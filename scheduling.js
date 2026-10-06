// Pure, dependency-free port of the hosted booking engine
// (backend/functions/src/apps/booking/runtimeService.ts). Keep behaviour identical.
// Used by the local preview engine (booking.js), the demo engine and the tests.

export const MAX_RANGE_DAYS = 31
export const MAX_OPENINGS = 200

export class BookingError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'PlatformError'
    this.status = status
    this.code = code
  }
}

const fail = (status, code, message) => new BookingError(status, code, message)

function record(value, message = 'A record object is required') {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw fail(400, 'BOOKING_INPUT_INVALID', message)
  return value
}

export function text(value, maximum = 10_000) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function isTruthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function isoInstant(value, field) {
  const parsed = new Date(text(value, 80))
  if (Number.isNaN(parsed.getTime()))
    throw fail(400, 'BOOKING_TIME_INVALID', `${field} must be an RFC 3339 timestamp`)
  return parsed.toISOString()
}

function isoDate(value, field) {
  const normalized = text(value, 10)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(normalized) ||
    Number.isNaN(new Date(`${normalized}T00:00:00.000Z`).getTime())
  )
    throw fail(400, 'BOOKING_DATE_INVALID', `${field} must use YYYY-MM-DD`)
  return normalized
}

// ---- timezone helpers (Intl only) ----

const formatters = new Map()
function formatterFor(timezone) {
  let formatter = formatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timezone, formatter)
  }
  return formatter
}

export function assertTimezone(timezone) {
  try {
    formatterFor(timezone).format(new Date())
  } catch {
    throw fail(400, 'BOOKING_TIMEZONE_INVALID', 'The booking profile needs a valid IANA timezone')
  }
}

function zonedParts(instantMs, timezone) {
  const parts = {}
  for (const part of formatterFor(timezone).formatToParts(new Date(instantMs)))
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  return parts
}

