-- 0037 talent pools: private shortlists of professionals per organization, and direct project invitations.
-- Pools, notes and tags are private to the owning organization. Only the invitation message reaches the professional.
-- Errcodes: 42501 not allowed, 22023 invalid, 23505 duplicate, 54000 limit.

create table public.talent_pools (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  description text not null default '' check (char_length(description) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index talent_pools_name_idx on public.talent_pools (org_id, lower(name));

create table public.talent_pool_members (
  pool_id uuid not null references public.talent_pools (id) on delete cascade,
  profile_id uuid not null references public.provider_profiles (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  note text check (note is null or char_length(note) <= 1000),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (pool_id, profile_id)
);
create index talent_pool_members_org_profile_idx on public.talent_pool_members (org_id, profile_id);

create table public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.provider_profiles (id) on delete cascade,
  invited_by uuid references auth.users (id) on delete set null,
  message text not null check (char_length(message) between 10 and 1000),
  status text not null default 'sent' check (status in ('sent','declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (project_id, profile_id)
);
create index project_invitations_org_idx on public.project_invitations (org_id, created_at desc);
create index project_invitations_profile_idx on public.project_invitations (profile_id, created_at desc);

alter table public.talent_pools enable row level security;
alter table public.talent_pool_members enable row level security;
alter table public.project_invitations enable row level security;
revoke all on public.talent_pools, public.talent_pool_members, public.project_invitations from public, anon, authenticated;
grant select on public.talent_pools, public.talent_pool_members to authenticated;
-- invited_by is deliberately not readable: the professional sees the organization, not the person.
grant select (id, project_id, org_id, profile_id, message, status, created_at, responded_at) on public.project_invitations to authenticated;

create policy talent_pools_select on public.talent_pools for select to authenticated using (public.is_member(org_id));
create policy talent_pool_members_select on public.talent_pool_members for select to authenticated using (public.is_member(org_id));
create policy project_invitations_select on public.project_invitations for select to authenticated
  using (public.is_member(org_id)
         or exists (select 1 from provider_profiles pp where pp.id = profile_id and public.has_org_role(pp.org_id, array['owner','admin','member'])));

insert into public.platform_settings (key, value, description) values
  ('limits.talent_pools', '{"default":1,"professional_plus":3,"business":10,"enterprise":null}', 'Max talent pools per organization, by plan (null = unlimited)'),
  ('limits.pool_members', '{"default":25,"professional_plus":100,"business":500,"enterprise":null}', 'Max professionals per talent pool, by plan (null = unlimited)'),
  ('limits.project_invites_per_day', '{"default":5,"professional_plus":25,"business":100,"enterprise":null}', 'Max project invitations an organization can send per rolling 24 hours, by plan (null = unlimited)')
on conflict (key) do nothing;

-- A client-side organization may use pools if it can post projects.
create function public.pool_eligible(p_org uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from organizations where id = p_org and status = 'active' and type in ('client_company','enterprise','agency')) $$;

-- A profile can be pooled or invited only while it is publicly discoverable.
create function public.pool_profile_ok(p_profile uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from provider_profiles p join organizations o on o.id = p.org_id
                   where p.id = p_profile and p.visibility = 'public' and p.status = 'active' and o.status = 'active') $$;

create function public.pool_normalize_tags(p_tags text[]) returns text[]
language plpgsql immutable set search_path = public as
$$ declare v_out text[] := '{}'; t text;
begin
  if p_tags is null then return v_out; end if;
  foreach t in array p_tags loop
    t := lower(trim(coalesce(t, '')));
    if t = '' then continue; end if;
    if char_length(t) > 30 then raise exception 'tag too long' using errcode = '22023'; end if;
    if not (t = any (v_out)) then v_out := v_out || t; end if;
  end loop;
  if cardinality(v_out) > 10 then raise exception 'too many tags' using errcode = '22023'; end if;
  return v_out;
end $$;

create function public.pool_save(p_org uuid, p_id uuid, p_name text, p_description text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_name text := trim(coalesce(p_name, '')); v_desc text := trim(coalesce(p_description, '')); v_id uuid; v_cap int;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not public.pool_eligible(p_org) then raise exception 'this organization cannot use talent pools' using errcode = '22023'; end if;
  if char_length(v_name) not between 2 and 60 or char_length(v_desc) > 300 then raise exception 'invalid name or description' using errcode = '22023'; end if;
  if p_id is null then
    perform pg_advisory_xact_lock(hashtextextended('pools:' || p_org::text, 0)); -- serialize the limit check; no org row lock, which would deadlock with hiring
    v_cap := public.org_limit(p_org, 'limits.talent_pools');
    if v_cap is not null and (select count(*) from talent_pools where org_id = p_org) >= v_cap then
      raise exception 'talent pool limit reached' using errcode = '54000'; end if;
    insert into talent_pools (org_id, name, description, created_by) values (p_org, v_name, v_desc, auth.uid()) returning id into v_id;
    insert into audit_log (actor_id, org_id, action, entity, entity_id, after, outcome, request_id)
    values (auth.uid(), p_org, 'pool.create', 'talent_pool', v_id::text, jsonb_build_object('name', v_name), 'success', gen_random_uuid()::text);
    return v_id;
  end if;
  update talent_pools set name = v_name, description = v_desc, updated_at = now() where id = p_id and org_id = p_org;
  if not found then raise exception 'no such pool' using errcode = '22023'; end if;
  return p_id;
end $$;

create function public.pool_delete(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare v_name text;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from talent_pools where id = p_id and org_id = p_org returning name into v_name;
  if not found then raise exception 'no such pool' using errcode = '22023'; end if;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, before, outcome, request_id)
  values (auth.uid(), p_org, 'pool.delete', 'talent_pool', p_id::text, jsonb_build_object('name', v_name), 'success', gen_random_uuid()::text);
end $$;

-- Add a professional to a pool, or update the note and tags of one already there.
create function public.pool_set_member(p_org uuid, p_pool uuid, p_profile uuid, p_note text, p_tags text[]) returns void
language plpgsql security definer set search_path = public as
$$ declare v_note text := nullif(trim(coalesce(p_note, '')), ''); v_tags text[] := public.pool_normalize_tags(p_tags); v_cap int; v_prof_org uuid;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not public.pool_eligible(p_org) then raise exception 'this organization cannot use talent pools' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 1000 then raise exception 'note too long' using errcode = '22023'; end if;
  perform 1 from talent_pools where id = p_pool and org_id = p_org for update;
  if not found then raise exception 'no such pool' using errcode = '22023'; end if;
  select org_id into v_prof_org from provider_profiles where id = p_profile;
  if v_prof_org is null then raise exception 'no such professional' using errcode = '22023'; end if;
  if v_prof_org = p_org or public.is_member(v_prof_org) then raise exception 'an organization cannot add itself' using errcode = '22023'; end if;
  if exists (select 1 from talent_pool_members where pool_id = p_pool and profile_id = p_profile) then
    update talent_pool_members set note = v_note, tags = v_tags where pool_id = p_pool and profile_id = p_profile;
    return;
  end if;
  if not public.pool_profile_ok(p_profile) then raise exception 'this professional cannot be added' using errcode = '22023'; end if;
  v_cap := public.org_limit(p_org, 'limits.pool_members');
  if v_cap is not null and (select count(*) from talent_pool_members m where m.pool_id = p_pool and public.pool_profile_ok(m.profile_id)) >= v_cap then
    raise exception 'pool member limit reached' using errcode = '54000'; end if;
  insert into talent_pool_members (pool_id, profile_id, org_id, note, tags, added_by) values (p_pool, p_profile, p_org, v_note, v_tags, auth.uid());
end $$;

create function public.pool_remove_member(p_org uuid, p_pool uuid, p_profile uuid) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from talent_pool_members where pool_id = p_pool and profile_id = p_profile and org_id = p_org;
  if not found then raise exception 'not in this pool' using errcode = '22023'; end if;
end $$;

create function public.pools_overview(p_org uuid)
returns table (id uuid, name text, description text, members bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public as
$$ begin
  if not public.is_member(p_org) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select p.id, p.name, p.description,
           (select count(*) from talent_pool_members m where m.pool_id = p.id and public.pool_profile_ok(m.profile_id)),
           p.created_at
      from talent_pools p where p.org_id = p_org order by p.created_at, p.id;
end $$;

-- Members still publicly discoverable. Private notes and tags are returned only to the owning organization.
create function public.pool_members(p_org uuid, p_pool uuid)
returns table (profile_id uuid, slug text, headline text, country text, availability text, note text, tags text[], added_at timestamptz,
               checked_credentials bigint, invited_projects bigint)
language plpgsql stable security definer set search_path = public as
$$ begin
  if not public.is_member(p_org) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select pp.id, pp.slug, pp.headline, pp.country, pp.availability, m.note, m.tags, m.added_at,
           (select count(*) from provider_credentials c where c.profile_id = pp.id and c.status = 'checked'
               and (c.expires_on is null or c.expires_on >= current_date)),
           (select count(*) from project_invitations i where i.profile_id = pp.id and i.org_id = p_org)
      from talent_pool_members m
      join talent_pools tp on tp.id = m.pool_id and tp.org_id = p_org
      join provider_profiles pp on pp.id = m.profile_id
     where m.pool_id = p_pool and m.org_id = p_org and public.pool_profile_ok(pp.id)
     order by m.added_at desc, pp.id;
end $$;

create function public.project_invite(p_org uuid, p_project uuid, p_profile uuid, p_message text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_msg text := trim(coalesce(p_message, '')); v_proj projects%rowtype; v_prof provider_profiles%rowtype; v_cap int; v_id uuid; v_org_name text;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not public.pool_eligible(p_org) then raise exception 'this organization cannot invite' using errcode = '22023'; end if;
  if char_length(v_msg) not between 10 and 1000 then raise exception 'please write a short message (10-1000 characters)' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('invites:' || p_org::text, 0)); -- serialize the daily cap; no org row lock, which would deadlock with hiring
  select * into v_proj from projects where id = p_project and org_id = p_org for share;
  if not found then raise exception 'no such project' using errcode = '22023'; end if;
  if v_proj.status <> 'open' then raise exception 'only open projects can invite' using errcode = '22023'; end if;
  select * into v_prof from provider_profiles where id = p_profile;
  if not found or v_prof.org_id = p_org or public.is_member(v_prof.org_id) then raise exception 'no such professional' using errcode = '22023'; end if;
  if not public.pool_profile_ok(p_profile) then raise exception 'this professional cannot be invited' using errcode = '22023'; end if;
  if not exists (select 1 from talent_pool_members where org_id = p_org and profile_id = p_profile) then
    raise exception 'add the professional to a pool first' using errcode = '22023'; end if;
  if exists (select 1 from project_invitations where project_id = p_project and profile_id = p_profile) then
    raise exception 'already invited' using errcode = '23505'; end if;
  v_cap := public.org_limit(p_org, 'limits.project_invites_per_day');
  if v_cap is not null and (select count(*) from project_invitations where org_id = p_org and created_at > now() - interval '24 hours') >= v_cap then
    raise exception 'daily invitation limit reached' using errcode = '54000'; end if;
  insert into project_invitations (project_id, org_id, profile_id, invited_by, message) values (p_project, p_org, p_profile, auth.uid(), v_msg) returning id into v_id;
  select name into v_org_name from organizations where id = p_org;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, after, outcome, request_id)
  values (auth.uid(), p_org, 'project.invite', 'project_invitation', v_id::text, jsonb_build_object('project_id', p_project, 'profile_id', p_profile), 'success', gen_random_uuid()::text);
  perform public.notify_org(v_prof.org_id, 'project_invite', jsonb_build_object('invitation_id', v_id, 'project_id', p_project, 'project_title', v_proj.title, 'from', v_org_name));
  return v_id;
end $$;

-- Invitations the professional's organization has received, for projects that are still open.
create function public.my_invitations(p_org uuid)
returns table (id uuid, project_id uuid, project_title text, from_org text, message text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as
$$ begin
  if not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select i.id, i.project_id, pj.title, o.name, i.message, i.status, i.created_at
      from project_invitations i
      join provider_profiles pp on pp.id = i.profile_id and pp.org_id = p_org
      join projects pj on pj.id = i.project_id and pj.status = 'open'
      join organizations o on o.id = i.org_id and o.status = 'active'
     order by i.created_at desc, i.id limit 100;
end $$;

create function public.invitation_decline(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare v_i project_invitations%rowtype;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select i.* into v_i from project_invitations i join provider_profiles pp on pp.id = i.profile_id
   where i.id = p_id and pp.org_id = p_org for update of i;
  if not found then raise exception 'no such invitation' using errcode = '22023'; end if;
  if v_i.status <> 'sent' then raise exception 'already answered' using errcode = '22023'; end if;
  update project_invitations set status = 'declined', responded_at = now() where id = p_id;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, after, outcome, request_id)
  values (auth.uid(), p_org, 'invite.decline', 'project_invitation', p_id::text, jsonb_build_object('project_id', v_i.project_id), 'success', gen_random_uuid()::text);
end $$;

revoke execute on function public.pool_eligible(uuid), public.pool_profile_ok(uuid), public.pool_normalize_tags(text[]) from public, anon, authenticated;
revoke execute on function public.pool_save(uuid, uuid, text, text), public.pool_delete(uuid, uuid), public.pool_set_member(uuid, uuid, uuid, text, text[]),
  public.pool_remove_member(uuid, uuid, uuid), public.pools_overview(uuid), public.pool_members(uuid, uuid), public.project_invite(uuid, uuid, uuid, text),
  public.my_invitations(uuid), public.invitation_decline(uuid, uuid) from public, anon;
grant execute on function public.pool_save(uuid, uuid, text, text), public.pool_delete(uuid, uuid), public.pool_set_member(uuid, uuid, uuid, text, text[]),
  public.pool_remove_member(uuid, uuid, uuid), public.pools_overview(uuid), public.pool_members(uuid, uuid), public.project_invite(uuid, uuid, uuid, text),
  public.my_invitations(uuid), public.invitation_decline(uuid, uuid) to authenticated;
