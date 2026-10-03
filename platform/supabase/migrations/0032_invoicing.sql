-- 0032 invoicing. Invoices and credit notes are written only by the RPCs below and can never be edited or deleted.
create table public.billing_profiles (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  legal_name text not null check (char_length(legal_name) between 2 and 160),
  address text not null check (char_length(address) between 5 and 500),
  country text not null check (country ~ '^[A-Z]{2}$'),
  tax_number text check (tax_number is null or char_length(tax_number) between 1 and 40),
  tax_bps int not null default 0 check (tax_bps between 0 and 10000),
  updated_at timestamptz not null default now(),
  check (tax_bps = 0 or tax_number is not null)
);
create trigger billing_profiles_touch before update on public.billing_profiles
  for each row execute function public.touch_updated_at();
alter table public.billing_profiles enable row level security;
revoke all on public.billing_profiles from public, anon, authenticated;
grant select on public.billing_profiles to authenticated;
create policy billing_profiles_select on public.billing_profiles for select to authenticated
  using (public.is_member(org_id) or public.is_platform_admin());

create table public.invoice_counters (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  last_no int not null default 0
);
alter table public.invoice_counters enable row level security;
revoke all on public.invoice_counters from public, anon, authenticated;
create policy invoice_counters_none on public.invoice_counters for all using (false) with check (false);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  contract_id uuid not null references public.contracts (id) on delete restrict,
  milestone_id uuid not null references public.milestones (id) on delete restrict,
  payment_id uuid not null references public.payments (id) on delete restrict,
  kind text not null check (kind in ('invoice','credit_note')),
  credits_invoice_id uuid references public.invoices (id) on delete restrict,
  number text not null,
  issued_at timestamptz not null default now(),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  net int not null check (net >= 0),
  tax_bps int not null check (tax_bps between 0 and 10000),
  tax int not null check (tax >= 0),
  total int not null check (total > 0),
  issuer jsonb not null,
  recipient jsonb not null,
  description text not null check (char_length(description) <= 400),
  unique (org_id, number),
  check (net + tax = total),
  check ((kind = 'credit_note') = (credits_invoice_id is not null))
);
create unique index invoices_one_invoice_per_milestone on public.invoices (milestone_id) where kind = 'invoice';
create unique index invoices_one_credit_note_per_invoice on public.invoices (credits_invoice_id) where kind = 'credit_note';
create index invoices_contract_idx on public.invoices (contract_id, issued_at);
alter table public.invoices enable row level security;
revoke all on public.invoices from public, anon, authenticated;
grant select on public.invoices to authenticated;
create policy invoices_select on public.invoices for select to authenticated
  using (public.is_contract_party(contract_id) or public.is_platform_admin());

create function public.invoices_immutable() returns trigger language plpgsql as
$$ begin raise exception 'invoices are immutable'; end $$;
create trigger invoices_no_change before update or delete on public.invoices
  for each row execute function public.invoices_immutable();
create trigger invoices_no_truncate before truncate on public.invoices
  for each statement execute function public.invoices_immutable();
create trigger invoice_counters_no_truncate before truncate on public.invoice_counters
  for each statement execute function public.invoices_immutable();
-- Supabase grants service_role everything on new tables by default; invoices and their counter are written only by the definer functions below.
revoke all on public.invoices, public.invoice_counters from service_role;

create function public.save_billing_profile(p_org uuid, p_legal_name text, p_address text, p_country text, p_tax_number text, p_tax_bps int) returns void
language plpgsql security definer set search_path = public as
$$ declare v_tax text := nullif(btrim(p_tax_number), '');
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_legal_name, ''))) not between 2 and 160
     or char_length(btrim(coalesce(p_address, ''))) not between 5 and 500
     or p_country is null or p_country !~ '^[A-Z]{2}$'
     or (v_tax is not null and char_length(v_tax) > 40)
     or p_tax_bps is null or p_tax_bps not between 0 and 10000
     or (p_tax_bps > 0 and v_tax is null) then
    raise exception 'invalid billing profile' using errcode = '22023';
  end if;
  insert into billing_profiles (org_id, legal_name, address, country, tax_number, tax_bps)
  values (p_org, btrim(p_legal_name), btrim(p_address), p_country, v_tax, p_tax_bps)
  on conflict (org_id) do update set legal_name = excluded.legal_name, address = excluded.address, country = excluded.country,
    tax_number = excluded.tax_number, tax_bps = excluded.tax_bps;
end $$;

