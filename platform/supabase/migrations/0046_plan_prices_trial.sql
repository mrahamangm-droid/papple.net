-- 0046 plan prices and a free trial (owner decision 2026-10-10): Professional Plus 29.99, Business 49.99 and Enterprise 99.99
-- per month, each with a 30-day free trial once per organization. Enterprise becomes self-serve (it was custom-priced).
-- Stripe prices cannot change amount, so the old price ids are cleared: a plan cannot be bought until the owner creates the new
-- Stripe Price and stores its id (Plans page or SQL), and nobody is charged an old amount under a new label.
-- Undo: restore price_cents 999 / 1999 / null, Enterprise interval null and features {"custom_pricing":true}, the old
-- stripe_price_id values, and delete setting billing.trial_days.

update public.plans set price_cents = 2999, interval = 'month', stripe_price_id = null, updated_at = now()
  where key = 'professional_plus' and price_cents is distinct from 2999;
update public.plans set price_cents = 4999, interval = 'month', stripe_price_id = null, updated_at = now()
  where key = 'business' and price_cents is distinct from 4999;
update public.plans set price_cents = 9999, interval = 'month', features = features - 'custom_pricing', stripe_price_id = null, updated_at = now()
  where key = 'enterprise' and price_cents is distinct from 9999;

insert into public.platform_settings (key, value, description)
values ('billing.trial_days', '30', 'Days free on a paid plan before the first charge, once per organization (0 turns trials off)')
on conflict (key) do nothing;
