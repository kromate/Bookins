const TABLES = { profiles: 'profiles', schedules: 'schedules', services: 'services', bookings: 'bookings' }
const LOCAL_STORAGE_KEY = 'bookins.local-preview.v5'
const localPreviewState = Object.create(null)

export function isLocalPreview() {
  return ['localhost', '127.0.0.1'].includes(window.location.hostname) && !window.GoalmaticApp
}

function recordList(result) {
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.records)) return result.records
  if (Array.isArray(result?.data?.records)) return result.data.records
  return []
}

function savedRecord(result) {
  return result?.record || result?.data?.record || result?.data || result
}

function nextWorkingDay(offset = 1) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1)
  date.setHours(10, 0, 0, 0)
  return date
}

function createLocalPreviewState() {
  const upcoming = nextWorkingDay(2)
  const later = nextWorkingDay(5)
  const iso = date => date.toISOString()
  const ending = (date, minutes) => new Date(date.getTime() + minutes * 60_000).toISOString()
  const weeklyWindows = [1, 2, 3, 4, 5].map(weekday => ({ weekday, startMinute: 9 * 60, endMinute: 17 * 60 }))
  return {
    profiles: [{
      id: 'preview-profile',
      display_name: "Amina's Studio",
      bio: 'Book a focused session for business strategy, creative direction, and practical next steps.',
      photo_url: '',
      timezone: 'Africa/Lagos',
      public_link_url: `${window.location.origin}/book#local-preview`,
      public_link_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      updated_at: new Date().toISOString(),
    }],
    schedules: [{
      id: 'preview-schedule',
      name: 'Working hours',
      timezone: 'Africa/Lagos',
      weekly_windows_json: JSON.stringify(weeklyWindows),
      slot_interval_minutes: 60,
      minimum_notice_minutes: 60,
      booking_horizon_days: 60,
      active: true,
      revision: 'preview-1',
      updated_at: new Date().toISOString(),
    }],
    services: [
      { id: 'preview-service-1', slug: 'discovery-call', name: 'Discovery call', description: 'A focused conversation to understand what you need and map the right next step.', duration_minutes: 30, schedule_id: 'preview-schedule', price: 0, currency: 'NGN', visibility: 'public', active: true, revision: 'preview-1' },
      { id: 'preview-service-2', slug: 'product-consultation', name: 'Product consultation', description: 'A practical working session for product direction, UX, and execution planning.', duration_minutes: 60, schedule_id: 'preview-schedule', price: 25000, currency: 'NGN', visibility: 'public', active: true, revision: 'preview-1' },
    ],
    bookings: [
      { id: 'preview-booking-1', reference: 'BK-DEMO2401', service_id: 'preview-service-1', service_name: 'Discovery call', schedule_id: 'preview-schedule', starts_at: iso(upcoming), ends_at: ending(upcoming, 30), timezone: 'Africa/Lagos', guest_name: 'Ada Okafor', guest_email: 'ada@example.com', guest_phone: '+234 803 555 0182', notes: 'I would like to discuss a new client portal.', status: 'confirmed', reservation_key: `preview-schedule|${iso(upcoming)}`, created_at: new Date().toISOString() },
      { id: 'preview-booking-2', reference: 'BK-DEMO2402', service_id: 'preview-service-2', service_name: 'Product consultation', schedule_id: 'preview-schedule', starts_at: iso(later), ends_at: ending(later, 60), timezone: 'Africa/Lagos', guest_name: 'Kwame Mensah', guest_email: 'kwame@example.com', guest_phone: '+233 24 555 0190', notes: '', status: 'confirmed', reservation_key: `preview-schedule|${iso(later)}`, created_at: new Date().toISOString() },
    ],
  }
}

