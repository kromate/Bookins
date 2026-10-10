export const BOOKING_THEMES = [
  { id: 'indigo', label: 'Indigo', description: 'Clear and confident', accent: '#2336dc', background: '#f3f5fc', card: '#ffffff', ink: '#172039', muted: '#56617a' },
  { id: 'sage', label: 'Sage', description: 'Calm and welcoming', accent: '#23644b', background: '#f1f6f2', card: '#ffffff', ink: '#183329', muted: '#52695c' },
  { id: 'sand', label: 'Sand', description: 'Warm and personal', accent: '#995a34', background: '#faf5ee', card: '#fffcf7', ink: '#38291f', muted: '#756354' },
  { id: 'midnight', label: 'Midnight', description: 'Quiet and focused', accent: '#a8b8ff', background: '#111621', card: '#1b2231', ink: '#f1f4fc', muted: '#b2bdd3' },
]

export const BOOKING_LAYOUTS = [
  { value: 'month', label: 'Month calendar' },
  { value: 'week', label: 'Week at a glance' },
  { value: 'column', label: 'Times by day' },
]

export function normalizeBookingAppearance(value) {
  let input = value
  if (typeof input === 'string') {
    try { input = JSON.parse(input) } catch { input = null }
  }
  const theme = input?.theme === 'dark' ? 'midnight' : input?.theme === 'light' ? 'indigo' : input?.theme
  return {
    theme: BOOKING_THEMES.some(item => item.id === theme) ? theme : 'indigo',
    layout: BOOKING_LAYOUTS.some(item => item.value === input?.layout) ? input.layout : 'month',
  }
}

export function bookingTheme(value) {
  const appearance = normalizeBookingAppearance(value)
  return BOOKING_THEMES.find(item => item.id === appearance.theme)
}
