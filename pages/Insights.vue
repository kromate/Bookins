<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import GmHint from '../components/ui/GmHint.vue'
import { useSetupState } from '../setup.ts'
import { hasTeam, isActiveTimeOff, isTimeOff, scheduleForStaff, segmentContacts, staffForBooking, teamMembers } from '../booking.ts'
import { serviceBaseId } from '../team.ts'
import { displayName, memberName } from '../team-ui.ts'
import { localFields, parseWeeklyWindows, wallClockInstant } from '../scheduling.ts'
import { displayTimeZone, ownerTimeZone } from '../time-display.ts'

interface AnalyticBooking extends BookingRecord {
  start: number
  end: number
  created: number
}

interface TimeInterval {
  start: number
  end: number
}

interface TimeOffInterval extends TimeInterval {
  schedule: string
}

interface CurrencyAmount {
  currency: string
  amount: number
}

const timestampMillis = (value: TimestampInput): number => {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string' || typeof value === 'number') return new Date(value).getTime()
  if (value && 'toDate' in value) return value.toDate().getTime()
  if (value && '_seconds' in value) return value._seconds * 1000
  return Number.NaN
}

const state = inject<WorkspaceState>('bookingState', { profile: null, schedules: [], services: [], bookings: [], contacts: [], staff: [], campaigns: [] })
const setup = useSetupState()
const toast = inject<ToastApi | null>('toast', null)
const DAY = 86_400_000
const PERIODS = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
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

const zone = computed(() => ownerTimeZone(state.schedules?.[0]?.timezone || state.profile?.timezone))
const madeIn = computed(() => (period.value ? `in the last ${period.value} days` : 'over all time'))
const periodLabel = computed(() => (period.value ? `the last ${period.value} days` : 'all time'))

const all = computed(() =>
  (state.bookings || [])
    .filter(item => !isTimeOff(item))
    .map((item): AnalyticBooking => ({ ...item, start: timestampMillis(item.starts_at), end: timestampMillis(item.ends_at), created: timestampMillis(item.created_at) }))
    .filter(item => Number.isFinite(item.start)),
)
const timeOff = computed(() =>
  (state.bookings || []).filter(isActiveTimeOff)
    .map((item): TimeOffInterval => ({ schedule: item.schedule_id || '', start: timestampMillis(item.starts_at), end: timestampMillis(item.ends_at) }))
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end)),
)

const inRange = (item: AnalyticBooking, from: number, to: number) => item.start > from && item.start <= to
const periodStart = computed(() => (period.value ? now.value - period.value * DAY : -Infinity))
const prevStart = computed(() => (period.value ? now.value - 2 * period.value * DAY : -Infinity))
const periodDates = computed(() => period.value ? {
  from: localFields(periodStart.value, zone.value).date,
  to: localFields(now.value, zone.value).date,
} : {})
const pastBookingsLink = computed(() => ({ path: '/bookings', query: { tab: 'past', ...periodDates.value } }))
const upcomingBookingsLink = { path: '/bookings', query: { tab: 'upcoming' } }

// Everything that started in the period, up to now (future bookings are not "performance" yet).
const inPeriod = computed(() => all.value.filter(item => inRange(item, periodStart.value, now.value)))
const inPrevious = computed(() => (period.value ? all.value.filter(item => inRange(item, prevStart.value, periodStart.value)) : []))
const active = (list: AnalyticBooking[]) => list.filter(item => item.status !== 'cancelled')
const isPastConfirmed = (item: AnalyticBooking) => item.status === 'confirmed' && item.start <= now.value

const count = computed(() => active(inPeriod.value).length)
// Appointments still ahead of now are not "performance" yet; say so instead of silently dropping them.
const upcomingCount = computed(() => active(all.value).filter(item => item.start > now.value).length)
const previousCount = computed(() => active(inPrevious.value).length)
const change = computed(() => {
  if (!period.value) return ''
  if (!previousCount.value && !count.value) return 'none in the period before either'
  if (!previousCount.value) return `none in the ${period.value} days before`
  const diff = count.value - previousCount.value
  const pct = Math.round((diff / previousCount.value) * 100)
  if (!diff) return `the same as the ${period.value} days before`
  return `${Math.abs(diff)} ${diff > 0 ? 'more' : 'fewer'} than the ${period.value} days before (${diff > 0 ? '+' : '−'}${Math.abs(pct)}%)`
})

