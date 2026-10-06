<script setup>
import { csvCell } from '../csv.js'
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, RouterLink, useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import GmDialog from '../components/ui/GmDialog.vue'
import {
  addBookingToCalendar,
  addBookingsToCalendar,
  calendarMode,
  cancelBookingWithCalendar,
  connectGoogleCalendar,
  copyText,
  createOwnerBooking,
  findCalendarConflicts,
  getCalendarStatus,
  hasRealEmail,
  isActiveTimeOff,
  isTimeOff,
  listCalendarEvents,
  rescheduleBooking,
  saveBookingNotes,
  setBookingStatus,
} from '../booking.js'
import { composeMessage } from '../messaging.js'
import { localFields, wallClockInstant } from '../scheduling.js'
import { displayTimeZone } from '../time-display.js'
import { isDemo, registerDemoGuard } from '../runtime.js'

const state = inject('bookingState')
const toast = inject('toast', null)
// Time off is stored as a booking but is never a client appointment.
const isHidden = (booking) => isTimeOff(booking)
const realBookings = computed(() => (state.bookings || []).filter((item) => !isHidden(item)))
const timeOffBlocks = computed(() => (state.bookings || []).filter(isActiveTimeOff))
const refresh = inject('refreshBookings')
const router = useRouter()
const route = useRoute()
const activeTab = ref('upcoming')
const view = ref('agenda')
const query = ref('')
const emailFilter = ref('')
const serviceFilter = ref('')
const fromDate = ref('')
const toDate = ref('')
const weekOffset = ref(0)
const selected = ref(null)
const confirmCancel = ref(false)
const cancellationReason = ref('')
const cancelling = ref(false)
const notice = ref('')
const error = ref('')
const now = ref(Date.now())
const clock = window.setInterval(() => { now.value = Date.now() }, 30_000)
const leavePrompt = ref(false)
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
    if (!calendarConnected.value) calendarError.value = 'Google Calendar was not connected. Finish the Google sign-in window and try again.'
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
  calendarBusy.value = true
  calendarError.value = ''
  try {
    const result = await addBookingToCalendar(booking)
    await refresh()
    reselect(booking.id)
    flash(result.alreadyOnCalendar ? 'Already on your calendar.' : 'Added to Google Calendar.')
  } catch (reason) {
    calendarError.value = reason?.message || 'The booking could not be added to Google Calendar.'
  } finally {
    calendarBusy.value = false
  }
}

async function addAllToCalendar() {
  const targets = needsCalendar.value
  if (!targets.length) return
  calendarBusy.value = true
  calendarError.value = ''
  bulkOutcomes.value = []
  try {
    bulkOutcomes.value = await addBookingsToCalendar(targets)
    await refresh()
    const failed = bulkOutcomes.value.filter((item) => !item.ok).length
    flash(failed ? `Added ${bulkOutcomes.value.length - failed} of ${bulkOutcomes.value.length}. ${failed} failed.` : `Added ${bulkOutcomes.value.length} to Google Calendar.`)
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
  () => [route.query.q, route.query.email],
  ([q, email]) => {
    const text = (value) => (Array.isArray(value) ? value[0] : value) || ''
    if (route.path !== '/bookings') return
    query.value = String(text(q))
    emailFilter.value = String(text(email)).trim().toLowerCase()
    if (q || email) activeTab.value = 'all'
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
  pendingRoute.value = to.fullPath
  leavePrompt.value = true
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
  const [y, m, d] = key.split('-').map(Number)
  const text = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
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
      off: showOff ? timeOffBlocks.value.filter((item) => dayKey(item) <= key && key <= dayKey(item, endMs(item) - 1)) : [],
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
  Boolean(query.value.trim() || emailFilter.value || serviceFilter.value || fromDate.value || toDate.value),
)
function clearFilters() {
  query.value = ''
  serviceFilter.value = ''
  fromDate.value = ''
  toDate.value = ''
  if (emailFilter.value || route.query.q || route.query.email) {
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
  return new Date(booking.starts_at).toLocaleString(undefined, displayTimeOptions({
    dateStyle: 'full',
    timeStyle: 'short',
  }, booking))
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
  const fmt = (booking, at) => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: zone(booking), hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(at))
    } catch {
      return ''
    }
  }
  const rows = [[
    'Reference', 'Status', 'Service', 'Date', 'Start', 'End', 'Timezone', 'Starts at (UTC)',
    'Guest name', 'Guest email', 'Guest phone', 'Notes', 'Private owner notes', 'Source', 'Cancellation reason',
  ]]
  for (const booking of filtered.value) {
    rows.push([
      booking.reference, booking.status, booking.service_name, dayKey(booking),
      fmt(booking, booking.starts_at), fmt(booking, booking.ends_at), zone(booking),
      booking.starts_at, booking.guest_name,
      hasRealEmail(booking.guest_email) ? booking.guest_email : '', booking.guest_phone,
      booking.notes, booking.owner_notes, booking.source === 'owner' ? 'owner' : 'guest', booking.cancellation_reason,
    ])
  }
  downloadCsv(`bookings-${activeTab.value}-${todayKey.value}.csv`, rows)
  toast?.(`Exported ${filtered.value.length} booking${filtered.value.length === 1 ? '' : 's'}`)
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
  selected.value = realBookings.value.find((item) => item.id === id) || null
  if (selected.value) notesDraft.value = selected.value.owner_notes || ''
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
  actionBusy.value = true
  error.value = ''
  try {
    await setBookingStatus(booking, status)
    await refresh()
    if (selected.value?.id === booking.id) reselect(booking.id)
    const doneText = status === 'confirmed' ? 'Status set back to confirmed.' : `Marked as ${statusLabel(status).toLowerCase()}.`
    if (toast) toast(doneText)
    else {
      notice.value = doneText
      window.setTimeout(() => { notice.value = '' }, 3000)
    }
  } catch (reason) {
    error.value = describeError(reason, 'The status could not be changed.')
  } finally {
    actionBusy.value = false
  }
}

