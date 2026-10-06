<script setup>
import { computed, inject, onBeforeUnmount, reactive, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import GmSelect from '../components/ui/GmSelect.vue'
import GmDialog from '../components/ui/GmDialog.vue'
import QrCode from '../components/QrCode.vue'
import { copyText, createServiceLink, deleteService, isTimeOff, revokeServiceLink, saveService } from '../booking.js'
import { whatsappShareUrl } from '../messaging.js'
import { isDemo, registerDemoGuard } from '../runtime.js'

const state = inject('bookingState')
const refresh = inject('refreshBookings')
const router = useRouter()
const toast = inject('toast', null)
const show = ref(false)
const selectPortalTarget = ref(null)
const keepServiceButton = ref(null)
const saving = ref(false)
const deleting = ref(false)
const editing = ref(null)
const pendingDelete = ref(null)
const notice = ref('')
const error = ref('')
const serviceBaseline = ref('')
const dialogPrompt = ref(false)
const pendingRoute = ref('')
const allowLeave = ref(false)
const currencies = ['NGN', 'GHS', 'KES', 'ZAR', 'UGX', 'TZS', 'XOF', 'USD']
const form = reactive({
  name: '',
  description: '',
  durationMinutes: 30,
  price: 0,
  currency: 'NGN',
  visibility: 'public',
  active: true,
  location: '',
})
const scheduleInterval = computed(() => Number(state.schedules[0]?.slot_interval_minutes || 0))

const durationError = computed(() => {
  const value = Number(form.durationMinutes)
  if (!Number.isInteger(value) || value < 5) return 'Enter a duration of at least 5 minutes.'
  if (value % 5 !== 0) return 'Duration must be a multiple of 5 minutes.'
  if (scheduleInterval.value && value > scheduleInterval.value)
    return `This is longer than your ${scheduleInterval.value}-minute booking interval. Bookins reserves one interval per booking, so raise the interval in Availability or shorten the service.`
  return ''
})
const nameConflict = computed(() => {
  const name = form.name.trim().toLowerCase()
  if (!name) return ''
  const other = state.services.find(
    (item) => item.id !== editing.value?.id && String(item.name || '').trim().toLowerCase() === name,
  )
  return other ? `You already have a service called "${other.name}". Choose a different name.` : ''
})
const upcomingCount = (service) => {
  const now = Date.now()
  return state.bookings.filter(
    (item) => item.service_id === service.id && !isTimeOff(item) && item.status === 'confirmed' && Date.parse(item.ends_at || item.starts_at) > now,
  ).length
}
const deleteUpcoming = computed(() => (pendingDelete.value ? upcomingCount(pendingDelete.value) : 0))
const pausing = ref(false)
const linkBusy = ref('')
const linkError = ref({})
const copiedLink = ref('')
const pendingRevoke = ref(null)
const nowMs = ref(Date.now())
let copiedTimer = 0
onBeforeUnmount(() => window.clearTimeout(copiedTimer))
const linkExpired = (service) => {
  const expiry = Date.parse(service.public_link_expires_at || '')
  return Boolean(service.public_link_url) && Number.isFinite(expiry) && expiry <= nowMs.value
}
const linkLive = (service) => Boolean(service.public_link_url) && !linkExpired(service)
const shareText = (service) => `Book ${service.name}${state.profile?.display_name ? ` with ${state.profile.display_name}` : ''}: ${service.public_link_url}`
const whatsappShare = (service) => whatsappShareUrl(shareText(service))
const setLinkError = (service, message) => { linkError.value = { ...linkError.value, [service.id]: message } }

async function makeLink(service) {
  if (isDemo.value || linkBusy.value) return
  linkBusy.value = service.id
  nowMs.value = Date.now()
  setLinkError(service, '')
  try {
    await createServiceLink(service)
    await refresh()
    notice.value = 'Direct link created.'
    toast?.('Direct link created')
    window.setTimeout(() => { notice.value = '' }, 2500)
  } catch (reason) {
    setLinkError(service, reason?.message || 'The direct link could not be created.')
  } finally {
    linkBusy.value = ''
  }
}

async function copyServiceLink(service) {
  setLinkError(service, '')
  try {
    await copyText(service.public_link_url)
    copiedLink.value = service.id
    toast?.('Link copied')
    window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => { copiedLink.value = '' }, 1600)
  } catch {
    setLinkError(service, 'Your browser blocked copying. Select the link and copy it manually.')
  }
}

