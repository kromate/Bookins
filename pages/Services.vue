<script setup>
import { computed, inject, reactive, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { deleteService, saveService } from '../booking.js'

const state = inject('bookingState')
const refresh = inject('refreshBookings')
const show = ref(false)
const saving = ref(false)
const deleting = ref(false)
const editing = ref(null)
const pendingDelete = ref(null)
const notice = ref('')
const error = ref('')
const durations = [15, 30, 45, 60, 90, 120]
const currencies = ['NGN', 'GHS', 'KES', 'ZAR', 'UGX', 'TZS', 'XOF', 'USD']
const form = reactive({ name: '', description: '', durationMinutes: 30, price: 0, currency: 'NGN', visibility: 'public', active: true })
const scheduleInterval = computed(() => Number(state.schedules[0]?.slot_interval_minutes || 0))

function open(service = null) {
  error.value = ''
  editing.value = service
  Object.assign(form, service ? {
    name: service.name,
    description: service.description,
    durationMinutes: service.duration_minutes,
    price: service.price || 0,
    currency: service.currency || 'NGN',
    visibility: service.visibility,
    active: service.active !== false,
  } : { name: '', description: '', durationMinutes: Math.min(scheduleInterval.value || 30, 30), price: 0, currency: 'NGN', visibility: 'public', active: true })
  show.value = true
}

function close() {
  if (saving.value) return
  show.value = false
  editing.value = null
}

function priceLabel(service) {
  if (!Number(service.price)) return 'Free'
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: service.currency || 'NGN', maximumFractionDigits: 0 }).format(service.price) } catch { return `${service.currency || 'NGN'} ${Number(service.price).toLocaleString()}` }
}

async function submit() {
  const schedule = state.schedules[0]
  if (!schedule) {
    error.value = 'Set your availability before creating a service.'
    show.value = false
    return
  }
  if (form.durationMinutes > Number(schedule.slot_interval_minutes)) {
    error.value = `This service is ${form.durationMinutes} minutes, but your schedule interval is ${schedule.slot_interval_minutes} minutes. Increase the interval in Availability first.`
    return
  }
  const wasEditing = Boolean(editing.value)
  saving.value = true
  error.value = ''
  try {
    await saveService(editing.value, { ...form, scheduleId: schedule.id })
    await refresh()
    show.value = false
    editing.value = null
    notice.value = wasEditing ? 'Service updated.' : 'Service created.'
    window.setTimeout(() => { notice.value = '' }, 2000)
  } catch (reason) {
    error.value = reason?.message || 'The service could not be saved.'
  } finally {
    saving.value = false
  }
}

