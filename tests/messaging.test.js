import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TEMPLATES,
  composeMessage,
  countryFromTimezone,
  mailtoUrl,
  messageVars,
  normalizePhone,
  renderTemplate,
  resolveTemplates,
  whatsappUrl,
} from '../messaging.js'

test('normalizePhone handles African local, international, and invalid numbers', () => {
  assert.equal(normalizePhone('0803 555 0182', 'NG'), '2348035550182')
  assert.equal(normalizePhone('+254 712 555 014'), '254712555014')
  assert.equal(normalizePhone('00233245550190'), '233245550190')
  assert.equal(normalizePhone('0712 555 014', 'KE'), '254712555014')
  assert.equal(normalizePhone('2348035550182'), '2348035550182')
  assert.equal(normalizePhone('555-0182'), '')
  assert.equal(normalizePhone(''), '')
  assert.equal(normalizePhone('+1 2'), '')
  assert.equal(countryFromTimezone('Africa/Nairobi'), 'KE')
  assert.equal(countryFromTimezone('Europe/London'), 'NG')
})

test('templates render variables, drop unknowns, and hide an empty location line', () => {
  assert.equal(renderTemplate('Hi {{first_name}} {{nope}}!', { first_name: 'Ada' }), 'Hi Ada !')
  const text = renderTemplate('A\nLocation: {{location}}\nB', { location: '' })
  assert.equal(text, 'A\nB')
  assert.equal(renderTemplate('Location: {{location}}', { location: 'Lekki' }), 'Location: Lekki')
})

test('saved templates override defaults per field; bad JSON falls back', () => {
  const custom = resolveTemplates({ message_templates_json: JSON.stringify({ reminder: { body: 'See you {{date}}' } }) })
  // v1 JSON loads: `reminder` maps onto the 24h slot.
  assert.equal(custom.reminder24.body, 'See you {{date}}')
  assert.equal(custom.reminder.body, 'See you {{date}}')
  assert.equal(custom.reminder24.subject, DEFAULT_TEMPLATES.reminder24.subject)
  assert.deepEqual(resolveTemplates({ message_templates_json: '{oops' }).confirmation, {
    ...DEFAULT_TEMPLATES.confirmation,
    channel: 'whatsapp',
    enabled: true,
  })
})

test('message variables use the booking timezone', () => {
  const vars = messageVars(
    { guest_name: 'Ada Okafor', starts_at: '2026-10-08T09:00:00.000Z', ends_at: '2026-10-08T09:30:00.000Z', timezone: 'Africa/Lagos', service_name: 'Call' },
    { profile: { display_name: 'Studio' } },
  )
  assert.equal(vars.first_name, 'Ada')
  assert.equal(vars.time, '10:00 am')
  assert.equal(vars.duration, '30 min')
  assert.match(vars.date, /Thursday/)
})

test('compose builds WhatsApp/email links and skips placeholder emails', () => {
  const booking = { guest_name: 'Ada', guest_phone: '0803 555 0182', guest_email: 'phone-2348035550182@bookins.invalid', starts_at: '2026-10-08T09:00:00.000Z', timezone: 'Africa/Lagos' }
  const message = composeMessage('reminder', booking, { profile: { display_name: 'Studio', timezone: 'Africa/Lagos' } })
  assert.match(message.whatsapp, /^https:\/\/wa\.me\/2348035550182\?text=/)
  assert.equal(message.email, '')
  assert.match(mailtoUrl('ada@example.com', 'S', 'B'), /^mailto:ada%40example\.com\?subject=S&body=B$/)
  assert.equal(whatsappUrl('', 'x'), '')
})

test('business falls back to a neutral phrase when the profile has no display name', () => {
  const booking = { guest_name: 'Ada', guest_phone: '0803 555 0182', service_name: 'Haircut', starts_at: '2026-10-08T09:00:00.000Z', timezone: 'Africa/Lagos' }
  for (const profile of [undefined, {}, { display_name: '   ' }]) {
    const vars = messageVars(booking, { profile })
    assert.equal(vars.business, 'your host')
    const message = composeMessage('confirmation', booking, { profile })
    assert.doesNotMatch(decodeURIComponent(message.whatsapp), /with ,|with \./)
    assert.match(decodeURIComponent(message.whatsapp), /Haircut with your host/)
  }
  assert.equal(messageVars(booking, { profile: { display_name: ' Studio ' } }).business, 'Studio')
})

