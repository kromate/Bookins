<script setup>
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import GmHint from '../components/ui/GmHint.vue'
import { useSetupState } from '../setup.js'
import { isActiveTimeOff, isTimeOff } from '../booking.js'
import { localFields, parseWeeklyWindows, wallClockInstant } from '../scheduling.js'
import { displayTimeZone } from '../time-display.js'

const state = inject('bookingState')
const setup = useSetupState()
const toast = inject('toast', null)
const DAY = 86_400_000
const PERIODS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 0, label: 'All time' },
]
const WEEKDAYS = [
  { index: 1, short: 'Mon', long: 'Monday' },
  { index: 2, short: 'Tue', long: 'Tuesday' },
  { index: 3, short: 'Wed', long: 'Wednesday' },
  { index: 4, short: 'Thu', long: 'Thursday' },
  { index: 5, short: 'Fri', long: 'Friday' },
  { index: 6, short: 'Sat', long: 'Saturday' },
  { index: 0, short: 'Sun', long: 'Sunday' },
]

const period = ref(30)
const now = ref(Date.now())
const clock = window.setInterval(() => { now.value = Date.now() }, 60_000)
onBeforeUnmount(() => window.clearInterval(clock))

const zone = computed(() => displayTimeZone(state.schedules?.[0]?.timezone))
const periodLabel = computed(() => PERIODS.find(item => item.value === period.value)?.label.toLowerCase() || '')

const all = computed(() =>
  (state.bookings || [])
    .filter(item => !isTimeOff(item))
    .map(item => ({ ...item, start: Date.parse(item.starts_at), end: Date.parse(item.ends_at), created: Date.parse(item.created_at) }))
    .filter(item => Number.isFinite(item.start)),
)
const timeOff = computed(() =>
  (state.bookings || []).filter(isActiveTimeOff)
    .map(item => ({ start: Date.parse(item.starts_at), end: Date.parse(item.ends_at) }))
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end)),
)

const inRange = (item, from, to) => item.start > from && item.start <= to
const periodStart = computed(() => (period.value ? now.value - period.value * DAY : -Infinity))
const prevStart = computed(() => (period.value ? now.value - 2 * period.value * DAY : -Infinity))

// Everything that started in the period, up to now (future bookings are not "performance" yet).
const inPeriod = computed(() => all.value.filter(item => inRange(item, periodStart.value, now.value)))
const inPrevious = computed(() => (period.value ? all.value.filter(item => inRange(item, prevStart.value, periodStart.value)) : []))
const active = list => list.filter(item => item.status !== 'cancelled')
const isPastConfirmed = item => item.status === 'confirmed' && item.start <= now.value

const count = computed(() => active(inPeriod.value).length)
const previousCount = computed(() => active(inPrevious.value).length)
const change = computed(() => {
  if (!period.value) return 'Across all recorded bookings'
  if (!previousCount.value && !count.value) return 'No bookings in either period'
  if (!previousCount.value) return `No bookings in the previous ${period.value} days`
  const diff = count.value - previousCount.value
  const pct = Math.round((diff / previousCount.value) * 100)
  if (!diff) return `No change vs previous ${period.value} days`
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff)} (${diff > 0 ? '+' : '−'}${Math.abs(pct)}%) vs previous ${period.value} days`
})
const changeTone = computed(() => {
  if (!period.value || !previousCount.value) return ''
  return count.value > previousCount.value ? 'up' : count.value < previousCount.value ? 'down' : ''
})

// ---- utilization, next 14 days ----
function subtract(intervals, cuts) {
  let result = intervals
  for (const cut of cuts) {
    result = result.flatMap(item => {
      if (cut.end <= item.start || cut.start >= item.end) return [item]
      return [
        ...(cut.start > item.start ? [{ start: item.start, end: cut.start }] : []),
        ...(cut.end < item.end ? [{ start: cut.end, end: item.end }] : []),
      ]
    })
  }
  return result
}
const utilization = computed(() => {
  const schedule = state.schedules?.[0]
  if (!schedule) return null
  let windows
  try { windows = parseWeeklyWindows(schedule.weekly_windows_json) } catch { return null }
  if (!windows.length) return { open: 0, booked: 0, pct: null }
  const from = now.value
  const to = now.value + 14 * DAY
  const first = localFields(from, zone.value).date
  let open = []
  for (let offset = 0; offset < 15; offset += 1) {
    const date = new Date(Date.parse(`${first}T12:00:00.000Z`) + offset * DAY).toISOString().slice(0, 10)
    const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay()
    for (const window of windows.filter(item => item.weekday === weekday)) {
      const start = wallClockInstant(date, window.startMinute, zone.value)
      if (!start) continue
      const begin = Math.max(start.getTime(), from)
      const end = Math.min(start.getTime() + (window.endMinute - window.startMinute) * 60_000, to)
      if (end > begin) open.push({ start: begin, end })
    }
  }
  open = subtract(open, timeOff.value)
  const booked = active(all.value).filter(item => item.status === 'confirmed' && item.end > from && item.start < to)
  // Booked time inside open time = open minus what remains after removing bookings.
  const free = subtract(open, booked.filter(item => Number.isFinite(item.end)).map(item => ({ start: item.start, end: item.end })))
  const sum = list => list.reduce((total, item) => total + (item.end - item.start), 0) / 60_000
  const openMinutes = Math.round(sum(open))
  const bookedMinutes = Math.round(openMinutes - sum(free))
  return { open: openMinutes, booked: bookedMinutes, pct: openMinutes ? Math.round((bookedMinutes / openMinutes) * 100) : null }
})
const hoursText = minutes => `${Math.round((minutes / 60) * 10) / 10} h`

// ---- revenue (display prices only) ----
const servicesById = computed(() => new Map((state.services || []).map(item => [item.id, item])))
const priceOf = item => {
  const service = servicesById.value.get(item.service_id)
  const price = Number(service?.price)
  return { amount: Number.isFinite(price) && price > 0 ? price : 0, currency: service?.currency || 'NGN' }
}
const earning = item => item.status === 'completed' || isPastConfirmed(item)
const revenue = computed(() => {
  const totals = new Map()
  for (const item of inPeriod.value.filter(earning)) {
    const { amount, currency } = priceOf(item)
    if (amount) totals.set(currency, (totals.get(currency) || 0) + amount)
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount }))
})
function money(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`
  }
}

