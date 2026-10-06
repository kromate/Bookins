# 04 - Platform capability research for Bookins (read-only; evidence-based)

Paths. BE = /Users/anthonyakpan/Desktop/mini/.audit/plugin-publishing-2026-10-01/runtime-source/backend/functions/src. Apps = /Users/anthonyakpan/Desktop/mini/apps. Snapshot is dated 2026-10-01; deployed behaviour is unverified.

## 0. Bookins today
- Manifest declares only `tables` and two `tools` capabilities. `booking-public` (booking.page-get, booking.openings-list, booking.create) and `booking-owner` (booking.cancel). `resources.agents/workflows/tools/nodes` are all empty (Apps/bookins/.goalmatic/app.json:158-228 capabilities; :528-530 empty resources).
- Guest route /book has 3 guest actions bound to tables (app.json:48-157). Guest SDK use: booking.js:358-415 (`GoalmaticGuest.query/command`).
- Owner cancel bypasses the `booking.cancel` op: booking.js:270-281 patches the Table directly (the engine op is BE/apps/booking/runtimeService.ts:379-403, same effect).
- Result of a booking is hard-coded "on-screen-only": runtimeService.ts:350 (`delivery: 'on-screen-only'`), runtimeService.ts:206 (`notices: {email:'not-sent', calendar:'not-created'}`).
- AGENTS.md: payments, Calendar writes, email delivery are unavailable until a real connected-provider flow is implemented and proved. docs/ARCHITECTURE.md "Provider truth" repeats this.

## 1. Platform operations relevant to Bookins

### 1a. Who can call what (auth model)
- Guest callers authenticate as `service-token`, which maps to audience `service`: BE/platform/auth.ts:94-102 (api-key/user-session -> owner; app-session -> authenticated; else service). Guest executions run as roles `['public']`, accessMode `guest`: BE/platform/appBrowserRuntime.ts:1476-1486.
- So an op is guest-declarable only if its `audiences` includes `service`. Owner installed runtime (app-session) needs `authenticated`.
- Guest manifest rules (BE/platform/appPublicContract.ts:263-270): action `capabilityId` must list the operationId; `agents.*` ops are forbidden for guests; `workflows.*` guest actions MUST bind `boundInput.flowId` = `{resourceKind:"workflow", logicalResourceId}`; `tables.*` must bind `tableId`. Schemas cannot use `$ref`/`pattern` (appPublicContract.ts:154). Reserved inputs can't be supplied (appPublicContract.ts:11).
- Guest ops with `approval:'policy'` receive an auto policy grant (appBrowserRuntime.ts:1493-1501), so a guest-declared calendar-write is technically admissible (see 1b), but AGENTS.md forbids claiming it until proved. Adding any new capability makes the release non-automatic: "Added permissions" (BE/platform/appRuntime.ts:1600; `updatePolicy.automaticWithoutNewCapabilities`, app.json:233).

### 1b. Google Calendar (integration id `GOOGLECALENDAR`; the only value in the connection-start enum, BE/platform/catalog.ts:126)
| Operation | Catalog | Audiences | Approval | Notes |
|---|---|---|---|---|
| integrations.connections-list | catalog.ts:~99-111 | service, owner, tenant, authenticated | none | non-secret metadata |
| integrations.connection-start / -complete | catalog.ts:115-150 | owner, authenticated | policy `app.integration-connect` | owner OAuth popup |
| integrations.google-calendar.availability (freebusy) | catalog.ts:847-863; executor executors.ts:557-604 | service, owner, authenticated, public | none | input `timeMin,timeMax` (+`calendarId`,`timezone` read at executors.ts:574-575 though not in schema); max 31 days; returns `busy:[{start,end}]` only, no titles. Uses `getGoogleCalendarClient(caller.accountId)` = owner account |
| ...events-list | catalog.ts:864-889 | service, owner, authenticated | none | safe event details, limit<=100 |
| ...event-create | catalog.ts:890-919; BE/platform/calendarEvents.ts:88-141 | service, owner, authenticated | policy `app.calendar-write` | fields summary,start,end,description,location,timeZone,calendarId. NO attendees/conference field. `sendUpdates:'none'` (calendarEvents.ts:120). Idempotent via private extended property keyed on idempotencyKey (calendarEvents.ts:101-131) |
| ...event-update | catalog.ts:920-949; calendarEvents.ts:143-166 | same | policy | patch by eventId |
| event-delete (platform op) | not found | - | - | no `event-delete` in catalog |

