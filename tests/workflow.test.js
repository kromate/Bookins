import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAgendaTransform } from '../scripts/sync-agenda-workflow.mjs'
import { composeMessage } from '../messaging.js'

const manifest = JSON.parse(readFileSync(new URL('../.goalmatic/app.json', import.meta.url), 'utf8'))
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const workflow = manifest.resources.workflows.find((item) => item.id === 'owner-daily-agenda')
const step = (id) => workflow.steps.find((item) => item.id === id)
const tableIds = manifest.resources.tables.map((table) => table.id)

test('manifest: v0.6.0 minor release with honest notes and consistent versions', () => {
  assert.equal(manifest.version, '0.6.0')
  assert.equal(pkg.version, '0.6.0')
  assert.equal(manifest.releaseType, 'minor')
  assert.match(manifest.releaseNotes, /staff-data/)
  assert.match(manifest.releaseNotes, /campaigns-data/)
  assert.match(manifest.releaseNotes, /sends nothing automatically/)
  assert.match(manifest.releaseNotes, /to be proved on a real account/)
  assert.doesNotMatch(manifest.releaseNotes, /open rate|delivered/i)
})

test('manifest: new tables, fields, and optional capabilities', () => {
  assert.equal(new Set(tableIds).size, tableIds.length)
  const table = (id) => manifest.resources.tables.find((item) => item.id === id)
  const fields = (id) => table(id).fields.map((field) => field.id)
  assert.deepEqual(fields('staff'), ['name', 'role', 'photo_url', 'color', 'phone', 'email', 'active', 'schedule_id', 'service_ids_json', 'is_owner', 'revision', 'updated_at'])
  assert.deepEqual(fields('campaigns'), ['name', 'segment_json', 'template_json', 'offer_text', 'offer_code', 'status', 'audience_count', 'created_at', 'last_opened_at'])
  assert.deepEqual(table('campaigns').fields.find((field) => field.id === 'status').options, ['draft', 'active', 'done'])
  for (const id of ['staff', 'campaigns']) assert.equal(table(id).fields.find((field) => field.id === 'name').required, true)
  for (const id of ['category', 'sort_order', 'rebook_after_days', 'prep_notes']) {
    const field = table('services').fields.find((item) => item.id === id)
    assert.ok(field && !field.required, id)
  }
  for (const id of ['staff_id', 'staff_name', 'reminder_opened_at', 'followup_opened_at', 'reminder24_opened_at', 'reminder2_opened_at', 'rebook_opened_at'])
    assert.ok(fields('bookings').includes(id), id)
  for (const id of ['marketing_opt_out', 'marketing_opt_out_at', 'last_campaign_at', 'offers_json']) assert.ok(fields('contacts').includes(id), id)
  // Required services/bookings fields did not change, so existing installs keep working.
  assert.deepEqual(table('services').fields.filter((field) => field.required).map((field) => field.id), ['slug', 'name', 'description', 'duration_minutes', 'schedule_id', 'visibility', 'active', 'revision'])
  const caps = Object.fromEntries(manifest.capabilities.map((cap) => [cap.id, cap]))
  for (const [id, resource] of [['staff-data', 'staff'], ['campaigns-data', 'campaigns']]) {
    assert.equal(caps[id].required, false)
    assert.equal(caps[id].kind, 'tables')
    assert.equal(caps[id].logicalResourceId, resource)
    assert.deepEqual(caps[id].operations, ['tables.records-list', 'tables.record-create', 'tables.record-update', 'tables.record-delete'])
  }
  for (const cap of manifest.capabilities.filter((item) => item.logicalResourceId && item.kind === 'tables')) assert.ok(tableIds.includes(cap.logicalResourceId), cap.id)
  // The guest runtime still only binds the original four Tables.
  const bound = new Set(manifest.publicRuntime.grants.flatMap((grant) => grant.actions.flatMap((action) => Object.values(action.boundInput).map((item) => item.logicalResourceId))))
  assert.deepEqual([...bound].sort(), ['bookings', 'profiles', 'schedules', 'services'])
})

