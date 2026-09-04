<script setup>
import { computed, inject, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { cancelBooking } from '../booking.js'

const state = inject('bookingState')
const refresh = inject('refreshBookings')
const activeTab = ref('upcoming')
const query = ref('')
const selected = ref(null)
const confirmCancel = ref(false)
const cancellationReason = ref('')
const cancelling = ref(false)
const notice = ref('')
const error = ref('')
const now = Date.now()

const tabs = computed(() => [
  { id: 'upcoming', label: 'Upcoming', count: state.bookings.filter(item => item.status !== 'cancelled' && Date.parse(item.starts_at) > now).length },
  { id: 'past', label: 'Past', count: state.bookings.filter(item => item.status !== 'cancelled' && Date.parse(item.starts_at) <= now).length },
  { id: 'cancelled', label: 'Cancelled', count: state.bookings.filter(item => item.status === 'cancelled').length },
  { id: 'all', label: 'All', count: state.bookings.length },
])

const filtered = computed(() => {
  const search = query.value.trim().toLowerCase()
  return state.bookings
    .filter(item => {
      if (activeTab.value === 'upcoming') return item.status !== 'cancelled' && Date.parse(item.starts_at) > now
      if (activeTab.value === 'past') return item.status !== 'cancelled' && Date.parse(item.starts_at) <= now
      if (activeTab.value === 'cancelled') return item.status === 'cancelled'
      return true
    })
    .filter(item => !search || [item.guest_name, item.guest_email, item.service_name, item.reference].some(value => String(value || '').toLowerCase().includes(search)))
    .sort((left, right) => activeTab.value === 'past' || activeTab.value === 'cancelled' ? Date.parse(right.starts_at) - Date.parse(left.starts_at) : Date.parse(left.starts_at) - Date.parse(right.starts_at))
})

function dateParts(value) {
  const date = new Date(value)
  return { day: date.toLocaleDateString(undefined, { day: '2-digit' }), month: date.toLocaleDateString(undefined, { month: 'short' }), weekday: date.toLocaleDateString(undefined, { weekday: 'short' }) }
}

function when(booking) {
  return new Date(booking.starts_at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })
}

