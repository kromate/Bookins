<script setup lang="ts">
// Today: the front desk. The day on a time rail (one lane per person, a now-line), what is next, and what needs the owner.
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import {
  copyText,
  hasTeam,
  isActiveBooking,
  isActiveTimeOff,
  isTimeOff,
  messageQueue,
  ownerStaff,
  staffForBooking,
  teamMembers,
} from '../booking.ts'
import { useSetupState } from '../setup.ts'
import { isDemo } from '../runtime.ts'
import { localFields, parseWeeklyWindows } from '../scheduling.ts'
import { displayTimeZone } from '../time-display.ts'
import { displayName, memberColor, memberFirstName, memberName, scheduleOf } from '../team-ui.ts'
import { composeMessage, whatsappShareUrl } from '../messaging.ts'
import { hourMarks, minutesOf, placeSpans, spanSize } from '../rail.ts'
import { readTourSeen, writeTourSeen } from '../tour.ts'

interface MinuteWindow { start: number; end: number }
interface RailBooking { booking: BookingRecord; start: number; end: number }
interface Lane { id: string; label: string; color: string; open: MinuteWindow[]; off: MinuteWindow[]; items: RailBooking[] }

const state = inject<WorkspaceState>('bookingState', { profile: null, schedules: [], services: [], bookings: [], contacts: [], staff: [], campaigns: [] })
const toast = inject<ToastApi | null>('toast', null)
const startTour = inject<(() => Promise<void> | void) | null>('startTour', null)
const setup = useSetupState(state)

const now = ref(Date.now())
const clockTimer = window.setInterval(() => { now.value = Date.now() }, 30_000)
onBeforeUnmount(() => window.clearInterval(clockTimer))

// One zone for the page: the owner's own schedule (never a team member's), else the profile's.
const owner = computed(() => ownerStaff(state))
const zone = computed(() => displayTimeZone(scheduleOf(state, owner.value)?.timezone || state.profile?.timezone || state.schedules.find((item) => item.timezone)?.timezone))
const todayKey = computed(() => localFields(now.value, zone.value).date)
const weekday = computed(() => new Date(`${todayKey.value}T12:00:00.000Z`).getUTCDay())
const nowMinute = computed(() => minutesOf(localFields(now.value, zone.value).time))
const team = computed(() => hasTeam(state))

const ms = (value: TimestampInput) => Date.parse(String(value ?? ''))
const realBookings = computed(() => state.bookings.filter((item) => !isTimeOff(item)))
const fmtTime = (value: TimestampInput) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: zone.value }).format(ms(value))
const fmtMinute = (minute: number) => {
  const date = new Date(Date.UTC(2000, 0, 1, Math.floor(minute / 60), minute % 60))
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(date)
}
const dateHeading = computed(() => new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: zone.value }).format(now.value))

function windowsFor(schedule: ScheduleRecord | null): MinuteWindow[] {
  if (!schedule) return []
  try {
    return parseWeeklyWindows(schedule.weekly_windows_json)
      .filter((item) => item.weekday === weekday.value)
      .map((item) => ({ start: item.startMinute, end: item.endMinute }))
  } catch {
    return []
  }
}
// Clamp a stored instant to minutes within today (time off can span several days).
function minuteToday(value: TimestampInput, fallback: number) {
  const fields = localFields(value, zone.value)
  if (fields.date < todayKey.value) return 0
  if (fields.date > todayKey.value) return 24 * 60
  const minute = minutesOf(fields.time)
  return Number.isFinite(minute) ? minute : fallback
}
const onToday = (booking: BookingRecord) => localFields(booking.starts_at, zone.value).date === todayKey.value

const todays = computed(() => realBookings.value
  .filter((item) => item.status !== 'cancelled' && isActiveBooking(item) && onToday(item))
  .sort((left, right) => ms(left.starts_at) - ms(right.starts_at)))

