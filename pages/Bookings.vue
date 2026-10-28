<script setup lang="ts">
import { formatDay } from '../format-date.ts'
import { csvCell } from '../csv.ts'
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, RouterLink, useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmConfirm from '../components/ui/GmConfirm.vue'
import GmDatePicker from '../components/ui/GmDatePicker.vue'
import GmHint from '../components/ui/GmHint.vue'
import GmSelect from '../components/ui/GmSelect.vue'
import GmTimePicker from '../components/ui/GmTimePicker.vue'
import { useSetupState } from '../setup.ts'
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
  rescheduleBookingWithCalendar,
  syncBookingCalendar,
  saveBookingNotes,
  servicesForStaff,
  setBookingStatus,
  staffForBooking,
  teamMembers,
} from '../booking.ts'
import { displayName, memberColor, memberFirstName, memberName, scheduleOf } from '../team-ui.ts'
import { composeMessage, gmailComposeUrl } from '../messaging.ts'
import { listOpenings, localFields, scheduleFromRecord, wallClockInstant } from '../scheduling.ts'
import { displayTimeZone, ownerTimeZone, zoneDisplayLabel } from '../time-display.ts'
import { isDemo, registerDemoGuard } from '../runtime.ts'
import { errorMessage } from '../error-message.ts'
import { hourMarks, minutesOf, placeSpans, spanSize } from '../rail.ts'

const state = inject<WorkspaceState>('bookingState', { profile: null, schedules: [], services: [], bookings: [], contacts: [], staff: [], campaigns: [] })
const toast = inject<ToastApi | null>('toast', null)
const setup = useSetupState()
const ok = (message: string, options?: ToastOptions) => toast?.(message, options)
// Error toasts persist until dismissed, so the previous one is dismissed when the user tries again.
let errorToastId: number | void | null = null
const clearBad = () => {
  if (errorToastId != null) toast?.dismiss?.(errorToastId)
  errorToastId = null
}
const bad = (message: string) => {
  clearBad()
  errorToastId = toast?.error ? toast.error(message) : toast?.(message, { kind: 'error' })
}
const info = (message: string) => (toast?.info ? toast.info(message) : toast?.(message))
// Time off is stored as a booking but is never a client appointment.
const isHidden = (booking: BookingRecord) => isTimeOff(booking)
const realBookings = computed(() => (state.bookings || []).filter((item) => !isHidden(item)))
const timeOffBlocks = computed(() => (state.bookings || []).filter(isActiveTimeOff))
// ---- team (everything below is inert, and no staff UI shows, until the first member is added) ----
const team = computed(() => hasTeam(state))
const members = computed(() => teamMembers(state, { includeInactive: true }))
const activeMembers = computed(() => members.value.filter(isStaffActive))
const memberFor = (booking: BookingRecord) => staffForBooking(state, booking)
const staffName = (booking: BookingRecord) => memberName(memberFor(booking))
const staffColor = (booking: BookingRecord) => memberColor(memberFor(booking))
const staffLabel = (member: StaffRecord) => `${memberName(member)}${isStaffActive(member) ? '' : ' (inactive)'}`
const refresh = inject<RefreshWorkspace>('refreshBookings', async () => true)
const router = useRouter()
const route = useRoute()
type BookingTab = 'upcoming' | 'past' | 'completed' | 'no_show' | 'cancelled' | 'all'
const activeTab = ref<BookingTab>('upcoming')
const view = ref<'week' | 'agenda'>('week')
const query = ref('')
const emailFilter = ref('')
const serviceFilter = ref('')
const staffFilter = ref('')
const fromDate = ref('')
const toDate = ref('')
const weekOffset = ref(0)
const showCancelled = ref(false)
// The open booking is looked up by id, so the dialog always reflects the latest state after any action or refresh.
const selectedId = ref('')
const selected = computed(() => realBookings.value.find((item) => item.id === selectedId.value) || null)
// At 1200px and below the detail is a modal panel (a bottom sheet on phones) above a scrim that covers the page and the
// bottom navigation; above 1200px it is a side panel next to the calendar.
const detailMedia = window.matchMedia('(max-width: 1200px)')
const compactDetail = ref(detailMedia.matches)
const updateDetailMedia = (event: MediaQueryListEvent) => { compactDetail.value = event.matches }
// Phones show one day of the week grid at a time, with a day strip to switch days.
const phoneMedia = window.matchMedia('(max-width: 700px)')
const phoneGrid = ref(phoneMedia.matches)
const updatePhoneMedia = (event: MediaQueryListEvent) => { phoneGrid.value = event.matches }
let detailOpener: HTMLElement | null = null
watch(selectedId, async (value, previous) => {
  if (value && !previous && document.activeElement instanceof HTMLElement) detailOpener = document.activeElement
  await nextTick()
  if (value) document.getElementById('booking-detail-title')?.focus({ preventScroll: true })
  else if (detailOpener?.isConnected) detailOpener.focus({ preventScroll: true })
})
function detailKeydown(event: KeyboardEvent) {
  if (!compactDetail.value || event.key !== 'Tab' || event.defaultPrevented) return
  if (!(event.currentTarget instanceof HTMLElement)) return
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]')].filter(el => !('disabled' in el) || !el.disabled).filter(el => el.getClientRects().length)
  const first = controls[0], last = controls.at(-1)
  if (event.shiftKey && (document.activeElement === first || (document.activeElement instanceof HTMLElement && document.activeElement.id === 'booking-detail-title'))) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(() => {
  detailMedia.addEventListener('change', updateDetailMedia)
  phoneMedia.addEventListener('change', updatePhoneMedia)
})
onBeforeUnmount(() => {
  detailMedia.removeEventListener('change', updateDetailMedia)
  phoneMedia.removeEventListener('change', updatePhoneMedia)
})
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
  newOpen.value ? 'Close the new booking form before switching modes.' : selected.value ? 'Close the booking details before switching modes.' : '',
)
onBeforeUnmount(() => {
  removeModeGuard()
  window.clearInterval(clock)
  window.removeEventListener('keydown', onPageKeydown)
})

function onPageKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || discardOpen.value || newDiscardOpen.value) return
  if (cancelOpen.value) { cancelOpen.value = false; return }
  if (newOpen.value) requestCloseNew()
  else if (selected.value) requestClose()
}
onMounted(() => window.addEventListener('keydown', onPageKeydown))

// ---- Google Calendar (optional) ----
// calendar.state: loading | connected | not-connected | preview | demo | unavailable | error
const calendar = ref({ state: 'loading', message: '' })
const calendarBusy = ref(false)
const calendarNotice = ref('')
const calendarError = ref('')
interface CalendarOutcome { id?: string; ok: boolean; skipped?: boolean; message?: string }
const bulkOutcomes = ref<CalendarOutcome[]>([])
const conflicts = ref<Map<string, string[]>>(new Map())
const conflictNote = ref('')
const calendarConnected = computed(() => calendar.value.state === 'connected')
const calendarChip = computed(() => {
  const value = calendar.value.state
  if (value === 'connected') return 'Calendar connected'
  if (value === 'loading') return 'Checking Calendar'
  if (value === 'not-connected') return 'Calendar not connected'
  if (value === 'error') return 'Calendar not checked'
  return 'Calendar unavailable here'
})
const calendarHint = computed(() => {
  const { state, message } = calendar.value
  if (state === 'preview') return 'Not available in local preview. Open Bookins from Goalmatic to connect Google Calendar.'
  if (state === 'demo') return 'Not available in the demo. Exit Demo and open Bookins from Goalmatic to connect Google Calendar.'
  if (state === 'unavailable') return message
  if (state === 'not-connected') return 'Connect Google Calendar to see clashes and add bookings to your calendar when you choose.'
  if (state === 'error') return message || 'Google Calendar could not be checked right now.'
  if (state === 'connected') return 'Add bookings to Google Calendar when you choose. Linked events follow moves and cancellations. Clients are never invited.'
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
    calendar.value = { state: 'error', message: errorMessage(reason) }
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
    calendarError.value = errorMessage(reason, 'Google Calendar could not be connected.')
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
    conflictNote.value = `Calendar clashes could not be checked: ${errorMessage(reason, 'try again later.')}`
  }
}
watch([calendarConnected, realBookings], loadConflicts)
onMounted(loadCalendarStatus)
watch(isDemo, loadCalendarStatus)

const onCalendar = (booking: BookingRecord) => Boolean(booking.calendar_event_id)
const calendarNeedsSync = (booking: BookingRecord) => onCalendar(booking) && ['pending', 'failed'].includes(String(booking.calendar_sync_status))
const conflictTitles = (booking: BookingRecord) => conflicts.value.get(String(booking.id || '')) || []
const needsCalendar = computed(() => realBookings.value.filter((item) => isUpcoming(item) && item.status === 'confirmed' && !onCalendar(item)))

function flash(message: string) {
  calendarNotice.value = message
  window.setTimeout(() => {
    if (calendarNotice.value === message) calendarNotice.value = ''
  }, 4000)
}

async function addToCalendar(booking: BookingRecord) {
  clearBad()
  calendarBusy.value = true
  calendarError.value = ''
  error.value = ''
  try {
    const result = await addBookingToCalendar(booking)
    await refresh()
    const text = result.alreadyOnCalendar ? 'Already on your calendar.' : 'Added to Google Calendar.'
    // One visible message: inline inside the open panel, otherwise a toast.
    if (selected.value) detailNotice.value = text
    else ok(text)
  } catch (reason) {
    const text = errorMessage(reason, 'The booking could not be added to Google Calendar.')
    if (selected.value) error.value = text
    else calendarError.value = text
  } finally {
    calendarBusy.value = false
  }
}

async function retryCalendarSync() {
  if (!selected.value || calendarBusy.value || isDemo.value) return
  clearBad()
  calendarBusy.value = true
  error.value = ''
  detailNotice.value = ''
  try {
    const result = await syncBookingCalendar(selected.value)
    await refresh()
    if (result.state === 'updated') detailNotice.value = 'Google Calendar is up to date.'
    else error.value = result.message || 'Google Calendar still needs updating.'
  } catch (reason) {
    error.value = describeError(reason, 'The Calendar update could not be retried.')
  } finally { calendarBusy.value = false }
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
    calendarError.value = errorMessage(reason, 'The bookings could not be added to Google Calendar.')
  } finally {
    calendarBusy.value = false
  }
}
const bulkLabel = (outcome: CalendarOutcome) => {
  const booking = realBookings.value.find((item) => item.id === outcome.id)
  return booking ? `${booking.service_name} with ${booking.guest_name}` : outcome.id
}
const calendarOpen = ref(false)

// One zone for the calendar: the owner's own schedule, never a team member's (B7), else the profile's, else this device's until one is saved.
const scheduleZone = computed(() => ownerTimeZone(scheduleOf(state, ownerStaff(state))?.timezone || state.schedules?.[0]?.timezone || state.profile?.timezone))
const zone = (booking: BookingRecord) => displayTimeZone(booking.timezone || scheduleZone.value)
const displayTimeOptions = (options: Intl.DateTimeFormatOptions, booking: BookingRecord): Intl.DateTimeFormatOptions => ({ ...options, timeZone: zone(booking) })

// One zone label everywhere, e.g. "Africa/Lagos (GMT+1)", taken at the booking's own date.
const zoneLabel = (booking: BookingRecord) => {
  const at = new Date(String(booking.starts_at || ''))
  return zoneDisplayLabel(zone(booking), 'en', Number.isFinite(at.getTime()) ? at : new Date())
}

// Calendar day (yyyy-mm-dd) of a booking in the booking's own timezone.
function dayKey(booking: BookingRecord, at: TimestampInput = booking.starts_at) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone(booking), year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(String(at || '')))
  } catch {
    return String(at).slice(0, 10)
  }
}
const todayKey = computed(() =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: scheduleZone.value, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now.value)),
)
const startMs = (booking: BookingRecord) => Date.parse(String(booking.starts_at || ''))
const endMs = (booking: BookingRecord) => Date.parse(String(booking.ends_at || '')) || startMs(booking)
const isCancelled = (booking: BookingRecord) => booking.status === 'cancelled'
// In-progress bookings are still "upcoming" so they remain cancellable and visible.
const isUpcoming = (booking: BookingRecord) => !isCancelled(booking) && endMs(booking) > now.value
const isPast = (booking: BookingRecord) => !isCancelled(booking) && endMs(booking) <= now.value
const canCancel = (booking: BookingRecord) => isUpcoming(booking)

