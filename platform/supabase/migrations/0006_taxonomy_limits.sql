-- 0006 marketplace taxonomy + per-plan limit helpers. Taxonomy is Admin-managed data, not code.
create extension if not exists pg_trgm with schema extensions;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories (id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name text not null check (char_length(name) between 2 and 80),
  position int not null default 0,
  is_active boolean not null default true
);
create index categories_parent_idx on public.categories (parent_id);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories (id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name text not null check (char_length(name) between 2 and 80),
  is_active boolean not null default true
);
create index skills_category_idx on public.skills (category_id);

alter table public.categories enable row level security;
alter table public.skills enable row level security;

revoke all on public.categories, public.skills from anon, public, authenticated;
grant select on public.categories, public.skills to anon, authenticated;
grant insert, update, delete on public.categories, public.skills to authenticated;

create policy categories_select_anon on public.categories for select to anon using (is_active);
create policy categories_select_auth on public.categories for select to authenticated
  using (is_active or public.is_platform_admin());
create policy categories_admin_write on public.categories for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy skills_select_anon on public.skills for select to anon using (is_active);
create policy skills_select_auth on public.skills for select to authenticated
  using (is_active or public.is_platform_admin());
create policy skills_admin_write on public.skills for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Plan resolution. Subscriptions arrive in sub-project 3; until then every org is on 'free'.
create function public.org_plan_key(p_org uuid) returns text
language sql stable security definer set search_path = public as
$$ select 'free'::text $$;

-- Limit lookup: platform_settings value is either a scalar or an object keyed by plan with a "default".
-- JSON null (or a missing key) means unlimited and is returned as SQL null.
create function public.org_limit(p_org uuid, p_key text) returns int
language plpgsql stable security definer set search_path = public as
$$ declare v jsonb; plan text := public.org_plan_key(p_org);
begin
  select value into v from platform_settings where key = p_key;
  if v is null then return null; end if;
  if jsonb_typeof(v) = 'object' then
    if v ? plan then v := v -> plan;
    elsif v ? 'default' then v := v -> 'default';
    else return null; end if;
  end if;
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  return (v #>> '{}')::int;
end $$;

revoke execute on function public.org_plan_key(uuid), public.org_limit(uuid, text) from public, anon, authenticated;
grant execute on function public.org_plan_key(uuid), public.org_limit(uuid, text) to authenticated;
