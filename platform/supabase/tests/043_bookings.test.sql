begin;
select plan(71);

insert into auth.users (id, email) values
 ('aaaaaa43-0000-0000-0000-0000000000a1','p@x.test'),('aaaaaa43-0000-0000-0000-0000000000a2','pa@x.test'),('aaaaaa43-0000-0000-0000-0000000000a3','pm@x.test'),('aaaaaa43-0000-0000-0000-0000000000a4','c@x.test'),('aaaaaa43-0000-0000-0000-0000000000a5','cm@x.test'),('aaaaaa43-0000-0000-0000-0000000000a6','cv@x.test'),('aaaaaa43-0000-0000-0000-0000000000a7','d@x.test'),('aaaaaa43-0000-0000-0000-0000000000a8','s@x.test');
insert into organizations (id, type, name) values ('cccccc43-0000-0000-0000-0000000000b1','agency','Provider'),('cccccc43-0000-0000-0000-0000000000c1','client_company','Client'),('cccccc43-0000-0000-0000-0000000000d1','client_company','Other client');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa43-0000-0000-0000-0000000000a1','cccccc43-0000-0000-0000-0000000000b1','owner'),('aaaaaa43-0000-0000-0000-0000000000a2','cccccc43-0000-0000-0000-0000000000b1','admin'),('aaaaaa43-0000-0000-0000-0000000000a3','cccccc43-0000-0000-0000-0000000000b1','member'),('aaaaaa43-0000-0000-0000-0000000000a4','cccccc43-0000-0000-0000-0000000000c1','owner'),('aaaaaa43-0000-0000-0000-0000000000a5','cccccc43-0000-0000-0000-0000000000c1','member'),('aaaaaa43-0000-0000-0000-0000000000a6','cccccc43-0000-0000-0000-0000000000c1','viewer'),('aaaaaa43-0000-0000-0000-0000000000a7','cccccc43-0000-0000-0000-0000000000d1','owner');
insert into provider_profiles (org_id, slug, headline) values ('cccccc43-0000-0000-0000-0000000000b1','provider-43','Provider headline');
insert into services (id, org_id, slug, title, status) values ('dddddd43-0000-0000-0000-000000000001','cccccc43-0000-0000-0000-0000000000b1','intro-call-43','Intro call','published'),('dddddd43-0000-0000-0000-000000000002','cccccc43-0000-0000-0000-0000000000b1','draft-call-43','Draft call','draft');
-- a Monday six weeks ahead (35 to 42 days from today), past the 30-day horizon test on any weekday and within the default 90
select set_config('t.mon', (date_trunc('week', now() at time zone 'UTC')::date + 42)::text, false);
create function pg_temp.at(t text) returns timestamptz language sql as $$ select (current_setting('t.mon')::date + t::time) at time zone 'UTC' $$;
create function pg_temp.mon_slots() returns text language sql as
$$ select coalesce(string_agg(to_char(s at time zone 'UTC','HH24:MI'), ',' order by s), '') from booking_slots('dddddd43-0000-0000-0000-000000000001', pg_temp.at('00:00'), pg_temp.at('23:59')) s $$;
grant execute on function pg_temp.at(text), pg_temp.mon_slots() to authenticated;

set local role authenticated;

