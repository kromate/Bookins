# 08 - Scheduling-first booking platforms: 2026 feature research

Researched 2026-10-06 via official pricing/help pages plus secondary roundups. Legend: ✓ = included on free/entry tier; paid = needs a paid plan; ✗ = not offered; "?" = unverified (page did not state it, or sources conflict).
Fetch tooling returned summarized page text, so every cell is only as strong as its cited source. Confidence is lowest for Microsoft Bookings, Google appointment schedules (tier detail), YouCanBook.me (plan prices differ by source), and TidyCal (official page and third-party reviews disagree).

## Sources (official first)
- Calendly: https://calendly.com/pricing , https://calendly.com/help/choose-the-right-calendly-plan-for-your-team , https://calendly.com/help/workflows-overview , https://calendly.com/help/how-to-use-buffers
- Cal.com: https://cal.com/pricing , https://cal.com/help/workflows/workflowsoverview , https://cal.com/docs/core-features/event-types/event-buffer , https://cal.com/docs/core-features/event-types/limit-future-bookings , https://cal.com/docs/core-features/event-types/minimum-notice , https://cal.com/scheduling/calcom-vs-calendly (vendor marketing, treat as biased)
- SavvyCal: https://savvycal.com/pricing , https://savvycal.com/features
- TidyCal: https://tidycal.com/pricing
- Google: https://support.google.com/calendar/answer/10729749 , https://workspace.google.com/resources/appointment-scheduling/
- Microsoft: https://learn.microsoft.com/en-us/microsoft-365/bookings/bookings-overview , https://learn.microsoft.com/en-us/microsoft-365/bookings/define-service-offerings
- Zoho: https://www.zoho.com/bookings/pricing.html , https://www.zoho.com/bookings/features.html
- YouCanBook.me: https://youcanbook.me/pricing , https://youcanbook.me/features
- Secondary (reviews/comparisons, lower trust): https://zeeg.me/en/blog/post/youcanbookme-pricing-features , https://koalendar.com/blog/youcanbookme-pricing , https://schedulingkit.com/reviews/tidycal-review , https://schedulingkit.com/reviews/zoho-bookings-review , https://www.capterra.com/p/148036/Calendly/reviews , https://www.capterra.com/p/250843/TidyCal/reviews/ , https://www.g2.com/products/savvycal/reviews (G2 direct fetch was blocked 403; G2 rating 4.8 seen via search snippet), https://vocus.io/blog/calendly-alternatives , https://sendpulse.com/blog/calendly-alternatives

## Pricing snapshot (as fetched; annual billing unless noted)
| Platform | Free tier | Paid entry | Team tier | Notes |
|---|---|---|---|---|
| Calendly | 1 event type, 1 calendar, branded | Standard $10/seat | Teams $16/seat; Enterprise from ~$15k/yr, 50 seats min | Monthly billing ~$16/$20 per seat (secondary). "Plus" AI add-ons cost more (+$8/seat on Teams). |
| Cal.com | Free forever, unlimited event types | Teams $12/user | Organizations $28/user; Enterprise custom | Open source, self-hostable. |
| SavvyCal | No free plan (trial + 30-day refund) | Basic $10/user | Premium $17/user | Secondary sources list $12/$20 (probably monthly). |
| TidyCal | Free: unlimited bookings/types, 1 calendar, 1% fee on Stripe | Lifetime $29 (Individual), $79 (Agency); Pro $12/mo or $99/yr | n/a (Agency lifetime has team features) | AppSumo lifetime; Agency LTD capped at 4 team members for purchases from 2026-09-01 (secondary source). |
| Google Calendar appointment schedules | Basic schedule on personal Google account | Multiple booking pages, payments, more on Workspace Business Standard+ | Included in Workspace | Exact per-plan matrix unverified. |
| Microsoft Bookings | None standalone | Included in M365 Business Basic/Standard/Premium, E1/E3/E5, Teams Essentials | SMS needs Teams Premium | Personal + Shared Bookings. |
| Zoho Bookings | Free, 1 user | Basic $6 (mo)/$8 (yr per listing) | Premium $9/$12 | Prices as extracted look inverted (yearly higher than monthly); treat as unverified. |
| YouCanBook.me | Free: 1 page, 1 calendar, branded | Individual ~$9, Professional ~$13 monthly | Teams ~$18/member | Official page extraction was garbled ($0); prices from secondary sources. Priced by calendar-connection count. |

