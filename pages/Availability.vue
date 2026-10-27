<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import WeeklyHoursEditor from '../components/WeeklyHoursEditor.vue'
import IntervalField from '../components/IntervalField.vue'
import GmSelect from '../components/ui/GmSelect.vue'
import GmDatePicker from '../components/ui/GmDatePicker.vue'
import GmTimePicker from '../components/ui/GmTimePicker.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmConfirm from '../components/ui/GmConfirm.vue'
import GmHint from '../components/ui/GmHint.vue'
import {
  createTimeOff,
  hasTeam,
  isActiveTimeOff,
  isOwnerMember,
  isStaffActive,
  isTimeOff,
  ownerStaff,
  removeTimeOff,
  saveSchedule,
  servicesForStaff,
  teamMembers,
} from '../booking.ts'
import { displayName, memberColor, memberFirstName, memberName, scheduleOf } from '../team-ui.ts'
import {
  DAY_NAMES,
  applyScheduleToDays,
  copyDaysInto,
  dayIssues,
  durationWords,
  endMinute,
  intervalFromQuery,
  makeDays,
  minute,
  smallestIntervalFor,
  validWindows,
  weeklyHoursTotal,
  weeklyWindowsFromDays,
  windowsAreSaveable,
} from '../weekly-hours.ts'
import { localFields, wallClockInstant } from '../scheduling.ts'
import { isDemo, registerDemoGuard } from '../runtime.ts'
import { formatDay } from '../format-date.ts'
import { errorMessage } from '../error-message.ts'

import { displayTimeZone, timezoneOptions } from '../time-display.ts'

interface EditorNotice { kind: 'error' | 'info'; text: string }
interface NumericWindow { start: number; end: number }
type WindowsByDay = Record<number, NumericWindow[]>
type TimeOffRange = { start: Date; end: Date } | { error: string }
type RowWithDuration = { duration: number }
type IntervalFieldExpose = { el?: HTMLElement }

const timestampDate = (value: TimestampInput): Date => {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') return new Date(value)
  if (value && 'toDate' in value) return value.toDate()
  if (value && '_seconds' in value) return new Date(value._seconds * 1000)
  return new Date(Number.NaN)
}
const timestampMillis = (value: TimestampInput) => timestampDate(value).getTime()

const timezoneItems = computed(() => timezoneOptions(form.timezone))
const state = inject<WorkspaceState>('bookingState', { profile: null, schedules: [], services: [], bookings: [], contacts: [], staff: [], campaigns: [] })
const refresh = inject<RefreshWorkspace>('refreshBookings', async () => true)
const toast = inject<ToastApi | null>('toast', null)
const router = useRouter()
const route = useRoute()
const saving = ref(false)
const error = ref('')
const availabilityBaseline = ref('')
const persistedScheduleBaseline = ref('')
const leavePrompt = ref(false)
const pendingRoute = ref('')
const allowLeave = ref(false)
const remoteChanged = ref(false)
const names = DAY_NAMES
const timeOffBusy = ref(false)
const pendingRemove = ref<BookingRecord | null>(null)
const days = reactive(makeDays())

// ----- team: whose calendar is being edited -----
// Single-owner installs never see the switcher and edit the owner's schedule exactly as before.
const team = computed(() => hasTeam(state))
const members = computed(() => teamMembers(state, { includeInactive: true }))
const memberOptions = computed(() => members.value.map((member) => ({
  value: String(member.id || ''),
  label: `${memberName(member)}${isStaffActive(member) ? '' : ' (inactive)'}`,
})))
const selectedStaffId = ref('')
const currentMember = computed(() => {
  if (!team.value) return ownerStaff(state)
  return members.value.find((item) => item.id === selectedStaffId.value) || members.value[0] || ownerStaff(state)
})
const currentSchedule = computed(() => scheduleOf(state, currentMember.value))
const isOwnerView = computed(() => !team.value || isOwnerMember(currentMember.value))
const whose = computed(() => (isOwnerView.value ? 'your' : `${memberFirstName(currentMember.value)}'s`))
const pendingMember = ref('')
const form = reactive({
  timezone: 'Africa/Lagos',
  slotIntervalMinutes: 60,
  minimumNoticeMinutes: 60,
  bookingHorizonDays: 60,
})
const browserZone = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' }
})()
const normalizeAvailability = () => JSON.stringify({
  form: { ...form },
  days: days.map(({ weekday, active, windows }) => ({
    weekday,
    active,
    windows: windows.map(({ start, end }) => ({ start, end })),
  })),
})
const dirty = computed(() => normalizeAvailability() !== availabilityBaseline.value)
const syncBaseline = () => { availabilityBaseline.value = normalizeAvailability() }
const removeModeGuard = registerDemoGuard('bookins-availability', () => {
  if (saving.value) return 'Wait for availability to finish saving.'
  if (dirty.value) return 'Finish or discard your unsaved availability before switching modes.'
  if (timeOffBusy.value || pendingRemove.value) return 'Finish the time off change before switching modes.'
  return ''
})
onBeforeUnmount(() => removeModeGuard())

onBeforeRouteLeave((to) => {
  if (saving.value) { error.value = 'Wait for availability to finish saving before leaving.'; return false }
  if (allowLeave.value) {
    allowLeave.value = false
    return true
  }
  if (!dirty.value) return true
  pendingRoute.value = to.fullPath
  leavePrompt.value = true
  return false
})

function discardChanges() {
  if (saving.value) return
  if (!availabilityBaseline.value) return
  const saved = JSON.parse(availabilityBaseline.value) as { form: typeof form; days: EditableDay[] }
  Object.assign(form, saved.form)
  saved.days.forEach((savedDay, index) => {
    const day = days[index]
    if (!day) return
    day.active = savedDay.active
    day.windows = savedDay.windows.map((item) => ({ ...item }))
  })
  leavePrompt.value = false
  const nextRoute = pendingRoute.value
  const nextMember = pendingMember.value
  pendingRoute.value = ''
  pendingMember.value = ''
  if (nextMember) switchMember(nextMember)
  else if (nextRoute) {
    allowLeave.value = true
    router.push(nextRoute)
  }
}

