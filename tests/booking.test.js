import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.window = { location: { hostname: 'localhost', origin: 'http://localhost', hash: '' } }
const booking = await import('../booking.js')

const code = async (fn) => {
  try {
    await fn()
  } catch (error) {
    return error.code
  }
  return null
}

test('slugs are unique, ASCII, and fall back for non-Latin names', () => {
  const { uniqueServiceSlug, slugBase } = booking
  assert.equal(slugBase('Café Chat!'), 'cafe-chat')
  assert.equal(slugBase('相談'), 'service')
  const existing = [{ id: 'a', slug: 'intro' }, { id: 'b', slug: 'intro-2' }]
  assert.equal(uniqueServiceSlug('Intro', null, existing), 'intro-3')
  assert.equal(uniqueServiceSlug('Intro', existing[0], existing), 'intro')
  assert.equal(uniqueServiceSlug('Intro', null), 'intro')
})

test('local preview: openings and submit use the shared engine', async () => {
  const { openings } = await booking.loadGuestOpenings(
    'preview-service-1',
    new Date().toISOString().slice(0, 10),
    new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10),
  )
  assert.ok(openings.length > 0)
  assert.ok(openings.every((item) => item.localTime && item.timezone === 'Africa/Lagos'))
  const contact = { name: 'Test', email: 'test@example.com', phone: '' }
  const first = openings[0]
  const done = await booking.submitGuestBooking(
    { serviceId: 'preview-service-1', startsAt: first.startsAt, contact },
    'abcdef12-0000',
  )
  assert.equal(done.timezone, 'Africa/Lagos')
  assert.equal(done.reference, 'LOCAL-ABCDEF12')
  assert.equal(
    await code(() => booking.submitGuestBooking({ serviceId: 'preview-service-1', startsAt: first.startsAt, contact }, 'k')),
    'BOOKING_SLOT_TAKEN',
  )
  assert.equal(
    await code(() => booking.submitGuestBooking({ serviceId: 'nope', startsAt: first.startsAt, contact }, 'k')),
    'BOOKING_SERVICE_NOT_FOUND',
  )
  assert.equal(
    await code(() => booking.submitGuestBooking({ serviceId: 'preview-service-1', startsAt: '2020-01-01T09:00:00Z', contact }, 'k')),
    'BOOKING_SLOT_TAKEN',
  )
})

test('saveSchedule rejects NaN and overlapping windows before writing', async () => {
  const base = { name: 'x', timezone: 'Africa/Lagos', weeklyWindows: [], slotIntervalMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 30 }
  assert.equal(await code(() => booking.saveSchedule(null, { ...base, slotIntervalMinutes: NaN })), 'BOOKING_SCHEDULE_INVALID')
  assert.equal(await code(() => booking.saveSchedule(null, { ...base, minimumNoticeMinutes: NaN })), 'BOOKING_SCHEDULE_INVALID')
  assert.equal(
    await code(() => booking.saveSchedule(null, { ...base, weeklyWindows: [{ weekday: 1, startMinute: 0, endMinute: 100 }, { weekday: 1, startMinute: 50, endMinute: 200 }] })),
    'BOOKING_SCHEDULE_INVALID',
  )
  assert.equal(await code(() => booking.saveSchedule(null, base)), null)
})

test('revokePublicLink throws in the hosted runtime without revoke support or token', async () => {
  const saved = globalThis.window
  globalThis.window = { location: { hostname: 'example.com', origin: 'https://example.com', hash: '' } }
  try {
    assert.equal(await code(() => booking.revokePublicLink('https://x/book#abc')), 'BOOKING_REVOKE_UNAVAILABLE')
    let revoked = null
    globalThis.window.GoalmaticShares = { revoke: async (token) => { revoked = token } }
    assert.equal(await code(() => booking.revokePublicLink('https://x/book')), 'BOOKING_LINK_INVALID')
    await booking.revokePublicLink('https://x/book#abc')
    assert.equal(revoked, 'abc')
  } finally {
    globalThis.window = saved
  }
})