const lanes = computed<Lane[]>(() => {
  const people = team.value ? teamMembers(state) : [owner.value]
  const map = new Map<string, Lane>()
  for (const member of people) {
    const id = String(member.id || '')
    map.set(id, {
      id,
      label: memberName(member),
      color: memberColor(member),
      open: windowsFor(scheduleOf(state, member)),
      off: [],
      items: [],
    })
  }
  const laneFor = (booking: BookingRecord) => {
    if (!team.value) return map.get(String(owner.value.id || ''))
    const member = staffForBooking(state, booking)
    const id = String(member.id || '')
    if (!map.has(id)) map.set(id, { id, label: memberName(member), color: memberColor(member), open: [], off: [], items: [] })
    return map.get(id)
  }
  for (const booking of todays.value) {
    const start = minuteToday(booking.starts_at, 0)
    const end = Math.max(start + 15, minuteToday(booking.ends_at, start + 30))
    laneFor(booking)?.items.push({ booking, start, end })
  }
  for (const block of state.bookings.filter(isActiveTimeOff)) {
    const startDay = localFields(block.starts_at, zone.value).date
    const endDay = localFields(new Date(ms(block.ends_at) - 1), zone.value).date
    if (startDay > todayKey.value || endDay < todayKey.value) continue
    laneFor(block)?.off.push({ start: minuteToday(block.starts_at, 0), end: minuteToday(block.ends_at, 24 * 60) })
  }
  return [...map.values()]
})

// The visible hours: everyone's open hours and every booking, at least 8:00 to 18:00.
const firstHour = computed(() => {
  const starts = lanes.value.flatMap((lane) => [...lane.open.map((item) => item.start), ...lane.items.map((item) => item.start)])
  return Math.max(0, Math.floor(Math.min(8 * 60, ...starts) / 60))
})
const lastHour = computed(() => {
  const ends = lanes.value.flatMap((lane) => [...lane.open.map((item) => item.end), ...lane.items.map((item) => item.end)])
  return Math.min(24, Math.ceil(Math.max(18 * 60, ...ends) / 60))
})
// An empty day keeps the open-hours shape but at half height, so the empty message and Next up are not pushed off screen.
const hourPx = computed(() => (todays.value.length ? 56 : 28))
const railHeight = computed(() => (lastHour.value - firstHour.value) * hourPx.value)
const hours = computed(() => hourMarks(firstHour.value, lastHour.value - 1))
const y = (minute: number) => ((minute - firstHour.value * 60) / 60) * hourPx.value
// Short labels ("10 AM"), the same as the week view in Bookings.
const hourLabel = (hour: number) => new Date(Date.UTC(2000, 0, 1, hour)).toLocaleTimeString(undefined, { hour: 'numeric', timeZone: 'UTC' })
const blockStyle = (window: MinuteWindow) => ({ top: `${Math.max(0, y(window.start))}px`, height: `${Math.max(2, y(Math.min(window.end, lastHour.value * 60)) - Math.max(0, y(window.start)))}px` })
const placed = (lane: Lane) => placeSpans(lane.items.map((item) => ({ start: item.start, end: item.end, item })), 30)
const nowVisible = computed(() => nowMinute.value >= firstHour.value * 60 && nowMinute.value <= lastHour.value * 60)

const serviceFor = (booking: BookingRecord) => state.services.find((item) => item.id === booking.service_id)
const statusWord = (booking: BookingRecord) => (booking.status === 'completed' ? 'came' : booking.status === 'no_show' ? 'no-show' : '')
const slotClass = (entry: { start: number; end: number; item: RailBooking }) => [
  { 'is-done': entry.item.booking.status === 'completed', 'is-noshow': entry.item.booking.status === 'no_show' },
  `is-${spanSize(entry.end - entry.start)}`,
]
const slotLabel = (entry: RailBooking, lane: Lane) =>
  `${fmtTime(entry.booking.starts_at)} to ${fmtTime(entry.booking.ends_at)}, ${entry.booking.guest_name || 'Client'}, ${displayName(entry.booking.service_name)}${team.value ? `, with ${lane.label}` : ''}${statusWord(entry.booking) ? `, ${statusWord(entry.booking)}` : ''}`