async function remove() {
  deleting.value = true
  error.value = ''
  try {
    await deleteService(pendingDelete.value.id)
    pendingDelete.value = null
    await refresh()
    notice.value = 'Service deleted. Existing booking history was kept.'
    window.setTimeout(() => { notice.value = '' }, 2500)
  } catch (reason) {
    error.value = reason?.message || 'The service could not be deleted.'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <section>
    <div class="page-header">
      <div><p class="eyebrow">Your offerings</p><h1>Services</h1><p class="lede">Create the sessions people can book. Each service uses your shared availability and can be paused without losing its history.</p></div>
      <button class="primary" type="button" @click="open()"><AppIcon name="plus" :size="17" />New service</button>
    </div>

    <div v-if="notice" class="notice" role="status">{{ notice }}</div>
    <div v-if="error && !show" class="notice error" role="alert">{{ error }}</div>

    <div v-if="state.services.length" class="service-grid">
      <article v-for="service in state.services" :key="service.id" class="card service-card">
        <div class="service-card-top">
          <span class="service-icon"><AppIcon name="services" :size="19" /></span>
          <div class="service-badges"><span class="chip" :class="service.active !== false ? 'active' : 'paused'">{{ service.active !== false ? 'Active' : 'Paused' }}</span><span class="chip" :class="service.visibility">{{ service.visibility }}</span></div>
        </div>
        <div class="service-copy"><h2>{{ service.name }}</h2><p>{{ service.description }}</p></div>
        <div class="service-facts"><span><AppIcon name="clock" :size="15" />{{ service.duration_minutes }} min</span><strong>{{ priceLabel(service) }}</strong></div>
        <div class="service-actions"><button class="secondary small-button" type="button" @click="open(service)">Edit service</button><button class="ghost small-button delete-link" type="button" @click="pendingDelete = service">Delete</button></div>
      </article>
    </div>

    <div v-else class="empty">
      <span class="empty-icon"><AppIcon name="services" /></span>
      <h2>Create your first service</h2>
      <p>Set a clear name, duration, and price so guests know exactly what they are booking.</p>
      <button class="primary" type="button" @click="open()"><AppIcon name="plus" :size="17" />Create service</button>
    </div>

    <div v-if="show" class="modal-backdrop" @click.self="close">
      <form class="card modal" role="dialog" aria-modal="true" aria-labelledby="service-dialog-title" @submit.prevent="submit">
        <div class="modal-header"><div><p class="eyebrow">{{ editing ? 'Edit service' : 'New service' }}</p><h2 id="service-dialog-title">{{ editing ? 'Update this service' : 'What can people book?' }}</h2><p class="muted">Keep the offer specific. Guests will see this copy before choosing a time.</p></div><button class="icon-button" type="button" aria-label="Close" @click="close"><AppIcon name="close" /></button></div>
        <div v-if="error" class="notice error" role="alert">{{ error }}</div>
        <div class="field"><label for="service-name">Service name</label><input id="service-name" v-model.trim="form.name" maxlength="100" required placeholder="30-minute discovery call"></div>
        <div class="field"><label for="service-description">Description</label><textarea id="service-description" v-model.trim="form.description" maxlength="1500" required placeholder="Tell guests what you will cover and what they should prepare."></textarea></div>
        <div class="grid grid-2 form-grid"><div class="field"><label for="service-duration">Duration</label><select id="service-duration" v-model.number="form.durationMinutes"><option v-for="value in durations" :key="value" :value="value" :disabled="scheduleInterval && value > scheduleInterval">{{ value }} minutes</option></select><p v-if="scheduleInterval" class="field-hint">Current schedule supports services up to {{ scheduleInterval }} minutes.</p></div><div class="field price-field"><label for="service-price">Display price</label><div><select v-model="form.currency" aria-label="Currency"><option v-for="currency in currencies" :key="currency" :value="currency">{{ currency }}</option></select><input id="service-price" v-model.number="form.price" type="number" min="0" step="1" aria-label="Price"></div><p class="field-hint">Prices are arranged with you. Online payment is not active yet.</p></div></div>
        <div class="grid grid-2 form-grid"><div class="field"><label for="service-visibility">Visibility</label><select id="service-visibility" v-model="form.visibility"><option value="public">Public booking page</option><option value="private">Hidden from public page</option></select></div><div class="field"><label for="service-status">Status</label><select id="service-status" v-model="form.active"><option :value="true">Active</option><option :value="false">Paused</option></select></div></div>
        <div class="form-actions"><button class="primary" :disabled="saving">{{ saving ? 'Saving…' : editing ? 'Save changes' : 'Create service' }}</button><button class="secondary" type="button" :disabled="saving" @click="close">Cancel</button></div>
      </form>
    </div>

    <div v-if="pendingDelete" class="modal-backdrop" @click.self="pendingDelete = null">
      <div class="card modal delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-service-title">
        <span class="delete-icon">!</span><p class="eyebrow">Delete service</p><h2 id="delete-service-title">Delete {{ pendingDelete.name }}?</h2><p class="muted">It will disappear from your booking page. Existing bookings and contact history will stay available.</p>
        <div class="form-actions"><button class="danger" type="button" :disabled="deleting" @click="remove">{{ deleting ? 'Deleting…' : 'Delete service' }}</button><button class="secondary" type="button" :disabled="deleting" @click="pendingDelete = null">Keep service</button></div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.service-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.service-card{min-height:286px;display:flex;flex-direction:column}.service-card-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.service-icon{width:42px;height:42px;display:grid;place-items:center;color:var(--accent);border-radius:12px;background:var(--accent-soft)}.service-badges{display:flex;gap:6px}.service-copy{margin:22px 0 18px}.service-copy h2{font-size:20px}.service-copy p{display:-webkit-box;overflow:hidden;color:var(--muted);font-size:12px;-webkit-box-orient:vertical;-webkit-line-clamp:3}.service-facts{margin-top:auto;padding:13px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.service-facts span{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12px}.service-facts strong{font-size:13px}.service-actions{padding-top:14px;display:flex;gap:8px}.service-actions .secondary{flex:1}.delete-link{color:var(--danger)}.form-grid{gap:12px}.price-field>div{display:grid;grid-template-columns:90px 1fr;gap:7px}.price-field select,.price-field input{min-width:0}.delete-modal{max-width:470px;text-align:center}.delete-icon{width:48px;height:48px;margin:0 auto 16px;display:grid;place-items:center;color:var(--danger);border-radius:50%;background:var(--danger-soft);font-size:22px;font-weight:850}.delete-modal .form-actions{margin-top:22px;justify-content:center}@media(max-width:1120px){.service-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.service-grid{grid-template-columns:1fr}.service-card{min-height:0}.form-grid{grid-template-columns:1fr}.modal-backdrop{padding:10px;align-items:end}.modal{width:100%;max-height:94vh;border-radius:20px 20px 12px 12px}}
</style>
