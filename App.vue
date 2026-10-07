<script setup>

import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from './components/AppIcon.vue'
import BookinsLogo from './components/BookinsLogo.vue'
import ProductTour from './components/ProductTour.vue'
import WorkspaceMenu from './components/WorkspaceMenu.vue'
import CreditsPill from './components/CreditsPill.vue'
import { APPS_URL, loadAccounts, loadCredits, resetShellRuntime } from './components/shell-runtime.js'

// Owner-only feedback widget: loaded lazily and never on the public /book page.
const GoalmaticFeedback = defineAsyncComponent(() => import('./components/GoalmaticFeedback.vue'))
import { copyText, isLocalPreview, loadOwnerWorkspace } from './booking.js'
import {
  demoSwitchError,
  isDemo,
  liveReturnRoute,
  registerDemoGuard,
  registerModeCommitHandler,
  rememberLiveRoute,
  setDemoMode,
} from './runtime.js'

const route = useRoute()
// The "Offline preview" runtime notice is only shown on loopback (see global.css).
if (['localhost', '127.0.0.1'].includes(globalThis.location?.hostname))
  document.documentElement.classList.add('bookins-loopback')
const router = useRouter()
const menuOpen = ref(false)
const sideMenu = ref(null)
const closeWorkspaceMenus = () => sideMenu.value?.close?.()
const tour = ref(null)
function focusMain() {
  document.getElementById('main-content')?.focus()
}
// Starts the Live or Demo tour (whichever matches the current mode). Closes every menu first.
async function startTour() {
  closeWorkspaceMenus()
  menuOpen.value = false
  moreOpen.value = false
  await nextTick()
  await tour.value?.start()
}
const narrowScreen = ref(false)
let navigationMedia
const updateNavigationMedia = event => { narrowScreen.value = event.matches }
onMounted(() => {
  navigationMedia = window.matchMedia('(max-width: 900px)')
  updateNavigationMedia(navigationMedia)
  navigationMedia.addEventListener('change', updateNavigationMedia)
})
onBeforeUnmount(() => navigationMedia?.removeEventListener('change', updateNavigationMedia))
watch(narrowScreen, narrow => { if (!narrow) moreOpen.value = false })
watch(menuOpen, async open => {
  if (!narrowScreen.value) return
  await nextTick()
  document.querySelector(open ? '.sidebar-close' : '.mobile-menu')?.focus()
})
function navigationKeydown(event) {
  if (!narrowScreen.value || !menuOpen.value || event.defaultPrevented) return
  if (event.key === 'Escape') {
    event.preventDefault()
    menuOpen.value = false
    return
  }
  if (event.key !== 'Tab') return
  const controls = [...event.currentTarget.querySelectorAll('a[href], button, [tabindex]')]
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length)
  const first = controls[0], last = controls.at(-1)
  if ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first)?.focus()
  }
}
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
const state = reactive({ profile: null, schedules: [], services: [], bookings: [], contacts: [] })
const localPreview = isLocalPreview()

const removeLoadingGuard = registerDemoGuard('bookins-workspace-loading', () =>
  loading.value ? 'Wait for the workspace to finish loading before switching.' : '',
)
onBeforeUnmount(removeLoadingGuard)

const navItems = [
  { label: 'Overview', shortLabel: 'Home', to: '/', icon: 'dashboard', section: 'WORKSPACE' },
  {
    label: 'Services',
    shortLabel: 'Services',
    to: '/services',
    icon: 'services',
    section: 'WORKSPACE',
  },
  {
    label: 'Availability',
    shortLabel: 'Hours',
    to: '/availability',
    icon: 'availability',
    section: 'WORKSPACE',
  },
  {
    label: 'Bookings',
    shortLabel: 'Bookings',
    to: '/bookings',
    icon: 'bookings',
    section: 'WORKSPACE',
  },
  {
    label: 'Messages',
    shortLabel: 'Messages',
    to: '/messages',
    icon: 'messages',
    section: 'WORKSPACE',
  },
  {
    label: 'Insights',
    shortLabel: 'Insights',
    to: '/insights',
    icon: 'sparkle',
    section: 'WORKSPACE',
  },
  {
    label: 'Team',
    shortLabel: 'Team',
    to: '/team',
    icon: 'team',
    section: 'MANAGE',
  },
  {
    label: 'Campaigns',
    shortLabel: 'Campaigns',
    to: '/campaigns',
    icon: 'campaigns',
    section: 'MANAGE',
  },
  {
    label: 'Contacts',
    shortLabel: 'Contacts',
    to: '/contacts',
    icon: 'contacts',
    section: 'MANAGE',
  },
  {
    label: 'Settings',
    shortLabel: 'Settings',
    to: '/settings',
    icon: 'settings',
    section: 'MANAGE',
  },
]

