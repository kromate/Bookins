# Bookins v0.5.0 final release QA (2026-10-06)

Method: `VITE_GOALMATIC_API_KEY= VITE_GOALMATIC_API_BASE_URL= yarn dev --port 5850` (yarn PID 88154, vite PID 88156; only those two were stopped, port confirmed free). Source was not edited; `dist/` from `yarn build` is git-ignored. The shared preview tab was driven with DOM scripting plus a few real key/click events. Console hook (console.error/warn, window error, unhandledrejection) was installed on first load and never reset (all routing was in-app, no reload): 0 entries in both the 1440 page and the 390 iframe.

`yarn test`: 34 pass, 0 fail. `yarn build`: succeeds; 4 INEFFECTIVE_DYNAMIC_IMPORT warnings (AppIcon, BookinsLogo, GmWalkthrough, DemoGuide imported both statically and dynamically; harmless).

/book gzip (route chunks plus shared): Book-*.js 13.90 kB, Book-*.css 4.15 kB, shared index-*.js 42.49 kB, index-*.css 10.19 kB, runtime-core 26.07 kB, dist (radix/vue deps) 31.29 kB, GmDialog/GmButton/GmSelect 0.77/0.81/2.16 kB, time-display 1.30 kB, guest 0.49 kB, QrCode 1.01 kB (not loaded by /book). The GoalmaticFeedback chunk (23.51 kB gzip) is a separate lazy chunk.

## Pass/fail table

Previous-QA (12-qa-v05.md) items that must still pass:

| Area | Result | Notes |
|---|---|---|
| Overview Today (Completed flips to "Completed"; No-show button present, not clicked) | PASS | Buttons only on started bookings |
| Overview reminder queue (wa.me / sms: / mailto hrefs, "this session only") | PASS | |
| Overview counts, time-off exclusion | PASS | Upcoming 2, this month 4 on seed; Bookings tabs match after adds |
| New booking phone-only / with email | PASS | "Saved 1 booking. Nothing was sent to the client." |
| Repeat weekly 3 with one clash | PASS | "Saved 3 bookings... 1 repeat skipped: Oct 13 ... overlaps Clash Carl" |
| Overlap rejection (owner create) | PASS | "This time overlaps Repeat Rita (Discovery call). Choose another time." Email-or-phone validation also enforced |
| Detail dialog: message menu 5 templates | PASS | wa.me, sms:, mailto; phone-only shows "No email on this booking..." and no mailto |
| Mark completed / no-show / Undo | PASS | |
| Private notes | PASS | Inline "Private note saved." plus toast; toast disappeared |
| Reschedule clash / free | PASS | Clash message; free: "Booking moved. The old time is free again..." |
| Cancel with reason, then cancellation message | PASS | Only email link for email-only guest |
| Week view, filters/tabs, `?email=` deep link | PASS | Show everyone / Clear filters present |
| Availability presets Today/Tomorrow/Next 7 days | PASS | |
| Time off multi-day all-day, time range, overlap notice | PASS | "2 existing bookings are inside this time off" |
| Time off end-before-start | PASS | Message "The end time must be after the start time." now observable |
| Remove time off (confirm dialog) | PASS | |
| Availability sticky save bar: appears, Save, toast "Availability saved." | PARTIAL | Works but is not sticky (BUG-1) |
| /book hides time-off slots | PASS | Oct 7-9 disabled; Oct 15 shows 4 slots (9-12) |
| Settings section nav | PASS (Low issue BUG-6) | Profile / Share kit / Templates scroll and highlight |
| Template tabs, chips lowercase `{{guest_name}}` (old BUG-3) | PASS | text-transform none |
| Chip insertion with real click/keyboard focus (old gap) | PASS | Inserted at cursor in focused field |
| Template preview, `{{unknown_var}}`, Reset, Save | PASS | "Message templates saved."; save bar clears |
| Version chip (old BUG-2) | PASS | "Bookins v0.5.0 candidate" |
| Share kit: link copy, button code copy, QR (img, 320px), WhatsApp share, Download PNG present | PASS | Clipboard stubbed to read values |
| Service location edit | PASS | "Service updated."; helper text now says "not shown on the booking page yet" (old BUG-6 documented honestly) |
| Direct link create: QR, Copy link, Share on WhatsApp, Download PNG, Revoke | PASS | |
| Private service link on /book (step 2 directly, no back button, public list hides it) | PASS | |
| Revoke link then `/book#token` | PASS | "This booking link is no longer valid." |
| Contacts edit panel (notes + tags, Add, Save) | PASS | Inline panel (not a dialog); toast "Contact saved" |
| Contacts tag filters (Priority, Remind), no-show badges, Message menu with View history | PASS | |
| Insights 7/30/90/all, no NaN/undefined | PASS | Heatmap is a table with caption |
| /book EN to confirmation: step indicator, validation, copy reference, .ics | PASS | `.ics` summary "Discovery call with Amina's Studio", reference in DESCRIPTION; Copy writes reference, label "Copied" |
| /book FR toggle through confirmation | PASS | Slot labels now `09:00` consistent (old BUG-4 fixed) |
| Demo mode read-only | PASS | All mutating controls disabled incl. New booking (disabled with title) |
| Demo: Settings copy buttons enabled | FAIL | BUG-5 |
| Mobile More sheet nav (Insights/Contacts/Settings), Esc closes, focus returns to More | PASS | |
| /book sticky confirm bar (mobile) | FAIL | BUG-1 |