// ---- private owner notes ----
const notesDraft = ref('')
const notesSaving = ref(false)
const notesMessage = ref('')
const notesDirty = computed(() => Boolean(selected.value) && notesDraft.value !== (selected.value.owner_notes || ''))
watch(() => selected.value?.id, () => {
  notesDraft.value = selected.value?.owner_notes || ''
  notesMessage.value = ''
  if (!selected.value) messageKind.value = ''
})
async function saveNotes() {
  if (isDemo.value || !selected.value || notesSaving.value) return
  notesSaving.value = true
  notesMessage.value = ''
  error.value = ''
  try {
    const id = selected.value.id
    await saveBookingNotes(selected.value, notesDraft.value.trim())
    await refresh()
    reselect(id)
    notesMessage.value = 'Private note saved.'
    toast?.('Private note saved')
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
  { id: 'reschedule', label: 'Reschedule' },
  { id: 'cancellation', label: 'Cancellation' },
  { id: 'followup', label: 'Follow-up' },
]
const messageKind = ref('')
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
  })
})
const phoneProblem = computed(() =>
  selected.value?.guest_phone ? 'This phone number could not be read as an international number. Edit it in your phone app, or copy the message.' : 'No phone on this booking, so WhatsApp and SMS are not available.',
)
const emailUsable = computed(() => Boolean(composed.value?.email) && hasRealEmail(selected.value?.guest_email))
function openMessage(kind) {
  messageKind.value = messageKind.value === kind ? '' : kind
  messageNotice.value = ''
}
async function copyMessage() {
  if (!composed.value) return
  try {
    await copyText(composed.value.text)
    messageNotice.value = 'Message copied. Paste it into any app.'
    toast?.('Message copied')
  } catch {
    messageNotice.value = 'The message could not be copied. Select the text above and copy it yourself.'
  }
}

// ---- new booking (walk-in / phone / recurring) ----
const newOpen = ref(false)
const newSaving = ref(false)
const newError = ref('')
const newResult = ref(null)
const blankForm = () => ({ serviceId: '', date: '', time: '', name: '', email: '', phone: '', notes: '', ownerNotes: '', repeatWeeks: 0 })
const form = ref(blankForm())
const bookableServices = computed(() => (state.services || []).filter((item) => item.active !== false))
const formService = computed(() => (state.services || []).find((item) => item.id === form.value.serviceId))
const formZone = computed(() => scheduleFor(formService.value)?.timezone || state.schedules?.[0]?.timezone || 'UTC')

function openNew() {
  if (isDemo.value) return
  form.value = blankForm()
  form.value.serviceId = bookableServices.value[0]?.id || ''
  form.value.date = todayKey.value
  newError.value = ''
  newResult.value = null
  newOpen.value = true
}
function closeNew() {
  if (newSaving.value) return
  newOpen.value = false
}
async function submitNew() {
  if (isDemo.value || newSaving.value) return
  newError.value = ''
  const f = form.value
  if (!f.serviceId) return void (newError.value = 'Choose a service for this booking.')
  if (!f.name.trim()) return void (newError.value = 'Enter the client name.')
  if (!f.email.trim() && !f.phone.trim()) return void (newError.value = 'Enter an email address or a phone number so you can reach the client.')
  const when = instantFor(f.date, f.time, formZone.value)
  if (when.error) return void (newError.value = when.error)
  const repeatWeeks = Math.max(0, Math.min(12, Math.floor(Number(f.repeatWeeks) || 0)))
  newSaving.value = true
  try {
    const result = await createOwnerBooking(state, {
      serviceId: f.serviceId,
      startsAt: when.at,
      contact: { name: f.name, email: f.email, phone: f.phone },
      notes: f.notes,
      ownerNotes: f.ownerNotes,
      repeatWeeks,
    })
    await refresh()
    newResult.value = result
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
    reselect(first.id)
    messageKind.value = 'confirmation'
  }, 0)
}
const skippedLabel = (item) =>
  new Date(item.startsAt).toLocaleString(undefined, { timeZone: formZone.value, dateStyle: 'medium', timeStyle: 'short' })