function keepEditing() {
  leavePrompt.value = false
  pendingRoute.value = ''
  pendingMember.value = ''
}

// Switching person with unsaved edits asks first (the confirmation sits by the save bar).
function requestMember(id: string | number | boolean) {
  if (typeof id !== 'string') return
  if (id === currentMember.value?.id || saving.value) return
  if (dirty.value) {
    pendingMember.value = id
    leavePrompt.value = true
    return
  }
  switchMember(id)
}
function switchMember(id: string) {
  selectedStaffId.value = id
  error.value = ''
  overlapResult.value = []
  offError.value = ''
  showPast.value = false
  hydrate()
  router.replace({ path: '/availability', query: id === ownerStaff(state).id ? {} : { staff: id } })
}

const issues = computed(() => dayIssues(days))
const hasIssues = computed(() => Object.values(issues.value).some(Boolean))
const isDraft = computed(() => !isDemo.value && !currentSchedule.value)
const showSaveBar = computed(() => !isDemo.value && (dirty.value || isDraft.value))
const saveBlockReason = computed(() => {
  const bad = days.find((day) => issues.value[day.weekday])
  return bad ? `Fix ${bad.name}: ${issues.value[bad.weekday]}` : ''
})

const activeDays = computed(() => days.filter((day) => day.active).length)
// With a team, only the services this person offers shape their interval and fit analysis.
const activeServices = computed(() =>
  (team.value ? servicesForStaff(state, currentMember.value) : state.services).filter((item) => item.active !== false),
)
const maxServiceDuration = computed(() =>
  Math.max(0, ...activeServices.value.map((item) => Number(item.duration_minutes || 0))),
)
const weeklyHours = computed(() => weeklyHoursTotal(days))

const longestServiceName = computed(() => displayName(activeServices.value.find((item) => Number(item.duration_minutes || 0) === maxServiceDuration.value)?.name || ''))
const noticeOptions = [
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 240, label: '4 hours' },
  { value: 720, label: '12 hours' },
  { value: 1440, label: '1 day' },
]
const horizonOptions = [14, 30, 60, 90, 180].map((value) => ({ value, label: value + ' days' }))

// ----- editing actions -----
const locked = computed(() => isDemo.value || saving.value)

function onEditorNotice(notice: EditorNotice) {
  if (notice.kind === 'error') error.value = notice.text
  else { error.value = ''; toast?.info?.(notice.text) }
}

function useBrowserZone() {
  if (browserZone) form.timezone = browserZone
}

// ----- hydrate from state -----
const FORM_DEFAULTS = { timezone: 'Africa/Lagos', slotIntervalMinutes: 60, minimumNoticeMinutes: 60, bookingHorizonDays: 60 }
const formFromSchedule = (schedule: ScheduleRecord) => ({
  timezone: schedule.timezone || form.timezone,
  slotIntervalMinutes: Number(schedule.slot_interval_minutes),
  minimumNoticeMinutes: Number(schedule.minimum_notice_minutes),
  bookingHorizonDays: Number(schedule.booking_horizon_days),
})
const scheduleFingerprint = (schedule: ScheduleRecord | null | undefined) => {
  if (!schedule) return ''
  let weeklyWindows: string | WeeklyWindow[] = schedule.weekly_windows_json || ''
  try {
    const parsed: unknown = JSON.parse(weeklyWindows)
    if (!Array.isArray(parsed)) return weeklyWindows
    weeklyWindows = parsed
      .filter((item): item is UnknownRecord => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        weekday: Number(item.weekday),
        startMinute: Number(item.startMinute),
        endMinute: Number(item.endMinute),
      }))
      .sort((a: WeeklyWindow, b: WeeklyWindow) => a.weekday - b.weekday || a.startMinute - b.startMinute || a.endMinute - b.endMinute)
  } catch { /* keep malformed persisted data comparable until hydrate reports it */ }
  return JSON.stringify({
    id: schedule.id || '',
    timezone: schedule.timezone || '',
    slotIntervalMinutes: Number(schedule.slot_interval_minutes),
    minimumNoticeMinutes: Number(schedule.minimum_notice_minutes),
    bookingHorizonDays: Number(schedule.booking_horizon_days),
    weeklyWindows,
  })
}
function hydrate() {
  const existing = currentSchedule.value
  remoteChanged.value = false
  persistedScheduleBaseline.value = scheduleFingerprint(existing)
  if (!existing) {
    // No hours saved yet: a team member starts from a copy of the owner's hours (a suggestion until saved).
    const owner = !isOwnerView.value ? scheduleOf(state, ownerStaff(state)) : null
    copyDaysInto(days, makeDays())
    Object.assign(form, FORM_DEFAULTS)
    if (owner) {
      try {
        applyScheduleToDays(days, owner)
        Object.assign(form, formFromSchedule(owner))
      } catch { /* owner hours unreadable: keep the defaults */ }
    }
    syncBaseline()
    return
  }
  Object.assign(form, formFromSchedule(existing))
  try {
    applyScheduleToDays(days, existing)
    error.value = ''
  } catch {
    error.value = 'The saved weekly schedule needs repair. Review each day, then save it again.'
  }
  syncBaseline()
}

selectedStaffId.value = String(route.query.staff || '') || String(ownerStaff(state).id || '')
onMounted(() => {
  hydrate()
  applyIntervalQuery()
})
watch(() => [route.query.interval, route.query.from], () => applyIntervalQuery())

watch(
  () => currentSchedule.value,
  (nextSchedule) => {
    if (saving.value) return
    const nextFingerprint = scheduleFingerprint(nextSchedule)
    if (nextFingerprint === persistedScheduleBaseline.value) return
    persistedScheduleBaseline.value = nextFingerprint
    if (dirty.value) remoteChanged.value = true
    else hydrate()
  },
)

