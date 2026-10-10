# Bookings (slice 1) — acceptance record

Run date: 2026-10-10 · Branch: `claude/vibrant-noether-6e5n36`. Design approved by the owner in chat ("yes"); spec and plan reviews delegated.
Legend: **VERIFIED** = observed passing in this session · **NOT VERIFIED** = needs live Supabase Auth or real accounts.

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Settings and weekly hours: owners and admins only; time zone, gap, notice, horizon and windows validated; other orgs cannot read them | **VERIFIED (pgTAP)** | `043_bookings.test.sql` |
| 2 | Per-service slot length (15/30/45/60) by owners and admins; `booking_offer` tells anyone whether a published service takes bookings | **VERIFIED (pgTAP)** | same |
| 3 | Slots: windows stepped by the slot length, horizon cut-off, gap applied around existing bookings, 31-day span limit, unpublished services refused | **VERIFIED (pgTAP)** | same |
| 4 | Daylight saving: on the spring-forward night (Europe/London) local 01:00-01:59 is skipped and the UTC offset moves | **VERIFIED (pgTAP)** | `booking_candidates` case |
| 5 | Requests: exact slot only (off-grid and past refused), no self-booking, viewers refused, daily cap counting every request in 24 hours (cancelling does not reset it), a held slot answers "just taken"; suspended organizations and private or hidden profiles cannot be booked | **VERIFIED (pgTAP)** | same |
| 6 | Confirm or decline (https meeting links only), cancel with a reason by either side; a past pending booking cannot be confirmed; declined and cancelled bookings free their slot | **VERIFIED (pgTAP)** | same |
| 7 | Six clients requesting the same slot at once get exactly one booking | **VERIFIED (race)** | `scripts/db-race-test.sh` case 24 |
| 8 | Third orgs see nothing; who booked is not readable; no direct writes; notifications carry only ids; all changes audited | **VERIFIED (pgTAP)** | same |
| 9 | Calendar file escaping and folding, slot grouping by local day, notification copy, input validation and error mapping | **VERIFIED (unit)** | `lib/bookings/*.test.ts` |
| 10 | `/bookings`, `/settings/bookings` and the calendar-file route refuse signed-out visitors; build, types and lint clean | **VERIFIED (e2e anonymous + build)** | `e2e/bookings-anonymous.spec.ts` |
| 11 | The screens signed in: setting hours, the picker on a service page in two time zones, confirming with a link, cancelling, the calendar file in Google/Outlook/Apple | **NOT VERIFIED** | Needs live Supabase Auth and two test accounts (staging run-through) |

## Known limits
- Free bookings only; payment goes through the existing proposal and contract flow.
- No calendar sync, reminders, rescheduling (cancel and rebook), date-specific exceptions or recurring bookings.
- The bookings list shows times in the viewer's browser time zone; email notifications carry no time (by design, no personal data in email).
- The professional's own organization appears in "Book for" if the professional is signed in; the database refuses the request with "not allowed".

## Review fixes applied (same migration 0043, before merge)
- Lowering the gap no longer leaves slots that always fail: the slot list also honours each booking's stored gap (what the no-overlap rule checks).
- Bookable only while the service is publicly listed (`booking_listed`, the same rule as public service cards), for `booking_offer`, `booking_slots` and `booking_request`.
- The existing-bookings scan is limited to the requested window through the no-overlap rule's index: the worst case allowed by the settings (21 all-day windows, 15-minute slots, 31 days, 3,000 past bookings) went from 10.7 s (reviewer's measurement) to 18 ms.
- The daily cap counts every request made in 24 hours, so cancel-and-rebook cannot flood a professional.
- Calendar files escape semicolons (`\;`), as RFC 5545 requires; the test checked the wrong string before.
- The bookings list really switches to the viewer's time zone after loading (`useSyncExternalStore`), instead of keeping the server's UTC text.

## Deferred (minor, from the branch review)
- Requesting a past grid slot that an old booking covers answers "just taken" instead of "not available".
- The calendar-file route looks bookings up in the 500 most recent; an older confirmed booking answers 404.
- A real slot hidden by a later booking's gap answers "not available" rather than "just taken" (wording only).
- A suspended organization's bookings page reads as empty instead of explaining access.
