-- 0033 simple CRM (contacts, deals, notes). Private to one organization; written only through the RPCs below.
create table public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  company text check (company is null or char_length(company) <= 160),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone text check (phone is null or char_length(phone) <= 40),
  source text not null default 'manual' check (source in ('manual','import','marketplace')),
  basis text check (basis in ('existing_client','opted_in','requested_contact')),
  import_attested_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index crm_contacts_email_uidx on public.crm_contacts (org_id, lower(email)) where email is not null;
create index crm_contacts_org_idx on public.crm_contacts (org_id, name);
create trigger crm_contacts_touch before update on public.crm_contacts for each row execute function public.touch_updated_at();

create table public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null references public.crm_contacts (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  stage text not null default 'lead' check (stage in ('lead','proposal','won','lost')),
  value int check (value is null or value >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  expected_close date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((value is null) = (currency is null))
);
create index crm_deals_contact_idx on public.crm_deals (contact_id);
create trigger crm_deals_touch before update on public.crm_deals for each row execute function public.touch_updated_at();

create table public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null references public.crm_contacts (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  follow_up_at timestamptz,
  done_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index crm_notes_contact_idx on public.crm_notes (contact_id, created_at desc);

alter table public.crm_contacts enable row level security;
alter table public.crm_deals enable row level security;
alter table public.crm_notes enable row level security;
revoke all on public.crm_contacts, public.crm_deals, public.crm_notes from public, anon, authenticated;
grant select on public.crm_contacts, public.crm_deals, public.crm_notes to authenticated;
create policy crm_contacts_select on public.crm_contacts for select to authenticated using (public.is_member(org_id) or public.is_platform_admin());
create policy crm_deals_select on public.crm_deals for select to authenticated using (public.is_member(org_id) or public.is_platform_admin());
create policy crm_notes_select on public.crm_notes for select to authenticated using (public.is_member(org_id) or public.is_platform_admin());

create function public.crm_valid_email(p text) returns boolean language sql immutable as
$$ select p is null or (char_length(p) <= 254 and p ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') $$;

-- Caller must write: member or above of an active organization.
create function public.crm_assert_writer(p_org uuid) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

create function public.crm_save_contact(p_org uuid, p_id uuid, p_name text, p_company text, p_email text, p_phone text, p_source text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_email text := nullif(btrim(p_email), ''); v_id uuid; v_limit int;
begin
  perform public.crm_assert_writer(p_org);
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 160 or char_length(coalesce(p_company, '')) > 160
     or not public.crm_valid_email(v_email) or char_length(coalesce(p_phone, '')) > 40
     or p_source is null or p_source not in ('manual','marketplace') then
    raise exception 'invalid contact' using errcode = '22023';
  end if;
  if p_id is null then
    perform pg_advisory_xact_lock(hashtext('crm:' || p_org::text));
    v_limit := public.org_limit(p_org, 'limits.crm_contacts');
    if v_limit is not null and (select count(*) from crm_contacts where org_id = p_org) >= v_limit then
      raise exception 'contact limit reached' using errcode = '54000';
    end if;
    insert into crm_contacts (org_id, name, company, email, phone, source, created_by)
    values (p_org, btrim(p_name), nullif(btrim(p_company), ''), v_email, nullif(btrim(p_phone), ''), p_source, auth.uid()) returning id into v_id;
  else
    update crm_contacts set name = btrim(p_name), company = nullif(btrim(p_company), ''), email = v_email, phone = nullif(btrim(p_phone), '')
    where id = p_id and org_id = p_org returning id into v_id;
    if v_id is null then raise exception 'not allowed' using errcode = '42501'; end if;
  end if;
  return v_id;
end $$;

create function public.crm_delete_contact(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from crm_contacts where id = p_id and org_id = p_org;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

-- Imports at most 500 rows. Returns {imported, duplicate, invalid: [1-based row numbers], limit}.
create function public.crm_import_contacts(p_org uuid, p_rows jsonb, p_attested boolean) returns jsonb
language plpgsql security definer set search_path = public as
$$ declare r jsonb; i int := 0; v_name text; v_email text; v_imported int := 0; v_dup int := 0; v_limit_rows int := 0; v_invalid jsonb := '[]'::jsonb;
  v_limit int; v_count int;
begin
  perform public.crm_assert_writer(p_org);
  if p_attested is distinct from true or p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'invalid import' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('crm:' || p_org::text));
  v_limit := public.org_limit(p_org, 'limits.crm_contacts');
  select count(*) into v_count from crm_contacts where org_id = p_org;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_name := btrim(coalesce(r ->> 'name', ''));
    v_email := nullif(btrim(coalesce(r ->> 'email', '')), '');
    if jsonb_typeof(r) <> 'object' or char_length(v_name) not between 1 and 160 or char_length(coalesce(r ->> 'company', '')) > 160
       or char_length(coalesce(r ->> 'phone', '')) > 40 or not public.crm_valid_email(v_email) then
      v_invalid := v_invalid || to_jsonb(i);
      continue;
    end if;
    if v_email is not null and exists (select 1 from crm_contacts where org_id = p_org and lower(email) = lower(v_email)) then
      v_dup := v_dup + 1;
      continue;
    end if;
    if v_limit is not null and v_count >= v_limit then
      v_limit_rows := v_limit_rows + 1;
      continue;
    end if;
    insert into crm_contacts (org_id, name, company, email, phone, source, import_attested_at, created_by)
    values (p_org, v_name, nullif(btrim(coalesce(r ->> 'company', '')), ''), v_email, nullif(btrim(coalesce(r ->> 'phone', '')), ''), 'import', now(), auth.uid());
    v_count := v_count + 1;
    v_imported := v_imported + 1;
  end loop;
  return jsonb_build_object('imported', v_imported, 'duplicate', v_dup, 'invalid', v_invalid, 'limit', v_limit_rows);
end $$;

create function public.crm_save_deal(p_org uuid, p_id uuid, p_contact uuid, p_title text, p_stage text, p_value int, p_currency text, p_close date) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_id uuid;
begin
  perform public.crm_assert_writer(p_org);
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 200 or p_stage is null or p_stage not in ('lead','proposal','won','lost')
     or (p_value is null) <> (p_currency is null) or (p_value is not null and (p_value < 0 or p_currency !~ '^[A-Z]{3}$')) then
    raise exception 'invalid deal' using errcode = '22023';
  end if;
  if not exists (select 1 from crm_contacts where id = p_contact and org_id = p_org) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_id is null then
    insert into crm_deals (org_id, contact_id, title, stage, value, currency, expected_close) values (p_org, p_contact, btrim(p_title), p_stage, p_value, p_currency, p_close) returning id into v_id;
  else
    update crm_deals set title = btrim(p_title), stage = p_stage, value = p_value, currency = p_currency, expected_close = p_close
    where id = p_id and org_id = p_org and contact_id = p_contact returning id into v_id;
    if v_id is null then raise exception 'not allowed' using errcode = '42501'; end if;
  end if;
  return v_id;
end $$;

create function public.crm_add_note(p_org uuid, p_contact uuid, p_body text, p_follow_up timestamptz) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_id uuid;
begin
  perform public.crm_assert_writer(p_org);
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'invalid note' using errcode = '22023'; end if;
  if not exists (select 1 from crm_contacts where id = p_contact and org_id = p_org) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into crm_notes (org_id, contact_id, body, follow_up_at, created_by) values (p_org, p_contact, btrim(p_body), p_follow_up, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create function public.crm_complete_note(p_org uuid, p_note uuid) returns void
language plpgsql security definer set search_path = public as
$$ begin
  perform public.crm_assert_writer(p_org);
  update crm_notes set done_at = coalesce(done_at, now()) where id = p_note and org_id = p_org;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

revoke execute on function public.crm_valid_email(text), public.crm_assert_writer(uuid), public.crm_save_contact(uuid, uuid, text, text, text, text, text),
  public.crm_delete_contact(uuid, uuid), public.crm_import_contacts(uuid, jsonb, boolean), public.crm_save_deal(uuid, uuid, uuid, text, text, int, text, date),
  public.crm_add_note(uuid, uuid, text, timestamptz), public.crm_complete_note(uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_save_contact(uuid, uuid, text, text, text, text, text), public.crm_delete_contact(uuid, uuid), public.crm_import_contacts(uuid, jsonb, boolean),
  public.crm_save_deal(uuid, uuid, uuid, text, text, int, text, date), public.crm_add_note(uuid, uuid, text, timestamptz), public.crm_complete_note(uuid, uuid) to authenticated;

-- The plan limit must exist wherever migrations run: org_limit() treats a missing key as unlimited.
insert into public.platform_settings (key, value, description)
values ('limits.crm_contacts', '{"default":100,"professional_plus":1000,"business":10000,"enterprise":null}', 'Max CRM contacts per organization, by plan (null = unlimited)')
on conflict (key) do nothing;
