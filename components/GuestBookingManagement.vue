<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import {
  cancelGuestBooking,
  loadGuestBookingManagement,
  loadGuestManagementOpenings,
  loadGuestCalendarCheck,
  openingOverlapsBusy,
  rescheduleGuestBooking,
} from '../booking.js'
import { displayTimeZone, formatClockMode, zonedDateKey, zoneDisplayLabel } from '../time-display.js'

const props = defineProps({
  bookingId: { type: String, required: true },
  managementToken: { type: String, required: true },
  initialBooking: { type: Object, default: null },
  initialMode: { type: String, default: 'summary' },
  locale: { type: String, default: 'en' },
})
const emit = defineEmits(['close', 'updated'])

const copy = {
  en: {
    loading: 'Opening your booking…',
    errorTitle: 'We could not open this booking.',
    errorText: 'Check the private link and try again.',
    expiredTitle: 'This private link is invalid or expired.',
    expiredText: 'Contact the host if you still need to change this booking.',
    retry: 'Try again',
    title: 'Your booking',
    reschedule: 'Reschedule',
    cancel: 'Cancel booking',
    close: 'Back to booking page',
    when: 'When',
    with: 'Service',
    reference: 'Reference',
    chooseTitle: 'Choose a new time',
    chooseText: 'Your current time stays reserved until the new time is confirmed.',
    prev: 'Previous month',
    next: 'Next month',
    noTimes: 'No open times',
    calendarUnchecked: 'Google Calendar could not be checked. These times reflect Bookins bookings; a Calendar conflict may still exist.',
    pickDay: 'Choose a highlighted day to see its available times.',
    loadingTimes: 'Checking available times…',
    timesError: 'Available times could not load.',
    back: 'Back',
    confirmNew: 'Confirm new time',
    confirming: 'Rescheduling…',
    conflict: 'That time is no longer available. The available times have been refreshed.',
    rescheduledTitle: 'Your booking has been rescheduled',
    rescheduledText: 'Save the updated appointment details below.',
    cancelTitle: 'Cancel this booking?',
    cancelText: 'The reserved time will become available to someone else.',
    keep: 'Keep booking',
    confirmCancel: 'Cancel booking',
    cancelling: 'Cancelling…',
    cancelledTitle: 'Booking cancelled',
    cancelledText: 'This time is no longer reserved.',
    actionError: 'We could not confirm whether the update completed. You can retry safely, or reload this private link to check the booking.',
    notChangeable: 'This booking can no longer be changed. Contact the host if you need help.',
    calendarPending: 'Your booking is saved. The host needs to update their linked calendar.',
  },
  fr: {
    loading: 'Ouverture de votre réservation…',
    errorTitle: 'Impossible d’ouvrir cette réservation.',
    errorText: 'Vérifiez le lien privé et réessayez.',
    expiredTitle: 'Ce lien privé est invalide ou a expiré.',
    expiredText: 'Contactez l’hôte si vous devez encore modifier cette réservation.',
    retry: 'Réessayer',
    title: 'Votre réservation',
    reschedule: 'Reprogrammer',
    cancel: 'Annuler la réservation',
    close: 'Retour à la page de réservation',
    when: 'Quand',
    with: 'Prestation',
    reference: 'Référence',
    chooseTitle: 'Choisissez un nouvel horaire',
    chooseText: 'Votre horaire actuel reste réservé jusqu’à la confirmation du nouvel horaire.',
    prev: 'Mois précédent',
    next: 'Mois suivant',
    noTimes: 'Aucun horaire libre',
    calendarUnchecked: 'Google Agenda n’a pas pu être vérifié. Ces horaires reflètent Bookins ; un conflit de calendrier reste possible.',
    pickDay: 'Choisissez un jour en surbrillance pour voir les horaires disponibles.',
    loadingTimes: 'Recherche des horaires disponibles…',
    timesError: 'Impossible de charger les horaires disponibles.',
    back: 'Retour',
    confirmNew: 'Confirmer le nouvel horaire',
    confirming: 'Reprogrammation…',
    conflict: 'Cet horaire n’est plus disponible. Les horaires disponibles ont été actualisés.',
    rescheduledTitle: 'Votre réservation a été reprogrammée',
    rescheduledText: 'Enregistrez les nouvelles informations ci-dessous.',
    cancelTitle: 'Annuler cette réservation ?',
    cancelText: 'L’horaire réservé sera de nouveau disponible.',
    keep: 'Garder la réservation',
    confirmCancel: 'Annuler la réservation',
    cancelling: 'Annulation…',
    cancelledTitle: 'Réservation annulée',
    cancelledText: 'Cet horaire n’est plus réservé.',
    actionError: 'Impossible de confirmer si la modification a abouti. Vous pouvez réessayer sans risque ou recharger ce lien privé pour vérifier la réservation.',
    notChangeable: 'Cette réservation ne peut plus être modifiée. Contactez l’hôte si vous avez besoin d’aide.',
    calendarPending: 'Votre réservation est enregistrée. L’hôte doit mettre à jour son calendrier associé.',
  },
}
const text = computed(() => copy[props.locale] || copy.en)

