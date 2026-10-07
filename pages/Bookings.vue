<script setup>
import { formatDay } from '../format-date.js'
import { csvCell } from '../csv.js'
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, RouterLink, useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmConfirm from '../components/ui/GmConfirm.vue'
import GmDialog from '../components/ui/GmDialog.vue'
import GmHint from '../components/ui/GmHint.vue'
import { useSetupState } from '../setup.js'
import {
  addBookingToCalendar,
  addBookingsToCalendar,
  assignBookingStaff,
  bulkAssignStaff,
  calendarMode,
  cancelBookingWithCalendar,
  connectGoogleCalendar,
  copyText,
  createOwnerBooking,
  findCalendarConflicts,
  getCalendarStatus,
  hasRealEmail,
  hasTeam,
  isActiveTimeOff,
  isOwnerMember,
  isStaffActive,
  isStaffCopy,
  isTimeOff,
  listCalendarEvents,
  ownerStaff,
  rescheduleBooking,
  saveBookingNotes,
  servicesForStaff,
  setBookingStatus,
  staffForBooking,
  teamMembers,
} from '../booking.js'
import { displayName, memberColor, memberFirstName, memberName, scheduleOf } from '../team-ui.js'
import { composeMessage } from '../messaging.js'
import { localFields, wallClockInstant } from '../scheduling.js'
import { displayTimeZone } from '../time-display.js'
import { isDemo, registerDemoGuard } from '../runtime.js'

const state = inject('bookingState')
const toast = inject('toast', null)
const setup = useSetupState()
const ok = (message, options) => toast?.(message, options)
// Error toasts persist until dismissed, so the previous one is dismissed when the user tries again.
let errorToastId = null
const clearBad = () => {
  if (errorToastId != null) toast?.dismiss?.(errorToastId)
  errorToastId = null
}
const bad = (message) => {
  clearBad()
  errorToastId = toast?.error ? toast.error(message) : toast?.(message, { kind: 'error' })
}
const info = (message) => (toast?.info ? toast.info(message) : toast?.(message))
// Time off is stored as a booking but is never a client appointment.
const isHidden = (booking) => isTimeOff(booking)
const realBookings = computed(() => (state.bookings || []).filter((item) => !isHidden(item)))
const timeOffBlocks = computed(() => (state.bookings || []).filter(isActiveTimeOff))
// ---- team (everything below is inert, and no staff UI shows, until the first member is added) ----
const team = computed(() => hasTeam(state))
const members = computed(() => teamMembers(state, { includeInactive: true }))
const activeMembers = computed(() => members.value.filter(isStaffActive))
const memberFor = (booking) => staffForBooking(state, booking)
const staffName = (booking) => memberName(memberFor(booking))
const staffColor = (booking) => memberColor(memberFor(booking))
const staffLabel = (member) => `${memberName(member)}${isStaffActive(member) ? '' : ' (inactive)'}`
const refresh = inject('refreshBookings')
const router = useRouter()
const route = useRoute()
const activeTab = ref('upcoming')
const view = ref('agenda')
const query = ref('')
const emailFilter = ref('')
const serviceFilter = ref('')
const staffFilter = ref('')
const fromDate = ref('')
const toDate = ref('')
const weekOffset = ref(0)
// The open booking is looked up by id, so the dialog always reflects the latest state after any action or refresh.
const selectedId = ref('')
const selected = computed(() => realBookings.value.find((item) => item.id === selectedId.value) || null)
const cancelOpen = ref(false)
const discardOpen = ref(false)
const cancellationReason = ref('')
const cancelling = ref(false)
const error = ref('')
const detailNotice = ref('')
const now = ref(Date.now())
const clock = window.setInterval(() => { now.value = Date.now() }, 30_000)
const pendingRoute = ref('')
const allowLeave = ref(false)
const removeModeGuard = registerDemoGuard('bookins-bookings-dialog', () =>
  selected.value ? 'Close the booking details before switching modes.' : '',
)
onBeforeUnmount(() => {
  removeModeGuard()
  window.clearInterval(clock)
})

// ---- Google Calendar (optional) ----
// calendar.state: loading | connected | not-connected | preview | demo | unavailable | error
const calendar = ref({ state: 'loading', message: '' })
const calendarBusy = ref(false)
const calendarNotice = ref('')
const calendarError = ref('')
const bulkOutcomes = ref([])
const conflicts = ref(new Map())
const conflictNote = ref('')
const calendarConnected = computed(() => calendar.value.state === 'connected')
const calendarHint = computed(() => {
  const { state, message } = calendar.value
  if (state === 'preview') return 'Not available in local preview. Launch Bookins from Goalmatic to connect Google Calendar.'
  if (state === 'demo') return 'Not available in the demo. Exit Demo and open Bookins from Goalmatic to connect Google Calendar.'
  if (state === 'unavailable') return message
  if (state === 'not-connected') return 'Connect Google Calendar to see clashes and add bookings to your calendar. Nothing is written without your approval.'
  if (state === 'error') return message || 'Google Calendar could not be checked right now.'
  return ''
})

async function loadCalendarStatus() {
  calendar.value = isDemo.value
    ? { state: 'demo', message: '' }
    : calendarMode() === 'live'
      ? { state: 'loading', message: '' }
      : { state: calendarMode(), message: '' }
  if (calendarMode() !== 'live') return
  try {
    calendar.value = await getCalendarStatus()
  } catch (reason) {
    calendar.value = { state: 'error', message: reason?.message || '' }
  }
}

async function connectCalendar() {
  calendarBusy.value = true
  calendarError.value = ''
  try {
    await connectGoogleCalendar()
    await loadCalendarStatus()
    if (!calendarConnected.value) {
      calendarError.value = 'Google Calendar was not connected. Finish the Google sign-in window and try again.'
    } else ok('Google Calendar connected')
  } catch (reason) {
    calendarError.value = reason?.message || 'Google Calendar could not be connected.'
  } finally {
    calendarBusy.value = false
  }
}

let conflictSeq = 0
async function loadConflicts() {
  const seq = ++conflictSeq
  conflictNote.value = ''
  const upcoming = realBookings.value.filter((item) => isUpcoming(item) && item.status === 'confirmed')
  if (!calendarConnected.value || !upcoming.length) {
    conflicts.value = new Map()
    return
  }
  try {
    const from = new Date(Math.min(...upcoming.map(startMs))).toISOString()
    const to = new Date(Math.max(...upcoming.map(endMs))).toISOString()
    const { events, truncated } = await listCalendarEvents(from, to)
    if (seq !== conflictSeq) return
    conflicts.value = findCalendarConflicts(upcoming, events)
    if (truncated) conflictNote.value = 'Clash checking covers the next 93 days and up to 100 events per month, so some clashes may not be flagged.'
  } catch (reason) {
    if (seq !== conflictSeq) return
    conflicts.value = new Map()
    conflictNote.value = `Calendar clashes could not be checked: ${reason?.message || 'try again later.'}`
  }
}
watch([calendarConnected, realBookings], loadConflicts)
onMounted(loadCalendarStatus)
watch(isDemo, loadCalendarStatus)

const onCalendar = (booking) => Boolean(booking.calendar_event_id)
const conflictTitles = (booking) => conflicts.value.get(booking.id) || []
const needsCalendar = computed(() => realBookings.value.filter((item) => isUpcoming(item) && item.status === 'confirmed' && !onCalendar(item)))

function flash(message) {
  calendarNotice.value = message
  window.setTimeout(() => {
    if (calendarNotice.value === message) calendarNotice.value = ''
  }, 4000)
}

async function addToCalendar(booking) {
  clearBad()
  calendarBusy.value = true
  calendarError.value = ''
  error.value = ''
  try {
    const result = await addBookingToCalendar(booking)
    await refresh()
    const text = result.alreadyOnCalendar ? 'Already on your calendar.' : 'Added to Google Calendar.'
    // One visible message: inline inside the open dialog, otherwise a toast.
    if (selected.value) detailNotice.value = text
    else ok(text)
  } catch (reason) {
    const text = reason?.message || 'The booking could not be added to Google Calendar.'
    // One visible message, where the user is looking: inside the dialog when it is open, else beside the calendar panel.
    if (selected.value) error.value = text
    else calendarError.value = text
  } finally {
    calendarBusy.value = false
  }
}

async function addAllToCalendar() {
  clearBad()
  const targets = needsCalendar.value
  if (!targets.length) return
  calendarBusy.value = true
  calendarError.value = ''
  bulkOutcomes.value = []
  try {
    bulkOutcomes.value = await addBookingsToCalendar(targets)
    await refresh()
    const failed = bulkOutcomes.value.filter((item) => !item.ok).length
    const text = failed ? `Added ${bulkOutcomes.value.length - failed} of ${bulkOutcomes.value.length}. ${failed} failed.` : `Added ${bulkOutcomes.value.length} to Google Calendar.`
    if (failed) calendarError.value = text
    else ok(text)
  } catch (reason) {
    const text = reason?.message || 'The bookings could not be added to Google Calendar.'
    calendarError.value = text
  } finally {
    calendarBusy.value = false
  }
}
const bulkLabel = (outcome) => {
  const booking = realBookings.value.find((item) => item.id === outcome.id)
  return booking ? `${booking.service_name} with ${booking.guest_name}` : outcome.id
}

const zone = (booking) => displayTimeZone(booking.timezone || state.schedules?.[0]?.timezone)
const scheduleZone = computed(() => displayTimeZone(state.schedules?.[0]?.timezone))
const displayTimeOptions = (options, booking) => ({ ...options, timeZone: zone(booking) })

function zoneAbbr(booking) {
  try {
    const part = new Intl.DateTimeFormat('en', { timeZone: zone(booking), timeZoneName: 'short' })
      .formatToParts(new Date(booking.starts_at))
      .find((item) => item.type === 'timeZoneName')
    return part?.value || ''
  } catch {
    return ''
  }
}
const zoneLabel = (booking) => {
  const abbr = zoneAbbr(booking)
  return abbr && abbr !== zone(booking) ? `${abbr} (${zone(booking)})` : zone(booking)
}

// Calendar day (yyyy-mm-dd) of a booking in the booking's own timezone.
function dayKey(booking, at = booking.starts_at) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone(booking), year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(at))
  } catch {
    return String(at).slice(0, 10)
  }
}
const todayKey = computed(() =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: scheduleZone.value, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now.value)),
)
const startMs = (booking) => Date.parse(booking.starts_at)
const endMs = (booking) => Date.parse(booking.ends_at) || startMs(booking)
const isCancelled = (booking) => booking.status === 'cancelled'
// In-progress bookings are still "upcoming" so they remain cancellable and visible.
const isUpcoming = (booking) => !isCancelled(booking) && endMs(booking) > now.value
const isPast = (booking) => !isCancelled(booking) && endMs(booking) <= now.value
const canCancel = (booking) => isUpcoming(booking)

watch(
  () => [route.query.q, route.query.email, route.query.staff],
  ([q, email, staff]) => {
    const text = (value) => (Array.isArray(value) ? value[0] : value) || ''
    if (route.path !== '/bookings') return
    query.value = String(text(q))
    emailFilter.value = String(text(email)).trim().toLowerCase()
    staffFilter.value = String(text(staff))
    if (q || email || staff) activeTab.value = 'all'
  },
  { immediate: true },
)

function clearEmail() {
  emailFilter.value = ''
  router.replace({ path: '/bookings', query: { ...route.query, email: undefined } })
}

onBeforeRouteLeave((to) => {
  if (allowLeave.value) {
    allowLeave.value = false
    return true
  }
  if (!selected.value) return true
  if (!detailDirty.value) {
    close()
    return true
  }
  pendingRoute.value = to.fullPath
  discardOpen.value = true
  return false
})

