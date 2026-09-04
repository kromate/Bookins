<script setup>
import { computed, inject, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { copyText } from '../booking.js'

const state = inject('bookingState')
const copied = ref(false)
const now = Date.now()

const activeServices = computed(() => state.services.filter(item => item.active !== false && item.visibility === 'public').length)
const upcomingBookings = computed(() => state.bookings
  .filter(item => item.status !== 'cancelled' && Date.parse(item.starts_at) > now)
  .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at)))
const thisMonthBookings = computed(() => {
  const today = new Date()
  return state.bookings.filter(item => {
    const date = new Date(item.starts_at)
    return item.status !== 'cancelled' && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear()
  }).length
})
const openDays = computed(() => {
  try { return new Set(JSON.parse(state.schedules[0]?.weekly_windows_json || '[]').map(item => item.weekday)).size } catch { return 0 }
})
const publicUrl = computed(() => state.profile?.public_link_url || '')
const setupSteps = computed(() => [
  { label: 'Complete your public profile', done: Boolean(state.profile), to: '/settings' },
  { label: 'Set your weekly availability', done: Boolean(state.schedules.length), to: '/availability' },
  { label: 'Create an active service', done: Boolean(activeServices.value), to: '/services' },
  { label: 'Publish your booking link', done: Boolean(publicUrl.value), to: '/settings' },
])
const completedSteps = computed(() => setupSteps.value.filter(step => step.done).length)
const setupProgress = computed(() => completedSteps.value / setupSteps.value.length * 100)
const nextStep = computed(() => setupSteps.value.find(step => !step.done) || { label: 'Review your booking page', to: '/settings' })

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

async function copyLink() {
  await copyText(publicUrl.value)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 1600)
}
</script>