watch(
  () => [route.query.q, route.query.email, route.query.staff, route.query.tab, route.query.from, route.query.to],
  ([q, email, staff, tab, from, to]) => {
    const text = (value: unknown) => (Array.isArray(value) ? value[0] : value) || ''
    if (route.path !== '/bookings') return
    query.value = String(text(q))
    emailFilter.value = String(text(email)).trim().toLowerCase()
    staffFilter.value = String(text(staff))
    const requestedTab = String(text(tab))
    if (['upcoming', 'past', 'completed', 'no_show', 'cancelled', 'all'].includes(requestedTab)) {
      activeTab.value = requestedTab as BookingTab
      view.value = 'agenda'
    } else if (q || email || staff) {
      activeTab.value = 'all'
      view.value = 'agenda'
    }
    fromDate.value = /^\d{4}-\d{2}-\d{2}$/.test(String(text(from))) ? String(text(from)) : ''
    toDate.value = /^\d{4}-\d{2}-\d{2}$/.test(String(text(to))) ? String(text(to)) : ''
  },
  { immediate: true },
)
function clearEmail() {
  emailFilter.value = ''
  router.replace({ path: '/bookings', query: { ...route.query, email: undefined } })
}
// B5: a phone-only client carries an internal placeholder address; name the client instead of showing it.
const emailFilterLabel = computed(() => {
  const email = emailFilter.value
  if (!email) return ''
  const match = realBookings.value.find((item) => String(item.guest_email || '').trim().toLowerCase() === email)
  const name = match?.guest_name || ''
  if (hasRealEmail(email)) return name ? `${name} (${email})` : email
  return name ? `${name}${match?.guest_phone ? ` (${match.guest_phone})` : ''}` : 'this client'
})

onBeforeRouteLeave((to) => {
  if (allowLeave.value) {
    allowLeave.value = false
    return true
  }
  if (newOpen.value) {
    if (!newDirty.value) {
      newDiscardOpen.value = false
      newOpen.value = false
      return true
    }
    pendingRoute.value = to.fullPath
    newDiscardOpen.value = true
    return false
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
  const seen = new Map<string, string>()
  for (const booking of realBookings.value) {
    const key = booking.service_id || booking.service_name
    if (key && !seen.has(key)) seen.set(key, displayName(booking.service_name) || 'Service')
  }
  return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
})
const serviceFilterOptions = computed(() => [{ value: '', label: 'All services' }, ...serviceOptions.value])
const staffFilterOptions = computed(() => [
  { value: '', label: 'Everyone' },
  ...members.value.map((member) => ({ value: member.id || '', label: staffLabel(member) })),
])

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

const tabs = computed<Array<{ id: BookingTab; label: string; count: number }>>(() => [
  { id: 'upcoming', label: 'Upcoming', count: baseFiltered.value.filter(isUpcoming).length },
  { id: 'past', label: 'Past', count: baseFiltered.value.filter(isPast).length },
  { id: 'completed', label: 'Came', count: baseFiltered.value.filter((item) => item.status === 'completed').length },
  { id: 'no_show', label: 'No-show', count: baseFiltered.value.filter((item) => item.status === 'no_show').length },
  { id: 'cancelled', label: 'Cancelled', count: baseFiltered.value.filter(isCancelled).length },
  { id: 'all', label: 'All', count: baseFiltered.value.length },
])

const inTab = (item: BookingRecord, tab: BookingTab) => {
  if (tab === 'upcoming') return isUpcoming(item)
  if (tab === 'past') return isPast(item)
  if (tab === 'cancelled') return isCancelled(item)
  if (tab === 'completed' || tab === 'no_show') return item.status === tab
  return true
}

// Upcoming soonest-first; past, cancelled and "all" newest-first.
const sortBookings = (list: BookingRecord[], tab: BookingTab) =>
  [...list].sort((left, right) => (tab === 'upcoming' ? startMs(left) - startMs(right) : startMs(right) - startMs(left)))

const filtered = computed(() => sortBookings(baseFiltered.value.filter((item) => inTab(item, activeTab.value)), activeTab.value))

const groups = computed(() => {
  const map = new Map<string, BookingRecord[]>()
  for (const booking of filtered.value) {
    const key = dayKey(booking)
    if (!map.has(key)) map.set(key, [])
    map.get(key)?.push(booking)
  }
  return [...map].map(([key, items]) => ({ key, items, label: dayLabel(key), today: key === todayKey.value }))
})

function dayLabel(key: string) {
  return formatDay(key, 'UTC')
}

const addDays = (key: string, days: number) => {
  const [y = 1970, m = 1, d = 1] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
const weekStart = computed(() => {
  const [y = 1970, m = 1, d = 1] = todayKey.value.split('-').map(Number)
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 // Monday first
  return addDays(todayKey.value, -dow + weekOffset.value * 7)
})
// The week grid shows every appointment in the week (status tabs belong to the agenda list only).
const weekPool = computed(() => baseFiltered.value.filter((item) => showCancelled.value || !isCancelled(item)))
const showOff = computed(() => !emailFilter.value && !query.value.trim())
const weekDays = computed(() => Array.from({ length: 7 }, (_, index) => {
  const key = addDays(weekStart.value, index)
  const [y = 1970, m = 1, d = 1] = key.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return {
    key,
    index,
    today: key === todayKey.value,
    past: key < todayKey.value,
    weekday: date.toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short' }),
    day: date.getUTCDate(),
    full: date.toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }),
    items: weekPool.value.filter((item) => dayKey(item) === key).sort((a, b) => startMs(a) - startMs(b)),
    off: showOff.value ? timeOffBlocks.value.filter((item) => (!team.value || !staffFilter.value || memberFor(item).id === staffFilter.value) && dayKey(item) <= key && key <= dayKey(item, endMs(item) - 1)) : [],
  }
}))
// Phones: one day at a time.
const focusDay = ref(0)
function resetFocusDay() {
  const today = weekDays.value.findIndex((day) => day.today)
  focusDay.value = today >= 0 ? today : 0
}
watch(weekOffset, resetFocusDay)
onMounted(resetFocusDay)
function focusWeekOn(booking: BookingRecord) {
  const key = dayKey(booking)
  const [y = 1970, m = 1, d = 1] = key.split('-').map(Number)
  const [ty = 1970, tm = 1, td = 1] = weekStart.value.split('-').map(Number)
  const diff = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000)
  weekOffset.value += Math.floor(diff / 7)
  nextTick(() => { focusDay.value = ((diff % 7) + 7) % 7 })
}
const shownDays = computed(() => (phoneGrid.value ? weekDays.value.filter((day) => day.index === focusDay.value) : weekDays.value))
// Today and other pages link straight to one booking with ?open=<id>.
watch(
  () => [route.query.open, realBookings.value.length] as const,
  ([open]) => {
    const id = String((Array.isArray(open) ? open[0] : open) || '')
    if (!id || route.path !== '/bookings') return
    const booking = realBookings.value.find((item) => item.id === id)
    if (!booking) return
    selectedId.value = booking.id || ''
    focusWeekOn(booking)
    router.replace({ path: '/bookings', query: { ...route.query, open: undefined } })
  },
  { immediate: true },
)
const weekRange = computed(() => {
  const fmt = (key: string) => {
    const [y = 1970, m = 1, d = 1] = key.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' })
  }
  return `${fmt(weekStart.value)} to ${fmt(addDays(weekStart.value, 6))}`
})

const calendarItems = computed(() => weekDays.value.flatMap((day) => day.items))
const shownItems = computed(() => shownDays.value.flatMap((day) => day.items))
const minuteOf = (booking: BookingRecord, at: TimestampInput) => minutesOf(localFields(at, zone(booking)).time)
const calendarStartHour = computed(() => {
  if (!shownItems.value.length) return 8
  return Math.max(0, Math.min(8, ...shownItems.value.map((booking) => Math.floor(minuteOf(booking, booking.starts_at) / 60) || 0)))
})
const calendarEndHour = computed(() => {
  if (!shownItems.value.length) return 18
  return Math.min(24, Math.max(18, ...shownItems.value.map((booking) => Math.ceil(minuteOf(booking, booking.ends_at || booking.starts_at) / 60) || 0)))
})
const HOUR = 64
const calendarHours = computed(() => hourMarks(calendarStartHour.value, calendarEndHour.value - 1))
const calendarHeight = computed(() => Math.max(320, (calendarEndHour.value - calendarStartHour.value) * HOUR))
const yOf = (minute: number) => ((minute - calendarStartHour.value * 60) / 60) * HOUR
// B1: overlapping bookings sit side by side, each in its own column.
function placedFor(day: { items: BookingRecord[] }) {
  return placeSpans(day.items.map((booking) => {
    const start = minuteOf(booking, booking.starts_at)
    const end = Math.max(start + 15, minuteOf(booking, booking.ends_at || booking.starts_at) || start + 30)
    return { start, end, item: booking }
  }), 30)
}
function slotStyle(entry: { start: number; end: number; column: number; columns: number; item: BookingRecord }) {
  return {
    top: `${Math.max(0, yOf(entry.start))}px`,
    height: `${Math.max(30, yOf(entry.end) - yOf(entry.start) - 2)}px`,
    left: `calc(${(entry.column / entry.columns) * 100}% + 3px)`,
    width: `calc(${100 / entry.columns}% - 6px)`,
    // B4: colour means the person (only once there is a team); status is shape and word.
    '--slot-stem': team.value ? staffColor(entry.item) : undefined,
    '--slot-fill': team.value ? `color-mix(in srgb, ${staffColor(entry.item)} 10%, var(--surface))` : undefined,
  }
}
const nowLine = computed(() => {
  const minute = minutesOf(localFields(now.value, scheduleZone.value).time)
  return minute >= calendarStartHour.value * 60 && minute <= calendarEndHour.value * 60 ? yOf(minute) : null
})
function hourLabel(hour: number) {
  return new Date(Date.UTC(2000, 0, 1, hour)).toLocaleTimeString(undefined, { hour: 'numeric', timeZone: 'UTC' })
}

const hasFilters = computed(() =>
  Boolean(query.value.trim() || emailFilter.value || serviceFilter.value || (team.value && staffFilter.value) || fromDate.value || toDate.value),
)
const filtersOpen = ref(false)
const activeFilterCount = computed(() => [query.value.trim(), serviceFilter.value, team.value && staffFilter.value, fromDate.value, toDate.value].filter(Boolean).length)
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

function when(booking: BookingRecord) {
  return `${formatDay(booking.starts_at, zone(booking))}, ${time(booking)}`
}
function time(booking: BookingRecord) {
  return new Date(String(booking.starts_at || '')).toLocaleTimeString(undefined, displayTimeOptions({ hour: 'numeric', minute: '2-digit' }, booking))
}
function endTime(booking: BookingRecord) {
  return new Date(String(booking.ends_at || booking.starts_at || '')).toLocaleTimeString(undefined, displayTimeOptions({ hour: 'numeric', minute: '2-digit' }, booking))
}
function duration(booking: BookingRecord) {
  return Math.max(0, Math.round((endMs(booking) - startMs(booking)) / 60_000))
}

// ---- CSV export ----
// Quote when needed, and neutralize spreadsheet formulas (= + - @, tab, CR) with a leading apostrophe.
function downloadCsv(filename: string, rows: unknown[][]) {
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
  const fmt = (booking: BookingRecord, at: TimestampInput) => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: zone(booking), hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(String(at || '')))
    } catch {
      return ''
    }
  }
  // The Staff column only exists once there is a team, so single-owner exports are unchanged.
  const withStaff = team.value
  const staffText = (booking: BookingRecord) => {
    const member = memberFor(booking)
    return member.implicit ? String(state.profile?.display_name || '').trim() || 'Owner' : member.name || booking.staff_name || ''
  }
  const rows: unknown[][] = [[
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
    bad(errorMessage(reason, 'The CSV file could not be created.'))
  }
}