const openLink = (booking: BookingRecord) => ({ path: '/bookings', query: { open: booking.id || '' } })

// ---- summary line ----
const openToday = computed(() => lanes.value.filter((lane) => lane.open.length))
const ownerHours = computed(() => lanes.value[0]?.open ?? [])
const summary = computed(() => {
  const count = todays.value.length
  const parts: string[] = []
  if (!team.value) {
    parts.push(ownerHours.value.length ? `Open ${ownerHours.value.map((item) => `${fmtMinute(item.start)} to ${fmtMinute(item.end)}`).join(' and ')}.` : 'Not open today.')
  } else {
    parts.push(openToday.value.length ? `${openToday.value.length} of ${lanes.value.length} ${lanes.value.length === 1 ? 'person' : 'people'} working.` : 'Nobody is scheduled today.')
  }
  parts.push(count ? `${count} ${count === 1 ? 'appointment' : 'appointments'}.` : 'Nothing booked yet.')
  return parts.join(' ')
})

// ---- next up ----
const nextUp = computed(() => realBookings.value
  .filter((item) => item.status === 'confirmed' && ms(item.ends_at || item.starts_at) > now.value)
  .sort((left, right) => ms(left.starts_at) - ms(right.starts_at))[0] || null)
const nextInProgress = computed(() => Boolean(nextUp.value && ms(nextUp.value.starts_at) <= now.value))
const nextWhen = computed(() => {
  const booking = nextUp.value
  if (!booking) return ''
  if (nextInProgress.value) return `In progress, until ${fmtTime(booking.ends_at)}`
  const minutes = Math.round((ms(booking.starts_at) - now.value) / 60_000)
  const time = fmtTime(booking.starts_at)
  if (onToday(booking)) return minutes < 60 ? `${time}, in ${Math.max(1, minutes)} min` : `${time} today`
  return `${new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short', timeZone: zone.value }).format(ms(booking.starts_at))}, ${time}`
})
const nextMember = computed(() => (nextUp.value && team.value ? staffForBooking(state, nextUp.value) : null))
const nextMessage = computed(() => {
  const booking = nextUp.value
  if (!booking || nextInProgress.value) return null
  const message = composeMessage('reminder24', booking, { profile: state.profile, service: serviceFor(booking), staff: nextMember.value })
  return message.whatsapp ? message : null
})

// ---- needs you ----
const pastUnmarked = computed(() => realBookings.value.filter((item) => item.status === 'confirmed' && ms(item.ends_at || item.starts_at) <= now.value).length)
const dueMessages = computed(() => {
  try {
    return messageQueue(state, { now: now.value, timezone: zone.value }).due.filter((item) => item.message.enabled !== false).length
  } catch {
    return 0
  }
})
const publicUrl = computed(() => state.profile?.public_link_url || '')
const linkExpired = computed(() => {
  const expiry = Date.parse(state.profile?.public_link_expires_at || '')
  return Boolean(publicUrl.value) && Number.isFinite(expiry) && expiry <= now.value
})
const needs = computed(() => {
  const list: Array<{ key: string; text: string; detail: string; to: string | { path: string; query?: Record<string, string>; hash?: string }; due?: boolean }> = []
  if (dueMessages.value) list.push({ key: 'messages', text: `${dueMessages.value} ${dueMessages.value === 1 ? 'message is' : 'messages are'} due`, detail: 'Reminders and thank-yous to open in your own apps', to: '/messages', due: true })
  if (pastUnmarked.value) list.push({ key: 'past', text: `${pastUnmarked.value} past ${pastUnmarked.value === 1 ? 'appointment needs' : 'appointments need'} an outcome`, detail: 'Mark whether they came, so history and insights stay right', to: { path: '/bookings', query: { tab: 'past' } } })
  if (linkExpired.value && !isDemo.value) list.push({ key: 'link', text: 'Your booking link has expired', detail: 'Guests see an expired-link page until you make a new one', to: { path: '/settings', hash: '#settings-link' } })
  return list
})