// ---- utilization, next 14 days ----
function subtract(intervals: TimeInterval[], cuts: TimeInterval[]) {
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
// Open hours are summed over every active member's own weekly schedule (the owner alone when there is no team),
// minus time off on that schedule; booked time is each member's confirmed bookings inside their open hours.
const utilization = computed(() => {
  const from = now.value
  const to = now.value + 14 * DAY
  const schedules = new Map<string, ScheduleRecord>()
  for (const member of teamMembers(state)) {
    const schedule = scheduleForStaff(state, member)
    const scheduleId = String(schedule?.id || '')
    if (schedule && scheduleId && !schedules.has(scheduleId)) schedules.set(scheduleId, schedule)
  }
  if (!schedules.size) return null
  const memberSchedule = (item: AnalyticBooking) => {
    const member = staffForBooking(state, item)
    return scheduleForStaff(state, member)?.id || item.schedule_id || ''
  }
  const confirmed = active(all.value).filter(item => item.status === 'confirmed' && Number.isFinite(item.end) && item.end > from && item.start < to)
  let openMinutes = 0
  let freeMinutes = 0
  let anyWindows = false
  const sum = (list: TimeInterval[]) => list.reduce((total, item) => total + (item.end - item.start), 0) / 60_000
  for (const schedule of schedules.values()) {
    let windows
    try { windows = parseWeeklyWindows(schedule.weekly_windows_json) } catch { continue }
    if (!windows.length) continue
    anyWindows = true
    const tz = displayTimeZone(schedule.timezone)
    const first = localFields(from, tz).date
    let open: TimeInterval[] = []
    for (let offset = 0; offset < 15; offset += 1) {
      const date = new Date(Date.parse(`${first}T12:00:00.000Z`) + offset * DAY).toISOString().slice(0, 10)
      const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay()
      for (const window of windows.filter(item => item.weekday === weekday)) {
        const start = wallClockInstant(date, window.startMinute, tz)
        if (!start) continue
        const begin = Math.max(start.getTime(), from)
        const end = Math.min(start.getTime() + (window.endMinute - window.startMinute) * 60_000, to)
        if (end > begin) open.push({ start: begin, end })
      }
    }
    open = subtract(open, timeOff.value.filter(item => item.schedule === schedule.id))
    const mine = confirmed.filter(item => memberSchedule(item) === schedule.id).map(item => ({ start: item.start, end: item.end }))
    // Booked time inside open time = open minus what remains after removing bookings.
    openMinutes += sum(open)
    freeMinutes += sum(subtract(open, mine))
  }
  if (!anyWindows) return { open: 0, booked: 0, pct: null }
  const open = Math.round(openMinutes)
  const booked = Math.round(openMinutes - freeMinutes)
  return { open, booked, pct: open ? Math.round((booked / open) * 100) : null }
})
const hoursText = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`

// ---- revenue (display prices only) ----
const servicesById = computed(() => new Map((state.services || []).map(item => [String(item.id || ''), item])))
const priceOf = (item: AnalyticBooking): CurrencyAmount => {
  const service = servicesById.value.get(String(item.service_id || ''))
  const price = Number(service?.price)
  return { amount: Number.isFinite(price) && price > 0 ? price : 0, currency: service?.currency || 'NGN' }
}
const earning = (item: AnalyticBooking) => item.status === 'completed' || isPastConfirmed(item)
const revenue = computed(() => {
  const totals = new Map<string, number>()
  for (const item of inPeriod.value.filter(earning)) {
    const { amount, currency } = priceOf(item)
    if (amount) totals.set(currency, (totals.get(currency) || 0) + amount)
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount }))
})
function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`
  }
}