test('calendar: event input, conflict detection and local-preview gating', async () => {
  const mine = {
    id: 'b1', reference: 'R1', service_name: 'Intro', guest_name: 'Ada', guest_email: 'a@x.co', notes: 'Hi',
    starts_at: '2030-01-07T10:00:00.000Z', ends_at: '2030-01-07T10:30:00.000Z', timezone: 'Africa/Lagos',
    calendar_event_id: 'evt-own',
  }
  const input = booking.calendarEventInput(mine)
  assert.equal(input.summary, 'Intro with Ada')
  assert.equal(input.timeZone, 'Africa/Lagos')
  assert.equal(input.start, '2030-01-07T10:00:00.000Z')
  assert.ok(input.description.includes('R1') && input.description.includes('a@x.co'))
  assert.ok(!('attendees' in input))
  const other = { ...mine, id: 'b2', calendar_event_id: '', starts_at: '2030-01-07T11:00:00.000Z', ends_at: '2030-01-07T11:30:00.000Z' }
  const events = [
    { id: 'evt-own', summary: 'Intro with Ada', start: mine.starts_at, end: mine.ends_at },
    { id: 'x1', summary: 'Dentist', start: '2030-01-07T11:15:00.000Z', end: '2030-01-07T12:00:00.000Z' },
    { id: 'x2', summary: 'Holiday', allDay: true, start: '2030-01-07', end: '2030-01-08' },
    { id: 'x3', summary: 'Adjacent', start: '2030-01-07T10:30:00.000Z', end: '2030-01-07T11:00:00.000Z' },
  ]
  const conflicts = booking.findCalendarConflicts([mine, other], events)
  assert.deepEqual([...conflicts], [['b2', ['Dentist']]])
  assert.equal(booking.calendarMode(), 'preview')
  assert.equal((await booking.getCalendarStatus()).state, 'preview')
  await assert.rejects(() => booking.addBookingToCalendar({ ...mine, calendar_event_id: '' }), /not available in local preview/)
  assert.equal((await booking.addBookingToCalendar(mine)).alreadyOnCalendar, true)
  assert.equal(await booking.loadGuestCalendarBusy(0, 1), null)
  assert.equal(booking.openingOverlapsBusy({ startsAt: mine.starts_at, endsAt: mine.ends_at }, [{ start: Date.parse(mine.starts_at) + 1, end: Date.parse(mine.ends_at) + 1 }]), true)
})

const ownerState = async () => {
  const workspace = await booking.loadOwnerWorkspace()
  return workspace
}

test('owner booking: phone-only walk-in, overlap rejection, and weekly repeats', async () => {
  const state = await ownerState()
  const start = new Date(Date.now() + 40 * 86_400_000)
  start.setUTCHours(6, 0, 0, 0)
  const contact = { name: 'Walk In', phone: '0803 000 1111' }
  const first = await booking.createOwnerBooking(state, { serviceId: 'preview-service-1', startsAt: start.toISOString(), contact })
  assert.equal(first.created.length, 1)
  assert.equal(first.created[0].guest_email, 'phone-2348030001111@bookins.invalid')
  assert.equal(first.created[0].source, 'owner')
  const refreshed = await ownerState()
  const clash = await code(() =>
    booking.createOwnerBooking(refreshed, { serviceId: 'preview-service-2', startsAt: new Date(start.getTime() + 15 * 60_000).toISOString(), contact }),
  )
  assert.equal(clash, 'BOOKING_SLOT_TAKEN')
  const series = await booking.createOwnerBooking(refreshed, {
    serviceId: 'preview-service-1',
    startsAt: new Date(start.getTime() - 7 * 86_400_000).toISOString(),
    contact,
    repeatWeeks: 2,
  })
  // Week 1 of the series lands on the existing booking and is skipped, not fatal.
  assert.equal(series.created.length, 2)
  assert.equal(series.skipped.length, 1)
  assert.ok(series.created.every((item) => item.series_id && item.series_id === series.created[0].series_id))
})

