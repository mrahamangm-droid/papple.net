begin;
select plan(75);

insert into auth.users (id, email) values
 ('aaaaaa44-0000-0000-0000-0000000000a1','p@x.test'),('aaaaaa44-0000-0000-0000-0000000000a2','pm@x.test'),('aaaaaa44-0000-0000-0000-0000000000a3','c@x.test'),('aaaaaa44-0000-0000-0000-0000000000a4','cm@x.test'),('aaaaaa44-0000-0000-0000-0000000000a5','cv@x.test'),('aaaaaa44-0000-0000-0000-0000000000a6','d@x.test'),('aaaaaa44-0000-0000-0000-0000000000a7','e@x.test');
insert into organizations (id, type, name) values ('cccccc44-0000-0000-0000-0000000000b1','agency','Provider'),('cccccc44-0000-0000-0000-0000000000c1','client_company','Client'),('cccccc44-0000-0000-0000-0000000000d1','client_company','Other client'),('cccccc44-0000-0000-0000-0000000000e1','client_company','Third client');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa44-0000-0000-0000-0000000000a1','cccccc44-0000-0000-0000-0000000000b1','owner'),('aaaaaa44-0000-0000-0000-0000000000a2','cccccc44-0000-0000-0000-0000000000b1','member'),('aaaaaa44-0000-0000-0000-0000000000a3','cccccc44-0000-0000-0000-0000000000c1','owner'),('aaaaaa44-0000-0000-0000-0000000000a4','cccccc44-0000-0000-0000-0000000000c1','member'),('aaaaaa44-0000-0000-0000-0000000000a5','cccccc44-0000-0000-0000-0000000000c1','viewer'),('aaaaaa44-0000-0000-0000-0000000000a6','cccccc44-0000-0000-0000-0000000000d1','owner'),('aaaaaa44-0000-0000-0000-0000000000a7','cccccc44-0000-0000-0000-0000000000e1','owner');
insert into provider_profiles (org_id, slug, headline) values ('cccccc44-0000-0000-0000-0000000000b1','provider-44','Provider headline');
insert into connected_accounts (org_id, stripe_account_id, payouts_enabled) values ('cccccc44-0000-0000-0000-0000000000b1','acct_test_44',true);
insert into services (id, org_id, slug, title, status, currency, booking_minutes) values ('dddddd44-0000-0000-0000-000000000001','cccccc44-0000-0000-0000-0000000000b1','consult-44','Consultation','published','USD',60);
insert into booking_settings (org_id, enabled, timezone, buffer_minutes, min_notice_hours, horizon_days) values ('cccccc44-0000-0000-0000-0000000000b1', true, 'UTC', 0, 0, 90);
insert into booking_hours (org_id, weekday, start_time, end_time) select 'cccccc44-0000-0000-0000-0000000000b1', g, '09:00', '17:00' from generate_series(1,7) g;
insert into platform_settings (key, value, description) values
  ('commission.professional_bps','500','t'),('commission.client_bps','200','t'),('payments.min_application_fee_minor','0','t')
on conflict (key) do update set value = excluded.value;
select set_config('t.mon', (date_trunc('week', now() at time zone 'UTC')::date + 35)::text, false);
create function pg_temp.at(t text) returns timestamptz language sql as $$ select (current_setting('t.mon')::date + t::time) at time zone 'UTC' $$;
grant execute on function pg_temp.at(text) to authenticated;

set local role authenticated;

