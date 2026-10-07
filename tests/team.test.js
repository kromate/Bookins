import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoPlatform } from '../demo/adapter.js'
import { STAFF_COPY_MAX, STAFF_COPY_WARN, hasTeam, isStaffCopy, ownerStaff, scheduleForStaff, servicesForStaff, staffForBooking, staffServiceCopyEstimate, teamMembers } from '../team.js'
import { splitDescription, withMeta } from '../service-meta.js'

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
const workspace = () => booking.loadOwnerWorkspace()
const member = (state, key) => state.staff.find((item) => item.id === `preview-staff-${key}`)
const contact = { name: 'Team Tester', email: 'team@example.com', phone: '' }

test('workspace carries staff and campaigns; the owner is implicit and owns the unclaimed schedule', async () => {
  const state = await workspace()
  assert.equal(state.staff.length, 2)
  assert.equal(state.campaigns.length, 1)
  assert.ok(hasTeam(state))
  const owner = ownerStaff(state)
  assert.equal(owner.implicit, true)
  assert.equal(scheduleForStaff(state, owner).id, 'preview-schedule')
  assert.equal(scheduleForStaff(state, member(state, 'amaka')).id, 'preview-schedule-amaka')
  assert.deepEqual(teamMembers(state).map((item) => item.name), ['You', 'Amaka Eze', 'Tolu Adebayo'])
  assert.deepEqual(servicesForStaff(state, member(state, 'tolu')).map((item) => item.id), ['preview-service-2'])
  assert.ok(state.contacts.some((item) => item.marketing_opt_out === true))
  const copy = state.services.find((item) => item.id === 'preview-service-2-amaka')
  assert.ok(isStaffCopy(copy))
  assert.deepEqual(splitDescription(copy.description).meta, { c: 'Consultations', o: 2, s: 'preview-staff-amaka', n: 'Amaka Eze', b: 'preview-service-2', p: 'Share your goals and any current designs before the session.' })
  const sampleStaffBooking = state.bookings.find((item) => item.staff_id === 'preview-staff-amaka')
  assert.equal(staffForBooking(state, sampleStaffBooking).name, 'Amaka Eze')
  // Guest bookings carry no staff_id: the member is found from the schedule.
  assert.equal(staffForBooking(state, { schedule_id: 'preview-schedule-tolu' }).name, 'Tolu Adebayo')
  assert.equal(staffForBooking(state, { schedule_id: 'preview-schedule' }).implicit, true)
  assert.equal(staffForBooking(state, { staff_id: 'gone', staff_name: 'Old' }).removed, true)
})

test('single-owner installs are unchanged: no team, no staff fields written, same schedule', async () => {
  const state = await workspace()
  const solo = { ...state, staff: [], schedules: [state.schedules[0]] }
  assert.equal(hasTeam(solo), false)
  assert.equal(scheduleForStaff(solo, ownerStaff(solo)).id, 'preview-schedule')
  assert.equal(staffForBooking(solo, state.bookings[0]).implicit, true)
  const start = new Date(Date.now() + 120 * 86_400_000)
  start.setUTCHours(11, 0, 0, 0)
  const { created } = await booking.createOwnerBooking(solo, { serviceId: 'preview-service-1', startsAt: start.toISOString(), contact })
  assert.ok(!('staff_id' in created[0]) && !('staff_name' in created[0]))
  assert.equal(created[0].schedule_id, 'preview-schedule')
})