const primaryNav = navItems.filter((item) => item.section === 'WORKSPACE')
const manageNav = navItems.filter((item) => item.section === 'MANAGE')
const mobileNav = navItems.filter((item) => ['/', '/services', '/availability', '/bookings'].includes(item.to))
const moreNav = navItems.filter((item) => !mobileNav.includes(item))
const moreOpen = ref(false)
const moreCurrent = computed(() => moreNav.some((item) => route.path.startsWith(item.to)))
async function toggleMore(open = !moreOpen.value) {
  moreOpen.value = open
  await nextTick()
  if (open) document.querySelector('.more-sheet .more-item, .more-sheet a')?.focus()
  else document.querySelector('.more-button')?.focus()
}
function moreKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    toggleMore(false)
    return
  }
  if (event.key !== 'Tab') return
  const controls = [...event.currentTarget.querySelectorAll('a[href], button')]
  const first = controls[0], last = controls.at(-1)
  if ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first)?.focus()
  }
}

// Toasts. `toast(message)` keeps working; options: { kind: 'success'|'error'|'info', duration (ms, 0 = until dismissed),
// action: { label, onClick } }. Errors persist until dismissed and are announced assertively; identical consecutive
// toasts are merged (their timer restarts). Helpers: toast.success / toast.error / toast.info.
const toasts = ref([])
const MAX_TOASTS = 2
let toastId = 0
const toastBorn = new Map()
const toastTimers = new Map()
function dismissToast(id) {
  window.clearTimeout(toastTimers.get(id))
  toastTimers.delete(id)
  toastBorn.delete(id)
  toasts.value = toasts.value.filter((item) => item.id !== id)
}
function armToast(id, duration) {
  window.clearTimeout(toastTimers.get(id))
  if (duration > 0) toastTimers.set(id, window.setTimeout(() => dismissToast(id), duration))
}
function toast(message, options = {}) {
  const text = String(message || '').trim()
  if (!text) return
  const kind = ['success', 'error', 'info'].includes(options.kind) ? options.kind : 'success'
  const duration = Number.isFinite(options.duration) ? options.duration : kind === 'error' ? 0 : options.action ? 6000 : 3500
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
    window.clearTimeout(toastTimers.get(drop.id))
    toastTimers.delete(drop.id)
    toastBorn.delete(drop.id)
    next = next.filter((item) => item !== drop)
  }
  toasts.value = next
  armToast(id, duration)
  return id
}
for (const kind of ['success', 'error', 'info']) toast[kind] = (message, options = {}) => toast(message, { ...options, kind })
toast.dismiss = dismissToast
// A toast is about the page it was raised on: drop the ones that outlived a navigation. Anything under 1.5s old stays
// (a save that navigates on purpose, such as "Availability saved" -> Services, keeps its message).
function dropStaleToasts() {
  const now = Date.now()
  for (const item of [...toasts.value]) if (now - (toastBorn.get(item.id) || 0) > 1500) dismissToast(item.id)
}
function runToastAction(item) {
  dismissToast(item.id)
  item.action.onClick()
}
onBeforeUnmount(() => toastTimers.forEach((timer) => window.clearTimeout(timer)))
const politeToasts = computed(() => toasts.value.filter((item) => item.kind !== 'error'))
const errorToasts = computed(() => toasts.value.filter((item) => item.kind === 'error'))
const isPublicRoute = computed(() => route.path === '/book')
const profileName = computed(() => state.profile?.display_name || 'Booking workspace')
const initials = computed(
  () =>
    profileName.value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'B',
)
const timezoneLabel = computed(() => state.profile?.timezone || state.schedules.find(item => item?.timezone)?.timezone || '')
const publicUrl = computed(() => state.profile?.public_link_url || '')
const currentPage = computed(
  () =>
    route.path === '/demo/guest'
      ? { label: 'Guest preview' }
      : navItems.find((item) =>
      item.to === '/' ? route.path === '/' : route.path.startsWith(item.to),
        ) || navItems[0],
)

