-- 0045 budgets: owners set a monthly or quarterly budget; accepted contracts and paid bookings count against it; an admin
-- acceptance that would go over it (or is in another currency) becomes an owner approval request, alongside the 0041
-- threshold rule. Periods are UTC calendar months or quarters, half-open. No currency conversion. Errcodes: 42501, 22023.
-- Undo: recreate accept_contract from 0041 and spend_request_decide from 0042; drop functions budget_set, budget_status,
-- budget_spent, budget_period; drop table budgets; drop columns contracts.client_accepted_at and spend_requests.reasons.

create table public.budgets (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default true,
  period text not null check (period in ('month','quarter')),
  amount_minor int not null check (amount_minor between 1 and 2147483647),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.budgets enable row level security;
revoke all on public.budgets from public, anon, authenticated;
grant select on public.budgets to authenticated;
-- as spend_policies: owners and admins read the row; members see the usage through budget_status only
create policy budgets_select on public.budgets for select to authenticated using (public.has_org_role(org_id, array['owner','admin']));

alter table public.contracts add column client_accepted_at timestamptz;
-- best date available for contracts accepted before this migration
update public.contracts set client_accepted_at = created_at where accepted_by_client;
create index contracts_client_accepted_idx on public.contracts (client_org_id, client_accepted_at) where accepted_by_client;

alter table public.spend_requests add column reasons text[] not null default '{threshold}'
  check (reasons <@ array['threshold','budget'] and cardinality(reasons) between 1 and 2);

create function public.budget_period(p_period text, p_at timestamptz) returns tstzrange
language sql immutable set search_path = public as
$$ select tstzrange(date_trunc(p_period, p_at at time zone 'UTC') at time zone 'UTC',
                    (date_trunc(p_period, p_at at time zone 'UTC') + case when p_period = 'quarter' then interval '3 months' else interval '1 month' end) at time zone 'UTC') $$;

-- Spend of one organization in [p_from, p_to) and one currency, and how many items in other currencies were left out.
create function public.budget_spent(p_org uuid, p_from timestamptz, p_to timestamptz, p_currency text,
  out contracts bigint, out bookings bigint, out other_currency int)
language sql stable security definer set search_path = public as
$$ select
     (select coalesce(sum(case when c.status = 'cancelled'
                               then (select coalesce(sum(p.amount), 0) from payments p where p.contract_id = c.id and p.status = 'succeeded')
                               else c.price end), 0)
        from contracts c where c.client_org_id = p_org and c.accepted_by_client and c.currency = p_currency
          and c.client_accepted_at >= p_from and c.client_accepted_at < p_to),
     (select coalesce(sum(bp.amount), 0) from booking_payments bp join bookings b on b.id = bp.booking_id
        where b.client_org_id = p_org and bp.status = 'succeeded' and bp.currency = p_currency and bp.paid_at >= p_from and bp.paid_at < p_to),
     (select count(*)::int from contracts c where c.client_org_id = p_org and c.accepted_by_client and c.currency <> p_currency
          and c.client_accepted_at >= p_from and c.client_accepted_at < p_to)
     + (select count(*)::int from booking_payments bp join bookings b on b.id = bp.booking_id
          where b.client_org_id = p_org and bp.status = 'succeeded' and bp.currency <> p_currency and bp.paid_at >= p_from and bp.paid_at < p_to) $$;

create function public.budget_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as
$$ declare v_b budgets; v_r tstzrange; v_s record;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_b from budgets where org_id = p_org;
  if not found then return null; end if;
  v_r := public.budget_period(v_b.period, now());
  select * into v_s from public.budget_spent(p_org, lower(v_r), upper(v_r), v_b.currency);
  return jsonb_build_object('enabled', v_b.enabled, 'period', v_b.period, 'period_start', lower(v_r), 'period_end', upper(v_r),
    'currency', v_b.currency, 'limit', v_b.amount_minor, 'spent', v_s.contracts + v_s.bookings,
    'remaining', v_b.amount_minor - (v_s.contracts + v_s.bookings), 'contracts', v_s.contracts, 'bookings', v_s.bookings,
    'other_currency', v_s.other_currency);
end $$;

create function public.budget_set(p_org uuid, p_enabled boolean, p_period text, p_amount int, p_currency text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_old budgets;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_enabled is null or p_period is null or p_period not in ('month','quarter') or p_amount is null or p_amount < 1
     or p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid budget' using errcode = '22023'; end if;
  select * into v_old from budgets where org_id = p_org for update;
  insert into budgets (org_id, enabled, period, amount_minor, currency, updated_by, updated_at)
  values (p_org, p_enabled, p_period, p_amount, p_currency, auth.uid(), now())
  on conflict (org_id) do update set enabled = excluded.enabled, period = excluded.period, amount_minor = excluded.amount_minor,
    currency = excluded.currency, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), p_org, 'budget.set', 'budget', p_org::text,
    case when v_old.org_id is null then null
         else jsonb_build_object('enabled', v_old.enabled, 'period', v_old.period, 'amount', v_old.amount_minor, 'currency', v_old.currency) end,
    jsonb_build_object('enabled', p_enabled, 'period', p_period, 'amount', p_amount, 'currency', p_currency), 'success', gen_random_uuid()::text);
