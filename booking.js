import { isDemo, runOwnerCall } from './runtime.js'
import {
  BookingError,
  assertScheduleSettings,
  findOverlaps,
  serviceAllowed,
  localFields,
  listServiceOpenings,
  resolveBookingRequest,
  validateWeeklyWindows,
  wallClockInstant,
} from './scheduling.js'
import { createSampleHistory } from './demo/history.js'
import { countryFromTimezone, normalizePhone } from './messaging.js'

const TABLES = {
  profiles: 'profiles',
  schedules: 'schedules',
  services: 'services',
  bookings: 'bookings',
  contacts: 'contacts',
}

// Reserved `.invalid` domain (RFC 2606): never deliverable, never someone else's mailbox.
export const PLACEHOLDER_EMAIL_DOMAIN = 'bookins.invalid'
export const TIME_OFF_SERVICE_ID = 'time-off'
const OWNER_STATUSES = ['confirmed', 'completed', 'no_show']

/**
 * Owner time off is stored as a `blocked` booking so the hosted engine treats it as busy.
 * `isTimeOff` matches every time-off record, including removed (cancelled) ones, so pages can
 * exclude them from clients and metrics. `isActiveTimeOff` matches only blocks still in force.
 */
export const isActiveTimeOff = (booking) => booking?.status === 'blocked'
export const isTimeOff = (booking) => isActiveTimeOff(booking) || booking?.service_id === TIME_OFF_SERVICE_ID
/** A real appointment that still holds its time (not cancelled, not time off). */
export const isActiveBooking = (booking) => OWNER_STATUSES.includes(booking?.status)
export const hasRealEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '')) &&
  !String(email).toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`)
const localPreviewState = Object.create(null)

export function isLocalPreview() {
  return ['localhost', '127.0.0.1'].includes(window.location.hostname) && !window.GoalmaticApp
}

function savedRecord(result) {
  return result?.record || result?.data?.record || result?.data || result
}

// Sample bookings sit on the schedule grid: 10:00 wall-clock in the preview schedule timezone.
function nextWorkingDay(offset = 1, timezone = 'Africa/Lagos') {
  const day = new Date(localFields(new Date(), timezone).date + 'T12:00:00.000Z')
  day.setUTCDate(day.getUTCDate() + offset)
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1)
  return wallClockInstant(day.toISOString().slice(0, 10), 10 * 60, timezone)
}

function createLocalPreviewState() {
  const upcoming = nextWorkingDay(2)
  const later = nextWorkingDay(5)
  const iso = (date) => date.toISOString()
  const ending = (date, minutes) => new Date(date.getTime() + minutes * 60_000).toISOString()
  const weeklyWindows = [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
  }))
  return {
    profiles: [
      {
        id: 'preview-profile',
        display_name: "Amina's Studio",
        bio: 'Book a focused session for business strategy, creative direction, and practical next steps.',
        photo_url: '',
        timezone: 'Africa/Lagos',
        public_link_url: `${window.location.origin}/book#local-preview`,
        public_link_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    schedules: [
      {
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
      },
    ],
    services: [
      {
        id: 'preview-service-1',
        slug: 'discovery-call',
        name: 'Discovery call',
        description:
          'A focused conversation to understand what you need and map the right next step.',
        duration_minutes: 30,
        schedule_id: 'preview-schedule',
        price: 0,
        currency: 'NGN',
        visibility: 'public',
        active: true,
        revision: 'preview-1',
      },
      {
        id: 'preview-service-2',
        slug: 'product-consultation',
        name: 'Product consultation',
        description:
          'A practical working session for product direction, UX, and execution planning.',
        duration_minutes: 60,
        schedule_id: 'preview-schedule',
        price: 25000,
        currency: 'NGN',
        visibility: 'public',
        active: true,
        revision: 'preview-1',
      },
    ],
    bookings: [
      {
        id: 'preview-booking-1',
        reference: 'BK-DEMO2401',
        service_id: 'preview-service-1',
        service_name: 'Discovery call',
        schedule_id: 'preview-schedule',
        starts_at: iso(upcoming),
        ends_at: ending(upcoming, 30),
        timezone: 'Africa/Lagos',
        guest_name: 'Ada Okafor',
        guest_email: 'ada@example.com',
        guest_phone: '+234 803 555 0182',
        notes: 'I would like to discuss a new client portal.',
        status: 'confirmed',
        reservation_key: `preview-schedule|${iso(upcoming)}`,
        created_at: new Date().toISOString(),
      },
      {
        id: 'preview-booking-2',
        reference: 'BK-DEMO2402',
        service_id: 'preview-service-2',
        service_name: 'Product consultation',
        schedule_id: 'preview-schedule',
        starts_at: iso(later),
        ends_at: ending(later, 60),
        timezone: 'Africa/Lagos',
        guest_name: 'Kwame Mensah',
        guest_email: 'kwame@example.com',
        guest_phone: '+233 24 555 0190',
        notes: '',
        status: 'confirmed',
        reservation_key: `preview-schedule|${iso(later)}`,
        created_at: new Date().toISOString(),
      },
    ],
  }
}

