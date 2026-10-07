# Bookins

Bookins is a Goalmatic App for service configuration (with CSV import), weekly availability, secure public booking links, appointment management, a small team with their own schedules, owner-opened client messages, campaigns, and contact history derived from bookings.

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

## Features (v0.6.0)

- Services with duration, display price in African currencies, location, public or private visibility, and optional direct links (private services are bookable only through their own link).
- Weekly hours with multiple windows per day, slot interval, minimum notice, horizon, and time off (holidays, breaks) that guests cannot book.
- Guest booking page in English and French with a month calendar, guest-timezone display, add-to-calendar, and collision-safe confirmation.
- Owner bookings: walk-in and phone bookings, weekly repeats, reschedule, completed and no-show tracking, private notes, search, filters, week view, and CSV export.
- Prefilled WhatsApp, SMS, and email messages for confirmations, reminders, changes, and follow-ups, opened in your own apps with editable templates. Bookins does not send messages itself.
- Contacts with private notes and tags, booking history, and no-show counts.
- Insights: booking trends, estimated revenue from display prices, top services, busiest times, cancellation and no-show rates, and new vs returning clients.
- Share kit: link, QR code, WhatsApp share, and a website button snippet.
- Guided first run: an optional product tour and Help menu, setup steps in order (profile, availability, service, link), tooltips, and a reason on every disabled control.

- **Services CSV (v0.6.0):** import and export services as CSV (also paste from Google Sheets: comma, semicolon, or tab). Columns: `category, name, description, duration_minutes, price, currency, visibility, location, active, staff, sort_order, rebook_after_days, prep_notes` (export adds `slug`). The preview shows New / Update / Skip / Error per row before anything is written; a duration longer than your booking interval is an error that points to Availability. Import is idempotent by slug, runs four rows at a time, can be cancelled, and never writes a partial row. Formula cells are stored neutralised (leading apostrophe). Up to 1000 rows per file. Categories, sort order, and prep notes also ride in a hidden trailer on the description (`[[bk:{...}]]`) because the hosted guest page only returns the service description; the owner UI never shows it.
- **Team (v0.6.0):** each member is a person plus their own schedule, so two members can hold the same time in parallel. You are always member #1 ("You") with no data change; nothing differs until you add the first member. Assign a booking to a member (a confirmed booking moves to their schedule after the same overlap and time-off check as rescheduling), bulk assign, and deactivate a member (their guest-page service copies are hidden; bookings are kept). Guests pick "With Amaka" by choosing that member's service copy (capped at 40 copies without confirmation, 200 hard). There is no "any professional" yet.
- **Message journey (v0.6.0):** six editable slots (confirmation, 24h reminder, 2h reminder, prep info, thank-you, rebook nudge) with a preferred channel, per-service overrides, and variables including `{{staff}} {{prep_notes}} {{rebook_link}} {{business_phone}} {{last_service}}`. A Messages queue (Due now, Upcoming, Done) is computed live from your bookings so cancelled or moved bookings never appear; you open each prefilled message in your own app and Bookins records "opened by you". Nothing is sent automatically.
- **Campaigns (v0.6.0):** build an audience from booking history (service or category, last visit, visits, no-shows, staff, tag, source, spend, new this month, due to rebook), save it with message wording and an offer, then open messages one by one in WhatsApp or SMS, in email batches of at most 40 BCC through your own mail app, or export a CSV. Opted-out clients are excluded from every queue, batch, and export; time off and placeholder emails are never in an audience; the queue is capped at 200. Bookins does not send campaigns, does not report delivery or open rates, and cannot apply a discount: an offer is text you honour by hand and optionally track per client. Ask counsel about marketing-consent law in your country before relying on this.

Bookins does not take payments, send guest emails or SMS, or let guests reschedule themselves yet.

## Google Calendar (optional, v0.4.0)

Owners can connect Google Calendar from **Bookings**. Bookins uses only the declared Goalmatic operations in the `calendar-sync` capability:

- **Owner, installed runtime:** `integrations.connection-start` / `connection-complete` (connect popup), `google-calendar.events-list` (connection check and clash flags for upcoming bookings, next 93 days, timed events only), `event-create` ("Add to Google Calendar" per booking or "Add all upcoming"; no attendees; the booking id is the idempotency key; the event id is saved in the booking's `calendar_event_id`), and `event-update` (renames the event "Cancelled: ..." when the booking is cancelled). Every write needs the platform's per-write approval (`app.calendar-write`).
- **Cancel** always succeeds first. If the Calendar update then fails, the owner is told and must fix the event in Google Calendar. The update operation has no free/transparent field, so only the title changes. There is no delete operation.
- **Guest `/book`:** the guest action `calendar-busy` (`google-calendar.availability`, busy ranges only, no titles) lets the booking page hide openings that overlap the owner's busy times. This is a **non-authoritative convenience filter**: `booking.create` does not check Calendar, and if the call fails or Calendar is not connected the page silently shows unfiltered openings.
- **Local preview and Demo** show "not available" for Calendar; nothing is simulated. Hosted without a connection shows a connect prompt.

Not provided: guest invites or email, payments, rescheduling, deleting events, and any Calendar enforcement at booking time. Calendar behavior is unproven until it is tested on a real connected Google account.

## Owner daily agenda (optional, v0.5.0; reminder links v0.6.0)

The `owner-daily-agenda` workflow emails the account owner at 07:00 Africa/Lagos time with today's appointments, today's time off, and bookings received in the last 24 hours, with times in each booking's timezone. It is installed switched off; turn it on from the workflow in Goalmatic. It comes from noreply@goalmatic.io, goes only to the owner's registered Goalmatic email, reads the 200 most recently created bookings, and uses Goalmatic workflow runs. From v0.6.0 it also reads Profiles and Services and adds a section "Reminders to open for tomorrow": one line per confirmed booking tomorrow (in each booking's timezone) with the same prefilled WhatsApp, SMS, or email link the Messages page would build from your 24-hour template (including per-service overrides and `{{prep_notes}}`). Links are prepared when the email is built; bookings moved or cancelled afterwards are not reflected, so the email says to check Messages. It is still one plain-text email to you; Bookins sends nothing to guests. **Unproven:** the digest, including the reminder links, has not been run end to end on a real account; treat it as off until a manual and a scheduled run have been checked. Instant per-booking emails and guest emails are not available.

`scripts/sync-agenda-workflow.mjs` writes `scripts/agenda-transform.src.js` into the manifest; run it after editing the source (a test fails if they drift). The platform rewrites text between angle brackets and double braces in step props, so the source avoids both.

## Data and manifest

v0.6.0 adds optional Tables `staff` (capability `staff-data`) and `campaigns` (capability `campaigns-data`), optional fields on `services`, `bookings`, and `contacts`, and a versioned `message_templates_json`. The App works with both new Tables unbound; Team and Campaigns then say so. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Source layout (v0.6.0)

Pure, unit-tested logic lives at the repo root so pages stay thin: `scheduling.js` (slots and overlap), `services.js` and `csv.js` (service CSV), `team.js` (staff-as-schedule), `messaging.js` (templates, queue, links), `campaigns.js` (segments and queues), `service-meta.js` (the description trailer), `records.js` (shared record predicates), `weekly-hours.js` and `team-ui.js` (hours editing helpers), `guest-page.js` (guest page helpers). Screens: `pages/*.vue`; shared UI in `components/` (`ServiceImportDialog`, `ServiceTeamFields`, `WeeklyHoursEditor`, `ProductTour`, `WorkspaceMenu`, `CreditsPill`, `ui/Gm*`).

## Tests

```bash
node --test tests/*.test.js        # also run with TZ=UTC, America/New_York, Pacific/Auckland
```

## Build

```bash
yarn build
```

## Source and releases

`preview` is the editable branch. `main` is the read-only Store candidate. A push updates source and previews only. Production changes through the App Store release flow using an immutable tested build.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for records, trust boundaries, and release limits.