// ----- fit analysis -----
const savedDayWindows = computed(() => {
  const existing = currentSchedule.value
  const map: WindowsByDay = {}
  try {
    const parsed: unknown = JSON.parse(existing?.weekly_windows_json || '[]')
    if (!Array.isArray(parsed)) return map
    for (const candidate of parsed) {
      if (!candidate || typeof candidate !== 'object') continue
      const item = candidate as UnknownRecord
      const weekday = Number(item.weekday)
      ;(map[weekday] ||= []).push({ start: Number(item.startMinute), end: Number(item.endMinute) })
    }
  } catch { /* handled during hydrate */ }
  return map
})

function bookableDays(service: ServiceRecord, windowsByDay: WindowsByDay, interval: number) {
  const duration = Number(service.duration_minutes || 0)
  if (duration > interval) return new Set<number>()
  return new Set<number>(
    Object.entries(windowsByDay)
      .filter(([, list]) => list.some((item) => item.end - item.start >= duration))
      .map(([weekday]) => Number(weekday)),
  )
}
const draftDayWindows = computed(() =>
  Object.fromEntries(days.filter((day) => day.active).map((day) => [day.weekday, validWindows(day)])),
)
const serviceFit = computed(() =>
  activeServices.value.map((service) => {
    const now = bookableDays(service, draftDayWindows.value, form.slotIntervalMinutes)
    const before = currentSchedule.value
      ? bookableDays(service, savedDayWindows.value, Number(currentSchedule.value.slot_interval_minutes))
      : new Set<number>()
    const lost = [...before].filter((weekday) => !now.has(weekday)).sort((left, right) => left - right)
    const duration = Number(service.duration_minutes || 0)
    return {
      id: service.id,
      name: displayName(service.name),
      duration,
      tooLong: duration > form.slotIntervalMinutes,
      days: now.size,
      lost: lost.map((weekday) => names[weekday]?.slice(0, 3) || ''),
    }
  }),
)
const hiddenWarnings = computed(() => serviceFit.value.filter((item) => item.lost.length || (item.days === 0 && activeDays.value > 0)))

const formatterCache = new Map<string, Intl.DateTimeFormat>()
function zonedParts(date: Date, timeZone: string) {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
    formatterCache.set(timeZone, formatter)
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  return {
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday || ''),
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

const bookingsOutside = computed(() => {
  const zone = displayTimeZone(form.timezone)
  const nowMs = Date.now()
  return state.bookings
    .filter((item) => item.status !== 'cancelled' && !isTimeOff(item) && timestampMillis(item.starts_at) > nowMs)
    .filter((item) => !team.value || item.schedule_id === currentSchedule.value?.id)
    .filter((item) => {
      const start = timestampDate(item.starts_at)
      const end = timestampMillis(item.ends_at) > start.getTime() ? timestampDate(item.ends_at) : null
      const length = end ? (end.getTime() - start.getTime()) / 60000 : 0
      const local = zonedParts(start, zone)
      const windows = draftDayWindows.value[local.weekday] || []
      return !windows.some((item2) => local.minute >= item2.start && local.minute + length <= item2.end)
    })
    .sort((left, right) => timestampMillis(left.starts_at) - timestampMillis(right.starts_at))
})
const outsideLabel = (booking: BookingRecord) =>
  `${formatDay(timestampDate(booking.starts_at), displayTimeZone(form.timezone))}, ${timestampDate(booking.starts_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: displayTimeZone(form.timezone) })}`


// ----- time off -----
const scheduleZone = computed(() => currentSchedule.value?.timezone || form.timezone)
const showPast = ref(false)
const timeOffClock = ref(Date.now())
const timeOffTimer = window.setInterval(() => { timeOffClock.value = Date.now() }, 60_000)
onBeforeUnmount(() => window.clearInterval(timeOffTimer))
const scheduleReady = computed(() => Boolean(currentSchedule.value))
const sortedTimeOff = computed(() =>
  state.bookings
    .filter((item) => isActiveTimeOff(item))
    .filter((item) => !team.value || item.schedule_id === currentSchedule.value?.id)
    .sort((left, right) => timestampMillis(left.starts_at) - timestampMillis(right.starts_at)),
)
const upcomingTimeOff = computed(() => sortedTimeOff.value.filter((item) => timestampMillis(item.ends_at) > timeOffClock.value))
const pastTimeOff = computed(() =>
  sortedTimeOff.value.filter((item) => timestampMillis(item.ends_at) <= timeOffClock.value).reverse(),
)
const addDays = (date: string, count: number) => {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + count)).toISOString().slice(0, 10)
}
const todayInZone = () => localFields(Date.now(), scheduleZone.value).date
const offForm = reactive({ allDay: true, startDate: '', endDate: '', startTime: '09:00', endTime: '17:00', reason: '' })
const overlapResult = ref<BookingRecord[]>([])
const offSummary = computed(() => {
  const range = offRange()
  if ('error' in range || !offForm.startDate) return ''
  const day = (iso: string) => formatDay(iso, scheduleZone.value)
  if (!offForm.allDay) return `${day(offForm.startDate)}, ${offForm.startTime} to ${offForm.endTime}`
  const last = offForm.endDate || offForm.startDate
  return last === offForm.startDate ? `${day(offForm.startDate)}, all day` : `${day(offForm.startDate)} to ${day(last)}, all day`
})
const offError = ref('')
function applyPreset(kind: 'today' | 'tomorrow' | 'week') {
  const today = todayInZone()
  offForm.allDay = true
  if (kind === 'today') Object.assign(offForm, { startDate: today, endDate: today })
  else if (kind === 'tomorrow') Object.assign(offForm, { startDate: addDays(today, 1), endDate: addDays(today, 1) })
  else Object.assign(offForm, { startDate: today, endDate: addDays(today, 6) })
}
function instantAt(date: string, minuteOfDay: number) {
  // Skip a nonexistent local time (DST gap) by moving forward an hour.
  return wallClockInstant(date, minuteOfDay, scheduleZone.value) || wallClockInstant(date, Math.min(minuteOfDay + 60, 1439), scheduleZone.value)
}
function offRange(): TimeOffRange {
  if (!offForm.startDate) return { error: 'Choose a date.' }
  if (offForm.allDay) {
    const last = offForm.endDate || offForm.startDate
    if (last < offForm.startDate) return { error: 'The last day cannot be before the first day.' }
    const start = instantAt(offForm.startDate, 0)
    const end = instantAt(addDays(last, 1), 0)
    return start && end ? { start, end } : { error: 'That date could not be converted in your schedule timezone.' }
  }
  const from = minute(offForm.startTime)
  const to = minute(offForm.endTime)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { error: 'Enter a start and an end time.' }
  if (to <= from) return { error: 'The end time must be after the start time.' }
  const start = instantAt(offForm.startDate, from)
  const end = instantAt(offForm.startDate, to)
  return start && end ? { start, end } : { error: 'That time does not exist in your schedule timezone.' }
}
async function addTimeOff() {
  if (isDemo.value || timeOffBusy.value) return
  const range = offRange()
  if ('error' in range) { offError.value = range.error; return }
  const { start, end } = range
  timeOffBusy.value = true
  offError.value = ''
  overlapResult.value = []
  try {
    const result = await createTimeOff(state, {
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      reason: offForm.reason,
      // With a team, time off blocks only this person's calendar.
      ...(team.value ? { staffId: String(currentMember.value.id || '') } : {}),
    })
    overlapResult.value = result?.overlapping || []
    offForm.reason = ''
    if (!(await reloadChecked())) offError.value = 'Time off was added, but Bookins could not reload to confirm. Use Refresh to check.'
    else flash(`Time off added: ${offSummary.value || 'blocked'}. Guests cannot book it.`)
  } catch (reason) {
    offError.value = errorMessage(reason, 'Time off could not be added.')
  } finally {
    timeOffBusy.value = false
  }
}
async function confirmRemove() {
  const record = pendingRemove.value
  if (!record || isDemo.value || timeOffBusy.value) return
  timeOffBusy.value = true
  offError.value = ''
  try {
    await removeTimeOff(record)
    pendingRemove.value = null
    if (!(await reloadChecked())) offError.value = 'Time off was removed, but Bookins could not reload to confirm. Use Refresh to check.'
    else flash('Time off removed. That time is bookable again.')
  } catch (reason) {
    offError.value = errorMessage(reason, 'Time off could not be removed.')
  } finally {
    timeOffBusy.value = false
  }
}
function timeOffLabel(item: BookingRecord) {
  const zone = displayTimeZone(scheduleZone.value)
  const startLocal = localFields(item.starts_at, scheduleZone.value)
  const endLocal = localFields(item.ends_at, scheduleZone.value)
  const day = (iso: string) => formatDay(iso, scheduleZone.value)
  const clock = (instant: TimestampInput) => timestampDate(instant).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: zone })
  if (startLocal.time === '00:00' && endLocal.time === '00:00') {
    const lastDay = addDays(endLocal.date, -1)
    return lastDay <= startLocal.date ? `${day(startLocal.date)}, all day` : `${day(startLocal.date)} to ${day(lastDay)}, all day`
  }
  if (startLocal.date === endLocal.date) return `${day(startLocal.date)}, ${clock(item.starts_at)} to ${clock(item.ends_at)}`
  return `${day(startLocal.date)} ${clock(item.starts_at)} to ${day(endLocal.date)} ${clock(item.ends_at)}`
}
const timeOffReason = (item: BookingRecord) => String(item.notes || (item.guest_name !== 'Time off' ? item.guest_name : '')).trim()

