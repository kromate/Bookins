import { createSampleHistory } from './history.js'

const clone = (value) => {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

const nextWeekday = (now, offset) => {
  const date = new Date(now)
  date.setUTCDate(date.getUTCDate() + offset)
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1)
  date.setUTCHours(10, 0, 0, 0)
  return date
}

const iso = (date) => date.toISOString()
const ending = (date, minutes) => new Date(date.getTime() + minutes * 60_000).toISOString()

export const createDemoDataset = (now = new Date()) => {
  const upcoming = nextWeekday(now, 2)
  const later = nextWeekday(now, 5)
  const weeklyWindows = [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
  }))

  const dataset = {
    profiles: [{
      id: 'demo-profile',
      display_name: "Amina's Studio",
      bio: 'A focused space for business strategy, creative direction, and practical next steps.',
      photo_url: '',
      timezone: 'UTC',
      public_link_url: '',
      public_link_expires_at: '',
      updated_at: iso(now),
    }],
    schedules: [{
      id: 'demo-schedule',
      name: 'Working hours',
      timezone: 'UTC',
      weekly_windows_json: JSON.stringify(weeklyWindows),
      slot_interval_minutes: 60,
      minimum_notice_minutes: 60,
      booking_horizon_days: 60,
      active: true,
      revision: 'demo-1',
      updated_at: iso(now),
    }],
    services: [
      {
        id: 'demo-service-discovery',
        slug: 'discovery-call',
        name: 'Discovery call',
        description: 'A focused conversation to understand what you need and map the right next step.',
        duration_minutes: 30,
        schedule_id: 'demo-schedule',
        price: 0,
        currency: 'NGN',
        visibility: 'public',
        active: true,
        revision: 'demo-1',
      },
      {
        id: 'demo-service-consultation',
        slug: 'product-consultation',
        name: 'Product consultation',
        description: 'A practical working session for product direction, UX, and execution planning.',
        duration_minutes: 60,
        schedule_id: 'demo-schedule',
        price: 25000,
        currency: 'NGN',
        visibility: 'public',
        active: true,
        revision: 'demo-1',
      },
    ],
    bookings: [
      {
        id: 'demo-booking-ada',
        reference: 'DEMO-2401',
        service_id: 'demo-service-discovery',
        service_name: 'Discovery call',
        schedule_id: 'demo-schedule',
        starts_at: iso(upcoming),
        ends_at: ending(upcoming, 30),
        timezone: 'UTC',
        guest_name: 'Ada Okafor',
        guest_email: 'ada@example.com',
        guest_phone: '+234 800 000 0001',
        notes: 'Fictional sample booking.',
        status: 'confirmed',
        reservation_key: `demo-schedule|${iso(upcoming)}`,
        created_at: iso(now),
      },
      {
        id: 'demo-booking-kwame',
        reference: 'DEMO-2402',
        service_id: 'demo-service-consultation',
        service_name: 'Product consultation',
        schedule_id: 'demo-schedule',
        starts_at: iso(later),
        ends_at: ending(later, 60),
        timezone: 'UTC',
        guest_name: 'Kwame Mensah',
        guest_email: 'kwame@example.com',
        guest_phone: '+233 20 000 0002',
        notes: '',
        status: 'confirmed',
        reservation_key: `demo-schedule|${iso(later)}`,
        created_at: iso(now),
      },
    ],
  }
  const history = createSampleHistory({
    now,
    scheduleId: 'demo-schedule',
    timezone: 'UTC',
    services: dataset.services,
    idPrefix: 'demo',
  })
  dataset.bookings.push(...history.bookings)
  dataset.contacts = history.contacts
  return dataset
}

export { clone }
