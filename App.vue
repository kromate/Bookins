<script setup lang="ts">

import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from './components/AppIcon.vue'
import BookinsLogo from './components/BookinsLogo.vue'
import ProductTour from './components/ProductTour.vue'
import WorkspaceMenu from './components/WorkspaceMenu.vue'
import CreditsPill from './components/CreditsPill.vue'
import { APPS_URL, loadAccounts, loadCredits, resetShellRuntime } from './components/shell-runtime.ts'

// Owner-only feedback widget: loaded lazily and never on the public /book page.
const GoalmaticFeedback = defineAsyncComponent(() => import('./components/GoalmaticFeedback.vue'))
import { copyText, isActiveBooking, isLocalPreview, loadOwnerWorkspace, messageQueue } from './booking.ts'
import { ownerTimeZone } from './time-display.ts'
import {
  demoSwitchError,
  isDemo,
  liveReturnRoute,
  registerDemoGuard,
  registerModeCommitHandler,
  rememberLiveRoute,
  setDemoMode,
} from './runtime.ts'

const route = useRoute()
// The platform's "Offline preview" notice is only honest on loopback (see global.css).
if (['localhost', '127.0.0.1'].includes(globalThis.location?.hostname))
  document.documentElement.classList.add('bookins-loopback')
const router = useRouter()
const routePending = ref(false)
const pendingPath = ref('')
const navigationError = ref('')
let navigationTimer = 0
const preloadingPages = new Set<string>()
function preloadPage(path: string) {
  if (!path || preloadingPages.has(path) || path === route.path) return Promise.resolve()
  const match = router.resolve(path).matched.at(-1)
  const loader = match?.components?.default
  if (typeof loader !== 'function') return Promise.resolve()
  preloadingPages.add(path)
  return Promise.resolve().then(() => (loader as () => unknown)()).catch(() => { preloadingPages.delete(path) })
}
function preloadFromLink(event: Event) {
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
  if (!link || link.origin !== window.location.origin || link.target === '_blank') return
  void preloadPage(link.pathname)
}
function clearNavigation() {
  window.clearTimeout(navigationTimer)
  routePending.value = false
}
const stopBeforeNavigation = router.beforeEach(to => {
  clearNavigation()
  navigationError.value = ''
  pendingPath.value = to.fullPath
  if (to.path !== route.path) navigationTimer = window.setTimeout(() => { routePending.value = true }, 120)
})
const stopAfterNavigation = router.afterEach(to => {
  if (to.fullPath === pendingPath.value) clearNavigation()
})
const stopNavigationError = router.onError((_error, to) => {
  if (to && to.fullPath !== pendingPath.value) return
  clearNavigation()
  navigationError.value = 'This page could not load. Check your connection and try again.'
})
function retryNavigation() { window.location.assign(router.resolve(pendingPath.value).href) }
onBeforeUnmount(() => { clearNavigation(); stopBeforeNavigation(); stopAfterNavigation(); stopNavigationError() })

const menuOpen = ref(false)
interface ClosableInstance { close(): void }
interface TourInstance { start(): Promise<unknown> | unknown }
interface FeedbackInstance { open(): void }
const sideMenu = ref<ClosableInstance | null>(null)
const closeWorkspaceMenus = () => sideMenu.value?.close?.()
const tour = ref<TourInstance | null>(null)
const feedback = ref<FeedbackInstance | null>(null)
async function openFeedback() {
  await toggleMore(false)
  feedback.value?.open()
}
function focusMain() {
  document.getElementById('main-content')?.focus()
}
// Starts the Live or Demo tour (whichever matches the current mode). Closes every menu first.
async function startTour() {
  closeWorkspaceMenus()
  menuOpen.value = false
  moreOpen.value = false
  modeOpen.value = false
  await nextTick()
  await tour.value?.start()
}
// Read synchronously so the closed drawer is inert from the first render on phones.
const NARROW = '(max-width: 900px)'
const narrowScreen = ref(typeof window !== 'undefined' && Boolean(window.matchMedia?.(NARROW).matches))
let navigationMedia: MediaQueryList | null = null
const updateNavigationMedia = (event: MediaQueryList | MediaQueryListEvent) => { narrowScreen.value = event.matches }
onMounted(() => {
  navigationMedia = window.matchMedia(NARROW)
  updateNavigationMedia(navigationMedia)
  navigationMedia.addEventListener('change', updateNavigationMedia)
})
onBeforeUnmount(() => navigationMedia?.removeEventListener('change', updateNavigationMedia))
// Short desktop windows (such as 1280x720): "Back to Apps" moves into the workspace menu so every page link stays in view.
const SHORT_DESKTOP = '(min-width: 901px) and (max-height: 820px)'
const shortDesktop = ref(typeof window !== 'undefined' && Boolean(window.matchMedia?.(SHORT_DESKTOP).matches))
let shortDesktopMedia: MediaQueryList | null = null
const updateShortDesktop = (event: MediaQueryList | MediaQueryListEvent) => { shortDesktop.value = event.matches }
onMounted(() => {
  shortDesktopMedia = window.matchMedia(SHORT_DESKTOP)
  updateShortDesktop(shortDesktopMedia)
  shortDesktopMedia.addEventListener('change', updateShortDesktop)
})
onBeforeUnmount(() => shortDesktopMedia?.removeEventListener('change', updateShortDesktop))
watch(narrowScreen, narrow => {
  if (!narrow) { moreOpen.value = false; menuOpen.value = false }
})
watch(menuOpen, async open => {
  if (!narrowScreen.value) return
  if (open) moreOpen.value = false
  await nextTick()
  document.querySelector<HTMLElement>(open ? '.sidebar-close' : '.mobile-menu')?.focus()
})
function navigationKeydown(event: KeyboardEvent) {
  if (!narrowScreen.value || !menuOpen.value || event.defaultPrevented) return
  if (event.key === 'Escape') {
    event.preventDefault()
    menuOpen.value = false
    return
  }
  if (event.key !== 'Tab') return
  if (!(event.currentTarget instanceof Element)) return
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button, [tabindex]')]
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length)
  const first = controls[0], last = controls.at(-1)
  if ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first)?.focus()
  }
}
const sessionWarning = ref('')
const savingConnection = ref(false)
const syncSessionWarning = () => { sessionWarning.value = String(window.GoalmaticAuth?.config?.sessionPersistenceWarning || '') }
async function retryRememberConnection() {
  if (savingConnection.value) return
  savingConnection.value = true
  try { await window.GoalmaticAuth?.retrySessionPersistence?.() }
  finally { savingConnection.value = false; syncSessionWarning() }
}
let unsubscribeSessionWarning: (() => void) | void
onMounted(() => {
  syncSessionWarning()
  unsubscribeSessionWarning = window.GoalmaticAuth?.onAuthChange?.(syncSessionWarning)
  window.addEventListener('focus', syncSessionWarning)
})
onBeforeUnmount(() => { unsubscribeSessionWarning?.(); window.removeEventListener('focus', syncSessionWarning) })
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const loadAttempted = ref(false)
const syncFailed = ref(false) // a background refresh failed while older data is still shown
const copied = ref(false)
const accountLabel = ref('Goalmatic workspace')
const userLabel = ref('')
const avatarUrl = ref('')
const transitioning = ref(isDemo.value)
const modeRequesting = ref(false)
const modeActionError = ref('')
const routeKey = computed(() => (isDemo.value ? 'demo' : 'live'))
const state = reactive<WorkspaceState>({ profile: null, schedules: [], services: [], bookings: [], contacts: [], staff: [], campaigns: [] })
const localPreview = isLocalPreview()