-- 1. settings
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a3',true);
select throws_ok($$select booking_settings_save('cccccc43-0000-0000-0000-0000000000b1', true, 'UTC', 0, 0, 90, '[{"weekday":1,"start":"09:00","end":"11:00"}]')$$, '42501', null, 'a provider member cannot save settings');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a4',true);
select throws_ok($$select booking_settings_save('cccccc43-0000-0000-0000-0000000000b1', true, 'UTC', 0, 0, 90, '[]')$$, '42501', null, 'another organization cannot save settings');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a8',true);
select throws_ok($$select booking_settings_save('cccccc43-0000-0000-0000-0000000000b1', true, 'UTC', 0, 0, 90, '[]')$$, '42501', null, 'a stranger cannot save settings');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a1',true);
select throws_ok($$select booking_settings_save('cccccc43-0000-0000-0000-0000000000b1', true, 'Mars/Base', 0, 0, 90, '[]')$$, '22023', null, 'an unknown time zone is refused');
select throws_ok($$select booking_settings_save('cccccc43-0000-0000-0000-0000000000b1', true, 'UTC', 121, 0, 90, '[]')$$, '22023', null, 'a buffer over 120 minutes is refused');
select throws_ok($$select booking_settings_save('cccccc43-0000-0000-0000-0000000000b1', true, 'UTC', 0, 0, 90, '[{"weekday":8,"start":"09:00","end":"11:00"}]')$$, '22023', null, 'weekday 8 is refused');
select throws_ok($$select booking_settings_save('cccccc43-0000-0000-0000-0000000000b1', true, 'UTC', 0, 0, 90, '[{"weekday":1,"start":"11:00","end":"11:00"}]')$$, '22023', null, 'a window must end after it starts');
select throws_ok($$select booking_settings_save('cccccc43-0000-0000-0000-0000000000b1', true, 'UTC', 0, 0, 90, (select jsonb_agg(jsonb_build_object('weekday',1,'start','09:00','end','10:00')) from generate_series(1,22)))$$, '22023', null, 'more than 21 windows are refused');
select lives_ok($$select booking_settings_save('cccccc43-0000-0000-0000-0000000000b1', true, 'UTC', 0, 0, 90, '[{"weekday":1,"start":"09:00","end":"11:00"}]')$$, 'the owner saves the settings');
select is((select count(*)::int from booking_hours where org_id = 'cccccc43-0000-0000-0000-0000000000b1'), 1, 'the provider reads its hours');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a4',true);
select is((select count(*)::int from booking_settings), 0, 'a client cannot read the provider settings');

-- 2. service
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a3',true);
select throws_ok($$select service_set_booking('cccccc43-0000-0000-0000-0000000000b1','dddddd43-0000-0000-0000-000000000001',30)$$, '42501', null, 'a provider member cannot make a service bookable');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a1',true);
select throws_ok($$select service_set_booking('cccccc43-0000-0000-0000-0000000000b1','dddddd43-0000-0000-0000-000000000001',20)$$, '22023', null, '20 minutes is not a slot length');
select lives_ok($$select service_set_booking('cccccc43-0000-0000-0000-0000000000b1','dddddd43-0000-0000-0000-000000000001',30)$$, 'the owner makes the service bookable in 30 minute slots');
select lives_ok($$select service_set_booking('cccccc43-0000-0000-0000-0000000000b1','dddddd43-0000-0000-0000-000000000002',30)$$, 'and the draft service too');

-- 3. slots
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a5',true);
select is(pg_temp.mon_slots(), '09:00,09:30,10:00,10:30', 'a 09:00-11:00 window gives four 30 minute slots');
select throws_ok($$select booking_slots('dddddd43-0000-0000-0000-000000000001', now(), now() + interval '32 days')$$, '22023', null, 'a span over 31 days is refused');
select throws_ok($$select booking_slots('dddddd43-0000-0000-0000-000000000002', pg_temp.at('00:00'), pg_temp.at('23:59'))$$, '22023', null, 'an unpublished service has no slots');
reset role; update booking_settings set horizon_days = 30 where org_id = 'cccccc43-0000-0000-0000-0000000000b1'; set local role authenticated;
select is(pg_temp.mon_slots(), '', 'slots beyond how far ahead people can book are not offered');
reset role; update booking_settings set horizon_days = 90 where org_id = 'cccccc43-0000-0000-0000-0000000000b1'; set local role authenticated;

select is(booking_offer('dddddd43-0000-0000-0000-000000000001'), 30, 'a client learns the published service is bookable in 30 minute slots');
select is(booking_offer('dddddd43-0000-0000-0000-000000000002'), null::int, 'a draft service is not offered');
reset role; set local role anon;
select is(booking_offer('dddddd43-0000-0000-0000-000000000001'), 30, 'a signed-out visitor can see that the service takes bookings');
reset role; set local role authenticated;