test('two members hold the same slot in parallel; a guest cannot double-book one member', async () => {
  const state = await workspace()
  const { openings } = await booking.loadGuestOpenings('preview-service-2-amaka', new Date().toISOString().slice(0, 10), new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10))
  const slot = openings.find((item) => item.localTime === '11:00')
  assert.ok(slot, 'Amaka has an 11:00 opening')
  const mine = await booking.createOwnerBooking(state, { serviceId: 'preview-service-2', startsAt: slot.startsAt, contact })
  assert.equal(mine.created[0].staff_id, 'owner')
  assert.equal(mine.created[0].schedule_id, 'preview-schedule')
  const fresh = await workspace()
  const hers = await booking.createOwnerBooking(fresh, { serviceId: 'preview-service-2', startsAt: slot.startsAt, contact: { ...contact, name: 'Second' }, staffId: 'preview-staff-amaka' })
  assert.equal(hers.created[0].schedule_id, 'preview-schedule-amaka')
  assert.equal(hers.created[0].staff_name, 'Amaka Eze')
  // Amaka is now busy at that time; her service copy no longer offers it, Tolu's still does.
  const amaka = await booking.loadGuestOpenings('preview-service-2-amaka', slot.localDate, slot.localDate)
  assert.ok(!amaka.openings.some((item) => item.startsAt === slot.startsAt))
  const tolu = await booking.loadGuestOpenings('preview-service-2-tolu', slot.localDate, slot.localDate)
  assert.ok(tolu.openings.some((item) => item.startsAt === slot.startsAt))
  assert.equal(
    await code(() => booking.submitGuestBooking({ serviceId: 'preview-service-2-amaka', startsAt: slot.startsAt, contact: { name: 'G', email: 'g@example.com' } }, 'k1')),
    'BOOKING_SLOT_TAKEN',
  )
  const viaCopy = await booking.createOwnerBooking(await workspace(), { serviceId: 'preview-service-2-tolu', startsAt: slot.startsAt, contact: { ...contact, name: 'Third' } })
  assert.equal(viaCopy.created[0].staff_id, 'preview-staff-tolu')
})

test('assignBookingStaff moves a confirmed booking, refuses overlaps and time off, relabels finished ones', async () => {
  const start = new Date(Date.now() + 90 * 86_400_000)
  start.setUTCHours(13, 0, 0, 0)
  const at = start.toISOString()
  let state = await workspace()
  const owned = (await booking.createOwnerBooking(state, { serviceId: 'preview-service-2', startsAt: at, contact })).created[0]
  state = await workspace()
  await booking.createOwnerBooking(state, { serviceId: 'preview-service-2', startsAt: new Date(start.getTime() + 15 * 60_000).toISOString(), contact: { ...contact, name: 'Tolu client' }, staffId: 'preview-staff-tolu' })
  state = await workspace()
  assert.equal(await code(() => booking.assignBookingStaff(state, owned, 'preview-staff-tolu')), 'BOOKING_SLOT_TAKEN')
  const { record } = await booking.createTimeOff(state, { startsAt: at, endsAt: new Date(start.getTime() + 3_600_000).toISOString(), reason: 'Amaka away', staffId: 'preview-staff-amaka' })
  assert.equal(record.schedule_id, 'preview-schedule-amaka')
  state = await workspace()
  await assert.rejects(() => booking.assignBookingStaff(state, owned, 'preview-staff-amaka'), /time off/)
  assert.equal(state.bookings.find((item) => item.id === owned.id).schedule_id, 'preview-schedule')
  // Removing the time off frees Amaka: the move now succeeds and changes schedule, key and label.
  await booking.removeTimeOff(record)
  state = await workspace()
  const moved = await booking.assignBookingStaff(state, owned, 'preview-staff-amaka')
  assert.equal(moved.schedule_id, 'preview-schedule-amaka')
  assert.equal(moved.staff_name, 'Amaka Eze')
  assert.equal(moved.reservation_key, `preview-schedule-amaka|${at}`)
  assert.equal(moved.service_name, owned.service_name)
  // Back to the owner.
  state = await workspace()
  const back = await booking.assignBookingStaff(state, moved, booking.OWNER_STAFF_ID)
  assert.equal(back.schedule_id, 'preview-schedule')
  assert.equal(back.staff_id, 'owner')
  // Completed bookings only change the reporting label, with no time check.
  state = await workspace()
  const done = state.bookings.find((item) => item.status === 'completed' && !item.staff_id)
  const relabelled = await booking.assignBookingStaff(state, done, 'preview-staff-tolu')
  assert.equal(relabelled.staff_id, 'preview-staff-tolu')
  assert.equal(relabelled.schedule_id, done.schedule_id)
  assert.equal(relabelled.reservation_key, done.reservation_key)
  assert.equal(await code(() => booking.assignBookingStaff(state, state.bookings.find((item) => item.status === 'blocked'), 'preview-staff-tolu')), 'BOOKING_NOT_ACTIVE')
  assert.equal(await code(() => booking.assignBookingStaff(state, done, 'nobody')), 'BOOKING_STAFF_NOT_FOUND')
})

