<script setup>
// Generated from Feedback Studio's shared integration. Update it with sync-app-feedback.mjs.
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import brand from '../feedback.config.json'

const host = 'https://feedback-studio.apps.goalmatic.io'
const route = useRoute()
// An App may provide its own receiver (Feedback Studio does); others use the hosted service.
const openLocal = inject('goalmaticFeedbackReceiver', null)
const busy = ref(false), error = ref(''), mounted = ref(false), logoFailed = ref(false)
const visible = computed(() => !route.meta.public && !['/auth', '/_goalmatic', ...brand.excludedRoutes]
  .some(path => route.path === path || route.path.startsWith(`${path}/`)))
let widget, controller, generation = 0, unsubscribe

function userContext() {
  const user = window.GoalmaticAuth?.user
  if (!user) return null
  // Leave out details the account doesn't have; the widget asks for an email when needed.
  const details = {
    id: String(user.id || user.uid || '').trim().slice(0, 128),
    name: String(user.displayName || user.name || '').trim().slice(0, 80),
    email: String(user.email || '').trim().slice(0, 254),
  }
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value))
}

function loadSdk() {
  if (window.FeedbackStudio?.boot) return Promise.resolve(window.FeedbackStudio)
  return new Promise((resolve, reject) => {
    let script = document.querySelector('script[data-goalmatic-feedback-sdk]')
    const existing = Boolean(script)
    if (!script) {
      script = document.createElement('script')
      script.dataset.goalmaticFeedbackSdk = ''
      script.src = `${host}/feedback-widget.js`
      script.async = true
    }
    const finish = () => {
      clearTimeout(timer)
      script.removeEventListener('load', loaded)
      script.removeEventListener('error', failed)
    }
    const loaded = () => {
      finish()
      if (window.FeedbackStudio?.boot) resolve(window.FeedbackStudio)
      else { script.remove(); reject(new Error('Feedback is temporarily unavailable. Please try again.')) }
    }
    const failed = () => {
      finish()
      script.remove()
      reject(new Error('Feedback could not load. Check your connection and try again.'))
    }
    const timer = setTimeout(failed, 15_000)
    script.addEventListener('load', loaded, { once: true })
    script.addEventListener('error', failed, { once: true })
    if (!existing) document.head.append(script)
  })
}

async function open() {
  if (busy.value || !visible.value) return
  const current = ++generation
  busy.value = true
  error.value = ''
  const requestController = new AbortController()
  controller = requestController
  const timer = setTimeout(() => requestController.abort(), 15_000)
  try {
    if (openLocal) {
      const instance = await openLocal({ user: userContext(), offset: window.innerWidth <= 850 ? 64 : 24 })
      if (current !== generation || !visible.value) { instance?.destroy(); return }
      if (instance) {
        widget = instance
        if (window.innerWidth <= 850) widget.host.style.setProperty('--offset', '88px')
        widget.open()
        mounted.value = true
        return
      }
    }
    const response = await fetch(`${host}/api/app-runtime/widgets/apps/${encodeURIComponent(brand.siteId)}`, {
      credentials: 'omit', referrerPolicy: 'no-referrer', signal: requestController.signal,
    })
    if (!response.ok) throw new Error('Feedback is temporarily unavailable. Please try again later.')
    const result = await response.json()
    if (result.version !== 1 || !/^fw_[A-Za-z0-9_-]{43}$/.test(result.widgetId || '') || !result.config)
      throw new Error('Feedback is temporarily unavailable. Please try again later.')
    const endpoint = new URL(result.submissionUrl)
    if (endpoint.origin !== host || endpoint.pathname !== `/api/app-runtime/widgets/submit/${result.widgetId}` || endpoint.search || endpoint.hash)
      throw new Error('Feedback is temporarily unavailable. Please try again later.')
    const sdk = await loadSdk()
    if (current !== generation || !visible.value) return
    widget = sdk.boot({
      widgetId: result.widgetId,
      config: { ...result.config, endpoint: endpoint.href, offset: window.innerWidth <= 850 ? 64 : 24 },
      user: userContext(),
    })
    if (window.innerWidth <= 850) widget.host.style.setProperty('--offset', '88px')
    sdk.show()
    mounted.value = true
  } catch (cause) {
    if (current === generation) error.value = cause.name === 'AbortError'
      ? 'Feedback took too long to load. Please try again.'
      : cause instanceof TypeError ? 'Feedback is unavailable right now. Please try again later.' : cause.message
  } finally {
    clearTimeout(timer)
    if (current === generation) busy.value = false
  }
}

function reset() {
  generation += 1
  controller?.abort()
  widget?.destroy()
  widget = null
  mounted.value = false
  busy.value = false
  error.value = ''
}
watch(visible, value => { if (!value) reset() })
onMounted(() => {
  unsubscribe = window.GoalmaticAuth?.onAuthChange?.(() => {
    if (widget) widget.update({ user: userContext() })
  })
})
onBeforeUnmount(() => { reset(); if (typeof unsubscribe === 'function') unsubscribe() })
</script>

<template>
  <div v-if="visible && !mounted" class="gm-product-feedback" :style="{ '--feedback-accent': brand.color }">
    <p v-if="error" class="gm-feedback-error" role="alert">{{ error }}<button type="button" aria-label="Dismiss feedback error" @click="error = ''">×</button></p>
    <button type="button" class="gm-feedback-launcher" :aria-label="`Give feedback on ${brand.name}`" :title="`Give feedback on ${brand.name}`" :disabled="busy" :aria-busy="busy" @click="open">
      <img v-if="!logoFailed" :src="brand.logoUrl" alt="" @error="logoFailed = true" />
      <span v-else aria-hidden="true">{{ brand.name.slice(0, 1) }}</span>
    </button>
    <span v-if="busy" class="gm-feedback-loading" role="status">Opening feedback…</span>
  </div>
</template>

<style scoped>
.gm-product-feedback{position:fixed;right:24px;bottom:max(24px,env(safe-area-inset-bottom));z-index:2147482999;font:14px/1.5 system-ui,sans-serif}
.gm-feedback-launcher{display:grid;place-items:center;width:56px;height:56px;padding:8px;border:0;border-radius:50%;background:var(--feedback-accent);color:#fff;box-shadow:0 4px 20px #142a2526;cursor:pointer}
.gm-feedback-launcher img{width:36px;height:36px;object-fit:contain;border-radius:8px}
.gm-feedback-launcher span{font-size:22px;font-weight:700}
.gm-feedback-launcher:focus-visible{outline:3px solid var(--feedback-accent);outline-offset:4px}
.gm-feedback-launcher:disabled{cursor:wait;opacity:.65}
.gm-feedback-error{position:absolute;right:0;bottom:68px;box-sizing:border-box;width:280px;max-width:calc(100vw - 32px);margin:0;padding:14px 34px 14px 14px;background:#fff;color:#782f36;border:1px solid #ebc8ce;border-radius:12px;box-shadow:0 4px 18px #142a2515}
.gm-feedback-error button{position:absolute;right:7px;top:7px;padding:4px 7px;border:0;background:transparent;color:inherit;font-size:20px;cursor:pointer}
.gm-feedback-loading{position:absolute;right:0;bottom:68px;white-space:nowrap;background:#fff;color:#18332f;padding:8px 12px;border:1px solid #dde8e5;border-radius:10px}
@media(max-width:850px){.gm-product-feedback{right:16px;bottom:calc(88px + env(safe-area-inset-bottom))}}
</style>
