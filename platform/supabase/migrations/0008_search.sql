-- 0008 search: full-text (simple config, multilingual-safe) + trigram typo tolerance. Results come only from the public views.

alter table public.provider_profiles
  add column skills_text text not null default '',
  add column search_vector tsvector;
alter table public.services add column search_vector tsvector;

create function public.provider_profiles_vector() returns trigger
language plpgsql set search_path = public as
$$ begin
  new.search_vector :=
    setweight(to_tsvector('simple', coalesce(new.headline, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(new.skills_text, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(new.summary, '')), 'C');
  return new;
end $$;
create trigger provider_profiles_vector before insert or update of headline, summary, skills_text
  on public.provider_profiles for each row execute function public.provider_profiles_vector();

create function public.services_vector() returns trigger
language plpgsql set search_path = public as
$$ begin
  new.search_vector :=
    setweight(to_tsvector('simple', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(new.description, '')), 'C');
  return new;
end $$;
create trigger services_vector before insert or update of title, description
  on public.services for each row execute function public.services_vector();

-- keep skills_text in step with provider_skills
create function public.refresh_provider_skills_text() returns trigger
language plpgsql security definer set search_path = public as
$$ declare v_profile uuid := coalesce(new.profile_id, old.profile_id);
begin
  update provider_profiles p set skills_text = coalesce((
    select string_agg(s.name, ' ' order by s.name) from provider_skills ps join skills s on s.id = ps.skill_id
    where ps.profile_id = v_profile), '')
  where p.id = v_profile;
  return null;
end $$;
create trigger provider_skills_text after insert or delete on public.provider_skills
  for each row execute function public.refresh_provider_skills_text();

-- backfill (no-op on empty tables)
update public.provider_profiles set headline = headline;
update public.services set title = title;

create index provider_profiles_search_idx on public.provider_profiles using gin (search_vector);
create index provider_profiles_headline_trgm on public.provider_profiles using gin (headline extensions.gin_trgm_ops);
create index services_search_idx on public.services using gin (search_vector);
create index services_title_trgm on public.services using gin (title extensions.gin_trgm_ops);

-- Rank is double precision so browse-mode epoch seconds keep their precision for keyset paging.
create function public.search_provider_cards(
  p_q text, p_category uuid, p_skill_ids uuid[], p_country text, p_rate_max int, p_availability text,
  p_after_rank double precision, p_after_id uuid, p_limit int)
returns table (card jsonb, rank double precision, id uuid)
language plpgsql stable security definer set search_path = public, extensions as
$$ declare q text := left(trim(coalesce(p_q, '')), 200); tsq tsquery; lim int := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  if q <> '' then tsq := websearch_to_tsquery('simple', q); end if;
  return query
  select to_jsonb(v), r.rank, v.id
  from public.public_provider_cards v
  join public.provider_profiles p on p.id = v.id
  cross join lateral (select case when q = '' then extract(epoch from p.updated_at)::double precision
      else ts_rank(p.search_vector, tsq)::double precision + word_similarity(q, p.headline)::double precision end as rank) r
  where (q = '' or p.search_vector @@ tsq or word_similarity(q, p.headline) > 0.4)
    and (p_country is null or p.country = upper(p_country))
    and (p_availability is null or p.availability = p_availability)
    and (p_rate_max is null or (p.hourly_min is not null and p.hourly_min <= p_rate_max))
    and (p_skill_ids is null or cardinality(p_skill_ids) = 0 or
         (select count(distinct ps.skill_id) from provider_skills ps where ps.profile_id = p.id and ps.skill_id = any (p_skill_ids))
         = (select count(distinct x) from unnest(p_skill_ids) x))
    and (p_category is null or exists (select 1 from provider_skills ps join skills s on s.id = ps.skill_id
         where ps.profile_id = p.id and (s.category_id = p_category or s.category_id in (select c.id from categories c where c.parent_id = p_category))))
    and (p_after_rank is null or p_after_id is null or r.rank < p_after_rank or (r.rank = p_after_rank and v.id > p_after_id))
  order by r.rank desc, v.id
  limit lim;
end $$;

create function public.search_service_cards(
  p_q text, p_category uuid, p_price_max int, p_after_rank double precision, p_after_id uuid, p_limit int)
returns table (card jsonb, rank double precision, id uuid)
language plpgsql stable security definer set search_path = public, extensions as
$$ declare q text := left(trim(coalesce(p_q, '')), 200); tsq tsquery; lim int := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  if q <> '' then tsq := websearch_to_tsquery('simple', q); end if;
  return query
  select to_jsonb(v), r.rank, v.id
  from public.public_service_cards v
  join public.services s on s.id = v.id
  cross join lateral (select case when q = '' then extract(epoch from s.updated_at)::double precision
      else ts_rank(s.search_vector, tsq)::double precision + word_similarity(q, s.title)::double precision end as rank) r
  where (q = '' or s.search_vector @@ tsq or word_similarity(q, s.title) > 0.4)
    and (p_category is null or s.category_id = p_category or s.category_id in (select c.id from categories c where c.parent_id = p_category))
    and (p_price_max is null or (s.price_min is not null and s.price_min <= p_price_max))
    and (p_after_rank is null or p_after_id is null or r.rank < p_after_rank or (r.rank = p_after_rank and v.id > p_after_id))
  order by r.rank desc, v.id
  limit lim;
end $$;

revoke execute on function public.provider_profiles_vector(), public.services_vector(), public.refresh_provider_skills_text(),
  public.search_provider_cards(text,uuid,uuid[],text,int,text,double precision,uuid,int),
  public.search_service_cards(text,uuid,int,double precision,uuid,int) from public, anon, authenticated;
grant execute on function public.search_provider_cards(text,uuid,uuid[],text,int,text,double precision,uuid,int),
  public.search_service_cards(text,uuid,int,double precision,uuid,int) to anon, authenticated;
