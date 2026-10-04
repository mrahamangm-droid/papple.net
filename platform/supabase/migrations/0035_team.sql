-- 0035 team workspace: invitations, role changes and removal, all through functions.
-- Direct writes to memberships are closed: before this, any owner or admin could insert any user id
-- (no consent, no seat limit) and admins could demote each other.
-- Errcodes: 42501 not allowed (also every invalid-token case), 22023 invalid, 23505 duplicate,
-- 54000 limit, 55000 not ready (suspended organization), P0001 last owner (existing trigger).

drop policy memberships_insert on public.memberships;
drop policy memberships_update on public.memberships;
drop policy memberships_delete on public.memberships;
revoke insert, update, delete on public.memberships from authenticated;

create table public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  role text not null check (role in ('admin','member','viewer')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz
);
create unique index org_invites_pending_uq on public.org_invites (org_id, email) where accepted_at is null and revoked_at is null;
create index org_invites_org_idx on public.org_invites (org_id, created_at);

alter table public.org_invites enable row level security;
revoke all on public.org_invites from public, anon, authenticated;
-- every column except token_hash: the token is shown once to the inviter and never readable again
grant select (id, org_id, email, role, invited_by, created_at, expires_at, accepted_by, accepted_at, revoked_at) on public.org_invites to authenticated;
create policy org_invites_select on public.org_invites for select to authenticated
  using (public.has_org_role(org_id, array['owner','admin']) or public.is_platform_admin());

-- Defaults live here, not only in the seed: org_limit() treats a missing key as unlimited.
insert into public.platform_settings (key, value, description)
values ('limits.team_seats', '{"default":1,"professional_plus":5,"business":25,"enterprise":null}', 'Max members plus pending invites per organization, by plan (null = unlimited)')
on conflict (key) do nothing;
insert into public.platform_settings (key, value, description)
values ('limits.team_invites_per_day', '{"default":20}', 'Max team invites created per organization per UTC day')
on conflict (key) do nothing;
insert into public.feature_flags (key, enabled, description)
values ('team.email_invites', false, 'Send team invitations by email (needs the Resend configuration); the link always works')
on conflict (key) do nothing;

create function public.team_members(p_org uuid)
returns table (user_id uuid, email text, display_name text, role text, joined_at timestamptz)
language plpgsql stable security definer set search_path = public as
$$ begin
  if not public.is_member(p_org) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select m.user_id, u.email::text, p.display_name, m.role, m.created_at
      from memberships m join auth.users u on u.id = m.user_id left join profiles p on p.id = m.user_id
     where m.org_id = p_org
     order by case m.role when 'owner' then 0 when 'admin' then 1 when 'member' then 2 else 3 end, m.created_at;
end $$;

create function public.team_seat_usage(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as
$$ begin
  if not public.is_member(p_org) then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'members', (select count(*) from memberships where org_id = p_org),
    'pending', (select count(*) from org_invites where org_id = p_org and accepted_at is null and revoked_at is null and expires_at > now()),
    'limit', public.org_limit(p_org, 'limits.team_seats'));
end $$;