test('bulkAssignStaff reports moved and refused rows, each seeing earlier moves', async () => {
  const start = new Date(Date.now() + 100 * 86_400_000)
  start.setUTCHours(9, 0, 0, 0)
  const later = new Date(start.getTime() + 3 * 3_600_000)
  let state = await workspace()
  const clash = (await booking.createOwnerBooking(state, { serviceId: 'preview-service-2', startsAt: start.toISOString(), contact })).created[0]
  state = await workspace()
  const free = (await booking.createOwnerBooking(state, { serviceId: 'preview-service-1', startsAt: later.toISOString(), contact: { ...contact, name: 'Free' } })).created[0]
  state = await workspace()
  await booking.createOwnerBooking(state, { serviceId: 'preview-service-2', startsAt: start.toISOString(), contact: { ...contact, name: 'Tolu has this' }, staffId: 'preview-staff-tolu' })
  state = await workspace()
  const timeOff = state.bookings.find((item) => item.status === 'blocked')
  const { moved, refused } = await booking.bulkAssignStaff(state, [clash, free, timeOff], 'preview-staff-tolu')
  assert.deepEqual(moved.map((item) => item.id), [free.id])
  assert.deepEqual(refused.map((item) => item.booking.id), [clash.id, timeOff.id])
  assert.match(refused[0].reason, /not free then/)
  assert.match(refused[1].reason, /Time off/)
})

test('deactivating a member hides their service copies from guests but keeps bookings; reactivating restores', async () => {
  const state = await workspace()
  const amaka = member(state, 'amaka')
  const result = await booking.deactivateStaff(amaka, state)
  assert.equal(result.staff.active, false)
  assert.equal(result.hidden, 1)
  const after = await workspace()
  assert.equal(after.services.find((item) => item.id === 'preview-service-2-amaka').active, false)
  assert.ok(after.bookings.some((item) => item.staff_id === 'preview-staff-amaka'))
  assert.equal(teamMembers(after).some((item) => item.id === amaka.id), false)
  assert.equal(teamMembers(after, { includeInactive: true }).some((item) => item.id === amaka.id), true)
  assert.equal(await code(() => booking.assignBookingStaff(after, after.bookings.find((item) => item.status === 'completed'), amaka.id)), 'BOOKING_STAFF_INACTIVE')
  assert.equal(await code(() => booking.deactivateStaff(ownerStaff(after))), 'BOOKING_STAFF_INVALID')
  const restored = await booking.reactivateStaff(amaka, after)
  assert.equal(restored.restored, 1)
  assert.equal((await workspace()).services.find((item) => item.id === 'preview-service-2-amaka').active, true)
})

test('saveStaff validates; saveSchedule creates and links a schedule for a member; createStaffServices is idempotent with caps', async () => {
  assert.equal(await code(() => booking.saveStaff(null, { name: ' ' })), 'BOOKING_STAFF_INVALID')
  assert.equal(await code(() => booking.saveStaff(null, { name: 'X', email: 'nope' })), 'BOOKING_STAFF_INVALID')
  assert.equal(await code(() => booking.saveStaff(null, { name: 'X', color: 'red' })), 'BOOKING_STAFF_INVALID')
  const chika = await booking.saveStaff(null, { name: 'Chika Obi', role: 'Nail tech', color: '#0e7490', email: 'Chika@Example.com', serviceIds: ['preview-service-2', 'preview-service-2'] })
  assert.equal(chika.email, 'chika@example.com')
  assert.equal(chika.active, true)
  assert.equal(chika.service_ids_json, JSON.stringify(['preview-service-2']))
  let state = await workspace()
  assert.equal(scheduleForStaff(state, chika), null)
  // No schedule yet: no copies, honest reason.
  const none = await booking.createStaffServices(state, state.services.find((item) => item.id === 'preview-service-2'), [chika.id])
  assert.equal(none.created.length, 0)
  assert.match(none.skipped[0].reason, /working hours/)
  const hours = { name: 'Chika hours', timezone: 'Africa/Lagos', weeklyWindows: [{ weekday: 2, startMinute: 600, endMinute: 900 }], slotIntervalMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 30 }
  const schedule = await booking.saveSchedule(null, hours, chika)
  state = await workspace()
  assert.equal(state.staff.find((item) => item.id === chika.id).schedule_id, schedule.id)
  assert.equal(scheduleForStaff(state, state.staff.find((item) => item.id === chika.id)).id, schedule.id)
  assert.equal(scheduleForStaff(state, ownerStaff(state)).id, 'preview-schedule', 'a member schedule never becomes the owner schedule')
  const base = state.services.find((item) => item.id === 'preview-service-2')
  const first = await booking.createStaffServices(state, base, [chika.id])
  assert.equal(first.created.length, 1)
  assert.equal(first.created[0].schedule_id, schedule.id)
  assert.deepEqual(splitDescription(first.created[0].description).meta.s, chika.id)
  assert.equal(first.created[0].slug, 'product-consultation-chika-obi')
  state = await workspace()
  const second = await booking.createStaffServices(state, base, [chika.id])
  assert.deepEqual([second.created.length, second.updated.length], [0, 1])
  assert.equal((await workspace()).services.length, state.services.length)
  // Copies of a service the member does not offer, copies of copies, and the owner are refused.
  assert.match((await booking.createStaffServices(state, state.services.find((item) => item.id === 'preview-service-1'), [chika.id])).skipped[0].reason, /does not offer/)
  assert.equal(await code(() => booking.createStaffServices(state, state.services.find((item) => item.id === 'preview-service-2-amaka'), [chika.id])), 'BOOKING_SERVICE_INVALID')
  assert.match((await booking.createStaffServices(state, base, ['owner'])).skipped[0].reason, /other than yourself/)
  // A service longer than the member's booking interval is skipped with the fix named.
  const long = await booking.saveService(null, { name: 'Long', description: 'x', durationMinutes: 120, scheduleId: 'preview-schedule', price: 0, visibility: 'public', active: true })
  const longResult = await booking.createStaffServices(await workspace(), long, [chika.id].concat([]))
  assert.match(longResult.skipped[0].reason, /does not offer|interval/)
})