const serviceOptions = computed(() => {
  const seen = new Map()
  for (const booking of realBookings.value) {
    const key = booking.service_id || booking.service_name
    if (key && !seen.has(key)) seen.set(key, booking.service_name || 'Service')
  }
  return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
})

// Everything except the status tab, so tab counts reflect the other filters.
const baseFiltered = computed(() => {
  const search = query.value.trim().toLowerCase()
  return realBookings.value.filter((item) => {
    if (emailFilter.value && String(item.guest_email || '').trim().toLowerCase() !== emailFilter.value) return false
    if (serviceFilter.value && (item.service_id || item.service_name) !== serviceFilter.value) return false
    if (team.value && staffFilter.value && memberFor(item).id !== staffFilter.value) return false
    const day = dayKey(item)
    if (fromDate.value && day < fromDate.value) return false
    if (toDate.value && day > toDate.value) return false
    if (!search) return true
    return [item.guest_name, item.guest_email, item.guest_phone, item.service_name, item.reference].some((value) =>
      String(value || '').toLowerCase().includes(search),
    )
  })
})

const tabs = computed(() => [
  { id: 'upcoming', label: 'Upcoming', count: baseFiltered.value.filter(isUpcoming).length },
  { id: 'past', label: 'Past', count: baseFiltered.value.filter(isPast).length },
  { id: 'completed', label: 'Completed', count: baseFiltered.value.filter((item) => item.status === 'completed').length },
  { id: 'no_show', label: 'No-show', count: baseFiltered.value.filter((item) => item.status === 'no_show').length },
  { id: 'cancelled', label: 'Cancelled', count: baseFiltered.value.filter(isCancelled).length },
  { id: 'all', label: 'All', count: baseFiltered.value.length },
])

const inTab = (item, tab) => {
  if (tab === 'upcoming') return isUpcoming(item)
  if (tab === 'past') return isPast(item)
  if (tab === 'cancelled') return isCancelled(item)
  if (tab === 'completed' || tab === 'no_show') return item.status === tab
  return true
}

// Upcoming soonest-first; past, cancelled and "all" newest-first.
const sortBookings = (list, tab) =>
  [...list].sort((left, right) => (tab === 'upcoming' ? startMs(left) - startMs(right) : startMs(right) - startMs(left)))

const filtered = computed(() => sortBookings(baseFiltered.value.filter((item) => inTab(item, activeTab.value)), activeTab.value))

const groups = computed(() => {
  const map = new Map()
  for (const booking of filtered.value) {
    const key = dayKey(booking)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(booking)
  }
  return [...map].map(([key, items]) => ({ key, items, label: dayLabel(key) }))
})

function dayLabel(key) {
  const text = formatDay(key)
  if (key === todayKey.value) return `Today · ${text}`
  return text
}

const addDays = (key, days) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
const weekStart = computed(() => {
  const [y, m, d] = todayKey.value.split('-').map(Number)
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 // Monday first
  return addDays(todayKey.value, -dow + weekOffset.value * 7)
})
const weekDays = computed(() => {
  const showCancelled = activeTab.value === 'cancelled' || activeTab.value === 'all'
  const statusTab = activeTab.value === 'completed' || activeTab.value === 'no_show'
  const pool = baseFiltered.value.filter((item) => (statusTab ? inTab(item, activeTab.value) : showCancelled || !isCancelled(item)))
  const showOff = !emailFilter.value && !query.value.trim() && !statusTab
  return Array.from({ length: 7 }, (_, index) => {
    const key = addDays(weekStart.value, index)
    const [y, m, d] = key.split('-').map(Number)
    const date = new Date(Date.UTC(y, m - 1, d))
    return {
      key,
      today: key === todayKey.value,
      weekday: date.toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short' }),
      label: date.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' }),
      items: pool.filter((item) => dayKey(item) === key).sort((a, b) => startMs(a) - startMs(b)),
      off: showOff ? timeOffBlocks.value.filter((item) => (!team.value || !staffFilter.value || memberFor(item).id === staffFilter.value) && dayKey(item) <= key && key <= dayKey(item, endMs(item) - 1)) : [],
    }
  })
})
const weekRange = computed(() => {
  const fmt = (key) => {
    const [y, m, d] = key.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' })
  }
  return `${fmt(weekStart.value)} – ${fmt(addDays(weekStart.value, 6))}`
})

const hasFilters = computed(() =>
  Boolean(query.value.trim() || emailFilter.value || serviceFilter.value || (team.value && staffFilter.value) || fromDate.value || toDate.value),
)
function clearFilters() {
  query.value = ''
  serviceFilter.value = ''
  staffFilter.value = ''
  fromDate.value = ''
  toDate.value = ''
  if (emailFilter.value || route.query.q || route.query.email || route.query.staff) {
    emailFilter.value = ''
    router.replace({ path: '/bookings' })
  }
}

function dateParts(booking) {
  const date = new Date(booking.starts_at)
  return {
    day: date.toLocaleDateString(undefined, displayTimeOptions({ day: '2-digit' }, booking)),
    month: date.toLocaleDateString(undefined, displayTimeOptions({ month: 'short' }, booking)),
    weekday: date.toLocaleDateString(undefined, displayTimeOptions({ weekday: 'short' }, booking)),
  }
}

function when(booking) {
  return `${formatDay(booking.starts_at, zone(booking))}, ${new Date(booking.starts_at).toLocaleTimeString(undefined, displayTimeOptions({ hour: 'numeric', minute: '2-digit' }, booking))}`
}

function time(booking) {
  return new Date(booking.starts_at).toLocaleTimeString(undefined, displayTimeOptions({ hour: 'numeric', minute: '2-digit' }, booking))
}

function duration(booking) {
  return Math.max(0, Math.round((endMs(booking) - startMs(booking)) / 60_000))
}

// ---- CSV export ----
// Quote when needed, and neutralize spreadsheet formulas (= + - @, tab, CR) with a leading apostrophe.
function downloadCsv(filename, rows) {
  const body = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob(['﻿' + body + '\r\n'], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function exportCsv() {
  if (!filtered.value.length) return
  const fmt = (booking, at) => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: zone(booking), hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(at))
    } catch {
      return ''
    }
  }
  // The Staff column only exists once there is a team, so single-owner exports are unchanged.
  const withStaff = team.value
  const staffText = (booking) => {
    const member = memberFor(booking)
    return member.implicit ? String(state.profile?.display_name || '').trim() || 'Owner' : member.name || booking.staff_name || ''
  }
  const rows = [[
    'Reference', 'Status', 'Service', ...(withStaff ? ['Staff'] : []), 'Date', 'Start', 'End', 'Timezone', 'Starts at (UTC)',
    'Guest name', 'Guest email', 'Guest phone', 'Notes', 'Private owner notes', 'Source', 'Cancellation reason',
  ]]
  for (const booking of filtered.value) {
    rows.push([
      booking.reference, booking.status, booking.service_name, ...(withStaff ? [staffText(booking)] : []), dayKey(booking),
      fmt(booking, booking.starts_at), fmt(booking, booking.ends_at), zone(booking),
      booking.starts_at, booking.guest_name,
      hasRealEmail(booking.guest_email) ? booking.guest_email : '', booking.guest_phone,
      booking.notes, booking.owner_notes, booking.source === 'owner' ? 'owner' : 'guest', booking.cancellation_reason,
    ])
  }
  try {
    downloadCsv(`bookings-${activeTab.value}-${todayKey.value}.csv`, rows)
    ok(`Exported ${filtered.value.length} booking${filtered.value.length === 1 ? '' : 's'} to CSV`)
  } catch (reason) {
    bad(reason?.message || 'The CSV file could not be created.')
  }
}


// ---- shared helpers ----
const actionBusy = ref(false)
const scheduleFor = (booking) => (state.schedules || []).find((item) => item.id === booking?.schedule_id) || state.schedules?.[0]
const serviceFor = (booking) => (state.services || []).find((item) => item.id === booking?.service_id)
const hasStarted = (booking) => startMs(booking) <= now.value
const isDone = (booking) => booking.status === 'completed' || booking.status === 'no_show'
const statusLabel = (status) => (status === 'no_show' ? 'No-show' : status)
const emailText = (booking) => (hasRealEmail(booking.guest_email) ? booking.guest_email : 'No email')
const isSeries = (booking) => Boolean(booking.series_id)
const canMove = (booking) => ['confirmed', 'completed', 'no_show'].includes(booking.status)
const demoHint = computed(() => (isDemo.value ? 'The demo is read-only. Exit Demo to make changes.' : ''))

function reselect(id) {
  selectedId.value = id
  notesDraft.value = selected.value?.owner_notes || ''
}
function openDetail(booking) {
  detailNotice.value = ''
  error.value = ''
  selectedId.value = booking.id
}
const STATUS_HELP = 'Confirmed: booked and still to come. Completed: the appointment happened. No-show: the client did not turn up. Cancelled: you cancelled it and the slot reopened. You can undo completed and no-show.'
const TAB_HELP = {
  upcoming: 'Appointments that have not finished yet, soonest first.',
  past: 'Appointments whose time has passed and that were not cancelled. Confirmed ones here still need you to mark them completed or no-show; completed and no-show ones also appear in their own tabs.',
  completed: 'Appointments you marked as having happened.',
  no_show: 'Appointments where the client did not turn up.',
  cancelled: 'Cancelled appointments stay here as history.',
  all: 'Every client booking, newest first. Time off is not listed here.',
}

function describeError(reason, fallback) {
  const code = reason?.code
  if (code === 'DEMO_READ_ONLY') return 'The demo is read-only. Exit Demo to make changes.'
  if (code === 'BOOKING_SLOT_TAKEN') return `${reason.message || 'That time is already taken.'} Choose another time.`
  if (code === 'BOOKING_CONTACT_INVALID') return reason.message || 'Check the client name, email, and phone number.'
  if (code === 'BOOKING_TIME_INVALID') return reason.message || 'Choose a valid date and time.'
  if (code === 'BOOKING_SERVICE_NOT_FOUND') return 'Choose a service for this booking.'
  if (code === 'BOOKING_SCHEDULE_UNAVAILABLE') return 'This service has no schedule yet. Set your availability first.'
  if (code === 'BOOKING_NOT_ACTIVE') return 'This booking is cancelled, so it cannot be changed.'
  return reason?.message || fallback
}

function zoneName(timezone) {
  try {
    const part = new Intl.DateTimeFormat('en', { timeZone: timezone, timeZoneName: 'short' })
      .formatToParts(new Date()).find((item) => item.type === 'timeZoneName')
    return part?.value && part.value !== timezone ? `${displayTimeZone(timezone)} (${part.value})` : displayTimeZone(timezone)
  } catch {
    return displayTimeZone(timezone)
  }
}
const instantFor = (date, clock, timezone) => {
  const [hours, minutes] = String(clock || '').split(':').map(Number)
  if (!date || !Number.isInteger(hours) || !Number.isInteger(minutes)) return { error: 'Choose a date and time.' }
  const at = wallClockInstant(date, hours * 60 + minutes, timezone)
  return at ? { at: at.toISOString() } : { error: 'That local time does not exist because of a clock change. Choose another time.' }
}

// ---- status ----
async function changeStatus(booking, status) {
  if (isDemo.value || actionBusy.value) return
  clearBad()
  const fresh = realBookings.value.find((item) => item.id === booking.id) || booking
  actionBusy.value = true
  error.value = ''
  try {
    await setBookingStatus(fresh, status)
    await refresh()
    const doneText = status === 'confirmed' ? 'Status set back to confirmed.' : `Marked as ${statusLabel(status).toLowerCase()}.`
    ok(doneText, status === 'confirmed' ? undefined : { action: { label: 'Undo', onClick: () => changeStatus(booking, 'confirmed') }, duration: 6000 })
  } catch (reason) {
    error.value = describeError(reason, 'The status could not be changed.')
  } finally {
    actionBusy.value = false
  }
}