// ---- message journey (v0.6.0) ----
import {
  JOURNEY_SLOTS,
  OPENED_FIELD,
  canonicalKind,
  messageQueue,
  openedAtFor,
  parseBioContact,
  resolveTemplateConfig,
  serializeTemplates,
  templateFor,
} from '../messaging.js'
import { NOW, TZ, profile, state } from './fixtures.js'

test('journey slots resolve with channel and enabled; legacy names alias', () => {
  const resolved = resolveTemplates(null)
  assert.deepEqual(JOURNEY_SLOTS, ['confirmation', 'reminder24', 'reminder2', 'prep', 'thanks', 'rebook'])
  for (const slot of JOURNEY_SLOTS) {
    assert.equal(resolved[slot].channel, 'whatsapp')
    assert.equal(resolved[slot].enabled, true)
    assert.ok(resolved[slot].subject && resolved[slot].body)
  }
  assert.equal(resolved.reminder, resolved.reminder24)
  assert.equal(resolved.followup, resolved.thanks)
  assert.equal(canonicalKind('followup'), 'thanks')
  assert.ok(!Object.keys(resolved).includes('reminder'))
})

test('v1 JSON maps reminder and followup onto the new slots; explicit v2 slots win', () => {
  const v1 = resolveTemplates({ message_templates_json: JSON.stringify({ followup: { body: 'Thanks {{first_name}}' }, reminder: { body: 'old' }, reminder24: { body: 'new' } }) })
  assert.equal(v1.thanks.body, 'Thanks {{first_name}}')
  assert.equal(v1.reminder24.body, 'new')
  const v2 = resolveTemplates({
    message_templates_json: JSON.stringify({ v: 2, slots: { reminder2: { channel: 'sms', subject: 'S', body: 'In 2h {{time}}', enabled: false }, rebook: { channel: 'bogus' } } }),
  })
  assert.deepEqual(v2.reminder2, { channel: 'sms', subject: 'S', body: 'In 2h {{time}}', enabled: false })
  assert.equal(v2.rebook.channel, 'whatsapp')
})

test('serializeTemplates writes only changes and round-trips through resolve', () => {
  const config = resolveTemplateConfig(null)
  assert.deepEqual(serializeTemplates(config), { v: 2, slots: {}, serviceOverrides: {} })
  config.templates.prep = { ...config.templates.prep, body: 'Bring {{prep_notes}}', channel: 'email' }
  config.serviceOverrides = { 'svc-braids': { reminder: { body: 'Braids: {{prep_notes}}' }, thanks: { body: '   ' } } }
  const json = serializeTemplates(config)
  assert.deepEqual(Object.keys(json.slots), ['prep'])
  assert.deepEqual(json.serviceOverrides, { 'svc-braids': { reminder24: { body: 'Braids: {{prep_notes}}' } } })
  const back = resolveTemplateConfig({ message_templates_json: JSON.stringify(json) })
  assert.equal(back.templates.prep.channel, 'email')
  assert.equal(templateFor(back, 'reminder', 'svc-braids').body, 'Braids: {{prep_notes}}')
  assert.equal(templateFor(back, 'reminder', 'svc-nails').overridden, false)
})