// ---- rates ----
const cancelledCount = computed(() => inPeriod.value.filter(item => item.status === 'cancelled').length)
const cancellationRate = computed(() => (inPeriod.value.length ? Math.round((cancelledCount.value / inPeriod.value.length) * 100) : null))
const outcome = computed(() => {
  const list = inPeriod.value
  const completed = list.filter(item => item.status === 'completed').length
  const noShow = list.filter(item => item.status === 'no_show').length
  const stale = list.filter(isPastConfirmed).length
  const total = completed + noShow + stale
  return { completed, noShow, stale, total, rate: total ? Math.round((noShow / total) * 100) : null }
})
const nudge = computed(() => outcome.value.stale >= 3 && outcome.value.stale / (outcome.value.total || 1) >= 0.25)

// ---- top services ----
const topServices = computed(() => {
  const rows = new Map()
  const list = active(inPeriod.value)
  for (const item of list) {
    const key = item.service_id || item.service_name || 'unknown'
    const row = rows.get(key) || { key, name: item.service_name || servicesById.value.get(item.service_id)?.name || 'Service', count: 0, revenue: new Map() }
    row.count += 1
    if (earning(item)) {
      const { amount, currency } = priceOf(item)
      if (amount) row.revenue.set(currency, (row.revenue.get(currency) || 0) + amount)
    }
    rows.set(key, row)
  }
  return [...rows.values()]
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 6)
    .map(row => ({
      ...row,
      share: Math.round((row.count / list.length) * 100),
      revenueText: [...row.revenue].map(([currency, amount]) => money(amount, currency)).join(' + '),
    }))
})

// ---- heatmap: weekday x hour ----
const heat = computed(() => {
  const cells = new Map()
  let max = 0
  let minHour = 24
  let maxHour = -1
  for (const item of active(inPeriod.value)) {
    const fields = localFields(item.start, zone.value)
    const weekday = new Date(`${fields.date}T12:00:00.000Z`).getUTCDay()
    const hour = Number(fields.time.slice(0, 2))
    const key = `${weekday}-${hour}`
    const value = (cells.get(key) || 0) + 1
    cells.set(key, value)
    max = Math.max(max, value)
    minHour = Math.min(minHour, hour)
    maxHour = Math.max(maxHour, hour)
  }
  if (!max) return { rows: [], max: 0, total: 0 }
  const rows = []
  for (let hour = minHour; hour <= maxHour; hour += 1) {
    rows.push({
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      cells: WEEKDAYS.map(day => {
        const value = cells.get(`${day.index}-${hour}`) || 0
        return { ...day, value, level: value ? Math.max(0.12, value / max) : 0 }
      }),
    })
  }
  const busiest = [...cells].sort((left, right) => right[1] - left[1])[0]
  const [day, hour] = busiest[0].split('-').map(Number)
  return { rows, max, busiest: `${WEEKDAYS.find(item => item.index === day).long} around ${String(hour).padStart(2, '0')}:00` }
})