## 1. Feature matrix

### 1a. Availability rules
| Feature | Calendly | Cal.com | SavvyCal | TidyCal | Google | MS Bookings | Zoho | YCBM |
|---|---|---|---|---|---|---|---|---|
| Weekly hours, multiple windows/day | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Multiple named schedules (reuse per event) | paid (1 event type on free) | ✓ | ✓ | ? | ✗ (per schedule) | ✓ (per service/staff) | ✓ | ✓ (per page) |
| Date overrides / specific dates | ✓ | ✓ | ✓ | ✓ (?) | ✓ | ✓ (?) | ✓ | ✓ |
| Buffer before/after | ✓ | ✓ (before+after, per event) | ✓ | ✓ (?) | ✓ (single buffer) | ✓ (buffer time per service) | ✓ | ✓ |
| Min notice | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (min lead time) | ✓ | paid (Individual+) |
| Booking horizon (max future) | ✓ (date range, rolling or fixed) | ✓ (rolling days, business days, or date range) | ✓ | ✓ | ✓ | ✓ (max lead time, days) | ✓ | paid (Individual+) |
| Daily/weekly/monthly caps | ✓ (per event type; day/week/month) | ✓ (day/week/month/year frequency + total duration limits) | ✓ (frequency limits) | ? | ✓ (max per day) | ? | ✓ (?) | ✓ (daily cap hides full days) |
| Start-time increments / slot interval | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Time blocking / focus time, clustering | ✗ | ✗ | ✓ (time blocks, clustering) | ✗ | ✗ (manual) | ✗ | ✗ | ✗ |
| Checks multiple calendars for conflicts | paid (up to 6) | ✓ | ✓ | 1 free / 10 paid / unlimited Pro | ✓ (multiple calendar checks, paid Workspace) | ✓ (Outlook) | ✓ | 1 free / 2 / 6 by plan |

### 1b. Event types
| Feature | Calendly | Cal.com | SavvyCal | TidyCal | Google | MS Bookings | Zoho | YCBM |
|---|---|---|---|---|---|---|---|---|
| Unlimited event types | paid (free = 1) | ✓ | ✓ | ✓ | ✓ (multiple pages paid) | ✓ | ✓ | page-count limited (1/2/10/15+) |
| One-to-one | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Group / seats | paid | ✓ (seats) | ✓ (?) | paid (lifetime+) | ✓ (?) group appts unverified | ✓ (group bookings) | ✓ | paid (Individual+) |
| Collective (all hosts) | paid (Standard "collective") | paid (Teams) | ✓ (Basic) | paid (Agency) | ✗ | ✓ (shared pages) | ✓ | paid (Teams) |
| Round robin | paid (Teams) | paid (Teams) | ✓ (Basic) | paid (Agency) | ✗ | ✓ (any staff) | ✓ free | paid (Teams) |
| Recurring / packages | ? | ✓ (weekly/monthly/yearly, N times) | ? | ✓ free (recurring + packages) | ✗ | ✓ (recurring appts in newer builds; unverified) | ✓ (?) | ✗ |
| Requires host confirmation | ✓ (?) | ✓ | ? | ? | ✗ | ✗ (?) | ✓ (?) | ✓ (?) |
| Secret/hidden event type | ✓ | ✓ (hidden) | ✓ (?) | ? | ✗ | ✓ (unlisted services) | ? | ✓ (separate links) |
| Single-use link | ✓ (all plans) | ✓ (private/expiring links) | ✓ (?) | ? | ✗ | ✗ | ? | ? |
| Password protected page | ✗ | ? | ? | ? | ✗ | ✗ | ? | paid (Individual+) |
| Resources (rooms/chairs) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (staff only; unverified) | ✓ (resource bookings) | ✗ |