// ---- reschedule ----
const rescheduling = ref(false)
const rescheduleSaving = ref(false)
const rescheduleError = ref('')
const moveNote = ref('')
const moveForm = ref({ date: '', time: '' })
const moveZone = computed(() => scheduleFor(selected.value)?.timezone || selected.value?.timezone || 'UTC')
function startReschedule() {
  if (isDemo.value || !selected.value) return
  const fields = localFields(selected.value.starts_at, moveZone.value)
  moveForm.value = { date: fields.date, time: fields.time }
  rescheduleError.value = ''
  moveNote.value = ''
  confirmCancel.value = false
  rescheduling.value = true
}
async function submitReschedule() {
  if (isDemo.value || rescheduleSaving.value || !selected.value) return
  rescheduleError.value = ''
  const when = instantFor(moveForm.value.date, moveForm.value.time, moveZone.value)
  if (when.error) return void (rescheduleError.value = when.error)
  if (Date.parse(when.at) === startMs(selected.value)) return void (rescheduleError.value = 'That is the current time. Choose a different date or time.')
  rescheduleSaving.value = true
  try {
    const id = selected.value.id
    const hadEvent = onCalendar(selected.value)
    await rescheduleBooking(state, selected.value, when.at)
    await refresh()
    reselect(id)
    rescheduling.value = false
    messageKind.value = 'reschedule'
    moveNote.value = `Booking moved. The old time is free again.${hadEvent ? ' Its Google Calendar event was not moved. Change or delete it in Google Calendar yourself.' : ''} Message the client so they know. Bookins does not send it for you.`
  } catch (reason) {
    rescheduleError.value = describeError(reason, 'The booking could not be moved.')
  } finally {
    rescheduleSaving.value = false
  }
}

function close() {
  if (cancelling.value || actionBusy.value) return
  selected.value = null
  messageKind.value = ''
  messageNotice.value = ''
  rescheduling.value = false
  rescheduleError.value = ''
  moveNote.value = ''
  confirmCancel.value = false
  cancellationReason.value = ''
  leavePrompt.value = false
  pendingRoute.value = ''
}