function hydrateLocalPreview() {
  if (localPreviewState.hydrated || !isLocalPreview()) return
  let saved = null
  try { saved = JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY) || 'null') } catch { saved = null }
  const source = saved && typeof saved === 'object' ? saved : createLocalPreviewState()
  for (const table of Object.values(TABLES)) localPreviewState[table] = Array.isArray(source[table]) ? source[table] : []
  const profile = localPreviewState.profiles[0]
  if (profile?.public_link_url?.endsWith('#local-preview')) profile.public_link_url = `${window.location.origin}/book#local-preview`
  localPreviewState.hydrated = true
  persistLocalPreview()
}

function persistLocalPreview() {
  if (!isLocalPreview()) return
  const data = Object.fromEntries(Object.values(TABLES).map(table => [table, localPreviewState[table] || []]))
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data))
}

function localTable(name) {
  hydrateLocalPreview()
  return Array.isArray(localPreviewState[name]) ? localPreviewState[name] : []
}

function setLocalTable(name, records) {
  localPreviewState[name] = records
  persistLocalPreview()
}

function runtimeData() {
  if (window.GoalmaticData) return window.GoalmaticData
  if (isLocalPreview()) return null
  throw new Error('Launch Bookins from Goalmatic to access this workspace.')
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
  const value = {
    display_name: input.displayName,
    bio: input.bio,
    photo_url: input.photoUrl || '',
    timezone: input.timezone,
    public_link_url: input.publicLinkUrl || '',
    public_link_expires_at: input.publicLinkExpiresAt || '',
    updated_at: new Date().toISOString(),
  }
  return existing?.id ? update(TABLES.profiles, existing.id, value) : create(TABLES.profiles, value)
}

export async function saveSchedule(existing, input) {
  const value = {
    name: input.name,
    timezone: input.timezone,
    weekly_windows_json: JSON.stringify(input.weeklyWindows),
    slot_interval_minutes: input.slotIntervalMinutes,
    minimum_notice_minutes: input.minimumNoticeMinutes,
    booking_horizon_days: input.bookingHorizonDays,
    active: true,
    revision: String(Date.now()),
    updated_at: new Date().toISOString(),
  }
  return existing?.id ? update(TABLES.schedules, existing.id, value) : create(TABLES.schedules, value)
}

export async function saveService(existing, input) {
  const value = {
    slug: input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name: input.name,
    description: input.description,
    duration_minutes: input.durationMinutes,
    schedule_id: input.scheduleId,
    price: input.price || 0,
    currency: input.currency || 'NGN',
    visibility: input.visibility,
    active: input.active,
    revision: String(Date.now()),
    updated_at: new Date().toISOString(),
  }
  return existing?.id ? update(TABLES.services, existing.id, value) : create(TABLES.services, value)
}

export function deleteService(id) {
  return remove(TABLES.services, id)
}

export function cancelBooking(booking, reason) {
  return update(TABLES.bookings, booking.id, {
    status: 'cancelled',
    reservation_key: `released:${booking.id}`,
    cancelled_at: new Date().toISOString(),
    cancellation_reason: reason || '',
  })
}

export async function createPublicLink(subject = { kind: 'profile' }) {
  if (!window.GoalmaticShares?.create) {
    if (!isLocalPreview()) throw new Error('Public links are unavailable outside the installed App runtime.')
    const token = crypto.randomUUID().replaceAll('-', '').padEnd(43, '0').slice(0, 43)
    return { token, routePath: '/book', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }
  }
  return window.GoalmaticShares.create(subject, { definitionId: 'booking-link', expiresInDays: 365 })
}

export async function revokePublicLink(url) {
  const token = String(url || '').split('#')[1] || ''
  if (token && window.GoalmaticShares?.revoke) await window.GoalmaticShares.revoke(token)
}

export async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const input = document.createElement('textarea')
  input.value = value
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  document.execCommand('copy')
  input.remove()
}

