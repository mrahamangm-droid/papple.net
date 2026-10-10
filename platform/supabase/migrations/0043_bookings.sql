-- 0043 bookings: clients book open slots on a professional's service; the professional confirms or declines; either side cancels.
-- Unpaid in this slice. Rows are written only by the RPCs below.
-- Errcodes: 42501 not allowed, 22023 invalid, 23505 slot taken, 54000 limit, 55000 not pending / in the past.
-- Undo: drop functions booking_*, service_set_booking; drop tables bookings, booking_hours, booking_settings;
-- alter table services drop column booking_minutes; delete setting limits.bookings_pending_per_day.

create extension if not exists btree_gist with schema extensions;

create table public.booking_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  timezone text not null default 'UTC',
  buffer_minutes int not null default 0 check (buffer_minutes between 0 and 120),
  min_notice_hours int not null default 12 check (min_notice_hours between 0 and 720),
  horizon_days int not null default 30 check (horizon_days between 1 and 90),
  updated_at timestamptz not null default now()
);

create table public.booking_hours (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  weekday int not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  check (start_time < end_time)
);
create index booking_hours_org_idx on public.booking_hours (org_id, weekday);

alter table public.services add column booking_minutes int check (booking_minutes in (15, 30, 45, 60));

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  provider_org_id uuid not null references public.organizations (id) on delete cascade,
  client_org_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid references public.services (id) on delete set null,
  booked_by uuid references auth.users (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocked tstzrange not null, -- [starts_at, ends_at + the provider's gap at booking time)
  status text not null default 'pending' check (status in ('pending','confirmed','declined','cancelled')),
  note text not null default '' check (char_length(note) <= 1000),
  meeting_url text check (meeting_url is null or (meeting_url ~ '^https://' and char_length(meeting_url) <= 500)),
  reason text not null default '' check (char_length(reason) <= 500),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  cancelled_by_org uuid references public.organizations (id) on delete set null,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at),
  -- the database itself rules out two live bookings overlapping for one provider
  constraint bookings_no_overlap exclude using gist (provider_org_id with =, blocked with &&) where (status in ('pending','confirmed'))
);
create index bookings_client_idx on public.bookings (client_org_id, starts_at);
create index bookings_provider_idx on public.bookings (provider_org_id, starts_at);

insert into public.platform_settings (key, value, description) values
  ('limits.bookings_pending_per_day', '{"default":5}', 'Max pending bookings a client organization can create in 24 hours (null = unlimited)')
on conflict (key) do nothing;

alter table public.booking_settings enable row level security;
alter table public.booking_hours enable row level security;
alter table public.bookings enable row level security;
revoke all on public.booking_settings, public.booking_hours, public.bookings from public, anon, authenticated;
grant select on public.booking_settings, public.booking_hours to authenticated;
-- who booked or decided stays server-side: the other side sees the organization, not the person
grant select (id, provider_org_id, client_org_id, service_id, starts_at, ends_at, status, note, meeting_url, reason, decided_at, cancelled_by_org, created_at)
  on public.bookings to authenticated;
create policy booking_settings_select on public.booking_settings for select to authenticated using (public.is_member(org_id));
create policy booking_hours_select on public.booking_hours for select to authenticated using (public.is_member(org_id));
create policy bookings_select on public.bookings for select to authenticated
  using (public.is_member(provider_org_id) or public.is_member(client_org_id));

create function public.booking_audit(p_org uuid, p_action text, p_id uuid, p_after jsonb) returns void
language sql security definer set search_path = public as
$$ insert into audit_log (actor_id, org_id, action, entity, entity_id, after, outcome, request_id)
   values (auth.uid(), p_org, p_action, 'booking', p_id::text, p_after, 'success', gen_random_uuid()::text) $$;

