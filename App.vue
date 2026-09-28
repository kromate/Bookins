<script setup>
import { defineAsyncComponent, computed, onMounted, provide, reactive, ref, watch } from 'vue'
// The feedback button loads after the App so its widget runtime never delays the first screen.
const GoalmaticFeedback = defineAsyncComponent(() => import('./components/GoalmaticFeedback.vue'))
import { useRoute } from 'vue-router'
import AppIcon from './components/AppIcon.vue'
import BookinsLogo from './components/BookinsLogo.vue'
import { copyText, isLocalPreview, loadOwnerWorkspace } from './booking.js'

const route = useRoute()
const menuOpen = ref(false)
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const copied = ref(false)
const accountLabel = ref('Goalmatic workspace')
const state = reactive({ profile: null, schedules: [], services: [], bookings: [] })
const localPreview = isLocalPreview()

const navItems = [
  { label: 'Overview', shortLabel: 'Home', to: '/', icon: 'dashboard', section: 'WORKSPACE' },
  { label: 'Services', shortLabel: 'Services', to: '/services', icon: 'services', section: 'WORKSPACE' },
  { label: 'Availability', shortLabel: 'Hours', to: '/availability', icon: 'availability', section: 'WORKSPACE' },
  { label: 'Bookings', shortLabel: 'Bookings', to: '/bookings', icon: 'bookings', section: 'WORKSPACE' },
  { label: 'Contacts', shortLabel: 'Contacts', to: '/contacts', icon: 'contacts', section: 'MANAGE' },
  { label: 'Settings', shortLabel: 'Settings', to: '/settings', icon: 'settings', section: 'MANAGE' },
]

// Static page intros let the first-load skeleton show real headings while workspace data loads.
const pageIntros = {
  '/': { eyebrow: 'Workspace overview', title: 'Run your booking day with less back-and-forth.', lede: 'Set your hours, share one link, and keep every confirmed appointment in view.', layout: 'overview' },
  '/services': { eyebrow: 'Your offerings', title: 'Services', lede: 'Create the sessions people can book. Each service uses your shared availability and can be paused without losing its history.', layout: 'cards' },
  '/availability': { eyebrow: 'Working hours', title: 'Availability', lede: 'Choose when guests can book you. Times are shown in your booking timezone and confirmed slots are removed automatically.', layout: 'split' },
  '/bookings': { eyebrow: 'Appointments', title: 'Bookings', lede: 'See who is coming, what they booked, and the details they shared. Cancelled appointments stay in history.', layout: 'list' },
  '/contacts': { eyebrow: 'Guest history', title: 'Contacts', lede: 'Every guest appears once, with their booking history kept together. Contacts are read-only and come directly from appointments.', layout: 'cards' },
  '/settings': { eyebrow: 'Configuration', title: 'Settings', lede: 'Shape what guests see and manage the release-pinned link that connects them to this Bookins workspace.', layout: 'split' },
}
const overviewMetrics = [
  { label: 'Active services', sub: 'Ready to book' },
  { label: 'Upcoming', sub: 'Confirmed appointments' },
  { label: 'This month', sub: 'Bookings received' },
  { label: 'Open weekdays', sub: '' },
]

const primaryNav = navItems.filter(item => item.section === 'WORKSPACE')
const manageNav = navItems.filter(item => item.section === 'MANAGE')
const mobileNav = [navItems[0], navItems[1], navItems[3], navItems[2]]
const isPublicRoute = computed(() => route.path === '/book')
const profileName = computed(() => state.profile?.display_name || 'Booking workspace')
const initials = computed(() => profileName.value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'B')
const publicUrl = computed(() => state.profile?.public_link_url || '')
const currentPage = computed(() => navItems.find(item => item.to === '/' ? route.path === '/' : route.path.startsWith(item.to)) || navItems[0])
const pageIntro = computed(() => pageIntros[currentPage.value.to] || pageIntros['/'])

async function refresh() {
  if (isPublicRoute.value || loading.value) return
  loading.value = true
  error.value = ''
  try {
    // The account label and workspace Tables are independent, so load them together.
    const [user, workspace] = await Promise.all([
      window.GoalmaticAuth?.getUser ? window.GoalmaticAuth.getUser() : null,
      loadOwnerWorkspace(),
    ])
    if (window.GoalmaticAuth?.getUser) accountLabel.value = user?.account?.name || user?.name || 'Goalmatic workspace'
    else if (localPreview) accountLabel.value = 'Sample workspace'
    Object.assign(state, workspace)
    loaded.value = true
  } catch (reason) {
    error.value = reason?.message || 'Bookins could not load this workspace.'
  } finally {
    loading.value = false
  }
}

async function copyPublicLink() {
  if (!publicUrl.value) return
  await copyText(publicUrl.value)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 1600)
}

provide('bookingState', state)
provide('refreshBookings', refresh)
provide('localPreview', localPreview)

watch(() => route.path, () => { menuOpen.value = false })
onMounted(refresh)
</script>