### 1c. Booking page & branding
| Feature | Calendly | Cal.com | SavvyCal | TidyCal | Google | MS Bookings | Zoho | YCBM |
|---|---|---|---|---|---|---|---|---|
| Logo + accent color | ✓ | ✓ | paid (Premium "custom branding") | ✓ | limited | ✓ | ✓ | paid (Individual+) |
| Remove vendor branding | paid (Standard+) | paid (Teams+) | paid (Premium) | paid (Pro) | n/a | n/a | paid (Basic+ white label) | paid (Teams per extraction; secondary says Individual+: conflict) |
| Custom domain | ✗ (all tiers, per secondary) | paid (Teams+/Org) | paid (Premium) | paid (Pro) | ✗ | ✗ | paid (Premium) | ? |
| Custom email sender domain | ✗ | paid (Org+) | ? | ? | ✗ | ✗ | ? | ? |
| Multi-language booking page | ✓ | ✓ | ? | ✓ (translations) | ✓ | ✓ | ✓ | ✓ (40+ languages) |

### 1d. Guest experience
| Feature | Calendly | Cal.com | SavvyCal | TidyCal | Google | MS Bookings | Zoho | YCBM |
|---|---|---|---|---|---|---|---|---|
| Auto timezone detect + switcher | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Self-serve reschedule/cancel link | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Add-to-calendar (.ics/Google/Outlook) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Guest overlay of own calendar | ✗ | ✗ | ✓ (signature) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Guest picks/ranks preferred times, personalized links | ✗ | ✗ | ✓ (ranked availability) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Meeting polls | ✓ (paid; "meeting polls") (?) | ✗ | ✓ (all plans) | ✗ | ✗ | ✗ | ✗ | ✓ (collaborative polls, Teams) |
| Customer portal | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | paid (Basic+) | ✗ |
| Email verification vs spam | ✗ (?) | ✓ (email verification / blocklist, unverified in detail) | ? | ? | ✓ (paid Workspace) | ✗ | ? | ? |

### 1e. Notifications & automation
| Feature | Calendly | Cal.com | SavvyCal | TidyCal | Google | MS Bookings | Zoho | YCBM |
|---|---|---|---|---|---|---|---|---|
| Confirmation email (guest + host) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Email reminders | paid (workflows) | ✓ default; custom paid | ✓ | ✓ | ✓ (up to 5, text not editable) | ✓ | ✓ | paid (Individual+) |
| SMS reminders | paid (workflows) | paid (workflows, Org+) | ✓ (via workflows, ? plan) | paid (10/mo Agency; unlimited Pro) | ✗ | paid (Teams Premium license) | paid (Basic+) | paid (Individual per secondary) |
| WhatsApp messages | ✗ | paid (workflows) | ✗ | ✗ | ✗ | ✗ | ✓ (integration) | ✗ |
| Workflow triggers | new booking, before start, start, end, rescheduled, canceled, no-show marked | new booking, before start, after end, canceled, rescheduled, booking requested/rejected, payment initiated/successful, no-show updated, routing form submitted (+ no booking) | reminders/follow-ups (detail unverified) | ✗ (no advanced automation) | ✗ | reminders only | custom workflows + custom functions | confirmations, reminders, follow-ups (page-level) |
| Webhooks / API | paid-ish (?) | ✓ free | ✓ (Basic) | ✓ (?) Zapier | ✗ | Graph API | ✓ | paid (Zapier on Professional+) |
| Zapier / no-code | paid (Standard+) | ✓ | ✓ | ✓ all plans | ✗ | Power Automate | ✓ | paid (Professional+) |

