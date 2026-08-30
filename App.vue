<template>
  <RouterView v-if="isPublicRoute" />
  <div v-else class="app-shell">
    <aside class="sidebar" :class="{ open: menuOpen }">
      <RouterLink class="brand" to="/" @click="menuOpen = false"><span class="brand-mark">B</span><span>Bookings</span></RouterLink>
      <nav aria-label="Primary navigation"><RouterLink v-for="item in navItems" :key="item.to" :to="item.to" @click="menuOpen = false"><span>{{ item.icon }}</span>{{ item.label }}</RouterLink></nav>
      <div class="sidebar-foot"><span class="runtime-dot" :class="{ live: !localPreview }"></span>{{ localPreview ? 'Local preview' : accountLabel }}</div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <button class="mobile-menu" type="button" aria-label="Open navigation" @click="menuOpen = !menuOpen">☰</button>
        <div><strong>{{ profileName }}</strong><small>{{ state.profile?.timezone || 'Set your timezone' }}</small></div>
        <button class="quiet" type="button" @click="refresh">Refresh</button>
      </header>
      <main>
        <div v-if="loading" class="state-card">Loading your Booking App…</div>
        <div v-else-if="error" class="state-card error" role="alert"><strong>Bookings could not load.</strong><p>{{ error }}</p><button type="button" @click="refresh">Try again</button></div>
        <RouterView v-else />
      </main>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, provide, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { isLocalPreview, loadOwnerWorkspace } from './booking.js'

const route = useRoute()
const isPublicRoute = computed(() => route.path === '/book')
const menuOpen = ref(false), loading = ref(false), error = ref(''), accountLabel = ref('Goalmatic workspace')
const state = reactive({ profile: null, schedules: [], services: [], bookings: [] })
const localPreview = isLocalPreview()
const profileName = computed(() => state.profile?.['display_name'] || 'Booking workspace')
const navItems = [
  { label: 'Overview', to: '/', icon: '⌂' }, { label: 'Services', to: '/services', icon: '◇' },
  { label: 'Availability', to: '/availability', icon: '◷' }, { label: 'Bookings', to: '/bookings', icon: '▣' },
  { label: 'Contacts', to: '/contacts', icon: '◎' },
  { label: 'Settings', to: '/settings', icon: '⚙' },
]
async function refresh() {
  if (isPublicRoute.value) return
  loading.value = true; error.value = ''
  try {
    if (window.GoalmaticAuth?.getUser) { const user = await window.GoalmaticAuth.getUser(); accountLabel.value = user?.account?.name || user?.name || 'Goalmatic workspace' }
    Object.assign(state, await loadOwnerWorkspace())
  } catch (reason) { error.value = reason?.message || 'Try again in a moment.' } finally { loading.value = false }
}
provide('bookingState', state); provide('refreshBookings', refresh); provide('localPreview', localPreview); onMounted(refresh)
</script>

