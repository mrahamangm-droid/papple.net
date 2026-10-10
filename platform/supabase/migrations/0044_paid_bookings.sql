-- 0044 paid bookings: a price per service, payment through Stripe Checkout after the professional confirms (within a window),
-- unpaid bookings released after the window, refunds on cancellation (professional: always; client: at least the cut-off before).
-- Booking payment ids are routed inside the database: record_payment_succeeded / record_payment_failed / record_refund_succeeded
-- delegate them to booking functions, so the webhook code is unchanged. Errcodes: 42501, 22023, 23505, 55000.
-- Undo: restore booking_request/decide/cancel/list/slots from 0043 and record_* from 0021/0017/0020; drop booking_payments,
-- booking_refunds and the functions below; drop the new bookings/services columns; delete the two bookings.* settings.

alter table public.services add column booking_price int check (booking_price between 1 and 10000000);
alter table public.bookings
  add column price int check (price between 1 and 10000000),
  add column currency text check (currency ~ '^[A-Z]{3}$'),
  add column commission_pro_bps int check (commission_pro_bps between 0 and 10000),
  add column commission_client_bps int check (commission_client_bps between 0 and 10000),
  add column confirmed_at timestamptz,
  add column pay_by timestamptz;
grant select (price, currency, pay_by, confirmed_at) on public.bookings to authenticated;

