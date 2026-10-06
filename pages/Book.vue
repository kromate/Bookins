<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { initLocale, intlLocale, locale, setLocale, t } from '../i18n/guest.js'
import AppIcon from '../components/AppIcon.vue'
import BookinsLogo from '../components/BookinsLogo.vue'
import { demoGuestApi } from '../demo/guest.js'
import {
  isLocalPreview,
  loadGuestCalendarBusy,
  loadGuestOpenings,
  loadGuestPage,
  openingOverlapsBusy,
  submitGuestBooking,
} from '../booking.js'
import {
  buildBookingIcs,
  detectGuestTimeZone,
  displayTimeZone,
  formatClock,
  formatDateClock,
  googleCalendarUrl,
  zonedDateKey,
  zoneDisplayLabel,
} from '../time-display.js'

const props = defineProps({ demoPreview: { type: Boolean, default: false } })
initLocale()

const MAX_RANGE_DAYS = 31
const RESULT_CAP = 100 // smallest per-call cap across hosted (200), local and demo engines
const SEARCH_AHEAD_DAYS = 366
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_PATTERN = /^[+()\-.\s\d]{6,40}$/

const loading = ref(true)
const pageError = ref(null) // { kind, retry }
const page = ref(null)
const selectedService = ref(null)
const selectedSlot = ref(null)
const submitting = ref(false)
const confirmation = ref(null)
const notes = ref('')
const contact = reactive({ name: '', email: '', phone: '' })
const touched = reactive({ name: false, email: false, phone: false })
const serverFieldErrors = reactive({ name: '', email: '', phone: '' })
const submitAttempted = ref(false)
const banner = ref(null)
const bannerPanel = ref(null)
const stepHeading = ref(null)
const confirmHeading = ref(null)
const photoFailed = ref(false)

// Availability state
const guestTz = detectGuestTimeZone()
const tzMode = ref('guest')
const openingStore = shallowRef(new Map())
const covered = new Set()
// Convenience filter only: hides openings that overlap the owner's Google Calendar busy times.
// It is not checked when the booking is created, and silently stops after the first failure.
let calendarBusyOff = props.demoPreview
let requestSeq = 0
const rangeLoading = ref(false)
const rangeError = ref('') // i18n key; empty when there is no error
let rangeRetried = false
let pageRetried = false
const nextHint = ref({ state: 'idle', key: '' })
const selectedDate = ref('')
const viewMonth = reactive({ year: 0, month: 0 })

// Idempotency: one key per booking attempt (service + slot + contact + notes).
let attemptKey = null
let attemptSignature = ''
// Key of an attempt whose outcome is unknown (lost response). A later SLOT_TAKEN for the
// same key may be the guest's own booking, so it must not be reported as someone else's.
let uncertainKey = null
let interacted = false

const ownerTz = computed(() => {
  const first = openingStore.value.values().next().value
  return displayTimeZone(first?.timezone || page.value?.profile?.timezone)
})
const displayedTimezone = computed(() => (tzMode.value === 'owner' ? ownerTz.value : guestTz))
const zonesDiffer = computed(() => ownerTz.value !== guestTz)
const todayKey = computed(() => zonedDateKey(new Date(), displayedTimezone.value))
const step = computed(() => (selectedSlot.value ? 3 : selectedService.value ? 2 : 1))
const api = () => (props.demoPreview ? demoGuestApi.loadGuestOpenings : loadGuestOpenings)

const safePhotoUrl = computed(() => {
  const raw = page.value?.profile?.photoUrl
  if (typeof raw !== 'string' || !raw.trim()) return ''
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : ''
  } catch {
    return ''
  }
})
const showPhoto = computed(() => safePhotoUrl.value && !photoFailed.value)
const hostInitial = computed(() => (Array.from(String(page.value?.profile?.displayName || '').trim())[0] || '•').toUpperCase())

