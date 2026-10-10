# PAPple bookings — design (bookings slice 1)

Status: design approved by the owner in chat on 2026-10-10 ("yes"), after "do your best" delegated the choice of feature. The spec and plan reviews are delegated, as for spend approvals.

## Goal
A signed-in client books a time slot (for example a 30-minute intro call) with a professional straight from a service page. The professional confirms or declines, and either side can cancel. No messages back and forth to find a time.

## Understanding
- **Said:** unpaid bookings in v1. The professional sets weekly hours in their time zone, a slot length (15/30/45/60 minutes), a gap between calls, minimum notice and how far ahead people can book, and switches bookings on per service. Clients see open slots in their own time zone. Bookings start as pending; the professional confirms (with an optional meeting link) or declines; either side cancels with a reason; a pending booking whose time has passed shows as expired. The database rules out double bookings. A daily cap on pending bookings per client. Notifications, an "add to calendar" file, settings, a bookings list and a slot picker.
- **Ruling: availability belongs to the provider organization** (one schedule), and the slot length belongs to each service. One person or agency has one calendar; different services can have different lengths. Cost if wrong: a per-service schedule is one extra table later.
- **Ruling: "expired" is derived, not stored.** It means pending and `starts_at <= now()`. That needs no job and no extra state. An expired booking no longer blocks anything, because only future slots are offered.
- **Ruling: the gap applies after each booking.** It is stored as a `blocked` range `[starts_at, ends_at + gap)`, and the exclusion constraint works on that range.
- **Success:** two clients clicking the same slot at the same moment get one booking and one "just taken" message, even when calling the database directly. Times are right across daylight-saving changes. A professional never sees another organization's bookings.

## Non-goals (later)
Payment, calendar sync (Google/Outlook), group sessions, recurring bookings, reminder emails, rescheduling (cancel and rebook instead), per-service schedules, date-specific exceptions (holidays: switch bookings off or cancel).

## Rules
- **Settings** (provider org owners and admins):
  - `enabled`;
  - `timezone` (an IANA name that Postgres knows);
  - `buffer_minutes` 0..120;
  - `min_notice_hours` 0..720;
  - `horizon_days` 1..90;
  - weekly hours: up to 21 windows of (weekday 1..7 ISO, start time, end time), with start < end.
- **Per service:** `booking_minutes` in {15, 30, 45, 60}, or null when the service can't be booked. Set by the provider org's owners and admins.
- **Slots** for a published, bookable service whose org has bookings enabled:
  - For each date in the provider's time zone, each window is stepped by `booking_minutes` from its start. A slot must end within the window.
  - Local times are converted with Postgres time zone rules. A local time that doesn't exist (the spring-forward gap) is skipped. An ambiguous one (fall-back) uses Postgres's choice, so it appears once.
  - Offered only when `starts_at >= now() + min_notice` and `starts_at < now() + horizon`, and when `[starts_at, ends_at + buffer)` doesn't overlap the blocked range of any pending or confirmed booking for that provider org.
  - Requests may span at most 31 days.
- **Request** (an owner, admin or member of the client org):
  - The caller must not belong to the provider org.
  - `p_start` must be exactly an offered slot, and the note is ≤ 1000 characters.
  - The client org may have at most `limits.bookings_pending_per_day` pending bookings created in the last 24 hours (default 5, null = unlimited).
  - A race on the same slot loses at the exclusion constraint and is reported as 23505.
  - The provider org is notified.
- **Decide** (an owner, admin or member of the provider org): only while pending and in the future.
  - Confirm, with an optional meeting URL (`https://` only, ≤ 500 characters).
  - Decline, with an optional reason (≤ 500 characters).
  - The client org is notified.
- **Cancel** (a member of either org, any role except viewer): pending or confirmed, in the future, reason 1..500 characters. The other org is notified.
- **Statuses:** `pending → confirmed | declined | cancelled`, and `confirmed → cancelled`. A cancelled or declined booking frees its slot.
- **Suspended orgs** lose `has_org_role` (existing behavior), so they can't act.

## Data (migration 0043)
- `create extension if not exists btree_gist with schema extensions`.
- `booking_settings(org_id pk, enabled, timezone, buffer_minutes, min_notice_hours, horizon_days, updated_at)` and `booking_hours(id, org_id, weekday, start_time, end_time)`.
  - Readable by signed-in users only through `booking_slots`. The provider org's members read the rows directly.
