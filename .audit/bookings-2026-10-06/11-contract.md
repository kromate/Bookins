# v0.5 implementation contract (architect-owned)

All engineers read this. Plan: 10-feature-plan.md. Do not commit. Do not edit files you do not own.

## Data model changes (engineer F owns `.goalmatic/app.json`, README, ARCHITECTURE, AGENTS.md)

- `bookings.status` options: `confirmed`, `cancelled`, `completed`, `no_show`, `blocked`.
  - `blocked` = owner time off. `service_id` = `time-off`, `service_name` = `Time off`, `guest_name` = reason or `Time off`, `guest_email` = `time-off@bookins.invalid`, `reservation_key` = `block:<uuid>`, `reference` = `OFF-<8 hex>`.
  - The hosted engine treats every non-`cancelled` record on a schedule as busy, so `blocked`, `completed`, and `no_show` all keep their time reserved.
- New optional `bookings` fields: `owner_notes` (textarea), `source` (select: `guest`, `owner`; missing = guest), `series_id` (text, recurring owner bookings).
- New optional `services` fields: `location` (text), `public_link_url` (url), `public_link_expires_at` (date).
- New optional `profiles` field: `message_templates_json` (textarea).
- New Table `contacts`: `email` (email, required, preventDuplicates), `name`, `phone`, `notes` (textarea), `tags_json` (textarea, JSON string array), `updated_at` (date). Capability `contacts-data` with records-list, record-create, record-update, record-delete, required:false.
- Version 0.5.0, releaseType minor.

## Helpers every page must use

`booking.js`:
- `isTimeOff(b)` → `b.status === 'blocked'`. Bookings, Contacts, Index, Insights must exclude time off from bookings, contacts, and metrics.
- `isActiveBooking(b)` → status is `confirmed`, `completed`, or `no_show`.

## Owner API in `booking.js` (engineer F; every function goes through `runOwnerCall` and has a read-only Demo twin in `demo/adapter.js`)

- `loadOwnerWorkspace()` → `{ profile, schedules, services, bookings, contacts }`. `contacts` = `[]` when the Table is missing or unbound; never fail the workspace.
- `createOwnerBooking(state, { serviceId, startsAt, contact: { name, email, phone }, notes, ownerNotes, repeatWeeks = 0 })` → `{ created: Booking[], skipped: [{ startsAt, reason }] }`.
  - Overlap is checked against non-cancelled bookings on the same schedule using `scheduling.js`. Owners may book outside weekly windows and inside minimum notice; they may not overlap.
  - `repeatWeeks` = 0–12 extra weekly occurrences sharing one `series_id`. `source` = `owner`.
- `rescheduleBooking(state, booking, startsAt)` → updated booking. Same overlap rule (ignoring itself). Updates `starts_at`, `ends_at` (same length), and `reservation_key`.
- `setBookingStatus(booking, status)`, where status ∈ `confirmed | completed | no_show`.
- `saveBookingNotes(booking, ownerNotes)`.
- `createTimeOff(state, { startsAt, endsAt, reason })` → record. Requires `endsAt > startsAt` and at most 60 days. Allowed to overlap existing guest bookings; the result includes `{ overlapping: Booking[] }` so the UI can warn.
- `removeTimeOff(record)` → sets `cancelled` and releases the key.
- `createServiceLink(service)` / `revokeServiceLink(service)` use `createPublicLink({ kind: 'service', serviceId })` and store the link on the service record.
- `saveMessageTemplates(profile, templates)`.
- `saveContact(existing, { email, name, phone, notes, tags })`.

## `messaging.js` (engineer F; pure, no window access at import)

- `DEFAULT_TEMPLATES` = `{ confirmation, reminder, reschedule, cancellation, followup }`, each `{ subject, body }`.
  - Variables: `{{guest_name}} {{first_name}} {{service}} {{date}} {{time}} {{timezone}} {{duration}} {{business}} {{location}} {{reference}} {{booking_link}}`.
- `resolveTemplates(profile)` → defaults merged with `profile.message_templates_json`.
- `renderTemplate(text, vars)`: unknown variables render empty, with no HTML.
- `messageVars(booking, { profile, service, timezone, bookingLink })`: date and time formatted in the booking timezone.
- `normalizePhone(phone, defaultCountry = 'NG')` → E.164 digits without `+`, or `''`.
  - Handles local leading-0 numbers for NG 234, GH 233, KE 254, ZA 27, UG 256, TZ 255, RW 250, CI 225, SN 221, CM 237, EG 20.
  - Infer the country from the profile timezone via `countryFromTimezone(tz)`.
- `whatsappUrl(phone, text)` → `https://wa.me/<digits>?text=…`, or `''` if there is no valid phone.
- `smsUrl(phone, text)` → `sms:+<digits>?&body=…`.
- `mailtoUrl(email, subject, body)`.
- `whatsappShareUrl(text)` → `https://wa.me/?text=…`.

## Honesty rules

- Messages are opened in the owner's own WhatsApp, SMS, or email app. Bookins never claims it sent anything. Label buttons "Open WhatsApp", not "Send".
- Insights revenue is "Estimated from display prices". Payments are not taken.
- The owner-created booking overlap check is client-side (not atomic). Exact-start collisions are still rejected by the unique key.

## As implemented (architect, authoritative — supersedes anything above)

Data layer is DONE and tested (`yarn test`, 33 passing). Read `booking.js` and `messaging.js` before coding.

- Placeholder emails use the reserved `.invalid` TLD: time off = `time-off@bookins.invalid`; clients with no email = `phone-<E.164 digits>@bookins.invalid`. Use `hasRealEmail(email)` before showing an email or building mailto. Display "No email" for placeholders.
- `booking.js` extra exports: `PLACEHOLDER_EMAIL_DOMAIN`, `TIME_OFF_SERVICE_ID` ('time-off'), `hasRealEmail`, `contactTags(contact)` → string[].
- `createOwnerBooking(state, { serviceId, startsAt, contact, notes, ownerNotes, repeatWeeks })`: contact needs name + (email or phone). Errors carry `.code` (`BOOKING_SLOT_TAKEN` with a message naming the clash, `BOOKING_CONTACT_INVALID`, `BOOKING_TIME_INVALID`, `BOOKING_SERVICE_NOT_FOUND`, `BOOKING_SCHEDULE_UNAVAILABLE`). Repeats skip clashing weeks into `skipped` instead of failing.
- `createTimeOff(state, …)` uses `state.schedules[0]`; returns `{ record, overlapping }`.
- `rescheduleBooking` / `setBookingStatus` throw `BOOKING_NOT_ACTIVE` for cancelled/time off.
- `saveService` now accepts `input.location`.
- `messaging.js` extra exports: `TEMPLATE_KINDS`, `TEMPLATE_VARIABLES`, `COUNTRY_CODES`, and `composeMessage(kind, booking, { profile, service, bookingLink })` → `{ subject, text, whatsapp, sms, email }` (links are '' when unusable). Prefer `composeMessage` in UI.
- After any owner mutation call `refreshBookings()` (injected; returns true/false) as existing pages do.
- Demo mode: every new owner call throws `DEMO_READ_ONLY`; disable mutating controls when `isDemo` (see existing pages).
- Sample data (local preview + Demo) includes past completed/no_show/cancelled bookings, one `blocked` time-off record, and two contacts with notes/tags.
- Shared component `components/QrCode.vue` (owned by engineer H; globally registered by filename): `<QrCode :value="url" :size="200" :label="'Booking link QR code'" />` renders an accessible QR image plus a "Download PNG" button. Uses the `qrcode` npm package (already installed).