<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171b2d;background:#f6f7fb;font-synthesis:none;--ink:#171b2d;--muted:#697087;--surface:#fff;--line:#e3e5ee;--accent:#3346db;--accent-soft:#eef0ff;--danger:#b42318;--success:#147a4d;--radius:16px}*{box-sizing:border-box}body{margin:0;min-width:320px;background:#f6f7fb}button,input,select,textarea{font:inherit}button,a,input,select,textarea{min-height:44px}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.55}:focus-visible{outline:3px solid #9da8ff;outline-offset:2px}.app-shell{display:grid;grid-template-columns:244px 1fr;min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;padding:26px 18px 20px;background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:11px;padding:0 8px 26px;color:var(--ink);font-size:19px;font-weight:800;text-decoration:none}.brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;color:#fff;background:var(--accent)}.sidebar nav{display:grid;gap:5px}.sidebar nav a{display:flex;align-items:center;gap:12px;padding:0 12px;border-radius:10px;color:var(--muted);font-size:14px;font-weight:650;text-decoration:none}.sidebar nav a.router-link-active{color:#2435c1;background:var(--accent-soft)}.sidebar-foot{margin-top:auto;padding:16px 10px 0;border-top:1px solid var(--line);color:var(--muted);font-size:12px}.runtime-dot{display:inline-block;width:8px;height:8px;margin-right:7px;border-radius:50%;background:#aeb3c3}.runtime-dot.live{background:#1a9a62}.workspace{min-width:0}.topbar{height:72px;padding:0 32px;display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,.92);border-bottom:1px solid var(--line)}.topbar div{display:grid;gap:2px}.topbar small{color:var(--muted)}.quiet{padding:0 14px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);font-weight:700}.mobile-menu{display:none;border:0;background:transparent;font-size:23px}.workspace main{max-width:1320px;margin:0 auto;padding:36px 32px 64px}.state-card{max-width:680px;margin:80px auto;padding:28px;border:1px solid var(--line);border-radius:var(--radius);background:#fff;text-align:center}.state-card.error{color:var(--danger)}.state-card p{color:var(--muted)}.state-card button,.primary,.secondary,.danger{padding:0 16px;border-radius:10px;font-weight:750}.primary{border:1px solid var(--accent);color:#fff;background:var(--accent)}.secondary{border:1px solid var(--line);color:var(--ink);background:#fff}.danger{border:1px solid #f1c5c1;color:var(--danger);background:#fff8f7}.page-header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:26px}.eyebrow{margin:0 0 8px;color:#3b4ccd;font-size:12px;font-weight:850;letter-spacing:.09em;text-transform:uppercase}h1,h2,h3,p{margin-top:0}h1{margin-bottom:8px;font-size:clamp(32px,4vw,50px);line-height:1.04;letter-spacing:-.045em}h2{letter-spacing:-.025em}.lede,.muted{color:var(--muted);line-height:1.6}.grid{display:grid;gap:16px}.grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}.grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}.card{padding:22px;border:1px solid var(--line);border-radius:var(--radius);background:#fff;box-shadow:0 10px 28px rgba(28,35,76,.045)}.metric{font-size:34px;font-weight:800;letter-spacing:-.04em}.label{color:var(--muted);font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.empty{padding:42px 22px;border:1px dashed #b9bece;border-radius:var(--radius);background:#fbfbfd;text-align:center}.field{display:grid;gap:7px;margin-bottom:16px}.field label{font-size:13px;font-weight:750}.field input,.field select,.field textarea{width:100%;padding:0 12px;border:1px solid #b9bece;border-radius:10px;background:#fff;color:var(--ink)}.field textarea{min-height:100px;padding-top:12px;resize:vertical}.form-actions{display:flex;gap:10px;flex-wrap:wrap}.notice{padding:13px 15px;margin-bottom:18px;border-radius:10px;color:var(--success);background:#eaf7f1}.notice.error{color:var(--danger);background:#fff0ef}.modal-backdrop{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:20px;background:rgba(18,23,50,.5)}.modal{width:min(620px,100%);max-height:90vh;overflow:auto}.chip{display:inline-flex;align-items:center;min-height:28px;padding:0 9px;border-radius:999px;background:#eef0f5;color:#565e73;font-size:12px;font-weight:800}.chip.confirmed{color:#147a4d;background:#e8f6ef}.chip.cancelled{color:var(--danger);background:#fff0ef}@media(max-width:900px){.app-shell{grid-template-columns:1fr}.sidebar{position:fixed;z-index:30;width:244px;transform:translateX(-100%);transition:transform .18s}.sidebar.open{transform:translateX(0)}.mobile-menu{display:block}.topbar{padding:0 18px;justify-content:flex-start;gap:14px}.topbar .quiet{margin-left:auto}.workspace main{padding:28px 18px 52px}.grid-3,.grid-2{grid-template-columns:1fr}.page-header{align-items:flex-start;flex-direction:column}}@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
</style>