-- 1. price
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a2',true);
select throws_ok($$select service_set_booking_price('cccccc44-0000-0000-0000-0000000000b1','dddddd44-0000-0000-0000-000000000001',10000)$$, '42501', null, 'a provider member cannot set the price');
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a1',true);
select throws_ok($$select service_set_booking_price('cccccc44-0000-0000-0000-0000000000b1','dddddd44-0000-0000-0000-000000000001',0)$$, '22023', null, 'a price of zero is refused');
reset role; update connected_accounts set payouts_enabled = false where org_id = 'cccccc44-0000-0000-0000-0000000000b1'; set local role authenticated;
select throws_ok($$select service_set_booking_price('cccccc44-0000-0000-0000-0000000000b1','dddddd44-0000-0000-0000-000000000001',10000)$$, '22023', null, 'charging needs finished payout setup');
reset role; update connected_accounts set payouts_enabled = true where org_id = 'cccccc44-0000-0000-0000-0000000000b1';
update platform_settings set value = '10000' where key = 'payments.min_application_fee_minor'; set local role authenticated;
select throws_ok($$select service_set_booking_price('cccccc44-0000-0000-0000-0000000000b1','dddddd44-0000-0000-0000-000000000001',10000)$$, '22023', null, 'a price must be above the minimum Papple fee');
reset role; update platform_settings set value = '0' where key = 'payments.min_application_fee_minor'; set local role authenticated;
select lives_ok($$select service_set_booking_price('cccccc44-0000-0000-0000-0000000000b1','dddddd44-0000-0000-0000-000000000001',10000)$$, 'the owner sets a price of 100.00');
reset role; set local role anon;
select is(booking_price_offer('dddddd44-0000-0000-0000-000000000001'), '{"price": 10000, "currency": "USD", "refund_cutoff_hours": 24}'::jsonb, 'anyone can see the price of a listed service');
reset role; set local role authenticated;

-- 2. request snapshots the price
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a4',true);
select lives_ok($$select set_config('t.b1', booking_request('cccccc44-0000-0000-0000-0000000000c1','dddddd44-0000-0000-0000-000000000001', pg_temp.at('10:00'), '')::text, false)$$, 'a client requests a priced slot');
reset role;
select is((select price || ' ' || currency || ' ' || commission_pro_bps || ' ' || commission_client_bps from bookings where id = current_setting('t.b1')::uuid), '10000 USD 500 200', 'the price and commission are snapshotted');
update platform_settings set value = '900' where key = 'commission.client_bps';
set local role authenticated;

