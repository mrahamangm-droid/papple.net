# Bookings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in clients book open slots on a professional's service page; the professional confirms or declines; either side cancels; double bookings are impossible.

**Architecture:** Migration 0043 adds settings, weekly hours, a per-service slot length and a `bookings` table with a gist exclusion constraint. Slots are computed in SQL (`booking_slots`), and `booking_request` re-checks the start against that set. The web app adds `lib/bookings` (service, presenters, ICS builder), two pages, a panel on the service page and an ICS route, all following the `lib/approvals` shape.

**Tech Stack:** Postgres 16 + btree_gist + pgTAP, Next.js 16 App Router, zod 4, vitest 5, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-papple-bookings-design.md`

## Global Constraints
- Errcodes: 42501 not allowed, 22023 invalid, 23505 duplicate or taken, 54000 limit, 55000 not pending or in the past. Users never see database text.
- All writes are SECURITY DEFINER with `search_path = public`, an explicit `p_org` and no direct table writes. RLS coverage stays clean.
- Value ranges:
  - `booking_minutes` ∈ {15, 30, 45, 60}; `buffer_minutes` 0..120; `min_notice_hours` 0..720; `horizon_days` 1..90;
  - weekday 1..7 (ISO); at most 21 windows;
  - note ≤ 1000; reason ≤ 500 (cancel needs 1..500 after trim); meeting URL `^https://` and ≤ 500;
  - slot request span ≤ 31 days.
- Notification payloads are `{booking_id, org_id}` only.
- Rate rule `bookings`: 30 per 60 s.
- Verify commands are the same as the spend approvals plan: `scripts/db-test.sh`, `scripts/db-race-test.sh`, then from `apps/web`: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Review Focus
1. Two clients request the same slot simultaneously. Expect one booking (race test, Task 1).
2. A request 1 minute off the slot grid, or in the past. Expect 22023 (pgTAP, Task 1).
3. A Europe/London schedule on the spring-forward Sunday. Expect no slot at a non-existent local time and the correct UTC instants (pgTAP, Task 1).
4. A note containing a CRLF and `END:VEVENT`. Expect the ICS to escape it, with no extra lines (vitest, Task 2).
5. A slot just after an existing booking plus its buffer. Expect it hidden inside the buffer and shown right after it (pgTAP, Task 1).

---

### Task 1: Database (0043, pgTAP 043, race case)

**Files:**
- Create: `supabase/migrations/0043_bookings.sql`
- Create: `supabase/tests/043_bookings.test.sql`
- Modify: `scripts/db-race-test.sh`

**Interfaces (produces):**
- `booking_settings_save(p_org uuid, p_enabled boolean, p_timezone text, p_buffer int, p_notice int, p_horizon int, p_hours jsonb) returns void`
  - `p_hours` is `[{"weekday":1,"start":"09:00","end":"17:00"}, …]`.
- `service_set_booking(p_org uuid, p_service uuid, p_minutes int) returns void` (`null` turns booking off).
- `booking_slots(p_service uuid, p_from timestamptz, p_to timestamptz) returns setof timestamptz`, ordered.
- `booking_request(p_org uuid, p_service uuid, p_start timestamptz, p_note text) returns uuid`
- `booking_decide(p_org uuid, p_booking uuid, p_confirm boolean, p_meeting_url text, p_reason text) returns void`
- `booking_cancel(p_org uuid, p_booking uuid, p_reason text) returns void`
- Tables:
  - `booking_settings(org_id, enabled, timezone, buffer_minutes, min_notice_hours, horizon_days, updated_at)`
  - `booking_hours(id, org_id, weekday, start_time, end_time)`
  - `bookings(id, provider_org_id, client_org_id, service_id, booked_by, starts_at, ends_at, blocked, status, note, meeting_url, reason, decided_by, decided_at, cancelled_by_org, created_at)`
  - `services.booking_minutes`

