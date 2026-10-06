<script setup>
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmHint from '../components/ui/GmHint.vue'
import { useSetupState } from '../setup.js'
import { copyText, isActiveBooking, isActiveTimeOff, setBookingStatus } from '../booking.js'
import { composeMessage } from '../messaging.js'
import { isDemo } from '../runtime.js'
import { displayTimeZone, zonedDateKey } from '../time-display.js'

const state = inject('bookingState')
const refresh = inject('refreshBookings', async () => true)
const router = useRouter()
const setup = useSetupState()
const startTour = inject('startTour', null)
const copied = ref(false)
const toast = inject('toast', null)
const now = ref(Date.now())
const clockTimer = window.setInterval(() => { now.value = Date.now() }, 30_000)
let copiedTimer = 0
onBeforeUnmount(() => {
  window.clearInterval(clockTimer)
  window.clearTimeout(copiedTimer)
})
const copyError = ref('')
const scheduleZone = computed(() => displayTimeZone(state.schedules[0]?.timezone))

const activeServices = computed(
  () =>
    state.services.filter((item) => item.active !== false && item.visibility === 'public').length,
)
const upcomingBookings = computed(() =>
  state.bookings
    .filter((item) => isActiveBooking(item) && Date.parse(item.starts_at) > now.value)
    .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at)),
)
const thisMonthBookings = computed(() => {
  const monthOf = (value) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: scheduleZone.value, year: 'numeric', month: '2-digit' }).format(value)
  const current = monthOf(new Date(now.value))
  return state.bookings.filter(
    (item) => isActiveBooking(item) && monthOf(new Date(item.starts_at)) === current,
  ).length
})
const openDays = computed(() => {
  try {
    return new Set(
      JSON.parse(state.schedules[0]?.weekly_windows_json || '[]').map((item) => item.weekday),
    ).size
  } catch {
    return 0
  }
})
const publicUrl = computed(() => state.profile?.public_link_url || '')
const linkExpired = computed(() => {
  const expiry = Date.parse(state.profile?.public_link_expires_at || '')
  return Boolean(publicUrl.value) && Number.isFinite(expiry) && expiry <= now.value
})
const linkActive = computed(() => Boolean(publicUrl.value) && !linkExpired.value)
const setupSteps = computed(() => isDemo.value
  ? [
      { label: 'Review the sample profile', done: true, to: '/settings' },
      { label: 'Review sample availability', done: true, to: '/availability' },
      { label: 'Review sample services', done: true, to: '/services' },
      { label: 'Guest preview available', done: true, to: '/demo/guest' },
    ]
  : setup.value.steps.map((step) => ({
      ...step,
      // A locked step points at the step that unlocks it.
      to: step.key === 'service' && step.lockedReason ? '/availability' : step.to,
    })))
const completedSteps = computed(() => setupSteps.value.filter((step) => step.done).length)
const setupProgress = computed(() => (completedSteps.value / setupSteps.value.length) * 100)
const nextStep = computed(() => {
  if (isDemo.value) return setupSteps.value.find((step) => !step.done) || { label: 'Open guest preview', to: '/demo/guest', description: '' }
  const next = setup.value.nextStep
  // The service step is blocked until hours exist, but the checklist order already puts availability first.
  return { ...next, to: next.key === 'service' && !setup.value.hasAvailability ? '/availability' : next.to }
})
const newService = () => router.push({ path: '/services', query: { new: '1' } })

const todayKey = computed(() => zonedDateKey(now.value, scheduleZone.value))
const tomorrowKey = computed(() => {
  const [year, month, day] = todayKey.value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
})
const byStart = (left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at)
const dayKey = (value) => zonedDateKey(value, scheduleZone.value)
const todayBookings = computed(() =>
  state.bookings.filter((item) => isActiveBooking(item) && dayKey(item.starts_at) === todayKey.value).sort(byStart),
)
const tomorrowBookings = computed(() =>
  state.bookings
    .filter((item) => item.status === 'confirmed' && dayKey(item.starts_at) === tomorrowKey.value)
    .sort(byStart),
)
const timeOffOn = (key) =>
  state.bookings.some(
    (item) => isActiveTimeOff(item) && dayKey(item.starts_at) <= key && key <= dayKey(item.ends_at || item.starts_at),
  )