async function confirmRevoke() {
  const service = pendingRevoke.value
  if (isDemo.value || !service || linkBusy.value) return
  linkBusy.value = service.id
  setLinkError(service, '')
  try {
    await revokeServiceLink(service)
    pendingRevoke.value = null
    await refresh()
    notice.value = 'Direct link revoked. Anyone holding it can no longer book.'
    window.setTimeout(() => { notice.value = '' }, 3000)
  } catch (reason) {
    setLinkError(service, reason?.message || 'The direct link could not be revoked.')
    pendingRevoke.value = null
  } finally {
    linkBusy.value = ''
  }
}
const currencyOptions = currencies.map((value) => ({ value, label: value }))
const visibilityOptions = [
  { value: 'public', label: 'Public booking page' },
  { value: 'private', label: 'Private (not on the public page)' },
]
const statusOptions = [
  { value: true, label: 'Active' },
  { value: false, label: 'Paused' },
]

const normalizeService = () => JSON.stringify({
  name: form.name.trim(),
  description: form.description.trim(),
  durationMinutes: Number(form.durationMinutes),
  price: Number(form.price || 0),
  currency: form.currency,
  visibility: form.visibility,
  active: form.active,
  location: form.location.trim(),
})
const serviceDirty = computed(() => show.value && normalizeService() !== serviceBaseline.value)
const syncServiceBaseline = () => { serviceBaseline.value = normalizeService() }
const removeModeGuard = registerDemoGuard('bookins-services', () => {
  if (saving.value || deleting.value) return 'Wait for the current service action to finish.'
  if (pendingDelete.value) return 'Close the delete confirmation before switching modes.'
  if (serviceDirty.value) return 'Finish or discard the open service before switching modes.'
  return ''
})
onBeforeUnmount(removeModeGuard)

onBeforeRouteLeave((to) => {
  if (saving.value || deleting.value) { error.value = 'Wait for the current service action to finish before leaving.'; return false }
  if (allowLeave.value) {
    allowLeave.value = false
    return true
  }
  if (!serviceDirty.value && !pendingDelete.value) return true
  pendingRoute.value = to.fullPath
  dialogPrompt.value = true
  return false
})

function open(service = null) {
  if (saving.value || deleting.value) return
  error.value = ''
  dialogPrompt.value = false
  editing.value = service
  Object.assign(
    form,
    service
      ? {
          name: service.name,
          description: service.description,
          durationMinutes: service.duration_minutes,
          price: service.price || 0,
          currency: service.currency || 'NGN',
          visibility: service.visibility,
          active: service.active !== false,
          location: service.location || '',
        }
      : {
          name: '',
          description: '',
          durationMinutes: Math.min(scheduleInterval.value || 30, 30),
          price: 0,
          currency: 'NGN',
          visibility: 'public',
          active: true,
          location: '',
        },
  )
  syncServiceBaseline()
  show.value = true
}

function close() {
  if (saving.value) return
  if (serviceDirty.value) {
    dialogPrompt.value = true
    return
  }
  show.value = false
  editing.value = null
  dialogPrompt.value = false
}

function discardChanges() {
  if (saving.value || deleting.value) return
  if (serviceDirty.value && serviceBaseline.value) Object.assign(form, JSON.parse(serviceBaseline.value))
  pendingDelete.value = null
  show.value = false
  editing.value = null
  dialogPrompt.value = false
  const route = pendingRoute.value
  pendingRoute.value = ''
  if (route) {
    allowLeave.value = true
    router.push(route)
  }
}

function keepEditing() {
  dialogPrompt.value = false
  pendingRoute.value = ''
}

function requestDeleteClose() {
  pendingDelete.value = null
}

function focusKeepService(event) {
  event.preventDefault()
  keepServiceButton.value?.focus({ preventScroll: true })
}

function priceLabel(service) {
  if (!Number(service.price)) return 'Free'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: service.currency || 'NGN',
      maximumFractionDigits: 0,
    }).format(service.price)
  } catch {
    return `${service.currency || 'NGN'} ${Number(service.price).toLocaleString()}`
  }
}

