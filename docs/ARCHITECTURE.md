# Bookins architecture

## Product boundary

Bookins owns the owner dashboard, guest booking page, schedule rules, service visibility, booking copy, and migration mapping. Goalmatic owns identity, account selection, installation bindings, Tables, public grant admission, platform execution, audit, credits, integrations, and App lifecycle.

## Records

- `profiles` stores the public display name, bio, photo, timezone, current public-link metadata, the owner's message templates (`message_templates_json`), and optional booking-page appearance (`booking_page_settings_json`).
- `schedules` stores recurring weekly windows, timezone, slot interval, notice, horizon, and revision.
- `services` stores the offering, duration, display price, location, schedule binding, visibility, status, revision, and an optional direct link (`public_link_url`, `public_link_expires_at`). v0.6.0 adds optional `category`, `sort_order`, `rebook_after_days`, and `prep_notes`. Because hosted `page-get` returns only slug, name, description, duration, price, and currency, `serializeService()` (services.js) also writes the same values (plus, for per-member copies, staff id, staff name, and base service id) as a machine-readable trailer on the last line of `description`: `[[bk:{"c":..,"o":..,"p":..,"s":..,"n":..,"b":..}]]` (service-meta.js). Owner UI reads fields first, then the trailer, and always shows the stripped text. Remove the trailer when the platform returns real fields.
- `bookings` stores a service snapshot, optional `staff_id` and `staff_name` (snapshot; the implicit owner is `owner`), optional "opened by you" timestamps `reminder24_opened_at`, `reminder2_opened_at`, `prep_opened_at`, `followup_opened_at`, `rebook_opened_at` (and the legacy `reminder_opened_at`), UTC range, timezone, guest contact, notes, private `owner_notes`, status, `source` (`guest` or `owner`), optional `series_id` for recurring owner bookings, reference, and unique reservation key. Status is `confirmed`, `completed`, `no_show`, `cancelled`, or `blocked` (owner time off).
- `contacts` (optional) stores private client notes and tags keyed by lowercased email. The Contacts page merges it with booking history; without the Table, Contacts is derived from bookings only. v0.6.0 adds `marketing_opt_out` (+ `marketing_opt_out_at`), `last_campaign_at`, and `offers_json` (`[{code, status: offered|redeemed, at}]`).
- `staff` (optional, capability `staff-data`) stores team members: name, role, photo, colour, phone, email, `active`, `schedule_id` (their own schedule), `service_ids_json` (empty = all services), `is_owner`. The owner needs no row: with no `is_owner` row an implicit member "You" owns the first schedule no other member has claimed. Unbound Table = no team.
- `campaigns` (optional, capability `campaigns-data`) stores saved campaigns: `segment_json` (filters), `template_json` (channel, subject, body), `offer_text`, `offer_code`, `status` (draft, active, done), `audience_count`, `created_at`, `last_opened_at`.
- `profiles.message_templates_json` is versioned JSON: `{v: 2, slots: {confirmation|reminder24|reminder2|prep|thanks|rebook|reschedule|cancellation|campaign: {channel, subject, body, enabled}}, serviceOverrides: {serviceId: {kind: {body}}}}`. v1 JSON (`reminder`, `followup`, subject/body only) still loads; only slots that differ from the defaults are written.
- `profiles.booking_page_settings_json` stores `{theme, layout}`. Invalid or legacy values normalize to Indigo and the month calendar. The public profile projection exposes only this sanitized appearance object, so every existing grant reads the current profile setting without changing its URL.
- `owner-daily-agenda` is an App workflow resource (installed off). A SCHEDULE_INTERVAL trigger (07:00 Africa/Lagos) runs TABLE_READ on the logical `bookings`, `profiles`, and `services` Tables via `$appResource` (no physical Table ID in source; step indices 0-2), one TRANSFORM_DATA step (index 3, reads all three through its `input` override) and one SEND_EMAIL step (index 4) to `USER_EMAIL`, whose subject and message are the mentions `@step-3-TRANSFORM_DATA-subject` and `-body`. Table-record triggers are not used: the Goalmatic importer rejects `$appResource` in trigger props.

The App has no separate wallet, provider-token store, or App-only identity.

## Capacity rule

One schedule represents one bookable resource. Services on that schedule must be no longer than its slot interval. The booking adapter derives `scheduleId|startsAt` as a unique reservation key. Goalmatic Tables creates the record and uniqueness marker in one transaction, so two guests cannot confirm the same schedule slot. Cancellation changes the reservation key to `released:<bookingId>` while retaining history.

The hosted engine treats every non-`cancelled` booking on a schedule as busy. Bookins uses this for owner time off: a `blocked` record with reservation key `block:<uuid>` and the placeholder email `time-off@bookins.invalid` (reserved TLD, never deliverable). Removing time off cancels the record. `completed` and `no_show` keep their time reserved like `confirmed`.

Owner-created bookings (walk-ins, phone bookings, weekly repeats up to 12) and owner reschedules may ignore weekly hours and minimum notice but never overlap another booking or time off. That overlap check runs in the browser against loaded state, so it is not atomic; exact-start collisions are still rejected by the unique reservation key. Clients without email are stored as `phone-<E.164 digits>@bookins.invalid`.

## Staff as schedule