const timeOffToday = computed(() => timeOffOn(todayKey.value))
const timeOffTomorrow = computed(() => timeOffOn(tomorrowKey.value))

// Reminders are opened in the owner's own WhatsApp, SMS, or mail app. "Reminded" is a per-session memory aid only.
const reminded = ref(new Set())
function toggleReminded(booking, checked) {
  const next = new Set(reminded.value)
  if (checked) next.add(booking.id)
  else next.delete(booking.id)
  reminded.value = next
}
function reminderFor(booking) {
  const service = state.services.find((item) => item.id === booking.service_id)
  return composeMessage('reminder', booking, {
    profile: state.profile,
    service,
    bookingLink: state.profile?.public_link_url || '',
  })
}
const reminders = computed(() => tomorrowBookings.value.map((booking) => ({ booking, message: reminderFor(booking) })))

const statusBusy = ref('')
const statusError = ref('')
const hasStarted = (booking) => Date.parse(booking.starts_at) <= now.value
async function markStatus(booking, status) {
  if (isDemo.value || statusBusy.value) return
  statusBusy.value = booking.id
  statusError.value = ''
  try {
    await setBookingStatus(booking, status)
    await refresh()
    toast?.success(status === 'completed' ? `Marked ${booking.guest_name} as completed` : `Marked ${booking.guest_name} as no-show`)
  } catch (reason) {
    statusError.value = reason?.message || 'The booking status could not be saved.'
    toast?.error(statusError.value)
  } finally {
    statusBusy.value = ''
  }
}
const statusLabel = { confirmed: 'Confirmed', completed: 'Completed', no_show: 'No-show' }
const statusClass = (status) => String(status || '').replace('_', '-')
const setupComplete = computed(() => completedSteps.value === setupSteps.value.length)

const zone = () => scheduleZone.value
const displayTimeOptions = (options, booking) => ({ ...options, timeZone: zone(booking) })

function formatDate(booking) {
  return new Date(booking.starts_at).toLocaleDateString(undefined, displayTimeOptions({
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }, booking))
}

function formatTime(booking) {
  return new Date(booking.starts_at).toLocaleTimeString(undefined, displayTimeOptions({ hour: 'numeric', minute: '2-digit' }, booking))
}

async function copyLink() {
  copyError.value = ''
  try {
    await copyText(publicUrl.value)
    copied.value = true
    toast?.success('Booking link copied')
    window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => {
      copied.value = false
    }, 1600)
  } catch {
    copyError.value = 'Your browser blocked copying. Select the link and copy it manually.'
    toast?.error('Could not copy the link. Select it and copy manually.')
  }
}
</script>

