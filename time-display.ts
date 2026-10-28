function dateFrom(value: TimestampInput): Date {
  if (value instanceof Date) return value
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate()
  if (value && typeof value === 'object' && '_seconds' in value) return new Date(Number(value._seconds) * 1000 + Number(value._nanoseconds ?? 0) / 1_000_000)
  return new Date(typeof value === 'string' || typeof value === 'number' ? value : '')
}

export function displayTimeZone(value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format(0)
      return value
    } catch { /* Invalid external timezone: display and label the same UTC fallback. */ }
  }
  return 'UTC'
}

// One way to name a zone on every screen: the IANA id with spaces ("America/New York").
const zoneName = (zone: string) => zone.replaceAll('_', ' ')

/** Every zone as a picker option, labelled the same way as zoneDisplayLabel names it ("Africa/Lagos"). */
export function timezoneOptions(current?: string) {
  const zones = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Cairo', 'Africa/Casablanca']
  return [...new Set(['UTC', ...zones, ...(current ? [current] : [])])]
    .map(value => ({ value, label: zoneName(value) }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

export function detectGuestTimeZone() {
  try {
    return displayTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  } catch {
    return 'UTC'
  }
}

// Owner screens only; the public /book page keeps its own guest and host zones.
let ownerDeviceZone: string | undefined
/** The owner's zone before one is saved: this device's zone (validated, UTC if unavailable), read once per page load so it never shifts mid-edit. */
export function ownerDefaultTimeZone() {
  ownerDeviceZone ??= detectGuestTimeZone()
  return ownerDeviceZone
}

/** Owner display zone. A saved value from the caller's own schedule/profile/booking chain is shown as displayTimeZone shows it (invalid stays UTC); only nothing saved uses ownerDefaultTimeZone(). */
export function ownerTimeZone(saved: unknown) {
  return saved ? displayTimeZone(saved) : ownerDefaultTimeZone()
}

/** Suggested zone for an unsaved owner draft (schedule or team hours): a valid saved profile zone, else ownerDefaultTimeZone(). */
export function ownerDraftTimeZone(profileZone: unknown) {
  return typeof profileZone === 'string' && profileZone && displayTimeZone(profileZone) === profileZone ? profileZone : ownerDefaultTimeZone()
}

const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>()
/** Calendar date (YYYY-MM-DD) of an instant as seen in the given IANA zone. */
export function zonedDateKey(value: TimestampInput, timeZone: string) {
  const zone = displayTimeZone(timeZone)
  let formatter = dateKeyFormatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    dateKeyFormatters.set(zone, formatter)
  }
  const parts = Object.fromEntries(formatter.formatToParts(dateFrom(value)).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function icsStamp(value: TimestampInput) {
  return dateFrom(value).toISOString().replace(/[-:]|\.\d{3}/g, '')
}

function icsText(value: unknown) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
}

function icsFold(line: string) {
  const chunks: string[] = []
  let rest = line
  while (rest.length > 73) {
    chunks.push(rest.slice(0, 73))
    rest = ` ${rest.slice(73)}`
  }
  chunks.push(rest)
  return chunks.join('\r\n')
}

/** Guest-side iCalendar text for a confirmed booking. Nothing is sent to any provider. */
export function buildBookingIcs({ reference, summary, description = '', startsAt, endsAt }: { reference: string; summary: string; description?: string; startsAt: TimestampInput; endsAt: TimestampInput }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Goalmatic//Bookins//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsText(reference)}@bookins.goalmatic`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(startsAt)}`,
    `DTEND:${icsStamp(endsAt)}`,
    `SUMMARY:${icsText(summary)}`,
    ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.map(icsFold).join('\r\n')}\r\n`
}

export function googleCalendarUrl({ summary, description = '', startsAt, endsAt }: { summary: string; description?: string; startsAt: TimestampInput; endsAt: TimestampInput }) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: summary,
    dates: `${icsStamp(startsAt)}/${icsStamp(endsAt)}`,
    details: description,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** Zone name with its short abbreviation, localized, e.g. "Africa/Lagos (WAT)". */
export function zoneDisplayLabel(zone: string, locale = 'en', at: Date = new Date()) {
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(at)
      .find(item => item.type === 'timeZoneName')
    return part && part.value !== zone ? `${zoneName(zone)} (${part.value})` : zoneName(zone)
  } catch {
    return zoneName(zone)
  }
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>()
/** One clock format per locale (fr: 24h "09:00", others: "9:00 AM") so every screen agrees. */
export function formatClock(value: TimestampInput, locale = 'en', timeZone = 'UTC') {
  const zone = displayTimeZone(timeZone)
  const cacheKey = `${locale}|${zone}`
  let formatter = clockFormatters.get(cacheKey)
  if (!formatter) {
    const french = String(locale).toLowerCase().startsWith('fr')
    formatter = new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      minute: '2-digit',
      ...(french ? { hour: '2-digit', hourCycle: 'h23' } : { hour: 'numeric' }),
    })
    clockFormatters.set(cacheKey, formatter)
  }
  return formatter.format(dateFrom(value))
}

/** Date plus the shared clock format, e.g. "Mon, 12 Oct 2026 · 9:00 AM". */
export function formatDateClock(value: TimestampInput, locale = 'en', timeZone = 'UTC', dateStyle: Intl.DateTimeFormatOptions['dateStyle'] = 'medium') {
  const zone = displayTimeZone(timeZone)
  const date = dateFrom(value).toLocaleDateString(locale, { dateStyle, timeZone: zone })
  return `${date} · ${formatClock(value, locale, zone)}`
}

const clockModeFormatters = new Map<string, Intl.DateTimeFormat>()
/** Clock with an explicit 12h/24h choice (the guest's toggle). mode: '12h' | '24h'. */
export function formatClockMode(value: TimestampInput, locale = 'en', timeZone = 'UTC', mode: '12h' | '24h' = '12h') {
  const zone = displayTimeZone(timeZone)
  const cacheKey = `${locale}|${zone}|${mode}`
  let formatter = clockModeFormatters.get(cacheKey)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      minute: '2-digit',
      ...(mode === '24h' ? { hour: '2-digit', hourCycle: 'h23' } : { hour: 'numeric', hour12: true }),
    })
    clockModeFormatters.set(cacheKey, formatter)
  }
  return formatter.format(dateFrom(value))
}

/** Locale default for the 12h/24h toggle (French is 24h, everything else 12h). */
export function defaultClockMode(locale = 'en'): '12h' | '24h' {
  return String(locale).toLowerCase().startsWith('fr') ? '24h' : '12h'
}

const FALLBACK_ZONES = ['Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Cairo', 'Africa/Casablanca', 'Africa/Abidjan', 'Europe/London', 'Europe/Paris', 'America/New_York']
let zoneCache: string[] | undefined
/** Every IANA zone the runtime knows (UTC first), cached. */
export function allTimeZones() {
  if (!zoneCache) {
    let zones: string[]
    try { zones = Intl.supportedValuesOf('timeZone') } catch { zones = FALLBACK_ZONES }
    zoneCache = ['UTC', ...zones.filter(zone => zone !== 'UTC')]
  }
  return zoneCache
}

const plain = (value: unknown) => String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_/]+/g, ' ').trim()
let abbreviations: Map<string, string> | undefined
/** Short names ("WAT", "GMT+1") for abbreviation search; built lazily because it creates one formatter per zone. */
function zoneAbbreviation(zone: string) {
  abbreviations ??= new Map()
  if (!abbreviations.has(zone)) abbreviations.set(zone, zoneDisplayLabel(zone, 'en').toLowerCase())
  return abbreviations.get(zone) ?? ''
}

/**
 * Searchable time-zone list: `pinned` zones (current, device, host) first, then every match of all the
 * query words against the zone id ("lagos", "africa lagos", "new york"), falling back to the short name
 * ("wat", "gmt+1") when the id matches nothing.
 */
export function searchTimeZones(query: unknown, { pinned = [], limit = 80 }: { pinned?: string[]; limit?: number } = {}) {
  const words = plain(query).split(/\s+/).filter(Boolean)
  const pool = allTimeZones()
  const ordered = [...new Set([...pinned.filter(Boolean), ...pool])]
  if (!words.length) return ordered.slice(0, limit)
  let hits = ordered.filter(zone => words.every(word => plain(zone).includes(word)))
  if (!hits.length) hits = ordered.filter(zone => words.every(word => zoneAbbreviation(zone).includes(word)))
  return hits.slice(0, limit)
}