function hydrateLocalPreview() {
  if (localPreviewState.hydrated || !isLocalPreview()) return
  const source = createLocalPreviewState()
  const history = createSampleHistory({
    scheduleId: 'preview-schedule',
    timezone: 'Africa/Lagos',
    services: source.services,
    idPrefix: 'preview',
  })
  source.bookings.push(...history.bookings)
  source.contacts = history.contacts
  for (const table of Object.values(TABLES))
    localPreviewState[table] = Array.isArray(source[table]) ? source[table] : []
  localPreviewState.hydrated = true
}

function localTable(name) {
  hydrateLocalPreview()
  return Array.isArray(localPreviewState[name]) ? localPreviewState[name] : []
}

function setLocalTable(name, records) {
  localPreviewState[name] = records
}

function runtimeData() {
  if (window.GoalmaticData) return window.GoalmaticData
  if (isLocalPreview()) return null
  throw new Error('Launch Bookins from Goalmatic to access this workspace.')
}

async function list(table) {
  const data = runtimeData()
  if (!data) return localTable(table)
  if (typeof data.fetchAll !== 'function') throw new Error('Relaunch Bookins to load complete workspace data.')
  const result = await data.fetchAll(table, { pageSize: 200, maxPages: 50, maxRecords: 10000 })
  if (window.GoalmaticData !== data || result?.complete !== true || !Array.isArray(result.records)) {
    throw new Error('Booking workspace data could not be loaded completely. Refresh before making changes.')
  }
  return result.records
}

async function create(table, value) {
  const data = runtimeData()
  if (data)
    return savedRecord(await data.submit(table, value, { idempotencyKey: crypto.randomUUID() }))
  const created = { id: crypto.randomUUID(), ...value }
  setLocalTable(table, [...localTable(table), created])
  return created
}

async function update(table, id, value) {
  const data = runtimeData()
  if (data)
    return savedRecord(await data.update(table, id, value, { idempotencyKey: crypto.randomUUID() }))
  const records = localTable(table).map((item) => (item.id === id ? { ...item, ...value } : item))
  setLocalTable(table, records)
  return records.find((item) => item.id === id)
}

async function remove(table, id) {
  const data = runtimeData()
  if (data) return data.remove(table, id, { idempotencyKey: crypto.randomUUID() })
  setLocalTable(
    table,
    localTable(table).filter((item) => item.id !== id),
  )
}

export async function loadOwnerWorkspace() {
  return runOwnerCall('loadOwnerWorkspace', async () => {
    const [profiles, schedules, services, bookings, contacts] = await Promise.all([
      list(TABLES.profiles),
      list(TABLES.schedules),
      list(TABLES.services),
      list(TABLES.bookings),
      // Contacts is optional (added in v0.5.0); an unbound Table must not block the workspace.
      list(TABLES.contacts).catch(() => []),
    ])
    return { profile: profiles[0] || null, schedules, services, bookings, contacts }
  })
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
  return runOwnerCall(
    'saveProfile',
    () => (existing?.id ? update(TABLES.profiles, existing.id, value) : create(TABLES.profiles, value)),
    [existing, input],
  )
}

// Validation failures happen before any write, so the demo boundary may treat them as not started.
function rejected(code, message) {
  const error = new BookingError(400, code, message)
  error.outcome = 'not_started'
  return error
}

function assertScheduleInput(input) {
  const windows = validateWeeklyWindows(input.weeklyWindows)
  if (!windows.valid) throw rejected('BOOKING_SCHEDULE_INVALID', windows.message)
  try {
    assertScheduleSettings({ slotIntervalMinutes: input.slotIntervalMinutes })
  } catch (error) {
    throw rejected(error.code, error.message)
  }
  for (const [label, value] of [
    ['minimum notice', input.minimumNoticeMinutes],
    ['booking horizon', input.bookingHorizonDays],
  ]) {
    if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(Number(value)))
      throw rejected('BOOKING_SCHEDULE_INVALID', `The ${label} must be a number`)
  }
  return windows.windows
}

export async function saveSchedule(existing, input) {
  return runOwnerCall(
    'saveSchedule',
    () => {
      const weeklyWindows = assertScheduleInput(input)
      const value = {
        name: input.name,
        timezone: input.timezone,
        weekly_windows_json: JSON.stringify(weeklyWindows),
        slot_interval_minutes: Number(input.slotIntervalMinutes),
        minimum_notice_minutes: Number(input.minimumNoticeMinutes),
        booking_horizon_days: Number(input.bookingHorizonDays),
        active: true,
        revision: String(Date.now()),
        updated_at: new Date().toISOString(),
      }
      return existing?.id ? update(TABLES.schedules, existing.id, value) : create(TABLES.schedules, value)
    },
    [existing, input],
  )
}

export function slugBase(name) {
  const base = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'service'
}

