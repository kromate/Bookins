<script setup>

import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from './components/AppIcon.vue'
import BookinsLogo from './components/BookinsLogo.vue'
import ProductTour from './components/ProductTour.vue'

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
const router = useRouter()
const menuOpen = ref(false)
const workspaceDetails = ref(null)
const tour = ref(null)
const helpOpen = ref(false)
const helpRoot = ref(null)
function workspaceKeydown(event) {
  if (event.key !== 'Escape' || !workspaceDetails.value?.open) return
  event.preventDefault()
  event.stopPropagation()
  workspaceDetails.value.open = false
  workspaceDetails.value.querySelector('summary')?.focus()
}
function focusMain() {
  document.getElementById('main-content')?.focus()
}
// Starts the Live or Demo tour (whichever matches the current mode). Closes every menu first.
async function startTour() {
  if (workspaceDetails.value) workspaceDetails.value.open = false
  menuOpen.value = false
  moreOpen.value = false
  helpOpen.value = false
  await nextTick()
  await tour.value?.start()
}
async function toggleHelp(open = !helpOpen.value, { restoreFocus = false } = {}) {
  helpOpen.value = open
  await nextTick()
  if (open) helpRoot.value?.querySelector('.help-popover > *')?.focus()
  else if (restoreFocus) helpRoot.value?.querySelector('.help-button')?.focus()
}
function helpKeydown(event) {
  if (!helpOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    toggleHelp(false, { restoreFocus: true })
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const items = [...helpRoot.value.querySelectorAll('.help-popover > *')]
    const index = items.indexOf(document.activeElement)
    event.preventDefault()
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }
}
function helpOutside(event) {
  if (helpOpen.value && !helpRoot.value?.contains(event.target)) helpOpen.value = false
}
onMounted(() => document.addEventListener('pointerdown', helpOutside, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', helpOutside, true))
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
const copied = ref(false)
const accountLabel = ref('Goalmatic workspace')
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
    label: 'Insights',
    shortLabel: 'Insights',
    to: '/insights',
    icon: 'sparkle',
    section: 'WORKSPACE',
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
  '/insights': { eyebrow: 'Performance', title: 'Insights', layout: 'overview' },
  '/contacts': { eyebrow: 'Clients', title: 'Contacts', layout: 'list' },
  '/settings': { eyebrow: 'Configuration', title: 'Settings', layout: 'split' },
}
const pageIntro = computed(
  () => pageIntros[Object.keys(pageIntros).find((path) => path !== '/' && route.path.startsWith(path)) || '/'],
)

async function loadWorkspace({ silent = false } = {}) {
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
    Object.assign(state, workspace)
    loaded.value = true
    lastLoadedAt = Date.now()
    return true
  } catch (reason) {
    if (silent && loaded.value) return false
    error.value = reason?.message || 'Bookins could not load this workspace.'
    return false
  } finally {
    if (!silent) loading.value = false
  }
}

const removeModeCommitHandler = registerModeCommitHandler(() => {
  state.profile = null
  state.schedules = []
  state.services = []
  state.bookings = []
  state.contacts = []
  loaded.value = false
  error.value = ''
  accountLabel.value = isDemo.value ? 'Demo workspace' : 'Goalmatic workspace'
  return refresh()
})

onBeforeUnmount(removeModeCommitHandler)