-- 4. requesting
select lives_ok($$select set_config('t.b1', booking_request('cccccc43-0000-0000-0000-0000000000c1','dddddd43-0000-0000-0000-000000000001', pg_temp.at('09:30'), 'Hello')::text, false)$$, 'a client member requests 09:30');
select is((select status from bookings where id = current_setting('t.b1')::uuid), 'pending', 'the booking is pending');
reset role;
select is((select count(*)::int from notifications where type = 'booking_requested' and user_id in ('aaaaaa43-0000-0000-0000-0000000000a1','aaaaaa43-0000-0000-0000-0000000000a2','aaaaaa43-0000-0000-0000-0000000000a3')), 3, 'every provider member is told');
select is((select count(*)::int from notifications where type = 'booking_requested' and (select array_agg(k order by k) from jsonb_object_keys(payload) k) <> array['booking_id','org_id']), 0, 'the payload carries only the booking and organization ids');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a5',true);
select is(pg_temp.mon_slots(), '09:00,10:00,10:30', 'the booked slot is no longer offered');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a7',true);
select throws_ok($$select booking_request('cccccc43-0000-0000-0000-0000000000d1','dddddd43-0000-0000-0000-000000000001', pg_temp.at('09:30'), '')$$, '23505', null, 'another client cannot take the same slot');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a6',true);
select throws_ok($$select booking_request('cccccc43-0000-0000-0000-0000000000c1','dddddd43-0000-0000-0000-000000000001', pg_temp.at('10:00'), '')$$, '42501', null, 'a viewer cannot book');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a3',true);
select throws_ok($$select booking_request('cccccc43-0000-0000-0000-0000000000b1','dddddd43-0000-0000-0000-000000000001', pg_temp.at('10:00'), '')$$, '42501', null, 'the provider cannot book itself');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a7',true);
select throws_ok($$select booking_request('cccccc43-0000-0000-0000-0000000000d1','dddddd43-0000-0000-0000-000000000001', pg_temp.at('10:01'), '')$$, '22023', null, 'a start off the slot grid is refused');
select throws_ok($$select booking_request('cccccc43-0000-0000-0000-0000000000d1','dddddd43-0000-0000-0000-000000000001', now() - interval '1 day', '')$$, '22023', null, 'a start in the past is refused');

select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a6',true);
select is((select service_title || ' / ' || other_org_name || ' / ' || side from booking_list('cccccc43-0000-0000-0000-0000000000c1') where id = current_setting('t.b1')::uuid), 'Intro call / Provider / client', 'a client viewer lists the booking with the service and the professional');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a3',true);
select is((select other_org_name || ' / ' || side || ' / ' || note from booking_list('cccccc43-0000-0000-0000-0000000000b1') where id = current_setting('t.b1')::uuid), 'Client / provider / Hello', 'the provider lists it with the client and the note');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a7',true);
select throws_ok($$select * from booking_list('cccccc43-0000-0000-0000-0000000000c1')$$, '42501', null, 'another organization cannot list them');

-- 5. buffer
reset role; update booking_settings set buffer_minutes = 30 where org_id = 'cccccc43-0000-0000-0000-0000000000b1'; set local role authenticated;
select is(pg_temp.mon_slots(), '10:30', 'with a 30 minute gap only slots clear of the booking and its gap remain');
reset role; update booking_settings set buffer_minutes = 0 where org_id = 'cccccc43-0000-0000-0000-0000000000b1'; set local role authenticated;

-- 5b. lowering the gap: a slot the list offers must really be bookable
reset role; update bookings set status = 'cancelled' where id = current_setting('t.b1')::uuid; update booking_settings set buffer_minutes = 30 where org_id = 'cccccc43-0000-0000-0000-0000000000b1'; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a7',true);
select lives_ok($$select set_config('t.b3', booking_request('cccccc43-0000-0000-0000-0000000000d1','dddddd43-0000-0000-0000-000000000001', pg_temp.at('10:00'), '')::text, false)$$, 'a 10:00 booking made while the gap is 30 minutes');
reset role; update booking_settings set buffer_minutes = 0 where org_id = 'cccccc43-0000-0000-0000-0000000000b1'; set local role authenticated;
select is(pg_temp.mon_slots(), '09:00,09:30', 'after lowering the gap, the slot still covered by the stored gap is not offered');
reset role; update bookings set status = 'cancelled' where id = current_setting('t.b3')::uuid; update bookings set status = 'pending' where id = current_setting('t.b1')::uuid; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a5',true);