<template>
  <section class="overview">
    <div class="page-header">
      <div>
        <p class="eyebrow">Workspace overview</p>
        <h1>Run your booking day with less back-and-forth.</h1>
        <p class="lede">{{ isDemo ? 'Review the prepared owner workspace, then open a labelled guest preview.' : 'Set your hours, share one link, and keep every confirmed appointment in view.' }}</p>
      </div>
      <div class="page-header-actions">
        <RouterLink v-if="isDemo" class="secondary" to="/services">
          <AppIcon name="plus" :size="17" />View services
        </RouterLink>
        <GmButton v-else @click="newService">
          <template #leading><AppIcon name="plus" :size="17" /></template>New service
        </GmButton>
      </div>
    </div>

    <div v-if="timeOffToday || timeOffTomorrow" class="notice warning" role="status">
      <AppIcon name="clock" :size="18" />
      <span>Time off {{ timeOffToday && timeOffTomorrow ? 'today and tomorrow' : timeOffToday ? 'today' : 'tomorrow' }}. Guests cannot book those times.
        <RouterLink to="/bookings">Review</RouterLink></span>
    </div>

    <div class="stat-grid stagger" data-tour="tour-overview-stats">
      <RouterLink class="card stat-tile" to="/services">
        <span class="label">Active services</span>
        <span class="icon-tile"><AppIcon name="services" :size="18" /></span>
        <p class="metric tnum">{{ activeServices }}</p>
        <p class="metric-sub">{{ activeServices ? 'Ready to book' : 'None yet' }}</p>
      </RouterLink>
      <RouterLink class="card stat-tile" to="/bookings">
        <span class="label">Upcoming</span>
        <span class="icon-tile success"><AppIcon name="bookings" :size="18" /></span>
        <p class="metric tnum">{{ upcomingBookings.length }}</p>
        <p class="metric-sub">Confirmed appointments</p>
      </RouterLink>
      <RouterLink class="card stat-tile" to="/bookings">
        <span class="label">This month</span>
        <span class="icon-tile warning"><AppIcon name="calendar" :size="18" /></span>
        <p class="metric tnum">{{ thisMonthBookings }}</p>
        <p class="metric-sub">{{ state.schedules[0] ? `Bookings in ${scheduleZone}` : 'Set your hours to begin' }}</p>
      </RouterLink>
      <RouterLink class="card stat-tile" to="/availability">
        <span class="label">Open weekdays</span>
        <span class="icon-tile info"><AppIcon name="availability" :size="18" /></span>
        <p class="metric tnum">{{ openDays }}</p>
        <p class="metric-sub">{{ state.schedules[0] ? scheduleZone : 'No timezone set' }}</p>
      </RouterLink>
    </div>

    <div class="grid grid-2 day-panels">
      <article class="card day-card">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Today</p>
            <h2>Today's bookings</h2>
            <p class="tz-label muted">{{ todayKey }} · {{ scheduleZone }}</p>
          </div>
        </div>
        <p v-if="statusError" class="notice error" role="alert">{{ statusError }}</p>
        <ul v-if="todayBookings.length" class="day-list">
          <li v-for="booking in todayBookings" :key="booking.id">
            <span class="day-time tnum">{{ formatTime(booking) }}</span>
            <span class="upcoming-copy"><strong>{{ booking.guest_name }}</strong><small>{{ booking.service_name }} · {{ statusLabel[booking.status] }}</small></span>
            <span v-if="booking.status === 'confirmed' && hasStarted(booking)" class="day-actions">
              <GmButton variant="secondary" size="sm" :disabled-reason="isDemo ? 'The demo is read-only.' : ''" :disabled="Boolean(statusBusy)" @click="markStatus(booking, 'completed')">Mark completed</GmButton>
              <GmButton variant="ghost" size="sm" class="delete-link" :disabled-reason="isDemo ? 'The demo is read-only.' : ''" :disabled="Boolean(statusBusy)" @click="markStatus(booking, 'no_show')">Mark no-show</GmButton>
            </span>
          </li>
        </ul>
        <div v-else class="empty compact">
          <span class="empty-icon"><AppIcon name="calendar" :size="20" /></span>
          <p>No bookings today.</p>
          <RouterLink v-if="!isDemo && !setup.isComplete" class="secondary small-button" :to="nextStep.to">{{ nextStep.label }}</RouterLink>
          <RouterLink v-else-if="!isDemo && publicUrl" class="secondary small-button" to="/settings">Share your booking link</RouterLink>
        </div>
      </article>

      <article class="card day-card">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Tomorrow</p>
            <h2>Reminder queue <GmHint text="Bookins does not send reminders for you. For each booking tomorrow, it prepares a message and opens it in your own WhatsApp, SMS or email app so you press send yourself." label="About reminders" /></h2>
            <p class="tz-label muted">{{ tomorrowKey }} · Opens your own WhatsApp, SMS, or mail app. Bookins does not send.</p>
          </div>
        </div>
        <ul v-if="reminders.length" class="day-list">
          <li v-for="{ booking, message } in reminders" :key="booking.id" class="reminder-row">
            <span class="day-time tnum">{{ formatTime(booking) }}</span>
            <span class="upcoming-copy"><strong>{{ booking.guest_name }}</strong><small>{{ booking.service_name }}</small></span>
            <span class="day-actions">
              <a v-if="message.whatsapp" class="primary small-button" :href="message.whatsapp" target="_blank" rel="noreferrer">Open WhatsApp</a>
              <a v-if="message.sms" class="secondary small-button" :href="message.sms">SMS</a>
              <a v-if="message.email" class="secondary small-button" :href="message.email">Email</a>
              <small v-if="!message.whatsapp && !message.sms && !message.email" class="muted">No usable phone or email</small>
            </span>
            <label class="reminded"><input type="checkbox" :checked="reminded.has(booking.id)" @change="toggleReminded(booking, $event.target.checked)" />Marked as reminded (this session only)</label>
          </li>
        </ul>
        <div v-else class="empty compact">
          <span class="empty-icon"><AppIcon name="clock" :size="20" /></span>
          <p>No confirmed bookings tomorrow. Reminders for tomorrow's guests will appear here.</p>
        </div>
      </article>
    </div>

    <div class="dashboard-grid">
      <article class="card next-card">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Up next</p>
            <h2>Upcoming bookings</h2>
            <p class="tz-label muted">Times shown in {{ scheduleZone }}</p>
          </div>
          <RouterLink to="/bookings">View all <AppIcon name="chevron" :size="14" /></RouterLink>
        </div>
        <div v-if="upcomingBookings.length" class="list">
          <RouterLink v-for="booking in upcomingBookings.slice(0, 3)" :key="booking.id" class="list-row upcoming-row" to="/bookings">
            <span class="date-tile">
              <strong>{{ new Date(booking.starts_at).toLocaleDateString(undefined, displayTimeOptions({ day: 'numeric' }, booking)) }}</strong>
              <small>{{ new Date(booking.starts_at).toLocaleDateString(undefined, displayTimeOptions({ month: 'short' }, booking)) }}</small>
            </span>
            <span class="list-row-main">
              <strong>{{ booking.service_name }}</strong>
              <span>{{ booking.guest_name }} · {{ formatDate(booking) }}</span>
            </span>
            <span class="list-row-end">
              <span class="upcoming-time tnum" :title="zone(booking)">{{ formatTime(booking) }}</span>
              <span class="chip" :class="statusClass(booking.status)">{{ statusLabel[booking.status] || booking.status }}</span>
              <AppIcon name="chevron" :size="16" />
            </span>
          </RouterLink>
        </div>
        <div v-else class="empty compact">
          <span class="empty-icon"><AppIcon name="calendar" :size="20" /></span>
          <h2>No upcoming bookings</h2>
          <p>Your next confirmed appointment will appear here.</p>
          <RouterLink v-if="!isDemo && !setup.isComplete" class="primary small" :to="nextStep.to">{{ nextStep.label }}</RouterLink>
          <RouterLink v-else-if="!isDemo" class="secondary small-button" to="/bookings">Open bookings</RouterLink>
        </div>
      </article>

      <aside class="dashboard-side">
        <article v-if="setupComplete" class="card ready-card" data-tour="tour-overview-checklist">
          <span class="icon-tile success"><AppIcon name="check" :size="18" /></span>
          <div class="ready-copy">
            <h2>{{ isDemo ? 'Demo is ready to explore' : 'You are ready to book' }}</h2>
            <RouterLink :to="nextStep.to">{{ isDemo ? nextStep.label : 'View booking link' }} <AppIcon name="chevron" :size="14" /></RouterLink>
            <button v-if="startTour" class="link-button" type="button" @click="startTour()">Replay the tour</button>
          </div>
        </article>
        <article v-else class="card setup-card" data-tour="tour-overview-checklist">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Launch checklist</p>
              <h2>{{ completedSteps }} of {{ setupSteps.length }} complete</h2>
            </div>
            <span class="progress-number tnum">{{ Math.round(setupProgress) }}%</span>
          </div>
          <div class="progress-track" aria-hidden="true"><span :style="{ width: `${setupProgress}%` }" /></div>
          <div class="setup-list">
            <RouterLink v-for="step in setupSteps" :key="step.label" :to="step.to" :class="{ done: step.done, current: !isDemo && !step.done && step.key === nextStep.key }" :aria-current="!isDemo && !step.done && step.key === nextStep.key ? 'step' : undefined">
              <span><AppIcon :name="step.done ? 'check' : 'chevron'" :size="14" /></span>
              <span class="step-text">{{ step.label }}<small v-if="step.lockedReason && !step.done">{{ step.lockedReason }}: set your hours first</small></span>
              <span v-if="step.done" class="visually-hidden">Done</span>
            </RouterLink>
          </div>
          <p v-if="!isDemo && nextStep.description" class="next-description"><strong>Next:</strong> {{ nextStep.description }}</p>
          <RouterLink class="primary setup-action" :to="nextStep.to">{{ nextStep.label }}<AppIcon name="chevron" :size="14" /></RouterLink>
        </article>

        <article class="card link-card">
          <span class="icon-tile"><AppIcon name="link" :size="20" /></span>
          <div>
            <p class="eyebrow">Booking link</p>
            <h2>{{ isDemo ? 'Guest preview is ready' : linkExpired ? 'Your link has expired' : publicUrl ? 'Ready to share' : 'Create your public page' }}</h2>
            <p class="muted">{{ isDemo ? 'Explore fictional services and times without creating a public link.' : 'Guests only see the services and times you make available.' }}</p>
          </div>
          <template v-if="linkExpired">
            <p class="muted">Guests opening this link now see an expired-link page.</p>
            <RouterLink class="primary" to="/settings">Create new link<AppIcon name="chevron" :size="15" /></RouterLink>
          </template>
          <template v-else-if="publicUrl">
            <div class="link-row">
              <input class="input" type="text" readonly :value="publicUrl" aria-label="Booking link" @focus="$event.target.select()" />
              <button class="secondary icon-button" type="button" :aria-label="copied ? 'Copied' : 'Copy link'" @click="copyLink">
                <AppIcon :name="copied ? 'check' : 'copy'" :size="18" />
              </button>
            </div>
            <p v-if="copyError" class="notice error" role="alert">{{ copyError }}</p>
            <a class="secondary" :href="publicUrl" target="_blank" rel="noreferrer">Preview<AppIcon name="external" :size="15" /></a>
          </template>
          <RouterLink v-else :class="isDemo ? 'secondary' : 'primary'" :to="isDemo ? '/demo/guest' : '/settings'">
            {{ isDemo ? 'Open guest preview' : 'Create booking link' }}<AppIcon name="chevron" :size="15" />
          </RouterLink>
        </article>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.overview { display: grid; gap: var(--space-4); }
