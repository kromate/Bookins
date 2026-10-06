import { localFields, wallClockInstant } from '../scheduling.js'

// Fictional clients shared by the Demo workspace and the localhost sample workspace.
const CLIENTS = [
  { name: 'Ada Okafor', email: 'ada@example.com', phone: '+234 803 555 0182' },
  { name: 'Kwame Mensah', email: 'kwame@example.com', phone: '+233 24 555 0190' },
  { name: 'Wanjiru Kamau', email: 'wanjiru@example.com', phone: '+254 712 555 014' },
  { name: 'Thandiwe Nkosi', email: 'thandiwe@example.com', phone: '+27 82 555 0147' },
  { name: 'Moussa Diop', email: 'moussa@example.com', phone: '+221 77 555 0123' },
  { name: 'Chiamaka Eze', email: 'chiamaka@example.com', phone: '0805 555 0133' },
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
    const client = CLIENTS[clientIndex]
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
  ]
  return { bookings, contacts }
}
