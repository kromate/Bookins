<template>
  <div class="app-shell">
    <header class="topbar">
      <RouterLink class="brand" to="/" aria-label="Bookings workspace home">
        <span class="brand-mark" aria-hidden="true">B</span>
        <span>Bookings</span>
      </RouterLink>
      <nav class="desktop-nav" aria-label="Primary navigation">
        <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="nav-link">{{ item.label }}</RouterLink>
      </nav>
      <div class="top-actions">
        <span class="account-badge"><span class="status-dot"></span>{{ authLabel }}</span>
        <button class="button button-quiet menu-button" type="button" @click="menuOpen = !menuOpen" :aria-expanded="menuOpen">Menu</button>
        <button class="button button-primary" type="button" @click="signIn">Sign in with Goalmatic</button>
      </div>
    </header>
    <div v-if="menuOpen" class="mobile-menu">
      <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="mobile-link" @click="menuOpen = false">{{ item.label }}</RouterLink>
    </div>
    <main class="page-wrap"><RouterView /></main>
    <footer class="utility-footer"><span>Private workspace draft</span><span>Local state only · no sample records</span></footer>
  </div>
</template>

<script setup>
import { computed, onMounted, provide, reactive, ref, watch } from 'vue'

const menuOpen = ref(false)
const auth = ref(false)
const authMessage = ref('')
const workspace = reactive({
  businessName: '',
  timezone: 'UTC',
  services: [],
  availability: [
    { day: 'Monday', active: false, start: '09:00', end: '17:00' },
    { day: 'Tuesday', active: false, start: '09:00', end: '17:00' },
    { day: 'Wednesday', active: false, start: '09:00', end: '17:00' },
    { day: 'Thursday', active: false, start: '09:00', end: '17:00' },
    { day: 'Friday', active: false, start: '09:00', end: '17:00' },
    { day: 'Saturday', active: false, start: '10:00', end: '14:00' },
    { day: 'Sunday', active: false, start: '10:00', end: '14:00' }
  ],
  bookings: []
})

const navItems = [
  { label: 'Overview', to: '/' }, { label: 'Services', to: '/services' },
  { label: 'Availability', to: '/availability' }, { label: 'Bookings', to: '/bookings' }, { label: 'Settings', to: '/settings' }
]
const authLabel = computed(() => auth.value ? 'Goalmatic account' : 'Preview mode')
provide('workspace', workspace)
provide('auth', auth)

function signIn() {
  authMessage.value = ''
  if (window.GoalmaticAuth?.loginWithGoogle) {
    window.GoalmaticAuth.loginWithGoogle().then(() => { auth.value = true }).catch(() => { authMessage.value = 'Sign-in is unavailable right now.' })
  } else {
    auth.value = !auth.value
    authMessage.value = auth.value ? 'Preview access enabled.' : 'Preview access disabled.'
  }
}
onMounted(() => {
  if (window.GoalmaticAuth?.isAuthenticated) auth.value = window.GoalmaticAuth.isAuthenticated()
})
watch(authMessage, (value) => { if (value) setTimeout(() => { authMessage.value = '' }, 3500) })
</script>