Workflow-node route (separate from the op catalog): registry/workflowNodes.ts has GOOGLECALENDAR_READ_EVENTS, _CREATE_EVENT (props summary,startDateTime,endDateTime,description; `requiresIntegrationId:'GOOGLECALENDAR'`, workflowNodes.ts:1218-1223), _UPDATE_EVENT and **_DELETE_EVENT** (workflowNodes.ts:1254-1256). So delete is only reachable via a workflow node.

Working manifest precedent (owner runtime, optional): Apps/Goals-by-Goalmatic/.goalmatic/app.json:
- capability (lines 93-106): `{"id":"calendar-sync","kind":"integrations","required":false,"operations":["integrations.connections-list","integrations.connection-start","integrations.connection-complete","integrations.google-calendar.events-list","integrations.google-calendar.event-create","integrations.google-calendar.event-update"],"displayName":...,"description":...}` (no `connectionProvider` set here).
- `resources.tools[]` entries (lines ~504-594) like `{"id":"calendar-event-create","operationId":"integrations.google-calendar.event-create","name":...,"description":...,"inputSchema":{...},"outputSchema":{...}}`. These are agent tools; each tool operationId must be declared by a capability (BE/platform/appRuntime.ts:766-771). Not needed for a UI-only call.
- Call from App source: Apps/Goals-by-Goalmatic/platform/goalmatic.js:487-533 `window.GoalmaticApp.execute('integrations.connection-start',{integrationId:'GOOGLECALENDAR'})`, `.execute('integrations.google-calendar.events-list'|'event-create'|'event-update', ...)`.
- NO sibling uses `integrations.google-calendar.availability` or declares it for guests. Not found.
- Connection-bound variant (bind a specific account at install): expense-tracker app.json:228-242 `{"id":"whatsapp-account","kind":"integrations","operations":["integrations.connections-list"],"required":false,"connectionProvider":"WHATSAPP","connectionScopes":[...]}` parsed by BE/platform/appSessionPolicy.ts:200-224; workflows reference it via `requiredConnectionIds` and `{"$appConnection":"whatsapp-account"}` (appRuntime.ts:626-640, 1092 in expense app.json). A `GOOGLECALENDAR` `connectionProvider` precedent: not found.

Guest feasibility: availability is admissible as a guest action (audience `service`, approval none). It is NOT a substitute for engine support: the guest UI would filter openings client-side, while `booking.create` revalidates only against schedule+bookings (runtimeService.ts:318-322), so a conflicting slot could still be booked by a direct call. Authoritative busy-check = engine change.

