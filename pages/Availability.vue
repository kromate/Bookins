<script setup>
import { computed, inject, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import GmSelect from '../components/ui/GmSelect.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmConfirm from '../components/ui/GmConfirm.vue'
import GmHint from '../components/ui/GmHint.vue'
import { createTimeOff, isActiveTimeOff, isTimeOff, removeTimeOff, saveSchedule } from '../booking.js'
import { localFields, wallClockInstant } from '../scheduling.js'
import { isDemo, registerDemoGuard } from '../runtime.js'
import { formatDay } from '../format-date.js'

import { displayTimeZone, timezoneOptions } from '../time-display.js'

const timezoneItems = computed(() => timezoneOptions(form.timezone))
const state = inject('bookingState')
const refresh = inject('refreshBookings')
const toast = inject('toast', null)
const router = useRouter()
const saving = ref(false)
const error = ref('')
const availabilityBaseline = ref('')
const leavePrompt = ref(false)
const pendingRoute = ref('')
const allowLeave = ref(false)
const remoteChanged = ref(false)
const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const defaultWindow = () => ({ start: '09:00', end: '17:00' })
const timeOffBusy = ref(false)
const pendingRemove = ref(null)
const days = reactive(
  names.map((name, weekday) => ({
    name,
    weekday,
    active: weekday > 0 && weekday < 6,
    windows: [defaultWindow()],
  })),
)
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
  const saved = JSON.parse(availabilityBaseline.value)
  Object.assign(form, saved.form)
  saved.days.forEach((savedDay, index) => {
    days[index].active = savedDay.active
    days[index].windows = savedDay.windows.map((item) => ({ ...item }))
  })
  leavePrompt.value = false
  const route = pendingRoute.value
  pendingRoute.value = ''
  if (route) {
    allowLeave.value = true
    router.push(route)
  }
}

function keepEditing() {
  leavePrompt.value = false
  pendingRoute.value = ''
}

// ----- time helpers -----
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/
function minute(value) {
  const match = TIME_PATTERN.exec(String(value ?? ''))
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN
}

// A 23:59 end means end of day, so a slot that runs until midnight still fits.
function endMinute(value) {
  const parsed = minute(value)
  return parsed === 1439 ? 1440 : parsed
}

function time(value) {
  const bounded = Math.min(1439, Math.max(0, Number(value) || 0))
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`
}

const cloneWindows = (windows) => windows.map((item) => ({ start: item.start, end: item.end }))

// ----- validation (inline; mirrors what the hosted engine requires) -----
function dayIssue(day) {
  if (!day.active) return ''
  const parsed = day.windows.map((item) => ({ start: minute(item.start), end: endMinute(item.end) }))
  if (parsed.some((item) => !Number.isFinite(item.start) || !Number.isFinite(item.end)))
    return 'Enter both a start and an end time for every window.'
  if (parsed.some((item) => item.start >= item.end))
    return 'Each window needs an end time after its start time.'
  const sorted = [...parsed].sort((left, right) => left.start - right.start)
  for (let index = 1; index < sorted.length; index += 1)
    if (sorted[index].start < sorted[index - 1].end)
      return 'Windows on the same day cannot overlap.'
  return ''
}
const issues = computed(() => Object.fromEntries(days.map((day) => [day.weekday, dayIssue(day)])))
const hasIssues = computed(() => Object.values(issues.value).some(Boolean))
const isDraft = computed(() => !isDemo.value && !state.schedules.length)
const showSaveBar = computed(() => !isDemo.value && (dirty.value || isDraft.value))
const saveBlockReason = computed(() => {
  const bad = days.find((day) => issues.value[day.weekday])
  return bad ? `Fix ${bad.name}: ${issues.value[bad.weekday]}` : ''
})

function validWindows(day) {
  return day.windows
    .map((item) => ({ start: minute(item.start), end: endMinute(item.end) }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.start < item.end)
}

const activeDays = computed(() => days.filter((day) => day.active).length)
const activeServices = computed(() => state.services.filter((item) => item.active !== false))
const maxServiceDuration = computed(() =>
  Math.max(0, ...activeServices.value.map((item) => Number(item.duration_minutes || 0))),
)
const weeklyHours = computed(() => {
  const total = days.reduce(
    (sum, day) =>
      day.active ? sum + validWindows(day).reduce((inner, item) => inner + item.end - item.start, 0) / 60 : sum,
    0,
  )
  return Math.round(total * 10) / 10
})

const intervalOptions = computed(() =>
  [15, 30, 45, 60, 90, 120].map((value) => ({
    value,
    label: 'Every ' + value + ' minutes' + (maxServiceDuration.value > value ? ' (too short for a service)' : ''),
    disabled: maxServiceDuration.value > value,
  })),
)
const longestServiceName = computed(() => activeServices.value.find((item) => Number(item.duration_minutes || 0) === maxServiceDuration.value)?.name || '')
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

function addWindow(day) {
  const last = [...day.windows].map((item) => endMinute(item.end)).filter(Number.isFinite).sort((a, b) => a - b).pop()
  const start = Number.isFinite(last) ? last + 60 : 9 * 60
  if (start >= 23 * 60) {
    error.value = `There is no room left after ${day.windows.at(-1)?.end || 'the last window'} on ${day.name}.`
    return
  }
  error.value = ''
  day.windows.push({ start: time(start), end: time(Math.min(start + 120, 1439)) })
}

function removeWindow(day, index) {
  if (day.windows.length <= 1) return
  day.windows.splice(index, 1)
}

function copyDayToWeekdays(source) {
  if (isDemo.value || saving.value) return
  for (const day of days.slice(1, 6)) {
    if (day === source) continue
    day.active = source.active
    day.windows = cloneWindows(source.windows)
  }
  toast?.info(`Copied ${source.name}'s hours to Monday to Friday. Save to keep them.`)
}

