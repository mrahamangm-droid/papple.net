-- 0009 projects (client-posted work), project skills, saved items, public project teaser view.

create function public.is_provider_member() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from memberships m join organizations o on o.id = m.org_id
                  where m.user_id = auth.uid() and o.type in ('individual','agency') and o.status = 'active') $$;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  title text not null check (char_length(title) between 5 and 150),
  description text not null check (char_length(description) between 5 and 10000),
  category_id uuid references public.categories (id) on delete set null,
  budget_min int check (budget_min is null or budget_min >= 0),
  budget_max int check (budget_max is null or budget_max >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  deadline date,
  status text not null default 'draft'
    check (status in ('draft','pending_review','open','closed','cancelled','hidden_by_admin')),
  visibility text not null default 'members_only' check (visibility in ('public','members_only')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (budget_min is null or budget_max is null or budget_min <= budget_max)
);
create index projects_org_idx on public.projects (org_id);
create index projects_open_idx on public.projects (status, created_at desc);
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

create table public.project_skills (
  project_id uuid not null references public.projects (id) on delete cascade,
  skill_id uuid not null references public.skills (id) on delete cascade,
  primary key (project_id, skill_id)
);

create table public.saved_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('profile','service','project')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, target_id)
);

alter table public.projects enable row level security;
alter table public.project_skills enable row level security;
alter table public.saved_items enable row level security;

revoke all on public.projects, public.project_skills, public.saved_items from anon, public, authenticated;
-- created_by is deliberately not readable through the API.
grant select (id, org_id, title, description, category_id, budget_min, budget_max, currency, deadline, status,
              visibility, created_at, updated_at) on public.projects to authenticated;
grant select on public.project_skills to authenticated;
grant select, insert, delete on public.saved_items to authenticated;

create policy projects_select on public.projects for select to authenticated
  using (public.is_member(org_id) or public.is_platform_admin()
         or (status = 'open' and public.is_provider_member()));
create policy project_skills_select on public.project_skills for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id));
create policy saved_items_own on public.saved_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create function public.upsert_project(
  p_org uuid, p_id uuid, p_title text, p_description text, p_category uuid, p_budget_min int, p_budget_max int,
  p_currency text, p_deadline date, p_visibility text, p_skill_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_type text; v_id uuid; v_status text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin','member']) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  select type into v_type from organizations where id = p_org;
  if v_type is null or v_type not in ('client_company','enterprise','agency') then
    raise exception 'this organization type cannot post projects' using errcode = '22023'; end if;
  if p_title is null or char_length(trim(p_title)) not between 5 and 150
     or p_description is null or char_length(trim(p_description)) not between 5 and 10000
     or p_visibility not in ('public','members_only') or p_currency !~ '^[A-Z]{3}$'
     or coalesce(p_budget_min, 0) < 0 or coalesce(p_budget_max, 0) < 0
     or (p_budget_min is not null and p_budget_max is not null and p_budget_min > p_budget_max)
     or (p_deadline is not null and p_deadline < current_date) then
    raise exception 'invalid project' using errcode = '22023'; end if;
  if coalesce(array_length(p_skill_ids, 1), 0) > 30 or
     (select count(*) from skills where id = any (coalesce(p_skill_ids, '{}')) and is_active)
       <> coalesce(array_length(p_skill_ids, 1), 0) then
    raise exception 'invalid skills' using errcode = '22023'; end if;
  if p_category is not null and not exists (select 1 from categories where id = p_category and is_active) then
    raise exception 'unknown category' using errcode = '22023'; end if;

  if p_id is null then
    insert into projects (org_id, created_by, title, description, category_id, budget_min, budget_max, currency,
                          deadline, visibility)
    values (p_org, auth.uid(), trim(p_title), trim(p_description), p_category, p_budget_min, p_budget_max,
            p_currency, p_deadline, p_visibility) returning id into v_id;
  else
    select status into v_status from projects where id = p_id and org_id = p_org;
    if not found then raise exception 'not allowed' using errcode = '42501'; end if;
    if v_status not in ('draft','open','pending_review') then
      raise exception 'project can no longer be edited' using errcode = '22023'; end if;
    update projects set title = trim(p_title), description = trim(p_description), category_id = p_category,
      budget_min = p_budget_min, budget_max = p_budget_max, currency = p_currency, deadline = p_deadline,
      visibility = p_visibility where id = p_id returning id into v_id;
  end if;
  delete from project_skills where project_id = v_id;
  insert into project_skills (project_id, skill_id)
    select v_id, s from unnest(coalesce(p_skill_ids, '{}')) s on conflict do nothing;
  return v_id;
end $$;

create function public.set_project_status(p_org uuid, p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_old text; v_new text := p_status; v_premod boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin','member']) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  select status into v_old from projects where id = p_id and org_id = p_org for update;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  if not ((v_old = 'draft' and p_status = 'open')
       or (v_old = 'open' and p_status = 'closed')
       or (v_old in ('draft','open','closed','pending_review') and p_status = 'cancelled')) then
    raise exception 'invalid status change' using errcode = '22023'; end if;
  if p_status = 'open' then
    select coalesce((select (value #>> '{}')::boolean from platform_settings where key = 'marketplace.premoderation'), false)
      into v_premod;
    if v_premod then v_new := 'pending_review'; end if;
  end if;
  update projects set status = v_new where id = p_id;
end $$;

create view public.public_open_projects with (security_barrier = true) as
select p.id, p.title, left(p.description, 280) as summary, p.budget_min, p.budget_max, p.currency,
       p.category_id, p.deadline, p.created_at,
       coalesce((select array_agg(s.name order by s.name) from project_skills ps join skills s on s.id = ps.skill_id
                 where ps.project_id = p.id), '{}') as skills
from projects p join organizations o on o.id = p.org_id
where p.visibility = 'public' and p.status = 'open' and o.status = 'active';
grant select on public.public_open_projects to anon, authenticated;

revoke execute on function public.is_provider_member(),
  public.upsert_project(uuid,uuid,text,text,uuid,int,int,text,date,text,uuid[]),
  public.set_project_status(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.is_provider_member(),
  public.upsert_project(uuid,uuid,text,text,uuid,int,int,text,date,text,uuid[]),
  public.set_project_status(uuid,uuid,text) to authenticated;
