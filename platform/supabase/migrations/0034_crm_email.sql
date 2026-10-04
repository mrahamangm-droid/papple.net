-- 0034 CRM email (one-to-one, consent-recorded). The database decides whether a message may be sent; the app only sends what was reserved.
create table public.crm_suppressions (
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) <= 254),
  reason text not null check (reason in ('unsubscribe','bounce','complaint')),
  created_at timestamptz not null default now(),
  primary key (org_id, email)
);

create table public.crm_emails (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  to_email text not null check (char_length(to_email) <= 254),
  subject text not null check (char_length(subject) between 1 and 200 and subject !~ '[\r\n]'),
  body text not null check (char_length(body) between 1 and 5000),
  basis text not null check (basis in ('existing_client','opted_in','requested_contact')),
  basis_set_by uuid,
  basis_set_at timestamptz,
  status text not null default 'queued' check (status in ('queued','sent','failed','unknown')),
  provider_id text check (provider_id is null or char_length(provider_id) <= 200),
  sent_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index crm_emails_org_idx on public.crm_emails (org_id, created_at desc);
create index crm_emails_contact_idx on public.crm_emails (contact_id, created_at desc);
create unique index crm_emails_provider_uidx on public.crm_emails (provider_id) where provider_id is not null;

alter table public.crm_suppressions enable row level security;
alter table public.crm_emails enable row level security;
revoke all on public.crm_suppressions, public.crm_emails from public, anon, authenticated;
grant select on public.crm_suppressions, public.crm_emails to authenticated;
create policy crm_suppressions_select on public.crm_suppressions for select to authenticated using (public.is_member(org_id) or public.is_platform_admin());
create policy crm_emails_select on public.crm_emails for select to authenticated using (public.is_member(org_id) or public.is_platform_admin());

-- Defaults are inserted here, not only in the seed: org_limit() treats a missing key as unlimited, and a missing flag is simply off.
insert into public.feature_flags (key, enabled, description)
values ('crm.email', false, 'One-to-one email from the CRM (needs a verified sending domain and the unsubscribe secret)')
on conflict (key) do nothing;
insert into public.platform_settings (key, value, description)
values ('limits.crm_emails_per_day', '{"default":10,"professional_plus":50,"business":200,"enterprise":1000}', 'Max CRM emails per organization per UTC day, by plan (null = unlimited)')
on conflict (key) do nothing;

-- Who recorded the reason, and when. The reason belongs to an address: changing the address clears it.
alter table public.crm_contacts add column basis_set_by uuid references auth.users (id) on delete set null, add column basis_set_at timestamptz;
create function public.crm_contacts_basis_guard() returns trigger language plpgsql as
$$ begin
  if lower(new.email) is distinct from lower(old.email) then new.basis := null; end if;
  if new.basis is null then new.basis_set_by := null; new.basis_set_at := null; end if;
  return new;
end $$;
create trigger crm_contacts_basis_guard before update on public.crm_contacts for each row execute function public.crm_contacts_basis_guard();

create function public.crm_email_enabled(p_org uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select enabled from feature_flag_overrides where key = 'crm.email' and org_id = p_org),
                   (select enabled from feature_flags where key = 'crm.email'), false) $$;

-- The reason a contact may be emailed is recorded explicitly by a person; imports and manual adds start without one.
create function public.crm_set_basis(p_org uuid, p_contact uuid, p_basis text) returns void
language plpgsql security definer set search_path = public as
$$ begin
  perform public.crm_assert_writer(p_org);
  if p_basis is not null and p_basis not in ('existing_client','opted_in','requested_contact') then raise exception 'invalid basis' using errcode = '22023'; end if;
  update crm_contacts set basis = p_basis, basis_set_by = case when p_basis is null then null else auth.uid() end, basis_set_at = case when p_basis is null then null else now() end where id = p_contact and org_id = p_org;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

