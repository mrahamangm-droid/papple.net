-- 0026 moderation: queue, dismiss, hidden list and a mandatory reason for hiding. Platform staff (admin or support) with aal2.
create function public.staff_reason(p_reason text) returns text
language plpgsql stable security definer set search_path = public as
$$ declare v_reason text := trim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or not public.is_platform_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'second factor required' using errcode = '42501'; end if;
  if char_length(v_reason) not between 10 and 1000 then raise exception 'please give a reason' using errcode = '22023'; end if;
  return v_reason;
end $$;
create function public.staff_guard() returns void
language plpgsql stable security definer set search_path = public as
$$ begin
  if auth.uid() is null or not public.is_platform_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'second factor required' using errcode = '42501'; end if;
end $$;

create or replace function public.admin_set_visibility(p_kind text, p_id uuid, p_hidden boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_reason text := public.staff_reason(p_reason); v_entity text; v_before text; v_after text; v_n int;
begin
  if p_kind = 'profile' then
    v_entity := 'provider_profile';
    select status into v_before from provider_profiles where id = p_id;
    v_after := case when p_hidden then 'hidden_by_admin' else 'active' end;
    update provider_profiles set status = v_after where id = p_id;
  elsif p_kind = 'service' then
    v_entity := 'service';
    select status into v_before from services where id = p_id;
    v_after := case when p_hidden then 'hidden_by_admin' else 'draft' end;  -- owner republishes after an unhide
    update services set status = v_after where id = p_id;
  elsif p_kind = 'project' then
    v_entity := 'project';
    select status into v_before from projects where id = p_id;
    v_after := case when p_hidden then 'hidden_by_admin' else 'draft' end;
    update projects set status = v_after where id = p_id;
  else raise exception 'unknown target kind' using errcode = '22023'; end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'unknown target' using errcode = '22023'; end if;
  insert into audit_log (actor_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), case when p_hidden then 'marketplace.hide' else 'marketplace.unhide' end, v_entity, p_id::text,
          jsonb_build_object('status', v_before), jsonb_build_object('status', v_after, 'reason', left(v_reason, 500)),
          'success', gen_random_uuid()::text);
  if p_hidden then update content_reports set status = 'actioned' where target_kind = p_kind and target_id = p_id and status = 'open'; end if;
end $$;

create function public.moderation_queue(p_limit int default 50)
returns table (report_id uuid, target_kind text, target_id uuid, reason text, created_at timestamptz, open_count int, target_label text, target_status text)
language plpgsql stable security definer set search_path = public as
$$ begin
  perform public.staff_guard();
  return query
  select r.id, r.target_kind, r.target_id, r.reason, r.created_at,
         (select count(*)::int from content_reports o where o.target_kind = r.target_kind and o.target_id = r.target_id and o.status = 'open'),
         case r.target_kind
           when 'profile' then (select p.headline from provider_profiles p where p.id = r.target_id)
           when 'service' then (select s.title from services s where s.id = r.target_id)
           when 'project' then (select pr.title from projects pr where pr.id = r.target_id)
           when 'message' then (select left(m.body, 200) from messages m where m.id = r.target_id) end,
         case r.target_kind
           when 'profile' then (select p.status from provider_profiles p where p.id = r.target_id)
           when 'service' then (select s.status from services s where s.id = r.target_id)
           when 'project' then (select pr.status from projects pr where pr.id = r.target_id)
           else 'n/a' end
  from content_reports r where r.status = 'open'
  order by r.created_at, r.id limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

create function public.hidden_items(p_limit int default 100)
returns table (target_kind text, target_id uuid, target_label text)
language plpgsql stable security definer set search_path = public as
$$ begin
  perform public.staff_guard();
  return query
  (select 'profile'::text, p.id, p.headline from provider_profiles p where p.status = 'hidden_by_admin'
   union all select 'service', s.id, s.title from services s where s.status = 'hidden_by_admin'
   union all select 'project', pr.id, pr.title from projects pr where pr.status = 'hidden_by_admin')
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

create function public.dismiss_report(p_report uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_reason text := public.staff_reason(p_reason); v_r content_reports%rowtype;
begin
  select * into v_r from content_reports where id = p_report for update;
  if not found or v_r.status <> 'open' then raise exception 'report is not open' using errcode = '22023'; end if;
  update content_reports set status = 'dismissed' where id = p_report;
  insert into audit_log (actor_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), 'moderation.dismiss', 'content_report', p_report::text, jsonb_build_object('status', 'open'),
          jsonb_build_object('status', 'dismissed', 'target_kind', v_r.target_kind, 'reason', left(v_reason, 500)), 'success', gen_random_uuid()::text);
end $$;

revoke execute on function public.staff_reason(text), public.staff_guard(), public.moderation_queue(int), public.hidden_items(int), public.dismiss_report(uuid, text) from public, anon, authenticated;
grant execute on function public.moderation_queue(int), public.hidden_items(int), public.dismiss_report(uuid, text) to authenticated;
