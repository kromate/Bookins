# 05 - Owner new-booking alert workflow (engineer E)

Decision: a manifest-declared workflow emails the OWNER when a record is created in `bookings`. Guest emails and reminders are out of scope. Snapshot is dated 2026-10-01; deployed behaviour is unverified. BE=/Users/anthonyakpan/Desktop/mini/.audit/plugin-publishing-2026-10-01/runtime-source/backend/functions/src. No existing file was edited.

## 1. Manifest JSON

### 1a. `resources.workflows[]` (append; currently `[]`)

```json
{
  "id": "owner-booking-alert",
  "name": "Bookins - email owner on new booking",
  "description": "When a new record is created in the Bookings Table, emails the account owner the booking details from noreply@goalmatic.io. Guests are not emailed.",
  "enabledOnInstall": true,
  "trigger": {
    "id": "booking-created",
    "nodeId": "TABLE_RECORD_CREATED",
    "name": "New booking record",
    "props": {
      "table_id": {
        "$appResource": {
          "kind": "table",
          "logicalResourceId": "bookings"
        }
      }
    }
  },
  "steps": [
    {
      "id": "build-owner-alert",
      "nodeId": "TRANSFORM_DATA",
      "name": "Format owner alert",
      "props": {
        "transformFunction": "(data) => { const rec = (data && data.record) || (data && data.payload && data.payload.record) || {}; const clean = (v) => String(v === null || v === undefined ? '' : v).replace(/[\\r\\n]+/g, ' ').trim(); const iso = clean(rec.starts_at); const tz = clean(rec.timezone) || 'UTC'; let when = iso + ' UTC (raw ISO, timezone could not be applied)'; try { const d = new Date(iso); if (!isNaN(d.getTime())) { when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }).format(d) + ' (' + tz + ')'; } } catch (e) { when = iso + ' UTC (raw ISO, timezone could not be applied)'; } const service = clean(rec.service_name) || 'a service'; const guest = clean(rec.guest_name) || 'A guest'; const phone = clean(rec.guest_phone) || 'Not provided'; const notes = String(rec.notes || '').trim() || 'None'; const subject = 'New booking: ' + service + ' - ' + guest; const body = ['You have a new booking in Bookins.', '', 'Service: ' + service, 'When: ' + when, 'Starts at (UTC ISO): ' + iso, 'Booking timezone: ' + tz, '', 'Guest: ' + guest, 'Email: ' + clean(rec.guest_email), 'Phone: ' + phone, 'Notes: ' + notes, '', 'Reference: ' + clean(rec.reference), '', 'Open Bookins to review or cancel this booking.', 'This alert is sent from noreply@goalmatic.io to the account owner only. The guest has not been emailed.'].join('\\n'); return { subject, body }; }"
      }
    },
    {
      "id": "email-owner",
      "nodeId": "SEND_EMAIL",
      "name": "Email the owner",
      "props": {
        "emailType": "plain",
        "recipientEmail": "USER_EMAIL",
        "subject": "@step-0-TRANSFORM_DATA-subject",
        "message": "@step-0-TRANSFORM_DATA-body"
      }
    }
  ]
}
```

The `transformFunction` is one string in the file. It was executed in node against sample records; output in section 2.

