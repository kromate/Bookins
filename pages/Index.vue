<script setup>
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import GmButton from '../components/ui/GmButton.vue'
import { copyText, isActiveBooking, isStaffCopy } from '../booking.js'
import { isDemo } from '../runtime.js'
import { useSetupState } from '../setup.js'
import { displayTimeZone } from '../time-display.js'
import { displayName } from '../team-ui.js'

const state = inject('bookingState')
const setup = useSetupState(state)
const toast = inject('toast', null)
const now = ref(Date.now())
const copied = ref(false)
const copyError = ref('')
let copiedTimer = 0
const clockTimer = window.setInterval(() => { now.value = Date.now() }, 30_000)

onBeforeUnmount(() => {
  window.clearInterval(clockTimer)
  window.clearTimeout(copiedTimer)
})

const schedule = computed(() => state.schedules?.[0] || null)
const scheduleZone = computed(() => displayTimeZone(schedule.value?.timezone))
const activeServiceList = computed(() =>
  (state.services || []).filter((service) => !isStaffCopy(service) && service.active !== false && service.visibility === 'public'),
)
const upcomingBookings = computed(() =>
  (state.bookings || [])
    .filter((booking) => isActiveBooking(booking) && Date.parse(booking.starts_at) > now.value)
    .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at)),
)
const nextSevenDays = computed(() => {
  const limit = now.value + 7 * 24 * 60 * 60 * 1000
  return upcomingBookings.value.filter((booking) => Date.parse(booking.starts_at) <= limit).length
})