// ----- buffers -----
const bufferRows = computed(() =>
  activeServices.value.map((service) => {
    const duration = Number(service.duration_minutes || 0)
    return { id: service.id, name: displayName(service.name), duration, free: Number(form.slotIntervalMinutes) - duration }
  }),
)

// The side lists show only the longest service when there are many (a 60-service workspace would otherwise make
// this page thousands of pixels tall); every service stays one click away.
const COLLAPSE_OVER = 3
const longestRow = <T extends RowWithDuration>(list: T[]): T | null => list.reduce<T | null>((best, item) => (!best || item.duration > best.duration ? item : best), null)
const bufferShown = computed(() => (bufferRows.value.length > COLLAPSE_OVER ? [longestRow(bufferRows.value)].filter((row): row is (typeof bufferRows.value)[number] => Boolean(row)) : bufferRows.value))
const fitShown = computed(() => (serviceFit.value.length > COLLAPSE_OVER ? [longestRow(serviceFit.value)].filter((row): row is (typeof serviceFit.value)[number] => Boolean(row)) : serviceFit.value))
const fitProblems = computed(() => serviceFit.value.filter((item) => item.tooLong || (item.days === 0 && activeDays.value > 0)).length)
const WARNING_LIMIT = 5
// A saved schedule whose interval is being changed: every service on it gets new start times.
const intervalChange = computed(() => {
  const saved = Number(currentSchedule.value?.slot_interval_minutes || 0)
  const next = Number(form.slotIntervalMinutes)
  return saved && next !== saved ? { from: saved, to: next } : null
})

// ----- "Fix interval in Availability" (?interval=240 from Services or the CSV import) -----
const highlightInterval = ref(false)
const intervalField = ref<IntervalFieldExpose | null>(null)
const returnToImport = ref(false)
let highlightTimer = 0
onBeforeUnmount(() => window.clearTimeout(highlightTimer))
function applyIntervalQuery() {
  const wanted = intervalFromQuery(route.query.interval)
  const from = String(route.query.from || '')
  if (!wanted && !from) return
  const { interval: _interval, from: _from, ...rest } = route.query
  router.replace({ path: route.path, query: rest })
  if (from === 'import') returnToImport.value = true
  if (!wanted || isDemo.value) return
  const need = smallestIntervalFor(Math.max(wanted, maxServiceDuration.value))
  if (!need) return
  if (Number(form.slotIntervalMinutes) >= need) {
    toast?.info?.(`Your interval is already ${form.slotIntervalMinutes} minutes (${durationWords(form.slotIntervalMinutes)}), which fits a ${wanted}-minute service.`)
    return
  }
  form.slotIntervalMinutes = need
  highlightInterval.value = true
  window.clearTimeout(highlightTimer)
  highlightTimer = window.setTimeout(() => { highlightInterval.value = false }, 6000)
  nextTick(() => intervalField.value?.el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }))
  toast?.(`Interval set to ${need} minutes (${durationWords(need)}) so a ${wanted}-minute service fits. Press Save availability to apply it. Every service on this schedule will then start only every ${need} minutes.`, { kind: 'info', duration: 9000 })
}

