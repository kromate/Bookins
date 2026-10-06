# Bookins

Bookins is a Goalmatic App for service configuration, weekly availability, secure public booking links, appointment management, and contact history derived from bookings.

Owners use their existing Goalmatic identity and selected account. The App stores profiles, schedules, services, and bookings in installation-bound Goalmatic Tables. Guests enter through an expiring public grant that exposes only the declared booking actions.

## Local development

Create a Web Key in **Site Builder > App Store > Local development**. Copy the
checked-in example and set the key:

```bash
cp .env.example .env.local
# Set VITE_GOALMATIC_API_KEY in .env.local.
yarn install --frozen-lockfile
yarn dev
```

Keep using the normal Vite command. A `gmw_dev_...` key connects this source to
isolated development Tables. The App uses the signed-in workspace's real shared
credits. A `gmw_prod_...` key connects the same local source to the current Store
release permissions, production App data, connected accounts, provider actions,
and real credits. To change environments, change only
`VITE_GOALMATIC_API_KEY`. You do not need a Goalmatic CLI, proxy, or custom
command.

The Web Key is a public App identifier, not an account credential. Goalmatic
sign-in and the App consent screen authorize protected data and credit use.
Production-local keys accept only exact registered loopback origins. The consent
screen requires an explicit production warning confirmation. Never put a private
account key or provider secret in a `VITE_*` variable. Never commit `.env.local`.

If no Web Key is configured, Bookins seeds an in-memory local sample workspace and
labels it clearly. Reloading resets that sample. If a configured key is invalid or
its origin is not allowed, startup
fails visibly instead of falling back to sample data. Hosted builds never use
preview data.

## Features (v0.5.0)

- Services with duration, display price in African currencies, location, public or private visibility, and optional direct links (private services are bookable only through their own link).
- Weekly hours with multiple windows per day, slot interval, minimum notice, horizon, and time off (holidays, breaks) that guests cannot book.
- Guest booking page in English and French with a month calendar, guest-timezone display, add-to-calendar, and collision-safe confirmation.
- Owner bookings: walk-in and phone bookings, weekly repeats, reschedule, completed and no-show tracking, private notes, search, filters, week view, and CSV export.
- Prefilled WhatsApp, SMS, and email messages for confirmations, reminders, changes, and follow-ups, opened in your own apps with editable templates. Bookins does not send messages itself.
- Contacts with private notes and tags, booking history, and no-show counts.
- Insights: booking trends, estimated revenue from display prices, top services, busiest times, cancellation and no-show rates, and new vs returning clients.
- Share kit: link, QR code, WhatsApp share, and a website button snippet.

Bookins does not take payments, send guest emails or SMS, or let guests reschedule themselves yet.

## Google Calendar (optional, v0.4.0)

Owners can connect Google Calendar from **Bookings**. Bookins uses only the declared Goalmatic operations in the `calendar-sync` capability:

- **Owner, installed runtime:** `integrations.connection-start` / `connection-complete` (connect popup), `google-calendar.events-list` (connection check and clash flags for upcoming bookings, next 93 days, timed events only), `event-create` ("Add to Google Calendar" per booking or "Add all upcoming"; no attendees; the booking id is the idempotency key; the event id is saved in the booking's `calendar_event_id`), and `event-update` (renames the event "Cancelled: ..." when the booking is cancelled). Every write needs the platform's per-write approval (`app.calendar-write`).
- **Cancel** always succeeds first. If the Calendar update then fails, the owner is told and must fix the event in Google Calendar. The update operation has no free/transparent field, so only the title changes. There is no delete operation.
- **Guest `/book`:** the guest action `calendar-busy` (`google-calendar.availability`, busy ranges only, no titles) lets the booking page hide openings that overlap the owner's busy times. This is a **non-authoritative convenience filter**: `booking.create` does not check Calendar, and if the call fails or Calendar is not connected the page silently shows unfiltered openings.
- **Local preview and Demo** show "not available" for Calendar; nothing is simulated. Hosted without a connection shows a connect prompt.

Not provided: guest invites or email, payments, rescheduling, deleting events, and any Calendar enforcement at booking time. Calendar behavior is unproven until it is tested on a real connected Google account.

## Owner booking alert (optional, v0.4.0)

When a new booking is created, the `owner-booking-alert` workflow emails the account owner the service, start time (in the booking timezone, with the UTC ISO time), guest name, email, phone, notes, and reference. It comes from noreply@goalmatic.io, goes only to the owner's registered Goalmatic email, does not fire for cancellations or edits, and uses Goalmatic workflow runs. Guest confirmation and reminder emails are not available.

## Build

```bash
yarn build
```

## Source and releases

`preview` is the editable branch. `main` is the read-only Store candidate. A push updates source and previews only. Production changes through the App Store release flow using an immutable tested build.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for records, trust boundaries, and release limits.