// ---- clients ----
const clientKey = item => String(item.guest_email || '').trim().toLowerCase()
const clients = computed(() => {
  const keys = new Set(active(inPeriod.value).map(clientKey).filter(Boolean))
  const earlier = new Set(
    active(all.value).filter(item => item.start <= periodStart.value).map(clientKey).filter(Boolean),
  )
  const returning = [...keys].filter(key => earlier.has(key)).length
  return { total: keys.size, returning, fresh: keys.size - returning, repeatRate: keys.size ? Math.round((returning / keys.size) * 100) : null }
})

// ---- lead time and source ----
const leadTime = computed(() => {
  const gaps = active(inPeriod.value)
    .filter(item => item.source !== 'owner' && Number.isFinite(item.created) && item.start > item.created)
    .map(item => item.start - item.created)
  if (!gaps.length) return null
  const average = gaps.reduce((total, gap) => total + gap, 0) / gaps.length
  return { text: average >= DAY ? `${Math.round((average / DAY) * 10) / 10} days` : `${Math.round(average / 3_600_000)} hours`, count: gaps.length }
})
const ownerShare = computed(() => {
  const list = active(inPeriod.value)
  if (!list.length) return null
  const owner = list.filter(item => item.source === 'owner').length
  return { count: owner, pct: Math.round((owner / list.length) * 100) }
})
async function copyBookingLink() {
  try {
    await navigator.clipboard.writeText(state.profile?.public_link_url || '')
    toast?.success('Booking link copied. Share it with your first client.')
  } catch {
    toast?.error('Could not copy the link. Open Settings to copy it.')
  }
}
const percent = value => (value === null ? '—' : `${value}%`)
</script>

