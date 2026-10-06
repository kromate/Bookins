# Bookins architecture

## Product boundary

Bookins owns the owner dashboard, guest booking page, schedule rules, service visibility, booking copy, and migration mapping. Goalmatic owns identity, account selection, installation bindings, Tables, public grant admission, platform execution, audit, credits, integrations, and App lifecycle.

## Records

- `profiles` stores the public display name, bio, photo, timezone, current public-link metadata, and the owner's message templates (`message_templates_json`).
- `schedules` stores recurring weekly windows, timezone, slot interval, notice, horizon, and revision.
- `services` stores the offering, duration, display price, location, schedule binding, visibility, status, revision, and an optional direct link (`public_link_url`, `public_link_expires_at`).
- `bookings` stores a service snapshot, UTC range, timezone, guest contact, notes, private `owner_notes`, status, `source` (`guest` or `owner`), optional `series_id` for recurring owner bookings, reference, and unique reservation key. Status is `confirmed`, `completed`, `no_show`, `cancelled`, or `blocked` (owner time off).
- `contacts` (optional) stores private client notes and tags keyed by lowercased email. The Contacts page merges it with booking history; without the Table, Contacts is derived from bookings only.
- `owner-booking-alert` is an App workflow resource. Its TABLE_RECORD_CREATED trigger is bound to the logical `bookings` Table by `$appResource`, so no physical Table ID appears in source. It runs one TRANSFORM_DATA step to format the message and one SEND_EMAIL step to `USER_EMAIL`. It does not fire on updates, so cancellations send nothing.

The App has no separate wallet, provider-token store, or App-only identity.

## Capacity rule

One schedule represents one bookable resource. Services on that schedule must be no longer than its slot interval. The booking adapter derives `scheduleId|startsAt` as a unique reservation key. Goalmatic Tables creates the record and uniqueness marker in one transaction, so two guests cannot confirm the same schedule slot. Cancellation changes the reservation key to `released:<bookingId>` while retaining history.

The hosted engine treats every non-`cancelled` booking on a schedule as busy. Bookins uses this for owner time off: a `blocked` record with reservation key `block:<uuid>` and the placeholder email `time-off@bookins.invalid` (reserved TLD, never deliverable). Removing time off cancels the record. `completed` and `no_show` keep their time reserved like `confirmed`.

Owner-created bookings (walk-ins, phone bookings, weekly repeats up to 12) and owner reschedules may ignore weekly hours and minimum notice but never overlap another booking or time off. That overlap check runs in the browser against loaded state, so it is not atomic; exact-start collisions are still rejected by the unique reservation key. Clients without email are stored as `phone-<E.164 digits>@bookins.invalid`.

## Public boundary

The pinned App manifest declares `/book` and four named guest actions. Links have a subject: a profile link lists public services; a service link (`{ kind: 'service', serviceId }`) opens exactly one service, including private ones. The installed owner runtime is not injected on that route. An owner creates an expiring grant for one installation and release. The raw token is exchanged from the URL fragment into an HttpOnly cookie. Guest calls cannot supply account, installation, release, physical Table, or provider IDs. Site Builder injects the grant subject and installation-bound Table IDs before invoking the bounded Goalmatic booking adapter.

## Provider truth

Bookins v0.5.0 guarantees on-screen confirmation, owner dashboard visibility, and Contacts built from booking history plus optional private notes. A non-zero price is informational and described as arranged with the owner; Insights revenue is an estimate from display prices.

Guest messages (confirmation, reminder, reschedule, cancellation, follow-up) are prefilled `wa.me`, `sms:`, and `mailto:` links that open in the owner's own WhatsApp, SMS, or email app. Bookins does not send them and never reports them as sent.

Google Calendar is optional and goes only through the `calendar-sync` capability's Goalmatic operations; Bookins holds no Google credential or client. In the installed owner runtime it can connect an account, list events to flag clashes with upcoming bookings (the app compares against events Bookins did not write), create one event per booking on request (no attendees, idempotency key derived from the booking id, id stored in `bookings.calendar_event_id`), and rename the event "Cancelled: ..." on cancellation. Each write needs per-write approval. A failed Calendar update never blocks or reverses a cancellation; the owner is told and edits the event manually. There is no delete or free/transparent update.

On `/book`, the guest action `calendar-busy` (`integrations.google-calendar.availability`, busy ranges only, input limited to `timeMin`/`timeMax`) is used to hide overlapping openings in the browser. It is **not authoritative**: `booking.create` and `booking.openings-list` do not consult Calendar, so a direct call can still book a slot that is busy on the calendar. On any failure or when Calendar is not connected the guest sees unfiltered openings. Local preview and Demo show Calendar as unavailable.

The owner receives one plain-text email per newly created booking through the `owner-booking-alert` workflow (platform mailer, noreply@goalmatic.io, the owner's registered email). Delivery depends on workflow-run limits and is not shown in the dashboard.

Calendar and owner-alert behavior is unproven until exercised on a real connected account. Guest email delivery, online payment, payout, guest cancellation, rescheduling, and Calendar invites are not claimed until their provider paths are connected and proved.

## Uninstall and release

Uninstall revokes App sessions and public grants before detaching bindings. Data is retained for 30 days and remains exposed as Tables after uninstall unless the owner explicitly deletes eligible App-provisioned data.

Private testing and Store publication are separate. Production must promote the exact tested build and artifact digest without rebuilding.
