import test from 'node:test'
import assert from 'node:assert/strict'
import {
  listOpenings,
  listServiceOpenings,
  resolveBookingRequest,
  reservationKey,
  validateWeeklyWindows,
  wallClockInstant,
} from '../scheduling.js'

const NOW = new Date('2026-10-06T12:00:00.000Z') // a Tuesday
const weekdays = (start = 540, end = 1020, days = [1, 2, 3, 4, 5]) =>
  days.map((weekday) => ({ weekday, startMinute: start, endMinute: end }))
const sched = (over = {}) => ({
  timezone: 'Africa/Lagos',
  slotIntervalMinutes: 60,
  minimumNoticeMinutes: 0,
  bookingHorizonDays: 60,
  weeklyWindows: weekdays(),
  ...over,
})
const open = (over = {}, extra = {}) =>
  listOpenings({
    schedule: sched(over),
    durationMinutes: 60,
    fromDate: '2026-10-12',
    throughDate: '2026-10-12',
    now: NOW,
    busy: [],
    ...extra,
  })
const starts = (list) => list.map((item) => item.startsAt)
const code = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.code
  }
  return null
}

test('Africa/Lagos: Monday 09:00-17:00 is 08:00Z-16:00Z with local fields', () => {
  const result = open()
  assert.equal(result.length, 8)
  assert.equal(result[0].startsAt, '2026-10-12T08:00:00.000Z')
  assert.equal(result[0].localDate, '2026-10-12')
  assert.equal(result[0].localTime, '09:00')
  assert.equal(result.at(-1).startsAt, '2026-10-12T15:00:00.000Z')
})

test('Africa/Lagos: midnight slot keeps schedule-zone localDate', () => {
  const [first] = open({ weeklyWindows: weekdays(0, 60) })
  assert.equal(first.startsAt, '2026-10-11T23:00:00.000Z')
  assert.equal(first.localDate, '2026-10-12')
  assert.equal(first.localTime, '00:00')
})

test('weekday follows the calendar date, not the runtime timezone', () => {
  // Sunday-only window must yield nothing on Monday and something on Sunday.
  assert.equal(open({ weeklyWindows: weekdays(540, 1020, [0]) }).length, 0)
  const sunday = open({ weeklyWindows: weekdays(540, 1020, [0]) }, { fromDate: '2026-10-11', throughDate: '2026-10-11' })
  assert.equal(sunday.length, 8)
})

test('Pacific/Auckland: 09:00 NZDT is 20:00Z the previous day', () => {
  const result = open({ timezone: 'Pacific/Auckland' })
  assert.equal(result[0].startsAt, '2026-10-11T20:00:00.000Z')
  assert.equal(result[0].localDate, '2026-10-12')
  assert.equal(result[0].localTime, '09:00')
})

test('America/New_York: ordinary EDT day', () => {
  const result = open({ timezone: 'America/New_York' })
  assert.equal(result[0].startsAt, '2026-10-12T13:00:00.000Z')
})

test('America/New_York spring-forward skips the nonexistent 02:00', () => {
  const result = open(
    { timezone: 'America/New_York', weeklyWindows: weekdays(0, 360, [0]) },
    { fromDate: '2027-03-14', throughDate: '2027-03-14', now: new Date('2027-03-01T00:00:00Z') },
  )
  assert.deepEqual(result.map((item) => item.localTime), ['00:00', '01:00', '03:00', '04:00', '05:00'])
  assert.deepEqual(starts(result), [
    '2027-03-14T05:00:00.000Z',
    '2027-03-14T06:00:00.000Z',
    '2027-03-14T07:00:00.000Z',
    '2027-03-14T08:00:00.000Z',
    '2027-03-14T09:00:00.000Z',
  ])
  assert.equal(new Set(starts(result)).size, result.length)
  assert.equal(wallClockInstant('2027-03-14', 120, 'America/New_York'), null)
})