-- 3. paying before confirmation, confirming
select throws_ok($$select booking_pay('cccccc44-0000-0000-0000-0000000000c1', current_setting('t.b1')::uuid)$$, '55000', null, 'a booking cannot be paid before it is confirmed');
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a1',true);
reset role; update connected_accounts set payouts_enabled = false where org_id = 'cccccc44-0000-0000-0000-0000000000b1'; set local role authenticated;
select throws_ok($$select booking_decide('cccccc44-0000-0000-0000-0000000000b1', current_setting('t.b1')::uuid, true, '', '')$$, '22023', null, 'confirming a priced booking needs payout setup');
reset role; update connected_accounts set payouts_enabled = true where org_id = 'cccccc44-0000-0000-0000-0000000000b1'; set local role authenticated;
select lives_ok($$select booking_decide('cccccc44-0000-0000-0000-0000000000b1', current_setting('t.b1')::uuid, true, '', '')$$, 'the owner confirms');
reset role;
select ok((select pay_by between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute' from bookings where id = current_setting('t.b1')::uuid), 'the client has 24 hours to pay');
set local role authenticated;

-- 4. paying
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a2',true);
select throws_ok($$select booking_pay('cccccc44-0000-0000-0000-0000000000b1', current_setting('t.b1')::uuid)$$, '42501', null, 'the provider cannot pay its own booking');
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a5',true);
select throws_ok($$select booking_pay('cccccc44-0000-0000-0000-0000000000c1', current_setting('t.b1')::uuid)$$, '42501', null, 'a viewer cannot pay');
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a4',true);
select is((select booking_pay('cccccc44-0000-0000-0000-0000000000c1', current_setting('t.b1')::uuid) - 'payment_id' - 'title' - 'pay_by'),
  '{"amount": 10000, "currency": "USD", "client_fee": 200, "client_total": 10200, "provider_fee": 500, "application_fee": 700, "previous_session": null}'::jsonb,
  'the snapshotted commission is charged, not today''s setting');
reset role; update platform_settings set value = '1000' where key = 'payments.min_application_fee_minor'; set local role authenticated;
select is((select (booking_pay('cccccc44-0000-0000-0000-0000000000c1', current_setting('t.b1')::uuid)->>'application_fee')::int), 1000, 'the minimum application fee applies');
reset role; update platform_settings set value = '0' where key = 'payments.min_application_fee_minor';
select is((select count(*)::int from booking_payments where booking_id = current_setting('t.b1')::uuid), 1, 'one payment row per booking');
select set_config('t.p1', (select id::text from booking_payments where booking_id = current_setting('t.b1')::uuid), false);
set local role service_role;
select is(booking_attach_checkout(current_setting('t.p1')::uuid, 'cs_1', null), true, 'the first checkout session attaches');
select is(booking_attach_checkout(current_setting('t.p1')::uuid, 'cs_2', null), false, 'a concurrent second session loses');
select is(booking_payment_destination(current_setting('t.p1')::uuid), 'acct_test_44', 'the money goes to the professional''s account');
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a4',true);
select is((select booking_pay('cccccc44-0000-0000-0000-0000000000c1', current_setting('t.b1')::uuid)->>'previous_session'), 'cs_1', 'paying again reports the open session so it can be expired');

-- 5. webhook
reset role; set local role service_role;
select is(record_payment_failed(current_setting('t.p1')::uuid, 'cs_other'), 'ignored', 'a stale session cannot fail the payment');
select is(record_payment_succeeded(current_setting('t.p1')::uuid, 'cs_1', 'pi_1', 10201, 'USD'), 'mismatch', 'a wrong amount is not accepted');
select is((select status from booking_payments where id = current_setting('t.p1')::uuid), 'pending', 'and the booking stays unpaid');
select is(record_payment_succeeded(current_setting('t.p1')::uuid, 'cs_1', 'pi_1', 10200, 'USD'), 'recorded', 'the matching webhook records the payment');
select is((select status from booking_payments where id = current_setting('t.p1')::uuid), 'succeeded', 'the booking is paid');
select is(record_payment_succeeded(current_setting('t.p1')::uuid, 'cs_1', 'pi_1', 10200, 'USD'), 'duplicate', 'a replay is a duplicate');
select is(record_payment_succeeded(current_setting('t.p1')::uuid, 'cs_9', 'pi_9', 10200, 'USD'), 'duplicate_charge', 'a second charge is flagged');
select is(record_payment_succeeded('00000000-0000-0000-0000-000000000000', 'cs', 'pi', 1, 'USD'), 'unknown', 'an unknown payment is still unknown');
reset role;
select is((select count(*)::int from notifications where type = 'booking_paid' and user_id in ('aaaaaa44-0000-0000-0000-0000000000a1','aaaaaa44-0000-0000-0000-0000000000a2')), 2, 'the professional is told it was paid');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a4',true);
select throws_ok($$select booking_pay('cccccc44-0000-0000-0000-0000000000c1', current_setting('t.b1')::uuid)$$, '55000', null, 'a paid booking cannot be paid again');

-- 6. the client cancels well before the start: full refund
select is(booking_cancel('cccccc44-0000-0000-0000-0000000000c1', current_setting('t.b1')::uuid, 'Plans changed'), 'refund_pending', 'cancelling early queues a full refund');
reset role;
select is((select amount || ' ' || status from booking_refunds where booking_payment_id = current_setting('t.p1')::uuid), '10200 pending', 'the refund is the full amount paid');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a1',true);
select is(booking_refund_pending('cccccc44-0000-0000-0000-0000000000b1', current_setting('t.b1')::uuid), true, 'the provider may retry sending the queued refund');
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a5',true);
select throws_ok($$select booking_refund_pending('cccccc44-0000-0000-0000-0000000000c1', current_setting('t.b1')::uuid)$$, '42501', null, 'a viewer cannot trigger a refund');
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a7',true);
select throws_ok($$select booking_refund_pending('cccccc44-0000-0000-0000-0000000000e1', current_setting('t.b1')::uuid)$$, '42501', null, 'a third organization cannot trigger a refund');
reset role;
set local role service_role;
select is((select payment_intent_id || ' ' || amount || ' ' || idempotency_key from booking_refund_to_send(current_setting('t.b1')::uuid)),
  'pi_1 10200 booking-refund-' || current_setting('t.p1'), 'the server gets the charge to refund and a fixed idempotency key');
select is(record_refund_succeeded(current_setting('t.p1')::uuid, 're_1', 10199, 'USD'), 'mismatch', 'a refund for the wrong amount is not accepted');
select is(record_refund_succeeded(current_setting('t.p1')::uuid, 're_1', 10200, 'USD'), 'recorded', 'the refund webhook finalizes it');
select is((select status from booking_payments where id = current_setting('t.p1')::uuid), 'refunded', 'the payment is refunded');
select is(record_refund_succeeded(current_setting('t.p1')::uuid, 're_1', 10200, 'USD'), 'duplicate', 'a replayed refund is a duplicate');

-- 7. the cut-off: exactly 24 hours before is still refunded, inside it is not, the provider always refunds
reset role;
create function pg_temp.paid_booking(p_start timestamptz, p_client uuid) returns uuid language plpgsql as $f$
declare v_b uuid; v_p uuid;
begin
  insert into bookings (provider_org_id, client_org_id, service_id, starts_at, ends_at, blocked, status, price, currency, commission_pro_bps, commission_client_bps, confirmed_at, pay_by)
  values ('cccccc44-0000-0000-0000-0000000000b1', p_client, 'dddddd44-0000-0000-0000-000000000001', p_start, p_start + interval '1 hour', tstzrange(p_start, p_start + interval '1 minute'), 'confirmed', 10000, 'USD', 500, 200, now(), now() + interval '1 hour')
  returning id into v_b;
  insert into booking_payments (booking_id, amount, client_fee, provider_fee, client_total, application_fee, currency, status, checkout_session_id, payment_intent_id, paid_at)
  values (v_b, 10000, 200, 500, 10200, 700, 'USD', 'succeeded', 'cs_' || v_b, 'pi_' || v_b, now()) returning id into v_p;
  return v_b;
end $f$;
select set_config('t.edge', pg_temp.paid_booking(now() + interval '24 hours', 'cccccc44-0000-0000-0000-0000000000c1')::text, false);
select set_config('t.late', pg_temp.paid_booking(now() + interval '23 hours 59 minutes', 'cccccc44-0000-0000-0000-0000000000c1')::text, false);
select set_config('t.prov', pg_temp.paid_booking(now() + interval '2 hours', 'cccccc44-0000-0000-0000-0000000000c1')::text, false);
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a3',true);
select is(booking_cancel('cccccc44-0000-0000-0000-0000000000c1', current_setting('t.edge')::uuid, 'edge'), 'refund_pending', 'cancelling exactly at the cut-off is refunded');
select is(booking_cancel('cccccc44-0000-0000-0000-0000000000c1', current_setting('t.late')::uuid, 'late'), 'cancelled', 'cancelling inside the cut-off is not refunded');
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a1',true);
select is(booking_cancel('cccccc44-0000-0000-0000-0000000000b1', current_setting('t.prov')::uuid, 'sick'), 'refund_pending', 'the professional cancelling always refunds');
reset role;
select is((select count(*)::int from booking_refunds r join booking_payments p on p.id = r.booking_payment_id where p.booking_id = current_setting('t.late')::uuid), 0, 'no refund row for the late cancellation');
set local role authenticated;

-- 7b. Stripe sessions last at least 30 minutes, so confirming and paying need that much time left
reset role;
select set_config('t.near', pg_temp.paid_booking(now() + interval '5 days', 'cccccc44-0000-0000-0000-0000000000c1')::text, false);
delete from booking_payments where booking_id = current_setting('t.near')::uuid;
update bookings set pay_by = now() + interval '20 minutes' where id = current_setting('t.near')::uuid;
insert into bookings (provider_org_id, client_org_id, service_id, starts_at, ends_at, blocked, status, price, currency, commission_pro_bps, commission_client_bps)
values ('cccccc44-0000-0000-0000-0000000000b1','cccccc44-0000-0000-0000-0000000000c1','dddddd44-0000-0000-0000-000000000001', now() + interval '80 minutes', now() + interval '140 minutes',
        tstzrange(now() + interval '80 minutes', now() + interval '81 minutes'), 'pending', 10000, 'USD', 500, 200) returning id \gset soon_
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a4',true);
select throws_ok($$select booking_pay('cccccc44-0000-0000-0000-0000000000c1', current_setting('t.near')::uuid)$$, '55000', null, 'less than 30 minutes before the payment deadline is too late to start paying');
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a1',true);
select throws_ok(format($$select booking_decide('cccccc44-0000-0000-0000-0000000000b1', %L, true, '', '')$$, :'soon_id'), '22023', null, 'a paid booking that would leave under 30 minutes to pay cannot be confirmed');

-- 8. an unpaid booking cancels without money
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a6',true);
select lives_ok($$select set_config('t.b2', booking_request('cccccc44-0000-0000-0000-0000000000d1','dddddd44-0000-0000-0000-000000000001', pg_temp.at('12:00'), '')::text, false)$$, 'another request');
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a1',true);
select lives_ok($$select booking_decide('cccccc44-0000-0000-0000-0000000000b1', current_setting('t.b2')::uuid, true, '', '')$$, 'confirmed');
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a6',true);
select is(booking_cancel('cccccc44-0000-0000-0000-0000000000d1', current_setting('t.b2')::uuid, 'no longer needed'), 'cancelled', 'an unpaid booking cancels without a refund');

-- 9. unpaid past pay_by: the slot is free and is released on the next request
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a6',true);
select lives_ok($$select set_config('t.b3', booking_request('cccccc44-0000-0000-0000-0000000000d1','dddddd44-0000-0000-0000-000000000001', pg_temp.at('14:00'), '')::text, false)$$, 'a request for 14:00');
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a1',true);
select lives_ok($$select booking_decide('cccccc44-0000-0000-0000-0000000000b1', current_setting('t.b3')::uuid, true, '', '')$$, 'confirmed');
reset role; update bookings set pay_by = now() - interval '1 minute' where id = current_setting('t.b3')::uuid; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a7',true);
select ok((select pg_temp.at('14:00') in (select booking_slots('dddddd44-0000-0000-0000-000000000001', pg_temp.at('00:00'), pg_temp.at('23:59')))), 'an unpaid booking past its payment deadline frees the slot');
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a6',true);
select throws_ok($$select booking_pay('cccccc44-0000-0000-0000-0000000000d1', current_setting('t.b3')::uuid)$$, '55000', null, 'it can no longer be paid');
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a7',true);
select lives_ok($$select booking_request('cccccc44-0000-0000-0000-0000000000e1','dddddd44-0000-0000-0000-000000000001', pg_temp.at('14:00'), '')$$, 'another client can book the released time');
reset role;
select is((select status || ' / ' || reason from bookings where id = current_setting('t.b3')::uuid), 'cancelled / Payment was not received in time', 'the unpaid booking was released');

-- 9b. an open checkout holds the time for an hour after the deadline, and a late webhook for a booking still confirmed counts
select set_config('t.b5', pg_temp.paid_booking(now() + interval '4 days', 'cccccc44-0000-0000-0000-0000000000c1')::text, false);
update booking_payments set status = 'pending', payment_intent_id = null, paid_at = null where booking_id = current_setting('t.b5')::uuid;
update bookings set pay_by = now() - interval '10 minutes' where id = current_setting('t.b5')::uuid;
select ok(not booking_is_lapsed(current_setting('t.b5')::uuid), 'a booking with an open checkout is not lapsed within the grace hour');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a3',true);
select is((select status from booking_list('cccccc44-0000-0000-0000-0000000000c1') where id = current_setting('t.b5')::uuid), 'confirmed', 'listing does not release it');
reset role; set local role service_role;
select is(record_payment_succeeded((select id from booking_payments where booking_id = current_setting('t.b5')::uuid), 'cs_' || current_setting('t.b5'), 'pi_b5', 10200, 'USD'), 'recorded', 'a webhook arriving after the deadline for a booking still held is recorded as paid');
reset role;

-- 10. money arriving after the booking was cancelled is refunded automatically
select set_config('t.b4', pg_temp.paid_booking(now() + interval '3 days', 'cccccc44-0000-0000-0000-0000000000c1')::text, false);
update booking_payments set status = 'pending', payment_intent_id = null, paid_at = null where booking_id = current_setting('t.b4')::uuid;
update bookings set status = 'cancelled', reason = 'Plans changed' where id = current_setting('t.b4')::uuid;
select set_config('t.p4', (select id::text from booking_payments where booking_id = current_setting('t.b4')::uuid), false);
set local role service_role;
select is(booking_attach_checkout(current_setting('t.p4')::uuid, 'cs_new', 'cs_' || current_setting('t.b4')), false, 'no new checkout attaches to a cancelled booking');
select is(booking_open_session(current_setting('t.b4')::uuid), 'cs_' || current_setting('t.b4'), 'the server finds the open session to expire');
select is(booking_of_payment(current_setting('t.p4')::uuid), current_setting('t.b4')::uuid, 'and maps a payment back to its booking');
select is(record_payment_succeeded(current_setting('t.p4')::uuid, 'cs_' || current_setting('t.b4'), 'pi_late', 10200, 'USD'), 'paid_on_cancelled', 'a payment after release is flagged');
reset role;
select is((select b.status || ' / ' || p.status || ' / ' || r.status from bookings b join booking_payments p on p.booking_id = b.id join booking_refunds r on r.booking_payment_id = p.id where b.id = current_setting('t.b4')::uuid),
  'cancelled / refund_pending / pending', 'it is recorded, the booking stays cancelled and a full refund is queued');

-- 11. privacy and direct writes
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a1',true);
select throws_ok($$select checkout_session_id from booking_payments limit 1$$, '42501', null, 'checkout session ids are not readable');
select throws_ok($$select payment_intent_id from booking_payments limit 1$$, '42501', null, 'payment intent ids are not readable');
select ok((select count(*) from booking_payments) > 0, 'the professional sees its booking payments');
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a7',true);
select is((select count(*)::int from booking_payments), 0, 'another organization sees none');
select throws_ok($$insert into booking_payments (booking_id, amount, client_fee, provider_fee, client_total, application_fee, currency) values (current_setting('t.b1')::uuid, 1, 0, 0, 1, 0, 'USD')$$, '42501', null, 'payments cannot be written directly');
select throws_ok($$update booking_refunds set status = 'succeeded'$$, '42501', null, 'refunds cannot be written directly');
select throws_ok($$select booking_attach_checkout(current_setting('t.p1')::uuid, 'x', null)$$, '42501', null, 'only the server attaches checkout sessions');

-- 12. booking_list carries the payment state
select set_config('request.jwt.claim.sub','aaaaaa44-0000-0000-0000-0000000000a3',true);
select is((select price || ' / ' || client_total || ' / ' || payment_status || ' / ' || refund_status from booking_list('cccccc44-0000-0000-0000-0000000000c1') where id = current_setting('t.b1')::uuid), '10000 / 10200 / refunded / succeeded', 'the list shows price, what the client pays, payment and refund state');

-- 13. audit
reset role;
select is((select count(distinct action)::int from audit_log where action in ('booking.pay','booking.paid','booking.refund_queued','booking.refunded','booking.released')), 5, 'every money change is audited');

select * from finish();
rollback;
