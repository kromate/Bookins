<script setup>
import { computed, onMounted, provide, reactive, ref, watch } from 'vue'
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

const primaryNav = navItems.filter(item => item.section === 'WORKSPACE')
const manageNav = navItems.filter(item => item.section === 'MANAGE')
const mobileNav = [navItems[0], navItems[1], navItems[3], navItems[2]]
const isPublicRoute = computed(() => route.path === '/book')
const profileName = computed(() => state.profile?.display_name || 'Booking workspace')
const initials = computed(() => profileName.value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'B')
const publicUrl = computed(() => state.profile?.public_link_url || '')
const currentPage = computed(() => navItems.find(item => item.to === '/' ? route.path === '/' : route.path.startsWith(item.to)) || navItems[0])

async function refresh() {
  if (isPublicRoute.value || loading.value) return
  loading.value = true
  error.value = ''
  try {
    if (window.GoalmaticAuth?.getUser) {
      const user = await window.GoalmaticAuth.getUser()
      accountLabel.value = user?.account?.name || user?.name || 'Goalmatic workspace'
    } else if (localPreview) {
      accountLabel.value = 'Sample workspace'
    }
    Object.assign(state, await loadOwnerWorkspace())
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
        <div class="topbar-title"><strong>{{ currentPage.label }}</strong><small>{{ profileName }} · {{ state.profile?.timezone || 'Set your timezone' }}</small></div>
        <div class="topbar-actions">
          <button class="icon-button" :class="{ spinning: loading && loaded }" type="button" :disabled="loading" aria-label="Refresh workspace" @click="refresh"><AppIcon name="refresh" :size="18" /></button>
        </div>
      </header>

      <div v-if="localPreview" class="mode-banner" role="status">
        <span>Local sample workspace. Changes stay in this browser and never reach your hosted App.</span>
      </div>
      <div v-if="error && loaded" class="mode-banner error" role="alert"><span>{{ error }}</span><button type="button" @click="refresh">Try again</button></div>

      <main :aria-busy="loading">
        <div v-if="loading && !loaded" class="page-skeleton" aria-hidden="true">
          <span class="skeleton-line skeleton-copy" />
          <span class="skeleton-line skeleton-title" />
          <span class="skeleton-line skeleton-copy" />
          <div class="skeleton-cards"><span v-for="index in 3" :key="index" class="skeleton-block" /></div>
        </div>
        <div v-else-if="error && !loaded" class="card state-card" role="alert">
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
