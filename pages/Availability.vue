<script setup>
import { computed, inject, onMounted, reactive, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { saveSchedule } from '../booking.js'

const state = inject('bookingState')
const refresh = inject('refreshBookings')
const saving = ref(false)
const notice = ref('')
const error = ref('')
const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const days = reactive(names.map((name, weekday) => ({ name, weekday, active: weekday > 0 && weekday < 6, start: '09:00', end: '17:00' })))
const form = reactive({ timezone: 'Africa/Lagos', slotIntervalMinutes: 60, minimumNoticeMinutes: 60, bookingHorizonDays: 60 })
const activeDays = computed(() => days.filter(day => day.active).length)
const maxServiceDuration = computed(() => Math.max(0, ...state.services.filter(item => item.active !== false).map(item => Number(item.duration_minutes || 0))))
const weeklyHours = computed(() => days.reduce((total, day) => day.active ? total + Math.max(0, minute(day.end) - minute(day.start)) / 60 : total, 0))

function minute(value) {
  const [hour, part] = value.split(':').map(Number)
  return hour * 60 + part
}

function time(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

function copyMonday() {
  const monday = days[1]
  for (const day of days.slice(2, 6)) Object.assign(day, { active: monday.active, start: monday.start, end: monday.end })
}

onMounted(() => {
  const existing = state.schedules[0]
  if (!existing) return
  Object.assign(form, {
    timezone: existing.timezone,
    slotIntervalMinutes: Number(existing.slot_interval_minutes),
    minimumNoticeMinutes: Number(existing.minimum_notice_minutes),
    bookingHorizonDays: Number(existing.booking_horizon_days),
  })
  try {
    const windows = JSON.parse(existing.weekly_windows_json)
    days.forEach(day => {
      const window = windows.find(item => item.weekday === day.weekday)
      day.active = Boolean(window)
      if (window) {
        day.start = time(window.startMinute)
        day.end = time(window.endMinute)
      }
    })
  } catch {
    error.value = 'The saved weekly schedule needs repair. Review each day, then save it again.'
  }
})

async function submit() {
  const weeklyWindows = days.filter(day => day.active).map(day => ({ weekday: day.weekday, startMinute: minute(day.start), endMinute: minute(day.end) }))
  if (!weeklyWindows.length) {
    error.value = 'Open at least one day so guests can find a time.'
    return
  }
  if (weeklyWindows.some(item => item.startMinute >= item.endMinute)) {
    error.value = 'Every open day needs an end time after its start time.'
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
    await refresh()
    notice.value = 'Availability saved.'
    window.setTimeout(() => { notice.value = '' }, 2000)
  } catch (reason) {
    error.value = reason?.message || 'Availability could not be saved.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section>
    <div class="page-header">
      <div><p class="eyebrow">Working hours</p><h1>Availability</h1><p class="lede">Choose when guests can book you. Times are shown in your booking timezone and confirmed slots are removed automatically.</p></div>
      <button class="primary" type="button" :disabled="saving" @click="submit">{{ saving ? 'Saving…' : 'Save availability' }}</button>
    </div>

    <div v-if="notice" class="notice" role="status">{{ notice }}</div>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>

    <div class="availability-layout">
      <div class="availability-main">
        <article class="card schedule-card">
          <div class="schedule-heading"><div><p class="eyebrow">Weekly schedule</p><h2>Regular hours</h2><p class="muted">Turn a day on, then set one continuous booking window.</p></div><button class="secondary small-button" type="button" @click="copyMonday">Copy Monday to weekdays</button></div>
          <div class="days">
            <div v-for="day in days" :key="day.weekday" class="day" :class="{ closed: !day.active }">
              <label class="day-toggle"><input v-model="day.active" type="checkbox"><span aria-hidden="true"><i /></span><strong>{{ day.name }}</strong></label>
              <div class="times"><input v-model="day.start" type="time" :disabled="!day.active" :aria-label="`${day.name} start time`"><span>to</span><input v-model="day.end" type="time" :disabled="!day.active" :aria-label="`${day.name} end time`"></div>
              <small>{{ day.active ? `${day.start} to ${day.end}` : 'Unavailable' }}</small>
            </div>
          </div>
        </article>
      </div>

      <aside class="availability-side">
        <article class="card summary-card">
          <p class="eyebrow">Schedule summary</p>
          <div class="summary-number"><strong>{{ activeDays }}</strong><span>open days</span></div>
          <div class="summary-row"><span>Weekly availability</span><strong>{{ weeklyHours }} hours</strong></div>
          <div class="summary-row"><span>Booking timezone</span><strong>{{ form.timezone }}</strong></div>
        </article>

        <article class="card settings-card">
          <div><p class="eyebrow">Booking rules</p><h2>Timing and notice</h2></div>
          <div class="field"><label for="availability-timezone">Timezone</label><input id="availability-timezone" v-model.trim="form.timezone" list="timezones" required><datalist id="timezones"><option value="Africa/Lagos"></option><option value="Africa/Accra"></option><option value="Africa/Nairobi"></option><option value="Africa/Johannesburg"></option><option value="Africa/Cairo"></option><option value="Africa/Casablanca"></option><option value="UTC"></option></datalist></div>
          <div class="field"><label for="slot-interval">Start-time interval</label><select id="slot-interval" v-model.number="form.slotIntervalMinutes"><option v-for="value in [15, 30, 45, 60, 90, 120]" :key="value" :value="value" :disabled="maxServiceDuration > value">Every {{ value }} minutes</option></select><p class="field-hint">Must cover your longest active service, currently {{ maxServiceDuration || 0 }} minutes.</p></div>
          <div class="field"><label for="minimum-notice">Minimum notice</label><select id="minimum-notice" v-model.number="form.minimumNoticeMinutes"><option :value="30">30 minutes</option><option :value="60">1 hour</option><option :value="240">4 hours</option><option :value="720">12 hours</option><option :value="1440">1 day</option></select></div>
          <div class="field"><label for="booking-horizon">How far ahead can guests book?</label><select id="booking-horizon" v-model.number="form.bookingHorizonDays"><option :value="14">14 days</option><option :value="30">30 days</option><option :value="60">60 days</option><option :value="90">90 days</option><option :value="180">180 days</option></select></div>
          <div class="rule-note"><AppIcon name="sparkle" :size="17" /><p>All current services share this schedule, so Bookins prevents two confirmed bookings from using the same time.</p></div>
        </article>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.availability-layout{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(310px,.65fr);gap:18px;align-items:start}.availability-side{display:grid;gap:18px}.schedule-heading{margin-bottom:18px;display:flex;align-items:flex-start;justify-content:space-between;gap:15px}.schedule-heading .muted{margin:0;font-size:12px}.days{margin:0 -22px -22px}.day{min-height:74px;padding:13px 22px;display:grid;grid-template-columns:160px minmax(260px,1fr) 130px;align-items:center;gap:18px;border-top:1px solid var(--line)}.day.closed{background:#fbfbfd}.day-toggle{display:flex;align-items:center;gap:10px}.day-toggle input{position:absolute;width:1px;height:1px;opacity:0}.day-toggle>span{width:38px;height:22px;padding:3px;display:flex;align-items:center;border-radius:99px;background:#d5d9e3;transition:background .15s ease}.day-toggle>span i{width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(16,25,40,.18);transition:transform .15s ease}.day-toggle input:checked+span{background:var(--accent)}.day-toggle input:checked+span i{transform:translateX(16px)}.day-toggle input:focus-visible+span{outline:3px solid rgba(35,54,220,.22);outline-offset:2px}.times{display:flex;align-items:center;gap:8px}.times input{width:135px;min-width:0;padding:0 10px;color:var(--ink);border:1px solid var(--line-strong);border-radius:10px;background:#fff}.times span{color:var(--muted);font-size:11px}.day>small{color:var(--muted);font-size:10px;text-align:right}.summary-card{color:#fff;background:linear-gradient(145deg,#2336dc,#4154ef);border-color:transparent;box-shadow:0 16px 38px rgba(35,54,220,.2)}.summary-card .eyebrow{color:#cfd5ff}.summary-number{margin:8px 0 22px;display:flex;align-items:baseline;gap:8px}.summary-number strong{font-size:42px;letter-spacing:-.05em}.summary-number span{color:#dfe3ff;font-size:13px}.summary-row{padding:12px 0;display:flex;justify-content:space-between;gap:14px;border-top:1px solid rgba(255,255,255,.15);font-size:11px}.summary-row span{color:#dfe3ff}.summary-row strong{text-align:right}.settings-card h2{margin-bottom:20px}.rule-note{padding:12px;display:flex;align-items:flex-start;gap:9px;color:var(--accent);border-radius:10px;background:var(--accent-soft)}.rule-note p{margin:0;color:#445071;font-size:11px}.settings-card .field:last-of-type{margin-bottom:13px}@media(max-width:1140px){.availability-layout{grid-template-columns:1fr}.availability-side{grid-template-columns:1fr 1fr}.settings-card{grid-column:span 1}}@media(max-width:780px){.day{grid-template-columns:1fr}.day>small{display:none}.times input{flex:1}.schedule-heading{align-items:stretch;flex-direction:column}.availability-side{grid-template-columns:1fr}.days{margin:0 -18px -18px}.day{padding:15px 18px}}
</style>
