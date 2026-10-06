# 03 - Public guest booking flow audit (2026-10-06)

Method: code reading only (no server started). Paths relative to apps/bookins. Platform = runtimeService.ts (RS) in the read-only snapshot.
Response shapes: page-get {profile{displayName,bio,photoUrl,timezone},services[{id,slug,name,description,durationMinutes,price,currency}],notices}, openings-list {openings[{startsAt,endsAt,timezone,localDate,localTime}]}, booking-create {bookingId,reference,serviceName,startsAt,endsAt,timezone,status,delivery} all MATCH what Book.vue consumes (Book.vue:99,126,144; RS:285-299, 330-337, 358-367). Local preview openings omit localTime (unused) so no break. Error codes are NOT consumed anywhere (see B3).

## Bugs, severity-ranked

### HIGH
**B1. Openings silently truncated to 32; a 7-day window shows ~4 days.**
Book.vue:126 `.slice(0, 32)`. RS returns up to 200 (RS:164 loop cap). A 09-17 / 60-min schedule gives 8 slots/day, 5 days = 40 > 32; the last days vanish with no "more" control. Guest sees an empty-looking Thursday/Friday and may conclude owner is unavailable. Local preview caps at 100 (booking.js:379).
Repro: local preview, Product consultation, pick a Monday start; Fri missing. Fix: drop the slice (or paginate per day with "show more"), and show per-day counts.

**B2. Idempotency key is fresh for every attempt.**
Book.vue:151 `crypto.randomUUID()` inside submit(); booking.js:415 passes it through. Reference is derived from the key (RS:336), so a retry after a lost response (network drop, double submit after the error path, re-click after timeout) uses a new key. Uniqueness of `reservation_key` (RS:371) prevents a true duplicate row, but the guest's own successful first booking now returns BOOKING_SLOT_TAKEN ("booked by someone else"), they believe it failed, and they never see the reference of the booking that exists. The double-click guard (`submitting`, Book.vue:136) covers only in-flight clicks.
Fix: generate the key once per (service, slot, contact-hash) attempt - e.g. store in a ref when the slot is selected, reuse it on retry, reset on slot/service change. Platform then replays the original response.

**B3. Submit errors are handled generically; slot-taken, validation and network are indistinguishable, and the form flow is wrong for non-collision errors.**
Book.vue:154-158: any error -> `reason.message`, then `loadOpenings()` which sets `selectedSlot=null` (Book.vue:119), kicking the user from step 3 to step 2. Banner text (Book.vue:284) always says "Choose another available time", even for BOOKING_CONTACT_INVALID (RS:333, bad email/name), BOOKING_RANGE/TIME_INVALID, or a transient network failure where the slot is still free and the user should just retry. Contact and notes are kept (reactive state not reset; good), but the slot is lost.
For the true collision case the behaviour is acceptable (message from RS:371, openings refreshed, details kept, focus moved to alert at :158) but the freshly selected slot context is gone and the error banner renders on step 2 above the list, far from the failed time.
Fix: branch on `error.code` (BOOKING_SLOT_TAKEN -> refresh+reselect; BOOKING_CONTACT_INVALID -> stay on step 3, mark fields; other/network -> stay on step 3 with Retry and the same idempotency key). I could not verify the shape of errors thrown by `GoalmaticGuest` (injected by platform, not in repo); confirm `.code` is exposed.

**B4. Guest cannot see or choose their timezone; display is in the owner's profile timezone, which can differ from the schedule timezone.**
Book.vue:38 `displayedTimezone = confirmation.timezone || page.profile.timezone`. Slot labels, groupings, summary and header ("Times shown in ...") use it. No Intl.DateTimeFormat().resolvedOptions().timeZone detection, no toggle. Further, openings carry `timezone` from the *schedule* (RS:317-ish, opening.timezone) while the page uses the *profile* timezone: if they differ, header and slot labels are in profile tz but the owner's hours are in schedule tz; confirmation then switches zone (Book.vue:38) so the same booking is shown in two zones across screens. A Lagos guest booking a London owner sees London times with no conversion and only a 10px caption. Day grouping (Book.vue:40-52) is correct for the chosen display zone (uses toLocaleDateString with timeZone), but groups are keyed by formatted label so locale/zone changes need a rebuild only (fine).
Fix: default to guest tz (resolvedOptions), selector using timezoneOptions() from time-display.js (already exists, used elsewhere), show "Owner is in X", show both on confirmation; send guest tz nothing (server is tz-agnostic, uses startsAt).