// ---- private owner notes ----
const notesDraft = ref('')
const notesSaving = ref(false)
const notesDirty = computed(() => Boolean(selected.value) && notesDraft.value !== (selected.value.owner_notes || ''))
watch(() => selected.value?.id, () => {
  notesDraft.value = selected.value?.owner_notes || ''
  if (selected.value) messageKind.value = suggestedKind(selected.value)
  else messageKind.value = ''
})
async function saveNotes() {
  if (isDemo.value || !selected.value || notesSaving.value) return
  clearBad()
  notesSaving.value = true
  error.value = ''
  try {
    const id = selected.value.id
    await saveBookingNotes(selected.value, notesDraft.value.trim())
    await refresh()
    reselect(id)
    ok('Private note saved')
  } catch (reason) {
    error.value = describeError(reason, 'The note could not be saved.')
  } finally {
    notesSaving.value = false
  }
}

// ---- messages (opened in the owner's own apps; Bookins sends nothing) ----
const MESSAGE_KINDS = [
  { id: 'confirmation', label: 'Confirmation' },
  { id: 'reminder', label: 'Reminder' },
  { id: 'reschedule', label: 'New time' },
  { id: 'cancellation', label: 'Cancellation' },
  { id: 'followup', label: 'Follow-up' },
]
const messageKind = ref('')
// The most relevant template for a booking, preselected when its details open.
const suggestedKind = (booking) => (isCancelled(booking) ? 'cancellation' : isPast(booking) ? 'followup' : 'confirmation')
const SUGGESTED_WHY = { confirmation: 'this booking is coming up', followup: 'this booking is in the past', cancellation: 'this booking is cancelled' }
const isSuggestedKind = (kind) => Boolean(selected.value) && kind === suggestedKind(selected.value)
const messageNotice = ref('')
function bookingLinkFor(booking) {
  const service = serviceFor(booking)
  const expires = Date.parse(service?.public_link_expires_at || '')
  if (service?.public_link_url && !(Number.isFinite(expires) && expires < now.value)) return service.public_link_url
  return state.profile?.public_link_url || ''
}
const composed = computed(() => {
  const booking = selected.value
  if (!booking || !messageKind.value) return null
  return composeMessage(messageKind.value, booking, {
    profile: state.profile,
    service: serviceFor(booking),
    bookingLink: bookingLinkFor(booking),
    staff: team.value ? memberFor(booking) : null,
  })
})
const phoneProblem = computed(() =>
  selected.value?.guest_phone ? 'This phone number could not be read as an international number. Edit it in your phone app, or copy the message.' : 'No phone on this booking, so WhatsApp and SMS are not available.',
)
const emailUsable = computed(() => Boolean(composed.value?.email) && hasRealEmail(selected.value?.guest_email))
function openMessage(kind) {
  messageKind.value = kind
  messageNotice.value = ''
}
async function copyMessage() {
  if (!composed.value) return
  try {
    await copyText(composed.value.text)
    messageNotice.value = 'Message copied. Paste it into any app.'
    window.setTimeout(() => { messageNotice.value = '' }, 5000)
  } catch {
    messageNotice.value = 'The message could not be copied. Select the text above and copy it yourself.'
  }
}
const openedApp = (app) => info(`Opening ${app} with the message ready. Press send there; Bookins cannot tell if it was sent.`)

// ---- new booking (walk-in / phone / recurring) ----
const newOpen = ref(false)
const newSaving = ref(false)
const newError = ref('')
const newResult = ref(null)
const newDiscardOpen = ref(false)
const blankForm = () => ({ serviceId: '', staffId: '', date: '', time: '', name: '', email: '', phone: '', notes: '', ownerNotes: '', repeatWeeks: 0 })
const form = ref(blankForm())
// With a team, per-person service copies are folded into their base service: pick the service, then "With".
const bookableServices = computed(() => (state.services || []).filter((item) => item.active !== false && !(team.value && isStaffCopy(item))))
const formService = computed(() => (state.services || []).find((item) => item.id === form.value.serviceId))
const eligibleMembers = computed(() => {
  if (!team.value || !formService.value) return []
  return activeMembers.value
    .filter((item) => servicesForStaff(state, item).some((service) => service.id === formService.value.id))
    .map((item) => ({ member: item, hasHours: Boolean(scheduleOf(state, item)) }))
})
const formMember = computed(() => eligibleMembers.value.find((item) => item.member.id === form.value.staffId)?.member || null)
const formZone = computed(() =>
  (team.value && formMember.value ? scheduleOf(state, formMember.value)?.timezone : '') || scheduleFor(formService.value)?.timezone || state.schedules?.[0]?.timezone || 'UTC',
)
// Default person: whoever was chosen if still valid, else the owner, else the first person who offers it and has hours.
function pickDefaultMember() {
  if (!team.value) { form.value.staffId = ''; return }
  const usable = eligibleMembers.value.filter((item) => item.hasHours)
  if (usable.some((item) => item.member.id === form.value.staffId)) return
  const owner = usable.find((item) => isOwnerMember(item.member))
  form.value.staffId = (owner || usable[0])?.member.id || ''
}
watch(() => [newOpen.value, form.value.serviceId, eligibleMembers.value.map((item) => item.member.id).join('|')], () => { if (newOpen.value) pickDefaultMember() })
const newStaffReason = computed(() => {
  if (!team.value || !formService.value) return ''
  if (!eligibleMembers.value.length) return 'No active team member offers this service. Choose services for a person in Team.'
  if (!form.value.staffId) return 'Nobody who offers this service has working hours yet. Set hours in Availability.'
  return ''
})
const newBlocked = computed(() =>
  !setup.value.hasAvailability
    ? { text: 'Bookings need your weekly hours first, then a service. Set your hours, then add a service, and you can add bookings here.', label: 'Set your availability', to: '/availability' }
    : !bookableServices.value.length
      ? { text: 'Bookings are made for a service. Add one, then come back to add a booking here.', label: 'Add a service', to: '/services' }
      : null,
)
const newDirty = computed(() => {
  if (!newOpen.value || newResult.value) return false
  const f = form.value
  return Boolean(f.time || f.name.trim() || f.email.trim() || f.phone.trim() || f.notes.trim() || f.ownerNotes.trim() || Number(f.repeatWeeks) > 0)
})

function openNew() {
  if (isDemo.value) return
  form.value = blankForm()
  form.value.serviceId = bookableServices.value[0]?.id || ''
  pickDefaultMember()
  form.value.date = todayKey.value
  newError.value = ''
  newResult.value = null
  newDiscardOpen.value = false
  newOpen.value = true
}
function closeNew() {
  if (newSaving.value) return
  newDiscardOpen.value = false
  newOpen.value = false
}
function requestCloseNew() {
  if (newSaving.value) return
  if (newDirty.value) newDiscardOpen.value = true
  else closeNew()
}
function newFail(message, field) {
  newError.value = message
  if (field) window.setTimeout(() => document.getElementById(field)?.focus(), 0)
}
async function submitNew() {
  if (isDemo.value || newSaving.value) return
  clearBad()
  newError.value = ''
  const f = form.value
  if (!f.serviceId) return newFail('Choose a service for this booking.', 'new-service')
  if (team.value && !f.staffId) return newFail(newStaffReason.value || 'Choose who this booking is with.', 'new-staff')
  if (!f.date) return newFail('Choose a date.', 'new-date')
  if (!f.time) return newFail('Choose a time.', 'new-time')
  if (!f.name.trim()) return newFail('Enter the client name.', 'new-name')
  if (!f.email.trim() && !f.phone.trim()) return newFail('Enter an email address or a phone number so you can reach the client.', 'new-phone')
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return newFail('That email address does not look right. Check it, or leave it blank and use a phone number.', 'new-email')
  const when = instantFor(f.date, f.time, formZone.value)
  if (when.error) return newFail(when.error, 'new-time')
  const repeatWeeks = Math.max(0, Math.min(12, Math.floor(Number(f.repeatWeeks) || 0)))
  newSaving.value = true
  try {
    const result = await createOwnerBooking(state, {
      serviceId: f.serviceId,
      // With a team the booking goes on the chosen person's own calendar; without one nothing changes.
      ...(team.value ? { staffId: f.staffId } : {}),
      startsAt: when.at,
      contact: { name: f.name, email: f.email, phone: f.phone },
      notes: f.notes,
      ownerNotes: f.ownerNotes,
      repeatWeeks,
    })
    await refresh()
    newResult.value = result
    // The result panel inside the dialog is the one confirmation (no duplicate toast).
  } catch (reason) {
    newError.value = describeError(reason, 'The booking could not be saved.')
  } finally {
    newSaving.value = false
  }
}
function messageNewClient() {
  const first = newResult.value?.created?.[0]
  newOpen.value = false
  if (!first) return
  window.setTimeout(() => {
    openDetail(first)
    reselect(first.id)
    messageKind.value = 'confirmation'
  }, 0)
}
const skippedLabel = (item) =>
  `${formatDay(item.startsAt, formZone.value)}, ${new Date(item.startsAt).toLocaleTimeString(undefined, { timeZone: formZone.value, hour: 'numeric', minute: '2-digit' })}`

