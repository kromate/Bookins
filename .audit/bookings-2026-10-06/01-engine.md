# Bookins scheduling/collision engine audit (2026-10-06)

Read-only audit. Hosted = `runtimeService.ts` (RT) in `.audit/plugin-publishing-2026-10-01/runtime-source/backend/functions/src/apps/booking/`; local = `booking.js` (BK); demo = `demo/adapter.js` (AD). Harness: `.audit/bookings-2026-10-06/scripts/engine-parity.mjs` (run `node engine-parity.mjs`; it re-spawns itself under TZ=Africa/Lagos, UTC, America/New_York, Pacific/Auckland). Logic is copied, not imported; the hosted reference uses Intl instead of date-fns-tz.

Bottom line: the hosted engine is sound for guest safety. Past, out-of-window, off-grid, beyond-horizon, inactive and private-service bookings are all rejected, because create re-runs the full opening generator and requires an exact `startsAt` match (RT:319-326). The weaknesses are non-atomic overlap protection, silent truncation, and idempotency. The local preview and demo engines diverge from hosted in many ways. Local is the worst: its submit path validates nothing.

## High

**H1. Local preview `submitGuestBooking` does no opening re-validation (BK:413-444).**
- It checks only exact `reservation_key` equality. It never checks window, grid, past, horizon, notice, overlap, service existence or visibility, schedule active, or contact format. Hosted checks all of these at RT:312-333.
- `service.duration_minutes` at BK:426 throws a TypeError for an unknown service.
- Harness T5, T6b: all four of past, out-of-window, off-grid and beyond-horizon are accepted, and an overlapping 09:30Z start is accepted against a 09:00-10:00 booking.
- Impact: local verification gives false confidence. A guest calling the exported function from the console on localhost can create invalid bookings. This is localhost only and gated by `isLocalPreview`.
- Fix (in-repo): factor the opening generator into a pure shared module. Have local submit call it, find the exact `startsAt`, and reject otherwise. Validate contact the same way RT does.

**H2. Local preview slot generation uses browser-local time, not the schedule timezone (BK:374-391).**
- `new Date('YYYY-MM-DDT00:00:00')`, `date.getDay()` and `setHours` all use the browser zone. The schedule timezone is only echoed back.
- Harness T1: with a Lagos schedule, local slots equal hosted only when the browser is in Lagos. Under UTC the first slot is 09:00Z instead of 08:00Z. Under New York it is 13:00Z. Under Auckland it is the previous day 20:00Z.
- `Book.vue` renders in the profile timezone (`displayTimeOptions`), so a non-Lagos developer sees slots at wrong wall-clock times and on wrong weekdays.
- DST (T8): under America/New_York on 2027-03-14, nonexistent local times shift forward in `setHours`. The harness found 2 duplicate `startsAt` values out of 6, which would give duplicate Vue keys at `Book.vue:387`.
- `localDate` is `toISOString().slice(0,10)` (BK:405). For a 00:00 Lagos slot it is 2026-10-06 where hosted gives 2026-10-07 (T2). `localDate` is not used by `Book.vue` today, but the contract differs.
- Fix (in-repo): reuse the hosted algorithm (wall-clock to instant via `Intl`, skipping nonexistent times, weekday from the date string at noon UTC) and emit `localDate` and `localTime` in the schedule zone.
- Fixture seed times (BK:19-25 `nextWorkingDay`) also use browser-local weekday and 10:00, so the sample bookings may not fall on the Lagos grid.

## Medium

**M1. Hosted overlap protection is read-then-write, not atomic (RT:310-358).**
- The only database-enforced constraint is `reservation_key` uniqueness (`preventDuplicates`, manifest bookings table). Key `scheduleId|startsAtISO` (RT:140) only stops identical start instants.
- Overlap is checked only against a snapshot (`bookingState`, called twice, RT:310 and via 320), so there is a TOCTOU window.
- While the grid is stable (every start is `window.start + k*interval` and `duration <= interval`), distinct starts cannot overlap, so the key is enough. Overlapping starts become possible when:
  - (a) the owner changes interval or windows with future bookings on the old grid. Example: a 60-min booking 09:00-10:00, then interval 30 with a 30-min service allows 09:30. The harness (T6) shows the list correctly hides 09:30 sequentially, but two concurrent creates, or a create racing a stale snapshot, would both succeed because the keys differ.
  - (b) DST (see M2).