test('workflow: trigger untouched, step indices consistent, no $appResource in trigger', () => {
  assert.equal(workflow.trigger.nodeId, 'SCHEDULE_INTERVAL')
  assert.deepEqual(workflow.trigger.props, { PlainText: 'Every day at 7:00 AM', cron: '0 7 * * *', timezone: 'Africa/Lagos' })
  assert.ok(!JSON.stringify(workflow.trigger).includes('$appResource'))
  assert.equal(workflow.enabledOnInstall, false)
  assert.deepEqual(workflow.steps.map((item) => item.nodeId), ['TABLE_READ', 'TABLE_READ', 'TABLE_READ', 'TRANSFORM_DATA', 'SEND_EMAIL'])
  const reads = workflow.steps.map((item, index) => ({ index, table: item.props.tableId?.$appResource?.logicalResourceId })).filter((item) => item.table)
  assert.deepEqual(reads.map((item) => item.table), ['bookings', 'profiles', 'services'])
  const transformIndex = workflow.steps.findIndex((item) => item.nodeId === 'TRANSFORM_DATA')
  const email = step('email-owner')
  assert.equal(email.props.recipientEmail, 'USER_EMAIL')
  assert.equal(email.props.subject, `@step-${transformIndex}-TRANSFORM_DATA-subject`)
  assert.equal(email.props.message, `@step-${transformIndex}-TRANSFORM_DATA-body`)
  const input = step('build-agenda').props.input
  for (const { index, table } of reads) assert.match(input, new RegExp(`"${table}":\\[@step-${index}-TABLE_READ-records\\]`))
})

const transform = () => step('build-agenda').props.transformFunction