async function submit() {
  if (isDemo.value || saving.value || deleting.value) return
  const schedule = state.schedules[0]
  if (!schedule) {
    error.value = 'Set your availability before creating a service.'
    show.value = false
    return
  }
  if (durationError.value || nameConflict.value) {
    error.value = durationError.value || nameConflict.value
    return
  }
  const wasEditing = Boolean(editing.value)
  saving.value = true
  error.value = ''
  try {
    await saveService(editing.value, { ...form, location: form.location.trim(), name: form.name.trim(), durationMinutes: Number(form.durationMinutes), scheduleId: schedule.id }, state.services)
    await refresh()
    show.value = false
    editing.value = null
    notice.value = wasEditing ? 'Service updated.' : 'Service created.'
    toast?.(wasEditing ? 'Service updated' : 'Service created')
    window.setTimeout(() => {
      notice.value = ''
    }, 2000)
  } catch (reason) {
    error.value = reason?.message || 'The service could not be saved.'
  } finally {
    saving.value = false
  }
}

async function pauseInstead() {
  const service = pendingDelete.value
  if (isDemo.value || !service || pausing.value) return
  pausing.value = true
  error.value = ''
  try {
    await saveService(service, {
      name: service.name,
      description: service.description,
      durationMinutes: service.duration_minutes,
      price: service.price || 0,
      currency: service.currency || 'NGN',
      visibility: service.visibility,
      active: false,
      location: service.location || '',
      scheduleId: service.schedule_id || state.schedules[0]?.id,
    }, state.services)
    pendingDelete.value = null
    await refresh()
    notice.value = 'Service paused. Existing bookings are unchanged and it can be resumed any time.'
    window.setTimeout(() => { notice.value = '' }, 3000)
  } catch (reason) {
    error.value = reason?.message || 'The service could not be paused.'
  } finally {
    pausing.value = false
  }
}