let inFlight = null
let rerun = false
let rerunLoud = false
let lastLoadedAt = 0

// Resolves true when workspace state was reloaded, false when it could not be.
// A call made during a load waits for one more load so callers never read stale state.
// `refresh({ silent: true })` is the background flavour (route change, focus, poll): no spinner, no error banner,
// the current state stays if it fails. Any other call (including a click handler passing an event) is a loud refresh.
function refresh(options) {
  if (isPublicRoute.value) return Promise.resolve(false)
  const silent = options?.silent === true
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
function backgroundBusy() {
  return Boolean(document.querySelector('.gm-dialog-overlay, [data-state="open"][role="dialog"]')) || document.body.classList.contains('bookins-tour-open')
}
function backgroundRefresh({ force = false } = {}) {
  if (isDemo.value || isPublicRoute.value || document.visibilityState === 'hidden' || !loaded.value) return
  if (!force && (backgroundBusy() || Date.now() - lastLoadedAt < 10000)) return
  void refresh({ silent: true })
}
function onVisibility() { if (document.visibilityState === 'visible') backgroundRefresh() }
onMounted(() => {
  window.addEventListener('focus', backgroundRefresh)
  document.addEventListener('visibilitychange', onVisibility)
  pollTimer = window.setInterval(backgroundRefresh, POLL_MS)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', backgroundRefresh)
  document.removeEventListener('visibilitychange', onVisibility)
  window.clearInterval(pollTimer)
})

// Real page headings while workspace data loads, so the first screen has the page's shape.
const pageIntros = {
  '/': { eyebrow: 'Workspace overview', title: 'Overview', layout: 'overview' },
  '/services': { eyebrow: 'Your offerings', title: 'Services', layout: 'cards' },
  '/availability': { eyebrow: 'Working hours', title: 'Availability', layout: 'split' },
  '/bookings': { eyebrow: 'Appointments', title: 'Bookings', layout: 'list' },
  '/messages': { eyebrow: 'Client messages', title: 'Messages', layout: 'list' },
  '/insights': { eyebrow: 'Performance', title: 'Insights', layout: 'overview' },
  '/team': { eyebrow: 'Your people', title: 'Team', layout: 'cards' },
  '/campaigns': { eyebrow: 'Win clients back', title: 'Campaigns', layout: 'list' },
  '/contacts': { eyebrow: 'Clients', title: 'Contacts', layout: 'list' },
  '/settings': { eyebrow: 'Configuration', title: 'Settings', layout: 'split' },
}
const pageIntro = computed(
  () => pageIntros[Object.keys(pageIntros).find((path) => path !== '/' && route.path.startsWith(path)) || '/'],
)

async function loadWorkspace({ silent = false } = {}) {
  loadAttempted.value = true
  if (!silent) {
    loading.value = true
    error.value = ''
  }
  try {
    // The account label and workspace Tables are independent, so load them together.
    const askUser = !isDemo.value && window.GoalmaticAuth?.getUser
    const [user, workspace] = await Promise.all([
      askUser ? window.GoalmaticAuth.getUser() : null,
      loadOwnerWorkspace(),
    ])
    if (isDemo.value) accountLabel.value = 'Demo workspace'
    else if (askUser) accountLabel.value = user?.account?.name || user?.name || 'Goalmatic workspace'
    else if (localPreview) accountLabel.value = 'Sample workspace'
    if (askUser) {
      userLabel.value = user?.name || user?.displayName || user?.email || ''
      avatarUrl.value = user?.avatar || user?.photoURL || user?.photoUrl || ''
    }
    Object.assign(state, workspace)
    loaded.value = true
    syncFailed.value = false
    lastLoadedAt = Date.now()
    return true
  } catch (reason) {
    if (silent && loaded.value) { syncFailed.value = true; return false }
    error.value = reason?.message || 'Bookins could not load this workspace.'
    return false
  } finally {
    if (!silent) loading.value = false
  }
}

const workspaceBusy = computed(() => modeRequesting.value || loading.value)
// Sidebar status follows the real load state, never a hard-coded "Connected".
const workspaceFailed = computed(() => !loaded.value && !loading.value && loadAttempted.value && !isPublicRoute.value)
const runtimeStatus = computed(() => {
  if (workspaceFailed.value) return { text: 'Could not load workspace', tone: 'error', retry: true }
  if (loading.value && !loaded.value) return { text: isDemo.value ? 'Loading demo…' : 'Connecting…', tone: 'pending', retry: false }
  if (syncFailed.value && !isDemo.value) return { text: 'Could not refresh. Showing last data', tone: 'error', retry: true }
  if (isDemo.value) return { text: 'Demo · read-only', tone: 'idle', retry: false }
  if (localPreview) return { text: 'Local sample data', tone: 'idle', retry: false }
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

async function changeMode(enabled) {
  if (modeRequesting.value || enabled === isDemo.value) return
  closeWorkspaceMenus()
  menuOpen.value = false
  moreOpen.value = false
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
    modeActionError.value = reason?.message || 'The view could not switch modes.'
  } finally {
    modeRequesting.value = false
    transitioning.value = false
  }
}

async function copyPublicLink() {
  if (!publicUrl.value) return
  await copyText(publicUrl.value)
  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 1600)
}

provide('bookingState', state)
provide('refreshBookings', refresh)
provide('localPreview', localPreview)
provide('bookingLoaded', loaded)
provide('toast', toast)
provide('startTour', startTour)

watch(
  () => route.path,
  (path, previous) => {
    menuOpen.value = false
    moreOpen.value = false
    dropStaleToasts()
    // Returning from /book (or any page change) pulls in bookings made in the meantime.
    if (previous !== undefined) {
      // Arriving from the public /book route (or after a failed load) with no workspace yet: load it now instead of showing an empty page.
      if (!isPublicRoute.value && !loaded.value && !loading.value && !modeRequesting.value) void refresh()
      else backgroundRefresh({ force: true })
    }
  },
)

// Demo: every disabled control explains itself (pages add richer GmHint text where it matters).
const DEMO_REASON = 'Read-only in Demo. Switch to Live to make changes.'
let demoObserver = null
let demoFrame = 0
function labelDemoControls() {
  demoFrame = 0
  for (const el of document.querySelectorAll('#main-content :is(button, input, select, textarea)[disabled], #main-content [aria-disabled="true"]')) {
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
    for (const el of document.querySelectorAll('[data-demo-title]')) { el.removeAttribute('title'); delete el.dataset.demoTitle }
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
const SCROLL_ROWS = '.tab-bar, .segmented, .kind-row, .settings-nav, .period'
let cueFrame = 0
function updateScrollCues() {
  cueFrame = 0
  for (const el of document.querySelectorAll(SCROLL_ROWS)) {
    const max = el.scrollWidth - el.clientWidth
    el.classList.toggle('has-more-right', max > 2 && el.scrollLeft < max - 2)
    el.classList.toggle('has-more-left', max > 2 && el.scrollLeft > 2)
  }
}
function scheduleScrollCues() { if (!cueFrame) cueFrame = window.requestAnimationFrame(updateScrollCues) }
let cueObserver = null
onMounted(() => {
  document.addEventListener('scroll', event => { if (event.target instanceof Element && event.target.matches(SCROLL_ROWS)) scheduleScrollCues() }, true)
  window.addEventListener('resize', scheduleScrollCues)
  cueObserver = new MutationObserver(scheduleScrollCues)
  cueObserver.observe(document.body, { subtree: true, childList: true })
  scheduleScrollCues()
})
onBeforeUnmount(() => { cueObserver?.disconnect(); window.removeEventListener('resize', scheduleScrollCues); window.cancelAnimationFrame(cueFrame) })

// Radix hides everything outside an open dialog from assistive tech; toasts render above dialogs, so keep them exposed.
let toastGuard = null
const toastRegion = ref(null)
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
  >
    <a class="skip-link" href="#main-content" @click.prevent="focusMain">Skip to content</a>
    <aside
      class="sidebar"
      :class="{ open: menuOpen }"
      :inert="narrowScreen && !menuOpen"
      :aria-hidden="narrowScreen && !menuOpen ? 'true' : undefined"
      :role="narrowScreen ? 'dialog' : undefined"
      :aria-modal="narrowScreen && menuOpen ? 'true' : undefined"
      aria-label="Navigation"
      @keydown="navigationKeydown"
    >
      <div class="sidebar-brand">
        <RouterLink
          to="/"
          aria-label="Bookins home"
          ><BookinsLogo
        /></RouterLink>
        <button
          class="sidebar-close"
          type="button"
          aria-label="Close navigation"
          @click="menuOpen = false"
          ><AppIcon name="close"
        /></button>
      </div>

      <WorkspaceMenu
        ref="sideMenu"
        id-prefix="sidebar-workspace"
        :label="accountLabel"
        :user-label="userLabel"
        :avatar-url="avatarUrl"
        :is-demo="isDemo"
        :local-preview="localPreview"
        :busy="workspaceBusy"
        @toggle-mode="changeMode(!isDemo)"
        @switched="onWorkspaceSwitched"
      >
        <RouterLink v-if="isDemo" to="/demo/guest" role="menuitem" class="ws-link" @click="menuOpen = false; closeWorkspaceMenus()">Guest preview</RouterLink>
      </WorkspaceMenu>

      <p class="nav-section-label">WORKSPACE</p>
      <nav
        class="side-nav"
        aria-label="Primary navigation"
      >
        <RouterLink
          v-for="item in primaryNav"
          :key="item.to"
          :to="item.to"
        >
          <AppIcon
            :name="item.icon"
            :size="18"
          />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-divider" />
      <p class="nav-section-label">MANAGE</p>
      <nav
        class="side-nav"
        aria-label="Management navigation"
      >
        <RouterLink
          v-for="item in manageNav"
          :key="item.to"
          :to="item.to"
        >
          <AppIcon
            :name="item.icon"
            :size="18"
          />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-spacer" />
      <div class="sidebar-footer">
        <div
          v-if="publicUrl"
          class="share-card"
        >
          <div class="share-card-header">
            <AppIcon
              name="link"
              :size="15"
            /><strong>Booking link</strong>
            <div class="share-card-actions">
              <button
                type="button"
                :aria-label="copied ? 'Booking link copied' : 'Copy booking link'"
                :title="copied ? 'Copied' : 'Copy booking link'"
                @click="copyPublicLink"
                ><AppIcon
                  :name="copied ? 'check' : 'copy'"
                  :size="14"
                /></button
              >
              <a
                :href="publicUrl"
                target="_blank"
                rel="noreferrer"
                aria-label="Open booking page"
                title="Open booking page"
                ><AppIcon
                  name="external"
                  :size="14"
                /></a
              >
            </div>
          </div>
          <p>{{ publicUrl }}</p>
          <span class="visually-hidden" role="status">{{ copied ? 'Booking link copied' : '' }}</span>
        </div>
        <CreditsPill v-if="!isDemo" id-prefix="sidebar-credits" />
        <div class="sidebar-links">
          <button
            class="sidebar-link"
            type="button"
            data-tour="tour-help-button"
            data-bookins-walkthrough-trigger
            @click="startTour"
          ><AppIcon name="help" :size="17" />Take a walkthrough</button>
          <a class="sidebar-link" :href="APPS_URL" target="_blank" rel="noopener"><AppIcon name="back" :size="17" />Back to Apps</a>
        </div>
        <div class="runtime-label" :class="`is-${runtimeStatus.tone}`" role="status"
          ><span
            class="runtime-dot"
            :class="runtimeStatus.tone"
          /><span class="runtime-text">{{ runtimeStatus.text }}</span
          ><button
            v-if="runtimeStatus.retry"
            type="button"
            class="runtime-retry"
            :disabled="loading"
            @click="refresh"
          >Retry</button
        ></div
        >
      </div>
    </aside>

    <button
      class="sidebar-scrim"
      :class="{ open: menuOpen }"
      type="button"
      aria-label="Close navigation"
      @click="menuOpen = false"
    />

    <div class="workspace" :inert="narrowScreen && menuOpen" :aria-hidden="narrowScreen && menuOpen ? 'true' : undefined">
      <header class="topbar">
        <div class="topbar-actions">
          <button
            class="icon-button mobile-menu"
            type="button"
            aria-label="Open navigation"
            @click="menuOpen = true"
            ><AppIcon name="menu"
          /></button>
          <RouterLink
            class="mobile-brand"
            to="/"
            ><BookinsLogo compact /><span>Bookins</span></RouterLink
          >
        </div>
        <div class="topbar-title"
          ><strong>{{ currentPage.label }}</strong
          ><small
            >{{ profileName }} ·
            <RouterLink v-if="loaded && !timezoneLabel" class="topbar-link" to="/settings">Set your timezone</RouterLink
            ><template v-else>{{ timezoneLabel }}</template></small
          ></div
        >
        <div class="topbar-actions">
          <span
            v-if="isDemo"
            class="preview-pill demo"
            role="status"
            title="Demo workspace. Read-only sample data; no real bookings are created."
            ><AppIcon name="lock" :size="14" />Demo<span class="pill-long">· Read-only</span></span
          >
          <span
            v-else-if="localPreview"
            class="preview-pill"
            role="status"
            title="Local sample workspace. Changes stay in this browser and never reach your hosted App."
            ><AppIcon name="info" :size="14" />Local preview<span class="pill-long">· not saved</span><span class="visually-hidden">. Local sample workspace. Changes stay in this browser and never reach your hosted App.</span></span
          >
          <button
            class="icon-button"
            :class="{ spinning: loading && loaded }"
            type="button"
            :disabled="loading"
            aria-label="Refresh workspace"
            @click="refresh"
          ><AppIcon
              name="refresh"
              :size="18"
          /></button>
        </div>
      </header>

      <p v-if="demoSwitchError || modeActionError" role="alert" class="mode-banner error">{{ demoSwitchError || modeActionError }}</p>
      <div
        v-if="error && loaded"
        class="mode-banner error"
        role="alert"
        ><span>{{ error }}</span
        ><button
          type="button"
          @click="refresh"
          >Try again</button
        ></div
      >

      <main id="main-content" tabindex="-1" :aria-busy="loading || transitioning">
        <div v-if="loading && !loaded" class="page-skeleton">
          <span class="visually-hidden" role="status">Loading your workspace…</span>
          <div class="page-header">
            <div><p class="eyebrow">{{ pageIntro.eyebrow }}</p><h1>{{ pageIntro.title }}</h1></div>
          </div>
          <div v-if="pageIntro.layout === 'overview'" aria-hidden="true">
            <div class="skeleton-cards skeleton-metrics"><span v-for="index in 4" :key="index" class="skeleton-block" /></div>
            <div class="skeleton-split"><span class="skeleton-block skeleton-main" /><div class="skeleton-side"><span v-for="index in 2" :key="index" class="skeleton-block" /></div></div>
          </div>
          <div v-else-if="pageIntro.layout === 'split'" class="skeleton-split" aria-hidden="true">
            <span class="skeleton-block skeleton-main" />
            <div class="skeleton-side"><span v-for="index in 2" :key="index" class="skeleton-block" /></div>
          </div>
          <div v-else-if="pageIntro.layout === 'list'" class="skeleton-list" aria-hidden="true"><span v-for="index in 4" :key="index" class="skeleton-block" /></div>
          <div v-else class="skeleton-cards" aria-hidden="true"><span v-for="index in 3" :key="index" class="skeleton-block" /></div>
        </div>
        <div
          v-else-if="workspaceFailed && !transitioning"
          class="card state-card"
          role="alert"
        >
          <span class="empty-icon">!</span>
          <h1>Bookins could not load.</h1>
          <p class="muted">{{ error || 'Bookins could not load this workspace.' }}</p>
          <button
            class="primary"
            type="button"
            @click="refresh"
            >Try again</button
          >
        </div>
        <RouterView v-else-if="!transitioning" v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" :key="`${routeKey}:${route.path}`" />
          </Transition>
        </RouterView>
        <p v-if="transitioning" class="mode-transition" role="status">Loading your workspace…</p>
      </main>
      <ProductTour v-if="!transitioning && loaded" ref="tour" />
    </div>

    <nav
      class="mobile-bottom-nav"
      :inert="narrowScreen && menuOpen"
      aria-label="Mobile navigation"
    >
      <RouterLink
        v-for="item in mobileNav"
        :key="item.to"
        :to="item.to"
      >
        <AppIcon
          :name="item.icon"
          :size="19"
        />
        <small>{{ item.shortLabel }}</small>
      </RouterLink>
      <button
        class="more-button"
        data-tour="tour-help-button"
        data-bookins-walkthrough-trigger
        :class="{ 'is-current': moreCurrent || moreOpen }"
        type="button"
        aria-haspopup="dialog"
        :aria-expanded="moreOpen"
        aria-controls="more-sheet"
        @click="toggleMore()"
      >
        <AppIcon name="more" :size="19" />
        <small>More</small>
      </button>
    </nav>

    <template v-if="moreOpen">
      <button class="more-sheet-scrim" type="button" aria-label="Close more menu" tabindex="-1" @click="toggleMore(false)" />
      <div id="more-sheet" class="more-sheet" role="dialog" aria-modal="true" aria-label="More pages" @keydown="moreKeydown">
        <h2>Workspace</h2>
        <WorkspaceMenu
          inline
          id-prefix="sheet-workspace"
          :label="accountLabel"
          :user-label="userLabel"
          :avatar-url="avatarUrl"
          :is-demo="isDemo"
          :local-preview="localPreview"
          :busy="workspaceBusy"
          @toggle-mode="changeMode(!isDemo)"
          @switched="onWorkspaceSwitched"
        >
          <RouterLink v-if="isDemo" to="/demo/guest" role="menuitem" class="ws-link" @click="moreOpen = false">Guest preview</RouterLink>
        </WorkspaceMenu>
        <CreditsPill v-if="!isDemo" id-prefix="sheet-credits" />
        <hr />
        <h2>Help</h2>
        <button type="button" class="more-item" @click="startTour"><AppIcon name="help" :size="20" />Take a walkthrough</button>
        <a class="more-item" :href="APPS_URL" target="_blank" rel="noopener" @click="moreOpen = false"><AppIcon name="back" :size="20" />Back to Apps</a>
        <a class="more-item" href="https://goalmatic.io/support" target="_blank" rel="noreferrer" @click="moreOpen = false"><AppIcon name="external" :size="20" />Contact support</a>
        <hr />
        <h2>More</h2>
        <RouterLink v-for="item in moreNav" :key="item.to" :to="item.to">
          <AppIcon :name="item.icon" :size="20" />{{ item.label }}
        </RouterLink>
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

  <GoalmaticFeedback v-if="!isPublicRoute" />
</template>

<style scoped>
@media (max-width: 480px) { .mobile-brand span:last-child { display: none; } .preview-pill { padding: 0 10px; } }
.demo-entry { min-height: 36px; white-space: nowrap; }
.demo-mode-banner { align-items: center; justify-content: space-between; gap: 12px; }
.demo-mode-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.demo-mode-actions .secondary { min-height: 40px; display: inline-flex; align-items: center; padding: 0 12px; border: 1px solid #cfd5ff; border-radius: 8px; background: #fff; color: #2336dc; font-size: 14px; font-weight: 700; }
.demo-mode-actions button { min-height: 40px; padding: 0 12px; border: 1px solid #cfd5ff; border-radius: 8px; background: #fff; color: #2336dc; font: inherit; font-size: 14px; font-weight: 700; }
.mode-transition { margin: 32px 0; color: var(--muted); text-align: center; }
@media (max-width: 700px) { .demo-mode-banner { align-items: flex-start; flex-direction: column; } .demo-mode-actions { width: 100%; } .demo-mode-actions > * { flex: 1; justify-content: center; } }
</style>