// ---- reschedule ----
const rescheduling = ref(false)
const rescheduleSaving = ref(false)
const rescheduleError = ref('')
const moveWarnOpen = ref(false)
const moveWarning = ref('')
const moveForm = ref({ date: '', time: '' })
const moveZone = computed(() => scheduleFor(selected.value)?.timezone || selected.value?.timezone || 'UTC')
const moveDirty = computed(() => {
  if (!rescheduling.value || !selected.value) return false
  const fields = localFields(selected.value.starts_at, moveZone.value)
  return fields.date !== moveForm.value.date || fields.time !== moveForm.value.time
})
const detailDirty = computed(() => notesDirty.value || moveDirty.value)
const discardMessage = computed(() =>
  notesDirty.value && moveDirty.value
    ? 'Your typed private note and the new time you picked have not been saved and will be lost.'
    : moveDirty.value
      ? 'The new time you picked has not been saved and will be lost.'
      : 'Your typed private note has not been saved and will be lost.',
)
function startReschedule() {
  if (isDemo.value || !selected.value) return
  const fields = localFields(selected.value.starts_at, moveZone.value)
  moveForm.value = { date: fields.date, time: fields.time }
  rescheduleError.value = ''
  detailNotice.value = ''
  moveWarnOpen.value = false
  cancelOpen.value = false
  rescheduling.value = true
  window.setTimeout(() => document.getElementById('move-date')?.focus(), 0)
}
// Warnings (not errors): the owner may still move the booking after confirming.
function moveWarnings(atIso) {
  const warnings = []
  if (Date.parse(atIso) < Date.now()) warnings.push('That time is in the past.')
  try {
    const schedule = scheduleFor(selected.value)
    const windows = JSON.parse(schedule?.weekly_windows_json || '[]')
    const f = localFields(atIso, moveZone.value)
    const weekday = new Date(`${f.date}T12:00:00.000Z`).getUTCDay()
    const [h, m] = f.time.split(':').map(Number)
    const startMin = h * 60 + m
    const endMin = startMin + duration(selected.value)
    if (Array.isArray(windows) && windows.length && !windows.some((w) => w.weekday === weekday && startMin >= w.startMinute && endMin <= w.endMinute))
      warnings.push('That time is outside your weekly hours, so guests could not book it themselves.')
  } catch { /* hours unreadable: no warning */ }
  return warnings
}
function requestMove() {
  clearBad()
  if (isDemo.value || rescheduleSaving.value || !selected.value) return
  rescheduleError.value = ''
  const when = instantFor(moveForm.value.date, moveForm.value.time, moveZone.value)
  if (when.error) return void (rescheduleError.value = when.error)
  if (Date.parse(when.at) === startMs(selected.value)) return void (rescheduleError.value = 'That is the current time. Choose a different date or time.')
  const warnings = moveWarnings(when.at)
  if (warnings.length) {
    moveWarning.value = `${warnings.join(' ')} Move it anyway?`
    moveWarnOpen.value = true
    return
  }
  submitReschedule()
}
async function submitReschedule() {
  if (isDemo.value || rescheduleSaving.value || !selected.value) return
  clearBad()
  rescheduleError.value = ''
  const when = instantFor(moveForm.value.date, moveForm.value.time, moveZone.value)
  if (when.error) return void (rescheduleError.value = when.error)
  rescheduleSaving.value = true
  try {
    const id = selected.value.id
    const hadEvent = onCalendar(selected.value)
    await rescheduleBooking(state, selected.value, when.at)
    await refresh()
    reselect(id)
    rescheduling.value = false
    messageKind.value = 'reschedule'
    detailNotice.value = `Booking moved. The old time is free again.${hadEvent ? ' Its Google Calendar event was not moved. Change or delete it in Google Calendar yourself.' : ''} Message the client below so they know. Bookins does not send it for you.`
    scrollDetailTop()
  } catch (reason) {
    rescheduleError.value = describeError(reason, 'The booking could not be moved.')
  } finally {
    rescheduleSaving.value = false
  }
}
// ---- assign to a team member ----
// Wording: you are "you"; "your calendar" / "Amaka's calendar".
const toWho = (member) => (isOwnerMember(member) ? 'you' : memberFirstName(member))
const whoseCalendar = (member) => (isOwnerMember(member) ? 'your calendar' : `${memberFirstName(member)}'s calendar`)
const assignTo = ref('')
const assignBusy = ref(false)
watch(
  () => [selected.value?.id, selected.value?.staff_id, selected.value?.schedule_id],
  () => {
    const current = selected.value ? memberFor(selected.value) : null
    assignTo.value = current && members.value.some((item) => item.id === current.id) ? current.id : ''
  },
  { immediate: true },
)
const assignOptions = computed(() =>
  members.value
    .filter((item) => isStaffActive(item) || item.id === assignTo.value)
    .map((item) => ({
      id: item.id,
      label: `${memberName(item)}${isOwnerMember(item) ? ' (owner)' : ''}${isStaffActive(item) ? '' : ' (inactive)'}${!scheduleOf(state, item) ? ' (no hours set)' : ''}`,
      disabled: !isStaffActive(item) || (!scheduleOf(state, item) && selected.value?.status === 'confirmed'),
    })),
)
const assignReason = computed(() => {
  if (isDemo.value) return demoHint.value
  if (!selected.value) return ''
  if (!assignTo.value) return 'Choose who should take this booking.'
  if (assignTo.value === memberFor(selected.value).id) return `Already with ${toWho(memberFor(selected.value))}. Choose someone else.`
  return ''
})
async function assignSelected() {
  if (isDemo.value || assignBusy.value || !selected.value || assignReason.value) return
  clearBad()
  assignBusy.value = true
  error.value = ''
  detailNotice.value = ''
  const booking = selected.value
  const member = members.value.find((item) => item.id === assignTo.value)
  try {
    await assignBookingStaff(state, booking, assignTo.value)
    await refresh()
    const text = booking.status === 'confirmed'
      ? `Moved to ${whoseCalendar(member)}. The time is free again on the previous calendar.`
      : `Now recorded as ${toWho(member)}'s. Finished and cancelled bookings keep their calendar; only the name changes.`
    detailNotice.value = `${text} Nothing was sent to the client.`
  } catch (reason) {
    // Refusals (busy, time off, not active) come with the exact reason; show it where the owner is looking.
    error.value = reason?.message || 'The booking could not be assigned.'
  } finally {
    assignBusy.value = false
  }
}

// ---- bulk assign (selection mode) ----
const selecting = ref(false)
const picked = ref([])
const bulkTo = ref('')
const bulkBusy = ref(false)
const bulkConfirmOpen = ref(false)
const bulkResult = ref(null)
const pickedBookings = computed(() => filtered.value.filter((item) => picked.value.includes(item.id)))
const allPicked = computed(() => filtered.value.length > 0 && pickedBookings.value.length === filtered.value.length)
const bulkMember = computed(() => members.value.find((item) => item.id === bulkTo.value) || null)
const bulkReason = computed(() => {
  if (isDemo.value) return demoHint.value
  if (!pickedBookings.value.length) return 'Tick the bookings you want to move first.'
  if (!bulkMember.value) return 'Choose who should take them.'
  if (!isStaffActive(bulkMember.value)) return `${memberFirstName(bulkMember.value)} is inactive.`
  return ''
})
function startSelecting() {
  if (isDemo.value) return
  selecting.value = true
  bulkResult.value = null
  if (!bulkTo.value) bulkTo.value = activeMembers.value.find((item) => !isOwnerMember(item))?.id || ownerStaff(state).id
}
function stopSelecting() {
  selecting.value = false
  picked.value = []
  bulkConfirmOpen.value = false
}
function togglePick(id) {
  picked.value = picked.value.includes(id) ? picked.value.filter((item) => item !== id) : [...picked.value, id]
}
const toggleAllPicked = () => { picked.value = allPicked.value ? [] : filtered.value.map((item) => item.id) }
// A selection only means something for the rows on screen.
watch([activeTab, view, query, emailFilter, serviceFilter, staffFilter, fromDate, toDate], () => { picked.value = []; bulkResult.value = null })
watch(team, (value) => { if (!value) stopSelecting() })
async function runBulk() {
  if (isDemo.value || bulkBusy.value || bulkReason.value) return
  clearBad()
  bulkBusy.value = true
  const member = bulkMember.value
  try {
    const result = await bulkAssignStaff(state, pickedBookings.value, member.id)
    await refresh()
    const moved = result.moved.length
    const refused = result.refused
    bulkResult.value = { member, moved, refused, total: moved + refused.length }
    // Refused rows stay ticked so the owner can try another person.
    picked.value = refused.map((item) => item.booking.id)
    // Refusals are listed inline with their reasons; a clean run is a toast. Never both.
    if (!refused.length) {
      bulkResult.value = null
      ok(`Moved ${moved} booking${moved === 1 ? '' : 's'} to ${whoseCalendar(member)}.`)
    }
  } catch (reason) {
    bad(reason?.message || 'The bookings could not be assigned.')
  } finally {
    bulkBusy.value = false
    bulkConfirmOpen.value = false
  }
}
const refusedLabel = (item) => `${item.booking.guest_name}, ${when(item.booking)}`

function scrollDetailTop() {
  window.setTimeout(() => document.querySelector('.booking-detail')?.scrollTo?.({ top: 0, behavior: 'smooth' }), 50)
}

function close() {
  if (cancelling.value || actionBusy.value) return
  clearBad()
  selectedId.value = ''
  messageKind.value = ''
  messageNotice.value = ''
  rescheduling.value = false
  rescheduleError.value = ''
  moveWarnOpen.value = false
  detailNotice.value = ''
  error.value = ''
  cancelOpen.value = false
  discardOpen.value = false
  cancellationReason.value = ''
  pendingRoute.value = ''
}
// Every way of closing (X, Close, Esc, overlay) goes through here so a typed note is never lost silently.
function requestClose() {
  if (cancelling.value || actionBusy.value) return
  if (detailDirty.value) discardOpen.value = true
  else close()
}
function keepEditing() {
  discardOpen.value = false
  pendingRoute.value = ''
}
function discardDialog() {
  const next = pendingRoute.value
  close()
  if (next) {
    allowLeave.value = true
    router.push(next)
  }
}
const cancelMessage = computed(() => {
  const base = 'The appointment stays in history and the slot reopens. Bookins does not send a cancellation message; afterwards you can open one in your own WhatsApp, SMS, or email.'
  return selected.value && onCalendar(selected.value) ? `${base} Its Google Calendar event will be renamed "Cancelled: ..." (needs your approval); if that fails the booking is still cancelled and you will be told.` : base
})

async function cancel() {
  if (isDemo.value || !selected.value || !canCancel(selected.value)) return
  clearBad()
  cancelling.value = true
  error.value = ''
  try {
    const cancelledId = selected.value.id
    const outcome = await cancelBookingWithCalendar(selected.value, cancellationReason.value.trim() || 'Cancelled by owner')
    await refresh()
    reselect(cancelledId)
    cancellationReason.value = ''
    messageKind.value = 'cancellation'
    const calendarState = outcome.calendar.state
    detailNotice.value =
      calendarState === 'updated'
        ? 'Booking cancelled and the slot reopened. The Google Calendar event is marked as cancelled.'
        : calendarState === 'failed'
          ? `Booking cancelled and the slot reopened, but the Google Calendar event was not updated (${outcome.calendar.message}). Update or delete it in Google Calendar.`
          : calendarState === 'skipped'
            ? 'Booking cancelled and the slot reopened. Its Google Calendar event was not changed because Calendar is unavailable here; update it in Google Calendar.'
            : 'Booking cancelled and the slot reopened.'
    detailNotice.value += ' You can message the client below. Bookins does not send it for you.'
    scrollDetailTop()
  } catch (reason) {
    error.value = reason?.message || 'The booking could not be cancelled.'
  } finally {
    cancelling.value = false
  }
}