- [ ] **Step 1: Write the failing pgTAP test.** Use the prefixes `aaaaaa43-`, `cccccc43-`, `dddddd43-`.
  - **Fixture:** provider org P (owner `p`, admin `pa`, member `pm`), client org C (owner `c`, member `cm`, viewer `cv`), a second client org D (owner `d`) and a stranger `s`. One published service in P.
  - **Fixing time:** the tests run against fixed future dates. Pass explicit `p_from`/`p_to`, and set `min_notice_hours = 0` and `horizon_days = 90`. Pick dates 30–60 days after `now()`, using `date_trunc('week', now()) + interval '5 weeks'` (a Monday) as the base, so the tests don't depend on today's date.

  **Assertions:**
  1. **Settings:**
     - `pm`, `c` and `s` cannot save P's settings (42501).
     - Invalid values → 22023: timezone `Mars/Base`, buffer 121, weekday 8, start ≥ end, 22 windows.
     - `p` saves `(true, 'UTC', 0, 0, 90, [{1, 09:00, 11:00}])`.
     - `c` cannot select P's `booking_settings` (0 rows).
  2. **Service:**
     - `pm` cannot set booking minutes (42501), and 20 minutes → 22023.
     - `p` sets 30.
  3. **Slots:**
     - Base Monday 09:00–11:00 UTC → exactly 4 slots: 09:00, 09:30, 10:00, 10:30.
     - A span of 32 days → 22023.
     - An unpublished service → 22023.
     - With `min_notice_hours` large enough to pass the base Monday → none that day.
  4. **Request:**
     - `cm` requests 09:30 → uuid, status pending, and P's members are notified, with the payload keys exactly `booking_id`, `org_id`.
     - Slots now omit 09:30.
     - `d` requesting 09:30 → 23505.
     - `cv` → 42501.
     - `pm` booking from P → 42501.
     - An off-grid 09:31 → 22023.
     - A past time → 22023.
  5. **Buffer:**
     - Save buffer 30 → slots omit 10:00 (inside 09:30–10:00 plus 30), keep 10:30, and omit 09:00 (its blocked range overlaps the 09:30 booking).
     - Reset buffer to 0.
  6. **Cap:** set the limit to `{"default":1}` → a second request by C → 54000. Restore it to 5.
  7. **Decide:**
     - `c` cannot decide (42501).
     - A meeting URL `http://x` → 22023.
     - `pm` confirms with `https://meet.example/x` → confirmed, and C is notified.
     - Confirming again → 55000.
  8. **Cancel:**
     - `s` → 42501; `cv` → 42501; an empty reason → 22023.
     - `c` cancels with a reason → cancelled, P notified, and 09:30 offered again.
     - Cancelling again → 55000.
  9. **Expired:** an inserted pending booking in the past (superuser), then `pm` confirms → 55000.
  10. **Decline:** a new request, `p` declines with a reason → declined, and the slot is free.
  11. **Daylight saving:** P timezone `Europe/London`, window Sunday 00:30–02:30. On the last Sunday of March in the next year that falls after the base date, slots should be 00:30 (00:30Z) and 02:00 (01:00Z), and nothing at local 01:00–01:59.
      - Compute that date in SQL. If the test date is not in the future, pick the following year.
      - Assert the exact UTC instants returned.
  12. **Visibility and access:**
      - D sees 0 of C's bookings, and `s` sees 0.
      - `p` cannot read the `booked_by` column (`throws_ok` select `booked_by` → 42501).
      - Direct insert, update or delete on `bookings` → 42501.
  13. **Audit:** rows exist for `booking_settings.save`, `booking.request`, `booking.confirm`, `booking.cancel` and `booking.decline`.

- [ ] **Step 2: Run it to see it fail.** Run `bash scripts/db-test.sh`. Expected: 043 fails (functions missing); the others pass.

- [ ] **Step 3: Write `0043_bookings.sql`.**
  - **Slot algorithm (a SQL function body):**
    1. Generate dates from `(p_from at time zone tz)::date` to `(p_to at time zone tz)::date`.
    2. Join the windows on `isodow`.
    3. Generate local starts `d + start_time + k*len` while `start + len <= end_time`.
    4. Convert with `(local_ts at time zone tz)` and keep only the instants where `(instant at time zone tz) = local_ts` (this drops non-existent times).
    5. Filter to `[greatest(p_from, now() + notice), least(p_to, now() + horizon))`.
    6. Drop any instant where an active booking's `blocked && tstzrange(s, s + len + buffer)`. Strictly, compare `tstzrange(s, s + len)` to `blocked` and also `tstzrange(s, s + len + buffer)` to `tstzrange(b.starts_at, b.ends_at)`, so the buffer works on both sides.
  - **`booking_request`:**
    - Lock `pg_advisory_xact_lock(hashtextextended('booking:'||provider_org,0))`.
    - Check `p_start` is in `booking_slots(...)` for `[p_start, p_start + 1 minute)`.
    - Insert with `blocked = tstzrange(start, end + buffer)`.
    - Catch `exclusion_violation` and raise 23505.
  - **The rest:** settings and hours are replaced atomically in `booking_settings_save`. Grants and RLS follow 0041.

- [ ] **Step 4: Run the suite.** Run `bash scripts/db-test.sh`. Expected: all pass, with RLS coverage OK.

- [ ] **Step 5: Add the race case.** A provider with a 30-minute service and settings; 6 different client orgs request the same slot in parallel → `count(*) = 1`. Run `bash scripts/db-race-test.sh`. Expected: PASSED.

- [ ] **Step 6: Commit** with the message "Bookings: migration 0043, pgTAP and race tests".

### Task 2: Library, rate rule, server actions