// ---- this week (Monday first) ----
const addDays = (key: string, days: number) => {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}
const week = computed(() => {
  const monday = addDays(todayKey.value, -((weekday.value + 6) % 7))
  const counts = new Map<string, number>()
  for (const booking of realBookings.value) {
    if (booking.status === 'cancelled' || !isActiveBooking(booking)) continue
    const key = localFields(booking.starts_at, zone.value).date
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const days = Array.from({ length: 7 }, (_, index) => {
    const key = addDays(monday, index)
    const date = new Date(`${key}T12:00:00.000Z`)
    return {
      key,
      label: date.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
      day: date.getUTCDate(),
      count: counts.get(key) || 0,
      today: key === todayKey.value,
      past: key < todayKey.value,
    }
  })
  const most = Math.max(1, ...days.map((item) => item.count))
  return { days, most, total: days.reduce((sum, item) => sum + item.count, 0) }
})

// ---- share ----
async function copyLink() {
  if (!publicUrl.value) return
  try {
    await copyText(publicUrl.value)
    toast?.success('Booking link copied')
  } catch {
    toast?.error('Your browser blocked copying. Open Settings to copy the link.')
  }
}
const whatsappShare = computed(() => whatsappShareUrl(`You can book a time${state.profile?.display_name ? ` with ${state.profile.display_name}` : ''} here: ${publicUrl.value}`))

// ---- first-run tour offer (inline, Live only) ----
const offerOpen = ref(!isDemo.value && !readTourSeen())
function takeTour() {
  offerOpen.value = false
  void startTour?.()
}
function dismissTour() {
  writeTourSeen()
  offerOpen.value = false
}
</script>

<template>
  <section class="today" aria-labelledby="today-title">
    <header class="today-head">
      <div class="today-heading">
        <h1 id="today-title"><span class="visually-hidden">Today, </span>{{ dateHeading }}</h1>
        <p class="today-summary">{{ summary }}</p>
      </div>
      <div class="page-header-actions">
        <details v-if="publicUrl && !linkExpired" class="menu" data-menu>
          <summary class="secondary"><AppIcon name="link" :size="16" />Share booking link</summary>
          <div class="menu-panel">
            <button type="button" @click="copyLink"><AppIcon name="copy" :size="16" />Copy link</button>
            <a :href="whatsappShare" target="_blank" rel="noopener noreferrer"><AppIcon name="messages" :size="16" />Share in WhatsApp</a>
            <a :href="publicUrl" target="_blank" rel="noopener noreferrer"><AppIcon name="external" :size="16" />Open booking page</a>
            <RouterLink :to="{ path: '/settings', hash: '#settings-link' }"><AppIcon name="settings" :size="16" />QR code and website button</RouterLink>
          </div>
        </details>
        <RouterLink class="primary" :to="{ path: '/bookings', query: { new: '1' } }"><AppIcon name="plus" :size="16" />New booking</RouterLink>
      </div>
    </header>

    <div v-if="!setup.isComplete && !isDemo" class="setup-row" role="region" aria-label="Finish setting up">
      <span class="setup-progress tnum" aria-hidden="true"><i v-for="step in setup.steps" :key="step.key" :class="{ done: step.done }" /></span>
      <div>
        <strong>Step {{ setup.completed + 1 }} of {{ setup.total }}: {{ setup.nextStep.label }}</strong>
        <p>{{ setup.nextStep.description }}</p>
      </div>
      <RouterLink class="secondary small" :to="setup.nextStep.to">{{ setup.nextStep.label }}</RouterLink>
    </div>

    <div v-if="offerOpen" class="offer-row" role="region" aria-label="Product walkthrough">
      <p><strong>New here?</strong> A short walkthrough points out where everything is. It does not change anything.</p>
      <div class="cluster">
        <button class="secondary small" type="button" @click="takeTour">Take the walkthrough</button>
        <button class="ghost small" type="button" @click="dismissTour">Not now</button>
      </div>
    </div>
    <p v-if="isDemo" class="demo-note">Sample business. You can look around; nothing here is saved.</p>

    <div class="today-layout">
      <!-- Next up comes first in the source so phones read it before the rail; on wide screens it sits at the top of the side column. -->
      <section class="panel next-panel" aria-labelledby="next-title">
        <div class="panel-head"><h2 id="next-title">{{ nextInProgress ? 'Now' : 'Next up' }}</h2></div>
        <div v-if="nextUp" class="panel-body next-body">
          <p class="next-when tnum">{{ nextWhen }}</p>
          <p class="next-who">{{ nextUp.guest_name }}</p>
          <p class="next-what">{{ displayName(nextUp.service_name) }}<template v-if="nextMember"> with {{ memberFirstName(nextMember) }}</template></p>
          <div class="next-actions">
            <a v-if="nextMessage" class="primary small" :href="nextMessage.whatsapp" target="_blank" rel="noopener noreferrer"><AppIcon name="messages" :size="16" />Open WhatsApp</a>
            <RouterLink class="secondary small" :to="openLink(nextUp)">Open booking</RouterLink>
          </div>
          <p v-if="nextMessage" class="fine">Opens in your WhatsApp with a reminder ready. You press send.</p>
        </div>
        <div v-else class="panel-body next-body">
          <p class="next-what">No upcoming appointments.</p>
          <p class="fine">New bookings from your link appear here as soon as a guest books.</p>
        </div>
      </section>

      <section class="panel rail-panel" aria-labelledby="rail-title" data-tour="tour-overview-checklist">
        <div class="panel-head">
          <h2 id="rail-title">Schedule</h2>
          <RouterLink to="/bookings">Open the week</RouterLink>
        </div>
        <p v-if="!todays.length" class="rail-empty">
          <template v-if="!openToday.length">You are not open today. <RouterLink to="/availability">Set your hours</RouterLink></template>
          <template v-else-if="publicUrl && !linkExpired">Nothing booked today yet. Share your link, or add a walk-in with New booking.</template>
          <template v-else>Nothing booked today. Add a walk-in or phone booking with New booking.</template>
        </p>
        <div class="rail-scroll">
          <div class="rail" :style="{ '--lanes': lanes.length, '--rail-height': `${railHeight}px` }">
            <div v-if="team" class="rail-corner" aria-hidden="true" />
            <div v-for="lane in team ? lanes : []" :key="`head-${lane.id}`" class="lane-head">
              <i :style="{ background: lane.color }" aria-hidden="true" /><span class="truncate">{{ lane.label }}</span>
              <small>{{ lane.items.length ? `${lane.items.length} booked` : lane.open.length ? 'Free' : 'Off' }}</small>
            </div>
            <div class="rail-axis" aria-hidden="true">
              <span v-for="hour in hours" :key="hour" :style="{ top: `${y(hour * 60)}px` }">{{ hourLabel(hour) }}</span>
            </div>
            <div v-for="lane in lanes" :key="lane.id" class="lane" :aria-label="team ? `${lane.label}'s day` : 'Your day'" role="group">
              <i v-for="hour in hours.slice(1)" :key="hour" class="hour-line" :style="{ top: `${y(hour * 60)}px` }" aria-hidden="true" />
              <i v-for="window in lane.open" :key="`open-${window.start}`" class="open-block" :style="blockStyle(window)" aria-hidden="true" />
              <RouterLink
                v-for="window in lane.off"
                :key="`off-${window.start}-${window.end}`"
                class="off-block"
                :style="blockStyle(window)"
                to="/availability"
                :aria-label="`Time off, ${fmtMinute(window.start)} to ${fmtMinute(Math.min(window.end, 1439))}`"
              ><span>Time off</span></RouterLink>
              <RouterLink
                v-for="entry in placed(lane)"
                :key="entry.item.booking.id"
                class="slot rail-slot"
                :class="slotClass(entry)"
                :style="{
                  top: `${y(entry.start)}px`,
                  height: `${Math.max(28, y(entry.end) - y(entry.start) - 2)}px`,
                  left: `calc(${(entry.column / entry.columns) * 100}% + 4px)`,
                  width: `calc(${100 / entry.columns}% - 8px)`,
                  '--slot-stem': team ? lane.color : undefined,
                  '--slot-fill': team ? `color-mix(in srgb, ${lane.color} 10%, var(--surface))` : undefined,
                }"
                :to="openLink(entry.item.booking)"
                :aria-label="slotLabel(entry.item, lane)"
              >
                <span class="tnum slot-time">{{ fmtTime(entry.item.booking.starts_at) }}</span>
                <strong class="truncate">{{ entry.item.booking.guest_name }}</strong>
                <small class="truncate">{{ displayName(entry.item.booking.service_name) }}</small>
              </RouterLink>
            </div>
            <div v-if="nowVisible" class="now-line" :style="{ top: `${y(nowMinute)}px` }" aria-hidden="true"><span class="tnum">{{ fmtMinute(nowMinute) }}</span></div>
          </div>
        </div>
      </section>

      <aside class="today-side" aria-label="Today at the desk">
        <section class="panel" aria-labelledby="needs-title">
          <div class="panel-head"><h2 id="needs-title">Needs you</h2></div>
          <ul v-if="needs.length" class="needs">
            <li v-for="item in needs" :key="item.key">
              <RouterLink :to="item.to" class="need" :class="{ due: item.due }">
                <span><strong>{{ item.text }}</strong><small>{{ item.detail }}</small></span>
                <AppIcon name="chevron" :size="16" />
              </RouterLink>
            </li>
          </ul>
          <p v-else class="panel-body caught-up"><AppIcon name="check" :size="16" />All caught up.</p>
        </section>

        <section class="panel" aria-labelledby="week-title">
          <div class="panel-head"><h2 id="week-title">This week</h2><RouterLink to="/bookings">{{ week.total }} booked</RouterLink></div>
          <ol class="week-strip">
            <li v-for="day in week.days" :key="day.key" :class="{ today: day.today, past: day.past }">
              <span class="week-bar" aria-hidden="true"><i :style="{ height: `${day.count ? Math.max(12, (day.count / week.most) * 100) : 0}%` }" /></span>
              <span class="week-day"><span>{{ day.label }}</span><b class="tnum">{{ day.day }}</b></span>
              <span class="visually-hidden">{{ day.today ? 'Today, ' : '' }}{{ day.count }} {{ day.count === 1 ? 'booking' : 'bookings' }}</span>
            </li>
          </ol>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.today { display: grid; gap: var(--space-4); }