// ---- shared helpers ----
const actionBusy = ref(false)
const scheduleFor = (booking?: BookingRecord | ServiceRecord | null) => (state.schedules || []).find((item) => item.id === booking?.schedule_id) || state.schedules?.[0]
const serviceFor = (booking: BookingRecord) => (state.services || []).find((item) => item.id === booking.service_id)
const hasStarted = (booking: BookingRecord) => startMs(booking) <= now.value
const isDone = (booking: BookingRecord) => booking.status === 'completed' || booking.status === 'no_show'
const STATUS_WORDS: Record<string, string> = { confirmed: 'Confirmed', completed: 'Came', no_show: 'No-show', cancelled: 'Cancelled' }
const statusLabel = (status: unknown) => STATUS_WORDS[String(status || '')] || String(status || '')
const isSeries = (booking: BookingRecord) => Boolean(booking.series_id)
const canMove = (booking: BookingRecord) => ['confirmed', 'completed', 'no_show'].includes(String(booking.status))
const needsOutcome = (booking: BookingRecord) => booking.status === 'confirmed' && hasStarted(booking)
const demoHint = computed(() => (isDemo.value ? 'The demo is read-only. Exit Demo to make changes.' : ''))
const slotClasses = (booking: BookingRecord) => ({
  'is-cancelled': isCancelled(booking),
  'is-done': booking.status === 'completed',
  'is-noshow': booking.status === 'no_show',
  'is-selected': selected.value?.id === booking.id,
})

function reselect(id: string | undefined) {
  selectedId.value = id || ''
  notesDraft.value = selected.value?.owner_notes || ''
}
function openDetail(booking: BookingRecord) {
  detailNotice.value = ''
  error.value = ''
  cancelOpen.value = false
  selectedId.value = booking.id || ''
}
const STATUS_HELP = 'Confirmed: booked and still to come. Came: the appointment happened. No-show: the client did not turn up. Cancelled: you cancelled it and the slot reopened. You can undo Came and No-show.'
const TAB_HELP: Record<BookingTab, string> = {
  upcoming: 'Appointments that have not finished yet, soonest first.',
  past: 'Finished appointments. Confirmed ones here still need you to mark whether the client came.',
  completed: 'Appointments you marked as having happened.',
  no_show: 'Appointments where the client did not turn up.',
  cancelled: 'Cancelled appointments stay here as history.',
  all: 'Every client booking, newest first. Time off is not listed.',
}

function describeError(reason: unknown, fallback: string) {
  const record = reason && typeof reason === 'object' ? reason as UnknownRecord : {}
  const code = record.code
  if (code === 'DEMO_READ_ONLY') return 'The demo is read-only. Exit Demo to make changes.'
  if (code === 'BOOKING_SLOT_TAKEN') return `${errorMessage(reason, 'That time is already taken.')} Choose another time.`
  if (code === 'BOOKING_CONTACT_INVALID') return errorMessage(reason, 'Check the client name, email, and phone number.')
  if (code === 'BOOKING_TIME_INVALID') return errorMessage(reason, 'Choose a valid date and time.')
  if (code === 'BOOKING_SERVICE_NOT_FOUND') return 'Choose a service for this booking.'
  if (code === 'BOOKING_SCHEDULE_UNAVAILABLE') return 'This service has no schedule yet. Set your availability first.'
  if (code === 'BOOKING_NOT_ACTIVE') return 'This booking is cancelled, so it cannot be changed.'
  return errorMessage(reason, fallback)
}

const zoneName = (timezone: string) => zoneDisplayLabel(displayTimeZone(timezone), 'en')
const instantFor = (date: string, clock: string, timezone: string): { at?: string; error?: string } => {
  const [hours = Number.NaN, minutes = Number.NaN] = String(clock || '').split(':').map(Number)
  if (!date || !Number.isInteger(hours) || !Number.isInteger(minutes)) return { error: 'Choose a date and time.' }
  const at = wallClockInstant(date, hours * 60 + minutes, timezone)
  return at ? { at: at.toISOString() } : { error: 'That local time does not exist because of a clock change. Choose another time.' }
}

// ---- status ----
async function changeStatus(booking: BookingRecord, status: string) {
  if (isDemo.value || actionBusy.value) return
  clearBad()
  const fresh = realBookings.value.find((item) => item.id === booking.id) || booking
  actionBusy.value = true
  error.value = ''
  try {
    await setBookingStatus(fresh, status)
    await refresh()
    const doneText = status === 'confirmed' ? 'Set back to confirmed.' : status === 'completed' ? 'Marked as came.' : 'Marked as no-show.'
    ok(doneText, status === 'confirmed' ? undefined : { action: { label: 'Undo', onClick: () => changeStatus(booking, 'confirmed') }, duration: 6000 })
  } catch (reason) {
    error.value = describeError(reason, 'The status could not be changed.')
    if (!selected.value) bad(error.value)
  } finally {
    actionBusy.value = false
  }
}

// ---- private owner notes ----
const notesDraft = ref('')
const notesSaving = ref(false)
const notesDirty = computed(() => selected.value ? notesDraft.value !== (selected.value.owner_notes || '') : false)
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
const suggestedKind = (booking: BookingRecord) => (isCancelled(booking) ? 'cancellation' : isPast(booking) ? 'followup' : 'confirmation')
const SUGGESTED_WHY: Record<string, string> = { confirmation: 'it is coming up', followup: 'it is in the past', cancellation: 'it is cancelled' }
const isSuggestedKind = (kind: string) => {
  const booking = selected.value
  return booking !== null && kind === suggestedKind(booking)
}
const messageNotice = ref('')
function bookingLinkFor(booking: BookingRecord) {
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
  selected.value?.guest_phone ? 'This phone number could not be read as an international number. Copy the message instead.' : 'No phone number on this booking, so WhatsApp and SMS are not available.',
)
const emailUsable = computed(() => Boolean(composed.value?.email) && hasRealEmail(selected.value?.guest_email))
const gmailUrl = computed(() => gmailComposeUrl(composed.value?.email))
function openMessage(kind: string) {
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
    messageNotice.value = 'The message could not be copied. Select the text and copy it yourself.'
  }
}
const openedApp = (app: string) => info(`Opening ${app} with the message ready. Press send there.`)