<template>
  <RouterView v-if="isPublicRoute" />
  <div v-else class="app-shell">
    <GoalmaticFeedback />
    <aside class="sidebar" :class="{ open: menuOpen }">
      <div class="sidebar-brand">
        <RouterLink to="/" aria-label="Bookins home"><BookinsLogo /></RouterLink>
        <button class="sidebar-close" type="button" aria-label="Close navigation" @click="menuOpen = false"><AppIcon name="close" /></button>
      </div>

      <div class="workspace-card">
        <span class="workspace-avatar">{{ initials }}</span>
        <div><small>{{ localPreview ? 'Sample workspace' : 'Active workspace' }}</small><strong>{{ accountLabel }}</strong></div>
      </div>

      <p class="nav-section-label">WORKSPACE</p>
      <nav class="side-nav" aria-label="Primary navigation">
        <RouterLink v-for="item in primaryNav" :key="item.to" :to="item.to">
          <AppIcon :name="item.icon" :size="18" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-divider" />
      <p class="nav-section-label">MANAGE</p>
      <nav class="side-nav" aria-label="Management navigation">
        <RouterLink v-for="item in manageNav" :key="item.to" :to="item.to">
          <AppIcon :name="item.icon" :size="18" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-spacer" />
      <div v-if="publicUrl" class="share-card">
        <div class="share-card-header"><AppIcon name="link" :size="15" /><strong>Your booking link</strong></div>
        <p>{{ publicUrl }}</p>
        <div class="share-card-actions">
          <button type="button" @click="copyPublicLink"><AppIcon name="copy" :size="13" />{{ copied ? 'Copied' : 'Copy' }}</button>
          <a :href="publicUrl" target="_blank" rel="noreferrer"><AppIcon name="external" :size="13" />Open</a>
        </div>
      </div>
      <div class="runtime-label"><span class="runtime-dot" :class="{ live: !localPreview }" />{{ localPreview ? 'Local sample data' : 'Connected to Goalmatic' }}</div>
    </aside>

    <button class="sidebar-scrim" :class="{ open: menuOpen }" type="button" aria-label="Close navigation" @click="menuOpen = false" />

    <div class="workspace">
      <header class="topbar">
        <div class="topbar-actions">
          <button class="icon-button mobile-menu" type="button" aria-label="Open navigation" @click="menuOpen = true"><AppIcon name="menu" /></button>
          <RouterLink class="mobile-brand" to="/"><BookinsLogo compact /><span>Bookins</span></RouterLink>
        </div>
        <div class="topbar-title"><strong>{{ currentPage.label }}</strong><small v-if="loaded">{{ profileName }} · {{ state.profile?.timezone || 'Set your timezone' }}</small><span v-else-if="!error" class="skeleton-line skeleton-topbar" aria-hidden="true" /></div>
        <div class="topbar-actions">
          <button class="icon-button" :class="{ spinning: loading && loaded }" type="button" :disabled="loading" aria-label="Refresh workspace" @click="refresh"><AppIcon name="refresh" :size="18" /></button>
        </div>
      </header>

      <div v-if="localPreview" class="mode-banner" role="status">
        <span>Local sample workspace. Changes stay in this browser and never reach your hosted App.</span>
      </div>
      <div v-if="error && loaded" class="mode-banner error" role="alert"><span>{{ error }}</span><button type="button" @click="refresh">Try again</button></div>

      <main :aria-busy="loading">
        <div v-if="!loaded && !error" class="page-skeleton">
          <span class="visually-hidden" role="status">Loading your workspace…</span>
          <div class="page-header">
            <div><p class="eyebrow">{{ pageIntro.eyebrow }}</p><h1>{{ pageIntro.title }}</h1><p class="lede">{{ pageIntro.lede }}</p></div>
            <span class="skeleton-block skeleton-action" aria-hidden="true" />
          </div>
          <template v-if="pageIntro.layout === 'overview'">
            <div class="grid grid-4">
              <article v-for="metric in overviewMetrics" :key="metric.label" class="card skeleton-metric"><span class="skeleton-block skeleton-icon" aria-hidden="true" /><div><span class="label">{{ metric.label }}</span><span class="skeleton-line skeleton-number" aria-hidden="true" /><p v-if="metric.sub" class="metric-sub">{{ metric.sub }}</p><span v-else class="skeleton-line skeleton-sub" aria-hidden="true" /></div></article>
            </div>
            <div class="skeleton-split">
              <article class="card"><p class="eyebrow">Up next</p><h2>Upcoming bookings</h2><span v-for="index in 3" :key="index" class="skeleton-block skeleton-row" aria-hidden="true" /></article>
              <div class="skeleton-side">
                <article class="card"><p class="eyebrow">Launch checklist</p><span class="skeleton-line skeleton-heading" aria-hidden="true" /><span v-for="index in 4" :key="index" class="skeleton-line skeleton-step" aria-hidden="true" /></article>
                <article class="card"><p class="eyebrow">Booking link</p><span class="skeleton-line skeleton-heading" aria-hidden="true" /><p class="muted">Guests only see the services and times you make available.</p><span class="skeleton-block skeleton-button" aria-hidden="true" /></article>
              </div>
            </div>
          </template>
          <div v-else-if="pageIntro.layout === 'split'" class="skeleton-split" aria-hidden="true">
            <span class="skeleton-block skeleton-main" />
            <div class="skeleton-side"><span v-for="index in 2" :key="index" class="skeleton-block" /></div>
          </div>
          <div v-else-if="pageIntro.layout === 'list'" class="skeleton-list" aria-hidden="true"><span v-for="index in 4" :key="index" class="skeleton-block" /></div>
          <div v-else class="skeleton-cards" aria-hidden="true"><span v-for="index in 3" :key="index" class="skeleton-block" /></div>
        </div>
        <div v-else-if="!loaded" class="card state-card" role="alert">
          <span class="empty-icon">!</span>
          <h1>Bookins could not load.</h1>
          <p class="muted">{{ error }}</p>
          <button class="primary" type="button" @click="refresh">Try again</button>
        </div>
        <RouterView v-else />
      </main>
    </div>

    <nav class="mobile-bottom-nav" aria-label="Mobile navigation">
      <RouterLink v-for="item in mobileNav" :key="item.to" :to="item.to">
        <AppIcon :name="item.icon" :size="19" />
        <small>{{ item.shortLabel }}</small>
      </RouterLink>
    </nav>
  </div>
</template>