### 1f. Calendar & video integrations
| Feature | Calendly | Cal.com | SavvyCal | TidyCal | Google | MS Bookings | Zoho | YCBM |
|---|---|---|---|---|---|---|---|---|
| Google Calendar | ✓ | ✓ | ✓ | ✓ | native | ✗ | ✓ | ✓ |
| Outlook/Microsoft 365 | ✓ | ✓ | ✓ | ✓ | ✗ | native | ✓ | ✓ |
| Apple/iCloud | ✓ | ✓ | ✓ | ? | ✗ | ✗ | ? | ✓ |
| Zoom / Meet / Teams auto-link | ✓ | ✓ | ✓ | ✓ (auto links on paid lifetime) | Meet | Teams | ✓ (Zoho Meeting + others) | ✓ |
| Number of connected calendars | 1 free / 6 paid | unlimited | unlimited | 1 / 10 / unlimited | multiple | Outlook | multiple | 1 / 2 / 6 / 10 |

### 1g. Payments
| Feature | Calendly | Cal.com | SavvyCal | TidyCal | Google | MS Bookings | Zoho | YCBM |
|---|---|---|---|---|---|---|---|---|
| Collect payment at booking | paid (Stripe/PayPal, Standard+) | ✓ free (Stripe, PayPal, others) | paid (Premium) | ✓ free (1% fee) / 0% on Pro | paid Workspace (Stripe) | ✗ (?) (Teams Premium payments unverified) | paid (Premium) | ✓ (Stripe; Apple/Google Pay; promo codes) |
| Promo codes | ? | ? | ? | ? | ✗ | ✗ | ? | ✓ |
| Deposits / no-show fee | ✗ (?) | ✓ (no-show fee via Stripe, unverified detail) | ? | ? | ✗ | ✗ | ? | ? |
| Africa-relevant gateways (Paystack, Flutterwave, M-Pesa) | ✗ | ✗ (community only; unverified) | ✗ | ✗ | ✗ | ✗ | paid (some gateways, unverified) | ✗ |

### 1h. Team / multi-staff
| Feature | Calendly | Cal.com | SavvyCal | TidyCal | Google | MS Bookings | Zoho | YCBM |
|---|---|---|---|---|---|---|---|---|
| Staff-specific booking | paid (Teams) | paid (Teams) | ✓ | paid (Agency) | limited | ✓ (Shared Bookings) | ✓ (roles, free) | paid (Teams) |
| Round-robin modes | rotate; optimize availability | weighted, priority, load balance, fixed hosts (?) | pooling "fair distribution" | basic | ✗ | any available | ✓ | optimize availability / equal distribution / fixed priority |
| Admin roles, managed event types | paid (Teams+) | paid (Teams/Org) | ? | ? | ✗ | ✓ | ✓ | paid (Teams) |
| Multiple locations/workspaces | ✗ | org-level | ✗ | ✗ | ✗ | ✓ | paid (Premium 3 workspaces) | ✗ |

### 1i. Routing / forms
| Feature | Calendly | Cal.com | SavvyCal | TidyCal | Google | MS Bookings | Zoho | YCBM |
|---|---|---|---|---|---|---|---|---|
| Custom booking questions | ✓ (text, dropdown, radio, checkbox, phone etc.) | ✓ (text, textarea, select, multi-select, phone, number, checkbox, radio, hidden, conditional) | ✓ | paid-ish ("no intake forms" per secondary) | ✓ (custom fields) | ✓ (custom fields per service) | ✓ | ✓ (conditional questions) |
| Routing forms | paid (Teams) | paid (Teams; attribute-based routing) | ✗ | ✗ | ✗ | ✗ | paid (Basic+) | ✗ |

### 1j. Analytics / reporting
| Feature | Calendly | Cal.com | SavvyCal | TidyCal | Google | MS Bookings | Zoho | YCBM |
|---|---|---|---|---|---|---|---|---|
| Booking analytics | paid (Teams) (?) | paid (Insights, Teams+) | basic | paid (lifetime) | ✗ | basic (Bookings app) | ✓ (day/week/month by service, staff, appointment) | paid (Professional+) |
| Data export CSV | paid (?) | ✓ | ✓ (?) | ? | ✗ | ✗ | ✓ (?) | ✓ (?) |