- Fix (platform): add a per-slot-bucket lock, or write one reservation row per grid cell covered. Re-check overlap after insert and roll back. Also consider rejecting interval/window edits that strand future bookings.

**M2. Hosted DST: openings can overlap each other (model, harness T9).**
- `wallClockInstant` (RT:126-133) correctly skips nonexistent times and takes the first of ambiguous ones. Slot ends are real elapsed minutes (RT:181).
- With interval == duration == 90 on a US spring-forward day (America/New_York 2027-03-14, window 00:00-06:00), 01:30 EST + 90 min ends at 04:00 EDT and overlaps the 03:00 EDT slot.
- Both are listed. Sequential booking is safe via the busy check; concurrent booking is not (M1).
- Impact is low for Africa/Lagos-style zones without DST. Casablanca and Cairo have DST.
- Fix (platform): drop candidates whose start is before the previous accepted slot's end.

**M3. Hosted busy set is silently truncated (RT:197-212, 234-239).**
- `listRecords` reads at most 10 pages of 200 records, so 2000 records, with no completeness signal.
- It counts past and cancelled bookings too (cancellation keeps the row). Once a table holds more than 2000 rows, future bookings may be missing from the busy set, assuming the list order is not newest-first.
- Overlap detection then fails silently; only the exact-key check remains. The owner side (`BK:156-164`) enforces `complete === true`, so the two are inconsistent.
- Fix (platform): query only future, non-cancelled bookings for the schedule, or fail closed when truncated.

**M4. Idempotency and retry (Book.vue ~145-153, RT:336).**
- The client generates a fresh `crypto.randomUUID()` per submit click, so a retry after a lost response is a new request. The slot is now busy, so the guest gets `BOOKING_SLOT_TAKEN` even though their own booking exists.
- Server `reference` is a hash of `accountId:idempotencyKey` (40 bits). A same-key replay hits the `reference` unique constraint, and the regex `/must be unique/` at RT:370 maps it to "slot taken".
- Whether the platform dedupes by `idempotencyKey` upstream is not visible in this snapshot (`context.idempotencyKey`, `types.ts:75`).
- Fix (in-repo): mint one key per (service, slot, form attempt) and reuse it on retry. Fix (platform): replay the stored result for an identical key; distinguish a reference collision from a reservation-key collision instead of regex-matching error text.

**M5. `Book.vue` hides most openings (Book.vue:121-126).**
- It requests 7 days then does `openings.slice(0, 32)`. With a 60-min interval and 9-17 windows there are 8 slots per weekday, so 32 slots is only 4 days. A 30-min interval shows about 2 days.
- The remaining days are unreachable except by moving the date picker. This is a guest-facing availability bug, not an engine bug.
- Fix (in-repo): group by day and paginate or show per-day counts instead of truncating.

**M6. Local and demo diverge from hosted on guard rules (table below).**
- Local and demo ignore `booking_horizon_days` (T3: 24 slots vs hosted 0 for a date 56 days out with a 14-day horizon).
- They also ignore `schedule.active`, `service.active` (local only checks it in the page list), and `schedule_id` on the busy filter (BK:373, AD:40).
- Fix (in-repo): share the engine module (see H1) between local and demo.

## Low