export function uniqueServiceSlug(name, existing, existingServices = []) {
  const base = slugBase(name)
  const taken = new Set(
    existingServices.filter((item) => item && item.id !== existing?.id).map((item) => item.slug),
  )
  if (existing?.slug && (existing.slug === base || new RegExp(`^${base}-\\d+$`).test(existing.slug)) && !taken.has(existing.slug))
    return existing.slug
  let slug = base
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`
  return slug
}

export async function saveService(existing, input, existingServices = []) {
  const value = {
    slug: uniqueServiceSlug(input.name, existing, existingServices),
    name: input.name,
    description: input.description,
    duration_minutes: input.durationMinutes,
    schedule_id: input.scheduleId,
    price: input.price || 0,
    currency: input.currency || 'NGN',
    visibility: input.visibility,
    active: input.active,
    location: String(input.location ?? existing?.location ?? '').trim().slice(0, 300),
    revision: String(Date.now()),
    updated_at: new Date().toISOString(),
  }
  return runOwnerCall(
    'saveService',
    () => (existing?.id ? update(TABLES.services, existing.id, value) : create(TABLES.services, value)),
    [existing, input, existingServices],
  )
}

export function deleteService(id) {
  return runOwnerCall('deleteService', () => remove(TABLES.services, id), [id])
}

export function cancelBooking(booking, reason) {
  return runOwnerCall(
    'cancelBooking',
    () => update(TABLES.bookings, booking.id, {
      status: 'cancelled',
      reservation_key: `released:${booking.id}`,
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason || '',
    }),
    [booking, reason],
  )
}

export async function createPublicLink(subject = { kind: 'profile' }) {
  return runOwnerCall(
    'createPublicLink',
    async () => {
      if (!window.GoalmaticShares?.create) {
        if (!isLocalPreview())
          throw new Error('Public links are unavailable outside the installed App runtime.')
        const token = crypto.randomUUID().replaceAll('-', '').padEnd(43, '0').slice(0, 43)
        return {
          token,
          routePath: '/book',
          expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        }
      }
      return window.GoalmaticShares.create(subject, {
        definitionId: 'booking-link',
        expiresInDays: 365,
      })
    },
    [subject],
  )
}

export async function revokePublicLink(url) {
  return runOwnerCall(
    'revokePublicLink',
    async () => {
      const token = String(url || '').split('#')[1] || ''
      if (isLocalPreview()) {
        if (token && window.GoalmaticShares?.revoke) await window.GoalmaticShares.revoke(token)
        return
      }
      if (!window.GoalmaticShares?.revoke) {
        const error = new BookingError(
          503,
          'BOOKING_REVOKE_UNAVAILABLE',
          'Link revoking is unavailable outside the installed App runtime. The link is still active.',
        )
        error.outcome = 'not_started'
        throw error
      }
      if (!token) {
        const error = new BookingError(
          400,
          'BOOKING_LINK_INVALID',
          'The saved booking link has no token, so it could not be revoked.',
        )
        error.outcome = 'not_started'
        throw error
      }
      await window.GoalmaticShares.revoke(token)
    },
    [url],
  )
}

// ---- owner booking actions (v0.5.0) ----

function notStarted(status, code, message) {
  const error = new BookingError(status, code, message)
  error.outcome = 'not_started'
  return error
}

const randomHex = (length) => crypto.randomUUID().replaceAll('-', '').slice(0, length).toUpperCase()

function isUniqueViolation(error) {
  return /must be unique|preventDuplicates|duplicate/i.test(String(error?.message || ''))
}

function serviceContext(state, serviceId) {
  const service = (state.services || []).find((item) => item.id === serviceId)
  if (!service) throw notStarted(404, 'BOOKING_SERVICE_NOT_FOUND', 'Choose a service for this booking.')
  const schedule = (state.schedules || []).find((item) => item.id === service.schedule_id)
  if (!schedule) throw notStarted(409, 'BOOKING_SCHEDULE_UNAVAILABLE', 'This service has no schedule. Set your availability first.')
  const minutes = Number(service.duration_minutes)
  if (!Number.isInteger(minutes) || minutes < 5)
    throw notStarted(400, 'BOOKING_SERVICE_INVALID', 'This service has no valid duration.')
  return { service, schedule, minutes }
}

function ownerContact(contact = {}, timezone = '') {
  const name = String(contact.name || '').trim().slice(0, 160)
  const phone = String(contact.phone || '').trim().slice(0, 40)
  let email = String(contact.email || '').trim().toLowerCase().slice(0, 254)
  if (!name) throw notStarted(400, 'BOOKING_CONTACT_INVALID', 'Enter the client name.')
  if (email && !hasRealEmail(email))
    throw notStarted(400, 'BOOKING_CONTACT_INVALID', 'Enter a valid email address, or leave it blank.')
  // Walk-ins and phone bookings often have no email. The Table requires one, so store a
  // never-deliverable placeholder keyed by phone so the client still groups in Contacts.
  if (!email) {
    const digits = normalizePhone(phone, countryFromTimezone(timezone)) || phone.replace(/\D/g, '')
    if (!digits) throw notStarted(400, 'BOOKING_CONTACT_INVALID', 'Enter an email address or a phone number.')
    email = `phone-${digits}@${PLACEHOLDER_EMAIL_DOMAIN}`
  }
  return { name, email, phone }
}

function overlapError(overlaps) {
  const first = overlaps[0]
  const label = isTimeOff(first) ? 'your time off' : `${first.guest_name || 'another booking'} (${first.service_name || 'booking'})`
  return notStarted(409, 'BOOKING_SLOT_TAKEN', `This time overlaps ${label}.`)
}

/**
 * Owner-created booking (walk-in, phone, or recurring). Owners may book outside weekly hours
 * and inside minimum notice, but never on top of another booking or time off.
 * Overlap is checked against loaded state (not atomic); exact-start collisions are still
 * rejected by the unique reservation key.
 */
export function createOwnerBooking(state, input = {}) {
  return runOwnerCall(
    'createOwnerBooking',
    async () => {
      const { service, schedule, minutes } = serviceContext(state, input.serviceId)
      const contact = ownerContact(input.contact, schedule.timezone)
      const repeatWeeks = Math.max(0, Math.min(12, Math.floor(Number(input.repeatWeeks) || 0)))
      const first = Date.parse(input.startsAt)
      if (!Number.isFinite(first)) throw notStarted(400, 'BOOKING_TIME_INVALID', 'Choose a date and time.')
      const seriesId = repeatWeeks ? crypto.randomUUID() : ''
      const known = [...(state.bookings || [])]
      const created = []
      const skipped = []
      for (let week = 0; week <= repeatWeeks; week += 1) {
        // Weekly repeats keep the same wall-clock time in the schedule timezone across DST.
        const startsAt = week === 0 ? new Date(first) : sameWallClockWeeksLater(first, week, schedule.timezone)
        if (!startsAt) {
          skipped.push({ startsAt: new Date(first + week * 7 * 86_400_000).toISOString(), reason: 'This local time does not exist that week (clock change).' })
          continue
        }
        const endsAt = new Date(startsAt.getTime() + minutes * 60_000)
        const overlaps = findOverlaps(known, schedule.id, startsAt.toISOString(), endsAt.toISOString())
        if (overlaps.length) {
          if (!repeatWeeks) throw overlapError(overlaps)
          skipped.push({ startsAt: startsAt.toISOString(), reason: overlapError(overlaps).message })
          continue
        }
        try {
          const booking = await create(TABLES.bookings, {
            reference: `BK-${randomHex(10)}`,
            service_id: service.id,
            service_name: service.name,
            schedule_id: schedule.id,
            starts_at: startsAt.toISOString(),
            ends_at: endsAt.toISOString(),
            timezone: schedule.timezone,
            guest_name: contact.name,
            guest_email: contact.email,
            guest_phone: contact.phone,
            notes: String(input.notes || '').trim().slice(0, 2000),
            owner_notes: String(input.ownerNotes || '').trim().slice(0, 4000),
            status: 'confirmed',
            source: 'owner',
            series_id: seriesId,
            reservation_key: `${schedule.id}|${startsAt.toISOString()}`,
            created_at: new Date().toISOString(),
          })
          created.push(booking)
          known.push(booking)
        } catch (error) {
          const reason = isUniqueViolation(error) ? 'Another booking starts at this exact time.' : error?.message || 'Could not save.'
          if (!repeatWeeks && !created.length) {
            if (isUniqueViolation(error)) throw notStarted(409, 'BOOKING_SLOT_TAKEN', reason)
            throw error
          }
          skipped.push({ startsAt: startsAt.toISOString(), reason })
        }
      }
      return { created, skipped }
    },
    [state, input],
  )
}

function sameWallClockWeeksLater(firstMs, weeks, timezone) {
  const { date, time } = localFields(new Date(firstMs), timezone)
  const day = new Date(`${date}T12:00:00.000Z`)
  day.setUTCDate(day.getUTCDate() + weeks * 7)
  const [hours, minutes] = time.split(':').map(Number)
  return wallClockInstant(day.toISOString().slice(0, 10), hours * 60 + minutes, timezone)
}

/** Moves a booking to `startsAt`, keeping its length. Same overlap rule, ignoring itself. */
export function rescheduleBooking(state, booking, startsAt) {
  return runOwnerCall(
    'rescheduleBooking',
    async () => {
      if (!booking?.id || !isActiveBooking(booking))
        throw notStarted(409, 'BOOKING_NOT_ACTIVE', 'Only active bookings can be moved.')
      const start = Date.parse(startsAt)
      if (!Number.isFinite(start)) throw notStarted(400, 'BOOKING_TIME_INVALID', 'Choose a new date and time.')
      const length = Date.parse(booking.ends_at) - Date.parse(booking.starts_at)
      const begins = new Date(start).toISOString()
      const ends = new Date(start + length).toISOString()
      const overlaps = findOverlaps(state.bookings || [], booking.schedule_id, begins, ends, booking.id)
      if (overlaps.length) throw overlapError(overlaps)
      try {
        return await update(TABLES.bookings, booking.id, {
          starts_at: begins,
          ends_at: ends,
          reservation_key: `${booking.schedule_id}|${begins}`,
          status: 'confirmed',
        })
      } catch (error) {
        if (isUniqueViolation(error))
          throw notStarted(409, 'BOOKING_SLOT_TAKEN', 'Another booking starts at this exact time.')
        throw error
      }
    },
    [state, booking, startsAt],
  )
}

export function setBookingStatus(booking, status) {
  return runOwnerCall(
    'setBookingStatus',
    async () => {
      if (!OWNER_STATUSES.includes(status))
        throw notStarted(400, 'BOOKING_STATUS_INVALID', 'Choose confirmed, completed, or no-show.')
      if (!isActiveBooking(booking))
        throw notStarted(409, 'BOOKING_NOT_ACTIVE', 'Cancelled bookings and time off cannot change status.')
      return update(TABLES.bookings, booking.id, { status })
    },
    [booking, status],
  )
}

export function saveBookingNotes(booking, ownerNotes) {
  return runOwnerCall(
    'saveBookingNotes',
    () => update(TABLES.bookings, booking.id, { owner_notes: String(ownerNotes || '').slice(0, 4000) }),
    [booking, ownerNotes],
  )
}

/**
 * Owner time off. Stored as a `blocked` booking on the schedule so hosted openings exclude it.
 * May overlap existing bookings (they are kept); `overlapping` lets the UI warn.
 */
export function createTimeOff(state, input = {}) {
  return runOwnerCall(
    'createTimeOff',
    async () => {
      const schedule = (state.schedules || [])[0]
      if (!schedule) throw notStarted(409, 'BOOKING_SCHEDULE_UNAVAILABLE', 'Set your availability before adding time off.')
      const start = Date.parse(input.startsAt)
      const end = Date.parse(input.endsAt)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        throw notStarted(400, 'BOOKING_TIME_INVALID', 'Time off must end after it starts.')
      if (end - start > 60 * 86_400_000)
        throw notStarted(400, 'BOOKING_TIME_INVALID', 'Add time off in blocks of 60 days or fewer.')
      const startsAt = new Date(start).toISOString()
      const endsAt = new Date(end).toISOString()
      const overlapping = findOverlaps(state.bookings || [], schedule.id, startsAt, endsAt).filter(
        (item) => !isTimeOff(item),
      )
      const reason = String(input.reason || '').trim().slice(0, 160)
      const id = randomHex(8)
      const record = await create(TABLES.bookings, {
        reference: `OFF-${id}`,
        service_id: TIME_OFF_SERVICE_ID,
        service_name: 'Time off',
        schedule_id: schedule.id,
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: schedule.timezone,
        guest_name: reason || 'Time off',
        guest_email: `time-off@${PLACEHOLDER_EMAIL_DOMAIN}`,
        guest_phone: '',
        notes: reason,
        status: 'blocked',
        source: 'owner',
        reservation_key: `block:${crypto.randomUUID()}`,
        created_at: new Date().toISOString(),
      })
      return { record, overlapping }
    },
    [state, input],
  )
}

export function removeTimeOff(record) {
  return runOwnerCall(
    'removeTimeOff',
    () => update(TABLES.bookings, record.id, {
      status: 'cancelled',
      reservation_key: `released:${record.id}`,
      cancelled_at: new Date().toISOString(),
    }),
    [record],
  )
}

/** Creates a link that opens one service directly, including private ones. */
export function createServiceLink(service) {
  return runOwnerCall(
    'createServiceLink',
    async () => {
      const grant = await createPublicLink({ kind: 'service', serviceId: service.id })
      const url = `${window.location.origin}${grant.routePath || '/book'}#${grant.token}`
      try {
        return await update(TABLES.services, service.id, {
          public_link_url: url,
          public_link_expires_at: grant.expiresAt || '',
          updated_at: new Date().toISOString(),
        })
      } catch (error) {
        // Never leave a live grant the owner cannot see or revoke.
        await revokePublicLink(url).catch(() => {})
        throw error
      }
    },
    [service],
  )
}

