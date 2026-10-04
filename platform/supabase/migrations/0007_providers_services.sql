-- 0007 provider profiles, portfolio, services and the narrow public views.
-- Base tables are default-deny for anon. Public pages read only public_* views (whitelisted columns).

create function public.make_slug(p_text text) returns text
language plpgsql volatile set search_path = public as
$$ declare s text;
begin
  s := lower(regexp_replace(coalesce(p_text, ''), '[^a-zA-Z0-9]+', '-', 'g'));
  s := trim(both '-' from s);
  s := trim(both '-' from left(s, 60));
  if s = '' then
    s := 'p-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
  end if;
  return s;
end $$;

create table public.provider_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.organizations (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,70}$'),
  headline text not null check (char_length(headline) between 3 and 120),
  summary text not null default '' check (char_length(summary) <= 5000),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  languages text[] not null default '{}' check (cardinality(languages) <= 10),
  hourly_min int check (hourly_min is null or hourly_min >= 0),
  hourly_max int check (hourly_max is null or hourly_max >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  availability text not null default 'available' check (availability in ('available','limited','unavailable')),
  visibility text not null default 'public' check (visibility in ('public','private')),
  status text not null default 'active' check (status in ('active','hidden_by_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (hourly_min is null or hourly_max is null or hourly_min <= hourly_max)
);

create table public.provider_skills (
  profile_id uuid not null references public.provider_profiles (id) on delete cascade,
  skill_id uuid not null references public.skills (id) on delete cascade,
  primary key (profile_id, skill_id)
);

create table public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.provider_profiles (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  file_key text check (file_key is null or char_length(file_key) <= 300),
  link text check (link is null or link ~ '^https://'),
  created_at timestamptz not null default now()
);
create index portfolio_items_profile_idx on public.portfolio_items (profile_id);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,70}$'),
  title text not null check (char_length(title) between 3 and 120),
  description text not null default '' check (char_length(description) <= 5000),
  pricing_model text not null default 'quote' check (pricing_model in ('fixed','hourly','quote')),
  price_min int check (price_min is null or price_min >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  delivery_days int check (delivery_days is null or delivery_days between 1 and 3650),
  status text not null default 'draft' check (status in ('draft','published','archived','hidden_by_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index services_org_idx on public.services (org_id);
create index services_category_idx on public.services (category_id);

alter table public.provider_profiles enable row level security;
alter table public.provider_skills enable row level security;
alter table public.portfolio_items enable row level security;
alter table public.services enable row level security;

revoke all on public.provider_profiles, public.provider_skills, public.portfolio_items, public.services
  from anon, public, authenticated;
grant select on public.provider_profiles, public.provider_skills, public.services to authenticated;
grant select, insert, update, delete on public.portfolio_items to authenticated;

create policy profiles_select on public.provider_profiles for select to authenticated
  using (public.is_member(org_id) or public.is_platform_admin());
create policy provider_skills_select on public.provider_skills for select to authenticated
  using (exists (select 1 from public.provider_profiles p where p.id = profile_id
                 and (public.is_member(p.org_id) or public.is_platform_admin())));
create policy services_select on public.services for select to authenticated
  using (public.is_member(org_id) or public.is_platform_admin());
create policy portfolio_select on public.portfolio_items for select to authenticated
  using (public.is_member(org_id) or public.is_platform_admin());
create policy portfolio_write on public.portfolio_items for all to authenticated
  using (public.has_org_role(org_id, array['owner','admin']))
  with check (public.has_org_role(org_id, array['owner','admin'])
              and exists (select 1 from public.provider_profiles p where p.id = profile_id and p.org_id = portfolio_items.org_id));

create function public.portfolio_limit_guard() returns trigger
language plpgsql security definer set search_path = public as
$$ declare v_max int;
begin
  perform pg_advisory_xact_lock(hashtextextended('portfolio:' || new.org_id::text, 0)); -- serialize the limit check per org
  v_max := public.org_limit(new.org_id, 'limits.max_portfolio_items');
  if v_max is not null and (select count(*) from portfolio_items where profile_id = new.profile_id) >= v_max then
    raise exception 'portfolio limit reached' using errcode = '54000';
  end if;
  return new;
end $$;
create trigger portfolio_limit_guard before insert on public.portfolio_items
  for each row execute function public.portfolio_limit_guard();

create function public.touch_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at := now(); return new; end $$;
create trigger provider_profiles_touch before update on public.provider_profiles
  for each row execute function public.touch_updated_at();
create trigger services_touch before update on public.services
  for each row execute function public.touch_updated_at();

-- Writes go through RPCs: explicit org, role re-checked, validated input.
create function public.upsert_provider_profile(
  p_org uuid, p_headline text, p_summary text, p_country text, p_languages text[],
  p_hourly_min int, p_hourly_max int, p_currency text, p_availability text, p_visibility text,
  p_skill_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_type text; v_id uuid; v_base text; v_slug text; v_n int := 1;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin']) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  select type into v_type from organizations where id = p_org;
  if v_type is null or v_type not in ('individual','agency') then
    raise exception 'this organization type cannot have a provider profile' using errcode = '22023'; end if;
  if p_headline is null or char_length(trim(p_headline)) not between 3 and 120 then
    raise exception 'invalid headline' using errcode = '22023'; end if;
  if p_availability not in ('available','limited','unavailable') or p_visibility not in ('public','private') then
    raise exception 'invalid availability or visibility' using errcode = '22023'; end if;
  if p_currency !~ '^[A-Z]{3}$' or (p_country is not null and p_country !~ '^[A-Z]{2}$') then
    raise exception 'invalid currency or country' using errcode = '22023'; end if;
  if p_hourly_min is not null and p_hourly_max is not null and p_hourly_min > p_hourly_max then
    raise exception 'invalid rate range' using errcode = '22023'; end if;
  if coalesce(array_length(p_skill_ids, 1), 0) > 30 then
    raise exception 'too many skills' using errcode = '22023'; end if;
  if (select count(*) from skills where id = any (coalesce(p_skill_ids, '{}')) and is_active)
     <> coalesce(array_length(p_skill_ids, 1), 0) then
    raise exception 'unknown skill' using errcode = '22023'; end if;

  select id into v_id from provider_profiles where org_id = p_org;
  if v_id is null then
    v_base := public.make_slug(p_headline); v_slug := v_base;
    while exists (select 1 from provider_profiles where slug = v_slug) loop
      v_n := v_n + 1; v_slug := left(v_base, 60) || '-' || v_n;
    end loop;
    insert into provider_profiles (org_id, slug, headline, summary, country, languages, hourly_min, hourly_max,
                                   currency, availability, visibility)
    values (p_org, v_slug, trim(p_headline), coalesce(p_summary, ''), p_country, coalesce(p_languages, '{}'),
            p_hourly_min, p_hourly_max, p_currency, p_availability, p_visibility)
    returning id into v_id;
  else
    update provider_profiles set headline = trim(p_headline), summary = coalesce(p_summary, ''), country = p_country,
      languages = coalesce(p_languages, '{}'), hourly_min = p_hourly_min, hourly_max = p_hourly_max,
      currency = p_currency, availability = p_availability, visibility = p_visibility
    where id = v_id;
  end if;
  delete from provider_skills where profile_id = v_id;
  insert into provider_skills (profile_id, skill_id)
    select v_id, s from unnest(coalesce(p_skill_ids, '{}')) s on conflict do nothing;
  return v_id;
end $$;

create function public.upsert_service(
  p_org uuid, p_id uuid, p_category uuid, p_title text, p_description text, p_pricing_model text,
  p_price_min int, p_currency text, p_delivery_days int, p_status text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_id uuid; v_old text; v_max int; v_base text; v_slug text; v_n int := 1;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin']) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from provider_profiles where org_id = p_org) then
    raise exception 'create a provider profile first' using errcode = '22023'; end if;
  if p_title is null or char_length(trim(p_title)) not between 3 and 120
     or p_pricing_model not in ('fixed','hourly','quote') or p_status not in ('draft','published','archived')
     or p_currency !~ '^[A-Z]{3}$' or coalesce(p_price_min, 0) < 0
     or (p_delivery_days is not null and p_delivery_days not between 1 and 3650) then
    raise exception 'invalid service' using errcode = '22023'; end if;
  if p_category is not null and not exists (select 1 from categories where id = p_category and is_active) then
    raise exception 'unknown category' using errcode = '22023'; end if;

  if p_id is not null then
    select status into v_old from services where id = p_id and org_id = p_org;
    if not found then raise exception 'not allowed' using errcode = '42501'; end if;
    if v_old = 'hidden_by_admin' then raise exception 'not allowed' using errcode = '42501'; end if;
  end if;
  if p_status = 'published' and coalesce(v_old, '') <> 'published' then
    perform pg_advisory_xact_lock(hashtextextended('services:' || p_org::text, 0)); -- serialize the limit check per org
    v_max := public.org_limit(p_org, 'limits.max_services');
    if v_max is not null and (select count(*) from services where org_id = p_org and status = 'published') >= v_max then
      raise exception 'service limit reached' using errcode = '54000'; end if;
  end if;

  if p_id is null then
    v_base := public.make_slug(p_title); v_slug := v_base;
    while exists (select 1 from services where slug = v_slug) loop
      v_n := v_n + 1; v_slug := left(v_base, 60) || '-' || v_n;
    end loop;
    insert into services (org_id, category_id, slug, title, description, pricing_model, price_min, currency,
                          delivery_days, status)
    values (p_org, p_category, v_slug, trim(p_title), coalesce(p_description, ''), p_pricing_model, p_price_min,
            p_currency, p_delivery_days, p_status) returning id into v_id;
  else
    update services set category_id = p_category, title = trim(p_title), description = coalesce(p_description, ''),
      pricing_model = p_pricing_model, price_min = p_price_min, currency = p_currency,
      delivery_days = p_delivery_days, status = p_status
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

-- Public views: whitelisted columns, no org ids, only public + active owners.
create view public.public_provider_cards with (security_barrier = true) as
select p.id, p.slug, p.headline, left(p.summary, 400) as summary, o.name as display_name, o.type as entity_type,
       p.country, p.languages, p.hourly_min, p.hourly_max, p.currency, p.availability, p.updated_at,
       coalesce((select array_agg(s.name order by s.name) from provider_skills ps join skills s on s.id = ps.skill_id
                 where ps.profile_id = p.id and s.is_active), '{}') as skills
from provider_profiles p join organizations o on o.id = p.org_id
where p.visibility = 'public' and p.status = 'active' and o.status = 'active';

create view public.public_service_cards with (security_barrier = true) as
select s.id, s.slug, s.title, left(s.description, 400) as description, s.pricing_model, s.price_min, s.currency,
       s.delivery_days, s.category_id, s.updated_at, p.id as provider_id, p.slug as provider_slug,
       p.headline as provider_headline, o.name as provider_name
from services s
join provider_profiles p on p.org_id = s.org_id
join organizations o on o.id = s.org_id
where s.status = 'published' and p.visibility = 'public' and p.status = 'active' and o.status = 'active';

grant select on public.public_provider_cards, public.public_service_cards to anon, authenticated;

revoke execute on function public.make_slug(text), public.touch_updated_at(), public.portfolio_limit_guard(),
  public.upsert_provider_profile(uuid,text,text,text,text[],int,int,text,text,text,uuid[]),
  public.upsert_service(uuid,uuid,uuid,text,text,text,int,text,int,text) from public, anon, authenticated;
grant execute on function public.make_slug(text),
  public.upsert_provider_profile(uuid,text,text,text,text[],int,int,text,text,text,uuid[]),
  public.upsert_service(uuid,uuid,uuid,text,text,text,int,text,int,text) to authenticated;