test('staff copy caps: warn above 40 needs confirmation, refuse above the hard max', async () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `copy-${i}`, description: withMeta('x', { s: `m${i % 3}`, b: `base${i}` }) }))
  const staff = [{ id: 'm0', name: 'A', schedule_id: 'sa', active: true }, { id: 'm1', name: 'B', schedule_id: 'sb', active: true }]
  const base = { id: 'svc', name: 'Svc', slug: 'svc', duration_minutes: 30, schedule_id: 'o', visibility: 'public', active: true, description: 'x' }
  const schedules = [{ id: 'o', slot_interval_minutes: 60 }, { id: 'sa', slot_interval_minutes: 60 }, { id: 'sb', slot_interval_minutes: 60 }]
  const state = (n) => ({ staff, schedules, services: [base, ...mk(n)], bookings: [], profile: null })
  const estimate = staffServiceCopyEstimate(state(39), { serviceIds: ['svc'], staffIds: ['m0', 'm1'] })
  assert.deepEqual([estimate.existing, estimate.adding, estimate.total, estimate.overCap, estimate.overMax], [39, 2, 41, true, false])
  assert.equal(STAFF_COPY_WARN, 40)
  assert.equal(await code(() => booking.createStaffServices(state(39), base, ['m0', 'm1'])), 'BOOKING_STAFF_COPY_CAP')
  assert.equal(await code(() => booking.createStaffServices(state(STAFF_COPY_MAX), base, ['m0'], { confirmOverCap: true })), 'BOOKING_STAFF_COPY_CAP')
  assert.equal(staffServiceCopyEstimate(state(10), { serviceIds: ['svc'], staffIds: ['m0'] }).overCap, false)
})

