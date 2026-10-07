// Shared deterministic fixture: a salon with 30 bookings around NOW (2026-10-07 09:00 UTC, Africa/Lagos).
// Used by the messaging and campaign tests. Nothing here reads the clock.
export const NOW = Date.parse('2026-10-07T09:00:00.000Z')
export const TZ = 'Africa/Lagos'
const HOUR = 3_600_000
const DAY = 24 * HOUR

export const CLIENTS = {
  ada: { name: 'Ada Okafor', email: 'ada@x.test', phone: '+234 803 555 0182' },
  bola: { name: 'Bola Ade', email: 'bola@x.test', phone: '0802 111 2222' },
  chi: { name: 'Chi Eze', email: 'chi@x.test', phone: '' },
  dayo: { name: 'Dayo Bello', email: 'phone-2348033334444@bookins.invalid', phone: '0803 333 4444' },
  ese: { name: 'Ese Ojo', email: 'ese@x.test', phone: '0805 000 1111' },
  femi: { name: 'Femi Ayo', email: 'femi@x.test', phone: '0807 222 3333' },
  gina: { name: 'Gina Mensah', email: 'gina@x.test', phone: '+233 24 555 0190' },
  hauwa: { name: 'Hauwa Musa', email: 'hauwa@x.test', phone: '0809 444 5555' },
  ife: { name: 'Ife Coker', email: 'ife@x.test', phone: '0810 666 7777' },
  jide: { name: 'Jide Obi', email: 'jide@x.test', phone: '0811 888 9999' },
  kemi: { name: 'Kemi Alabi', email: 'kemi@x.test', phone: '0812 000 1234' },
  lola: { name: 'Lola King', email: 'lola@x.test', phone: '0813 000 2345' },
  mira: { name: 'Mira Dara', email: 'mira@x.test', phone: '0814 000 3456' },
  nora: { name: 'Nora Pius', email: 'nora@x.test', phone: '' },
  pia: { name: 'Pia Sule', email: 'pia@x.test', phone: '0815 000 4567' },
  rita: { name: 'Rita Bako', email: 'rita@x.test', phone: '0816 000 5678' },
  sade: { name: 'Sade Wale', email: 'sade@x.test', phone: '0817 000 6789' },
}

export const profile = {
  id: 'p1',
  display_name: 'Glow Studio',
  bio: 'Braids, nails and lashes. [[wa:+234 801 000 0000]]',
  timezone: TZ,
  public_link_url: 'https://glow.example/book#tok',
}

export const schedules = [{ id: 'sch-owner', name: 'Hours', timezone: TZ, slot_interval_minutes: 240, minimum_notice_minutes: 0, booking_horizon_days: 90, active: true, weekly_windows_json: '[]' }]

const service = (id, name, category, price, extra = {}) => ({
  id, slug: id, name, category, price, currency: 'NGN', duration_minutes: 60, schedule_id: 'sch-owner', visibility: 'public', active: true, description: name, ...extra,
})
export const services = [
  service('svc-braids', 'Knotless braids', 'Braids', 45000, { rebook_after_days: 42, prep_notes: 'Arrive with washed hair', location: 'Lekki Phase 1' }),
  service('svc-nails', 'Gel manicure', 'Nails', 12000, { rebook_after_days: 21 }),
  service('svc-lashes', 'Lash lift', 'Lashes', 20000),
]
const SERVICE = { braids: services[0], nails: services[1], lashes: services[2] }

