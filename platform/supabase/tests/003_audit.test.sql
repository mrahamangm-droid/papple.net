begin;
select plan(7);
insert into auth.users (id, email) values
 ('aaaaaaa2-0000-0000-0000-000000000001','admin@x.test'),
 ('aaaaaaa2-0000-0000-0000-000000000002','user@x.test');
insert into platform_roles (user_id, role) values ('aaaaaaa2-0000-0000-0000-000000000001','admin');
insert into audit_log (actor_id, action, entity, outcome, request_id)
  values ('aaaaaaa2-0000-0000-0000-000000000001','seed.test','thing','success','req-seed');

-- append-only even for the table owner / service role
select throws_ok($$update audit_log set action='x'$$, 'P0001', 'audit_log is append-only', 'superuser cannot update audit rows');
select throws_ok($$delete from audit_log$$, 'P0001', 'audit_log is append-only', 'superuser cannot delete audit rows');

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaa2-0000-0000-0000-000000000002',true);
select is((select count(*)::int from audit_log), 0, 'non-admin cannot read audit rows');
select throws_ok($$insert into audit_log (action, entity, outcome, request_id) values ('a','b','success','r')$$, '42501', null, 'authenticated cannot insert audit rows');

select set_config('request.jwt.claim.sub','aaaaaaa2-0000-0000-0000-000000000001',true);
select is((select count(*)::int from audit_log where request_id='req-seed'), 1, 'platform admin can read audit rows');
select throws_ok($$update audit_log set action='x'$$, '42501', null, 'admin cannot update audit rows');
select throws_ok($$delete from audit_log$$, '42501', null, 'admin cannot delete audit rows');

select * from finish();
rollback;