-- 5c. a suspended or hidden professional cannot be booked
reset role; update organizations set status = 'suspended' where id = 'cccccc43-0000-0000-0000-0000000000b1'; set local role authenticated;
select is(booking_offer('dddddd43-0000-0000-0000-000000000001'), null::int, 'a suspended professional does not offer bookings');
select throws_ok($$select booking_slots('dddddd43-0000-0000-0000-000000000001', pg_temp.at('00:00'), pg_temp.at('23:59'))$$, '22023', null, 'nor slots');
select throws_ok($$select booking_request('cccccc43-0000-0000-0000-0000000000c1','dddddd43-0000-0000-0000-000000000001', pg_temp.at('10:30'), '')$$, '22023', null, 'nor accepts requests');
reset role; update organizations set status = 'active' where id = 'cccccc43-0000-0000-0000-0000000000b1'; update provider_profiles set visibility = 'private' where org_id = 'cccccc43-0000-0000-0000-0000000000b1'; set local role authenticated;
select is(booking_offer('dddddd43-0000-0000-0000-000000000001'), null::int, 'a private profile does not offer bookings');
reset role; update provider_profiles set visibility = 'public' where org_id = 'cccccc43-0000-0000-0000-0000000000b1'; set local role authenticated;

-- 6. daily cap
reset role; update platform_settings set value = '{"default":1}' where key = 'limits.bookings_pending_per_day'; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a4',true);
select throws_ok($$select booking_request('cccccc43-0000-0000-0000-0000000000c1','dddddd43-0000-0000-0000-000000000001', pg_temp.at('10:30'), '')$$, '54000', null, 'the daily cap on pending bookings holds');
reset role; update platform_settings set value = '{"default":5}' where key = 'limits.bookings_pending_per_day'; set local role authenticated;

-- 7. decide
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a4',true);
select throws_ok($$select booking_decide('cccccc43-0000-0000-0000-0000000000c1', current_setting('t.b1')::uuid, true, '', '')$$, '42501', null, 'the client cannot confirm');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a3',true);
select throws_ok($$select booking_decide('cccccc43-0000-0000-0000-0000000000b1', current_setting('t.b1')::uuid, true, 'http://meet.example/x', '')$$, '22023', null, 'a meeting link must be https');
select lives_ok($$select booking_decide('cccccc43-0000-0000-0000-0000000000b1', current_setting('t.b1')::uuid, true, 'https://meet.example/x', '')$$, 'a provider member confirms');
select is((select status from bookings where id = current_setting('t.b1')::uuid), 'confirmed', 'the booking is confirmed');
select throws_ok($$select booking_decide('cccccc43-0000-0000-0000-0000000000b1', current_setting('t.b1')::uuid, true, '', '')$$, '55000', null, 'a confirmed booking cannot be decided again');
reset role;
select is((select count(*)::int from notifications where type = 'booking_confirmed' and user_id in ('aaaaaa43-0000-0000-0000-0000000000a4','aaaaaa43-0000-0000-0000-0000000000a5','aaaaaa43-0000-0000-0000-0000000000a6')), 3, 'the client organization is told');
set local role authenticated;

-- 8. cancel
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a8',true);
select throws_ok($$select booking_cancel('cccccc43-0000-0000-0000-0000000000c1', current_setting('t.b1')::uuid, 'no')$$, '42501', null, 'a stranger cannot cancel');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a6',true);
select throws_ok($$select booking_cancel('cccccc43-0000-0000-0000-0000000000c1', current_setting('t.b1')::uuid, 'no')$$, '42501', null, 'a viewer cannot cancel');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a4',true);
select throws_ok($$select booking_cancel('cccccc43-0000-0000-0000-0000000000c1', current_setting('t.b1')::uuid, '  ')$$, '22023', null, 'cancelling needs a reason');
select lives_ok($$select booking_cancel('cccccc43-0000-0000-0000-0000000000c1', current_setting('t.b1')::uuid, 'Something came up')$$, 'the client cancels');
select is(pg_temp.mon_slots(), '09:00,09:30,10:00,10:30', 'the cancelled slot is offered again');
select throws_ok($$select booking_cancel('cccccc43-0000-0000-0000-0000000000c1', current_setting('t.b1')::uuid, 'again')$$, '55000', null, 'a cancelled booking cannot be cancelled again');
reset role;
select is((select count(*)::int from notifications where type = 'booking_cancelled' and user_id in ('aaaaaa43-0000-0000-0000-0000000000a1','aaaaaa43-0000-0000-0000-0000000000a2','aaaaaa43-0000-0000-0000-0000000000a3')), 3, 'the provider is told about the cancellation');

reset role; update platform_settings set value = '{"default":1}' where key = 'limits.bookings_pending_per_day'; set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a4',true);
select throws_ok($$select booking_request('cccccc43-0000-0000-0000-0000000000c1','dddddd43-0000-0000-0000-000000000001', pg_temp.at('10:30'), '')$$, '54000', null, 'a cancelled request still counts toward the daily limit');
reset role; update platform_settings set value = '{"default":5}' where key = 'limits.bookings_pending_per_day';

