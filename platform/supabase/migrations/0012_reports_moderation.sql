-- 0012 abuse reports and admin/support hide (post-moderation). Staff actions need a verified second factor (aal2) and are audited.

create function public.is_platform_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from platform_roles where user_id = auth.uid() and role in ('admin','support')) $$;

create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_kind text not null check (target_kind in ('profile','service','project','message')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 1000),
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at timestamptz not null default now()
);
create unique index content_reports_one_open on public.content_reports (reporter_id, target_kind, target_id)
  where status = 'open';

alter table public.content_reports enable row level security;
revoke all on public.content_reports from anon, public, authenticated;
grant select on public.content_reports to authenticated;
create policy content_reports_select on public.content_reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_platform_staff());

create function public.report_content(p_kind text, p_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_ok boolean; v_id uuid; v_reason text := trim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if char_length(v_reason) not between 1 and 1000 then raise exception 'invalid reason' using errcode = '22023'; end if;
  if p_kind = 'profile' then select exists (select 1 from public_provider_cards where id = p_id) into v_ok;
  elsif p_kind = 'service' then select exists (select 1 from public_service_cards where id = p_id) into v_ok;
  elsif p_kind = 'project' then select exists (select 1 from projects where id = p_id and status = 'open') into v_ok;
  elsif p_kind = 'message' then
    select exists (select 1 from messages m where m.id = p_id and public.is_conversation_member(m.conversation_id)) into v_ok;
  else raise exception 'unknown target kind' using errcode = '22023'; end if;
  if not v_ok then raise exception 'unknown target' using errcode = '22023'; end if;
  insert into content_reports (reporter_id, target_kind, target_id, reason) values (auth.uid(), p_kind, p_id, v_reason)
    returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'you already reported this' using errcode = '23505';
end $$;

create function public.admin_set_visibility(p_kind text, p_id uuid, p_hidden boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_entity text; v_before text; v_after text; v_n int;
begin
  if auth.uid() is null or not public.is_platform_staff() then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'second factor required' using errcode = '42501'; end if;
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
          jsonb_build_object('status', v_before), jsonb_build_object('status', v_after, 'reason', left(coalesce(p_reason, ''), 500)),
          'success', gen_random_uuid()::text);
  if p_hidden then update content_reports set status = 'actioned' where target_kind = p_kind and target_id = p_id and status = 'open'; end if;
end $$;

revoke execute on function public.is_platform_staff(), public.report_content(text,uuid,text),
  public.admin_set_visibility(text,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.is_platform_staff(), public.report_content(text,uuid,text),
  public.admin_set_visibility(text,uuid,boolean,text) to authenticated;
