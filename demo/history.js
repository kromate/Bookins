import { localFields, wallClockInstant } from '../scheduling.js'
import { splitDescription, withMeta } from '../service-meta.js'

// Fictional clients shared by the Demo workspace and the localhost sample workspace.
export const SAMPLE_CLIENTS = [
  { name: 'Ada Okafor', email: 'ada@example.com', phone: '+234 803 555 0182' },
  { name: 'Kwame Mensah', email: 'kwame@example.com', phone: '+233 24 555 0190' },
  { name: 'Wanjiru Kamau', email: 'wanjiru@example.com', phone: '+254 712 555 014' },
  { name: 'Thandiwe Nkosi', email: 'thandiwe@example.com', phone: '+27 82 555 0147' },
  { name: 'Moussa Diop', email: 'moussa@example.com', phone: '+221 77 555 0123' },
  { name: 'Chiamaka Eze', email: 'chiamaka@example.com', phone: '0805 555 0133' },
  { name: 'Funmilayo Bello', email: 'funmi@example.com', phone: '+234 806 555 0171' },
  { name: 'Tunde Adeyemi', email: 'tunde@example.com', phone: '+234 809 555 0126' },
]

// Deterministic pattern: [days ago, start hour, client index, service index, status].
const PAST = [
  [3, 10, 0, 1, 'completed'],
  [4, 14, 2, 0, 'completed'],
  [6, 11, 3, 1, 'no_show'],
  [8, 9, 1, 0, 'completed'],
  [10, 15, 4, 1, 'completed'],
  [11, 10, 5, 0, 'cancelled'],
  [13, 13, 0, 1, 'completed'],
  [17, 10, 2, 1, 'completed'],
  [20, 16, 3, 0, 'completed'],
  [24, 11, 1, 1, 'no_show'],
  [27, 9, 4, 0, 'completed'],
  [31, 14, 0, 0, 'completed'],
  [38, 10, 5, 1, 'completed'],
  [45, 12, 2, 0, 'confirmed'],
  // A lapsed client (no visit in 95 days) and a brand-new client this month, so Campaigns presets show results.
  [95, 11, 6, 0, 'completed'],
  [2, 12, 7, 1, 'completed'],
]

function localDateOffset(now, days, timezone) {
  const day = new Date(`${localFields(now, timezone).date}T12:00:00.000Z`)
  day.setUTCDate(day.getUTCDate() + days)
  return day.toISOString().slice(0, 10)
}

/**
 * Past bookings with completed / no-show / cancelled outcomes, one upcoming time-off block,
 * and client records, so Insights, statuses, and Contacts have realistic data.
 */
export function createSampleHistory({ now = new Date(), scheduleId, timezone, services, idPrefix }) {
  const bookings = []
  PAST.forEach(([daysAgo, hour, clientIndex, serviceIndex, status], index) => {
    const service = services[serviceIndex % services.length]
    const client = SAMPLE_CLIENTS[clientIndex]
    const startsAt = wallClockInstant(localDateOffset(now, -daysAgo, timezone), hour * 60, timezone)
    if (!startsAt) return
    const endsAt = new Date(startsAt.getTime() + Number(service.duration_minutes) * 60_000)
    const created = new Date(startsAt.getTime() - (2 + (index % 5)) * 86_400_000)
    bookings.push({
      id: `${idPrefix}-history-${index + 1}`,
      reference: `BK-HIST${String(index + 1).padStart(4, '0')}`,
      service_id: service.id,
      service_name: service.name,
      schedule_id: scheduleId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      timezone,
      guest_name: client.name,
      guest_email: client.email,
      guest_phone: client.phone,
      notes: '',
      owner_notes: status === 'no_show' ? 'Did not arrive; no message.' : '',
      status,
      source: index % 4 === 0 ? 'owner' : 'guest',
      reservation_key: status === 'cancelled' ? `released:${idPrefix}-history-${index + 1}` : `${scheduleId}|${startsAt.toISOString()}`,
      created_at: created.toISOString(),
      ...(status === 'cancelled' ? { cancelled_at: created.toISOString(), cancellation_reason: 'Client travelling' } : {}),
    })
  })
  const offStart = wallClockInstant(localDateOffset(now, 9, timezone), 13 * 60, timezone)
  if (offStart) {
    bookings.push({
      id: `${idPrefix}-time-off`,
      reference: 'OFF-SAMPLE01',
      service_id: 'time-off',
      service_name: 'Time off',
      schedule_id: scheduleId,
      starts_at: offStart.toISOString(),
      ends_at: new Date(offStart.getTime() + 4 * 3_600_000).toISOString(),
      timezone,
      guest_name: 'Team training',
      guest_email: 'time-off@bookins.invalid',
      guest_phone: '',
      notes: 'Team training',
      status: 'blocked',
      source: 'owner',
      reservation_key: `block:${idPrefix}-time-off`,
      created_at: now.toISOString(),
    })
  }
  const contacts = [
    { id: `${idPrefix}-contact-ada`, email: 'ada@example.com', name: 'Ada Okafor', phone: '+234 803 555 0182', notes: 'Prefers morning sessions. Building a client portal.', tags_json: JSON.stringify(['VIP', 'Returning']), updated_at: now.toISOString() },
    { id: `${idPrefix}-contact-thandiwe`, email: 'thandiwe@example.com', name: 'Thandiwe Nkosi', phone: '+27 82 555 0147', notes: 'Missed one session; send a reminder the day before.', tags_json: JSON.stringify(['Remind']), updated_at: now.toISOString() },
    {
      id: `${idPrefix}-contact-moussa`,
      email: 'moussa@example.com',
      name: 'Moussa Diop',
      phone: '+221 77 555 0123',
      notes: 'Asked us to stop marketing messages. Appointment reminders are still fine.',
      tags_json: JSON.stringify([]),
      marketing_opt_out: true,
      marketing_opt_out_at: new Date(now.getTime() - 20 * 86_400_000).toISOString(),
      updated_at: now.toISOString(),
    },
  ]
  return { bookings, contacts }
}