### 1c. Email
- No generic "send email" platform operation in catalog.ts. Not found. Email-ish ops found: `apps.visitor-account` (OTP, catalog.ts:1399), `feedback.update-notify` (feedback-only, catalog.ts:~1350-1365), article `sendEmail` flag (executors.ts:447, newsletter publishing). None usable for booking confirmations.
- Workflow nodes: `SEND_EMAIL` (registry/workflowNodes.ts:909-915; impl BE/flows/executeFlow/flowSteps/node/messaging/sendEmail.ts:80-180): props to/recipientEmail, subject, body|message, cc, emailType html|plain; sends via `notifyUser` from noreply@goalmatic.io; recipient passed through unless the literal `USER_EMAIL` (emailRecipient.ts:17-34). So arbitrary dynamic recipient is supported at engine level (via mention substitution from earlier step output - exact mention syntax not verified). `COMPOSIO_GMAIL_SEND_EMAIL` (workflowNodes.ts:1276-1283) sends from the owner's Gmail, `requiresIntegrationId:'GMAIL'`, connection via `getWorkflowGmailConnectionId` (not read); an App-manifest precedent for binding Gmail: not found.
- Precedent for SEND_EMAIL in an App workflow: career-studio .goalmatic/app.json cap at :100-107 and resource at :374+ (`trigger SCHEDULE_INTERVAL {cron:"0 8 * * 1-5",timezone,PlainText}`, step `{"nodeId":"SEND_EMAIL","props":{"emailType":"plain","subject":...,"recipientEmail":"USER_EMAIL","message":"@step-2-VERTEX_SEARCH-formattedText"}}`). Owner-only recipient; no precedent with guest recipients.
- Inbound email: `INBOUND_MESSAGE_TRIGGER {provider:"email"}` precedent teambox/expense-tracker (not needed for Bookins).

### 1d. Workflows, triggers, schedules, webhooks
Manifest syntax (precedent: career-studio, expense-tracker, store-studio):
- Capability: `{"id":"career-email-workflow","kind":"workflows","logicalResourceId":"career-email-alerts","operations":["workflows.run","workflows.schedule-configure"],"required":true|false,"displayName":...,"description":...}` (career-studio app.json:100-107).
- Resource: `resources.workflows[] = {"id","name","description","enabledOnInstall":bool,"requiredConnectionIds":[...],"trigger":{"id","nodeId","name","props"},"steps":[{"id","nodeId","name","props"}]}`. Props may use `{"$appResource":{"kind":"table","logicalResourceId":"..."}}` (career-studio app.json: step TABLE_READ) and `{"$appConnection":"<capability id>"}`, resolved at install (BE/platform/appRuntime.ts:626-640). Every nodeId must be in the registry (appRuntime.ts:621-625, 754-756). Max 63-char IDs.
- Ops: `workflows.run` (catalog.ts:1202-1218): audiences service/owner/authenticated/public, approval policy `workflow.runtime`, metered (`cost.metered:true`), exactly-once via idempotency key (executors.ts:688-698), accepts `triggerData`. `workflows.schedule-configure` (catalog.ts:1220-1236): owner/authenticated ONLY; input flowId,cron,timezone,enabled; only for installed SCHEDULE workflows (appRuntime.ts:815-818). Precedent of schedule-configure capability: career-studio :100, expense-tracker app.json:193 (`summary-workflow`).
- Guest-triggerable workflow: allowed by contract (appPublicContract.ts:263-270, `boundInput.flowId` kind workflow). Sibling precedent in a publicRuntime: not found (store-studio has `inventory-review-run` owner-side only).
- Triggers in registry (workflowNodes.ts): TRIGGER_MANUAL, SCHEDULE_INTERVAL (cron, tz; :806), SCHEDULE_TIME (one-off date/time/tz; :822), TRIGGER_WEBHOOK (inbound POST; :726), TABLE_RECORD_CREATED / _UPDATED (prop `table_id`; :754, :779), APP_EVENT_TRIGGER, INBOUND_MESSAGE_TRIGGER, EMAIL_TRIGGER.
- **Table triggers fire on any record write**, including the engine's own `booking.create` write: Firestore document triggers `onTableRecordCreated/Updated` match flows by `trigger.propsData.table_id` and `status==1` (BE/tables/onRecordCreatedOrUpdated.ts:15-28, 41-70; fanout cap 100). Install resolves `$appResource` into propsData, so a manifest trigger `{"nodeId":"TABLE_RECORD_CREATED","props":{"table_id":{"$appResource":{"kind":"table","logicalResourceId":"bookings"}}}}` is plausible. Sibling manifest precedent for TABLE_RECORD_*: not found (grep of apps/*/.goalmatic/app.json empty). Activation of non-manual triggers happens at install when `enabledOnInstall` (appRuntime.ts:989-996 area).
- Outbound webhook: node `WEB_API_CALL` (HTTP url/method/headers/body; workflowNodes.ts:~460-490). Not a platform op. App-manifest precedent: not found.
- Fan-out/loop/delay nodes: no LOOP/ITERATE/DELAY/conditional node found in registry. Consequence: a TABLE_RECORD_CREATED workflow sees one record (good for confirmation emails); a cron "reminder N hours before" workflow would need per-row sends, which has no loop node (not found). SCHEDULE_TIME is a fixed date/time per flow, not per record; no per-record dynamic scheduling API found.
- Other usable workflow nodes: SEND_WHATSAPP_MESSAGE / SEND_WHATSAPP_BUSINESS_TEMPLATE (needs WHATSAPP connection, expense-tracker precedent), TWILIO_SEND_SMS, ZOOM_CREATE_MEETING, CALENDLY_* (read-only competitor sync), GOOGLE_SHEETS_*, ASK_AGENT (all in registry; Bookins use unproven).