// ---- new booking (walk-in / phone / recurring) ----
const newOpen = ref(false)
const newSaving = ref(false)
const newError = ref('')
interface NewBookingResult { created: BookingRecord[]; skipped: Array<{ startsAt: string; reason: string }> }
const newResult = ref<NewBookingResult | null>(null)
const newDiscardOpen = ref(false)
const blankForm = () => ({ serviceId: '', staffId: '', date: '', time: '', name: '', email: '', phone: '', notes: '', ownerNotes: '', repeatWeeks: 0 })
const form = ref(blankForm())
// With a team, per-person service copies are folded into their base service: pick the service, then "With".
const bookableServices = computed(() => (state.services || []).filter((item) => item.active !== false && !(team.value && isStaffCopy(item))))
const formService = computed(() => (state.services || []).find((item) => item.id === form.value.serviceId))
const formPriceLabel = computed(() => {
  const service = formService.value
  if (!service || !Number(service.price)) return 'Free'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: service.currency || 'NGN', maximumFractionDigits: 0,
    }).format(Number(service.price))
  } catch {
    return `${service.currency || 'NGN'} ${Number(service.price).toLocaleString()}`
  }
})
const formDateLabel = computed(() => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.value.date)) return ''
  return new Date(`${form.value.date}T12:00:00.000Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
  })
})
const eligibleMembers = computed(() => {
  const service = formService.value
  if (!team.value || !service) return []
  return activeMembers.value
    .filter((item) => servicesForStaff(state, item).some((candidate) => candidate.id === service.id))
    .map((item) => ({ member: item, hasHours: Boolean(scheduleOf(state, item)) }))
})
const formMember = computed(() => eligibleMembers.value.find((item) => item.member.id === form.value.staffId)?.member || null)
const formSchedule = computed(() => (team.value && formMember.value ? scheduleOf(state, formMember.value) : scheduleFor(formService.value || null)) || null)
const formZone = computed(() =>
  (team.value && formMember.value ? scheduleOf(state, formMember.value)?.timezone : '') || scheduleFor(formService.value || null)?.timezone || state.schedules?.[0]?.timezone || 'UTC',
)
// Open times on the chosen day for this service and person: their hours, minus bookings and time off on that calendar.
// Owners may still book any other time with the time field (walk-ins and phone bookings).
const openSlots = computed(() => {
  const schedule = formSchedule.value
  const service = formService.value
  if (!schedule || !service || !/^\d{4}-\d{2}-\d{2}$/.test(form.value.date)) return []
  try {
    const model = { ...scheduleFromRecord(schedule), minimumNoticeMinutes: 0, bookingHorizonDays: 365 }
    const busy = (state.bookings || [])
      .filter((item) => item.schedule_id === schedule.id && item.status !== 'cancelled')
      .flatMap((item) => {
        const start = Date.parse(String(item.starts_at || ''))
        const end = Date.parse(String(item.ends_at || ''))
        return Number.isFinite(start) && Number.isFinite(end) ? [{ startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() }] : []
      })
    return listOpenings({ schedule: model, durationMinutes: Number(service.duration_minutes), fromDate: form.value.date, throughDate: form.value.date, now: new Date(), busy })
  } catch {
    return []
  }
})
const slotText = (opening: Opening) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: displayTimeZone(formZone.value) }).format(Date.parse(opening.startsAt))
const formTimeLabel = computed(() => {
  if (!/^\d{2}:\d{2}$/.test(form.value.time)) return ''
  const minute = minutesOf(form.value.time)
  return new Date(Date.UTC(2000, 0, 1, Math.floor(minute / 60), minute % 60)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
})
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
    ? { title: 'Set your hours first', text: 'Bookings sit inside your weekly hours. Set your hours, add a service, then you can add bookings here.', label: 'Set your availability', to: '/availability' }
    : !bookableServices.value.length
      ? { title: 'Add a service first', text: 'Every booking is for a service. Add one, then come back to add a booking.', label: 'Add a service', to: '/services' }
      : null,
)
const newDirty = computed(() => {
  if (!newOpen.value || newResult.value) return false
  const f = form.value
  return Boolean(f.time || f.name.trim() || f.email.trim() || f.phone.trim() || f.notes.trim() || f.ownerNotes.trim() || Number(f.repeatWeeks) > 0)
})
const repeatOptions = Array.from({ length: 13 }, (_, weeks) => ({ value: weeks, label: weeks === 0 ? 'Does not repeat' : `Every week, ${weeks} more ${weeks === 1 ? 'time' : 'times'}` }))
const setRepeat = (value: string | number | boolean) => { form.value.repeatWeeks = Math.max(0, Math.min(12, Math.floor(Number(value) || 0))) }
const newServiceOptions = computed(() => bookableServices.value.map((item) => ({
  value: item.id || '',
  label: `${displayName(item.name)}, ${item.duration_minutes} min`,
})))
const newStaffOptions = computed(() => eligibleMembers.value.map((item) => ({
  value: item.member.id || '',
  label: `${memberName(item.member)}${isOwnerMember(item.member) ? ' (owner)' : ''}${item.hasHours ? '' : ' (set hours first)'}`,
  disabled: !item.hasHours,
})))

function openNew() {
  if (isDemo.value) return
  form.value = blankForm()
  form.value.serviceId = bookableServices.value[0]?.id || ''
  pickDefaultMember()
  form.value.date = todayKey.value
  newError.value = ''
  newResult.value = null
  newDiscardOpen.value = false
  selectedId.value = ''
  newOpen.value = true
  nextTick(() => document.getElementById('new-booking-title')?.focus())
}
watch(
  () => route.query.new,
  (value) => {
    if (route.path === '/bookings' && String(Array.isArray(value) ? value[0] : value || '') === '1' && !newOpen.value) openNew()
  },
  { immediate: true },
)
function closeNew() {
  if (newSaving.value) return
  newDiscardOpen.value = false
  newOpen.value = false
  if (route.path === '/bookings' && route.query.new) router.replace({ path: '/bookings', query: { ...route.query, new: undefined } })
}
function discardNew() {
  const next = pendingRoute.value
  pendingRoute.value = ''
  newDiscardOpen.value = false
  newOpen.value = false
  if (next) {
    allowLeave.value = true
    router.push(next)
  } else if (route.path === '/bookings' && route.query.new) {
    router.replace({ path: '/bookings', query: { ...route.query, new: undefined } })
  }
}
function requestCloseNew() {
  if (newSaving.value) return
  if (newDirty.value) newDiscardOpen.value = true
  else closeNew()
}
function newFail(message: string, field?: string) {
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
  if (!f.time) return newFail('Choose a time: tap an open time, or set any time below.', 'new-time')
  if (!f.name.trim()) return newFail('Enter the client name.', 'new-name')
  if (!f.email.trim() && !f.phone.trim()) return newFail('Add a phone number or an email address so you can reach the client.', 'new-phone')
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
      startsAt: when.at || '',
      contact: { name: f.name, email: f.email, phone: f.phone },
      notes: f.notes,
      ownerNotes: f.ownerNotes,
      repeatWeeks,
    })
    await refresh()
    newResult.value = result as NewBookingResult
    // The result panel is the one confirmation (no duplicate toast).
  } catch (reason) {
    newError.value = describeError(reason, 'The booking could not be saved.')
  } finally {
    newSaving.value = false
  }
}
function messageNewClient() {
  const first = newResult.value?.created?.[0]
  closeNew()
  if (!first) return
  window.setTimeout(() => {
    openDetail(first)
    reselect(first.id)
    messageKind.value = 'confirmation'
  }, 0)
}
const skippedLabel = (item: { startsAt: string; reason: string }) =>
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
function moveWarnings(atIso: string) {
  const warnings: string[] = []
  if (Date.parse(atIso) < Date.now()) warnings.push('That time is in the past.')
  try {
    const schedule = scheduleFor(selected.value)
    const windows = JSON.parse(schedule?.weekly_windows_json || '[]')
    const f = localFields(atIso, moveZone.value)
    const weekday = new Date(`${f.date}T12:00:00.000Z`).getUTCDay()
    const [h = 0, m = 0] = f.time.split(':').map(Number)
    const startMin = h * 60 + m
    const booking = selected.value
    if (!booking) return warnings
    const endMin = startMin + duration(booking)
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
  if (Date.parse(when.at || '') === startMs(selected.value)) return void (rescheduleError.value = 'That is the current time. Choose a different date or time.')
  const warnings = moveWarnings(when.at || '')
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
    const outcome = await rescheduleBookingWithCalendar(state, selected.value, when.at || '')
    await refresh()
    reselect(id)
    rescheduling.value = false
    messageKind.value = 'reschedule'
    detailNotice.value = `Booking moved; the old time is free again.${hadEvent ? outcome.calendar.state === 'updated' ? ' Google Calendar was updated too.' : ' Google Calendar still needs updating: use Retry Calendar update.' : ''} Let the client know with the message below.`
    scrollDetailTop()
  } catch (reason) {
    rescheduleError.value = describeError(reason, 'The booking could not be moved.')
  } finally {
    rescheduleSaving.value = false
  }
}
// ---- assign to a team member ----
// Wording: you are "you"; "your calendar" / "Amaka's calendar".
const toWho = (member: StaffRecord | null) => member && isOwnerMember(member) ? 'you' : member ? memberFirstName(member) : 'that person'
const whoseCalendar = (member: StaffRecord | null) => member && isOwnerMember(member) ? 'your calendar' : member ? `${memberFirstName(member)}'s calendar` : 'that calendar'
const assignTo = ref('')
const assignBusy = ref(false)
watch(
  () => [selected.value?.id, selected.value?.staff_id, selected.value?.schedule_id],
  () => {
    const current = selected.value ? memberFor(selected.value) : null
    assignTo.value = current && members.value.some((item) => item.id === current.id) ? current.id || '' : ''
  },
  { immediate: true },
)
// The current person is shown above the picker, so the picker lists everyone else.
const assignSelectOptions = computed(() => {
  const current = selected.value ? memberFor(selected.value).id : ''
  return members.value
    .filter((item) => item.id !== current && isStaffActive(item))
    .map((item) => ({
      value: item.id || '',
      label: `${memberName(item)}${!scheduleOf(state, item) ? ' (no hours set)' : ''}`,
      disabled: !scheduleOf(state, item) && selected.value?.status === 'confirmed',
    }))
})
const assignPick = ref('')
watch(() => selected.value?.id, () => { assignPick.value = '' })
const bulkMemberOptions = computed(() => activeMembers.value.map((member) => ({
  value: member.id || '',
  label: `${memberName(member)}${isOwnerMember(member) ? ' (owner)' : ''}${scheduleOf(state, member) ? '' : ' (no hours set)'}`,
})))
const assignReason = computed(() => {
  if (isDemo.value) return demoHint.value
  if (!selected.value) return ''
  if (!assignPick.value) return 'Choose who should take this booking.'
  return ''
})
async function assignSelected() {
  if (isDemo.value || assignBusy.value || !selected.value || assignReason.value) return
  clearBad()
  assignBusy.value = true
  error.value = ''
  detailNotice.value = ''
  const booking = selected.value
  const member = members.value.find((item) => item.id === assignPick.value) || null
  try {
    await assignBookingStaff(state, booking, assignPick.value)
    await refresh()
    assignPick.value = ''
    const text = booking.status === 'confirmed'
      ? `Moved to ${whoseCalendar(member)}; the time is free again on the previous calendar.`
      : `Now recorded as ${toWho(member)}'s. Finished and cancelled bookings keep their calendar; only the name changes.`
    detailNotice.value = `${text} Nothing was sent to the client.`
  } catch (reason) {
    // Refusals (busy, time off, not active) come with the exact reason; show it where the owner is looking.
    error.value = errorMessage(reason, 'The booking could not be assigned.')
  } finally {
    assignBusy.value = false
  }
}

// ---- bulk assign (selection mode) ----
const selecting = ref(false)
const picked = ref<string[]>([])
const bulkTo = ref('')
const bulkBusy = ref(false)
const bulkConfirmOpen = ref(false)
interface BulkAssignResult { member: StaffRecord | null; moved: number; refused: Array<{ booking: BookingRecord; reason: string }>; total: number }
const bulkResult = ref<BulkAssignResult | null>(null)
const pickedBookings = computed(() => filtered.value.filter((item) => item.id && picked.value.includes(item.id)))
const isPicked = (id: string | undefined) => Boolean(id && picked.value.includes(id))
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
  if (!bulkTo.value) bulkTo.value = activeMembers.value.find((item) => !isOwnerMember(item))?.id || ownerStaff(state).id || ''
}
function stopSelecting() {
  selecting.value = false
  picked.value = []
  bulkConfirmOpen.value = false
}
function togglePick(id: string | undefined) {
  if (!id) return
  picked.value = picked.value.includes(id) ? picked.value.filter((item) => item !== id) : [...picked.value, id]
}
const toggleAllPicked = () => { picked.value = allPicked.value ? [] : filtered.value.flatMap((item) => item.id ? [item.id] : []) }
// A selection only means something for the rows on screen.
watch([activeTab, view, query, emailFilter, serviceFilter, staffFilter, fromDate, toDate], () => { picked.value = []; bulkResult.value = null })
watch(team, (value) => { if (!value) stopSelecting() })
watch(view, (value) => { if (value === 'week') stopSelecting() })
async function runBulk() {
  if (isDemo.value || bulkBusy.value || bulkReason.value) return
  clearBad()
  bulkBusy.value = true
  const member = bulkMember.value
  try {
    if (!member?.id) return
    const result = await bulkAssignStaff(state, pickedBookings.value, member.id)
    await refresh()
    const moved = result.moved.length
    const refused = result.refused
    bulkResult.value = { member, moved, refused, total: moved + refused.length }
    // Refused rows stay ticked so the owner can try another person.
    picked.value = refused.flatMap((item) => item.booking.id ? [item.booking.id] : [])
    // Refusals are listed inline with their reasons; a clean run is a toast. Never both.
    if (!refused.length) {
      bulkResult.value = null
      ok(`Moved ${moved} booking${moved === 1 ? '' : 's'} to ${whoseCalendar(member)}.`)
    }
  } catch (reason) {
    bad(errorMessage(reason, 'The bookings could not be assigned.'))
  } finally {
    bulkBusy.value = false
    bulkConfirmOpen.value = false
  }
}
const refusedLabel = (item: { booking: BookingRecord; reason: string }) => `${item.booking.guest_name}, ${when(item.booking)}`

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
// Every way of closing (X, Esc, scrim) goes through here so a typed note is never lost silently.
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
  const base = 'The appointment stays in history and the time opens up again. Afterwards you can open a cancellation message in your own WhatsApp, SMS or email.'
  return selected.value && onCalendar(selected.value) ? `${base} Its Google Calendar event will be marked cancelled, shown as free time, and have reminders turned off.` : base
})
function askCancel() {
  if (isDemo.value) return
  rescheduling.value = false
  cancelOpen.value = true
  nextTick(() => document.getElementById('cancellation-reason')?.focus())
}

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
    cancelOpen.value = false
    messageKind.value = 'cancellation'
    const calendarState = outcome.calendar.state
    detailNotice.value =
      calendarState === 'updated'
        ? 'Booking cancelled and the time opened up. The Google Calendar event is marked cancelled, shows free time, and has no reminders.'
        : calendarState === 'failed'
          ? `Booking cancelled and the time opened up, but the Google Calendar event was not updated (${outcome.calendar.message}). Use Retry Calendar update.`
          : calendarState === 'skipped'
            ? 'Booking cancelled and the time opened up. Its Google Calendar event was not changed because Calendar is unavailable here; update it in Google Calendar.'
            : 'Booking cancelled and the time opened up.'
    detailNotice.value += ' Let the client know with the message below.'
    scrollDetailTop()
  } catch (reason) {
    error.value = errorMessage(reason, 'The booking could not be cancelled.')
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
const contactLine = (booking: BookingRecord) => booking.guest_phone || (hasRealEmail(booking.guest_email) ? booking.guest_email : 'No phone or email')
</script>

<template>
  <section class="bookings-page" :class="{ 'is-creating': newOpen, 'has-detail': selected && !compactDetail }">
    <template v-if="!newOpen">
      <header class="page-header">
        <div>
          <h1>Bookings</h1>
          <p class="lede">{{ view === 'week' ? `Week of ${weekRange}` : 'Every appointment as a list' }}</p>
        </div>
        <div class="page-header-actions">
          <div class="calendar-status">
            <button class="chip-button" :class="{ connected: calendarConnected }" type="button" :aria-expanded="calendarOpen" aria-controls="calendar-panel" @click="calendarOpen = !calendarOpen">
              <span class="calendar-dot" aria-hidden="true" />{{ calendarChip }}
            </button>
          </div>
          <details class="menu" data-menu>
            <summary class="secondary">More<AppIcon class="chevron-down" name="chevron" :size="14" /></summary>
            <div class="menu-panel">
              <GmButton variant="ghost" size="sm" :disabled-reason="state.profile?.public_link_url ? '' : 'Create your booking link in Settings first.'" @click="copyShareLink"><template #leading><AppIcon name="link" :size="16" /></template>Copy booking link</GmButton>
              <GmButton variant="ghost" size="sm" :disabled-reason="exportReason" @click="exportCsv"><template #leading><AppIcon name="download" :size="16" /></template>Export this list (CSV)</GmButton>
            </div>
          </details>
          <GmButton variant="primary" :disabled-reason="demoHint" @click="openNew"><template #leading><AppIcon name="plus" :size="16" /></template>New booking</GmButton>
        </div>
      </header>

      <section v-if="calendarOpen" id="calendar-panel" class="calendar-panel" aria-label="Google Calendar">
        <p>{{ calendarHint }}</p>
        <div class="cluster">
          <button v-if="calendar.state === 'not-connected'" class="primary small" type="button" :disabled="calendarBusy" @click="connectCalendar">{{ calendarBusy ? 'Connecting…' : 'Connect Google Calendar' }}</button>
          <button v-if="calendar.state === 'error'" class="secondary small" type="button" @click="loadCalendarStatus">Check again</button>
          <GmButton v-if="calendarConnected" variant="secondary" size="sm" :disabled="calendarBusy" :disabled-reason="calendarBusy ? '' : addAllReason" @click="addAllToCalendar">{{ calendarBusy ? 'Working…' : `Add all upcoming (${needsCalendar.length})` }}</GmButton>
          <GmHint text="Optional. Goalmatic may ask for approval according to your workspace policy. Clients are never invited." label="About Google Calendar" />
        </div>
      </section>
      <p v-if="calendarNotice" class="notice success" role="status">{{ calendarNotice }}</p>
      <p v-if="calendarError" class="notice error" role="alert">{{ calendarError }}</p>
      <p v-if="conflictNote" class="notice warning" role="status">{{ conflictNote }}</p>
      <ul v-if="bulkOutcomes.length" class="calendar-outcomes">
        <li v-for="outcome in bulkOutcomes" :key="outcome.id" :class="{ 'error-text': !outcome.ok }">{{ bulkLabel(outcome) }}: {{ outcome.ok ? (outcome.skipped ? 'already on calendar' : 'added') : outcome.message }}</li>
      </ul>
      <p v-if="isDemo" class="demo-note">{{ demoHint }} Message links still open, because they only prepare text in your own apps.</p>
      <div v-if="error && !selected" class="notice error" role="alert">{{ error }}</div>

      <div data-tour="tour-bookings-list">
        <div class="toolbar booking-toolbar">
          <div class="segmented" role="group" aria-label="View">
            <button type="button" :aria-pressed="view === 'week'" @click="view = 'week'"><AppIcon name="calendar" :size="16" />Week</button>
            <button type="button" :aria-pressed="view === 'agenda'" @click="view = 'agenda'"><AppIcon name="bookings" :size="16" />List</button>
          </div>
          <!-- Phones: search and filters sit behind one button so the calendar starts on the first screen. -->
          <button v-if="phoneGrid" class="secondary filters-toggle" type="button" :aria-expanded="filtersOpen" aria-controls="booking-filters" @click="filtersOpen = !filtersOpen">
            <AppIcon name="search" :size="16" />Search and filters<span v-if="activeFilterCount" class="count-pill" :aria-label="`${activeFilterCount} active`">{{ activeFilterCount }}</span>
          </button>
          <div v-show="!phoneGrid || filtersOpen" id="booking-filters" class="booking-filters">
            <label class="search-field">
              <AppIcon name="search" :size="17" /><span class="visually-hidden">Search bookings</span>
              <input v-model="query" type="search" placeholder="Client, service or reference" />
            </label>
            <div class="field">
              <label for="filter-service" class="visually-hidden">Service</label>
              <GmSelect id="filter-service" v-model="serviceFilter" class="input" :options="serviceFilterOptions" label="Filter by service" />
            </div>
            <div v-if="team" class="field">
              <label for="filter-staff" class="visually-hidden">Team member</label>
              <GmSelect id="filter-staff" v-model="staffFilter" class="input" :options="staffFilterOptions" label="Filter by team member" />
            </div>
            <template v-if="view === 'agenda'">
              <div class="field date-field">
                <label for="filter-from">From</label>
                <GmDatePicker id="filter-from" v-model="fromDate" class="input" label="From date" :max="toDate" />
              </div>
              <div class="field date-field">
                <label for="filter-to">To</label>
                <GmDatePicker id="filter-to" v-model="toDate" class="input" label="To date" :min="fromDate" />
              </div>
            </template>
            <button v-if="hasFilters" class="ghost small" type="button" @click="clearFilters">Clear filters</button>
          </div>
        </div>
        <p v-if="emailFilter" class="filter-line">Showing history for <strong>{{ emailFilterLabel }}</strong><button class="ghost small" type="button" @click="clearEmail">Show everyone</button></p>

        <!-- Week: time drawn to scale, overlaps side by side -->
        <div v-if="view === 'week'" class="panel week-panel">
          <div class="week-nav">
            <button class="icon-button" type="button" aria-label="Previous week" @click="weekOffset -= 1"><AppIcon name="arrow-left" :size="16" /></button>
            <button class="icon-button" type="button" aria-label="Next week" @click="weekOffset += 1"><AppIcon name="chevron" :size="16" /></button>
            <strong class="tnum">{{ weekRange }}</strong>
            <button v-if="weekOffset !== 0" class="ghost small" type="button" @click="weekOffset = 0">This week</button>
            <span class="week-meta">{{ calendarItems.length }} {{ calendarItems.length === 1 ? 'appointment' : 'appointments' }}, times in {{ scheduleZone }}</span>
            <label class="inline-check week-toggle"><input v-model="showCancelled" type="checkbox" />Show cancelled</label>
          </div>
          <p v-if="!calendarItems.length" class="week-empty">{{ hasFilters ? 'No appointments match your filters this week.' : 'No appointments this week.' }} <button v-if="hasFilters" class="link-button" type="button" @click="clearFilters">Clear filters</button></p>
          <div v-if="phoneGrid" class="day-strip" role="group" aria-label="Day">
            <button v-for="day in weekDays" :key="`strip-${day.key}`" type="button" :class="{ today: day.today }" :aria-pressed="focusDay === day.index" :aria-label="`${day.full}, ${day.items.length} ${day.items.length === 1 ? 'appointment' : 'appointments'}`" @click="focusDay = day.index">
              <small>{{ day.weekday }}</small><b class="tnum">{{ day.day }}</b><i v-if="day.items.length" aria-hidden="true" />
            </button>
          </div>
          <ul v-if="team" class="week-legend" aria-label="Who is who">
            <li v-for="member in members" :key="member.id"><i class="legend-stem" :style="{ background: memberColor(member) }" aria-hidden="true" />{{ staffLabel(member) }}</li>
          </ul>
          <div class="calendar-scroll">
            <div class="calendar-week" :style="{ '--calendar-height': `${calendarHeight}px`, '--days': shownDays.length }">
              <div class="calendar-corner" aria-hidden="true" />
              <div v-for="day in shownDays" :key="`head-${day.key}`" class="calendar-day-head" :class="{ today: day.today, past: day.past }">
                <span>{{ day.weekday }}</span><b class="tnum">{{ day.day }}</b><small v-if="day.today">Today</small>
              </div>
              <div class="calendar-time-axis" :style="{ height: `${calendarHeight}px` }" aria-hidden="true">
                <span v-for="hour in calendarHours" :key="hour" :style="{ top: `${yOf(hour * 60)}px` }">{{ hourLabel(hour) }}</span>
              </div>
              <div v-for="day in shownDays" :key="day.key" class="calendar-day-column" :class="{ today: day.today }" role="group" :aria-label="day.full" :style="{ height: `${calendarHeight}px` }">
                <i v-for="hour in calendarHours.slice(1)" :key="hour" class="calendar-grid-line" :style="{ top: `${yOf(hour * 60)}px` }" aria-hidden="true" />
                <RouterLink
                  v-if="day.off.length"
                  to="/availability"
                  class="calendar-time-off"
                  :aria-label="`${day.off.length} time off ${day.off.length === 1 ? 'block' : 'blocks'} on ${day.full}. Manage in Availability.`"
                >Time off</RouterLink>
                <button
                  v-for="entry in placedFor(day)"
                  :key="entry.item.id"
                  type="button"
                  class="slot calendar-booking"
                  :class="[slotClasses(entry.item), `is-${spanSize(entry.end - entry.start)}`]"
                  :style="slotStyle(entry)"
                  :aria-label="`${time(entry.item)} to ${endTime(entry.item)}, ${entry.item.guest_name}, ${displayName(entry.item.service_name)}${team ? ', with ' + staffName(entry.item) : ''}, ${statusLabel(entry.item.status)}`"
                  @click="openDetail(entry.item)"
                ><span class="tnum">{{ time(entry.item) }}</span><strong>{{ entry.item.guest_name }}</strong><small>{{ displayName(entry.item.service_name) }}</small><small v-if="team" class="week-staff">{{ memberFirstName(memberFor(entry.item)) }}</small></button>
                <div v-if="day.today && nowLine !== null" class="calendar-now" :style="{ top: `${nowLine}px` }" aria-hidden="true" />
              </div>
            </div>
          </div>
          <footer class="week-foot"><span class="legend-shapes"><span class="status completed">Came</span><span class="status no_show">No-show</span><span class="status cancelled">Cancelled</span></span></footer>
        </div>

        <!-- List: the front-desk ledger -->
        <template v-else>
          <div class="tab-bar" role="group" aria-label="Show">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              :aria-pressed="activeTab === tab.id"
              @click="activeTab = tab.id"
            >{{ tab.label }}<span class="count-pill">{{ tab.count }}</span></button>
          </div>
          <p class="tab-help">{{ TAB_HELP[activeTab] }} <GmHint :text="STATUS_HELP" label="What the statuses mean" /></p>

          <div v-if="team" class="select-row">
            <GmButton
              v-if="!selecting"
              variant="secondary"
              size="sm"
              :disabled-reason="isDemo ? demoHint : !groups.length ? 'No bookings in this view to select.' : ''"
              @click="startSelecting"
            >Assign several to someone</GmButton>
          </div>
          <div v-if="team && selecting" class="bulk-bar" role="region" aria-label="Assign selected bookings">
            <div class="bulk-top">
              <strong class="tnum">{{ pickedBookings.length }} selected</strong>
              <button class="ghost small" type="button" :disabled="!filtered.length" @click="toggleAllPicked">{{ allPicked ? 'Clear selection' : `Select all ${filtered.length} shown` }}</button>
              <button class="ghost small bulk-done" type="button" :disabled="bulkBusy" @click="stopSelecting">Done</button>
            </div>
            <div class="bulk-controls">
              <div class="field">
                <label for="bulk-to">Assign to <GmHint text="Confirmed bookings move onto that person's own calendar, and each one is refused if they are busy or on time off then. Finished and cancelled bookings only change who is recorded. Clients are not messaged." label="About assigning" /></label>
                <GmSelect id="bulk-to" v-model="bulkTo" class="input" :options="bulkMemberOptions" label="Assign selected bookings to" />
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
              <p v-if="bulkResult.refused.length" class="muted">Refused bookings stay ticked and where they were. Choose someone else, or move them one by one.</p>
              <button class="ghost small" type="button" @click="bulkResult = null">Dismiss</button>
            </div>
          </div>

          <div v-if="groups.length" class="agenda">
            <section v-for="group in groups" :key="group.key" class="day-group" :aria-labelledby="`day-${group.key}`">
              <h2 :id="`day-${group.key}`" class="day-heading" :class="{ today: group.today }">{{ group.label }}<span v-if="group.today" class="chip now">Today</span><small class="tnum">{{ group.items.length }}</small></h2>
              <ul class="ledger">
                <li v-for="booking in group.items" :key="booking.id" class="agenda-row" :class="{ selecting, 'is-picked': isPicked(booking.id), 'is-cancelled': isCancelled(booking) }">
                  <label v-if="selecting" class="pick-box">
                    <input type="checkbox" :checked="isPicked(booking.id)" :aria-label="`Select ${booking.guest_name}, ${booking.service_name}, ${when(booking)}`" @change="togglePick(booking.id)" />
                  </label>
                  <button type="button" class="agenda-open" @click="openDetail(booking)">
                    <span class="agenda-time tnum"><b>{{ time(booking) }}</b><small>{{ duration(booking) }} min</small></span>
                    <span class="agenda-stem" :style="team ? { background: staffColor(booking) } : undefined" aria-hidden="true" />
                    <span class="agenda-main">
                      <h3>{{ booking.guest_name }}</h3>
                      <span class="agenda-meta">{{ displayName(booking.service_name) }}<template v-if="team"> with {{ staffName(booking) }}</template></span>
                      <span class="agenda-contact">{{ contactLine(booking) }}</span>
                    </span>
                    <span class="agenda-flags">
                      <span class="status" :class="booking.status">{{ statusLabel(booking.status) }}</span>
                      <span v-if="isSeries(booking)" class="chip neutral">Weekly</span>
                      <span v-if="calendarNeedsSync(booking)" class="chip warning">Calendar needs update</span>
                      <span v-if="conflictTitles(booking).length" class="chip warning">Calendar clash</span>
                    </span>
                  </button>
                  <span v-if="needsOutcome(booking)" class="agenda-actions">
                    <span class="agenda-question">Did they come?</span>
                    <button class="secondary small" type="button" :disabled="actionBusy || isDemo" :title="isDemo ? demoHint : undefined" @click="changeStatus(booking, 'completed')">Came</button>
                    <button class="secondary small" type="button" :disabled="actionBusy || isDemo" :title="isDemo ? demoHint : undefined" @click="changeStatus(booking, 'no_show')">No-show</button>
                  </span>
                </li>
              </ul>
            </section>
          </div>

          <div v-else class="empty">
            <h2>{{ hasFilters ? 'No bookings match your filters' : !hasAnyBookings ? 'No bookings yet' : `No ${tabs.find((tab) => tab.id === activeTab)?.label.toLowerCase() || activeTab} bookings` }}</h2>
            <p v-if="hasFilters">Try a client name, phone, service, reference, or a wider date range.</p>
            <p v-else-if="!hasAnyBookings">{{ setup.hasLink ? 'Share your booking link and bookings appear here as soon as a guest books. You can also add a walk-in or phone booking yourself.' : `Guests book through your booking link, which is ready once setup is done. Next: ${(setup.nextStep?.label || 'finish setup').toLowerCase()}. You can also add a booking yourself.` }}</p>
            <p v-else>Nothing here right now. Other tabs may have bookings.</p>
            <div class="empty-actions">
              <GmButton v-if="hasFilters" variant="secondary" @click="clearFilters">Clear filters</GmButton>
              <template v-else-if="!hasAnyBookings">
                <GmButton v-if="setup.hasLink" variant="primary" @click="copyShareLink">Copy your booking link</GmButton>
                <RouterLink v-else class="primary" :to="setup.nextStep?.to || '/settings'">{{ setup.nextStep?.label || 'Finish setup' }}</RouterLink>
                <GmButton variant="secondary" :disabled-reason="demoHint" @click="openNew">New booking</GmButton>
              </template>
              <GmButton v-else-if="activeTab !== 'all'" variant="secondary" @click="activeTab = 'all'">Show all bookings</GmButton>
            </div>
          </div>
        </template>
      </div>
    </template>

    <!-- Booking detail: side panel above 1200px, modal panel with a scrim below, bottom sheet on phones -->
    <button v-if="selected && compactDetail" class="detail-scrim" type="button" aria-label="Close booking details" tabindex="-1" @click="requestClose"></button>
    <aside v-if="selected" class="booking-detail" :role="compactDetail ? 'dialog' : 'region'" :aria-modal="compactDetail ? 'true' : undefined" aria-labelledby="booking-detail-title" @keydown="detailKeydown">
      <header class="detail-head">
        <div class="detail-title">
          <h2 id="booking-detail-title" tabindex="-1">{{ selected.guest_name }}</h2>
          <p>{{ displayName(selected.service_name) }}<template v-if="team"> with {{ staffName(selected) }}</template></p>
        </div>
        <GmConfirm
          v-model:open="discardOpen"
          title="Discard unsaved changes?"
          :message="discardMessage"
          confirm-label="Discard and close"
          cancel-label="Keep editing"
          tone="danger"
          placement="bottom"
          @confirm="discardDialog"
          @cancel="keepEditing"
        >
          <button class="icon-button" type="button" aria-label="Close booking details" @click="requestClose"><AppIcon name="close" /></button>
        </GmConfirm>
      </header>

      <div class="detail-body">
        <div class="detail-summary" :class="{ cancelled: isCancelled(selected) }">
          <p class="detail-when tnum"><strong>{{ when(selected) }}</strong> to {{ endTime(selected) }}</p>
          <p class="detail-sub">{{ duration(selected) }} minutes, {{ zoneLabel(selected) }}</p>
          <p class="detail-status"><span class="status" :class="selected.status">{{ statusLabel(selected.status) }}</span><span v-if="selected.source === 'owner'" class="chip neutral">Added by you</span><span v-if="isSeries(selected)" class="chip neutral">Repeats weekly</span><span class="detail-ref mono">{{ selected.reference }}</span></p>
        </div>

        <div v-if="error" class="notice error" role="alert"><AppIcon name="alert" :size="18" /><span>{{ error }}</span></div>
        <div v-if="detailNotice" class="notice success" role="status"><AppIcon name="check" :size="18" /><span>{{ detailNotice }}</span></div>

        <!-- The decision at the desk -->
        <div v-if="canMove(selected) && hasStarted(selected) && !rescheduling" class="outcome" role="group" aria-labelledby="outcome-q">
          <p id="outcome-q">{{ isDone(selected) ? `Recorded as ${statusLabel(selected.status).toLowerCase()}.` : 'Did they come?' }}</p>
          <div class="cluster">
            <GmButton v-if="selected.status !== 'completed'" :variant="isDone(selected) ? 'secondary' : 'primary'" size="sm" :disabled="actionBusy" :disabled-reason="demoHint" @click="changeStatus(selected, 'completed')">Came</GmButton>
            <GmButton v-if="selected.status !== 'no_show'" variant="secondary" size="sm" :disabled="actionBusy" :disabled-reason="demoHint" @click="changeStatus(selected, 'no_show')">No-show</GmButton>
            <GmButton v-if="isDone(selected)" variant="ghost" size="sm" :disabled="actionBusy" :disabled-reason="demoHint" @click="changeStatus(selected, 'confirmed')">Undo</GmButton>
          </div>
        </div>
        <div v-else-if="!rescheduling && !cancelOpen && (canMove(selected) || canCancel(selected))" class="quick-row">
          <GmButton v-if="canMove(selected)" variant="secondary" size="sm" :disabled-reason="demoHint" @click="startReschedule"><template #leading><AppIcon name="calendar" :size="16" /></template>Reschedule</GmButton>
          <GmButton v-if="canCancel(selected)" variant="ghost" size="sm" class="cancel-trigger" :disabled-reason="demoHint" @click="askCancel">Cancel booking</GmButton>
        </div>

        <!-- Cancel: one confirm step with an optional private reason -->
        <section v-if="cancelOpen && canCancel(selected)" class="cancel-box" aria-labelledby="cancel-title">
          <h3 id="cancel-title">Cancel this booking?</h3>
          <p>{{ cancelMessage }}</p>
          <div class="field">
            <label for="cancellation-reason">Reason <span class="optional">(optional, only you see it)</span></label>
            <textarea id="cancellation-reason" v-model.trim="cancellationReason" maxlength="500" rows="2"></textarea>
          </div>
          <div class="form-actions">
            <GmButton variant="danger" :pending="cancelling" pending-label="Cancelling…" :disabled-reason="demoHint" @click="cancel">Cancel booking</GmButton>
            <GmButton variant="ghost" :disabled="cancelling" @click="cancelOpen = false">Keep booking</GmButton>
          </div>
        </section>

        <!-- Reschedule -->
        <form v-if="rescheduling && canMove(selected)" class="move-box" @submit.prevent="requestMove">
          <h3>Move to a new time</h3>
          <p class="field-hint">Times are in {{ zoneName(moveZone) }}. The booking keeps its {{ duration(selected) }} minutes.<template v-if="onCalendar(selected)"> The linked Google Calendar event moves too.</template></p>
          <div v-if="rescheduleError" class="notice error" role="alert"><AppIcon name="alert" :size="18" /><span>{{ rescheduleError }}</span></div>
          <div class="field-row">
            <div class="field">
              <label for="move-date">New date</label>
              <GmDatePicker id="move-date" v-model="moveForm.date" label="New date" required />
            </div>
            <div class="field">
              <label for="move-time">New time</label>
              <GmTimePicker id="move-time" v-model="moveForm.time" label="New time" required />
            </div>
          </div>
          <div class="form-actions">
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
            <GmButton variant="ghost" :disabled="rescheduleSaving" @click="rescheduling = false">Keep current time</GmButton>
          </div>
        </form>

        <!-- Message the client: opened in the owner's own app -->
        <section v-if="!rescheduling" class="detail-section message-box" aria-labelledby="message-heading">
          <h3 id="message-heading">Message {{ selected.guest_name?.split(' ')[0] || 'the client' }}</h3>
          <div class="segmented kind-row" role="group" aria-label="Message type">
            <button
              v-for="kind in MESSAGE_KINDS"
              :key="kind.id"
              type="button"
              :aria-pressed="messageKind === kind.id"
              @click="openMessage(kind.id)"
            >{{ kind.label }}</button>
          </div>
          <template v-if="composed">
            <p v-if="isSuggestedKind(messageKind)" class="field-hint">Suggested because {{ SUGGESTED_WHY[messageKind] }}.</p>
            <p class="message-text" tabindex="0" aria-label="Message text">{{ composed.text }}</p>
            <div class="form-actions">
              <a v-if="composed.whatsapp" class="primary small" :href="composed.whatsapp" target="_blank" rel="noopener noreferrer" @click="openedApp('WhatsApp')"><AppIcon name="messages" :size="16" />Open WhatsApp</a>
              <a v-if="composed.sms" class="secondary small" :href="composed.sms" @click="openedApp('SMS')">Open SMS</a>
              <a v-if="emailUsable" class="secondary small" :href="composed.email" @click="openedApp('your mail app')">Open mail app</a>
              <a v-if="emailUsable && gmailUrl" class="secondary small" :href="gmailUrl" target="_blank" rel="noopener noreferrer" @click="openedApp('Gmail')">Open Gmail</a>
              <button class="ghost small" type="button" @click="copyMessage"><AppIcon name="copy" :size="16" />Copy</button>
            </div>
            <p class="field-hint">Opens in your own app with the text ready. You press send; Bookins cannot see whether it was sent.</p>
            <p v-if="!composed.whatsapp" class="field-hint">{{ phoneProblem }}</p>
            <p v-if="messageNotice" class="field-hint" role="status">{{ messageNotice }}</p>
          </template>
        </section>

        <section class="detail-section" aria-labelledby="guest-heading">
          <h3 id="guest-heading">Client</h3>
          <dl class="detail-list">
            <dt>Phone</dt><dd>{{ selected.guest_phone || 'Not given' }}</dd>
            <dt>Email</dt>
            <dd><a v-if="hasRealEmail(selected.guest_email)" :href="`mailto:${selected.guest_email}`">{{ selected.guest_email }}</a><template v-else>Not given</template></dd>
            <dt>Their note</dt><dd>{{ selected.notes || 'None' }}</dd>
          </dl>
          <RouterLink v-if="selected.guest_email" class="text-link" :to="{ path: '/bookings', query: { email: String(selected.guest_email).toLowerCase() } }" @click="close">See their history</RouterLink>
        </section>

        <section class="detail-section" aria-labelledby="owner-notes-label">
          <h3 id="owner-notes-label">Private note</h3>
          <div class="field">
            <label for="owner-notes" class="field-hint">Only you see this. It never goes into messages to the client.</label>
            <textarea id="owner-notes" v-model="notesDraft" maxlength="4000" :disabled="isDemo || notesSaving" placeholder="Preferences, follow-ups, what was used"></textarea>
          </div>
          <div class="form-actions">
            <GmButton variant="secondary" size="sm" :pending="notesSaving" pending-label="Saving…" :disabled-reason="isDemo ? demoHint : !notesDirty ? 'Type a note to save it.' : ''" @click="saveNotes">Save note</GmButton>
            <span v-if="notesDirty" class="unsaved" role="status">Not saved yet</span>
          </div>
        </section>

        <section v-if="team" class="detail-section" aria-labelledby="staff-heading">
          <h3 id="staff-heading">Who it is with</h3>
          <p class="staff-now"><i class="legend-stem" :style="{ background: staffColor(selected) }" aria-hidden="true" />{{ staffName(selected) }}<small v-if="memberFor(selected).removed" class="muted"> (no longer on your team)</small><small v-else-if="!isStaffActive(memberFor(selected))" class="muted"> (inactive)</small></p>
          <div class="assign-row">
            <div class="field">
              <label for="assign-to">Give it to <GmHint text="Assigning a confirmed booking moves it onto that person's own calendar, so it is refused if they are busy or on time off then. Finished or cancelled bookings only change the name recorded." label="About assigning a booking" /></label>
              <GmSelect id="assign-to" v-model="assignPick" :options="assignSelectOptions" label="Give this booking to" placeholder="Choose a person" :disabled="isDemo || assignBusy || !assignSelectOptions.length" />
            </div>
            <GmButton variant="secondary" size="sm" :pending="assignBusy" pending-label="Assigning…" :disabled-reason="assignReason" @click="assignSelected">Assign</GmButton>
          </div>
        </section>

        <section v-if="onCalendar(selected) || calendarConnected || conflictTitles(selected).length" class="detail-section" aria-labelledby="cal-heading">
          <h3 id="cal-heading">Google Calendar</h3>
          <p v-if="conflictTitles(selected).length && isUpcoming(selected)" class="notice warning">Clashes with {{ conflictTitles(selected).join(', ') }} on your Google Calendar.</p>
          <div v-if="calendarNeedsSync(selected)" class="notice warning" role="status">
            <span>{{ selected.calendar_sync_error || 'This booking changed. Its Google Calendar event still needs updating.' }}</span>
            <GmButton variant="secondary" size="sm" :pending="calendarBusy" :disabled="isDemo" @click="retryCalendarSync">Retry Calendar update</GmButton>
          </div>
          <p v-else-if="onCalendar(selected)" class="field-hint">{{ selected.calendar_sync_status === 'synced' ? isCancelled(selected) ? 'Calendar updated: free time, reminders off.' : 'Google Calendar is up to date.' : 'Linked to Google Calendar.' }}</p>
          <GmButton
            v-if="calendarConnected && canCancel(selected) && selected.status === 'confirmed' && !onCalendar(selected)"
            variant="secondary"
            size="sm"
            :pending="calendarBusy"
            pending-label="Adding…"
            @click="addToCalendar(selected)"
          >Add to Google Calendar</GmButton>
        </section>

        <p v-if="selected.status !== 'cancelled' && !canCancel(selected) && !hasStarted(selected)" class="field-hint">This appointment can no longer be cancelled.</p>
        <p v-if="selected.cancellation_reason && isCancelled(selected)" class="field-hint">Cancellation reason: {{ selected.cancellation_reason }}</p>
      </div>
    </aside>

    <!-- New booking: one column, real open times, the summary docked at the bottom -->
    <section v-if="newOpen" class="new-booking" aria-labelledby="new-booking-title">
      <nav class="crumbs" aria-label="Breadcrumb"><button type="button" class="link-button" @click="requestCloseNew">Bookings</button><AppIcon name="chevron" :size="14" /><span aria-current="page">New booking</span></nav>
      <h1 id="new-booking-title" tabindex="-1">New booking</h1>
      <p class="lede">For a walk-in or a phone booking. Nothing is sent to the client.</p>

      <div v-if="newResult" class="new-result">
        <div class="notice success" role="status"><AppIcon name="check" :size="18" /><span>Saved {{ newResult.created.length }} booking{{ newResult.created.length === 1 ? '' : 's' }}. Nothing was sent to the client.</span></div>
        <div v-if="newResult.skipped.length" class="notice warning" role="status">
          <div><strong>{{ newResult.skipped.length }} repeat{{ newResult.skipped.length === 1 ? '' : 's' }} skipped</strong>
            <ul class="skipped"><li v-for="item in newResult.skipped" :key="item.startsAt">{{ skippedLabel(item) }}: {{ item.reason }}</li></ul></div>
        </div>
        <div class="form-actions">
          <GmButton v-if="newResult.created.length" variant="primary" @click="messageNewClient">Message the client</GmButton>
          <GmButton variant="secondary" @click="closeNew">Back to bookings</GmButton>
          <GmButton variant="ghost" @click="openNew">Add another</GmButton>
        </div>
      </div>

      <div v-else-if="newBlocked" class="empty">
        <h2>{{ newBlocked.title }}</h2>
        <p>{{ newBlocked.text }}</p>
        <div class="empty-actions">
          <RouterLink class="primary" :to="newBlocked.to">{{ newBlocked.label }}</RouterLink>
          <GmButton variant="secondary" @click="closeNew">Back to bookings</GmButton>
        </div>
      </div>

      <form v-else class="new-form" novalidate @submit.prevent="submitNew">
        <div v-if="newError" class="notice error" role="alert"><AppIcon name="alert" :size="18" /><span>{{ newError }}</span></div>

        <fieldset class="new-group">
          <legend>Appointment</legend>
          <div class="field">
            <label for="new-service">Service</label>
            <GmSelect id="new-service" v-model="form.serviceId" :options="newServiceOptions" label="Service" required />
          </div>
          <div v-if="team" class="field">
            <label for="new-staff">With <GmHint text="The booking goes on this person's own calendar, so two people can be booked at the same time. Only people who offer this service are listed." label="About choosing who it is with" /></label>
            <GmSelect id="new-staff" v-model="form.staffId" :options="newStaffOptions" label="Team member" required :described-by="newStaffReason ? 'new-staff-note' : undefined" />
            <span v-if="newStaffReason" id="new-staff-note" class="field-hint">{{ newStaffReason }}</span>
          </div>
          <div class="field">
            <label for="new-date">Day</label>
            <GmDatePicker id="new-date" v-model="form.date" label="Day" required />
          </div>
          <div class="field" role="group" aria-labelledby="open-times-label">
            <span id="open-times-label" class="field-label">Open times{{ formDateLabel ? ` on ${formDateLabel}` : '' }}</span>
            <div v-if="openSlots.length" class="time-chips">
              <button
                v-for="opening in openSlots"
                :key="opening.startsAt"
                type="button"
                class="time-chip tnum"
                :aria-pressed="form.time === opening.localTime"
                @click="form.time = opening.localTime"
              >{{ slotText(opening) }}</button>
            </div>
            <p v-else class="field-hint">{{ formService ? 'No open times left in your hours that day. You can still set any time below.' : 'Choose a service to see open times.' }}</p>
          </div>
          <div class="field time-field">
            <label for="new-time">Or set any time</label>
            <GmTimePicker id="new-time" v-model="form.time" label="Time" required />
            <span class="field-hint">In {{ zoneName(formZone) }}. Outside your hours is fine for walk-ins; another booking or time off at that time is not.</span>
          </div>
          <div class="field">
            <label for="new-repeat">Repeat</label>
            <GmSelect id="new-repeat" :model-value="form.repeatWeeks" :options="repeatOptions" label="Repeat" @update:model-value="setRepeat" />
            <span v-if="form.repeatWeeks > 0" class="field-hint">Creates this booking and {{ form.repeatWeeks }} more at the same time each week. Weeks that clash are skipped and listed afterwards.</span>
          </div>
        </fieldset>

        <fieldset class="new-group">
          <legend>Client</legend>
          <div class="field">
            <label for="new-name">Name</label>
            <input id="new-name" v-model="form.name" maxlength="160" autocomplete="off" required />
          </div>
          <p id="new-contact-hint" class="field-hint">Add a phone number, an email, or both. A phone number lets you open WhatsApp or SMS.</p>
          <div class="field-row">
            <div class="field">
              <label for="new-phone">Phone</label>
              <input id="new-phone" v-model="form.phone" type="tel" autocomplete="off" aria-describedby="new-contact-hint" />
            </div>
            <div class="field">
              <label for="new-email">Email</label>
              <input id="new-email" v-model="form.email" type="email" autocomplete="off" aria-describedby="new-contact-hint" />
            </div>
          </div>
        </fieldset>

        <fieldset class="new-group">
          <legend>Notes <span class="optional">(optional)</span></legend>
          <div class="field">
            <label for="new-notes">Note on the booking</label>
            <textarea id="new-notes" v-model="form.notes" maxlength="2000" rows="2"></textarea>
            <span class="field-hint">Stored on the booking like a guest's own note.</span>
          </div>
          <div class="field">
            <label for="new-owner-notes">Private note</label>
            <textarea id="new-owner-notes" v-model="form.ownerNotes" maxlength="4000" rows="2"></textarea>
            <span class="field-hint">Only you see this.</span>
          </div>
        </fieldset>

        <div class="new-dock">
          <p class="new-summary" aria-live="polite">
            <strong>{{ formService ? displayName(formService.name) : 'Choose a service' }}</strong>
            <span class="tnum">{{ formDateLabel || 'Choose a day' }}{{ formTimeLabel ? `, ${formTimeLabel}` : '' }}</span>
            <span v-if="team && formMember">with {{ memberName(formMember) }}</span>
            <span>{{ formPriceLabel }}</span>
          </p>
          <div class="form-actions">
            <GmConfirm
              v-model:open="newDiscardOpen"
              title="Discard this booking?"
              message="What you typed has not been saved and will be lost."
              confirm-label="Discard"
              cancel-label="Keep editing"
              tone="danger"
              @confirm="discardNew"
            >
              <GmButton variant="ghost" :disabled="newSaving" @click="requestCloseNew">Cancel</GmButton>
            </GmConfirm>
            <GmButton variant="primary" type="submit" :pending="newSaving" pending-label="Saving…" :disabled-reason="demoHint || newStaffReason">Save booking</GmButton>
          </div>
        </div>
      </form>
    </section>
  </section>
</template>

<style scoped>
.bookings-page { min-width: 0; }
.demo-note { margin: 0 0 var(--space-3); color: var(--muted); font-size: var(--text-sm); }
.error-text { color: var(--danger); }
.lede { font-variant-numeric: tabular-nums; }

/* Calendar status chip + panel */
.calendar-status { position: relative; }
.chip-button {
  min-height: var(--control-h); padding: 0 var(--space-3); display: inline-flex; align-items: center; gap: var(--space-2); color: var(--ink-soft);
  border: 1px dashed var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); font-size: var(--text-sm); font-weight: var(--weight-medium);
}
.chip-button.connected { border-style: solid; border-color: var(--success-line); color: var(--success); }
.calendar-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--faint); }
.chip-button.connected .calendar-dot { background: var(--success); }
.calendar-panel { margin-bottom: var(--space-4); padding: var(--space-3) var(--space-4); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); font-size: var(--text-sm); }
.calendar-panel p { margin: 0; max-width: 72ch; color: var(--ink-soft); }
.calendar-outcomes { margin: 0 0 var(--space-4); padding-left: 18px; font-size: var(--text-sm); }

