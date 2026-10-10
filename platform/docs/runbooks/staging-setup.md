# Staging setup (owner steps)

Three steps only the owner can do, in this order. Secrets go straight into the Vercel, Supabase and GitHub screens. Never paste them into chat, issues, commits or logs.

## 1. Vercel: connect the app to the staging database (about 5 minutes)

Supabase → project **papple-staging** → Project Settings → API: copy the Project URL, the `anon` key and the `service_role` key.

Vercel → project **papple-staging** (and **papple-platform** if you keep both) → Settings → Environment Variables. Add each for **Preview** (and Production on the staging project):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` key |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key (server only; never expose it in browser code) |
| `NEXT_PUBLIC_SITE_URL` | the staging address, for example `https://papple-staging.vercel.app` |

Supabase → Authentication → URL Configuration: set **Site URL** to the same address and add `<address>/auth/callback` to the redirect URLs.

Then Vercel → Deployments → the latest one → **Redeploy**, so the new variables are picked up. Other services can wait. Without the Stripe keys, checkout shows as unavailable. Without Resend, no email goes out. Without Anthropic, the AI buttons are hidden. Without Sentry or PostHog, nothing is reported. **R2 is the exception:** file uploads and downloads (contract files, portfolio images) fail until `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` are set. Everything else works without them. See `docs/secrets.md` for the full list.

## 2. Database: bring staging up to date (about 10 minutes)

Staging has migrations 0001-0039 loaded by hand (verified 2026-10-09). 0040 (work and files), 0041 and 0042 (spend approvals), 0043 (bookings) and 0044 (paid bookings, once merged) are pending.

**One-time setup.** GitHub → repository Settings → Environments → **New environment** `staging`, then add three secrets:

- `SUPABASE_ACCESS_TOKEN`: Supabase → Account → Access Tokens → Generate.
- `SUPABASE_PROJECT_REF`: the id in the staging project's URL (`supabase.com/dashboard/project/<ref>`).
- `SUPABASE_DB_PASSWORD`: the database password (Project Settings → Database; reset it there if unknown).

Create a `production` environment the same way later, with **Required reviewers** switched on.

**Run it.** GitHub → Actions → **platform-migrations** → Run workflow, environment `staging`:

1. Choose mode `dry-run`, then read the "Run" step. If it lists only `0040` and later (up to `0044`), go to 3. If it lists `0001` and up, the hand-loaded history was not recorded: go to 2.
2. Run again with mode `mark-applied` and `through` set to `0039`. This only records that 0001-0039 are already there (it changes no tables). Its output must now list only 0040 and later.
3. Run again with mode `apply`. It applies 0040 onwards (through 0044) and prints each one.

If `apply` fails, nothing after the failing migration runs. Copy the error from the log and stop; do not retry blindly.

## 3. Run-through with two test accounts (about 20 minutes)

Use two email addresses you control. Sign up as **A** (client) and **B** (professional) on the staging address.

**Setup.**
- A creates an organization. In Settings → Team, A invites a third address **C** as **admin**, and C accepts.
- B creates a professional profile and finishes payout onboarding in Stripe test mode (needs the Stripe test keys). Without them, everything up to activation still works.

**Spend approvals.**
1. A (owner) opens Settings → Approvals and sets the rule to **100.00 USD**. Expect: "Contracts of $100.00 or more … need an owner's approval".
2. A posts a project. B sends a proposal for **150 USD**. A shortlists it, then hires B.
3. Set the milestones to add up to 150. B accepts the terms.
4. **C** (admin) clicks **Accept terms**. Expect: "Sent to your organization's owners for approval", and the contract page shows **Awaiting owner approval**. A gets a notification.
5. A opens **Approvals**. Expect: the request with the price and C as requester, and no Approve button for C.
6. A clicks **Approve**. Expect: the request moves to Recent decisions as approved, the contract shows the client side accepted, and C is notified.
7. Repeat with a second contract and **Reject** it with a reason. Expect: C sees the reason under Approvals.
8. Repeat once more, but have B change the milestones after C accepts. Then A approves. Expect: "The terms changed after this request was made, so it lapsed".

Note anything that differs from "Expect" with the time and a screenshot. The other checklist items marked "Owner + Claude" in `docs/launch-checklist.md` use the same two accounts.