const weeklyWindows = computed(() => {
  try {
    const parsed = JSON.parse(schedule.value?.weekly_windows_json || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
})
const weeklyHours = computed(() => {
  const minutes = weeklyWindows.value.reduce(
    (total, window) => total + Math.max(0, Number(window.endMinute) - Number(window.startMinute)),
    0,
  )
  const hours = minutes / 60
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
})
const weekdays = [
  { label: 'Monday', weekday: 1 }, { label: 'Tuesday', weekday: 2 }, { label: 'Wednesday', weekday: 3 },
  { label: 'Thursday', weekday: 4 }, { label: 'Friday', weekday: 5 }, { label: 'Saturday', weekday: 6 },
  { label: 'Sunday', weekday: 0 },
]
const availabilityRows = computed(() => weekdays.map(({ label, weekday }) => {
  const windows = weeklyWindows.value
    .filter((window) => Number(window.weekday) === weekday)
    .sort((left, right) => Number(left.startMinute) - Number(right.startMinute))
  return {
    label,
    windows: windows.map((window) => `${minuteLabel(window.startMinute)}–${minuteLabel(window.endMinute)}`),
  }
}))

const publicUrl = computed(() => state.profile?.public_link_url || '')
const linkExpired = computed(() => {
  const expiry = Date.parse(state.profile?.public_link_expires_at || '')
  return Boolean(publicUrl.value) && Number.isFinite(expiry) && expiry <= now.value
})
const dateLabel = computed(() => new Intl.DateTimeFormat(undefined, {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: scheduleZone.value,
}).format(now.value))

function minuteLabel(value) {
  const minutes = Number(value)
  const hours = Math.floor(minutes / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
function displayOptions(options) {
  return { ...options, timeZone: scheduleZone.value }
}
function bookingDate(booking) {
  return new Date(booking.starts_at).toLocaleDateString(undefined, displayOptions({ month: 'short', day: 'numeric' }))
}
function bookingTime(booking) {
  return new Date(booking.starts_at).toLocaleTimeString(undefined, displayOptions({ hour: 'numeric', minute: '2-digit' }))
}
function priceLabel(service) {
  if (!Number(service.price)) return 'Free'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: service.currency || 'NGN', maximumFractionDigits: 0,
    }).format(Number(service.price))
  } catch {
    return `${service.currency || 'NGN'} ${Number(service.price).toLocaleString()}`
  }
}
function serviceTone(index) {
  return ['indigo', 'sage', 'sand'][index % 3]
}
function statusLabel(status) {
  const value = String(status || 'confirmed')
  return value === 'no_show' ? 'No-show' : `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}
async function copyLink() {
  if (!publicUrl.value) return
  copyError.value = ''
  try {
    await copyText(publicUrl.value)
    copied.value = true
    toast?.success('Booking link copied')
    window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => { copied.value = false }, 1600)
  } catch {
    copyError.value = 'Your browser blocked copying. Select the link and copy it manually.'
    toast?.error('Could not copy the booking link')
  }
}
</script>

<template>
  <section class="owner-overview">
    <header class="overview-header">
      <div>
        <h1>Overview</h1>
        <p>{{ dateLabel }}</p>
      </div>
      <RouterLink class="primary overview-new" :to="{ path: '/bookings', query: { new: '1' } }">
        <AppIcon name="plus" :size="16" />New booking
      </RouterLink>
    </header>

    <div v-if="!setup.isComplete && !isDemo" class="overview-setup"><div><strong>Finish setting up your booking page</strong><p>{{ setup.completed }} of {{ setup.total }} steps complete. {{ setup.nextStep.description }}</p></div><RouterLink class="secondary button-link" :to="setup.nextStep.to">{{ setup.nextStep.label }}</RouterLink></div>
    <p v-if="isDemo" class="muted demo-note">Sample owner data is read-only.</p>

    <section class="metrics" data-tour="tour-overview-checklist" aria-label="Booking summary">
      <RouterLink to="/bookings" class="metric"><span>Upcoming</span><strong>{{ upcomingBookings.length }}</strong></RouterLink>
      <RouterLink to="/bookings" class="metric"><span>Next 7 days</span><strong>{{ nextSevenDays }}</strong></RouterLink>
      <RouterLink to="/services" class="metric"><span>Active services</span><strong>{{ activeServiceList.length }}</strong></RouterLink>
      <RouterLink to="/availability" class="metric"><span>Weekly hours</span><strong>{{ weeklyHours }}</strong></RouterLink>
    </section>

    <div class="overview-dashboard">
      <section class="overview-section bookings-section">
        <div class="section-head">
          <h2>Upcoming bookings</h2>
          <RouterLink to="/bookings">View calendar</RouterLink>
        </div>
        <div v-if="upcomingBookings.length" class="table-wrap">
          <table class="booking-table">
            <thead><tr><th>Client</th><th>Date &amp; time</th><th>Service</th><th>Status</th></tr></thead>
            <tbody>
              <tr v-for="(booking, index) in upcomingBookings.slice(0, 4)" :key="booking.id">
                <td><RouterLink :to="{ path: '/bookings', query: { q: booking.reference || booking.guest_name } }">{{ booking.guest_name }}</RouterLink></td>
                <td class="date">{{ bookingDate(booking) }} · {{ bookingTime(booking) }}</td>
                <td><span class="service"><i :class="serviceTone(index)" />{{ displayName(booking.service_name) }}</span></td>
                <td><span class="status-badge" :class="booking.status"><i />{{ statusLabel(booking.status) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="overview-empty">
          <strong>No upcoming bookings</strong>
          <span>Your next confirmed appointment will appear here.</span>
          <RouterLink to="/bookings">Open bookings</RouterLink>
        </div>
      </section>

      <section class="overview-section availability-section">
        <div class="section-head">
          <h2>Availability</h2>
          <RouterLink class="compact-action" to="/availability">Edit availability</RouterLink>
        </div>
        <div class="availability-list">
          <div v-for="day in availabilityRows" :key="day.label" class="availability-row" :class="{ closed: !day.windows.length }">
            <span>{{ day.label }}</span><span>{{ day.windows.length ? day.windows.join(', ') : 'Closed' }}</span>
          </div>
        </div>
        <p class="timezone">{{ scheduleZone }}</p>
      </section>
    </div>

    <div class="overview-lower">
      <section class="overview-section services-section">
        <div class="section-head">
          <h2>Services at a glance</h2>
          <RouterLink to="/services">Manage services</RouterLink>
        </div>
        <div v-if="activeServiceList.length">
          <div v-for="service in activeServiceList.slice(0, 4)" :key="service.id" class="service-row">
            <strong>{{ displayName(service.name) }}</strong>
            <span>{{ service.duration_minutes }} min</span>
            <span>{{ priceLabel(service) }}</span>
            <span class="active">Active</span>
          </div>
        </div>
        <div v-else class="overview-empty compact-empty">
          <strong>No active services</strong><RouterLink to="/services">Add a service</RouterLink>
        </div>
      </section>

      <aside class="overview-section link-card" id="booking-link">
        <h2>Booking link</h2>
        <p>{{ isDemo ? 'Sample preview URL' : linkExpired ? 'This link has expired' : publicUrl ? 'Ready to share' : 'Create your public page' }}</p>
        <input v-if="publicUrl" class="url" type="text" readonly :value="publicUrl" aria-label="Booking link" @focus="$event.target.select()" />
        <div v-if="publicUrl" class="link-actions">
          <GmButton variant="secondary" size="sm" @click="copyLink"><template #leading><AppIcon name="copy" :size="15" /></template>{{ copied ? 'Copied' : 'Copy link' }}</GmButton>
          <a v-if="!linkExpired" class="secondary compact-action" :href="publicUrl" target="_blank" rel="noreferrer"><AppIcon name="external" :size="15" />View page</a>
          <RouterLink v-else class="secondary compact-action" to="/settings">Create new link</RouterLink>
        </div>
        <RouterLink v-else :to="isDemo ? '/demo/guest' : '/settings'" class="secondary compact-action">{{ isDemo ? 'Open guest preview' : 'Create booking link' }}</RouterLink>
        <p v-if="copyError" class="notice error" role="alert">{{ copyError }}</p>
        <div class="readiness"><strong>Client messages</strong><br />Prepare a message after booking. You choose when to send it.</div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.owner-overview { display: grid; gap: 16px; color: #20242d; font-size: 13px; }
.overview-header { min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid #e5e7eb; }
.overview-header h1 { margin: 0; font-size: 24px; line-height: 1.2; letter-spacing: -.025em; }
.overview-header p { margin: 4px 0 0; color: #707580; font-size: 13px; }
.overview-new { min-height: 40px; padding: 0 14px; display: inline-flex; align-items: center; gap: 7px; border-radius: 7px; text-decoration: none; }
.demo-note { margin: 0; }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: hidden; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; }
.metric { min-height: 76px; padding: 14px 16px; display: block; color: inherit; border-right: 1px solid #e5e7eb; text-decoration: none; }
.metric:last-child { border-right: 0; }
.metric span { display: block; color: #707580; font-size: 12px; }
.metric strong { display: block; margin-top: 4px; font-size: 22px; letter-spacing: -.03em; }
.overview-dashboard, .overview-lower { display: grid; grid-template-columns: minmax(0, 2fr) 320px; gap: 16px; }
.overview-section { min-width: 0; overflow: hidden; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; }
.section-head { min-height: 54px; padding: 0 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid #e5e7eb; }
.section-head h2, .link-card h2 { margin: 0; font-size: 16px; letter-spacing: -.015em; }
.section-head a { display: inline-flex; align-items: center; color: #2336dc; font-size: 12px; font-weight: 650; text-decoration: none; }
.table-wrap { overflow-x: auto; }
.booking-table { width: 100%; min-width: 660px; border-collapse: collapse; table-layout: fixed; }
.booking-table th { height: 34px; padding: 0 16px; color: #969ba5; text-align: left; font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.booking-table td { height: 56px; padding: 0 16px; border-top: 1px solid #e5e7eb; }
.booking-table th:nth-child(1) { width: 30%; }.booking-table th:nth-child(2) { width: 27%; }.booking-table th:nth-child(3) { width: 25%; }.booking-table th:nth-child(4) { width: 18%; }
.booking-table td > a { color: #20242d; font-weight: 680; text-decoration: none; }
.booking-table .date { color: #707580; font-variant-numeric: tabular-nums; }
.service { display: flex; align-items: center; gap: 8px; color: #4d5460; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.service i { width: 8px; height: 8px; flex: none; border-radius: 2px; background: #6574e8; }.service i.sage { background: #59926f; }.service i.sand { background: #b77a46; }
.status-badge { padding: 4px 8px; display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; color: #247552; background: #eaf6ef; font-size: 11px; font-weight: 700; }
.status-badge i { width: 6px; height: 6px; border-radius: 50%; background: #38a169; }.status-badge.cancelled, .status-badge.no_show { color: #707580; background: #f1f2f4; }.status-badge.cancelled i, .status-badge.no_show i { background: #969ba5; }
.availability-list { padding: 7px 16px 0; }
.availability-row { min-height: 38px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid #f0f1f3; color: #4e5560; }
.availability-row:last-child { border-bottom: 0; }.availability-row span:last-child { color: #707580; text-align: right; font-variant-numeric: tabular-nums; }.availability-row.closed span:last-child { color: #969ba5; }
.timezone { margin: 8px 16px 13px; color: #969ba5; font-size: 11px; }
.services-section { padding-bottom: 2px; }
.service-row { min-height: 44px; padding: 0 16px; display: grid; grid-template-columns: minmax(0, 1.45fr) .75fr .85fr .55fr; align-items: center; gap: 10px; border-top: 1px solid #e5e7eb; font-size: 12px; }
.service-row > span { color: #707580; }.service-row strong { overflow: hidden; font-size: 13px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }.service-row .active { color: #247552; font-weight: 650; }
.link-card { padding: 15px 16px; }.link-card > p { margin: 4px 0 12px; color: #707580; font-size: 12px; }
.url { width: 100%; height: 38px; padding: 0 10px; overflow: hidden; border: 1px solid #e5e7eb; border-radius: 7px; color: #3e4652; background: #f5f6f8; font-family: var(--font-mono); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.link-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.compact-action { min-height: 38px; padding: 0 11px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid #d5d8de; border-radius: 7px; color: #353a45; background: #fff; font-weight: 650; text-decoration: none; }
.readiness { margin-top: 10px; padding: 10px 12px; border-left: 3px solid #c7cdd8; border-radius: 0 7px 7px 0; background: #f8f9fb; color: #5e6470; font-size: 12px; line-height: 1.45; }.readiness strong { color: #414854; }
.overview-empty { min-height: 230px; padding: 28px; display: grid; place-content: center; justify-items: center; gap: 7px; color: #707580; text-align: center; }.overview-empty strong { color: #20242d; font-size: 14px; }.overview-empty a { color: #2336dc; font-weight: 650; }.compact-empty { min-height: 130px; }
@media (max-width: 1080px) { .overview-dashboard, .overview-lower { grid-template-columns: 1fr; }.availability-section, .link-card { width: 100%; }.metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }.metric:nth-child(2) { border-right: 0; }.metric:nth-child(-n+2) { border-bottom: 1px solid #e5e7eb; } }
@media (max-width: 700px) { .overview-header { align-items: flex-start; flex-direction: column; padding-bottom: 16px; }.overview-new { width: 100%; justify-content: center; }.metrics { grid-template-columns: 1fr 1fr; }.metric { min-height: 68px; padding: 12px; }.metric strong { font-size: 20px; }.service-row { grid-template-columns: minmax(0, 1.2fr) .65fr .8fr; }.service-row .active { display: none; } }
.overview-setup{margin:0 0 16px;padding:16px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;border:1px solid var(--line);border-radius:8px;background:white}.overview-setup strong{font-size:14px}.overview-setup p{margin:4px 0 0;color:var(--muted);font-size:13px}
</style>