end $$;

-- As 0041, plus: the budget check (under an advisory lock per organization, so parallel acceptances queue and each counts
-- the others), one request carrying its reasons, and client_accepted_at. The count runs in a new statement after the lock,
-- which sees work committed meanwhile under READ COMMITTED (the default, and what PostgREST uses).
create or replace function public.accept_contract(p_org uuid, p_contract uuid) returns text
language plpgsql security definer set search_path = public as
$$ declare v_c contracts%rowtype; v_sum bigint; v_pol spend_policies; v_req spend_requests; v_hash text; v_id uuid; m record;
  v_bud budgets; v_r tstzrange; v_s record; v_reasons text[] := '{}';
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_c from contracts where id = p_contract for update; -- also serializes parallel requests for this contract
  if not found or p_org not in (v_c.client_org_id, v_c.provider_org_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_c.status <> 'draft' then raise exception 'contract is not editable' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into v_sum from milestones where contract_id = p_contract;
  if v_sum <> v_c.price then raise exception 'milestones must add up to the contract price' using errcode = '22023'; end if;
  -- already accepted by this side: nothing to do (counting it again, or moving its acceptance time, would distort the budget)
  if (p_org = v_c.client_org_id and v_c.accepted_by_client) or (p_org = v_c.provider_org_id and v_c.accepted_by_provider) then return 'accepted'; end if;
  if p_org = v_c.client_org_id then
    select * into v_bud from budgets where org_id = p_org and enabled;
    -- every client acceptance under a budget queues here (owners too), so an admin's count includes them
    if v_bud.org_id is not null then perform pg_advisory_xact_lock(hashtextextended('budget:' || p_org::text, 0)); end if;
  end if;
  if p_org = v_c.client_org_id and not public.has_org_role(p_org, array['owner']) then
    select * into v_pol from spend_policies where org_id = p_org and enabled;
    -- no currency conversion: a contract in another currency always needs approval
    if v_pol.org_id is not null and (v_c.currency <> v_pol.currency or v_c.price >= v_pol.threshold_minor) then
      v_reasons := v_reasons || 'threshold'::text; end if;
    if v_bud.org_id is not null then
      if v_c.currency <> v_bud.currency then v_reasons := v_reasons || 'budget'::text;
      else
        v_r := public.budget_period(v_bud.period, now());
        select * into v_s from public.budget_spent(p_org, lower(v_r), upper(v_r), v_bud.currency); -- new statement: sees acceptances committed while we queued
        if v_s.contracts + v_s.bookings + v_c.price > v_bud.amount_minor then v_reasons := v_reasons || 'budget'::text; end if;
      end if;
    end if;
    if cardinality(v_reasons) > 0 then
      v_hash := public.spend_terms_hash(p_contract);
      select * into v_req from spend_requests where org_id = p_org and contract_id = p_contract and status = 'pending' for update;
      if v_req.id is not null then
        if v_req.price = v_c.price and v_req.currency = v_c.currency and v_req.terms_hash = v_hash and v_req.reasons = v_reasons then return 'approval_pending'; end if;
        update spend_requests set status = 'lapsed', decided_at = now() where id = v_req.id;
        perform public.spend_audit(p_org, 'spend_request.lapse', v_req.id, jsonb_build_object('contract', p_contract));
      end if;
      insert into spend_requests (org_id, contract_id, requested_by, price, currency, terms_hash, reasons)
      values (p_org, p_contract, auth.uid(), v_c.price, v_c.currency, v_hash, v_reasons) returning id into v_id;
      perform public.spend_audit(p_org, 'spend_request.create', v_id, jsonb_build_object('contract', p_contract, 'price', v_c.price, 'currency', v_c.currency, 'reasons', v_reasons));
      for m in select user_id from memberships where org_id = p_org and role = 'owner' loop
        perform public.notify(m.user_id, 'spend_approval_requested', jsonb_build_object('contract_id', p_contract, 'request_id', v_id, 'org_id', p_org));
      end loop;
      return 'approval_requested';
    end if;
  end if;
  if p_org = v_c.client_org_id then
    update contracts set accepted_by_client = true, client_accepted_at = now() where id = p_contract;
    -- accepted another way (an owner, or the rule changed): a pending request is no longer needed
    perform public.spend_lapse_pending(p_contract);
  else update contracts set accepted_by_provider = true where id = p_contract; end if;
  return 'accepted';
end $$;

-- As 0042, plus client_accepted_at on approval, and the budget lock: an approval is an acceptance too, so an admin accepting
-- at the same time must count it. Order: contract, budget lock, request (the order accept_contract uses).
create or replace function public.spend_request_decide(p_org uuid, p_request uuid, p_approve boolean, p_note text) returns text
language plpgsql security definer set search_path = public as
$$ declare v_req spend_requests; v_c contracts%rowtype; v_sum bigint; v_note text := btrim(coalesce(p_note, '')); v_contract uuid;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select contract_id into v_contract from spend_requests where id = p_request and org_id = p_org;
  if v_contract is null then raise exception 'not allowed' using errcode = '42501'; end if;
  -- contract first, then request: the order accept_contract uses
  select * into v_c from contracts where id = v_contract for update;
  if p_approve and exists (select 1 from budgets where org_id = p_org and enabled) then
    perform pg_advisory_xact_lock(hashtextextended('budget:' || p_org::text, 0)); end if;
  select * into v_req from spend_requests where id = p_request for update;
  -- nobody decides their own request, including an admin who was promoted to owner since
  if v_req.requested_by = auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'invalid decision' using errcode = '22023'; end if;
  if v_req.status <> 'pending' then raise exception 'request is no longer pending' using errcode = '55000'; end if;
  if not p_approve then
    if char_length(v_note) not between 1 and 500 then raise exception 'a note is required' using errcode = '22023'; end if;
    update spend_requests set status = 'rejected', note = v_note, decided_by = auth.uid(), decided_at = now() where id = p_request;
    perform public.spend_audit(p_org, 'spend_request.reject', p_request, jsonb_build_object('contract', v_req.contract_id));
    if v_req.requested_by is not null then
      perform public.notify(v_req.requested_by, 'spend_request_rejected', jsonb_build_object('contract_id', v_req.contract_id, 'request_id', p_request, 'org_id', p_org));
    end if;
    return 'rejected';
  end if;
  select coalesce(sum(amount), 0) into v_sum from milestones where contract_id = v_req.contract_id;
  if v_c.status <> 'draft' or v_c.price <> v_req.price or v_c.currency <> v_req.currency or v_sum <> v_c.price
     or public.spend_terms_hash(v_req.contract_id) <> v_req.terms_hash then
    update spend_requests set status = 'lapsed', decided_by = auth.uid(), decided_at = now() where id = p_request;
    perform public.spend_audit(p_org, 'spend_request.lapse', p_request, jsonb_build_object('contract', v_req.contract_id));
    return 'lapsed';
  end if;
  update spend_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_request;
  update contracts set accepted_by_client = true, client_accepted_at = now() where id = v_req.contract_id;
  perform public.spend_audit(p_org, 'spend_request.approve', p_request, jsonb_build_object('contract', v_req.contract_id));
  if v_req.requested_by is not null then
    perform public.notify(v_req.requested_by, 'spend_request_approved', jsonb_build_object('contract_id', v_req.contract_id, 'request_id', p_request, 'org_id', p_org));
  end if;
  return 'approved';
end $$;

revoke execute on function public.budget_period(text, timestamptz), public.budget_spent(uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.budget_set(uuid, boolean, text, int, text), public.budget_status(uuid) from public, anon;
grant execute on function public.budget_set(uuid, boolean, text, int, text), public.budget_status(uuid) to authenticated;