function keepEditing() {
  leavePrompt.value = false
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

async function cancel() {
  if (isDemo.value || !canCancel(selected.value)) return
  cancelling.value = true
  error.value = ''
  try {
    const outcome = await cancelBookingWithCalendar(selected.value, cancellationReason.value.trim() || 'Cancelled by owner')
    const cancelledId = selected.value.id
    await refresh()
    reselect(cancelledId)
    confirmCancel.value = false
    cancellationReason.value = ''
    messageKind.value = 'cancellation'
    const calendarState = outcome.calendar.state
    notice.value =
      calendarState === 'updated'
        ? 'Booking cancelled and the slot reopened. The Google Calendar event is marked as cancelled.'
        : calendarState === 'failed'
          ? `Booking cancelled and the slot reopened, but the Google Calendar event was not updated (${outcome.calendar.message}). Update or delete it in Google Calendar.`
          : calendarState === 'skipped'
            ? 'Booking cancelled and the slot reopened. Its Google Calendar event was not changed because Calendar is unavailable here; update it in Google Calendar.'
            : 'Booking cancelled and the slot reopened.'
    notice.value += ' You can message the client below. Bookins does not send it for you.'
    window.setTimeout(() => {
      notice.value = ''
    }, calendarState === 'failed' || calendarState === 'skipped' ? 12000 : 8000)
  } catch (reason) {
    error.value = reason?.message || 'The booking could not be cancelled.'
  } finally {
    cancelling.value = false
  }
}
</script>

<template>
  <section>
    <div class="page-header">
      <div
        ><p class="eyebrow">Appointments</p><h1>Bookings</h1
        ><p class="lede"
          >See who is coming, what they booked, and the details they shared. Times are shown in each
          booking's own timezone. Cancelled appointments stay in history.</p
        ></div
      >
      <div class="page-header-actions">
        <label class="search-field"
          ><AppIcon
            name="search"
            :size="18" /><span class="visually-hidden">Search bookings</span
          ><input
            v-model="query"
            type="search"
            placeholder="Guest, email, reference, service"
        /></label>
        <button
          class="secondary"
          type="button"
          :disabled="!filtered.length"
          @click="exportCsv"
          >Export CSV</button
        ><button
          class="primary"
          type="button"
          :disabled="isDemo"
          :title="demoHint || undefined"
          @click="openNew"
          >New booking</button
        >
      </div>
    </div>

    <div
      v-if="notice"
      class="notice success"
      role="status"
      ><AppIcon
        name="check"
        :size="18" />{{ notice }}</div
    >
    <p
      v-if="isDemo"
      class="muted demo-note"
      >{{ demoHint }} You can still open message links, which only prepare text in your own apps.</p
    >
    <div
      v-if="error && !selected"
      class="notice error"
      role="alert"
      >{{ error }}</div
    >

    <div
      class="card calendar-panel"
      :class="{ 'is-connected': calendarConnected }"
    >
      <div class="calendar-copy"
        ><strong><AppIcon
          name="calendar"
          :size="18" /> Google Calendar<span
          class="chip dot"
          :class="calendarConnected ? 'confirmed' : 'neutral'"
          >{{ calendarConnected ? 'Connected' : calendar.state === 'loading' ? 'Checking' : 'Not connected' }}</span
        ></strong
        ><p
          v-if="calendarHint"
          class="muted"
          >{{ calendarHint }}</p
        ><p
          v-else-if="calendarConnected"
          class="muted"
          >Add confirmed bookings to your calendar yourself. Each write asks for your approval and invites no one. Bookings that clash with other events are flagged.</p
        ></div
      >
      <div class="calendar-actions">
        <button
          v-if="calendar.state === 'not-connected'"
          class="primary small-button"
          type="button"
          :disabled="calendarBusy"
          @click="connectCalendar"
          >{{ calendarBusy ? 'Connecting…' : 'Connect Google Calendar' }}</button
        ><button
          v-if="calendar.state === 'error'"
          class="secondary small-button"
          type="button"
          @click="loadCalendarStatus"
          >Check again</button
        ><button
          v-if="calendarConnected"
          class="secondary small-button"
          type="button"
          :disabled="calendarBusy || !needsCalendar.length"
          @click="addAllToCalendar"
          >{{ calendarBusy ? 'Working…' : `Add all upcoming (${needsCalendar.length})` }}</button
        ></div
      >
      <p
        v-if="calendarNotice"
        class="calendar-line"
        role="status"
        >{{ calendarNotice }}</p
      >
      <p
        v-if="calendarError"
        class="calendar-line error-text"
        role="alert"
        >{{ calendarError }}</p
      >
      <p
        v-if="conflictNote"
        class="calendar-line muted"
        >{{ conflictNote }}</p
      >
      <ul
        v-if="bulkOutcomes.length"
        class="calendar-outcomes"
        ><li
          v-for="outcome in bulkOutcomes"
          :key="outcome.id"
          :class="{ 'error-text': !outcome.ok }"
          >{{ bulkLabel(outcome) }}: {{ outcome.ok ? (outcome.skipped ? 'already on calendar' : 'added') : outcome.message }}</li
        ></ul
      >
    </div>

    <div class="filter-bar">
      <div class="field"
        ><label for="filter-service">Service</label
        ><select id="filter-service" v-model="serviceFilter" class="input"
          ><option value="">All services</option
          ><option
            v-for="option in serviceOptions"
            :key="option.value"
            :value="option.value"
            >{{ option.label }}</option
          ></select
        ></div
      >
      <div class="field"
        ><label for="filter-from">From</label><input
          id="filter-from"
          v-model="fromDate"
          class="input"
          type="date"
          :max="toDate || undefined"
      /></div>
      <div class="field"
        ><label for="filter-to">To</label><input
          id="filter-to"
          v-model="toDate"
          class="input"
          type="date"
          :min="fromDate || undefined"
      /></div>
      <button
        v-if="hasFilters"
        class="ghost small-button"
        type="button"
        @click="clearFilters"
        >Clear filters</button
      >
      <div
        class="segmented filter-view"
        role="group"
        aria-label="View"
        ><button
          type="button"
          :class="{ 'is-active': view === 'agenda' }"
          :aria-pressed="view === 'agenda'"
          @click="view = 'agenda'"
          >Agenda</button
        ><button
          type="button"
          :class="{ 'is-active': view === 'week' }"
          :aria-pressed="view === 'week'"
          @click="view = 'week'"
          >Week</button
        ></div
      >
    </div>
    <p
      v-if="emailFilter"
      class="email-filter"
      >Showing history for <strong>{{ emailFilter }}</strong
      ><button
        class="ghost small-button"
        type="button"
        @click="clearEmail"
        >Show everyone</button
      ></p
    >

    <div
      class="tab-bar"
      role="tablist"
      aria-label="Booking status"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.id"
        :class="{ 'is-active': activeTab === tab.id }"
        @click="activeTab = tab.id"
        ><span>{{ tab.label }}</span
        ><span class="count-pill">{{ tab.count }}</span></button
      >
    </div>

    <div
      v-if="view === 'week'"
      class="week"
    >
      <div class="week-nav"
        ><button
          class="secondary small-button"
          type="button"
          @click="weekOffset -= 1"
          >Previous</button
        ><strong>{{ weekRange }}</strong
        ><span class="muted">Days in {{ scheduleZone }}</span
        ><button
          class="secondary small-button"
          type="button"
          :disabled="weekOffset === 0"
          @click="weekOffset = 0"
          >This week</button
        ><button
          class="secondary small-button"
          type="button"
          @click="weekOffset += 1"
          >Next</button
        ></div
      >
      <div class="week-grid">
        <div
          v-for="day in weekDays"
          :key="day.key"
          class="week-day"
          :class="{ today: day.today }"
        >
          <header
            ><small>{{ day.weekday }}</small
            ><strong>{{ day.label }}</strong></header
          >
          <RouterLink
            v-for="off in day.off"
            :key="off.id"
            to="/availability"
            class="week-off"
            :title="`Time off${off.guest_name && off.guest_name !== 'Time off' ? ': ' + off.guest_name : ''}. Manage in Availability.`"
            ><b>Time off</b><small>{{ off.guest_name && off.guest_name !== 'Time off' ? off.guest_name : 'Blocked' }}</small></RouterLink
          ><button
            v-for="booking in day.items"
            :key="booking.id"
            type="button"
            class="week-item"
            :class="booking.status"
            :title="`${booking.service_name} · ${booking.guest_name} · ${zoneLabel(booking)}`"
            @click="selected = booking"
            ><b class="tnum">{{ time(booking) }}</b
            ><span>{{ booking.service_name }}</span
            ><small>{{ booking.guest_name }}<template v-if="isDone(booking)"> · {{ statusLabel(booking.status) }}</template></small></button
          >
          <p
            v-if="!day.items.length && !day.off.length"
            class="week-empty"
            >—</p
          >
        </div>
      </div>
    </div>

    <div
      v-else-if="groups.length"
      class="booking-list"
    >
      <section
        v-for="group in groups"
        :key="group.key"
        class="day-group"
      >
        <h3 class="day-heading">{{ group.label }}<small>{{ group.items.length }}</small></h3>
        <article
          v-for="booking in group.items"
          :key="booking.id"
          class="card booking-card"
          :class="{ 'is-cancelled': isCancelled(booking) }"
        >
          <div class="date-tile"
            ><small>{{ dateParts(booking).weekday }}</small
            ><strong>{{ dateParts(booking).day }}</strong
            ><span>{{ dateParts(booking).month }}</span></div
          >
          <div class="booking-main">
            <div class="booking-title"
              ><h2>{{ booking.service_name }}</h2
              ><span
                class="chip"
                :class="booking.status"
                >{{ statusLabel(booking.status) }}</span
              ><span
                v-if="booking.source === 'owner'"
                class="chip accent"
                >Added by you</span
              ><span
                v-if="isSeries(booking)"
                class="chip accent"
                >Repeats weekly</span
              ><span
                v-if="onCalendar(booking) && !isCancelled(booking)"
                class="chip success"
                >On calendar</span
              ><span
                v-if="conflictTitles(booking).length"
                class="chip warning"
                :title="conflictTitles(booking).join(', ')"
                >Clashes with calendar</span
              ></div
            >
            <p
              ><AppIcon
                name="clock"
                :size="16"
              /><span class="tnum">{{
                time(booking)
              }}
              · {{ duration(booking) }} min · {{ zoneLabel(booking) }}</span></p
            >
            <div class="guest-line"
              ><span class="guest-avatar">{{
                String(booking.guest_name || '?')
                  .slice(0, 1)
                  .toUpperCase()
              }}</span
              ><span
                ><strong>{{ booking.guest_name }}</strong
                ><small>{{ emailText(booking) }}<template v-if="booking.guest_phone"> · {{ booking.guest_phone }}</template></small></span
              ></div
            >
          </div>
          <div class="booking-end"
            ><small class="ref">{{ booking.reference }}</small
            ><span
              v-if="booking.status === 'confirmed' && hasStarted(booking)"
              class="quick-actions"
              ><button
                class="secondary small-button"
                type="button"
                :disabled="isDemo || actionBusy"
                @click="changeStatus(booking, 'completed')"
                >Completed</button
              ><button
                class="secondary small-button"
                type="button"
                :disabled="isDemo || actionBusy"
                @click="changeStatus(booking, 'no_show')"
                >No-show</button
              ></span
            ><span
              v-else-if="isDone(booking)"
              class="quick-actions"
              ><button
                class="ghost small-button"
                type="button"
                :disabled="isDemo || actionBusy"
                @click="changeStatus(booking, 'confirmed')"
                >Undo</button
              ></span
            ><button
              class="secondary small-button"
              type="button"
              @click="selected = booking"
              >View details<AppIcon
                name="chevron"
                :size="16" /></button
          ></div>
        </article>
      </section>
    </div>

    <div
      v-else
      class="empty"
    >
      <span class="empty-icon"><AppIcon name="bookings" /></span>
      <h2>{{
        hasFilters
          ? 'No bookings match your filters'
          : activeTab === 'all'
            ? 'No bookings yet'
            : `No ${tabs.find((tab) => tab.id === activeTab)?.label.toLowerCase() || activeTab} bookings`
      }}</h2>
      <p>{{
        hasFilters
          ? 'Try a guest name, email, service, booking reference, or a wider date range.'
          : 'Confirmed guest bookings will appear here as soon as Bookins reserves the slot.'
      }}</p>
      <button
        v-if="hasFilters"
        class="secondary"
        type="button"
        @click="clearFilters"
        >Clear filters</button
      >
    </div>

    <GmDialog
      :open="Boolean(selected)"
      :title="selected?.service_name || 'Booking details'"
      :busy="cancelling"
      overlay-class="modal-backdrop"
      @update:open="open => { if (!open) close() }"
    >
      <aside
        v-if="selected"
        class="card modal booking-detail"
      >
        <div class="modal-header"
          ><div
            ><p class="eyebrow">Booking {{ selected.reference }}</p
            ><h2 id="booking-detail-title">{{ selected.service_name }}</h2></div
          ><button
            class="icon-button"
            type="button"
            aria-label="Close"
            @click="close"
            ><AppIcon name="close" /></button
        ></div>
        <div
          v-if="error"
          class="notice error"
          role="alert"
          ><AppIcon
            name="alert"
            :size="18" />{{ error }}</div
        >
        <div class="detail-when"
          ><span
            ><AppIcon
              name="calendar"
              :size="20" /></span
          ><div
            ><strong>{{ when(selected) }}</strong
            ><small>{{ duration(selected) }} minutes · {{ zoneLabel(selected) }}</small></div
          ><span
            class="chip"
            :class="selected.status"
            >{{ statusLabel(selected.status) }}</span
          ></div
        >
        <p
          v-if="selected.source === 'owner' || isSeries(selected)"
          class="badge-row"
          ><span
            v-if="selected.source === 'owner'"
            class="chip accent"
            >Added by you</span
          ><span
            v-if="isSeries(selected)"
            class="chip accent"
            >Repeats weekly</span
          ></p
        >
        <p
          v-if="conflictTitles(selected).length && isUpcoming(selected)"
          class="muted error-text"
          >Overlaps on your Google Calendar: {{ conflictTitles(selected).join(', ') }}.</p
        ><p
          v-if="onCalendar(selected)"
          class="muted"
          >On Google Calendar{{ isCancelled(selected) ? '. The event was marked cancelled when this booking was cancelled, if Calendar was available.' : '.' }}</p
        >
        <section
          class="detail-section"
          aria-labelledby="guest-heading"
        >
          <h3 id="guest-heading">Guest</h3>
          <dl class="detail-list">
            <dt>Name</dt><dd>{{ selected.guest_name }}</dd>
            <dt>Email</dt
            ><dd
              ><a
                v-if="hasRealEmail(selected.guest_email)"
                :href="`mailto:${selected.guest_email}`"
                >{{ selected.guest_email }}</a
              ><template v-else>No email</template></dd
            >
            <dt>Phone</dt><dd>{{ selected.guest_phone || 'Not supplied' }}</dd>
            <dt>Notes</dt><dd>{{ selected.notes || 'No notes supplied.' }}</dd>
          </dl>
        </section>
        <section
          class="panel-box"
          aria-labelledby="owner-notes-label"
        >
          <label
            id="owner-notes-label"
            for="owner-notes"
            ><h3>Private owner notes</h3><span class="private-tag">Private — guests never see this</span></label
          >
          <textarea
            id="owner-notes"
            v-model="notesDraft"
            class="input"
            maxlength="4000"
            :disabled="isDemo || notesSaving"
            placeholder="Add a note for yourself, such as preferences or follow-ups"
          ></textarea>
          <div class="form-actions">
            <button
              class="secondary small-button"
              type="button"
              :disabled="isDemo || notesSaving || !notesDirty"
              @click="saveNotes"
              >{{ notesSaving ? 'Saving…' : 'Save note' }}</button
            ><span
              v-if="notesMessage"
              class="muted"
              role="status"
              >{{ notesMessage }}</span
            ></div
          >
        </section>

        <p
          v-if="moveNote"
          class="notice success"
          role="status"
          ><AppIcon
            name="check"
            :size="18" />{{ moveNote }}</p
        >

        <section
          v-if="!rescheduling"
          class="panel-box"
          aria-labelledby="message-heading"
        >
          <h3 id="message-heading">Message client</h3>
          <p class="muted">Opens WhatsApp, SMS, or email on your own device with the text filled in. Bookins does not send anything.</p>
          <div
            class="segmented kind-row"
            role="group"
            aria-label="Message type"
            ><button
              v-for="kind in MESSAGE_KINDS"
              :key="kind.id"
              type="button"
              :class="{ 'is-active': messageKind === kind.id }"
              :aria-pressed="messageKind === kind.id"
              @click="openMessage(kind.id)"
              >{{ kind.label }}</button
            ></div
          >
          <div
            v-if="composed"
            class="message-preview"
            ><p
              class="message-text"
              tabindex="0"
              aria-label="Message text"
              >{{ composed.text }}</p
            ><div class="form-actions"
              ><a
                v-if="composed.whatsapp"
                class="secondary small-button link-button"
                :href="composed.whatsapp"
                target="_blank"
                rel="noopener noreferrer"
                >Open WhatsApp</a
              ><a
                v-if="composed.sms"
                class="secondary small-button link-button"
                :href="composed.sms"
                >Open SMS</a
              ><a
                v-if="emailUsable"
                class="secondary small-button link-button"
                :href="composed.email"
                >Open email</a
              ><button
                class="secondary small-button"
                type="button"
                @click="copyMessage"
                >Copy message</button
              ></div
            ><p
              v-if="!composed.whatsapp"
              class="muted hint"
              >{{ phoneProblem }}</p
            ><p
              v-if="!emailUsable"
              class="muted hint"
              >No email on this booking, so Open email is not available.</p
            ><p
              v-if="messageNotice"
              class="muted"
              role="status"
              >{{ messageNotice }}</p
            ></div
          >
        </section>

        <div v-if="leavePrompt" class="confirm-box">
          <strong>Leave these booking details?</strong>
          <p class="muted">Any note or form entry that is not saved will be discarded.</p>
          <div class="form-actions">
            <button class="secondary" type="button" @click="keepEditing">Keep editing</button>
            <button class="ghost" type="button" @click="discardDialog">Discard changes</button>
          </div>
        </div>

        <div
          v-if="canMove(selected) && hasStarted(selected) && !rescheduling"
          class="panel-box"
          ><h3>Did this appointment happen?</h3
          ><div class="form-actions"
            ><button
              v-if="selected.status !== 'completed'"
              class="secondary small-button"
              type="button"
              :disabled="isDemo || actionBusy"
              @click="changeStatus(selected, 'completed')"
              >Mark completed</button
            ><button
              v-if="selected.status !== 'no_show'"
              class="secondary small-button"
              type="button"
              :disabled="isDemo || actionBusy"
              @click="changeStatus(selected, 'no_show')"
              >Mark no-show</button
            ><button
              v-if="isDone(selected)"
              class="ghost small-button"
              type="button"
              :disabled="isDemo || actionBusy"
              @click="changeStatus(selected, 'confirmed')"
              >Undo (back to confirmed)</button
            ></div
          ></div
        >

        <form
          v-if="rescheduling && canMove(selected)"
          class="panel-box"
          @submit.prevent="submitReschedule"
        >
          <h3>Reschedule</h3>
          <p class="muted">Times are in {{ zoneName(moveZone) }}. The booking keeps its {{ duration(selected) }} minute length.</p>
          <p
            v-if="onCalendar(selected)"
            class="muted"
            >This booking is on your Google Calendar. Rescheduling here does not move that event; change it in Google Calendar yourself.</p
          >
          <div
            v-if="rescheduleError"
            class="notice error"
            role="alert"
            ><AppIcon
              name="alert"
              :size="18" />{{ rescheduleError }}</div
          >
          <div class="field-row">
            <div class="field"
              ><label for="move-date">New date</label
              ><input
                id="move-date"
                v-model="moveForm.date"
                type="date"
                required
            /></div>
            <div class="field"
              ><label for="move-time">New time</label
              ><input
                id="move-time"
                v-model="moveForm.time"
                type="time"
                required
            /></div>
          </div>
          <div class="form-actions modal-footer"
            ><button
              class="primary"
              :class="{ 'is-pending': rescheduleSaving }"
              type="submit"
              :disabled="isDemo || rescheduleSaving"
              >{{ rescheduleSaving ? 'Moving…' : 'Move booking' }}</button
            ><button
              class="secondary"
              type="button"
              :disabled="rescheduleSaving"
              @click="rescheduling = false"
              >Keep current time</button
            ></div
          >
        </form>

        <p
          v-if="selected.status !== 'cancelled' && !canCancel(selected)"
          class="muted"
          >This appointment has already happened, so it can no longer be cancelled.</p
        >
        <div
          v-if="confirmCancel && canCancel(selected)"
          class="confirm-box"
          ><strong>Cancel and reopen this slot?</strong
          ><p class="muted"
            >The appointment stays in history. Bookins does not send a cancellation message; after cancelling you can open one in your own WhatsApp, SMS, or email.<template v-if="onCalendar(selected)"> Its Google Calendar event will be renamed "Cancelled: …" (needs your approval); if that fails the booking is still cancelled and you will be told.</template></p
          ><div class="field"
            ><label for="cancellation-reason">Reason, optional</label
            ><textarea
              id="cancellation-reason"
              v-model.trim="cancellationReason"
              maxlength="500"
              placeholder="Add a private note for your records"
            ></textarea></div
          ><div class="form-actions"
            ><button
              class="danger solid"
              type="button"
              :disabled="cancelling || isDemo"
              :class="{ 'is-pending': cancelling }"
              @click="cancel"
              >{{ cancelling ? 'Cancelling…' : 'Cancel booking' }}</button
            ><button
              class="secondary"
              type="button"
              :disabled="cancelling || isDemo"
              @click="confirmCancel = false"
              >Keep booking</button
            ></div
          ></div
        >
        <div
          v-else
          class="form-actions modal-footer detail-actions"
          ><button
            v-if="calendarConnected && canCancel(selected) && selected.status === 'confirmed' && !onCalendar(selected)"
            class="secondary"
            type="button"
            :disabled="calendarBusy"
            @click="addToCalendar(selected)"
            >{{ calendarBusy ? 'Adding…' : 'Add to Google Calendar' }}</button
          ><button
            v-if="canMove(selected) && !rescheduling"
            class="secondary"
            type="button"
            :disabled="isDemo"
            @click="startReschedule"
            >Reschedule</button
          ><button
            v-if="canCancel(selected)"
            class="danger"
            type="button"
            :disabled="isDemo"
            @click="confirmCancel = true"
            >Cancel booking</button
          ><button
            class="secondary"
            type="button"
            @click="close"
            >Close</button
          ></div
        >
      </aside>
    </GmDialog>

    <GmDialog
      :open="newOpen"
      title="New booking"
      :busy="newSaving"
      overlay-class="modal-backdrop"
      @update:open="open => { if (!open) closeNew() }"
    >
      <form
        class="card modal booking-detail"
        @submit.prevent="submitNew"
      >
        <div class="modal-header"
          ><div
            ><p class="eyebrow">Walk-in or phone booking</p
            ><h2>New booking</h2></div
          ><button
            class="icon-button"
            type="button"
            aria-label="Close"
            @click="closeNew"
            ><AppIcon name="close" /></button
        ></div>

        <template v-if="newResult">
          <div
            class="notice success"
            role="status"
            ><AppIcon
              name="check"
              :size="18" />Saved {{ newResult.created.length }} booking{{ newResult.created.length === 1 ? '' : 's' }}. Nothing was sent to the client.</div
          >
          <div
            v-if="newResult.skipped.length"
            class="panel-box"
            role="status"
            ><strong>{{ newResult.skipped.length }} repeat{{ newResult.skipped.length === 1 ? '' : 's' }} skipped</strong
            ><ul class="skipped"
              ><li
                v-for="item in newResult.skipped"
                :key="item.startsAt"
                >{{ skippedLabel(item) }}: {{ item.reason }}</li
              ></ul
            ></div
          >
          <div class="form-actions modal-footer"
            ><button
              v-if="newResult.created.length"
              class="primary"
              type="button"
              @click="messageNewClient"
              >Message client</button
            ><button
              class="secondary"
              type="button"
              @click="closeNew"
              >Done</button
            ></div
          >
        </template>

        <template v-else>
          <p
            v-if="!bookableServices.length"
            class="muted"
            >Add a service first. <RouterLink to="/services">Go to Services</RouterLink></p
          >
          <div
            v-if="newError"
            class="notice error"
            role="alert"
            ><AppIcon
              name="alert"
              :size="18" />{{ newError }}</div
          >
          <div class="field"
            ><label for="new-service">Service</label
            ><select
              id="new-service"
              v-model="form.serviceId"
              required
              ><option
                v-for="item in bookableServices"
                :key="item.id"
                :value="item.id"
                >{{ item.name }} · {{ item.duration_minutes }} min</option
              ></select
            ></div
          >
          <p class="muted zone-line">Date and time are in {{ zoneName(formZone) }}, your schedule's timezone. You can book outside your weekly hours, but not on top of another booking or time off.</p>
          <div class="field-row">
            <div class="field"
              ><label for="new-date">Date</label
              ><input
                id="new-date"
                v-model="form.date"
                type="date"
                required
            /></div>
            <div class="field"
              ><label for="new-time">Time</label
              ><input
                id="new-time"
                v-model="form.time"
                type="time"
                required
            /></div>
          </div>
          <div class="field"
            ><label for="new-name">Client name</label
            ><input
              id="new-name"
              v-model="form.name"
              maxlength="160"
              autocomplete="off"
              required
          /></div>
          <div class="field-row">
            <div class="field"
              ><label for="new-email">Email</label
              ><input
                id="new-email"
                v-model="form.email"
                type="email"
                autocomplete="off"
                aria-describedby="new-contact-hint"
            /></div>
            <div class="field"
              ><label for="new-phone">Phone</label
              ><input
                id="new-phone"
                v-model="form.phone"
                type="tel"
                autocomplete="off"
                aria-describedby="new-contact-hint"
            /></div>
          </div>
          <p
            id="new-contact-hint"
            class="muted zone-line"
            >Enter an email, a phone number, or both. A phone number lets you message the client on WhatsApp or SMS.</p
          >
          <div class="field"
            ><label for="new-notes">Notes the client can see</label
            ><textarea
              id="new-notes"
              v-model="form.notes"
              maxlength="2000"
          ></textarea></div>
          <div class="field"
            ><label for="new-owner-notes">Private owner notes <span class="private-tag">Private — guests never see this</span></label
            ><textarea
              id="new-owner-notes"
              v-model="form.ownerNotes"
              maxlength="4000"
          ></textarea></div>
          <div class="field"
            ><label for="new-repeat">Repeat weekly (extra weeks, 0 to 12)</label
            ><input
              id="new-repeat"
              v-model.number="form.repeatWeeks"
              type="number"
              min="0"
              max="12"
              step="1"
            /><span
              v-if="form.repeatWeeks > 0"
              class="field-hint"
              >Creates this booking plus {{ Math.min(12, Math.floor(form.repeatWeeks)) }} more at the same local time. Weeks that clash are skipped and listed afterwards.</span
            ></div
          >
          <div class="form-actions modal-footer"
            ><button
              class="primary"
              :class="{ 'is-pending': newSaving }"
              type="submit"
              :disabled="newSaving || isDemo || !bookableServices.length"
              >{{ newSaving ? 'Saving…' : 'Save booking' }}</button
            ><button
              class="secondary"
              type="button"
              :disabled="newSaving"
              @click="closeNew"
              >Cancel</button
            ></div
          >
        </template>
      </form>
    </GmDialog>
  </section>
</template>

<style scoped>
.filter-bar { align-items: flex-end; }
.filter-bar .field { min-width: 150px; flex: 0 1 190px; }
.filter-bar .filter-view { margin-left: auto; }
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
.week-empty { margin: auto; color: var(--line-strong); }

/* Dialogs */
.booking-detail { width: min(620px, 100%); }
.detail-when { padding: var(--space-3); display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: var(--space-3); border-radius: var(--radius-sm); background: var(--accent-faint); }
.detail-when > span:first-child { width: 40px; height: 40px; display: grid; place-items: center; color: var(--accent); border-radius: var(--radius-sm); background: var(--accent-soft); }
.detail-when div { display: grid; gap: 2px; }
.detail-when strong { font-size: var(--text-md); }
.detail-when small { color: var(--muted); font-size: var(--text-sm); }
.badge-row { margin: var(--space-3) 0 0; display: flex; gap: 6px; flex-wrap: wrap; }
.booking-detail > p.muted { margin: var(--space-3) 0 0; font-size: var(--text-sm); }
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
  .filter-bar .filter-view { margin-left: 0; }
}
@media (max-width: 700px) {
  .filter-bar .field { flex: 1 1 140px; }
  .booking-card { grid-template-columns: 54px minmax(0, 1fr); gap: var(--space-3); padding: var(--space-3); }
  .booking-end { grid-column: 1/-1; grid-template-columns: 1fr auto; align-items: center; justify-items: start; }
  .booking-end button { justify-self: end; }
  .date-tile { width: 54px; height: 62px; }
  .detail-when { grid-template-columns: 40px minmax(0, 1fr); }
  .detail-when .chip { grid-column: 1/-1; justify-self: start; }
  .modal-footer > button, .modal-footer > a { flex: 1 1 auto; }
}
</style>
