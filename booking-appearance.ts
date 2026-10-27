// Guest booking page themes. IDs are stored on profiles and links, so they never change; the colours may.
// `onAccent` is the text colour on an accent fill (a selected day or time), dark on Midnight's light accent.
export const BOOKING_THEMES = [
  { id: 'indigo', label: 'Indigo', description: 'Clear and confident', accent: '#2e3fa8', onAccent: '#ffffff', background: '#f4f5f8', card: '#ffffff', ink: '#1a1f3d', muted: '#5b6273' },
  { id: 'sage', label: 'Sage', description: 'Calm and welcoming', accent: '#2f6b52', onAccent: '#ffffff', background: '#f1f5f2', card: '#ffffff', ink: '#17302a', muted: '#52665c' },
  { id: 'sand', label: 'Sand', description: 'Warm and personal', accent: '#6f4e0f', onAccent: '#ffffff', background: '#f5f1e8', card: '#fffdf8', ink: '#2f2618', muted: '#6b5d48' },
  { id: 'midnight', label: 'Midnight', description: 'Quiet and focused', accent: '#a9b6ff', onAccent: '#141833', background: '#141833', card: '#1d2244', ink: '#eef0fb', muted: '#b3b9d6' },
]

export const BOOKING_LAYOUTS = [
  { value: 'month', label: 'Month calendar' },
  { value: 'week', label: 'Week at a glance' },
  { value: 'column', label: 'Times by day' },
]

export type BookingThemeId = (typeof BOOKING_THEMES)[number]['id']
export type BookingLayoutId = (typeof BOOKING_LAYOUTS)[number]['value']

export function normalizeBookingAppearance(value: unknown): { theme: BookingThemeId; layout: BookingLayoutId } {
  let input = value
  if (typeof input === 'string') {
    try { input = JSON.parse(input) } catch { input = null }
  }
  const record = input && typeof input === 'object' && !Array.isArray(input) ? input as UnknownRecord : {}
  const theme = record.theme === 'dark' ? 'midnight' : record.theme === 'light' ? 'indigo' : record.theme
  return {
    theme: BOOKING_THEMES.some(item => item.id === theme) ? theme as BookingThemeId : 'indigo',
    layout: BOOKING_LAYOUTS.some(item => item.value === record.layout) ? record.layout as BookingLayoutId : 'month',
  }
}

export function bookingTheme(value: unknown) {
  const appearance = normalizeBookingAppearance(value)
  return BOOKING_THEMES.find(item => item.id === appearance.theme) ?? BOOKING_THEMES[0]!
}
