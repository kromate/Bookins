import test from 'node:test'
import assert from 'node:assert/strict'
import { toCsv } from '../csv.js'
import { exportServicesCsv, parseDuration, parsePrice, parseServiceCsv, serializeService, serviceCsvTemplate, serviceDisplayMeta, importErrorReportCsv } from '../services.js'
import { splitDescription } from '../service-meta.js'

globalThis.window = { location: { hostname: 'localhost', origin: 'http://localhost', hash: '' } }
const booking = await import('../booking.js')

const schedule = { id: 'sch', slot_interval_minutes: 60, timezone: 'Africa/Lagos' }
const parse = (rows, extra = {}) => parseServiceCsv(toCsv(rows), { schedule, services: [], ...extra })
const HEADER = ['category', 'name', 'description', 'duration_minutes', 'price', 'currency', 'visibility', 'location', 'active', 'staff', 'sort_order', 'rebook_after_days', 'prep_notes']

test('serializeService writes fields and trailer together, and old inputs keep working', () => {
  const value = serializeService({ name: 'Silk press', description: 'Smooth.', durationMinutes: 60, scheduleId: 's', price: 15000, currency: 'NGN', visibility: 'public', active: true, category: 'Hair', sortOrder: 3, rebookAfterDays: 28, prepNotes: 'Wash first' })
  assert.equal(value.category, 'Hair')
  assert.equal(value.sort_order, 3)
  assert.equal(value.rebook_after_days, 28)
  assert.equal(value.prep_notes, 'Wash first')
  assert.deepEqual(splitDescription(value.description), { text: 'Smooth.', meta: { c: 'Hair', o: 3, p: 'Wash first' } })
  // Pausing with the old call shape (description carries the trailer) keeps every value and never doubles the trailer.
  const existing = { id: 'x', slug: 'silk-press', ...value }
  const paused = serializeService({ name: 'Silk press', description: existing.description, durationMinutes: 60, scheduleId: 's', visibility: 'public', active: false }, existing, [existing])
  assert.equal(paused.slug, 'silk-press')
  assert.equal(paused.description, value.description)
  assert.equal(paused.category, 'Hair')
  assert.equal(paused.sort_order, 3)
  assert.equal(paused.active, false)
  assert.deepEqual(serviceDisplayMeta(existing), { text: 'Smooth.', category: 'Hair', sortOrder: 3, rebookAfterDays: 28, prepNotes: 'Wash first', staffId: '', staffName: '', baseId: '' })
  const plain = serializeService({ name: 'Intro', description: 'Hi', durationMinutes: 30, scheduleId: 's', visibility: 'public', active: true })
  assert.equal(plain.description, 'Hi')
  assert.ok(!('sort_order' in plain) && !('rebook_after_days' in plain))
})

test('parsePrice and parseDuration accept spreadsheet habits and reject nonsense', () => {
  assert.deepEqual(parsePrice('₦45,000'), { value: 45000, currency: 'NGN' })
  assert.deepEqual(parsePrice('N 12 500'), { value: 12500, currency: 'NGN' })
  assert.deepEqual(parsePrice('NGN 3000'), { value: 3000, currency: 'NGN' })
  assert.deepEqual(parsePrice('GHS 150.5'), { value: 150.5, currency: 'GHS' })
  assert.deepEqual(parsePrice('free'), { value: 0, currency: '' })
  assert.deepEqual(parsePrice(''), { value: 0, currency: '' })
  assert.throws(() => parsePrice('-500'), /negative/)
  assert.throws(() => parsePrice('abc'), /not a number/)
  assert.equal(parseDuration('90'), 90)
  assert.equal(parseDuration('90 min'), 90)
  assert.equal(parseDuration('1h'), 60)
  assert.equal(parseDuration('1h30'), 90)
  assert.equal(parseDuration('1.5 hours'), 90)
  assert.ok(Number.isNaN(parseDuration('soon')))
})

