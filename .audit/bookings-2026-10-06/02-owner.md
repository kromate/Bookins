# Owner dashboard audit (2026-10-06)

Method: static read of all in-scope files plus manifest/README/ARCHITECTURE. No browser run.
`yarn build` FAILED, but this is an environment fault and not a source error: `node_modules/vite/dist/node/chunks/node.js` is missing (ERR_MODULE_NOT_FOUND, `node_modules/vite/dist/node/cli.js`). The install is corrupt or partial. Fix: `yarn install --frozen-lockfile` (not done, read-only audit). Source compile status is therefore UNVERIFIED. No dev server was started.

## Bugs, severity ranked

### HIGH

**H1. Revoke can report success without revoking the grant.** `booking.js:306-312`
`if (token && window.GoalmaticShares?.revoke) await ...revoke(token)`. If either condition is false (runtime lacks `revoke`, or the stored URL has no `#token`), the function resolves. `Settings.vue:183-188` then clears `public_link_url` and flashes "Booking link revoked." The guest grant stays live and the owner has lost the only copy of the token. Hosted builds must fail honestly (AGENTS.md).
Repro: hosted/installed, runtime without `GoalmaticShares.revoke`, or a profile with a URL lacking a fragment, then Revoke.
Fix: outside local preview, throw if `revoke` is missing or the token is empty. Only clear the profile after revoke succeeds. If the profile save then fails, retry that step without re-revoking.

**H2. Create-link is not atomic and silently saves draft edits.** `Settings.vue:161-167`
The grant is created first, then `saveProfile(state.profile, {...form, publicLinkUrl})`. If the save fails, the grant exists but is not stored. It is orphaned and cannot be revoked from the UI.
Also (a) `...form` persists any unsaved profile edits without the user asking, and the dirty banner then clears via `syncProfileDraft`. (b) With `state.profile == null` it creates a profile from the blank form, bypassing the `required` display name. `canShare` (line 39-45) requires `state.profile`, which blocks (b) in the UI, but the function does not enforce it.
Fix: save only `publicLink*` fields onto `state.profile` (not `...form`). On save failure, call revoke on the new token and surface the error.

**H3. Empty time input passes availability validation.** `Availability.vue:115-118, 161-172`
Clearing a `type=time` input gives `''`. `minute('')` returns NaN (`part` is undefined). `NaN >= NaN` is false, so line 172 passes and `JSON.stringify` writes `null` into `startMinute`/`endMinute`. A corrupt schedule is saved, and `weeklyHours` shows NaN.
Repro: Availability, clear Monday's start time, Save.
Fix: reject non-finite minutes, plus a bounds check (0 <= start < end <= 1440).

### MEDIUM

**M1. No concurrency control.** `booking.js:225-232, 252-256`
`revision` is regenerated (`String(Date.now())`) on every write but never sent as an expected value, so there are no revision conflicts, only last write wins. Two tabs or devices can overwrite each other. Both tabs can also run `create` for the schedule or profile when none exists, producing duplicate rows. The UI only ever reads `[0]`.
Fix: pass the expected revision to `update` (if the Tables API supports it), or refetch and compare before writing.

**M2. Forms hydrate once on mount, so refresh does not resync.** `Availability.vue:131-157`, `Settings.vue:57-63`
After the top-bar Refresh or "Try again" (`App.vue:397,424`), or a change from another session, the draft still shows old values. Saving overwrites the newer server data (see M1). Not dirty means the form should follow `state`.
Fix: watch `state.schedules[0]`/`state.profile` and rehydrate when not dirty.

**M3. `refresh()` hides failures and can silently no-op after a save.** `App.vue:149-169`
It returns early if `loading` is true, so a save made while a refresh is in flight leaves stale lists. It also catches its own error, so every caller (`Services.vue:188`, `Availability.vue:184`, `Bookings.vue:150`, `Settings.vue:146`) goes on to show "saved/created/cancelled" with stale data. With `loaded` already true, the failure shows only as a top banner.
Fix: have refresh return success/throw, and skip the success toast on failure. Queue a re-run instead of dropping it.

**M4. Service slug collisions and empties.** `booking.js:244-247`; manifest `services.slug` has `preventDuplicates`
The slug is derived from the name. "Consultation" and "consultation!" collide, giving an opaque Tables duplicate error. Names with no ASCII letters or digits (e.g. "咨询", emoji) give an empty slug, which fails the `required` field. Renaming regenerates the slug, which breaks any slug-based links. Local preview does not enforce uniqueness, so the bug only appears hosted.
Fix: append a short suffix on collision, fall back to `service-<id>`, and keep the slug stable on edit.

**M5. Deleting a service with upcoming bookings has no warning.** `Services.vue:202-219, 491-493`
There is no booking check. The dialog says history stays. Bookings keep `service_id` and `service_name` but the service is gone, with no signal to the owner that N upcoming appointments are now orphaned.
Fix: count `state.bookings` with `service_id` and a future confirmed status, and show the count or offer Pause instead.

**M6. Schedule edits are not checked against existing data.** `Availability.vue:159-195`
(a) A window shorter than the longest active service, or not covering a multiple of the interval, yields zero or odd openings with no warning. (b) A timezone, hours or notice change can leave confirmed future bookings outside the new hours, with no warning or list. (c) Only active services are checked against the interval (line 83-89). That is consistent with `Services.vue:179`, which re-checks on reactivation.