function useBrowserZone() {
  if (browserZone) form.timezone = browserZone
}

// ----- hydrate from state -----
function hydrate() {
  const existing = state.schedules[0]
  remoteChanged.value = false
  if (!existing) {
    syncBaseline()
    return
  }
  Object.assign(form, {
    timezone: existing.timezone || form.timezone,
    slotIntervalMinutes: Number(existing.slot_interval_minutes),
    minimumNoticeMinutes: Number(existing.minimum_notice_minutes),
    bookingHorizonDays: Number(existing.booking_horizon_days),
  })
  try {
    const windows = JSON.parse(existing.weekly_windows_json)
    if (!Array.isArray(windows)) throw new Error('not an array')
    error.value = ''
    days.forEach((day) => {
      const own = windows
        .filter((item) => item.weekday === day.weekday)
        .sort((left, right) => left.startMinute - right.startMinute)
      day.active = own.length > 0
      day.windows = own.length
        ? own.map((item) => ({ start: time(item.startMinute), end: time(item.endMinute) }))
        : [defaultWindow()]
    })
  } catch {
    error.value = 'The saved weekly schedule needs repair. Review each day, then save it again.'
  }
  syncBaseline()
}

onMounted(hydrate)

watch(
  () => state.schedules[0],
  () => {
    if (saving.value) return
    if (dirty.value) remoteChanged.value = true
    else hydrate()
  },
)

// ----- fit analysis -----
const savedDayWindows = computed(() => {
  const existing = state.schedules[0]
  const map = {}
  try {
    for (const item of JSON.parse(existing?.weekly_windows_json || '[]')) {
      ;(map[item.weekday] ||= []).push({ start: Number(item.startMinute), end: Number(item.endMinute) })
    }
  } catch { /* handled during hydrate */ }
  return map
})

function bookableDays(service, windowsByDay, interval) {
  const duration = Number(service.duration_minutes || 0)
  if (duration > interval) return new Set()
  return new Set(
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
    const before = state.schedules[0]
      ? bookableDays(service, savedDayWindows.value, Number(state.schedules[0].slot_interval_minutes))
      : new Set()
    const lost = [...before].filter((weekday) => !now.has(weekday)).sort()
    const duration = Number(service.duration_minutes || 0)
    return {
      id: service.id,
      name: service.name,
      duration,
      tooLong: duration > form.slotIntervalMinutes,
      days: now.size,
      lost: lost.map((weekday) => names[weekday].slice(0, 3)),
    }
  }),
)
const hiddenWarnings = computed(() => serviceFit.value.filter((item) => item.lost.length || (item.days === 0 && activeDays.value > 0)))

const formatterCache = new Map()
function zonedParts(date, timeZone) {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
    formatterCache.set(timeZone, formatter)
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  return {
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

const bookingsOutside = computed(() => {
  const zone = displayTimeZone(form.timezone)
  const nowMs = Date.now()
  return state.bookings
    .filter((item) => item.status !== 'cancelled' && !isTimeOff(item) && Date.parse(item.starts_at) > nowMs)
    .filter((item) => {
      const start = new Date(item.starts_at)
      const end = Date.parse(item.ends_at) > start.getTime() ? new Date(item.ends_at) : null
      const length = end ? (end.getTime() - start.getTime()) / 60000 : 0
      const local = zonedParts(start, zone)
      const windows = draftDayWindows.value[local.weekday] || []
      return !windows.some((item2) => local.minute >= item2.start && local.minute + length <= item2.end)
    })
    .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at))
})
const outsideLabel = (booking) =>
  `${formatDay(booking.starts_at, displayTimeZone(form.timezone))}, ${new Date(booking.starts_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: displayTimeZone(form.timezone) })}`


