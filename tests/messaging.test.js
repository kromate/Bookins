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
  assert.equal(custom.reminder.body, 'See you {{date}}')
  assert.equal(custom.reminder.subject, DEFAULT_TEMPLATES.reminder.subject)
  assert.deepEqual(resolveTemplates({ message_templates_json: '{oops' }).confirmation, DEFAULT_TEMPLATES.confirmation)
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
