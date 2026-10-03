begin;
select plan(11);
insert into auth.users (id, email) values ('aaaaaa32-0000-0000-0000-000000000001','o@x.test');
insert into organizations (id, type, name) values ('cccccc32-0000-0000-0000-00000000000a','individual','Fix A');
insert into memberships (user_id, org_id, role) values ('aaaaaa32-0000-0000-0000-000000000001','cccccc32-0000-0000-0000-00000000000a','owner');
update plans set stripe_price_id = 'price_pro' where key = 'professional_plus';
update plans set stripe_price_id = 'price_biz' where key = 'business';
update platform_settings set value = '7' where key = 'billing.grace_days';
\set org '''cccccc32-0000-0000-0000-00000000000a'''

-- same-second events: the stronger state wins instead of being dropped as stale
select is(apply_subscription_event(:org,'cus_1','sub_1','price_pro','incomplete',null,false,'2026-08-01 10:00:00+00'),'applied','incomplete applied');
select is(apply_subscription_event(:org,'cus_1','sub_1','price_pro','active',null,false,'2026-08-01 10:00:00+00'),'applied','an active event in the same second is not dropped');
select is(org_plan_key(:org),'professional_plus','the organization gets the plan it paid for');
select is(apply_subscription_event(:org,'cus_1','sub_1','price_pro','incomplete',null,false,'2026-08-01 10:00:00+00'),'stale','a weaker event in the same second is stale');

-- a different subscription that is not active cannot displace the live one
select is(apply_subscription_event(:org,'cus_1','sub_2','price_biz','incomplete',null,false,'2026-08-01 10:05:00+00'),'stale','a new incomplete subscription does not displace the active one');
select is(apply_subscription_event(:org,'cus_1','sub_OLD','price_pro','past_due',null,false,'2026-08-01 10:06:00+00'),'stale','an unrelated subscription going past due does not displace the active one');
select is(org_plan_key(:org),'professional_plus','the plan is unchanged');

-- a cancellation still lands after the price was unmapped from every plan
update plans set stripe_price_id = null where key = 'professional_plus';
select is(apply_subscription_event(:org,'cus_1','sub_1','price_pro','canceled',null,false,'2026-08-01 11:00:00+00'),'applied','a cancellation for an unmapped price is applied');
select is(org_plan_key(:org),'free','the organization falls back to free');

-- the grace period counts from the event, not from when it was processed
select is(apply_subscription_event(:org,'cus_1','sub_3','price_biz','past_due',null,false,now() - interval '8 days'),'applied','a late past_due is applied');
select is(org_plan_key(:org),'free','grace is measured from the event time');
select * from finish();
rollback;
