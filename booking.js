const TABLES = { profiles: 'profiles', schedules: 'schedules', services: 'services', bookings: 'bookings' }

export const isLocalPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname)

function recordList(result) {
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.records)) return result.records
  if (Array.isArray(result?.data?.records)) return result.data.records
  return []
}

function savedRecord(result) { return result?.record || result?.data?.record || result?.data || result }
const localPreviewState = Object.create(null)
function localTable(name) { return Array.isArray(localPreviewState[name]) ? localPreviewState[name] : [] }
function setLocalTable(name, records) { localPreviewState[name] = records }
function runtimeData() {
  if (window.GoalmaticData) return window.GoalmaticData
  if (isLocalPreview) return null
  throw new Error('Launch Bookings from Goalmatic to access this workspace.')
}

async function list(table) {
  const data = runtimeData()
  return data ? recordList(await data.fetch(table, { limit: 200 })) : localTable(table)
}
async function create(table, value) {
  const data = runtimeData()
  if (data) return savedRecord(await data.submit(table, value, { idempotencyKey: crypto.randomUUID() }))
  const created = { id: crypto.randomUUID(), ...value }
  setLocalTable(table, [...localTable(table), created])
  return created
}
async function update(table, id, value) {
  const data = runtimeData()
  if (data) return savedRecord(await data.update(table, id, value, { idempotencyKey: crypto.randomUUID() }))
  const records = localTable(table).map(item => item.id === id ? { ...item, ...value } : item)
  setLocalTable(table, records)
  return records.find(item => item.id === id)
}
async function remove(table, id) {
  const data = runtimeData()
  if (data) return data.remove(table, id, { idempotencyKey: crypto.randomUUID() })
  setLocalTable(table, localTable(table).filter(item => item.id !== id))
}