create function public.team_create_invite(p_org uuid, p_email text, p_role text, p_token_hash text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare
  v_caller text; v_email text := lower(btrim(p_email)); v_id uuid; v_seats int; v_cap int;
begin
  select role into v_caller from memberships where org_id = p_org and user_id = auth.uid();
  if v_caller is null or v_caller not in ('owner','admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('admin','member','viewer') then raise exception 'invalid role' using errcode = '22023'; end if;
  if p_role = 'admin' and v_caller <> 'owner' then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_email !~ '^[^[:space:]@,;<>"]+@[^[:space:]@,;<>"]+\.[^[:space:]@,;<>"]+$' or char_length(v_email) > 254 then
    raise exception 'invalid email' using errcode = '22023'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid token' using errcode = '22023'; end if;
  if (select status from organizations where id = p_org) <> 'active' then raise exception 'organization not active' using errcode = '55000'; end if;

  perform pg_advisory_xact_lock(hashtext('team:' || p_org::text));
  update org_invites set revoked_at = now() where org_id = p_org and accepted_at is null and revoked_at is null and expires_at <= now();
  if exists (select 1 from memberships m join auth.users u on u.id = m.user_id where m.org_id = p_org and lower(u.email) = v_email) then
    raise exception 'already a member' using errcode = '23505'; end if;
  if exists (select 1 from org_invites where org_id = p_org and email = v_email and accepted_at is null and revoked_at is null) then
    raise exception 'already invited' using errcode = '23505'; end if;
  v_seats := public.org_limit(p_org, 'limits.team_seats');
  if v_seats is not null and (select count(*) from memberships where org_id = p_org)
       + (select count(*) from org_invites where org_id = p_org and accepted_at is null and revoked_at is null) >= v_seats then
    raise exception 'seat limit reached' using errcode = '54000'; end if;
  v_cap := public.org_limit(p_org, 'limits.team_invites_per_day');
  if v_cap is not null and (select count(*) from org_invites where org_id = p_org
       and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')) >= v_cap then
    raise exception 'daily invite limit reached' using errcode = '54000'; end if;
  insert into org_invites (org_id, email, role, token_hash, invited_by) values (p_org, v_email, p_role, p_token_hash, auth.uid())
    returning id into v_id;
  return v_id;
end $$;

create function public.team_revoke_invite(p_org uuid, p_invite uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare v_caller text; v_role text;
begin
  select role into v_caller from memberships where org_id = p_org and user_id = auth.uid();
  if v_caller is null or v_caller not in ('owner','admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  select role into v_role from org_invites where id = p_invite and org_id = p_org and accepted_at is null and revoked_at is null;
  if v_role is null then raise exception 'no such pending invite' using errcode = '22023'; end if;
  if v_role = 'admin' and v_caller <> 'owner' then raise exception 'not allowed' using errcode = '42501'; end if;
  update org_invites set revoked_at = now() where id = p_invite;
end $$;

-- The signed-in caller's confirmed address must equal the invited one. Every other case answers 42501.
create function public.team_invite_preview(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path = public as
$$ declare i org_invites; v_email text; v_confirmed timestamptz; v_name text;
begin
  if auth.uid() is null or p_token_hash is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
  select * into i from org_invites where token_hash = p_token_hash and accepted_at is null and revoked_at is null and expires_at > now();
  if i.id is null or v_confirmed is null or lower(v_email) is distinct from i.email then raise exception 'not allowed' using errcode = '42501'; end if;
  select name into v_name from organizations where id = i.org_id and status = 'active';
  if v_name is null then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object('org_name', v_name, 'role', i.role, 'email', i.email);
end $$;

create function public.team_accept_invite(p_token_hash text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare i org_invites; v_email text; v_confirmed timestamptz; v_seats int;
begin
  if auth.uid() is null or p_token_hash is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
  select * into i from org_invites where token_hash = p_token_hash and accepted_at is null and revoked_at is null and expires_at > now();
  if i.id is null or v_confirmed is null or lower(v_email) is distinct from i.email then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from organizations where id = i.org_id and status = 'active') then raise exception 'not allowed' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtext('team:' || i.org_id::text));
  -- re-read under the lock: a parallel accept or revoke may have used it
  select * into i from org_invites where id = i.id and accepted_at is null and revoked_at is null and expires_at > now();
  if i.id is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from memberships where org_id = i.org_id and user_id = auth.uid()) then
    v_seats := public.org_limit(i.org_id, 'limits.team_seats');
    if v_seats is not null and (select count(*) from memberships where org_id = i.org_id) >= v_seats then
      raise exception 'seat limit reached' using errcode = '54000'; end if;
    insert into memberships (user_id, org_id, role) values (auth.uid(), i.org_id, i.role);
  end if;
  update org_invites set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
  return i.org_id;
end $$;

-- All three take the organization's team lock before changing anything: the last-owner trigger reads a snapshot,
-- so two owners acting on different rows at once would otherwise both pass it. Roles are re-read under the lock.
-- Pending invites made by someone who is removed, leaves or loses the right to invite are revoked with them.
create function public.team_set_role(p_org uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_caller text; v_target text;
begin
  select role into v_caller from memberships where org_id = p_org and user_id = auth.uid();
  if v_caller is null or v_caller not in ('owner','admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('owner','admin','member','viewer') then raise exception 'invalid role' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('team:' || p_org::text));
  select role into v_caller from memberships where org_id = p_org and user_id = auth.uid();
  if v_caller is null or v_caller not in ('owner','admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  select role into v_target from memberships where org_id = p_org and user_id = p_user;
  if v_target is null then raise exception 'not a member' using errcode = '22023'; end if;
  if v_caller = 'admin' and (v_target not in ('member','viewer') or p_role not in ('member','viewer')) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  update memberships set role = p_role where org_id = p_org and user_id = p_user;
  if p_role not in ('owner','admin') then
    update org_invites set revoked_at = now() where org_id = p_org and invited_by = p_user and accepted_at is null and revoked_at is null;
  elsif p_role = 'admin' then
    update org_invites set revoked_at = now() where org_id = p_org and invited_by = p_user and role = 'admin' and accepted_at is null and revoked_at is null;
  end if;
end $$;

create function public.team_remove_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare v_caller text; v_target text;
begin
  select role into v_caller from memberships where org_id = p_org and user_id = auth.uid();
  if v_caller is null or v_caller not in ('owner','admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('team:' || p_org::text));
  select role into v_caller from memberships where org_id = p_org and user_id = auth.uid();
  if v_caller is null or v_caller not in ('owner','admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  select role into v_target from memberships where org_id = p_org and user_id = p_user;
  if v_target is null then raise exception 'not a member' using errcode = '22023'; end if;
  if p_user = auth.uid() then raise exception 'use leave' using errcode = '22023'; end if;
  if v_caller = 'admin' and v_target not in ('member','viewer') then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from memberships where org_id = p_org and user_id = p_user;
  update org_invites set revoked_at = now() where org_id = p_org and invited_by = p_user and accepted_at is null and revoked_at is null;
end $$;

create function public.team_leave(p_org uuid) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if not public.is_member(p_org) then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('team:' || p_org::text));
  delete from memberships where org_id = p_org and user_id = auth.uid();
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  update org_invites set revoked_at = now() where org_id = p_org and invited_by = auth.uid() and accepted_at is null and revoked_at is null;
end $$;

revoke execute on function public.team_members(uuid), public.team_seat_usage(uuid), public.team_create_invite(uuid, text, text, text),
  public.team_revoke_invite(uuid, uuid), public.team_invite_preview(text), public.team_accept_invite(text),
  public.team_set_role(uuid, uuid, text), public.team_remove_member(uuid, uuid), public.team_leave(uuid) from public, anon;
grant execute on function public.team_members(uuid), public.team_seat_usage(uuid), public.team_create_invite(uuid, text, text, text),
  public.team_revoke_invite(uuid, uuid), public.team_invite_preview(text), public.team_accept_invite(text),
  public.team_set_role(uuid, uuid, text), public.team_remove_member(uuid, uuid), public.team_leave(uuid) to authenticated;
