// Presentation helpers for team members (pure): colours, names, initials. Shared by the Team,
// Availability and Bookings pages so a person looks the same everywhere.
import { isOwnerMember, ownerStaff, scheduleForStaff } from './team.ts'

export const OWNER_COLOR = '#2e3fa8'
/** Distinct, all readable with white text. Saved on the member as a plain #rrggbb. */
export const STAFF_COLORS = ['#c2410c', '#0e7490', '#7c3aed', '#be185d', '#15803d', '#b45309', '#4d7c0f', '#a21caf']
const COLOR_NAMES: Readonly<Record<string, string>> = Object.freeze({
  '#2e3fa8': 'Indigo',
  '#2336dc': 'Blue',
  '#c2410c': 'Rust',
  '#0e7490': 'Teal',
  '#7c3aed': 'Violet',
  '#be185d': 'Berry',
  '#15803d': 'Green',
  '#b45309': 'Amber',
  '#4d7c0f': 'Olive',
  '#a21caf': 'Plum',
})
/** A spoken name for a member colour ("Teal"), so colour swatches never announce raw hex codes. */
export const colorName = (hex: string) => COLOR_NAMES[String(hex).toLowerCase()] || 'Custom colour'
const HEX = /^#[0-9a-f]{6}$/i

const hash = (text: unknown) => [...String(text)].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7)

/** The member's saved colour, else the owner blue, else a stable palette colour derived from the id. */
export function memberColor(member: StaffRecord | null | undefined) {
  if (HEX.test(member?.color || '')) return member?.color ?? OWNER_COLOR
  if (isOwnerMember(member)) return OWNER_COLOR
  return STAFF_COLORS[hash(member?.id || member?.name || '') % STAFF_COLORS.length] ?? OWNER_COLOR
}

/** First palette colour no current member uses, for a new member's default. */
export function nextFreeColor(members: StaffRecord[] | null | undefined) {
  const used = new Set((members || []).map((member) => memberColor(member).toLowerCase()))
  return STAFF_COLORS.find((color) => !used.has(color)) || STAFF_COLORS[(members || []).length % STAFF_COLORS.length] || OWNER_COLOR
}

/** "You" for the owner, else the member's name. */
export const memberName = (member: StaffRecord | null | undefined) => (isOwnerMember(member) ? 'You' : String(member?.name || 'Team member'))

/** Name to show beside a person's own bookings in lists: owner shows as "You". */
export const memberFirstName = (member: StaffRecord | null | undefined) => (isOwnerMember(member) ? 'You' : String(member?.name || '').trim().split(/\s+/)[0] || 'Team member')

export function memberInitial(state: Pick<WorkspaceState, 'profile'>, member: StaffRecord | null | undefined) {
  const source = isOwnerMember(member)
    ? String(state?.profile?.display_name || '').trim() || 'You'
    : String(member?.name || '').trim() || '?'
  return source.slice(0, 1).toUpperCase()
}

/** Name to store when the owner row is first saved (never the placeholder "You"). */
export const ownerSaveName = (state: Pick<WorkspaceState, 'profile' | 'staff' | 'schedules'>) => {
  const owner = ownerStaff(state)
  return owner.implicit ? String(state?.profile?.display_name || '').trim() || 'Owner' : owner.name
}

/**
 * `scheduleForStaff`, except the owner never borrows a team member's schedule: when every schedule is claimed
 * (the owner has not saved hours of their own) the owner has none yet. Pages use this so the owner is not shown
 * a colleague's hours and is not booked onto their calendar.
 */
export function scheduleOf(state: Pick<WorkspaceState, 'staff' | 'schedules'>, member: StaffRecord): ScheduleRecord | null {
  const schedule = scheduleForStaff(state, member)
  if (!schedule || !isOwnerMember(member) || member.schedule_id === schedule.id) return schedule
  const claimed = (state?.staff || []).some((item) => !isOwnerMember(item) && item.schedule_id === schedule.id)
  return claimed ? null : schedule
}

/**
 * A service name as people should read it. Spreadsheet imports neutralise names that start with = + - @ by
 * prefixing one apostrophe (so a formula never runs); the stored name keeps it, the screen does not show it.
 * Strips exactly one leading apostrophe, and only in front of one of those characters.
 */
export const displayName = (name: unknown) => {
  const text = String(name ?? '')
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text
}