const loading = ref(!props.initialBooking)
const loadError = ref('')
const booking = ref(props.initialBooking)
const mode = ref('summary')
const openings = ref([])
const availabilityLoading = ref(false)
const availabilityError = ref('')
const calendarChecked = ref(false)
const selectedDate = ref('')
const selectedSlot = ref(null)
const actionError = ref('')
const acting = ref(false)
const resultMode = ref('')
const viewMonth = reactive({ year: 0, month: 0 })
let actionKey = ''
let actionSignature = ''
let availabilityRequest = 0

const timezone = computed(() => displayTimeZone(booking.value?.timezone))
const calendarPending = computed(() => {
  const state = booking.value?.calendarSync
  return state === 'pending' || state?.state === 'pending'
})
const isCancelled = computed(() => String(booking.value?.status || '').toLowerCase() === 'cancelled')
const canChange = computed(() => String(booking.value?.status || '').toLowerCase() === 'confirmed' && Date.parse(booking.value?.startsAt) > Date.now())
const pad = value => String(value).padStart(2, '0')
const monthKey = computed(() => `${viewMonth.year}-${pad(viewMonth.month + 1)}`)
const minimumMonth = computed(() => zonedDateKey(new Date(), timezone.value).slice(0, 7))
const maximumMonth = computed(() => zonedDateKey(new Date(Date.now() + 365 * 86_400_000), timezone.value).slice(0, 7))
const canGoPrevious = computed(() => monthKey.value > minimumMonth.value)
const canGoNext = computed(() => monthKey.value < maximumMonth.value)
const monthLabel = computed(() =>
  new Date(Date.UTC(viewMonth.year, viewMonth.month, 1)).toLocaleDateString(props.locale, {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }),
)
const weekdays = computed(() =>
  Array.from({ length: 7 }, (_, index) =>
    new Date(Date.UTC(2024, 0, 7 + index)).toLocaleDateString(props.locale, { weekday: 'short', timeZone: 'UTC' }),
  ),
)
const openingsByDay = computed(() => {
  const days = new Map()
  for (const opening of openings.value) {
    const key = zonedDateKey(opening.startsAt, timezone.value)
    if (!days.has(key)) days.set(key, [])
    days.get(key).push(opening)
  }
  return days
})
const calendarCells = computed(() => {
  const lead = new Date(Date.UTC(viewMonth.year, viewMonth.month, 1)).getUTCDay()
  const total = new Date(Date.UTC(viewMonth.year, viewMonth.month + 1, 0)).getUTCDate()
  const cells = Array.from({ length: lead }, (_, index) => ({ key: `blank-${index}`, blank: true }))
  for (let day = 1; day <= total; day += 1) {
    const key = `${monthKey.value}-${pad(day)}`
    cells.push({ key, day, count: openingsByDay.value.get(key)?.length || 0 })
  }
  while (cells.length < 42) cells.push({ key: `tail-${cells.length}`, blank: true })
  return cells
})
const slots = computed(() => openingsByDay.value.get(selectedDate.value) || [])
const dateTime = computed(() => {
  if (!booking.value?.startsAt) return ''
  const date = new Date(booking.value.startsAt)
  const day = date.toLocaleDateString(props.locale, { dateStyle: 'full', timeZone: timezone.value })
  return `${day} · ${formatClockMode(date, props.locale, timezone.value, '24h')}`
})
const zoneText = computed(() => zoneDisplayLabel(timezone.value, props.locale, new Date(booking.value?.startsAt || Date.now())))