test('workflow transform: manifest string equals its source and survives the platform clean-up', () => {
  assert.equal(transform(), buildAgendaTransform())
  const source = transform()
  // The platform strips <...> spans, rewrites {{...}} and entity text, and resolves at-step tokens inside step props.
  assert.ok(!source.includes('<'), 'no less-than character')
  assert.ok(!source.includes('{{'), 'no double braces')
  assert.ok(!/&[a-z#0-9]+;/i.test(source), 'no entity text')
  assert.ok(!/@(step|trigger)-/.test(source), 'no at-step tokens')
  assert.equal(source.replace(/<[^>]*>/g, ''), source)
  assert.doesNotThrow(() => new Function('data', `"use strict"; const transform = ${source}; return transform(data)`))
})

// Runs the transform exactly as the platform does: `input` is JSON built from the three reads.
function run(data, nowIso) {
  const realNow = Date.now
  Date.now = () => Date.parse(nowIso)
  try {
    const input = `{"bookings":[${data.bookings.map((item) => JSON.stringify(item)).join(', ')}],"profiles":[${data.profiles.map((item) => JSON.stringify(item)).join(', ')}],"services":[${(data.services || []).map((item) => JSON.stringify(item)).join(', ')}]}`
    const wrapper = new Function('data', `"use strict"; const transform = ${transform()}; return transform(data);`)
    return wrapper(JSON.parse(input))
  } finally {
    Date.now = realNow
  }
}

const NOW = '2026-10-07T06:00:00.000Z' // 07:00 in Lagos
const profile = {
  display_name: 'Glow Studio',
  timezone: 'Africa/Lagos',
  public_link_url: 'https://glow.example/book#tok',
  bio: 'Braids. [[wa:+234 801 000 0000]]',
  message_templates_json: JSON.stringify({
    v: 2,
    slots: { reminder24: { channel: 'whatsapp', subject: 'Tomorrow: {{service}}', body: 'Hi {{first_name}}, {{service}} with {{staff}} tomorrow at {{time}} ({{timezone}}).\nPrep: {{prep_notes}}\nCall {{business_phone}}\nLocation: {{location}}' } },
    serviceOverrides: { 'svc-nails': { reminder24: { body: 'Nails at {{time}}, {{business}}. Prep: {{prep_notes}}' } } },
  }),
}
const services = [
  { id: 'svc-braids', name: 'Knotless braids', location: 'Lekki', prep_notes: 'Wash hair', description: 'x' },
  { id: 'svc-nails', name: 'Gel manicure', description: 'Gel\n[[bk:{"c":"Nails","p":"No polish on"}]]' },
]
const booking = (id, extra) => ({
  id, reference: `BK-${id}`, service_id: 'svc-braids', service_name: 'Knotless braids', schedule_id: 's', timezone: 'Africa/Lagos', status: 'confirmed',
  starts_at: '2026-10-08T09:00:00.000Z', ends_at: '2026-10-08T10:00:00.000Z', guest_name: 'Ada Okafor', guest_email: 'ada@x.test', guest_phone: '0803 555 0182',
  created_at: '2026-10-01T10:00:00.000Z', ...extra,
})

test('workflow transform: tomorrow reminder links match composeMessage rendering exactly', () => {
  const rows = [
    booking('1', { staff_name: 'Amaka', starts_at: '2026-10-08T09:00:00.000Z', ends_at: '2026-10-08T10:00:00.000Z' }),
    booking('2', { service_id: 'svc-nails', service_name: 'Gel manicure', guest_name: 'Bola Ade', guest_phone: '+233 24 555 0190', guest_email: 'bola@x.test', starts_at: '2026-10-08T07:00:00.000Z', ends_at: '2026-10-08T08:00:00.000Z' }),
    booking('3', { guest_name: 'Chi Eze', guest_phone: '', guest_email: 'chi@x.test', starts_at: '2026-10-08T13:00:00.000Z', ends_at: '2026-10-08T14:00:00.000Z' }),
    booking('4', { guest_name: 'Dayo', guest_phone: '', guest_email: 'phone-1@bookins.invalid', starts_at: '2026-10-08T14:00:00.000Z', ends_at: '2026-10-08T15:00:00.000Z' }),
  ]
  const { subject, body } = run({ bookings: rows, profiles: [profile], services }, NOW)
  assert.match(subject, /4 to remind/) // includes the client with nothing to open
  assert.match(body, /REMINDERS TO OPEN FOR TOMORROW \(4\)/)
  const lineFor = (needle) => body.split('\n').find((line) => line.includes(needle))
  const urlIn = (line) => /(https?:\/\/\S+|mailto:\S+)/.exec(line)[1]
  const expected = (row, service) => composeMessage('reminder24', row, { profile, service })
  // Ada: WhatsApp with the staff name, prep notes, business phone from the bio, and the service's Location line.
  const ada = expected(rows[0], services[0])
  assert.equal(urlIn(lineFor('Ada Okafor')), ada.whatsapp)
  assert.match(decodeURIComponent(ada.whatsapp), /Hi Ada, Knotless braids with Amaka tomorrow at 10:00 am \(Africa\/Lagos\)\.\nPrep: Wash hair\nCall \+234 801 000 0000\nLocation: Lekki/)
  assert.match(lineFor('Ada Okafor'), /Open WhatsApp/)
  // Bola: per-service override, prep notes read from the description trailer, international number.
  const bola = expected(rows[1], services[1])
  assert.equal(urlIn(lineFor('Bola Ade')), bola.whatsapp)
  assert.match(decodeURIComponent(bola.whatsapp), /Nails at 8:00 am, Glow Studio\. Prep: No polish on/)
  // Chi has no phone: falls back to the email link built the same way.
  const chi = expected(rows[2], services[0])
  assert.equal(urlIn(lineFor('Chi Eze')), chi.email)
  assert.match(lineFor('Chi Eze'), /Open email/)
  // Placeholder emails are never linked.
  assert.match(lineFor('Dayo'), /no phone or email to message/)
})

test('workflow transform: v1 templates, preferred channel, opened and cancelled bookings, time zones, disabled slot', () => {
  const v1 = { ...profile, message_templates_json: JSON.stringify({ reminder: { subject: 'Reminder', body: 'Old wording for {{first_name}}' } }) }
  const row = booking('1', { guest_email: 'ada@x.test' })
  const out = run({ bookings: [row], profiles: [v1], services }, NOW)
  assert.equal(/(https:\/\/wa\.me\/\S+)/.exec(out.body)[1], composeMessage('reminder24', row, { profile: v1 }).whatsapp)
  // Email as the preferred channel.
  const emailFirst = { ...profile, message_templates_json: JSON.stringify({ v: 2, slots: { reminder24: { channel: 'email', subject: 'S {{service}}', body: 'B {{first_name}}' } } }) }
  const viaEmail = run({ bookings: [row], profiles: [emailFirst], services }, NOW)
  assert.equal(/(mailto:\S+)/.exec(viaEmail.body)[1], composeMessage('reminder24', row, { profile: emailFirst }).email)
  // Opened (new and legacy field), cancelled, today's, next-day-after-tomorrow, and time off are not reminders.
  const rows = [
    booking('a', { reminder24_opened_at: '2026-10-07T05:00:00.000Z' }),
    booking('b', { reminder_opened_at: '2026-10-07T05:00:00.000Z' }),
    booking('c', { status: 'cancelled' }),
    booking('d', { starts_at: '2026-10-07T10:00:00.000Z', ends_at: '2026-10-07T11:00:00.000Z' }),
    booking('e', { starts_at: '2026-10-09T10:00:00.000Z', ends_at: '2026-10-09T11:00:00.000Z' }),
    booking('f', { status: 'blocked', service_id: 'time-off', guest_name: 'Off' }),
    booking('g', { status: 'completed' }),
  ]
  const none = run({ bookings: rows, profiles: [profile], services }, NOW)
  assert.match(none.body, /REMINDERS TO OPEN FOR TOMORROW \(0\)/)
  assert.match(none.body, /Nothing to remind about tomorrow/)
  assert.match(none.body, /TODAY \(1\)/)
  // "Tomorrow" is judged in each booking's own time zone: 23:30 UTC on 7 Oct is already 8 Oct in Lagos? No (00:30), but 8 Oct in Auckland.
  const zones = [
    booking('z1', { timezone: 'Pacific/Auckland', guest_name: 'Auckland', starts_at: '2026-10-07T12:00:00.000Z', ends_at: '2026-10-07T13:00:00.000Z' }),
    booking('z2', { timezone: 'America/New_York', guest_name: 'NewYork', starts_at: '2026-10-08T03:30:00.000Z', ends_at: '2026-10-08T04:30:00.000Z' }),
  ]
  const zoned = run({ bookings: zones, profiles: [profile], services }, NOW)
  assert.match(zoned.body, /REMINDERS TO OPEN FOR TOMORROW \(1\)/)
  assert.match(zoned.body, /Auckland/)
  assert.doesNotMatch(zoned.body.split('REMINDERS TO OPEN')[1], /NewYork/)
  const off = { ...profile, message_templates_json: JSON.stringify({ v: 2, slots: { reminder24: { enabled: false } } }) }
  const disabled = run({ bookings: [row], profiles: [off], services }, NOW)
  assert.match(disabled.body, /24-hour reminder is switched off/)
  assert.doesNotMatch(disabled.body, /wa\.me/)
})

test('workflow transform: keeps the v0.5 agenda sections, honest footer, and old single-read input', () => {
  const rows = [
    booking('1', { starts_at: '2026-10-07T10:00:00.000Z', ends_at: '2026-10-07T11:00:00.000Z', staff_name: 'Amaka' }),
    booking('n', { created_at: '2026-10-06T20:00:00.000Z', source: 'owner' }),
    booking('off', { status: 'blocked', service_id: 'time-off', notes: 'Clinic', starts_at: '2026-10-07T09:00:00.000Z', ends_at: '2026-10-07T12:00:00.000Z', guest_email: 'time-off@bookins.invalid' }),
  ]
  const out = run({ bookings: rows, profiles: [], services: [] }, NOW)
  assert.match(out.body, /^Good morning\. Here is your Bookins agenda\./)
  assert.match(out.body, /TODAY \(1\)\n- 11:00 Knotless braids - Ada Okafor with Amaka, 0803 555 0182, ada@x\.test \(Africa\/Lagos, BK-1\)/)
  assert.match(out.body, /TIME OFF TODAY\n- 10:00-13:00 Clinic \(Africa\/Lagos\)/)
  assert.match(out.body, /NEW IN THE LAST 24 HOURS \(1\)\n- .*\(added by you\)/)
  assert.match(out.body, /Opening one only fills in a message in your own WhatsApp, SMS or email app: Bookins sends nothing to guests/)
  assert.match(out.body, /check Bookins > Messages first/)
  assert.match(out.body, /Guests are not emailed\./)
  assert.equal(out.subject, 'Bookins: 1 appointment today, 1 new, 1 to remind')
  // The previous single-read shape still works (a platform that passes the bookings step directly).
  const legacy = new Function('data', `"use strict"; const transform = ${transform()}; return transform(data);`)({ payload: { records: rows } })
  assert.match(legacy.body, /TODAY \(1\)/)
  // A mention that did not resolve fails loudly instead of emailing an empty agenda.
  assert.throws(() => new Function('data', `"use strict"; const transform = ${transform()}; return transform(data);`)('{"bookings":[@step-0-TABLE_READ-records]}'), /could not read/)
})
