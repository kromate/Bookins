# Bookins: platform engine requests

Owner: Goalmatic platform team (`backend/functions/src/apps/booking/runtimeService.ts`).
Source: audits 01-engine.md and 04-platform.md, 2026-10-06. Bookins cannot fix these in-repo.

## Correctness (do first)

1. **Atomic overlap on create.** Create re-reads openings then writes; only the exact-start `reservation_key` is unique. Overlapping-but-different starts (after the owner changes interval/windows, or on DST days) can both commit under concurrency. Enforce overlap inside the same transaction, or reserve every interval bucket the booking covers.
2. **Busy set truncation.** `listRecords` stops after 10 pages (~2000 rows) including past and cancelled bookings, so overlap checks silently miss later rows. Filter to `ends_at >= now` and non-cancelled server-side, or page to completion and fail closed.
3. **Idempotent create.** A retry with the same idempotency key after a lost response returns `BOOKING_SLOT_TAKEN` for the guest's own booking. Return the original booking when the key matches. Also map only the `reservation_key` uniqueness violation to SLOT_TAKEN, not every "must be unique" error.
4. **DST overlap.** With interval == duration (e.g. 90 min) on a spring-forward day, generated openings can overlap each other. Skip openings that overlap an earlier generated opening on the same day.
5. **Date validation.** `isoDate` accepts impossible dates like `2026-02-31`.

## Competitive features (need engine support to be honest)

| Feature | Engine change |
| --- | --- |
| Calendar busy-check at create | Call `integrations.google-calendar.availability` for the owner inside `booking.create` and `openings-list`. The guest page already hides busy times client-side (`calendar-busy` action), but that is not authoritative. |
| Buffers before/after | Schedule fields `buffer_before_minutes` / `buffer_after_minutes`; expand busy ranges and openings accordingly. |
| Date overrides / time off | `date_overrides_json` on schedules (closed dates, custom windows per date). |
| Duration longer than slot interval | Drop the `duration <= interval` rule once (1) makes overlap authoritative. |
| Guest cancel / reschedule | New guest actions bound to a per-booking token. |
| Reminders / follow-ups | A delay or scheduled-per-record workflow node; today there is no delay node. |
| Guest confirmation email | Owner alert ships via workflow; guest recipient mapping in `SEND_EMAIL` from App workflows is unproven. |
| Per-service links | `subjectAllowsService` already supports `{kind:'service'}`; needs owner UI plus manifest work in Bookins only. |
| Branding on guest page | `page-get` should return accent/logo fields once profiles store them. |
| Horizon in `page-get` | Expose `bookingHorizonDays` so the guest calendar can bound navigation. |