<template>
  <section>
    <div class="page-header dashboard-header">
      <div>
        <p class="eyebrow">Workspace overview</p>
        <h1>Run your booking day with less back-and-forth.</h1>
        <p class="lede">Set your hours, share one link, and keep every confirmed appointment in view.</p>
      </div>
      <RouterLink class="primary" to="/services"><AppIcon name="plus" :size="17" />New service</RouterLink>
    </div>

    <div class="grid grid-4 metrics">
      <article class="card metric-card"><span class="metric-icon blue"><AppIcon name="services" :size="18" /></span><div><span class="label">Active services</span><div class="metric">{{ activeServices }}</div><p class="metric-sub">Ready to book</p></div></article>
      <article class="card metric-card"><span class="metric-icon green"><AppIcon name="bookings" :size="18" /></span><div><span class="label">Upcoming</span><div class="metric">{{ upcomingBookings.length }}</div><p class="metric-sub">Confirmed appointments</p></div></article>
      <article class="card metric-card"><span class="metric-icon gold"><AppIcon name="calendar" :size="18" /></span><div><span class="label">This month</span><div class="metric">{{ thisMonthBookings }}</div><p class="metric-sub">Bookings received</p></div></article>
      <article class="card metric-card"><span class="metric-icon violet"><AppIcon name="availability" :size="18" /></span><div><span class="label">Open weekdays</span><div class="metric">{{ openDays }}</div><p class="metric-sub">{{ state.schedules[0]?.timezone || 'No timezone set' }}</p></div></article>
    </div>

    <div class="dashboard-grid">
      <article class="card next-card">
        <div class="section-heading"><div><p class="eyebrow">Up next</p><h2>Upcoming bookings</h2></div><RouterLink to="/bookings">View all <AppIcon name="chevron" :size="14" /></RouterLink></div>
        <div v-if="upcomingBookings.length" class="upcoming-list">
          <RouterLink v-for="booking in upcomingBookings.slice(0, 3)" :key="booking.id" class="upcoming-row" to="/bookings">
            <span class="date-tile"><strong>{{ new Date(booking.starts_at).getDate() }}</strong><small>{{ new Date(booking.starts_at).toLocaleDateString(undefined, { month: 'short' }) }}</small></span>
            <span class="upcoming-copy"><strong>{{ booking.service_name }}</strong><small>{{ booking.guest_name }} · {{ formatDate(booking.starts_at) }}</small></span>
            <span class="upcoming-time">{{ formatTime(booking.starts_at) }}<AppIcon name="chevron" :size="14" /></span>
          </RouterLink>
        </div>
        <div v-else class="empty compact-empty"><span class="empty-icon"><AppIcon name="calendar" /></span><h2>No upcoming bookings</h2><p>Your next confirmed appointment will appear here.</p></div>
      </article>

      <aside class="dashboard-side">
        <article class="card setup-card">
          <div class="section-heading"><div><p class="eyebrow">Launch checklist</p><h2>{{ completedSteps === setupSteps.length ? 'You are ready to book' : `${completedSteps} of ${setupSteps.length} complete` }}</h2></div><span class="progress-number">{{ Math.round(setupProgress) }}%</span></div>
          <div class="progress-track" aria-hidden="true"><span :style="{ width: `${setupProgress}%` }" /></div>
          <div class="setup-list">
            <RouterLink v-for="step in setupSteps" :key="step.label" :to="step.to" :class="{ done: step.done }"><span><AppIcon :name="step.done ? 'check' : 'chevron'" :size="14" /></span>{{ step.label }}</RouterLink>
          </div>
          <RouterLink class="secondary setup-action" :to="nextStep.to">{{ nextStep.label }}<AppIcon name="chevron" :size="14" /></RouterLink>
        </article>

        <article class="card link-card">
          <span class="link-art"><AppIcon name="link" :size="21" /></span>
          <div><p class="eyebrow">Booking link</p><h2>{{ publicUrl ? 'Ready to share' : 'Create your public page' }}</h2><p class="muted">Guests only see the services and times you make available.</p></div>
          <template v-if="publicUrl">
            <code>{{ publicUrl }}</code>
            <div class="form-actions"><button class="primary" type="button" @click="copyLink"><AppIcon name="copy" :size="16" />{{ copied ? 'Copied' : 'Copy link' }}</button><a class="secondary" :href="publicUrl" target="_blank" rel="noreferrer">Preview<AppIcon name="external" :size="15" /></a></div>
          </template>
          <RouterLink v-else class="primary" to="/settings">Create booking link<AppIcon name="chevron" :size="15" /></RouterLink>
        </article>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.metrics{margin-bottom:18px}.metric-card{min-height:132px;display:flex;align-items:flex-start;gap:14px}.metric-icon{width:38px;height:38px;display:grid;place-items:center;flex:none;border-radius:11px}.metric-icon.blue{color:#2336dc;background:#eef1ff}.metric-icon.green{color:#147a4d;background:#eaf8f1}.metric-icon.gold{color:#9a6700;background:#fff6df}.metric-icon.violet{color:#7851c9;background:#f3edff}.metric-card .metric{font-size:31px}.dashboard-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(320px,.75fr);gap:18px}.dashboard-side{display:grid;align-content:start;gap:18px}.section-heading{margin-bottom:18px;display:flex;align-items:flex-start;justify-content:space-between;gap:15px}.section-heading .eyebrow{margin-bottom:5px}.section-heading h2{margin:0}.section-heading>a{min-height:34px;display:flex;align-items:center;gap:3px;color:var(--accent);font-size:12px;font-weight:750;text-decoration:none}.upcoming-list{display:grid}.upcoming-row{min-height:78px;padding:12px 0;display:grid;grid-template-columns:50px minmax(0,1fr) auto;align-items:center;gap:13px;border-bottom:1px solid var(--line);text-decoration:none}.upcoming-row:last-child{border:0}.upcoming-row:hover .upcoming-copy strong{color:var(--accent)}.date-tile{width:48px;height:50px;display:grid;place-items:center;align-content:center;color:var(--accent);border-radius:11px;background:var(--accent-soft)}.date-tile strong{font-size:18px;line-height:1}.date-tile small{margin-top:3px;font-size:9px;font-weight:800;text-transform:uppercase}.upcoming-copy{min-width:0;display:grid;gap:4px}.upcoming-copy strong,.upcoming-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.upcoming-copy strong{font-size:13px}.upcoming-copy small{color:var(--muted);font-size:11px}.upcoming-time{display:flex;align-items:center;gap:7px;color:var(--ink-soft);font-size:12px;font-weight:700}.compact-empty{padding:36px 18px}.progress-number{color:var(--accent);font-size:14px;font-weight:850}.progress-track{height:7px;margin:-5px 0 16px;overflow:hidden;border-radius:99px;background:#eceef4}.progress-track span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#2336dc,#5264f0);transition:width .25s ease}.setup-list{display:grid;margin-bottom:15px}.setup-list a{min-height:42px;display:flex;align-items:center;gap:10px;color:var(--ink-soft);border-bottom:1px solid var(--line);font-size:12px;text-decoration:none}.setup-list a>span{width:24px;height:24px;display:grid;place-items:center;color:var(--muted);border:1px solid var(--line);border-radius:50%}.setup-list a.done{color:var(--muted);text-decoration:line-through}.setup-list a.done>span{color:var(--success);border-color:#bfe2d1;background:var(--success-soft)}.setup-action{width:100%;justify-content:space-between}.link-card{position:relative;overflow:hidden}.link-art{position:absolute;right:-8px;top:-9px;width:74px;height:74px;display:grid;place-items:center;color:#8490ee;border-radius:50%;background:#eef1ff}.link-card>div{position:relative}.link-card .muted{margin-bottom:15px;font-size:12px}.link-card code{display:block;margin-bottom:12px;padding:11px;overflow:hidden;color:#4d5871;border-radius:9px;background:#f4f5f8;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.link-card .form-actions>*{flex:1}.link-card>.primary{width:100%}@media(max-width:1120px){.dashboard-grid{grid-template-columns:1fr}.dashboard-side{grid-template-columns:1fr 1fr}}@media(max-width:700px){.dashboard-side{grid-template-columns:1fr}.upcoming-row{grid-template-columns:48px minmax(0,1fr)}.upcoming-time{grid-column:2}.dashboard-header h1{font-size:32px}}
</style>