<template>
  <section class="insights">
    <div class="page-header">
      <div>
        <p class="eyebrow">Insights</p>
        <h1>See how your bookings are going.</h1>
        <p class="lede">Worked out in your browser from your own bookings, in {{ zone }} time. Time off is left out.</p>
      </div>
    </div>

    <div class="segmented period" role="group" aria-label="Reporting period">
      <button
        v-for="item in PERIODS"
        :key="item.value"
        type="button"
        :class="{ 'is-active': period === item.value }"
        :aria-pressed="period === item.value"
        @click="period = item.value"
        >{{ item.label }}</button
      >
    </div>

    <div v-if="!all.length" class="card empty" data-tour="tour-insights-summary">
      <span class="empty-icon"><AppIcon name="bookings" :size="22" /></span>
      <h2>No bookings to analyse yet</h2>
      <p>Insights appear after your first booking. Once clients book or you add appointments, trends and totals will show here.</p>
      <div class="cluster empty-actions">
        <button v-if="setup.hasLink" class="primary" type="button" @click="copyBookingLink">Copy your booking link</button>
        <RouterLink v-else class="primary" to="/settings">Create your booking link</RouterLink>
        <RouterLink class="secondary" to="/bookings">Add your first booking</RouterLink>
      </div>
    </div>

    <template v-else>
      <div v-if="nudge" class="notice warning" role="status">
        <AppIcon name="clock" :size="18" />
        <span>{{ outcome.stale }} past appointments are still marked confirmed. Mark past appointments as completed or no-show in
          <RouterLink to="/bookings">Bookings</RouterLink> so revenue and no-show rates are accurate.</span>
      </div>

      <div class="stat-grid kpis" data-tour="tour-insights-summary">
        <div class="card stat-tile kpi">
          <span class="label">Bookings <GmHint text="Appointments that started in this period and were not cancelled. Time off is never counted. The line below compares with the period just before." label="About bookings" /></span>
          <p class="metric tnum">{{ count }}</p>
          <p class="sub" :class="changeTone">{{ change }}</p>
          <p class="sub">Not cancelled, {{ periodLabel }}</p>
        </div>
        <div class="card stat-tile kpi">
          <span class="label">Share of open hours booked, next 14 days <GmHint text="Utilization: of the hours you are open over the next 14 days (after time off), how many already have a confirmed booking. 100% means fully booked." label="About utilization" /></span>
          <p class="metric tnum">{{ utilization ? percent(utilization.pct) : '—' }}</p>
          <p v-if="utilization && utilization.pct !== null" class="sub">{{ hoursText(utilization.booked) }} booked of {{ hoursText(utilization.open) }} open</p>
          <p v-else class="sub">Add weekly hours in Availability to measure this.</p>
          <div v-if="utilization && utilization.pct !== null" class="bar" aria-hidden="true"><span :style="{ width: `${utilization.pct}%` }" /></div>
        </div>
        <div class="card stat-tile kpi">
          <span class="label">Cancellation rate <GmHint text="Cancelled bookings as a share of all bookings that started in this period." label="About cancellation rate" /></span>
          <p class="metric tnum">{{ percent(cancellationRate) }}</p>
          <p class="sub">{{ cancelledCount }} of {{ inPeriod.length }} bookings, {{ periodLabel }}</p>
        </div>
        <div class="card stat-tile kpi">
          <span class="label">No-show rate <GmHint text="Of appointments that are over (completed, no-show, or past and not yet marked), the share you marked No-show. Mark past appointments in Bookings to keep this accurate." label="About no-show rate" /></span>
          <p class="metric tnum">{{ percent(outcome.rate) }}</p>
          <p class="sub">{{ outcome.noShow }} of {{ outcome.total }} finished appointments were no-shows</p>
        </div>
      </div>

      <article class="card block">
        <h2>Estimated revenue <GmHint text="An estimate only: the current display price of each service, added up for completed and past appointments. Bookins does not take payments, so this is not money received." label="About estimated revenue" /></h2>
        <p class="note">Estimated from display prices — Bookins does not take payments.</p>
        <ul v-if="revenue.length" class="revenue">
          <li v-for="item in revenue" :key="item.currency"><strong>{{ money(item.amount, item.currency) }}</strong></li>
        </ul>
        <p v-else class="muted">No priced appointments completed or past due in {{ periodLabel }}.</p>
        <p class="muted small">Counts completed and past confirmed appointments, using each service's current price.</p>
      </article>

      <div class="grid grid-2 pair">
        <article class="card block">
          <h2>Top services</h2>
          <div class="table-wrap" v-if="topServices.length">
            <table>
              <caption class="sr">Services ranked by bookings in {{ periodLabel }}</caption>
              <thead><tr><th scope="col">Service</th><th scope="col" class="num">Bookings</th><th scope="col" class="num">Share</th><th scope="col" class="num">Est. revenue</th></tr></thead>
              <tbody>
                <tr v-for="row in topServices" :key="row.key">
                  <th scope="row">{{ row.name }}</th>
                  <td class="num">{{ row.count }}</td>
                  <td class="num">{{ row.share }}%</td>
                  <td class="num">{{ row.revenueText || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="muted">No bookings in {{ periodLabel }}.</p>
        </article>

        <article class="card block">
          <h2>Clients <GmHint text="Clients are matched by email. Returning means the same email also booked before this period. Repeat rate is returning clients as a share of everyone who booked in this period." label="About repeat rate" /></h2>
          <dl v-if="clients.total" class="facts">
            <div><dt>Clients booked</dt><dd>{{ clients.total }}</dd></div>
            <div><dt>New clients</dt><dd>{{ clients.fresh }}</dd></div>
            <div><dt>Returning clients</dt><dd>{{ clients.returning }}</dd></div>
            <div><dt>Repeat rate (returning clients)</dt><dd>{{ percent(clients.repeatRate) }}</dd></div>
          </dl>
          <p v-else class="muted">No clients booked in {{ periodLabel }}.</p>
          <p class="muted small">Clients are matched by email address. Returning means booked before this period.</p>
        </article>
      </div>

      <article class="card block">
        <h2>Busiest days and hours</h2>
        <template v-if="heat.rows.length">
          <p class="muted">Busiest slot: {{ heat.busiest }}. Darker cells mean more bookings.</p>
          <div class="table-wrap">
            <table class="heat">
              <caption class="sr">Bookings by weekday and hour of day, {{ periodLabel }}, {{ zone }} time</caption>
              <thead><tr><td class="corner"><span class="sr">Hour</span></td><th v-for="day in WEEKDAYS" :key="day.index" scope="col"><abbr :title="day.long">{{ day.short }}</abbr></th></tr></thead>
              <tbody>
                <tr v-for="row in heat.rows" :key="row.hour">
                  <th scope="row">{{ row.label }}</th>
                  <td
                    v-for="cell in row.cells"
                    :key="cell.index"
                    :class="{ strong: cell.level > 0.55 }"
                    :style="cell.value ? { background: `rgba(35, 54, 220, ${0.1 + cell.level * 0.75})` } : undefined"
                    :title="`${cell.long} ${row.label}: ${cell.value}`"
                  ><span :class="{ zero: !cell.value }">{{ cell.value || '·' }}</span><span class="sr" v-if="!cell.value"> none</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="heat-legend" aria-hidden="true">
            <span>Fewer</span>
            <span v-for="step in [0, 0.25, 0.5, 0.75, 1]" :key="step" class="swatch" :class="{ strong: step > 0.55 }" :style="step ? { background: `rgba(35, 54, 220, ${0.1 + step * 0.75})` } : undefined" />
            <span>More (up to {{ heat.max }} per slot)</span>
          </div>
        </template>
        <p v-else class="muted">No bookings in {{ periodLabel }}.</p>
      </article>

      <div class="grid grid-2 pair">
        <article class="card block">
          <h2>Lead time <GmHint text="How far ahead clients book on average: the time from when they booked online to the appointment. Bookings you add yourself are excluded." label="About lead time" /></h2>
          <div v-if="leadTime" class="metric tnum">{{ leadTime.text }}</div>
          <p v-if="leadTime" class="muted">Average time between a client booking online and the appointment, from {{ leadTime.count }} online bookings.</p>
          <p v-else class="muted">No online bookings in {{ periodLabel }}.</p>
        </article>
        <article class="card block">
          <h2>Added by you</h2>
          <div v-if="ownerShare" class="metric tnum">{{ ownerShare.pct }}%</div>
          <p v-if="ownerShare" class="muted">{{ ownerShare.count }} of {{ count }} bookings in {{ periodLabel }} were added by you rather than booked online.</p>
          <p v-else class="muted">No bookings in {{ periodLabel }}.</p>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.insights { display: grid; gap: var(--space-4); }
.insights .page-header { margin-bottom: 0; }
.empty-actions { justify-content: center; }
.label :deep(.gm-hint__bubble) { text-transform: none; letter-spacing: normal; font-weight: 500; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.period { max-width: 100%; justify-self: start; overflow-x: auto; }
.notice a { display: inline; min-height: 0; color: inherit; font-weight: 700; text-decoration: underline; }
.kpis { gap: var(--space-4); }
.kpi { min-width: 0; align-content: start; }
.kpi .label { grid-column: 1 / -1; }
.kpi .metric { margin-top: 4px; }
.kpi .sub { grid-column: 1 / -1; margin: 2px 0 0; color: var(--muted); font-size: var(--text-xs); overflow-wrap: anywhere; }
.kpi .sub.up { color: var(--success); }
.kpi .sub.down { color: var(--danger); }
.bar { grid-column: 1 / -1; height: 6px; margin-top: var(--space-2); border-radius: 999px; background: var(--accent-soft); overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent); }
.block { min-width: 0; }
.block h2 { margin: 0 0 var(--space-2); font-size: var(--text-lg); }
.note { margin: 0 0 var(--space-3); padding: 8px 12px; border-radius: var(--radius-sm); background: var(--accent-faint); color: var(--ink-soft); font-size: var(--text-sm); font-weight: 600; }
.small { font-size: var(--text-xs); }
.revenue { display: flex; flex-wrap: wrap; gap: 12px 28px; margin: 0 0 var(--space-2); padding: 0; list-style: none; }
.revenue li { display: grid; }
.revenue strong { font-size: 26px; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.revenue span { color: var(--muted); font-size: var(--text-xs); }
.pair { align-items: start; }
.table-wrap { max-width: 100%; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
th, td { padding: 10px 6px; border-bottom: 1px solid var(--line); text-align: left; }
thead th { color: var(--muted); font-size: var(--text-xs); font-weight: 700; }
tbody th { font-weight: 650; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); margin: 0 0 var(--space-2); }
.facts dt { color: var(--muted); font-size: var(--text-sm); }
.facts dd { margin: 2px 0 0; font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
.heat { table-layout: fixed; min-width: 300px; }
.heat th, .heat td { padding: 6px 2px; border: 2px solid var(--surface); text-align: center; font-size: var(--text-sm); }
.heat thead th { font-size: var(--text-xs); }
.heat tbody th { width: 56px; text-align: right; padding-right: 6px; color: var(--muted); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.heat td { height: 36px; border-radius: 6px; background: var(--surface-soft); font-weight: 600; font-variant-numeric: tabular-nums; }
.heat td.strong { color: #fff; }
.heat .zero { color: var(--line-strong); }
.heat-legend { margin-top: var(--space-3); display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--muted); font-size: var(--text-xs); }
.heat-legend .swatch { width: 24px; height: 16px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface-soft); }
.heat-legend .swatch:first-of-type { margin-left: 4px; }
.heat-legend .swatch:last-of-type { margin-right: 4px; }
abbr { text-decoration: none; }
@media (max-width: 700px) {
  .pair { grid-template-columns: 1fr; }
  .kpis { gap: var(--space-2); }
  .revenue strong { font-size: 22px; }
}
</style>
