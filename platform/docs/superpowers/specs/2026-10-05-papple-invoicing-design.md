# PAPple invoicing (SaaS tools, slice B1) — design

Status: owner chose in chat on 2026-10-05: "Provider invoices per paid milestone" and "No claim, owner-reviewed". Written spec accepted under the owner's standing delegation.

## Goal
A professional can issue a numbered, immutable invoice to the client for each paid milestone, and a credit note when that payment is refunded. Both parties can open and print it.

## Honesty rules
- Invoices carry the fields UAE-style tax invoices usually need (issuer legal name, address, tax number, recipient, sequential number, date, description, net, tax rate, tax, total) but the product never says they are compliant. Every invoice page shows a "Template not reviewed as a tax invoice" note driven by one constant (`INVOICE.reviewed = false`), and the title is "Invoice", never "Tax Invoice".
- Papple does no tax calculation. The professional sets their own tax rate and number once.

## Data (migration 0032_invoicing.sql)
- `billing_profiles(org_id pk, legal_name, address, country, tax_number, tax_bps)`: members read, written only through `save_billing_profile` (owner/admin). A rate above 0 requires a tax number.
- `invoice_counters(org_id pk, last_no)`: no direct access; one gapless sequence per issuing organization (invoices and credit notes share it).
- `invoices(id, org_id issuer, contract_id, milestone_id, payment_id, kind invoice|credit_note, credits_invoice_id, number 'INV-YYYY-000001'|'CN-YYYY-000001', issued_at, currency, net, tax_bps, tax, total, issuer jsonb, recipient jsonb, description)`: unique `(org_id, number)`; one invoice per milestone; one credit note per invoice. Readable by contract parties and platform admins. Never updated or deleted (no grants plus a trigger that blocks it even for the service role).
- Amounts: the milestone amount the client paid for the work is the gross total. With a tax rate, `net = round(total * 10000 / (10000 + bps))`, `tax = total - net`. The client fee belongs to Papple and is not part of the provider's invoice.
- `issue_invoice(org, milestone) → uuid`: provider-side owner/admin, milestone paid with a succeeded payment, billing profile present; idempotent (returns the existing invoice). Issuer and recipient are snapshotted at issue time (recipient = client billing profile if any, else organization name).
- `issue_credit_note(org, invoice) → uuid`: provider-side owner/admin, a succeeded refund exists for the invoice's payment, idempotent. Same amounts as the invoice.
- Errors: 42501 not allowed, 22023 invalid input, 55000 not ready (not paid, no billing profile, no refund).

## Server and UI
- `lib/invoices/{db,service,present}.ts`: validated inputs, throttle rule `invoice` (20/min), fixed messages.
- `/settings/invoicing`: billing profile form (owner/admin of provider organizations). Nav link for owners/admins of any organization.
- Contract page: provider-side "Issue invoice" on paid milestones, "Issue credit note" on refunded ones, "View invoice" for both parties.
- `/contracts/[id]/invoices/[invoiceId]`: printable page (print CSS, "Save as PDF" through the browser; no server PDF yet), noindex through the `(app)` layout.

## Out of scope
Papple's own fee statements, automatic issuing, partial refunds, multi-currency conversion, e-invoicing/PEPPOL, emailing invoices, server-side PDF.

## Review focus
Invoice for an unpaid or foreign milestone; non-provider or viewer issuing; double issue under concurrency (one number, no gap); credit note without a refund; tax rounding (total = net + tax always); editing or deleting an invoice; client reading another contract's invoice; issuer snapshot changing after the profile is edited; gap in numbering after a failed issue.
