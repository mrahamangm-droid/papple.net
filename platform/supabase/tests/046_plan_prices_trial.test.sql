begin;
select plan(4);
select is((select string_agg(key || '=' || coalesce(price_cents::text, 'custom') || '/' || coalesce(interval, '-'), ',' order by sort) from plans),
  'free=0/-,professional_plus=2999/month,business=4999/month,enterprise=9999/month', 'the three paid plans cost 29.99, 49.99 and 99.99 a month');
select is((select count(*)::int from plans where key in ('professional_plus','business','enterprise') and stripe_price_id is not null), 0,
  'old Stripe prices are cleared, so nobody is charged an old amount under a new label');
select is((select value from platform_settings where key = 'billing.trial_days')::int, 30, 'a 30-day free trial');
select ok(not (select features ? 'custom_pricing' from plans where key = 'enterprise'), 'Enterprise is no longer custom-priced');
select * from finish();
rollback;
