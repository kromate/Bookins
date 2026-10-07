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
  defaultClockMode,
  formatClockMode,
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
  // Always six rows so the card never changes height between months.
  while (cells.length < 42) cells.push({ key: `tail-${cells.length}`, blank: true })
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
    prefetchNeighbours(seq)
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

/** Quietly warms the next month so paging forward is instant. Failures are ignored; the normal load retries. */
function prefetchNeighbours(seq) {
  const next = new Date(Date.UTC(viewMonth.year, viewMonth.month + 1, 1))
  const year = next.getUTCFullYear()
  const month = next.getUTCMonth()
  if (monthKey(year, month) > addDays(todayKey.value, 365).slice(0, 7)) return
  ensureRange(addDays(monthFirst(year, month), -1), addDays(monthLast(year, month), 1), seq).catch(() => {})
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

const slotsPane = ref(null)
function pickDay(cell) {
  if (!cell.count) return
  selectedDate.value = cell.key
  // Stacked (mobile) layout: bring the times into view under the calendar.
  if (window.matchMedia('(max-width: 820px)').matches) {
    nextTick(() => slotsPane.value?.scrollIntoView?.({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }))
  }
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
// One clock formatter (formatClockMode, driven by the 12h/24h toggle) feeds slots, summaries and the confirmation.
const CLOCK_KEY = 'bookins.guest.clock'
function storedClock() {
  try {
    const value = globalThis.localStorage?.getItem(CLOCK_KEY)
    return value === '12h' || value === '24h' ? value : ''
  } catch { return '' }
}
const clockChoice = ref(storedClock()) // empty = follow the language default
const clockMode = computed(() => clockChoice.value || defaultClockMode(locale.value))
function setClock(mode) {
  clockChoice.value = mode
  try { globalThis.localStorage?.setItem(CLOCK_KEY, mode) } catch { /* choice just is not remembered */ }
}
const clockText = (value, zone = displayedTimezone.value) => formatClockMode(value, intlLocale(), zone, clockMode.value)
const slotTime = slot => clockText(slot.startsAt)
const dateText = (value, zone, dateStyle) => new Date(value).toLocaleDateString(intlLocale(), { dateStyle, timeZone: zone })
const longDateTime = (value, zone = displayedTimezone.value) => `${dateText(value, zone, 'full')} · ${clockText(value, zone)}`
const selectedSlotLabel = computed(() =>
  selectedSlot.value ? `${dateText(selectedSlot.value.startsAt, displayedTimezone.value, 'full')} · ${clockText(selectedSlot.value.startsAt)}` : '',
)
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
const view = computed(() => (step.value === 1 ? 'profile' : 'book'))
const stage = computed(() => (selectedSlot.value ? 'details' : 'schedule'))

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
  <div class="bk" :data-demo-guest-ready="demoPreview && !loading && !pageError ? 'true' : undefined">
    <header class="bk-header">
      <a href="/" aria-label="Bookins"><BookinsLogo /></a>
      <div class="bk-header-end">
        <span class="bk-secure"><AppIcon name="lock" :size="14" />{{ demoPreview ? t('header.demo') : t('header.secure') }}</span>
        <div class="bk-lang" role="group" :aria-label="t('lang.label')">
          <button type="button" lang="en" :aria-pressed="locale === 'en'" :class="{ active: locale === 'en' }" @click="setLocale('en')">EN</button>
          <button type="button" lang="fr" :aria-pressed="locale === 'fr'" :class="{ active: locale === 'fr' }" @click="setLocale('fr')">FR</button>
        </div>
      </div>
    </header>
    <div v-if="demoPreview" class="bk-demo" role="status">
      <strong>{{ t('demo.title') }}</strong>
      <span>{{ t('demo.text') }}</span>
    </div>

    <main class="bk-main">
      <div v-if="loading" class="bk-loading" role="status" aria-live="polite">
        <h1 class="bk-sr">{{ t('loading.title') }}</h1>
        <p class="bk-sr">{{ t('loading.text') }}</p>
        <div class="bk-card bk-skel-card" aria-hidden="true">
          <span class="bk-skel bk-skel-avatar" />
          <span class="bk-skel bk-skel-line wide" />
          <span class="bk-skel bk-skel-line" />
        </div>
        <div class="bk-card bk-skel-card" aria-hidden="true">
          <span class="bk-skel bk-skel-line wide" />
          <span class="bk-skel bk-skel-line" />
          <span class="bk-skel bk-skel-line short" />
        </div>
      </div>

      <div v-else-if="pageError" class="bk-state" role="alert">
        <span class="bk-state-symbol" aria-hidden="true">!</span>
        <h1>{{ t(`err.${pageError.kind}.title`) }}</h1>
        <p>{{ t(`err.${pageError.kind}.text`) }}</p>
        <button v-if="pageError.retry" class="bk-btn" type="button" @click="retryPage">{{ t('retry') }}</button>
      </div>

      <article v-else-if="confirmation" class="bk-card bk-confirm">
        <span class="bk-confirm-check"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
        <h1 ref="confirmHeading" tabindex="-1">{{ t('confirm.title') }}</h1>
        <p class="bk-muted">{{ t('confirm.copy', { host: page.profile.displayName }) }}</p>
        <dl class="bk-facts">
          <div><dt>{{ t('confirm.what') }}</dt><dd>{{ confirmation.serviceName }} · {{ t('confirm.minutes', { count: confirmationDuration }) }}</dd></div>
          <div>
            <dt>{{ t('confirm.when') }}</dt>
            <dd>
              {{ longDateTime(confirmation.startsAt) }}
              <small>{{ displayedZoneLabel }}</small>
              <small v-if="confirmationOwnerTz !== displayedTimezone">{{ t('confirm.hostTime', { time: longDateTime(confirmation.startsAt, confirmationOwnerTz), zone: zoneLabel(confirmationOwnerTz) }) }}</small>
            </dd>
          </div>
          <div><dt>{{ t('confirm.who') }}</dt><dd>{{ page.profile.displayName }}</dd></div>
          <div>
            <dt>{{ t('confirm.reference') }}</dt>
            <dd class="bk-ref">
              <code>{{ confirmation.reference }}</code>
              <button type="button" class="bk-btn small" :aria-label="t('confirm.copyAria')" @click="copyReference">{{ refCopied ? t('confirm.copied') : t('confirm.copyRef') }}</button>
              <span class="bk-sr" role="status">{{ refCopied ? t('confirm.copied') : '' }}</span>
            </dd>
          </div>
        </dl>
        <div class="bk-confirm-actions">
          <button class="bk-btn" type="button" @click="downloadIcs"><AppIcon name="calendar" :size="15" />{{ t('confirm.ics') }}</button>
          <a class="bk-btn" :href="googleUrl" target="_blank" rel="noopener noreferrer">{{ t('confirm.google') }}</a>
        </div>
        <button class="bk-btn primary wide" type="button" @click="bookAnother">{{ t('confirm.another') }}</button>
        <p class="bk-fine">{{ t('confirm.note') }}</p>
      </article>

      <Transition v-else name="bk-view" mode="out-in">
        <!-- Profile: host header and service list -->
        <section v-if="view === 'profile'" key="profile" class="bk-profile">
          <div class="bk-card bk-host">
            <img v-if="showPhoto" class="bk-avatar big" :src="safePhotoUrl" alt="" referrerpolicy="no-referrer" loading="lazy" @error="photoFailed = true" />
            <span v-else class="bk-avatar big" aria-hidden="true">{{ hostInitial }}</span>
            <h1>{{ page.profile.displayName }}</h1>
            <p v-if="page.profile.bio" class="bk-bio">{{ page.profile.bio }}</p>
          </div>
          <div v-if="page.services.length" class="bk-card bk-services">
            <h2 ref="stepHeading" tabindex="-1" class="bk-services-title">{{ t('svc.title') }}</h2>
            <ul>
              <li v-for="service in page.services" :key="service.id">
                <button type="button" class="bk-service" @click="chooseService(service)">
                  <span class="bk-service-name">{{ service.name }}</span>
                  <span v-if="service.description" class="bk-service-desc">{{ service.description }}</span>
                  <span class="bk-chips">
                    <span class="bk-chip"><AppIcon name="clock" :size="12" />{{ t('svc.min', { count: service.durationMinutes }) }}</span>
                    <span class="bk-chip">{{ priceLabel(service) }}</span>
                  </span>
                </button>
              </li>
            </ul>
          </div>
          <div v-else class="bk-card bk-empty">
            <AppIcon name="calendar" :size="24" />
            <h2>{{ t('svc.emptyTitle') }}</h2>
            <p>{{ t('svc.emptyText', { host: page.profile.displayName }) }}</p>
          </div>
        </section>

        <!-- Scheduler: info | calendar | times, then info | details -->
        <section v-else key="book" class="bk-book">
          <div v-if="banner" ref="bannerPanel" tabindex="-1" role="alert" class="bk-banner" :class="`banner-${banner.kind}`">
            <p>{{ t(banner.key) }}</p>
          </div>
          <div class="bk-card bk-grid" :class="`stage-${stage}`">
            <aside class="bk-info">
              <button v-if="showBack" class="bk-back" :disabled="submitting" type="button" @click="back">
                <AppIcon name="arrow-left" :size="15" />{{ t('back') }}
              </button>
              <div class="bk-host-line">
                <img v-if="showPhoto" class="bk-avatar" :src="safePhotoUrl" alt="" referrerpolicy="no-referrer" loading="lazy" @error="photoFailed = true" />
                <span v-else class="bk-avatar" aria-hidden="true">{{ hostInitial }}</span>
                <span>{{ page.profile.displayName }}</span>
              </div>
              <h1 class="bk-title">{{ selectedService.name }}</h1>
              <p v-if="selectedService.description" class="bk-desc">{{ selectedService.description }}</p>
              <ul class="bk-meta">
                <li v-if="selectedSlot" class="bk-meta-when">
                  <AppIcon name="calendar" :size="15" />
                  <span>{{ selectedSlotLabel }}<small>{{ displayedZoneLabel }}</small></span>
                </li>
                <li><AppIcon name="clock" :size="15" /><span>{{ t('confirm.minutes', { count: selectedService.durationMinutes }) }}</span></li>
                <li><AppIcon name="wallet" :size="15" /><span>{{ priceLabel(selectedService) }}</span></li>
                <li v-if="selectedService.price" class="bk-meta-note"><span>{{ t('sum.payment') }}</span></li>
                <li class="bk-tz">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.4 4 5.5 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.5-4-9s1.4-6.6 4-9z" /></svg>
                  <label v-if="zonesDiffer" class="bk-sr" for="booking-tz-mode">{{ t('tz.shownIn') }}</label>
                  <select v-if="zonesDiffer" id="booking-tz-mode" v-model="tzMode" :disabled="submitting">
                    <option value="guest">{{ t('tz.guest', { zone: zoneLabel(guestTz) }) }}</option>
                    <option value="owner">{{ t('tz.owner', { zone: zoneLabel(ownerTz) }) }}</option>
                  </select>
                  <span v-else>{{ displayedZoneLabel }}</span>
                </li>
              </ul>
            </aside>

            <Transition name="bk-pane" mode="out-in">
              <div v-if="stage === 'schedule'" key="schedule" class="bk-schedule">
                <h2 ref="stepHeading" tabindex="-1" class="bk-sr">{{ t('time.title') }}</h2>
                <div class="bk-calendar" role="group" :aria-label="t('cal.aria')">
                  <div class="bk-cal-head">
                    <h3 aria-live="polite"><strong>{{ monthLabel.replace(/\s*\d{4}$/, '') }}</strong> <span>{{ viewMonth.year }}</span></h3>
                    <div class="bk-cal-nav">
                      <button type="button" :disabled="!canGoPrev || rangeLoading" :aria-label="t('cal.prev')" @click="shiftMonth(-1)"><AppIcon name="arrow-left" :size="16" /></button>
                      <button type="button" :disabled="!canGoNext || rangeLoading" :aria-label="t('cal.next')" @click="shiftMonth(1)"><AppIcon name="chevron" :size="16" /></button>
                    </div>
                  </div>
                  <div class="bk-days bk-weekdays" aria-hidden="true">
                    <span v-for="label in weekdayLabels" :key="label">{{ label }}</span>
                  </div>
                  <div class="bk-days" :class="{ loading: rangeLoading }">
                    <template v-for="cell in calendarCells" :key="cell.key">
                      <span v-if="cell.blank" />
                      <button
                        v-else
                        type="button"
                        class="bk-day"
                        :class="{ selected: cell.key === selectedDate, today: cell.key === todayKey, open: cell.count > 0 }"
                        :disabled="!cell.count"
                        :aria-pressed="cell.key === selectedDate"
                        :aria-current="cell.key === todayKey ? 'date' : undefined"
                        :aria-label="cell.count ? t('cal.dayTimes', { day: dayLabel(cell.key), count: cell.count }) : t('cal.dayNone', { day: dayLabel(cell.key) })"
                        @click="pickDay(cell)"
                      >{{ cell.day }}</button>
                    </template>
                  </div>
                </div>

                <div ref="slotsPane" class="bk-slots">
                  <div class="bk-slots-inner">
                    <template v-if="rangeLoading">
                      <p class="bk-sr" role="status">{{ t('slots.loading') }}</p>
                      <div class="bk-slots-head" aria-hidden="true"><span class="bk-skel bk-skel-line short" /></div>
                      <div class="bk-slot-list" aria-hidden="true"><span v-for="n in slotPlaceholders" :key="n" class="bk-skel bk-skel-slot" /></div>
                    </template>
                    <div v-else-if="rangeError" class="bk-note error" role="alert">
                      <p>{{ t(rangeError) }}</p>
                      <button class="bk-btn small" type="button" @click="retryRange">{{ t('retry') }}</button>
                    </div>
                    <template v-else-if="selectedDate && slotsForSelectedDay.length">
                      <div class="bk-slots-head">
                        <h3 :aria-label="t('slots.on', { day: dayLabel(selectedDate) })"><strong>{{ dayLabel(selectedDate, { weekday: 'short' }) }}</strong> {{ dayLabel(selectedDate, { day: 'numeric' }) }}</h3>
                        <div class="bk-clock" role="group" :aria-label="t('clock.aria')">
                          <button type="button" :aria-pressed="clockMode === '12h'" :class="{ active: clockMode === '12h' }" @click="setClock('12h')">12h</button>
                          <button type="button" :aria-pressed="clockMode === '24h'" :class="{ active: clockMode === '24h' }" @click="setClock('24h')">24h</button>
                        </div>
                      </div>
                      <p class="bk-sr" aria-live="polite">{{ t('slots.heading', { day: dayLabel(selectedDate), count: slotsForSelectedDay.length }) }}</p>
                      <div :key="`${selectedDate}-${clockMode}`" class="bk-slot-list">
                        <button v-for="slot in slotsForSelectedDay" :key="slot.startsAt" type="button" class="bk-slot" @click="selectSlot(slot)">{{ slotTime(slot) }}</button>
                      </div>
                    </template>
                    <div v-else-if="monthHasOpenings" class="bk-note">
                      <strong>{{ t('slots.pickDayTitle') }}</strong>
                      <p>{{ t('slots.pickDayText') }}</p>
                    </div>
                    <div v-else class="bk-note">
                      <template v-if="nextHint.state === 'searching'">
                        <strong>{{ t('slots.searching') }}</strong>
                      </template>
                      <template v-else-if="nextHint.state === 'found'">
                        <strong>{{ t('slots.noneInMonth', { month: monthLabel }) }}</strong>
                        <p>{{ t('slots.nextDay', { date: dayLabel(nextHint.key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) }) }}</p>
                        <button class="bk-btn small" type="button" @click="jumpToNext">{{ t('slots.goNext') }}</button>
                      </template>
                      <template v-else>
                        <strong>{{ t('slots.noneTitle') }}</strong>
                        <p>{{ t('slots.noneText', { host: page.profile.displayName }) }}</p>
                      </template>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else key="details" class="bk-details">
                <h2 ref="stepHeading" tabindex="-1" class="bk-form-title">{{ demoPreview ? t('form.titleDemo') : t('form.title') }}</h2>
                <p class="bk-muted">{{ demoPreview ? t('form.textDemo') : t('form.text') }}</p>
                <form class="bk-form" novalidate @submit.prevent="submit">
                  <div class="bk-field">
                    <label for="booking-guest-name">{{ t('form.name') }}</label>
                    <input
                      id="booking-guest-name"
                      v-model="contact.name"
                      class="bk-input"
                      :disabled="submitting"
                      :aria-invalid="shownError('name') ? 'true' : undefined"
                      :aria-describedby="shownError('name') ? 'booking-guest-name-error' : undefined"
                      autocomplete="name"
                      required
                      maxlength="160"
                      :placeholder="t('form.namePh')"
                      @blur="touched.name = true"
                    />
                    <p v-if="shownError('name')" id="booking-guest-name-error" class="bk-error">{{ shownError('name') }}</p>
                  </div>
                  <div class="bk-field">
                    <label for="booking-guest-email">{{ t('form.email') }}</label>
                    <input
                      id="booking-guest-email"
                      v-model="contact.email"
                      class="bk-input"
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
                    <p v-if="shownError('email')" id="booking-guest-email-error" class="bk-error">{{ shownError('email') }}</p>
                  </div>
                  <div class="bk-field">
                    <label for="booking-guest-phone">{{ t('form.phone') }} <span>{{ t('form.optional') }}</span></label>
                    <input
                      id="booking-guest-phone"
                      v-model="contact.phone"
                      class="bk-input"
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
                    <p v-if="shownError('phone')" id="booking-guest-phone-error" class="bk-error">{{ shownError('phone') }}</p>
                    <p v-else id="booking-guest-phone-hint" class="bk-hint">{{ t('form.phoneHint', { host: page.profile.displayName }) }}</p>
                  </div>
                  <div class="bk-field">
                    <label for="booking-guest-notes">{{ t('form.notes') }} <span>{{ t('form.optional') }}</span></label>
                    <textarea
                      id="booking-guest-notes"
                      v-model="notes"
                      class="bk-input"
                      :disabled="submitting"
                      maxlength="2000"
                      rows="3"
                      aria-describedby="booking-guest-notes-count"
                      :placeholder="t('form.notesPh')"
                    ></textarea>
                    <p id="booking-guest-notes-count" class="bk-hint right">{{ notes.length }}/2000</p>
                  </div>
                  <div class="bk-actions">
                    <button class="bk-btn" type="button" :disabled="submitting" @click="back">{{ t('back') }}</button>
                    <button class="bk-btn primary" :disabled="submitting || demoPreview">
                      {{ demoPreview ? t('form.submitDemo') : submitting ? t('form.submitting') : t('form.submit') }}
                    </button>
                  </div>
                  <p class="bk-fine">{{ demoPreview ? t('form.fineDemo') : t('form.fine') }}</p>
                </form>
              </div>
            </Transition>
          </div>
        </section>
      </Transition>
    </main>
    <footer class="bk-footer"><BookinsLogo compact /><span>{{ t('footer') }}</span></footer>
  </div>
</template>

<style scoped>
.bk {
  --ink: #111111;
  --body: #374151;
  --muted: #6b7280;
  --soft: #898989;
  --line: #e5e7eb;
  --line-soft: #f3f4f6;
  --surface: #f5f5f5;
  --focus: #2336dc;
  --display: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  color: var(--ink);
  background: #fafafa;
  font-family: var(--font-ui, ui-sans-serif, system-ui, sans-serif);
  font-size: 14px;
  line-height: 1.5;
}
.bk :where(h1, h2, h3, p, ul, dl, dd) { margin: 0; padding: 0; }
.bk :where(ul) { list-style: none; }
.bk :where(a, button, select, input, textarea):focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.bk-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.bk-muted { color: var(--muted); }

/* ---- header / footer ---- */
.bk-header {
  height: 64px;
  padding: 0 max(20px, calc((100vw - 960px) / 2));
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.bk-header > a { display: flex; text-decoration: none; color: var(--ink); }
.bk-header-end { display: flex; align-items: center; gap: 14px; }
.bk-secure { display: flex; align-items: center; gap: 6px; color: var(--soft); font-size: 13px; }
.bk-lang { display: flex; padding: 2px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.bk-lang button {
  min-width: 44px; min-height: 32px; padding: 0 8px; color: var(--muted);
  border: 0; border-radius: 6px; background: transparent; font-size: 13px; font-weight: 600; cursor: pointer;
}
.bk-lang button.active { color: #fff; background: var(--ink); }
.bk-demo {
  max-width: 960px; margin: 4px auto 0; padding: 10px 14px; display: flex; flex-wrap: wrap; gap: 4px 12px;
  color: #35217b; border: 1px solid #d9cef9; border-radius: 10px; background: #f5f1ff;
}
.bk-main { width: 100%; max-width: 960px; margin: 0 auto; padding: 24px 20px 56px; flex: 1; }
.bk-footer { padding: 0 20px 32px; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--soft); font-size: 13px; }

/* ---- shared ---- */
.bk-card { border: 1px solid var(--line); border-radius: 12px; background: #fff; }
.bk-avatar {
  width: 24px; height: 24px; flex: none; display: grid; place-items: center; object-fit: cover;
  color: #fff; border-radius: 50%; background: var(--ink); font-size: 12px; font-weight: 700;
}
.bk-avatar.big { width: 72px; height: 72px; font-size: 28px; }
.bk-btn {
  min-height: 40px; padding: 0 16px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  color: var(--ink); border: 1px solid var(--line); border-radius: 8px; background: #fff;
  font: inherit; font-weight: 600; text-decoration: none; cursor: pointer;
}
.bk-btn:hover:not(:disabled) { background: var(--line-soft); }
.bk-btn.primary { color: #fff; border-color: var(--ink); background: var(--ink); }
.bk-btn.primary:hover:not(:disabled) { background: #242424; }
.bk-btn.wide { width: 100%; }
.bk-btn.small { min-height: 32px; padding: 0 12px; font-size: 13px; }
.bk-btn:disabled { color: var(--soft); border-color: var(--line); background: var(--line); cursor: not-allowed; }
.bk-skel {
  display: block; border-radius: 6px; background: linear-gradient(100deg, #eceef1 30%, #f6f7f8 50%, #eceef1 70%); background-size: 220% 100%;
}
.bk-skel-line { height: 14px; width: 60%; }
.bk-skel-line.wide { width: 85%; }
.bk-skel-line.short { width: 35%; }
.bk-skel-avatar { width: 56px; height: 56px; border-radius: 50%; }
.bk-skel-slot { height: 40px; border-radius: 8px; }
.bk-skel-card { margin-bottom: 16px; padding: 24px; display: grid; gap: 12px; }
.bk-loading { max-width: 640px; margin: 0 auto; }
.bk-state { max-width: 520px; margin: 80px auto; text-align: center; display: grid; justify-items: center; gap: 10px; }
.bk-state h1 { font-family: var(--display); font-size: 24px; font-weight: 650; letter-spacing: -0.03em; }
.bk-state p { color: var(--muted); }
.bk-state-symbol { width: 44px; height: 44px; display: grid; place-items: center; color: #b42318; border-radius: 50%; background: #fef3f2; font-size: 20px; font-weight: 800; }
.bk-banner { max-width: 640px; margin: 0 auto 12px; padding: 12px 14px; border-radius: 10px; border: 1px solid #fecdca; background: #fef3f2; color: #b42318; }
.bk-banner.banner-slot, .bk-banner.banner-retry { color: #93370d; border-color: #fedf89; background: #fffaeb; }
.bk-banner:focus { outline: none; }
.bk-banner:focus-visible { outline: 2px solid var(--focus); }

/* ---- profile ---- */
.bk-profile { max-width: 640px; margin: 0 auto; display: grid; gap: 16px; }
.bk-host { padding: 28px; display: grid; justify-items: start; gap: 6px; }
.bk-host .bk-avatar { margin-bottom: 8px; }
.bk-host h1 { font-family: var(--display); font-size: 28px; font-weight: 650; line-height: 1.15; letter-spacing: -0.035em; }
.bk-bio { max-width: 60ch; color: var(--body); white-space: pre-line; }
.bk-services-title { padding: 16px 24px 4px; color: var(--muted); font-size: 13px; font-weight: 600; }
.bk-services-title:focus { outline: none; }
.bk-service {
  width: 100%; padding: 16px 24px; display: grid; gap: 6px; text-align: left; color: var(--ink);
  border: 0; border-top: 1px solid var(--line-soft); background: transparent; font: inherit; cursor: pointer;
}
.bk-services li:first-child .bk-service { border-top: 0; }
.bk-services li:last-child .bk-service { border-radius: 0 0 12px 12px; }
.bk-service:hover { background: #fafafa; }
.bk-service-name { font-size: 15px; font-weight: 650; }
.bk-service-desc {
  max-width: 62ch; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.bk-chips { margin-top: 2px; display: flex; flex-wrap: wrap; gap: 6px; }
.bk-chip {
  min-height: 24px; padding: 0 8px; display: inline-flex; align-items: center; gap: 4px;
  color: var(--body); border-radius: 6px; background: var(--surface); font-size: 12px; font-weight: 600;
}
.bk-empty { padding: 40px 24px; display: grid; justify-items: center; gap: 6px; color: var(--muted); text-align: center; }
.bk-empty h2 { color: var(--ink); font-size: 16px; }

/* ---- scheduler ---- */
.bk-book { max-width: 940px; margin: 0 auto; }
.bk-grid { display: grid; grid-template-columns: 250px minmax(0, 1fr); min-height: 468px; overflow: hidden; box-shadow: 0 1px 2px rgba(17, 17, 17, 0.04); }
.bk-info { padding: 24px; border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.bk-back {
  align-self: flex-start; min-height: 32px; margin: -4px 0 6px -8px; padding: 0 8px 0 6px; display: inline-flex; align-items: center; gap: 4px;
  color: var(--muted); border: 0; border-radius: 6px; background: transparent; font: inherit; font-weight: 600; cursor: pointer;
}
.bk-back:hover:not(:disabled) { color: var(--ink); background: var(--line-soft); }
.bk-host-line { display: flex; align-items: center; gap: 8px; color: var(--muted); font-weight: 600; }
.bk-title { margin-top: 4px; font-family: var(--display); font-size: 22px; font-weight: 650; line-height: 1.2; letter-spacing: -0.035em; overflow-wrap: anywhere; }
.bk-desc {
  color: var(--muted); white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 6; line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden;
}
.bk-meta { margin-top: 14px; display: grid; gap: 10px; color: var(--body); font-weight: 600; }
.bk-meta li { display: flex; align-items: flex-start; gap: 10px; }
.bk-meta svg { flex: none; margin-top: 3px; color: var(--muted); }
.bk-meta small { display: block; color: var(--muted); font-weight: 500; }
.bk-meta-note { color: var(--muted); font-weight: 500; font-size: 13px; padding-left: 25px; }
.bk-meta-when { color: var(--ink); }
.bk-tz { align-items: center; }
.bk-tz select {
  min-width: 0; max-width: 100%; min-height: 32px; margin: -4px 0 -4px -6px; padding: 0 6px; color: var(--body);
  border: 1px solid transparent; border-radius: 6px; background: transparent; font: inherit; font-weight: 600; cursor: pointer;
}
.bk-tz select:hover { background: var(--line-soft); }

.bk-schedule { display: grid; grid-template-columns: minmax(0, 1fr) 216px; min-width: 0; }
.bk-calendar { padding: 24px; min-width: 0; }
.bk-cal-head { margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; min-height: 36px; }
.bk-cal-head h3 { font-size: 15px; text-transform: capitalize; }
.bk-cal-head h3 span { color: var(--muted); font-weight: 500; }
.bk-cal-nav { display: flex; gap: 4px; }
.bk-cal-nav button {
  width: 36px; height: 36px; display: grid; place-items: center; color: var(--ink); border: 0; border-radius: 8px; background: transparent; cursor: pointer;
}
.bk-cal-nav button:hover:not(:disabled) { background: var(--line-soft); }
.bk-cal-nav button:disabled { color: #c4c7cd; cursor: not-allowed; }
.bk-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; transition: opacity 0.15s ease; }
.bk-days.loading { opacity: 0.5; pointer-events: none; }
.bk-weekdays { margin-bottom: 6px; }
.bk-weekdays span { color: var(--muted); font-size: 11px; font-weight: 600; text-align: center; text-transform: uppercase; letter-spacing: 0.04em; }
.bk-day {
  position: relative; height: 44px; color: var(--soft); border: 0; border-radius: 8px; background: transparent;
  font: inherit; font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; cursor: default;
}
.bk-day.open { color: var(--ink); background: var(--surface); font-weight: 600; cursor: pointer; }
.bk-day.open:hover { background: var(--line); }
.bk-day.selected, .bk-day.selected:hover { color: #fff; background: var(--ink); }
.bk-day.today::after {
  content: ''; position: absolute; left: 50%; bottom: 5px; width: 4px; height: 4px; border-radius: 50%; background: currentColor; transform: translateX(-50%);
}
.bk-day.today:not(.open) { color: var(--ink); }

.bk-slots { position: relative; border-left: 1px solid var(--line); min-width: 0; }
.bk-slots-inner { position: absolute; inset: 0; padding: 24px 20px 16px; overflow-y: auto; scrollbar-width: thin; }
.bk-slots-head { margin-bottom: 14px; min-height: 36px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.bk-slots-head h3 { font-size: 15px; font-weight: 500; text-transform: capitalize; }
.bk-slots-head h3 strong { font-weight: 650; }
.bk-clock { display: flex; padding: 2px; border-radius: 8px; background: var(--surface); }
.bk-clock button {
  min-height: 28px; min-width: 36px; padding: 0 8px; color: var(--muted); border: 0; border-radius: 6px; background: transparent;
  font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
}
.bk-clock button.active { color: var(--ink); background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }
.bk-slot-list { display: grid; gap: 8px; }
.bk-slot {
  min-height: 42px; color: var(--ink); border: 1px solid var(--line); border-radius: 8px; background: #fff;
  font: inherit; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer;
}
.bk-slot:hover { border-color: var(--ink); }
.bk-note { padding: 8px 0; display: grid; justify-items: start; gap: 6px; color: var(--muted); }
.bk-note strong { color: var(--ink); font-size: 14px; }
.bk-note.error { color: #b42318; }

/* ---- details ---- */
.bk-details { padding: 24px 32px 28px; max-width: 600px; }
.bk-form-title { font-family: var(--display); font-size: 18px; font-weight: 650; letter-spacing: -0.02em; }
.bk-form-title:focus { outline: none; }
.bk-form-title:focus-visible { outline: 2px solid var(--focus); outline-offset: 4px; }
.bk-form { margin-top: 18px; display: grid; gap: 16px; }
.bk-field { display: grid; gap: 6px; }
.bk-field label { color: var(--ink); font-weight: 600; }
.bk-field label span { color: var(--soft); font-weight: 500; }
.bk-input {
  width: 100%; min-height: 40px; padding: 8px 12px; color: var(--ink); border: 1px solid #d1d5db; border-radius: 8px; background: #fff; font: inherit; box-shadow: none;
}
textarea.bk-input { resize: vertical; min-height: 84px; }
.bk-input::placeholder { color: #9ca3af; }
.bk-input:focus { outline: none; border-color: var(--ink); box-shadow: 0 0 0 2px rgba(17, 17, 17, 0.12); }
.bk-input[aria-invalid='true'] { border-color: #b42318; }
.bk-error { color: #b42318; font-size: 13px; }
.bk-hint { color: var(--muted); font-size: 13px; }
.bk-hint.right { text-align: right; }
.bk-actions { display: flex; justify-content: flex-end; gap: 8px; }
.bk-fine { color: var(--soft); font-size: 12px; }

/* ---- confirmation ---- */
.bk-confirm { max-width: 560px; margin: 24px auto 0; padding: 36px 32px 28px; display: grid; justify-items: center; gap: 8px; text-align: center; }
.bk-confirm h1 { font-family: var(--display); font-size: 24px; font-weight: 650; letter-spacing: -0.035em; }
.bk-confirm h1:focus { outline: none; }
.bk-confirm h1:focus-visible { outline: 2px solid var(--focus); outline-offset: 4px; }
.bk-confirm-check { width: 52px; height: 52px; margin-bottom: 8px; display: grid; place-items: center; color: #027a48; border-radius: 50%; background: #ecfdf3; }
.bk-facts { width: 100%; margin: 20px 0 8px; padding-top: 16px; display: grid; gap: 14px; border-top: 1px solid var(--line); text-align: left; }
.bk-facts > div { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; }
.bk-facts dt { color: var(--muted); font-weight: 600; }
.bk-facts dd { font-weight: 600; overflow-wrap: anywhere; }
.bk-facts dd small { display: block; color: var(--muted); font-weight: 500; }
.bk-ref { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.bk-ref code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 15px; user-select: all; }
.bk-confirm-actions { width: 100%; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 4px 0 4px; }
.bk-confirm .bk-fine { margin-top: 8px; }
.bk-confirm-check svg { stroke-dasharray: 28; stroke-dashoffset: 0; }

/* ---- transitions (reduced-motion aware) ---- */
@media (prefers-reduced-motion: no-preference) {
  .bk-view-enter-active, .bk-pane-enter-active { transition: opacity 0.2s ease, transform 0.2s ease; }
  .bk-view-leave-active, .bk-pane-leave-active { transition: opacity 0.12s ease; }
  .bk-view-enter-from, .bk-pane-enter-from { opacity: 0; transform: translateY(6px); }
  .bk-view-leave-to, .bk-pane-leave-to { opacity: 0; }
  .bk-slot-list { animation: bk-fade 0.18s ease; }
  .bk-confirm { animation: bk-fade 0.25s ease; }
  .bk-skel { animation: bk-shimmer 1.4s ease-in-out infinite; }
  .bk-day, .bk-slot, .bk-btn, .bk-service { transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease; }
  .bk-confirm-check svg { stroke-dashoffset: 28; animation: bk-draw 0.4s 0.15s ease-out forwards; }
  .bk-confirm-check { animation: bk-pop 0.3s ease-out; }
}
@keyframes bk-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes bk-shimmer { from { background-position: 120% 0; } to { background-position: -120% 0; } }
@keyframes bk-draw { to { stroke-dashoffset: 0; } }
@keyframes bk-pop { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }

/* ---- tablet / mobile: info -> calendar -> times ---- */
@media (max-width: 820px) {
  .bk-header { padding: 0 16px; height: 56px; }
  .bk-secure { display: none; }
  .bk-main { padding: 12px 12px 40px; }
  .bk-grid { grid-template-columns: 1fr; min-height: 0; overflow: visible; }
  .bk-info { padding: 16px 16px 14px; border-right: 0; border-bottom: 1px solid var(--line); }
  .bk-desc { -webkit-line-clamp: 3; line-clamp: 3; }
  .bk-meta { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px 16px; }
  .bk-meta li { min-width: 0; }
  .bk-meta .bk-tz, .bk-meta .bk-meta-when, .bk-meta .bk-meta-note { flex: 1 1 100%; }
  .bk-meta-note { padding-left: 0; }
  .bk-grid.stage-details .bk-desc { display: none; }
  .bk-schedule { grid-template-columns: 1fr; }
  .bk-calendar { padding: 16px; }
  .bk-slots { border-left: 0; border-top: 1px solid var(--line); scroll-margin-top: 8px; }
  .bk-slots-inner { position: static; padding: 16px 16px 24px; overflow: visible; min-height: 200px; }
  .bk-slot-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .bk-slot { min-height: 46px; }
  .bk-details { max-width: none; padding: 18px 16px 0; }
  .bk-actions {
    position: sticky; bottom: 0; z-index: 5; margin: 4px -16px 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--line); background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(8px);
  }
  .bk-actions .bk-btn.primary { flex: 1; }
  .bk-input { min-height: 44px; font-size: 16px; }
  .bk-host { padding: 20px; }
  .bk-services-title, .bk-service { padding-left: 16px; padding-right: 16px; }
  .bk-confirm { padding: 28px 18px 22px; margin-top: 8px; }
  .bk-facts > div { grid-template-columns: 1fr; gap: 2px; }
}
@media (max-width: 380px) {
  .bk-slot-list { grid-template-columns: 1fr; }
}
</style>