### 1k. Admin / CRM
| Feature | Calendly | Cal.com | SavvyCal | TidyCal | Google | MS Bookings | Zoho | YCBM |
|---|---|---|---|---|---|---|---|---|
| CRM integrations | paid (HubSpot Standard; Salesforce Teams) | paid (HubSpot/Salesforce) | ? | ✗ | ✗ | Dynamics (?) | paid (Zoho CRM Premium) | Zapier |
| Built-in client list / CRM | ✗ | ✗ | ✗ | ✗ | ✗ | customer list (✓) | customer portal paid | ✗ |

### 1l. Embeds & sharing
| Feature | Calendly | Cal.com | SavvyCal | TidyCal | Google | MS Bookings | Zoho | YCBM |
|---|---|---|---|---|---|---|---|---|
| Inline/popup/floating embed | ✓ (free incl.) | ✓ | ✓ (Basic) | ✓ | ✓ (embed/link) | ✓ (iframe) | ✓ | ✓ |
| Browser extension | ✓ free | ✗ (?) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Mailbox/email-embed of times | ✓ (?) | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

### 1m. Mobile apps
Calendly: iOS/Android app on all plans. Cal.com: mobile app (status unverified; mobile web works). Zoho: native iOS/Android (staff schedule mgmt). TidyCal: no native app (secondary source). Google: Calendar app manages bookings. MS: Bookings inside Teams/Outlook mobile. SavvyCal, YCBM: ? (unverified).

### 1n. Security / compliance
| Feature | Calendly | Cal.com | SavvyCal | TidyCal | Google | MS Bookings | Zoho | YCBM |
|---|---|---|---|---|---|---|---|---|
| SSO/SAML | paid (Enterprise) | paid (Org+) | ✗ | ✗ | Workspace SSO | M365 Entra | ? | ? |
| HIPAA | paid (Enterprise, ?) | paid (Org+) | ✗ | ✗ | Workspace BAA (?) | M365 compliance | ? | ? |
| Audit log | paid (Enterprise) | paid | ✗ | ✗ | Workspace | M365 | ? | ? |
| Self-host / data residency | ✗ | ✓ self-host free; dedicated DB Enterprise | ✗ | ✗ | ✗ | Exchange Online storage | regional DCs (?) | ✗ |

### 1o. AI features
Calendly: Notetaker and "Callie" email scheduling assistant, paid "Plus" add-ons (Standard/Teams). Zoho: AI auto-generates event types/staff labels at signup. TidyCal: "AI assistant" on paid lifetime (details unverified). Cal.com: AI scheduling assistant (Cal.ai) status unverified. SavvyCal, Google, MS Bookings, YCBM: none verified.

## 2. How the leaders implement the details
- Buffers: Calendly sets before/after per event type and they reduce offered slots (all plans). Cal.com has before and after, per event type. Google has a single buffer setting. MS Bookings blocks buffer on staff calendar (shows busy).
- Daily limits: Calendly caps per event type per day/week/month; Cal.com adds total-duration caps and yearly frequency; YCBM hides fully booked days but keeps week visible; Google caps appointments per day.
- Min notice / horizon: Cal.com minimum notice from minutes to days; future limit as rolling N days (calendar or business days) or a fixed date range. Calendly "date range" supports rolling days or fixed range. MS uses min/max lead time.
- Date overrides: Calendly "date-specific hours" and Cal.com "date overrides" per schedule.
- Reschedule/cancel: tokenized links in confirmation email (all); Cal.com host can "request reschedule"; Calendly reconfirmation request workflows.
- No-show: Calendly host marks no-show and invitee receives only no-show automations; Cal.com marks attendee/host no-show and exposes a trigger.
- Workflows: Calendly up to 50 automations, email/SMS/third-party email actions, reminder/follow-up timing relative to start/end. Cal.com Trigger -> Action with email/SMS/WhatsApp to attendee, host, or specific number; custom workflows need Org plan.
- Single-use links: Calendly one-time expiring link on every plan. Secret events: link-only, hidden from profile.
- Booking questions: Cal.com richest (field types, hidden fields, conditionals, prefill); YCBM conditional questions; MS custom fields per service (e.g. insurance provider).
- Round-robin modes: YCBM optimizes availability, equal distribution, or fixed priority; Cal.com adds weights/priorities (detail unverified); Zoho free tier includes it.
- Google: Stripe payment, up to 5 reminders (uneditable text), email verification, custom fields; multiple pages and payments gated to Workspace.

