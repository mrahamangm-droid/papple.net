-- 0041 spend approvals: owners can require their approval before an admin accepts a contract at or above a threshold.
-- Rows are written only by the RPCs below. Errcodes: 42501 not allowed, 22023 invalid, 23505 duplicate.
-- accept_contract now returns text ('accepted' | 'approval_requested' | 'approval_pending') instead of void.
-- Undo: drop functions spend_policy_set, spend_request_decide, spend_request_withdraw, spend_terms_hash, spend_audit,
-- spend_lapse_pending; drop tables spend_requests, spend_policies; recreate accept_contract and cancel_contract from 0016.

create table public.spend_policies (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default true,
  threshold_minor int not null check (threshold_minor between 0 and 2147483647),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.spend_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn','lapsed')),
  price int not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  terms_hash text not null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create unique index spend_requests_one_pending on public.spend_requests (org_id, contract_id) where status = 'pending';
create index spend_requests_org_idx on public.spend_requests (org_id, created_at desc);

alter table public.spend_policies enable row level security;
alter table public.spend_requests enable row level security;
revoke all on public.spend_policies, public.spend_requests from public, anon, authenticated;
grant select on public.spend_policies, public.spend_requests to authenticated;
-- the provider side never sees the client's rule or requests; members and viewers of the client do not either
create policy spend_policies_select on public.spend_policies for select to authenticated
  using (public.has_org_role(org_id, array['owner','admin']));
create policy spend_requests_select on public.spend_requests for select to authenticated
  using (public.has_org_role(org_id, array['owner','admin']));

-- Fingerprint of the milestone schedule, so an approval covers exactly the terms the owner saw.
create function public.spend_terms_hash(p_contract uuid) returns text
language sql stable security definer set search_path = public as
-- jsonb encoding, so separators typed into a title cannot make two different schedules look alike
$$ select md5(coalesce(jsonb_agg(jsonb_build_array(position, title, amount, due_date) order by position)::text, ''))
   from milestones where contract_id = p_contract $$;

create function public.spend_audit(p_org uuid, p_action text, p_request uuid, p_after jsonb) returns void
language sql security definer set search_path = public as
$$ insert into audit_log (actor_id, org_id, action, entity, entity_id, after, outcome, request_id)
   values (auth.uid(), p_org, p_action, 'spend_request', p_request::text, p_after, 'success', gen_random_uuid()::text) $$;

create function public.spend_policy_set(p_org uuid, p_enabled boolean, p_threshold int, p_currency text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_old spend_policies;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_enabled is null or p_threshold is null or p_threshold < 0 or p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid policy' using errcode = '22023'; end if;
  select * into v_old from spend_policies where org_id = p_org for update;
  insert into spend_policies (org_id, enabled, threshold_minor, currency, updated_by, updated_at)
  values (p_org, p_enabled, p_threshold, p_currency, auth.uid(), now())
  on conflict (org_id) do update set enabled = excluded.enabled, threshold_minor = excluded.threshold_minor,
    currency = excluded.currency, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), p_org, 'spend_policy.set', 'spend_policy', p_org::text,
    case when v_old.org_id is null then null else jsonb_build_object('enabled', v_old.enabled, 'threshold', v_old.threshold_minor, 'currency', v_old.currency) end,
    jsonb_build_object('enabled', p_enabled, 'threshold', p_threshold, 'currency', p_currency), 'success', gen_random_uuid()::text);
end $$;

