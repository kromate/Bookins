<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import {
  cancelGuestBooking,
  loadGuestBookingManagement,
  loadGuestManagementOpenings,
  loadGuestCalendarCheck,
  openingOverlapsBusy,
  rescheduleGuestBooking,
} from '../booking.ts'
import { defaultClockMode, displayTimeZone, formatClockMode, zonedDateKey, zoneDisplayLabel } from '../time-display.ts'
import { t } from '../i18n/guest.ts'

interface BookingReceipt extends UnknownRecord { startsAt: string; endsAt?: string; timezone?: string; calendarSync?: string | { state?: string }; status?: string; reference?: string; serviceName?: string }
interface CalendarCell { key: string; blank?: boolean; day?: number; count?: number }
// `clock` is the guest's 12h/24h choice from the booking page; without it the language default applies.
const props = withDefaults(defineProps<{ bookingId: string; managementToken: string; initialBooking?: BookingReceipt | null; initialMode?: string; locale?: 'en' | 'fr'; clock?: '12h' | '24h' }>(), { initialBooking: null, initialMode: 'summary', locale: 'en' })
const emit = defineEmits<{ close: []; updated: [booking: BookingReceipt] }>()

// Copy lives in i18n/guest.ts under `manage.*`, next to the rest of the guest page, so both languages stay in one place.
const KEYS = [
  'loading', 'errorTitle', 'errorText', 'expiredTitle', 'expiredText', 'retry', 'title', 'reschedule', 'cancel', 'close',
  'when', 'with', 'reference', 'chooseTitle', 'chooseText', 'prev', 'next', 'noTimes', 'calendarUnchecked', 'pickDay',
  'loadingTimes', 'timesError', 'back', 'confirmNew', 'confirming', 'conflict', 'rescheduledTitle', 'rescheduledText',
  'cancelTitle', 'cancelText', 'keep', 'confirmCancel', 'cancelling', 'cancelledTitle', 'cancelledText', 'actionError',
  'notChangeable', 'calendarPending',
] as const
type CopyKey = (typeof KEYS)[number]
// t() reads the shared guest locale, so this recomputes when the language switch changes it.
const text = computed(() => Object.fromEntries(KEYS.map((key) => [key, t(`manage.${key}`)])) as Record<CopyKey, string>)

const loading = ref(!props.initialBooking)
const loadError = ref('')
const booking = ref<BookingReceipt | null>(props.initialBooking)
const mode = ref('summary')
const openings = ref<Opening[]>([])
const availabilityLoading = ref(false)
const availabilityError = ref('')
const calendarChecked = ref(false)
// Only a failed check is worth telling the guest about; a page without Calendar checking ('unavailable') is normal.
const calendarDegraded = ref(false)
const selectedDate = ref('')
const selectedSlot = ref<Opening | null>(null)
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
  return state === 'pending' || (typeof state === 'object' && state?.state === 'pending')
})
const isCancelled = computed(() => String(booking.value?.status || '').toLowerCase() === 'cancelled')
const canChange = computed(() => String(booking.value?.status || '').toLowerCase() === 'confirmed' && Date.parse(booking.value?.startsAt || '') > Date.now())
const pad = (value: number) => String(value).padStart(2, '0')
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
  const days = new Map<string, Opening[]>()
  for (const opening of openings.value) {
    const key = zonedDateKey(opening.startsAt, timezone.value)
    const day = days.get(key) ?? []
    day.push(opening)
    days.set(key, day)
  }
  return days
})
const calendarCells = computed(() => {
  const lead = new Date(Date.UTC(viewMonth.year, viewMonth.month, 1)).getUTCDay()
  const total = new Date(Date.UTC(viewMonth.year, viewMonth.month + 1, 0)).getUTCDate()
  const cells: CalendarCell[] = Array.from({ length: lead }, (_, index) => ({ key: `blank-${index}`, blank: true }))
  for (let day = 1; day <= total; day += 1) {
    const key = `${monthKey.value}-${pad(day)}`
    cells.push({ key, day, count: openingsByDay.value.get(key)?.length || 0 })
  }
  while (cells.length < 42) cells.push({ key: `tail-${cells.length}`, blank: true })
  return cells
})
const slots = computed(() => openingsByDay.value.get(selectedDate.value) || [])
const clockMode = computed(() => props.clock || defaultClockMode(props.locale))
const clockText = (value: TimestampInput) => formatClockMode(value, props.locale, timezone.value, clockMode.value)
const dateTime = computed(() => {
  if (!booking.value?.startsAt) return ''
  const date = new Date(booking.value.startsAt)
  const day = date.toLocaleDateString(props.locale, { dateStyle: 'full', timeZone: timezone.value })
  return `${day}, ${clockText(date)}`
})
const zoneText = computed(() => zoneDisplayLabel(timezone.value, props.locale, new Date(booking.value?.startsAt || Date.now())))