test('America/New_York fall-back takes the first of the ambiguous 01:00', () => {
  const result = open(
    { timezone: 'America/New_York', weeklyWindows: weekdays(0, 180, [0]) },
    { fromDate: '2026-11-01', throughDate: '2026-11-01' },
  )
  assert.deepEqual(starts(result), [
    '2026-11-01T04:00:00.000Z',
    '2026-11-01T05:00:00.000Z', // 01:00 EDT (first occurrence)
    '2026-11-01T07:00:00.000Z', // 02:00 EST
  ])
  assert.deepEqual(result.map((item) => item.localTime), ['00:00', '01:00', '02:00'])
})

test('minimum notice hides slots that start too soon', () => {
  const now = new Date('2026-10-12T07:00:00.000Z')
  const result = open({ minimumNoticeMinutes: 90 }, { now })
  // earliest allowed 08:30Z -> first slot is 09:00Z
  assert.equal(result[0].startsAt, '2026-10-12T09:00:00.000Z')
  assert.equal(open({ minimumNoticeMinutes: 0 }, { now })[0].startsAt, '2026-10-12T08:00:00.000Z')
})

test('horizon: clamped to 1..365 days from now', () => {
  const far = { fromDate: '2026-10-19', throughDate: '2026-10-21' }
  const within = open({ bookingHorizonDays: 14 }, far)
  assert.ok(within.some((item) => item.localDate === '2026-10-19'))
  assert.ok(!within.some((item) => item.localDate === '2026-10-21'))
  // horizon 0 clamps to 1 day: nothing on 10-12
  assert.equal(open({ bookingHorizonDays: 0 }).length, 0)
  // horizon above 365 clamps to 365 days
  const year = open({ bookingHorizonDays: 9999 }, { fromDate: '2027-10-05', throughDate: '2027-10-07' })
  assert.ok(year.every((item) => Date.parse(item.startsAt) <= NOW.getTime() + 365 * 86_400_000))
  assert.ok(year.length > 0)
})

test('overlap against busy ranges with different durations', () => {
  const busy = [{ startsAt: '2026-10-12T09:00:00.000Z', endsAt: '2026-10-12T09:30:00.000Z' }]
  const result = listOpenings({
    schedule: sched({ slotIntervalMinutes: 30 }),
    durationMinutes: 30,
    fromDate: '2026-10-12',
    throughDate: '2026-10-12',
    now: NOW,
    busy,
  })
  assert.ok(!starts(result).includes('2026-10-12T09:00:00.000Z'))
  assert.ok(starts(result).includes('2026-10-12T09:30:00.000Z'))
  // A 60-minute booking at 09:00Z blocks a 30-minute grid at 09:00 and 09:30 but not 08:30 or 10:00.
  const long = [{ startsAt: '2026-10-12T09:00:00.000Z', endsAt: '2026-10-12T10:00:00.000Z' }]
  const blocked = starts(
    listOpenings({
      schedule: sched({ slotIntervalMinutes: 30 }),
      durationMinutes: 30,
      fromDate: '2026-10-12',
      throughDate: '2026-10-12',
      now: NOW,
      busy: long,
    }),
  )
  assert.ok(blocked.includes('2026-10-12T08:30:00.000Z'))
  assert.ok(!blocked.includes('2026-10-12T09:00:00.000Z'))
  assert.ok(!blocked.includes('2026-10-12T09:30:00.000Z'))
  assert.ok(blocked.includes('2026-10-12T10:00:00.000Z'))
})

test('validation errors carry hosted codes and messages', () => {
  const run = (over, extra, duration = 60) =>
    code(() => listOpenings({ schedule: sched(over), durationMinutes: duration, fromDate: '2026-10-12', throughDate: '2026-10-12', now: NOW, busy: [], ...extra }))
  assert.equal(run({ slotIntervalMinutes: 7 }), 'BOOKING_SCHEDULE_INVALID')
  assert.equal(run({ slotIntervalMinutes: NaN }), 'BOOKING_SCHEDULE_INVALID')
  assert.equal(run({}, {}, 90), 'BOOKING_SERVICE_INVALID')
  assert.equal(run({}, {}, 7), 'BOOKING_SERVICE_INVALID')
  assert.equal(run({}, { throughDate: '2026-11-12' }), 'BOOKING_RANGE_INVALID')
  assert.equal(run({}, { throughDate: '2026-10-01' }), 'BOOKING_RANGE_INVALID')
  assert.equal(run({}, { fromDate: 'nope' }), 'BOOKING_DATE_INVALID')
  assert.equal(run({ timezone: 'Mars/Base' }), 'BOOKING_TIMEZONE_INVALID')
  assert.equal(
    run({ weeklyWindows: [...weekdays(540, 700, [1]), ...weekdays(600, 800, [1])] }),
    'BOOKING_SCHEDULE_INVALID',
  )
})

