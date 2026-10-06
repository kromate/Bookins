export const demoGuideRoutes = Object.freeze([
  '/',
  '/services',
  '/availability',
  '/bookings',
  '/demo/guest',
])

export const demoGuideSteps = Object.freeze([
  {
    id: 'overview',
    route: '/',
    title: 'See the owner overview',
    explanation: 'The overview brings services, availability, the booking link area, and upcoming sample bookings together. These records are fictional.',
    expected: 'You can see how an owner checks the day without changing an account.',
  },
  {
    id: 'services',
    route: '/services',
    title: 'Review bookable services',
    explanation: 'Services define what guests can choose, how long each session takes, and whether it appears publicly. Demo controls cannot save or remove services.',
    expected: 'You can compare the prepared service names, durations, prices, and visibility.',
  },
  {
    id: 'availability',
    route: '/availability',
    title: 'Review weekly availability',
    explanation: 'Availability sets the weekly hours and booking rules that shape the times guests can see. The Demo schedule is read-only.',
    expected: 'You can read the sample hours, timezone, notice, and booking horizon.',
  },
  {
    id: 'bookings',
    route: '/bookings',
    title: 'Review upcoming bookings',
    explanation: 'Bookings shows the guest, service, time, and status for prepared appointments. Cancellation is disabled in Demo.',
    expected: 'You can inspect the sample booking history without changing it.',
  },
  {
    id: 'guest-preview',
    route: '/demo/guest',
    title: 'Open the labelled guest preview',
    explanation: 'Guest preview shows the same kind of public service and availability page a guest would read. It uses separate fictional data and does not use a grant or create a reservation.',
    expected: 'You can explore services and times, while the booking confirmation action stays unavailable.',
  },
])