/** A service record with its category, order, rebook and prep metadata written as fields and trailer. */
export function sampleService(base, { category = '', sortOrder, rebookAfterDays, prepNotes = '' } = {}) {
  return {
    ...base,
    description: withMeta(base.description, { c: category, o: sortOrder, p: prepNotes }),
    category,
    ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
    ...(rebookAfterDays !== undefined ? { rebook_after_days: rebookAfterDays } : {}),
    prep_notes: prepNotes,
  }
}

/**
 * Two team members, each with their own schedule and a service copy, plus a few bookings assigned
 * to them (past completed and upcoming confirmed), and one draft campaign. The owner stays implicit.
 */
export function createSampleTeam({ now = new Date(), timezone, idPrefix, baseService }) {
  const windows = JSON.stringify([1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 10 * 60, endMinute: 18 * 60 })))
  const members = [
    { key: 'amaka', name: 'Amaka Eze', role: 'Senior stylist', color: '#c2410c', phone: '+234 802 555 0111' },
    { key: 'tolu', name: 'Tolu Adebayo', role: 'Stylist', color: '#0e7490', phone: '+234 802 555 0122' },
  ]
  const schedules = []
  const staff = []
  const services = []
  const bookings = []
  members.forEach((member, memberIndex) => {
    const scheduleId = `${idPrefix}-schedule-${member.key}`
    const staffId = `${idPrefix}-staff-${member.key}`
    schedules.push({
      id: scheduleId,
      name: `${member.name} hours`,
      timezone,
      weekly_windows_json: windows,
      slot_interval_minutes: 60,
      minimum_notice_minutes: 60,
      booking_horizon_days: 60,
      active: true,
      revision: `${idPrefix}-1`,
      updated_at: now.toISOString(),
    })
    staff.push({
      id: staffId,
      name: member.name,
      role: member.role,
      photo_url: '',
      color: member.color,
      phone: member.phone,
      email: `${member.key}@example.com`,
      active: true,
      schedule_id: scheduleId,
      service_ids_json: JSON.stringify([baseService.id]),
      is_owner: false,
      revision: `${idPrefix}-1`,
      updated_at: now.toISOString(),
    })
    const copyId = `${idPrefix}-service-2-${member.key}`
    services.push({
      ...baseService,
      id: copyId,
      slug: `${baseService.slug}-${member.key}`,
      description: withMeta(splitDescription(baseService.description).text, {
        c: baseService.category,
        o: baseService.sort_order,
        s: staffId,
        n: member.name,
        b: baseService.id,
        p: baseService.prep_notes,
      }),
      schedule_id: scheduleId,
    })
    // [days from now, hour, client index, status]
    const plan = memberIndex === 0
      ? [[-5, 11, 2, 'completed'], [-12, 14, 3, 'completed'], [1, 11, 5, 'confirmed']]
      : [[-8, 10, 4, 'completed'], [-19, 15, 0, 'no_show'], [1, 14, 1, 'confirmed']]
    plan.forEach(([days, hour, clientIndex, status], index) => {
      const startsAt = wallClockInstant(localDateOffset(now, days, timezone), hour * 60, timezone)
      if (!startsAt) return
      const client = SAMPLE_CLIENTS[clientIndex]
      const id = `${idPrefix}-team-${member.key}-${index + 1}`
      bookings.push({
        id,
        reference: `BK-TEAM${memberIndex + 1}${index + 1}00`,
        service_id: copyId,
        service_name: baseService.name,
        schedule_id: scheduleId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + Number(baseService.duration_minutes) * 60_000).toISOString(),
        timezone,
        guest_name: client.name,
        guest_email: client.email,
        guest_phone: client.phone,
        notes: '',
        owner_notes: '',
        status,
        source: 'guest',
        staff_id: staffId,
        staff_name: member.name,
        reservation_key: `${scheduleId}|${startsAt.toISOString()}`,
        created_at: new Date(startsAt.getTime() - 3 * 86_400_000).toISOString(),
      })
    })
  })
  const campaigns = [
    {
      id: `${idPrefix}-campaign-welcome-back`,
      name: 'Welcome back: 10% off',
      segment_json: JSON.stringify({ visitsAtLeast: 1, noVisitSinceDays: 30 }),
      template_json: JSON.stringify({ channel: 'whatsapp' }),
      offer_text: '10% off your next visit if you book before the end of the month.',
      offer_code: 'WELCOME10',
      status: 'draft',
      audience_count: 0,
      created_at: now.toISOString(),
      last_opened_at: '',
    },
  ]
  return { schedules, staff, services, bookings, campaigns }
}