## 3. Table stakes (every serious competitor has)
1. Weekly availability with multiple windows per day
2. Date-specific overrides / blocked dates
3. Buffer before and after
4. Minimum notice
5. Booking horizon (max days ahead)
6. Slot interval / start-time increments
7. Multiple event types / services with duration
8. Two-way calendar sync with conflict checking
9. Auto-detected timezone with guest switcher
10. Confirmation emails to guest and host
11. Email reminders (often gated, but universal)
12. Guest self-serve reschedule and cancel link
13. Add-to-calendar (.ics / Google / Outlook)
14. Custom booking questions (required/optional)
15. Auto video-meeting link (Meet/Zoom/Teams)
16. Embed (inline/popup/link) and shareable URL
17. Stripe payment at booking (gated on some)
18. Daily/weekly booking caps
19. Logo/colors customization
20. Zapier/webhooks integration

## 4. Differentiators
- SavvyCal: guest calendar overlay, ranked availability, personalized links; G2 4.8 (about 36 reviews); users praise overlay, some say pricey for individuals (https://www.g2.com/products/savvycal/reviews via search snippet; not fetched).
- Cal.com: open source/self-host, free-tier payments, deep workflows (WhatsApp, payment and no-show triggers), attribute-based routing, API and webhooks.
- TidyCal: lifetime pricing, free paid-bookings + recurring/packages + digital storefront (secondary review).
- YouCanBook.me: priced by calendar connections not seats; round-robin modes; promo codes with Apple/Google Pay.
- Zoho Bookings: resource bookings, customer portal, WhatsApp, cheap per-staff, free round robin, native mobile app, Zoho CRM sync.
- Microsoft Bookings: bundled free in M365, Teams/Outlook native, shared mailboxes for compliance, staff scheduling.
- Calendly: brand recognition, polished UX, Salesforce routing, AI Notetaker.
- Google: zero-setup in Calendar, free for individuals.
User-love evidence is mostly secondary roundups; no Reddit threads were retrievable (unverified).

## 5. Common complaints (challenger openings)
- Per-seat pricing and steep tiers (Calendly Teams $16/seat, Enterprise from ~$15k/yr, 50-seat min; add-on AI "Plus" priced per seat). Source: pricing page, https://vocus.io/blog/calendly-alternatives
- Free tier too thin: Calendly free = 1 event type, 1 calendar, no reminders/workflows; YCBM free = 1 page/1 calendar; Zoho free "limited" per reviews.
- Branding removal and custom domain paywalled (Calendly: no custom domain at any tier per secondary; Cal.com Teams+; SavvyCal Premium; TidyCal Pro).
- SMS/WhatsApp reminders gated (Calendly workflows paid; MS needs Teams Premium; TidyCal SMS capped at 10/mo on Agency).
- Payments gated or foreign-centric (Calendly paid; SavvyCal Premium; Stripe/PayPal only; no Paystack/Flutterwave/M-Pesa verified anywhere).
- Calendar sync drift (TidyCal "most repeated complaint"); calendar-connection caps.
- Zoho: slow support, difficult setup, dated/limited UI customization (G2 4.1 over 54 reviews; SchedulingKit 3.6).
- TidyCal: no native mobile app, no SMS (per secondary; official page says SMS exists on paid), few integrations, slow updates.
- Calendly/others: support on lower tiers is slow; limited design control.
- Overbuilt for single-owner service businesses (Calendly/Cal.com built around meetings, not services with prices; no client records/CRM in most).
- Gaps likely unaddressed (unverified): offline/low-bandwidth friendly pages, local currency display, WhatsApp-first confirmations, mobile-money payment, deposits.
