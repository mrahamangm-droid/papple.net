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
 ('payments.min_application_fee_minor', '100', 'PLACEHOLDER: minimum Papple fee per milestone payment in minor units (100 = AED 1.00, Stripe''s fixed fee); owner to confirm'),
 ('contracts.min_milestone_minor', '10000', 'PLACEHOLDER: smallest milestone in minor units (10000 = AED 100), below which Stripe fees can exceed the commission; owner to confirm'),
 ('payments.checkout_expiry_minutes', '60', 'PLACEHOLDER: how long a milestone Checkout session stays open'),
 ('reviews.reveal_after_days', '14', 'PLACEHOLDER: a one-sided review becomes visible after this many days'),
 ('contracts.max_milestones', '20', 'PLACEHOLDER: maximum milestones per contract'),
 ('limits.max_orgs_per_user', '5', 'Maximum organizations one user may create'),
 ('ai.monthly_message_limits', '{"free":20,"professional_plus":200,"business":1000,"enterprise":null}', 'Per-plan monthly AI message caps (null = by contract)')
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, description) values
 ('ai.assistant', false, 'AI assistant surfaces'),
 ('marketplace.public_signup', true, 'Allow public signup'),
 ('marketplace.email_notifications', false, 'Email unread-notification nudges (needs Resend configured)')
on conflict (key) do nothing;

-- Marketplace taxonomy starter set (Admin-editable at runtime) and limits. Values are launch placeholders for owner confirmation.
insert into public.categories (slug, name, position) values
 ('construction-engineering','Construction & Engineering',1),
 ('technology','Technology',2),
 ('design','Design',3),
 ('legal-compliance','Legal & Compliance',4),
 ('finance-accounting','Finance & Accounting',5),
 ('marketing','Marketing',6)
on conflict (slug) do nothing;
insert into public.categories (parent_id, slug, name, position)
select (select id from public.categories where slug='construction-engineering'), v.slug, v.name, v.pos from (values
 ('architecture','Architecture',1),
 ('civil-structural','Civil & Structural',2),
 ('mep','MEP Engineering',3),
 ('project-management','Project Management',4),
 ('quantity-surveying','Quantity Surveying',5)
) as v(slug,name,pos)
on conflict (slug) do nothing;
insert into public.skills (category_id, slug, name)
select (select id from public.categories where slug = v.cat), v.slug, v.name from (values
 ('architecture','bim-modelling','BIM Modelling'),
 ('architecture','concept-design','Concept Design'),
 ('civil-structural','structural-analysis','Structural Analysis'),
 ('civil-structural','site-supervision','Site Supervision'),
 ('mep','hvac-design','HVAC Design'),
 ('mep','electrical-design','Electrical Design'),
 ('project-management','scheduling','Scheduling'),
 ('project-management','risk-management','Risk Management'),
 ('quantity-surveying','boq-preparation','BOQ Preparation'),
 ('quantity-surveying','cost-estimating','Cost Estimating'),
 ('technology','web-development','Web Development'),
 ('technology','data-analysis','Data Analysis'),
 ('design','brand-design','Brand Design'),
 ('design','ui-design','UI Design'),
 ('legal-compliance','contract-review','Contract Review'),
 ('finance-accounting','bookkeeping','Bookkeeping'),
 ('finance-accounting','tax-advisory','Tax Advisory'),
 ('marketing','seo','SEO'),
 ('marketing','content-writing','Content Writing')
) as v(cat,slug,name)
on conflict (slug) do nothing;
insert into public.platform_settings (key, value, description) values
 ('limits.max_services', '{"default":5,"professional_plus":25,"business":100,"enterprise":null}', 'Max published services per organization, by plan (null = unlimited)'),
 ('limits.max_portfolio_items', '{"default":6,"professional_plus":20,"business":50,"enterprise":null}', 'Max portfolio items per organization, by plan'),
 ('limits.proposals_per_month', '{"default":10,"professional_plus":60,"business":200,"enterprise":null}', 'Max proposals an organization may submit per calendar month, by plan'),
 ('limits.new_conversations_per_day', '20', 'Max new conversations a user may start per day'),
 ('matching.weights', '{"skills":50,"category":20,"budget":15,"availability":10,"language":5}', 'Rule-based matching weights'),
 ('marketplace.premoderation', 'false', 'When true, new projects wait in a review queue'),
 ('search.page_size', '20', 'Search results per page')
on conflict (key) do nothing;