create table public.booking_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete restrict,
  amount int not null check (amount > 0),
  client_fee int not null check (client_fee >= 0),
  provider_fee int not null check (provider_fee >= 0),
  client_total int not null check (client_total > 0),
  application_fee int not null check (application_fee >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending','succeeded','failed','refund_pending','refunded')),
  checkout_session_id text,
  payment_intent_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.booking_refunds (
  id uuid primary key default gen_random_uuid(),
  booking_payment_id uuid not null unique references public.booking_payments (id) on delete restrict,
  amount int not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending','succeeded')),
  provider_refund_id text,
  idempotency_key text not null unique,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger booking_refunds_touch before update on public.booking_refunds for each row execute function public.touch_updated_at();

insert into public.platform_settings (key, value, description) values
  ('bookings.payment_window_hours', '24', 'Hours a client has to pay a confirmed paid booking (also never later than 1 hour before it starts)'),
  ('bookings.client_refund_cutoff_hours', '24', 'A client who cancels a paid booking at least this many hours before it starts gets a full refund')
on conflict (key) do nothing;

alter table public.booking_payments enable row level security;
alter table public.booking_refunds enable row level security;
revoke all on public.booking_payments, public.booking_refunds from public, anon, authenticated;
-- Stripe ids and failure reasons stay server-side
grant select (id, booking_id, amount, client_fee, provider_fee, client_total, application_fee, currency, status, paid_at, created_at) on public.booking_payments to authenticated;
grant select (id, booking_payment_id, amount, currency, status, created_at) on public.booking_refunds to authenticated;
create policy booking_payments_select on public.booking_payments for select to authenticated
  using (exists (select 1 from bookings b where b.id = booking_id and (public.is_member(b.provider_org_id) or public.is_member(b.client_org_id))));
create policy booking_refunds_select on public.booking_refunds for select to authenticated
  using (exists (select 1 from booking_payments p join bookings b on b.id = p.booking_id
                 where p.id = booking_payment_id and (public.is_member(b.provider_org_id) or public.is_member(b.client_org_id))));

-- A confirmed paid booking whose payment window passed without a payment. While a checkout session is open the time is held
-- one hour longer: the client may have paid before the deadline and Stripe's webhook can arrive late.
create function public.booking_is_lapsed(p_booking uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from bookings b where b.id = p_booking and b.status = 'confirmed' and b.price is not null
                  and b.pay_by <= now() - case when exists (select 1 from booking_payments p where p.booking_id = b.id and p.status = 'pending' and p.checkout_session_id is not null)
                                               then interval '1 hour' else interval '0' end
                  and not exists (select 1 from booking_payments p where p.booking_id = b.id and p.status in ('succeeded','refund_pending','refunded'))) $$;

-- Releases lapsed bookings involving an organization (lazy: there is no scheduler). Frees the slot for the exclusion constraint.
create function public.booking_release_lapsed(p_org uuid) returns void
language plpgsql security definer set search_path = public as
-- Candidates are locked first and re-checked in a new statement (new snapshot), so a payment the webhook committed while we
-- waited for the row lock is seen and the booking is kept.
$$ declare r record; v_client uuid;
begin
  for r in select b.id from bookings b
           where p_org in (b.provider_org_id, b.client_org_id) and b.status = 'confirmed' and b.price is not null and b.pay_by <= now()
           order by b.id for update loop
    update bookings b set status = 'cancelled', reason = 'Payment was not received in time', decided_at = now()
      where b.id = r.id and public.booking_is_lapsed(r.id)
      returning b.client_org_id into v_client;
    if found then
      insert into audit_log (org_id, action, entity, entity_id, after, outcome, request_id)
      values (v_client, 'booking.released', 'booking', r.id::text, '{}'::jsonb, 'success', gen_random_uuid()::text);
    end if;
  end loop;
end $$;

create function public.booking_queue_refund(p_payment uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare v_p booking_payments; v_org uuid;
begin
  select * into v_p from booking_payments where id = p_payment for update;
  insert into booking_refunds (booking_payment_id, amount, currency, idempotency_key)
  values (p_payment, v_p.client_total, v_p.currency, 'booking-refund-' || p_payment::text)
  on conflict (booking_payment_id) do nothing;
  update booking_payments set status = 'refund_pending' where id = p_payment and status = 'succeeded';
  select client_org_id into v_org from bookings where id = v_p.booking_id;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, after, outcome, request_id)
  values (auth.uid(), v_org, 'booking.refund_queued', 'booking', v_p.booking_id::text, jsonb_build_object('payment', p_payment, 'amount', v_p.client_total), 'success', gen_random_uuid()::text);
end $$;

create function public.service_set_booking_price(p_org uuid, p_service uuid, p_price int) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_price is not null and p_price not between 1 and 10000000 then raise exception 'invalid price' using errcode = '22023'; end if;
  -- as contracts' smallest milestone: the professional must receive something after Papple's minimum fee
  if p_price is not null and p_price <= public.setting_int('payments.min_application_fee_minor', 0) then
    raise exception 'price must be above the minimum fee' using errcode = '22023'; end if;
  if p_price is not null and not exists (select 1 from connected_accounts where org_id = p_org and payouts_enabled) then
    raise exception 'finish payout setup first' using errcode = '22023'; end if;
  update services set booking_price = p_price where id = p_service and org_id = p_org;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

-- What anyone may see before booking: the price of a listed, bookable service, or null when it is free or not offered.
create function public.booking_price_offer(p_service uuid) returns jsonb
language sql stable security definer set search_path = public as
$$ select jsonb_build_object('price', s.booking_price, 'currency', s.currency,
                             'refund_cutoff_hours', public.setting_int('bookings.client_refund_cutoff_hours', 24)) from services s
   join booking_settings b on b.org_id = s.org_id and b.enabled
   where s.id = p_service and s.booking_minutes is not null and s.booking_price is not null and public.booking_listed(p_service) $$;

-- Slots: as 0043, but a lapsed unpaid booking no longer holds its time.
create or replace function public.booking_slots(p_service uuid, p_from timestamptz, p_to timestamptz) returns setof timestamptz
language plpgsql stable security definer set search_path = public as
$$ declare v_svc services; v_set booking_settings; v_len interval; v_gap interval; v_lo timestamptz; v_hi timestamptz;
begin
  if auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '31 days' then raise exception 'invalid range' using errcode = '22023'; end if;
  select * into v_svc from services where id = p_service;
  if not found or v_svc.booking_minutes is null or not public.booking_listed(p_service) then raise exception 'not bookable' using errcode = '22023'; end if;
  select * into v_set from booking_settings where org_id = v_svc.org_id;
  if not found or not v_set.enabled then raise exception 'not bookable' using errcode = '22023'; end if;
  v_len := make_interval(mins => v_svc.booking_minutes);
  v_gap := make_interval(mins => v_set.buffer_minutes);
  v_lo := greatest(p_from, now() + make_interval(hours => v_set.min_notice_hours));
  v_hi := least(p_to, now() + make_interval(days => v_set.horizon_days));
  if v_hi <= v_lo then return; end if;
  return query
    with near as materialized (
      select b.starts_at, b.ends_at, b.blocked from bookings b
      where b.provider_org_id = v_svc.org_id and b.status in ('pending','confirmed')
        and b.blocked && tstzrange(v_lo - v_gap - interval '120 minutes', v_hi + v_len + v_gap)
        and not public.booking_is_lapsed(b.id))
    select c from public.booking_candidates(v_svc.org_id, v_svc.booking_minutes, v_lo, v_hi) c
    where not exists (
      select 1 from near b
      where tstzrange(b.starts_at, b.ends_at + v_gap) && tstzrange(c, c + v_len)
         or tstzrange(b.starts_at, b.ends_at) && tstzrange(c, c + v_len + v_gap)
         or b.blocked && tstzrange(c, c + v_len + v_gap))
    order by c;
end $$;

-- Request: as 0043, plus releasing lapsed bookings first and snapshotting the price and commission.
create or replace function public.booking_request(p_org uuid, p_service uuid, p_start timestamptz, p_note text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_svc services; v_set booking_settings; v_note text := btrim(coalesce(p_note, '')); v_cap int; v_id uuid; m record;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_svc from services where id = p_service;
  if not found or not public.booking_listed(p_service) then raise exception 'not bookable' using errcode = '22023'; end if;
  if v_svc.org_id = p_org or public.is_member(v_svc.org_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(v_note) > 1000 or p_start is null then raise exception 'invalid request' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('booking:' || v_svc.org_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('booking-cap:' || p_org::text, 0));
  perform public.booking_release_lapsed(v_svc.org_id);
  if not exists (select 1 from public.booking_slots(p_service, p_start, p_start + interval '1 minute') s where s = p_start) then
    if v_svc.booking_minutes is not null and exists (
         select 1 from bookings b where b.provider_org_id = v_svc.org_id and b.status in ('pending','confirmed')
           and b.blocked && tstzrange(p_start, p_start + make_interval(mins => v_svc.booking_minutes)))
       and exists (select 1 from public.booking_candidates(v_svc.org_id, v_svc.booking_minutes, p_start, p_start + interval '1 minute') c where c = p_start) then
      raise exception 'that time was just taken' using errcode = '23505'; end if;
    raise exception 'that time is not available' using errcode = '22023'; end if;
  v_cap := public.org_limit(p_org, 'limits.bookings_pending_per_day');
  if v_cap is not null and (select count(*) from bookings where client_org_id = p_org and created_at > now() - interval '24 hours') >= v_cap then
    raise exception 'daily booking limit reached' using errcode = '54000'; end if;
  select * into v_set from booking_settings where org_id = v_svc.org_id;
  begin
    insert into bookings (provider_org_id, client_org_id, service_id, booked_by, starts_at, ends_at, blocked, note,
                          price, currency, commission_pro_bps, commission_client_bps)
    values (v_svc.org_id, p_org, p_service, auth.uid(), p_start, p_start + make_interval(mins => v_svc.booking_minutes),
            tstzrange(p_start, p_start + make_interval(mins => v_svc.booking_minutes + v_set.buffer_minutes)), v_note,
            v_svc.booking_price, case when v_svc.booking_price is not null then v_svc.currency end,
            case when v_svc.booking_price is not null then public.setting_int('commission.professional_bps', 0) end,
            case when v_svc.booking_price is not null then public.setting_int('commission.client_bps', 0) end)
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

-- Decide: as 0043; confirming a paid booking needs payout setup and opens the payment window.
create or replace function public.booking_decide(p_org uuid, p_booking uuid, p_confirm boolean, p_meeting_url text, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_b bookings; v_url text := nullif(btrim(coalesce(p_meeting_url, '')), ''); v_reason text := btrim(coalesce(p_reason, '')); v_pay_by timestamptz; m record;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_b from bookings where id = p_booking for update;
  if not found or v_b.provider_org_id <> p_org then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_confirm is null or char_length(v_reason) > 500 or (v_url is not null and (v_url !~ '^https://[^\s]+$' or char_length(v_url) > 500)) then
    raise exception 'invalid decision' using errcode = '22023'; end if;
  if v_b.status <> 'pending' or v_b.starts_at <= now() then raise exception 'booking is not pending' using errcode = '55000'; end if;
  if p_confirm and v_b.price is not null then
    if not exists (select 1 from connected_accounts where org_id = p_org and payouts_enabled) then
      raise exception 'finish payout setup first' using errcode = '22023'; end if;
    v_pay_by := least(now() + make_interval(hours => public.setting_int('bookings.payment_window_hours', 24)), v_b.starts_at - interval '1 hour');
    -- Stripe sessions last at least 30 minutes; a shorter window would let a payment land after the deadline
    if v_pay_by < now() + interval '30 minutes' then raise exception 'too close to the start to be paid' using errcode = '22023'; end if;
  end if;
  update bookings set status = case when p_confirm then 'confirmed' else 'declined' end,
    meeting_url = case when p_confirm then v_url else null end, reason = case when p_confirm then '' else v_reason end,
    decided_by = auth.uid(), decided_at = now(),
    confirmed_at = case when p_confirm then now() end, pay_by = case when p_confirm then v_pay_by end
  where id = p_booking;
  perform public.booking_audit(p_org, case when p_confirm then 'booking.confirm' else 'booking.decline' end, p_booking, '{}'::jsonb);
  for m in select user_id from memberships where org_id = v_b.client_org_id loop
    perform public.notify(m.user_id, case when p_confirm then 'booking_confirmed' else 'booking_declined' end,
      jsonb_build_object('booking_id', p_booking, 'org_id', v_b.client_org_id));
  end loop;
end $$;

-- Pay: creates or refreshes the one payment row for a confirmed paid booking and returns what Checkout needs.
create function public.booking_pay(p_org uuid, p_booking uuid) returns jsonb
language plpgsql security definer set search_path = public as
$$ declare v_b bookings; v_p booking_payments; v_cf int; v_pf int; v_total int; v_fee int; v_prev text;
  v_min int := public.setting_int('payments.min_application_fee_minor', 0); v_title text;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_b from bookings where id = p_booking for update;
  if not found or v_b.client_org_id <> p_org then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_b.price is null then raise exception 'this booking is free' using errcode = '22023'; end if;
  if v_b.status <> 'confirmed' or v_b.pay_by is null or v_b.pay_by < now() + interval '30 minutes' then
    raise exception 'booking cannot be paid now' using errcode = '55000'; end if;
  if v_b.price <= v_min then raise exception 'price is not above the minimum fee' using errcode = '22023'; end if;
  select * into v_p from booking_payments where booking_id = p_booking for update;
  if found and v_p.status in ('succeeded','refund_pending','refunded') then raise exception 'booking is already paid' using errcode = '55000'; end if;
  v_prev := v_p.checkout_session_id;
  -- same rounding as applyBps in apps/web/src/lib/money.ts (half up), on the commission snapshotted at request
  v_cf := ((v_b.price::bigint * v_b.commission_client_bps + 5000) / 10000)::int;
  v_pf := ((v_b.price::bigint * v_b.commission_pro_bps + 5000) / 10000)::int;
  v_total := v_b.price + v_cf;
  v_fee := least(greatest(v_cf + v_pf, v_min), v_total);
  insert into booking_payments (booking_id, amount, client_fee, provider_fee, client_total, application_fee, currency)
  values (p_booking, v_b.price, v_cf, v_pf, v_total, v_fee, v_b.currency)
  on conflict (booking_id) do update set amount = excluded.amount, client_fee = excluded.client_fee, provider_fee = excluded.provider_fee,
    client_total = excluded.client_total, application_fee = excluded.application_fee, status = 'pending'
  returning * into v_p;
  select coalesce(s.title, 'Booking') into v_title from services s where s.id = v_b.service_id;
  perform public.booking_audit(p_org, 'booking.pay', p_booking, jsonb_build_object('payment', v_p.id, 'total', v_total));
  return jsonb_build_object('payment_id', v_p.id, 'amount', v_b.price, 'client_fee', v_cf, 'provider_fee', v_pf, 'client_total', v_total,
    'application_fee', v_fee, 'currency', v_b.currency, 'title', coalesce(v_title, 'Booking'), 'previous_session', v_prev, 'pay_by', v_b.pay_by);
end $$;

create function public.booking_payment_destination(p_payment uuid) returns text
language plpgsql security definer set search_path = public as
$$ declare v_acct text;
begin
  select ca.stripe_account_id into v_acct from booking_payments p
    join bookings b on b.id = p.booking_id
    join connected_accounts ca on ca.org_id = b.provider_org_id and ca.payouts_enabled
    where p.id = p_payment;
  if v_acct is null then raise exception 'no payout account' using errcode = '22023'; end if;
  return v_acct;
end $$;

-- Compare-and-set, as attach_checkout_session: only the caller that saw the current session attaches a new one.
create function public.booking_attach_checkout(p_payment uuid, p_session text, p_prev text) returns boolean
language plpgsql security definer set search_path = public as
$$ begin
  update booking_payments p set checkout_session_id = p_session, status = 'pending'
    where p.id = p_payment and p.status in ('pending','failed') and p.checkout_session_id is not distinct from p_prev
      and exists (select 1 from bookings b where b.id = p.booking_id and b.status = 'confirmed' and b.pay_by > now());
  return found;
end $$;

create function public.booking_payment_succeeded(p_payment uuid, p_session text, p_intent text, p_amount int, p_currency text) returns text
language plpgsql security definer set search_path = public as
$$ declare v_p booking_payments; v_b bookings; v_lapsed boolean; m record;
begin
  select * into v_p from booking_payments where id = p_payment;
  if not found then return 'unknown'; end if;
  select * into v_b from bookings where id = v_p.booking_id for update;
  select * into v_p from booking_payments where id = p_payment for update;
  if v_p.status in ('succeeded','refund_pending','refunded') then
    if v_p.payment_intent_id is not distinct from p_intent then return 'duplicate'; end if;
    insert into audit_log (action, entity, entity_id, after, outcome, request_id)
    values ('booking.duplicate_charge', 'booking_payment', p_payment::text,
            jsonb_build_object('payment_intent', p_intent, 'session', p_session, 'amount', p_amount, 'currency', p_currency), 'error', 'stripe-webhook');
    return 'duplicate_charge';
  end if;
  if p_amount is distinct from v_p.client_total or p_currency is distinct from v_p.currency then return 'mismatch'; end if;
  -- A booking still confirmed was paid in time: sessions are created only 30+ minutes before pay_by and never outlive it, and
  -- release waits for the row lock held here. Only a cancelled or released booking gives the money back.
  v_lapsed := v_b.status <> 'confirmed';
  update booking_payments set status = 'succeeded', payment_intent_id = p_intent, paid_at = now(),
    checkout_session_id = coalesce(p_session, checkout_session_id) where id = p_payment;
  insert into audit_log (org_id, action, entity, entity_id, after, outcome, request_id)
  values (v_b.client_org_id, 'booking.paid', 'booking', v_b.id::text, jsonb_build_object('payment', p_payment, 'amount', p_amount), 'success', 'stripe-webhook');
  if v_lapsed then
    -- the money is real: record it, release the booking and give it all back
    update bookings set status = 'cancelled', reason = 'Paid after the booking was released', decided_at = now()
      where id = v_b.id and status in ('pending','confirmed');
    perform public.booking_queue_refund(p_payment);
    return 'paid_on_cancelled';
  end if;
  for m in select user_id from memberships where org_id = v_b.provider_org_id loop
    perform public.notify(m.user_id, 'booking_paid', jsonb_build_object('booking_id', v_b.id, 'org_id', v_b.provider_org_id));
  end loop;
  return 'recorded';
end $$;

create function public.booking_payment_failed(p_payment uuid, p_session text) returns text
language plpgsql security definer set search_path = public as
$$ begin
  update booking_payments set status = 'failed' where id = p_payment and status = 'pending' and checkout_session_id is not distinct from p_session;
  return case when found then 'failed' else 'ignored' end;
end $$;

create function public.booking_refund_succeeded(p_payment uuid, p_refund text, p_amount int, p_currency text) returns text
language plpgsql security definer set search_path = public as
$$ declare v_p booking_payments; v_r booking_refunds; v_org uuid;
begin
  select * into v_p from booking_payments where id = p_payment for update;
  if not found then return 'unknown'; end if;
  select * into v_r from booking_refunds where booking_payment_id = p_payment for update;
  if not found then return 'unknown'; end if;
  if v_r.status = 'succeeded' then return 'duplicate'; end if;
  if p_amount is distinct from v_r.amount or p_currency is distinct from v_r.currency then
    insert into audit_log (action, entity, entity_id, after, outcome, request_id)
    values ('booking.refund_mismatch', 'booking_payment', p_payment::text, jsonb_build_object('refund', p_refund, 'amount', p_amount, 'currency', p_currency), 'error', 'stripe-webhook');
    return 'mismatch';
  end if;
  update booking_refunds set status = 'succeeded', provider_refund_id = p_refund, failure_reason = null where id = v_r.id;
  update booking_payments set status = 'refunded' where id = p_payment;
  select client_org_id into v_org from bookings where id = v_p.booking_id;
  insert into audit_log (org_id, action, entity, entity_id, after, outcome, request_id)
  values (v_org, 'booking.refunded', 'booking', v_p.booking_id::text, jsonb_build_object('payment', p_payment, 'amount', p_amount), 'success', 'stripe-webhook');
  return 'recorded';
end $$;

-- Cancel: as 0043, plus refunds for paid bookings. Returns 'refund_pending' when a refund was queued, else 'cancelled'.
drop function public.booking_cancel(uuid, uuid, text);
create function public.booking_cancel(p_org uuid, p_booking uuid, p_reason text) returns text
language plpgsql security definer set search_path = public as
$$ declare v_b bookings; v_reason text := btrim(coalesce(p_reason, '')); v_other uuid; v_p booking_payments; v_refund boolean := false; m record;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_b from bookings where id = p_booking for update;
  if not found or p_org not in (v_b.provider_org_id, v_b.client_org_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(v_reason) not between 1 and 500 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if v_b.status not in ('pending','confirmed') or v_b.starts_at <= now() then raise exception 'booking cannot be cancelled' using errcode = '55000'; end if;
  update bookings set status = 'cancelled', reason = v_reason, cancelled_by_org = p_org, decided_by = auth.uid(), decided_at = now() where id = p_booking;
  select * into v_p from booking_payments where booking_id = p_booking for update;
  if found and v_p.status = 'succeeded'
     and (p_org = v_b.provider_org_id
          or v_b.starts_at - now() >= make_interval(hours => public.setting_int('bookings.client_refund_cutoff_hours', 24))) then
    perform public.booking_queue_refund(v_p.id);
    v_refund := true;
  end if;
  perform public.booking_audit(p_org, 'booking.cancel', p_booking, jsonb_build_object('refund', v_refund));
  v_other := case when p_org = v_b.provider_org_id then v_b.client_org_id else v_b.provider_org_id end;
  for m in select user_id from memberships where org_id = v_other loop
    perform public.notify(m.user_id, 'booking_cancelled', jsonb_build_object('booking_id', p_booking, 'org_id', v_other));
  end loop;
  return case when v_refund then 'refund_pending' else 'cancelled' end;
end $$;

create function public.booking_open_session(p_booking uuid) returns text
language sql stable security definer set search_path = public as
$$ select checkout_session_id from booking_payments where booking_id = p_booking and status = 'pending' and checkout_session_id is not null $$;

create function public.booking_of_payment(p_payment uuid) returns uuid
language sql stable security definer set search_path = public as
$$ select booking_id from booking_payments where id = p_payment $$;

create function public.booking_refund_to_send(p_booking uuid) returns table (payment_id uuid, payment_intent_id text, amount int, currency text, idempotency_key text)
language sql stable security definer set search_path = public as
$$ select p.id, p.payment_intent_id, r.amount, r.currency, r.idempotency_key
   from booking_payments p join booking_refunds r on r.booking_payment_id = p.id
   where p.booking_id = p_booking and r.status = 'pending' and p.payment_intent_id is not null $$;

-- For the "Retry refund" button: may this member of p_org ask the server to (re)send this booking's queued refund?
create function public.booking_refund_pending(p_org uuid, p_booking uuid) returns boolean
language plpgsql stable security definer set search_path = public as
$$ begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member'])
     or not exists (select 1 from bookings where id = p_booking and p_org in (provider_org_id, client_org_id)) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  return exists (select 1 from booking_payments p join booking_refunds r on r.booking_payment_id = p.id where p.booking_id = p_booking and r.status = 'pending');
end $$;

create function public.booking_record_refund_failed(p_payment uuid, p_reason text) returns void
language sql security definer set search_path = public as
$$ update booking_refunds set failure_reason = left(coalesce(p_reason, 'unknown error'), 500) where booking_payment_id = p_payment and status = 'pending' $$;

-- List: as 0043 plus price and payment state; also releases lapsed bookings of this organization first.
drop function public.booking_list(uuid);
create function public.booking_list(p_org uuid) returns table (
  id uuid, side text, service_title text, other_org_name text, starts_at timestamptz, ends_at timestamptz,
  status text, note text, meeting_url text, reason text, cancelled_by_org uuid, created_at timestamptz,
  price int, currency text, client_total int, pay_by timestamptz, payment_status text, refund_status text)
language plpgsql security definer set search_path = public as
$$ begin
  if auth.uid() is null or not public.is_member(p_org) then raise exception 'not allowed' using errcode = '42501'; end if;
  perform public.booking_release_lapsed(p_org);
  return query
    select b.id, case when b.provider_org_id = p_org then 'provider' else 'client' end, coalesce(s.title, 'Service'),
           o.name, b.starts_at, b.ends_at, b.status, b.note, b.meeting_url, b.reason, b.cancelled_by_org, b.created_at,
           b.price, b.currency,
           coalesce(p.client_total, case when b.price is not null then b.price + ((b.price::bigint * b.commission_client_bps + 5000) / 10000)::int end),
           b.pay_by, p.status, r.status
    from bookings b
    left join services s on s.id = b.service_id
    join organizations o on o.id = case when b.provider_org_id = p_org then b.client_org_id else b.provider_org_id end
    left join booking_payments p on p.booking_id = b.id
    left join booking_refunds r on r.booking_payment_id = p.id
    where p_org in (b.provider_org_id, b.client_org_id)
    order by b.starts_at desc
    limit 500;
end $$;

-- Webhook entry points: booking payment ids are delegated first; the rest of each body is unchanged (0021, 0017, 0020).
create or replace function public.record_payment_succeeded(p_payment uuid, p_session text, p_intent text, p_amount int, p_currency text) returns text
language plpgsql security definer set search_path = public as
$$ declare v_mid uuid; v_m milestones%rowtype; v_c contracts%rowtype; v_p payments%rowtype;
begin
  if exists (select 1 from booking_payments where id = p_payment) then
    return public.booking_payment_succeeded(p_payment, p_session, p_intent, p_amount, p_currency);
  end if;
  select milestone_id into v_mid from payments where id = p_payment;
  if v_mid is null then return 'unknown'; end if;
  select * into v_m from milestones where id = v_mid for update;
  select * into v_c from contracts where id = v_m.contract_id for update;
  select * into v_p from payments where id = p_payment for update;
  if v_p.status in ('succeeded','refund_pending','refunded') then
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
  if v_c.status = 'cancelled' then
    insert into audit_log (action, entity, entity_id, after, outcome, request_id)
    values ('payment.on_cancelled_contract', 'payment', p_payment::text,
            jsonb_build_object('payment_intent', p_intent, 'session', p_session, 'amount', p_amount, 'currency', p_currency, 'contract_id', v_c.id),
            'error', 'stripe-webhook');
    return 'paid_on_cancelled';
  end if;
  perform public.notify_org(v_c.provider_org_id, 'payment_received',
    jsonb_build_object('contract_id', v_c.id, 'milestone_id', v_mid));
  if v_c.status = 'active' and not exists (select 1 from milestones where contract_id = v_c.id and status <> 'paid') then
    update contracts set status = 'completed' where id = v_c.id;
    perform public.notify_org(v_c.provider_org_id, 'contract_completed', jsonb_build_object('contract_id', v_c.id));
    perform public.notify_org(v_c.client_org_id, 'contract_completed', jsonb_build_object('contract_id', v_c.id));
  end if;
  return 'recorded';
end $$;

create or replace function public.record_payment_failed(p_payment uuid, p_session text) returns text
language plpgsql security definer set search_path = public as
$$ begin
  if exists (select 1 from booking_payments where id = p_payment) then return public.booking_payment_failed(p_payment, p_session); end if;
  update payments set status = 'failed' where id = p_payment and status = 'pending' and checkout_session_id is not distinct from p_session;
  return case when found then 'failed' else 'ignored' end;
end $$;

create or replace function public.record_refund_succeeded(p_payment uuid, p_refund text, p_amount int, p_currency text) returns text
language plpgsql security definer set search_path = public as
$$ declare v_mid uuid; v_cid uuid; v_r refunds%rowtype;
begin
  if exists (select 1 from booking_payments where id = p_payment) then
    return public.booking_refund_succeeded(p_payment, p_refund, p_amount, p_currency);
  end if;
  select milestone_id, contract_id into v_mid, v_cid from payments where id = p_payment;
  if v_mid is null then return 'unknown'; end if;
  perform 1 from milestones where id = v_mid for update;
  perform 1 from contracts where id = v_cid for update;
  perform 1 from payments where id = p_payment for update;
  select * into v_r from refunds where payment_id = p_payment for update;
  if not found then return 'unknown'; end if;
  if v_r.status = 'succeeded' then return 'duplicate'; end if;
  if p_amount is distinct from v_r.amount or p_currency is distinct from v_r.currency then
    insert into audit_log (action, entity, entity_id, after, outcome, request_id)
    values ('refund.mismatch', 'payment', p_payment::text,
            jsonb_build_object('refund', p_refund, 'amount', p_amount, 'currency', p_currency), 'error', 'stripe-webhook');
    return 'mismatch';
  end if;
  update refunds set status = 'succeeded', provider_refund_id = p_refund, failure_reason = null where id = v_r.id;
  update payments set status = 'refunded' where id = p_payment;
  return 'recorded';
end $$;

revoke execute on function public.booking_is_lapsed(uuid), public.booking_release_lapsed(uuid), public.booking_queue_refund(uuid),
  public.booking_payment_succeeded(uuid, text, text, int, text), public.booking_payment_failed(uuid, text),
  public.booking_refund_succeeded(uuid, text, int, text), public.booking_payment_destination(uuid),
  public.booking_attach_checkout(uuid, text, text), public.booking_refund_to_send(uuid), public.booking_record_refund_failed(uuid, text),
  public.booking_open_session(uuid), public.booking_of_payment(uuid)
  from public, anon, authenticated;
grant execute on function public.booking_payment_destination(uuid), public.booking_attach_checkout(uuid, text, text),
  public.booking_refund_to_send(uuid), public.booking_record_refund_failed(uuid, text), public.booking_open_session(uuid), public.booking_of_payment(uuid) to service_role;
revoke execute on function public.service_set_booking_price(uuid, uuid, int), public.booking_pay(uuid, uuid), public.booking_cancel(uuid, uuid, text),
  public.booking_list(uuid), public.booking_price_offer(uuid), public.booking_refund_pending(uuid, uuid) from public, anon;
grant execute on function public.service_set_booking_price(uuid, uuid, int), public.booking_pay(uuid, uuid), public.booking_cancel(uuid, uuid, text),
  public.booking_list(uuid), public.booking_price_offer(uuid), public.booking_refund_pending(uuid, uuid) to authenticated;
grant execute on function public.booking_price_offer(uuid) to anon;
