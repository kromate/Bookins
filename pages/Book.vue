<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { initLocale, intlLocale, locale, setLocale, t } from '../i18n/guest.js'
import AppIcon from '../components/AppIcon.vue'
import BookinsLogo from '../components/BookinsLogo.vue'
import { demoGuestApi } from '../demo/guest.js'
import {
  isLocalPreview,
  loadGuestCalendarCheck,
  loadGuestOpenings,
  loadGuestPage,
  openingOverlapsBusy,
  readWithDeadline,
  submitGuestBooking,
} from '../booking.js'
import { filterGroups, LAYOUTS, parseBio, readPageParams, slugify, teamRows } from '../guest-page.js'
import { groupServices, presentService } from '../service-meta.js'
import {
  buildBookingIcs,
  detectGuestTimeZone,
  displayTimeZone,
  defaultClockMode,
  formatClockMode,
  googleCalendarUrl,
  searchTimeZones,
  zonedDateKey,
  zoneDisplayLabel,
} from '../time-display.js'

const props = defineProps({ demoPreview: { type: Boolean, default: false } })
initLocale()

const MAX_RANGE_DAYS = 31
const RESULT_CAP = 100 // smallest per-call cap across hosted (200), local and demo engines
const SEARCH_AHEAD_DAYS = 366
const SEARCH_DEADLINE_MS = 20_000
const COLUMN_DAYS = 5
const SESSION_TTL = 5 * 60_000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_PATTERN = /^[+()\-.\s\d]{6,40}$/

// Display options and prefill from the link: ?name=&email=&phone=&layout=month|week|column&theme=light|dark&service=
const params = readPageParams(typeof window === 'undefined' ? '' : window.location.search)
const theme = params.theme || 'light'
const layoutPref = ref(params.layout || 'month')

const loading = ref(true)
const pageError = ref(null) // { kind, retry }
const page = ref(null)
const selectedService = ref(null)
const selectedSlot = ref(null)
const pendingSlot = ref(null) // small screens: a tapped time waits for the sticky Continue bar
const submitting = ref(false)
const confirmation = ref(null)
const notes = ref('')
const contact = reactive({ name: params.name, email: params.email, phone: params.phone })
const touched = reactive({ name: false, email: false, phone: false })
const serverFieldErrors = reactive({ name: '', email: '', phone: '' })
const submitAttempted = ref(false)
const banner = ref(null)
const bannerPanel = ref(null)
const stepHeading = ref(null)
const confirmHeading = ref(null)
const photoFailed = ref(false)

// Responsive: at <= 820px the date picker becomes a slots-first week strip with a month bottom sheet.
const mobileQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 820px)') : null
const isMobile = ref(Boolean(mobileQuery?.matches))
const onMobileChange = event => { isMobile.value = event.matches }
const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

// Availability state
const guestTz = detectGuestTimeZone()
const TZ_KEY = 'bookins.guest.tz'
function storedZone() {
  try {
    const value = globalThis.localStorage?.getItem(TZ_KEY)
    return value && displayTimeZone(value) === value ? value : ''
  } catch { return '' }
}
const zoneChoice = ref(storedZone() || guestTz)
const openingStore = shallowRef(new Map())
let covered = new Set()
// Per-service session cache of loaded openings (5 min), so returning to a service is instant.
const sessionCache = new Map()
// Calendar remains a declared guest capability separate from Bookins' authoritative slot record.
// A failed check degrades visibly, and a selected slot is checked again before confirmation.
const calendarCheck = ref({ state: props.demoPreview ? 'unavailable' : 'idle' })
let calendarCheckDisabled = props.demoPreview
let requestSeq = 0
let nextSearchSeq = 0
const rangeLoading = ref(false)
const rangeError = ref('') // i18n key; empty when there is no error
let rangeRetried = false
let pageRetried = false
const nextHint = ref({ state: 'idle', key: '' })
const selectedDate = ref('')
const viewMonth = reactive({ year: 0, month: 0 })
const windowStart = ref('')
const sheetOpen = ref(false)

// Idempotency: one key per booking attempt (service + slot + contact + notes).
let attemptKey = null
let attemptSignature = ''
const allowUncheckedSubmit = ref(false)
// Key of an attempt whose outcome is unknown (lost response). A later SLOT_TAKEN for the
// same key may be the guest's own booking, so it must not be reported as someone else's.
let uncertainKey = null
let interacted = false

const ownerTz = computed(() => {
  const first = openingStore.value.values().next().value
  return displayTimeZone(first?.timezone || page.value?.profile?.timezone)
})
const displayedTimezone = computed(() => zoneChoice.value)
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
// A `[[wa:+234...]]` marker in the host bio is a hidden WhatsApp contact: never shown, used only on the confirmation.
const bio = computed(() => parseBio(page.value?.profile?.bio))

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
const weekdayOf = key => new Date(`${key}T00:00:00Z`).getUTCDay()
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

// ---- date view: month (default), week, column; small screens always use the slots-first strip ----
const dateView = computed(() => (isMobile.value ? 'strip' : layoutPref.value))
const windowLen = computed(() => (dateView.value === 'column' ? COLUMN_DAYS : 7))
const windowDays = computed(() => (windowStart.value ? Array.from({ length: windowLen.value }, (_, index) => addDays(windowStart.value, index)) : []))
const windowMin = computed(() => (dateView.value === 'week' ? addDays(todayKey.value, -weekdayOf(todayKey.value)) : todayKey.value))
const canWindowPrev = computed(() => windowStart.value > windowMin.value)
const canWindowNext = computed(() => addDays(windowStart.value, windowLen.value) <= addDays(todayKey.value, 365))
const windowTitle = computed(() => {
  if (!windowDays.value.length) return ''
  const short = { month: 'short', day: 'numeric' }
  return `${dayLabel(windowDays.value[0], short)} – ${dayLabel(windowDays.value.at(-1), { ...short, year: 'numeric' })}`
})
function alignWindow(key) {
  const from = key < todayKey.value ? todayKey.value : key
  windowStart.value = dateView.value === 'week' ? addDays(from, -weekdayOf(from)) : from
}

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
const columns = computed(() =>
  windowDays.value.map(key => ({ key, past: key < todayKey.value, slots: availableDays.value.get(key) || [] })),
)
const windowHasOpenings = computed(() => columns.value.some(column => column.slots.length))
const viewHasOpenings = computed(() => (dateView.value === 'month' ? monthHasOpenings.value : windowHasOpenings.value))

function firstDayAfter(key) {
  for (const day of availableDays.value.keys()) if (day > key) return day
  return ''
}
/** The day the "Next available" chip jumps to, or '' when there is nothing to offer. */
const nextTarget = computed(() => {
  if (dateView.value === 'strip') {
    if (!selectedDate.value || slotsForSelectedDay.value.length) return ''
    return firstDayAfter(selectedDate.value) || (nextHint.value.state === 'found' ? nextHint.value.key : '')
  }
  return !viewHasOpenings.value && nextHint.value.state === 'found' ? nextHint.value.key : ''
})
const nextWhen = computed(() => {
  const key = nextTarget.value
  const first = key ? availableDays.value.get(key)?.[0] : null
  if (!key) return ''
  const date = dayLabel(key, { weekday: 'short', day: 'numeric', month: 'short' })
  return first ? `${date}, ${clockText(first.startsAt)}` : date
})

function resetAvailability() {
  requestSeq += 1
  nextSearchSeq += 1
  openingStore.value = new Map()
  covered = new Set()
  rangeLoading.value = false
  rangeError.value = ''
  nextHint.value = { state: 'idle', key: '' }
  selectedDate.value = ''
  pendingSlot.value = null
  sheetOpen.value = false
  allowUncheckedSubmit.value = false
  calendarCheck.value = { state: props.demoPreview ? 'unavailable' : 'idle' }
  calendarCheckDisabled = props.demoPreview
}