// ---- date helpers (calendar keys are plain YYYY-MM-DD strings, UTC arithmetic) ----
const pad = value => String(value).padStart(2, '0')
function addDays(key, count) {
  const value = new Date(`${key}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + count)
  return value.toISOString().slice(0, 10)
}
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}
const monthKey = (year, month) => `${year}-${pad(month + 1)}`
const monthFirst = (year, month) => `${monthKey(year, month)}-01`
const monthLast = (year, month) => `${monthKey(year, month)}-${pad(new Date(Date.UTC(year, month + 1, 0)).getUTCDate())}`
function setViewFromKey(key) {
  viewMonth.year = Number(key.slice(0, 4))
  viewMonth.month = Number(key.slice(5, 7)) - 1
}
function dayLabel(key, options = { weekday: 'long', month: 'short', day: 'numeric' }) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(intlLocale(), { ...options, timeZone: 'UTC' })
}
const zoneLabel = (zone, at = new Date()) => zoneDisplayLabel(zone, intlLocale(), at)
const displayedZoneLabel = computed(() => zoneLabel(displayedTimezone.value))

// ---- availability ----
const availableDays = computed(() => {
  const days = new Map()
  const zone = displayedTimezone.value
  const sorted = [...openingStore.value.values()].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  for (const opening of sorted) {
    const key = zonedDateKey(opening.startsAt, zone)
    if (!days.has(key)) days.set(key, [])
    days.get(key).push(opening)
  }
  return days
})
const monthLabel = computed(() =>
  new Date(Date.UTC(viewMonth.year, viewMonth.month, 1)).toLocaleDateString(intlLocale(), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }),
)
const weekdayLabels = computed(() =>
  Array.from({ length: 7 }, (_, index) =>
    new Date(Date.UTC(2024, 0, 7 + index)).toLocaleDateString(intlLocale(), { weekday: 'short', timeZone: 'UTC' }),
  ),
)
const calendarCells = computed(() => {
  const { year, month } = viewMonth
  const total = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const cells = Array.from({ length: lead }, (_, index) => ({ key: `blank-${index}`, blank: true }))
  for (let day = 1; day <= total; day += 1) {
    const key = `${monthKey(year, month)}-${pad(day)}`
    const count = availableDays.value.get(key)?.length || 0
    cells.push({ key, day, count, past: key < todayKey.value })
  }
  return cells
})
const monthHasOpenings = computed(() => calendarCells.value.some(cell => cell.count > 0))
const canGoPrev = computed(() => monthKey(viewMonth.year, viewMonth.month) > todayKey.value.slice(0, 7))
const canGoNext = computed(() => monthKey(viewMonth.year, viewMonth.month) < addDays(todayKey.value, 365).slice(0, 7))
const slotsForSelectedDay = computed(() => availableDays.value.get(selectedDate.value) || [])

function resetAvailability() {
  requestSeq += 1
  openingStore.value = new Map()
  covered.clear()
  rangeLoading.value = false
  rangeError.value = ''
  nextHint.value = { state: 'idle', key: '' }
  selectedDate.value = ''
}

async function fetchSpan(serviceId, from, to) {
  const result = await api()(serviceId, from, to)
  const list = result?.openings || []
  if (list.length >= RESULT_CAP && from < to) {
    const mid = addDays(from, Math.floor(daysBetween(from, to) / 2))
    const left = await fetchSpan(serviceId, from, mid)
    const right = await fetchSpan(serviceId, addDays(mid, 1), to)
    return [...left, ...right]
  }
  return list
}

async function withoutBusy(list) {
  if (calendarBusyOff || !list.length) return list
  const starts = list.map(item => Date.parse(item.startsAt)).filter(Number.isFinite)
  const ends = list.map(item => Date.parse(item.endsAt) || Date.parse(item.startsAt)).filter(Number.isFinite)
  if (!starts.length) return list
  const busy = await loadGuestCalendarBusy(Math.min(...starts), Math.max(...ends) + 1)
  if (!busy) {
    calendarBusyOff = true
    return list
  }
  return list.filter(item => !openingOverlapsBusy(item, busy))
}

/** Load [from, through] (schedule-zone dates, at most 31 days per call). Returns false when superseded. */
async function ensureRange(from, through, seq) {
  const serviceId = selectedService.value?.id
  if (!serviceId) return false
  const first = from < addDays(todayKey.value, -1) ? addDays(todayKey.value, -1) : from
  const missing = []
  for (let day = first; day <= through; day = addDays(day, 1)) if (!covered.has(day)) missing.push(day)
  if (!missing.length) return true
  for (let index = 0; index < missing.length; ) {
    const chunkStart = missing[index]
    let chunkEnd = chunkStart
    let length = 1
    while (index + length < missing.length && length < MAX_RANGE_DAYS && missing[index + length] === addDays(chunkEnd, 1)) {
      chunkEnd = missing[index + length]
      length += 1
    }
    const fetched = await fetchSpan(serviceId, chunkStart, chunkEnd)
    if (seq !== requestSeq) return false
    const list = await withoutBusy(fetched)
    if (seq !== requestSeq) return false
    const next = new Map(openingStore.value)
    for (const opening of list) next.set(opening.startsAt, opening)
    openingStore.value = next
    for (let offset = 0; offset < length; offset += 1) covered.add(addDays(chunkStart, offset))
    index += length
  }
  return true
}

function firstDayOnOrAfter(key) {
  for (const day of availableDays.value.keys()) if (day >= key) return day
  return ''
}

/** Scans forward in <=31-day calls until a day with openings is found (or the search window ends). */
async function findNextAvailable(fromKey, seq) {
  const start = fromKey < todayKey.value ? todayKey.value : fromKey
  const limit = addDays(todayKey.value, SEARCH_AHEAD_DAYS)
  for (let cursor = start; cursor <= limit; cursor = addDays(cursor, MAX_RANGE_DAYS)) {
    const through = addDays(cursor, MAX_RANGE_DAYS - 1)
    // One day of padding covers guest-zone/schedule-zone date differences.
    if (!(await ensureRange(addDays(cursor, -1), addDays(through, 1), seq))) return null
    const found = firstDayOnOrAfter(start)
    if (found) return found
  }
  return ''
}

function errorKeyFor(reason, fallback) {
  const code = errorCode(reason)
  if (code === 'BOOKING_SERVICE_NOT_FOUND') return 'err.serviceGone'
  if (code === 'BOOKING_SCHEDULE_UNAVAILABLE') return 'err.noSchedule'
  if (isNetworkError(reason)) return 'err.networkRange'
  return fallback
}

async function loadMonth() {
  const seq = ++requestSeq
  rangeLoading.value = true
  rangeError.value = ''
  nextHint.value = { state: 'idle', key: '' }
  try {
    const ok = await ensureRange(addDays(monthFirst(viewMonth.year, viewMonth.month), -1), addDays(monthLast(viewMonth.year, viewMonth.month), 1), seq)
    if (!ok || seq !== requestSeq) return
    if (selectedDate.value && !availableDays.value.has(selectedDate.value)) selectedDate.value = ''
    if (!monthHasOpenings.value) {
      nextHint.value = { state: 'searching', key: '' }
      const fromKey = monthFirst(viewMonth.year, viewMonth.month) < todayKey.value ? todayKey.value : addDays(monthLast(viewMonth.year, viewMonth.month), 1)
      const found = await findNextAvailable(fromKey, seq)
      if (found === null || seq !== requestSeq) return
      nextHint.value = { state: found ? 'found' : 'none', key: found }
    }
  } catch (reason) {
    if (seq !== requestSeq) return
    rangeError.value = errorKeyFor(reason, 'err.availability')
  } finally {
    if (seq === requestSeq) rangeLoading.value = false
  }
}

async function initialJump() {
  const seq = ++requestSeq
  rangeLoading.value = true
  rangeError.value = ''
  setViewFromKey(todayKey.value)
  try {
    const found = await findNextAvailable(todayKey.value, seq)
    if (found === null || seq !== requestSeq) return
    if (found) {
      selectedDate.value = found
      setViewFromKey(found)
      await loadMonth()
    } else {
      nextHint.value = { state: 'none', key: '' }
      rangeLoading.value = false
    }
  } catch (reason) {
    if (seq !== requestSeq) return
    rangeError.value = errorKeyFor(reason, 'err.availability')
    rangeLoading.value = false
  }
}

function retryAvailability() {
  rangeError.value = ''
  if (selectedDate.value || monthHasOpenings.value || openingStore.value.size) loadMonth()
  else initialJump()
}

function shiftMonth(delta) {
  const value = new Date(Date.UTC(viewMonth.year, viewMonth.month + delta, 1))
  viewMonth.year = value.getUTCFullYear()
  viewMonth.month = value.getUTCMonth()
  selectedDate.value = ''
  loadMonth()
}

async function jumpToNext() {
  const key = nextHint.value.key
  if (!key) return
  selectedDate.value = key
  setViewFromKey(key)
  await loadMonth()
  selectedDate.value = key
}

function pickDay(cell) {
  if (!cell.count) return
  selectedDate.value = cell.key
}

// Re-bucket days when the display zone changes.
watch(displayedTimezone, () => {
  if (!selectedService.value) return
  if (selectedSlot.value) {
    const key = zonedDateKey(selectedSlot.value.startsAt, displayedTimezone.value)
    selectedDate.value = key
    setViewFromKey(key)
  } else {
    selectedDate.value = ''
    setViewFromKey(todayKey.value)
    initialJump()
  }
})

// ---- formatting ----
function priceLabel(service) {
  if (!Number(service.price)) return t('svc.free')
  try {
    return new Intl.NumberFormat(intlLocale(), {
      style: 'currency',
      currency: service.currency || 'NGN',
      maximumFractionDigits: 0,
    }).format(service.price)
  } catch {
    return `${service.currency || 'NGN'} ${Number(service.price).toLocaleString()}`
  }
}
// One clock formatter (formatClock) feeds slot buttons, summaries and the confirmation.
const slotTime = slot => formatClock(slot.startsAt, intlLocale(), displayedTimezone.value)
const longDateTime = (value, zone = displayedTimezone.value) => formatDateClock(value, intlLocale(), zone, 'full')
const selectedSlotLabel = computed(() =>
  selectedSlot.value ? formatDateClock(selectedSlot.value.startsAt, intlLocale(), displayedTimezone.value, 'medium') : '',
)
const stepKeys = ['steps.service', 'steps.time', 'steps.details', 'steps.done']
const shownStep = computed(() => (confirmation.value ? 4 : step.value))
const slotPlaceholders = [0, 1, 2, 3, 4, 5]
const refCopied = ref(false)
async function copyReference() {
  try {
    await navigator.clipboard.writeText(String(confirmation.value?.reference ?? ''))
    refCopied.value = true
    setTimeout(() => { refCopied.value = false }, 2000)
  } catch { /* clipboard unavailable: the reference stays visible and selectable */ }
}

// ---- error classification ----
function errorCode(reason) {
  const raw = reason?.code ?? reason?.data?.code ?? reason?.error?.code ?? reason?.cause?.code
  const code = typeof raw === 'string' ? raw.toUpperCase() : ''
  if (code.startsWith('BOOKING_')) return code
  const message = String(reason?.message || '')
  if (/taken|booked by someone|no longer (available|free)|already booked/i.test(message)) return 'BOOKING_SLOT_TAKEN'
  if (/contact|e-?mail|valid name|name is required/i.test(message)) return 'BOOKING_CONTACT_INVALID'
  if (/service.*(unavailable|not found)/i.test(message)) return 'BOOKING_SERVICE_NOT_FOUND'
  if (/no active availability/i.test(message)) return 'BOOKING_SCHEDULE_UNAVAILABLE'
  return code
}
function isNetworkError(reason) {
  const message = String(reason?.message || '')
  return (
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    /network|failed to fetch|offline|timed? ?out|load failed|connection/i.test(message)
  )
}
function classifyPageError(reason) {
  const code = errorCode(reason)
  const message = String(reason?.message || '')
  const status = Number(reason?.status ?? reason?.data?.status ?? reason?.statusCode)
  if (reason instanceof TypeError && /GoalmaticGuest|undefined|null/i.test(message) && !isNetworkError(reason))
    return pageErrors.runtime
  if (/GoalmaticGuest/i.test(message)) return pageErrors.runtime
  if (code === 'BOOKING_PROFILE_REQUIRED') return pageErrors.notReady
  if ([401, 403, 404, 410].includes(status) || /link|expired|revoked|forbidden|unauthori[sz]ed|token|not found/i.test(`${code} ${message}`))
    return pageErrors.link
  if (isNetworkError(reason)) return pageErrors.network
  return pageErrors.generic
}
const pageErrors = {
  link: { kind: 'link', retry: false },
  runtime: { kind: 'runtime', retry: true },
  notReady: { kind: 'notReady', retry: false },
  network: { kind: 'network', retry: true },
  generic: { kind: 'generic', retry: true },
}

// ---- navigation ----
function selectSlot(slot) {
  interacted = true
  selectedSlot.value = slot
  banner.value = null
}

function back() {
  if (submitting.value) return
  interacted = true
  banner.value = null
  if (selectedSlot.value) {
    selectedSlot.value = null
    return
  }
  selectedService.value = null
  resetAvailability()
}

async function choose(service) {
  selectedService.value = service
  selectedSlot.value = null
  banner.value = null
  resetAvailability()
  await initialJump()
}

async function start() {
  loading.value = true
  pageError.value = null
  photoFailed.value = false
  try {
    if (!props.demoPreview && !isLocalPreview() && typeof window.GoalmaticGuest === 'undefined') {
      pageError.value = pageErrors.runtime
      return
    }
    const result = await (props.demoPreview ? demoGuestApi.loadGuestPage() : loadGuestPage())
    page.value = { ...result, services: Array.isArray(result?.services) ? result.services : [], profile: result?.profile || {} }
    // A service-subject link returns exactly one service (including private ones): skip straight to times.
    if (page.value.services.length === 1) await choose(page.value.services[0])
  } catch (reason) {
    pageError.value = classifyPageError(reason)
  } finally {
    loading.value = false
  }
}

// ---- form validation ----
const fieldErrors = computed(() => ({
  name: contact.name.trim() ? '' : t('form.errName'),
  email: !contact.email.trim()
    ? t('form.errEmailEmpty')
    : EMAIL_PATTERN.test(contact.email.trim())
      ? ''
      : t('form.errEmail'),
  phone:
    !contact.phone.trim() || (PHONE_PATTERN.test(contact.phone.trim()) && contact.phone.replace(/\D/g, '').length >= 6)
      ? ''
      : t('form.errPhone'),
}))
const shownError = field =>
  (serverFieldErrors[field] ? t(serverFieldErrors[field]) : '') ||
  (touched[field] || submitAttempted.value ? fieldErrors.value[field] : '')
for (const field of ['name', 'email', 'phone']) watch(() => contact[field], () => { serverFieldErrors[field] = '' })

function newKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}
function keyForAttempt(payload) {
  const signature = JSON.stringify([payload.serviceId, payload.startsAt, payload.contact, payload.notes])
  if (!attemptKey || signature !== attemptSignature) {
    attemptKey = newKey()
    attemptSignature = signature
  }
  return attemptKey
}
function resetAttempt() {
  attemptKey = null
  attemptSignature = ''
  uncertainKey = null
}

function showBanner(kind, key) {
  banner.value = { kind, key }
  nextTick(() => bannerPanel.value?.focus())
}

async function refreshAfterSlotTaken() {
  const keepDate = selectedDate.value
  requestSeq += 1
  openingStore.value = new Map()
  covered.clear()
  selectedSlot.value = null
  resetAttempt()
  showBanner('slot', 'banner.slotTaken')
  await loadMonth()
  if (keepDate && availableDays.value.has(keepDate)) selectedDate.value = keepDate
}

async function handleSubmitError(reason, key) {
  const code = errorCode(reason)
  if (code === 'BOOKING_SLOT_TAKEN' && key && key === uncertainKey) {
    return showBanner('retry', 'banner.uncertainTaken')
  }
  if (code === 'BOOKING_SLOT_TAKEN') return refreshAfterSlotTaken()
  if (code === 'BOOKING_CONTACT_INVALID') {
    const message = String(reason?.message || '')
    if (/e-?mail/i.test(message)) serverFieldErrors.email = 'form.srvEmail'
    else if (/name/i.test(message)) serverFieldErrors.name = 'form.srvName'
    else if (/phone/i.test(message)) serverFieldErrors.phone = 'form.srvPhone'
    else {
      serverFieldErrors.name = fieldErrors.value.name ? 'form.errName' : ''
      serverFieldErrors.email = fieldErrors.value.email ? (contact.email.trim() ? 'form.errEmail' : 'form.errEmailEmpty') : 'form.srvEmail'
    }
    showBanner('contact', 'banner.contact')
    return nextTick(() => document.querySelector('[aria-invalid="true"]')?.focus())
  }
  if (code === 'BOOKING_SERVICE_NOT_FOUND' || code === 'BOOKING_SCHEDULE_UNAVAILABLE') {
    selectedSlot.value = null
    selectedService.value = null
    resetAvailability()
    resetAttempt()
    showBanner('unavailable', 'banner.serviceGone')
    try {
      const refreshed = await loadGuestPage()
      page.value = { ...page.value, services: Array.isArray(refreshed?.services) ? refreshed.services : [] }
    } catch { /* keep the list we already have */ }
    return
  }
  if (['BOOKING_RANGE_INVALID', 'BOOKING_SCHEDULE_INVALID', 'BOOKING_SERVICE_INVALID'].includes(code)) {
    return showBanner('unavailable', 'banner.cannotBook')
  }
  // Network or unknown: keep the slot and the idempotency key so a retry is safe.
  uncertainKey = key
  showBanner('retry', isNetworkError(reason) ? 'banner.retryNetwork' : 'banner.retryOther')
}

async function submit() {
  if (submitting.value || !selectedService.value || !selectedSlot.value) return
  if (props.demoPreview) {
    showBanner('unavailable', 'banner.demo')
    return
  }
  submitAttempted.value = true
  if (fieldErrors.value.name || fieldErrors.value.email || fieldErrors.value.phone) {
    await nextTick()
    document.querySelector('.guest-form [aria-invalid="true"]')?.focus()
    return
  }
  const payload = {
    serviceId: selectedService.value.id,
    startsAt: selectedSlot.value.startsAt,
    contact: { name: contact.name.trim(), email: contact.email.trim(), phone: contact.phone.trim() },
    notes: notes.value.trim(),
  }
  const key = keyForAttempt(payload)
  submitting.value = true
  banner.value = null
  try {
    confirmation.value = await submitGuestBooking(payload, key)
    resetAttempt()
  } catch (reason) {
    await handleSubmitError(reason, key)
  } finally {
    submitting.value = false
  }
}

// ---- confirmation ----
const confirmationEnd = computed(() => {
  const value = confirmation.value
  if (!value) return ''
  if (value.endsAt) return value.endsAt
  const minutes = Number(selectedService.value?.durationMinutes) || 60
  return new Date(Date.parse(value.startsAt) + minutes * 60_000).toISOString()
})
const confirmationOwnerTz = computed(() => displayTimeZone(confirmation.value?.timezone || ownerTz.value))
const calendarEvent = computed(() => {
  const value = confirmation.value
  if (!value) return null
  return {
    reference: value.reference,
    summary: t('ics.summary', { service: value.serviceName, host: page.value?.profile?.displayName || t('host.fallback') }),
    description: t('ics.description', { reference: value.reference }),
    startsAt: value.startsAt,
    endsAt: confirmationEnd.value,
  }
})
const googleUrl = computed(() =>
  calendarEvent.value ? `${googleCalendarUrl(calendarEvent.value)}&hl=${encodeURIComponent(locale.value)}` : '',
)
const confirmationDuration = computed(() =>
  confirmation.value ? Math.round((Date.parse(confirmationEnd.value) - Date.parse(confirmation.value.startsAt)) / 60_000) : 0,
)

async function bookAnother() {
  confirmation.value = null
  selectedSlot.value = null
  notes.value = ''
  submitAttempted.value = false
  banner.value = null
  resetAttempt()
  interacted = true
  window.scrollTo({ top: 0 })
  if (singleService.value) await choose(page.value.services[0])
  else {
    selectedService.value = null
    resetAvailability()
  }
}

function downloadIcs() {
  if (!calendarEvent.value) return
  const blob = new Blob([buildBookingIcs(calendarEvent.value)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `booking-${String(calendarEvent.value.reference).replace(/[^\w-]+/g, '-')}.ics`
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---- focus management ----
watch(step, async () => {
  if (!interacted || banner.value) return
  await nextTick()
  stepHeading.value?.focus({ preventScroll: false })
})
watch(confirmation, async value => {
  if (!value) return
  window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  await nextTick()
  confirmHeading.value?.focus()
})

function chooseService(service) {
  interacted = true
  choose(service)
}

// Connectivity: when the connection returns, retry a failed page/openings load once. Form state lives
// in this component (not in the failed views), so nothing the guest typed is dropped.
function onOnline() {
  if (pageError.value?.retry && !pageRetried) {
    pageRetried = true
    start()
  } else if (rangeError.value === 'err.networkRange' && !rangeRetried && selectedService.value) {
    rangeRetried = true
    retryAvailability()
  }
}
const retryPage = () => {
  pageRetried = false
  start()
}
const retryRange = () => {
  rangeRetried = false
  retryAvailability()
}
const singleService = computed(() => (page.value?.services?.length || 0) === 1)
const showBack = computed(() => step.value > 2 || (step.value === 2 && !singleService.value))

onMounted(() => {
  window.addEventListener('online', onOnline)
  start()
})
onBeforeUnmount(() => {
  requestSeq += 1
  window.removeEventListener('online', onOnline)
})
</script>

<template>
  <div class="public-shell" :data-demo-guest-ready="demoPreview && !loading && !pageError ? 'true' : undefined">
    <header class="public-header">
      <a href="/" aria-label="Bookins"><BookinsLogo /></a>
      <div class="header-end">
        <span class="secure-note"><AppIcon name="lock" :size="14" />{{ demoPreview ? t('header.demo') : t('header.secure') }}</span>
        <div class="lang-toggle" role="group" :aria-label="t('lang.label')">
          <button type="button" lang="en" :aria-pressed="locale === 'en'" :class="{ active: locale === 'en' }" @click="setLocale('en')">EN</button>
          <span aria-hidden="true">|</span>
          <button type="button" lang="fr" :aria-pressed="locale === 'fr'" :class="{ active: locale === 'fr' }" @click="setLocale('fr')">FR</button>
        </div>
      </div>
    </header>
    <div v-if="demoPreview" class="demo-preview-banner" role="status">
      <strong>{{ t('demo.title') }}</strong>
      <span>{{ t('demo.text') }}</span>
    </div>
    <main>
      <div v-if="loading" class="public-state" role="status" aria-live="polite">
        <span class="public-spinner" />
        <h1>{{ t('loading.title') }}</h1>
        <p>{{ t('loading.text') }}</p>
      </div>
      <div v-else-if="pageError" class="public-state error-state" role="alert">
        <span class="state-symbol" aria-hidden="true">!</span>
        <h1>{{ t(`err.${pageError.kind}.title`) }}</h1>
        <p>{{ t(`err.${pageError.kind}.text`) }}</p>
        <button v-if="pageError.retry" class="secondary" type="button" @click="retryPage">{{ t('retry') }}</button>
      </div>

      <div v-else-if="confirmation" class="confirmation-wrap">
        <ol class="stepper" :aria-label="t('steps.aria')">
          <li
            v-for="(key, index) in stepKeys"
            :key="key"
            :class="{ active: shownStep === index + 1, done: shownStep > index + 1 }"
            :aria-current="shownStep === index + 1 ? 'step' : undefined"
          ><i aria-hidden="true"><AppIcon v-if="shownStep > index + 1" name="check" :size="12" :stroke-width="3" /><template v-else>{{ index + 1 }}</template></i><span>{{ t(key) }}</span></li>
        </ol>
        <article class="confirmation-card">
          <span class="confirmation-check"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
          <p class="eyebrow">{{ t('confirm.eyebrow') }}</p>
          <h1 ref="confirmHeading" tabindex="-1">{{ t('confirm.title') }}</h1>
          <p class="confirmation-copy">{{ t('confirm.copy', { host: page.profile.displayName }) }}</p>
          <div class="confirmation-event">
            <span><AppIcon name="calendar" :size="22" /></span>
            <div>
              <strong>{{ confirmation.serviceName }}</strong>
              <small>{{ longDateTime(confirmation.startsAt) }}</small>
              <small>{{ displayedZoneLabel }}</small>
              <small v-if="confirmationOwnerTz !== displayedTimezone">
                {{ t('confirm.hostTime', { time: longDateTime(confirmation.startsAt, confirmationOwnerTz), zone: zoneLabel(confirmationOwnerTz) }) }}
              </small>
            </div>
          </div>
          <div class="reference-box">
            <div>
              <span>{{ t('confirm.reference') }}</span>
              <code>{{ confirmation.reference }}</code>
            </div>
            <button type="button" class="secondary small-button" :aria-label="t('confirm.copyAria')" @click="copyReference">
              {{ refCopied ? t('confirm.copied') : t('confirm.copyRef') }}
            </button>
            <p class="visually-hidden" role="status">{{ refCopied ? t('confirm.copied') : '' }}</p>
          </div>
          <dl>
            <div><dt>{{ t('confirm.duration') }}</dt><dd>{{ t('confirm.minutes', { count: confirmationDuration }) }}</dd></div>
          </dl>
          <div class="calendar-actions">
            <button class="secondary" type="button" @click="downloadIcs">
              <AppIcon name="calendar" :size="15" />{{ t('confirm.ics') }}
            </button>
            <a class="secondary calendar-link" :href="googleUrl" target="_blank" rel="noopener noreferrer">
              {{ t('confirm.google') }}
            </a>
          </div>
          <button class="primary another-button" type="button" @click="bookAnother">{{ t('confirm.another') }}</button>
          <p class="truth-note">
            {{ t('confirm.note') }}
          </p>
        </article>
      </div>

      <template v-else>
        <section class="host-card" :class="{ compact: step > 1 }">
          <img
            v-if="showPhoto"
            :src="safePhotoUrl"
            alt=""
            referrerpolicy="no-referrer"
            loading="lazy"
            @error="photoFailed = true"
          />
          <span v-else class="host-avatar" aria-hidden="true">{{ hostInitial }}</span>
          <div>
            <p class="eyebrow">{{ t('host.eyebrow') }}</p>
            <h1>{{ page.profile.displayName }}</h1>
            <p v-if="page.profile.bio && step === 1" class="host-bio">{{ page.profile.bio }}</p>
            <span class="tz-line">
              <AppIcon name="clock" :size="14" />
              <label v-if="zonesDiffer" for="booking-tz-mode">{{ t('tz.shownIn') }}</label>
              <span v-else>{{ t('tz.shownInZone', { zone: displayedZoneLabel }) }}</span>
              <select v-if="zonesDiffer" id="booking-tz-mode" v-model="tzMode" :disabled="submitting">
                <option value="guest">{{ t('tz.guest', { zone: zoneLabel(guestTz) }) }}</option>
                <option value="owner">{{ t('tz.owner', { zone: zoneLabel(ownerTz) }) }}</option>
              </select>
            </span>
          </div>
        </section>

        <ol class="stepper" :aria-label="t('steps.aria')">
          <li
            v-for="(key, index) in stepKeys"
            :key="key"
            :class="{ active: shownStep === index + 1, done: shownStep > index + 1 }"
            :aria-current="shownStep === index + 1 ? 'step' : undefined"
          ><i aria-hidden="true"><AppIcon v-if="shownStep > index + 1" name="check" :size="12" :stroke-width="3" /><template v-else>{{ index + 1 }}</template></i><span>{{ t(key) }}</span></li>
        </ol>

        <div class="booking-card">
          <section class="booking-content">
            <div v-if="banner" ref="bannerPanel" tabindex="-1" role="alert" class="public-inline-error" :class="`banner-${banner.kind}`">
              <p>{{ t(banner.key) }}</p>
            </div>
            <button v-if="showBack" class="back-button" :disabled="submitting" type="button" @click="back">
              <AppIcon name="arrow-left" :size="16" />{{ t('back') }}
            </button>

            <template v-if="step === 1">
              <div class="booking-heading">
                <p class="eyebrow">{{ t('steps.of', { n: 1 }) }}</p>
                <h2 ref="stepHeading" tabindex="-1">{{ t('svc.title') }}</h2>
                <p>{{ t('svc.text') }}</p>
              </div>
              <div v-if="page.services.length" class="service-options">
                <button v-for="service in page.services" :key="service.id" class="service-option" type="button" @click="chooseService(service)">
                  <span class="service-option-icon"><AppIcon name="sparkle" :size="19" /></span>
                  <span class="service-option-copy">
                    <strong>{{ service.name }}</strong>
                    <small>{{ service.description }}</small>
                    <span>
                      <b><AppIcon name="clock" :size="13" />{{ t('svc.min', { count: service.durationMinutes }) }}</b>
                      <b>{{ priceLabel(service) }}</b>
                    </span>
                  </span>
                  <AppIcon name="chevron" :size="18" />
                </button>
              </div>
              <div v-else class="public-empty">
                <AppIcon name="calendar" :size="24" />
                <h2>{{ t('svc.emptyTitle') }}</h2>
                <p>{{ t('svc.emptyText', { host: page.profile.displayName }) }}</p>
              </div>
            </template>

            <template v-else-if="step === 2">
              <div class="booking-heading">
                <p class="eyebrow">{{ t('steps.of', { n: 2 }) }}</p>
                <h2 ref="stepHeading" tabindex="-1">{{ t('time.title') }}</h2>
                <p>{{ t('time.sub', { service: selectedService.name, count: selectedService.durationMinutes }) }}</p>
              </div>

              <div class="calendar" role="group" :aria-label="t('cal.aria')">
                <div class="calendar-head">
                  <button type="button" class="cal-nav" :disabled="!canGoPrev || rangeLoading" :aria-label="t('cal.prev')" @click="shiftMonth(-1)">
                    <AppIcon name="arrow-left" :size="16" />
                  </button>
                  <h3 aria-live="polite">{{ monthLabel }}</h3>
                  <button type="button" class="cal-nav" :disabled="!canGoNext || rangeLoading" :aria-label="t('cal.next')" @click="shiftMonth(1)">
                    <AppIcon name="chevron" :size="16" />
                  </button>
                </div>
                <div class="calendar-grid weekdays" aria-hidden="true">
                  <span v-for="label in weekdayLabels" :key="label">{{ label }}</span>
                </div>
                <div class="calendar-grid" :class="{ busy: rangeLoading }">
                  <template v-for="cell in calendarCells" :key="cell.key">
                    <span v-if="cell.blank" />
                    <button
                      v-else
                      type="button"
                      class="cal-day"
                      :class="{ selected: cell.key === selectedDate, today: cell.key === todayKey, open: cell.count > 0 }"
                      :disabled="!cell.count"
                      :aria-pressed="cell.key === selectedDate"
                      :aria-label="cell.count ? t('cal.dayTimes', { day: dayLabel(cell.key), count: cell.count }) : t('cal.dayNone', { day: dayLabel(cell.key) })"
                      @click="pickDay(cell)"
                    >{{ cell.day }}</button>
                  </template>
                </div>
                <p class="calendar-zone">{{ t('cal.zone', { zone: displayedZoneLabel }) }}</p>
                <p class="calendar-zone calendar-legend">{{ t('cal.legend') }}</p>
              </div>

              <div v-if="rangeLoading" class="slots-loading" role="status" aria-live="polite">
                <p class="visually-hidden">{{ t('slots.loading') }}</p>
                <div class="slot-grid" aria-hidden="true"><span v-for="n in slotPlaceholders" :key="n" class="slot-skeleton" /></div>
              </div>
              <div v-else-if="rangeError" class="public-inline-error" role="alert">
                <p>{{ t(rangeError) }}</p>
                <button class="secondary small-button" type="button" @click="retryRange">{{ t('retry') }}</button>
              </div>
              <template v-else>
                <section v-if="selectedDate && slotsForSelectedDay.length" class="slot-day" :aria-label="t('slots.on', { day: dayLabel(selectedDate) })">
                  <h3>{{ t('slots.heading', { day: dayLabel(selectedDate), count: slotsForSelectedDay.length }) }}</h3>
                  <div class="slot-grid">
                    <button v-for="slot in slotsForSelectedDay" :key="slot.startsAt" type="button" @click="selectSlot(slot)">{{ slotTime(slot) }}</button>
                  </div>
                </section>
                <div v-else-if="monthHasOpenings" class="public-empty compact">
                  <h2>{{ t('slots.pickDayTitle') }}</h2>
                  <p>{{ t('slots.pickDayText') }}</p>
                </div>
                <div v-else class="public-empty compact">
                  <AppIcon name="clock" :size="24" />
                  <template v-if="nextHint.state === 'searching'">
                    <h2>{{ t('slots.searching') }}</h2>
                  </template>
                  <template v-else-if="nextHint.state === 'found'">
                    <h2>{{ t('slots.noneInMonth', { month: monthLabel }) }}</h2>
                    <p>{{ t('slots.nextDay', { date: dayLabel(nextHint.key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) }) }}</p>
                    <button class="secondary small-button" type="button" @click="jumpToNext">{{ t('slots.goNext') }}</button>
                  </template>
                  <template v-else>
                    <h2>{{ t('slots.noneTitle') }}</h2>
                    <p>{{ t('slots.noneText', { host: page.profile.displayName }) }}</p>
                  </template>
                </div>
              </template>
            </template>

            <template v-else>
              <div class="booking-heading">
                <p class="eyebrow">{{ t('steps.of', { n: 3 }) }}</p>
                <h2 ref="stepHeading" tabindex="-1">{{ demoPreview ? t('form.titleDemo') : t('form.title') }}</h2>
                <p>{{ demoPreview ? t('form.textDemo') : t('form.text') }}</p>
              </div>
              <div class="mobile-selection">
                <small>{{ t('sum.with', { host: page.profile.displayName }) }}</small>
                <strong>{{ selectedService.name }}</strong>
                <span>{{ selectedSlotLabel }}</span>
                <small>{{ displayedZoneLabel }} · {{ t('svc.min', { count: selectedService.durationMinutes }) }} · {{ priceLabel(selectedService) }}</small>
              </div>
              <form class="guest-form" novalidate @submit.prevent="submit">
                <div class="field">
                  <label for="booking-guest-name">{{ t('form.name') }}</label>
                  <input
                    id="booking-guest-name"
                    v-model="contact.name"
                    :disabled="submitting"
                    :aria-invalid="shownError('name') ? 'true' : undefined"
                    :aria-describedby="shownError('name') ? 'booking-guest-name-error' : undefined"
                    autocomplete="name"
                    required
                    maxlength="160"
                    :placeholder="t('form.namePh')"
                    @blur="touched.name = true"
                  />
                  <p v-if="shownError('name')" id="booking-guest-name-error" class="field-error">{{ shownError('name') }}</p>
                </div>
                <div class="field">
                  <label for="booking-guest-email">{{ t('form.email') }}</label>
                  <input
                    id="booking-guest-email"
                    v-model="contact.email"
                    :disabled="submitting"
                    :aria-invalid="shownError('email') ? 'true' : undefined"
                    :aria-describedby="shownError('email') ? 'booking-guest-email-error' : undefined"
                    type="email"
                    inputmode="email"
                    autocomplete="email"
                    required
                    pattern="[^\s@]+@[^\s@]+\.[^\s@]{2,}"
                    maxlength="254"
                    :placeholder="t('form.emailPh')"
                    @blur="touched.email = true"
                  />
                  <p v-if="shownError('email')" id="booking-guest-email-error" class="field-error">{{ shownError('email') }}</p>
                </div>
                <div class="field field-wide">
                  <label for="booking-guest-phone">{{ t('form.phone') }} <span>{{ t('form.optional') }}</span></label>
                  <input
                    id="booking-guest-phone"
                    v-model="contact.phone"
                    :disabled="submitting"
                    :aria-invalid="shownError('phone') ? 'true' : undefined"
                    :aria-describedby="shownError('phone') ? 'booking-guest-phone-error' : 'booking-guest-phone-hint'"
                    type="tel"
                    inputmode="tel"
                    autocomplete="tel"
                    maxlength="40"
                    :placeholder="t('form.phonePh')"
                    @blur="touched.phone = true"
                  />
                  <p v-if="shownError('phone')" id="booking-guest-phone-error" class="field-error">{{ shownError('phone') }}</p>
                  <p v-else id="booking-guest-phone-hint" class="phone-hint">{{ t('form.phoneHint', { host: page.profile.displayName }) }}</p>
                </div>
                <div class="field field-wide">
                  <label for="booking-guest-notes">{{ t('form.notes') }} <span>{{ t('form.optional') }}</span></label>
                  <textarea
                    id="booking-guest-notes"
                    v-model="notes"
                    :disabled="submitting"
                    maxlength="2000"
                    aria-describedby="booking-guest-notes-count"
                    :placeholder="t('form.notesPh')"
                  ></textarea>
                  <p id="booking-guest-notes-count" class="field-count">{{ notes.length }}/2000</p>
                </div>
                <div class="confirm-bar">
                  <button class="primary confirm-button" :disabled="submitting || demoPreview">
                    {{ demoPreview ? t('form.submitDemo') : submitting ? t('form.submitting') : t('form.submit') }}
                    <AppIcon v-if="!submitting && !demoPreview" name="chevron" :size="16" />
                  </button>
                </div>
                <p class="fine-print">
                  {{ demoPreview ? t('form.fineDemo') : t('form.fine') }}
                </p>
              </form>
            </template>
          </section>

          <aside v-if="selectedService" class="booking-summary">
            <p class="eyebrow">{{ t('sum.eyebrow') }}</p>
            <p class="summary-host">{{ t('sum.with', { host: page.profile.displayName }) }}</p>
            <h2>{{ selectedService.name }}</h2>
            <p>{{ selectedService.description }}</p>
            <dl>
              <div><dt><AppIcon name="clock" :size="15" />{{ t('sum.duration') }}</dt><dd>{{ t('confirm.minutes', { count: selectedService.durationMinutes }) }}</dd></div>
              <div><dt><AppIcon name="wallet" :size="15" />{{ t('sum.price') }}</dt><dd>{{ priceLabel(selectedService) }}</dd></div>
              <div v-if="selectedSlot"><dt><AppIcon name="calendar" :size="15" />{{ t('sum.time') }}</dt><dd>{{ selectedSlotLabel }}<br /><small>{{ displayedZoneLabel }}</small></dd></div>
            </dl>
            <p v-if="selectedService.price" class="payment-note">{{ t('sum.payment') }}</p>
          </aside>
        </div>
      </template>
    </main>
    <footer><BookinsLogo compact /><span>{{ t('footer') }}</span></footer>
  </div>
</template>

<style scoped>
.public-shell {
  min-height: 100vh;
  color: #101928;
  background:
    radial-gradient(circle at 85% 8%, #e9edff 0, transparent 30%),
    linear-gradient(180deg, #f8f9ff 0, #fff 38%);
}
.public-header {
  height: 72px;
  padding: 0 max(22px, calc((100vw - 1120px) / 2));
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(221, 225, 241, 0.9);
  background: rgba(255, 255, 255, 0.84);
  backdrop-filter: blur(14px);
}
.public-header > a {
  display: flex;
  text-decoration: none;
}
.header-end { display: flex; align-items: center; gap: 14px; }
.lang-toggle { display: flex; align-items: center; gap: 2px; color: #b4bacb; font-size: 14px; }
.lang-toggle button {
  min-width: 44px;
  min-height: 44px;
  padding: 0 6px;
  color: #4f5971;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-size: 14px;
  font-weight: 700;
}
.lang-toggle button.active { color: #2336dc; background: #eef1ff; }
.lang-toggle button:focus-visible { outline: 3px solid #8c98ff; outline-offset: 1px; }
.secure-note {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #697087;
  font-size: 14px;
}
.demo-preview-banner {
  max-width: 1120px;
  margin: 14px auto 0;
  padding: 11px 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 5px 12px;
  color: #35217b;
  border: 1px solid #d9cef9;
  border-radius: 10px;
  background: #f5f1ff;
  font-size: 14px;
  line-height: 1.45;
}
.demo-preview-banner strong { font-weight: 800; }
.demo-preview-banner span { color: #5d5476; }
.public-shell main {
  max-width: 1120px;
  margin: 0 auto;
  padding: 42px 22px 70px;
}
.host-card {
  margin-bottom: 26px;
  display: flex;
  align-items: center;
  gap: 17px;
}
.host-avatar,
.host-card img {
  width: 70px;
  height: 70px;
  display: grid;
  place-items: center;
  object-fit: cover;
  color: #fff;
  border-radius: 20px;
  background: linear-gradient(145deg, #4154ef, #2336dc);
  font-size: 22px;
  font-weight: 850;
  box-shadow: 0 14px 28px rgba(35, 54, 220, 0.2);
}
.host-card h1 {
  margin: 0 0 4px;
  font-size: 31px;
}
.host-card p:not(.eyebrow) {
  max-width: 65ch;
  margin: 0 0 7px;
  color: #697087;
  font-size: 14px;
}
.host-card div > span {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #4f5971;
  font-size: 14px;
}
.booking-card {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(290px, 0.65fr);
  overflow: hidden;
  border: 1px solid #e2e5ef;
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(31, 42, 86, 0.09);
}
.booking-content {
  min-height: 530px;
  padding: 30px;
}
.booking-summary {
  padding: 30px;
  border-left: 1px solid #e4e7ef;
  background: #f8f9fc;
}
.booking-heading {
  margin-bottom: 22px;
}
.booking-heading h2 {
  margin-bottom: 5px;
  font-size: 24px;
}
.booking-heading > p:last-child {
  margin: 0;
  color: #697087;
  font-size: 14px;
}
.back-button {
  min-height: 44px;
  margin: 0 0 17px;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  color: #697087;
  border: 0;
  background: transparent;
  font-size: 14px;
  font-weight: 700;
}
.service-options {
  display: grid;
  gap: 10px;
}
.service-option {
  width: 100%;
  min-height: 112px;
  padding: 16px;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 13px;
  color: #101928;
  border: 1px solid #e2e5ef;
  border-radius: 14px;
  background: #fff;
  text-align: left;
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}
.service-option:hover {
  transform: translateY(-1px);
  border-color: #bfc7ff;
  box-shadow: 0 10px 24px rgba(35, 54, 220, 0.08);
}
.service-option-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  color: #2336dc;
  border-radius: 12px;
  background: #eef1ff;
}
.service-option-copy {
  min-width: 0;
  display: grid;
  gap: 5px;
}
.service-option-copy > strong {
  font-size: 14px;
}
.service-option-copy > small {
  overflow: hidden;
  color: #697087;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.service-option-copy > span {
  display: flex;
  gap: 13px;
}
.service-option-copy b {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #4b5670;
  font-size: 14px;
}
.slots-loading {
  min-height: 220px;
  display: grid;
  place-items: center;
  align-content: center;
  color: #697087;
}
.slots-loading p {
  margin: 10px 0 0;
  font-size: 14px;
}
.public-empty {
  min-height: 230px;
  display: grid;
  place-items: center;
  align-content: center;
  color: #2336dc;
  text-align: center;
}
.public-empty h2 {
  margin: 13px 0 5px;
  font-size: 17px;
}
.public-empty p {
  max-width: 380px;
  margin: 0;
  color: #697087;
  font-size: 14px;
}
.public-inline-error {
  margin-bottom: 16px;
  padding: 13px;
  color: #b42318;
  border: 1px solid #f0c8c4;
  border-radius: 10px;
  background: #fff1f0;
}
.public-inline-error p {
  margin: 0;
  font-size: 14px;
}
.public-inline-error button {
  margin-top: 10px;
}
.guest-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.guest-form > :not(.field) { grid-column: 1 / -1; }
.guest-form .field-wide { grid-column: 1 / -1; }
.phone-hint { margin: 5px 0 0; color: #697087; font-size: 14px; }
.host-card.compact { margin-bottom: 18px; }
.host-card.compact .host-avatar, .host-card.compact img { width: 44px; height: 44px; border-radius: 13px; font-size: 16px; }
.host-card.compact h1 { font-size: 20px; }
.calendar-legend { margin-top: 4px; font-size: 14px; }
.summary-host { margin: 0 0 4px; color: #2336dc; font-size: 14px; font-weight: 700; }
.another-button { margin-top: 18px; }
.guest-form .field {
  margin-bottom: 14px;
}
.guest-form label span {
  color: #8990a1;
  font-weight: 500;
}
.confirm-button {
  width: 100%;
  margin-top: 3px;
}
.fine-print {
  margin: 12px 0 0;
  color: #7b8293;
  font-size: 14px;
  text-align: center;
}
.booking-summary h2 {
  font-size: 20px;
}
.booking-summary > p:not(.eyebrow):not(.payment-note) {
  color: #697087;
  font-size: 14px;
}
.booking-summary dl {
  margin: 22px 0 0;
  display: grid;
  gap: 13px;
}
.booking-summary dl div {
  padding-bottom: 13px;
  border-bottom: 1px solid #e3e6ee;
}
.booking-summary dt {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #7a8295;
  font-size: 14px;
  font-weight: 750;
  text-transform: uppercase;
}
.booking-summary dd {
  margin: 6px 0 0;
  color: #344054;
  font-size: 14px;
  font-weight: 700;
}
.payment-note {
  margin: 18px 0 0;
  padding: 11px;
  color: #8a6700;
  border-radius: 9px;
  background: #fff7e5;
  font-size: 14px;
}
.public-state {
  max-width: 600px;
  margin: 120px auto;
  text-align: center;
}
.public-state h1 {
  margin-bottom: 7px;
  font-size: 29px;
}
.public-state p {
  color: #697087;
  font-size: 14px;
}
.public-spinner {
  width: 34px;
  height: 34px;
  margin: 0 auto 18px;
  display: block;
  border: 3px solid #dce1ff;
  border-top-color: #2336dc;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.public-spinner.small {
  width: 26px;
  height: 26px;
  margin: 0;
}
.state-symbol {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  display: grid;
  place-items: center;
  color: #b42318;
  border-radius: 50%;
  background: #fff1f0;
  font-size: 22px;
  font-weight: 850;
}
.confirmation-wrap {
  max-width: 640px;
  margin: 40px auto;
}
.confirmation-card {
  padding: 40px;
  border: 1px solid #e2e5ef;
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(31, 42, 86, 0.09);
  text-align: center;
}
.confirmation-check {
  width: 64px;
  height: 64px;
  margin: 0 auto 20px;
  display: grid;
  place-items: center;
  color: #fff;
  border-radius: 50%;
  background: #15915a;
  box-shadow: 0 12px 28px rgba(21, 145, 90, 0.22);
}
.confirmation-card h1 {
  margin-bottom: 7px;
}
.confirmation-copy {
  color: #697087;
  font-size: 14px;
}
.confirmation-event {
  margin: 26px 0 14px;
  padding: 16px;
  display: grid;
  grid-template-columns: 46px 1fr;
  align-items: center;
  gap: 12px;
  border-radius: 13px;
  background: #f5f7ff;
  text-align: left;
}
.confirmation-event > span {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  color: #2336dc;
  border-radius: 12px;
  background: #e8ecff;
}
.confirmation-event div {
  display: grid;
  gap: 3px;
}
.confirmation-event strong {
  font-size: 14px;
}
.confirmation-event small {
  color: #697087;
  font-size: 14px;
}
.confirmation-card dl {
  margin: 0;
  display: grid;
  text-align: center;
  grid-template-columns: minmax(0, 1fr);
  gap: 9px;
}
.confirmation-card dl div {
  padding: 13px;
  border: 1px solid #e2e5ef;
  border-radius: 10px;
}
.confirmation-card dt {
  color: #7b8293;
  font-size: 14px;
  font-weight: 800;
  text-transform: uppercase;
}
.confirmation-card dd {
  margin: 5px 0 0;
  font-size: 14px;
  font-weight: 750;
}
.truth-note {
  margin: 18px 0 0;
  color: #7b8293;
  font-size: 14px;
}
.public-shell footer {
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 22px 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #7b8293;
  font-size: 14px;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 820px) {
  .public-header {
    height: 64px;
    padding: 0 16px;
  }
  .secure-note {
    font-size: 14px;
  }
  .header-end { gap: 6px; }
  .demo-preview-banner { margin-inline: 12px; }
  .public-shell main {
    padding: 28px 14px 50px;
  }
  .host-card {
    align-items: flex-start;
  }
  .host-avatar,
  .host-card img {
    width: 56px;
    height: 56px;
    border-radius: 16px;
  }
  .host-card h1 {
    font-size: 25px;
  }
  .booking-card {
    grid-template-columns: 1fr;
  }
  .booking-content {
    min-height: 500px;
    padding: 21px;
  }
  .booking-summary {
    grid-row: 1;
    padding: 18px;
    border-left: 0;
    border-bottom: 1px solid #e4e7ef;
  }
  .booking-summary > p:not(.eyebrow),
  .booking-summary dl,
  .booking-summary .payment-note {
    display: none;
  }
}
@media (max-width: 480px) {
  .service-option {
    grid-template-columns: 40px minmax(0, 1fr);
  }
  .service-option > svg {
    display: none;
  }
  .service-option-copy > small {
    white-space: normal;
  }
  .confirmation-card {
    padding: 26px 18px;
  }
  .confirmation-card dl {
    grid-template-columns: 1fr;
  }
}
.host-bio { white-space: pre-line; }
.tz-line { flex-wrap: wrap; }
.tz-line select {
  min-height: 44px;
  max-width: 100%;
  padding: 0 8px;
  color: #101928;
  border: 1px solid #cfd4e2;
  border-radius: 8px;
  background: #fff;
  font-size: 14px;
}
.calendar { margin-bottom: 20px; max-width: 420px; }
.calendar-head { margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.calendar-head h3 { margin: 0; font-size: 14px; }
.cal-nav {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  color: #344054;
  border: 1px solid #e2e5ef;
  border-radius: 10px;
  background: #fff;
}
.cal-nav:disabled { opacity: 0.4; cursor: not-allowed; }
.cal-nav:first-child svg { display: block; }
.calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.calendar-grid.weekdays span { padding: 4px 0; color: #697087; font-size: 14px; font-weight: 750; text-align: center; }
.calendar-grid.busy { opacity: 0.55; }
.cal-day {
  min-height: 44px;
  color: #98a1b3;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  font-size: 14px;
}
.cal-day.open { color: #2336dc; border-color: #cfd5ff; background: #f7f8ff; font-weight: 800; }
.cal-day.open:hover { background: #e8ecff; }
.cal-day.selected { color: #fff; border-color: #2336dc; background: #2336dc; }
.cal-day.today:not(.selected) { box-shadow: inset 0 -3px 0 #cfd5ff; }
.cal-day:disabled { cursor: default; }
.cal-day:focus-visible, .cal-nav:focus-visible, .slot-grid button:focus-visible { outline: 3px solid #8c98ff; outline-offset: 2px; }
.calendar-zone { margin: 8px 0 0; color: #697087; font-size: 14px; }
.slot-day h3 { margin-bottom: 9px; color: #344054; font-size: 14px; letter-spacing: 0; }
.slot-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; }
.slot-grid button {
  min-height: 44px;
  color: #2336dc;
  border: 1px solid #cfd5ff;
  border-radius: 9px;
  background: #fff;
  font-size: 14px;
  font-weight: 750;
}
.slot-grid button:hover { color: #fff; background: #2336dc; }
.public-empty.compact { min-height: 140px; }
.public-empty.compact button { margin-top: 12px; }
.banner-slot, .banner-retry { color: #8a4b00; border-color: #f3d8a8; background: #fff8e8; }
.field-error { margin: 5px 0 0; color: #b42318; font-size: 14px; }
.field-count { margin: 4px 0 0; color: #7b8293; font-size: 14px; text-align: right; }
.guest-form input[aria-invalid='true'] { border-color: #b42318; }
.mobile-selection {
  margin-bottom: 18px;
  padding: 12px 14px;
  display: none;
  gap: 3px;
  border: 1px solid #cfd5ff;
  border-radius: 12px;
  background: #f7f8ff;
}
.mobile-selection strong { font-size: 14px; }
.mobile-selection span { font-size: 14px; font-weight: 700; color: #2336dc; }
.mobile-selection small { color: #697087; font-size: 14px; }
.booking-summary dd small { color: #697087; font-weight: 500; }
.calendar-actions { margin-top: 18px; display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
.calendar-actions .secondary { display: inline-flex; align-items: center; gap: 6px; }
.calendar-link { min-height: 44px; padding: 0 14px; text-decoration: none; align-items: center; }
.booking-heading h2:focus, .confirmation-card h1:focus { outline: none; }
.booking-heading h2:focus-visible, .confirmation-card h1:focus-visible { outline: 3px solid #8c98ff; outline-offset: 4px; }
@media (max-width: 560px) {
  .guest-form { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 820px) {
  .mobile-selection { display: grid; }
  .calendar { max-width: none; }
}
@media (max-width: 480px) {
  .slot-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* ---- polish layer ---- */
.public-shell { font-family: var(--font-ui, system-ui, sans-serif); }
.public-shell :where(a, button, select, input, textarea, summary):focus-visible { outline: 3px solid #8c98ff; outline-offset: 2px; }
.host-card h1 { letter-spacing: -0.02em; }
.host-card div > span { font-size: 14px; }
.stepper {
  max-width: 640px;
  margin: 0 0 18px;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  list-style: none;
}
.stepper li > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.confirmation-wrap > .stepper { margin-inline: auto; }
.stepper li {
  min-height: 44px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #697087;
  border: 1px solid #e4e7ef;
  border-radius: 12px;
  background: #fff;
  font-size: 14px;
  font-weight: 700;
}
.stepper i {
  width: 24px;
  height: 24px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #eef0f5;
  font-style: normal;
  font-size: 13px;
}
.stepper li.active { color: #2336dc; border-color: #bfc7ff; background: #f7f8ff; }
.stepper li.active i { color: #fff; background: #2336dc; }
.stepper li.done { color: #147a4d; }
.stepper li.done i { color: #fff; background: #15915a; }
.booking-card { border-radius: 18px; }
.service-option { min-height: 96px; }
.service-option:hover { transform: translateY(-1px); }
.service-option:active { transform: translateY(0); }
.service-option-copy > strong { font-size: 16px; }
.service-option-copy > small { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
.service-option-copy > span { flex-wrap: wrap; gap: 8px; }
.service-option-copy b {
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: #eef1ff;
  color: #2336dc;
  font-weight: 700;
}
.service-option-copy b:last-child { color: #147a4d; background: #eaf8f1; }
.calendar { max-width: 440px; }
.calendar-head h3 { font-size: 16px; text-transform: capitalize; }
.calendar-grid.weekdays span { font-size: 13px; }
.cal-day {
  position: relative;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}
.cal-day:disabled { color: #a0a7b8; }
.cal-day:disabled:not(.open) { text-decoration: line-through; text-decoration-color: rgba(160, 167, 184, 0.6); }
.cal-day.open::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 5px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  transform: translateX(-50%);
}
.cal-day.selected { box-shadow: 0 6px 14px rgba(35, 54, 220, 0.28); }
.cal-day.today:not(.selected) { border-color: #2336dc; box-shadow: none; }
.cal-day.today:not(.selected):not(.open) { color: #2336dc; }
.slot-grid { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); }
.slot-grid button {
  min-height: 48px;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  border-radius: 12px;
}
.slot-skeleton {
  min-height: 48px;
  display: block;
  border-radius: 12px;
  background: linear-gradient(100deg, #e9ebf2 30%, #f4f5fa 50%, #e9ebf2 70%);
  background-size: 220% 100%;
}
.slots-loading { min-height: 0; display: block; }
.slot-day h3 { font-size: 15px; }
.public-state .state-symbol { font-size: 22px; }
.reference-box {
  margin: 0 0 12px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px dashed #bfc7ff;
  border-radius: 12px;
  background: #fafbff;
  text-align: left;
}
.reference-box > div { min-width: 0; display: grid; gap: 4px; }
.reference-box span { color: #697087; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.reference-box code {
  overflow-wrap: anywhere;
  color: #101928;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 18px;
  font-weight: 700;
  user-select: all;
}
.confirmation-card dt { font-size: 13px; }
.confirmation-card dd { font-size: 15px; }
.confirmation-event strong { font-size: 17px; }
.confirmation-check svg { stroke-dasharray: 28; stroke-dashoffset: 0; }
.confirm-bar { margin-top: 3px; }
.fine-print { font-size: 13px; }
@media (max-width: 820px) {
  .confirm-bar {
    position: sticky;
    bottom: 0;
    z-index: 5;
    margin: 0 -21px -21px;
    padding: 12px 21px calc(12px + env(safe-area-inset-bottom));
    border-top: 1px solid #e4e7ef;
    background: rgba(255, 255, 255, 0.96);
    backdrop-filter: blur(8px);
  }
  .booking-card { overflow: visible; }
  .booking-summary { border-radius: 18px 18px 0 0; }
  .booking-content { border-radius: 0 0 18px 18px; }
  .booking-content { padding-bottom: 21px; }
  .host-card h1 { font-size: 24px; }
}
@media (max-width: 480px) {
  .stepper { gap: 4px; }
  .stepper li { min-width: 0; padding: 0 6px; gap: 5px; justify-content: center; font-size: 13px; }
  .stepper i { width: 22px; height: 22px; flex: none; }
  /* Four labels do not fit a phone row: number-only steps, with the active step's label shown. */
  .stepper { grid-template-columns: repeat(4, auto); justify-content: start; }
  .stepper li > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .stepper li.active > span { position: static; width: auto; height: auto; clip-path: none; }
  .secure-note { display: none; }
  .reference-box { flex-wrap: wrap; }
  .slot-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 360px) {
  .stepper li > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .stepper li.active > span { position: static; width: auto; height: auto; clip-path: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .slot-skeleton { animation: shimmer 1.45s ease-in-out infinite; }
  .confirmation-check svg { stroke-dashoffset: 28; animation: draw-check 0.4s 0.15s ease-out forwards; }
  .confirmation-check { animation: pop-in 0.3s ease-out; }
  .slot-grid button, .cal-day { transition: background 0.12s ease, color 0.12s ease, transform 0.12s ease; }
  .slot-grid button:active, .cal-day:active { transform: scale(0.97); }
}
@keyframes draw-check { to { stroke-dashoffset: 0; } }
@keyframes pop-in { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .public-spinner { animation-duration: 2.4s; }
  .service-option { transition: none; }
  .service-option:hover { transform: none; }
}
</style>