export function revokeServiceLink(service) {
  return runOwnerCall(
    'revokeServiceLink',
    async () => {
      if (service.public_link_url) await revokePublicLink(service.public_link_url)
      return update(TABLES.services, service.id, {
        public_link_url: '',
        public_link_expires_at: '',
        updated_at: new Date().toISOString(),
      })
    },
    [service],
  )
}

export function saveMessageTemplates(profile, templates) {
  return runOwnerCall(
    'saveMessageTemplates',
    async () => {
      if (!profile?.id) throw notStarted(409, 'BOOKING_PROFILE_REQUIRED', 'Save your profile first.')
      return update(TABLES.profiles, profile.id, {
        message_templates_json: JSON.stringify(templates || {}),
        updated_at: new Date().toISOString(),
      })
    },
    [profile, templates],
  )
}

/** Client record keyed by lowercased email: private notes and tags merged with booking history. */
export function saveContact(existing, input = {}) {
  return runOwnerCall(
    'saveContact',
    async () => {
      const email = String(input.email || existing?.email || '').trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw notStarted(400, 'BOOKING_CONTACT_INVALID', 'This client has no email to key their record.')
      const tags = [...new Set((input.tags || []).map((tag) => String(tag).trim().slice(0, 40)).filter(Boolean))].slice(0, 20)
      const value = {
        email,
        name: String(input.name || '').trim().slice(0, 160),
        phone: String(input.phone || '').trim().slice(0, 40),
        notes: String(input.notes || '').slice(0, 4000),
        tags_json: JSON.stringify(tags),
        updated_at: new Date().toISOString(),
      }
      return existing?.id ? update(TABLES.contacts, existing.id, value) : create(TABLES.contacts, value)
    },
    [existing, input],
  )
}

