import assert from 'node:assert/strict'
import test from 'node:test'
import { filterGroups, parseBio, readPageParams, slugify, teamRows } from '../guest-page.js'
import { groupServices, presentService, withMeta } from '../service-meta.js'
import { searchTimeZones } from '../time-display.js'

test('bio WhatsApp marker is hidden and validated', () => {
  assert.deepEqual(parseBio('Braids.\n[[wa:+234 803 123 4567]]'), { text: 'Braids.', whatsapp: '2348031234567' })
  assert.equal(parseBio('Hi [[wa:08031234567]] there').whatsapp, '')
  assert.equal(parseBio('Hi [[wa:08031234567]] there').text, 'Hi  there')
  assert.equal(parseBio('[[wa:+12]]').whatsapp, '')
  assert.equal(parseBio('[[wa:+1234567890123456789]]').whatsapp, '')
  assert.equal(parseBio('[[wa:+234<script>]]').whatsapp, '')
  assert.deepEqual(parseBio(null), { text: '', whatsapp: '' })
})

test('bio drops a dangling lead-in once the WhatsApp marker is stripped', () => {
  assert.deepEqual(parseBio('Braids in Lekki.\nWhatsApp us: [[wa:+234 803 123 4567]]'), { text: 'Braids in Lekki.', whatsapp: '2348031234567' })
  assert.equal(parseBio('Braids in Lekki. WhatsApp us: [[wa:+2348031234567]]').text, 'Braids in Lekki.')
  assert.equal(parseBio('WhatsApp us: [[wa:+2348031234567]]').text, '')
  assert.equal(parseBio('Hours: Mon-Fri.\nBook below [[wa:+2348031234567]]').text, 'Hours: Mon-Fri.\nBook below')
  // no marker: a colon at the end is the owner's own text and stays
  assert.equal(parseBio('Services include:').text, 'Services include:')
})

test('page params are sanitised', () => {
  const p = readPageParams('?name=Ada%20Obi&email=ada@x.com&phone=%2B234%20801&layout=WEEK&theme=dark&service=Silk-Press')
  assert.equal(p.name, 'Ada Obi')
  assert.equal(p.layout, 'week')
  assert.equal(p.theme, 'dark')
  assert.equal(p.phone, '+234 801')
  assert.equal(readPageParams('?layout=grid&theme=neon&phone=abc').layout, '')
  assert.equal(readPageParams('?layout=grid&theme=neon&phone=abc').phone, '')
  assert.equal(readPageParams('?name=' + 'x'.repeat(500)).name.length, 160)
  assert.equal(slugify('Silk Press!'), 'silk-press')
})

test('team copies collapse into one row with a staff choice', () => {
  const svc = (id, name, meta, price = 5000) => ({ id, name, price, durationMinutes: 60, description: withMeta('d', meta) })
  const groups = groupServices([
    svc('1', 'Knotless braids', { c: 'Braids', s: 'st-a', n: 'Chidi' }, 8000),
    svc('2', 'Knotless braids', { c: 'Braids', s: 'st-b', n: 'Amaka' }, 6000),
    svc('3', 'Silk press', { c: 'Hair' }),
    svc('4', 'Wash', { c: 'Hair', s: 'st-a' }),
  ]).map(g => ({ name: g.name, rows: teamRows(g.items) }))
  const braids = groups.find(g => g.name === 'Braids').rows
  assert.equal(braids.length, 1)
  assert.equal(braids[0].team, true)
  assert.deepEqual(braids[0].copies.map(c => c.staffName), ['Amaka', 'Chidi'])
  assert.equal(braids[0].price, 6000)
  assert.equal(braids[0].priceVaries, true)
  const hair = groups.find(g => g.name === 'Hair').rows
  assert.equal(hair.length, 2)
  assert.ok(hair.every(r => !r.team))
  assert.equal(presentService({ description: withMeta('x', { n: 'Amaka', s: 'a' }) }).staffName, 'Amaka')
  assert.deepEqual(filterGroups(groups, 'amaka').map(g => g.name), ['Braids'])
  assert.deepEqual(filterGroups(groups, 'hair').map(g => g.name), ['Hair'])
  assert.equal(filterGroups(groups, 'zzz').length, 0)
})

test('time zone search finds by city, region words and abbreviation', () => {
  assert.equal(searchTimeZones('lagos')[0], 'Africa/Lagos')
  assert.ok(searchTimeZones('new york').includes('America/New_York'))
  assert.equal(searchTimeZones('', { pinned: ['Africa/Accra'] })[0], 'Africa/Accra')
  assert.equal(searchTimeZones('qqqqzz').length, 0)
})

// ---- team rows (H2) ----
const svc = (id, name, meta = {}, extra = {}) => ({
  id, name, price: 5000, durationMinutes: 60, description: withMeta(extra.description ?? '', meta), ...extra.fields,
})
const rowsOf = (services, hostName = 'Amina Beauty') =>
  groupServices(services).flatMap(g => teamRows(g.items, { hostName }))
const labels = row => row.options.map(o => (o.owner ? 'host' : o.copy.staffName))

