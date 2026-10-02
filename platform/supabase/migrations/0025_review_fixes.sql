-- 0025 fixes from the admin-console review.
-- (1) Console edits are the only way to change settings, flags and plans: no direct admin writes that skip aal2, reason and audit.
drop policy plans_admin_write on public.plans;
drop policy settings_admin_write on public.platform_settings;
drop policy flags_admin_write on public.feature_flags;
drop policy flag_overrides_admin_write on public.feature_flag_overrides;
revoke insert, update, delete on public.plans, public.platform_settings, public.feature_flags, public.feature_flag_overrides from authenticated;

-- (2) "Is this person on that side" guards must not switch off when that side is suspended. belongs_to ignores organization status.
create function public.belongs_to(p_org uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from memberships where org_id = p_org and user_id = auth.uid()) $$;
revoke execute on function public.belongs_to(uuid) from public, anon;
grant execute on function public.belongs_to(uuid) to authenticated;

do $$ declare f record; def text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('create_contract', 'approve_milestone', 'submit_proposal', 'post_review') loop
    def := pg_get_functiondef(f.oid);
    if def like '%is_member(%' then execute replace(def, 'public.is_member(', 'public.belongs_to('); end if;
  end loop;
end $$;

-- (3) A verified badge does not survive a rename: the evidence was for the old name.
create function public.clear_verification_on_rename() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if new.name is distinct from old.name and exists (select 1 from provider_profiles where org_id = new.id and verified_at is not null) then
    update provider_profiles set verified_at = null where org_id = new.id;
    insert into audit_log (actor_id, org_id, action, entity, entity_id, after, outcome, request_id)
    values (auth.uid(), new.id, 'verification.cleared_on_rename', 'organization', new.id::text, jsonb_build_object('old_name', old.name, 'new_name', new.name), 'success', gen_random_uuid()::text);
  end if;
  return new;
end $$;
revoke execute on function public.clear_verification_on_rename() from public, anon, authenticated;
create trigger organizations_clear_verification after update of name on public.organizations
  for each row execute function public.clear_verification_on_rename();

-- (4) Re-check the caller is still an administrator after taking the lock, so a role revoked a moment ago cannot revoke another.
create or replace function public.admin_set_platform_role(p_user uuid, p_role text, p_grant boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_reason text := public.admin_guard(p_reason); v_had boolean;
begin
  if p_role not in ('admin','support') or p_grant is null then raise exception 'invalid role' using errcode = '22023'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own role' using errcode = '22023'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'unknown user' using errcode = '22023'; end if;
  perform 1 from platform_roles where role = 'admin' order by user_id for update;
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
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