-- 9. an expired pending booking cannot be confirmed
insert into bookings (id, provider_org_id, client_org_id, service_id, starts_at, ends_at, blocked, status)
values ('dddddd43-0000-0000-0000-0000000000e1','cccccc43-0000-0000-0000-0000000000b1','cccccc43-0000-0000-0000-0000000000c1','dddddd43-0000-0000-0000-000000000001', now() - interval '2 hours', now() - interval '90 minutes', tstzrange(now() - interval '2 hours', now() - interval '90 minutes'), 'pending');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a3',true);
select throws_ok($$select booking_decide('cccccc43-0000-0000-0000-0000000000b1', 'dddddd43-0000-0000-0000-0000000000e1', true, '', '')$$, '55000', null, 'a pending booking in the past cannot be confirmed');

-- 10. decline
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a7',true);
select lives_ok($$select set_config('t.b2', booking_request('cccccc43-0000-0000-0000-0000000000d1','dddddd43-0000-0000-0000-000000000001', pg_temp.at('10:00'), '')::text, false)$$, 'another request');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a1',true);
select lives_ok($$select booking_decide('cccccc43-0000-0000-0000-0000000000b1', current_setting('t.b2')::uuid, false, '', 'Fully booked that week')$$, 'the owner declines');
select is((select status from bookings where id = current_setting('t.b2')::uuid), 'declined', 'the booking is declined');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a5',true);
select is(pg_temp.mon_slots(), '09:00,09:30,10:00,10:30', 'a declined booking frees its slot');

-- 11. daylight saving (the generator, independent of today's date)
reset role;
update booking_settings set timezone = 'Europe/London' where org_id = 'cccccc43-0000-0000-0000-0000000000b1';
delete from booking_hours where org_id = 'cccccc43-0000-0000-0000-0000000000b1';
insert into booking_hours (org_id, weekday, start_time, end_time) values ('cccccc43-0000-0000-0000-0000000000b1', 7, '00:30', '02:30');
select set_config('t.dst', (select (make_date(y,3,31) - (extract(isodow from make_date(y,3,31))::int % 7))::text from (select extract(year from now())::int + 1 as y) q), false);
select is(
  (select string_agg(to_char(s at time zone 'UTC','HH24:MI'), ',' order by s) from booking_candidates('cccccc43-0000-0000-0000-0000000000b1', 30,
     (current_setting('t.dst')::date - 1)::timestamptz, (current_setting('t.dst')::date + 1)::timestamptz) s),
  '00:30,01:00', 'on the spring-forward night local 01:00-01:59 does not exist and the offset moves to +1');

-- 12. visibility and direct writes
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a7',true);
select is((select count(*)::int from bookings where client_org_id = 'cccccc43-0000-0000-0000-0000000000c1'), 0, 'another client cannot see these bookings');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a8',true);
select is((select count(*)::int from bookings), 0, 'a stranger sees nothing');
select set_config('request.jwt.claim.sub','aaaaaa43-0000-0000-0000-0000000000a1',true);
select throws_ok($$select booked_by from bookings limit 1$$, '42501', null, 'the person who booked is not readable');
select throws_ok($$insert into bookings (provider_org_id, client_org_id, service_id, starts_at, ends_at, blocked) values ('cccccc43-0000-0000-0000-0000000000b1','cccccc43-0000-0000-0000-0000000000c1','dddddd43-0000-0000-0000-000000000001', now(), now(), tstzrange(now(), now() + interval '1 minute'))$$, '42501', null, 'bookings cannot be inserted directly');
select throws_ok($$update bookings set status = 'confirmed'$$, '42501', null, 'bookings cannot be updated directly');
select throws_ok($$delete from bookings$$, '42501', null, 'bookings cannot be deleted directly');
select throws_ok($$select booking_candidates('cccccc43-0000-0000-0000-0000000000b1', 30, now(), now() + interval '1 day')$$, '42501', null, 'the slot generator is internal');

-- 13. audit
reset role;
select is((select count(distinct action)::int from audit_log where action in ('booking_settings.save','booking.request','booking.confirm','booking.cancel','booking.decline')), 5, 'every kind of change is audited');

select * from finish();
rollback;