-- Everything that must hold before a message leaves, checked in one place. Error codes: 42501 not allowed, 22023 invalid,
-- 55000 not ready (flag off, no basis, no billing profile), 23P01 address suppressed, 54000 daily cap.
create function public.crm_reserve_email(p_org uuid, p_contact uuid, p_subject text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as
$$ declare c crm_contacts; bp billing_profiles; v_cap int; v_used int; v_id uuid; v_subject text := btrim(coalesce(p_subject, '')); v_body text := btrim(coalesce(p_body, ''));
begin
  perform public.crm_assert_writer(p_org);
  if char_length(v_subject) not between 1 and 200 or v_subject ~ '[\r\n]' or char_length(v_body) not between 1 and 5000 then raise exception 'invalid message' using errcode = '22023'; end if;
  select * into c from crm_contacts where id = p_contact and org_id = p_org;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.email is null or c.email !~ '^[A-Za-z0-9._%+''-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$' then raise exception 'contact has no usable email' using errcode = '22023'; end if;
  if not public.crm_email_enabled(p_org) or c.basis is null then raise exception 'not ready' using errcode = '55000'; end if;
  select * into bp from billing_profiles where org_id = p_org;
  if not found then raise exception 'not ready' using errcode = '55000'; end if;
  if exists (select 1 from crm_suppressions where org_id = p_org and email = lower(c.email)) then raise exception 'suppressed' using errcode = '23P01'; end if;
  perform pg_advisory_xact_lock(hashtext('crmemail:' || p_org::text));
  v_cap := public.org_limit(p_org, 'limits.crm_emails_per_day');
  if v_cap is not null then
    select count(*) into v_used from crm_emails
     where org_id = p_org and status <> 'failed' and created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC');
    if v_used >= v_cap then raise exception 'daily limit reached' using errcode = '54000'; end if;
  end if;
  insert into crm_emails (org_id, contact_id, to_email, subject, body, basis, basis_set_by, basis_set_at, sent_by)
  values (p_org, p_contact, c.email, v_subject, v_body, c.basis, c.basis_set_by, c.basis_set_at, auth.uid()) returning id into v_id;
  return jsonb_build_object('id', v_id, 'to', c.email, 'subject', v_subject, 'body', v_body, 'basis', c.basis, 'legal_name', bp.legal_name, 'address', bp.address, 'country', bp.country);
end $$;

-- Records the outcome once. Server only: a user who could mark their own message "failed" would escape the daily cap and the
-- complaint mapping. 'unknown' means the provider's answer was ambiguous (the message may have been delivered) and still counts.
create function public.crm_mark_email(p_id uuid, p_status text, p_provider text) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if p_status is null or p_status not in ('sent','failed','unknown') or char_length(coalesce(p_provider, '')) > 200 then raise exception 'invalid status' using errcode = '22023'; end if;
  update crm_emails set status = p_status, provider_id = p_provider, finished_at = now() where id = p_id and status = 'queued';
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

-- Service role only: unsubscribe links and provider bounce/complaint events.
create function public.crm_add_suppression(p_org uuid, p_email text, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if p_reason is null or p_reason not in ('unsubscribe','bounce','complaint') or p_email is null or char_length(p_email) not between 3 and 254 then raise exception 'invalid suppression' using errcode = '22023'; end if;
  insert into crm_suppressions (org_id, email, reason) values (p_org, lower(btrim(p_email)), p_reason) on conflict (org_id, email) do nothing;
end $$;

create function public.crm_suppress_by_provider_id(p_provider text, p_reason text) returns boolean
language plpgsql security definer set search_path = public as
$$ declare m crm_emails;
begin
  if p_reason is null or p_reason not in ('bounce','complaint') then raise exception 'invalid suppression' using errcode = '22023'; end if;
  select * into m from crm_emails where provider_id = p_provider;
  if not found then return false; end if;
  insert into crm_suppressions (org_id, email, reason) values (m.org_id, lower(m.to_email), p_reason) on conflict (org_id, email) do nothing;
  return true;
end $$;

revoke execute on function public.crm_email_enabled(uuid), public.crm_set_basis(uuid, uuid, text), public.crm_reserve_email(uuid, uuid, text, text),
  public.crm_mark_email(uuid, text, text), public.crm_add_suppression(uuid, text, text), public.crm_suppress_by_provider_id(text, text) from public, anon, authenticated;
grant execute on function public.crm_set_basis(uuid, uuid, text), public.crm_reserve_email(uuid, uuid, text, text) to authenticated;
grant execute on function public.crm_mark_email(uuid, text, text), public.crm_add_suppression(uuid, text, text), public.crm_suppress_by_provider_id(text, text) to service_role;