test('31-day range is allowed, 32 rejected; 200-openings cap applies per day boundary', () => {
  const call = (through) =>
    listOpenings({ schedule: sched(), durationMinutes: 60, fromDate: '2026-10-07', throughDate: through, now: NOW, busy: [] })
  assert.doesNotThrow(() => call('2026-11-06'))
  assert.equal(code(() => call('2026-11-07')), 'BOOKING_RANGE_INVALID')
  const all = listOpenings({
    schedule: sched({ weeklyWindows: weekdays(540, 1020, [0, 1, 2, 3, 4, 5, 6]) }),
    durationMinutes: 60, fromDate: '2026-10-07', throughDate: '2026-11-06', now: NOW, busy: [],
  })
  assert.ok(all.length <= 207 && all.length >= 200)
})

test('validateWeeklyWindows', () => {
  assert.equal(validateWeeklyWindows(weekdays()).valid, true)
  const overlap = validateWeeklyWindows([
    { weekday: 1, startMinute: 540, endMinute: 700 },
    { weekday: 1, startMinute: 600, endMinute: 800 },
  ])
  assert.equal(overlap.valid, false)
  assert.equal(overlap.message, 'Weekly availability windows must not overlap')
  assert.equal(validateWeeklyWindows([{ weekday: 1, startMinute: 600, endMinute: 600 }]).valid, false)
  assert.equal(validateWeeklyWindows([{ weekday: 1, startMinute: NaN, endMinute: 600 }]).valid, false)
  assert.equal(validateWeeklyWindows('nope').valid, false)
  // touching windows are fine
  assert.equal(
    validateWeeklyWindows([
      { weekday: 1, startMinute: 540, endMinute: 600 },
      { weekday: 1, startMinute: 600, endMinute: 700 },
    ]).valid,
    true,
  )
})

// ---- record-level behaviour ----

const world = (over = {}) => ({
  schedules: [
    {
      id: 's1', timezone: 'Africa/Lagos', weekly_windows_json: JSON.stringify(weekdays()),
      slot_interval_minutes: 60, minimum_notice_minutes: 60, booking_horizon_days: 14, active: true,
    },
  ],
  services: [
    { id: 'svc', name: 'Call', duration_minutes: 60, schedule_id: 's1', visibility: 'public', active: true },
    { id: 'priv', name: 'Private', duration_minutes: 60, schedule_id: 's1', visibility: 'private', active: true },
    { id: 'off', name: 'Off', duration_minutes: 60, schedule_id: 's1', visibility: 'public', active: false },
  ],
  bookings: [],
  ...over,
})
const contact = { name: 'Ada', email: 'Ada@Example.com', phone: '' }
const book = (w, startsAt, extra = {}) =>
  resolveBookingRequest({ ...w, serviceId: 'svc', startsAt, contact, now: NOW, ...extra })
const GOOD = '2026-10-12T09:00:00.000Z'
const stored = (b) => ({
  schedule_id: b.scheduleId, starts_at: b.opening.startsAt, ends_at: b.opening.endsAt,
  status: 'confirmed', reservation_key: b.reservationKey,
})

test('submit accepts a valid slot, normalizes contact, stores schedule tz', () => {
  const result = book(world(), GOOD)
  assert.equal(result.opening.timezone, 'Africa/Lagos')
  assert.equal(result.contact.email, 'ada@example.com')
  assert.equal(result.reservationKey, `s1|${GOOD}`)
})