### 1e. Agents
`agents.chat`/`agents.app-chat` etc.: catalog.ts:~955-1190; forbidden as guest actions (appPublicContract.ts:264). Resource syntax `resources.agents[]` + capability `kind:"agents"` precedent: Goals app.json (`goals-assistant-capability`), career-studio `career-resume-assistant`. Irrelevant to core booking features.

### 1f. Payments
- `commerce.payment-bind/-start/-refresh`, `commerce.refund-*` exist (BE/platform/commerce/catalog.ts:25-30), guest flag true for payment-start/-refresh (catalog.ts:38 audiences), but they operate on commerce orders/stores/inventory (input `callbackUrl`, `orderId`...). Provider adapters: Paystack in BE/integrations/merchantPayments/paystack.ts (per GOALMATIC_FUNCTIONAL_ARCHITECTURE_PLAN.md:31 row/F31). Precedent: store-studio caps `merchant-payments` and `commerce-public` (store-studio app.json; `commerce.payment-start` in publicRuntime). No booking/appointment payment op, no deposits. Docs (GOALMATIC_FUNCTIONAL_ARCHITECTURE_PLAN.md:143, Invoices row) plan "Store plus Invoices can share payment settlement"; Bookins payment = platform work. Keep merchant money separate from credits (same doc, line 34).

### 1g. Table/data operations (what Bookins can do alone)
Owner Table CRUD via `tables.*` caps with `existingResourceAllowed` (app.json:158-228); `GoalmaticData`, `GoalmaticShares` (booking.js:151-311). Table field additions: "Added required Table field" is a release-review reason (appRuntime.ts:1626); optional fields are additive (provisionedTableFields.ts reconciles). Existing installations' tables get new optional fields reconciled (assumed, not tested).

## 2. What the hosted engine (BE/apps/booking/runtimeService.ts) honors

Honored from table fields:
- schedules: `timezone`, `weekly_windows_json` (array of {weekday 0-6,startMinute,endMinute}, non-overlapping), `slot_interval_minutes` (multiple of 5, 5..1440), `minimum_notice_minutes`, `booking_horizon_days` (default 60, clamp 1..365), `active` (runtimeService.ts:174-183, 107-131, 142-163).
- services: `active`, `visibility` (profile link shows public only; service-link subject shows one id) (:185-188), `duration_minutes` (5-min multiple, must be <= slot interval, :148-152), `schedule_id` (per-service schedule binding works, :245-251), `slug,name,description,price,currency` returned only as read-only display (:208-218). `price` is never charged; page notice `payment:'arranged-with-owner'`.
- bookings: `schedule_id,status,starts_at,ends_at` define "busy"; cancelled are skipped (:262-266). Unique `reservation_key = scheduleId|startsAtISO` guards double booking only for the exact same start on the same schedule (:134, 325-345 conflict path); overlapping different-start bookings are caught by the busy-overlap check in openings (:158).
- Limits: openings range <=31 days (:139), <=200 openings (:155), Tables read capped at 10 pages x 200 = 2000 records per table (:230-243, so >2000 bookings would silently drop busy records - risk), page-get/booking-create outputs are fixed shapes.