async function changeMode(enabled) {
  if (modeRequesting.value || enabled === isDemo.value) return
  if (workspaceDetails.value) workspaceDetails.value.open = false
  menuOpen.value = false
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
    if (previous !== undefined) backgroundRefresh({ force: true })
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

      <details ref="workspaceDetails" class="workspace-card workspace-menu" @keydown="workspaceKeydown">
        <summary tabindex="0">
        <span class="workspace-avatar">{{ initials }}</span>
        <div
          ><small>{{ isDemo ? 'Demo mode' : localPreview ? 'Sample workspace' : 'Active workspace' }}</small
          ><strong>{{ accountLabel }}</strong></div
        >
        </summary>
        <div class="workspace-menu-actions">
          <button type="button" :disabled="modeRequesting" @click="changeMode(!isDemo)">{{ isDemo ? 'Switch to Live' : 'Switch to Demo' }}</button>
          <RouterLink v-if="isDemo" to="/demo/guest" @click="menuOpen = false; workspaceDetails.open = false">Guest preview</RouterLink>
        </div>
      </details>

      <div class="mode-switch" role="group" aria-label="Workspace data">
        <button type="button" :aria-pressed="!isDemo" :disabled="modeRequesting" @click="changeMode(false)">{{ localPreview ? 'Sample' : 'Live' }}</button>
        <button type="button" :aria-pressed="isDemo" :disabled="modeRequesting" @click="changeMode(true)">Demo</button>
      </div>

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
      <div
        v-if="publicUrl"
        class="share-card"
      >
        <div class="share-card-header"
          ><AppIcon
            name="link"
            :size="15"
          /><strong>Your booking link</strong></div
        >
        <p>{{ publicUrl }}</p>
        <div class="share-card-actions">
          <button
            type="button"
            @click="copyPublicLink"
            ><AppIcon
              name="copy"
              :size="13"
            />{{ copied ? 'Copied' : 'Copy' }}</button
          >
          <a
            :href="publicUrl"
            target="_blank"
            rel="noreferrer"
            ><AppIcon
              name="external"
              :size="13"
            />Open</a
          >
        </div>
      </div>
      <div ref="helpRoot" class="help-menu" @keydown="helpKeydown">
        <div v-if="helpOpen" id="help-popover" class="help-popover" role="menu" aria-label="Help">
          <button type="button" role="menuitem" @click="startTour"><AppIcon name="sparkle" :size="18" />Take the tour</button>
          <RouterLink to="/" role="menuitem" @click="helpOpen = false; menuOpen = false"><AppIcon name="check" :size="18" />Setup checklist</RouterLink>
          <a href="https://goalmatic.io/support" target="_blank" rel="noreferrer" role="menuitem" @click="helpOpen = false"><AppIcon name="external" :size="18" />Contact support</a>
        </div>
        <button
          class="help-button"
          type="button"
          data-tour="tour-help-button"
          data-bookins-walkthrough-trigger
          aria-haspopup="menu"
          :aria-expanded="helpOpen"
          aria-controls="help-popover"
          @click="toggleHelp()"
        ><AppIcon name="info" :size="18" />Help</button>
      </div>
      <div class="runtime-label"
        ><span
          class="runtime-dot"
          :class="{ live: !localPreview }"
        />{{ isDemo ? 'Demo · read-only' : localPreview ? 'Local sample data' : 'Connected to Goalmatic' }}</div
      >
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
            <RouterLink v-if="!timezoneLabel" class="topbar-link" to="/settings">Set your timezone</RouterLink
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
          v-else-if="error && !loaded"
          class="card state-card"
          role="alert"
        >
          <span class="empty-icon">!</span>
          <h1>Bookins could not load.</h1>
          <p class="muted">{{ error }}</p>
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
        <h2>Help</h2>
        <button type="button" class="more-item" @click="startTour"><AppIcon name="sparkle" :size="20" />Take the tour</button>
        <RouterLink to="/" class="more-item" @click="moreOpen = false"><AppIcon name="check" :size="20" />Setup checklist</RouterLink>
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
.workspace-menu { display: block; }
.workspace-menu summary { display: flex; align-items: center; gap: 10px; min-height: 44px; cursor: pointer; list-style: none; }
.workspace-menu summary::after { content: ""; width: 6px; height: 6px; margin-left: auto; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg); flex: none; }
.workspace-menu summary::-webkit-details-marker { display: none; }
.workspace-menu-actions { display: grid; gap: 4px; margin-top: 8px; }
.workspace-menu-actions button, .workspace-menu-actions a { min-height: 44px; padding: 10px 6px; background: transparent; border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.workspace-menu summary:focus-visible, .workspace-menu-actions button:focus-visible, .workspace-menu-actions a:focus-visible { outline: 2px solid #2336dc; outline-offset: 2px; }
@media (max-width: 480px) { .mobile-brand span:last-child { display: none; } .preview-pill { padding: 0 10px; } }
.demo-entry { min-height: 36px; white-space: nowrap; }
.demo-mode-banner { align-items: center; justify-content: space-between; gap: 12px; }
.demo-mode-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.demo-mode-actions .secondary { min-height: 40px; display: inline-flex; align-items: center; padding: 0 12px; border: 1px solid #cfd5ff; border-radius: 8px; background: #fff; color: #2336dc; font-size: 14px; font-weight: 700; }
.demo-mode-actions button { min-height: 40px; padding: 0 12px; border: 1px solid #cfd5ff; border-radius: 8px; background: #fff; color: #2336dc; font: inherit; font-size: 14px; font-weight: 700; }
.mode-transition { margin: 32px 0; color: var(--muted); text-align: center; }
@media (max-width: 700px) { .demo-mode-banner { align-items: flex-start; flex-direction: column; } .demo-mode-actions { width: 100%; } .demo-mode-actions > * { flex: 1; justify-content: center; } }
</style>
