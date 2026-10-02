-- Launch defaults ONLY. Every value is admin-editable at runtime; application code must not hardcode them.
insert into public.plans (key, name, audience, price_cents, currency, interval, limits, features, sort) values
 ('free', 'Free', 'client', 0, 'USD', null, '{}', '{"marketplace_basic":true}', 0),
 ('professional_plus', 'Professional Plus', 'professional', 999, 'USD', 'month', '{}', '{}', 10),
 ('business', 'Business', 'agency', 1999, 'USD', 'month', '{}', '{}', 20),
 ('enterprise', 'Enterprise', 'enterprise', null, 'USD', null, '{}', '{"custom_pricing":true}', 30)
on conflict (key) do nothing;

insert into public.platform_settings (key, value, description) values
 ('commission.professional_bps', '500', 'Launch commission charged to the Professional, in basis points'),
 ('commission.client_bps', '200', 'Launch fee charged to the Client, in basis points'),
 ('payments.enabled', 'false', 'Master switch for taking payments'),
 ('limits.max_orgs_per_user', '5', 'Maximum organizations one user may create'),
 ('ai.monthly_message_limits', '{"free":20,"professional_plus":200,"business":1000,"enterprise":null}', 'Per-plan monthly AI message caps (null = by contract)')
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, description) values
 ('ai.assistant', false, 'AI assistant surfaces'),
 ('marketplace.public_signup', true, 'Allow public signup')
on conflict (key) do nothing;