test('submit rejections', () => {
  const w = world()
  const slot = (iso) => code(() => book(w, iso))
  assert.equal(slot('2026-10-06T08:00:00.000Z'), 'BOOKING_SLOT_TAKEN') // past
  assert.equal(slot('2026-10-12T09:30:00.000Z'), 'BOOKING_SLOT_TAKEN') // off grid
  assert.equal(slot('2026-10-12T02:00:00.000Z'), 'BOOKING_SLOT_TAKEN') // outside window
  assert.equal(slot('2026-10-17T09:00:00.000Z'), 'BOOKING_SLOT_TAKEN') // Saturday
  assert.equal(slot('2026-12-14T09:00:00.000Z'), 'BOOKING_SLOT_TAKEN') // beyond horizon
  assert.equal(slot('2026-10-06T12:30:00.000Z'), 'BOOKING_SLOT_TAKEN') // inside notice
  assert.equal(slot('garbage'), 'BOOKING_TIME_INVALID')
  assert.equal(code(() => book(w, GOOD, { serviceId: 'priv' })), 'BOOKING_SERVICE_NOT_FOUND')
  assert.equal(code(() => book(w, GOOD, { serviceId: 'off' })), 'BOOKING_SERVICE_NOT_FOUND')
  assert.equal(code(() => book(w, GOOD, { serviceId: 'missing' })), 'BOOKING_SERVICE_NOT_FOUND')
  assert.equal(
    code(() => book(world({ schedules: [{ ...w.schedules[0], active: false }] }), GOOD)),
    'BOOKING_SCHEDULE_UNAVAILABLE',
  )
  assert.equal(code(() => book(w, GOOD, { contact: { name: '', email: 'a@b.co' } })), 'BOOKING_CONTACT_INVALID')
  assert.equal(code(() => book(w, GOOD, { contact: { name: 'A', email: 'nope' } })), 'BOOKING_CONTACT_INVALID')
  assert.equal(code(() => book(w, GOOD, { contact: null })), 'BOOKING_INPUT_INVALID')
})

test('submit rejects overlapping and identical slots; cancelled booking releases the slot', () => {
  const taken = stored(book(world(), GOOD))
  const w = world({ bookings: [taken] })
  assert.equal(code(() => book(w, GOOD)), 'BOOKING_SLOT_TAKEN')
  // overlap from a longer booking on a finer grid
  const fine = world({
    schedules: [{ ...world().schedules[0], slot_interval_minutes: 30 }],
    services: [{ id: 'svc', duration_minutes: 30, schedule_id: 's1', visibility: 'public', active: true }],
    bookings: [{ ...taken, ends_at: '2026-10-12T10:00:00.000Z' }],
  })
  assert.equal(code(() => book(fine, '2026-10-12T09:30:00.000Z')), 'BOOKING_SLOT_TAKEN')
  assert.ok(book(fine, '2026-10-12T10:00:00.000Z'))
  // cancelled releases
  const released = world({ bookings: [{ ...taken, status: 'cancelled', reservation_key: 'released:x' }] })
  assert.ok(book(released, GOOD))
  // a booking on another schedule does not block
  assert.ok(book(world({ bookings: [{ ...taken, schedule_id: 'other' }] }), GOOD))
})

test('listServiceOpenings reflects busy bookings and service state', () => {
  const w = world()
  const all = listServiceOpenings({ ...w, serviceId: 'svc', fromDate: '2026-10-12', throughDate: '2026-10-12', now: NOW })
  assert.equal(all.openings.length, 8)
  const taken = stored(book(w, GOOD))
  const fewer = listServiceOpenings({ ...world({ bookings: [taken] }), serviceId: 'svc', fromDate: '2026-10-12', throughDate: '2026-10-12', now: NOW })
  assert.equal(fewer.openings.length, 7)
  assert.equal(
    code(() => listServiceOpenings({ ...w, serviceId: 'priv', fromDate: '2026-10-12', throughDate: '2026-10-12', now: NOW })),
    'BOOKING_SERVICE_NOT_FOUND',
  )
})

test('reservation key collision: same instant in any representation collides', () => {
  assert.equal(
    reservationKey('s1', '2026-10-12T10:00:00+01:00'),
    reservationKey('s1', '2026-10-12T09:00:00.000Z'),
  )
  assert.notEqual(reservationKey('s1', GOOD), reservationKey('s2', GOOD))
  assert.notEqual(reservationKey('s1', GOOD), reservationKey('s1', '2026-10-12T10:00:00.000Z'))
})
