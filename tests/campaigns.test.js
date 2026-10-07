import test from 'node:test'
import assert from 'node:assert/strict'
import { CAMPAIGN_CAP, SEGMENT_PRESETS, campaignQueue, emailBatches, exportCampaignCsv, normalizeFilters, segmentContacts } from '../campaigns.js'
import { parseCsv } from '../csv.js'
import { NOW, TZ, names, state } from './fixtures.js'

const opts = { now: NOW, timezone: TZ }
const segment = (filters) => segmentContacts(state(), filters, opts)

test('acceptance: "Braids clients not seen in 60 days" is exactly the contacts whose latest non-cancelled braids booking is older', () => {
  const result = segment({ serviceContains: 'braids', lastVisitBeforeDays: 60 })
  // ada -70, bola -90, chi -65 (cancelled -5 ignored), dayo -80 (phone only), hauwa -61, jide -150 (no-show counts as booked).
  // Not: femi (-30 latest), gina (+5 booked ahead), ife (exactly 60), ese (opted out).
  assert.deepEqual(names(result.contacts), ['ada', 'bola', 'chi', 'dayo', 'hauwa', 'jide'])
  assert.deepEqual(names(result.optedOut), ['ese'])
})

test('segmentation by channel: placeholder emails only excluded when the channel needs email', () => {
  const base = { serviceContains: 'braids', lastVisitBeforeDays: 60 }
  assert.deepEqual(names(segment({ ...base, channel: 'email' }).contacts), ['ada', 'bola', 'chi', 'hauwa', 'jide'])
  assert.deepEqual(names(segment({ ...base, channel: 'whatsapp' }).contacts), ['ada', 'bola', 'dayo', 'hauwa', 'jide'])
  assert.equal(segment({ ...base, channel: 'email' }).unreachable, 1)
})

test('time off never appears in any audience, even unfiltered', () => {
  for (const channel of [undefined, 'email', 'whatsapp', 'sms']) {
    const all = segment(channel ? { channel } : {})
    assert.ok(all.contacts.every((item) => !item.contact.email.startsWith('time-off@')), channel)
    assert.ok(all.optedOut.every((item) => !item.contact.email.startsWith('time-off@')))
  }
  // Exactly one contact (ese) is opted out of the unfiltered audience.
  assert.equal(segment({}).optedOut.length, 1)
})

test('opt-out is excluded from every output: queue, email batches and CSV', () => {
  for (const channel of ['whatsapp', 'sms', 'email']) {
    const queue = campaignQueue(state(), { segment: {}, offerText: '10% off', offerCode: 'HAIR10' }, channel, opts)
    assert.ok(queue.recipients.length > 5)
    assert.ok(queue.all.every((item) => item.contact.email !== 'ese@x.test'), channel)
    assert.ok(queue.all.every((item) => !item.links.whatsapp.includes('2348050001111') && !item.links.sms.includes('2348050001111')))
    assert.ok(!exportCampaignCsv(queue.recipients).includes('ese@x.test'))
    assert.ok(emailBatches(queue.recipients, 40).every((batch) => !batch.url.includes('ese%40x.test')))
  }
  // Even if a caller hands an opted-out contact straight to the exporters they are skipped.
  const queue = campaignQueue(state(), { segment: {} }, 'email', opts)
  const hostile = [...queue.recipients, { contact: { name: 'Ese Ojo', email: 'ese@x.test', phone: '0805 000 1111', marketing_opt_out: true }, stats: {}, text: 'x' }]
  assert.ok(!exportCampaignCsv(hostile).includes('ese@x.test'))
  assert.ok(emailBatches(hostile, 40).every((batch) => !batch.emails.includes('ese@x.test')))
})