test('owner booking requires a name and an email or phone', async () => {
  const state = await ownerState()
  const startsAt = new Date(Date.now() + 50 * 86_400_000).toISOString()
  assert.equal(await code(() => booking.createOwnerBooking(state, { serviceId: 'preview-service-1', startsAt, contact: { name: 'X' } })), 'BOOKING_CONTACT_INVALID')
  assert.equal(await code(() => booking.createOwnerBooking(state, { serviceId: 'preview-service-1', startsAt, contact: { phone: '0803' } })), 'BOOKING_CONTACT_INVALID')
})

test('reschedule ignores itself and rejects overlaps; status and notes update', async () => {
  const state = await ownerState()
  const target = state.bookings.find((item) => item.id === 'preview-booking-1')
  const later = new Date(Date.parse(target.starts_at) + 15 * 60_000).toISOString()
  const moved = await booking.rescheduleBooking(state, target, later)
  assert.equal(moved.starts_at, later)
  assert.equal(moved.reservation_key, `${target.schedule_id}|${later}`)
  const next = await ownerState()
  const other = next.bookings.find((item) => item.id === 'preview-booking-2')
  assert.equal(await code(() => booking.rescheduleBooking(next, other, later)), 'BOOKING_SLOT_TAKEN')
  assert.equal((await booking.setBookingStatus(moved, 'completed')).status, 'completed')
  assert.equal(await code(() => booking.setBookingStatus(moved, 'cancelled')), 'BOOKING_STATUS_INVALID')
  assert.equal((await booking.saveBookingNotes(moved, 'Paid cash')).owner_notes, 'Paid cash')
})

test('time off blocks guest openings, reports overlaps, and releases on removal', async () => {
  const state = await ownerState()
  const { openings } = await booking.loadGuestOpenings(
    'preview-service-1',
    new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
    new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
  )
  const slot = openings[0]
  const { record, overlapping } = await booking.createTimeOff(state, {
    startsAt: slot.startsAt,
    endsAt: new Date(Date.parse(slot.startsAt) + 3 * 3_600_000).toISOString(),
    reason: 'Clinic',
  })
  assert.equal(record.status, 'blocked')
  assert.ok(booking.isTimeOff(record))
  assert.ok(!booking.isActiveBooking(record))
  assert.deepEqual(overlapping, [])
  const after = await booking.loadGuestOpenings('preview-service-1', slot.localDate, slot.localDate)
  assert.ok(!after.openings.some((item) => item.startsAt === slot.startsAt))
  await booking.removeTimeOff(record)
  const restored = await booking.loadGuestOpenings('preview-service-1', slot.localDate, slot.localDate)
  assert.ok(restored.openings.some((item) => item.startsAt === slot.startsAt))
  assert.equal(await code(() => booking.createTimeOff(state, { startsAt: slot.startsAt, endsAt: slot.startsAt })), 'BOOKING_TIME_INVALID')
})

test('workspace includes contacts; saveContact keys by email and dedupes tags', async () => {
  const state = await ownerState()
  assert.ok(Array.isArray(state.contacts) && state.contacts.length >= 1)
  const saved = await booking.saveContact(null, { email: 'New@Example.com', name: 'New', tags: ['VIP', 'VIP', ' '] })
  assert.equal(saved.email, 'new@example.com')
  assert.deepEqual(booking.contactTags(saved), ['VIP'])
})

test('removed time off stays excluded from clients and metrics but no longer blocks', async () => {
  const state = await ownerState()
  const startsAt = new Date(Date.now() + 70 * 86_400_000).toISOString()
  const { record } = await booking.createTimeOff(state, {
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(),
    reason: 'Dentist',
  })
  const removed = await booking.removeTimeOff(record)
  assert.equal(removed.status, 'cancelled')
  assert.ok(booking.isTimeOff(removed))
  assert.ok(!booking.isActiveTimeOff(removed))
  assert.ok(!booking.isActiveBooking(removed))
})
