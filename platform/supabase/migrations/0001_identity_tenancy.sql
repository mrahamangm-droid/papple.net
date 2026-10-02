-- 0001 identity & tenancy. Default-deny RLS; helpers are SECURITY DEFINER with fixed search_path.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  persona text check (persona in ('client','professional','agency','enterprise','pgan_expert')),
  locale text not null default 'en',
  status text not null default 'active' check (status in ('active','pending_verification','suspended')),
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('individual','agency','client_company','enterprise')),
  name text not null check (char_length(name) between 2 and 120),
  status text not null default 'active' check (status in ('active','suspended','closed')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  role text not null check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);
create index memberships_org_idx on public.memberships (org_id);

create table public.platform_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin','support')),
  primary key (user_id, role)
);

-- helpers (read memberships live so removal takes effect immediately)
create function public.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from memberships where org_id = p_org and user_id = auth.uid()) $$;

create function public.has_org_role(p_org uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from memberships where org_id = p_org and user_id = auth.uid() and role = any (p_roles)) $$;

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from platform_roles where user_id = auth.uid() and role = 'admin') $$;

create function public.shares_org(p_user uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from memberships a join memberships b on a.org_id = b.org_id
     where a.user_id = auth.uid() and b.user_id = p_user) $$;

-- profile auto-creation
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- atomic org creation (only way for users to create orgs)
create function public.create_organization(p_name text, p_type text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_type not in ('individual','agency','client_company','enterprise') then
    raise exception 'invalid organization type' using errcode = '22023'; end if;
  insert into organizations (type, name, created_by) values (p_type, trim(p_name), auth.uid()) returning id into v_id;
  insert into memberships (user_id, org_id, role) values (auth.uid(), v_id, 'owner');
  return v_id;
end $$;

-- privileges: nothing for anon/public; narrow grants for authenticated
revoke all on public.profiles, public.organizations, public.memberships, public.platform_roles from anon, public;
revoke all on public.profiles, public.organizations, public.memberships, public.platform_roles from authenticated;
grant select on public.profiles, public.organizations, public.memberships, public.platform_roles to authenticated;
grant update (display_name, locale, persona) on public.profiles to authenticated;
grant update (name) on public.organizations to authenticated;
grant insert, update, delete on public.memberships to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
revoke execute on function public.is_member(uuid), public.has_org_role(uuid, text[]), public.is_platform_admin(),
  public.shares_org(uuid), public.create_organization(text, text), public.handle_new_user() from public, anon;
grant execute on function public.is_member(uuid), public.has_org_role(uuid, text[]), public.is_platform_admin(),
  public.shares_org(uuid), public.create_organization(text, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.platform_roles enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_org(id) or public.is_platform_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy organizations_select on public.organizations for select to authenticated
  using (public.is_member(id) or public.is_platform_admin());
create policy organizations_update on public.organizations for update to authenticated
  using (public.has_org_role(id, array['owner','admin'])) with check (public.has_org_role(id, array['owner','admin']));

create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.is_member(org_id) or public.is_platform_admin());
create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.has_org_role(org_id, array['owner','admin'])
              and (role <> 'owner' or public.has_org_role(org_id, array['owner'])));
create policy memberships_update on public.memberships for update to authenticated
  using (public.has_org_role(org_id, array['owner'])
         or (public.has_org_role(org_id, array['admin']) and role <> 'owner'))
  with check (public.has_org_role(org_id, array['owner','admin'])
              and (role <> 'owner' or public.has_org_role(org_id, array['owner'])));
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.has_org_role(org_id, array['owner'])
         or (public.has_org_role(org_id, array['admin']) and role not in ('owner','admin'))
         or (user_id = auth.uid() and role <> 'owner'));

create policy platform_roles_select_own on public.platform_roles for select to authenticated
  using (user_id = auth.uid());