test('filters: visits, VIPs, tags, no-shows, spend, never rebooked, new this month, source', () => {
  assert.deepEqual(names(segment({ visitsAtLeast: 3 }).contacts), ['ada', 'femi'])
  assert.deepEqual(names(segment({ tag: 'vip' }).contacts), ['ada'])
  assert.deepEqual(names(segment({ noShowsAtLeast: 1 }).contacts), ['jide'])
  // Spend counts completed and ended confirmed visits at service display prices.
  assert.deepEqual(names(segment({ spendAtLeast: 90000 }).contacts), ['ada', 'femi'])
  assert.deepEqual(names(segment({ newThisMonth: true }).contacts), ['kemi', 'lola', 'mira', 'nora', 'pia', 'rita'])
  assert.deepEqual(names(segment({ neverRebooked: true, visitsAtLeast: 1 }).contacts), ['chi', 'dayo', 'ife', 'pia'])
  assert.deepEqual(names(segment({ categoryContains: 'lashes', lastVisitWithinDays: 5 }).contacts), ['ada', 'kemi'])
  assert.deepEqual(names(segment({ serviceContains: 'manicure', visitsAtLeast: 2 }).contacts), ['femi'])
  assert.ok(names(segment({ source: 'owner' }).contacts).length > 0)
  assert.deepEqual(names(segment({ noVisitSinceDays: 100 }).contacts), ['jide'])
})

test('presets are valid and Due to rebook uses each service rebook_after_days', () => {
  assert.equal(SEGMENT_PRESETS.length, 5)
  for (const preset of SEGMENT_PRESETS) assert.deepEqual(normalizeFilters(preset.filters), preset.filters, preset.id)
  const due = SEGMENT_PRESETS.find((preset) => preset.id === 'due-rebook').filters
  // Latest visit older than the service interval: chi/dayo/ife (braids 42d), hauwa (nails 21d). Femi is 15 of 21 days in; ese is opted out.
  assert.deepEqual(names(segment(due).contacts), ['chi', 'dayo', 'hauwa', 'ife'])
  assert.deepEqual(names(segment(SEGMENT_PRESETS.find((preset) => preset.id === 'vips').filters).contacts), ['ada', 'femi'])
})

test('normalizeFilters drops junk and accepts JSON text', () => {
  assert.deepEqual(normalizeFilters({ visitsAtLeast: '3', tag: ' vip ', nope: 1, neverRebooked: false, channel: 'fax', spendAtLeast: -5 }), { visitsAtLeast: 3, tag: 'vip' })
  assert.deepEqual(normalizeFilters('{"channel":"email","source":"guest"}'), { channel: 'email', source: 'guest' })
  assert.deepEqual(normalizeFilters('{oops'), {})
})

test('campaign queue composes text, a STOP footer, and one link per recipient', () => {
  const queue = campaignQueue(state(), { segment: { visitsAtLeast: 3 }, offerText: '10% off if you book before 30 Nov', offerCode: 'HAIR10' }, 'whatsapp', opts)
  assert.equal(queue.total, 2)
  const first = queue.recipients[0]
  assert.match(first.text, /Hi Ada/)
  assert.match(first.text, /10% off if you book before 30 Nov/)
  assert.match(first.text, /Offer code: HAIR10/)
  assert.doesNotMatch(first.text, /Valid until/) // empty variable drops its label line
  assert.match(first.text, /Reply STOP to opt out\./)
  assert.match(first.link, /^https:\/\/wa\.me\/2348035550182\?text=/)
  assert.equal(first.openedAt, '')
  assert.match(queue.recipients.broadcast.text, /Hi there/)
  // A custom body without STOP still gets the footer.
  const custom = campaignQueue(state(), { segment: { visitsAtLeast: 3 }, template: { body: 'Hello {{first_name}}!' } }, 'whatsapp', opts)
  assert.match(custom.recipients[0].text, /Hello Ada!\n\nReply STOP to opt out\.$/)
})

test('campaign recipients show opened-by-you from offers and last_campaign_at', () => {
  const s = state()
  s.contacts = [
    { id: 'c-ada', email: 'ada@x.test', offers_json: JSON.stringify([{ code: 'HAIR10', status: 'redeemed', at: '2026-10-01T10:00:00.000Z' }]) },
    { id: 'c-femi', email: 'femi@x.test', last_campaign_at: '2026-10-02T10:00:00.000Z' },
  ]
  const queue = campaignQueue(s, { segment: { visitsAtLeast: 3 }, offerCode: 'HAIR10', created_at: '2026-10-01T00:00:00.000Z' }, 'whatsapp', opts)
  const ada = queue.recipients.find((item) => item.contact.email === 'ada@x.test')
  const femi = queue.recipients.find((item) => item.contact.email === 'femi@x.test')
  assert.equal(ada.redeemed, true)
  assert.equal(ada.openedAt, '2026-10-01T10:00:00.000Z')
  assert.equal(femi.openedAt, '2026-10-02T10:00:00.000Z')
})