.today-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--space-3) var(--space-5); }
.today-heading { min-width: 0; }
.today-heading h1 { margin: 0; font-size: var(--text-display); line-height: 1.1; letter-spacing: -0.025em; }
.today-summary { margin: var(--space-2) 0 0; color: var(--ink-soft); font-size: var(--text-md); }
.today-head .menu > summary { display: inline-flex; }

.setup-row, .offer-row {
  padding: var(--space-3) var(--space-4); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3) var(--space-4);
  border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 2px var(--radius) var(--radius) 2px; background: var(--surface);
}
.setup-row > div { min-width: 0; flex: 1 1 260px; }
.setup-row strong { font-size: var(--text-sm); }
.setup-row p { margin: 2px 0 0; color: var(--muted); font-size: var(--text-sm); }
.setup-progress { display: inline-flex; gap: 4px; }
.setup-progress i { width: 18px; height: 6px; border-radius: 2px; background: var(--surface-sunken); }
.setup-progress i.done { background: var(--accent); }
.offer-row { border-left-color: var(--now); justify-content: space-between; }
.offer-row p { margin: 0; font-size: var(--text-sm); }
.demo-note { margin: 0; color: var(--muted); font-size: var(--text-sm); }

/* Wide: the rail spans the left column; Next up then the other panels stack on the right. */
.today-layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; grid-template-rows: auto 1fr; gap: var(--space-4); align-items: start; }
.rail-panel { grid-column: 1; grid-row: 1 / 3; }
.next-panel { grid-column: 2; grid-row: 1; }
.today-side { grid-column: 2; grid-row: 2; display: grid; gap: var(--space-4); }