**Files:**
- Create: `apps/web/src/lib/bookings/{present,ics,service}.ts` and their tests
- Modify: `lib/ratelimit.ts` (`bookings: { limit: 30, windowSec: 60 }`), `lib/server.ts` (`bookingsService`)
- Create: `app/(app)/booking-actions.ts`

**Interfaces (produces):**
- `type BookingFailure = "forbidden"|"invalid"|"taken"|"limit"|"stale"|"rate"|"error"`
- `createBookingsService(deps)`, with deps as in approvals. It returns:
  - `saveSettings(raw)`: `{orgId, enabled, timezone, bufferMinutes, noticeHours, horizonDays, hours:[{weekday,start:"HH:MM",end:"HH:MM"}]}`
  - `setServiceBooking(raw)`: `{orgId, serviceId, minutes: 15|30|45|60|null}`
  - `slots(raw)`: `{serviceId, from: ISO, to: ISO}` → `{ok:true, slots: string[] ISO}`. A non-string row → `error`.
  - `request(raw)`: `{orgId, serviceId, start: ISO, note}` → `{ok:true, id}`
  - `decide(raw)`: `{orgId, bookingId, confirm, meetingUrl, reason}`
  - `cancel(raw)`: `{orgId, bookingId, reason}`
  - Code mapping: 42501 → forbidden, 22023 → invalid, 23505 → taken, 54000 → limit, 55000 → stale. Revalidate `/bookings`.
- `present.ts`:
  - `bookingStatusLabel(status, startsAt, now)`: "Expired" for pending in the past;
  - `bookingFailureMessage(code)`;
  - `bookingNotificationCopy(type, payload) → {text, href: "/bookings?org=<org_id>"}`, with no amounts or names;
  - `groupSlotsByDay(isoSlots, timeZone) → [{day: "YYYY-MM-DD", label, slots:[{iso, time}]}]`.
- `ics.ts`: `buildIcs({uid, start: Date, end: Date, title, description, url?, now: Date}) → string`.
  - CRLF line endings; `DTSTART`, `DTEND` and `DTSTAMP` as UTC `YYYYMMDDTHHMMSSZ`.
  - Escape `\`, `;`, `,` and newlines in text, and fold lines longer than 75 octets.

- [ ] **Step 1: Write failing tests.**
  - **ics:** a note with `"a\r\nEND:VEVENT\r\nX"` yields exactly one `END:VEVENT` line; commas and semicolons are escaped; the times are formatted as UTC; every line ends with `\r\n`.
  - **present:** expired logic; `groupSlotsByDay` splits on the local midnight for `Asia/Tokyo`; the notification copy has no digits.
  - **service:**
    - invalid inputs (minutes 20, `http://` URL, a 32-day span, `HH:MM` out of range) are refused before any rpc call;
    - the code mapping;
    - `slots` returns the ISO strings;
    - rpc args are snake_case: `p_hours` as `[{weekday,start,end}]`.
- [ ] **Step 2: Run them to see them fail.** Run `pnpm -C apps/web exec vitest run src/lib/bookings`. Expected: FAIL.
- [ ] **Step 3: Implement**, plus the rate rule, the server wiring and the actions file.
- [ ] **Step 4: Run again.** The same command plus `typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Bookings: library, ICS, rate rule and server actions".

### Task 3: Pages, panel, ICS route, nav, e2e, docs

**Files:**
- Create: `app/(app)/bookings/page.tsx`, `app/(app)/settings/bookings/page.tsx`, `components/bookings/{BookingForms,BookingPanel}.tsx`, `app/api/bookings/[id]/ics/route.ts`, `e2e/bookings-anonymous.spec.ts`, `docs/acceptance-bookings.md`
- Modify: `app/(public)/services/[slug]/page.tsx` (render `BookingPanel` when `booking_minutes` is set; it needs `booking_minutes` in the public service data, so add it to the service card RPC or read it separately), `lib/route-gate.ts` and its test (`/bookings`), `lib/rbac.ts` and its test (Bookings for members; settings stays under `/settings`), `app/(app)/notifications/page.tsx`, `README.md`, `docs/PROJECT_STATUS.md`, `docs/PROJECT_AUDIT.md` (bookings row PARTIAL)

- [ ] **Step 1: Write failing tests:** route-gate (`/bookings` protected, `/bookingsx` public) and rbac (Bookings for every member, not without a membership).
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - The ICS route: auth through `createServerSupabase`, select the booking (RLS), 404 unless confirmed, and `Content-Disposition: attachment; filename="booking.ics"`.
  - The panel loads slots client-side through `bookingSlotsAction` for a 14-day window, and shows `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- [ ] **Step 4: Full verification:** DB, race, lint, typecheck, test, build, and Playwright anonymous e2e.
- [ ] **Step 5: Commit** with the message "Bookings: pages, booking panel, ICS route, nav, e2e and docs".