### MEDIUM
**B5. Date range: fixed 7 days, no paging, no horizon awareness, wrong default.**
Book.vue:36 default start = tomorrow in guest local date (today's later slots never offered unless user edits; schedule-tz "today" vs guest-local mismatch near midnight). Book.vue:121-125 range = start..start+6; there is no Next/Prev week, no "next available" jump. RS silently drops slots beyond `bookingHorizonDays` (RS:~157 horizon) and before minimum notice, so an owner with 14-day horizon gives "No openings in this week" forever on later weeks and the hint says "Choose another starting date" (Book.vue:401) with no `max` on the input (Book.vue:358, only `:min`). Guest `from` is a guest-local calendar date but RS interprets fromDate/throughDate as dates in *schedule* tz-neutral UTC day math, so edge days can be off by one for far-offset guests. Clearing the date input yields `NaN-NaN-NaN` (plusDays on "" , Book.vue:54-58) and a 400 shown raw.
Fix: week pager buttons, "Next available" (query 31 days), `max` from horizon (not exposed by page-get; add `bookingHorizonDays` to output or detect empty), guard empty date.

**B6. Stale-response race in loadOpenings.** Book.vue:115-133 has no request token. Changing date twice quickly, or Retry then back, lets an older response overwrite newer openings and the slot list can show another service's/date's times. Also `choose()` then `back()` during loading leaves `slotsLoading` true for a response that lands after selectedService=null. Fix: monotonically increasing request id; ignore stale.

**B7. Mobile: selected time disappears on step 3.** CSS @media 820px hides `.booking-summary dl` (Book.vue:~1076-1080), which is the only place the chosen date/time is shown (Book.vue:491-503). On phones the guest filling the form cannot see which slot they are booking, nor the price/duration. Fix: show a compact time line in the form header.

**B8. Hosted runtime-unavailable / bad link all collapse to "This booking link is unavailable."** Book.vue:195. booking.js:358 calls `window.GoalmaticGuest.ready()` without a presence check; if the injected object is missing the guest sees "Cannot read properties of undefined (reading 'ready')". Expired/revoked, network, and runtime failures share one heading, and "Try again" is shown for expired links (pointless). AGENTS.md demands honest messaging: map codes to (a) link expired/revoked -> "ask the owner for a new link", (b) service unavailable (BOOKING_SERVICE_NOT_FOUND), (c) profile not finished (BOOKING_PROFILE_REQUIRED, RS:241 message is owner-facing "Finish the Booking App profile before sharing..." and is shown verbatim to a guest), (d) runtime missing, (e) offline -> retry. Also BOOKING_SCHEDULE_UNAVAILABLE for a visible service surfaces only after a service click (page-get does not check schedule.active, RS:285); the guest sees a service they can never book.

**B9. Confirmation copy and gaps.** Book.vue:238 "Confirmation: Saved on this screen" is inaccurate/confusing: the booking is saved in the owner's Table; the screen is ephemeral and a refresh loses the reference (state is in-memory only, no URL/sessionStorage). Positive: truth note (Book.vue:240-242) correctly denies email/calendar/payment and matches RS `delivery:'on-screen-only'`. No .ics (see gaps), no end time/duration, notes not echoed, no host contact. Raw IANA string shown as tz (Book.vue:232). No focus move to the confirmation heading (only scrollTo, Book.vue:153), so screen-reader users get no announcement.

### LOW
**B10. Owner-provided content rendering.** Bio/description/name rendered via `{{ }}` interpolation = XSS-safe (Book.vue:260,317,475). Whitespace/newlines in bio collapse (no pre-line). `photoUrl` is bound straight to `<img :src>` (Book.vue:253): no scheme check, no `referrerpolicy="no-referrer"`/`loading`, and no onerror fallback; a non-https or non-allowlisted host (manifest externalDomains only lists firebasestorage + feedback-studio) will show a broken image with alt="" and any host leaks guest IP/referrer. Fix: https-only check, referrerpolicy, @error -> initial avatar. Avatar `slice(0,1)` splits surrogate pairs/emoji; empty displayName throws no error but shows blank.
**B11. Validation is browser-only plus server regex.** Name `required`+trim; email type=email (browser rules are looser than RS regex at RS:334, but both lenient); phone has no pattern/inputmode, no min length; notes maxlength 2000 matches RS text(...,2000) but there is no counter and RS truncates silently. No inline per-field errors/aria-invalid/aria-describedby; v-model.trim on a live input swallows trailing spaces while typing. Native validity bubbles are the only feedback.
**B12. A11y / keyboard.** Step changes (Book.vue:297-467) don't move focus; after choose()/selectSlot the previously focused button is destroyed so focus drops to body. Stepper has no `aria-current="step"`, labels are 9px on <=480px (second 480 media block overrides `font-size:0`, Book.vue:1115-1141, leaving tiny text). Many font sizes 9-12px (slot buttons 11px, body 12px). Slots are not grouped as a labelled group/radio set and have no pressed state. `:focus` on fields sets `outline:none` (global.css:655) - check border replacement keeps 3:1. Loading and slot-loading states have no `role="status"/aria-live`. Positive: submit error panel is focused with role=alert; `prefers-reduced-motion` honoured.
**B13. Local-preview fidelity drift.** booking.js:374-406 builds slots in browser-local time and `localDate` via UTC slice, ignores schedule.timezone/horizon, and `timezone` returned is schedule tz while the Date objects are guest-local, so local preview shows wrong labels when browser tz != Africa/Lagos (not a hosted bug; hides B4 during testing). Local error text "This time was booked by someone else." has no `code`, so future code-based handling won't be exercised locally. Demo guest (pages/demo/guest.vue, demo/guest.js) is a thin delegate; submit is intentionally blocked (Book.vue:137) - fine and honest.

## Verified OK
- Response-shape compatibility with RS (above).
- Collision detection: RS re-checks opening (RS:326) and unique-key (RS:371); client refreshes openings and keeps contact fields.
- Hosted builds do not fall back to preview data (booking.js:333, 414 gate on isLocalPreview).
- Confirmation does not claim email/calendar/payment (Book.vue:240, 464) and fine print matches the manifest.
- Service price note "arranged directly with the host" (Book.vue:508).

## Gap list vs Calendly / Cal.com
1. Month calendar picker with available-day dots (current: native date input + 7-day list). Needs per-day availability or 31-day query.
2. Timezone auto-detect and switcher (B4); 12/24h toggle.
3. .ics download on confirmation - pure client-side Blob (`BEGIN:VCALENDAR`, UID = reference, DTSTART/DTEND UTC from startsAt/endsAt, SUMMARY serviceName). Absent today; requires no provider and is honest to add. Also "Add to Google/Outlook" URL templates (still no write by Bookins).
4. Reschedule / cancel link: not implemented (docs/ARCHITECTURE.md:26 says so). Needs a guest action in the manifest (cancel by reference+email or secret token); `cancelOwnerBooking` is owner-only today.
5. Custom booking questions (only fixed name/email/phone/notes); consent checkbox; guest count/add guests.
6. Reference lookup / booking persistence (sessionStorage so refresh keeps confirmation); shareable confirmation page.
7. Branding: owner logo/colour/accent, cover; footer is Bookins branding only. Location/meeting-link field per service; none shown (no way to tell guest where/how to meet).
8. Per-service slot/buffer controls, "next available" shortcut, waitlist when no openings, minimum-notice explanation.
9. Email/SMS confirmation and reminders (explicitly out of scope until a provider flow is proved - keep the on-screen disclaimer).
10. Embed/redirect-after-booking, SEO/OG for the booking page, localisation of copy.

## Suggested fix order
B2 (key reuse) + B3 (error codes) -> B1 (drop slice) -> B4 (tz) -> B7 (mobile time) -> B5/B6 -> .ics + persistence -> B8 messaging -> a11y pass.