const removeLoadingGuard = registerDemoGuard('bookins-workspace-loading', () =>
  loading.value ? 'Wait for the workspace to finish loading before switching.' : '',
)
onBeforeUnmount(removeLoadingGuard)

// Navigation follows the owner's day: run today, then set up, then grow.
interface NavItem { label: string; shortLabel: string; to: string; icon: string }
const dailyNav: NavItem[] = [
  { label: 'Today', shortLabel: 'Today', to: '/', icon: 'today' },
  { label: 'Bookings', shortLabel: 'Bookings', to: '/bookings', icon: 'bookings' },
  { label: 'Messages', shortLabel: 'Messages', to: '/messages', icon: 'messages' },
  { label: 'Clients', shortLabel: 'Clients', to: '/contacts', icon: 'contacts' },
]
const setupNav: NavItem[] = [
  { label: 'Availability', shortLabel: 'Hours', to: '/availability', icon: 'availability' },
  { label: 'Services', shortLabel: 'Services', to: '/services', icon: 'services' },
  { label: 'Team', shortLabel: 'Team', to: '/team', icon: 'team' },
]
const growNav: NavItem[] = [
  { label: 'Campaigns', shortLabel: 'Campaigns', to: '/campaigns', icon: 'campaigns' },
  { label: 'Insights', shortLabel: 'Insights', to: '/insights', icon: 'chart' },
]
const settingsItem: NavItem = { label: 'Settings', shortLabel: 'Settings', to: '/settings', icon: 'settings' }
const navItems = [...dailyNav, ...setupNav, ...growNav, settingsItem]
const mobileNav = dailyNav
const moreNav = [...setupNav, ...growNav, settingsItem]
const isCurrent = (to: string) => (to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`))

const moreOpen = ref(false)
const navigationOverlay = computed(() => narrowScreen.value && (menuOpen.value || moreOpen.value))
let originalBodyOverflow: string | null = null
watch(navigationOverlay, open => {
  if (open) {
    originalBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else if (originalBodyOverflow !== null) {
    document.body.style.overflow = originalBodyOverflow
    originalBodyOverflow = null
  }
})
onBeforeUnmount(() => {
  if (originalBodyOverflow !== null) document.body.style.overflow = originalBodyOverflow
})
const moreCurrent = computed(() => moreNav.some((item) => isCurrent(item.to)) || route.path === '/demo/guest')
async function toggleMore(open = !moreOpen.value) {
  moreOpen.value = open
  await nextTick()
  if (open) {
    menuOpen.value = false
    document.querySelector<HTMLElement>('.more-close')?.focus()
  }
  else document.querySelector<HTMLElement>('.more-button')?.focus()
}
function moreKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    toggleMore(false)
    return
  }
  if (event.key !== 'Tab') return
  if (!(event.currentTarget instanceof Element)) return
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button')]
  const first = controls[0], last = controls.at(-1)
  if ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first)?.focus()
  }
}

// Toasts. `toast(message)` keeps working; options: { kind: 'success'|'error'|'info', duration (ms, 0 = until dismissed),
// action: { label, onClick } }. Errors persist until dismissed and are announced assertively; identical consecutive
// toasts are merged (their timer restarts). Helpers: toast.success / toast.error / toast.info.
interface ToastAction { label: string; onClick(): void }
interface ToastItem { id: number; text: string; kind: 'success' | 'error' | 'info'; action: ToastAction | null }
interface ToastOptions { kind?: ToastItem['kind']; duration?: number; action?: ToastAction }
type ToastFunction = ((message: string, options?: ToastOptions) => number | undefined) & ToastApi & { dismiss(id: number): void }
const toasts = ref<ToastItem[]>([])
const MAX_TOASTS = 2
let toastId = 0
const toastBorn = new Map<number, number>()
const toastTimers = new Map<number, number>()
function dismissToast(id: number) {
  window.clearTimeout(toastTimers.get(id))
  toastTimers.delete(id)
  toastBorn.delete(id)
  toasts.value = toasts.value.filter((item) => item.id !== id)
}
function armToast(id: number, duration: number) {
  window.clearTimeout(toastTimers.get(id))
  if (duration > 0) toastTimers.set(id, window.setTimeout(() => dismissToast(id), duration))
}
const toast = function toast(message: string, options: ToastOptions = {}) {
  const text = String(message || '').trim()
  if (!text) return
  const requestedKind = options.kind
  const kind: ToastItem['kind'] = requestedKind && ['success', 'error', 'info'].includes(requestedKind) ? requestedKind : 'success'
  const duration = typeof options.duration === 'number' && Number.isFinite(options.duration)
    ? options.duration
    : kind === 'error' ? 0 : options.action ? 6000 : 3500
  const action = options.action?.label && typeof options.action.onClick === 'function' ? options.action : null
  const last = toasts.value.at(-1)
  if (last && last.text === text && last.kind === kind && !action && !last.action) {
    armToast(last.id, duration)
    return last.id
  }
  const id = ++toastId
  toastBorn.set(id, Date.now())
  let next = [...toasts.value, { id, text, kind, action }]
  while (next.length > MAX_TOASTS) {
    const drop = next.find((item) => item.kind !== 'error') || next[0]
    if (!drop) break
    window.clearTimeout(toastTimers.get(drop.id))
    toastTimers.delete(drop.id)
    toastBorn.delete(drop.id)
    next = next.filter((item) => item !== drop)
  }
  toasts.value = next
  armToast(id, duration)
  return id
} as ToastFunction
toast.success = (message: string) => { toast(message, { kind: 'success' }) }
toast.error = (message: string) => { toast(message, { kind: 'error' }) }
toast.info = (message: string) => { toast(message, { kind: 'info' }) }
toast.dismiss = dismissToast
// A toast is about the page it was raised on: drop the ones that outlived a navigation. Anything under 1.5s old stays
// (a save that navigates on purpose, such as "Availability saved" -> Services, keeps its message).
function dropStaleToasts() {
  const now = Date.now()
  for (const item of [...toasts.value]) if (now - (toastBorn.get(item.id) || 0) > 1500) dismissToast(item.id)
}
function runToastAction(item: ToastItem) {
  dismissToast(item.id)
  item.action?.onClick()
}
onBeforeUnmount(() => toastTimers.forEach((timer) => window.clearTimeout(timer)))
const politeToasts = computed(() => toasts.value.filter((item) => item.kind !== 'error'))
const errorToasts = computed(() => toasts.value.filter((item) => item.kind === 'error'))
const isPublicRoute = computed(() => route.path === '/book')
const profileName = computed(() => state.profile?.display_name || 'Booking workspace')
const publicUrl = computed(() => state.profile?.public_link_url || '')
const pendingRoutePath = computed(() => pendingPath.value.split('?')[0] || '/')

// ---- Today strip: local time, the next appointment, and messages due (marigold marks what is due) ----
const clockNow = ref(Date.now())
const clockTimer = window.setInterval(() => { clockNow.value = Date.now() }, 30_000)
onBeforeUnmount(() => window.clearInterval(clockTimer))
const workZone = computed(() => ownerTimeZone(state.schedules.find((item) => item?.timezone)?.timezone || state.profile?.timezone))
const startMs = (booking: BookingRecord) => Date.parse(String(booking.starts_at || ''))
const stripClock = computed(() => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: workZone.value }).format(clockNow.value))
const stripDate = computed(() => new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: workZone.value }).format(clockNow.value))
const nextBooking = computed(() => state.bookings
  .filter((item) => isActiveBooking(item) && item.status === 'confirmed' && startMs(item) > clockNow.value)
  .sort((left, right) => startMs(left) - startMs(right))[0] || null)
const dayKeyIn = (value: number) => new Intl.DateTimeFormat('en-CA', { timeZone: workZone.value, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
const nextLabel = computed(() => {
  const booking = nextBooking.value
  if (!booking) return ''
  const start = startMs(booking)
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: workZone.value }).format(start)
  const day = dayKeyIn(start) === dayKeyIn(clockNow.value) ? '' : `${new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: workZone.value }).format(start)} `
  return `${day}${time}`
})
const dueCount = computed(() => {
  if (!loaded.value) return 0
  try {
    return messageQueue(state, { now: clockNow.value, timezone: workZone.value }).due.filter((item) => item.message.enabled !== false).length
  } catch {
    return 0
  }
})

// ---- Mode chip: the one place the shell states Demo or local preview ----
const modeOpen = ref(false)
const modeWrap = ref<HTMLElement | null>(null)
const modeLabel = computed(() => (isDemo.value ? 'Demo, read-only' : localPreview ? 'Sample data' : ''))
function closeModeOnOutside(event: PointerEvent) {
  if (modeOpen.value && event.target instanceof Node && !modeWrap.value?.contains(event.target)) modeOpen.value = false
}

// Menus built on <details data-menu> close on Escape and on a click outside them.
function closeMenus(except: Element | null = null) {
  for (const menu of document.querySelectorAll('details[data-menu][open]')) if (menu !== except) menu.removeAttribute('open')
}
function onDocumentPointer(event: PointerEvent) {
  closeMenus(event.target instanceof Element ? event.target.closest('details[data-menu]') : null)
  closeModeOnOutside(event)
}
function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (modeOpen.value) {
    modeOpen.value = false
    document.querySelector<HTMLElement>('.mode-chip')?.focus()
  }
  const open = document.querySelector('details[data-menu][open]')
  if (!open || document.querySelector('.gm-confirm__pop')) return
  open.removeAttribute('open')
  open.querySelector<HTMLElement>('summary')?.focus()
}
function onMenuClick(event: MouseEvent) {
  // Choosing an item in a menu closes it, except for controls that open a confirmation inside the menu.
  const target = event.target instanceof Element ? event.target : null
  const panel = target?.closest('details[data-menu] .menu-panel')
  if (!panel || target?.closest('.gm-confirm, [data-keep-menu]')) return
  if (target?.closest('a, button')) panel.closest('details')?.removeAttribute('open')
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointer, true)
  document.addEventListener('keydown', onDocumentKeydown)
  document.addEventListener('click', onMenuClick)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointer, true)
  document.removeEventListener('keydown', onDocumentKeydown)
  document.removeEventListener('click', onMenuClick)
})

let inFlight: Promise<boolean> | null = null
let rerun = false
let rerunLoud = false
let lastLoadedAt = 0

// Resolves true when workspace state was reloaded, false when it could not be.
// A call made during a load waits for one more load so callers never read stale state.
// `refresh({ silent: true })` is the background flavour (route change, focus, poll): no spinner, no error banner,
// the current state stays if it fails. Any other call (including a click handler passing an event) is a loud refresh.
function refresh(options?: { silent?: boolean } | Event): Promise<boolean> {
  if (isPublicRoute.value) return Promise.resolve(false)
  const silent = !(options instanceof Event) && options?.silent === true
  if (inFlight) {
    rerun = true
    if (!silent) rerunLoud = true
    return inFlight
  }
  rerunLoud = !silent
  inFlight = (async () => {
    let ok = false
    do {
      rerun = false
      const loud = rerunLoud
      rerunLoud = false
      ok = await loadWorkspace({ silent: !loud })
    } while (rerun)
    return ok
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}

// Background refresh so owners see new guest bookings without clicking Refresh. Never runs in Demo (fixed sample
// data), on /book, while a dialog or the tour is open, or more than once every 10s. Refresh only replaces the shared
// store state; pages keep their own drafts, so typing is never overwritten.
const POLL_MS = 45000
let pollTimer = 0
let lastBackgroundAttempt = 0
function backgroundBusy() {
  return Boolean(document.querySelector('.gm-dialog-overlay, [data-state="open"][role="dialog"]')) || document.body.classList.contains('bookins-tour-open')
}
function backgroundRefresh({ force = false }: { force?: boolean } = {}) {
  if (isDemo.value || isPublicRoute.value || document.visibilityState === 'hidden' || !loaded.value) return
  if (!force && (backgroundBusy() || Date.now() - Math.max(lastLoadedAt, lastBackgroundAttempt) < 10000)) return
  lastBackgroundAttempt = Date.now()
  void refresh({ silent: true })
}
function onVisibility() { if (document.visibilityState === 'visible') backgroundRefresh() }
function onWindowFocus() { backgroundRefresh() }
onMounted(() => {
  window.addEventListener('focus', onWindowFocus)
  document.addEventListener('visibilitychange', onVisibility)
  pollTimer = window.setInterval(() => backgroundRefresh(), POLL_MS)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', onWindowFocus)
  document.removeEventListener('visibilitychange', onVisibility)
  window.clearInterval(pollTimer)
})

// Real page headings while workspace data loads, so the first screen has the page's shape.
const pageIntros: Record<string, { title: string; layout: 'today' | 'split' | 'list' | 'cards' }> = {
  '/': { title: 'Today', layout: 'today' },
  '/services': { title: 'Services', layout: 'list' },
  '/availability': { title: 'Availability', layout: 'split' },
  '/bookings': { title: 'Bookings', layout: 'today' },
  '/messages': { title: 'Messages', layout: 'list' },
  '/insights': { title: 'Insights', layout: 'list' },
  '/team': { title: 'Team', layout: 'list' },
  '/campaigns': { title: 'Campaigns', layout: 'list' },
  '/contacts': { title: 'Clients', layout: 'list' },
  '/settings': { title: 'Settings', layout: 'split' },
}
const pageIntro = computed(
  () => pageIntros[Object.keys(pageIntros).find((path) => path !== '/' && route.path.startsWith(path)) || '/']
    || { title: 'Bookins', layout: 'cards' },
)
const wideRoute = computed(() => ['/', '/bookings'].includes(route.path))

async function loadWorkspace({ silent = false }: { silent?: boolean } = {}) {
  loadAttempted.value = true
  if (!silent) {
    loading.value = true
    error.value = ''
  }
  try {
    // The account label and workspace Tables are independent, so load them together.
    const askUser = !isDemo.value ? window.GoalmaticAuth?.getUser : undefined
    const [userResult, workspace] = await Promise.all([
      askUser ? askUser() : null,
      loadOwnerWorkspace(),
    ])
    const user = userResult && typeof userResult === 'object' ? userResult as UnknownRecord : null
    const account = user?.account && typeof user.account === 'object' ? user.account as UnknownRecord : null
    if (isDemo.value) accountLabel.value = 'Demo workspace'
    else if (askUser) accountLabel.value = String(account?.name || user?.name || 'Goalmatic workspace')
    else if (localPreview) accountLabel.value = 'Sample workspace'
    if (askUser) {
      userLabel.value = String(user?.name || user?.displayName || user?.email || '')
      avatarUrl.value = String(user?.avatar || user?.photoURL || user?.photoUrl || '')
    }
    Object.assign(state, workspace)
    loaded.value = true
    syncFailed.value = false
    lastLoadedAt = Date.now()
    return true
  } catch (reason) {
    if (silent && loaded.value) { syncFailed.value = true; return false }
    error.value = reason instanceof Error ? reason.message : 'Bookins could not load this workspace.'
    return false
  } finally {
    if (!silent) loading.value = false
  }
}

const workspaceBusy = computed(() => modeRequesting.value || loading.value)
// Sidebar status follows the real load state, never a hard-coded "Connected". Demo and local preview are stated once,
// in the top bar's mode chip, so the footer only reports connection problems or the live connection.
const workspaceFailed = computed(() => !loaded.value && !loading.value && loadAttempted.value && !isPublicRoute.value)
const runtimeStatus = computed(() => {
  if (workspaceFailed.value) return { text: 'Could not load workspace', tone: 'error', retry: true }
  if (loading.value && !loaded.value) return { text: isDemo.value ? 'Loading demo…' : 'Connecting…', tone: 'pending', retry: false }
  if (syncFailed.value && !isDemo.value) return { text: 'Could not refresh. Showing last data', tone: 'error', retry: true }
  if (isDemo.value || localPreview) return null
  return { text: 'Connected to Goalmatic', tone: 'live', retry: false }
})
const removeModeCommitHandler = registerModeCommitHandler(() => {
  state.profile = null
  state.schedules = []
  state.services = []
  state.bookings = []
  state.contacts = []
  loaded.value = false
  error.value = ''
  accountLabel.value = isDemo.value ? 'Demo workspace' : 'Goalmatic workspace'
  if (isDemo.value) resetShellRuntime()
  else { void loadAccounts(); void loadCredits() }
  return refresh()
})

onBeforeUnmount(removeModeCommitHandler)

// After the runtime switches the active Goalmatic workspace, drop the old workspace's data and reload.
async function onWorkspaceSwitched() {
  closeWorkspaceMenus()
  menuOpen.value = false
  moreOpen.value = false
  state.profile = null
  state.schedules = []
  state.services = []
  state.bookings = []
  state.contacts = []
  loaded.value = false
  error.value = ''
  void loadCredits()
  await refresh()
  void loadAccounts()
}

async function changeMode(enabled: boolean) {
  if (modeRequesting.value || enabled === isDemo.value) return
  closeWorkspaceMenus()
  menuOpen.value = false
  moreOpen.value = false
  modeOpen.value = false
  modeActionError.value = ''
  if (!isDemo.value) rememberLiveRoute(route.fullPath)
  modeRequesting.value = true
  try {
    const change = setDemoMode(enabled)
    if (isDemo.value === enabled) transitioning.value = true
    const changed = await change
    if (!changed) return
    const destination = enabled ? '/' : liveReturnRoute()
    if (router.currentRoute.value.fullPath !== destination) await router.replace(destination)
  } catch (reason) {
    modeActionError.value = reason instanceof Error ? reason.message : 'The view could not switch modes.'
  } finally {
    modeRequesting.value = false
    transitioning.value = false
  }
}

async function copyPublicLink() {
  if (!publicUrl.value) return
  try {
    await copyText(publicUrl.value)
    copied.value = true
    toast.success('Booking link copied')
    window.setTimeout(() => { copied.value = false }, 1600)
  } catch {
    toast.error('Could not copy the link. Open Settings to copy it manually.')
  }
}

provide('bookingState', state)
provide('refreshBookings', refresh)
provide('localPreview', localPreview)
provide('bookingLoaded', loaded)
provide('toast', toast)
provide('startTour', startTour)
provide('changeMode', changeMode)
let warmupCancelled = false
let warmupHandle = 0
watch(loaded, ready => {
  if (!ready || isPublicRoute.value || navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType || '')) return
  const warm = async () => {
    for (const path of navItems.map(item => item.to)) {
      if (warmupCancelled || document.visibilityState === 'hidden') return
      await preloadPage(path)
    }
  }
  warmupHandle = window.setTimeout(warm, 600)
}, { once: true })
onBeforeUnmount(() => { warmupCancelled = true; window.clearTimeout(warmupHandle) })

watch(
  () => route.path,
  async (path, previous) => {
    menuOpen.value = false
    moreOpen.value = false
    modeOpen.value = false
    closeMenus()
    dropStaleToasts()
    // Returning from /book (or any page change) pulls in bookings made in the meantime.
    if (previous !== undefined) {
      // Arriving from the public /book route (or after a failed load) with no workspace yet: load it now instead of showing an empty page.
      if (!isPublicRoute.value && !loaded.value && !loading.value && !modeRequesting.value) void refresh()
      else backgroundRefresh({ force: previous === '/book' })
      await nextTick()
      if (!route.hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    }
  },
)

// Demo: every disabled control explains itself (pages add richer GmHint text where it matters).
const DEMO_REASON = 'Read-only in Demo. Switch to Live to make changes.'
let demoObserver: MutationObserver | null = null
let demoFrame = 0
function labelDemoControls() {
  demoFrame = 0
  for (const el of document.querySelectorAll<HTMLElement>('#main-content :is(button, input, select, textarea)[disabled], #main-content [aria-disabled="true"]')) {
    if (el.closest('.gm-walkthrough, .gm-hint') || el.hasAttribute('title') || el.hasAttribute('aria-describedby')) continue
    el.setAttribute('title', DEMO_REASON)
    el.dataset.demoTitle = ''
  }
}
function scheduleDemoLabels() { if (!demoFrame) demoFrame = window.requestAnimationFrame(labelDemoControls) }
function syncDemoObserver() {
  demoObserver?.disconnect()
  demoObserver = null
  if (!isDemo.value) {
    for (const el of document.querySelectorAll<HTMLElement>('[data-demo-title]')) { el.removeAttribute('title'); delete el.dataset.demoTitle }
    return
  }
  demoObserver = new MutationObserver(scheduleDemoLabels)
  demoObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled'] })
  scheduleDemoLabels()
}
watch(isDemo, syncDemoObserver)
onMounted(syncDemoObserver)
onBeforeUnmount(() => { demoObserver?.disconnect(); window.cancelAnimationFrame(demoFrame) })

// Scroll cue: rows that scroll sideways (tabs, filters) get `has-more-right` / `has-more-left` so CSS can fade the clipped edge.
const SCROLL_ROWS = '.tab-bar, .segmented, .kind-row, .settings-nav, .period, .day-strip'
let cueFrame = 0
function updateScrollCues() {
  cueFrame = 0
  for (const el of document.querySelectorAll<HTMLElement>(SCROLL_ROWS)) {
    const max = el.scrollWidth - el.clientWidth
    el.classList.toggle('has-more-right', max > 2 && el.scrollLeft < max - 2)
    el.classList.toggle('has-more-left', max > 2 && el.scrollLeft > 2)
  }
}
function scheduleScrollCues() { if (!cueFrame) cueFrame = window.requestAnimationFrame(updateScrollCues) }
function onRowScroll(event: Event) { if (event.target instanceof Element && event.target.matches(SCROLL_ROWS)) scheduleScrollCues() }
let cueObserver: MutationObserver | null = null
onMounted(() => {
  document.addEventListener('scroll', onRowScroll, true)
  window.addEventListener('resize', scheduleScrollCues)
  cueObserver = new MutationObserver(scheduleScrollCues)
  cueObserver.observe(document.body, { subtree: true, childList: true })
  scheduleScrollCues()
})
onBeforeUnmount(() => { cueObserver?.disconnect(); document.removeEventListener('scroll', onRowScroll, true); window.removeEventListener('resize', scheduleScrollCues); window.cancelAnimationFrame(cueFrame) })

// Radix hides everything outside an open dialog from assistive tech; toasts render above dialogs, so keep them exposed.
let toastGuard: MutationObserver | null = null
const toastRegion = ref<HTMLElement | null>(null)
onMounted(() => {
  toastGuard = new MutationObserver(() => {
    const region = toastRegion.value
    if (region?.hasAttribute('aria-hidden')) region.removeAttribute('aria-hidden')
    if (region?.hasAttribute('inert')) region.removeAttribute('inert')
  })
  if (toastRegion.value) toastGuard.observe(toastRegion.value, { attributes: true, attributeFilter: ['aria-hidden', 'inert'] })
})
onBeforeUnmount(() => toastGuard?.disconnect())
onMounted(async () => {
  if (!isPublicRoute.value && !isDemo.value) void loadCredits()
  try {
    await refresh()
  } finally {
    transitioning.value = false
  }
})
</script>

<template>
  <RouterView v-if="isPublicRoute" />
  <div
    v-else
    class="app-shell"
    @pointerover="preloadFromLink"
    @focusin="preloadFromLink"
  >
    <a class="skip-link" href="#main-content" @click.prevent="focusMain">Skip to content</a>
    <aside
      id="app-navigation"
      class="sidebar"
      :class="{ open: menuOpen }"
      :inert="narrowScreen && !menuOpen"
      :aria-hidden="narrowScreen && !menuOpen ? 'true' : undefined"
      :role="narrowScreen && menuOpen ? 'dialog' : undefined"
      :aria-modal="narrowScreen && menuOpen ? 'true' : undefined"
      aria-label="Navigation"
      @keydown="navigationKeydown"
    >
      <div class="sidebar-brand">
        <RouterLink to="/" class="sidebar-identity" aria-label="Bookins, go to Today"><BookinsLogo /></RouterLink>
        <button class="sidebar-close" type="button" aria-label="Close navigation" @click="menuOpen = false"><AppIcon name="close" /></button>
      </div>

      <WorkspaceMenu
        ref="sideMenu"
        id-prefix="sidebar-workspace"
        :label="isDemo ? accountLabel : loaded ? profileName : accountLabel"
        :user-label="accountLabel"
        :avatar-url="avatarUrl"
        :is-demo="isDemo"
        :local-preview="localPreview"
        :busy="workspaceBusy"
        @toggle-mode="changeMode(!isDemo)"
        @switched="onWorkspaceSwitched"
      >
        <RouterLink v-if="isDemo" to="/demo/guest" role="menuitem" class="ws-link" @click="menuOpen = false; closeWorkspaceMenus()">Guest view (sample)</RouterLink>
        <a v-if="shortDesktop" :href="APPS_URL" role="menuitem" class="ws-link" target="_blank" rel="noopener" @click="closeWorkspaceMenus()"><AppIcon name="back" :size="15" /><span class="ws-mode-copy">Back to Apps</span></a>
      </WorkspaceMenu>

      <div class="sidebar-navigation">
        <nav class="side-nav" aria-label="Your day">
          <RouterLink v-for="item in dailyNav" :key="item.to" :to="item.to" :class="{ 'is-current': isCurrent(item.to) }" :aria-current="isCurrent(item.to) ? 'page' : undefined" @click="menuOpen = false">
            <AppIcon :name="item.icon" :size="18" />
            <span>{{ item.label }}</span>
            <span v-if="item.to === '/messages' && dueCount" class="count-pill now" :aria-label="`${dueCount} due`">{{ dueCount }}</span>
          </RouterLink>
        </nav>
        <p id="nav-setup" class="nav-section-label">Set up</p>
        <nav class="side-nav" aria-labelledby="nav-setup">
          <RouterLink v-for="item in setupNav" :key="item.to" :to="item.to" :class="{ 'is-current': isCurrent(item.to) }" :aria-current="isCurrent(item.to) ? 'page' : undefined" @click="menuOpen = false">
            <AppIcon :name="item.icon" :size="18" />
            <span>{{ item.label }}</span>
          </RouterLink>
        </nav>
        <p id="nav-grow" class="nav-section-label">Grow</p>
        <nav class="side-nav" aria-labelledby="nav-grow">
          <RouterLink v-for="item in growNav" :key="item.to" :to="item.to" :class="{ 'is-current': isCurrent(item.to) }" :aria-current="isCurrent(item.to) ? 'page' : undefined" @click="menuOpen = false">
            <AppIcon :name="item.icon" :size="18" />
            <span>{{ item.label }}</span>
          </RouterLink>
        </nav>
      </div>
      <div class="sidebar-footer">
        <div v-if="publicUrl" class="share-row">
          <a :href="publicUrl" target="_blank" rel="noopener noreferrer"><AppIcon name="link" :size="16" /><span class="truncate">Your booking page</span></a>
          <button type="button" :aria-label="copied ? 'Booking link copied' : 'Copy booking link'" :title="copied ? 'Copied' : 'Copy booking link'" @click="copyPublicLink"><AppIcon :name="copied ? 'check' : 'copy'" :size="16" /></button>
          <span class="visually-hidden" role="status">{{ copied ? 'Booking link copied' : '' }}</span>
        </div>
        <CreditsPill v-if="!isDemo" id-prefix="sidebar-credits" />
        <div class="sidebar-links">
          <RouterLink class="sidebar-link" :class="{ 'is-current': isCurrent('/settings') }" to="/settings" :aria-current="isCurrent('/settings') ? 'page' : undefined" @click="menuOpen = false"><AppIcon name="settings" :size="18" />Settings</RouterLink>
          <button class="sidebar-link tour-help-button bookins-walkthrough-trigger" type="button" @click="startTour"><AppIcon name="help" :size="18" />Take a walkthrough</button>
          <a v-if="!shortDesktop" class="sidebar-link" :href="APPS_URL" target="_blank" rel="noopener"><AppIcon name="back" :size="18" />Back to Apps</a>
        </div>
        <div v-if="runtimeStatus" class="runtime-label" :class="`is-${runtimeStatus.tone}`" role="status">
          <span class="runtime-dot" :class="runtimeStatus.tone" aria-hidden="true" />
          <span class="runtime-text">{{ runtimeStatus.text }}</span>
          <button v-if="runtimeStatus.retry" type="button" class="runtime-retry" :disabled="loading" @click="refresh">Retry</button>
        </div>
      </div>
    </aside>

    <button class="sidebar-scrim" :class="{ open: menuOpen }" type="button" aria-label="Close navigation" tabindex="-1" @click="menuOpen = false" />

    <div class="workspace" :inert="navigationOverlay" :aria-hidden="navigationOverlay ? 'true' : undefined">
      <header class="topbar">
        <button
          class="icon-button mobile-menu"
          type="button"
          aria-label="Open navigation"
          aria-controls="app-navigation"
          :aria-expanded="menuOpen"
          @click="menuOpen = true"
        ><AppIcon name="menu" /></button>
        <RouterLink class="mobile-brand" to="/" aria-label="Bookins, go to Today"><BookinsLogo compact /></RouterLink>
        <div class="today-strip" aria-label="Today at a glance">
          <span class="strip-clock"><strong>{{ stripClock }}</strong><span>{{ stripDate }}</span></span>
          <RouterLink v-if="nextBooking" class="strip-item strip-next" :to="{ path: '/bookings', query: { q: nextBooking.reference || nextBooking.guest_name } }">
            <span class="strip-label">Next</span><b>{{ nextLabel }}</b><span class="truncate">{{ nextBooking.guest_name }}</span>
          </RouterLink>
          <RouterLink v-if="dueCount" class="strip-item strip-due" to="/messages">
            <b>{{ dueCount }}</b><span>{{ dueCount === 1 ? 'message' : 'messages' }}<span class="strip-label-short"> due</span></span>
          </RouterLink>
        </div>
        <div class="topbar-actions">
          <div v-if="modeLabel" ref="modeWrap" class="mode-wrap">
            <button class="mode-chip" type="button" :aria-expanded="modeOpen" aria-controls="mode-popover" @click="modeOpen = !modeOpen">
              <AppIcon :name="isDemo ? 'lock' : 'info'" :size="14" />{{ modeLabel }}
            </button>
            <div v-if="modeOpen" id="mode-popover" class="mode-popover" role="region" aria-label="About this workspace">
              <template v-if="isDemo">
                <strong>Demo workspace</strong>
                <p>Fictional sample data. Nothing you change here is saved, and nothing reaches a client.</p>
                <button class="secondary small" type="button" :disabled="workspaceBusy" @click="changeMode(false)">Switch back to Live</button>
              </template>
              <template v-else>
                <strong>Local preview</strong>
                <p>This sample workspace lives in this browser only. Nothing is saved to Goalmatic, and account data and credits are not connected.</p>
              </template>
            </div>
          </div>
          <button
            class="icon-button"
            :class="{ spinning: loading && loaded }"
            type="button"
            :disabled="loading"
            aria-label="Refresh workspace"
            title="Refresh"
            @click="refresh"
          ><AppIcon name="refresh" :size="18" /></button>
        </div>
      </header>

      <div v-if="sessionWarning" class="mode-banner warning" role="status">
        <span>{{ sessionWarning }}</span>
        <button type="button" :disabled="savingConnection" @click="retryRememberConnection">{{ savingConnection ? 'Saving connection…' : 'Retry saving connection' }}</button>
      </div>
      <p v-if="demoSwitchError || modeActionError" role="alert" class="mode-banner error">{{ demoSwitchError || modeActionError }}</p>
      <div v-if="error && loaded" class="mode-banner error" role="alert">
        <span>{{ error }}</span>
        <button type="button" @click="refresh">Try again</button>
      </div>

      <main id="main-content" :class="{ 'is-wide': wideRoute }" tabindex="-1" :aria-busy="loading || transitioning || routePending">
        <div v-if="loading && !loaded" class="page-skeleton">
          <span class="visually-hidden" role="status">Loading your workspace…</span>
          <div class="page-header"><div><h1>{{ pageIntro.title }}</h1></div></div>
          <div v-if="pageIntro.layout === 'today'" class="skeleton-rail" aria-hidden="true"><span class="skeleton-block" /><div class="skeleton-list"><span v-for="index in 4" :key="index" class="skeleton-block" /></div></div>
          <div v-else-if="pageIntro.layout === 'split'" class="skeleton-split" aria-hidden="true"><span class="skeleton-block" /><div class="skeleton-list"><span v-for="index in 3" :key="index" class="skeleton-block" /></div></div>
          <div v-else-if="pageIntro.layout === 'list'" class="skeleton-list" aria-hidden="true"><span v-for="index in 5" :key="index" class="skeleton-block" /></div>
          <div v-else class="skeleton-cards" aria-hidden="true"><span v-for="index in 3" :key="index" class="skeleton-block" /></div>
        </div>
        <div v-else-if="workspaceFailed && !transitioning" class="state-card" role="alert">
          <span class="empty-icon"><AppIcon name="alert" /></span>
          <h1>Bookins could not load</h1>
          <p class="muted">{{ error || 'Bookins could not load this workspace.' }} Check your connection, then try again.</p>
          <button class="primary" type="button" @click="refresh">Try again</button>
        </div>
        <template v-else-if="!transitioning">
          <div v-if="routePending" class="route-loading" role="status" aria-live="polite">
            <h1>{{ pageIntros[pendingRoutePath]?.title || 'Loading page' }}</h1>
            <p>Loading…</p>
            <div class="route-loading-lines" aria-hidden="true"><span /><span /><span /></div>
          </div>
          <div v-if="navigationError" class="notice error" role="alert"><span>{{ navigationError }}</span><button type="button" class="secondary small" @click="retryNavigation">Reload page</button></div>
          <div v-show="!routePending" :inert="routePending"><RouterView v-slot="{ Component }"><component :is="Component" :key="`${routeKey}:${route.path}`" /></RouterView></div>
        </template>
        <p v-if="transitioning" class="mode-transition" role="status">Loading your workspace…</p>
      </main>
      <ProductTour v-if="!transitioning && loaded" ref="tour" />
    </div>

    <nav class="mobile-bottom-nav" :inert="navigationOverlay" aria-label="Main">
      <RouterLink v-for="item in mobileNav" :key="item.to" :to="item.to" :class="{ 'is-current': isCurrent(item.to) }" :aria-current="isCurrent(item.to) ? 'page' : undefined">
        <AppIcon :name="item.icon" :size="20" />
        <small>{{ item.shortLabel }}</small>
        <span v-if="item.to === '/messages' && dueCount" class="count-pill now" :aria-label="`${dueCount} due`">{{ dueCount }}</span>
      </RouterLink>
      <button
        class="more-button tour-help-button bookins-walkthrough-trigger"
        :class="{ 'is-current': moreCurrent || moreOpen }"
        type="button"
        aria-haspopup="dialog"
        :aria-expanded="moreOpen"
        aria-controls="more-sheet"
        @click="toggleMore()"
      >
        <AppIcon name="more" :size="20" />
        <small>More</small>
      </button>
    </nav>

    <template v-if="moreOpen">
      <button class="more-sheet-scrim" type="button" aria-label="Close more menu" tabindex="-1" @click="toggleMore(false)" />
      <div id="more-sheet" class="more-sheet" role="dialog" aria-modal="true" aria-labelledby="more-heading" @keydown="moreKeydown">
        <div class="more-heading"><h2 id="more-heading">More</h2><button class="icon-button more-close" type="button" aria-label="Close more menu" @click="toggleMore(false)"><AppIcon name="close" :size="20" /></button></div>
        <div class="more-sheet-content">
          <nav class="more-pages" aria-label="More pages">
            <RouterLink v-for="item in moreNav" :key="item.to" :to="item.to" :class="{ 'is-current': isCurrent(item.to) }" @click="toggleMore(false)">
              <AppIcon :name="item.icon" :size="18" />{{ item.label }}
            </RouterLink>
          </nav>
          <div v-if="publicUrl" class="share-row">
            <a :href="publicUrl" target="_blank" rel="noopener noreferrer"><AppIcon name="link" :size="16" /><span class="truncate">Your booking page</span></a>
            <button type="button" :aria-label="copied ? 'Booking link copied' : 'Copy booking link'" @click="copyPublicLink"><AppIcon :name="copied ? 'check' : 'copy'" :size="16" /></button>
          </div>
          <section class="more-workspace" aria-labelledby="more-workspace-heading">
            <h2 id="more-workspace-heading">Workspace</h2>
            <WorkspaceMenu
              id-prefix="sheet-workspace"
              :label="isDemo ? accountLabel : loaded ? profileName : accountLabel"
              :user-label="accountLabel"
              :avatar-url="avatarUrl"
              :is-demo="isDemo"
              :local-preview="localPreview"
              :busy="workspaceBusy"
              @toggle-mode="changeMode(!isDemo)"
              @switched="onWorkspaceSwitched"
            >
              <RouterLink v-if="isDemo" to="/demo/guest" role="menuitem" class="ws-link" @click="moreOpen = false">Guest view (sample)</RouterLink>
            </WorkspaceMenu>
            <CreditsPill v-if="!isDemo" id-prefix="sheet-credits" />
          </section>
        </div>
        <footer class="more-sheet-footer" aria-label="Help and account links">
          <button type="button" class="more-walkthrough" @click="startTour"><AppIcon name="help" :size="18" />Take a walkthrough</button>
          <div class="more-footer-links">
            <button type="button" class="more-item" @click="openFeedback"><AppIcon name="messages" :size="17" />Feedback</button>
            <a class="more-item" href="https://goalmatic.io/support" target="_blank" rel="noreferrer" @click="moreOpen = false"><AppIcon name="external" :size="17" />Support</a>
            <a class="more-item" :href="APPS_URL" target="_blank" rel="noopener" @click="moreOpen = false"><AppIcon name="back" :size="17" />Apps</a>
          </div>
        </footer>
      </div>
    </template>

    <div ref="toastRegion" class="toast-region">
      <div aria-live="polite" aria-atomic="false">
        <TransitionGroup name="toast">
          <div v-for="item in politeToasts" :key="item.id" class="toast" :class="item.kind">
            <AppIcon :name="item.kind === 'info' ? 'info' : 'check'" :size="16" />
            <span class="toast-text">{{ item.text }}</span>
            <button v-if="item.action" type="button" class="toast-action" @click="runToastAction(item)">{{ item.action.label }}</button>
            <button type="button" class="toast-dismiss" aria-label="Dismiss notification" @click="dismissToast(item.id)">&times;</button>
          </div>
        </TransitionGroup>
      </div>
      <div aria-live="assertive" aria-atomic="false">
        <TransitionGroup name="toast">
          <div v-for="item in errorToasts" :key="item.id" class="toast error" role="alert">
            <AppIcon name="alert" :size="16" />
            <span class="toast-text">{{ item.text }}</span>
            <button v-if="item.action" type="button" class="toast-action" @click="runToastAction(item)">{{ item.action.label }}</button>
            <button type="button" class="toast-dismiss" aria-label="Dismiss error" @click="dismissToast(item.id)">&times;</button>
          </div>
        </TransitionGroup>
      </div>
    </div>
  </div>

  <GoalmaticFeedback v-if="!isPublicRoute" ref="feedback" />
</template>
