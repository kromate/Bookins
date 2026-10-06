// One date format for owner-facing lists: "Mon, 12 Oct 2026".
// Accepts a Date, a timestamp, an ISO instant, or a plain "YYYY-MM-DD" key (treated as a calendar day, no zone shift).
export function formatDay(value, timeZone) {
  const plain = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = plain ? new Date(`${value}T12:00:00Z`) : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  let parts
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: plain ? 'UTC' : timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).formatToParts(date)
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).formatToParts(date)
  }
  const get = (type) => parts.find((part) => part.type === type)?.value || ''
  return `${get('weekday')}, ${get('day')} ${get('month').replace('Sept', 'Sep')} ${get('year')}`
}
