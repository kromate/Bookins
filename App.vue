<script setup>

import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from './components/AppIcon.vue'
import BookinsLogo from './components/BookinsLogo.vue'
import DemoGuide from './components/DemoGuide.vue'

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
const demoGuide = ref(null)
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
async function startWalkthrough() {
  if (workspaceDetails.value) workspaceDetails.value.open = false
  menuOpen.value = false
  await nextTick()
  await demoGuide.value?.start()
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
  if (open) document.querySelector('.more-sheet a')?.focus()
  else document.querySelector('.more-button')?.focus()
}
function moreKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    toggleMore(false)
    return
  }
  if (event.key !== 'Tab') return
  const controls = [...event.currentTarget.querySelectorAll('a[href]')]
  const first = controls[0], last = controls.at(-1)
  if ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first)?.focus()
  }
}

// Lightweight success toast (supplements, never replaces, inline role="status"/"alert" messages).
const toasts = ref([])
let toastId = 0
function toast(message, { duration = 3500 } = {}) {
  const text = String(message || '').trim()
  if (!text) return
  const id = ++toastId
  toasts.value = [...toasts.value.slice(-2), { id, text }]
  window.setTimeout(() => {
    toasts.value = toasts.value.filter((item) => item.id !== id)
  }, duration)
}
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

// Resolves true when workspace state was reloaded, false when it could not be.
// A call made during a load waits for one more load so callers never read stale state.
function refresh() {
  if (isPublicRoute.value) return Promise.resolve(false)
  if (inFlight) {
    rerun = true
    return inFlight
  }
  inFlight = (async () => {
    let ok = false
    do {
      rerun = false
      ok = await loadWorkspace()
    } while (rerun)
    return ok
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function loadWorkspace() {
  loading.value = true
  error.value = ''
  try {
    if (isDemo.value) {
      accountLabel.value = 'Demo workspace'
    } else if (window.GoalmaticAuth?.getUser) {
      const user = await window.GoalmaticAuth.getUser()
      accountLabel.value = user?.account?.name || user?.name || 'Goalmatic workspace'
    } else if (localPreview) {
      accountLabel.value = 'Sample workspace'
    }
    Object.assign(state, await loadOwnerWorkspace())
    loaded.value = true
    return true
  } catch (reason) {
    error.value = reason?.message || 'Bookins could not load this workspace.'
    return false
  } finally {
    loading.value = false
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

watch(
  () => route.path,
  () => {
    menuOpen.value = false
    moreOpen.value = false
  },
)
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
          ><small>{{ localPreview ? 'Sample workspace' : 'Active workspace' }}</small
          ><strong>{{ accountLabel }}</strong></div
        >
        </summary>
        <div class="workspace-menu-actions">
          <button type="button" :disabled="modeRequesting" @click="changeMode(!isDemo)">{{ isDemo ? 'Switch to Live' : 'Switch to Demo' }}</button>
          <template v-if="isDemo">
            <button type="button" @click="startWalkthrough">Start or restart walkthrough</button>
            <RouterLink to="/demo/guest" @click="menuOpen = false; workspaceDetails.open = false">Guest preview</RouterLink>
          </template>
        </div>
      </details>

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
            >{{ profileName }} · {{ state.profile?.timezone || 'Set your timezone' }}</small
          ></div
        >
        <div class="topbar-actions">
          <span
            v-if="isDemo"
            class="preview-pill demo"
            role="status"
            title="Demo workspace. Read-only sample data; no real bookings are created."
            ><AppIcon name="lock" :size="14" />Demo · Read-only</span
          >
          <span
            v-else-if="localPreview"
            class="preview-pill"
            role="status"
            title="Local sample workspace. Changes stay in this browser and never reach your hosted App."
            ><AppIcon name="info" :size="14" />Local preview · not saved<span class="visually-hidden">. Local sample workspace. Changes stay in this browser and never reach your hosted App.</span></span
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
        <div
          v-if="loading && !loaded"
          class="page-skeleton"
          aria-hidden="true"
        >
          <span class="skeleton-line skeleton-copy" />
          <span class="skeleton-line skeleton-title" />
          <span class="skeleton-line skeleton-copy" />
          <div class="skeleton-cards"
            ><span
              v-for="index in 3"
              :key="index"
              class="skeleton-block"
          /></div>
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
      <DemoGuide v-if="isDemo && !transitioning" ref="demoGuide" />
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
        <h2>More</h2>
        <RouterLink v-for="item in moreNav" :key="item.to" :to="item.to">
          <AppIcon :name="item.icon" :size="20" />{{ item.label }}
        </RouterLink>
      </div>
    </template>

    <div class="toast-region" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="toast">
        <div v-for="item in toasts" :key="item.id" class="toast" role="status">
          <AppIcon name="check" :size="16" />{{ item.text }}
        </div>
      </TransitionGroup>
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