export function contactTags(contact) {
  try {
    const tags = JSON.parse(contact?.tags_json || '[]')
    return Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string') : []
  } catch {
    return []
  }
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

// Local stand-in for the hosted grant subject: the profile link or one service's direct link.
function localGuestSubject() {
  const token = window.location.hash.slice(1)
  const tokenOf = (url) => String(url || '').split('#')[1] || ''
  if (!token) return null
  if (tokenOf(localTable(TABLES.profiles)[0]?.public_link_url) === token) return { kind: 'profile' }
  const service = localTable(TABLES.services).find((item) => tokenOf(item.public_link_url) === token)
  return service ? { kind: 'service', serviceId: service.id } : null
}

export async function loadGuestPage() {
  if (isLocalPreview()) {
    const profile = localTable(TABLES.profiles)[0] || {}
    const subject = localGuestSubject()
    if (!subject) throw new Error('This local booking link is missing, expired, or has been revoked.')
    return {
      profile: {
        displayName: profile.display_name || 'Local booking preview',
        bio: profile.bio || '',
        photoUrl: profile.photo_url || null,
        timezone: profile.timezone || 'UTC',
      },
      services: localTable(TABLES.services)
        .filter((item) => item.active !== false && serviceAllowed(item, subject))
        .map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          durationMinutes: item.duration_minutes,
          price: item.price || 0,
          currency: item.currency || 'NGN',
        })),
    }
  }
  await window.GoalmaticGuest.ready()
  return window.GoalmaticGuest.query('page-get', {})
}

