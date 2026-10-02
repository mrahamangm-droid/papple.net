begin;
select plan(4);
insert into auth.users (id, email) values ('aaaaaaa4-0000-0000-0000-000000000001','u@x.test');
insert into webhook_events (provider, event_id, payload) values ('stripe','evt_1','{"a":1}');

select throws_ok($$insert into webhook_events (provider, event_id, payload) values ('stripe','evt_1','{}')$$, '23505', null,
  'same provider + event id cannot be stored twice');
select lives_ok($$insert into webhook_events (provider, event_id, payload) values ('other','evt_1','{}')$$,
  'same event id from a different provider is distinct');

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaa4-0000-0000-0000-000000000001',true);
select throws_ok($$select * from webhook_events$$, '42501', null, 'authenticated users cannot read webhook events');
reset role; set local role anon;
select throws_ok($$select * from webhook_events$$, '42501', null, 'anon cannot read webhook events');

select * from finish();
rollback;
