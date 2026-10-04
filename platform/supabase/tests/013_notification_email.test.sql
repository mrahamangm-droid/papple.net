begin;
select plan(5);

insert into auth.users (id, email) values
 ('aaaaaa13-0000-0000-0000-000000000001','n1@x.test'),
 ('aaaaaa13-0000-0000-0000-000000000002','n2@x.test');
insert into notifications (id, user_id, type, payload) values
 ('bbbbbb13-0000-0000-0000-000000000001','aaaaaa13-0000-0000-0000-000000000001','message_received','{}');

select has_column('public','notifications','emailed_at','emailed_at column exists');
select is((select emailed_at from notifications where id = 'bbbbbb13-0000-0000-0000-000000000001'), null, 'new notifications start un-emailed');

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa13-0000-0000-0000-000000000001',true);
select throws_ok($$update notifications set emailed_at = now() where id = 'bbbbbb13-0000-0000-0000-000000000001'$$, '42501', null, 'a user cannot mark their own notification as emailed');
select lives_ok($$select mark_notification_read('bbbbbb13-0000-0000-0000-000000000001')$$, 'marking read still works');
reset role;
select is((select emailed_at from notifications where id = 'bbbbbb13-0000-0000-0000-000000000001'), null, 'marking read does not touch emailed_at');

select * from finish();
rollback;