// ----- time off -----
const scheduleZone = computed(() => state.schedules[0]?.timezone || form.timezone)
const showPast = ref(false)
const timeOffClock = ref(Date.now())
const timeOffTimer = window.setInterval(() => { timeOffClock.value = Date.now() }, 60_000)
onBeforeUnmount(() => window.clearInterval(timeOffTimer))
const scheduleReady = computed(() => state.schedules.length > 0)
const sortedTimeOff = computed(() =>
  state.bookings
    .filter((item) => isActiveTimeOff(item))
    .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at)),
)
const upcomingTimeOff = computed(() => sortedTimeOff.value.filter((item) => Date.parse(item.ends_at) > timeOffClock.value))
const pastTimeOff = computed(() =>
  sortedTimeOff.value.filter((item) => Date.parse(item.ends_at) <= timeOffClock.value).reverse(),
)
const addDays = (date, count) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + count)).toISOString().slice(0, 10)
}
const todayInZone = () => localFields(Date.now(), scheduleZone.value).date
const offForm = reactive({ allDay: true, startDate: '', endDate: '', startTime: '09:00', endTime: '17:00', reason: '' })
const overlapResult = ref([])
const offSummary = computed(() => {
  const range = offRange()
  if (range.error || !offForm.startDate) return ''
  const day = (iso) => formatDay(iso)
  if (!offForm.allDay) return `${day(offForm.startDate)}, ${offForm.startTime} to ${offForm.endTime}`
  const last = offForm.endDate || offForm.startDate
  return last === offForm.startDate ? `${day(offForm.startDate)}, all day` : `${day(offForm.startDate)} to ${day(last)}, all day`
})
const offError = ref('')
function applyPreset(kind) {
  const today = todayInZone()
  offForm.allDay = true
  if (kind === 'today') Object.assign(offForm, { startDate: today, endDate: today })
  else if (kind === 'tomorrow') Object.assign(offForm, { startDate: addDays(today, 1), endDate: addDays(today, 1) })
  else Object.assign(offForm, { startDate: today, endDate: addDays(today, 6) })
}
function instantAt(date, minuteOfDay) {
  // Skip a nonexistent local time (DST gap) by moving forward an hour.
  return wallClockInstant(date, minuteOfDay, scheduleZone.value) || wallClockInstant(date, Math.min(minuteOfDay + 60, 1439), scheduleZone.value)
}
function offRange() {
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
  if (range.error) { offError.value = range.error; return }
  timeOffBusy.value = true
  offError.value = ''
  overlapResult.value = []
  try {
    const result = await createTimeOff(state, {
      startsAt: range.start.toISOString(),
      endsAt: range.end.toISOString(),
      reason: offForm.reason,
    })
    overlapResult.value = result?.overlapping || []
    offForm.reason = ''
    if (!(await reloadChecked())) offError.value = 'Time off was added, but Bookins could not reload to confirm. Use Refresh to check.'
    else flash(`Time off added: ${offSummary.value || 'blocked'}. Guests cannot book it.`)
  } catch (reason) {
    offError.value = reason?.message || 'Time off could not be added.'
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
    offError.value = reason?.message || 'Time off could not be removed.'
  } finally {
    timeOffBusy.value = false
  }
}
function timeOffLabel(item) {
  const zone = displayTimeZone(scheduleZone.value)
  const startLocal = localFields(item.starts_at, scheduleZone.value)
  const endLocal = localFields(item.ends_at, scheduleZone.value)
  const day = (iso) => formatDay(iso)
  const clock = (instant) => new Date(instant).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: zone })
  if (startLocal.time === '00:00' && endLocal.time === '00:00') {
    const lastDay = addDays(endLocal.date, -1)
    return lastDay <= startLocal.date ? `${day(startLocal.date)}, all day` : `${day(startLocal.date)} to ${day(lastDay)}, all day`
  }
  if (startLocal.date === endLocal.date) return `${day(startLocal.date)}, ${clock(item.starts_at)} to ${clock(item.ends_at)}`
  return `${day(startLocal.date)} ${clock(item.starts_at)} to ${day(endLocal.date)} ${clock(item.ends_at)}`
}
const timeOffReason = (item) => (item.notes || (item.guest_name !== 'Time off' ? item.guest_name : '')).trim()

// ----- buffers -----
const bufferRows = computed(() =>
  activeServices.value.map((service) => {
    const duration = Number(service.duration_minutes || 0)
    return { id: service.id, name: service.name, duration, free: Number(form.slotIntervalMinutes) - duration }
  }),
)

// ----- save -----
function flash(message, options) {
  toast?.(message, options)
}
const hasActiveService = computed(() => activeServices.value.length > 0)
const needsFirstService = computed(() => scheduleReady.value && !hasActiveService.value && !isDemo.value)

async function reloadChecked() {
  return (await refresh()) === true
}

