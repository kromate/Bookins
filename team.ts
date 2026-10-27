// Staff-as-schedule helpers (pure). A team member is a person plus their own schedule (1:1); each
// schedule is an independent resource on the hosted engine, which is what gives parallel capacity.
// The owner is always member #1 ("You"). With no `staff` rows the owner is implicit and an install
// behaves exactly as it did before teams existed.
import { isTruthyFlag } from './records.ts'
import { splitDescription } from './service-meta.ts'

export const OWNER_STAFF_ID = 'owner'
/** Above this many per-member service copies the owner must confirm; above the max we refuse. */
export const STAFF_COPY_WARN = 40
export const STAFF_COPY_MAX = 200

const isActiveFlag = (value: unknown) => value !== false && value !== 'false' && value !== 0 && value !== '0'

export const isOwnerMember = (member: StaffRecord | null | undefined) => member?.id === OWNER_STAFF_ID || isTruthyFlag(member?.is_owner)

/** Service ids a member offers; an empty list means "all services". */
export function parseServiceIds(member: StaffRecord | null | undefined): string[] {
  try {
    const ids = JSON.parse(member?.service_ids_json || '[]')
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && Boolean(id)) : []
  } catch {
    return []
  }
}

/** True when at least one non-owner member exists (active or not). Single-owner installs are unchanged. */
export const hasTeam = (state: Pick<WorkspaceState, 'staff'> | null | undefined) => (state?.staff || []).some((member) => !isOwnerMember(member))

/** The owner member: the saved `is_owner` row, or an implicit "You" bound to the owner's schedule. */
export function ownerStaff(state: Pick<WorkspaceState, 'staff' | 'schedules'> | null | undefined): StaffRecord {
  const saved = (state?.staff || []).find((member) => isTruthyFlag(member?.is_owner))
  if (saved) return saved
  return {
    id: OWNER_STAFF_ID,
    implicit: true,
    name: 'You',
    role: '',
    photo_url: '',
    color: '',
    phone: '',
    email: '',
    active: true,
    schedule_id: '',
    service_ids_json: '[]',
    is_owner: true,
  }
}

/** Owner first, then team members by name. Inactive members only when `includeInactive`. */
export function teamMembers(state: Pick<WorkspaceState, 'staff' | 'schedules'> | null | undefined, { includeInactive = false }: { includeInactive?: boolean } = {}): StaffRecord[] {
  const owner = ownerStaff(state)
  const others = (state?.staff || [])
    .filter((member) => !isOwnerMember(member))
    .filter((member) => includeInactive || isActiveFlag(member.active))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  return [owner, ...others]
}

export const isStaffActive = (member: StaffRecord | null | undefined) => isActiveFlag(member?.active)

export const staffById = (state: Pick<WorkspaceState, 'staff' | 'schedules'> | null | undefined, id: string | null | undefined) =>
  id === OWNER_STAFF_ID || (id && id === ownerStaff(state).id)
    ? ownerStaff(state)
    : (state?.staff || []).find((member) => member.id === id) || null

/** The member's schedule record. The owner's is the first schedule no other member has claimed. */
export function scheduleForStaff(state: Pick<WorkspaceState, 'staff' | 'schedules'> | null | undefined, member: StaffRecord | null | undefined): ScheduleRecord | null {
  const schedules = state?.schedules || []
  if (!member) return null
  if (!isOwnerMember(member)) return schedules.find((item) => item.id === member.schedule_id) || null
  const explicit = member.schedule_id && schedules.find((item) => item.id === member.schedule_id)
  if (explicit) return explicit
  const claimed = new Set(
    (state?.staff || []).filter((item) => !isOwnerMember(item) && item.schedule_id).map((item) => item.schedule_id),
  )
  const unclaimed = schedules.find((item) => !claimed.has(item.id))
  if (unclaimed) return unclaimed
  // Every schedule belongs to a team member: the owner has no hours yet. Never borrow a member's calendar.
  return claimed.size ? null : schedules[0] || null
}

/** Per-member service copies carry the member's id in the description trailer (`s`). */
export const serviceStaffId = (service: ServiceRecord | null | undefined) => splitDescription(service?.description).meta.s || ''
export const isStaffCopy = (service: ServiceRecord | null | undefined) => Boolean(serviceStaffId(service))
export const serviceBaseId = (service: ServiceRecord | null | undefined) => splitDescription(service?.description).meta.b || ''

/** Copies of `service` (or every copy when omitted), optionally for one member. */
export function staffCopies(state: Pick<WorkspaceState, 'services'> | null | undefined, service?: ServiceRecord | null, member?: StaffRecord | null): ServiceRecord[] {
  return (state?.services || []).filter((item) => {
    const meta = splitDescription(item.description).meta
    if (!meta.s) return false
    if (service && meta.b !== service.id) return false
    if (member && meta.s !== member.id) return false
    return true
  })
}

/** Base (non-copy) services a member offers. Empty `service_ids_json` means all of them. */
export function servicesForStaff(state: Pick<WorkspaceState, 'services'> | null | undefined, member: StaffRecord | null | undefined): ServiceRecord[] {
  const ids = parseServiceIds(member)
  return (state?.services || [])
    .filter((item) => !isStaffCopy(item))
    .filter((item) => !ids.length || Boolean(item.id && ids.includes(item.id)))
}

/**
 * The member a booking belongs to: its saved `staff_id`, else the member whose schedule it sits on
 * (guest bookings made on a member's service copy), else the owner.
 */
export function staffForBooking(state: Pick<WorkspaceState, 'staff' | 'schedules'> | null | undefined, booking: BookingRecord | null | undefined): StaffRecord {
  const owner = ownerStaff(state)
  if (!booking) return owner
  const id = booking.staff_id
  if (id) {
    if (id === OWNER_STAFF_ID || id === owner.id) return owner
    const found = (state?.staff || []).find((member) => member.id === id)
    if (found) return found
    return { id, name: booking.staff_name || 'Former team member', removed: true, active: false }
  }
  const bySchedule = (state?.staff || []).find(
    (member) => !isOwnerMember(member) && member.schedule_id && member.schedule_id === booking.schedule_id,
  )
  return bySchedule || owner
}

/** How many per-member copies creating `serviceIds` x `staffIds` would add on top of existing ones. */
export function staffServiceCopyEstimate(state: Pick<WorkspaceState, 'services'> | null | undefined, { serviceIds = [], staffIds = [] }: { serviceIds?: string[]; staffIds?: string[] } = {}) {
  const existing = staffCopies(state).length
  let adding = 0
  for (const serviceId of serviceIds)
    for (const staffId of staffIds)
      if (!staffCopies(state, { id: serviceId }, { id: staffId }).length) adding += 1
  const total = existing + adding
  return { existing, adding, total, warnAt: STAFF_COPY_WARN, max: STAFF_COPY_MAX, overCap: total > STAFF_COPY_WARN, overMax: total > STAFF_COPY_MAX }
}
