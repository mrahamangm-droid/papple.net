-- 0016 contract lifecycle RPCs. Errcodes: 42501 not allowed, 22023 invalid, 54000 limit, 23505 duplicate.

create function public.setting_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = public as
$$ select coalesce((select (value #>> '{}')::int from platform_settings where key = p_key), p_default) $$;
revoke execute on function public.setting_int(text, int) from public, anon, authenticated;

create function public.create_contract(p_org uuid, p_proposal uuid) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_prop proposals%rowtype; v_proj projects%rowtype; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select project_id into v_proj.id from proposals where id = p_proposal;
  if v_proj.id is null then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('contract:' || v_proj.id::text, 0)); -- one hire per project at a time
  select * into v_proj from projects where id = v_proj.id for update;
  select * into v_prop from proposals where id = p_proposal for update;
  if v_proj.org_id <> p_org then raise exception 'not allowed' using errcode = '42501'; end if;
  -- a person controlling both sides could hire themselves
  if public.is_member(v_prop.org_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if exists (select 1 from contracts where proposal_id = p_proposal) then
    raise exception 'a contract already exists for this proposal' using errcode = '23505'; end if;
  if v_prop.status <> 'shortlisted' or v_proj.status <> 'open' then
    raise exception 'proposal cannot be hired' using errcode = '22023'; end if;
  insert into contracts (project_id, proposal_id, client_org_id, provider_org_id, title, price, currency,
      commission_pro_bps, commission_client_bps, created_by)
  values (v_proj.id, p_proposal, p_org, v_prop.org_id, left(v_proj.title, 200), v_prop.price, v_prop.currency,
      public.setting_int('commission.professional_bps', 0), public.setting_int('commission.client_bps', 0), auth.uid())
  returning id into v_id;
  update proposals set status = 'hired' where id = p_proposal;
  update projects set status = 'closed' where id = v_proj.id;
  perform public.notify_org(v_prop.org_id, 'contract_offered', jsonb_build_object('contract_id', v_id), auth.uid());
  return v_id;
end $$;

create function public.set_milestones(p_org uuid, p_contract uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = public as
$$ declare v_c contracts%rowtype; v_max int := public.setting_int('contracts.max_milestones', 20); v_min int := public.setting_int('contracts.min_milestone_minor', 1); v_n int; v_item jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_c from contracts where id = p_contract for update;
  if not found or p_org not in (v_c.client_org_id, v_c.provider_org_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_c.status <> 'draft' then raise exception 'contract is not editable' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'invalid milestones' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_items);
  if v_n < 1 then raise exception 'invalid milestones' using errcode = '22023'; end if;
  if v_n > v_max then raise exception 'too many milestones' using errcode = '54000'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or char_length(trim(coalesce(v_item->>'title',''))) not between 1 and 200
       or char_length(coalesce(v_item->>'description','')) > 2000
       or coalesce(v_item->>'amount','') !~ '^[0-9]{1,10}$'
       or (v_item->>'amount')::bigint not between greatest(v_min, 1) and 2147483647
       or (v_item ? 'due_date' and v_item->>'due_date' is not null and v_item->>'due_date' !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception 'invalid milestone' using errcode = '22023'; end if;
  end loop;
  delete from milestones where contract_id = p_contract;
  insert into milestones (contract_id, position, title, description, amount, due_date)
  select p_contract, t.ord::int, trim(t.item->>'title'), coalesce(t.item->>'description',''),
         (t.item->>'amount')::int, nullif(t.item->>'due_date','')::date
  from jsonb_array_elements(p_items) with ordinality as t(item, ord);
  update contracts set accepted_by_client = false, accepted_by_provider = false where id = p_contract;
end $$;

create function public.accept_contract(p_org uuid, p_contract uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare v_c contracts%rowtype; v_sum bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_c from contracts where id = p_contract for update;
  if not found or p_org not in (v_c.client_org_id, v_c.provider_org_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_c.status <> 'draft' then raise exception 'contract is not editable' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into v_sum from milestones where contract_id = p_contract;
  if v_sum <> v_c.price then raise exception 'milestones must add up to the contract price' using errcode = '22023'; end if;
  if p_org = v_c.client_org_id then update contracts set accepted_by_client = true where id = p_contract;
  else update contracts set accepted_by_provider = true where id = p_contract; end if;
end $$;

create function public.activate_contract(p_contract uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare v_c contracts%rowtype; v_sum bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_c from contracts where id = p_contract for update;
  if not found or not (public.has_org_role(v_c.client_org_id, array['owner','admin'])
                       or public.has_org_role(v_c.provider_org_id, array['owner','admin'])) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if v_c.status <> 'draft' or not v_c.accepted_by_client or not v_c.accepted_by_provider then
    raise exception 'both sides must accept first' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into v_sum from milestones where contract_id = p_contract;
  if v_sum <> v_c.price then raise exception 'milestones must add up to the contract price' using errcode = '22023'; end if;
  if not exists (select 1 from connected_accounts where org_id = v_c.provider_org_id and payouts_enabled) then
    raise exception 'the professional has not finished payout setup' using errcode = '22023'; end if;
  update contracts set status = 'active' where id = p_contract;
  perform public.notify_org(v_c.client_org_id, 'contract_active', jsonb_build_object('contract_id', p_contract), auth.uid());
  perform public.notify_org(v_c.provider_org_id, 'contract_active', jsonb_build_object('contract_id', p_contract), auth.uid());
end $$;

create function public.submit_milestone(p_org uuid, p_milestone uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare v_m milestones%rowtype; v_c contracts%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_m from milestones where id = p_milestone for update;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_c from contracts where id = v_m.contract_id for update;
  if p_org <> v_c.provider_org_id then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_c.status <> 'active' or v_m.status not in ('pending','changes_requested') then
    raise exception 'milestone cannot be submitted' using errcode = '22023'; end if;
  update milestones set status = 'submitted', change_note = null where id = p_milestone;
  perform public.notify_org(v_c.client_org_id, 'milestone_submitted',
    jsonb_build_object('contract_id', v_c.id, 'milestone_id', p_milestone), auth.uid());
end $$;

create function public.request_changes(p_org uuid, p_milestone uuid, p_note text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_m milestones%rowtype; v_c contracts%rowtype; v_note text := trim(coalesce(p_note, ''));
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_m from milestones where id = p_milestone for update;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_c from contracts where id = v_m.contract_id for update;
  if p_org <> v_c.client_org_id then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(v_note) not between 1 and 1000 then raise exception 'a note is required' using errcode = '22023'; end if;
  if v_c.status <> 'active' or v_m.status <> 'submitted' then
    raise exception 'milestone is not awaiting review' using errcode = '22023'; end if;
  update milestones set status = 'changes_requested', change_note = v_note where id = p_milestone;
  perform public.notify_org(v_c.provider_org_id, 'milestone_changes_requested',
    jsonb_build_object('contract_id', v_c.id, 'milestone_id', p_milestone), auth.uid());
end $$;

create function public.cancel_contract(p_org uuid, p_contract uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_c contracts%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_c from contracts where id = p_contract for update;
  if not found or p_org not in (v_c.client_org_id, v_c.provider_org_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_c.status <> 'draft' then raise exception 'only a draft contract can be cancelled here' using errcode = '22023'; end if;
  update contracts set status = 'cancelled', cancelled_reason = left(trim(coalesce(p_reason, '')), 1000) where id = p_contract;
  perform public.notify_org(case when p_org = v_c.client_org_id then v_c.provider_org_id else v_c.client_org_id end,
    'contract_cancelled', jsonb_build_object('contract_id', p_contract), auth.uid());
end $$;

revoke execute on function public.create_contract(uuid,uuid), public.set_milestones(uuid,uuid,jsonb),
  public.accept_contract(uuid,uuid), public.activate_contract(uuid), public.submit_milestone(uuid,uuid),
  public.request_changes(uuid,uuid,text), public.cancel_contract(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.create_contract(uuid,uuid), public.set_milestones(uuid,uuid,jsonb),
  public.accept_contract(uuid,uuid), public.activate_contract(uuid), public.submit_milestone(uuid,uuid),
  public.request_changes(uuid,uuid,text), public.cancel_contract(uuid,uuid,text) to authenticated;