NOT honored / not found in the engine (would work hosted only if platform team changes it):
| Feature | Engine status |
|---|---|
| Buffers before/after | not found; busy check is exact overlap with no padding (:158) |
| Date overrides / holidays / blocked dates / extra days | not found; only weekly windows (:174-183) |
| Per-service schedule | supported (service->schedule_id) but each schedule is one resource with a single capacity; services on different schedules can double-book the same person (cross-schedule conflicts are not checked: busy is filtered by schedule_id at :262) |
| Service duration > slot interval (e.g. 90-min service on 30-min grid) | rejected with BOOKING_SERVICE_INVALID (:148-152) |
| Horizon | honored, but minimum notice measured from now and horizon is rolling days only (no fixed date range) |
| Calendar busy-check | not found; no call to freebusy/getGoogleCalendarClient in the booking service; `calendar:'not-created'` notice (:206) |
| Calendar event write after create | not found (:333-352) |
| Email/notification on create | not found (:350 on-screen-only) |
| Guest cancel/reschedule | not found; `booking.cancel` is owner-only, audiences [owner,authenticated] (catalog.ts:1344). No reschedule op. No guest-held booking secret/token exists |
| Custom booking questions, extra fields, attendees count, event-type colours/branding, locations | not found; `createPublicBooking` writes a fixed set of fields (:325-345); `notes` only (<=2000 chars, :340); page-get returns fixed `profile`+`services` shape (:195-218). New table fields would be stored but never returned/populated by guest ops |
| Team/round-robin | not found; one profile per installation (`profiles[0]`, :190), single owner account |
| Idempotency | booking reference derived from `caller.accountId + context.idempotencyKey` (:316); guest key from SDK `idempotencyKey` (booking.js:415) |

## 3. Feasibility matrix
Legend: (a) this repo only; (b) this repo + existing platform capability; (c) needs platform engine change; (d) blocked by AGENTS.md until a provider flow is proved. A feature can sit in two columns (e.g. b but also d).