const errorRecord = (reason: unknown): UnknownRecord => reason && typeof reason === 'object' ? reason as UnknownRecord : {}
const nestedError = (reason: unknown): UnknownRecord => {
  const data = errorRecord(reason).data
  return data && typeof data === 'object' ? data as UnknownRecord : {}
}
function receiptFrom(value: unknown): BookingReceipt {
  const item = errorRecord(value)
  if (typeof item.startsAt !== 'string') throw new Error('The booking runtime returned an invalid booking.')
  return { ...item, startsAt: item.startsAt }
}
function classifyLoadError(reason: unknown) {
  const detail = errorRecord(reason)
  const nested = nestedError(reason)
  const code = String(detail.code ?? nested.code ?? '').toUpperCase()
  const status = Number(detail.status ?? nested.status)
  return code.includes('EXPIRED') || [401, 403, 410].includes(status) ? 'expired' : 'generic'
}
function isNotChangeable(reason: unknown) {
  const detail = errorRecord(reason)
  const code = String(detail.code ?? nestedError(reason).code ?? '').toUpperCase()
  return code === 'BOOKING_NOT_CHANGEABLE'
}
function newKey() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
function idempotencyKey(signature: string) {
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
function setMonthFrom(value: string) {
  const date = new Date(value)
  viewMonth.year = date.getUTCFullYear()
  viewMonth.month = date.getUTCMonth()
}
function dayLabel(key: string) {
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
    const result = await loadGuestBookingManagement({ bookingId: props.bookingId, managementToken: props.managementToken })
    booking.value = receiptFrom(result)
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
    const resultRecord = result && typeof result === 'object' ? result as UnknownRecord : {}
    const available = Array.isArray(resultRecord.openings) ? resultRecord.openings.flatMap((item): Opening[] => {
      const value = item && typeof item === 'object' ? item as UnknownRecord : null
      return value && typeof value.startsAt === 'string' && typeof value.endsAt === 'string'
        ? [{ startsAt: value.startsAt, endsAt: value.endsAt, timezone: String(value.timezone ?? ''), localDate: String(value.localDate ?? ''), localTime: String(value.localTime ?? '') }]
        : []
    }) : []
    const check = available.length ? await loadGuestCalendarCheck(Math.min(...available.map(item => Date.parse(item.startsAt))), Math.max(...available.map(item => Date.parse(item.endsAt)))) : { state: 'unavailable', busy: [] }
    if (request !== availabilityRequest) return
    calendarChecked.value = check.state === 'checked'
    calendarDegraded.value = check.state !== 'checked' && check.state !== 'unavailable'
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
  if (!booking.value?.startsAt) return
  setMonthFrom(booking.value.startsAt)
  await loadOpenings()
}
async function shiftMonth(delta: number) {
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
    calendarDegraded.value = check.state !== 'checked' && check.state !== 'unavailable'
    if (calendarChecked.value && openingOverlapsBusy(slot, check.busy)) { actionError.value = 'conflict'; await loadOpenings(); return }
    const result = await rescheduleGuestBooking(
      { bookingId: props.bookingId, managementToken: props.managementToken, startsAt: slot.startsAt },
      idempotencyKey(signature),
    )
    booking.value = receiptFrom(result)
    resetActionKey()
    resultMode.value = 'rescheduled'
    mode.value = 'summary'
    emit('updated', booking.value)
  } catch (reason) {
    const detail = errorRecord(reason)
    const code = String(detail.code ?? nestedError(reason).code ?? '').toUpperCase()
    if (code.includes('SLOT') || /taken|available/i.test(String(detail.message || ''))) {
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
    const result = await cancelGuestBooking(
      { bookingId: props.bookingId, managementToken: props.managementToken },
      idempotencyKey('cancel'),
    )
    booking.value = receiptFrom(result)
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
  <section class="gm">
    <div v-if="loading" class="gm-state" role="status">
      <span class="gm-spinner" aria-hidden="true" />
      <h1>{{ text.loading }}</h1>
    </div>

    <div v-else-if="loadError" class="gm-state" role="alert">
      <span class="gm-state-icon danger" aria-hidden="true"><AppIcon name="alert" :size="24" /></span>
      <h1>{{ loadError === 'expired' ? text.expiredTitle : text.errorTitle }}</h1>
      <p>{{ loadError === 'expired' ? text.expiredText : text.errorText }}</p>
      <button v-if="loadError !== 'expired'" class="gm-button" type="button" @click="loadBooking">{{ text.retry }}</button>
      <button class="gm-button" type="button" @click="emit('close')">{{ text.close }}</button>
    </div>

    <div v-else-if="mode === 'cancelled'" class="gm-state result" role="status">
      <span class="gm-state-icon" aria-hidden="true"><AppIcon name="close" :size="24" /></span>
      <h1>{{ text.cancelledTitle }}</h1>
      <p>{{ text.cancelledText }}</p>
      <button class="gm-button primary" type="button" @click="emit('close')">{{ text.close }}</button>
    </div>

    <template v-else-if="booking">
      <div v-if="mode === 'summary'" class="gm-state summary">
        <span v-if="resultMode === 'rescheduled'" class="gm-state-icon success" aria-hidden="true"><AppIcon name="check" :size="24" /></span>
        <h1>{{ resultMode === 'rescheduled' ? text.rescheduledTitle : text.title }}</h1>
        <p v-if="resultMode === 'rescheduled'" role="status">{{ text.rescheduledText }}</p>
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
        <span class="gm-state-icon danger" aria-hidden="true"><AppIcon name="alert" :size="24" /></span>
        <h1>{{ text.cancelTitle }}</h1>
        <p class="gm-cancel-what">{{ dateTime }}<template v-if="booking.serviceName">, {{ booking.serviceName }}</template></p>
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
        <p v-if="!availabilityLoading && calendarDegraded" class="gm-notice" role="status">{{ text.calendarUnchecked }}</p>
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
                <button v-else type="button" :class="{ open: cell.count, selected: selectedDate === cell.key }" :disabled="acting || !cell.count || availabilityLoading" :aria-label="cell.count ? t('cal.dayTimes', { day: dayLabel(cell.key), count: cell.count }) : t('cal.dayNone', { day: dayLabel(cell.key) })" @click="selectedDate = cell.key; selectedSlot = null">{{ cell.day }}</button>
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
              <button v-for="slot in slots" :key="slot.startsAt" type="button" :disabled="acting" :class="{ selected: selectedSlot?.startsAt === slot.startsAt }" :aria-pressed="selectedSlot?.startsAt === slot.startsAt" :aria-label="`${dayLabel(selectedDate)}, ${clockText(slot.startsAt)}`" @click="selectedSlot = slot">
                {{ clockText(slot.startsAt) }}
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
/* Styled with the guest page tokens from Book.vue (--accent, --card, --line, --err...), so every theme applies. */
.gm {
  width: min(1120px, 100%);
  min-height: 490px;
  margin: 0 auto;
  padding: 36px 40px 40px;
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--card);
  box-shadow: 0 12px 34px var(--shadow);
}
.gm :where(h1, p, dl, dd) { margin: 0; }
.gm :where(button):focus-visible { outline: 2px solid var(--focus, var(--accent)); outline-offset: 2px; }
.gm-state { min-height: 410px; display: grid; align-content: center; justify-items: center; gap: 10px; text-align: center; }
.gm-state h1, .gm-reschedule h1 { font-size: 24px; line-height: 1.2; letter-spacing: -0.03em; }
.gm-state > p { max-width: 470px; color: var(--muted); }
.gm-state > p.gm-cancel-what { color: var(--ink); font-weight: 650; }
.gm-state-icon { width: 54px; height: 54px; margin-bottom: 8px; display: grid; place-items: center; color: var(--muted); border-radius: 50%; background: var(--surface); }
.gm-state-icon.success { color: var(--ok); background: var(--ok-bg); }
.gm-state-icon.danger { color: var(--err); background: var(--err-bg); }
.gm-spinner { width: 34px; height: 34px; border: 3px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: gm-spin 0.8s linear infinite; }
.gm-button { min-height: 44px; padding: 0 16px; color: var(--ink); border: 1px solid var(--input-line); border-radius: 8px; background: var(--card); font: inherit; font-weight: 650; cursor: pointer; }
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
.gm-notice { max-width: 520px !important; padding: 10px 12px; color: var(--warn) !important; border: 1px solid var(--warn-bd); border-radius: 8px; background: var(--warn-bg); font-size: 14px; }
.gm-error { max-width: 680px; padding: 10px 12px; color: var(--err); border: 1px solid var(--err-bd); border-radius: 7px; background: var(--err-bg); }
.gm-state.cancel { padding: 24px; }
.gm-reschedule { display: grid; gap: 22px; }
.gm-reschedule > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.gm-reschedule > header p { margin-top: 7px; color: var(--muted); }
.gm-picker { display: grid; grid-template-columns: minmax(360px, 420px) 220px; justify-content: center; gap: 32px; }
.gm-calendar-head { min-height: 38px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.gm-calendar-head > span { display: flex; gap: 4px; }
.gm-calendar-head button { width: 34px; height: 34px; display: grid; place-items: center; color: var(--ink); border: 0; border-radius: 7px; background: transparent; cursor: pointer; }
.gm-calendar-head button:hover { background: var(--surface); }
.gm-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.gm-days.labels { margin-bottom: 6px; color: var(--muted); font-size: 12px; font-weight: 650; text-align: center; }
.gm-days button { width: 100%; min-width: 0; min-height: 40px; max-width: 56px; justify-self: center; aspect-ratio: 1 / 1; padding: 0; color: var(--soft); border: 1px solid transparent; border-radius: 8px; background: transparent; font: inherit; font-size: 14px; font-variant-numeric: tabular-nums; cursor: default; }
.gm-days button.open { color: var(--ink); border-color: var(--line); background: var(--surface); font-weight: 650; cursor: pointer; }
.gm-days button.open:hover { border-color: var(--accent); }
.gm-days button.selected { color: var(--on-accent, #fff); border-color: var(--accent); background: var(--accent); font-weight: 700; }
.gm-slots { padding-left: 22px; border-left: 1px solid var(--line); }
.gm-slot-list { display: grid; gap: 8px; }
.gm-slot-list button { min-height: 48px; padding: 0 14px; color: var(--ink); border: 1px solid var(--input-line); border-left-width: 4px; border-radius: 3px 8px 8px 3px; background: var(--card); font: inherit; font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; text-align: left; cursor: pointer; }
.gm-slot-list button:hover:not(:disabled) { border-color: var(--accent); }
.gm-slot-list button.selected { color: var(--on-accent, #fff); border-color: var(--accent); background: var(--accent); }
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
