-- 0005 guards found in review: never leave an organization without an owner; cap organizations per user.

create function public.memberships_keep_owner() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and exists (select 1 from organizations where id = old.org_id)  -- false while the org itself is being deleted
     and not exists (select 1 from memberships where org_id = old.org_id and role = 'owner' and user_id <> old.user_id)
  then
    raise exception 'organization must keep at least one owner';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.memberships_keep_owner() from public, anon, authenticated;
create trigger memberships_keep_owner before update or delete on public.memberships
  for each row execute function public.memberships_keep_owner();

-- Replaces 0001's version; same signature and grants. Limit is admin-editable: platform_settings 'limits.max_orgs_per_user' (default 5).
create or replace function public.create_organization(p_name text, p_type text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_id uuid; v_max int; v_count int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_type not in ('individual','agency','client_company','enterprise') then
    raise exception 'invalid organization type' using errcode = '22023'; end if;
  select coalesce((select (value #>> '{}')::int from platform_settings where key = 'limits.max_orgs_per_user'), 5) into v_max;
  select count(*) into v_count from organizations where created_by = auth.uid();
  if v_count >= v_max then raise exception 'organization limit reached' using errcode = '54000'; end if;
  insert into organizations (type, name, created_by) values (p_type, trim(p_name), auth.uid()) returning id into v_id;
  insert into memberships (user_id, org_id, role) values (auth.uid(), v_id, 'owner');
  return v_id;
end $$;