-- Lapse any pending request for a contract that was settled another way (direct accept or cancellation).
create function public.spend_lapse_pending(p_contract uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare r record;
begin
  for r in update spend_requests set status = 'lapsed', decided_at = now()
           where contract_id = p_contract and status = 'pending' returning id, org_id loop
    perform public.spend_audit(r.org_id, 'spend_request.lapse', r.id, jsonb_build_object('contract', p_contract));
  end loop;
end $$;

drop function public.accept_contract(uuid, uuid);
create function public.accept_contract(p_org uuid, p_contract uuid) returns text
language plpgsql security definer set search_path = public as
$$ declare v_c contracts%rowtype; v_sum bigint; v_pol spend_policies; v_req spend_requests; v_hash text; v_id uuid; m record;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_c from contracts where id = p_contract for update; -- also serializes parallel requests for this contract
  if not found or p_org not in (v_c.client_org_id, v_c.provider_org_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_c.status <> 'draft' then raise exception 'contract is not editable' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into v_sum from milestones where contract_id = p_contract;
  if v_sum <> v_c.price then raise exception 'milestones must add up to the contract price' using errcode = '22023'; end if;
  if p_org = v_c.client_org_id and not public.has_org_role(p_org, array['owner']) then
    select * into v_pol from spend_policies where org_id = p_org and enabled;
    -- no currency conversion: a contract in another currency always needs approval
    if v_pol.org_id is not null and (v_c.currency <> v_pol.currency or v_c.price >= v_pol.threshold_minor) then
      v_hash := public.spend_terms_hash(p_contract);
      select * into v_req from spend_requests where org_id = p_org and contract_id = p_contract and status = 'pending' for update;
      if v_req.id is not null then
        if v_req.price = v_c.price and v_req.currency = v_c.currency and v_req.terms_hash = v_hash then return 'approval_pending'; end if;
        update spend_requests set status = 'lapsed', decided_at = now() where id = v_req.id;
        perform public.spend_audit(p_org, 'spend_request.lapse', v_req.id, jsonb_build_object('contract', p_contract));
      end if;
      insert into spend_requests (org_id, contract_id, requested_by, price, currency, terms_hash)
      values (p_org, p_contract, auth.uid(), v_c.price, v_c.currency, v_hash) returning id into v_id;
      perform public.spend_audit(p_org, 'spend_request.create', v_id, jsonb_build_object('contract', p_contract, 'price', v_c.price, 'currency', v_c.currency));
      for m in select user_id from memberships where org_id = p_org and role = 'owner' loop
        perform public.notify(m.user_id, 'spend_approval_requested', jsonb_build_object('contract_id', p_contract, 'request_id', v_id, 'org_id', p_org));
      end loop;
      return 'approval_requested';
    end if;
  end if;
  if p_org = v_c.client_org_id then
    update contracts set accepted_by_client = true where id = p_contract;
    -- accepted another way (an owner, or the rule changed): a pending request is no longer needed
    perform public.spend_lapse_pending(p_contract);
  else update contracts set accepted_by_provider = true where id = p_contract; end if;
  return 'accepted';
end $$;

create function public.spend_request_decide(p_org uuid, p_request uuid, p_approve boolean, p_note text) returns text
language plpgsql security definer set search_path = public as
$$ declare v_req spend_requests; v_c contracts%rowtype; v_sum bigint; v_note text := btrim(coalesce(p_note, ''));
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_req from spend_requests where id = p_request for update;
  if not found or v_req.org_id <> p_org then raise exception 'not allowed' using errcode = '42501'; end if;
  -- nobody decides their own request, including an admin who was promoted to owner since
  if v_req.requested_by = auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_req.status <> 'pending' or p_approve is null then raise exception 'request is not pending' using errcode = '22023'; end if;
  if not p_approve then
    if char_length(v_note) not between 1 and 500 then raise exception 'a note is required' using errcode = '22023'; end if;
    update spend_requests set status = 'rejected', note = v_note, decided_by = auth.uid(), decided_at = now() where id = p_request;
    perform public.spend_audit(p_org, 'spend_request.reject', p_request, jsonb_build_object('contract', v_req.contract_id));
    if v_req.requested_by is not null then
      perform public.notify(v_req.requested_by, 'spend_request_rejected', jsonb_build_object('contract_id', v_req.contract_id, 'request_id', p_request, 'org_id', p_org));
    end if;
    return 'rejected';
  end if;
  select * into v_c from contracts where id = v_req.contract_id for update;
  select coalesce(sum(amount), 0) into v_sum from milestones where contract_id = v_req.contract_id;
  if v_c.status <> 'draft' or v_c.price <> v_req.price or v_c.currency <> v_req.currency or v_sum <> v_c.price
     or public.spend_terms_hash(v_req.contract_id) <> v_req.terms_hash then
    update spend_requests set status = 'lapsed', decided_by = auth.uid(), decided_at = now() where id = p_request;
    perform public.spend_audit(p_org, 'spend_request.lapse', p_request, jsonb_build_object('contract', v_req.contract_id));
    return 'lapsed';
  end if;
  update spend_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_request;
  update contracts set accepted_by_client = true where id = v_req.contract_id;
  perform public.spend_audit(p_org, 'spend_request.approve', p_request, jsonb_build_object('contract', v_req.contract_id));
  if v_req.requested_by is not null then
    perform public.notify(v_req.requested_by, 'spend_request_approved', jsonb_build_object('contract_id', v_req.contract_id, 'request_id', p_request, 'org_id', p_org));
  end if;
  return 'approved';
end $$;

create function public.spend_request_withdraw(p_org uuid, p_request uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare v_req spend_requests;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_req from spend_requests where id = p_request for update;
  if not found or v_req.org_id <> p_org then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_req.status <> 'pending' then raise exception 'request is not pending' using errcode = '22023'; end if;
  if v_req.requested_by is distinct from auth.uid() and not public.has_org_role(p_org, array['owner']) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  update spend_requests set status = 'withdrawn', decided_by = auth.uid(), decided_at = now() where id = p_request;
  perform public.spend_audit(p_org, 'spend_request.withdraw', p_request, jsonb_build_object('contract', v_req.contract_id));
end $$;

-- Same as 0016 plus lapsing a pending approval request, so nothing waits on a cancelled draft.
create or replace function public.cancel_contract(p_org uuid, p_contract uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_c contracts%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_c from contracts where id = p_contract for update;
  if not found or p_org not in (v_c.client_org_id, v_c.provider_org_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_c.status <> 'draft' then raise exception 'only a draft contract can be cancelled here' using errcode = '22023'; end if;
  update contracts set status = 'cancelled', cancelled_reason = left(trim(coalesce(p_reason, '')), 1000) where id = p_contract;
  perform public.spend_lapse_pending(p_contract);
  perform public.notify_org(case when p_org = v_c.client_org_id then v_c.provider_org_id else v_c.client_org_id end,
    'contract_cancelled', jsonb_build_object('contract_id', p_contract), auth.uid());
end $$;

revoke execute on function public.spend_terms_hash(uuid), public.spend_audit(uuid, text, uuid, jsonb), public.spend_lapse_pending(uuid) from public, anon, authenticated;
revoke execute on function public.accept_contract(uuid, uuid), public.spend_policy_set(uuid, boolean, int, text),
  public.spend_request_decide(uuid, uuid, boolean, text), public.spend_request_withdraw(uuid, uuid) from public, anon;
grant execute on function public.accept_contract(uuid, uuid), public.spend_policy_set(uuid, boolean, int, text),
  public.spend_request_decide(uuid, uuid, boolean, text), public.spend_request_withdraw(uuid, uuid) to authenticated;