async function remove() {
  if (isDemo.value) return
  deleting.value = true
  error.value = ''
  try {
    await deleteService(pendingDelete.value.id)
    pendingDelete.value = null
    await refresh()
    notice.value = 'Service deleted. Existing booking history was kept.'
    window.setTimeout(() => {
      notice.value = ''
    }, 2500)
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
      <div
        ><p class="eyebrow">Your offerings</p><h1>Services</h1
        ><p class="lede"
          >Create the sessions people can book. Each service uses your shared availability and can
          be paused without losing its history.</p
        ></div
      >
      <button
        class="primary"
        type="button"
        :disabled="isDemo || saving || deleting"
        @click="open()"
        ><AppIcon
          name="plus"
          :size="17"
        />New service</button
      >
    </div>

    <div
      v-if="notice"
      class="notice"
      role="status"
      >{{ notice }}</div
    >
    <div
      v-if="error && !show"
      class="notice error"
      role="alert"
      >{{ error }}</div
    >
    <div v-if="!isDemo && (serviceDirty || pendingDelete)" class="dirty-actions">
      <span>{{ dialogPrompt ? 'Leave without saving this service?' : 'Unsaved service changes are kept until you save or discard them.' }}</span>
      <div>
        <button class="secondary" type="button" @click="keepEditing">Keep editing</button>
        <button class="ghost" type="button" :disabled="saving || deleting" @click="discardChanges">Discard changes</button>
      </div>
    </div>

    <div
      v-if="state.services.length"
      class="service-grid"
    >
      <article
        v-for="service in state.services"
        :key="service.id"
        class="card service-card"
      >
        <div class="service-card-top">
          <span class="icon-tile"
            ><AppIcon
              name="services"
              :size="20"
          /></span>
          <div class="service-badges"
            ><span
              class="chip"
              :class="service.active !== false ? 'active' : 'paused'"
              >{{ service.active !== false ? 'Active' : 'Paused' }}</span
            ><span
              class="chip"
              :class="service.visibility"
              :title="service.visibility === 'private' ? 'Hidden from your booking page; bookable only through its direct link.' : 'Listed on your public booking page'"
              >{{ service.visibility === 'private' ? 'Private' : 'Public' }}</span
            ></div
          >
        </div>
        <div class="service-copy"
          ><h2>{{ service.name }}</h2
          ><p>{{ service.description }}</p></div
        >
        <p v-if="service.visibility === 'private'" class="private-note">Private — hidden from your booking page; bookable only through its direct link.</p>
        <p v-if="upcomingCount(service)" class="private-note">{{ upcomingCount(service) }} upcoming {{ upcomingCount(service) === 1 ? 'booking' : 'bookings' }}</p>
        <div class="service-facts"
          ><span
            ><AppIcon
              name="clock"
              :size="16"
            />{{ service.duration_minutes }} min</span
          ><strong class="tnum">{{ priceLabel(service) }}</strong></div
        >
        <details class="direct-link" :open="Boolean(linkError[service.id]) || undefined">
          <summary class="direct-summary">
            <AppIcon name="link" :size="16" /><span>Direct link</span>
            <span class="chip" :class="linkLive(service) ? 'success' : linkExpired(service) ? 'warning' : 'neutral'">{{ linkLive(service) ? 'Live' : linkExpired(service) ? 'Expired' : 'Not created' }}</span>
            <AppIcon class="direct-chevron" name="chevron" :size="16" />
          </summary>
          <div class="direct-body">
            <template v-if="linkLive(service)">
              <code>{{ service.public_link_url }}</code>
              <div class="direct-actions">
                <button class="secondary small-button" type="button" @click="copyServiceLink(service)"><AppIcon name="copy" :size="16" />{{ copiedLink === service.id ? 'Copied' : 'Copy link' }}</button>
                <a class="secondary small-button" :href="whatsappShare(service)" target="_blank" rel="noreferrer">Share on WhatsApp</a>
                <button class="ghost small-button delete-link" type="button" :disabled="isDemo || Boolean(linkBusy)" @click="pendingRevoke = service">Revoke</button>
              </div>
              <QrCode :value="service.public_link_url" :size="140" :label="`QR code for ${service.name} direct link`" />
            </template>
            <template v-else-if="linkExpired(service)">
              <p class="private-note">This direct link has expired. Guests opening it see an expired-link page.</p>
              <button class="primary small-button" type="button" :disabled="isDemo || Boolean(linkBusy)" @click="makeLink(service)">{{ linkBusy === service.id ? 'Creating…' : 'Create new link' }}</button>
            </template>
            <button v-else class="secondary small-button" type="button" :disabled="isDemo || Boolean(linkBusy)" @click="makeLink(service)">{{ linkBusy === service.id ? 'Creating…' : 'Create direct link' }}</button>
            <p v-if="linkError[service.id]" class="field-error private-note" role="alert">{{ linkError[service.id] }}</p>
          </div>
        </details>
        <div class="service-actions"
          ><button
            class="secondary small-button"
            type="button"
            :disabled="isDemo || saving || deleting"
            @click="open(service)"
            ><AppIcon name="edit" :size="16" />Edit service</button
          ><button
            class="ghost small-button icon-delete delete-link"
            type="button"
            aria-label="Delete service"
            title="Delete service"
            :disabled="isDemo || saving || deleting"
            @click="pendingDelete = service"
            ><AppIcon name="trash" :size="18" /></button
          ></div
        >
      </article>
    </div>

    <div
      v-else
      class="empty"
    >
      <span class="empty-icon"><AppIcon name="services" /></span>
      <h2>Create your first service</h2>
      <p>Set a clear name, duration, and price so guests know exactly what they are booking.</p>
      <button
        class="primary"
        type="button"
        :disabled="isDemo || saving || deleting"
        @click="open()"
        ><AppIcon
          name="plus"
          :size="17"
        />Create service</button
      >
    </div>

    <GmDialog
      :open="show"
      :title="editing ? 'Update this service' : 'What can people book?'"
      content-class="card modal bookins-service-dialog"
      overlay-class="modal-backdrop bookins-modal-backdrop"
      :busy="saving"
      @update:open="(value) => { if (!value) close() }"
    >
      <form
        ref="selectPortalTarget"
        class="bookins-service-dialog-form"
        @submit.prevent="submit"
      >
        <div class="modal-header"
          ><div
            ><p class="eyebrow">{{ editing ? 'Edit service' : 'New service' }}</p
            ><h2>{{
              editing ? 'Update this service' : 'What can people book?'
            }}</h2
            ><p class="muted"
              >Keep the offer specific. Guests will see this copy before choosing a time.</p
            ></div
          ><button
            class="icon-button"
            type="button"
              aria-label="Close"
              :disabled="saving || deleting"
            @click="close"
            ><AppIcon name="close" /></button
        ></div>
        <div
          v-if="error"
          class="notice error"
          role="alert"
          >{{ error }}</div
        >
        <div v-if="dialogPrompt" class="dirty-actions">
          <span>Discard these unsaved service changes?</span>
          <div>
            <button class="secondary" type="button" @click="keepEditing">Keep editing</button>
            <button class="ghost" type="button" :disabled="saving || deleting" @click="discardChanges">Discard changes</button>
          </div>
        </div>
        <section class="form-section">
          <h3>Basics</h3>
          <div class="field"
            ><label for="service-name">Service name</label
            ><input
              id="service-name"
              v-model.trim="form.name"
              :disabled="isDemo || saving || deleting"
              maxlength="100"
              required
              :aria-invalid="Boolean(nameConflict)"
              placeholder="30-minute discovery call"
          /><p v-if="nameConflict" class="field-hint field-error" role="alert">{{ nameConflict }}</p></div>
          <div class="field"
            ><label for="service-description">Description</label
            ><textarea
              id="service-description"
              v-model.trim="form.description"
              :disabled="isDemo || saving || deleting"
              maxlength="1500"
              required
              placeholder="Tell guests what you will cover and what they should prepare."
            ></textarea>
          </div>
        </section>
        <section class="form-section">
          <h3>Duration and price</h3>
          <div class="grid grid-2 form-grid"
            ><div class="field"
              ><label for="service-duration">Duration</label
              ><input
                id="service-duration"
                v-model.number="form.durationMinutes"
                :disabled="isDemo || saving || deleting"
                type="number"
                min="5"
                step="5"
                :max="scheduleInterval || undefined"
                inputmode="numeric"
                required
                :aria-invalid="Boolean(durationError)"
                aria-describedby="service-duration-hint" /><p
                id="service-duration-hint"
                class="field-hint"
                :class="{ 'field-error': durationError }"
                >{{ durationError || (scheduleInterval ? `Minutes, in steps of 5, up to your ${scheduleInterval}-minute booking interval.` : 'Minutes, in steps of 5.') }}
                <RouterLink v-if="scheduleInterval" to="/availability">Change interval in Availability</RouterLink></p
              ></div
            ><div class="field price-field"
              ><label for="service-price">Display price</label
              ><div
                ><GmSelect
                  v-model="form.currency"
                  :options="currencyOptions"
                  label="Currency"
                  :disabled="isDemo || saving || deleting"
                  :portal-target="selectPortalTarget || 'body'" /><input
                  id="service-price"
                  v-model.number="form.price"
                  :disabled="isDemo || saving || deleting"
                  type="number"
                  min="0"
                  step="1"
                  aria-label="Price" /></div
              ><p class="field-hint"
                >Prices are arranged with you. Online payment is not active yet.</p
              ></div
            ></div
          >
        </section>
        <section class="form-section">
          <h3>Booking rules</h3>
          <div class="field"
            ><label for="service-location">Location (optional)</label
            ><input
              id="service-location"
              v-model.trim="form.location"
              :disabled="isDemo || saving || deleting"
              maxlength="300"
              placeholder="Address, Phone call, or a video meeting URL" /><p class="field-hint"
              >Included in your messages to clients and in calendar events. It is not shown on the booking page yet.</p
            ></div>
        </section>
        <section class="form-section">
          <h3>Visibility</h3>
          <div class="grid grid-2 form-grid"
            ><div class="field"
              ><label for="service-visibility">Visibility</label
              ><GmSelect
                id="service-visibility"
                v-model="form.visibility"
                :options="visibilityOptions"
                label="Visibility"
                :disabled="isDemo || saving || deleting"
                :portal-target="selectPortalTarget || 'body'" /><p class="field-hint"
                >Private services are hidden from your booking page and bookable only through their direct link.</p
              ></div
            ><div class="field"
              ><label for="service-status">Status</label
              ><GmSelect
                id="service-status"
                v-model="form.active"
                :options="statusOptions"
                label="Status"
                :disabled="isDemo || saving || deleting"
                :portal-target="selectPortalTarget || 'body'" /></div
          ></div>
        </section>
        <div class="form-actions modal-footer"
          ><button
            class="primary"
            :disabled="saving || isDemo || Boolean(durationError || nameConflict)"
            >{{ saving ? 'Saving…' : editing ? 'Save changes' : 'Create service' }}</button
          ><button
            class="secondary"
            type="button"
            :disabled="saving || isDemo"
            @click="close"
            >Cancel</button
          ></div
        >
      </form>
    </GmDialog>

    <GmDialog
      :open="Boolean(pendingRevoke)"
      :title="`Revoke link for ${pendingRevoke?.name || 'service'}?`"
      content-class="card modal delete-modal bookins-delete-dialog"
      overlay-class="modal-backdrop bookins-modal-backdrop"
      :busy="Boolean(linkBusy)"
      @update:open="(value) => { if (!value) pendingRevoke = null }"
    >
      <div v-if="pendingRevoke" class="bookins-delete-dialog-body">
        <span class="delete-icon">!</span><p class="eyebrow">Revoke direct link</p>
        <h2>Revoke the link for {{ pendingRevoke.name }}?</h2>
        <p class="muted">Anyone holding this link, including printed QR codes, will no longer be able to open or book this service. Existing bookings are unchanged.</p>
        <div class="form-actions">
          <button class="danger" type="button" :disabled="isDemo || Boolean(linkBusy)" @click="confirmRevoke">{{ linkBusy ? 'Revoking…' : 'Revoke link' }}</button>
          <button class="secondary" type="button" :disabled="Boolean(linkBusy)" @click="pendingRevoke = null">Keep link</button>
        </div>
      </div>
    </GmDialog>

    <GmDialog
      :open="Boolean(pendingDelete)"
      :title="`Delete ${pendingDelete?.name || 'service'}?`"
      content-class="card modal delete-modal bookins-delete-dialog"
      overlay-class="modal-backdrop bookins-modal-backdrop"
      :busy="deleting"
      @open-auto-focus="focusKeepService"
      @update:open="(value) => { if (!value) requestDeleteClose() }"
    >
      <div
        v-if="pendingDelete"
        class="bookins-delete-dialog-body"
      >
        <span class="delete-icon">!</span><p class="eyebrow">Delete service</p
        ><h2>Delete {{ pendingDelete.name }}?</h2
        ><p v-if="deleteUpcoming" class="muted"
          ><strong>{{ deleteUpcoming }} upcoming confirmed {{ deleteUpcoming === 1 ? 'booking uses' : 'bookings use' }} this service.</strong>
          Deleting it leaves {{ deleteUpcoming === 1 ? 'that appointment' : 'those appointments' }} without a service on your list. Pausing hides it from guests and keeps everything intact.</p
        ><p v-else class="muted"
          >It will disappear from your booking page. Existing bookings and contact history will stay
          available.</p
        >
        <div v-if="dialogPrompt" class="dirty-actions">
          <span>Close this confirmation before leaving?</span>
          <div>
            <button class="secondary" type="button" @click="keepEditing">Keep editing</button>
            <button class="ghost" type="button" :disabled="saving || deleting" @click="discardChanges">Discard changes</button>
          </div>
        </div>
        <div class="form-actions"
          ><button
            v-if="deleteUpcoming && pendingDelete.active !== false"
            class="primary"
            type="button"
            :disabled="deleting || pausing || isDemo"
            @click="pauseInstead"
            >{{ pausing ? 'Pausing…' : 'Pause instead' }}</button
          ><button
            :class="deleteUpcoming && pendingDelete.active !== false ? 'ghost delete-link' : 'danger'"
            type="button"
            :disabled="deleting || pausing || isDemo"
            @click="remove"
            >{{ deleting ? 'Deleting…' : deleteUpcoming ? 'Delete anyway' : 'Delete service' }}</button
          ><button
            class="secondary"
            type="button"
            ref="keepServiceButton"
            :disabled="deleting || pausing || isDemo"
            @click="requestDeleteClose"
            >Keep service</button
          ></div
        >
      </div>
    </GmDialog>
  </section>
</template>

<style scoped>
.field-error { color: var(--danger); }
.private-note { margin: 0 0 var(--space-2); color: var(--muted); font-size: var(--text-xs); line-height: 1.45; }
.direct-link { margin: var(--space-3) 0 0; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg-soft, #fafbfd); }
.direct-summary { min-height: var(--control-h-sm); padding: 0 var(--space-3); display: flex; align-items: center; gap: var(--space-2); color: var(--ink-soft); font-size: var(--text-sm); font-weight: 650; list-style: none; cursor: pointer; }
.direct-summary::-webkit-details-marker { display: none; }
.direct-summary > span:nth-child(2) { flex: 1; }
.direct-chevron { transition: transform var(--dur-fast) var(--ease); }
.direct-link[open] .direct-chevron { transform: rotate(90deg); }
.direct-body { padding: 0 var(--space-3) var(--space-3); display: grid; gap: var(--space-2); justify-items: start; }
.direct-link code { max-width: 100%; padding: 8px 10px; overflow: hidden; color: var(--ink-soft); border-radius: 8px; background: #f1f3f8; font-family: var(--font-mono); font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }
.direct-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.direct-actions a { display: inline-flex; align-items: center; text-decoration: none; }
.dirty-actions { margin-bottom: 18px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #5d4d24; border: 1px solid #ead9a8; border-radius: 10px; background: #fffaf0; font-size: var(--text-sm); line-height: 1.45; }
.dirty-actions > div { display: flex; flex-wrap: wrap; gap: 8px; }
.dirty-actions button { min-height: var(--control-h-sm); }
.service-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-4);
}
.service-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.service-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.service-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.service-copy {
  margin: var(--space-4) 0 var(--space-3);
}
.service-copy h2 {
  font-size: var(--text-lg);
}
.service-copy p {
  display: -webkit-box;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--text-sm);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.service-facts {
  margin-top: auto;
  padding: var(--space-3) 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--line);
}
.service-facts span {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: var(--text-sm);
}
.service-facts strong {
  font-size: var(--text-md);
}
.service-actions {
  padding-top: var(--space-3);
  display: flex;
  gap: var(--space-2);
}
.service-actions .secondary {
  flex: 1;
}
.icon-delete { width: var(--control-h-sm); padding: 0; display: inline-grid; place-items: center; flex: none; }
.delete-link {
  color: var(--danger);
}
:global(.bookins-service-dialog .form-grid) {
  gap: 12px;
}
:global(.bookins-modal-backdrop) {
  padding: 22px;
  background: rgba(16, 25, 40, 0.52);
  backdrop-filter: blur(4px);
}
:global(.bookins-service-dialog),
:global(.bookins-delete-dialog) {
  width: min(620px, 100%);
  max-height: calc(100vh - 44px);
  overflow: auto;
  box-shadow: var(--shadow-lg);
}
:global(.bookins-service-dialog .price-field > div) {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 7px;
}
:global(.bookins-service-dialog .price-field .gm-select-shell),
:global(.bookins-service-dialog .price-field input) {
  min-width: 0;
}
:global(.bookins-delete-dialog) {
  max-width: 470px;
  text-align: center;
}
:global(.bookins-delete-dialog .delete-icon) {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  display: grid;
  place-items: center;
  color: var(--danger);
  border-radius: 50%;
  background: var(--danger-soft);
  font-size: 22px;
  font-weight: 850;
}
:global(.bookins-delete-dialog .form-actions) {
  margin-top: 22px;
  justify-content: center;
}
:global(.bookins-service-dialog .dirty-actions),
:global(.bookins-delete-dialog .dirty-actions) {
  margin-bottom: 18px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #5d4d24;
  border: 1px solid #ead9a8;
  border-radius: 10px;
  background: #fffaf0;
  font-size: var(--text-sm);
  line-height: 1.45;
}
:global(.bookins-service-dialog .dirty-actions > div),
:global(.bookins-delete-dialog .dirty-actions > div) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
:global(.bookins-service-dialog .dirty-actions button),
:global(.bookins-delete-dialog .dirty-actions button) {
  min-height: var(--control-h-sm);
}
@media (max-width: 700px) {
  .dirty-actions { align-items: flex-start; flex-direction: column; }
  .service-grid {
    grid-template-columns: 1fr;
  }
  :global(.bookins-service-dialog .form-grid) {
    grid-template-columns: 1fr;
  }
  :global(.bookins-modal-backdrop) {
    padding: 10px;
    align-items: end;
  }
  :global(.bookins-service-dialog),
  :global(.bookins-delete-dialog) {
    width: 100%;
    max-height: 94vh;
    border-radius: 20px 20px 12px 12px;
  }
  :global(.bookins-service-dialog .dirty-actions),
  :global(.bookins-delete-dialog .dirty-actions) {
    align-items: flex-start;
    flex-direction: column;
  }
  :global(.bookins-service-dialog .dirty-actions button),
  :global(.bookins-delete-dialog .dirty-actions button) {
    min-height: 44px;
  }
}
</style>