test('new variables render: staff, prep notes, rebook link, business phone, last service, offer', () => {
  const booking = { guest_name: 'Ada Okafor', service_name: 'Knotless braids', starts_at: '2026-10-08T09:00:00.000Z', timezone: TZ, staff_name: 'Amaka' }
  const vars = messageVars(booking, {
    profile,
    service: { name: 'Knotless braids', prep_notes: 'Wash hair', location: 'Lekki' },
    offer: { text: '10% off', code: 'HAIR10', expires: '30 Nov' },
    lastService: 'Silk press',
  })
  assert.equal(vars.staff, 'Amaka')
  assert.equal(vars.prep_notes, 'Wash hair')
  assert.equal(vars.business_phone, '+234 801 000 0000')
  assert.equal(vars.rebook_link, 'https://glow.example/book#tok')
  assert.equal(vars.last_service, 'Silk press')
  assert.deepEqual([vars.offer, vars.offer_code, vars.offer_expires], ['10% off', 'HAIR10', '30 Nov'])
  assert.equal(parseBioContact('Hi [[wa:+234 801 000 0000]] there').text, 'Hi there')
  // The implicit owner is never printed as "You" into a guest message.
  assert.equal(messageVars({ guest_name: 'A' }, { staff: { implicit: true, name: 'You' } }).staff, '')
})

test('composeMessage applies service overrides, drops empty label lines, and picks the preferred channel', () => {
  const p = {
    ...profile,
    message_templates_json: JSON.stringify({
      v: 2,
      slots: { reminder24: { channel: 'email', subject: 'Tomorrow: {{service}}', body: 'Hi {{first_name}}\nPrep: {{prep_notes}}\nBye' } },
      serviceOverrides: { 'svc-braids': { reminder24: { body: 'Braids note: {{prep_notes}}' } } },
    }),
  }
  const booking = { service_id: 'svc-nails', guest_name: 'Ada', guest_phone: '0803 555 0182', guest_email: 'ada@x.test', starts_at: '2026-10-08T09:00:00.000Z', timezone: TZ, service_name: 'Gel' }
  const plain = composeMessage('reminder', booking, { profile: p, service: { id: 'svc-nails' } })
  assert.equal(plain.text, 'Hi Ada\nBye')
  assert.equal(plain.preferred, 'email')
  assert.equal(plain.subject, 'Tomorrow: Gel')
  assert.equal(plain.kind, 'reminder24')
  const braids = composeMessage('reminder24', { ...booking, service_id: 'svc-braids' }, { profile: p, service: { id: 'svc-braids', prep_notes: 'Wash hair' } })
  assert.equal(braids.text, 'Braids note: Wash hair')
  const noEmail = composeMessage('reminder24', { ...booking, guest_email: '' }, { profile: p })
  assert.equal(noEmail.preferred, 'whatsapp')
  assert.equal(composeMessage('nonsense', booking, { profile: p }).kind, 'confirmation')
})

const queue = () => messageQueue(state(), { now: NOW, timezone: TZ })
const idsOf = (list) => list.map((item) => item.id).sort()
const ref = (n) => `b${n}`

test('message queue buckets from the 30-booking fixture, computed live', () => {
  const { due, upcoming, done } = queue()
  // Bookings by plan index: lola=23, mira=24, nora=25, pia=26, rita=27, sade=28 (cancelled).
  assert.deepEqual(idsOf(due), [
    'prep:b24', 'prep:b27', 'rebook:b14', 'rebook:b20', 'rebook:b5', 'rebook:b7', 'reminder2:b24', 'reminder24:b23', 'thanks:b26',
  ].sort())
  assert.deepEqual(idsOf(upcoming), ['rebook:b18', 'reminder2:b23', 'reminder2:b27', 'reminder24:b25'].sort())
  assert.deepEqual(idsOf(done), ['reminder24:b27'])
})

test('message queue never lists cancelled, time off, or opted-out rebook, and respects moves', () => {
  const all = (q) => [...q.due, ...q.upcoming, ...q.done]
  const q = queue()
  assert.ok(!all(q).some((item) => item.booking.id === 'b28'), 'cancelled sade')
  assert.ok(!all(q).some((item) => item.booking.id === 'b6'), 'cancelled chi')
  assert.ok(!all(q).some((item) => /^off/.test(item.booking.id)), 'time off')
  assert.ok(!all(q).some((item) => item.kind === 'rebook' && item.contact.email === 'ese@x.test'), 'opted out')
  // Move lola from +20h to +10 days: she drops out of reminders entirely.
  const moved = state()
  const lola = moved.bookings.find((item) => item.id === 'b23')
  lola.starts_at = new Date(NOW + 10 * 86_400_000).toISOString()
  lola.ends_at = new Date(NOW + 10 * 86_400_000 + 3_600_000).toISOString()
  const after = messageQueue(moved, { now: NOW, timezone: TZ })
  assert.ok(!all(after).some((item) => item.booking.id === 'b23'))
  // Cancel mira: all her reminder items vanish.
  moved.bookings.find((item) => item.id === 'b24').status = 'cancelled'
  assert.ok(!all(messageQueue(moved, { now: NOW, timezone: TZ })).some((item) => item.booking.id === 'b24'))
})

