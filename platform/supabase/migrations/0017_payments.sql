-- 0017 milestone payments. Clients can only request approval; money state changes come from the verified Stripe webhook (service role).

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null unique references public.milestones (id) on delete restrict,
  contract_id uuid not null references public.contracts (id) on delete restrict,
  checkout_session_id text unique,
  payment_intent_id text,
  amount int not null check (amount > 0),
  client_fee int not null check (client_fee >= 0),
  provider_fee int not null check (provider_fee >= 0),
  client_total int not null check (client_total > 0),
  application_fee int not null check (application_fee >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending','succeeded','failed')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_contract_idx on public.payments (contract_id);
create trigger payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();

alter table public.payments enable row level security;
revoke all on public.payments from anon, public, authenticated;
grant select (id, milestone_id, contract_id, amount, client_fee, provider_fee, client_total, application_fee, currency, status, paid_at, created_at)
  on public.payments to authenticated;
create policy payments_select on public.payments for select to authenticated
  using (public.is_contract_party(contract_id) or public.is_platform_admin());

-- Client approves a submitted milestone; the server then opens a Checkout session for the returned payment.
-- Lock order everywhere: milestone, then contract, then payment.
create function public.approve_milestone(p_org uuid, p_milestone uuid) returns jsonb
language plpgsql security definer set search_path = public as
$$ declare v_m milestones%rowtype; v_c contracts%rowtype; v_pay payments%rowtype;
  v_cf int; v_pf int; v_total int; v_fee int; v_prev text; v_min int := public.setting_int('payments.min_application_fee_minor', 0);
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_m from milestones where id = p_milestone for update;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_c from contracts where id = v_m.contract_id for update;
  if p_org <> v_c.client_org_id then raise exception 'not allowed' using errcode = '42501'; end if;
  -- nobody approves and pays for work done by an organization they belong to
  if public.is_member(v_c.provider_org_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_c.status <> 'active' or v_m.status not in ('submitted','approved') then
    raise exception 'milestone cannot be approved' using errcode = '22023'; end if;
  if exists (select 1 from payments where milestone_id = p_milestone and status = 'succeeded') then
    raise exception 'milestone is already paid' using errcode = '22023'; end if;
  select checkout_session_id into v_prev from payments where milestone_id = p_milestone;
  -- same rounding as applyBps in apps/web/src/lib/money.ts (half up)
  v_cf := ((v_m.amount::bigint * v_c.commission_client_bps + 5000) / 10000)::int;
  v_pf := ((v_m.amount::bigint * v_c.commission_pro_bps + 5000) / 10000)::int;
  v_total := v_m.amount + v_cf;
  v_fee := least(greatest(v_cf + v_pf, v_min), v_total);
  insert into payments (milestone_id, contract_id, amount, client_fee, provider_fee, client_total, application_fee, currency)
  values (p_milestone, v_c.id, v_m.amount, v_cf, v_pf, v_total, v_fee, v_c.currency)
  on conflict (milestone_id) do update
    set status = 'pending', amount = excluded.amount, client_fee = excluded.client_fee, provider_fee = excluded.provider_fee,
        client_total = excluded.client_total, application_fee = excluded.application_fee
    where payments.status <> 'succeeded'
  returning * into v_pay;
  update milestones set status = 'approved' where id = p_milestone and status = 'submitted';
  return jsonb_build_object('payment_id', v_pay.id, 'milestone_id', p_milestone, 'title', v_m.title,
    'amount', v_pay.amount, 'client_fee', v_pay.client_fee, 'provider_fee', v_pay.provider_fee,
    'client_total', v_pay.client_total, 'application_fee', v_pay.application_fee, 'currency', v_pay.currency,
    'contract_id', v_c.id, 'previous_session', v_prev);
end $$;

-- Payout setup: the user-facing check (role + organization type), then a service-only lookup.
create function public.assert_can_manage_payouts(p_org uuid) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from organizations where id = p_org and type in ('individual','agency')) then
    raise exception 'this organization cannot receive payouts' using errcode = '22023'; end if;
end $$;

create function public.payout_account(p_org uuid) returns text
language sql stable security definer set search_path = public as
$$ select stripe_account_id from connected_accounts where org_id = p_org $$;

create function public.payment_destination(p_payment uuid) returns text
language plpgsql security definer set search_path = public as
$$ declare v_acct text;
begin
  select ca.stripe_account_id into v_acct from payments p
    join contracts c on c.id = p.contract_id
    join connected_accounts ca on ca.org_id = c.provider_org_id and ca.payouts_enabled
    where p.id = p_payment;
  if v_acct is null then raise exception 'no payout account' using errcode = '22023'; end if;
  return v_acct;
end $$;

-- Compare-and-set: succeeds only for the caller that saw the current session (p_prev). A concurrent second click loses
-- and returns false, so exactly one live Checkout session exists per payment. A payment failed by a stale expiry event is revived.
create function public.attach_checkout_session(p_payment uuid, p_session text, p_prev text) returns boolean
language plpgsql security definer set search_path = public as
$$ begin
  update payments set checkout_session_id = p_session, status = 'pending'
    where id = p_payment and status in ('pending','failed') and checkout_session_id is not distinct from p_prev;
  return found;
end $$;

create function public.record_payment_succeeded(p_payment uuid, p_session text, p_intent text, p_amount int, p_currency text) returns text
language plpgsql security definer set search_path = public as
$$ declare v_mid uuid; v_m milestones%rowtype; v_c contracts%rowtype; v_p payments%rowtype;
begin
  select milestone_id into v_mid from payments where id = p_payment;
  if v_mid is null then return 'unknown'; end if;
  select * into v_m from milestones where id = v_mid for update;
  select * into v_c from contracts where id = v_m.contract_id for update;
  select * into v_p from payments where id = p_payment for update;
  if v_p.status = 'succeeded' then
    if v_p.payment_intent_id is not distinct from p_intent then return 'duplicate'; end if;
    insert into audit_log (action, entity, entity_id, after, outcome, request_id)
    values ('payment.duplicate_charge', 'payment', p_payment::text,
            jsonb_build_object('payment_intent', p_intent, 'session', p_session, 'amount', p_amount, 'currency', p_currency),
            'error', 'stripe-webhook');
    return 'duplicate_charge';
  end if;
  if p_amount is distinct from v_p.client_total or p_currency is distinct from v_p.currency then return 'mismatch'; end if;
  update payments set status = 'succeeded', payment_intent_id = p_intent, paid_at = now(),
    checkout_session_id = coalesce(p_session, checkout_session_id) where id = p_payment;
  update milestones set status = 'paid' where id = v_mid;
  perform public.notify_org(v_c.provider_org_id, 'payment_received',
    jsonb_build_object('contract_id', v_c.id, 'milestone_id', v_mid));
  if v_c.status = 'active' and not exists (select 1 from milestones where contract_id = v_c.id and status <> 'paid') then
    update contracts set status = 'completed' where id = v_c.id;
    perform public.notify_org(v_c.provider_org_id, 'contract_completed', jsonb_build_object('contract_id', v_c.id));
    perform public.notify_org(v_c.client_org_id, 'contract_completed', jsonb_build_object('contract_id', v_c.id));
  end if;
  return 'recorded';
end $$;

-- Only an event for the payment's current session can fail it: the expiry of a replaced session must not kill the new attempt.
create function public.record_payment_failed(p_payment uuid, p_session text) returns text
language plpgsql security definer set search_path = public as
$$ begin
  update payments set status = 'failed' where id = p_payment and status = 'pending' and checkout_session_id is not distinct from p_session;
  return case when found then 'failed' else 'ignored' end;
end $$;

create function public.register_connected_account(p_org uuid, p_account text) returns void
language sql security definer set search_path = public as
$$ insert into connected_accounts (org_id, stripe_account_id) values (p_org, p_account) on conflict (org_id) do nothing $$;

create function public.record_account_update(p_account text, p_payouts boolean, p_details boolean) returns boolean
language plpgsql security definer set search_path = public as
$$ begin
  update connected_accounts set payouts_enabled = coalesce(p_payouts, payouts_enabled),
    details_submitted = coalesce(p_details, details_submitted) where stripe_account_id = p_account;
  return found;
end $$;

revoke execute on function public.approve_milestone(uuid,uuid), public.payment_destination(uuid),
  public.attach_checkout_session(uuid,text,text), public.record_payment_succeeded(uuid,text,text,int,text),
  public.record_payment_failed(uuid,text), public.register_connected_account(uuid,text),
  public.record_account_update(text,boolean,boolean), public.assert_can_manage_payouts(uuid), public.payout_account(uuid)
  from public, anon, authenticated;
grant execute on function public.approve_milestone(uuid,uuid), public.assert_can_manage_payouts(uuid) to authenticated;
grant execute on function public.payment_destination(uuid), public.attach_checkout_session(uuid,text,text),
  public.record_payment_succeeded(uuid,text,text,int,text), public.record_payment_failed(uuid,text),
  public.register_connected_account(uuid,text), public.record_account_update(text,boolean,boolean), public.payout_account(uuid) to service_role;
