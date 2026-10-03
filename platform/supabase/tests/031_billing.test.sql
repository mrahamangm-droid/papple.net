begin;
select plan(24);
insert into auth.users (id, email) values
 ('aaaaaa31-0000-0000-0000-000000000001','owner@x.test'),('aaaaaa31-0000-0000-0000-000000000002','member@x.test'),('aaaaaa31-0000-0000-0000-000000000003','outsider@x.test');
insert into organizations (id, type, name) values ('cccccc31-0000-0000-0000-00000000000a','individual','Org A'),('cccccc31-0000-0000-0000-00000000000b','individual','Org B');
insert into memberships (user_id, org_id, role) values
 ('aaaaaa31-0000-0000-0000-000000000001','cccccc31-0000-0000-0000-00000000000a','owner'),
 ('aaaaaa31-0000-0000-0000-000000000002','cccccc31-0000-0000-0000-00000000000a','member');
update plans set stripe_price_id = 'price_pro' where key = 'professional_plus';
update plans set stripe_price_id = 'price_biz' where key = 'business';
update plans set features = '{"invoicing":true}' where key = 'professional_plus';
update platform_settings set value = '7' where key = 'billing.grace_days';

select is(org_plan_key('cccccc31-0000-0000-0000-00000000000a'), 'free', 'an organization with no subscription is on free');
select is(apply_subscription_event('cccccc31-0000-0000-0000-00000000000a','cus_1','sub_1','price_pro','active', now() + interval '30 days', false, now() - interval '3 minutes'), 'applied', 'an active subscription is applied');
select is(org_plan_key('cccccc31-0000-0000-0000-00000000000a'), 'professional_plus', 'the plan follows the subscription price');
select is(apply_subscription_event('cccccc31-0000-0000-0000-00000000000a','cus_1','sub_1','price_biz','active', now() + interval '30 days', false, now() - interval '10 minutes'), 'stale', 'an older event is ignored');
select is(org_plan_key('cccccc31-0000-0000-0000-00000000000a'), 'professional_plus', 'a stale event does not change the plan');
select is(apply_subscription_event('cccccc31-0000-0000-0000-00000000000a','cus_1','sub_1','price_biz','trialing', now() + interval '30 days', false, now() - interval '2 minutes'), 'applied', 'a newer upgrade is applied');
select is(org_plan_key('cccccc31-0000-0000-0000-00000000000a'), 'business', 'trialing counts as the plan');
select is(apply_subscription_event('cccccc31-0000-0000-0000-00000000000a','cus_1','sub_1','price_biz','past_due', now() + interval '30 days', false, now() - interval '1 minute'), 'applied', 'past_due is recorded');
select is(org_plan_key('cccccc31-0000-0000-0000-00000000000a'), 'business', 'past_due keeps the plan during the grace period');
update subscriptions set past_due_since = now() - interval '10 days' where org_id = 'cccccc31-0000-0000-0000-00000000000a';
select is(org_plan_key('cccccc31-0000-0000-0000-00000000000a'), 'free', 'past_due falls back to free after the grace period');
select is(apply_subscription_event('cccccc31-0000-0000-0000-00000000000a','cus_1','sub_OLD','price_pro','canceled', now(), false, now()), 'stale', 'the end of a different, older subscription cannot cancel the current one');
select is(apply_subscription_event('cccccc31-0000-0000-0000-00000000000a','cus_1','sub_1','price_biz','canceled', now(), false, now()), 'applied', 'cancellation is applied');
select is(org_plan_key('cccccc31-0000-0000-0000-00000000000a'), 'free', 'a cancelled subscription returns the organization to free');
select is(apply_subscription_event('cccccc31-0000-0000-0000-00000000000a','cus_1','sub_1','price_unknown','active', now(), false, now() + interval '1 minute'), 'unknown_plan', 'an unknown price is reported, not guessed');
select is(apply_subscription_event('cccccc31-0000-0000-0000-0000000000ff','cus_9','sub_9','price_pro','active', now(), false, now()), 'unknown_org', 'an unknown organization is reported');
select is(apply_subscription_event('cccccc31-0000-0000-0000-00000000000b','cus_2','sub_1','price_pro','active', now(), false, now()), 'conflict', 'one Stripe subscription cannot belong to two organizations');
select throws_ok($$select apply_subscription_event('cccccc31-0000-0000-0000-00000000000a','cus_1','sub_1','price_pro','weird', now(), false, now() + interval '2 minutes')$$, '22023', null, 'an unknown status is invalid');

select apply_subscription_event('cccccc31-0000-0000-0000-00000000000a','cus_1','sub_2','price_pro','active', now() + interval '30 days', false, now() + interval '5 minutes');
update plans set active = false where key = 'professional_plus';
select is(org_plan_key('cccccc31-0000-0000-0000-00000000000a'), 'free', 'an inactive plan is not granted');
update plans set active = true where key = 'professional_plus';

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaa31-0000-0000-0000-000000000001',true);
select ok(can_manage_billing('cccccc31-0000-0000-0000-00000000000a'), 'the owner can manage billing');
select set_config('request.jwt.claim.sub','aaaaaa31-0000-0000-0000-000000000002',true);
select ok(not can_manage_billing('cccccc31-0000-0000-0000-00000000000a'), 'a plain member cannot manage billing');
select ok(plan_feature('cccccc31-0000-0000-0000-00000000000a','invoicing'), 'a member sees the plan feature');
select throws_ok($$select apply_subscription_event('cccccc31-0000-0000-0000-00000000000a','c','s','price_pro','active', now(), false, now())$$, '42501', null, 'users cannot call the webhook function');
select lives_ok($$select org_id, plan_key, status, current_period_end, cancel_at_period_end, past_due_since from subscriptions$$, 'members can read every column the billing page selects');
select throws_ok($$select stripe_customer_id from subscriptions$$, '42501', null, 'Stripe ids are not readable by members');
select * from finish();
rollback;