function classifyLoadError(reason) {
  const code = String(reason?.code ?? reason?.data?.code ?? '').toUpperCase()
  const status = Number(reason?.status ?? reason?.data?.status)
  return code.includes('EXPIRED') || [401, 403, 410].includes(status) ? 'expired' : 'generic'
}
function isNotChangeable(reason) {
  const code = String(reason?.code ?? reason?.data?.code ?? '').toUpperCase()
  return code === 'BOOKING_NOT_CHANGEABLE'
}
function newKey() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
function idempotencyKey(signature) {
  if (!actionKey || signature !== actionSignature) {
    actionKey = newKey()
    actionSignature = signature
  }
  return actionKey
}
function resetActionKey() {
  actionKey = ''
  actionSignature = ''
}
function setMonthFrom(value) {
  const date = new Date(value)
  viewMonth.year = date.getUTCFullYear()
  viewMonth.month = date.getUTCMonth()
}
function dayLabel(key) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(props.locale, { dateStyle: 'full', timeZone: 'UTC' })
}
function dateRange() {
  const fromDate = `${monthKey.value}-01`
  const throughDate = `${monthKey.value}-${pad(new Date(Date.UTC(viewMonth.year, viewMonth.month + 1, 0)).getUTCDate())}`
  return { fromDate, throughDate }
}
async function loadBooking() {
  loading.value = true
  loadError.value = ''
  try {
    booking.value = await loadGuestBookingManagement({ bookingId: props.bookingId, managementToken: props.managementToken })
    if (isCancelled.value) mode.value = 'cancelled'
  } catch (reason) {
    loadError.value = classifyLoadError(reason)
  } finally {
    loading.value = false
  }
}
async function loadOpenings() {
  const request = ++availabilityRequest
  availabilityLoading.value = true
  availabilityError.value = ''
  selectedSlot.value = null
  try {
    const result = await loadGuestManagementOpenings({
      bookingId: props.bookingId,
      managementToken: props.managementToken,
      ...dateRange(),
    })
    if (request !== availabilityRequest) return
    const available = Array.isArray(result?.openings) ? result.openings : []
    const check = available.length ? await loadGuestCalendarCheck(Math.min(...available.map(item => Date.parse(item.startsAt))), Math.max(...available.map(item => Date.parse(item.endsAt)))) : { state: 'unavailable', busy: [] }
    if (request !== availabilityRequest) return
    calendarChecked.value = check.state === 'checked'
    openings.value = calendarChecked.value ? available.filter(item => !openingOverlapsBusy(item, check.busy)) : available
    const first = openings.value[0]
    selectedDate.value = first ? zonedDateKey(first.startsAt, timezone.value) : ''
  } catch (reason) {
    if (request !== availabilityRequest) return
    availabilityError.value = isNotChangeable(reason) ? 'notChangeable' : classifyLoadError(reason)
    if (availabilityError.value === 'expired') loadError.value = 'expired'
  } finally {
    if (request === availabilityRequest) availabilityLoading.value = false
  }
}
async function beginReschedule() {
  actionError.value = ''
  mode.value = 'reschedule'
  setMonthFrom(booking.value.startsAt)
  await loadOpenings()
}
async function shiftMonth(delta) {
  if (delta < 0 && !canGoPrevious.value) return
  if (delta > 0 && !canGoNext.value) return
  const next = new Date(Date.UTC(viewMonth.year, viewMonth.month + delta, 1))
  viewMonth.year = next.getUTCFullYear()
  viewMonth.month = next.getUTCMonth()
  selectedDate.value = ''
  await loadOpenings()
}
async function confirmReschedule() {
  if (!selectedSlot.value || acting.value) return
  const slot = selectedSlot.value
  actionError.value = ''
  acting.value = true
  const signature = `reschedule:${slot.startsAt}`
  try {
    const check = await loadGuestCalendarCheck(Date.parse(slot.startsAt), Date.parse(slot.endsAt))
    calendarChecked.value = check.state === 'checked'
    if (calendarChecked.value && openingOverlapsBusy(slot, check.busy)) { actionError.value = 'conflict'; await loadOpenings(); return }
    booking.value = await rescheduleGuestBooking(
      { bookingId: props.bookingId, managementToken: props.managementToken, startsAt: slot.startsAt },
      idempotencyKey(signature),
    )
    resetActionKey()
    resultMode.value = 'rescheduled'
    mode.value = 'summary'
    emit('updated', booking.value)
  } catch (reason) {
    const code = String(reason?.code ?? reason?.data?.code ?? '').toUpperCase()
    if (code.includes('SLOT') || /taken|available/i.test(String(reason?.message || ''))) {
      actionError.value = 'conflict'
      await loadOpenings()
    } else if (classifyLoadError(reason) === 'expired') {
      loadError.value = 'expired'
    } else if (isNotChangeable(reason)) {
      actionError.value = 'notChangeable'
    } else {
      actionError.value = 'generic'
    }
  } finally {
    acting.value = false
  }
}
async function confirmCancel() {
  if (acting.value) return
  actionError.value = ''
  acting.value = true
  try {
    booking.value = await cancelGuestBooking(
      { bookingId: props.bookingId, managementToken: props.managementToken },
      idempotencyKey('cancel'),
    )
    resetActionKey()
    mode.value = 'cancelled'
    emit('updated', booking.value)
  } catch (reason) {
    if (classifyLoadError(reason) === 'expired') loadError.value = 'expired'
    else if (isNotChangeable(reason)) actionError.value = 'notChangeable'
    else actionError.value = 'generic'
  } finally {
    acting.value = false
  }
}
function returnToSummary() {
  mode.value = 'summary'
  actionError.value = ''
  selectedSlot.value = null
  resetActionKey()
}

