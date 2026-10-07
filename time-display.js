export function displayTimeZone(value) {
  if (typeof value === 'string' && value.trim()) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format(0)
      return value
    } catch { /* Invalid external timezone: display and label the same UTC fallback. */ }
  }
  return 'UTC'
}

export function timezoneOptions(current) {
  const zones = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Cairo', 'Africa/Casablanca']
  return [...new Set(['UTC', ...zones, ...(current ? [current] : [])])].map(value => {
    const parts = value.split('/')
    const city = parts.pop().replaceAll('_', ' ')
    return { value, label: parts.length ? `${city} — ${parts.join(' / ').replaceAll('_', ' ')}` : city }
  }).sort((left, right) => left.label.localeCompare(right.label))
}

export function detectGuestTimeZone() {
  try {
    return displayTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  } catch {
    return 'UTC'
  }
}

const dateKeyFormatters = new Map()
/** Calendar date (YYYY-MM-DD) of an instant as seen in the given IANA zone. */
export function zonedDateKey(value, timeZone) {
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
  const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function icsStamp(value) {
  return new Date(value).toISOString().replace(/[-:]|\.\d{3}/g, '')
}

function icsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
}

function icsFold(line) {
  const chunks = []
  let rest = line
  while (rest.length > 73) {
    chunks.push(rest.slice(0, 73))
    rest = ` ${rest.slice(73)}`
  }
  chunks.push(rest)
  return chunks.join('\r\n')
}

/** Guest-side iCalendar text for a confirmed booking. Nothing is sent to any provider. */
export function buildBookingIcs({ reference, summary, description = '', startsAt, endsAt }) {
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

export function googleCalendarUrl({ summary, description = '', startsAt, endsAt }) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: summary,
    dates: `${icsStamp(startsAt)}/${icsStamp(endsAt)}`,
    details: description,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** Zone name with its short abbreviation, localized, e.g. "Africa/Lagos (WAT)". */
export function zoneDisplayLabel(zone, locale = 'en', at = new Date()) {
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(at)
      .find(item => item.type === 'timeZoneName')
    return part ? `${zone.replaceAll('_', ' ')} (${part.value})` : zone
  } catch {
    return zone
  }
}

const clockFormatters = new Map()
/** One clock format per locale (fr: 24h "09:00", others: "9:00 AM") so every screen agrees. */
export function formatClock(value, locale = 'en', timeZone = 'UTC') {
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
  return formatter.format(new Date(value))
}

/** Date plus the shared clock format, e.g. "Mon, 12 Oct 2026 · 9:00 AM". */
export function formatDateClock(value, locale = 'en', timeZone = 'UTC', dateStyle = 'medium') {
  const zone = displayTimeZone(timeZone)
  const date = new Date(value).toLocaleDateString(locale, { dateStyle, timeZone: zone })
  return `${date} · ${formatClock(value, locale, zone)}`
}

const clockModeFormatters = new Map()
/** Clock with an explicit 12h/24h choice (the guest's toggle). mode: '12h' | '24h'. */
export function formatClockMode(value, locale = 'en', timeZone = 'UTC', mode = '12h') {
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
  return formatter.format(new Date(value))
}

/** Locale default for the 12h/24h toggle (French is 24h, everything else 12h). */
export function defaultClockMode(locale = 'en') {
  return String(locale).toLowerCase().startsWith('fr') ? '24h' : '12h'
}