**M7. Two timezone fields.** `Settings.vue:285-289` vs `Availability.vue:303`
`profile.timezone` and `schedule.timezone` are separate and never synced. The top bar shows the profile tz, the Overview card shows the schedule tz, and bookings use the schedule tz. Changing one produces a confusing mismatch.
Fix: single source of truth (schedule), or sync on save.

**M8. Public link expiry not reflected.** `Settings.vue:324-325, 32-38`, `App.vue:321-351`
The status chip always says "Active" and only the date is shown. An expired link (365 days live per `booking.js:298`; 30 days in local preview) still shows as active in both places. There is no renew or rotate action: the Create button only appears when no URL is stored (line 353), so renewal needs Revoke and then Create.

### LOW

- L1. `Bookings.vue:21`, `Index.vue:10`: `const now = Date.now()` is frozen at mount. Tabs and counts go stale in long-lived sessions. `starts_at > now` also files an in-progress booking under Past.
- L2. `Bookings.vue:400-406`: Cancel is offered for past bookings, and the copy says "reopen this slot". The `booking-owner` / `booking.cancel` capability in the manifest is unused, because `cancelBooking` writes the table directly (`booking.js:271-281`). Confirm this is intended.
- L3. Timezone display: bookings show in `booking.timezone` (fallback schedule tz). The date format (`when()`, `Bookings.vue:103-108`) has no tz name in the detail heading, but the line below shows the zone. The owner's browser tz is never shown, so an owner in another zone cannot see their local time. Overview "This month" (`Index.vue:21-31`) buckets by browser tz, not booking tz. Contacts dates (`Contacts.vue:64-73`) use browser tz.
- L4. `Contacts.vue:144`: "View booking history" goes to `/bookings` unfiltered. Contacts show "Most recent" using `latestAt`, which includes cancelled or future bookings (lines 22, 33-37, 138).
- L5. `copyText` callers (`Settings.vue:198`, `Index.vue:82`, `App.vue:206`) have no catch. A clipboard denial gives an unhandled rejection and no feedback.
- L6. Only `schedules[0]` is used everywhere. Extra schedules are ignored, and `Services.vue:187` rebinds an edited service to `schedules[0]`.
- L7. `Availability.vue:91-97`: `weeklyHours` is not rounded (e.g. 7.33333). `Services.vue`: an existing duration not in `[15..120]` renders an empty select.
- L8. `demo/adapter.js:44-56` computes openings in UTC and ignores `schedule.timezone`. This is latent, because the fixtures are all UTC. `booking.js:389,405` (local preview) uses the browser tz and a UTC `localDate`, so the guest preview can disagree with the schedule tz.
- L9. `runtime.js` / `demo/boundary.js:37-39`: any non-explicit failure sets `uncertain`, which blocks mode switching until a full reload. Safe, but it also trips on plain validation errors with no `outcome`.
- L10. `Settings.vue:290-298`: `type=url` accepts non-HTTPS/`javascript:` strings for `photo_url`. It is only used as `<img src>`, so risk is low, but the hint says HTTPS.

## Verified OK
- Double-submit: all save/delete/cancel/link paths are guarded by `saving`/`deleting`/`busy` flags and use a fresh `idempotencyKey`.
- Demo mode: every mutation is gated by `isDemo` and also throws `DEMO_READ_ONLY` in the adapter. Switching is guarded by pending ops, dirty forms and a loading guard, and `routeKey` remounts pages. State is cleared and reloaded in `registerModeCommitHandler`.
- Interval vs duration: enforced both ways (disabled select options plus submit checks, `Services.vue:179`, `Availability.vue:176`) and surfaced as a hint with an error message. The disabled options do not name the blocking service.
- Overlap validation: not applicable, since each day permits one window and overnight windows are rejected. This is itself a gap (see below).
- Contacts derivation is correct for email dedupe, with latest-wins name and phone.

## Gaps vs Calendly / Cal.com owner experience

Possible now (no provider needed):
- Multiple windows per day (lunch breaks); this is the main schedule limit
- Date overrides, time off and holidays
- Buffers before and after, per-service minimum notice, daily booking caps
- Per-service schedule or multiple schedules or resources (one schedule today by design)
- Owner-created manual bookings
- Owner reschedule
- Calendar or week view and day agenda
- Booking filters beyond free-text search (date range, service, status) and sorting
- CSV export (bookings and contacts)
- Contact detail and edit, tags, notes
- Booking questions or custom intake fields (only name, email, phone, notes today)
- Branding and customization (accent colour, logo, cover) and a custom slug or vanity URL
- Link rotation and renewal, multiple links per service
- Dashboard analytics (no-show, conversion)
- Warning list of bookings broken by schedule changes
- Service ordering and duplicate service

Blocked by AGENTS.md until a real connected-provider flow is proved:
- Online payments and deposits
- Google/Outlook Calendar sync and conflict checking
- Email or SMS confirmations, reminders and cancellation notices (the UI states none are sent)
- Video-conferencing link generation
- Guest self-cancel and self-reschedule (per ARCHITECTURE "not claimed"; email-link driven in practice)
