<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import WeeklyHoursEditor from '../components/WeeklyHoursEditor.vue'
import IntervalField from '../components/IntervalField.vue'
import GmSelect from '../components/ui/GmSelect.vue'
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
} from '../booking.js'
import { displayName, memberColor, memberFirstName, memberName, scheduleOf } from '../team-ui.js'
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
} from '../weekly-hours.js'
import { localFields, wallClockInstant } from '../scheduling.js'
import { isDemo, registerDemoGuard } from '../runtime.js'
import { formatDay } from '../format-date.js'

import { displayTimeZone, timezoneOptions } from '../time-display.js'

const timezoneItems = computed(() => timezoneOptions(form.timezone))
const state = inject('bookingState')
const refresh = inject('refreshBookings')
const toast = inject('toast', null)
const router = useRouter()
const route = useRoute()
const saving = ref(false)
const error = ref('')
const availabilityBaseline = ref('')
const leavePrompt = ref(false)
const pendingRoute = ref('')
const allowLeave = ref(false)
const remoteChanged = ref(false)
const names = DAY_NAMES
const timeOffBusy = ref(false)
const pendingRemove = ref(null)
const days = reactive(makeDays())

// ----- team: whose calendar is being edited -----
// Single-owner installs never see the switcher and edit the owner's schedule exactly as before.
const team = computed(() => hasTeam(state))
const members = computed(() => teamMembers(state, { includeInactive: true }))
const selectedStaffId = ref('')
const currentMember = computed(() => {
  if (!team.value) return ownerStaff(state)
  return members.value.find((item) => item.id === selectedStaffId.value) || members.value[0]
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
  const saved = JSON.parse(availabilityBaseline.value)
  Object.assign(form, saved.form)
  saved.days.forEach((savedDay, index) => {
    days[index].active = savedDay.active
    days[index].windows = savedDay.windows.map((item) => ({ ...item }))
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
function requestMember(id) {
  if (id === currentMember.value?.id || saving.value) return
  if (dirty.value) {
    pendingMember.value = id
    leavePrompt.value = true
    return
  }
  switchMember(id)
}
function switchMember(id) {
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

function onEditorNotice(notice) {
  if (notice.kind === 'error') error.value = notice.text
  else { error.value = ''; toast?.info?.(notice.text) }
}

function useBrowserZone() {
  if (browserZone) form.timezone = browserZone
}

// ----- hydrate from state -----
const FORM_DEFAULTS = { timezone: 'Africa/Lagos', slotIntervalMinutes: 60, minimumNoticeMinutes: 60, bookingHorizonDays: 60 }
const formFromSchedule = (schedule) => ({
  timezone: schedule.timezone || form.timezone,
  slotIntervalMinutes: Number(schedule.slot_interval_minutes),
  minimumNoticeMinutes: Number(schedule.minimum_notice_minutes),
  bookingHorizonDays: Number(schedule.booking_horizon_days),
})
function hydrate() {
  const existing = currentSchedule.value
  remoteChanged.value = false
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

selectedStaffId.value = String(route.query.staff || '') || ownerStaff(state).id
onMounted(() => {
  hydrate()
  applyIntervalQuery()
})
watch(() => [route.query.interval, route.query.from], () => applyIntervalQuery())

watch(
  () => currentSchedule.value,
  () => {
    if (saving.value) return
    if (dirty.value) remoteChanged.value = true
    else hydrate()
  },
)

// ----- fit analysis -----
const savedDayWindows = computed(() => {
  const existing = currentSchedule.value
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
    const before = currentSchedule.value
      ? bookableDays(service, savedDayWindows.value, Number(currentSchedule.value.slot_interval_minutes))
      : new Set()
    const lost = [...before].filter((weekday) => !now.has(weekday)).sort()
    const duration = Number(service.duration_minutes || 0)
    return {
      id: service.id,
      name: displayName(service.name),
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
    .filter((item) => !team.value || item.schedule_id === currentSchedule.value?.id)
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
      // With a team, time off blocks only this person's calendar.
      ...(team.value ? { staffId: currentMember.value.id } : {}),
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
    return { id: service.id, name: displayName(service.name), duration, free: Number(form.slotIntervalMinutes) - duration }
  }),
)

// The side lists show only the longest service when there are many (a 60-service workspace would otherwise make
// this page thousands of pixels tall); every service stays one click away.
const COLLAPSE_OVER = 3
const longestRow = (list) => list.reduce((best, item) => (!best || item.duration > best.duration ? item : best), null)
const bufferShown = computed(() => (bufferRows.value.length > COLLAPSE_OVER ? [longestRow(bufferRows.value)] : bufferRows.value))
const fitShown = computed(() => (serviceFit.value.length > COLLAPSE_OVER ? [longestRow(serviceFit.value)] : serviceFit.value))
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
const intervalField = ref(null)
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
  toast?.info?.(`Interval set to ${need} minutes (${durationWords(need)}) so a ${wanted}-minute service fits. Press Save availability to apply it. Every service on this schedule will then start only every ${need} minutes.`, { duration: 9000 })
}

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
      { name: isOwnerView.value ? 'Working hours' : currentSchedule.value?.name || `${currentMember.value.name} hours`, ...form, weeklyWindows },
      team.value ? currentMember.value : null,
    )
  } catch (reason) {
    error.value = reason?.message || 'Availability could not be saved.'
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
          ><template v-if="team">Each person on your team has their own working hours and time off, so two people can be booked at the same time. Pick whose calendar to edit.</template
          ><template v-else>Choose when guests can book you. Times are shown in your booking timezone and confirmed
          slots are removed automatically.</template></p
        ></div
      >
    </div>

    <div v-if="team" class="member-switch" data-tour="tour-availability-member" role="group" aria-label="Whose calendar to edit">
      <span class="switch-label">Editing <GmHint text="Hours and time off are saved per person. Switching person never changes anyone else's calendar." label="About editing per person" /></span>
      <div class="segmented switch-list">
        <button
          v-for="member in members"
          :key="member.id"
          type="button"
          :class="{ 'is-active': member.id === currentMember.id }"
          :aria-pressed="member.id === currentMember.id"
          :disabled="saving"
          @click="requestMember(member.id)"
        ><i class="switch-dot" :style="{ background: memberColor(member) }" aria-hidden="true" />{{ memberName(member) }}<small v-if="!isStaffActive(member)" class="switch-inactive">inactive</small></button>
      </div>
      <router-link class="ghost small-button" to="/team">Manage team</router-link>
    </div>

    <div v-if="isDemo" class="notice info" role="status">
      <AppIcon name="info" :size="18" />
      <span>Demo is read-only. Switch to your own workspace to change hours.</span>
    </div>
    <div v-if="isDraft" class="notice warning draft-notice" role="status">
      <AppIcon name="info" :size="18" />
      <span v-if="isOwnerView"><strong>Draft, not saved yet.</strong> These hours are a suggestion. Guests cannot book you until you press Save availability.</span>
      <span v-else><strong>{{ currentMember.name }} has no hours saved yet.</strong> These hours are a copy of yours as a suggestion. They cannot be booked, or assigned bookings, until you press Save availability.</span>
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
              ><p class="eyebrow">Weekly schedule<template v-if="team"> · {{ memberName(currentMember) }}</template> <span v-if="isDraft" class="chip warning">Not saved yet</span><span v-else-if="dirty && !isDemo" class="chip warning">Unsaved changes</span><span v-else-if="!isDemo" class="chip success">Saved</span></p><h2>{{ isOwnerView ? 'Regular hours' : `${memberFirstName(currentMember)}'s regular hours` }}</h2
              ><p class="muted">Turn a day on, then set one or more booking windows, for example before and after a lunch break.</p></div
            ></div
          >
          <WeeklyHoursEditor class="days" :days="days" :disabled="locked" @notice="onEditorNotice" />
        </article>

        <article class="card timeoff-card" aria-labelledby="timeoff-title" data-tour="tour-availability-timeoff">
          <div><p class="eyebrow">Time off<template v-if="team"> · {{ memberName(currentMember) }}</template></p><h2 id="timeoff-title">Block out days or hours <GmHint :text="team ? `Time off blocks only ${whose} calendar. The rest of the team can still be booked. Existing bookings are not cancelled; you will be told if any fall inside it.` : 'Time off hides those times from your booking page without changing your weekly hours. Existing bookings are not cancelled; you will be told if any fall inside it.'" label="About time off" /></h2>
            <p class="muted">Guests cannot book blocked times<template v-if="team"> with {{ isOwnerView ? 'you' : memberFirstName(currentMember) }}</template>. Dates and times use {{ whose }} schedule timezone, {{ displayTimeZone(scheduleZone) }}.</p></div>
          <p v-if="!scheduleReady" class="muted">Save {{ whose }} weekly hours first (button at the bottom of the page), then you can add time off.</p>
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
          <div><p class="eyebrow">Booking rules</p><h2>Timing and notice</h2><p class="muted">{{ team ? `These rules apply to ${whose} calendar only.` : 'These rules apply to every service on your booking page.' }}</p></div>
          <div class="field"
            ><label for="availability-timezone">Timezone <GmHint text="Your weekly hours and time off are read in this timezone, and guests see times converted to theirs. Pick the city where you work." label="About timezone" /></label
            ><GmSelect id="availability-timezone" v-model="form.timezone" :options="timezoneItems" label="Timezone" :disabled="isDemo || saving" required described-by="availability-timezone-help" />
            <p id="availability-timezone-help" class="field-hint">The timezone your hours are in. Type a city name to search.</p
          ><button v-if="browserZone && browserZone !== form.timezone" class="ghost small-button" type="button" :disabled="locked" @click="useBrowserZone">Use this browser's timezone ({{ browserZone }})</button
          ></div>
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
              <p>The interval sets how far apart start times are. An appointment shorter than the interval leaves the rest as free time before the next one.</p>
              <ul>
                <li v-for="row in bufferShown" :key="row.id">
                  <strong>{{ row.name }}</strong>: {{ row.duration }} min appointment<template v-if="row.free >= 0"> + {{ row.free }} min free before the next one</template><template v-else> (longer than the interval)</template>
                </li>
              </ul>
              <p v-if="bufferRows.length > COLLAPSE_OVER" class="list-count">Longest of {{ bufferRows.length }} active services.</p>
              <details v-if="bufferRows.length > COLLAPSE_OVER" class="see-all">
                <summary>See all {{ bufferRows.length }} services</summary>
                <ul>
                  <li v-for="row in bufferRows" :key="row.id">
                    <strong>{{ row.name }}</strong>: {{ row.duration }} min<template v-if="row.free >= 0"> + {{ row.free }} min free</template><template v-else> (longer than the interval)</template>
                  </li>
                </ul>
              </details>
            </div>
          </IntervalField>
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
            <p class="eyebrow">{{ team ? `${isOwnerView ? 'Your' : memberFirstName(currentMember) + '\'s'} active services at this interval` : 'Active services at this interval' }}</p>
            <ul>
              <li v-for="item in fitShown" :key="item.id">
                <span>{{ item.name }} <small>{{ item.duration }} min</small></span>
                <strong :class="item.tooLong || (item.days === 0 && activeDays) ? 'bad' : 'ok'">{{ item.tooLong ? 'Longer than interval' : item.days === 0 ? 'No window fits' : `Bookable ${item.days} ${item.days === 1 ? 'day' : 'days'}` }}</strong>
              </li>
            </ul>
            <p v-if="serviceFit.length > COLLAPSE_OVER" class="list-count">Longest of {{ serviceFit.length }} active services<template v-if="fitProblems">; {{ fitProblems }} {{ fitProblems === 1 ? 'does' : 'do' }} not fit</template>.</p>
            <details v-if="serviceFit.length > COLLAPSE_OVER" class="see-all">
              <summary>See all {{ serviceFit.length }} services</summary>
              <ul>
                <li v-for="item in serviceFit" :key="item.id">
                  <span>{{ item.name }} <small>{{ item.duration }} min</small></span>
                  <strong :class="item.tooLong || (item.days === 0 && activeDays) ? 'bad' : 'ok'">{{ item.tooLong ? 'Longer than interval' : item.days === 0 ? 'No window fits' : `Bookable ${item.days} ${item.days === 1 ? 'day' : 'days'}` }}</strong>
                </li>
              </ul>
            </details>
          </div>
          <div v-if="intervalChange" class="notice info warning-note" role="status">
            <AppIcon name="info" :size="18" />
            <div><strong>This changes start times for all services</strong>
            <p>Guests can start every {{ intervalChange.to }} minutes instead of every {{ intervalChange.from }}{{ team && !isOwnerView ? ` on ${memberFirstName(currentMember)}'s calendar` : '' }}. Existing bookings are not moved.</p></div>
          </div>
          <div v-if="hiddenWarnings.length" class="notice warning warning-note" role="status">
            <AppIcon name="info" :size="18" />
            <div><strong>This change would hide services</strong>
            <ul>
              <li v-for="item in hiddenWarnings.slice(0, WARNING_LIMIT)" :key="item.id">{{ item.name }}<template v-if="item.lost.length"> on {{ item.lost.join(', ') }}</template><template v-else> on every day</template></li>
              <li v-if="hiddenWarnings.length > WARNING_LIMIT">and {{ hiddenWarnings.length - WARNING_LIMIT }} more services</li>
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
              ><template v-if="team">Each person has their own calendar. Bookins prevents two bookings at the same time for the same person, but two different people can be booked at once.</template
              ><template v-else>All current services share this schedule, so Bookins prevents two confirmed bookings
              from using the same time.</template></p
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
          :title="pendingRoute ? 'Leave without saving?' : pendingMember ? 'Switch without saving?' : 'Discard your changes?'"
          :message="pendingRoute ? 'Your availability changes have not been saved and will be lost.' : pendingMember ? `Your unsaved changes to ${whose} hours will be lost.` : 'Your hours go back to the last saved version.'"
          :confirm-label="pendingRoute ? 'Leave without saving' : pendingMember ? 'Switch and discard' : 'Discard changes'"
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

.member-switch { margin-bottom: var(--space-4); padding: var(--space-3) var(--space-4); display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-4); border: 1px solid var(--line); border-radius: var(--radius); background: #fff; }
.switch-label { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-size: var(--text-sm); font-weight: 650; }
.switch-list { max-width: 100%; display: flex; flex-wrap: wrap; }
.switch-list button { display: inline-flex; align-items: center; gap: 8px; }
.switch-dot { width: 10px; height: 10px; flex: none; border-radius: 50%; }
.switch-inactive { color: var(--muted); font-size: var(--text-xs); }

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
.list-count { margin: 6px 0 0; color: var(--muted); font-size: var(--text-xs); }
.see-all { margin-top: 6px; }
.see-all summary { min-height: 32px; display: flex; align-items: center; color: var(--accent); cursor: pointer; font-size: var(--text-sm); font-weight: 650; }
.see-all ul { max-height: 260px; margin-top: 4px; overflow: auto; }
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
  .days { margin: 0 calc(var(--space-4) * -1) calc(var(--space-4) * -1); }
  .availability-side { grid-template-columns: 1fr; }
  .timeoff-form { padding: var(--space-3); }
  .save-reason { text-align: left; }
  .notice { flex-wrap: wrap; }
  .notice-action { margin-left: 0; flex-basis: 100%; justify-content: center; text-align: center; }
}
</style>