export async function loadGuestOpenings(serviceId, fromDate, throughDate) {
  if (!isLocalPreview())
    return window.GoalmaticGuest.query('openings-list', { serviceId, fromDate, throughDate })
  return listServiceOpenings({
    services: localTable(TABLES.services),
    schedules: localTable(TABLES.schedules),
    bookings: localTable(TABLES.bookings),
    serviceId,
    fromDate,
    throughDate,
    now: new Date(),
    subject: localGuestSubject() || { kind: 'profile' },
  })
}

export async function submitGuestBooking(input, idempotencyKey) {
  if (!isLocalPreview())
    return window.GoalmaticGuest.command('booking-create', input, { idempotencyKey })
  const bookings = localTable(TABLES.bookings)
  const request = resolveBookingRequest({
    services: localTable(TABLES.services),
    schedules: localTable(TABLES.schedules),
    bookings,
    serviceId: input?.serviceId,
    startsAt: input?.startsAt,
    contact: input?.contact,
    notes: input?.notes,
    now: new Date(),
    subject: localGuestSubject() || { kind: 'profile' },
  })
  if (bookings.some((item) => item.reservation_key === request.reservationKey && item.status !== 'cancelled'))
    throw new BookingError(409, 'BOOKING_SLOT_TAKEN', 'This time was booked by someone else. Choose another slot.')
  const reference = `LOCAL-${String(idempotencyKey || crypto.randomUUID()).slice(0, 8).toUpperCase()}`
  const { service, opening } = request
  const booking = await create(TABLES.bookings, {
    reference,
    service_id: service.id,
    service_name: service.name,
    schedule_id: request.scheduleId,
    starts_at: opening.startsAt,
    ends_at: opening.endsAt,
    timezone: opening.timezone,
    guest_name: request.contact.name,
    guest_email: request.contact.email,
    guest_phone: request.contact.phone,
    notes: request.notes,
    status: 'confirmed',
    reservation_key: request.reservationKey,
    created_at: new Date().toISOString(),
  })
  return {
    bookingId: booking.id,
    reference,
    serviceName: service.name,
    startsAt: opening.startsAt,
    endsAt: opening.endsAt,
    timezone: opening.timezone,
    status: 'confirmed',
    delivery: 'on-screen-only',
  }
}

// ---- Google Calendar (optional; owner runtime and guest busy filter) ----
// Declared in the manifest as capability `calendar-sync`. Call pattern follows
// Goals-by-Goalmatic platform/goalmatic.js (connect popup, events-list/create/update).
const CALENDAR_RANGE_DAYS = 31
const CALENDAR_EVENT_LIMIT = 100
const CALENDAR_OWNER_LOOKAHEAD_DAYS = 93
const CANCELLED_PREFIX = 'Cancelled: '

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function unwrap(value) {
  let current = value
  for (let index = 0; index < 4; index += 1) {
    if (!isRecord(current)) break
    if ('data' in current && current.data !== undefined) current = current.data
    else if ('result' in current && current.result !== undefined) current = current.result
    else break
  }
  return current
}

function calendarExecute(operationId, input, options) {
  if (typeof window.GoalmaticApp?.execute !== 'function')
    throw new Error('Launch Bookins from Goalmatic to use Google Calendar.')
  return window.GoalmaticApp.execute(operationId, input, options)
}

/** 'live' (installed runtime), 'demo', 'preview' (localhost without runtime) or 'unavailable'. */
export function calendarMode() {
  if (isDemo.value) return 'demo'
  if (typeof window.GoalmaticApp?.execute === 'function') return 'live'
  return isLocalPreview() ? 'preview' : 'unavailable'
}

