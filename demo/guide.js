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

// Live (owner) tour. Steps only navigate and highlight; they never write data. `anchor` is the `data-tour` value a page
// must carry (see "Foundation as implemented" in .audit/bookings-2026-10-06/15-walkthrough-help-spec.md).
// Steps whose anchor is not on the page are skipped silently.
export const liveGuideRoutes = Object.freeze(['/', '/settings', '/availability', '/services', '/bookings', '/contacts', '/insights'])

export const liveGuideSteps = Object.freeze([
  { id: 'welcome', route: '/', targetId: 'tour-overview-checklist', title: 'Start with the checklist', explanation: 'This checklist is the order that works: profile, availability, a service, then your booking link.' },
  { id: 'profile', route: '/settings', targetId: 'tour-settings-profile', title: 'Your public profile', explanation: 'Your name and public details appear on your booking page.' },
  { id: 'availability', route: '/availability', targetId: 'tour-availability-hours', title: 'Set your weekly hours', explanation: 'Set the hours guests can book first. Services need this before they can be created. Save availability and you will see a confirmation.' },
  { id: 'timeoff', route: '/availability', targetId: 'tour-availability-timeoff', title: 'Block time off', explanation: 'Block days off here. Blocked time never shows to guests and is not counted as a booking.' },
  { id: 'services', route: '/services', targetId: 'tour-services-new', title: 'Create a service', explanation: 'Create what guests can book. Each service uses your shared availability.', requires: 'availability' },
  { id: 'link', route: '/settings', targetId: 'tour-settings-link', title: 'Publish your booking link', explanation: 'Create your booking link, then share it or add the button to your site.' },
  { id: 'bookings', route: '/bookings', targetId: 'tour-bookings-list', title: 'Confirmed bookings', explanation: 'Confirmed appointments land here. Guest messages open in your own WhatsApp, SMS or email app. Bookins does not send them for you.' },
  { id: 'contacts', route: '/contacts', targetId: 'tour-contacts-list', title: 'Your contacts', explanation: 'Guests you have booked are kept here with private notes.' },
  { id: 'insights', route: '/insights', targetId: 'tour-insights-summary', title: 'Insights', explanation: 'Counts here exclude time off.' },
  { id: 'done', route: '/', targetId: 'tour-help-button', title: 'Replay any time', explanation: 'Replay this tour whenever you like from Help.' },
])