/* Rail */
.rail-panel { min-width: 0; overflow: hidden; }
.rail-scroll { overflow-x: auto; }
.rail {
  --axis-w: 64px;
  position: relative; display: grid; grid-template-columns: var(--axis-w) repeat(var(--lanes), minmax(150px, 1fr));
  grid-template-rows: auto var(--rail-height); min-width: calc(var(--axis-w) + var(--space-2) + var(--lanes) * 150px); padding: var(--space-2) var(--space-3) var(--space-4) var(--space-2);
}
.rail-corner { grid-row: 1; grid-column: 1; }
.lane-head { grid-row: 1; padding: 0 var(--space-2) var(--space-2); display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); font-weight: var(--weight-strong); min-width: 0; }
.lane-head i { width: 10px; height: 10px; flex: none; border-radius: 2px; }
.lane-head small { margin-left: auto; color: var(--muted); font-size: var(--text-xs); font-weight: var(--weight-regular); white-space: nowrap; }
/* The hour labels stay in view while the lanes scroll sideways. */
.rail-axis { position: sticky; left: 0; z-index: 4; grid-row: 2; grid-column: 1; background: var(--surface); }
.rail-axis span { position: absolute; right: 8px; color: var(--muted); font-size: var(--text-xs); font-variant-numeric: tabular-nums; transform: translateY(-50%); white-space: nowrap; }
.lane { position: relative; grid-row: 2; min-width: 0; border-left: 1px solid var(--line); }
.hour-line { position: absolute; left: 0; right: 0; height: 1px; background: var(--surface-sunken); }
.open-block { position: absolute; left: 0; right: 0; background: var(--accent-faint); }
.off-block {
  position: absolute; left: 4px; right: 4px; z-index: 1; min-height: 24px; padding: 4px 8px; overflow: hidden; color: var(--ink-soft);
  border: 1px dashed var(--line-strong); border-radius: var(--radius-sm); font-size: var(--text-xs); font-weight: var(--weight-strong); text-decoration: none;
  background: repeating-linear-gradient(135deg, var(--surface-sunken) 0 6px, var(--surface) 6px 12px);
}
.rail-slot { position: absolute; z-index: 2; padding-block: 4px; display: grid; grid-auto-rows: max-content; align-content: start; gap: 1px; overflow: hidden; text-decoration: none; font-size: var(--text-xs); line-height: 1.3; }
.rail-slot:hover { box-shadow: var(--shadow-1); }
.rail-slot > * { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail-slot strong { font-size: var(--text-sm); }
.rail-slot small { color: var(--ink-soft); }
/* Text follows the drawn length: under 45 minutes time and name on one line; under 75 minutes the service goes below them. */
.rail-slot:is(.is-short, .is-medium) { grid-template-columns: auto minmax(0, 1fr); align-items: baseline; column-gap: 6px; }
.rail-slot.is-short { padding-block: 2px; }
.rail-slot.is-short small { display: none; }
.rail-slot.is-medium small { grid-column: 1 / -1; }
.slot-time { color: var(--ink-soft); font-weight: var(--weight-strong); }
.now-line { position: absolute; left: calc(var(--axis-w) + var(--space-2)); right: var(--space-3); z-index: 3; height: 0; border-top: 2px solid var(--now); pointer-events: none; }
.now-line::before { content: ''; position: absolute; left: -5px; top: -6px; width: 10px; height: 10px; border-radius: 50%; background: var(--now); }
.now-line span { position: absolute; right: 0; top: -22px; padding: 1px 6px; color: var(--ink); border-radius: var(--radius-xs); background: var(--now); font-size: var(--text-xs); font-weight: var(--weight-strong); }
.rail-empty { margin: 0; padding: var(--space-3) var(--space-4); color: var(--ink-soft); border-bottom: 1px solid var(--line); font-size: var(--text-sm); }
.rail-empty a { color: var(--accent); font-weight: var(--weight-strong); }

/* Side panels */
.next-body { display: grid; gap: 4px; }
.next-when { margin: 0; color: var(--ink); font-size: var(--text-sm); font-weight: var(--weight-strong); }
.next-who { margin: 0; font-size: var(--text-lg); font-weight: var(--weight-strong); line-height: 1.25; overflow-wrap: anywhere; }
.next-what { margin: 0; color: var(--ink-soft); font-size: var(--text-sm); }
.next-actions { margin-top: var(--space-3); display: flex; flex-wrap: wrap; gap: var(--space-2); }
.fine { margin: var(--space-2) 0 0; color: var(--muted); font-size: var(--text-xs); }
.needs { margin: 0; padding: 0; list-style: none; }
.needs li + li { border-top: 1px solid var(--line); }
.need { min-height: 64px; padding: var(--space-3) var(--space-4); display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); color: inherit; text-decoration: none; }
.need:hover { background: var(--accent-faint); }
.need > span { min-width: 0; display: grid; gap: 2px; }
.need strong { font-size: var(--text-sm); }
.need small { color: var(--muted); font-size: var(--text-xs); }
.need > svg { flex: none; color: var(--muted); }
.need.due strong::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 8px; border-radius: 50%; background: var(--now); box-shadow: 0 0 0 3px var(--now-soft); vertical-align: 1px; }
.caught-up { margin: 0; display: flex; align-items: center; gap: var(--space-2); color: var(--success); font-size: var(--text-sm); font-weight: var(--weight-strong); }
.week-strip { margin: 0; padding: var(--space-3) var(--space-4) var(--space-4); display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; list-style: none; }
.week-strip li { display: grid; justify-items: center; gap: 6px; }
.week-bar { position: relative; width: 100%; height: 48px; display: block; border-radius: 2px; background: var(--surface-sunken); overflow: hidden; }
.week-bar i { position: absolute; left: 0; right: 0; bottom: 0; border-top: 3px solid var(--accent); background: var(--accent-soft); }
.week-day { display: grid; justify-items: center; color: var(--muted); font-size: var(--text-xs); line-height: 1.2; }
.week-day b { color: var(--ink); font-size: var(--text-sm); }
.week-strip li.today .week-day b { padding: 0 6px; border-radius: var(--radius-xs); background: var(--now); }
.week-strip li.past { opacity: 0.6; }

/* One column: source order, so Next up comes before the rail. */
@media (max-width: 1100px) {
  .today-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; }
  .rail-panel, .next-panel, .today-side { grid-column: auto; grid-row: auto; }
  .today-side { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); align-items: start; }
}
@media (max-width: 700px) {
  .today-heading h1 { font-size: var(--text-xl); }
  .today-summary { font-size: var(--text-sm); }
  .today-head .page-header-actions { width: 100%; }
  .today-head .page-header-actions > * { flex: 1 1 auto; }
  .today-head .menu > summary { width: 100%; justify-content: center; }
  .today-side { grid-template-columns: 1fr; }
  .rail { --axis-w: 52px; grid-template-columns: var(--axis-w) repeat(var(--lanes), minmax(140px, 1fr)); min-width: calc(var(--axis-w) + var(--space-2) + var(--lanes) * 140px); }
}
</style>