// ---- empty states ----
const hasAnyBookings = computed(() => realBookings.value.length > 0)
async function copyShareLink() {
  const url = state.profile?.public_link_url || ''
  if (!url) return
  try {
    await copyText(url)
    ok('Booking link copied')
  } catch {
    bad('The link could not be copied. Copy it from Settings.')
  }
}
const exportReason = computed(() => (filtered.value.length ? '' : hasAnyBookings.value ? 'Nothing to export in this view. Pick another tab or clear the filters.' : 'No bookings yet, so there is nothing to export.'))
const addAllReason = computed(() => (needsCalendar.value.length ? '' : 'Every upcoming confirmed booking is already on your calendar.'))
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <p class="eyebrow">Appointments</p>
        <h1>Bookings</h1>
        <p class="lede">See who is coming, what they booked, and the details they shared. Times are shown in each booking's own timezone. Cancelled appointments stay in history.</p>
      </div>
      <div class="page-header-actions">
        <label class="search-field">
          <AppIcon name="search" :size="18" /><span class="visually-hidden">Search bookings</span>
          <input v-model="query" type="search" placeholder="Guest, email, reference, service" />
        </label>
        <GmButton variant="secondary" :disabled-reason="exportReason" @click="exportCsv">Export CSV</GmButton>
        <GmButton variant="primary" :disabled-reason="demoHint" @click="openNew">New booking</GmButton>
      </div>
    </div>

    <p v-if="isDemo" class="muted demo-note">{{ demoHint }} You can still open message links, which only prepare text in your own apps.</p>
    <div v-if="error && !selected" class="notice error" role="alert">{{ error }}</div>

    <div class="card calendar-panel" :class="{ 'is-connected': calendarConnected }">
      <div class="calendar-copy">
        <strong>
          <AppIcon name="calendar" :size="18" /> Google Calendar
          <span class="chip dot" :class="calendarConnected ? 'confirmed' : 'neutral'">{{ calendarConnected ? 'Connected' : calendar.state === 'loading' ? 'Checking' : 'Not connected' }}</span>
          <GmHint text="Optional. Bookins reads your calendar only to flag clashes, and adds a booking as an event only when you ask, with your approval each time. It never invites the client." label="About Google Calendar" />
        </strong>
        <p v-if="calendarHint" class="muted">{{ calendarHint }}</p>
        <p v-else-if="calendarConnected" class="muted">Add confirmed bookings to your calendar yourself. Each write asks for your approval and invites no one. Bookings that clash with other events are flagged.</p>
      </div>
      <div class="calendar-actions">
        <button v-if="calendar.state === 'not-connected'" class="primary small-button" type="button" :disabled="calendarBusy" @click="connectCalendar">{{ calendarBusy ? 'Connecting…' : 'Connect Google Calendar' }}</button>
        <button v-if="calendar.state === 'error'" class="secondary small-button" type="button" @click="loadCalendarStatus">Check again</button>
        <GmButton
          v-if="calendarConnected"
          variant="secondary"
          size="sm"
          :disabled="calendarBusy"
          :disabled-reason="calendarBusy ? '' : addAllReason"
          @click="addAllToCalendar"
        >{{ calendarBusy ? 'Working…' : `Add all upcoming (${needsCalendar.length})` }}</GmButton>
      </div>
      <p v-if="calendarNotice" class="calendar-line" role="status">{{ calendarNotice }}</p>
      <p v-if="calendarError" class="calendar-line error-text" role="alert">{{ calendarError }}</p>
      <p v-if="conflictNote" class="calendar-line muted">{{ conflictNote }}</p>
      <ul v-if="bulkOutcomes.length" class="calendar-outcomes">
        <li v-for="outcome in bulkOutcomes" :key="outcome.id" :class="{ 'error-text': !outcome.ok }">{{ bulkLabel(outcome) }}: {{ outcome.ok ? (outcome.skipped ? 'already on calendar' : 'added') : outcome.message }}</li>
      </ul>
    </div>

    <div data-tour="tour-bookings-list">
    <div class="filter-bar">
      <div class="field">
        <label for="filter-service">Service</label>
        <select id="filter-service" v-model="serviceFilter" class="input">
          <option value="">All services</option>
          <option v-for="option in serviceOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </div>
      <div v-if="team" class="field">
        <label for="filter-staff">Team member</label>
        <select id="filter-staff" v-model="staffFilter" class="input">
          <option value="">Everyone</option>
          <option v-for="member in members" :key="member.id" :value="member.id">{{ staffLabel(member) }}</option>
        </select>
      </div>
      <div class="field">
        <label for="filter-from">From</label>
        <input id="filter-from" v-model="fromDate" class="input" type="date" :max="toDate || undefined" />
      </div>
      <div class="field">
        <label for="filter-to">To</label>
        <input id="filter-to" v-model="toDate" class="input" type="date" :min="fromDate || undefined" />
      </div>
      <button v-if="hasFilters" class="ghost small-button" type="button" @click="clearFilters">Clear filters</button>
      <div class="filter-tail">
        <GmButton
          v-if="team && view === 'agenda' && !selecting"
          variant="secondary"
          size="sm"
          :disabled-reason="isDemo ? demoHint : !groups.length ? 'No bookings in this view to select.' : ''"
          @click="startSelecting"
        >Select bookings</GmButton>
        <div class="segmented filter-view" role="group" aria-label="View">
          <button type="button" :class="{ 'is-active': view === 'agenda' }" :aria-pressed="view === 'agenda'" @click="view = 'agenda'">Agenda</button>
          <button type="button" :class="{ 'is-active': view === 'week' }" :aria-pressed="view === 'week'" @click="view = 'week'">Week</button>
        </div>
      </div>
    </div>
    <p v-if="emailFilter" class="email-filter">Showing history for <strong>{{ emailFilter }}</strong><button class="ghost small-button" type="button" @click="clearEmail">Show everyone</button></p>

    <div class="tab-bar" role="tablist" aria-label="Booking status">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.id"
        :class="{ 'is-active': activeTab === tab.id }"
        @click="activeTab = tab.id"
      ><span>{{ tab.label }}</span><span class="count-pill">{{ tab.count }}</span></button>
    </div>
    <p class="tab-help muted">{{ TAB_HELP[activeTab] }} <GmHint :text="STATUS_HELP" label="What the statuses mean" /></p>

    <div v-if="team && selecting && view === 'agenda'" class="card bulk-bar" role="region" aria-label="Assign selected bookings">
      <div class="bulk-top">
        <strong class="tnum">{{ pickedBookings.length }} selected</strong>
        <button class="ghost small-button" type="button" :disabled="!filtered.length" @click="toggleAllPicked">{{ allPicked ? 'Clear selection' : `Select all ${filtered.length} shown` }}</button>
        <button class="ghost small-button bulk-done" type="button" :disabled="bulkBusy" @click="stopSelecting">Done</button>
      </div>
      <div class="bulk-controls">
        <div class="field">
          <label for="bulk-to">Assign to <GmHint text="Confirmed bookings move onto that person's own calendar, and each one is refused if they are busy or on time off then. Completed, no-show and cancelled bookings only change who is recorded. Clients are not messaged." label="About assigning" /></label>
          <select id="bulk-to" v-model="bulkTo" class="input">
            <option v-for="member in activeMembers" :key="member.id" :value="member.id">{{ memberName(member) }}{{ isOwnerMember(member) ? ' (owner)' : '' }}{{ scheduleOf(state, member) ? '' : ' (no hours set)' }}</option>
          </select>
        </div>
        <GmConfirm
          v-model:open="bulkConfirmOpen"
          :title="`Assign ${pickedBookings.length} booking${pickedBookings.length === 1 ? '' : 's'} to ${bulkMember ? toWho(bulkMember) : 'them'}?`"
          :message="`Confirmed bookings move onto ${bulkMember ? whoseCalendar(bulkMember) : 'their calendar'}. Any that clash with ${bulkMember && !isOwnerMember(bulkMember) ? memberFirstName(bulkMember) + '\'s' : 'your'} bookings or time off are refused one by one and left where they are. Nothing is sent to clients.`"
          confirm-label="Assign"
          cancel-label="Cancel"
          :busy="bulkBusy"
          @confirm="runBulk"
        >
          <GmButton variant="primary" :pending="bulkBusy" pending-label="Assigning…" :disabled-reason="bulkReason" @click="bulkConfirmOpen = true">Assign selected</GmButton>
        </GmConfirm>
      </div>
      <div v-if="bulkResult" class="bulk-result" role="status">
        <p><strong>{{ bulkResult.moved }} of {{ bulkResult.total }} moved</strong> to {{ whoseCalendar(bulkResult.member) }}<template v-if="bulkResult.refused.length">, {{ bulkResult.refused.length }} refused</template>.</p>
        <ul v-if="bulkResult.refused.length" class="refused">
          <li v-for="item in bulkResult.refused" :key="item.booking.id"><strong>{{ refusedLabel(item) }}</strong>: {{ item.reason }}</li>
        </ul>
        <p v-if="bulkResult.refused.length" class="muted">Refused bookings stay ticked and where they were. Choose someone else above, or move them one by one.</p>
        <button class="ghost small-button" type="button" @click="bulkResult = null">Dismiss</button>
      </div>
    </div>

    <div v-if="view === 'week'" class="week">
      <div class="week-nav">
        <button class="secondary small-button" type="button" @click="weekOffset -= 1">Previous</button>
        <strong>{{ weekRange }}</strong>
        <span class="muted">Days in {{ scheduleZone }}</span>
        <button class="secondary small-button" type="button" :disabled="weekOffset === 0" @click="weekOffset = 0">This week</button>
        <button class="secondary small-button" type="button" @click="weekOffset += 1">Next</button>
      </div>
      <ul v-if="team" class="week-legend" aria-label="Team colours">
        <li v-for="member in members" :key="member.id"><i class="staff-dot" :style="{ background: memberColor(member) }" aria-hidden="true" />{{ staffLabel(member) }}</li>
        <li class="legend-off"><i class="legend-swatch" aria-hidden="true" />Time off</li>
      </ul>
      <div class="week-grid">
        <div v-for="day in weekDays" :key="day.key" class="week-day" :class="{ today: day.today }">
          <header><small>{{ day.weekday }}</small><strong>{{ day.label }}</strong></header>
          <RouterLink
            v-for="off in day.off"
            :key="off.id"
            to="/availability"
            class="week-off"
            :title="`Time off${off.guest_name && off.guest_name !== 'Time off' ? ': ' + off.guest_name : ''}. Manage in Availability.`"
          ><b>Time off</b><small>{{ off.guest_name && off.guest_name !== 'Time off' ? off.guest_name : 'Blocked' }}<template v-if="team"> · {{ memberFirstName(memberFor(off)) }}</template></small></RouterLink>
          <button
            v-for="booking in day.items"
            :key="booking.id"
            type="button"
            class="week-item"
            :class="[booking.status, { 'has-staff': team }]"
            :style="team ? { '--staff': staffColor(booking) } : undefined"
            :title="`${booking.service_name} · ${booking.guest_name}${team ? ' · with ' + staffName(booking) : ''} · ${zoneLabel(booking)}`"
            @click="openDetail(booking)"
          ><b class="tnum">{{ time(booking) }}</b><span>{{ booking.service_name }}</span><small>{{ booking.guest_name }}<template v-if="isDone(booking)"> · {{ statusLabel(booking.status) }}</template></small><small v-if="team" class="week-staff">{{ memberFirstName(memberFor(booking)) }}</small></button>
          <p v-if="!day.items.length && !day.off.length" class="week-empty">—</p>
        </div>
      </div>
    </div>

    <div v-else-if="groups.length" class="booking-list">
      <section v-for="group in groups" :key="group.key" class="day-group">
        <h3 class="day-heading">{{ group.label }}<small>{{ group.items.length }}</small></h3>
        <div v-for="booking in group.items" :key="booking.id" class="booking-row" :class="{ selecting }">
        <label v-if="selecting" class="pick-box" :title="`Select ${booking.guest_name}, ${when(booking)}`">
          <input type="checkbox" :checked="picked.includes(booking.id)" :aria-label="`Select ${booking.guest_name}, ${booking.service_name}, ${when(booking)}`" @change="togglePick(booking.id)" />
        </label>
        <article class="card booking-card" :class="{ 'is-cancelled': isCancelled(booking), 'is-picked': picked.includes(booking.id) }">
          <div class="date-tile"><small>{{ dateParts(booking).weekday }}</small><strong>{{ dateParts(booking).day }}</strong><span>{{ dateParts(booking).month }}</span></div>
          <div class="booking-main">
            <div class="booking-title">
              <h2>{{ booking.service_name }}</h2>
              <span class="chip" :class="booking.status">{{ statusLabel(booking.status) }}</span>
              <span v-if="team" class="chip staff-chip" :title="`With ${staffName(booking)}`"><i class="staff-dot" :style="{ background: staffColor(booking) }" aria-hidden="true" />{{ staffName(booking) }}</span>
              <span v-if="booking.source === 'owner'" class="chip accent">Added by you</span>
              <span v-if="isSeries(booking)" class="chip accent">Repeats weekly</span>
              <span v-if="onCalendar(booking) && !isCancelled(booking)" class="chip success">On calendar</span>
              <template v-if="conflictTitles(booking).length">
                <span class="chip warning">Clashes with calendar</span>
                <GmHint :text="`This booking overlaps another event on your Google Calendar: ${conflictTitles(booking).join(', ')}. Check it, or move one of them.`" label="About the calendar clash" />
              </template>
            </div>
            <p>
              <AppIcon name="clock" :size="16" /><span class="tnum">{{ time(booking) }} · {{ duration(booking) }} min · {{ zoneLabel(booking) }}</span>
            </p>
            <div class="guest-line">
              <span class="guest-avatar">{{ String(booking.guest_name || '?').slice(0, 1).toUpperCase() }}</span>
              <span><strong>{{ booking.guest_name }}</strong><small>{{ emailText(booking) }}<template v-if="booking.guest_phone"> · {{ booking.guest_phone }}</template></small></span>
            </div>
          </div>
          <div class="booking-end">
            <small class="ref">{{ booking.reference }}</small>
            <span v-if="booking.status === 'confirmed' && hasStarted(booking)" class="quick-actions">
              <span class="quick-label">Did it happen?</span>
              <GmHint wrap :text="isDemo ? demoHint : 'Use when the appointment took place. You can undo this.'" v-slot="{ describedby }">
                <button class="secondary small-button" type="button" :disabled="actionBusy" :aria-disabled="isDemo || undefined" :aria-describedby="describedby" @click="changeStatus(booking, 'completed')">Mark completed</button>
              </GmHint>
              <GmHint wrap :text="isDemo ? demoHint : 'Use when the client did not turn up. You can undo this.'" v-slot="{ describedby }">
                <button class="secondary small-button" type="button" :disabled="actionBusy" :aria-disabled="isDemo || undefined" :aria-describedby="describedby" @click="changeStatus(booking, 'no_show')">Mark no-show</button>
              </GmHint>
            </span>
            <span v-else-if="isDone(booking)" class="quick-actions">
              <GmHint wrap :text="isDemo ? demoHint : 'Puts this booking back to confirmed.'" v-slot="{ describedby }">
                <button class="ghost small-button" type="button" :disabled="actionBusy" :aria-disabled="isDemo || undefined" :aria-describedby="describedby" @click="changeStatus(booking, 'confirmed')">Undo {{ booking.status === 'no_show' ? 'no-show' : 'completed' }}</button>
              </GmHint>
            </span>
            <button class="secondary small-button" type="button" @click="openDetail(booking)">View details<AppIcon name="chevron" :size="16" /></button>
          </div>
        </article>
        </div>
      </section>
    </div>

    <div v-else class="empty">
      <span class="empty-icon"><AppIcon name="bookings" /></span>
      <h2>{{
        hasFilters
          ? 'No bookings match your filters'
          : !hasAnyBookings
            ? 'No bookings yet'
            : `No ${tabs.find((tab) => tab.id === activeTab)?.label.toLowerCase() || activeTab} bookings`
      }}</h2>
      <p v-if="hasFilters">Try a guest name, email, service, booking reference, or a wider date range.</p>
      <p v-else-if="!hasAnyBookings">
        {{ setup.hasLink
          ? 'Share your booking link and bookings will appear here as soon as a guest books a slot. You can also add a booking yourself for a walk-in or phone call.'
          : `Guests book through your public booking link, which is ready once setup is done. Next step: ${(setup.nextStep?.label || 'finish setup').toLowerCase()}. You can also add a booking yourself.` }}
      </p>
      <p v-else>Nothing here right now. Other tabs may have bookings.</p>
      <div class="empty-actions">
        <GmButton v-if="hasFilters" variant="secondary" @click="clearFilters">Clear filters</GmButton>
        <template v-else-if="!hasAnyBookings">
          <GmButton v-if="setup.hasLink" variant="primary" @click="copyShareLink">Copy your booking link</GmButton>
          <RouterLink v-else class="primary button-link" :to="setup.nextStep?.to || '/settings'">{{ setup.nextStep?.label || 'Finish setup' }}</RouterLink>
          <GmButton variant="secondary" :disabled-reason="demoHint" @click="openNew">New booking</GmButton>
        </template>
        <template v-else>
          <GmButton v-if="activeTab !== 'all'" variant="secondary" @click="activeTab = 'all'">View all bookings</GmButton>
          <GmButton v-if="setup.hasLink" variant="secondary" @click="copyShareLink">Copy your booking link</GmButton>
        </template>
      </div>
    </div>
    </div>

    <GmDialog
      :open="Boolean(selected)"
      :title="selected?.service_name || 'Booking details'"
      :busy="cancelling"
      content-class="card modal booking-detail"
      overlay-class="modal-backdrop"
      @update:open="open => { if (!open) requestClose() }"
    >
      <template v-if="selected">
        <div class="modal-header">
          <div>
            <p class="eyebrow">Booking {{ selected.reference }}</p>
            <h2 id="booking-detail-title">{{ selected.service_name }}</h2>
          </div>
          <button class="icon-button" type="button" aria-label="Close" @click="requestClose"><AppIcon name="close" /></button>
        </div>
        <div v-if="error" class="notice error" role="alert"><AppIcon name="alert" :size="18" />{{ error }}</div>
        <div class="detail-when">
          <span><AppIcon name="calendar" :size="20" /></span>
          <div>
            <strong>{{ when(selected) }}</strong>
            <small>{{ duration(selected) }} minutes · {{ zoneLabel(selected) }}</small>
          </div>
          <span class="status-cell">
            <span class="chip" :class="selected.status">{{ statusLabel(selected.status) }}</span>
            <GmHint :text="STATUS_HELP" label="What the statuses mean" />
          </span>
        </div>
        <div v-if="detailNotice" class="notice success" role="status"><AppIcon name="check" :size="18" />{{ detailNotice }}</div>

        <section v-if="team" class="panel-box staff-panel" aria-labelledby="staff-heading">
          <h3 id="staff-heading">Team member <GmHint text="Who is doing this booking. Assigning a confirmed booking moves it onto that person's own calendar, so it is refused if they are busy or on time off at that time. Finished or cancelled bookings only change the name recorded." label="About assigning a booking" /></h3>
          <p class="staff-now"><span class="chip staff-chip"><i class="staff-dot" :style="{ background: staffColor(selected) }" aria-hidden="true" />{{ staffName(selected) }}</span><small v-if="memberFor(selected).removed" class="muted">No longer on your team</small><small v-else-if="!isStaffActive(memberFor(selected))" class="muted">Inactive</small></p>
          <div class="assign-row">
            <div class="field">
              <label for="assign-to">Assign to…</label>
              <select id="assign-to" v-model="assignTo" :disabled="isDemo || assignBusy">
                <option value="" disabled>Choose a person</option>
                <option v-for="option in assignOptions" :key="option.id" :value="option.id" :disabled="option.disabled">{{ option.label }}</option>
              </select>
            </div>
            <GmButton variant="secondary" size="sm" :pending="assignBusy" pending-label="Assigning…" :disabled-reason="assignReason" @click="assignSelected">Assign</GmButton>
          </div>
        </section>

        <section
          v-if="canMove(selected) && hasStarted(selected) && !rescheduling"
          class="panel-box"
          aria-labelledby="happened-heading"
        >
          <h3 id="happened-heading">Did this appointment happen?</h3>
          <div class="form-actions">
            <GmButton v-if="selected.status !== 'completed'" variant="secondary" size="sm" :disabled="actionBusy" :disabled-reason="demoHint" @click="changeStatus(selected, 'completed')">Mark completed</GmButton>
            <GmButton v-if="selected.status !== 'no_show'" variant="secondary" size="sm" :disabled="actionBusy" :disabled-reason="demoHint" @click="changeStatus(selected, 'no_show')">Mark no-show</GmButton>
            <GmButton v-if="isDone(selected)" variant="ghost" size="sm" :disabled="actionBusy" :disabled-reason="demoHint" @click="changeStatus(selected, 'confirmed')">Undo (back to confirmed)</GmButton>
            <GmHint text="No-show means the client did not turn up. It stays in history and you can undo it." label="About no-show" />
          </div>
        </section>

        <p v-if="selected.source === 'owner' || isSeries(selected)" class="badge-row">
          <span v-if="selected.source === 'owner'" class="chip accent">Added by you</span>
          <span v-if="isSeries(selected)" class="chip accent">Repeats weekly</span>
        </p>
        <p v-if="conflictTitles(selected).length && isUpcoming(selected)" class="muted error-text">
          Overlaps on your Google Calendar: {{ conflictTitles(selected).join(', ') }}.
          <GmHint text="Your Google Calendar has another event at the same time as this booking. Check it, or reschedule one of them." label="About the calendar clash" />
        </p>
        <p v-if="onCalendar(selected)" class="muted">On Google Calendar{{ isCancelled(selected) ? '. The event was marked cancelled when this booking was cancelled, if Calendar was available.' : '.' }}</p>

        <section class="detail-section" aria-labelledby="guest-heading">
          <h3 id="guest-heading">Guest</h3>
          <dl class="detail-list">
            <dt>Name</dt><dd>{{ selected.guest_name }}</dd>
            <dt>Email</dt>
            <dd><a v-if="hasRealEmail(selected.guest_email)" :href="`mailto:${selected.guest_email}`">{{ selected.guest_email }}</a><template v-else>No email</template></dd>
            <dt>Phone</dt><dd>{{ selected.guest_phone || 'Not supplied' }}</dd>
            <dt>Notes</dt><dd>{{ selected.notes || 'No notes supplied.' }}</dd>
          </dl>
        </section>
        <section class="panel-box" aria-labelledby="owner-notes-label">
          <label id="owner-notes-label" for="owner-notes">
            <h3>Private owner notes</h3><span class="private-tag">Private — guests never see this</span>
            <GmHint text="Only you can see this. It is stored in your own Bookins data and is never shown to the client or included in messages. Save it before you close this window." label="About private notes" />
          </label>
          <textarea
            id="owner-notes"
            v-model="notesDraft"
            class="input"
            maxlength="4000"
            :disabled="isDemo || notesSaving"
            placeholder="Add a note for yourself, such as preferences or follow-ups"
          ></textarea>
          <div class="form-actions">
            <GmButton variant="secondary" size="sm" :pending="notesSaving" pending-label="Saving…" :disabled-reason="isDemo ? demoHint : !notesDirty ? 'Type a note to save it.' : ''" @click="saveNotes">Save note</GmButton>
            <span v-if="notesDirty" class="muted unsaved" role="status">Not saved yet</span>
          </div>
        </section>

        <section v-if="!rescheduling" class="panel-box" aria-labelledby="message-heading">
          <h3 id="message-heading">Message client <GmHint text="Each option opens your own WhatsApp, SMS or email app with the text already written. You press send there. Bookins sends nothing and cannot tell whether you did." label="How messages work" /></h3>
          <p class="muted">Pick a message, then open it in your own WhatsApp, SMS or email app. Bookins does not send anything.</p>
          <div class="segmented kind-row" role="group" aria-label="Message type">
            <button
              v-for="kind in MESSAGE_KINDS"
              :key="kind.id"
              type="button"
              :class="{ 'is-active': messageKind === kind.id }"
              :aria-pressed="messageKind === kind.id"
              @click="openMessage(kind.id)"
            >{{ kind.label }}<span v-if="isSuggestedKind(kind.id)" class="suggested-dot" aria-hidden="true"></span></button>
          </div>
          <p v-if="composed" class="muted hint message-cue">Showing: {{ MESSAGE_KINDS.find((kind) => kind.id === messageKind)?.label }}.<template v-if="isSuggestedKind(messageKind)"> Suggested because {{ SUGGESTED_WHY[messageKind] }}.</template> Pick another type above to change it.</p>
          <p v-else class="muted hint">Choose a message type above to preview it.</p>
          <div v-if="composed" class="message-preview">
            <p class="message-text" tabindex="0" aria-label="Message text">{{ composed.text }}</p>
            <div class="form-actions">
              <GmHint v-if="composed.whatsapp" wrap text="Opens your own WhatsApp with this message ready. You press send there." v-slot="{ describedby }">
                <a class="secondary small-button link-button" :href="composed.whatsapp" target="_blank" rel="noopener noreferrer" :aria-describedby="describedby" @click="openedApp('WhatsApp')">Open WhatsApp</a>
              </GmHint>
              <GmHint v-if="composed.sms" wrap text="Opens the SMS app on this device with the message filled in. You press send there." v-slot="{ describedby }">
                <a class="secondary small-button link-button" :href="composed.sms" :aria-describedby="describedby" @click="openedApp('SMS')">Open SMS</a>
              </GmHint>
              <GmHint v-if="emailUsable" wrap text="Opens your own email app with the message filled in. You press send there." v-slot="{ describedby }">
                <a class="secondary small-button link-button" :href="composed.email" :aria-describedby="describedby" @click="openedApp('your email app')">Open email</a>
              </GmHint>
              <button class="secondary small-button" type="button" @click="copyMessage">Copy message</button>
            </div>
            <p v-if="!composed.whatsapp" class="muted hint">{{ phoneProblem }}</p>
            <p v-if="!emailUsable" class="muted hint">No email on this booking, so Open email is not available.</p>
            <p v-if="messageNotice" class="muted" role="status">{{ messageNotice }}</p>
          </div>
        </section>

        <form v-if="rescheduling && canMove(selected)" class="panel-box" @submit.prevent="requestMove">
          <h3>Reschedule</h3>
          <p class="muted">Times are in {{ zoneName(moveZone) }}. The booking keeps its {{ duration(selected) }} minute length. You will be warned if the new time is in the past or outside your weekly hours.</p>
          <p v-if="onCalendar(selected)" class="muted">This booking is on your Google Calendar. Rescheduling here does not move that event; change it in Google Calendar yourself.</p>
          <div v-if="rescheduleError" class="notice error" role="alert"><AppIcon name="alert" :size="18" />{{ rescheduleError }}</div>
          <div class="field-row">
            <div class="field">
              <label for="move-date">New date</label>
              <input id="move-date" v-model="moveForm.date" type="date" required />
            </div>
            <div class="field">
              <label for="move-time">New time</label>
              <input id="move-time" v-model="moveForm.time" type="time" required />
            </div>
          </div>
          <div class="form-actions modal-footer">
            <GmConfirm
              v-model:open="moveWarnOpen"
              title="Move this booking anyway?"
              :message="moveWarning"
              confirm-label="Move anyway"
              cancel-label="Choose another time"
              @confirm="submitReschedule"
            >
              <GmButton variant="primary" type="submit" :pending="rescheduleSaving" pending-label="Moving…" :disabled-reason="demoHint">Move booking</GmButton>
            </GmConfirm>
            <GmButton variant="secondary" :disabled="rescheduleSaving" @click="rescheduling = false">Keep current time</GmButton>
          </div>
        </form>

        <div v-if="canCancel(selected) && !isDemo" class="field cancel-reason">
          <label for="cancellation-reason">If you cancel: reason (optional, private)</label>
          <textarea id="cancellation-reason" v-model.trim="cancellationReason" maxlength="500" placeholder="Add a private note for your records"></textarea>
        </div>

        <p v-if="selected.status !== 'cancelled' && !canCancel(selected)" class="muted past-note">This appointment has already happened, so it can no longer be cancelled.</p>
        <div class="form-actions modal-footer detail-actions">
          <GmButton
            v-if="calendarConnected && canCancel(selected) && selected.status === 'confirmed' && !onCalendar(selected)"
            variant="secondary"
            :pending="calendarBusy"
            pending-label="Adding…"
            @click="addToCalendar(selected)"
          >Add to Google Calendar</GmButton>
          <GmButton v-if="canMove(selected) && !rescheduling" variant="secondary" :disabled-reason="demoHint" @click="startReschedule">Reschedule</GmButton>
          <GmConfirm
            v-if="canCancel(selected)"
            v-model:open="cancelOpen"
            title="Cancel and reopen this slot?"
            :message="cancelMessage"
            confirm-label="Cancel booking"
            cancel-label="Keep booking"
            tone="danger"
            :busy="cancelling"
            @confirm="cancel"
          >
            <GmButton variant="danger" :pending="cancelling" pending-label="Cancelling…" :disabled-reason="demoHint" @click="cancelOpen = true">Cancel booking</GmButton>
          </GmConfirm>
          <GmButton
            v-else-if="selected.status !== 'cancelled'"
            variant="danger"
            disabled-reason="This appointment has already happened, so it can no longer be cancelled."
          >Cancel booking</GmButton>
          <GmConfirm
            v-model:open="discardOpen"
            title="Discard unsaved changes?"
            :message="discardMessage"
            confirm-label="Discard and close"
            cancel-label="Keep editing"
            tone="danger"
            @confirm="discardDialog"
            @cancel="keepEditing"
          >
            <GmButton variant="secondary" @click="requestClose">Close</GmButton>
          </GmConfirm>
        </div>
      </template>
    </GmDialog>

    <GmDialog
      :open="newOpen"
      title="New booking"
      :busy="newSaving"
      content-class="card modal booking-detail"
      overlay-class="modal-backdrop"
      @update:open="open => { if (!open) requestCloseNew() }"
    >
      <form novalidate @submit.prevent="submitNew">
        <div class="modal-header">
          <div>
            <p class="eyebrow">Walk-in or phone booking</p>
            <h2>New booking</h2>
          </div>
          <button class="icon-button" type="button" aria-label="Close" @click="requestCloseNew"><AppIcon name="close" /></button>
        </div>

        <template v-if="newResult">
          <div class="notice success" role="status"><AppIcon name="check" :size="18" />Saved {{ newResult.created.length }} booking{{ newResult.created.length === 1 ? '' : 's' }}. Nothing was sent to the client.</div>
          <div v-if="newResult.skipped.length" class="panel-box" role="status">
            <strong>{{ newResult.skipped.length }} repeat{{ newResult.skipped.length === 1 ? '' : 's' }} skipped</strong>
            <ul class="skipped"><li v-for="item in newResult.skipped" :key="item.startsAt">{{ skippedLabel(item) }}: {{ item.reason }}</li></ul>
          </div>
          <div class="form-actions modal-footer">
            <GmButton v-if="newResult.created.length" variant="primary" @click="messageNewClient">Message client</GmButton>
            <GmButton variant="secondary" @click="closeNew">Done</GmButton>
          </div>
        </template>

        <div v-else-if="newBlocked" class="empty empty-inline">
          <span class="empty-icon"><AppIcon name="bookings" /></span>
          <h2>{{ !setup.hasAvailability ? 'Set your hours first' : 'Add a service first' }}</h2>
          <p>{{ newBlocked.text }}</p>
          <div class="empty-actions">
            <RouterLink class="primary button-link" :to="newBlocked.to" @click="closeNew">{{ newBlocked.label }}</RouterLink>
            <GmButton variant="secondary" @click="closeNew">Close</GmButton>
          </div>
        </div>

        <template v-else>
          <div v-if="newError" class="notice error" role="alert"><AppIcon name="alert" :size="18" />{{ newError }}</div>
          <div class="field">
            <label for="new-service">Service</label>
            <select id="new-service" v-model="form.serviceId" required>
              <option v-for="item in bookableServices" :key="item.id" :value="item.id">{{ displayName(item.name) }} · {{ item.duration_minutes }} min</option>
            </select>
          </div>
          <div v-if="team" class="field">
            <label for="new-staff">With <GmHint text="The booking goes on this person's own calendar, so two people can be booked at the same time. Only people who offer this service are listed." label="About choosing who it is with" /></label>
            <select id="new-staff" v-model="form.staffId" required :aria-describedby="newStaffReason ? 'new-staff-note' : undefined">
              <option v-for="item in eligibleMembers" :key="item.member.id" :value="item.member.id" :disabled="!item.hasHours">{{ memberName(item.member) }}{{ isOwnerMember(item.member) ? ' (owner)' : '' }}{{ item.hasHours ? '' : ' (set hours first)' }}</option>
            </select>
            <span v-if="newStaffReason" id="new-staff-note" class="field-hint">{{ newStaffReason }}</span>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="new-date">Date</label>
              <input id="new-date" v-model="form.date" type="date" required />
            </div>
            <div class="field">
              <label for="new-time">Time</label>
              <input id="new-time" v-model="form.time" type="time" required />
            </div>
          </div>
          <p class="field-hint form-hint">Date and time are in {{ zoneName(formZone) }}, {{ team && formMember && !isOwnerMember(formMember) ? memberFirstName(formMember) + "'s" : 'your' }} schedule timezone. You can book outside weekly hours, but not on top of {{ team && formMember && !isOwnerMember(formMember) ? 'their' : 'another' }} booking or time off.</p>
          <div class="field">
            <label for="new-name">Client name</label>
            <input id="new-name" v-model="form.name" maxlength="160" autocomplete="off" required />
          </div>
          <p id="new-contact-hint" class="field-hint form-hint">Enter an email, a phone number, or both (at least one). A phone number lets you message the client on WhatsApp or SMS.</p>
          <div class="field-row">
            <div class="field">
              <label for="new-email">Email <span class="optional">(or phone)</span></label>
              <input id="new-email" v-model="form.email" type="email" autocomplete="off" aria-describedby="new-contact-hint" />
            </div>
            <div class="field">
              <label for="new-phone">Phone <span class="optional">(or email)</span></label>
              <input id="new-phone" v-model="form.phone" type="tel" autocomplete="off" aria-describedby="new-contact-hint" />
            </div>
          </div>
          <div class="field">
            <label for="new-notes">Notes the client can see <span class="optional">(optional)</span></label>
            <textarea id="new-notes" v-model="form.notes" maxlength="2000"></textarea>
          </div>
          <div class="field">
            <label for="new-owner-notes">Private owner notes <span class="private-tag">Private — guests never see this</span></label>
            <textarea id="new-owner-notes" v-model="form.ownerNotes" maxlength="4000"></textarea>
          </div>
          <div class="field">
            <label for="new-repeat">Repeat weekly (extra weeks, 0 to 12)</label>
            <input id="new-repeat" v-model.number="form.repeatWeeks" type="number" min="0" max="12" step="1" />
            <span v-if="form.repeatWeeks > 0" class="field-hint">Creates this booking plus {{ Math.min(12, Math.floor(form.repeatWeeks)) }} more at the same local time. Weeks that clash are skipped and listed afterwards.</span>
          </div>
          <div class="form-actions modal-footer">
            <GmButton variant="primary" type="submit" :pending="newSaving" pending-label="Saving…" :disabled-reason="demoHint || newStaffReason">Save booking</GmButton>
            <GmConfirm
              v-model:open="newDiscardOpen"
              title="Discard this booking?"
              message="What you typed has not been saved and will be lost."
              confirm-label="Discard"
              cancel-label="Keep editing"
              tone="danger"
              @confirm="closeNew"
            >
              <GmButton variant="secondary" :disabled="newSaving" @click="requestCloseNew">Cancel</GmButton>
            </GmConfirm>
          </div>
        </template>
      </form>
    </GmDialog>
  </section>