const NOT_CONNECTED = /CONNECTION_UNAVAILABLE|not connected|authorization expired|oauth is not configured/i
export const isCalendarNotConnected = (error) =>
  NOT_CONNECTED.test(`${error?.code || ''} ${error?.message || ''}`)

function calendarErrorMessage(error, fallback) {
  if (isCalendarNotConnected(error)) return 'Google Calendar is not connected.'
  return error?.message || fallback
}

const stripNotice = (mode) =>
  mode === 'demo'
    ? 'Google Calendar is not available in the demo.'
    : mode === 'preview'
      ? 'Google Calendar is not available in local preview. Launch Bookins from Goalmatic to connect it.'
      : 'Google Calendar needs the installed Bookins App. Launch Bookins from Goalmatic.'

/** Connection status without changing anything: a one-event read tells connected from not connected. */
export async function getCalendarStatus() {
  const mode = calendarMode()
  if (mode !== 'live') return { state: mode, message: stripNotice(mode) }
  return runOwnerCall('getCalendarStatus', async () => {
    const now = Date.now()
    try {
      await calendarExecute('integrations.google-calendar.events-list', {
        timeMin: new Date(now).toISOString(),
        timeMax: new Date(now + 86_400_000).toISOString(),
        limit: 1,
      })
      return { state: 'connected', message: '' }
    } catch (error) {
      if (isCalendarNotConnected(error)) return { state: 'not-connected', message: '' }
      return { state: 'error', message: calendarErrorMessage(error, 'Google Calendar could not be checked.') }
    }
  })
}

// Same flow as Goals-by-Goalmatic platform/goalmatic.js connectGoogleCalendar (487-513).
export async function connectGoogleCalendar() {
  if (calendarMode() !== 'live') throw new Error(stripNotice(calendarMode()))
  return runOwnerCall('connectGoogleCalendar', async () => {
    const authWindow = window.open('about:blank', 'goalmatic-google-calendar', 'popup=yes,width=560,height=720')
    if (!authWindow) throw new Error('Allow pop-ups to connect Google Calendar.')
    try {
      authWindow.document.title = 'Connect Google Calendar'
      const started = unwrap(
        await window.GoalmaticApp.execute('integrations.connection-start', { integrationId: 'GOOGLECALENDAR' }),
      )
      if (!isRecord(started) || typeof started.redirectUrl !== 'string' || typeof started.requestId !== 'string')
        throw new Error('Goalmatic could not start Google Calendar authorization.')
      authWindow.location.replace(started.redirectUrl)
      await new Promise((resolve) => window.setTimeout(resolve, 750))
      await window.GoalmaticApp.execute('integrations.connection-complete', { requestId: started.requestId })
    } finally {
      authWindow.close()
    }
  })
}

/** The Calendar event Bookins writes for a booking. UTC instants plus the booking's own timezone; no attendees. */
export function calendarEventInput(booking) {
  const lines = [
    `Bookins reference: ${booking.reference || booking.id}`,
    `Guest: ${booking.guest_name || ''}`,
    `Email: ${booking.guest_email || ''}`,
  ]
  if (booking.guest_phone) lines.push(`Phone: ${booking.guest_phone}`)
  if (booking.notes) lines.push('', `Notes: ${booking.notes}`)
  return {
    summary: calendarSummary(booking),
    description: lines.join('\n').slice(0, 8000),
    start: new Date(booking.starts_at).toISOString(),
    end: new Date(booking.ends_at).toISOString(),
    ...(booking.timezone ? { timeZone: booking.timezone } : {}),
  }
}

const calendarSummary = (booking) =>
  `${booking.service_name || 'Appointment'} with ${booking.guest_name || 'guest'}`.slice(0, 480)

/** Creates the event once per booking. The booking id is the idempotency key, so a retry cannot duplicate it. */
export async function addBookingToCalendar(booking) {
  if (booking.calendar_event_id) return { eventId: booking.calendar_event_id, alreadyOnCalendar: true }
  if (calendarMode() !== 'live') throw new Error(stripNotice(calendarMode()))
  return runOwnerCall('addBookingToCalendar', async () => {
    let eventId = ''
    try {
      const result = unwrap(
        await window.GoalmaticApp.execute('integrations.google-calendar.event-create', calendarEventInput(booking), {
          idempotencyKey: `bookins:calendar-create:${booking.id}`,
        }),
      )
      const event = isRecord(result) && isRecord(result.event) ? result.event : result
      eventId = isRecord(event) && typeof event.id === 'string' ? event.id : ''
    } catch (error) {
      throw new Error(calendarErrorMessage(error, 'The event could not be added to Google Calendar.'))
    }
    if (!eventId) throw new Error('Google Calendar did not return the new event.')
    try {
      await update(TABLES.bookings, booking.id, { calendar_event_id: eventId })
    } catch {
      throw new Error(
        'The event was created in Google Calendar but Bookins could not save its link. Try again; the same event will be reused.',
      )
    }
    return { eventId, alreadyOnCalendar: false }
  })
}