// ---- per team member (only once a team exists; each figure is a slice of the totals above) ----
const teamOn = computed(() => hasTeam(state))
const staffRows = computed(() => {
  if (!teamOn.value) return []
  const rows = new Map<string, { id: string; name: string; inactive: boolean; count: number; revenue: Map<string, number>; noShow: number; finished: number }>(teamMembers(state, { includeInactive: true }).map(member => {
    const id = String(member.id || '')
    return [id, { id, name: memberName(member), inactive: member.active === false, count: 0, revenue: new Map<string, number>(), noShow: 0, finished: 0 }] as const
  }))
  for (const item of inPeriod.value) {
    const member = staffForBooking(state, item)
    const memberId = String(member.id || '')
    const row = rows.get(memberId) || { id: memberId, name: member.name || 'Former team member', inactive: true, count: 0, revenue: new Map<string, number>(), noShow: 0, finished: 0 }
    rows.set(memberId, row)
    if (item.status !== 'cancelled') row.count += 1
    if (earning(item)) {
      const { amount, currency } = priceOf(item)
      if (amount) row.revenue.set(currency, (row.revenue.get(currency) || 0) + amount)
    }
    if (item.status === 'completed' || item.status === 'no_show' || isPastConfirmed(item)) row.finished += 1
    if (item.status === 'no_show') row.noShow += 1
  }
  return [...rows.values()]
    .filter(row => row.count || !row.inactive)
    .map(row => ({
      ...row,
      share: count.value ? Math.round((row.count / count.value) * 100) : null,
      revenueList: [...row.revenue].map(([currency, amount]) => ({ currency, amount })),
      revenueText: [...row.revenue].map(([currency, amount]) => money(amount, currency)).join(' + '),
      rate: row.finished ? Math.round((row.noShow / row.finished) * 100) : null,
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
})
const staffTotals = computed(() => {
  const revenue = new Map<string, number>()
  let bookings = 0
  let noShow = 0
  let finished = 0
  for (const row of staffRows.value) {
    bookings += row.count
    noShow += row.noShow
    finished += row.finished
    for (const item of row.revenueList) revenue.set(item.currency, (revenue.get(item.currency) || 0) + item.amount)
  }
  return {
    bookings,
    revenueText: [...revenue].map(([currency, amount]) => money(amount, currency)).join(' + '),
    rate: finished ? Math.round((noShow / finished) * 100) : null,
  }
})

// ---- rebook opportunity: clients past their service's "rebook after" days (opted-out clients are never counted) ----
const rebook = computed(() => {
  const due = segmentContacts(state, { dueToRebook: true }, { now: now.value, timezone: zone.value })
  const configured = (state.services || []).some(service => Number(service.rebook_after_days) > 0)
  return { total: due.total, configured, sample: due.contacts.slice(0, 3).map(item => item.contact.name) }
})

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

// ---- top services: one row per service (per-person copies count toward the service they copy) ----
const baseKey = (item: AnalyticBooking) => {
  const service = servicesById.value.get(String(item.service_id || ''))
  return serviceBaseId(service) || item.service_id || item.service_name || 'unknown'
}
const baseName = (key: string, item: AnalyticBooking) => displayName(servicesById.value.get(key)?.name || item.service_name || 'Service')
const topServices = computed(() => {
  const rows = new Map<string, { key: string; name: string; count: number; revenue: Map<string, number> }>()
  const list = active(inPeriod.value)
  for (const item of list) {
    const key = baseKey(item)
    const row = rows.get(key) || { key, name: baseName(key, item), count: 0, revenue: new Map<string, number>() }
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

// ---- heatmap: weekday x hour, Monday first ----
const heat = computed(() => {
  const cells = new Map<string, number>()
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
  const hourText = (hour: number) => new Date(Date.UTC(2000, 0, 1, hour)).toLocaleTimeString(undefined, { hour: 'numeric', timeZone: 'UTC' })
  const rows: Array<{ hour: number; label: string; cells: Array<(typeof WEEKDAYS)[number] & { value: number; level: number }> }> = []
  for (let hour = minHour; hour <= maxHour; hour += 1) {
    rows.push({
      hour,
      label: hourText(hour),
      cells: WEEKDAYS.map(day => {
        const value = cells.get(`${day.index}-${hour}`) || 0
        return { ...day, value, level: value ? Math.max(0.15, value / max) : 0 }
      }),
    })
  }
  const busiest = [...cells].sort((left, right) => right[1] - left[1])[0]
  const [day = 0, hour = 0] = (busiest?.[0] || '0-0').split('-').map(Number)
  return { rows, max, busiest: `${WEEKDAYS.find(item => item.index === day)?.long || 'Sunday'} around ${hourText(hour)}` }
})
// The indigo ramp stops at 60% so ink numbers keep at least 4.5:1 contrast on every cell.
const heatStyle = (level: number) => (level ? { background: `color-mix(in srgb, var(--accent) ${Math.round(10 + level * 50)}%, var(--surface))` } : undefined)

// ---- clients ----
const clientKey = (item: AnalyticBooking) => String(item.guest_email || '').trim().toLowerCase()
const clients = computed(() => {
  const keys = new Set(active(inPeriod.value).map(clientKey).filter(Boolean))
  const earlier = new Set(
    active(all.value).filter(item => item.start <= periodStart.value).map(clientKey).filter(Boolean),
  )
  const returning = [...keys].filter(key => earlier.has(key)).length
  return { total: keys.size, returning, fresh: keys.size - returning, repeatRate: keys.size ? Math.round((returning / keys.size) * 100) : null }
})

// ---- lead time and source: bookings CREATED in the period (so today's online bookings count) ----
const createdInPeriod = computed(() =>
  active(all.value).filter(item => {
    const created = Number.isFinite(item.created) ? item.created : item.start
    return created > periodStart.value && created <= now.value
  }),
)
const leadTime = computed(() => {
  const gaps = createdInPeriod.value
    .filter(item => item.source !== 'owner' && Number.isFinite(item.created) && item.start > item.created)
    .map(item => item.start - item.created)
  if (!gaps.length) return null
  const average = gaps.reduce((total: number, gap: number) => total + gap, 0) / gaps.length
  return { text: average >= DAY ? `${Math.round((average / DAY) * 10) / 10} days` : `${Math.round(average / 3_600_000)} hours`, count: gaps.length }
})
const ownerShare = computed(() => {
  const list = createdInPeriod.value
  if (!list.length) return null
  const owner = list.filter(item => item.source === 'owner').length
  return { total: list.length, count: owner, pct: Math.round((owner / list.length) * 100) }
})
async function copyBookingLink() {
  try {
    await navigator.clipboard.writeText(state.profile?.public_link_url || '')
    toast?.success('Booking link copied. Share it with your first client.')
  } catch {
    toast?.error('Could not copy the link. Open Settings to copy it.')
  }
}
const percent = (value: number | null) => (value === null ? 'Not enough data' : `${value}%`)
</script>

<template>
  <section class="insights">
    <header class="page-header">
      <div>
        <h1>Insights</h1>
        <p class="lede">Worked out from your own bookings, in {{ zone }} time. Time off is never counted.</p>
      </div>
      <div class="segmented period" role="group" aria-label="Period">
        <button v-for="item in PERIODS" :key="item.value" type="button" :aria-pressed="period === item.value" @click="period = item.value">{{ item.label }}</button>
      </div>
    </header>

    <div v-if="!all.length" class="empty" data-tour="tour-insights-summary">
      <h2>No bookings to look at yet</h2>
      <p>Insights fill in after your first appointments: how busy you are, who comes back, and your busiest hours.</p>
      <div class="empty-actions">
        <button v-if="setup.hasLink" class="primary" type="button" @click="copyBookingLink">Copy your booking link</button>
        <RouterLink v-else class="primary" :to="setup.nextStep.to">{{ setup.nextStep.label }}</RouterLink>
        <RouterLink class="secondary" :to="{ path: '/bookings', query: { new: '1' } }">Add a booking yourself</RouterLink>
      </div>
    </div>

    <template v-else>
      <p class="period-summary" data-tour="tour-insights-summary">
        <strong class="tnum">{{ count }}</strong> {{ count === 1 ? 'appointment' : 'appointments' }} in {{ periodLabel }}<template v-if="change">, {{ change }}</template>.
        <template v-if="upcomingCount"> {{ upcomingCount }} more {{ upcomingCount === 1 ? 'is' : 'are' }} still ahead.</template>
      </p>
      <div v-if="nudge" class="notice warning" role="status">
        <AppIcon name="clock" :size="18" />
        <span>{{ outcome.stale }} past appointments are still marked confirmed. Mark whether they came in <RouterLink :to="{ path: '/bookings', query: { tab: 'past' } }">Bookings</RouterLink> so these numbers stay right.</span>
      </div>

      <section class="panel" aria-labelledby="figures-title">
        <div class="panel-head"><h2 id="figures-title">This period</h2></div>
        <dl class="figures">
          <div class="figure">
            <dt>Booked share of open hours, next 14 days <GmHint text="Of the hours you and your active team are open over the next 14 days (after time off), how many already have a confirmed booking." label="About booked share" /></dt>
            <dd><b class="tnum">{{ utilization && utilization.pct !== null ? `${utilization.pct}%` : 'Not enough data' }}</b>
              <span v-if="utilization && utilization.pct !== null" class="figure-bar" aria-hidden="true"><i :style="{ width: `${utilization.pct}%` }" /></span>
              <small>{{ utilization && utilization.pct !== null ? `${hoursText(utilization.booked)} booked of ${hoursText(utilization.open)} open` : 'Add weekly hours in Availability to measure this.' }}</small></dd>
            <RouterLink class="text-link" :to="upcomingBookingsLink">Upcoming</RouterLink>
          </div>
          <div class="figure">
            <dt>No-show rate <GmHint text="Of appointments that are over (came, no-show, or past and not marked), the share marked No-show." label="About no-show rate" /></dt>
            <dd><b class="tnum">{{ percent(outcome.rate) }}</b><small>{{ outcome.noShow }} of {{ outcome.total }} finished appointments</small></dd>
            <RouterLink class="text-link" :to="pastBookingsLink">Past</RouterLink>
          </div>
          <div class="figure">
            <dt>Cancellations <GmHint text="Cancelled bookings as a share of all bookings that started in this period." label="About cancellations" /></dt>
            <dd><b class="tnum">{{ percent(cancellationRate) }}</b><small>{{ cancelledCount }} of {{ inPeriod.length }} appointments</small></dd>
            <RouterLink class="text-link" :to="pastBookingsLink">See them</RouterLink>
          </div>
          <div class="figure">
            <dt>Estimated takings <GmHint text="Each service's current display price, added up for appointments that came or are past. Bookins does not take payments, so this is an estimate, not money received." label="About estimated takings" /></dt>
            <dd><b class="tnum">{{ revenue.length ? revenue.map((item) => money(item.amount, item.currency)).join(' + ') : 'No priced visits' }}</b><small>Estimate from display prices</small></dd>
          </div>
        </dl>
      </section>

      <section v-if="rebook.total || rebook.configured" class="rebook-row" aria-labelledby="rebook-title">
        <div>
          <h2 id="rebook-title">Due to come back</h2>
          <p v-if="rebook.total"><strong class="tnum">{{ rebook.total }}</strong> {{ rebook.total === 1 ? 'client is' : 'clients are' }} past their usual return time<span v-if="rebook.sample.length">, including {{ rebook.sample.join(', ') }}</span>. Clients who opted out are not counted.</p>
          <p v-else>Nobody is past their return time right now.</p>
        </div>
        <RouterLink v-if="rebook.total" class="primary" :to="{ path: '/campaigns', query: { preset: 'due-rebook' } }">Message them</RouterLink>
        <RouterLink v-else class="secondary" :to="{ path: '/campaigns', query: { preset: 'lapsed-90' } }">Find lapsed clients</RouterLink>
      </section>
      <p v-else class="hint-row">Set "rebook after" days on a service in <RouterLink to="/services">Services</RouterLink> to see who is due to come back.</p>

      <div class="pair">
        <section class="panel" aria-labelledby="top-title">
          <div class="panel-head"><h2 id="top-title">Top services</h2></div>
          <div v-if="topServices.length" class="table-wrap">
            <table class="data-table">
              <caption class="visually-hidden">Services ranked by appointments in {{ periodLabel }}</caption>
              <thead><tr><th scope="col">Service</th><th scope="col" class="num">Appointments</th><th scope="col" class="num">Share</th><th scope="col" class="num">Est. takings</th></tr></thead>
              <tbody>
                <tr v-for="row in topServices" :key="row.key">
                  <th scope="row">{{ row.name }}</th>
                  <td class="num">{{ row.count }}</td>
                  <td class="num">{{ row.share }}%</td>
                  <td class="num">{{ row.revenueText || 'None' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="panel-body muted">No appointments in {{ periodLabel }}.</p>
        </section>

        <section class="panel" aria-labelledby="clients-title">
          <div class="panel-head"><h2 id="clients-title">Clients <GmHint text="Clients are matched by email address. Returning means the same address also booked before this period." label="About clients" /></h2></div>
          <dl v-if="clients.total" class="client-facts">
            <div><dt>Booked</dt><dd class="tnum">{{ clients.total }}</dd></div>
            <div><dt>New</dt><dd class="tnum">{{ clients.fresh }}</dd></div>
            <div><dt>Returning</dt><dd class="tnum">{{ clients.returning }}</dd></div>
            <div><dt>Come back rate</dt><dd class="tnum">{{ percent(clients.repeatRate) }}</dd></div>
          </dl>
          <p v-else class="panel-body muted">No clients booked in {{ periodLabel }}.</p>
        </section>
      </div>

      <section class="panel" aria-labelledby="heat-title">
        <div class="panel-head"><h2 id="heat-title">Busiest days and hours</h2></div>
        <div v-if="heat.rows.length" class="panel-body">
          <p class="heat-lead">Busiest: <strong>{{ heat.busiest }}</strong>. Darker means more appointments.</p>
          <div class="table-wrap">
            <table class="heat">
              <caption class="visually-hidden">Appointments by weekday and hour, {{ periodLabel }}, {{ zone }} time</caption>
              <thead><tr><td class="corner"><span class="visually-hidden">Hour</span></td><th v-for="day in WEEKDAYS" :key="day.index" scope="col"><abbr :title="day.long">{{ day.short }}</abbr></th></tr></thead>
              <tbody>
                <tr v-for="row in heat.rows" :key="row.hour">
                  <th scope="row" class="tnum">{{ row.label }}</th>
                  <td v-for="cell in row.cells" :key="cell.index" :style="heatStyle(cell.level)" :title="`${cell.long} ${row.label}: ${cell.value}`">
                    <span v-if="cell.value" class="tnum">{{ cell.value }}</span><span v-else class="visually-hidden">none</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p v-else class="panel-body muted">No appointments in {{ periodLabel }}.</p>
      </section>

      <section v-if="teamOn" class="panel" aria-labelledby="team-title" data-testid="staff-insights">
        <div class="panel-head"><h2 id="team-title">By team member <GmHint text="A booking counts for the person it is assigned to; the rows add up to the totals." label="About team figures" /></h2></div>
        <div v-if="staffRows.length" class="table-wrap">
          <table class="data-table staff-table">
            <caption class="visually-hidden">Appointments, estimated takings and no-show rate per team member, {{ periodLabel }}</caption>
            <thead><tr><th scope="col">Person</th><th scope="col" class="num">Appointments</th><th scope="col" class="num">Share</th><th scope="col" class="num">Est. takings</th><th scope="col" class="num">No-show rate</th></tr></thead>
            <tbody>
              <tr v-for="row in staffRows" :key="row.id">
                <th scope="row" data-label="Person">{{ row.name }}<span v-if="row.inactive" class="chip neutral">Inactive</span></th>
                <td class="num" data-label="Appointments">{{ row.count }}</td>
                <td class="num" data-label="Share">{{ row.share === null ? 'None' : `${row.share}%` }}</td>
                <td class="num" data-label="Est. takings">{{ row.revenueText || 'None' }}</td>
                <td class="num" data-label="No-show rate">{{ row.rate === null ? 'None' : `${row.rate}%` }}<span v-if="row.finished" class="sub-inline"> ({{ row.noShow }} of {{ row.finished }})</span></td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" data-label="Everyone">Everyone</th>
                <td class="num" data-label="Appointments" data-testid="staff-total-bookings">{{ staffTotals.bookings }}</td>
                <td class="num" data-label="Share">{{ count ? '100%' : 'None' }}</td>
                <td class="num" data-label="Est. takings" data-testid="staff-total-revenue">{{ staffTotals.revenueText || 'None' }}</td>
                <td class="num" data-label="No-show rate" data-testid="staff-total-rate">{{ staffTotals.rate === null ? 'None' : `${staffTotals.rate}%` }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p v-else class="panel-body muted">No team members to show yet.</p>
      </section>

      <section class="panel" aria-labelledby="source-title">
        <div class="panel-head"><h2 id="source-title">How people book</h2></div>
        <div class="panel-body source-lines">
          <p v-if="leadTime">Online, clients book <strong class="tnum">{{ leadTime.text }}</strong> ahead on average ({{ leadTime.count }} online {{ leadTime.count === 1 ? 'booking' : 'bookings' }} made {{ madeIn }}). <GmHint text="The time from when each online booking was made to its appointment. Bookings you add yourself are left out." label="About lead time" /></p>
          <p v-else>No online bookings were made {{ madeIn }}.</p>
          <p v-if="ownerShare">You added <strong class="tnum">{{ ownerShare.pct }}%</strong> of the bookings made {{ madeIn }} ({{ ownerShare.count }} of {{ ownerShare.total }}); the rest came through your link.</p>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.insights { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
.insights .page-header { margin-bottom: 0; }
.period { justify-self: start; }
.period-summary { margin: 0; color: var(--ink-soft); font-size: var(--text-lg); line-height: 1.5; }
.period-summary strong { color: var(--ink); font-size: var(--text-xl); }
.notice a { color: inherit; text-decoration: underline; }
.figures { margin: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.figure { padding: var(--space-4); display: grid; align-content: start; gap: var(--space-2); }
.figure + .figure { border-left: 1px solid var(--line); }
.figure dt { display: flex; align-items: center; gap: 4px; color: var(--ink-soft); font-size: var(--text-sm); font-weight: var(--weight-strong); }
.figure dd { margin: 0; display: grid; gap: 6px; }
.figure b { font-size: var(--text-xl); line-height: 1.15; overflow-wrap: anywhere; }
.figure small { color: var(--muted); font-size: var(--text-xs); }
.figure-bar { position: relative; display: block; height: 6px; overflow: hidden; border-radius: 3px; background: var(--surface-sunken); }
.figure-bar i { position: absolute; inset: 0 auto 0 0; background: var(--accent); }
.figure .text-link { justify-self: start; min-height: 32px; display: inline-flex; align-items: center; }
.rebook-row { padding: var(--space-4); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); border: 1px solid var(--line); border-left: 4px solid var(--now); border-radius: 2px var(--radius) var(--radius) 2px; background: var(--surface); }
.rebook-row h2 { margin: 0; font-size: var(--text-md); }
.rebook-row p { margin: 4px 0 0; color: var(--ink-soft); font-size: var(--text-sm); max-width: 70ch; }
.hint-row { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.hint-row a { color: var(--accent); font-weight: var(--weight-strong); }
.pair { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: var(--space-4); align-items: start; }
.client-facts { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.client-facts > div { padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--line); }
.client-facts > div:nth-child(odd) { border-right: 1px solid var(--line); }
.client-facts > div:nth-last-child(-n + 2) { border-bottom: 0; }
.client-facts dt { color: var(--muted); font-size: var(--text-sm); }
.client-facts dd { margin: 2px 0 0; font-size: var(--text-xl); font-weight: var(--weight-strong); }
.heat-lead { margin: 0 0 var(--space-3); color: var(--ink-soft); font-size: var(--text-sm); }
.heat { width: 100%; min-width: 320px; table-layout: fixed; border-collapse: separate; border-spacing: 3px; }
.heat th, .heat td { padding: 0; text-align: center; font-size: var(--text-sm); }
.heat thead th { color: var(--muted); font-size: var(--text-xs); font-weight: var(--weight-strong); }
.heat tbody th { width: 64px; padding-right: 6px; color: var(--muted); font-size: var(--text-xs); font-weight: var(--weight-medium); text-align: right; white-space: nowrap; }
.heat td { height: 34px; color: var(--ink); border-radius: var(--radius-xs); background: var(--surface-sunken); font-weight: var(--weight-strong); }
abbr { text-decoration: none; }
.staff-table tfoot th, .staff-table tfoot td { border-top: 2px solid var(--line-strong); border-bottom: 0; font-weight: var(--weight-strong); }
.staff-table .chip { margin-left: var(--space-2); }
.sub-inline { color: var(--muted); font-size: var(--text-xs); font-weight: var(--weight-regular); }
.source-lines { display: grid; gap: var(--space-2); }
.source-lines p { margin: 0; color: var(--ink-soft); font-size: var(--text-sm); display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.source-lines strong { color: var(--ink); }

@media (max-width: 1000px) {
  .figures { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .figure:nth-child(3) { border-left: 0; }
  .figure:nth-child(n + 3) { border-top: 1px solid var(--line); }
  .pair { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 700px) {
  .period { width: 100%; }
  .period button { flex: 1; padding: 0 var(--space-2); }
  .period-summary { font-size: var(--text-md); }
  .figures { grid-template-columns: 1fr; }
  .figure + .figure { border-left: 0; border-top: 1px solid var(--line); }
  .staff-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .staff-table, .staff-table tbody, .staff-table tfoot, .staff-table tr, .staff-table th, .staff-table td { display: block; }
  .staff-table tr { padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--line); }
  .staff-table th, .staff-table td { padding: 2px 0; border: 0 !important; text-align: left; }
  .staff-table td.num { display: flex; justify-content: space-between; gap: var(--space-3); }
  .staff-table td::before { content: attr(data-label); color: var(--muted); font-size: var(--text-xs); font-weight: var(--weight-medium); }
}
</style>