Justification
- Shape `{id,name,description,enabledOnInstall,trigger{id,nodeId,name,props},steps[{id,nodeId,name,props}]}`: BE/platform/appRuntime.ts:575-593 (parser), career-studio/.goalmatic/app.json:325-387 (precedent incl. SEND_EMAIL step and `enabledOnInstall`).
- `id` must match lowercase/digits/hyphens, <=63 chars, unique across tables/agents/workflows: appRuntime.ts:735-742. `owner-booking-alert` is distinct from table ids (profiles, schedules, services, bookings).
- All nodeIds (TABLE_RECORD_CREATED, TRANSFORM_DATA, SEND_EMAIL) are registered, which install validates: appRuntime.ts:621-625, 754-756; registry/workflowNodes.ts:754 (trigger), :909 (SEND_EMAIL); flows/executeFlow/flowSteps/list.ts:69, :76.
- Trigger binding: `{"$appResource":{"kind":"table","logicalResourceId":"bookings"}}` is replaced at install with the physical table id (appRuntime.ts:626-640; `propsData: resolveAppWorkflowProps(node.props)` at :930-935). The runtime matches flows on `trigger.propsData.table_id == tableId` and `status==1` (BE/tables/onRecordCreatedOrUpdated.ts:41-48). Tables are provisioned before workflows so the binding exists (appRuntime.ts:1171-1224). Prop key is `table_id` (registry/workflowNodes.ts:762), not `tableId` (TABLE_READ uses `tableId`; do not copy that).
- Manifest precedent for TABLE_RECORD_CREATED / `$appResource` inside a trigger: NOT FOUND in any apps/*/.goalmatic/app.json (only $appResource inside steps, career-studio:329-335). Code path supports it; needs real install proof.
- `enabledOnInstall:true`: only then is the trigger activated at install (appRuntime.ts:968-975 -> activateFlowTrigger -> handleActivateTableRecordTrigger sets status 1, flows/activateFlow/triggerHandler/activateTableRecordTrigger.ts). Career-studio uses false because it is a paid schedule; here the owner has no UI to enable it, so true. Set false if the owner must opt in (see unproven).
- Recipient `"USER_EMAIL"`: resolved at run time to the flow owner's registered email (flows/executeFlow/flowSteps/node/messaging/emailRecipient.ts:17-34, sendEmail.ts:130-141); precedent career-studio:367. It looks up payload.userId then `flows/{id}.creator_id`; table-trigger runs send `userId: ownerId = account_id||creator_id` (BE/tables/tableRecordTriggerDelivery.ts:62). Sender is fixed noreply@goalmatic.io (sendEmail.ts:151-153).
- Prop names `emailType`, `recipientEmail`, `subject`, `message`: read by sendEmail.ts:125-129 (also accepts to/body). Same as career-studio:364-369.
- Step reference tokens `@step-0-TRANSFORM_DATA-subject`: legacy token `@(step|trigger)-<index>-<NODE_ID>-<key>`, zero-based index (processMentions.ts:103-121; career-studio uses `@step-2-VERTEX_SEARCH-formattedText` for the third step, :368). Subject and message values pass through processMentionsProps (sendEmail.ts:100-108; processMentions.ts:239-281).
- Two-step design because dot-paths cannot be written as legacy tokens (key regex `[\w]+`, processMentions.ts:104), and no manifest precedent writes mention spans. The TRANSFORM_DATA step starts with no earlier step, so `data` is the flattened trigger result, which exposes `record` at top level (flows/executeFlow/flowSteps/index.ts:39-45, :202; transformData.ts:27-42; tableRecordTrigger.ts:30-44).
- Constraint baked into the function: TRANSFORM_DATA runs processMentionsProps over its own `transformFunction` (transformData.ts:9), which strips anything matching `<...>` and replaces `{{..}}` and `@step-..` tokens (processMentions.ts:147, :176-210). The function therefore contains no `<`, `>` pairs (other than `=>`), no `{{`, no `@` tokens. Do not edit it without re-checking this.

### 1b. `capabilities[]` (append; optional, see note)

```json
{
  "id": "owner-booking-alert-workflow",
  "kind": "workflows",
  "displayName": "Email me new bookings",
  "description": "Installs one workflow that emails the account owner when a new booking record is created. Guests are not emailed.",
  "operations": [
    "workflows.run"
  ],
  "required": false,
  "logicalResourceId": "owner-booking-alert"
}
```

- Matches expense-tracker budget-alert-workflow (`kind:"workflows"`, `operations:["workflows.run"]`, `required:false`, `logicalResourceId` = resource id; expense-tracker/.goalmatic/app.json:217-226) and career-studio:99-106.
- `required:false` means install does not hard-require it: the required-capability check only fires for `required===true` (appRuntime.ts:782-789).
- Honest caveat: the platform does not need a capability for a record-triggered workflow. Install validation never requires one for `required:false`, and the trigger fires from Firestore, not from an App `workflows.run` call. Every shipped precedent with a workflow resource declares one (checked chorus/glaze/polish: none have workflows; teambox, social-studio, career, expense all declare). A workflow with no capability: precedent NOT FOUND. The cost of declaring it is a new requested scope `workflows.run` (appSessionPolicy.ts:185-198), shown as "Added permissions: workflows.run" in release review (appRuntime.ts:1600-1601) and a run permission the owner session never uses. Recommendation: follow precedent and declare it; if the product owner prefers least privilege, omit it and prove install works without it. Either way "Added workflow: owner-booking-alert" already makes the release non-automatic (appRuntime.ts:1637-1640), so the capability adds no extra friction.
- No `integrations` capability, `requiredConnectionIds` or `$appConnection`: SEND_EMAIL uses the platform mailer, not a connected provider (sendEmail.ts:151-163). Contrast COMPOSIO_GMAIL_SEND_EMAIL, which does need GMAIL (04-platform.md 1c).
- Do not add `externalDomains`; none is required by evidence.

## 2. Email template and time formatting

Field syntax, evidenced:
- Step output tokens (used here, precedent-backed): `@step-<zero-based index>-<NODE_ID>-<key>` (processMentions.ts:103-121).
- Direct trigger fields, if ever wanted without TRANSFORM_DATA: editor mention span `<span data-type="mention" data-id="trigger-TABLE_RECORD_CREATED[record.guest_name]"></span>`; dot-path resolves via getNestedValue (processMentions.ts:36-52, :55-96; parseMentionId stepReferences.ts:56-69). Legacy `@trigger-TABLE_RECORD_CREATED-record` yields the whole record as JSON only, not usable. No App manifest uses a mention span: precedent NOT FOUND. Trigger payload keys: record_id, table_id, record, triggered_at, event_type (tableRecordTrigger.ts:30-44).
- `{{trigger.guest_name}}` template form exists (processMentions.ts:176-210) but only reads top-level keys, so it cannot reach `record.*`. Not used.

Rendered output (node-executed against sample record; Africa/Lagos, starts_at 2026-10-12T08:30:00.000Z, guest_phone empty):

```
Subject: New booking: Haircut - Ada X

You have a new booking in Bookins.

Service: Haircut
When: Monday, 12 October 2026 at 09:30 (Africa/Lagos)
Starts at (UTC ISO): 2026-10-12T08:30:00.000Z
Booking timezone: Africa/Lagos

Guest: Ada X
Email: a@b.co
Phone: Not provided
Notes: hi

Reference: BK-1

Open Bookins to review or cancel this booking.
This alert is sent from noreply@goalmatic.io to the account owner only. The guest has not been emailed.
```

Template, field to line: service_name -> Service and subject; starts_at -> When (formatted) and raw UTC ISO line; timezone -> label; guest_name -> Guest and subject; guest_email, guest_phone, notes, reference -> own lines. CR/LF are stripped from values used in the subject (header injection guard).

Can the node format starts_at in the booking timezone? SEND_EMAIL itself has no date formatting (sendEmail.ts, whole file); mentions substitute raw strings (processMentions.ts:7-28). The only evidenced formatter is TRANSFORM_DATA running arbitrary JS via `new Function` (transformData.ts:49-66), so `Intl.DateTimeFormat(..., {timeZone})` is used. Whether the Cloud Functions runtime has full ICU for `Africa/Lagos` etc. is NOT verified (works on local node). The function falls back to raw UTC ISO labelled "raw ISO, timezone could not be applied", and the body always also prints the raw ISO plus the timezone label, so the email is honest either way. Note: Intl may throw RangeError for an invalid timezone string; handled by try/catch.

Plain-text email (`emailType:"plain"`) is used so guest-provided text cannot inject HTML. The plain path strips HTML tags from the template but substituted token values are inserted after stripping (processMentions.ts:147-151), so guest notes are inserted verbatim as text.

## 3. Create vs update

- TABLE_RECORD_CREATED is a separate trigger from TABLE_RECORD_UPDATED. The Firestore handlers match on `trigger.node_id == 'TABLE_RECORD_' + kind` (BE/tables/onRecordCreatedOrUpdated.ts:15-28 created, 31-39 updated, 41-48 matcher). A flow with TABLE_RECORD_CREATED does not fire on updates, so cancellation (a patch, booking.js:270-281) does NOT send mail. The delivery layer re-checks `expectedNode` (tableRecordTriggerDelivery.ts:36-45).
- Fires on any new document in `tables/{tableId}/records` regardless of writer: guest `booking.create` (runtimeService.ts:338-360 uses executeTableRestOperation -> tables/restApi.ts:179), owner-created records, and any imports or migrations writing bookings. Not distinguishable in the trigger; there is no conditional node (04-platform.md 1d). If Bookins' migration/import path writes historical rows, it would email the owner per row: needs a check before shipping (not found in evidence either way).
- Records with status already `cancelled` at creation are not distinguished either.
- Delivery is retried (`retry:true`) and exactly-once per event via deterministic delivery id (tableRecordTriggerDelivery.ts:16-29), so duplicates are unlikely but a failed SEND_EMAIL does not throw: it returns `{success:false}` (sendEmail.ts:163-171) and the run is logged; no owner-visible failure surface in Bookins.
- Fanout cap 100 flows per table event (onRecordCreatedOrUpdated.ts:46-47). Each run records a `flow_runs` usage unit (flows/executeFlow/index.ts:262-266) and can be rejected by plan limits (:138-139). Credit/plan cost of SEND_EMAIL: not found.

## 4. Proposed doc lines

AGENTS.md: replace the line "- Payments, Calendar writes, and email delivery are unavailable until a real connected-provider flow is implemented and proved." with:

```
- Payments and Calendar writes are unavailable until a real connected-provider flow is implemented and proved. Guest emails (confirmations, reminders, cancellations) are unavailable. The only email Bookins sends is the owner new-booking alert, delivered by the manifest-declared `owner-booking-alert` workflow (TABLE_RECORD_CREATED on `bookings` -> SEND_EMAIL from noreply@goalmatic.io to the account owner). Never send email from browser code, never add a provider key, and do not claim the alert works until the real-account test in .audit/bookings-2026-10-06/05-owner-alert-workflow.md passes.
```

README.md (capability/limits section):

```
- Owner alert: when a new booking is created, Goalmatic emails the account owner the service, start time (shown in the booking timezone, with the UTC ISO time), guest name, email, phone, notes and reference. It comes from noreply@goalmatic.io, is sent only to the owner's registered Goalmatic email, and does not fire for cancellations or edits. It is delivered by the `owner-booking-alert` workflow declared in the manifest and uses Goalmatic workflow runs.
- Not available: guest confirmation or reminder emails, Calendar writes, online payment, guest cancellation and rescheduling.
```

docs/ARCHITECTURE.md: add under Records: "- `owner-booking-alert` is an App workflow resource. Its TABLE_RECORD_CREATED trigger is bound to the logical `bookings` Table by `$appResource`, so no physical Table ID appears in source. It runs one TRANSFORM_DATA step to format the message and one SEND_EMAIL step to `USER_EMAIL`. It does not fire on updates, so cancellations send nothing." and replace the "Provider truth" sentence (line 26) with:

```
Bookins v0.3.0 guarantees on-screen confirmation, owner dashboard visibility, and a read-only Contacts view derived from booking history. The owner receives one plain-text email per newly created booking through the declared `owner-booking-alert` workflow (platform mailer, noreply@goalmatic.io); delivery depends on the owner's registered email and workflow-run limits and is not shown in the dashboard. A non-zero price is informational and described as arranged with the owner. Guest emails, reminders, Calendar writes, online payment, payout, guest cancellation, and rescheduling are not claimed until their provider paths are connected and proved.
```

Also: the app's release notes and the booking confirmation "email: not-sent" notice (runtimeService.ts:206) still refer to guests; keep guest wording as "not sent". Manifest, README and ARCHITECTURE must change together (AGENTS.md rule). Version bump: adding a workflow makes the release non-automatic (appRuntime.ts:1637-1640); `releaseType:"minor"` is already set.

## 5. Unproven and how to prove it

Unproven
1. A manifest TABLE_RECORD_CREATED trigger with `$appResource` in `trigger.props` installs and activates (no shipped precedent; $appResource has only been evidenced in steps).
2. `enabledOnInstall:true` activates a TABLE trigger on a fresh install and on an upgrade of an existing installation (preservingExistingState logic, appRuntime.ts:907-914, 968-975; migration path uses activateWorkflows:false, :1452).
3. The workflow fires for a guest `booking.create` write (guest context, installation-bound table).
4. `USER_EMAIL` resolves to the owner and the email is delivered (recipient validation via an external validator, helpers/emailNotifier.ts:132-238, may reject).
5. Legacy tokens `@step-0-TRANSFORM_DATA-subject/body` resolve in a table-triggered run and the output is not truncated or altered (newline handling, processMentions.ts:155-160).
6. `Intl` timezone formatting works in the deployed runtime.
7. Cancellation and edits send nothing; no duplicate email on retry.
8. Plan/credit cost and limits for `flow_runs`; behaviour when the owner has no registered email (throws, run fails silently from the owner's view).
9. Whether a capability-less workflow would install (only matters if the capability is dropped).
10. Whether Bookins data import/migration writes bookings (would mass-email).

Real-account test steps
1. On `preview`, `yarn build`, save to Site Builder, install the release to a test account whose profile email you can read. Confirm install succeeds and Workflows lists "Bookins - email owner on new booking" as active (status 1) with its trigger table equal to the installed Bookings Table.
2. Complete setup (profile, schedule, one public service), open the `/book` link in a private window, book a slot with guest name, email, phone, multi-line notes containing `<b>x</b>` and an @-sign.
3. Within a minute, check the owner inbox: one email from noreply@goalmatic.io; verify subject, formatted local time vs UTC ISO line, all fields, notes verbatim and no HTML interpretation. Check the workflow run log for the trigger payload and SEND_EMAIL `success:true`.
4. Confirm the guest inbox received nothing.
5. Cancel that booking in the owner dashboard: confirm no email and no new run.
6. Book a second slot with a non-UTC timezone (Africa/Lagos and e.g. Pacific/Auckland) and confirm the formatted time; if the fallback text appears, record that Intl is unavailable.
7. Retry the same booking idempotency key (refresh/resubmit): expect no second record and no second email.
8. Upgrade an existing installation from v0.3.0 to this release: confirm the workflow appears and is active, and existing bookings did not generate emails.
9. Edit the owner's account email, book again, confirm the new address receives it.
10. Temporarily remove the owner email on a test account (or use one without it) and record the visible failure behaviour.
11. Check usage/billing: record `flow_runs` consumption per booking.
12. Only after 1-9 pass, update AGENTS.md/README/ARCHITECTURE with the lines in section 4.