| Feature | Verdict | Basis |
|---|---|---|
| Multiple event types (many services, per-service duration/price/colour/slug, private links) | (a) | services table + service-link subject already supported; colours/questions shown only in owner UI. Hosted guest page can't show new fields (c) |
| Branding customization (owner UI, accent, logo) | (a) for owner UI; (c) for hosted guest page | page-get returns fixed fields (runtimeService.ts:195-218); only `profile.photo_url/bio/display_name` surface. Colour/logo fields need engine or a guest op to read profile fields |
| Buffers before/after | (c) | engine exact-overlap, no padding. Workaround (a): fold buffer into duration/interval (visible to guests; can't be separate) |
| Date overrides / holidays / time-off | (c) | engine only reads weekly windows. Workaround (a): owner creates "blocked" `confirmed` bookings (hold records) - pollutes contacts/history; or edit weekly windows |
| Min notice, horizon, slot interval | already (a) | honored by engine |
| Per-service schedules | already works, with cross-schedule double-booking caveat (c) | see section 2 |
| Longer service than interval | (c) | engine rejects |
| Calendar read / busy-check for guests | (b)+(c) and (d) | op `integrations.google-calendar.availability` (catalog.ts:847) callable as guest action, but authoritative enforcement in `booking.openings-list` / `booking.create` requires engine change; client-only filter is bypassable. Also AGENTS.md: Calendar needs real connected-provider flow proved |
| Owner-side connect + show conflicts in dashboard | (b) and (d) | Goals precedent (goalmatic.js:487-513); connection-start/-list/events-list/availability via `GoalmaticApp.execute`; needs new `integrations` capability (non-automatic update) |
| Calendar write on booking | (b)/(c) and (d) | owner-side `event-create` from dashboard (b, manual) or workflow `GOOGLECALENDAR_CREATE_EVENT` triggered by TABLE_RECORD_CREATED (b if table-trigger precedent proves out). Guest-declared event-create is admissible but not atomic with booking (c for atomic). No attendee invites (calendarEvents.ts:120 `sendUpdates:'none'`) |
| Calendar event delete/update on cancel/reschedule | (b) via workflow node DELETE_EVENT / op event-update; (d) | no delete op in catalog |
| Confirmation email to guest | (b) and (d) | `SEND_EMAIL` node in a TABLE_RECORD_CREATED workflow (engine fires on booking.create writes, onRecordCreatedOrUpdated.ts:15-28). Sender is noreply@goalmatic.io, not owner's domain. AGENTS.md forbids claiming email until proved |
| Owner notification email / WhatsApp | (b) and (d) | SEND_EMAIL with USER_EMAIL (career-studio precedent) or WhatsApp connection (expense-tracker precedent) |
| Reminder emails (T-24h/T-1h) | (c) + (d) | no per-record schedule/loop/delay node found; cron scanning needs fan-out. Daily digest to owner is (b) |
| Follow-ups after meeting | (c) + (d) | same fan-out/delay gap |
| Webhooks (outbound on create/cancel) | (b)/(d) | `WEB_API_CALL` node in table-triggered workflow; no manifest precedent; not a platform op |
| Inbound webhooks/automation recipes | (b) | `TRIGGER_WEBHOOK`/APP_EVENT_TRIGGER nodes exist; no Bookins use case needing it |
| Guest cancel/reschedule | (c) | no guest cancel/reschedule op; `booking.cancel` owner-only (catalog.ts:1339-1353). Needs engine + a per-booking secret/token + new guest actions in manifest. Pure workaround: owner-handled via email/WhatsApp is manual |
| Team / round-robin | (c) | single-owner installation, single profile; need engine to assign across members/schedules (schedules table could model resources, but assignment logic missing) |
| Payments / deposits | (c) + (d) | only commerce-order-bound payment ops (commerce/catalog.ts:25-30); no booking payment op; AGENTS.md forbids until proved |
| Native video link (Meet/Zoom) | (c)+(d) | event-create has no conference fields; `ZOOM_CREATE_MEETING` node exists (workflowNodes) but unproved |
| Exports, search, contacts, notes, owner UI polish, analytics | (a) | tables only |
| Embed/widget, custom domain | not found in platform research | out of scope |

## 4. Recommended order (low risk first)
1. (a) now: more event-type metadata, owner-side branding, tidy cancel to use `booking.cancel`, bookings analytics.
2. Ask platform team (c, blocking most rows): engine fields for buffers (before/after), date overrides table/field, longer-than-interval durations, calendar busy-check inside openings+create (single authoritative path), guest-held manage token + guest cancel/reschedule ops, page-get returning brand fields, per-record reminders (delay/scheduled-per-row), optional per-service capacity.
3. (b) after proof of provider flows: add `integrations` capability for GOOGLECALENDAR (copy Goals syntax) and optional workflow resources (SEND_EMAIL, GOOGLECALENDAR_* nodes) with `enabledOnInstall:false`; update README, docs/ARCHITECTURE.md and manifest together (AGENTS.md rule).

## 5. Open/unverified
- TABLE_RECORD_CREATED in an App-installed workflow with `$appResource` table_id: code paths exist (appRuntime.ts:621-640, onRecordCreatedOrUpdated.ts:41-70) but no shipped App uses it; needs a real install test.
- Mention syntax for passing `guest_email` from the trigger record into `SEND_EMAIL.to`: not verified (processMentionsProps in utils/processMentions).
- Whether `GOOGLECALENDAR_*` workflow nodes need `requiredConnectionIds`/`$appConnection` in an App (client.ts uses account default connection): not read.
- Snapshot dated 2026-10-01; deployed catalog may differ.
