-- 0023 suspend organizations and manage staff roles. Admin only, aal2, reason, audited.
-- A suspended organization's memberships stop counting (is_member / has_org_role), so its members lose access to its data and actions.
-- Platform staff checks and service-role flows (webhooks) do not go through these helpers, so they are unaffected, and a counterparty keeps its own access.
create or replace function public.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from memberships m join organizations o on o.id = m.org_id
                  where m.org_id = p_org and m.user_id = auth.uid() and o.status = 'active') $$;

create or replace function public.has_org_role(p_org uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from memberships m join organizations o on o.id = m.org_id
                  where m.org_id = p_org and m.user_id = auth.uid() and m.role = any (p_roles) and o.status = 'active') $$;

create policy platform_roles_select_admin on public.platform_roles for select to authenticated using (public.is_platform_admin());

create function public.admin_set_org_status(p_org uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_reason text := public.admin_guard(p_reason); v_old text;
begin
  if p_status not in ('active','suspended') then raise exception 'invalid status' using errcode = '22023'; end if;
  select status into v_old from organizations where id = p_org for update;
  if not found or v_old = 'closed' then raise exception 'organization cannot be changed' using errcode = '22023'; end if;
  if v_old <> p_status then
    update organizations set status = p_status where id = p_org;
    insert into audit_log (actor_id, org_id, action, entity, entity_id, before, after, outcome, request_id)
    values (auth.uid(), p_org, 'admin.org.status', 'organization', p_org::text, jsonb_build_object('status', v_old),
            jsonb_build_object('status', p_status, 'reason', left(v_reason, 500)), 'success', gen_random_uuid()::text);
    perform public.notify_org(p_org, case when p_status = 'suspended' then 'org_suspended' else 'org_restored' end, '{}'::jsonb);
  end if;
end $$;

create function public.admin_set_platform_role(p_user uuid, p_role text, p_grant boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_reason text := public.admin_guard(p_reason); v_had boolean;
begin
  if p_role not in ('admin','support') or p_grant is null then raise exception 'invalid role' using errcode = '22023'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own role' using errcode = '22023'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'unknown user' using errcode = '22023'; end if;
  perform 1 from platform_roles where role = 'admin' order by user_id for update;
  v_had := exists (select 1 from platform_roles where user_id = p_user and role = p_role);
  if p_grant and not v_had then
    insert into platform_roles (user_id, role) values (p_user, p_role);
  elsif not p_grant and v_had then
    if p_role = 'admin' and not exists (select 1 from platform_roles where role = 'admin' and user_id <> p_user) then
      raise exception 'an administrator must remain' using errcode = '22023'; end if;
    delete from platform_roles where user_id = p_user and role = p_role;
  else
    return;
  end if;
  insert into audit_log (actor_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), 'admin.role.set', 'user', p_user::text, jsonb_build_object('had_role', v_had),
          jsonb_build_object('role', p_role, 'granted', p_grant, 'reason', left(v_reason, 500)), 'success', gen_random_uuid()::text);
end $$;

revoke execute on function public.admin_set_org_status(uuid, text, text), public.admin_set_platform_role(uuid, text, boolean, text) from public, anon;
grant execute on function public.admin_set_org_status(uuid, text, text), public.admin_set_platform_role(uuid, text, boolean, text) to authenticated;