.overview .page-header { margin-bottom: 0; }
.notice a { margin-left: 6px; color: var(--accent); font-weight: 700; }
.stat-tile { min-width: 0; }
.stat-tile .label { align-self: center; }
.day-card .section-heading { margin-bottom: var(--space-3); }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-4); }
.section-heading .eyebrow { margin-bottom: 4px; }
.section-heading h2 { margin: 0; font-size: var(--text-lg); }
.section-heading > a { min-height: 40px; display: flex; align-items: center; gap: 3px; color: var(--accent); font-size: var(--text-sm); font-weight: 700; text-decoration: none; }
.tz-label { margin: 4px 0 0; font-size: var(--text-xs); }
.day-list { margin: 0; padding: 0; display: grid; list-style: none; }
.day-list li { padding: var(--space-3) 0; display: grid; grid-template-columns: 76px minmax(0, 1fr) auto; align-items: center; gap: var(--space-3); border-bottom: 1px solid var(--line); }
.day-list li:last-child { border: 0; }
.day-time { color: var(--ink-soft); font-size: var(--text-sm); font-weight: 700; }
.day-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); justify-content: flex-end; }
.day-actions a { display: inline-flex; align-items: center; text-decoration: none; }
.delete-link { color: var(--danger); }
.day-actions :deep(.delete-link) { --button-fg: var(--danger); }
.reminded { grid-column: 2 / -1; display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: var(--text-xs); }
.upcoming-copy { min-width: 0; display: grid; gap: 2px; }
.upcoming-copy strong, .upcoming-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upcoming-copy strong { font-size: var(--text-md); }
.upcoming-copy small { color: var(--muted); font-size: var(--text-sm); }
.dashboard-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.75fr); gap: var(--space-4); }
.dashboard-side { display: grid; align-content: start; gap: var(--space-4); }
.upcoming-row { min-height: 78px; }
.date-tile { width: 48px; height: 52px; flex: none; display: grid; place-items: center; align-content: center; color: var(--accent); border-radius: 11px; background: var(--accent-soft); }
.date-tile strong { font-size: 18px; line-height: 1; }
.date-tile small { margin-top: 3px; font-size: var(--text-xs); font-weight: 800; text-transform: uppercase; }
.upcoming-time { color: var(--ink-soft); font-size: var(--text-sm); font-weight: 700; }
.list-row-end > svg { color: var(--muted); }
.progress-number { color: var(--accent); font-size: var(--text-md); font-weight: 800; }
.progress-track { height: 8px; margin: -4px 0 var(--space-4); overflow: hidden; border-radius: 99px; background: #e6e9f2; }
.progress-track span { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width var(--dur-panel) var(--ease); }
.setup-list { display: grid; margin-bottom: var(--space-4); }
.setup-list a { min-height: 44px; display: flex; align-items: center; gap: var(--space-3); color: var(--ink-soft); border-bottom: 1px solid var(--line); font-size: var(--text-sm); text-decoration: none; }
.setup-list a > span { width: 24px; height: 24px; display: grid; place-items: center; color: var(--muted); border: 1px solid var(--line); border-radius: 50%; }
.setup-list a.done { color: var(--muted); }
.setup-list a.done > span { color: var(--success); border-color: var(--success); background: var(--success-soft); }
.setup-action { width: 100%; justify-content: space-between; }
.setup-list a > .step-text { width: auto; height: auto; display: grid; gap: 1px; border: 0; border-radius: 0; background: none; color: inherit; place-items: start; }
.setup-list a > .step-text small { color: var(--muted); font-size: var(--text-xs); }
.setup-list a.current { color: var(--ink); font-weight: 700; }
.setup-list a.current > span:first-child { color: var(--accent); border-color: var(--accent); }
.next-description { margin: 0 0 var(--space-3); color: var(--muted); font-size: var(--text-sm); line-height: 1.45; }
.link-button { padding: 0; width: fit-content; min-height: 32px; color: var(--muted); border: 0; background: none; font-size: var(--text-xs); text-decoration: underline; cursor: pointer; }
.empty.compact .small-button, .empty.compact .small { margin-top: var(--space-2); }
.section-heading h2 :deep(.gm-hint) { vertical-align: middle; }
.ready-card { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4) var(--space-5); border-color: var(--success); background: var(--success-soft); }
.ready-copy { min-width: 0; display: grid; gap: 2px; }
.ready-copy h2 { margin: 0; font-size: var(--text-md); }
.ready-copy a { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); font-size: var(--text-sm); font-weight: 700; text-decoration: none; }
.link-card { display: grid; gap: var(--space-3); }
.link-card h2 { margin: 0 0 4px; font-size: var(--text-lg); }
.link-card .muted { margin: 0; font-size: var(--text-sm); }
.link-row { display: flex; gap: var(--space-2); }
.link-row .input { min-width: 0; flex: 1; font-family: var(--font-mono); font-size: var(--text-sm); text-overflow: ellipsis; }
.icon-button { width: var(--control-h); padding: 0; flex: none; }
.link-card > .primary, .link-card > .secondary { width: 100%; }
@media (max-width: 1120px) {
  .dashboard-grid { grid-template-columns: 1fr; }
  .dashboard-side { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 700px) {
  .dashboard-side { grid-template-columns: 1fr; }
  .day-list li { grid-template-columns: 64px minmax(0, 1fr); }
  .day-actions { grid-column: 1 / -1; justify-content: flex-start; }
  .reminded { grid-column: 1 / -1; }
  .upcoming-row .chip { display: none; }
}
</style>