/* Toolbar */
.booking-toolbar { align-items: center; }
.booking-toolbar .field { min-width: 160px; flex: 0 1 200px; }
.booking-toolbar .date-field { flex: 0 1 200px; min-width: 160px; display: flex; align-items: center; gap: var(--space-2); }
.booking-toolbar .date-field > label { flex: none; color: var(--ink-soft); font-weight: var(--weight-medium); }
.booking-toolbar .date-field > :not(label) { min-width: 0; flex: 1; }
.booking-toolbar .search-field { flex: 1 1 220px; }
.booking-filters { display: contents; }
.filters-toggle { min-height: var(--control-h); display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); }
@media (max-width: 700px) {
  .filters-toggle { width: 100%; }
  .booking-filters { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
}
.filter-line { margin: 0 0 var(--space-3); display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); font-size: var(--text-sm); }

/* Week */
.week-panel { min-width: 0; overflow: hidden; }
.week-nav { min-height: 56px; padding: var(--space-2) var(--space-3); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); border-bottom: 1px solid var(--line); }
.week-nav strong { font-size: var(--text-md); }
.week-meta { margin-left: auto; color: var(--muted); font-size: var(--text-sm); }
.week-toggle { font-size: var(--text-sm); }
.week-legend { margin: 0; padding: var(--space-2) var(--space-3); display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); border-bottom: 1px solid var(--line); list-style: none; font-size: var(--text-sm); }
.week-legend li { display: inline-flex; align-items: center; gap: 8px; }
.legend-stem { width: 4px; height: 16px; flex: none; display: inline-block; border-radius: 2px; }
.calendar-scroll { max-width: 100%; overflow-x: auto; }
.calendar-week { min-width: calc(64px + var(--days) * 104px); display: grid; grid-template-columns: 64px repeat(var(--days), minmax(104px, 1fr)); grid-template-rows: 56px var(--calendar-height); }
.calendar-corner { border-bottom: 1px solid var(--line); }
.calendar-day-head { padding: var(--space-2); display: flex; align-items: baseline; justify-content: center; gap: 6px; border-left: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.calendar-day-head span { color: var(--muted); font-size: var(--text-sm); }
.calendar-day-head b { font-size: var(--text-lg); line-height: 1.2; }
.calendar-day-head small { color: var(--ink); font-size: var(--text-xs); font-weight: var(--weight-strong); }
/* Today: a marigold bar under the date, sized to the text (no circle to overflow). */
.calendar-day-head.today { box-shadow: inset 0 -4px 0 var(--now); }
.calendar-day-head.past b { color: var(--muted); }
.calendar-time-axis { position: relative; }
.calendar-time-axis span { position: absolute; right: 10px; color: var(--muted); font-size: var(--text-xs); font-variant-numeric: tabular-nums; transform: translateY(-50%); white-space: nowrap; }
.calendar-day-column { position: relative; min-width: 0; border-left: 1px solid var(--line); }
.calendar-day-column.today { background: color-mix(in srgb, var(--now-soft) 30%, var(--surface)); }
.calendar-grid-line { position: absolute; left: 0; right: 0; height: 1px; background: var(--surface-sunken); pointer-events: none; }
.calendar-time-off {
  position: absolute; top: 4px; left: 4px; right: 4px; z-index: 1; min-height: 26px; padding: 4px 8px; overflow: hidden; color: var(--ink-soft);
  border: 1px dashed var(--line-strong); border-radius: var(--radius-sm); font-size: var(--text-xs); font-weight: var(--weight-strong); text-decoration: none; text-overflow: ellipsis; white-space: nowrap;
  background: repeating-linear-gradient(135deg, var(--surface-sunken) 0 6px, var(--surface) 6px 12px);
}
.calendar-booking { position: absolute; z-index: 2; padding-block: 4px; display: grid; grid-auto-rows: max-content; align-content: start; gap: 1px; overflow: hidden; font-size: var(--text-xs); line-height: 1.3; }
.calendar-booking:hover { box-shadow: var(--shadow-1); }
.calendar-booking > * { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Text follows the drawn length: under 45 minutes one line (time and name), under 75 minutes no staff line. */
.calendar-booking.is-short { padding-block: 2px; grid-template-columns: auto minmax(0, 1fr); align-items: baseline; column-gap: 6px; }
.calendar-booking.is-short > small { display: none; }
.calendar-booking.is-medium > .week-staff { display: none; }
.calendar-booking > span { color: var(--ink-soft); font-weight: var(--weight-strong); }
.calendar-booking > strong { font-size: var(--text-sm); }
.calendar-booking > small { color: var(--ink-soft); }
.calendar-booking .week-staff { font-weight: var(--weight-strong); }
.calendar-now { position: absolute; left: 0; right: 0; z-index: 3; border-top: 2px solid var(--now); pointer-events: none; }
.calendar-now::before { content: ''; position: absolute; left: -5px; top: -6px; width: 10px; height: 10px; border-radius: 50%; background: var(--now); }
.week-empty { margin: 0; padding: var(--space-3) var(--space-4); color: var(--ink-soft); border-bottom: 1px solid var(--line); font-size: var(--text-sm); }
.week-foot { min-height: 44px; padding: 0 var(--space-4); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-4); color: var(--muted); border-top: 1px solid var(--line); font-size: var(--text-xs); }
.legend-shapes { display: inline-flex; flex-wrap: wrap; gap: var(--space-3); }
.legend-shapes .status { font-size: var(--text-xs); }
.day-strip { padding: var(--space-2); display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; border-bottom: 1px solid var(--line); }
.day-strip button { position: relative; min-height: 56px; padding: 4px 0; display: grid; justify-items: center; align-content: center; gap: 0; color: var(--ink-soft); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
.day-strip button small { font-size: var(--text-xs); }
.day-strip button b { font-size: var(--text-md); }
.day-strip button i { position: absolute; bottom: 5px; width: 14px; height: 3px; border-radius: 2px; background: var(--accent); }
.day-strip button.today { box-shadow: inset 0 -3px 0 var(--now); }
.day-strip button[aria-pressed='true'] { color: var(--on-accent); border-color: var(--accent); background: var(--accent); }
.day-strip button[aria-pressed='true'] i { background: var(--on-accent); }

/* List (ledger) */
.tab-bar { margin-bottom: var(--space-2); }
.tab-help { margin: 0 0 var(--space-4); display: flex; align-items: center; flex-wrap: wrap; gap: 4px; color: var(--muted); font-size: var(--text-sm); }
.select-row { margin-bottom: var(--space-3); }
.agenda { display: grid; gap: var(--space-5); }
.day-group { display: grid; gap: var(--space-2); }
.day-heading { margin: 0; display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-md); }
.day-heading small { color: var(--muted); font-size: var(--text-xs); font-weight: var(--weight-medium); }
.agenda-row { display: flex; flex-wrap: wrap; align-items: center; }
.agenda-row.is-picked { background: var(--accent-faint); }
.agenda-row.is-cancelled .agenda-main h3 { color: var(--muted); text-decoration: line-through; }
.pick-box { width: 48px; align-self: stretch; display: grid; place-items: center; cursor: pointer; }
.pick-box input { width: 20px; height: 20px; min-height: 0; margin: 0; accent-color: var(--accent); }
.agenda-open {
  min-width: 0; flex: 1 1 420px; min-height: 68px; padding: var(--space-3) var(--space-4); display: grid; grid-template-columns: 76px 4px minmax(0, 1fr) auto;
  align-items: center; gap: var(--space-3); color: inherit; border: 0; background: transparent; text-align: left;
}
.agenda-open:hover { background: var(--accent-faint); }
.agenda-time { display: grid; }
.agenda-time b { font-size: var(--text-md); }
.agenda-time small { color: var(--muted); font-size: var(--text-xs); }
.agenda-stem { width: 4px; height: 40px; border-radius: 2px; background: var(--accent); }
.agenda-main { min-width: 0; display: grid; gap: 1px; }
.agenda-main h3 { margin: 0; overflow: hidden; font-size: var(--text-md); text-overflow: ellipsis; white-space: nowrap; }
.agenda-meta, .agenda-contact { overflow: hidden; color: var(--ink-soft); font-size: var(--text-sm); text-overflow: ellipsis; white-space: nowrap; }
.agenda-contact { color: var(--muted); font-size: var(--text-xs); }
.agenda-flags { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.agenda-actions { padding: 0 var(--space-4) var(--space-3) calc(76px + 4px + var(--space-4) + var(--space-3) * 2); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); flex-basis: 100%; }
.agenda-question { color: var(--ink); font-size: var(--text-sm); font-weight: var(--weight-strong); }
.bulk-bar { margin-bottom: var(--space-4); padding: var(--space-3) var(--space-4); display: grid; gap: var(--space-3); border: 1px solid var(--accent-line); border-radius: var(--radius); background: var(--accent-faint); }
.bulk-top { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-3); font-size: var(--text-sm); }
.bulk-done { margin-left: auto; }
.bulk-controls { display: flex; align-items: flex-end; flex-wrap: wrap; gap: var(--space-3); }
.bulk-controls .field { margin: 0; min-width: 200px; flex: 0 1 280px; }
.bulk-result { padding: var(--space-3); display: grid; justify-items: start; gap: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); font-size: var(--text-sm); }
.bulk-result p { margin: 0; }
.refused { margin: 0; padding-left: 18px; display: grid; gap: 4px; }

