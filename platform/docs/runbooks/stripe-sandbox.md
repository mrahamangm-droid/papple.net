# Stripe sandbox setup (owner steps)

Do everything in a Stripe **sandbox** (test mode) first. Switch to live only once the test run below has worked end to end.
Never email or paste Stripe keys (`sk_...`, `whsec_...`). They go straight into Vercel. Price IDs (`price_...`) are not secret.

## 1. Open the sandbox
Stripe Dashboard → account menu → **Sandboxes** → open or create one (for example "Papple test"). Every step below happens inside it.

## 2. Turn on Connect
Settings → **Connect** → platform or marketplace, with Express accounts. Without it, professionals can't finish payout setup, so paid bookings and contracts can't be paid.

## 3. Create the three plans
Product catalog → **Add product**, three times. Each is a recurring monthly price in USD:

| Product | Price |
|---|---|
| Professional Plus | 29.99 |
| Business | 49.99 |
| Enterprise | 99.99 |

Do **not** add a free trial on the prices. Papple adds the 30-day trial at checkout, once per organization (setting `billing.trial_days`). Copy each `price_...` ID.

## 4. Webhooks
Developers → Webhooks → **Add destination**. URL: `https://<staging address>/api/webhooks/stripe`.

- **Endpoint A** (your account), events:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `checkout.session.expired`
  - `refund.created`
  - `refund.updated`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- **Endpoint B** (connected accounts), same URL, event: `account.updated`.

Copy each endpoint's signing secret (`whsec_...`).

## 5. Keys into Vercel
Developers → API keys: copy the secret key (`sk_test_...`). Then Vercel → **papple-staging** → Settings → Environment Variables:

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from endpoint A |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `whsec_...` from endpoint B |

Then Deployments → latest → **Redeploy**.

## 6. Store the price IDs
Supabase → papple-staging → SQL editor, using your three IDs:

```sql
update plans set stripe_price_id = 'price_AAA' where key = 'professional_plus';
update plans set stripe_price_id = 'price_BBB' where key = 'business';
update plans set stripe_price_id = 'price_CCC' where key = 'enterprise';
```

Until this is done, the paid plans show but can't be bought. Migration 0046 cleared the old IDs on purpose, so nobody is charged an old price.

## 7. Customer portal
Settings → Billing → **Customer portal**: allow cancelling, updating the payment method and viewing invoices. Save.

## 8. Test run (no real money)
Test cards:
- Succeeds: `4242 4242 4242 4242`, any future date, any CVC.
- Declined: `4000 0000 0000 0002`.

Checks:
- **Plan:** as an organization owner, Billing → choose a plan → pay with 4242. The page shows "Free trial until …" and nothing is charged today.
- **Paid booking:**
  1. B (professional) finishes payout setup with Stripe's test data and sets a price on a service.
  2. A books, and B confirms.
  3. A clicks **Pay now** and pays with 4242. The booking shows Paid within a minute.
  4. A cancels more than 24 hours before the start and sees Refunded.

Prerequisites: everything in `staging-setup.md` (Vercel variables, and the GitHub `staging` environment so migrations 0040–0046 are applied).