- **L1. Demo hard-codes UTC (AD:41-48).** Fixtures use `timezone: 'UTC'` (fixtures.js:32,40), so it is currently correct. Any non-UTC dataset gives wrong slots (T1b: first slot 09:00Z vs hosted 08:00Z for a Lagos schedule). Demo also has no range cap and no hosted-style `localTime`.
- **L2. Per-day cap granularity.** The cap is checked in the outer day loop only (RT:174 at 200, BK:379 at 100, AD at 100 breaks mid-day). A single day can exceed it (T11: 288). It is silent: later days are dropped without a "truncated" flag. A 5-min, 24h schedule could never offer slot 201+ of a single day for create, since create also lists through the same generator.
- **L3. `isoDate` accepts impossible dates (RT:72-78, T10).** `2026-02-31` passes (`Date` rolls to 03-03), so the range starts a few days later than requested. Harmless to safety.
- **L4. Contact validation comes after the slot check (RT:328).** Invalid contact still costs a table read, and the error order is odd. Minor.
- **L5. Corrupt `starts_at`/`ends_at` rows are silently dropped from busy (RT:286-290).** The row stops blocking time.
- **L6. Local `timezone` of a new booking is `schedules[0].timezone` (BK:436)**, not the service's schedule. Hosted uses the opening's schedule timezone.
- **L7. Local and demo do not validate windows or intervals.** Overlapping windows would duplicate openings; hosted rejects them (RT:116-124). `interval` NaN or non-multiple-of-5 is not validated.
- **L8. Cross-schedule double-booking.** Busy is per `schedule_id`. The UI only uses `schedules[0]`, so this is latent, but two schedules for one person would not collide.
- **L9. Minimum notice and horizon are measured from the server `now` per request**, so a slot can pass notice between list and create. Create re-validates, so it surfaces as `BOOKING_SLOT_TAKEN` with a generic message.

## Confirmed correct (hosted)

- Weekday is computed from the calendar date at noon UTC (RT:176), so it is zone-independent and correct. `localDate` and `localTime` are taken in the schedule zone (RT:319, 189).
- The notice clamp is `>= 0` and the horizon is clamped to 1-365 days, with a missing horizon defaulting to 60. Past times can never be listed or booked.
- Windows are validated and non-overlapping on read. Duration must be a 5-minute multiple and `<= interval`.
- `subjectAllowsService`: the profile subject only exposes public services; the service subject only its own. Inactive service or schedule gives 404/409.
- Cancel sets `reservation_key = released:<id>`, which frees the exact key (RT:397). Cancelled rows are excluded from busy (RT:284). Cancel is idempotent (RT:387).
- Guest-controlled `startsAt` is normalized through ISO and matched to a generated opening (RT:325).

## Divergence matrix

| Rule | Hosted | Local (BK) | Demo (AD) |
|---|---|---|---|
| Schedule timezone | Yes (Intl) | No (browser) | UTC only |
| Weekday zone | Date string, noon UTC | Browser | UTC |
| `localDate` | Schedule zone | UTC date | UTC date (= schedule zone only for UTC) |
| `localTime` | Yes | Absent | Absent |
| Skip nonexistent DST times | Yes | No (duplicates) | N/A |
| Horizon | Yes | No | No |
| Schedule/service active | Yes | Partly | No |
| Private service | Yes | Page filter only | Page filter only |
| Window overlap validation | Yes | No | No |
| Range cap | 31 days | None | None |
| Opening cap | 200 (per-day granularity) | 100 | 100 |
| Busy scoped by schedule | Yes | No | No |
| Create re-validates opening | Yes | No | Read-only |
| Contact validation | Yes | No | N/A |

## Harness results (53 FAIL lines across 4 TZ runs)

Under TZ=Africa/Lagos: 5 pass, 13 fail. Under UTC: 5 pass, 13 fail. Under America/New_York: 4 pass, 14 fail. Under Pacific/Auckland: 5 pass, 13 fail.
- PASS in every run: hosted hides overlapping starts sequentially (T6), and cancel releases a slot (T7).
- FAIL in every run: demo vs hosted for a non-UTC schedule (T1b), horizon (T3, T3b), inactive schedule (T4), four invalid submits accepted (T5), overlap start accepted (T6b), hosted DST overlap model (T9), `isoDate` (T10), cap overshoot (T11).
- FAIL only outside Lagos: T1 (browser timezone slots), T8 (DST duplicates, New York only).
- T2 (`localDate` mismatch) FAILs under Lagos only; it is skipped elsewhere.
- Several "FAIL" lines are expected-divergence assertions, so the count is not a defect count. Use the findings above.

## Fix ownership

- **In-repo:** H1, H2, M4 (client key), M5, M6, L1, L6, L7.
- **Platform team (hosted `runtimeService.ts`):** M1, M2, M3, M4 (server replay and error mapping), L2, L3, L4, L5, L8.