function rememberAvailability() {
  const id = selectedService.value?.id
  if (!id) return
  const entry = sessionCache.get(id)
  sessionCache.set(id, {
    store: openingStore.value,
    covered,
    calendarCheck: calendarCheck.value,
    calendarCheckDisabled,
    at: entry?.at ?? Date.now(),
  })
}
function restoreAvailability(id) {
  const entry = sessionCache.get(id)
  if (!entry || Date.now() - entry.at > SESSION_TTL) {
    sessionCache.delete(id)
    return
  }
  openingStore.value = entry.store
  covered = entry.covered
  calendarCheck.value = entry.calendarCheck || { state: props.demoPreview ? 'unavailable' : 'idle' }
  calendarCheckDisabled = entry.calendarCheckDisabled ?? props.demoPreview
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

function markCalendarCheck(state) {
  calendarCheck.value = { state }
}

async function withoutBusy(list, seq = requestSeq, force = false) {
  if ((calendarCheckDisabled && !force) || !list.length) return list
  const starts = list.map(item => Date.parse(item.startsAt)).filter(Number.isFinite)
  const ends = list.map(item => Date.parse(item.endsAt) || Date.parse(item.startsAt)).filter(Number.isFinite)
  if (!starts.length) return list
  if (seq === requestSeq) markCalendarCheck('checking')
  const result = await loadGuestCalendarCheck(Math.min(...starts), Math.max(...ends) + 1)
  if (result.state !== 'checked') {
    calendarCheckDisabled = true
    if (seq === requestSeq) markCalendarCheck(result.state === 'unavailable' ? 'unavailable' : 'degraded')
    return list
  }
  calendarCheckDisabled = false
  if (seq === requestSeq) markCalendarCheck('checked')
  return list.filter(item => !openingOverlapsBusy(item, result.busy))
}

async function retryCalendarCheck() {
  if (calendarCheck.value.state === 'checking') return
  allowUncheckedSubmit.value = false
  const seq = ++requestSeq
  const current = [...openingStore.value.values()]
  calendarCheckDisabled = false
  const filtered = await withoutBusy(current, seq, true)
  if (seq !== requestSeq) return
  openingStore.value = new Map(filtered.map(opening => [opening.startsAt, opening]))
  if (selectedSlot.value && !openingStore.value.has(selectedSlot.value.startsAt)) {
    selectedSlot.value = null
    pendingSlot.value = null
    showBanner('slot', 'banner.calendarBusy')
  }
  rememberAvailability()
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
    const list = await withoutBusy(fetched, seq)
    if (seq !== requestSeq) return false
    const next = new Map(openingStore.value)
    for (const opening of list) next.set(opening.startsAt, opening)
    openingStore.value = next
    for (let offset = 0; offset < length; offset += 1) covered.add(addDays(chunkStart, offset))
    rememberAvailability()
    index += length
  }
  return true
}

function firstDayOnOrAfter(key) {
  for (const day of availableDays.value.keys()) if (day >= key) return day
  return ''
}

/** Scans forward in <=31-day calls until a day with openings is found (or the search window ends). */
async function findNextAvailable(fromKey, seq, searchSeq) {
  const start = fromKey < todayKey.value ? todayKey.value : fromKey
  const limit = addDays(todayKey.value, SEARCH_AHEAD_DAYS)
  for (let cursor = start; cursor <= limit; cursor = addDays(cursor, MAX_RANGE_DAYS)) {
    if (searchSeq !== nextSearchSeq) return null
    const through = addDays(cursor, MAX_RANGE_DAYS - 1)
    // One day of padding covers guest-zone/schedule-zone date differences.
    if (!(await ensureRange(addDays(cursor, -1), addDays(through, 1), seq))) return null
    if (searchSeq !== nextSearchSeq) return null
    const found = firstDayOnOrAfter(start)
    if (found) return found
  }
  return ''
}

async function boundedNextAvailable(fromKey, seq) {
  const searchSeq = ++nextSearchSeq
  try {
    return await readWithDeadline(() => findNextAvailable(fromKey, seq, searchSeq), SEARCH_DEADLINE_MS)
  } catch (error) {
    if (searchSeq === nextSearchSeq) nextSearchSeq += 1
    throw error
  }
}

async function searchNext(fromKey, seq = requestSeq) {
  nextHint.value = { state: 'searching', key: '' }
  const found = await boundedNextAvailable(fromKey, seq)
  if (found === null || seq !== requestSeq) return
  nextHint.value = { state: found ? 'found' : 'none', key: found }
}

function errorKeyFor(reason, fallback) {
  const code = errorCode(reason)
  if (code === 'BOOKING_SERVICE_NOT_FOUND') return 'err.serviceGone'
  if (code === 'BOOKING_SCHEDULE_UNAVAILABLE') return 'err.noSchedule'
  if (code === 'BOOKING_READ_TIMEOUT') return 'err.timeoutRange'
  if (isNetworkError(reason)) return 'err.networkRange'
  return fallback
}

function spanFor(mode) {
  return mode === 'month'
    ? [monthFirst(viewMonth.year, viewMonth.month), monthLast(viewMonth.year, viewMonth.month)]
    : [windowStart.value, addDays(windowStart.value, windowLen.value - 1)]
}

/** Loads what the current view shows: the visible month (mode 'month') or the week/column/strip window. */
async function loadView(mode = dateView.value === 'month' ? 'month' : 'window') {
  const seq = ++requestSeq
  rangeLoading.value = true
  rangeError.value = ''
  nextHint.value = { state: 'idle', key: '' }
  try {
    const [from, to] = spanFor(mode)
    const ok = await ensureRange(addDays(from, -1), addDays(to, 1), seq)
    if (!ok || seq !== requestSeq) return
    prefetchNext(seq, mode)
    let has = true
    if (dateView.value === 'month') {
      if (selectedDate.value && !availableDays.value.has(selectedDate.value)) selectedDate.value = ''
      has = monthHasOpenings.value
    } else if (mode === 'window') {
      // Slots first: land on the first day of the window that has times.
      if (dateView.value === 'strip' && !windowDays.value.includes(selectedDate.value)) {
        selectedDate.value = windowDays.value.find(day => availableDays.value.has(day)) || windowDays.value[0] || ''
      }
      has = windowHasOpenings.value
    }
    if (!has && (dateView.value === 'month' || mode === 'window')) {
      await searchNext(from < todayKey.value ? todayKey.value : addDays(to, 1), seq)
    }
  } catch (reason) {
    if (seq !== requestSeq) return
    rangeError.value = errorKeyFor(reason, 'err.availability')
  } finally {
    if (seq === requestSeq) rangeLoading.value = false
  }
}

const whenIdle = callback =>
  typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(callback, { timeout: 2500 }) : setTimeout(callback, 250)

/** Quietly warms the next month / window once the browser is idle. Failures are ignored; the normal load retries. */
function prefetchNext(seq, mode) {
  let from
  let to
  if (mode === 'month') {
    const next = new Date(Date.UTC(viewMonth.year, viewMonth.month + 1, 1))
    from = monthFirst(next.getUTCFullYear(), next.getUTCMonth())
    to = monthLast(next.getUTCFullYear(), next.getUTCMonth())
  } else {
    from = addDays(windowStart.value, windowLen.value)
    to = addDays(from, windowLen.value - 1)
  }
  if (from > addDays(todayKey.value, 365)) return
  whenIdle(() => {
    if (seq === requestSeq) ensureRange(addDays(from, -1), addDays(to, 1), seq).catch(() => {})
  })
}

async function initialJump() {
  const seq = ++requestSeq
  rangeLoading.value = true
  rangeError.value = ''
  setViewFromKey(todayKey.value)
  alignWindow(todayKey.value)
  try {
    const found = await boundedNextAvailable(todayKey.value, seq)
    if (found === null || seq !== requestSeq) return
    if (found) {
      selectedDate.value = found
      setViewFromKey(found)
      alignWindow(found)
      await loadView()
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
  if (selectedDate.value || viewHasOpenings.value || openingStore.value.size) loadView()
  else initialJump()
}

function shiftMonth(delta) {
  const value = new Date(Date.UTC(viewMonth.year, viewMonth.month + delta, 1))
  viewMonth.year = value.getUTCFullYear()
  viewMonth.month = value.getUTCMonth()
  if (dateView.value === 'month') selectedDate.value = ''
  loadView('month')
}

function shiftWindow(direction) {
  const step = dateView.value === 'column' ? COLUMN_DAYS : 7
  const next = addDays(windowStart.value, direction * step)
  windowStart.value = next < windowMin.value ? windowMin.value : next
  selectedDate.value = ''
  loadView()
}

function currentAnchor() {
  if (selectedDate.value) return selectedDate.value
  if (dateView.value === 'month') {
    const first = monthFirst(viewMonth.year, viewMonth.month)
    return first < todayKey.value ? todayKey.value : first
  }
  return windowStart.value || todayKey.value
}

function switchLayout(next) {
  if (next === layoutPref.value) return
  const anchor = currentAnchor()
  layoutPref.value = next
  setViewFromKey(anchor)
  alignWindow(anchor)
  loadView()
}

async function jumpToNext() {
  const key = nextTarget.value
  if (!key) return
  selectedDate.value = key
  setViewFromKey(key)
  alignWindow(key)
  await loadView()
  selectedDate.value = key
}

function pickDay(cell) {
  if (cell.count) selectedDate.value = cell.key
}

function pickStripDay(key) {
  selectedDate.value = key
  if (!availableDays.value.get(key)?.length && !firstDayAfter(key)) searchNext(addDays(key, 1)).catch(() => {})
}

// ---- month bottom sheet (small screens) ----
const sheetEl = ref(null)
const sheetTrigger = ref(null)
function openSheet() {
  setViewFromKey(selectedDate.value || windowStart.value || todayKey.value)
  sheetOpen.value = true
  loadView('month')
  nextTick(() => sheetEl.value?.querySelector('button:not(:disabled)')?.focus())
}
function closeSheet() {
  sheetOpen.value = false
  nextTick(() => sheetTrigger.value?.focus())
}
function pickFromSheet(cell) {
  if (!cell.count) return
  selectedDate.value = cell.key
  if (!windowDays.value.includes(cell.key)) alignWindow(cell.key)
  closeSheet()
  loadView('window')
}
function onSheetKey(event) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    return closeSheet()
  }
  if (event.key !== 'Tab') return
  const items = [...sheetEl.value.querySelectorAll('button:not(:disabled)')]
  if (!items.length) return
  const first = items[0]
  const last = items.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
watch(sheetOpen, open => { document.body.style.overflow = open ? 'hidden' : '' })

// ---- week / column keyboard navigation (one tab stop, arrow keys move between times) ----
const roving = ref('')
const rovingStart = computed(() => {
  const all = columns.value.flatMap(column => column.slots)
  return all.some(slot => slot.startsAt === roving.value) ? roving.value : all[0]?.startsAt || ''
})
function columnKeydown(event) {
  const target = event.target.closest?.('[data-col]')
  if (!target) return
  const col = Number(target.dataset.col)
  const row = Number(target.dataset.row)
  const lengths = columns.value.map(column => column.slots.length)
  let nextCol = col
  let nextRow = row
  if (event.key === 'ArrowDown') nextRow = Math.min(row + 1, lengths[col] - 1)
  else if (event.key === 'ArrowUp') nextRow = Math.max(row - 1, 0)
  else if (event.key === 'Home') nextRow = 0
  else if (event.key === 'End') nextRow = lengths[col] - 1
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const dir = event.key === 'ArrowRight' ? 1 : -1
    let probe = col + dir
    while (probe >= 0 && probe < lengths.length && !lengths[probe]) probe += dir
    if (probe < 0 || probe >= lengths.length) return event.preventDefault()
    nextCol = probe
    nextRow = Math.min(row, lengths[probe] - 1)
  } else return
  event.preventDefault()
  event.currentTarget.querySelector(`[data-col="${nextCol}"][data-row="${nextRow}"]`)?.focus()
}