test('message queue: rebook order, thanks window, items carry links and wording', () => {
  const { due } = queue()
  const rebook = due.filter((item) => item.kind === 'rebook')
  assert.deepEqual(rebook.map((item) => item.booking.id), ['b7', 'b5', 'b14', 'b20'])
  const thanks = due.find((item) => item.kind === 'thanks')
  assert.equal(thanks.contact.email, 'pia@x.test')
  assert.match(thanks.message.text, /thank you for your Gel manicure with Glow Studio/)
  const prep = due.find((item) => item.id === 'prep:b24')
  assert.match(prep.message.text, /Arrive with washed hair/)
  assert.match(prep.links.whatsapp, /^https:\/\/wa\.me\/234814000/)
  const nora = queue().upcoming.find((item) => item.id === 'reminder24:b25')
  assert.deepEqual(nora.links, { whatsapp: '', sms: '', email: 'mailto:nora%40x.test?subject=' + encodeURIComponent(nora.message.subject) + '&body=' + encodeURIComponent(nora.message.text) })
  assert.equal(Date.parse(nora.due_at), NOW + 30 * 3_600_000 - 24 * 3_600_000)
})

test('opened fields: marking moves an item to done; legacy reminder_opened_at is honoured', () => {
  assert.equal(OPENED_FIELD.thanks, 'followup_opened_at')
  const s = state()
  s.bookings.find((item) => item.id === 'b26').followup_opened_at = '2026-10-07T08:30:00.000Z'
  s.bookings.find((item) => item.id === 'b23').reminder_opened_at = '2026-10-07T08:31:00.000Z'
  const q = messageQueue(s, { now: NOW, timezone: TZ })
  assert.ok(q.done.some((item) => item.id === 'thanks:b26'))
  assert.ok(q.done.some((item) => item.id === 'reminder24:b23'))
  assert.ok(!q.due.some((item) => item.id === 'thanks:b26'))
  assert.equal(openedAtFor({ reminder_opened_at: 'x' }, 'reminder'), 'x')
})

test('a booking inside the 2h window is not also offered the 24h reminder (M8)', async () => {
  const { messageQueue } = await import('../messaging.js')
  const now = new Date('2026-10-07T09:00:00.000Z')
  const state = {
    profile: { display_name: 'Amina', timezone: 'UTC' },
    services: [{ id: 'sv', name: 'Braids', duration_minutes: 60 }],
    contacts: [],
    bookings: [{ id: 'b1', service_id: 'sv', service_name: 'Braids', status: 'confirmed', guest_name: 'Ada', guest_phone: '+2348030000000', guest_email: 'a@x.com', starts_at: '2026-10-07T10:30:00.000Z', ends_at: '2026-10-07T11:30:00.000Z', timezone: 'UTC' }],
  }
  const kinds = messageQueue(state, { now, timezone: 'UTC' }).due.map((item) => item.kind)
  assert.ok(kinds.includes('reminder2'))
  assert.ok(!kinds.includes('reminder24'))
})

test('{{staff}} never renders the legacy "Owner" snapshot (M7)', async () => {
  const { messageVars } = await import('../messaging.js')
  const vars = messageVars({ guest_name: 'Ada', staff_name: 'Owner' }, { profile: { display_name: 'Amina Studio' }, staff: { implicit: true, name: 'You' } })
  assert.equal(vars.staff, 'Amina Studio')
  assert.equal(messageVars({ guest_name: 'Ada', staff_name: 'Owner' }, { profile: {}, staff: { implicit: true } }).staff, '')
})