test('owner plus two members is one row: host first, then members', () => {
  const rows = rowsOf([
    svc('base', 'Knotless braids', { c: 'Braids', p: 'Wash your hair' }, { description: 'Gentle braids.' }),
    svc('c-tolu', 'Knotless braids', { c: 'Braids', s: 'st-t', n: 'Tolu', b: 'base' }),
    svc('c-amaka', 'Knotless braids', { c: 'Braids', s: 'st-a', n: 'Amaka', b: 'base' }),
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].team, true)
  assert.deepEqual(labels(rows[0]), ['host', 'Amaka', 'Tolu'])
  assert.equal(rows[0].options[0].copy.id, 'base')
  assert.equal(rows[0].copies.length, 3)
  assert.equal(rows[0].prepNotes, 'Wash your hair')
  assert.equal(rows[0].description, 'Gentle braids.')
})

test('prep notes are shared across the group whichever copy carries them', () => {
  const [row] = rowsOf([
    svc('base', 'Silk press', { c: 'Hair' }),
    svc('c1', 'Silk press', { c: 'Hair', s: 'a', n: 'Amaka', b: 'base', p: 'Bring a bonnet' }),
    svc('c2', 'Silk press', { c: 'Hair', s: 'b', n: 'Tolu', b: 'base' }),
  ])
  assert.equal(row.prepNotes, 'Bring a bonnet')
})

test('owner plus one member offers a choice only when the member is a different person', () => {
  const different = rowsOf([
    svc('base', 'Consultation', { c: 'Hair' }),
    svc('c1', 'Consultation', { c: 'Hair', s: 'b', n: 'Tolu', b: 'base' }),
  ])
  assert.equal(different.length, 1)
  assert.equal(different[0].team, true)
  assert.deepEqual(labels(different[0]), ['host', 'Tolu'])
  // an unnamed copy, or one carrying the host's own name, only shadows the base: one row, no choice, base wins
  for (const meta of [{ s: 'b', b: 'base' }, { s: 'b', n: 'amina beauty', b: 'base' }]) {
    const shadow = rowsOf([svc('base', 'Consultation', { c: 'Hair' }), svc('c1', 'Consultation', { c: 'Hair', ...meta })])
    assert.equal(shadow.length, 1)
    assert.equal(shadow[0].team, false)
    assert.equal(shadow[0].options.length, 1)
    assert.equal(shadow[0].options[0].copy.id, 'base')
    assert.equal(shadow[0].id, 'base')
  }
})

test('two members without an owner service are a team; one lone member is a plain row', () => {
  const two = rowsOf([
    svc('c1', 'Locs', { c: 'Hair', s: 'a', n: 'Amaka', b: 'gone' }),
    svc('c2', 'Locs', { c: 'Hair', s: 'b', n: 'Tolu', b: 'gone' }),
  ])
  assert.equal(two.length, 1)
  assert.equal(two[0].team, true)
  assert.deepEqual(labels(two[0]), ['Amaka', 'Tolu'])
  const one = rowsOf([svc('c2', 'Locs', { c: 'Hair', s: 'b', n: 'Tolu', b: 'gone' })])
  assert.equal(one.length, 1)
  assert.equal(one[0].team, false)
  assert.equal(one[0].options[0].copy.staffName, 'Tolu')
})

test('legacy copies without baseId attach to the same-name owner service', () => {
  const rows = rowsOf([
    svc('base', 'Wash', { c: 'Hair' }),
    svc('c1', 'Wash', { c: 'Hair', s: 'a', n: 'Amaka' }),
  ])
  assert.equal(rows.length, 1)
  assert.deepEqual(labels(rows[0]), ['host', 'Amaka'])
})

test('services without a team are untouched, and distinct services stay separate', () => {
  const rows = rowsOf([svc('1', 'Silk press', { c: 'Hair' }), svc('2', 'Wash', { c: 'Hair' }), svc('3', 'Wash', { c: 'Hair' })])
  assert.equal(rows.length, 3)
  assert.ok(rows.every(r => !r.team && r.options.length === 1))
})

test('search counts distinct services, not copies', () => {
  const services = []
  for (let i = 1; i <= 10; i++) {
    services.push(svc(`b${i}`, `Service ${i}`, { c: 'Hair' }))
    if (i <= 2) {
      services.push(svc(`a${i}`, `Service ${i}`, { c: 'Hair', s: 'a', n: 'Amaka', b: `b${i}` }))
      services.push(svc(`t${i}`, `Service ${i}`, { c: 'Hair', s: 't', n: 'Tolu', b: `b${i}` }))
    }
  }
  const groups = groupServices(services).map(g => ({ name: g.name, rows: teamRows(g.items, { hostName: 'Amina' }) }))
  const count = list => list.reduce((n, g) => n + g.rows.length, 0)
  assert.equal(count(groups), 10)
  assert.equal(count(filterGroups(groups, 'service')), 10)
  assert.equal(count(filterGroups(groups, 'amaka')), 2)
  assert.equal(count(filterGroups(groups, 'service 1')), 2) // "Service 1" and "Service 10"
})