// Re-bucket days when the display zone changes; a chosen time keeps pointing at the same instant.
watch(displayedTimezone, () => {
  if (!selectedService.value) return
  const keep = selectedSlot.value || pendingSlot.value
  if (keep) {
    const key = zonedDateKey(keep.startsAt, displayedTimezone.value)
    selectedDate.value = key
    setViewFromKey(key)
    alignWindow(key)
    loadView()
  } else {
    selectedDate.value = ''
    initialJump()
  }
})
watch(isMobile, () => {
  if (!selectedService.value) return
  const anchor = selectedDate.value || todayKey.value
  sheetOpen.value = false
  setViewFromKey(anchor)
  alignWindow(anchor)
  loadView()
})

// ---- time zone picker (searchable, remembered) ----
const tzOpen = ref(false)
const tzQuery = ref('')
const tzActive = ref(0)
const tzBox = ref(null)
const tzInput = ref(null)
const tzButton = ref(null)
const tzResults = computed(() => (tzOpen.value ? searchTimeZones(tzQuery.value, { pinned: [zoneChoice.value, guestTz, ownerTz.value] }) : []))
const tzTag = zone => (zone === guestTz ? t('tz.device') : zone === ownerTz.value ? t('tz.host') : '')
watch(tzQuery, () => { tzActive.value = 0 })
function openTz() {
  tzQuery.value = ''
  tzActive.value = 0
  tzOpen.value = true
  nextTick(() => tzInput.value?.focus())
}
function closeTz(refocus = true) {
  tzOpen.value = false
  if (refocus) nextTick(() => tzButton.value?.focus())
}
function chooseZone(zone) {
  zoneChoice.value = zone
  try {
    if (zone === guestTz) globalThis.localStorage?.removeItem(TZ_KEY)
    else globalThis.localStorage?.setItem(TZ_KEY, zone)
  } catch { /* the choice just is not remembered */ }
  closeTz()
}
function onTzKey(event) {
  const last = tzResults.value.length - 1
  if (event.key === 'ArrowDown') tzActive.value = Math.min(tzActive.value + 1, last)
  else if (event.key === 'ArrowUp') tzActive.value = Math.max(tzActive.value - 1, 0)
  else if (event.key === 'Enter') {
    if (tzResults.value[tzActive.value]) chooseZone(tzResults.value[tzActive.value])
  } else if (event.key === 'Escape') {
    event.stopPropagation()
    return closeTz()
  } else if (event.key === 'Tab') return closeTz(false)
  else return
  event.preventDefault()
  nextTick(() => tzBox.value?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }))
}
function onDocumentPointer(event) {
  if (tzOpen.value && !tzBox.value?.contains(event.target)) closeTz(false)
}