test('parseServiceCsv validates rows with plain-language errors', () => {
  const result = parse([
    HEADER,
    ['Braids', 'Knotless', 'Nice', '60', '45,000', '', 'public', '', 'yes', '', '1', '42', 'Wash hair'],
    ['Braids', 'Too long', '', '480', '100', '', '', '', '', '', '', '', ''],
    ['Braids', 'Odd', '', '47', '100', '', '', '', '', '', '', '', ''],
    ['Braids', 'Free?', '', '30', -5, '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['Nails', '', '', '30', '', '', '', '', '', '', '', '', ''],
    ['Nails', 'Bad flags', '', '30', '', 'ngn1', 'secret', '', 'maybe', '', 'x', '0', ''],
  ])
  assert.deepEqual(result.counts, { new: 1, update: 0, skip: 0, error: 5 })
  assert.equal(result.rows.length, 6) // fully blank rows are ignored
  assert.deepEqual(result.rows.map((row) => row.line), [2, 3, 4, 5, 7, 8])
  assert.equal(result.rows[0].slug, 'braids-knotless')
  assert.equal(result.rows[0].values.price, 45000)
  assert.equal(result.rows[1].errors[0], 'Duration 480 min exceeds your 60-minute booking interval. Increase the interval in Availability, or shorten this service.')
  assert.match(result.rows[2].errors[0], /multiple of 5/)
  assert.match(result.rows[3].errors[0], /negative/)
  assert.match(result.rows[4].errors[0], /Name is required/)
  assert.ok(result.rows[5].errors.length >= 4)
})

test('parseServiceCsv maps header aliases, reports unmapped columns, and handles files it cannot read', () => {
  const text = 'Service Name;Mins;Cost;Group;Favourite colour\nBlow dry;45;₦8000;Hair;blue\n'
  const result = parseServiceCsv(text, { schedule, services: [] })
  assert.deepEqual(result.unmapped, ['Favourite colour'])
  assert.deepEqual(result.headers.map((h) => h.field), ['name', 'duration_minutes', 'price', 'category', null])
  assert.equal(result.rows[0].values.currency, 'NGN')
  assert.equal(result.rows[0].slug, 'hair-blow-dry')
  // Manual mapping overrides for headers the aliases do not know.
  const mapped = parseServiceCsv('Thing,How long\nBlow dry,30', { schedule, mapping: { Thing: 'name', 'How long': 'duration_minutes' } })
  assert.equal(mapped.rows[0].status, 'new')
  assert.match(parseServiceCsv('', { schedule }).error, /empty/)
  assert.match(parseServiceCsv('price\n5', { schedule }).error, /name column/)
  assert.match(parseServiceCsv('name\nx', { schedule }).error, /duration column/)
  assert.match(parseServiceCsv('name,duration\nx,30', { schedule: null }).error, /availability/i)
  const big = toCsv([['name', 'duration'], ...Array.from({ length: 1001 }, (_, i) => [`S${i}`, 30])])
  assert.match(parseServiceCsv(big, { schedule }).error, /1,?000/)
  assert.equal(parseServiceCsv(big, { schedule }).rows.length, 0)
})

test('formula injection is neutralized on import and stays neutralized on export', () => {
  const result = parse([HEADER, ['', '=HYPERLINK("http://evil","Click")', '+cmd', '30', '', '', '', '@here', '', '', '', '', '-1+1']])
  const row = result.rows[0]
  assert.equal(row.status, 'new')
  assert.equal(row.values.name, `'=HYPERLINK("http://evil","Click")`)
  assert.equal(row.values.description, "'+cmd")
  assert.equal(row.values.location, "'@here")
  assert.equal(row.values.prepNotes, "'-1+1")
  const stored = serializeService(row.values, null, [])
  const exported = exportServicesCsv([{ id: '1', ...stored }], [schedule])
  const cells = exported.split('\r\n')[1]
  assert.ok(cells.startsWith(`","'=HYPERLINK`) || cells.includes(`'=HYPERLINK`))
  assert.ok(!/(^|,)"?=HYPERLINK/.test(cells))
  // Re-importing the neutralized export is a no-op, not a second apostrophe.
  const again = parseServiceCsv(exported, { schedule, services: [{ id: '1', ...stored }] })
  assert.equal(again.rows[0].status, 'skip')
})

test('duplicate lines in one file are skipped; slug match is an update; identical rows are skipped', () => {
  const existing = [{ id: 's1', slug: 'braids-knotless', name: 'Knotless', description: 'Old', duration_minutes: 60, price: 100, currency: 'NGN', visibility: 'public', active: true, schedule_id: 'sch' }]
  const result = parse(
    [HEADER, ['Braids', 'Knotless', 'New', '60', '200', '', '', '', '', '', '', '', ''], ['Braids', 'Knotless', 'Dup', '60', '200', '', '', '', '', '', '', '', ''], ['Nails', 'Gel', '', '30', '', '', '', '', '', '', '', '', '']],
    { services: existing },
  )
  assert.deepEqual(result.rows.map((row) => row.status), ['update', 'skip', 'new'])
  assert.equal(result.rows[0].existingId, 's1')
  assert.match(result.rows[1].notes[0], /line 2/)
})

test('export round-trips through parse: every row is a no-op, copies and staff names handled', () => {
  const services = [
    { id: 'a', slug: 'braids-knotless', name: 'Knotless', category: 'Braids', description: 'Mid-back.', duration_minutes: 60, price: 45000, currency: 'NGN', visibility: 'public', active: true, location: 'Lekki', sort_order: 1, rebook_after_days: 42, prep_notes: 'Wash, "detangle"', schedule_id: 'sch' },
    { id: 'b', slug: 'gel', name: 'Gel, short', description: 'Gel, short', duration_minutes: 30, price: 0, currency: 'NGN', visibility: 'private', active: false, schedule_id: 'sch' },
    { id: 'c', slug: 'braids-knotless-amaka', name: 'Knotless', description: serializeService({ name: 'Knotless', description: 'x', staffId: 'st1', staffName: 'Amaka', baseId: 'a' }).description, duration_minutes: 60, price: 45000, schedule_id: 'sch2' },
  ]
  const csv = exportServicesCsv(services, [schedule], { staff: [{ name: 'Amaka', service_ids_json: JSON.stringify(['a']) }, { name: 'Tolu', service_ids_json: JSON.stringify(['a']) }] })
  const lines = csv.split('\r\n')
  assert.equal(lines.length, 3) // header + 2 (the per-staff copy is not exported)
  assert.ok(csv.includes('Amaka | Tolu'))
  const parsed = parseServiceCsv(csv, { schedule, services })
  assert.deepEqual(parsed.rows.map((row) => row.status), ['skip', 'skip'])
  assert.deepEqual(parsed.rows.flatMap((row) => row.values.staffNames), ['Amaka', 'Tolu'])
  assert.deepEqual(parsed.rows.map((row) => row.errors), [[], []])
  assert.equal(parseServiceCsv(serviceCsvTemplate(), { schedule: { ...schedule, slot_interval_minutes: 240 } }).counts.new, 3)
  assert.equal(parseServiceCsv(serviceCsvTemplate(), { schedule }).counts.error, 1) // 240-minute example vs 60-minute interval
})

const workspace = () => booking.loadOwnerWorkspace()
const rowsFor = (count, bad = []) => {
  const rows = [HEADER]
  for (let i = 1; i <= count; i += 1) {
    const flaw = bad.find((item) => item.at === i)
    rows.push([`Cat ${i % 7}`, `Service ${i}`, `Description ${i}`, flaw?.duration ?? (i % 2 ? '30' : '60'), flaw?.price ?? String(1000 + i), 'NGN', 'public', '', 'yes', '', String(i), '', ''])
  }
  return toCsv(rows)
}

test('150-row import: 3 bad rows listed, 147 saved, re-import creates nothing and is idempotent', async () => {
  const state = await workspace()
  const csv = rowsFor(150, [{ at: 10, duration: '480' }, { at: 77, price: '-5' }, { at: 140, duration: '47' }])
  const preview = parseServiceCsv(csv, { schedule: state.schedules[0], services: state.services })
  assert.deepEqual(preview.counts, { new: 147, update: 0, skip: 0, error: 3 })
  assert.deepEqual(preview.rows.filter((row) => row.status === 'error').map((row) => row.line), [11, 78, 141])
  const progress = []
  const saved = await booking.importServices(preview.rows, { onProgress: (p) => progress.push(p) })
  assert.equal(saved.created, 147)
  assert.equal(saved.updated, 0)
  assert.deepEqual(saved.failed, [])
  assert.equal(progress.length, 147)
  assert.deepEqual(progress.at(-1), { done: 147, total: 147, created: 147, updated: 0, failed: 0 })
  const after = await workspace()
  assert.equal(after.services.length, state.services.length + 147)
  // Errors are never written; whole rows only.
  assert.ok(!after.services.some((item) => item.name === 'Service 10' || item.name === 'Service 77' || item.name === 'Service 140'))
  assert.ok(after.services.filter((item) => /^Service \d+$/.test(item.name)).every((item) => item.slug && item.duration_minutes && item.schedule_id === state.schedules[0].id))
  const sample = after.services.find((item) => item.name === 'Service 5')
  assert.equal(sample.category, 'Cat 5')
  assert.equal(sample.sort_order, 5)
  assert.equal(splitDescription(sample.description).meta.c, 'Cat 5')

  // Re-import the same file: nothing new, every row identical.
  const again = parseServiceCsv(csv, { schedule: after.schedules[0], services: after.services })
  assert.deepEqual(again.counts, { new: 0, update: 0, skip: 147, error: 3 })
  const rerun = await booking.importServices(again.rows)
  assert.equal(rerun.created, 0)
  assert.equal(rerun.skipped, 147)
  assert.equal((await workspace()).services.length, after.services.length)

  // Changing one price turns exactly that row into an update, still without duplicates.
  const edited = csv.replace('1005', '1555')
  const third = parseServiceCsv(edited, { schedule: after.schedules[0], services: after.services })
  assert.equal(third.counts.update, 1)
  const updated = await booking.importServices(third.rows)
  assert.deepEqual([updated.created, updated.updated], [0, 1])
  assert.equal((await workspace()).services.length, after.services.length)
})

test('import: concurrency 4, cancel with AbortSignal, then a re-run finishes the rest without duplicates', async () => {
  const state = await workspace()
  const csv = toCsv([HEADER, ...Array.from({ length: 30 }, (_, i) => ['Bulk', `Cancel ${i}`, '', '30', '', '', '', '', '', '', '', '', ''])])
  const preview = parseServiceCsv(csv, { schedule: state.schedules[0], services: state.services })
  const controller = new AbortController()
  const first = await booking.importServices(preview.rows, { signal: controller.signal, onProgress: ({ done }) => { if (done === 10) controller.abort() } })
  assert.equal(first.cancelled, true)
  assert.ok(first.created >= 10 && first.created < 30)
  assert.equal(first.created + first.remaining, 30)
  const mid = await workspace()
  const resume = parseServiceCsv(csv, { schedule: mid.schedules[0], services: mid.services })
  assert.equal(resume.counts.skip, first.created)
  assert.equal(resume.counts.new, 30 - first.created)
  const second = await booking.importServices(resume.rows)
  assert.equal(second.created, 30 - first.created)
  const done = await workspace()
  assert.equal(done.services.filter((item) => item.name.startsWith('Cancel ')).length, 30)
  assert.equal(new Set(done.services.map((item) => item.slug)).size, done.services.length)
})

test('import reports per-row write failures and never throws for them', async () => {
  const state = await workspace()
  const csv = toCsv([HEADER, ['', 'Fails A', '', '30', '', '', '', '', '', '', '', '', ''], ['', 'Works', '', '30', '', '', '', '', '', '', '', '', ''], ['', 'Fails B', '', '30', '', '', '', '', '', '', '', '', '']])
  const preview = parseServiceCsv(csv, { schedule: state.schedules[0], services: state.services })
  const realSubmit = globalThis.window.GoalmaticData
  globalThis.window.GoalmaticData = {
    submit: async (_table, value) => { if (/Fails/.test(value.name)) throw new Error('Table rejected the row'); return { record: { id: `new-${value.slug}`, ...value } } },
    update: async () => ({}),
    fetchAll: async () => ({ complete: true, records: [] }),
  }
  try {
    const result = await booking.importServices(preview.rows)
    assert.equal(result.created, 1)
    assert.equal(result.failed.length, 2)
    assert.deepEqual(result.failed.map((item) => item.line), [2, 4])
    assert.match(result.failed[0].reason, /Table rejected/)
    const report = importErrorReportCsv(preview.rows, result.failed)
    assert.match(report, /Fails A/)
  } finally {
    globalThis.window.GoalmaticData = realSubmit
  }
})

test('hand-made CSV matches an existing service by name instead of duplicating it (M4)', async () => {
  const { parseServiceCsv } = await import('../services.js')
  const schedule = { id: 's', slot_interval_minutes: 60, timezone: 'UTC' }
  const services = [{ id: 'svc-1', slug: 'discovery-call', name: 'Discovery call', description: 'x', duration_minutes: 30, schedule_id: 's', price: 0, currency: 'NGN', visibility: 'public', active: true }]
  const out = parseServiceCsv('category,name,duration_minutes,price\nConsultations,Discovery call,45,5000\n', { schedule, services })
  assert.equal(out.rows[0].status, 'update')
  assert.equal(out.rows[0].slug, 'discovery-call')
  assert.equal(out.counts.new, 0)
})