</template>

<style scoped>
.filter-bar { align-items: flex-end; }
.filter-bar .field { min-width: 150px; flex: 0 1 190px; }
.filter-bar .filter-tail { margin-left: auto; display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.email-filter { margin: 0 0 var(--space-3); display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); font-size: var(--text-sm); }
.demo-note { margin: 0 0 var(--space-3); font-size: var(--text-sm); }
.error-text { color: var(--danger); }

/* Calendar strip (honest: no connect CTA unless the real flow exists) */
.calendar-panel { margin-bottom: var(--space-4); padding: var(--space-3) var(--space-4); display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-4); box-shadow: none; }
.calendar-copy { flex: 1 1 280px; min-width: 0; }
.calendar-copy strong { min-height: 28px; display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); font-size: var(--text-sm); }
.calendar-copy p { margin: 4px 0 0; font-size: var(--text-sm); }
.calendar-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.calendar-line { flex: 1 1 100%; margin: 0; font-size: var(--text-sm); }
.calendar-outcomes { flex: 1 1 100%; margin: 0; padding-left: 18px; font-size: var(--text-sm); }

.tab-bar { margin-bottom: var(--space-4); }
@media (max-width: 760px) {
  .tab-bar { flex-wrap: wrap; overflow: visible; -webkit-mask-image: none; mask-image: none; }
  .tab-bar > button { flex: 1 1 auto; justify-content: center; }
}
.suggested-dot { width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: var(--accent); display: inline-block; vertical-align: middle; }