New checks:

| Check | Result |
|---|---|
| Removed time off ("Dentist") not in Contacts (10 contacts before and after) | PASS (old BUG-1 fixed; `isTimeOff` now matches `service_id === TIME_OFF_SERVICE_ID`, booking.js:35) |
| Insights cancellation unchanged after removal (1 of 12 / 1 of 15 / 0 of 4 / 1 of 15 for 30/90/7/all) | PASS |
| Removed time off absent from Bookings Cancelled tab | PASS |
| 1440: html/main scrollWidth = clientWidth on all 7 owner routes | PASS (1440/1440, main 1188/1188) |
| 390: html/main scrollWidth = clientWidth on 7 owner routes plus /book steps 1-3; only intended scrollers (settings-nav, template tabs, booking tabs) extend past the edge | PASS |
| 390 dialogs: new booking, detail, reschedule, cancel, service edit, revoke confirm: scrollWidth = clientWidth, bottom-sheet settles at viewport bottom | PASS |
| Text under 13px | FAIL (Low, BUG-7) |
| Mobile targets under 40px | FAIL (Low, BUG-8) |
| Visible focus ring on Tab | NOT VERIFIED visually (see limits); CSS rules present, faint colour (BUG-9) |
| Dialog focus trap + Esc | PASS (Shift+Tab from first control wrapped to last, stayed in dialog; real Esc closed). Focus not returned to trigger (BUG-10) |
| Toasts appear and disappear | PASS |
| Page transition vs anchors/scroll | PASS (settings section nav and router navigation fine; sweeps taken mid-transition show the previous page, which is expected) |
| Console errors | PASS (0) |

## Bugs

### BUG-1 (High, one-line fix): `position: sticky` is broken app-wide, so sticky save bars, topbar and /book Confirm bar do not stick
- Repro: any route at any width, scroll down. Availability: change a weekly end time (bar appears), then scroll to top: bar sits at the very bottom of the page (y=2031 in a 900px viewport) instead of pinned at 16px from the viewport bottom. Topbar scrolls away (top = -761 at scrollY 800). /book step 3 at 390px: "Confirm booking" bottom = 1264 with viewport 844 at scrollY 0, i.e. below the fold; the `.confirm-bar` sticky never engages.
- Expected: `.sticky-save-bar` pinned to the viewport bottom while there are unsaved changes (also Settings templates bar), topbar pinned, `.confirm-bar` pinned above the fold on phones.
- Actual: not pinned; owner can miss "Unsaved changes", guests must scroll to find Confirm.
- Cause: both `html` and `body` have `overflow-x: hidden` (css/global.css:107 and :114). When html is non-visible, body's overflow is not propagated to the viewport, so body becomes its own scroll container (computed `overflow-y: auto`, auto height) and sticky descendants anchor to a container that never scrolls.
- Verified fix (runtime experiment only): `document.body.style.overflowX = 'visible'` made topbar top 0, save bar bottom 884 (viewport 900), confirm bar bottom 832 (viewport 844), and scrollWidth stayed 390. Fix: remove `overflow-x: hidden` from `body` (or use `overflow-x: clip` on both).
- Note: the old rules (`html{overflow-x:hidden}`, `body{overflow-x:hidden}`) were already in HEAD, so this is pre-existing, but the polish pass relies on sticky in 4 places.