<style>
:root { font-family: Inter, Arial, sans-serif; color: #17202a; background: #f7f8fa; font-synthesis: none; --bg:#f7f8fa; --surface:#fff; --text:#17202a; --muted:#657180; --accent:#2563eb; --border:#dce1e8; --danger:#b42318; --success:#176b45; --radius:10px; }
* { box-sizing: border-box; }
body { margin:0; min-width:320px; background:var(--bg); }
button, input, select, textarea { font:inherit; }
button, a, input, select, textarea { min-height:44px; }
button { cursor:pointer; }
button:disabled { cursor:not-allowed; opacity:.55; }
a { color:inherit; }
:focus-visible { outline:3px solid #93b4ff; outline-offset:2px; }
.topbar { height:72px; display:flex; align-items:center; gap:30px; padding:0 28px; background:var(--surface); border-bottom:1px solid var(--border); }
.brand { display:flex; align-items:center; gap:10px; font-weight:750; text-decoration:none; letter-spacing:-.02em; }
.brand-mark { width:32px; height:32px; display:grid; place-items:center; color:#fff; background:var(--accent); border-radius:8px; font-weight:800; }
.desktop-nav { display:flex; gap:4px; flex:1; }
.nav-link, .mobile-link { padding:10px 12px; min-height:44px; display:inline-flex; align-items:center; text-decoration:none; color:var(--muted); border-radius:7px; font-size:14px; }
.nav-link.router-link-active, .mobile-link.router-link-active { color:var(--text); background:#edf3ff; font-weight:700; }
.top-actions { display:flex; align-items:center; gap:10px; }
.account-badge { display:flex; align-items:center; gap:7px; color:var(--muted); font-size:12px; white-space:nowrap; }
.status-dot { width:8px; height:8px; border-radius:50%; background:#a8b0ba; }
.button { border:1px solid var(--border); border-radius:8px; padding:0 14px; min-height:44px; font-weight:700; background:var(--surface); color:var(--text); }
.button-primary { border-color:var(--accent); color:#fff; background:var(--accent); }
.button-quiet { background:transparent; }
.menu-button, .mobile-menu { display:none; }
.page-wrap { max-width:1440px; margin:0 auto; padding:40px 28px 56px; }
.utility-footer { display:flex; justify-content:space-between; padding:18px 28px; color:var(--muted); font-size:12px; border-top:1px solid var(--border); }
.page-header { display:flex; justify-content:space-between; gap:24px; align-items:flex-end; margin-bottom:30px; }
.eyebrow { margin:0 0 9px; color:#315da8; font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
h1,h2,h3,p { margin-top:0; } h1 { margin-bottom:10px; font-size:clamp(30px,4vw,48px); line-height:1.05; letter-spacing:-.04em; } h2 { font-size:24px; letter-spacing:-.025em; } h3 { font-size:16px; }
.lede { max-width:62ch; color:var(--muted); line-height:1.6; }
.grid { display:grid; gap:18px; } .grid-3 { grid-template-columns:repeat(3,1fr); } .grid-2 { grid-template-columns:repeat(2,1fr); }
.card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:22px; box-shadow:0 8px 24px rgba(23,32,42,.05); }
.card h2:last-child, .card p:last-child { margin-bottom:0; }
.card-label { color:var(--muted); font-size:12px; font-weight:750; text-transform:uppercase; letter-spacing:.06em; }
.empty { padding:42px 22px; text-align:center; border:1px dashed #aeb8c5; border-radius:var(--radius); background:#fbfcfd; }
.empty p { color:var(--muted); line-height:1.55; }
.field { display:grid; gap:7px; margin-bottom:16px; } label { font-size:13px; font-weight:700; } input, select, textarea { width:100%; border:1px solid #aeb8c5; border-radius:8px; padding:0 12px; color:var(--text); background:#fff; } textarea { padding-top:12px; min-height:96px; resize:vertical; }
.form-actions { display:flex; gap:10px; flex-wrap:wrap; } .muted { color:var(--muted); } .success { color:var(--success); } .error { color:var(--danger); }
@media (max-width:800px) { .topbar { padding:0 18px; gap:12px; } .desktop-nav { display:none; } .top-actions { margin-left:auto; } .top-actions .button-primary { display:none; } .menu-button { display:inline-flex; align-items:center; justify-content:center; } .mobile-menu { display:flex; flex-wrap:wrap; gap:4px; padding:10px 18px; background:#fff; border-bottom:1px solid var(--border); } .page-wrap { padding:28px 18px 42px; } .grid-3, .grid-2 { grid-template-columns:1fr; } .page-header { align-items:flex-start; flex-direction:column; } }
@media (max-width:480px) { .account-badge { display:none; } .utility-footer { flex-direction:column; gap:6px; padding:16px 18px; } }
@media (prefers-reduced-motion:reduce) { * { scroll-behavior:auto !important; transition:none !important; } }
</style>