test('queue caps at 200 recipients and says so', () => {
  const s = state()
  for (let index = 0; index < 230; index += 1) {
    s.bookings.push({
      id: `bulk${index}`, service_id: 'svc-nails', service_name: 'Gel manicure', schedule_id: 'sch-owner', status: 'completed', timezone: TZ,
      starts_at: new Date(NOW - 40 * 86_400_000).toISOString(), ends_at: new Date(NOW - 40 * 86_400_000 + 3_600_000).toISOString(),
      guest_name: `Bulk ${index}`, guest_email: `bulk${index}@x.test`, guest_phone: `0803${String(1000000 + index)}`,
    })
  }
  const queue = campaignQueue(s, { segment: { serviceContains: 'manicure' } }, 'whatsapp', opts)
  assert.equal(queue.recipients.length, CAMPAIGN_CAP)
  assert.equal(queue.capped, true)
  assert.ok(queue.total > CAMPAIGN_CAP)
})

test('email batches: at most 40 BCC, labelled, deduped, and mailto length safe', () => {
  const recipients = Array.from({ length: 95 }, (_, index) => ({ contact: { email: `person${index}@example.com`, name: `P${index}` }, subject: 'Hello', text: 'A short note' }))
  recipients.push({ contact: { email: 'phone-2348030000000@bookins.invalid', name: 'Placeholder' } }, { contact: { email: 'person1@example.com', name: 'Dupe' } })
  const batches = emailBatches(recipients, 40)
  assert.equal(batches.length, 3)
  assert.deepEqual(batches.map((batch) => batch.count), [40, 40, 15])
  assert.deepEqual(batches.map((batch) => batch.label), ['Batch 1 of 3', 'Batch 2 of 3', 'Batch 3 of 3'])
  for (const batch of batches) {
    assert.match(batch.url, /^mailto:\?bcc=/)
    assert.ok(batch.emails.length <= 40)
    assert.ok(batch.url.length <= 1900)
  }
  assert.ok(!batches.some((batch) => batch.url.includes('bookins.invalid')))
  // Long addresses force smaller batches rather than an oversized link.
  const long = Array.from({ length: 60 }, (_, index) => ({ contact: { email: `a.very.long.address.number.${index}@a-quite-long-domain-name.example.com`, name: 'x' }, subject: 'S', text: 'T' }))
  const split = emailBatches(long, 40)
  assert.ok(split.length > 2)
  assert.ok(split.every((batch) => batch.url.length <= 1900 && batch.count <= 40))
  assert.equal(split.reduce((sum, batch) => sum + batch.count, 0), 60)
  // A message that cannot fit is reported, not truncated.
  const tooLong = emailBatches([{ contact: { email: 'a@b.co', name: 'A' } }], 40, { subject: 'S', text: 'x'.repeat(3000) })
  assert.ok(tooLong[0].error && tooLong[0].url === '')
})

test('CSV export neutralizes formulas, hides placeholder emails, and parses back', () => {
  const rows = [
    { contact: { name: '=HYPERLINK("x")', email: 'a@x.test', phone: '0803 1', marketing_opt_out: false }, stats: { lastService: 'Braids', lastAt: '2026-08-01T10:00:00.000Z', visits: 2 }, text: 'Hi, "there"\nline 2', offerCode: 'X1' },
    { contact: { name: 'Dayo', email: 'phone-1@bookins.invalid', phone: '0803 2', marketing_opt_out: false }, stats: {}, text: 'Hi' },
  ]
  const parsed = parseCsv(exportCampaignCsv(rows))
  assert.equal(parsed.length, 3)
  assert.equal(parsed[1][0], `'=HYPERLINK("x")`)
  assert.equal(parsed[1][5], '2026-08-01')
  assert.equal(parsed[1][8], 'Hi, "there"\nline 2')
  assert.equal(parsed[2][2], '')
})