/* Agenda */
.booking-list { display: grid; gap: var(--space-5); }
.day-group { display: grid; gap: var(--space-2); }
.day-heading { position: sticky; top: calc(var(--topbar-h) + 4px); z-index: 5; margin: 0; padding: var(--space-2) 0; display: flex; align-items: center; gap: var(--space-2); color: var(--ink-soft); background: linear-gradient(var(--surface-soft) 75%, transparent); font-size: var(--text-sm); font-weight: 700; }
.day-heading small { min-width: 20px; padding: 1px 7px; border-radius: var(--radius-pill); background: #e9ebf3; color: var(--muted); font-size: 0.75rem; text-align: center; }
.booking-card { padding: var(--space-4); display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; align-items: center; gap: var(--space-4); box-shadow: none; transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease); }
.booking-card:hover { border-color: var(--line-strong); box-shadow: var(--shadow); }
.booking-card.is-cancelled { background: #fafafc; }
.booking-card.is-cancelled .date-tile { color: var(--muted); border-color: var(--line); background: #f1f2f6; }
.date-tile { width: 60px; height: 68px; display: grid; place-items: center; align-content: center; color: var(--accent); border: 1px solid var(--accent-line); border-radius: var(--radius-sm); background: var(--accent-soft); }
.date-tile small, .date-tile span { font-size: 0.75rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
.date-tile strong { font-size: 22px; line-height: 1.05; }
.booking-main { min-width: 0; }
.booking-title { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.booking-title h2 { margin: 0; font-size: var(--text-lg); }
.booking-main > p { margin: 6px 0 var(--space-3); display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: var(--text-sm); }
.guest-line { display: flex; align-items: center; gap: var(--space-2); }
.guest-avatar { width: 32px; height: 32px; flex: none; display: grid; place-items: center; color: var(--accent); border-radius: 50%; background: var(--accent-soft); font-size: var(--text-sm); font-weight: 750; }
.guest-line > span:last-child { min-width: 0; display: grid; gap: 1px; }
.guest-line strong, .guest-line small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.guest-line strong { font-size: var(--text-sm); }
.guest-line small { color: var(--muted); font-size: var(--text-xs); }
.booking-end { display: grid; justify-items: end; gap: var(--space-2); }
.booking-end > .ref { color: var(--muted); font-family: var(--font-mono); font-size: var(--text-xs); font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
.quick-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; justify-content: flex-end; }

/* Team */
.staff-chip { gap: 6px; }
.staff-dot { width: 10px; height: 10px; flex: none; display: inline-block; border-radius: 50%; }
.booking-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); }
.booking-row.selecting { grid-template-columns: 44px minmax(0, 1fr); align-items: center; }
.pick-box { width: 44px; height: 44px; display: grid; place-items: center; cursor: pointer; }
.pick-box input { width: 22px; height: 22px; min-height: 0; margin: 0; cursor: pointer; }
.booking-card.is-picked { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.bulk-bar { margin-bottom: var(--space-4); padding: var(--space-3) var(--space-4); display: grid; gap: var(--space-3); box-shadow: none; border-color: var(--accent-line); background: var(--accent-faint); }
.bulk-top { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-3); font-size: var(--text-sm); }
.bulk-done { margin-left: auto; }
.bulk-controls { display: flex; align-items: flex-end; flex-wrap: wrap; gap: var(--space-3); }
.bulk-controls .field { margin: 0; min-width: 200px; flex: 0 1 280px; }
.bulk-result { padding: var(--space-3); display: grid; justify-items: start; gap: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; font-size: var(--text-sm); }
.bulk-result p { margin: 0; }
.refused { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.staff-panel .staff-now { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.assign-row { display: flex; align-items: flex-end; flex-wrap: wrap; gap: var(--space-3); }
.assign-row .field { margin: 0; flex: 1 1 220px; min-width: 0; }
.week-legend { margin: 0 0 var(--space-3); padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); font-size: var(--text-sm); }
.week-legend li { display: inline-flex; align-items: center; gap: 6px; }
.legend-swatch { width: 14px; height: 10px; display: inline-block; border: 1px dashed var(--line-strong); border-radius: 3px; background: repeating-linear-gradient(45deg, #f6f7fa, #f6f7fa 3px, #e4e7ee 3px, #e4e7ee 6px); }

/* Week */
.week-nav { margin-bottom: var(--space-3); display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); font-size: var(--text-sm); }
.week-nav .muted { margin-right: auto; font-size: var(--text-xs); }
.week-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: var(--space-2); }
.week-day { min-height: 160px; padding: var(--space-2); display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; }
.week-day.today { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.week-day header { padding-bottom: 6px; display: grid; gap: 1px; border-bottom: 1px solid var(--line); }
.week-day header small { color: var(--muted); font-size: var(--text-xs); font-weight: 750; text-transform: uppercase; }
.week-day header strong { font-size: var(--text-sm); }
.week-item { min-height: 44px; padding: 6px 8px; display: grid; gap: 1px; text-align: left; border: 1px solid var(--accent-line); border-radius: 8px; background: var(--accent-soft); font-size: var(--text-xs); }
.week-item.cancelled { color: var(--muted); border-color: var(--line); background: #f6f7fa; text-decoration: line-through; }
.week-item.completed { border-color: #c9d8ff; background: #eef3ff; }
.week-item.no_show { border-color: #f1dcae; background: var(--warning-soft); }
.week-item b { font-size: var(--text-sm); }
.week-item span, .week-item small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.week-off { padding: 6px 8px; display: grid; gap: 1px; color: var(--muted); border: 1px dashed var(--line-strong); border-radius: 8px; background: repeating-linear-gradient(45deg, #f6f7fa, #f6f7fa 6px, #eef0f5 6px, #eef0f5 12px); font-size: var(--text-xs); text-decoration: none; }
.week-off b { font-size: var(--text-sm); }
.week-item.has-staff { border-left: 4px solid var(--staff); }
.week-item.has-staff:not(.cancelled):not(.completed):not(.no_show) { background: color-mix(in srgb, var(--staff) 11%, #fff); border-color: color-mix(in srgb, var(--staff) 38%, #fff); border-left-color: var(--staff); }
.week-item .week-staff { color: var(--ink-soft, var(--muted)); font-weight: 650; }
.week-empty { margin: auto; color: var(--line-strong); }

/* Dialogs */
.tab-help { margin: calc(var(--space-2) * -1) 0 var(--space-4); display: flex; align-items: center; flex-wrap: wrap; gap: 4px; font-size: var(--text-sm); }
.quick-label { align-self: center; color: var(--muted); font-size: var(--text-xs); }
.empty-actions { margin-top: var(--space-4); display: flex; justify-content: center; flex-wrap: wrap; gap: var(--space-2); }
.button-link { min-height: 44px; padding: 0 var(--space-4); display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); text-decoration: none; font-weight: 700; }
.empty-inline { margin: var(--space-4) 0; }
.status-cell { display: inline-flex; align-items: center; gap: 4px; }
.unsaved { color: var(--warning); font-weight: 700; }
.optional { color: var(--muted); font-weight: 400; }
.form-hint { margin: 0 0 var(--space-4); }
.past-note { margin: var(--space-3) 0 0; font-size: var(--text-sm); }
.cancel-reason { margin-top: var(--space-4); }
.cancel-reason textarea { min-height: 64px; }
.detail-actions { align-items: flex-start; }
.booking-detail .notice { margin-top: var(--space-3); }
.detail-when { padding: var(--space-3); display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: var(--space-3); border-radius: var(--radius-sm); background: var(--accent-faint); }
.detail-when > span:first-child { width: 40px; height: 40px; display: grid; place-items: center; color: var(--accent); border-radius: var(--radius-sm); background: var(--accent-soft); }
.detail-when div { display: grid; gap: 2px; }
.detail-when strong { font-size: var(--text-md); }
.detail-when small { color: var(--muted); font-size: var(--text-sm); }
.badge-row { margin: var(--space-3) 0 0; display: flex; gap: 6px; flex-wrap: wrap; }
.booking-detail p.muted { margin: var(--space-3) 0 0; font-size: var(--text-sm); }
.detail-section { margin-top: var(--space-4); }
.detail-section h3, .panel-box h3 { margin: 0; font-size: var(--text-sm); font-weight: 700; letter-spacing: 0.01em; }
.detail-section h3 { margin-bottom: var(--space-2); color: var(--muted); font-size: var(--text-xs); letter-spacing: 0.06em; text-transform: uppercase; }
.detail-list dd a { color: var(--accent); }
.panel-box { margin-top: var(--space-4); padding: var(--space-4); display: grid; gap: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--accent-faint); }
.panel-box > * { margin: 0; }
.panel-box > p { font-size: var(--text-sm); }
.panel-box label { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; }
.panel-box textarea { min-height: 88px; }
.private-tag { color: var(--warning); font-size: var(--text-xs); font-weight: 700; }
.kind-row { max-width: 100%; display: flex; overflow-x: auto; scrollbar-width: none; }
.kind-row::-webkit-scrollbar { display: none; }
.kind-row button { flex: none; white-space: nowrap; }
.message-preview { display: grid; gap: var(--space-3); }
.message-text { padding: var(--space-3); max-height: 190px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; font-size: var(--text-sm); }
.link-button { min-height: var(--control-h-sm); display: inline-flex; align-items: center; justify-content: center; text-decoration: none; }
.hint { font-size: var(--text-xs); }
.zone-line { margin: calc(var(--space-2) * -1) 0 var(--space-4); font-size: var(--text-xs); }
.confirm-box .field { margin-top: var(--space-3); margin-bottom: var(--space-3); }
.confirm-box textarea { min-height: 80px; }
.skipped { margin: 0; padding-left: 18px; font-size: var(--text-sm); }
.booking-detail .modal-footer { margin-top: var(--space-5); }
.detail-actions { justify-content: flex-end; }
.modal .field { min-width: 0; }
.modal .field-row .field { margin-bottom: var(--space-4); }

@media (max-width: 900px) {
  .week-grid { grid-template-columns: 1fr; }
  .week-day { min-height: 0; }
  .filter-bar .filter-tail { margin-left: 0; }
}
@media (max-width: 700px) {
  .booking-row.selecting { position: relative; grid-template-columns: minmax(0, 1fr); }
  .booking-row.selecting .pick-box { position: absolute; top: 4px; right: 4px; z-index: 2; border-radius: var(--radius-sm); background: rgba(255, 255, 255, 0.92); }
  .booking-row.selecting .booking-title { padding-right: 44px; }
  .filter-bar .field { flex: 1 1 140px; }
  .booking-card { grid-template-columns: 54px minmax(0, 1fr); gap: var(--space-3); padding: var(--space-3); }
  .booking-end { grid-column: 1/-1; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); }
  .booking-end > .ref { flex: 1 1 100%; }
  .quick-actions { justify-content: flex-start; }
  .date-tile { width: 54px; height: 62px; }
  .detail-when { grid-template-columns: 40px minmax(0, 1fr); }
  .detail-when .chip { grid-column: 1/-1; justify-self: start; }
  .modal-footer > button, .modal-footer > a { flex: 1 1 auto; }
  .quick-label { width: 100%; }
}
</style>

<style>
.booking-detail { width: min(620px, 100%); }
</style>
