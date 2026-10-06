# Bookins competitive feature plan (2026-10-06)

Sources: 08-research-scheduling.md (Calendly, Cal.com, SavvyCal, TidyCal, Google, Microsoft, Zoho, YouCanBook.me) and 09-research-services-africa.md (Acuity, Square, Setmore, SimplyBook.me, Fresha, Booksy, Vagaro, Booklink and African tools). Feasibility checked against the hosted engine (`runtimeService.ts`, snapshot 2026-10-01) and the platform workflow nodes.

Legend: **BUILD** = this release, honest with the hosted engine. **PLATFORM** = needs a Goalmatic engine change (see 07-platform-requests.md). **BLOCKED** = AGENTS.md provider rule.

## Where Bookins already matches or beats the field

| Feature | Status |
| --- | --- |
| Weekly hours, multiple windows per day, notice, horizon, slot interval | Shipped |
| Collision-safe booking (unique reservation key + server re-check) | Shipped |
| Guest timezone detection + switcher | Shipped |
| Add to calendar (.ics + Google) | Shipped |
| Google Calendar connect, add events, clash flags, guest busy filter | Shipped (unproven on real account) |
| Owner new-booking email | Shipped (unproven) |
| Bookings search, filters, week view, CSV export | Shipped |
| African currencies, free with no commission or per-seat fee | Shipped |

## Gap list

| # | Feature (who has it) | Plan |
| --- | --- | --- |
| 1 | Time off, holidays, blocked dates (all) | **BUILD**: owner "blocked" records in Bookings. The hosted engine treats every non-cancelled record on the schedule as busy, so guests truly cannot book them. |
| 2 | Buffer between appointments (all) | **BUILD** (honest form): show spacing = slot interval minus service duration as the buffer. Separate before/after buffers are **PLATFORM**. |
| 3 | Owner-created bookings, walk-ins, phone bookings (Acuity, Square, Fresha, Setmore) | **BUILD**: create from dashboard, overlap-checked, unique key. |
| 4 | Recurring appointments (Acuity, SimplyBook, Vagaro) | **BUILD**: owner "repeat weekly ×N" with per-occurrence collision report. |
| 5 | Owner reschedule (all) | **BUILD**: move booking with overlap check, then message the guest. |
| 6 | Guest self-serve reschedule/cancel link (all) | **PLATFORM**. |
| 7 | Confirmation and reminder messages (all; SMS/WhatsApp paid add-ons elsewhere) | **BUILD, WhatsApp-first and free**: one-tap prefilled WhatsApp, SMS, and email messages for confirmation, reminder, reschedule, cancellation, and follow-up, with editable templates. Plus a "Tomorrow" reminder queue on Overview. Automatic guest sending is **PLATFORM/BLOCKED**. |
| 8 | No-show and completed tracking (Acuity, Fresha, Booksy, Vagaro) | **BUILD**: status completed / no-show, rates in Insights and per contact. |
| 9 | Private owner notes on bookings (all service tools) | **BUILD**. |
| 10 | Client records, notes, tags (Acuity, Fresha, Setmore, Vagaro) | **BUILD**: new `contacts` Table merged with booking history. |
| 11 | Secret / per-service links (Calendly, Cal.com, TidyCal) | **BUILD**: engine already supports `{kind:'service'}` grants, which makes private services bookable by direct link. |
| 12 | Share kit: QR code, WhatsApp share, website button snippet (Calendly, Fresha, Booksy) | **BUILD**. Iframe embed is unverified on hosted headers, so a link-button snippet only. |
| 13 | Meeting location / video link per service (all) | **BUILD**: service location field, used in owner messages and calendar events. The guest page cannot show it until page-get returns it (**PLATFORM**). |
| 14 | Analytics (Calendly paid, Acuity, Fresha, Vagaro) | **BUILD**: Insights page with volume trend, estimated revenue from display prices, top services, busiest days and hours, cancellation and no-show rates, new vs returning clients, lead time. |
| 15 | Localized booking page (French for francophone Africa) | **BUILD**: English and French guest page with a toggle. Swahili, Hausa, and Yoruba need native review first. |
| 16 | Lightweight, low-data guest page (Africa research) | **BUILD**: measure and trim the /book bundle and avoid heavy owner-only code. |
| 17 | Custom booking questions (all) | **PLATFORM**: page-get does not expose service config. |
| 18 | Daily / weekly booking caps (Calendly, Cal.com) | **PLATFORM**. |
| 19 | Separate before/after buffers, date-specific custom hours | **PLATFORM**. |
| 20 | Branding on the guest page (colour, logo) | **PLATFORM**: page-get returns name, bio, photo only. |
| 21 | Team, round-robin, multi-staff | **PLATFORM**. One schedule = one resource; schedules do not block each other. |
| 22 | Online payments, deposits, Paystack / Flutterwave / M-Pesa / MoMo | **BLOCKED**: real provider flow first. Pay-at-venue stays default. |
| 23 | Automatic guest email and SMS reminders | **PLATFORM/BLOCKED**: no delay node; guest recipient mapping unproven. |
| 24 | Waitlist, classes / group bookings, packages, gift cards, reviews | **PLATFORM / later**. |
| 25 | Video link auto-generation (Zoom/Meet) | **PLATFORM**. |

## Our marketing angle after this release

Free WhatsApp-first messaging with no per-message fees, no commission, African currencies, French booking page, collision-proof slots, Google Calendar clash detection, no-show tracking, and client records. Competitors charge for SMS/WhatsApp reminders, remove branding only on paid tiers, and none verify a local payment rail.