/** Adds bookings one at a time and reports each outcome; one failure never stops the rest. */
export async function addBookingsToCalendar(bookings, onProgress) {
  const outcomes = []
  for (const booking of bookings) {
    let outcome
    try {
      const result = await addBookingToCalendar(booking)
      outcome = { id: booking.id, ok: true, eventId: result.eventId, skipped: result.alreadyOnCalendar }
    } catch (error) {
      outcome = { id: booking.id, ok: false, message: error?.message || 'Could not add this booking.' }
    }
    outcomes.push(outcome)
    onProgress?.(outcome, outcomes.length, bookings.length)
  }
  return outcomes
}

/**
 * Cancels first (the authoritative step), then marks the Calendar event "Cancelled: ...".
 * The op schema has no transparency/free field, so only the title changes.
 * A Calendar failure never undoes the cancellation; it is returned as `calendar.state === 'failed'`.
 */
export async function cancelBookingWithCalendar(booking, reason) {
  await cancelBooking(booking, reason)
  if (!booking.calendar_event_id) return { calendar: { state: 'none' } }
  if (calendarMode() !== 'live') return { calendar: { state: 'skipped', message: stripNotice(calendarMode()) } }
  try {
    await runOwnerCall('markCalendarEventCancelled', () =>
      window.GoalmaticApp.execute(
        'integrations.google-calendar.event-update',
        { eventId: booking.calendar_event_id, summary: `${CANCELLED_PREFIX}${calendarSummary(booking)}` },
        { idempotencyKey: `bookins:calendar-cancel:${booking.id}` },
      ),
    )
    return { calendar: { state: 'updated' } }
  } catch (error) {
    return { calendar: { state: 'failed', message: calendarErrorMessage(error, 'The Calendar event was not updated.') } }
  }
}

/** Timed events from the owner's calendar in [from, to), in <=31-day calls, up to three calls ahead. */
export async function listCalendarEvents(from, to) {
  if (calendarMode() !== 'live') throw new Error(stripNotice(calendarMode()))
  return runOwnerCall('listCalendarEvents', async () => {
    const events = []
    let truncated = false
    const limit = Math.min(Date.parse(to), Date.parse(from) + CALENDAR_OWNER_LOOKAHEAD_DAYS * 86_400_000)
    truncated = limit < Date.parse(to)
    for (let cursor = Date.parse(from); cursor < limit; cursor += CALENDAR_RANGE_DAYS * 86_400_000) {
      const result = unwrap(
        await window.GoalmaticApp.execute('integrations.google-calendar.events-list', {
          timeMin: new Date(cursor).toISOString(),
          timeMax: new Date(Math.min(limit, cursor + CALENDAR_RANGE_DAYS * 86_400_000)).toISOString(),
          limit: CALENDAR_EVENT_LIMIT,
        }),
      )
      const page = isRecord(result) && Array.isArray(result.events) ? result.events : []
      if (page.length >= CALENDAR_EVENT_LIMIT) truncated = true
      for (const event of page) if (isRecord(event) && typeof event.id === 'string') events.push(event)
    }
    return { events, truncated }
  })
}

/**
 * Upcoming bookings that overlap a timed Calendar event that is not a Bookins-written event.
 * Returns Map(bookingId -> event titles). All-day and cancelled events are ignored.
 */
export function findCalendarConflicts(bookings, events) {
  const own = new Set(bookings.map((item) => item.calendar_event_id).filter(Boolean))
  const timed = events
    .filter((event) => !own.has(event.id) && event.allDay !== true && event.status !== 'cancelled')
    .map((event) => ({ event, start: Date.parse(event.start), end: Date.parse(event.end) }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))
  const conflicts = new Map()
  for (const booking of bookings) {
    const start = Date.parse(booking.starts_at)
    const end = Date.parse(booking.ends_at)
    const hits = timed.filter((item) => item.start < end && item.end > start)
    if (hits.length) conflicts.set(booking.id, hits.map((item) => item.event.summary || '(Untitled event)'))
  }
  return conflicts
}

/**
 * Guest busy ranges for the booking page. NOT authoritative: it only hides openings in the browser.
 * `booking.create` does not check Calendar. Any failure (not connected, runtime, range) returns null.
 */
export async function loadGuestCalendarBusy(fromMs, toMs) {
  if (isLocalPreview() || typeof window.GoalmaticGuest?.query !== 'function') return null
  try {
    const busy = []
    for (let cursor = fromMs; cursor < toMs; cursor += CALENDAR_RANGE_DAYS * 86_400_000) {
      const result = await window.GoalmaticGuest.query('calendar-busy', {
        timeMin: new Date(cursor).toISOString(),
        timeMax: new Date(Math.min(toMs, cursor + CALENDAR_RANGE_DAYS * 86_400_000)).toISOString(),
      })
      const ranges = unwrap(result)?.busy
      if (!Array.isArray(ranges)) return null
      for (const range of ranges) {
        const start = Date.parse(range?.start)
        const end = Date.parse(range?.end)
        if (Number.isFinite(start) && Number.isFinite(end)) busy.push({ start, end })
      }
    }
    return busy
  } catch {
    return null
  }
}

export function openingOverlapsBusy(opening, busy) {
  const start = Date.parse(opening.startsAt)
  const end = Date.parse(opening.endsAt) || start
  return busy.some((range) => range.start < end && range.end > start)
}
