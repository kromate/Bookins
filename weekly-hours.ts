// Weekly working-hours editing helpers (pure). Shared by Availability (the owner and each team member)
// and the Team member dialog. A "day" is { name, weekday, active, windows: [{ start: 'HH:MM', end: 'HH:MM' }] }.
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export const defaultWindow = () => ({ start: '09:00', end: '17:00' })

/** Seven editable days, Monday to Friday open 09:00-17:00. */
export const makeDays = () =>
  DAY_NAMES.map((name, weekday) => ({
    name,
    weekday,
    active: weekday > 0 && weekday < 6,
    windows: [defaultWindow()],
  }))

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/
export function minute(value: unknown) {
  const match = TIME_PATTERN.exec(String(value ?? ''))
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN
}

// A 23:59 end means end of day, so a slot that runs until midnight still fits.
export function endMinute(value: unknown) {
  const parsed = minute(value)
  return parsed === 1439 ? 1440 : parsed
}

export function time(value: unknown) {
  const bounded = Math.min(1439, Math.max(0, Number(value) || 0))
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`
}

export const cloneWindows = (windows: EditableWindow[]) => windows.map((item) => ({ start: item.start, end: item.end }))

/** Plain-language problem with one day, or ''. Mirrors what the hosted engine requires. */
export function dayIssue(day: EditableDay) {
  if (!day.active) return ''
  const parsed = day.windows.map((item) => ({ start: minute(item.start), end: endMinute(item.end) }))
  if (parsed.some((item) => !Number.isFinite(item.start) || !Number.isFinite(item.end)))
    return 'Enter both a start and an end time for every window.'
  if (parsed.some((item) => item.start >= item.end)) return 'Each window needs an end time after its start time.'
  const sorted = [...parsed].sort((left, right) => left.start - right.start)
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]
    const previous = sorted[index - 1]
    if (current && previous && current.start < previous.end) return 'Windows on the same day cannot overlap.'
  }
  return ''
}

export const dayIssues = (days: EditableDay[]) => Object.fromEntries(days.map((day) => [day.weekday, dayIssue(day)]))

export function validWindows(day: EditableDay) {
  return day.windows
    .map((item) => ({ start: minute(item.start), end: endMinute(item.end) }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.start < item.end)
}

/** Total open hours in the week, one decimal. */
export function weeklyHoursTotal(days: EditableDay[]) {
  const total = days.reduce(
    (sum, day) =>
      day.active ? sum + validWindows(day).reduce((inner, item) => inner + item.end - item.start, 0) / 60 : sum,
    0,
  )
  return Math.round(total * 10) / 10
}

/** The `weeklyWindows` input of `saveSchedule`. */
export const weeklyWindowsFromDays = (days: EditableDay[]): WeeklyWindow[] =>
  days
    .filter((day) => day.active)
    .flatMap((day) =>
      day.windows.map((item) => ({ weekday: day.weekday, startMinute: minute(item.start), endMinute: endMinute(item.end) })),
    )

export const windowsAreSaveable = (windows: WeeklyWindow[]) =>
  windows.length > 0 &&
  windows.every(
    (item) =>
      Number.isInteger(item.startMinute) &&
      Number.isInteger(item.endMinute) &&
      item.startMinute >= 0 &&
      item.endMinute <= 1440 &&
      item.startMinute < item.endMinute,
  )

/** Fills `days` (in place) from a saved schedule. Throws when the stored JSON is unreadable. */
export function applyScheduleToDays(days: EditableDay[], schedule: ScheduleRecord | null | undefined) {
  const windows: unknown = JSON.parse(schedule?.weekly_windows_json || '[]')
  if (!Array.isArray(windows)) throw new Error('not an array')
  days.forEach((day) => {
    const own = windows
      .filter((item): item is WeeklyWindow => Boolean(item) && typeof item === 'object' && Number.isFinite((item as UnknownRecord).weekday) && Number.isFinite((item as UnknownRecord).startMinute) && Number.isFinite((item as UnknownRecord).endMinute))
      .filter((item) => item.weekday === day.weekday)
      .sort((left, right) => left.startMinute - right.startMinute)
    day.active = own.length > 0
    day.windows = own.length
      ? own.map((item) => ({ start: time(item.startMinute), end: time(item.endMinute) }))
      : [defaultWindow()]
  })
}

/** Copies one set of days onto another (same weekday order). */
export function copyDaysInto(target: EditableDay[], source: EditableDay[]) {
  source.forEach((day, index) => {
    if (!target[index]) return
    target[index].active = day.active
    target[index].windows = cloneWindows(day.windows)
  })
}

/** Same hours? Used to detect edits and to flag identical calendars. */
export const daysSignature = (days: EditableDay[]) =>
  JSON.stringify(days.map(({ weekday, active, windows }) => [weekday, active, active ? windows.map(({ start, end }) => [start, end]) : []]))

const ORDER = [1, 2, 3, 4, 5, 6, 0] // Monday first
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * One-line summary of a saved schedule, e.g. "Mon-Sat 10:00-18:00". Returns
 * { text, hoursPerWeek, openDays }. A missing or unreadable schedule is "No hours set".
 */
export function summarizeHours(schedule: ScheduleRecord | null | undefined) {
  let windows: WeeklyWindow[] = []
  try {
    const parsed: unknown = JSON.parse(schedule?.weekly_windows_json || '[]')
    if (Array.isArray(parsed)) windows = parsed.filter((item): item is WeeklyWindow => Boolean(item) && typeof item === 'object' && Number.isFinite((item as UnknownRecord).weekday) && Number.isFinite((item as UnknownRecord).startMinute) && Number.isFinite((item as UnknownRecord).endMinute))
  } catch { /* unreadable: treated as no hours */ }
  windows = windows.filter((item) => Number.isFinite(item?.startMinute) && Number.isFinite(item?.endMinute) && item.startMinute < item.endMinute)
  if (!windows.length) return { text: 'No hours set', hoursPerWeek: 0, openDays: 0 }
  const label = (weekday: number) =>
    windows
      .filter((item) => item.weekday === weekday)
      .sort((a, b) => a.startMinute - b.startMinute)
      .map((item) => `${time(item.startMinute)}-${item.endMinute >= 1440 ? '24:00' : time(item.endMinute)}`)
      .join(', ')
  const groups: Array<{ from: number; to: number; text: string }> = []
  for (const weekday of ORDER) {
    const text = label(weekday)
    if (!text) continue
    const last = groups.at(-1)
    if (last && last.text === text && ORDER.indexOf(last.to) === ORDER.indexOf(weekday) - 1) last.to = weekday
    else groups.push({ from: weekday, to: weekday, text })
  }
  const hoursPerWeek = Math.round((windows.reduce((sum, item) => sum + item.endMinute - item.startMinute, 0) / 60) * 10) / 10
  const parts = groups.map((group) => `${group.from === group.to ? SHORT[group.from] : `${SHORT[group.from]}-${SHORT[group.to]}`} ${group.text}`)
  return {
    text: parts.length > 3 ? `${new Set(windows.map((item) => item.weekday)).size} days a week, hours vary` : parts.join('; '),
    hoursPerWeek,
    openDays: new Set(windows.map((item) => item.weekday)).size,
  }
}

// ---- start-time interval ----
// The engine accepts any interval that is a multiple of 5 minutes up to 1440, and reserves exactly one
// interval per booking, so a service can be no longer than its schedule's interval. Long hair services
// (3 to 8 hours) therefore need a long interval.
export const INTERVAL_CHOICES = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 420, 480, 600, 720, 1440]
const isIntervalValue = (value: number) => Number.isInteger(value) && value >= 5 && value <= 1440 && value % 5 === 0

/** "4 hours", "2.5 hours", "45 minutes" (readable length). */
export function durationWords(minutes: unknown) {
  const value = Number(minutes)
  if (!Number.isFinite(value)) return ''
  if (value < 60) return `${value} ${value === 1 ? 'minute' : 'minutes'}`
  const hours = Math.round((value / 60) * 100) / 100
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

/** "Every 240 minutes (4 hours)". */
export const intervalLabel = (minutes: number) => `Every ${minutes} minutes${minutes >= 90 ? ` (${durationWords(minutes)})` : ''}`

/**
 * The smallest offered interval that fits a service of `maxDuration` minutes, or 0 when there is no service.
 * Falls back to the next whole hour (capped at 1440) for unusual lengths.
 */
export function smallestIntervalFor(maxDuration: unknown) {
  const need = Math.ceil(Number(maxDuration) || 0)
  if (need <= 0) return 0
  const choice = INTERVAL_CHOICES.find((value) => value >= need)
  if (choice) return choice
  return Math.min(1440, Math.ceil(need / 60) * 60)
}

/**
 * Select options for the interval field: `{ value, label, disabled }`. Intervals shorter than the longest service
 * (`maxDuration`) are disabled and say why. `current` is always listed, even when it is not a standard choice.
 * With `strict: false` nothing is disabled (used where the owner may deliberately choose a shorter interval).
 */
export function intervalOptionsFor(maxDuration: unknown = 0, current: unknown = 0, { strict = true }: { strict?: boolean } = {}) {
  const need = Number(maxDuration) || 0
  const values = new Set(INTERVAL_CHOICES)
  const now = Number(current)
  if (isIntervalValue(now)) values.add(now)
  const smallest = smallestIntervalFor(need)
  if (smallest) values.add(smallest)
  return [...values]
    .sort((left, right) => left - right)
    .map((value) => {
      const short = need > value
      return {
        value,
        label: intervalLabel(value) + (short ? ' - too short for a service' : ''),
        disabled: strict && short,
      }
    })
}

/** Reads `?interval=` from a route query: a whole multiple of 5 from 5 to 1440, else 0. */
export function intervalFromQuery(raw: unknown) {
  const value = Number(Array.isArray(raw) ? raw[0] : raw)
  return isIntervalValue(value) ? value : 0
}