async function submit() {
  if (isDemo.value || saving.value) return
  const weeklyWindows = days
    .filter((day) => day.active)
    .flatMap((day) =>
      day.windows.map((item) => ({
        weekday: day.weekday,
        startMinute: minute(item.start),
        endMinute: endMinute(item.end),
      })),
    )
  if (!weeklyWindows.length) {
    error.value = 'Open at least one day so guests can find a time.'
    return
  }
  if (hasIssues.value || weeklyWindows.some((item) => !Number.isInteger(item.startMinute) || !Number.isInteger(item.endMinute) || item.startMinute < 0 || item.endMinute > 1440 || item.startMinute >= item.endMinute)) {
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
    await saveSchedule(state.schedules[0], { name: 'Working hours', ...form, weeklyWindows })
  } catch (reason) {
    error.value = reason?.message || 'Availability could not be saved.'
    toast?.error?.(error.value)
    saving.value = false
    return
  }
  try {
    if (await reloadChecked()) {
      hydrate()
      if (hasActiveService.value) flash('Availability saved. Guests can now book these hours.')
      else flash('Availability saved', { duration: 9000, action: { label: 'Create your first service', onClick: () => router.push('/services') } })
    } else {
      syncBaseline()
      error.value = 'Availability was saved, but Bookins could not reload it to confirm. Use Refresh to check the stored version.'
    }
  } catch (reason) {
    syncBaseline()
    error.value = reason?.message || 'Availability was saved, but the workspace could not be reloaded.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section>
    <div class="page-header">
      <div
        ><p class="eyebrow">Working hours</p><h1>Availability</h1
        ><p class="lede"
          >Choose when guests can book you. Times are shown in your booking timezone and confirmed
          slots are removed automatically.</p
        ></div
      >
    </div>

    <div v-if="isDemo" class="notice info" role="status">
      <AppIcon name="info" :size="18" />
      <span>Demo is read-only. Switch to your own workspace to change hours.</span>
    </div>
    <div v-if="isDraft" class="notice warning draft-notice" role="status">
      <AppIcon name="info" :size="18" />
      <span><strong>Draft, not saved yet.</strong> These hours are a suggestion. Guests cannot book you until you press Save availability.</span>
      <button class="primary small notice-action" type="button" :disabled="saving || hasIssues" @click="submit">Save availability</button>
    </div>
    <div v-else-if="needsFirstService" class="notice success" role="status">
      <AppIcon name="check" :size="18" />
      <span><strong>Hours saved.</strong> Next, create a service so guests have something to book.</span>
      <router-link class="primary small notice-action" to="/services">Create your first service</router-link>
    </div>
    <div
      v-if="error"
      class="notice error"
      role="alert"
      >{{ error }}</div
    >
    <div v-if="!isDemo && remoteChanged" class="notice warning" role="status">
      <AppIcon name="info" :size="18" />
      <span>A newer saved schedule was loaded from your workspace. Your unsaved edits are still shown.</span>
      <button class="secondary small-button notice-action" type="button" :disabled="saving" @click="hydrate">Load saved version</button>
    </div>

    <div class="availability-layout">
      <div class="availability-main">
        <article class="card schedule-card" data-tour="tour-availability-hours">
          <div class="schedule-heading"
            ><div
              ><p class="eyebrow">Weekly schedule <span v-if="isDraft" class="chip warning">Not saved yet</span><span v-else-if="dirty && !isDemo" class="chip warning">Unsaved changes</span><span v-else-if="!isDemo" class="chip success">Saved</span></p><h2>Regular hours</h2
              ><p class="muted">Turn a day on, then set one or more booking windows, for example before and after a lunch break.</p></div
            ></div
          >
          <div class="days">
            <div
              v-for="day in days"
              :key="day.weekday"
              class="day"
              :class="{ closed: !day.active }"
            >
              <label class="day-toggle"
                ><input
                  v-model="day.active"
                  :disabled="locked"
                  type="checkbox"
                /><span aria-hidden="true"><i /></span><strong>{{ day.name }}</strong></label
              >
              <div class="windows">
                <template v-if="day.active">
                  <div v-for="(item, index) in day.windows" :key="index" class="times">
                    <div class="window-pill">
                      <input
                        v-model="item.start"
                        type="time"
                        required
                        :disabled="locked"
                        :aria-label="`${day.name} window ${index + 1} start time`" /><span class="to">to</span
                      ><input
                        v-model="item.end"
                        type="time"
                        required
                        :disabled="locked"
                        :aria-label="`${day.name} window ${index + 1} end time`" />
                    </div>
                    <button
                      v-if="day.windows.length > 1"
                      class="ghost small-button icon-button"
                      type="button"
                      :disabled="locked"
                      :aria-label="`Remove ${day.name} window ${index + 1}`"
                      @click="removeWindow(day, index)"
                      >Remove</button
                    >
                  </div>
                  <div class="day-actions">
                    <button class="ghost small-button" type="button" :disabled="locked" @click="addWindow(day)">+ Add window</button>
                    <button class="ghost small-button" type="button" :disabled="locked" @click="copyDayToWeekdays(day)">Copy to Mon-Fri</button>
                  </div>
                  <p v-if="issues[day.weekday]" class="day-issue" role="alert">{{ issues[day.weekday] }}</p>
                </template>
                <span v-else class="muted-closed">Unavailable</span>
              </div>
            </div>
          </div>
        </article>

        <article class="card timeoff-card" aria-labelledby="timeoff-title" data-tour="tour-availability-timeoff">
          <div><p class="eyebrow">Time off</p><h2 id="timeoff-title">Block out days or hours <GmHint text="Time off hides those times from your booking page without changing your weekly hours. Existing bookings are not cancelled; you will be told if any fall inside it." label="About time off" /></h2>
            <p class="muted">Guests cannot book blocked times. Dates and times use your schedule timezone, {{ displayTimeZone(scheduleZone) }}.</p></div>
          <p v-if="!scheduleReady" class="muted">Save your weekly hours first (button at the bottom of the page), then you can add time off.</p>
          <form v-else class="timeoff-form" @submit.prevent="addTimeOff">
            <div class="preset-row" role="group" aria-label="Quick time off presets">
              <button class="secondary small-button" type="button" :disabled="isDemo || timeOffBusy" @click="applyPreset('today')">Today</button>
              <button class="secondary small-button" type="button" :disabled="isDemo || timeOffBusy" @click="applyPreset('tomorrow')">Tomorrow</button>
              <button class="secondary small-button" type="button" :disabled="isDemo || timeOffBusy" @click="applyPreset('week')">Next 7 days</button>
            </div>
            <label class="inline-check"><input v-model="offForm.allDay" type="checkbox" :disabled="isDemo || timeOffBusy" /> All day</label>
            <div v-if="offForm.allDay" class="field-row off-grid">
              <div class="field"><label for="off-start">First day</label><input id="off-start" v-model="offForm.startDate" type="date" required :disabled="isDemo || timeOffBusy" /></div>
              <div class="field"><label for="off-end">Last day (included)</label><input id="off-end" v-model="offForm.endDate" type="date" :min="offForm.startDate" :disabled="isDemo || timeOffBusy" /></div>
            </div>
            <div v-else class="field-row off-grid three">
              <div class="field"><label for="off-date">Date</label><input id="off-date" v-model="offForm.startDate" type="date" required :disabled="isDemo || timeOffBusy" /></div>
              <div class="field"><label for="off-from">From</label><input id="off-from" v-model="offForm.startTime" type="time" required :disabled="isDemo || timeOffBusy" /></div>
              <div class="field"><label for="off-to">To</label><input id="off-to" v-model="offForm.endTime" type="time" required :disabled="isDemo || timeOffBusy" /></div>
            </div>
            <p class="field-hint off-format">Pick from the calendar or type the date in your browser's format. Dates are in {{ displayTimeZone(scheduleZone) }}; today is {{ formatDay(todayInZone()) }}.</p>
            <p v-if="offSummary" class="field-hint off-summary" aria-live="polite">Will block: <strong>{{ offSummary }}</strong> ({{ displayTimeZone(scheduleZone) }}).</p>
            <div class="field"><label for="off-reason">Reason (optional)</label><input id="off-reason" v-model="offForm.reason" maxlength="160" placeholder="Holiday, training, errand" :disabled="isDemo || timeOffBusy" /></div>
            <div class="stack-sm"><GmButton type="submit" variant="primary" :pending="timeOffBusy" pending-label="Saving…" :disabled-reason="isDemo ? 'Demo is read-only.' : !offForm.startDate ? 'Choose a first day, or tap Today, Tomorrow or Next 7 days.' : ''" reason-visible>Add time off</GmButton></div>
          </form>
          <p v-if="offError" class="notice error" role="alert">{{ offError }}</p>
          <div v-if="overlapResult.length" class="notice warning warning-note" role="status">
            <AppIcon name="info" :size="18" />
            <div><strong>{{ overlapResult.length }} existing {{ overlapResult.length === 1 ? 'booking is' : 'bookings are' }} inside this time off</strong>
            <p>They still stand. <router-link to="/bookings">Open Bookings</router-link> to reschedule or cancel them and message the guests.</p>
            <ul><li v-for="item in overlapResult" :key="item.id">{{ item.guest_name }}, {{ timeOffLabel(item) }}</li></ul></div>
          </div>
          <div class="timeoff-list">
            <p class="eyebrow">Upcoming</p>
            <p v-if="!upcomingTimeOff.length" class="muted">No upcoming time off.</p>
            <ul v-else>
              <li v-for="item in upcomingTimeOff" :key="item.id">
                <AppIcon name="calendar" :size="18" class="off-icon" />
                <span class="off-text"><strong>{{ timeOffLabel(item) }}</strong><small v-if="timeOffReason(item)">{{ timeOffReason(item) }}</small></span>
                <GmConfirm
                  :open="pendingRemove?.id === item.id"
                  title="Remove this time off?"
                  :message="`${timeOffLabel(item)} will become bookable again.`"
                  confirm-label="Remove time off"
                  cancel-label="Keep it"
                  tone="danger"
                  :busy="timeOffBusy"
                  @update:open="(open) => { if (open) pendingRemove = item; else if (!timeOffBusy) pendingRemove = null }"
                  @confirm="pendingRemove = item; confirmRemove()"
                >
                  <GmHint wrap text="Demo is read-only. Exit Demo to remove time off." :disabled="!isDemo" v-slot="{ describedby }">
                    <button class="ghost small-button" type="button" :disabled="timeOffBusy" :aria-disabled="isDemo || undefined" :aria-describedby="isDemo ? describedby : undefined" :aria-label="`Remove time off ${timeOffLabel(item)}`" @click="isDemo ? null : (pendingRemove = item)">Remove</button>
                  </GmHint>
                </GmConfirm>
              </li>
            </ul>
            <button v-if="pastTimeOff.length" class="ghost small-button" type="button" :aria-expanded="showPast" @click="showPast = !showPast">{{ showPast ? 'Hide past' : `Show past (${pastTimeOff.length})` }}</button>
            <ul v-if="showPast" class="past">
              <li v-for="item in pastTimeOff" :key="item.id"><AppIcon name="calendar" :size="18" class="off-icon" /><span class="off-text"><strong>{{ timeOffLabel(item) }}</strong><small v-if="timeOffReason(item)">{{ timeOffReason(item) }}</small></span></li>
            </ul>
          </div>
        </article>
      </div>

      <aside class="availability-side">
        <article class="card summary-card">
          <p class="eyebrow">Schedule summary <span v-if="isDraft" class="chip warning">Draft</span></p>
          <div class="summary-number"
            ><strong>{{ activeDays }}</strong
            ><span>open days</span></div
          >
          <div class="summary-row"
            ><span>Weekly availability</span><strong>{{ weeklyHours }} hours</strong></div
          >
          <div class="summary-row"
            ><span>Booking timezone</span><strong>{{ displayTimeZone(form.timezone) }}</strong></div
          >
        </article>

        <article class="card settings-card">
          <div><p class="eyebrow">Booking rules</p><h2>Timing and notice</h2><p class="muted">These rules apply to every service on your booking page.</p></div>
          <div class="field"
            ><label for="availability-timezone">Timezone <GmHint text="Your weekly hours and time off are read in this timezone, and guests see times converted to theirs. Pick the city where you work." label="About timezone" /></label
            ><GmSelect id="availability-timezone" v-model="form.timezone" :options="timezoneItems" label="Timezone" :disabled="isDemo || saving" required described-by="availability-timezone-help" />
            <p id="availability-timezone-help" class="field-hint">The timezone your hours are in. Type a city name to search.</p
          ><button v-if="browserZone && browserZone !== form.timezone" class="ghost small-button" type="button" :disabled="locked" @click="useBrowserZone">Use this browser's timezone ({{ browserZone }})</button
          ></div>
          <div class="field"
            ><label for="slot-interval">Start-time interval <GmHint text="How far apart appointment start times are. With 60 minutes, guests can start at 9:00, 10:00, 11:00. A 30 minute service on a 60 minute interval leaves 30 minutes free before the next one." label="About the start-time interval" /></label
            ><GmSelect
              id="slot-interval"
              v-model="form.slotIntervalMinutes"
              :options="intervalOptions"
              label="Start-time interval"
              :disabled="isDemo || saving"
            /><p class="field-hint"
              ><template v-if="maxServiceDuration">Must be at least as long as your longest active service ({{ longestServiceName }}, {{ maxServiceDuration }} minutes), so shorter intervals are unavailable.</template><template v-else>You have no services yet, so any interval works. Once you add one, the interval must be at least as long as it.</template></p
            ><div v-if="bufferRows.length" class="buffer-note">
              <p>The interval sets how far apart start times are. An appointment shorter than the interval leaves the rest as free time before the next one.</p>
              <ul>
                <li v-for="row in bufferRows" :key="row.id">
                  <strong>{{ row.name }}</strong>: {{ row.duration }} min appointment<template v-if="row.free >= 0"> + {{ row.free }} min free before the next one</template><template v-else> (longer than the interval)</template>
                </li>
              </ul>
            </div></div
          >
          <div class="field"
            ><label for="minimum-notice">Minimum notice <GmHint text="The shortest time before an appointment that a guest can still book it. 1 day means nobody can book for later today." label="About minimum notice" /></label
            ><GmSelect
              id="minimum-notice"
              v-model="form.minimumNoticeMinutes"
              :options="noticeOptions"
              label="Minimum notice"
              :disabled="isDemo || saving"
          /><p class="field-hint">Guests cannot book closer to the start time than this.</p></div>
          <div class="field"
            ><label for="booking-horizon">How far ahead can guests book? <GmHint text="The booking horizon: guests only see days up to this far from today." label="About the booking horizon" /></label
            ><GmSelect
              id="booking-horizon"
              v-model="form.bookingHorizonDays"
              :options="horizonOptions"
              label="How far ahead can guests book?"
              :disabled="isDemo || saving"
          /><p class="field-hint">Days further away than this are hidden from guests.</p></div>
          <div v-if="serviceFit.length" class="fit-list">
            <p class="eyebrow">Active services at this interval</p>
            <ul>
              <li v-for="item in serviceFit" :key="item.id">
                <span>{{ item.name }} <small>{{ item.duration }} min</small></span>
                <strong :class="item.tooLong || (item.days === 0 && activeDays) ? 'bad' : 'ok'">{{ item.tooLong ? 'Longer than interval' : item.days === 0 ? 'No window fits' : `Bookable ${item.days} ${item.days === 1 ? 'day' : 'days'}` }}</strong>
              </li>
            </ul>
          </div>
          <div v-if="hiddenWarnings.length" class="notice warning warning-note" role="status">
            <AppIcon name="info" :size="18" />
            <div><strong>This change would hide services</strong>
            <ul>
              <li v-for="item in hiddenWarnings" :key="item.id">{{ item.name }}<template v-if="item.lost.length"> on {{ item.lost.join(', ') }}</template><template v-else> on every day</template></li>
            </ul></div>
          </div>
          <div v-if="bookingsOutside.length" class="notice warning warning-note" role="status">
            <AppIcon name="info" :size="18" />
            <div><strong>{{ bookingsOutside.length }} upcoming {{ bookingsOutside.length === 1 ? 'booking falls' : 'bookings fall' }} outside these hours</strong>
            <p>They stay confirmed. Saving does not move or cancel them. Times shown in {{ displayTimeZone(form.timezone) }}.</p>
            <ul>
              <li v-for="item in bookingsOutside.slice(0, 5)" :key="item.id">{{ item.guest_name }}, {{ outsideLabel(item) }}</li>
              <li v-if="bookingsOutside.length > 5">and {{ bookingsOutside.length - 5 }} more</li>
            </ul></div>
          </div>
          <div class="rule-note"
            ><AppIcon
              name="sparkle"
              :size="17"
            /><p
              >All current services share this schedule, so Bookins prevents two confirmed bookings
              from using the same time.</p
            ></div
          >
        </article>
      </aside>
    </div>

    <div v-if="showSaveBar" class="sticky-save-bar" role="status" data-tour="tour-availability-save">
      <span>{{ isDraft && !dirty ? 'Draft: not saved yet. Save your hours so guests can book you.' : isDraft ? 'Draft with edits, not saved yet.' : 'Unsaved availability changes.' }}</span>
      <div class="cluster">
        <GmConfirm
          v-model:open="leavePrompt"
          :title="pendingRoute ? 'Leave without saving?' : 'Discard your changes?'"
          :message="pendingRoute ? 'Your availability changes have not been saved and will be lost.' : 'Your hours go back to the last saved version.'"
          :confirm-label="pendingRoute ? 'Leave without saving' : 'Discard changes'"
          cancel-label="Keep editing"
          tone="danger"
          :busy="saving"
          @confirm="discardChanges"
          @cancel="keepEditing"
        >
          <button v-if="dirty" class="ghost" type="button" :disabled="saving" @click="leavePrompt = true">Discard changes</button>
        </GmConfirm>
        <GmButton variant="primary" :pending="saving" pending-label="Saving…" :disabled-reason="saveBlockReason" @click="submit">Save availability</GmButton>
      </div>
      <span v-if="saveBlockReason" class="field-hint save-reason" role="alert">{{ saveBlockReason }}</span>
    </div>
  </section>
</template>

<style scoped>
.availability-layout { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.65fr); gap: var(--space-4); align-items: start; }
.availability-main { min-width: 0; display: grid; gap: var(--space-4); }
.availability-side { display: grid; gap: var(--space-4); min-width: 0; }
.notice-action { margin-left: auto; flex: none; }
.draft-notice span { min-width: 0; }
.eyebrow .chip { margin-left: 8px; vertical-align: middle; }
.off-summary strong { color: var(--ink); }
.sticky-save-bar { flex-wrap: wrap; }
.save-reason { flex-basis: 100%; margin: 0; color: var(--danger); text-align: right; }
.availability-layout { padding-bottom: 96px; }
.timeoff-card h2 { display: flex; align-items: center; gap: 4px; }
.schedule-heading { margin-bottom: var(--space-4); }
.schedule-heading h2, .timeoff-card h2, .settings-card h2 { margin: 0 0 4px; }
.schedule-heading .muted, .timeoff-card .muted { margin: 0; font-size: var(--text-sm); }
.days { margin: 0 calc(var(--space-5) * -1) calc(var(--space-5) * -1); }
.day { min-height: 72px; padding: 14px var(--space-5); display: grid; grid-template-columns: 170px minmax(0, 1fr); align-items: start; gap: var(--space-4); border-top: 1px solid var(--line); transition: background var(--dur-fast) var(--ease); }
.day.closed { background: var(--surface-soft); }
.day.closed .day-toggle strong { color: var(--muted); font-weight: 600; }
.day-toggle { min-height: var(--control-h); display: flex; align-items: center; gap: 12px; cursor: pointer; }
.day-toggle strong { font-size: var(--text-sm); font-weight: 650; }
.day-toggle input { position: absolute; width: 1px; height: 1px; min-height: 0; opacity: 0; }
.day-toggle > span { width: 40px; height: 24px; padding: 3px; display: flex; align-items: center; flex: none; border-radius: 99px; background: #c9cfdd; transition: background var(--dur-fast) var(--ease); }
.day-toggle > span i { width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(16, 25, 40, 0.18); transition: transform var(--dur-fast) var(--ease); }
.day-toggle input:checked + span { background: var(--accent); }
.day-toggle input:checked + span i { transform: translateX(16px); }
.day-toggle input:focus-visible + span { outline: 3px solid rgba(35, 54, 220, 0.22); outline-offset: 2px; }
.windows { display: grid; gap: var(--space-2); min-width: 0; }
.times { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.window-pill { display: inline-flex; align-items: center; gap: 4px; padding: 0 4px; min-height: var(--control-h); border: 1px solid var(--line-strong); border-radius: var(--radius-pill); background: #fff; }
.window-pill:focus-within { border-color: var(--accent); box-shadow: var(--focus-ring); }
.window-pill input { width: 112px; min-width: 0; min-height: 38px; padding: 0 8px; color: var(--ink); border: 0; border-radius: var(--radius-pill); background: transparent; font-size: var(--text-md); font-variant-numeric: tabular-nums; }
.window-pill input:focus, .window-pill input:focus-visible { outline: 0; box-shadow: none; }
.to { color: var(--muted); font-size: var(--text-sm); }
.day-actions { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-2); }
.icon-button { padding: 0 12px; color: var(--muted); }
.day-issue { margin: 0; color: var(--danger); font-size: var(--text-sm); }
.muted-closed { min-height: var(--control-h); display: inline-flex; align-items: center; color: var(--muted); font-size: var(--text-sm); }

.timeoff-card { display: grid; gap: var(--space-3); }
.timeoff-form { display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-soft); }
.preset-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.inline-check { min-height: var(--control-h-sm); display: inline-flex; align-items: center; gap: 8px; font-size: var(--text-sm); font-weight: 600; }
.inline-check input { min-height: 0; width: 18px; height: 18px; }
.timeoff-list ul { margin: var(--space-2) 0; padding: 0; list-style: none; display: grid; gap: var(--space-2); }
.timeoff-list li { padding: 10px 12px; display: flex; align-items: center; gap: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; font-size: var(--text-sm); }
.off-icon { flex: none; color: var(--accent); }
.off-text { min-width: 0; flex: 1; display: grid; gap: 2px; }
.timeoff-list li .small-button { margin-left: auto; flex: none; }
.timeoff-list small { color: var(--muted); font-size: var(--text-xs); }
.timeoff-list .past { opacity: 0.7; }

.buffer-note { margin-top: var(--space-2); color: var(--muted); font-size: var(--text-xs); line-height: 1.5; }
.buffer-note p { margin: 0 0 6px; }
.buffer-note ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.buffer-note strong { color: var(--ink); font-weight: 600; }
.fit-list ul, .warning-note ul { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.fit-list li { display: flex; justify-content: space-between; gap: 10px; font-size: var(--text-sm); }
.fit-list small { color: var(--muted); font-size: var(--text-xs); }
.fit-list .ok { color: var(--success); font-size: var(--text-xs); }
.fit-list .bad { color: #9a6700; font-size: var(--text-xs); }
.warning-note { margin-bottom: 0; }
.warning-note > div { min-width: 0; }
.warning-note p { margin: 4px 0 0; }
.warning-note li { font-size: var(--text-sm); }
.settings-card { display: grid; gap: var(--space-3); }
.settings-card .field { margin-bottom: 0; }

.summary-card { color: #fff; background: linear-gradient(145deg, #2336dc, #4154ef); border-color: transparent; box-shadow: 0 16px 38px rgba(35, 54, 220, 0.2); }
.summary-card .eyebrow { color: #dfe3ff; }
.summary-number { margin: 8px 0 var(--space-4); display: flex; align-items: baseline; gap: 8px; }
.summary-number strong { font-size: 42px; letter-spacing: -0.05em; font-variant-numeric: tabular-nums; }
.summary-number span { color: #e6e9ff; font-size: var(--text-sm); }
.summary-row { padding: 12px 0; display: flex; justify-content: space-between; gap: 14px; border-top: 1px solid rgba(255, 255, 255, 0.2); font-size: var(--text-sm); }
.summary-row span { color: #e6e9ff; }
.summary-row strong { text-align: right; overflow-wrap: anywhere; }
.rule-note { padding: 12px; display: flex; align-items: flex-start; gap: 9px; color: var(--accent); border-radius: var(--radius-sm); background: var(--accent-soft); }
.rule-note svg { flex: none; margin-top: 2px; }
.rule-note p { margin: 0; color: #445071; font-size: var(--text-sm); }

@media (max-width: 1140px) {
  .availability-layout { grid-template-columns: 1fr; }
  .availability-side { grid-template-columns: 1fr 1fr; align-items: start; }
}
@media (max-width: 780px) {
  .day { grid-template-columns: 1fr; gap: var(--space-2); padding: 14px var(--space-4); }
  .days { margin: 0 calc(var(--space-4) * -1) calc(var(--space-4) * -1); }
  .availability-side { grid-template-columns: 1fr; }
  .window-pill { flex: 1; min-width: 0; }
  .window-pill input { flex: 1; width: 0; }
  .timeoff-form { padding: var(--space-3); }
  .save-reason { text-align: left; }
  .notice { flex-wrap: wrap; }
  .notice-action { margin-left: 0; flex-basis: 100%; justify-content: center; text-align: center; }
}
</style>
