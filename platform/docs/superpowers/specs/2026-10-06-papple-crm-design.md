# PAPple simple CRM (SaaS tools, slice B2) — design

Status: owner chose in chat on 2026-10-06: "Full CRM with import and email" and, for email, "One-to-one, consent-recorded". Built in two PRs: B2a (contacts, deals, notes, CSV import) and B2b (email). Written spec accepted under the owner's standing delegation.

## Goal
A professional keeps a private list of their own contacts and deals, records follow-ups, imports an existing list, and can email one contact at a time with a recorded lawful basis and a working unsubscribe.

## Rules
- Everything belongs to one organization and is visible only to its members; viewers read, members and above write; deleting is owner/admin. No platform staff access except `is_platform_admin` read for support (audited in the console later; not exposed in UI).
- The CRM never touches marketplace data automatically. "Add to CRM" copies a name the user can already see, on the user's click.
- Plan limits: `limits.crm_contacts` (default 100, professional_plus 1000, business 10000, enterprise unlimited) enforced in the database under an advisory lock, same as other limits.
- Import: CSV only, at most 500 rows and 512 KB per upload, parsed on the server, rows validated one by one, duplicates by lower-cased email within the organization are skipped, the report says imported / duplicate / invalid with row numbers (never echoes the CSV content back beyond row numbers). The uploader must tick that they have the right to store these contacts and contact them; the attestation and time are stored on every imported contact.
- Email (B2b): one-to-one only, no bulk. Needs the platform flag `crm.email` (default off), a verified Resend domain, a saved billing profile (sender identity and postal address go in the footer), and a recorded basis on the contact (`existing_client`, `opted_in`, `requested_contact`). Every message carries an unsubscribe link (signed token, public page); unsubscribes and provider complaints/bounces are stored as suppressions per organization and block all later sends. Daily cap per organization by plan and a per-user throttle. Message log keeps subject and body for the sender's records.

## Data (B2a, migration 0033_crm.sql)
- `crm_contacts(id, org_id, name, company, email, phone, notes_summary?, source 'manual'|'import'|'marketplace', basis null|'existing_client'|'opted_in'|'requested_contact', import_attested_at, created_by, created_at, updated_at)`; unique `(org_id, lower(email))` where email not null; length checks on every text field.
- `crm_deals(id, org_id, contact_id, title, stage 'lead'|'proposal'|'won'|'lost', value int, currency, expected_close date, created_at, updated_at)`.
- `crm_notes(id, org_id, contact_id, body, follow_up_at, done_at, created_by, created_at)`.
- RLS select for members of the org (and platform admins); no direct writes; definer RPCs `crm_save_contact`, `crm_delete_contact`, `crm_import_contacts(org, jsonb rows, attested)`, `crm_save_deal`, `crm_add_note`, `crm_complete_note`. Role checks: members+ write, owner/admin delete. Limit check on create and import (the import imports as many as fit and reports the rest as `limit`).

## Server and UI (B2a)
- `lib/crm/csv.ts` (RFC 4180 parser, header mapping, validation), `lib/crm/service.ts` (validated inputs, throttle rule `crm` 60/min, fixed messages), actions, pages `/crm` (contacts list + search + add + import), `/crm/[id]` (details, deals, notes with follow-ups), nav "CRM" for any member. Pipeline view is a grouped list by stage (no drag and drop).

## Out of scope (B2a)
Email (B2b), custom fields, tags, merge, export, activity timeline across modules, reminders by email, shared team inbox.

## Review focus
Cross-organization reads or writes (contact ids from another org); viewer writing; duplicate email races on import and create; the limit under parallel imports; CSV edge cases (quotes, embedded newlines, BOM, formula injection `=cmd|...` in exports/echo, huge cells, wrong delimiter, header-only file); attestation missing; deleting a contact with deals and notes; a note or deal pointing at a contact of another organization.

## B2b decisions (email), 2026-10-06
Built on the rules above; these settle what they left open.
- **Enforcement in the database.** `crm_reserve_email` checks everything (flag, writer role, contact in the organization, address present, recorded basis, billing profile, suppression, daily cap) and inserts a `queued` row; the app sends only what the database reserved. `crm_mark_email` records `sent` or `failed` once, by the sender. Failed sends do not count toward the daily cap.
- **Flag and cap.** Flag `crm.email` (org override, then global; default off). Cap setting `limits.crm_emails_per_day` (default 10, professional_plus 50, business 200, enterprise 1,000), counted per UTC day. Both rows are inserted by the migration, not only the seed.
- **Basis is set explicitly** by a member or above through `crm_set_basis`; imports and manual adds start with no basis, so nothing can be emailed until someone records why.
- **Footer** is built on the server from the organization's billing profile and the recorded basis; the sender cannot edit or remove it. Plain text only. `Reply-To` is the sender's own address; `From` is the platform sender address with the organization's legal name as display name.
- **Unsubscribe.** A signed token (HMAC-SHA256 over organization id and lower-cased address, secret `CRM_UNSUBSCRIBE_SECRET`, sending is not ready without it) in a public route. GET shows a confirm form so link scanners cannot unsubscribe anyone; POST (also the RFC 8058 one-click target) stores the suppression. Messages carry `List-Unsubscribe` and `List-Unsubscribe-Post`.
- **Bounces and complaints.** Resend webhook route verifies the Svix signature and suppresses the address of the message with that provider id (`email.bounced` permanent, `email.complained`).
- **Not built:** bulk send, templates, scheduling, open or click tracking, HTML bodies, attachments.
- **Review focus (B2b):** emailing a suppressed or basis-less contact; a viewer or other organization sending; the cap under parallel sends; header injection through the subject; forged or replayed unsubscribe tokens; GET unsubscribing; footer missing or editable; webhook signature bypass; failed sends consuming quota; the flag being off yet a send succeeding.