// ---- formatting ----
function priceLabel(service) {
  if (!Number(service.price)) return t('svc.free')
  let text
  try {
    text = new Intl.NumberFormat(intlLocale(), {
      style: 'currency',
      currency: service.currency || 'NGN',
      maximumFractionDigits: 0,
    }).format(service.price)
  } catch {
    text = `${service.currency || 'NGN'} ${Number(service.price).toLocaleString()}`
  }
  return service.priceVaries ? t('svc.from', { price: text }) : text
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
const pendingLabel = computed(() =>
  pendingSlot.value
    ? `${dayLabel(zonedDateKey(pendingSlot.value.startsAt, displayedTimezone.value), { weekday: 'short', day: 'numeric', month: 'short' })} · ${clockText(pendingSlot.value.startsAt)}`
    : '',
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
function commitSlot(slot) {
  interacted = true
  selectedSlot.value = slot
  selectedDate.value = zonedDateKey(slot.startsAt, displayedTimezone.value)
  pendingSlot.value = null
  banner.value = null
  allowUncheckedSubmit.value = false
}
function selectSlot(slot) {
  interacted = true
  // Small screens: tapping a time only highlights it; the sticky Continue bar moves on.
  if (isMobile.value) pendingSlot.value = slot
  else commitSlot(slot)
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
  query.value = ''
  openTeam.value = ''
  resetAvailability()
}

async function choose(service) {
  selectedService.value = service
  selectedSlot.value = null
  banner.value = null
  resetAvailability()
  restoreAvailability(service.id)
  await initialJump()
}

// ---- service list: categories, search, team choice ----
const query = ref('')
const openTeam = ref('')
const serviceGroups = computed(() =>
  groupServices(page.value?.services || []).map(group => ({ name: group.name, rows: teamRows(group.items, { hostName: page.value?.profile?.displayName || '' }) })),
)
const serviceCount = computed(() => serviceGroups.value.reduce((total, group) => total + group.rows.length, 0))
const hasCategories = computed(() => serviceGroups.value.some(group => group.name))
const showHeadings = computed(() => serviceGroups.value.length > 1)
const showSearch = computed(() => hasCategories.value && serviceCount.value > 6)
const visibleGroups = computed(() => filterGroups(serviceGroups.value, showSearch.value ? query.value : ''))
const visibleCount = computed(() => visibleGroups.value.reduce((total, group) => total + group.rows.length, 0))
const optionLabel = (option, index) => {
  if (option.owner) {
    const host = page.value?.profile?.displayName
    return host ? t('sum.with', { host }) : t('team.host')
  }
  return t('sum.with', { host: option.copy.staffName || t('team.option', { n: index + 1 }) })
}
const initialOf = text => (Array.from(String(text || '').trim())[0] || '•').toUpperCase()

function openFromParam() {
  const want = params.service
  if (!want || selectedService.value) return
  const slug = slugify(want)
  const rows = serviceGroups.value.flatMap(group => group.rows)
  for (const row of rows) {
    for (const copy of row.copies) {
      if (copy.id === want || copy.slug === want || (copy.slug && slugify(copy.slug) === slug)) return choose(copy)
    }
  }
  const row = rows.find(item => slugify(item.name) === slug)
  if (!row) return
  if (row.team) openTeam.value = row.key
  else return choose(row.options[0].copy)
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
    if (page.value.services.length === 1) await choose(presentService(page.value.services[0]))
    else await openFromParam()
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
  covered = new Set()
  sessionCache.clear()
  selectedSlot.value = null
  pendingSlot.value = null
  resetAttempt()
  showBanner('slot', 'banner.slotTaken')
  await loadView()
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
    sessionCache.clear()
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
  submitting.value = true
  banner.value = null
  let key = ''
  try {
    const slot = selectedSlot.value
    if (!allowUncheckedSubmit.value) {
      const previousCalendarState = calendarCheck.value.state
      const result = await loadGuestCalendarCheck(Date.parse(slot.startsAt), Date.parse(slot.endsAt))
      if (result.state === 'checked') {
        allowUncheckedSubmit.value = false
        calendarCheckDisabled = false
        markCalendarCheck('checked')
        if (openingOverlapsBusy(slot, result.busy)) {
          await refreshAfterSlotTaken()
          showBanner('slot', 'banner.calendarBusy')
          return
        }
      } else if (result.state === 'unavailable' && previousCalendarState === 'unavailable') {
        calendarCheckDisabled = true
        markCalendarCheck('unavailable')
        rememberAvailability()
      } else if (!props.demoPreview) {
        calendarCheckDisabled = true
        markCalendarCheck('degraded')
        allowUncheckedSubmit.value = true
        rememberAvailability()
        showBanner('retry', 'banner.calendarUnchecked')
        return
      }
    }
    const payload = {
      serviceId: selectedService.value.id,
      startsAt: slot.startsAt,
      contact: { name: contact.name.trim(), email: contact.email.trim(), phone: contact.phone.trim() },
      notes: notes.value.trim(),
    }
    key = keyForAttempt(payload)
    confirmation.value = await submitGuestBooking(payload, key)
    sessionCache.clear() // the booked time must not come back from the cache
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
// The guest's own share/copy of the booking details. Nothing is sent by Bookins.
const detailsText = computed(() => {
  const value = confirmation.value
  if (!value) return ''
  return t('share.text', {
    service: value.serviceName,
    host: page.value?.profile?.displayName || t('host.fallback'),
    when: `${longDateTime(value.startsAt)}, ${displayedZoneLabel.value}`,
    reference: value.reference,
  })
})
const shareUrl = computed(() => `https://wa.me/?text=${encodeURIComponent(detailsText.value)}`)
const changeUrl = computed(() =>
  bio.value.whatsapp && confirmation.value
    ? `https://wa.me/${bio.value.whatsapp}?text=${encodeURIComponent(t('share.changeText', { reference: confirmation.value.reference }))}`
    : '',
)
const detailsCopied = ref(false)
async function copyDetails() {
  try {
    await navigator.clipboard.writeText(detailsText.value)
    detailsCopied.value = true
    setTimeout(() => { detailsCopied.value = false }, 2000)
  } catch { /* clipboard unavailable: the details are on screen */ }
}

async function bookAnother() {
  confirmation.value = null
  selectedSlot.value = null
  notes.value = ''
  submitAttempted.value = false
  banner.value = null
  resetAttempt()
  interacted = true
  window.scrollTo({ top: 0 })
  if (singleService.value) await choose(presentService(page.value.services[0]))
  else {
    selectedService.value = null
    query.value = ''
    openTeam.value = ''
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
  window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
  await nextTick()
  confirmHeading.value?.focus()
})

function chooseService(service) {
  interacted = true
  choose(service)
}
function toggleTeam(key) {
  openTeam.value = openTeam.value === key ? '' : key
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

const rootBackground = { light: '', dark: '#0e0f11' }
onMounted(() => {
  window.addEventListener('online', onOnline)
  document.addEventListener('pointerdown', onDocumentPointer)
  mobileQuery?.addEventListener?.('change', onMobileChange)
  document.documentElement.style.backgroundColor = rootBackground[theme]
  start()
})
onBeforeUnmount(() => {
  requestSeq += 1
  window.removeEventListener('online', onOnline)
  document.removeEventListener('pointerdown', onDocumentPointer)
  mobileQuery?.removeEventListener?.('change', onMobileChange)
  document.documentElement.style.backgroundColor = ''
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="bk" :data-theme="theme" :data-demo-guest-ready="demoPreview && !loading && !pageError ? 'true' : undefined">
    <header class="bk-header">
      <a href="/" aria-label="Bookins"><BookinsLogo :inverse="theme === 'dark'" /></a>
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
          <div><dt>{{ t('confirm.who') }}</dt><dd>{{ selectedService?.staffName ? `${page.profile.displayName} · ${selectedService.staffName}` : page.profile.displayName }}</dd></div>
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
          <a class="bk-btn" :href="shareUrl" target="_blank" rel="noopener noreferrer">{{ t('confirm.shareWa') }}</a>
          <button class="bk-btn" type="button" @click="copyDetails"><AppIcon name="copy" :size="15" />{{ detailsCopied ? t('confirm.detailsCopied') : t('confirm.copyDetails') }}</button>
          <span class="bk-sr" role="status">{{ detailsCopied ? t('confirm.detailsCopied') : '' }}</span>
        </div>
        <p v-if="changeUrl" class="bk-change">
          {{ t('confirm.change', { host: page.profile.displayName }) }}
          <a class="bk-btn small" :href="changeUrl" target="_blank" rel="noopener noreferrer">{{ t('confirm.changeCta', { host: page.profile.displayName }) }}</a>
        </p>
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
            <p v-if="bio.text" class="bk-bio">{{ bio.text }}</p>
          </div>
          <div v-if="page.services.length" class="bk-card bk-services">
            <h2 ref="stepHeading" tabindex="-1" class="bk-services-title">{{ t('svc.title') }}</h2>
            <div v-if="showSearch" class="bk-search">
              <AppIcon name="search" :size="15" />
              <input v-model="query" type="search" class="bk-input" :aria-label="t('svc.search')" :placeholder="t('svc.searchHint')" autocomplete="off" />
            </div>
            <p class="bk-sr" role="status" aria-live="polite">{{ showSearch && query.trim() ? t('svc.count', { count: visibleCount }) : '' }}</p>
            <p v-if="!visibleGroups.length" class="bk-nomatch">{{ t('svc.noMatch', { query: query.trim() }) }}</p>
            <template v-for="group in visibleGroups" :key="group.name || 'other'">
              <h3 v-if="showHeadings" class="bk-group">{{ group.name || t('svc.other') }}</h3>
              <ul>
                <li v-for="row in group.rows" :key="row.key">
                  <button
                    type="button"
                    class="bk-service"
                    :aria-expanded="row.team ? openTeam === row.key : undefined"
                    :aria-controls="row.team ? `team-${row.key}` : undefined"
                    @click="row.team ? toggleTeam(row.key) : chooseService(row.options[0].copy)"
                  >
                    <span class="bk-service-name">{{ row.name }}</span>
                    <span v-if="row.description" class="bk-service-desc">{{ row.description }}</span>
                    <span v-if="row.prepNotes" class="bk-service-prep">{{ t('svc.prep', { notes: row.prepNotes }) }}</span>
                    <span class="bk-chips">
                      <span class="bk-chip"><AppIcon name="clock" :size="12" />{{ t('svc.min', { count: row.durationMinutes }) }}</span>
                      <span class="bk-chip">{{ priceLabel(row) }}</span>
                      <span v-if="row.team" class="bk-chip team"><AppIcon name="user" :size="12" />{{ t('svc.team', { count: row.options.length }) }}</span>
                    </span>
                  </button>
                  <div v-if="row.team && openTeam === row.key" :id="`team-${row.key}`" class="bk-team" role="group" :aria-label="t('svc.pickWho')">
                    <button v-for="(option, index) in row.options" :key="option.copy.id" type="button" class="bk-pro" @click="chooseService(option.copy)">
                      <span class="bk-avatar" aria-hidden="true">{{ initialOf(option.owner ? page.profile.displayName : option.copy.staffName || t('team.option', { n: index + 1 })) }}</span>
                      <span>{{ optionLabel(option, index) }}</span>
                      <span class="bk-pro-price">{{ priceLabel(option.copy) }}</span>
                    </button>
                  </div>
                </li>
              </ul>
            </template>
          </div>
          <div v-else class="bk-card bk-empty">
            <AppIcon name="calendar" :size="24" />
            <h2>{{ t('svc.emptyTitle') }}</h2>
            <p>{{ t('svc.emptyText', { host: page.profile.displayName }) }}</p>
          </div>
        </section>

        <!-- Scheduler: info | dates + times, then info | details -->
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
                <li v-if="selectedService.staffName"><AppIcon name="user" :size="15" /><span>{{ t('sum.with', { host: selectedService.staffName }) }}</span></li>
                <li><AppIcon name="clock" :size="15" /><span>{{ t('confirm.minutes', { count: selectedService.durationMinutes }) }}</span></li>
                <li><AppIcon name="wallet" :size="15" /><span>{{ priceLabel(selectedService) }}</span></li>
                <li v-if="selectedService.price" class="bk-meta-note"><span>{{ t('sum.payment') }}</span></li>
                <li v-if="selectedService.prepNotes" class="bk-meta-note prep"><span>{{ t('svc.prep', { notes: selectedService.prepNotes }) }}</span></li>
              </ul>
              <div ref="tzBox" class="bk-tz">
                <button
                  ref="tzButton"
                  type="button"
                  class="bk-tz-btn"
                  aria-haspopup="listbox"
                  :aria-expanded="tzOpen"
                  :aria-label="t('tz.change', { zone: displayedZoneLabel })"
                  :disabled="submitting"
                  @click="tzOpen ? closeTz() : openTz()"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.4 4 5.5 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.5-4-9s1.4-6.6 4-9z" /></svg>
                  <span>{{ displayedZoneLabel }}</span>
                  <svg class="bk-tz-caret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                <div v-if="tzOpen" class="bk-tz-pop">
                  <input
                    ref="tzInput"
                    v-model="tzQuery"
                    class="bk-input"
                    type="text"
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="booking-tz-list"
                    :aria-activedescendant="tzResults.length ? `tz-opt-${tzActive}` : undefined"
                    aria-autocomplete="list"
                    autocomplete="off"
                    :aria-label="t('tz.search')"
                    :placeholder="t('tz.search')"
                    @keydown="onTzKey"
                  />
                  <ul id="booking-tz-list" role="listbox" :aria-label="t('tz.label')">
                    <li
                      v-for="(zone, index) in tzResults"
                      :id="`tz-opt-${index}`"
                      :key="zone"
                      role="option"
                      :aria-selected="index === tzActive"
                      :class="{ active: index === tzActive, current: zone === zoneChoice }"
                      @pointerdown.prevent="chooseZone(zone)"
                      @pointermove="tzActive = index"
                    >
                      <span>{{ zoneLabel(zone) }}</span>
                      <small v-if="tzTag(zone)">{{ tzTag(zone) }}</small>
                    </li>
                    <li v-if="!tzResults.length" class="bk-tz-none" role="presentation">{{ t('tz.noMatch') }}</li>
                  </ul>
                </div>
              </div>
            </aside>

            <Transition name="bk-pane" mode="out-in">
              <div v-if="stage === 'schedule'" key="schedule" class="bk-schedule" :class="`dv-${dateView}`">
                <h2 ref="stepHeading" tabindex="-1" class="bk-sr">{{ t('time.title') }}</h2>
                <div class="bk-viewbar">
                  <div class="bk-range">
                    <h3 aria-live="polite">
                      <template v-if="dateView === 'month'"><strong>{{ monthLabel.replace(/\s*\d{4}$/, '') }}</strong> <span>{{ viewMonth.year }}</span></template>
                      <template v-else>{{ windowTitle }}</template>
                    </h3>
                    <div class="bk-cal-nav">
                      <template v-if="dateView === 'month'">
                        <button type="button" :disabled="!canGoPrev || rangeLoading" :aria-label="t('cal.prev')" @click="shiftMonth(-1)"><AppIcon name="arrow-left" :size="16" /></button>
                        <button type="button" :disabled="!canGoNext || rangeLoading" :aria-label="t('cal.next')" @click="shiftMonth(1)"><AppIcon name="chevron" :size="16" /></button>
                      </template>
                      <template v-else>
                        <button type="button" :disabled="!canWindowPrev || rangeLoading" :aria-label="t('cal.prevRange')" @click="shiftWindow(-1)"><AppIcon name="arrow-left" :size="16" /></button>
                        <button type="button" :disabled="!canWindowNext || rangeLoading" :aria-label="t('cal.nextRange')" @click="shiftWindow(1)"><AppIcon name="chevron" :size="16" /></button>
                      </template>
                    </div>
                  </div>
                  <div v-if="!isMobile" class="bk-switch" role="group" :aria-label="t('view.aria')">
                    <button v-for="mode in LAYOUTS" :key="mode" type="button" :aria-pressed="layoutPref === mode" :class="{ active: layoutPref === mode }" @click="switchLayout(mode)">{{ t(`view.${mode}`) }}</button>
                  </div>
                  <button v-else ref="sheetTrigger" type="button" class="bk-btn small" :aria-label="t('cal.pickDateAria')" aria-haspopup="dialog" @click="openSheet"><AppIcon name="calendar" :size="14" />{{ t('cal.pickDate') }}</button>
                </div>
                <div v-if="calendarCheck.state === 'checking'" class="bk-calendar-status" role="status">{{ t('cal.checking') }}</div>
                <div v-else-if="calendarCheck.state === 'degraded'" class="bk-calendar-status warning" role="alert">
                  <span>{{ t('cal.degraded') }}</span>
                  <button class="bk-btn small" type="button" @click="retryCalendarCheck">{{ t('cal.retry') }}</button>
                </div>
                <div v-else-if="calendarCheck.state === 'unavailable' && !demoPreview" class="bk-calendar-status" role="status">{{ t('cal.unavailable') }}</div>

                <!-- Month grid: the desktop month view, or the bottom sheet on small screens -->
                <div v-if="sheetOpen && dateView !== 'month'" class="bk-backdrop" @click="closeSheet" />
                <div
                  v-if="dateView === 'month' || sheetOpen"
                  ref="sheetEl"
                  class="bk-calendar"
                  :class="{ 'is-sheet': dateView !== 'month' }"
                  :role="dateView === 'month' ? 'group' : 'dialog'"
                  :aria-modal="dateView === 'month' ? undefined : 'true'"
                  :aria-label="t('cal.aria')"
                  @keydown="dateView === 'month' ? null : onSheetKey($event)"
                >
                  <div v-if="dateView !== 'month'" class="bk-sheet-bar">
                    <h3 aria-live="polite"><strong>{{ monthLabel.replace(/\s*\d{4}$/, '') }}</strong> <span>{{ viewMonth.year }}</span></h3>
                    <div class="bk-cal-nav">
                      <button type="button" :disabled="!canGoPrev || rangeLoading" :aria-label="t('cal.prev')" @click="shiftMonth(-1)"><AppIcon name="arrow-left" :size="16" /></button>
                      <button type="button" :disabled="!canGoNext || rangeLoading" :aria-label="t('cal.next')" @click="shiftMonth(1)"><AppIcon name="chevron" :size="16" /></button>
                      <button type="button" :aria-label="t('cal.close')" @click="closeSheet"><AppIcon name="close" :size="16" /></button>
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
                        :title="cell.count ? undefined : t('cal.noTimes')"
                        :aria-label="cell.count ? t('cal.dayTimes', { day: dayLabel(cell.key), count: cell.count }) : `${t('cal.dayNone', { day: dayLabel(cell.key) })}. ${t('cal.noTimes')}`"
                        @click="dateView === 'month' ? pickDay(cell) : pickFromSheet(cell)"
                      >{{ cell.day }}</button>
                    </template>
                  </div>
                </div>

                <!-- Slots-first week strip (small screens) -->
                <div v-if="dateView === 'strip'" class="bk-strip" role="group" :aria-label="t('cal.rangeAria')">
                  <button
                    v-for="key in windowDays"
                    :key="key"
                    type="button"
                    class="bk-sd"
                    :class="{ selected: key === selectedDate, has: availableDays.has(key) }"
                    :aria-pressed="key === selectedDate"
                    :aria-label="availableDays.get(key)?.length ? t('cal.dayTimes', { day: dayLabel(key), count: availableDays.get(key).length }) : t('cal.dayNone', { day: dayLabel(key) })"
                    @click="pickStripDay(key)"
                  >
                    <small>{{ dayLabel(key, { weekday: 'short' }) }}</small>
                    <strong>{{ Number(key.slice(8)) }}</strong>
                    <i aria-hidden="true" />
                  </button>
                </div>

                <!-- Week / column view -->
                <div v-if="dateView === 'week' || dateView === 'column'" class="bk-cols" role="group" :aria-label="t('cal.rangeAria')" :aria-busy="rangeLoading" :style="{ '--cols': windowLen }" @keydown="columnKeydown">
                  <div class="bk-cols-scroll">
                    <div v-for="(column, columnIndex) in columns" :key="column.key" class="bk-col" :class="{ past: column.past }">
                      <div class="bk-col-head">
                        <small>{{ dayLabel(column.key, { weekday: 'short' }) }}</small>
                        <strong>{{ Number(column.key.slice(8)) }}</strong>
                      </div>
                      <template v-if="rangeLoading">
                        <span v-for="n in 5" :key="n" class="bk-skel bk-skel-slot compact" aria-hidden="true" />
                      </template>
                      <template v-else>
                        <button
                          v-for="(slot, rowIndex) in column.slots"
                          :key="slot.startsAt"
                          type="button"
                          class="bk-slot compact"
                          :class="{ picked: pendingSlot?.startsAt === slot.startsAt }"
                          :data-col="columnIndex"
                          :data-row="rowIndex"
                          :tabindex="slot.startsAt === rovingStart ? 0 : -1"
                          :aria-label="t('cols.slotAria', { day: dayLabel(column.key), time: slotTime(slot) })"
                          @focus="roving = slot.startsAt"
                          @click="selectSlot(slot)"
                        >{{ slotTime(slot) }}</button>
                        <span v-if="!column.slots.length && !column.past" class="bk-col-none">{{ t('cols.none') }}</span>
                      </template>
                    </div>
                  </div>
                  <p v-if="rangeLoading" class="bk-sr" role="status">{{ t('slots.loading') }}</p>
                  <div v-else-if="rangeError" class="bk-note error" role="alert">
                    <p>{{ t(rangeError) }}</p>
                    <button class="bk-btn small" type="button" @click="retryRange">{{ t('retry') }}</button>
                  </div>
                  <div v-else-if="!windowHasOpenings" class="bk-note bk-cols-note">
                    <button v-if="nextTarget" class="bk-next" type="button" @click="jumpToNext"><AppIcon name="calendar" :size="14" />{{ t('slots.nextChip', { when: nextWhen }) }}</button>
                    <strong v-else-if="nextHint.state === 'searching'">{{ t('slots.searching') }}</strong>
                    <template v-else>
                      <strong>{{ t('slots.noneTitle') }}</strong>
                      <p>{{ t('slots.noneText', { host: page.profile.displayName }) }}</p>
                    </template>
                  </div>
                </div>

                <div v-if="dateView === 'month' || dateView === 'strip'" class="bk-slots">
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
                        <button
                          v-for="slot in slotsForSelectedDay"
                          :key="slot.startsAt"
                          type="button"
                          class="bk-slot"
                          :class="{ picked: pendingSlot?.startsAt === slot.startsAt }"
                          :aria-pressed="isMobile ? pendingSlot?.startsAt === slot.startsAt : undefined"
                          @click="selectSlot(slot)"
                        >{{ slotTime(slot) }}</button>
                      </div>
                    </template>
                    <div v-else-if="dateView === 'strip' && selectedDate" class="bk-note">
                      <strong>{{ t('slots.dayEmpty', { day: dayLabel(selectedDate) }) }}</strong>
                      <button v-if="nextTarget" class="bk-next" type="button" @click="jumpToNext"><AppIcon name="calendar" :size="14" />{{ t('slots.nextChip', { when: nextWhen }) }}</button>
                      <p v-else-if="nextHint.state === 'searching'" role="status">{{ t('slots.searching') }}</p>
                      <p v-else-if="nextHint.state === 'none'">{{ t('slots.noneText', { host: page.profile.displayName }) }}</p>
                    </div>
                    <div v-else-if="monthHasOpenings" class="bk-note">
                      <strong>{{ t('slots.pickDayTitle') }}</strong>
                      <p>{{ t('slots.pickDayText') }}</p>
                    </div>
                    <div v-else class="bk-note">
                      <strong v-if="nextHint.state === 'searching'">{{ t('slots.searching') }}</strong>
                      <template v-else-if="nextTarget">
                        <strong>{{ t('slots.noneInMonth', { month: monthLabel }) }}</strong>
                        <button class="bk-next" type="button" @click="jumpToNext"><AppIcon name="calendar" :size="14" />{{ t('slots.nextChip', { when: nextWhen }) }}</button>
                      </template>
                      <template v-else>
                        <strong>{{ t('slots.noneTitle') }}</strong>
                        <p>{{ t('slots.noneText', { host: page.profile.displayName }) }}</p>
                      </template>
                    </div>
                  </div>
                </div>

                <div v-if="isMobile && pendingSlot" class="bk-continue">
                  <span>{{ t('slots.picked', { when: pendingLabel }) }}</span>
                  <button class="bk-btn primary" type="button" @click="commitSlot(pendingSlot)">{{ t('slots.continue') }}</button>
                </div>
              </div>

              <div v-else key="details" class="bk-details">
                <h2 ref="stepHeading" tabindex="-1" class="bk-form-title">{{ demoPreview ? t('form.titleDemo') : t('form.title') }}</h2>
                <p class="bk-muted">{{ demoPreview ? t('form.textDemo') : t('form.text') }}</p>
                <div v-if="calendarCheck.state === 'checking'" class="bk-calendar-status details" role="status">{{ t('cal.checking') }}</div>
                <div v-else-if="calendarCheck.state === 'degraded'" class="bk-calendar-status details warning" role="alert">
                  <span>{{ t('cal.degraded') }}</span>
                  <button class="bk-btn small" type="button" :disabled="submitting" @click="retryCalendarCheck">{{ t('cal.retry') }}</button>
                </div>
                <div v-else-if="calendarCheck.state === 'unavailable' && !demoPreview" class="bk-calendar-status details" role="status">{{ t('cal.unavailable') }}</div>
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
                      {{ demoPreview ? t('form.submitDemo') : submitting ? t('form.submitting') : allowUncheckedSubmit ? t('form.submitUnchecked') : t('form.submit') }}
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
  --soft: #74777d;
  --line: #e5e7eb;
  --line-soft: #f3f4f6;
  --surface: #f5f5f5;
  --bg: #fafafa;
  --card: #ffffff;
  --on-ink: #ffffff;
  --ink-hover: #242424;
  --hover: #fafafa;
  --faint: #c4c7cd;
  --input-line: #d1d5db;
  --ring: rgba(17, 17, 17, 0.12);
  --bar: rgba(255, 255, 255, 0.96);
  --skel-a: #eceef1;
  --skel-b: #f6f7f8;
  --err: #b42318;
  --err-bg: #fef3f2;
  --err-bd: #fecdca;
  --warn: #93370d;
  --warn-bg: #fffaeb;
  --warn-bd: #fedf89;
  --ok: #027a48;
  --ok-bg: #ecfdf3;
  --demo-fg: #35217b;
  --demo-bg: #f5f1ff;
  --demo-bd: #d9cef9;
  --shadow: rgba(17, 17, 17, 0.04);
  --focus: #2336dc;
  --display: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  color: var(--ink);
  background: var(--bg);
  font-family: var(--font-ui, ui-sans-serif, system-ui, sans-serif);
  font-size: 14px;
  line-height: 1.5;
}
.bk[data-theme='dark'] {
  color-scheme: dark;
  --ink: #f4f4f5;
  --body: #d4d4d8;
  --muted: #a1a1aa;
  --soft: #9a9aa4;
  --line: #2e2f35;
  --line-soft: #25262b;
  --surface: #26272c;
  --bg: #0e0f11;
  --card: #16171a;
  --on-ink: #111113;
  --ink-hover: #e4e4e7;
  --hover: #1c1d21;
  --faint: #4b4c54;
  --input-line: #3b3c44;
  --ring: rgba(244, 244, 245, 0.2);
  --bar: rgba(22, 23, 26, 0.96);
  --skel-a: #202126;
  --skel-b: #2b2c32;
  --err: #fda29b;
  --err-bg: #2a1513;
  --err-bd: #5c2620;
  --warn: #fec84b;
  --warn-bg: #2b2210;
  --warn-bd: #5c4513;
  --ok: #6ce9a6;
  --ok-bg: #10281d;
  --demo-fg: #d9ccff;
  --demo-bg: #231a3d;
  --demo-bd: #43347a;
  --shadow: rgba(0, 0, 0, 0.4);
  --focus: #9db0ff;
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
.bk-lang { display: flex; padding: 2px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
.bk-lang button {
  min-width: 44px; min-height: 32px; padding: 0 8px; color: var(--muted);
  border: 0; border-radius: 6px; background: transparent; font-size: 13px; font-weight: 600; cursor: pointer;
}
.bk-lang button.active { color: var(--on-ink); background: var(--ink); }
.bk-demo {
  max-width: 960px; margin: 4px auto 0; padding: 10px 14px; display: flex; flex-wrap: wrap; gap: 4px 12px;
  color: var(--demo-fg); border: 1px solid var(--demo-bd); border-radius: 10px; background: var(--demo-bg);
}
.bk-main { width: 100%; max-width: 960px; margin: 0 auto; padding: 24px 20px 56px; flex: 1; }
.bk-footer { padding: 0 20px 32px; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--soft); font-size: 13px; }

/* ---- shared ---- */
.bk-card { border: 1px solid var(--line); border-radius: 12px; background: var(--card); }
.bk-avatar {
  width: 24px; height: 24px; flex: none; display: grid; place-items: center; object-fit: cover;
  color: var(--on-ink); border-radius: 50%; background: var(--ink); font-size: 13px; font-weight: 700;
}
.bk-avatar.big { width: 72px; height: 72px; font-size: 28px; }
.bk-btn {
  min-height: 40px; padding: 0 16px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  color: var(--ink); border: 1px solid var(--line); border-radius: 8px; background: var(--card);
  font: inherit; font-weight: 600; text-decoration: none; cursor: pointer;
}
.bk-btn:hover:not(:disabled) { background: var(--line-soft); }
.bk-btn.primary { color: var(--on-ink); border-color: var(--ink); background: var(--ink); }
.bk-btn.primary:hover:not(:disabled) { background: var(--ink-hover); }
.bk-btn.wide { width: 100%; }
.bk-btn.small { min-height: 32px; padding: 0 12px; font-size: 13px; }
.bk-btn:disabled { color: var(--soft); border-color: var(--line); background: var(--line); cursor: not-allowed; }
.bk-skel {
  display: block; border-radius: 6px; background: linear-gradient(100deg, var(--skel-a) 30%, var(--skel-b) 50%, var(--skel-a) 70%); background-size: 220% 100%;
}
.bk-skel-line { height: 14px; width: 60%; }
.bk-skel-line.wide { width: 85%; }
.bk-skel-line.short { width: 35%; }
.bk-skel-avatar { width: 56px; height: 56px; border-radius: 50%; }
.bk-skel-slot { height: 40px; border-radius: 8px; }
.bk-skel-slot.compact { height: 36px; }
.bk-skel-card { margin-bottom: 16px; padding: 24px; display: grid; gap: 12px; }
.bk-loading { max-width: 640px; margin: 0 auto; }
.bk-state { max-width: 520px; margin: 80px auto; text-align: center; display: grid; justify-items: center; gap: 10px; }
.bk-state h1 { font-family: var(--display); font-size: 24px; font-weight: 650; letter-spacing: -0.03em; }
.bk-state p { color: var(--muted); }
.bk-state-symbol { width: 44px; height: 44px; display: grid; place-items: center; color: var(--err); border-radius: 50%; background: var(--err-bg); font-size: 20px; font-weight: 800; }
.bk-banner { max-width: 640px; margin: 0 auto 12px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--err-bd); background: var(--err-bg); color: var(--err); }
.bk-banner.banner-slot, .bk-banner.banner-retry { color: var(--warn); border-color: var(--warn-bd); background: var(--warn-bg); }
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
.bk-search { position: relative; margin: 8px 16px 4px; }
.bk-search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.bk-search .bk-input { padding-left: 34px; }
.bk-group { padding: 14px 24px 6px; color: var(--ink); font-size: 13px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; border-top: 1px solid var(--line-soft); }
.bk-services-title + .bk-group, .bk-search + .bk-group, .bk-search + p + .bk-group { border-top: 0; }
.bk-nomatch { padding: 20px 24px; color: var(--muted); }
.bk-service {
  width: 100%; padding: 16px 24px; display: grid; gap: 6px; text-align: left; color: var(--ink);
  border: 0; border-top: 1px solid var(--line-soft); background: transparent; font: inherit; cursor: pointer;
}
.bk-services li:first-child > .bk-service { border-top: 0; }
.bk-services > ul:last-child li:last-child > .bk-service:last-child { border-radius: 0 0 12px 12px; }
.bk-service:hover { background: var(--hover); }
.bk-service-name { font-size: 15px; font-weight: 650; }
.bk-service-desc {
  max-width: 62ch; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.bk-service-prep { max-width: 62ch; color: var(--body); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bk-chips { margin-top: 2px; display: flex; flex-wrap: wrap; gap: 6px; }
.bk-chip {
  min-height: 24px; padding: 0 8px; display: inline-flex; align-items: center; gap: 4px;
  color: var(--body); border-radius: 6px; background: var(--surface); font-size: 13px; font-weight: 600;
}
.bk-team { padding: 4px 24px 14px; display: grid; gap: 6px; }
.bk-pro {
  min-height: 44px; padding: 0 12px; display: flex; align-items: center; gap: 10px; text-align: left; color: var(--ink);
  border: 1px solid var(--line); border-radius: 10px; background: var(--card); font: inherit; font-weight: 600; cursor: pointer;
}
.bk-pro:hover { border-color: var(--ink); }
.bk-pro-price { margin-left: auto; color: var(--muted); font-weight: 500; }
.bk-empty { padding: 40px 24px; display: grid; justify-items: center; gap: 6px; color: var(--muted); text-align: center; }
.bk-empty h2 { color: var(--ink); font-size: 16px; }

/* ---- scheduler ---- */
.bk-book { max-width: 940px; margin: 0 auto; }
.bk-grid { display: grid; grid-template-columns: 250px minmax(0, 1fr); min-height: 468px; overflow: hidden; box-shadow: 0 1px 2px var(--shadow); }
.bk-info { position: relative; z-index: 3; padding: 24px; border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; min-width: 0; }
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
.bk-meta small { display: block; color: var(--muted); font-size: 13px; font-weight: 500; }
.bk-meta-note { color: var(--muted); font-weight: 500; font-size: 13px; padding-left: 25px; }
.bk-meta-when { color: var(--ink); }

/* time zone picker */
.bk-tz { position: relative; margin-top: auto; padding-top: 14px; }
.bk-tz-btn {
  max-width: 100%; min-height: 32px; margin-left: -6px; padding: 0 6px; display: inline-flex; align-items: center; gap: 8px; text-align: left;
  color: var(--body); border: 1px solid transparent; border-radius: 6px; background: transparent; font: inherit; font-weight: 600; cursor: pointer;
}
.bk-tz-btn:hover:not(:disabled), .bk-tz-btn[aria-expanded='true'] { background: var(--line-soft); }
.bk-tz-btn > svg { flex: none; color: var(--muted); }
.bk-tz-btn span { min-width: 0; overflow-wrap: anywhere; }
.bk-tz-pop {
  position: absolute; z-index: 20; left: 0; bottom: calc(100% - 8px); width: min(320px, calc(100vw - 48px)); padding: 8px; display: grid; gap: 6px;
  border: 1px solid var(--line); border-radius: 12px; background: var(--card); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}
.bk-tz-pop ul { max-height: 220px; overflow-y: auto; scrollbar-width: thin; }
.bk-tz-pop li { padding: 8px 10px; display: flex; justify-content: space-between; gap: 8px; border-radius: 8px; color: var(--body); font-weight: 500; cursor: pointer; }
.bk-tz-pop li.active { background: var(--line-soft); color: var(--ink); }
.bk-tz-pop li.current span { font-weight: 700; }
.bk-tz-pop li small { flex: none; color: var(--muted); }
.bk-tz-none { color: var(--muted); cursor: default !important; }

/* view bar: range heading + nav on the left, view switcher on the right */
.bk-schedule { display: grid; grid-template-columns: minmax(0, 1fr) 216px; grid-template-rows: auto 1fr; min-width: 0; }
.bk-schedule.dv-week, .bk-schedule.dv-column { grid-template-columns: minmax(0, 1fr); }
.bk-viewbar { grid-column: 1 / -1; padding: 16px 20px 0 24px; min-height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.bk-calendar-status { grid-column: 1 / -1; margin: 8px 20px 0 24px; color: var(--muted); font-size: 13px; }
.bk-calendar-status.warning { padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--warn); border: 1px solid var(--warn-bd); border-radius: 8px; background: var(--warn-bg); }
.bk-calendar-status.details { margin: 12px 0 0; }
.bk-range { min-width: 0; display: flex; align-items: center; gap: 10px; }
.bk-range h3, .bk-sheet-bar h3 { font-size: 15px; text-transform: capitalize; }
.bk-range h3 span, .bk-sheet-bar h3 span { color: var(--muted); font-weight: 500; }
.bk-switch { display: flex; padding: 2px; border-radius: 8px; background: var(--surface); }
.bk-switch button {
  min-height: 30px; padding: 0 12px; color: var(--muted); border: 0; border-radius: 6px; background: transparent;
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
}
.bk-switch button.active { color: var(--ink); background: var(--card); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14); }
.bk-calendar { grid-column: 1; padding: 12px 24px 24px; min-width: 0; }
.bk-cal-nav { display: flex; gap: 4px; }
.bk-cal-nav button {
  width: 36px; height: 36px; display: grid; place-items: center; color: var(--ink); border: 0; border-radius: 8px; background: transparent; cursor: pointer;
}
.bk-cal-nav button:hover:not(:disabled) { background: var(--line-soft); }
.bk-cal-nav button:disabled { color: var(--faint); cursor: not-allowed; }
.bk-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; transition: opacity 0.15s ease; }
.bk-days.loading { opacity: 0.5; pointer-events: none; }
.bk-weekdays { margin-bottom: 6px; }
.bk-weekdays span { color: var(--muted); font-size: 13px; font-weight: 600; text-align: center; text-transform: uppercase; letter-spacing: 0.04em; }
.bk-day {
  position: relative; height: 44px; color: var(--soft); border: 0; border-radius: 8px; background: transparent;
  font: inherit; font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; cursor: default;
}
.bk-day.open { color: var(--ink); background: var(--surface); font-weight: 600; cursor: pointer; }
.bk-day.open:hover { background: var(--line); }
.bk-day.selected, .bk-day.selected:hover { color: var(--on-ink); background: var(--ink); }
.bk-day.today::after {
  content: ''; position: absolute; left: 50%; bottom: 5px; width: 4px; height: 4px; border-radius: 50%; background: currentColor; transform: translateX(-50%);
}
.bk-day.today:not(.open) { color: var(--ink); }

.bk-slots { grid-column: 2; position: relative; border-left: 1px solid var(--line); min-width: 0; }
.bk-slots-inner { position: absolute; inset: 0; padding: 12px 20px 16px; overflow-y: auto; scrollbar-width: thin; }
.bk-slots-head { margin-bottom: 14px; min-height: 36px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.bk-slots-head h3 { font-size: 15px; font-weight: 500; text-transform: capitalize; }
.bk-slots-head h3 strong { font-weight: 650; }
.bk-clock { display: flex; padding: 2px; border-radius: 8px; background: var(--surface); }
.bk-clock button {
  min-height: 28px; min-width: 36px; padding: 0 8px; color: var(--muted); border: 0; border-radius: 6px; background: transparent;
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
}
.bk-clock button.active { color: var(--ink); background: var(--card); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }
.bk-slot-list { display: grid; gap: 8px; }
.bk-slot {
  min-height: 42px; color: var(--ink); border: 1px solid var(--line); border-radius: 8px; background: var(--card);
  font: inherit; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer;
}
.bk-slot:hover { border-color: var(--ink); }
.bk-slot.picked, .bk-slot.picked:hover { color: var(--on-ink); border-color: var(--ink); background: var(--ink); }
.bk-note { padding: 8px 0; display: grid; justify-items: start; gap: 6px; color: var(--muted); }
.bk-note strong { color: var(--ink); font-size: 14px; }
.bk-note.error { color: var(--err); }
.bk-next {
  min-height: 36px; padding: 6px 12px; display: inline-flex; align-items: center; gap: 8px; text-align: left; line-height: 1.3; color: var(--ink);
  border: 1px solid var(--line); border-radius: 10px; background: var(--surface); font: inherit; font-weight: 600; cursor: pointer;
}
.bk-next:hover { border-color: var(--ink); }

/* week / column views */
.bk-cols { grid-column: 1 / -1; padding: 8px 12px 16px 24px; min-width: 0; }
.bk-cols-scroll {
  height: 372px; padding-right: 12px; display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 8px;
  align-content: start; overflow-y: auto; scrollbar-width: thin;
}
.bk-col { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.bk-col-head {
  position: sticky; top: 0; z-index: 1; padding: 4px 0 8px; display: grid; justify-items: center; background: var(--card);
}
.bk-col-head small { color: var(--muted); font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.bk-col-head strong { font-size: 18px; font-weight: 650; line-height: 1.2; }
.bk-col.past .bk-col-head { opacity: 0.45; }
.bk-slot.compact { min-height: 36px; padding: 0 4px; font-size: 13px; }
.bk-col-none { padding-top: 6px; color: var(--soft); font-size: 13px; text-align: center; }
.bk-cols-note { padding-top: 12px; }

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
  width: 100%; min-height: 40px; padding: 8px 12px; color: var(--ink); border: 1px solid var(--input-line); border-radius: 8px; background: var(--card); font: inherit; box-shadow: none;
}
textarea.bk-input { resize: vertical; min-height: 84px; }
.bk-input::placeholder { color: var(--soft); }
.bk-input:focus { outline: none; border-color: var(--ink); box-shadow: 0 0 0 2px var(--ring); }
.bk-input[aria-invalid='true'] { border-color: var(--err); }
.bk-error { color: var(--err); font-size: 13px; }
.bk-hint { color: var(--muted); font-size: 13px; }
.bk-hint.right { text-align: right; }
.bk-actions { display: flex; justify-content: flex-end; gap: 8px; }
.bk-fine { color: var(--soft); font-size: 13px; }

/* ---- confirmation ---- */
.bk-confirm { max-width: 560px; margin: 24px auto 0; padding: 36px 32px 28px; display: grid; justify-items: center; gap: 8px; text-align: center; }
.bk-confirm h1 { font-family: var(--display); font-size: 24px; font-weight: 650; letter-spacing: -0.035em; }
.bk-confirm h1:focus { outline: none; }
.bk-confirm h1:focus-visible { outline: 2px solid var(--focus); outline-offset: 4px; }
.bk-confirm-check { width: 52px; height: 52px; margin-bottom: 8px; display: grid; place-items: center; color: var(--ok); border-radius: 50%; background: var(--ok-bg); }
.bk-facts { width: 100%; margin: 20px 0 8px; padding-top: 16px; display: grid; gap: 14px; border-top: 1px solid var(--line); text-align: left; }
.bk-facts > div { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; }
.bk-facts dt { color: var(--muted); font-weight: 600; }
.bk-facts dd { font-weight: 600; overflow-wrap: anywhere; }
.bk-facts dd small { display: block; color: var(--muted); font-weight: 500; }
.bk-ref { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.bk-ref code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 15px; user-select: all; }
.bk-confirm-actions { width: 100%; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 4px 0 4px; }
.bk-change { display: grid; justify-items: center; gap: 8px; color: var(--body); }
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
  .bk-day, .bk-slot, .bk-btn, .bk-service, .bk-sd, .bk-next { transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease; }
  .bk-confirm-check svg { stroke-dashoffset: 28; animation: bk-draw 0.4s 0.15s ease-out forwards; }
  .bk-confirm-check { animation: bk-pop 0.3s ease-out; }
  .bk-calendar.is-sheet { animation: bk-sheet 0.22s ease-out; }
  .bk-backdrop { animation: bk-fade-in 0.2s ease; }
}
@keyframes bk-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes bk-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes bk-sheet { from { transform: translateY(100%); } to { transform: none; } }
@keyframes bk-shimmer { from { background-position: 120% 0; } to { background-position: -120% 0; } }
@keyframes bk-draw { to { stroke-dashoffset: 0; } }
@keyframes bk-pop { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }

/* ---- tablet / mobile: info -> slots-first strip -> times; month in a bottom sheet ---- */
@media (max-width: 820px) {
  .bk-header { padding: 0 16px; height: 56px; }
  .bk-secure { display: none; }
  .bk-lang button { min-height: 40px; }
  .bk-back { min-height: 40px; }
  .bk-tz-btn { min-height: 40px; }
  .bk-clock button { min-height: 40px; min-width: 44px; }
  .bk-main { padding: 12px 12px 40px; }
  .bk-grid { grid-template-columns: 1fr; min-height: 0; overflow: visible; }
  .bk-info { padding: 16px 16px 14px; border-right: 0; border-bottom: 1px solid var(--line); }
  .bk-desc { -webkit-line-clamp: 3; line-clamp: 3; }
  .bk-meta { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px 16px; }
  .bk-meta li { min-width: 0; }
  .bk-meta .bk-meta-when, .bk-meta .bk-meta-note { flex: 1 1 100%; }
  .bk-meta-note { padding-left: 0; }
  .bk-tz { margin-top: 6px; padding-top: 0; }
  .bk-tz-pop { bottom: auto; top: calc(100% - 2px); }
  .bk-grid.stage-details .bk-desc { display: none; }
  .bk-schedule { grid-template-columns: 1fr; grid-template-rows: none; }
  .bk-viewbar { padding: 12px 12px 4px 16px; min-height: 52px; }
  .bk-strip { padding: 4px 12px 12px; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
  .bk-sd {
    min-height: 66px; padding: 6px 0; display: grid; justify-items: center; align-content: center; gap: 1px; color: var(--soft);
    border: 1px solid var(--line); border-radius: 10px; background: var(--card); font: inherit; cursor: pointer;
  }
  .bk-sd small { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
  .bk-sd strong { font-size: 16px; font-weight: 650; }
  .bk-sd i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; visibility: hidden; }
  .bk-sd.has { color: var(--ink); background: var(--surface); }
  .bk-sd.has i { visibility: visible; }
  .bk-sd.selected { color: var(--on-ink); border-color: var(--ink); background: var(--ink); }
  .bk-slots { grid-column: 1; border-left: 0; border-top: 1px solid var(--line); }
  .bk-slots-inner { position: static; padding: 16px 16px 24px; overflow: visible; min-height: 220px; }
  .bk-slot-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .bk-slot { min-height: 46px; }
  .bk-continue {
    position: sticky; bottom: 0; z-index: 6; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); display: flex; align-items: center; gap: 12px;
    border-top: 1px solid var(--line); background: var(--bar); backdrop-filter: blur(8px);
  }
  .bk-continue span { min-width: 0; flex: 1; font-weight: 600; }
  .bk-backdrop { position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, 0.45); }
  .bk-calendar.is-sheet {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 41; max-height: 90vh; padding: 12px 16px calc(20px + env(safe-area-inset-bottom)); overflow-y: auto;
    border-radius: 16px 16px 0 0; background: var(--card); box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.25);
  }
  .bk-sheet-bar { margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
  .bk-details { max-width: none; padding: 18px 16px 0; }
  .bk-actions {
    position: sticky; bottom: 0; z-index: 5; margin: 4px -16px 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--line); background: var(--bar); backdrop-filter: blur(8px);
  }
  .bk-actions .bk-btn.primary { flex: 1; }
  .bk-input { min-height: 44px; font-size: 16px; }
  .bk-host { padding: 20px; }
  .bk-services-title, .bk-service, .bk-group, .bk-team { padding-left: 16px; padding-right: 16px; }
  .bk-confirm { padding: 28px 18px 22px; margin-top: 8px; }
  .bk-facts > div { grid-template-columns: 1fr; gap: 2px; }
}
@media (max-width: 380px) {
  .bk-slot-list { grid-template-columns: 1fr; }
}
</style>