-- Next number in the organization's gapless sequence; the caller holds the org's advisory lock.
create function public.next_invoice_number(p_org uuid, p_prefix text) returns text
language plpgsql security definer set search_path = public as
$$ declare v_no int;
begin
  insert into invoice_counters (org_id, last_no) values (p_org, 1)
  on conflict (org_id) do update set last_no = invoice_counters.last_no + 1 returning last_no into v_no;
  return p_prefix || '-' || extract(year from now() at time zone 'Asia/Dubai')::int || '-' || lpad(v_no::text, 6, '0');
end $$;

create function public.issue_invoice(p_org uuid, p_milestone uuid) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_m milestones%rowtype; v_c contracts%rowtype; v_pay payments%rowtype; v_prof billing_profiles%rowtype;
  v_cli billing_profiles%rowtype; v_id uuid; v_net int; v_cname text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_m from milestones where id = p_milestone;
  select * into v_c from contracts where id = v_m.contract_id;
  if not found or v_c.provider_org_id <> p_org or not public.has_org_role(p_org, array['owner','admin']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('invoice:' || p_org::text));
  select id into v_id from invoices where milestone_id = p_milestone and kind = 'invoice';
  if found then return v_id; end if;
  select * into v_pay from payments where milestone_id = p_milestone for share;
  -- A payment that landed on a cancelled contract is refunded outside the system, so it is never invoiced.
  if not found or v_pay.status <> 'succeeded' or v_m.status <> 'paid' or v_c.status = 'cancelled' then raise exception 'milestone is not paid' using errcode = '55000'; end if;
  select * into v_prof from billing_profiles where org_id = p_org;
  if not found then raise exception 'billing profile required' using errcode = '55000'; end if;
  select * into v_cli from billing_profiles where org_id = v_c.client_org_id;
  select name into v_cname from organizations where id = v_c.client_org_id;
  -- The milestone amount is what the client paid for the work (gross); the client fee belongs to Papple and is not on this invoice.
  v_net := case when v_prof.tax_bps = 0 then v_pay.amount else round(v_pay.amount::numeric * 10000 / (10000 + v_prof.tax_bps))::int end;
  insert into invoices (org_id, contract_id, milestone_id, payment_id, kind, number, currency, net, tax_bps, tax, total, issuer, recipient, description)
  values (p_org, v_c.id, v_m.id, v_pay.id, 'invoice', public.next_invoice_number(p_org, 'INV'), v_pay.currency, v_net, v_prof.tax_bps, v_pay.amount - v_net, v_pay.amount,
    jsonb_build_object('legal_name', v_prof.legal_name, 'address', v_prof.address, 'country', v_prof.country, 'tax_number', v_prof.tax_number),
    case when v_cli.org_id is null then jsonb_build_object('name', v_cname)
         else jsonb_build_object('name', v_cli.legal_name, 'address', v_cli.address, 'country', v_cli.country, 'tax_number', v_cli.tax_number) end,
    left(v_c.title || ' - ' || v_m.title, 400))
  returning id into v_id;
  return v_id;
end $$;

create function public.issue_credit_note(p_org uuid, p_invoice uuid) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_i invoices%rowtype; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_i from invoices where id = p_invoice and kind = 'invoice';
  if not found or v_i.org_id <> p_org or not public.has_org_role(p_org, array['owner','admin']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('invoice:' || p_org::text));
  select id into v_id from invoices where credits_invoice_id = p_invoice;
  if found then return v_id; end if;
  if not exists (select 1 from refunds where payment_id = v_i.payment_id and status = 'succeeded') then
    raise exception 'payment was not refunded' using errcode = '55000';
  end if;
  insert into invoices (org_id, contract_id, milestone_id, payment_id, kind, credits_invoice_id, number, currency, net, tax_bps, tax, total, issuer, recipient, description)
  values (v_i.org_id, v_i.contract_id, v_i.milestone_id, v_i.payment_id, 'credit_note', v_i.id, public.next_invoice_number(p_org, 'CN'), v_i.currency, v_i.net, v_i.tax_bps, v_i.tax, v_i.total,
    v_i.issuer, v_i.recipient, left('Credit for ' || v_i.number || ': ' || v_i.description, 400))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.invoices_immutable(), public.next_invoice_number(uuid, text), public.save_billing_profile(uuid, text, text, text, text, int),
  public.issue_invoice(uuid, uuid), public.issue_credit_note(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.save_billing_profile(uuid, text, text, text, text, int), public.issue_invoice(uuid, uuid), public.issue_credit_note(uuid, uuid) to authenticated;