test('message opened marks, reschedule clears them; campaign, opt-out and offer writes', async () => {
  const state = await workspace()
  const target = state.bookings.find((item) => item.id === 'preview-booking-2')
  const opened = await booking.markMessageOpened(target, 'reminder')
  assert.match(opened.reminder24_opened_at, /^\d{4}-/)
  assert.equal((await booking.markMessageOpened(target, 'thanks')).followup_opened_at.length > 0, true)
  assert.equal(await code(() => booking.markMessageOpened(target, 'confirmation')), 'BOOKING_MESSAGE_INVALID')
  assert.equal((await booking.markMessageOpened(target, 'reminder24', false)).reminder24_opened_at, '')
  await booking.markMessageOpened(target, 'reminder2')
  const refreshed = await workspace()
  const moved = await booking.rescheduleBooking(refreshed, refreshed.bookings.find((item) => item.id === target.id), new Date(Date.parse(target.starts_at) + 30 * 60_000).toISOString())
  assert.equal(moved.reminder2_opened_at, '')

  assert.equal(await code(() => booking.saveCampaign(null, { name: ' ' })), 'BOOKING_CAMPAIGN_INVALID')
  assert.equal(await code(() => booking.saveCampaign(null, { name: 'X', status: 'sent' })), 'BOOKING_CAMPAIGN_INVALID')
  const saved = await booking.saveCampaign(null, { name: 'Spring', segment: { serviceContains: 'braids', visitsAtLeast: '2', junk: 1 }, template: { body: 'Hi {{first_name}}', channel: 'email' }, offerText: '10% off', offerCode: 'hair 10!', audienceCount: 12.6 })
  assert.equal(saved.offer_code, 'HAIR10')
  assert.equal(saved.status, 'draft')
  assert.equal(saved.audience_count, 13)
  assert.deepEqual(JSON.parse(saved.segment_json), { serviceContains: 'braids', visitsAtLeast: 2 })
  assert.equal(JSON.parse(saved.template_json).channel, 'email')
  const edited = await booking.saveCampaign(saved, { status: 'active' })
  assert.equal(edited.status, 'active')
  assert.equal(edited.name, 'Spring')
  assert.equal((await booking.touchCampaign(saved)).last_opened_at.length > 0, true)
  const withCampaigns = await workspace()
  assert.ok(withCampaigns.campaigns.some((item) => item.id === saved.id))
  await booking.deleteCampaign(saved)
  assert.ok(!(await workspace()).campaigns.some((item) => item.id === saved.id))

  // Opt-out creates the record when the client only exists through bookings, and keeps notes/tags when it exists.
  const adaView = { email: 'kwame@example.com', name: 'Kwame Mensah', phone: '', record: null }
  const out = await booking.setMarketingOptOut(adaView, true)
  assert.equal(out.marketing_opt_out, true)
  assert.match(out.marketing_opt_out_at, /^\d{4}-/)
  const back = await booking.setMarketingOptOut({ ...adaView, record: out }, false)
  assert.equal(back.marketing_opt_out, false)
  assert.equal(back.marketing_opt_out_at, '')
  assert.equal(back.id, out.id)
  const offered = await booking.recordOffer({ ...adaView, record: back }, { code: 'hair10' })
  assert.deepEqual(JSON.parse(offered.offers_json).map((item) => [item.code, item.status]), [['HAIR10', 'offered']])
  const redeemed = await booking.recordOffer({ ...adaView, record: offered }, { code: 'HAIR10', status: 'redeemed' })
  assert.deepEqual(JSON.parse(redeemed.offers_json).map((item) => [item.code, item.status]), [['HAIR10', 'redeemed']])
  assert.equal(await code(() => booking.recordOffer(adaView, { code: '' })), 'BOOKING_OFFER_INVALID')
  const opened2 = await booking.markCampaignRecipientOpened({ ...adaView, record: redeemed }, { offer_code: 'WELCOME10' })
  assert.match(opened2.last_campaign_at, /^\d{4}-/)
  assert.deepEqual(JSON.parse(opened2.offers_json).map((item) => item.code), ['HAIR10', 'WELCOME10'])
})

test('Demo twins carry staff, campaigns and an opted-out contact; every new action is read-only', async () => {
  const demo = createDemoPlatform(new Date('2026-10-07T09:00:00Z'))
  const state = await demo.owner.loadOwnerWorkspace()
  assert.equal(state.staff.length, 2)
  assert.equal(state.campaigns.length, 1)
  assert.ok(state.services.some((item) => splitDescription(item.description).meta.c))
  assert.ok(state.contacts.some((item) => item.marketing_opt_out))
  assert.ok(state.bookings.some((item) => item.staff_id))
  const names = ['saveStaff', 'deactivateStaff', 'reactivateStaff', 'createStaffServices', 'deleteStaffServiceCopies', 'assignBookingStaff', 'bulkAssignStaff', 'markMessageOpened', 'saveCampaign', 'deleteCampaign', 'touchCampaign', 'setMarketingOptOut', 'recordOffer', 'markCampaignRecipientOpened']
  for (const name of names) assert.equal(await code(() => demo.owner[name]()), 'DEMO_READ_ONLY', name)
})

test('owner never borrows a member schedule when all schedules are claimed', async () => {
  const { scheduleForStaff } = await import('../team.js')
  const state = {
    schedules: [{ id: 'sch-a' }],
    staff: [{ id: 'm1', name: 'Amaka', schedule_id: 'sch-a', active: true }],
  }
  assert.equal(scheduleForStaff(state, { id: 'owner', is_owner: true, implicit: true }), null)
  assert.equal(scheduleForStaff({ schedules: [{ id: 's1' }], staff: [] }, { id: 'owner', is_owner: true, implicit: true })?.id, 's1')
})