export async function loadGuestPage() {
  if (isLocalPreview()) {
    const profile = localTable(TABLES.profiles)[0] || {}
    const expectedToken = String(profile.public_link_url || '').split('#')[1] || ''
    const currentToken = window.location.hash.slice(1)
    if (!expectedToken || currentToken !== expectedToken) throw new Error('This local booking link is missing, expired, or has been revoked.')
    return {
      profile: { displayName: profile.display_name || 'Local booking preview', bio: profile.bio || '', photoUrl: profile.photo_url || null, timezone: profile.timezone || 'UTC' },
      services: localTable(TABLES.services)
        .filter(item => item.active !== false && item.visibility === 'public')
        .map(item => ({ id: item.id, name: item.name, description: item.description, durationMinutes: item.duration_minutes, price: item.price || 0, currency: item.currency || 'NGN' })),
    }
  }
  await window.GoalmaticGuest.ready()
  return window.GoalmaticGuest.query('page-get', {})
}

export function loadGuestOpenings(serviceId, fromDate, throughDate) {
  if (!isLocalPreview()) return window.GoalmaticGuest.query('openings-list', { serviceId, fromDate, throughDate })
  const service = localTable(TABLES.services).find(item => item.id === serviceId)
  const schedule = localTable(TABLES.schedules).find(item => item.id === service?.schedule_id)
  if (!service || !schedule) return Promise.resolve({ openings: [] })
  const windows = JSON.parse(schedule.weekly_windows_json || '[]')
  const interval = Number(schedule.slot_interval_minutes)
  const duration = Number(service.duration_minutes)
  if (!Number.isInteger(duration) || duration < 5 || duration > interval) throw new Error('This service does not fit the current booking interval.')
  const busy = localTable(TABLES.bookings).filter(item => item.status !== 'cancelled')
  const start = new Date(`${fromDate}T00:00:00`)
  const end = new Date(`${throughDate}T00:00:00`)
  const openings = []
  for (let date = new Date(start); date <= end && openings.length < 100; date.setDate(date.getDate() + 1)) {
    for (const window of windows.filter(item => item.weekday === date.getDay())) {
      for (let minute = window.startMinute; minute + duration <= window.endMinute; minute += interval) {
        const begins = new Date(date)
        begins.setHours(Math.floor(minute / 60), minute % 60, 0, 0)
        const ends = new Date(begins.getTime() + duration * 60_000)
        if (begins.getTime() < Date.now() + Number(schedule.minimum_notice_minutes || 0) * 60_000) continue
        if (busy.some(item => Date.parse(item.starts_at) < ends.getTime() && begins.getTime() < Date.parse(item.ends_at))) continue
        openings.push({ startsAt: begins.toISOString(), endsAt: ends.toISOString(), timezone: schedule.timezone, localDate: begins.toISOString().slice(0, 10) })
      }
    }
  }
  return Promise.resolve({ openings })
}

export async function submitGuestBooking(input, idempotencyKey) {
  if (!isLocalPreview()) return window.GoalmaticGuest.command('booking-create', input, { idempotencyKey })
  const service = localTable(TABLES.services).find(item => item.id === input.serviceId)
  const scheduleId = service?.schedule_id
  const reservationKey = `${scheduleId}|${new Date(input.startsAt).toISOString()}`
  if (localTable(TABLES.bookings).some(item => item.reservation_key === reservationKey && item.status !== 'cancelled')) throw new Error('This time was booked by someone else.')
  const endsAt = new Date(Date.parse(input.startsAt) + Number(service.duration_minutes) * 60_000).toISOString()
  const reference = `LOCAL-${idempotencyKey.slice(0, 8).toUpperCase()}`
  const booking = await create(TABLES.bookings, {
    reference,
    service_id: service.id,
    service_name: service.name,
    schedule_id: scheduleId,
    starts_at: input.startsAt,
    ends_at: endsAt,
    timezone: localTable(TABLES.schedules)[0]?.timezone || 'UTC',
    guest_name: input.contact.name,
    guest_email: input.contact.email,
    guest_phone: input.contact.phone,
    notes: input.notes || '',
    status: 'confirmed',
    reservation_key: reservationKey,
    created_at: new Date().toISOString(),
  })
  return { bookingId: booking.id, reference, serviceName: service.name, startsAt: input.startsAt, endsAt, timezone: booking.timezone, status: 'confirmed', delivery: 'on-screen-only' }
}