// ----- save -----
function flash(message: string, options?: ToastOptions) {
  toast?.(message, options)
}
const hasActiveService = computed(() => activeServices.value.length > 0)
const needsFirstService = computed(() => scheduleReady.value && !dirty.value && !hasActiveService.value && !isDemo.value)

async function reloadChecked() {
  return (await refresh()) === true
}

async function submit() {
  if (isDemo.value || saving.value) return
  const weeklyWindows = weeklyWindowsFromDays(days)
  if (!weeklyWindows.length) {
    error.value = 'Open at least one day so guests can find a time.'
    return
  }
  if (hasIssues.value || !windowsAreSaveable(weeklyWindows)) {
    error.value = 'Fix the highlighted days before saving.'
    return
  }
  if (maxServiceDuration.value > form.slotIntervalMinutes) {
    error.value = `Your longest active service is ${maxServiceDuration.value} minutes. Choose an interval of at least ${maxServiceDuration.value} minutes or pause that service first.`
    return
  }
  saving.value = true
  error.value = ''
  try {
    await saveSchedule(
      currentSchedule.value,
      { name: isOwnerView.value ? 'Working hours' : currentSchedule.value?.name || `${currentMember.value.name || 'Team member'} hours`, ...form, weeklyWindows },
      team.value ? currentMember.value : null,
    )
  } catch (reason) {
    error.value = errorMessage(reason, 'Availability could not be saved.')
    toast?.error?.(error.value)
    saving.value = false
    return
  }
  try {
    if (await reloadChecked()) {
      hydrate()
      if (returnToImport.value) {
        returnToImport.value = false
        flash(`Availability saved. Your interval is now ${form.slotIntervalMinutes} minutes.`, { duration: 12000, action: { label: 'Continue your import', onClick: () => router.push({ path: '/services', query: { import: '1' } }) } })
      } else if (!isOwnerView.value) flash(`Hours saved for ${memberFirstName(currentMember.value)}. Their calendar is separate from yours.`)
      else if (hasActiveService.value) flash('Availability saved. Guests can now book these hours.')
      else flash('Availability saved', { duration: 9000, action: { label: 'Create your first service', onClick: () => router.push('/services') } })
    } else {
      syncBaseline()
      error.value = 'Availability was saved, but Bookins could not reload it to confirm. Use Refresh to check the stored version.'
    }
  } catch (reason) {
    syncBaseline()
    error.value = errorMessage(reason, 'Availability was saved, but the workspace could not be reloaded.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="availability">
    <header class="page-header">
      <div>
        <h1>Availability</h1>
        <p class="lede">{{ team ? 'Each person has their own hours, rules and time off.' : 'The hours guests can book, your booking rules, and days off.' }}</p>
      </div>
      <div v-if="team" class="member-switch" data-tour="tour-availability-member">
        <label for="availability-member">Whose hours</label>
        <GmSelect id="availability-member" :model-value="currentMember.id" :options="memberOptions" label="Whose hours" :disabled="saving" @update:model-value="requestMember" />
        <RouterLink class="text-link" to="/team">Manage team</RouterLink>
      </div>
    </header>

    <div v-if="isDemo" class="notice info" role="status"><AppIcon name="info" :size="18" /><span>Sample hours. Switch to Live to change your own.</span></div>
    <div v-if="isDraft" class="notice warning" role="status">
      <AppIcon name="info" :size="18" />
      <span v-if="isOwnerView"><strong>Not saved yet.</strong> These hours are a suggestion. Guests cannot book you until you save them.</span>
      <span v-else><strong>{{ currentMember.name }} has no hours saved yet.</strong> These are a copy of yours as a starting point. They cannot be booked or assigned bookings until you save.</span>
    </div>
    <div v-else-if="needsFirstService" class="notice success" role="status">
      <AppIcon name="check" :size="18" />
      <span><strong>Hours saved.</strong> Next, add a service so guests have something to book.</span>
      <RouterLink class="primary small notice-action" to="/services">Add your first service</RouterLink>
    </div>
    <div v-if="error" class="notice error" role="alert"><AppIcon name="alert" :size="18" /><span>{{ error }}</span></div>
    <div v-if="!isDemo && remoteChanged" class="notice warning" role="status">
      <AppIcon name="info" :size="18" />
      <span>A newer saved version was loaded from your workspace. Your unsaved edits are still shown.</span>
      <button class="secondary small notice-action" type="button" :disabled="saving" @click="hydrate">Load saved version</button>
    </div>

    <div class="availability-layout">
      <section class="panel hours-panel" aria-labelledby="hours-title" data-tour="tour-availability-hours">
        <div class="panel-head">
          <div>
            <h2 id="hours-title">{{ isOwnerView ? 'Weekly hours' : `${memberFirstName(currentMember)}'s weekly hours` }}</h2>
            <p class="panel-sub tnum">{{ activeDays }} {{ activeDays === 1 ? 'day' : 'days' }} open, {{ weeklyHours }} hours a week</p>
          </div>
          <span class="save-state" :class="{ unsaved: isDraft || (dirty && !isDemo) }">{{ isDemo ? 'Sample' : isDraft ? 'Not saved' : dirty ? 'Unsaved changes' : 'Saved' }}</span>
        </div>
        <WeeklyHoursEditor :days="days" :disabled="locked" :color="team ? memberColor(currentMember) : ''" @notice="onEditorNotice" />
      </section>

      <div class="availability-side">
        <section class="panel" aria-labelledby="rules-title">
          <div class="panel-head"><h2 id="rules-title">Booking rules</h2></div>
          <div class="panel-body rules">
            <div class="field">
              <label for="availability-timezone">Time zone <GmHint text="Your hours and time off are read in this time zone; guests see times converted to theirs. Pick the city where you work." label="About time zone" /></label>
              <GmSelect id="availability-timezone" v-model="form.timezone" :options="timezoneItems" label="Time zone" :disabled="isDemo || saving" required searchable search-placeholder="Search by city" described-by="availability-timezone-help" />
              <p id="availability-timezone-help" class="field-hint">
                The time zone your hours are in.
                <button v-if="browserZone && browserZone !== form.timezone" class="link-button" type="button" :disabled="locked" @click="useBrowserZone">Use this device's ({{ browserZone }})</button>
              </p>
            </div>
            <IntervalField
              id="slot-interval"
              ref="intervalField"
              v-model="form.slotIntervalMinutes"
              :max-duration="maxServiceDuration"
              :longest-name="longestServiceName"
              :disabled="isDemo || saving"
              :highlight="highlightInterval"
              :team="team"
              :who="isOwnerView ? 'your' : `${memberFirstName(currentMember)}'s`"
            >
              <div v-if="bufferRows.length" class="buffer-note">
                <ul>
                  <li v-for="row in bufferShown" :key="row.id">
                    <strong>{{ row.name }}</strong>: {{ row.duration }} min<template v-if="row.free > 0">, then {{ row.free }} min free</template><template v-else-if="row.free < 0"> (longer than the interval)</template>
                  </li>
                </ul>
                <details v-if="bufferRows.length > COLLAPSE_OVER" class="see-all">
                  <summary>All {{ bufferRows.length }} services</summary>
                  <ul>
                    <li v-for="row in bufferRows" :key="row.id"><strong>{{ row.name }}</strong>: {{ row.duration }} min<template v-if="row.free > 0">, then {{ row.free }} min free</template><template v-else-if="row.free < 0"> (longer than the interval)</template></li>
                  </ul>
                </details>
              </div>
            </IntervalField>
            <div class="field-row">
              <div class="field">
                <label for="minimum-notice">Shortest notice</label>
                <GmSelect id="minimum-notice" v-model="form.minimumNoticeMinutes" :options="noticeOptions" label="Shortest notice" :disabled="isDemo || saving" />
                <p class="field-hint">Guests cannot book closer to the start than this.</p>
              </div>
              <div class="field">
                <label for="booking-horizon">Furthest ahead</label>
                <GmSelect id="booking-horizon" v-model="form.bookingHorizonDays" :options="horizonOptions" label="How far ahead guests can book" :disabled="isDemo || saving" />
                <p class="field-hint">Later days are hidden from guests.</p>
              </div>
            </div>
            <div v-if="serviceFit.length" class="fit-list">
              <p class="fit-title">{{ team ? `${isOwnerView ? 'Your' : memberFirstName(currentMember) + '\'s'} services with these rules` : 'Your services with these rules' }}</p>
              <ul>
                <li v-for="item in fitShown" :key="item.id">
                  <span>{{ item.name }} <small>{{ item.duration }} min</small></span>
                  <strong :class="item.tooLong || (item.days === 0 && activeDays) ? 'bad' : 'ok'">{{ item.tooLong ? 'Longer than the interval' : item.days === 0 ? 'No range fits' : `Bookable ${item.days} ${item.days === 1 ? 'day' : 'days'}` }}</strong>
                </li>
              </ul>
              <p v-if="serviceFit.length > COLLAPSE_OVER" class="list-count">The longest of {{ serviceFit.length }} services<template v-if="fitProblems">; {{ fitProblems }} {{ fitProblems === 1 ? 'does' : 'do' }} not fit</template>.</p>
              <details v-if="serviceFit.length > COLLAPSE_OVER" class="see-all">
                <summary>All {{ serviceFit.length }} services</summary>
                <ul>
                  <li v-for="item in serviceFit" :key="item.id">
                    <span>{{ item.name }} <small>{{ item.duration }} min</small></span>
                    <strong :class="item.tooLong || (item.days === 0 && activeDays) ? 'bad' : 'ok'">{{ item.tooLong ? 'Longer than the interval' : item.days === 0 ? 'No range fits' : `Bookable ${item.days} ${item.days === 1 ? 'day' : 'days'}` }}</strong>
                  </li>
                </ul>
              </details>
            </div>
            <div v-if="intervalChange" class="notice info" role="status">
              <AppIcon name="info" :size="18" />
              <div><strong>Start times change for every service</strong><p>Guests can start every {{ intervalChange.to }} minutes instead of every {{ intervalChange.from }}{{ team && !isOwnerView ? ` on ${memberFirstName(currentMember)}'s calendar` : '' }}. Existing bookings are not moved.</p></div>
            </div>
            <div v-if="hiddenWarnings.length" class="notice warning" role="status">
              <AppIcon name="alert" :size="18" />
              <div><strong>This change would hide services</strong>
                <ul>
                  <li v-for="item in hiddenWarnings.slice(0, WARNING_LIMIT)" :key="item.id">{{ item.name }}<template v-if="item.lost.length"> on {{ item.lost.join(', ') }}</template><template v-else> on every day</template></li>
                  <li v-if="hiddenWarnings.length > WARNING_LIMIT">and {{ hiddenWarnings.length - WARNING_LIMIT }} more</li>
                </ul></div>
            </div>
            <div v-if="bookingsOutside.length" class="notice warning" role="status">
              <AppIcon name="alert" :size="18" />
              <div><strong>{{ bookingsOutside.length }} upcoming {{ bookingsOutside.length === 1 ? 'booking falls' : 'bookings fall' }} outside these hours</strong>
                <p>They stay booked; saving does not move or cancel them. Times in {{ displayTimeZone(form.timezone) }}.</p>
                <ul>
                  <li v-for="item in bookingsOutside.slice(0, 5)" :key="item.id">{{ item.guest_name }}, {{ outsideLabel(item) }}</li>
                  <li v-if="bookingsOutside.length > 5">and {{ bookingsOutside.length - 5 }} more</li>
                </ul></div>
            </div>
            <p class="rule-note">{{ team ? 'Each person has their own calendar: one person cannot be double-booked, but two people can be booked at once.' : 'All your services share these hours, so two bookings can never take the same time.' }}</p>
          </div>
        </section>

        <section class="panel" aria-labelledby="timeoff-title" data-tour="tour-availability-timeoff">
          <div class="panel-head"><h2 id="timeoff-title">Time off</h2></div>
          <div class="panel-body timeoff">
            <p v-if="!scheduleReady" class="muted">Save {{ whose }} weekly hours first, then you can block time off.</p>
            <template v-else>
              <div class="timeoff-list">
                <p v-if="!upcomingTimeOff.length" class="muted">No time off coming up.</p>
                <ul v-else>
                  <li v-for="item in upcomingTimeOff" :key="item.id">
                    <span class="off-mark" aria-hidden="true" />
                    <span class="off-text"><strong>{{ timeOffLabel(item) }}</strong><small v-if="timeOffReason(item)">{{ timeOffReason(item) }}</small></span>
                    <GmConfirm
                      :open="pendingRemove?.id === item.id"
                      title="Remove this time off?"
                      :message="`${timeOffLabel(item)} becomes bookable again.`"
                      confirm-label="Remove time off"
                      cancel-label="Keep it"
                      tone="danger"
                      :busy="timeOffBusy"
                      @update:open="(open) => { if (open) pendingRemove = item; else if (!timeOffBusy) pendingRemove = null }"
                      @confirm="pendingRemove = item; confirmRemove()"
                    >
                      <GmHint wrap text="Demo is read-only. Exit Demo to remove time off." :disabled="!isDemo" v-slot="{ describedby }">
                        <button class="ghost small" type="button" :disabled="timeOffBusy" :aria-disabled="isDemo || undefined" :aria-describedby="isDemo ? describedby : undefined" :aria-label="`Remove time off ${timeOffLabel(item)}`" @click="isDemo ? null : (pendingRemove = item)">Remove</button>
                      </GmHint>
                    </GmConfirm>
                  </li>
                </ul>
                <button v-if="pastTimeOff.length" class="link-button" type="button" :aria-expanded="showPast" @click="showPast = !showPast">{{ showPast ? 'Hide past' : `Show past (${pastTimeOff.length})` }}</button>
                <ul v-if="showPast" class="past">
                  <li v-for="item in pastTimeOff" :key="item.id"><span class="off-mark" aria-hidden="true" /><span class="off-text"><strong>{{ timeOffLabel(item) }}</strong><small v-if="timeOffReason(item)">{{ timeOffReason(item) }}</small></span></li>
                </ul>
              </div>
              <form class="timeoff-form" @submit.prevent="addTimeOff">
                <h3>Block time</h3>
                <div class="preset-row" role="group" aria-label="Quick choices">
                  <button class="secondary small" type="button" :disabled="isDemo || timeOffBusy" @click="applyPreset('today')">Today</button>
                  <button class="secondary small" type="button" :disabled="isDemo || timeOffBusy" @click="applyPreset('tomorrow')">Tomorrow</button>
                  <button class="secondary small" type="button" :disabled="isDemo || timeOffBusy" @click="applyPreset('week')">Next 7 days</button>
                </div>
                <label class="inline-check"><input v-model="offForm.allDay" type="checkbox" :disabled="isDemo || timeOffBusy" />All day</label>
                <div v-if="offForm.allDay" class="field-row">
                  <div class="field"><label for="off-start">First day</label><GmDatePicker id="off-start" v-model="offForm.startDate" label="First day" required :disabled="isDemo || timeOffBusy" /></div>
                  <div class="field"><label for="off-end">Last day</label><GmDatePicker id="off-end" v-model="offForm.endDate" label="Last day, included" :min="offForm.startDate" :disabled="isDemo || timeOffBusy" /></div>
                </div>
                <div v-else class="field-row">
                  <div class="field"><label for="off-date">Day</label><GmDatePicker id="off-date" v-model="offForm.startDate" label="Time off day" required :disabled="isDemo || timeOffBusy" /></div>
                  <div class="field"><label for="off-from">From</label><GmTimePicker id="off-from" v-model="offForm.startTime" label="Time off starts" :step="300" required :disabled="isDemo || timeOffBusy" /></div>
                  <div class="field"><label for="off-to">To</label><GmTimePicker id="off-to" v-model="offForm.endTime" label="Time off ends" :step="300" required :disabled="isDemo || timeOffBusy" /></div>
                </div>
                <div class="field"><label for="off-reason">Reason <span class="optional">(only you see it)</span></label><input id="off-reason" v-model="offForm.reason" maxlength="160" placeholder="Holiday, training, errand" :disabled="isDemo || timeOffBusy" /></div>
                <p v-if="offSummary" class="field-hint" aria-live="polite">Blocks <strong>{{ offSummary }}</strong> in {{ displayTimeZone(scheduleZone) }}.</p>
                <GmButton type="submit" variant="primary" :pending="timeOffBusy" pending-label="Saving…" :disabled-reason="isDemo ? 'Demo is read-only.' : !offForm.startDate ? 'Choose a first day, or tap Today, Tomorrow or Next 7 days.' : ''" reason-visible>Block this time</GmButton>
              </form>
            </template>
            <p v-if="offError" class="notice error" role="alert">{{ offError }}</p>
            <div v-if="overlapResult.length" class="notice warning" role="status">
              <AppIcon name="alert" :size="18" />
              <div><strong>{{ overlapResult.length }} existing {{ overlapResult.length === 1 ? 'booking is' : 'bookings are' }} inside this time off</strong>
                <p>They still stand. <RouterLink to="/bookings">Open Bookings</RouterLink> to move or cancel them and let the clients know.</p>
                <ul><li v-for="item in overlapResult" :key="item.id">{{ item.guest_name }}, {{ timeOffLabel(item) }}</li></ul></div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <div v-if="showSaveBar" class="sticky-save-bar" role="region" aria-label="Unsaved availability" data-tour="tour-availability-save">
      <span>{{ isDraft && !dirty ? 'Not saved yet: save your hours so guests can book.' : isDraft ? 'Draft with edits, not saved yet.' : 'You have unsaved changes.' }}</span>
      <div class="cluster">
        <GmConfirm
          v-model:open="leavePrompt"
          :title="pendingRoute ? 'Leave without saving?' : pendingMember ? 'Switch without saving?' : 'Discard your changes?'"
          :message="pendingRoute ? 'Your availability changes have not been saved and will be lost.' : pendingMember ? `Your unsaved changes to ${whose} hours will be lost.` : 'Your hours go back to the last saved version.'"
          :confirm-label="pendingRoute ? 'Leave without saving' : pendingMember ? 'Switch and discard' : 'Discard changes'"
          cancel-label="Keep editing"
          tone="danger"
          :busy="saving"
          @confirm="discardChanges"
          @cancel="keepEditing"
        >
          <button v-if="dirty" class="ghost" type="button" :disabled="saving" @click="leavePrompt = true">Discard</button>
        </GmConfirm>
        <GmButton variant="primary" :pending="saving" pending-label="Saving…" :disabled-reason="saveBlockReason" @click="submit">Save availability</GmButton>
      </div>
      <span v-if="saveBlockReason" class="field-hint save-reason" role="alert">{{ saveBlockReason }}</span>
    </div>
  </section>
</template>

<style scoped>
.availability { min-width: 0; }
.member-switch { display: grid; grid-template-columns: auto minmax(200px, 280px) auto; align-items: center; gap: var(--space-2) var(--space-3); }
.member-switch label { color: var(--ink-soft); font-size: var(--text-sm); font-weight: var(--weight-strong); }
.notice-action { margin-left: auto; flex: none; }
.availability-layout { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(320px, 1fr); gap: var(--space-4); align-items: start; }
.availability-side { display: grid; gap: var(--space-4); min-width: 0; }
.hours-panel { min-width: 0; overflow: hidden; }
.hours-panel .panel-head { border-bottom: 0; }
.panel-sub { margin: 2px 0 0; color: var(--muted); font-size: var(--text-sm); }
.save-state { color: var(--success); font-size: var(--text-sm); font-weight: var(--weight-strong); }
.save-state.unsaved { color: var(--warning); }
.rules { display: grid; gap: var(--space-2); }
.rules .field { margin-bottom: var(--space-2); }
.rules .notice { margin: 0; }
.rules .notice p { margin: 4px 0 0; }
.rules .notice ul { margin: 6px 0 0; padding-left: 18px; }
.buffer-note { margin-top: var(--space-2); color: var(--ink-soft); font-size: var(--text-xs); line-height: 1.5; }
.buffer-note ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
.buffer-note strong { color: var(--ink); font-weight: var(--weight-strong); }
.see-all { margin-top: 6px; font-size: var(--text-xs); }
.see-all summary { min-height: 32px; display: flex; align-items: center; color: var(--accent); cursor: pointer; font-weight: var(--weight-strong); }
.see-all ul { max-height: 240px; margin: 4px 0 0; padding: 0; overflow: auto; list-style: none; display: grid; gap: 4px; }
.fit-list { padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-soft); }
.fit-title { margin: 0 0 var(--space-2); font-size: var(--text-sm); font-weight: var(--weight-strong); }
.fit-list > ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.fit-list li { display: flex; justify-content: space-between; gap: 10px; font-size: var(--text-sm); }
.fit-list small { color: var(--muted); font-size: var(--text-xs); }
.fit-list .ok { color: var(--success); font-size: var(--text-xs); }
.fit-list .bad { color: var(--warning); font-size: var(--text-xs); }
.list-count { margin: 6px 0 0; color: var(--muted); font-size: var(--text-xs); }
.rule-note { margin: 0; padding-top: var(--space-2); color: var(--ink-soft); border-top: 1px solid var(--line); font-size: var(--text-sm); }
.timeoff { display: grid; gap: var(--space-4); }
.timeoff .notice { margin: 0; }
.timeoff-list ul { margin: 0 0 var(--space-2); padding: 0; list-style: none; display: grid; gap: var(--space-2); }
.timeoff-list li { padding: var(--space-2) var(--space-3); display: flex; align-items: center; gap: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: var(--text-sm); }
.timeoff-list .muted { margin: 0; font-size: var(--text-sm); }
.off-mark { width: 14px; height: 28px; flex: none; border: 1px dashed var(--line-strong); border-radius: 2px; background: repeating-linear-gradient(135deg, var(--surface-sunken) 0 4px, var(--surface) 4px 8px); }
.off-text { min-width: 0; flex: 1; display: grid; gap: 2px; }
.off-text small { color: var(--muted); font-size: var(--text-xs); }
.timeoff-list .past { opacity: 0.7; }
.timeoff-form { padding: var(--space-3); display: grid; gap: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-soft); }
.timeoff-form h3 { margin: 0; font-size: var(--text-sm); }
.timeoff-form .field { margin-bottom: 0; }
.preset-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.save-reason { flex-basis: 100%; margin: 0; color: var(--danger); text-align: right; }

@media (max-width: 1100px) {
  .availability-layout { grid-template-columns: 1fr; }
}
@media (max-width: 700px) {
  .member-switch { width: 100%; grid-template-columns: 1fr; }
  .notice { flex-wrap: wrap; }
  .notice-action { margin-left: 0; }
  .save-reason { text-align: left; }
}
</style>