function duration(booking) {
  return Math.max(0, Math.round((Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 60_000))
}

function close() {
  if (cancelling.value) return
  selected.value = null
  confirmCancel.value = false
  cancellationReason.value = ''
}

async function cancel() {
  cancelling.value = true
  error.value = ''
  try {
    await cancelBooking(selected.value, cancellationReason.value.trim() || 'Cancelled by owner')
    await refresh()
    selected.value = null
    confirmCancel.value = false
    cancellationReason.value = ''
    notice.value = 'Booking cancelled and the slot reopened.'
    window.setTimeout(() => { notice.value = '' }, 2400)
  } catch (reason) {
    error.value = reason?.message || 'The booking could not be cancelled.'
  } finally {
    cancelling.value = false
  }
}
</script>

<template>
  <section>
    <div class="page-header bookings-header">
      <div><p class="eyebrow">Appointments</p><h1>Bookings</h1><p class="lede">See who is coming, what they booked, and the details they shared. Cancelled appointments stay in history.</p></div>
      <label class="search-box"><AppIcon name="search" :size="17" /><span class="visually-hidden">Search bookings</span><input v-model="query" type="search" placeholder="Search guest or service"></label>
    </div>

    <div v-if="notice" class="notice" role="status">{{ notice }}</div>
    <div v-if="error && !selected" class="notice error" role="alert">{{ error }}</div>

    <div class="booking-tabs" role="tablist" aria-label="Booking status">
      <button v-for="tab in tabs" :key="tab.id" type="button" role="tab" :aria-selected="activeTab === tab.id" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id"><span>{{ tab.label }}</span><small>{{ tab.count }}</small></button>
    </div>

    <div v-if="filtered.length" class="booking-list">
      <article v-for="booking in filtered" :key="booking.id" class="card booking-card">
        <div class="date-tile"><small>{{ dateParts(booking.starts_at).weekday }}</small><strong>{{ dateParts(booking.starts_at).day }}</strong><span>{{ dateParts(booking.starts_at).month }}</span></div>
        <div class="booking-main">
          <div class="booking-title"><h2>{{ booking.service_name }}</h2><span class="chip" :class="booking.status">{{ booking.status }}</span></div>
          <p><AppIcon name="clock" :size="15" />{{ new Date(booking.starts_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }} · {{ duration(booking) }} min · {{ booking.timezone }}</p>
          <div class="guest-line"><span class="guest-avatar">{{ String(booking.guest_name || '?').slice(0, 1).toUpperCase() }}</span><span><strong>{{ booking.guest_name }}</strong><small>{{ booking.guest_email }}</small></span></div>
        </div>
        <div class="booking-end"><small>{{ booking.reference }}</small><button class="secondary small-button" type="button" @click="selected = booking">View details<AppIcon name="chevron" :size="14" /></button></div>
      </article>
    </div>

    <div v-else class="empty">
      <span class="empty-icon"><AppIcon name="bookings" /></span>
      <h2>{{ query ? 'No bookings match your search' : `No ${activeTab === 'all' ? '' : activeTab} bookings` }}</h2>
      <p>{{ query ? 'Try a guest name, email, service, or booking reference.' : 'Confirmed guest bookings will appear here as soon as Bookins reserves the slot.' }}</p>
      <button v-if="query" class="secondary" type="button" @click="query = ''">Clear search</button>
    </div>

    <div v-if="selected" class="modal-backdrop" @click.self="close">
      <aside class="card modal booking-detail" role="dialog" aria-modal="true" aria-labelledby="booking-detail-title">
        <div class="modal-header"><div><p class="eyebrow">Booking {{ selected.reference }}</p><h2 id="booking-detail-title">{{ selected.service_name }}</h2></div><button class="icon-button" type="button" aria-label="Close" @click="close"><AppIcon name="close" /></button></div>
        <div v-if="error" class="notice error" role="alert">{{ error }}</div>
        <div class="detail-when"><span><AppIcon name="calendar" :size="20" /></span><div><strong>{{ when(selected) }}</strong><small>{{ duration(selected) }} minutes · {{ selected.timezone }}</small></div><span class="chip" :class="selected.status">{{ selected.status }}</span></div>
        <dl>
          <div><dt>Guest</dt><dd>{{ selected.guest_name }}</dd></div>
          <div><dt>Email</dt><dd><a :href="`mailto:${selected.guest_email}`">{{ selected.guest_email }}</a></dd></div>
          <div><dt>Phone</dt><dd>{{ selected.guest_phone || 'Not supplied' }}</dd></div>
          <div class="wide"><dt>Notes</dt><dd>{{ selected.notes || 'No notes supplied.' }}</dd></div>
        </dl>
        <div v-if="confirmCancel" class="confirm-box"><strong>Cancel and reopen this slot?</strong><p class="muted">The appointment stays in history. Bookins does not send a cancellation email in this release.</p><div class="field"><label for="cancellation-reason">Reason, optional</label><textarea id="cancellation-reason" v-model.trim="cancellationReason" maxlength="500" placeholder="Add a private note for your records"></textarea></div><div class="form-actions"><button class="danger" type="button" :disabled="cancelling" @click="cancel">{{ cancelling ? 'Cancelling…' : 'Cancel booking' }}</button><button class="secondary" type="button" :disabled="cancelling" @click="confirmCancel = false">Keep booking</button></div></div>
        <div v-else class="form-actions detail-actions"><button v-if="selected.status !== 'cancelled'" class="danger" type="button" @click="confirmCancel = true">Cancel booking</button><button class="secondary" type="button" @click="close">Close</button></div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.search-box{width:250px;min-height:44px;padding:0 12px;display:flex;align-items:center;gap:8px;color:var(--muted);border:1px solid var(--line-strong);border-radius:11px;background:#fff}.search-box input{width:100%;min-width:0;min-height:40px;border:0;outline:0;background:transparent}.booking-tabs{margin-bottom:16px;padding:4px;display:flex;gap:3px;overflow:auto;border:1px solid var(--line);border-radius:12px;background:#f0f2f6}.booking-tabs button{min-height:38px;padding:0 13px;display:flex;align-items:center;gap:7px;color:var(--muted);border:0;border-radius:9px;background:transparent;font-size:12px;font-weight:700;white-space:nowrap}.booking-tabs button.active{color:var(--ink);background:#fff;box-shadow:0 2px 8px rgba(24,34,70,.08)}.booking-tabs small{min-width:20px;padding:2px 5px;border-radius:99px;background:#e6e8ef;font-size:9px}.booking-tabs .active small{color:var(--accent);background:var(--accent-soft)}.booking-list{display:grid;gap:11px}.booking-card{padding:16px 18px;display:grid;grid-template-columns:62px minmax(0,1fr) auto;align-items:center;gap:16px;box-shadow:none}.date-tile{width:58px;height:66px;display:grid;place-items:center;align-content:center;color:var(--accent);border:1px solid #dbe0ff;border-radius:13px;background:var(--accent-soft)}.date-tile small,.date-tile span{font-size:9px;font-weight:800;text-transform:uppercase}.date-tile strong{font-size:22px;line-height:1.05}.booking-main{min-width:0}.booking-title{display:flex;align-items:center;gap:8px}.booking-title h2{margin:0;font-size:17px}.booking-main>p{margin:6px 0 10px;display:flex;align-items:center;gap:5px;color:var(--muted);font-size:11px}.guest-line{display:flex;align-items:center;gap:8px}.guest-avatar{width:28px;height:28px;display:grid;place-items:center;color:var(--accent);border-radius:8px;background:var(--accent-soft);font-size:10px;font-weight:800}.guest-line>span:last-child{min-width:0;display:grid;gap:1px}.guest-line strong,.guest-line small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.guest-line strong{font-size:11px}.guest-line small{color:var(--muted);font-size:10px}.booking-end{display:grid;justify-items:end;gap:10px}.booking-end>small{color:var(--muted);font-size:9px;font-weight:700;letter-spacing:.04em}.booking-detail{max-width:610px}.detail-when{padding:14px;display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:11px;border-radius:12px;background:var(--accent-faint)}.detail-when>span:first-child{width:40px;height:40px;display:grid;place-items:center;color:var(--accent);border-radius:11px;background:var(--accent-soft)}.detail-when div{display:grid;gap:3px}.detail-when strong{font-size:12px}.detail-when small{color:var(--muted);font-size:10px}.booking-detail dl{margin:20px 0;display:grid;grid-template-columns:1fr 1fr;gap:12px}.booking-detail dl div{padding:13px;border:1px solid var(--line);border-radius:10px}.booking-detail dl .wide{grid-column:1/-1}.booking-detail dt{color:var(--muted);font-size:9px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}.booking-detail dd{margin:5px 0 0;color:var(--ink-soft);font-size:12px;overflow-wrap:anywhere}.booking-detail dd a{color:var(--accent)}.detail-actions{justify-content:flex-end}.confirm-box .field{margin-top:14px}.confirm-box textarea{min-height:78px}@media(max-width:700px){.search-box{width:100%}.booking-card{grid-template-columns:54px minmax(0,1fr)}.booking-end{grid-column:1/-1;grid-template-columns:1fr auto;align-items:center;justify-items:start}.booking-end button{justify-self:end}.date-tile{width:52px}.modal-backdrop{padding:10px;align-items:end}.modal{width:100%;max-height:94vh;border-radius:20px 20px 12px 12px}.booking-detail dl{grid-template-columns:1fr}.booking-detail dl .wide{grid-column:auto}}
</style>