watch(() => [props.bookingId, props.managementToken], () => loadBooking())
onMounted(() => {
  if (!props.initialBooking) loadBooking()
  else if (isCancelled.value) mode.value = 'cancelled'
  else if (props.initialMode === 'cancel') mode.value = 'cancel'
  else if (props.initialMode === 'reschedule') beginReschedule()
})
</script>

<template>
  <section class="gm" aria-live="polite">
    <div v-if="loading" class="gm-state" role="status">
      <span class="gm-spinner" aria-hidden="true" />
      <h1>{{ text.loading }}</h1>
    </div>

    <div v-else-if="loadError" class="gm-state" role="alert">
      <span class="gm-state-icon" aria-hidden="true">!</span>
      <h1>{{ loadError === 'expired' ? text.expiredTitle : text.errorTitle }}</h1>
      <p>{{ loadError === 'expired' ? text.expiredText : text.errorText }}</p>
      <button v-if="loadError !== 'expired'" class="gm-button" type="button" @click="loadBooking">{{ text.retry }}</button>
      <button class="gm-button" type="button" @click="emit('close')">{{ text.close }}</button>
    </div>

    <div v-else-if="mode === 'cancelled'" class="gm-state result">
      <span class="gm-state-icon neutral" aria-hidden="true">–</span>
      <h1>{{ text.cancelledTitle }}</h1>
      <p>{{ text.cancelledText }}</p>
      <button class="gm-button primary" type="button" @click="emit('close')">{{ text.close }}</button>
    </div>

    <template v-else-if="booking">
      <div v-if="mode === 'summary'" class="gm-state summary">
        <span v-if="resultMode === 'rescheduled'" class="gm-state-icon success" aria-hidden="true">✓</span>
        <h1>{{ resultMode === 'rescheduled' ? text.rescheduledTitle : text.title }}</h1>
        <p v-if="resultMode === 'rescheduled'">{{ text.rescheduledText }}</p>
        <dl class="gm-facts">
          <div><dt>{{ text.when }}</dt><dd>{{ dateTime }}<small>{{ zoneText }}</small></dd></div>
          <div v-if="booking.serviceName"><dt>{{ text.with }}</dt><dd>{{ booking.serviceName }}</dd></div>
          <div><dt>{{ text.reference }}</dt><dd><code>{{ booking.reference }}</code></dd></div>
        </dl>
        <p v-if="calendarPending" class="gm-notice">{{ text.calendarPending }}</p>
        <p v-if="actionError" class="gm-error" role="alert">{{ actionError === 'notChangeable' ? text.notChangeable : text.actionError }}</p>
        <div v-if="canChange" class="gm-actions">
          <button class="gm-button" type="button" @click="beginReschedule">{{ text.reschedule }}</button>
          <button class="gm-button danger" type="button" @click="mode = 'cancel'">{{ text.cancel }}</button>
        </div>
        <p v-else class="gm-error">{{ text.notChangeable }}</p>
      </div>

      <div v-else-if="mode === 'cancel'" class="gm-state cancel">
        <span class="gm-state-icon danger" aria-hidden="true">!</span>
        <h1>{{ text.cancelTitle }}</h1>
        <p>{{ dateTime }} · {{ booking.serviceName }}</p>
        <p>{{ text.cancelText }}</p>
        <p v-if="actionError" class="gm-error" role="alert">{{ actionError === 'notChangeable' ? text.notChangeable : text.actionError }}</p>
        <div class="gm-actions split">
          <button class="gm-button" type="button" :disabled="acting" @click="returnToSummary">{{ text.keep }}</button>
          <button class="gm-button danger" type="button" :disabled="acting" @click="confirmCancel">{{ acting ? text.cancelling : text.confirmCancel }}</button>
        </div>
      </div>

      <div v-else class="gm-reschedule">
        <header>
          <div>
            <h1>{{ text.chooseTitle }}</h1>
            <p>{{ text.chooseText }}</p>
          </div>
          <button class="gm-button" type="button" :disabled="acting" @click="returnToSummary">{{ text.back }}</button>
        </header>
        <p v-if="actionError" class="gm-error" role="alert">{{ actionError === 'conflict' ? text.conflict : actionError === 'notChangeable' ? text.notChangeable : text.actionError }}</p>
        <p v-if="!availabilityLoading && !calendarChecked" class="gm-notice" role="status">{{ text.calendarUnchecked }}</p>
        <div class="gm-picker">
          <div class="gm-calendar">
            <div class="gm-calendar-head">
              <strong>{{ monthLabel }}</strong>
              <span>
                <button type="button" :aria-label="text.prev" :disabled="acting || availabilityLoading || !canGoPrevious" @click="shiftMonth(-1)"><AppIcon name="arrow-left" :size="16" /></button>
                <button type="button" :aria-label="text.next" :disabled="acting || availabilityLoading || !canGoNext" @click="shiftMonth(1)"><AppIcon name="chevron" :size="16" /></button>
              </span>
            </div>
            <div class="gm-days labels" aria-hidden="true"><span v-for="day in weekdays" :key="day">{{ day }}</span></div>
            <div class="gm-days" :aria-busy="availabilityLoading">
              <template v-for="cell in calendarCells" :key="cell.key">
                <span v-if="cell.blank" />
                <button v-else type="button" :class="{ open: cell.count, selected: selectedDate === cell.key }" :disabled="acting || !cell.count || availabilityLoading" :aria-label="`${dayLabel(cell.key)} · ${cell.count || text.noTimes}`" @click="selectedDate = cell.key; selectedSlot = null">{{ cell.day }}</button>
              </template>
            </div>
          </div>
          <aside class="gm-slots">
            <p v-if="availabilityLoading" role="status">{{ text.loadingTimes }}</p>
            <div v-else-if="availabilityError" class="gm-empty" role="alert">
              <p>{{ availabilityError === 'notChangeable' ? text.notChangeable : text.timesError }}</p>
              <button class="gm-button" type="button" @click="loadOpenings">{{ text.retry }}</button>
            </div>
            <div v-else-if="slots.length" class="gm-slot-list">
              <button v-for="slot in slots" :key="slot.startsAt" type="button" :disabled="acting" :class="{ selected: selectedSlot?.startsAt === slot.startsAt }" :aria-label="`${dayLabel(selectedDate)} · ${formatClockMode(slot.startsAt, props.locale, timezone, '24h')}`" @click="selectedSlot = slot">
                {{ formatClockMode(slot.startsAt, props.locale, timezone, '24h') }}
              </button>
            </div>
            <p v-else class="gm-empty">{{ selectedDate ? text.noTimes : text.pickDay }}</p>
          </aside>
        </div>
        <footer>
          <span>{{ zoneText }}</span>
          <button class="gm-button primary" type="button" :disabled="!selectedSlot || acting" @click="confirmReschedule">{{ acting ? text.confirming : text.confirmNew }}</button>
        </footer>
      </div>
    </template>
  </section>