A team member is a person plus their own `schedules` record (1:1); each schedule is an independent resource on the hosted engine, which is the only way to get parallel capacity today. The capacity rule above applies per schedule, so two members can each hold a booking at 10:00 and a guest still cannot double-book one member. Guests choose a member by choosing that member's service copy: a `services` record bound to the member's schedule whose trailer carries `s` (staff id), `n` (name), and `b` (base service id), grouped under the base service by name. Copies are created idempotently by `createStaffServices` (warning above 40 copies, refusal above 200, skipped when the service is longer than the member's interval or the member does not offer it). Deactivating a member sets their copies inactive, which hides them from `page-get`; bookings are kept. Owner assignment (`assignBookingStaff`, `bulkAssignStaff`) moves a confirmed booking's `schedule_id` and `reservation_key` to the member's schedule after the same non-atomic browser overlap check as rescheduling (time off counts); completed, no-show, and cancelled bookings only change `staff_id`/`staff_name`. Guest bookings carry no `staff_id`; the member is derived from the booking's schedule (`staffForBooking`). With no non-owner member, nothing in this section applies and an install behaves exactly as before. Not built: "any professional" (needs union of openings and auto-assign inside `booking.create`), staff on `page-get`, atomic cross-schedule rules.

## Public boundary

The pinned App manifest declares `/book` and four named guest actions. Links have a subject: a profile link lists public services; a service link (`{ kind: 'service', serviceId }`) opens exactly one service, including private ones. The installed owner runtime is not injected on that route. An owner creates an expiring grant for one installation and release. The raw token is exchanged from the URL fragment into an HttpOnly cookie. Guest calls cannot supply account, installation, release, physical Table, or provider IDs. Site Builder injects the grant subject and installation-bound Table IDs before invoking the bounded Goalmatic booking adapter.

## Provider truth

Bookins v0.6.0 guarantees on-screen confirmation, owner dashboard visibility, and Contacts built from booking history plus optional private notes. A non-zero price is informational and described as arranged with the owner; Insights revenue is an estimate from display prices.

Guest messages (the six journey slots, reschedule, cancellation, campaign) are prefilled `wa.me`, `sms:`, and `mailto:` links that open in the owner's own WhatsApp, SMS, or email app. Bookins does not send them and never reports them as sent or delivered; the Messages queue is computed live from bookings (reminders by time window, thank-you within 24 hours of a completed visit, rebook nudge after the service's `rebook_after_days`) and records only "opened by you". Campaigns follow the same rule: the audience (`segmentContacts`) is built from non-cancelled, non-time-off booking history; opted-out contacts are excluded from every queue, email BCC batch (at most 40 addresses and a mailto short enough for mail clients), and CSV; placeholder `@bookins.invalid` addresses are never used as email; the queue is capped at 200. Offers are text: Bookins cannot apply a discount (prices are display-only and payments are unavailable), so the owner honours them by hand and may mark them redeemed. There are no delivery, open-rate, or revenue claims, and marketing-consent law has not been researched here.

Google Calendar uses only the declared `calendar-sync` operations. The App never receives provider credentials. An explicit Add creates an event without attendees. Rescheduling updates its times; cancellation marks it free and disables reminders through `event-update`. Goalmatic applies the workspace approval policy. Additive `calendar_sync_status` and `calendar_sync_error` fields preserve pending or failed reconciliation and enable retry after reload. Bookins writes its record first and reports provider failure separately.

The public `calendar-busy` action returns busy ranges only. Both availability and optional Calendar reads have bounded deadlines. The guest UI distinguishes connected, unavailable and failed checks, displays recovery controls and rechecks the selected time before submission. This is not an atomic reservation across Bookins and Google: platform booking commands own the Bookins conflict check.

Settings uses installation-bound `workflows.schedule-status`, `workflows.schedule-configure` and `workflows.run` to expose the agenda schedule and test queue. Status reads enforce account, App and installation ownership. The App never treats queue acceptance as delivery.

When turned on, the owner receives one plain-text agenda email each morning through the `owner-daily-agenda` workflow (platform mailer, noreply@goalmatic.io, the owner's registered email). It reads the 200 most recently created bookings, so very old bookings scheduled for today could be missed. Delivery depends on workflow-run limits and is not shown in the dashboard. From v0.6.0 the email also lists tomorrow's prefilled reminder links (rendered with the same rules as `messaging.js`, tested against it); the transform must not contain less-than characters, double braces, entity text, or at-step tokens because the platform processes mentions and HTML over step props. The digest is **unproven** until a manual and a scheduled run succeed on a real account.

Calendar and daily-agenda behavior is unproven until exercised on a real connected account. Guest email delivery, online payment, payout, guest cancellation, rescheduling, and Calendar invites are not claimed until their provider paths are connected and proved.

## Uninstall and release

Uninstall revokes App sessions and public grants before detaching bindings. Data is retained for 30 days and remains exposed as Tables after uninstall unless the owner explicitly deletes eligible App-provisioned data.

Private testing and Store publication are separate. Production must promote the exact tested build and artifact digest without rebuilding.

## Source layout

Domain logic is pure and unit-tested outside the Vue pages: `scheduling.js` mirrors the hosted opening and overlap rules; `services.js` and `csv.js` parse, validate, and import service CSV; `team.js` models staff as one schedule per person; `messaging.js` renders templates and computes the live message queue from bookings; `campaigns.js` builds segments, queues, and batches; `service-meta.js` reads and writes the description trailer. `booking.js` is the only module that touches Tables, the Goalmatic runtime, and the local preview store, and every owner write goes through `runOwnerCall` so Demo stays read-only.