- `services.booking_minutes int null check (booking_minutes in (15,30,45,60))`.
- `bookings(id, provider_org_id, client_org_id, service_id, booked_by, starts_at, ends_at, blocked tstzrange, status, note, meeting_url, reason, decided_by, decided_at, cancelled_by_org, created_at)`.
  - `exclude using gist (provider_org_id with =, blocked with &&) where (status in ('pending','confirmed'))`.
  - Select: members of either org. `booked_by` and `decided_by` are not readable by the other side (column grants).
- Setting `limits.bookings_pending_per_day` `{"default":5}`.
- RPCs (SECURITY DEFINER, `search_path = public`, explicit `p_org`, errcodes 42501 / 22023 / 23505 / 54000 / 55000 for not-pending-or-past):
  - `booking_settings_save(p_org, p_enabled, p_timezone, p_buffer, p_notice, p_horizon, p_hours jsonb)`;
  - `service_set_booking(p_org, p_service, p_minutes)`;
  - `booking_slots(p_service, p_from timestamptz, p_to timestamptz) returns setof timestamptz`;
  - `booking_request(p_org, p_service, p_start, p_note) returns uuid`;
  - `booking_decide(p_org, p_booking, p_confirm, p_meeting_url, p_reason) returns void`;
  - `booking_cancel(p_org, p_booking, p_reason) returns void`.
  - Each write is audited (`booking_settings.save`, `booking.request|confirm|decline|cancel`).
- Notifications: `booking_requested`, `booking_confirmed`, `booking_declined`, `booking_cancelled`. The payload is `{booking_id, org_id}` (org_id = the recipient's org), with no names or notes.

## Server and UI (apps/web)
- `lib/bookings/`:
  - `present.ts`: status labels including derived "Expired", notification copy, slot grouping by local day.
  - `ics.ts`: builds an RFC 5545 VEVENT for a confirmed booking, with fixed fields and escaped text.
  - `service.ts`: validators and the RPC-backed actions, with codes `forbidden | invalid | taken | limit | stale | rate | error`.
- Rate-limit rule `bookings`: 30 per minute per user.
- Server actions: `saveBookingSettingsAction`, `setServiceBookingAction`, `bookingSlotsAction`, `requestBookingAction`, `decideBookingAction`, `cancelBookingAction`.
- Pages and components:
  - **`/settings/bookings`** (provider owners and admins): the settings form, the weekly hours editor, and the services list with a slot-length select.
  - **`/bookings`**: tabs "Requests to me" (provider orgs) and "My bookings" (client orgs), each upcoming then past. Confirm, Decline, Cancel and "Add to calendar" appear where allowed.
  - **Service page:** a `BookingPanel` for signed-in users when the service is bookable. It shows a 14-day strip with slots shown in the browser's time zone, the time zone name, an org picker (existing `eligibleOrgs`), a note, and a Request button. Visitors see "Sign in to book".
  - **`GET /api/bookings/[id]/ics`**: signed-in only. Reads through RLS and serves only confirmed bookings, as `text/calendar`.
- Navigation: "Bookings" for every member. `/bookings` is added to `route-gate.ts`.

## Tests
- **pgTAP (`043_bookings.test.sql`):**
  - Settings and service validation and access.
  - Slots: window stepping, the notice and horizon cut-offs, buffer, an existing booking hiding overlapping slots, a span over 31 days refused, an unpublished or unbookable service refused.
  - Daylight saving: a Europe/London window on the spring-forward date skips 01:00–02:00 local, and the UTC offset changes across the change.
  - Requests: an off-grid start refused, self-booking refused, a viewer refused, the daily cap, and the same slot twice → 23505.
  - Decide and cancel permissions and states; an expired pending booking can't be confirmed (55000).
  - Visibility to a third org, column privacy, no direct writes, notifications without notes, audit rows.
- **Race:** 6 clients request the same slot in parallel, and exactly 1 booking exists.
- **vitest:** the ICS builder (escaping, UTC format, CRLF), presenters (expired, grouping by local day across midnight), and service error mapping (23505 → taken, 55000 → stale).
- **e2e:** anonymous visitors to `/bookings` and `/settings/bookings` are sent to sign-in; anonymous ICS → 401 or redirect.

## Review focus
- Double booking under races or a buffer edge.
- An off-grid or past start accepted.
- Time zone and daylight-saving errors.
- The provider seeing a client's private fields, or a third org seeing anything.
- ICS injection through notes or titles.
- A cancelled or declined booking still blocking its slot.
- `booking_slots` used to scrape another org's private schedule details beyond free times.