create function public.booking_settings_save(p_org uuid, p_enabled boolean, p_timezone text, p_buffer int, p_notice int, p_horizon int, p_hours jsonb) returns void
language plpgsql security definer set search_path = public as
$$ declare v_item jsonb;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_enabled is null or p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone)
     or p_buffer is null or p_buffer not between 0 and 120 or p_notice is null or p_notice not between 0 and 720
     or p_horizon is null or p_horizon not between 1 and 90
     or p_hours is null or jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) > 21 then
    raise exception 'invalid settings' using errcode = '22023'; end if;
  for v_item in select * from jsonb_array_elements(p_hours) loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(v_item->>'weekday','') !~ '^[1-7]$'
       or coalesce(v_item->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(v_item->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (v_item->>'start')::time >= (v_item->>'end')::time then
      raise exception 'invalid hours' using errcode = '22023'; end if;
  end loop;
  insert into booking_settings (org_id, enabled, timezone, buffer_minutes, min_notice_hours, horizon_days, updated_at)
  values (p_org, p_enabled, p_timezone, p_buffer, p_notice, p_horizon, now())
  on conflict (org_id) do update set enabled = excluded.enabled, timezone = excluded.timezone, buffer_minutes = excluded.buffer_minutes,
    min_notice_hours = excluded.min_notice_hours, horizon_days = excluded.horizon_days, updated_at = excluded.updated_at;
  delete from booking_hours where org_id = p_org;
  insert into booking_hours (org_id, weekday, start_time, end_time)
  select p_org, (h->>'weekday')::int, (h->>'start')::time, (h->>'end')::time from jsonb_array_elements(p_hours) h;
  perform public.booking_audit(p_org, 'booking_settings.save', p_org, jsonb_build_object('enabled', p_enabled, 'timezone', p_timezone, 'windows', jsonb_array_length(p_hours)));
end $$;

create function public.service_set_booking(p_org uuid, p_service uuid, p_minutes int) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_minutes is not null and p_minutes not in (15, 30, 45, 60) then raise exception 'invalid slot length' using errcode = '22023'; end if;
  update services set booking_minutes = p_minutes where id = p_service and org_id = p_org;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

-- Every slot start the weekly hours produce between two instants, before notice, horizon and existing bookings.
-- Local times that do not exist (the spring-forward gap) are dropped by the round-trip check.
create function public.booking_candidates(p_org uuid, p_minutes int, p_from timestamptz, p_to timestamptz) returns setof timestamptz
language sql stable security definer set search_path = public as
$$ with s as (select timezone as tz from booking_settings where org_id = p_org),
   days as (select d::date as d from s, generate_series((p_from at time zone s.tz)::date, (p_to at time zone s.tz)::date, interval '1 day') d),
   local_starts as (
     select (days.d + h.start_time + make_interval(mins => k * p_minutes)) as lt
     from days join booking_hours h on h.org_id = p_org and h.weekday = extract(isodow from days.d)::int
     cross join lateral generate_series(0, (extract(epoch from (h.end_time - h.start_time))::int / 60 - p_minutes) / p_minutes) k
     where extract(epoch from (h.end_time - h.start_time)) / 60 >= p_minutes)
   select distinct (ls.lt at time zone s.tz) as st
   from local_starts ls, s
   where ((ls.lt at time zone s.tz) at time zone s.tz) = ls.lt
     and (ls.lt at time zone s.tz) >= p_from and (ls.lt at time zone s.tz) < p_to
   order by 1 $$;

create function public.booking_slots(p_service uuid, p_from timestamptz, p_to timestamptz) returns setof timestamptz
language plpgsql stable security definer set search_path = public as
$$ declare v_svc services; v_set booking_settings; v_len interval; v_gap interval;
begin
  if auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '31 days' then raise exception 'invalid range' using errcode = '22023'; end if;
  select * into v_svc from services where id = p_service;
  if not found or v_svc.status <> 'published' or v_svc.booking_minutes is null then raise exception 'not bookable' using errcode = '22023'; end if;
  select * into v_set from booking_settings where org_id = v_svc.org_id;
  if not found or not v_set.enabled then raise exception 'not bookable' using errcode = '22023'; end if;
  v_len := make_interval(mins => v_svc.booking_minutes);
  v_gap := make_interval(mins => v_set.buffer_minutes);
  return query
    select c from public.booking_candidates(v_svc.org_id, v_svc.booking_minutes,
                                           greatest(p_from, now() + make_interval(hours => v_set.min_notice_hours)),
                                           least(p_to, now() + make_interval(days => v_set.horizon_days))) c
    where not exists (
      select 1 from bookings b
      where b.provider_org_id = v_svc.org_id and b.status in ('pending','confirmed')
        -- the current gap applies after every booking, so neither may start inside the other's gap
        and (tstzrange(b.starts_at, b.ends_at + v_gap) && tstzrange(c, c + v_len) or tstzrange(b.starts_at, b.ends_at) && tstzrange(c, c + v_len + v_gap)))
    order by c;
end $$;

create function public.booking_request(p_org uuid, p_service uuid, p_start timestamptz, p_note text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_svc services; v_set booking_settings; v_note text := btrim(coalesce(p_note, '')); v_cap int; v_id uuid; m record;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_svc from services where id = p_service;
  if not found then raise exception 'not bookable' using errcode = '22023'; end if;
  -- nobody books their own organization, or a professional they belong to
  if v_svc.org_id = p_org or public.is_member(v_svc.org_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(v_note) > 1000 or p_start is null then raise exception 'invalid request' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('booking:' || v_svc.org_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('booking-cap:' || p_org::text, 0));
  -- the start must be exactly an offered slot (this also checks published, enabled, notice, horizon and conflicts)
  if not exists (select 1 from public.booking_slots(p_service, p_start, p_start + interval '1 minute') s where s = p_start) then
    -- a real slot that someone holds reads as "just taken"; anything else is simply not offered
    if v_svc.booking_minutes is not null and exists (
         select 1 from bookings b where b.provider_org_id = v_svc.org_id and b.status in ('pending','confirmed')
           and b.blocked && tstzrange(p_start, p_start + make_interval(mins => v_svc.booking_minutes)))
       and exists (select 1 from public.booking_candidates(v_svc.org_id, v_svc.booking_minutes, p_start, p_start + interval '1 minute') c where c = p_start) then
      raise exception 'that time was just taken' using errcode = '23505'; end if;
    raise exception 'that time is not available' using errcode = '22023'; end if;
  v_cap := public.org_limit(p_org, 'limits.bookings_pending_per_day');
  if v_cap is not null and (select count(*) from bookings where client_org_id = p_org and status = 'pending' and created_at > now() - interval '24 hours') >= v_cap then
    raise exception 'daily booking limit reached' using errcode = '54000'; end if;
  select * into v_set from booking_settings where org_id = v_svc.org_id;
  begin
    insert into bookings (provider_org_id, client_org_id, service_id, booked_by, starts_at, ends_at, blocked, note)
    values (v_svc.org_id, p_org, p_service, auth.uid(), p_start, p_start + make_interval(mins => v_svc.booking_minutes),
            tstzrange(p_start, p_start + make_interval(mins => v_svc.booking_minutes + v_set.buffer_minutes)), v_note)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'that time was just taken' using errcode = '23505';
  end;
  perform public.booking_audit(p_org, 'booking.request', v_id, jsonb_build_object('service', p_service, 'provider', v_svc.org_id));
  for m in select user_id from memberships where org_id = v_svc.org_id loop
    perform public.notify(m.user_id, 'booking_requested', jsonb_build_object('booking_id', v_id, 'org_id', v_svc.org_id));
  end loop;
  return v_id;
end $$;

create function public.booking_decide(p_org uuid, p_booking uuid, p_confirm boolean, p_meeting_url text, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_b bookings; v_url text := nullif(btrim(coalesce(p_meeting_url, '')), ''); v_reason text := btrim(coalesce(p_reason, '')); m record;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_b from bookings where id = p_booking for update;
  if not found or v_b.provider_org_id <> p_org then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_confirm is null or char_length(v_reason) > 500 or (v_url is not null and (v_url !~ '^https://[^\s]+$' or char_length(v_url) > 500)) then
    raise exception 'invalid decision' using errcode = '22023'; end if;
  if v_b.status <> 'pending' or v_b.starts_at <= now() then raise exception 'booking is not pending' using errcode = '55000'; end if;
  update bookings set status = case when p_confirm then 'confirmed' else 'declined' end,
    meeting_url = case when p_confirm then v_url else null end, reason = case when p_confirm then '' else v_reason end,
    decided_by = auth.uid(), decided_at = now() where id = p_booking;
  perform public.booking_audit(p_org, case when p_confirm then 'booking.confirm' else 'booking.decline' end, p_booking, '{}'::jsonb);
  for m in select user_id from memberships where org_id = v_b.client_org_id loop
    perform public.notify(m.user_id, case when p_confirm then 'booking_confirmed' else 'booking_declined' end,
      jsonb_build_object('booking_id', p_booking, 'org_id', v_b.client_org_id));
  end loop;
end $$;

create function public.booking_cancel(p_org uuid, p_booking uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_b bookings; v_reason text := btrim(coalesce(p_reason, '')); v_other uuid; m record;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_b from bookings where id = p_booking for update;
  if not found or p_org not in (v_b.provider_org_id, v_b.client_org_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(v_reason) not between 1 and 500 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if v_b.status not in ('pending','confirmed') or v_b.starts_at <= now() then raise exception 'booking cannot be cancelled' using errcode = '55000'; end if;
  update bookings set status = 'cancelled', reason = v_reason, cancelled_by_org = p_org, decided_by = auth.uid(), decided_at = now() where id = p_booking;
  perform public.booking_audit(p_org, 'booking.cancel', p_booking, '{}'::jsonb);
  v_other := case when p_org = v_b.provider_org_id then v_b.client_org_id else v_b.provider_org_id end;
  for m in select user_id from memberships where org_id = v_other loop
    perform public.notify(m.user_id, 'booking_cancelled', jsonb_build_object('booking_id', p_booking, 'org_id', v_other));
  end loop;
end $$;

revoke execute on function public.booking_audit(uuid, text, uuid, jsonb), public.booking_candidates(uuid, int, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.booking_settings_save(uuid, boolean, text, int, int, int, jsonb), public.service_set_booking(uuid, uuid, int),
  public.booking_slots(uuid, timestamptz, timestamptz), public.booking_request(uuid, uuid, timestamptz, text),
  public.booking_decide(uuid, uuid, boolean, text, text), public.booking_cancel(uuid, uuid, text) from public, anon;
grant execute on function public.booking_settings_save(uuid, boolean, text, int, int, int, jsonb), public.service_set_booking(uuid, uuid, int),
  public.booking_slots(uuid, timestamptz, timestamptz), public.booking_request(uuid, uuid, timestamptz, text),
  public.booking_decide(uuid, uuid, boolean, text, text), public.booking_cancel(uuid, uuid, text) to authenticated;