// [client, service, hours from NOW of the start, status, extra fields]
const PLAN = [
  ['ada', 'braids', -100 * 24, 'completed'],
  ['ada', 'braids', -70 * 24, 'completed'],
  ['bola', 'braids', -90 * 24, 'completed'],
  ['bola', 'nails', -10 * 24, 'completed'],
  ['chi', 'braids', -65 * 24, 'completed'],
  ['chi', 'braids', -5 * 24, 'cancelled'],
  ['dayo', 'braids', -80 * 24, 'completed'],
  ['ese', 'braids', -120 * 24, 'completed'],
  ['femi', 'braids', -30 * 24, 'completed'],
  ['femi', 'braids', -75 * 24, 'completed'],
  ['gina', 'braids', -200 * 24, 'completed'],
  ['gina', 'braids', 5 * 24, 'confirmed'],
  ['hauwa', 'braids', -61 * 24, 'completed'],
  ['ife', 'braids', -60 * 24, 'completed'],
  ['jide', 'braids', -150 * 24, 'no_show'],
  ['ada', 'nails', -20 * 24, 'completed'],
  ['ada', 'lashes', -3 * 24, 'completed'],
  ['femi', 'nails', -15 * 24, 'completed'],
  ['femi', 'nails', -45 * 24, 'completed'],
  ['hauwa', 'nails', -25 * 24, 'completed'],
  ['kemi', 'lashes', -4 * 24, 'completed'],
  ['kemi', 'lashes', 10 * 24, 'confirmed'],
  ['lola', 'nails', 20, 'confirmed'],
  ['mira', 'braids', 1.5, 'confirmed'],
  ['nora', 'lashes', 30, 'confirmed'],
  ['pia', 'nails', -10, 'completed'],
  ['rita', 'braids', 10, 'confirmed', { reminder24_opened_at: '2026-10-07T08:00:00.000Z' }],
  ['sade', 'nails', 5, 'cancelled'],
]

export const bookings = [
  ...PLAN.map(([who, svc, hours, status, extra = {}], index) => {
    const client = CLIENTS[who]
    const startsAt = new Date(NOW + hours * HOUR)
    const base = SERVICE[svc]
    return {
      id: `b${index + 1}`,
      reference: `BK-${String(index + 1).padStart(4, '0')}`,
      service_id: base.id,
      service_name: base.name,
      schedule_id: 'sch-owner',
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
      timezone: TZ,
      guest_name: client.name,
      guest_email: client.email,
      guest_phone: client.phone,
      status,
      source: index % 5 === 0 ? 'owner' : 'guest',
      reservation_key: `sch-owner|${startsAt.toISOString()}`,
      created_at: new Date(Math.min(startsAt.getTime() - 2 * HOUR, NOW - HOUR)).toISOString(),
      ...extra,
    }
  }),
  // Owner time off: one in force and one removed. Never part of any audience or queue.
  {
    id: 'off1', reference: 'OFF-1', service_id: 'time-off', service_name: 'Time off', schedule_id: 'sch-owner',
    starts_at: new Date(NOW + 3 * HOUR).toISOString(), ends_at: new Date(NOW + 5 * HOUR).toISOString(), timezone: TZ,
    guest_name: 'Clinic', guest_email: 'time-off@bookins.invalid', guest_phone: '', status: 'blocked', created_at: new Date(NOW).toISOString(),
  },
  {
    id: 'off2', reference: 'OFF-2', service_id: 'time-off', service_name: 'Time off', schedule_id: 'sch-owner',
    starts_at: new Date(NOW - 2 * DAY).toISOString(), ends_at: new Date(NOW - 2 * DAY + 4 * HOUR).toISOString(), timezone: TZ,
    guest_name: 'Training', guest_email: 'time-off@bookins.invalid', guest_phone: '', status: 'cancelled', created_at: new Date(NOW - 3 * DAY).toISOString(),
  },
]

export const contacts = [
  { id: 'c-ada', email: 'ada@x.test', name: 'Ada Okafor', phone: '+234 803 555 0182', tags_json: JSON.stringify(['VIP']) },
  { id: 'c-ese', email: 'ese@x.test', name: 'Ese Ojo', phone: '0805 000 1111', tags_json: '[]', marketing_opt_out: true, marketing_opt_out_at: '2026-09-01T00:00:00.000Z' },
]

export const state = () => ({ profile, schedules, services, bookings: bookings.map((item) => ({ ...item })), contacts, staff: [], campaigns: [] })
export const names = (list) => list.map((item) => (item.contact || item).name.split(' ')[0].toLowerCase()).sort()