</template>

<style scoped>
.gm {
  width: min(1120px, 100%);
  min-height: 490px;
  margin: 0 auto;
  padding: 36px 40px 40px;
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--card);
  box-shadow: 0 12px 34px rgba(24, 31, 45, 0.08);
}
.gm :where(h1, p, dl, dd) { margin: 0; }
.gm :where(button):focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 32%, transparent); outline-offset: 2px; }
.gm-state { min-height: 410px; display: grid; align-content: center; justify-items: center; gap: 10px; text-align: center; }
.gm-state h1, .gm-reschedule h1 { font-size: 25px; line-height: 1.2; letter-spacing: -0.035em; }
.gm-state > p { max-width: 470px; color: var(--muted); }
.gm-state-icon { width: 54px; height: 54px; margin-bottom: 8px; display: grid; place-items: center; color: #59616d; border-radius: 50%; background: #f0f1f3; font-size: 24px; }
.gm-state-icon.success { color: #247552; background: #eaf6ef; }
.gm-state-icon.danger { color: var(--err); background: var(--err-bg); }
.gm-spinner { width: 34px; height: 34px; border: 3px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: gm-spin 0.8s linear infinite; }
.gm-button { min-height: 40px; padding: 0 15px; color: var(--ink); border: 1px solid #d5d8de; border-radius: 7px; background: var(--card); font: inherit; font-weight: 660; cursor: pointer; }
.gm-button.primary { color: var(--on-accent, #fff); border-color: var(--accent); background: var(--accent); }
.gm-button.danger { color: var(--err); border-color: var(--err-bd); background: var(--err-bg); }
.gm-button:disabled { opacity: 0.55; cursor: not-allowed; }
.gm-facts { width: min(430px, 100%); margin: 18px 0 8px; padding: 18px; display: grid; gap: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); text-align: left; }
.gm-facts > div { display: grid; grid-template-columns: 86px minmax(0, 1fr); gap: 12px; }
.gm-facts dt { color: var(--muted); font-weight: 600; }
.gm-facts dd { font-weight: 650; overflow-wrap: anywhere; }
.gm-facts small { display: block; color: var(--muted); font-weight: 500; }
.gm-facts code { user-select: all; }
.gm-actions { margin-top: 10px; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.gm-actions.split { width: min(430px, 100%); display: grid; grid-template-columns: 1fr 1fr; }
.gm-notice { max-width: 520px !important; padding: 10px 12px; color: var(--warn) !important; border: 1px solid var(--warn-bd); border-radius: 7px; background: var(--warn-bg); font-size: 12px; }
.gm-error { max-width: 680px; padding: 10px 12px; color: var(--err); border: 1px solid var(--err-bd); border-radius: 7px; background: var(--err-bg); }
.gm-state.cancel { padding: 24px; border: 1px solid var(--err-bd); border-radius: 10px; background: var(--err-bg); }
.gm-reschedule { display: grid; gap: 22px; }
.gm-reschedule > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.gm-reschedule > header p { margin-top: 7px; color: var(--muted); }
.gm-picker { display: grid; grid-template-columns: minmax(360px, 420px) 220px; justify-content: center; gap: 32px; }
.gm-calendar-head { min-height: 38px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.gm-calendar-head > span { display: flex; gap: 4px; }
.gm-calendar-head button { width: 34px; height: 34px; display: grid; place-items: center; color: var(--ink); border: 0; border-radius: 7px; background: transparent; cursor: pointer; }
.gm-calendar-head button:hover { background: var(--surface); }
.gm-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.gm-days.labels { margin-bottom: 6px; color: var(--muted); font-size: 10px; font-weight: 700; text-align: center; }
.gm-days button { width: 100%; min-width: 0; min-height: 0; max-width: 56px; justify-self: center; aspect-ratio: 1 / 1; padding: 0; color: var(--muted); border: 1px solid transparent; border-radius: 7px; background: transparent; font: inherit; font-size: 12px; cursor: default; }
.gm-days button.open { color: var(--ink); border-color: var(--line); background: var(--surface); cursor: pointer; }
.gm-days button.selected { color: var(--on-accent, #fff); border-color: var(--accent); background: var(--accent); font-weight: 750; }
.gm-slots { padding-left: 22px; border-left: 1px solid var(--line); }
.gm-slot-list { display: grid; gap: 7px; }
.gm-slot-list button { min-height: 40px; padding: 0 10px; color: var(--ink); border: 1px solid #d5d8de; border-radius: 6px; background: var(--card); font: inherit; font-size: 12px; font-weight: 650; text-align: left; cursor: pointer; }
.gm-slot-list button.selected { color: var(--accent); border-color: var(--accent); background: var(--surface); }
.gm-empty { color: var(--muted); }
.gm-reschedule > footer { padding-top: 18px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-top: 1px solid var(--line); }
.gm-reschedule > footer span { color: var(--muted); font-size: 12px; }
@media (max-width: 760px) {
  .gm { min-height: 0; padding: 24px 20px; border-radius: 10px; }
  .gm-state { min-height: 390px; }
  .gm-reschedule > header { flex-direction: column-reverse; gap: 16px; }
  .gm-picker { grid-template-columns: 1fr; gap: 20px; }
  .gm-slots { padding: 20px 0 0; border-top: 1px solid var(--line); border-left: 0; }
  .gm-slot-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .gm-reschedule > footer { align-items: stretch; flex-direction: column; }
  .gm-actions.split { grid-template-columns: 1fr; }
  .gm-facts > div { grid-template-columns: 1fr; gap: 2px; }
}
@media (prefers-reduced-motion: reduce) { .gm-spinner { animation: none; } }
@keyframes gm-spin { to { transform: rotate(360deg); } }
</style>