/* Booking detail */
.detail-scrim { position: fixed; inset: 0; z-index: 70; display: block; border: 0; background: rgb(26 31 61 / 0.45); }
.booking-detail {
  position: fixed; top: var(--topbar-h); right: 0; bottom: 0; z-index: 34; width: 400px; max-width: 100vw; display: flex; flex-direction: column;
  border-left: 1px solid var(--line); background: var(--surface); box-shadow: var(--shadow-2);
}
.detail-head { padding: var(--space-4) var(--space-4) var(--space-3) var(--space-5); display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); border-bottom: 1px solid var(--line); }
.detail-title { min-width: 0; }
.detail-title h2 { margin: 0; font-size: var(--text-xl); overflow-wrap: anywhere; }
.detail-title h2:focus { outline: none; }
.detail-title h2:focus-visible { outline: 3px solid var(--focus-color); outline-offset: 2px; }
.detail-title p { margin: 2px 0 0; color: var(--ink-soft); font-size: var(--text-sm); }
.detail-body { min-height: 0; flex: 1; padding: var(--space-4) var(--space-5) var(--space-6); display: grid; align-content: start; gap: var(--space-4); overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.detail-body .notice { margin: 0; }
.detail-summary { padding: var(--space-3) var(--space-4); display: grid; gap: 4px; border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 2px var(--radius-sm) var(--radius-sm) 2px; background: var(--accent-faint); }
.detail-summary.cancelled { border-left-color: var(--line-strong); background: var(--surface-soft); }
.detail-summary p { margin: 0; }
.detail-when { font-size: var(--text-md); }
.detail-sub { color: var(--muted); font-size: var(--text-sm); }
.detail-status { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.detail-ref { margin-left: auto; color: var(--muted); font-size: var(--text-xs); }
.outcome { padding: var(--space-3) var(--space-4); display: grid; gap: var(--space-2); border: 1px solid var(--now); border-radius: var(--radius-sm); background: var(--now-soft); }
.outcome p { margin: 0; font-size: var(--text-sm); font-weight: var(--weight-strong); }
.quick-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.quick-row :deep(.cancel-trigger) { --button-fg: var(--danger); }
.cancel-box, .move-box { padding: var(--space-4); display: grid; gap: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-soft); }
.cancel-box { border-color: var(--danger-line); background: var(--danger-soft); }
.cancel-box h3, .move-box h3 { margin: 0; font-size: var(--text-md); }
.cancel-box p { margin: 0; font-size: var(--text-sm); }
.cancel-box .field, .move-box .field { margin-bottom: 0; }
.cancel-box textarea { min-height: 64px; }
.detail-section { padding-top: var(--space-4); display: grid; gap: var(--space-2); border-top: 1px solid var(--line); }
.detail-section > h3 { margin: 0; font-size: var(--text-sm); }
.detail-section .field { margin-bottom: 0; }
.detail-section textarea { min-height: 84px; }
.message-text { margin: 0; padding: var(--space-3); max-height: 200px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-soft); font-size: var(--text-sm); line-height: 1.55; }
.kind-row { max-width: 100%; }
.staff-now { margin: 0; display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); font-weight: var(--weight-strong); }
.assign-row { display: flex; align-items: flex-end; flex-wrap: wrap; gap: var(--space-3); }
.assign-row .field { flex: 1 1 200px; min-width: 0; }
.unsaved { color: var(--warning); font-size: var(--text-sm); font-weight: var(--weight-strong); }
@media (min-width: 1201px) { .bookings-page.has-detail { padding-right: 408px; } }
@media (max-width: 1200px) {
  .booking-detail { top: 0; z-index: 71; width: min(440px, 100vw); box-shadow: var(--shadow-3); }
}
@media (max-width: 700px) {
  .booking-detail { top: auto; left: 0; width: 100%; max-height: calc(100dvh - 24px); border-left: 0; border-top: 1px solid var(--line); border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
  .detail-body { padding: var(--space-4) var(--space-4) calc(var(--space-6) + env(safe-area-inset-bottom)); }
  .detail-head { padding-left: var(--space-4); }
}

/* New booking */
.new-booking { max-width: 720px; margin: 0 auto; }
.crumbs { margin-bottom: var(--space-2); display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: var(--text-sm); }
.crumbs .link-button { min-height: 32px; color: var(--accent); text-decoration: none; }
.new-booking h1 { margin: 0; }
.new-booking h1:focus { outline: none; }
.new-booking > .lede { margin-bottom: var(--space-5); }
.new-form { display: grid; gap: var(--space-4); }
.new-group { margin: 0; padding: var(--space-5); display: grid; gap: 0; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); min-width: 0; }
.new-group > legend { padding: 0 var(--space-2); margin-left: calc(var(--space-2) * -1); font-size: var(--text-md); font-weight: var(--weight-strong); }
.new-group > .field-hint { margin: 0 0 var(--space-3); }
.time-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.time-chip {
  min-width: 92px; min-height: 44px; padding: 0 var(--space-3); color: var(--ink); border: 1px solid var(--line-strong); border-left: 4px solid var(--accent);
  border-radius: 2px var(--radius-sm) var(--radius-sm) 2px; background: var(--surface); font-size: var(--text-md); font-weight: var(--weight-strong);
}
.time-chip:hover { background: var(--accent-faint); }
.time-chip[aria-pressed='true'] { color: var(--on-accent); border-color: var(--accent); border-left-color: var(--now); background: var(--accent); }
.time-field { max-width: 320px; }
.new-dock {
  position: sticky; bottom: var(--space-3); z-index: 5; padding: var(--space-3) var(--space-4); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: var(--space-3); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 2px var(--radius) var(--radius) 2px; background: var(--surface); box-shadow: var(--shadow-2);
}
.new-summary { min-width: 0; margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px var(--space-3); font-size: var(--text-sm); }
.new-summary span { color: var(--ink-soft); }
.new-result { display: grid; gap: var(--space-3); }
.skipped { margin: var(--space-1) 0 0; padding-left: 18px; font-size: var(--text-sm); }

@media (max-width: 900px) {
  .new-dock { bottom: calc(var(--bottom-nav-h) + var(--space-2) + env(safe-area-inset-bottom)); }
}
@media (max-width: 700px) {
  .booking-toolbar .field, .booking-toolbar .date-field { flex: 1 1 140px; }
  .booking-toolbar .segmented { width: 100%; }
  .booking-toolbar .segmented button { flex: 1; }
  .week-meta { margin-left: 0; }
  .agenda-open { grid-template-columns: 64px 4px minmax(0, 1fr); padding: var(--space-3); }
  .agenda-flags { grid-column: 3; justify-content: flex-start; }
  .agenda-actions { padding: 0 var(--space-3) var(--space-3) var(--space-3); }
  .new-group { padding: var(--space-4); }
  .new-dock .form-actions { width: 100%; }
  .new-dock .form-actions > * { flex: 1; }
}
</style>