export async function loadOwnerWorkspace() {
  const [profiles, schedules, services, bookings] = await Promise.all([
    list(TABLES.profiles), list(TABLES.schedules), list(TABLES.services), list(TABLES.bookings),
  ])
  return { profile: profiles[0] || null, schedules, services, bookings }
}
export async function saveProfile(existing, input) {
  const value = { 'display-name': input.displayName, bio: input.bio, 'photo-url': input.photoUrl || '', timezone: input.timezone, 'public-link-url': input.publicLinkUrl || '', 'public-link-expires-at': input.publicLinkExpiresAt || '', 'updated-at': new Date().toISOString() }
  return existing?.id ? update(TABLES.profiles, existing.id, value) : create(TABLES.profiles, value)
}
export async function saveSchedule(existing, input) {
  const value = { name: input.name, timezone: input.timezone, 'weekly-windows-json': JSON.stringify(input.weeklyWindows), 'slot-interval-minutes': input.slotIntervalMinutes, 'minimum-notice-minutes': input.minimumNoticeMinutes, 'booking-horizon-days': input.bookingHorizonDays, active: true, revision: String(Date.now()), 'updated-at': new Date().toISOString() }
  return existing?.id ? update(TABLES.schedules, existing.id, value) : create(TABLES.schedules, value)
}
export async function saveService(existing, input) {
  const value = { slug: input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name: input.name, description: input.description, 'duration-minutes': input.durationMinutes, 'schedule-id': input.scheduleId, price: input.price || 0, currency: input.currency || 'NGN', visibility: input.visibility, active: input.active, revision: String(Date.now()), 'updated-at': new Date().toISOString() }
  return existing?.id ? update(TABLES.services, existing.id, value) : create(TABLES.services, value)
}
export function deleteService(id) { return remove(TABLES.services, id) }
export function cancelBooking(booking, reason) {
  return update(TABLES.bookings, booking.id, { status: 'cancelled', 'reservation-key': `released:${booking.id}`, 'cancelled-at': new Date().toISOString(), 'cancellation-reason': reason || '' })
}
export async function createPublicLink(subject = { kind: 'profile' }) {
  if (!window.GoalmaticShares?.create) {
    if (!isLocalPreview) throw new Error('Public links are unavailable outside the installed App runtime.')
    const token = crypto.randomUUID().replaceAll('-', '').padEnd(43, '0').slice(0, 43)
    return { token, routePath: '/book', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }
  }
  return window.GoalmaticShares.create(subject, { definitionId: 'booking-link', expiresInDays: 365 })
}
export async function revokePublicLink(url) {
  const token = String(url || '').split('#')[1] || ''
  if (token && window.GoalmaticShares?.revoke) await window.GoalmaticShares.revoke(token)
}
export async function loadGuestPage() {
  if (isLocalPreview) {
    const profile = localTable(TABLES.profiles)[0] || {}
    return { profile: { displayName: profile['display-name'] || 'Local booking preview', bio: profile.bio || '', photoUrl: profile['photo-url'] || null, timezone: profile.timezone || 'UTC' }, services: localTable(TABLES.services).filter(item => item.active !== false && item.visibility === 'public').map(item => ({ id: item.id, name: item.name, description: item.description, durationMinutes: item['duration-minutes'], price: item.price || 0, currency: item.currency || 'NGN' })) }
  }
  await window.GoalmaticGuest.ready()
  return window.GoalmaticGuest.query('page-get', {})
}
export function loadGuestOpenings(serviceId, fromDate, throughDate) {
  if (!isLocalPreview) return window.GoalmaticGuest.query('openings-list', { serviceId, fromDate, throughDate })
  const service = localTable(TABLES.services).find(item => item.id === serviceId)
  const schedule = localTable(TABLES.schedules).find(item => item.id === service?.['schedule-id'])
  if (!service || !schedule) return Promise.resolve({ openings: [] })
  const windows = JSON.parse(schedule['weekly-windows-json'] || '[]'), interval = Number(schedule['slot-interval-minutes']), duration = Number(service['duration-minutes']), busy = localTable(TABLES.bookings).filter(item => item.status !== 'cancelled')
  const start = new Date(`${fromDate}T00:00:00`), end = new Date(`${throughDate}T00:00:00`), openings = []
  for (let date = new Date(start); date <= end && openings.length < 100; date.setDate(date.getDate() + 1)) {
    for (const window of windows.filter(item => item.weekday === date.getDay())) for (let minute = window.startMinute; minute + duration <= window.endMinute; minute += interval) {
      const begins = new Date(date); begins.setHours(Math.floor(minute / 60), minute % 60, 0, 0); const ends = new Date(begins.getTime() + duration * 60000)
      if (begins.getTime() < Date.now() + Number(schedule['minimum-notice-minutes'] || 0) * 60000) continue
      if (busy.some(item => Date.parse(item['starts-at']) < ends.getTime() && begins.getTime() < Date.parse(item['ends-at']))) continue
      openings.push({ startsAt: begins.toISOString(), endsAt: ends.toISOString(), timezone: schedule.timezone })
    }
  }
  return Promise.resolve({ openings })
}
export async function submitGuestBooking(input, idempotencyKey) {
  if (!isLocalPreview) return window.GoalmaticGuest.command('booking-create', input, { idempotencyKey })
  const service = localTable(TABLES.services).find(item => item.id === input.serviceId), scheduleId = service?.['schedule-id'], reservationKey = `${scheduleId}|${new Date(input.startsAt).toISOString()}`
  if (localTable(TABLES.bookings).some(item => item['reservation-key'] === reservationKey && item.status !== 'cancelled')) throw new Error('This time was booked by someone else.')
  const endsAt = new Date(Date.parse(input.startsAt) + Number(service['duration-minutes']) * 60000).toISOString(), reference = `LOCAL-${idempotencyKey.slice(0, 8).toUpperCase()}`
  const booking = await create(TABLES.bookings, { reference, 'service-id': service.id, 'service-name': service.name, 'schedule-id': scheduleId, 'starts-at': input.startsAt, 'ends-at': endsAt, timezone: localTable(TABLES.schedules)[0]?.timezone || 'UTC', 'guest-name': input.contact.name, 'guest-email': input.contact.email, 'guest-phone': input.contact.phone, notes: input.notes || '', status: 'confirmed', 'reservation-key': reservationKey, 'created-at': new Date().toISOString() })
  return { bookingId: booking.id, reference, serviceName: service.name, startsAt: input.startsAt, endsAt, timezone: booking.timezone, status: 'confirmed', delivery: 'on-screen-only' }
}