### BUG-5 (Low): Demo mode has no share-kit copy buttons
- Repro: Switch to Demo, Settings. Share kit shows "Create your booking link" with a disabled "Create booking link"; no Copy link / Download PNG / Copy button code exist (previous QA saw them disabled, now they are not rendered because Demo has no link).
- Expected (per brief): copy buttons enabled in Demo. Actual: unavailable. Suspect: pages/Settings.vue share-kit block (conditional on a booking link). Demo can't create grants, so this may be acceptable by design; decide and document.

### BUG-6 (Low): Settings scroll-spy never highlights "Delivery status"
- Clicking "Delivery status" scrolls to the page bottom (max scroll 2164) but the active item stays "Message templates" because the last section cannot reach the activation line. Suspect: Settings.vue scroll-spy offset.

### BUG-7 (Low): 12px text remains
- Visible text under 13px: bottom-nav labels (`<small>` in the mobile nav, "Home/Hours/Bookings..." at 12px) and `.nav-section-label` ("WORKSPACE", "MANAGE" at 12px). Spec allows these but the release criteria say no text under 13px. No other offenders on any route at 1440 or 390 (including dialogs and /book).

### BUG-8 (Low): interactive targets under 40px on mobile (390)
- Bookings Agenda / Week toggle: 38px high. Bookings detail dialog template tabs (Confirmation, Reminder, Reschedule, Cancellation, Follow-up): 38px. Availability weekly time inputs (`Monday window 1 start time` etc.): 38px high (147x38) and the 18x18 day checkboxes. Contacts "Open SMS/WhatsApp" menu links: 71x32. Inline mailto links in dialogs (17px, inline text, likely exempt). Everything else (buttons, bottom nav 55px, More sheet 52px, calendar days, form fields) is 40-44px+.

### BUG-9 (Low): focus ring is faint
- Global `:focus-visible` is `rgba(35,54,220,0.4)` 3px outline: roughly 2.1:1 against white, under the 3:1 non-text contrast guideline. Could not observe the ring live (document had no focus in the automation tab, so `:focus-visible` never matched); rules exist for buttons, inputs (`.field input:focus-visible` uses outline none plus a `:focus` style at global.css:1079), and gm components.

### BUG-10 (Low): focus not returned to the trigger after a dialog closes
- Repro: Bookings, click "New booking", press Esc. `document.activeElement` becomes `body`. Keyboard users lose their place. Dialog focus trap itself works.

### BUG-11 (Info): status chip casing inconsistent
- Overview/Today shows "Confirmed" (capitalized) while the Bookings list, week view and detail dialog show lowercase "confirmed"/"cancelled" (chips no longer capitalize; Overview formats text itself).
- Contacts "Last: None" for contacts with only future bookings reads oddly (suggest "No past bookings").

## Not exercised / limits
- Hosted runtime, real guest grants, Calendar connect/write, Delivery status: not possible with the key disabled; local preview data is in memory, so persistence across a hard reload was not tested (only in-app navigation).
- Visual review: preview snapshot/screenshot tool fails on this client and `preview_resize` times out (tab hidden), so all layout checks are DOM metrics. 390px was measured in a same-origin 390x844 iframe with fresh in-memory data (same approach as v0.5 QA); touch behaviour and real mobile chrome were not tested.
- Real Tab-order sweep and rendered focus ring: automation window not focused, `:focus-visible` never matched; only trap/wrap and CSS inspection done. Mobile More sheet Esc was dispatched as a keydown on the focused element, not a trusted key.
- Overview "No-show" button not clicked (verified in Bookings dialog). Revenue/Insights beyond the no-NaN scan, CSV downloads, Contacts CSV, 60-day horizon, repeat of 12, DST/non-Lagos schedules not re-tested.
- Demo walkthrough guide (`/demo/*`, DemoGuide.vue, GmWalkthrough phone placement) not examined.
- Private-service booking was verified to step 2 only (not completed) in this run; service booking completion and .ics were verified for the public Discovery call (EN and FR).
- Feedback launcher (shadow DOM) excluded from target-size checks.