/** Wall-clock fields of an instant in `timezone`: { date: 'YYYY-MM-DD', time: 'HH:mm' }. */
export function localFields(instant, timezone) {
  const p = zonedParts(new Date(instant).getTime(), timezone)
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return {
    date: `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  }
}

function offsetAt(instantMs, timezone) {
  const p = zonedParts(instantMs, timezone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(instantMs / 1000) * 1000
}

/**
 * Wall-clock minute-of-day on a calendar date -> instant, or null when the local time does not
 * exist (DST gap). Detected by round trip, like hosted. Ambiguous times resolve to the first.
 */
export function wallClockInstant(date, minute, timezone) {
  const hours = String(Math.floor(minute / 60)).padStart(2, '0')
  const minutes = String(minute % 60).padStart(2, '0')
  const [y, mo, d] = date.split('-').map(Number)
  const naive = Date.UTC(y, mo - 1, d, Math.floor(minute / 60), minute % 60)
  const candidates = new Set()
  for (const probe of [naive - 86_400_000, naive, naive + 86_400_000])
    candidates.add(naive - offsetAt(probe, timezone))
  const matches = [...candidates]
    .filter((ms) => {
      const fields = localFields(ms, timezone)
      return fields.date === date && fields.time === `${hours}:${minutes}`
    })
    .sort((a, b) => a - b)
  return matches.length ? new Date(matches[0]) : null
}

// ---- weekly windows ----

function assertNonOverlappingWeeklyWindows(windows) {
  const ordered = [...windows].sort(
    (l, r) => l.weekday - r.weekday || l.startMinute - r.startMinute,
  )
  if (
    ordered.some((window, index) => {
      const previous = ordered[index - 1]
      return previous && previous.weekday === window.weekday && previous.endMinute > window.startMinute
    })
  )
    throw fail(400, 'BOOKING_SCHEDULE_INVALID', 'Weekly availability windows must not overlap')
}

export function parseWeeklyWindows(value) {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw fail(400, 'BOOKING_SCHEDULE_INVALID', 'Weekly availability is invalid JSON')
    }
  }
  if (!Array.isArray(parsed))
    throw fail(400, 'BOOKING_SCHEDULE_INVALID', 'Weekly availability must be an array')
  const windows = parsed.map((item) => {
    const window = record(item, 'Every weekly availability window must be an object')
    const weekday = number(window.weekday, -1)
    const startMinute = number(window.startMinute, -1)
    const endMinute = number(window.endMinute, -1)
    if (
      !Number.isInteger(weekday) || weekday < 0 || weekday > 6 ||
      !Number.isInteger(startMinute) || !Number.isInteger(endMinute) ||
      startMinute < 0 || endMinute > 24 * 60 || startMinute >= endMinute
    )
      throw fail(400, 'BOOKING_SCHEDULE_INVALID', 'A weekly availability window is invalid')
    return { weekday, startMinute, endMinute }
  })
  assertNonOverlappingWeeklyWindows(windows)
  return windows
}

/** UI helper. Never throws: { valid, message, windows }. Same rules as the hosted engine. */
export function validateWeeklyWindows(windows) {
  try {
    const parsed = parseWeeklyWindows(windows)
    return { valid: true, message: '', windows: parsed }
  } catch (error) {
    return { valid: false, message: error.message, windows: [] }
  }
}

/** Validates the numeric schedule settings the way hosted does when it reads them. */
export function assertScheduleSettings({ slotIntervalMinutes }) {
  const interval = Number(slotIntervalMinutes)
  if (!Number.isInteger(interval) || interval < 5 || interval > 24 * 60 || interval % 5 !== 0)
    throw fail(400, 'BOOKING_SCHEDULE_INVALID', 'The schedule slot interval must be a five-minute multiple')
}

// ---- keys and ranges ----

export function reservationKey(scheduleId, startsAt) {
  return `${scheduleId}|${new Date(startsAt).toISOString()}`
}

function rangesOverlap(left, right) {
  return (
    Date.parse(left.startsAt) < Date.parse(right.endsAt) &&
    Date.parse(right.startsAt) < Date.parse(left.endsAt)
  )
}

// ---- openings ----

/**
 * schedule: { timezone, slotIntervalMinutes, minimumNoticeMinutes, bookingHorizonDays, weeklyWindows }
 * busy: [{ startsAt, endsAt }] ISO strings. now: Date.
 */
export function listOpenings({ schedule, durationMinutes, fromDate, throughDate, now, busy = [] }) {
  assertTimezone(schedule.timezone)
  assertNonOverlappingWeeklyWindows(schedule.weeklyWindows)
  const from = isoDate(fromDate, 'fromDate')
  const through = isoDate(throughDate, 'throughDate')
  const firstDay = new Date(`${from}T00:00:00.000Z`)
  const lastDay = new Date(`${through}T00:00:00.000Z`)
  const dayCount = Math.floor((lastDay.getTime() - firstDay.getTime()) / 86_400_000) + 1
  if (dayCount < 1 || dayCount > MAX_RANGE_DAYS)
    throw fail(400, 'BOOKING_RANGE_INVALID', 'Availability may cover at most 31 days')
  const interval = schedule.slotIntervalMinutes
  const duration = durationMinutes
  if (!Number.isInteger(interval) || interval < 5 || interval > 24 * 60 || interval % 5 !== 0)
    throw fail(400, 'BOOKING_SCHEDULE_INVALID', 'The schedule slot interval must be a five-minute multiple')
  if (!Number.isInteger(duration) || duration < 5 || duration > interval || duration % 5 !== 0)
    throw fail(400, 'BOOKING_SERVICE_INVALID', 'Service duration must not exceed the schedule slot interval')
  const minimum = now.getTime() + Math.max(0, schedule.minimumNoticeMinutes) * 60_000
  const horizon =
    now.getTime() + Math.min(365, Math.max(1, schedule.bookingHorizonDays)) * 86_400_000
  const openings = []

  for (let offset = 0; offset < dayCount && openings.length < MAX_OPENINGS; offset += 1) {
    const date = new Date(firstDay.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
    const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay()
    for (const window of schedule.weeklyWindows.filter((item) => item.weekday === weekday)) {
      for (let minute = window.startMinute; minute + duration <= window.endMinute; minute += interval) {
        const start = wallClockInstant(date, minute, schedule.timezone)
        if (!start) continue
        const end = new Date(start.getTime() + duration * 60_000)
        if (start.getTime() < minimum || start.getTime() > horizon) continue
        const opening = { startsAt: start.toISOString(), endsAt: end.toISOString() }
        if (busy.some((item) => rangesOverlap(opening, item))) continue
        openings.push({
          ...opening,
          timezone: schedule.timezone,
          localDate: date,
          localTime: localFields(start, schedule.timezone).time,
        })
      }
    }
  }
  return openings
}

// ---- record-level helpers (snake_case table rows) ----

export function scheduleFromRecord(value) {
  const timezone = text(value.timezone, 100)
  assertTimezone(timezone)
  return {
    timezone,
    slotIntervalMinutes: number(value.slot_interval_minutes),
    minimumNoticeMinutes: number(value.minimum_notice_minutes),
    bookingHorizonDays: number(value.booking_horizon_days, 60),
    weeklyWindows: parseWeeklyWindows(value.weekly_windows_json),
  }
}

/** Mirrors hosted subjectAllowsService: profile links list public services; service links allow one service. */
export function serviceAllowed(service, subject = { kind: 'profile' }) {
  if (!subject || subject.kind === 'profile') return service.visibility === 'public'
  return subject.kind === 'service' && text(subject.serviceId, 200) === text(service.id, 200)
}

function busyFor(bookings, scheduleId) {
  return bookings
    .filter((item) => text(item.schedule_id, 200) === scheduleId && text(item.status, 40) !== 'cancelled')
    .flatMap((item) => {
      try {
        return [{ startsAt: isoInstant(item.starts_at, 'starts_at'), endsAt: isoInstant(item.ends_at, 'ends_at') }]
      } catch {
        return []
      }
    })
}

function resolveService({ services, schedules, serviceId, subject }) {
  const service = services.find((item) => text(item.id, 200) === text(serviceId, 200))
  if (!service || !isTruthy(service.active) || !serviceAllowed(service, subject))
    throw fail(404, 'BOOKING_SERVICE_NOT_FOUND', 'This service is unavailable')
  const scheduleId = text(service.schedule_id, 200)
  const scheduleRecord = schedules.find((item) => text(item.id, 200) === scheduleId)
  if (!scheduleRecord || !isTruthy(scheduleRecord.active))
    throw fail(409, 'BOOKING_SCHEDULE_UNAVAILABLE', 'This service has no active availability')
  return { service, scheduleId, scheduleRecord }
}

/** Mirrors hosted listPublicBookingOpenings. Returns { openings }. */
export function listServiceOpenings({
  services, schedules, bookings, serviceId, fromDate, throughDate, now = new Date(), subject,
}) {
  const { service, scheduleId, scheduleRecord } = resolveService({ services, schedules, serviceId, subject })
  return {
    openings: listOpenings({
      schedule: scheduleFromRecord(scheduleRecord),
      durationMinutes: number(service.duration_minutes),
      fromDate: isoDate(fromDate, 'fromDate'),
      throughDate: isoDate(throughDate, 'throughDate'),
      now,
      busy: busyFor(bookings, scheduleId),
    }),
  }
}

/**
 * Mirrors hosted createPublicBooking up to the table write. Returns the validated row fields:
 * { service, scheduleId, opening, contact: { name, email, phone }, notes, reservationKey }.
 */
export function resolveBookingRequest({
  services, schedules, bookings, serviceId, startsAt, contact, notes, now = new Date(), subject,
}) {
  const instant = isoInstant(startsAt, 'startsAt')
  const { service, scheduleId, scheduleRecord } = resolveService({ services, schedules, serviceId, subject })
  const localDate = localFields(instant, scheduleFromRecord(scheduleRecord).timezone).date
  const { openings } = listServiceOpenings({
    services, schedules, bookings, serviceId, fromDate: localDate, throughDate: localDate, now, subject,
  })
  const opening = openings.find((item) => item.startsAt === instant)
  if (!opening) throw fail(409, 'BOOKING_SLOT_TAKEN', 'This time is no longer available')

  const details = record(contact, 'Contact details are required')
  const name = text(details.name, 160)
  const email = text(details.email, 254).toLowerCase()
  const phone = text(details.phone, 40)
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw fail(400, 'BOOKING_CONTACT_INVALID', 'Enter a name and valid email address')
  return {
    service,
    scheduleId,
    opening,
    contact: { name, email, phone },
    notes: text(notes, 2_000),
    reservationKey: reservationKey(scheduleId, opening.startsAt),
  }
}

// ---- owner actions ----

/**
 * Non-cancelled bookings (including time off) on `scheduleId` that overlap [startsAt, endsAt).
 * `ignoreId` skips the booking being moved. Owner actions may ignore weekly windows and notice,
 * but never overlap: the hosted engine would otherwise show a double-booked schedule.
 */
export function findOverlaps(bookings, scheduleId, startsAt, endsAt, ignoreId = '') {
  const range = { startsAt: isoInstant(startsAt, 'startsAt'), endsAt: isoInstant(endsAt, 'endsAt') }
  return busyRecords(bookings, scheduleId).filter(
    ({ item, startsAt: start, endsAt: end }) =>
      text(item.id, 200) !== text(ignoreId, 200) && rangesOverlap(range, { startsAt: start, endsAt: end }),
  ).map(({ item }) => item)
}

function busyRecords(bookings, scheduleId) {
  return bookings
    .filter((item) => text(item.schedule_id, 200) === scheduleId && text(item.status, 40) !== 'cancelled')
    .flatMap((item) => {
      try {
        return [{ item, startsAt: isoInstant(item.starts_at, 'starts_at'), endsAt: isoInstant(item.ends_at, 'ends_at') }]
      } catch {
        return []
      }
    })
}
