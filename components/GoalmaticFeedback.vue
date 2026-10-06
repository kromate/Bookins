<script setup>
// Generated from Feedback Studio's shared integration. Update it with sync-app-feedback.mjs.
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import brand from '../feedback.config.json'
import { mountFeedbackWidget, postFeedback, sanitizePublicWidgetConfig } from './feedback-widget-runtime.js'

const host = 'https://feedback-studio.apps.goalmatic.io'
const route = useRoute()
const prepareLocal = inject('goalmaticFeedbackOptions', null)
const localConfig = inject('goalmaticFeedbackConfig', null)
const error = ref('')
const visible = computed(() => !route.meta.public && !['/auth', '/_goalmatic', ...brand.excludedRoutes]
  .some(path => route.path === path || route.path.startsWith(`${path}/`)))
const textOnlyCapture = Object.freeze({ image: false, voice: false, video: false, screen: false, screenshot: false, element: false })
const coldConfig = sanitizePublicWidgetConfig({}, {
  title: `Help us improve ${brand.name}`,
  greeting: 'Share an idea, report a problem, or tell us what could work better.',
  accent: brand.color, logoUrl: brand.logoUrl, font: 'inherit', delivery: 'builtin', capture: textOnlyCapture,
})
const cacheKey = `goalmatic-feedback-config:${brand.siteId}`

function publicConfig(value) {
  return sanitizePublicWidgetConfig({ ...value, delivery: 'builtin', capture: textOnlyCapture }, coldConfig)
}
function cachedConfig() {
  try {
    const cached = JSON.parse(globalThis.localStorage?.getItem(cacheKey) || 'null')
    return cached?.version === 1 ? publicConfig(cached.config) : coldConfig
  } catch { return coldConfig }
}

const discoveredConfig = ref(cachedConfig())
const effectiveConfig = computed(() => {
  const local = typeof localConfig === 'function' ? localConfig() : null
  return local ? publicConfig(local) : discoveredConfig.value
})
let widget, discovery, discoveryPromise, requestController, unsubscribe, discoveryGeneration = 0

function userContext() {
  const user = window.GoalmaticAuth?.user
  if (!user) return null
  const details = {
    id: String(user.id || user.uid || '').trim().slice(0, 128),
    name: String(user.displayName || user.name || '').trim().slice(0, 80),
    email: String(user.email || '').trim().slice(0, 254),
  }
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value))
}

function validatedDiscovery(value) {
  if (!value || value.version !== 1 || !/^fw_[A-Za-z0-9_-]{43}$/.test(value.widgetId || ''))
    throw new Error('Feedback settings are unavailable right now.')
  if (!value.config || value.config.delivery !== 'builtin') throw new Error('This App feedback receiver is not available.')
  const nextConfig = publicConfig(value.config)
  const endpoint = new URL(value.submissionUrl || '', host)
  if (endpoint.origin !== host || endpoint.pathname !== `/api/app-runtime/widgets/submit/${value.widgetId}` || endpoint.search || endpoint.hash)
    throw new Error('Feedback settings are unavailable right now.')
  return { widgetId: value.widgetId, submissionUrl: endpoint.href, config: nextConfig }
}
function savePublicConfig(value) {
  try { globalThis.localStorage?.setItem(cacheKey, JSON.stringify({ version: 1, config: value })) } catch { /* Public cache is optional. */ }
}

async function discover({ force = false, silent = true } = {}) {
  if (discovery && !force) return discovery
  if (discoveryPromise && !force) return discoveryPromise
  if (force) {
    discoveryGeneration += 1
    requestController?.abort()
    requestController = null
    discoveryPromise = null
  }
  const generation = ++discoveryGeneration
  const controller = new AbortController()
  requestController = controller
  const promise = (async () => {
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(`${host}/api/app-runtime/widgets/apps/${encodeURIComponent(brand.siteId)}`, {
        cache: 'no-cache', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || 'Feedback settings could not be refreshed.')
      const next = validatedDiscovery(body)
      if (generation !== discoveryGeneration || !visible.value) return null
      discovery = next
      discoveredConfig.value = next.config
      savePublicConfig(next.config)
      widget?.update({ config: effectiveConfig.value })
      return next
    } catch (cause) {
      if (generation !== discoveryGeneration) return null
      if (!silent) throw cause?.name === 'AbortError'
        ? new Error('Feedback settings took too long to refresh. Try sending again.')
        : cause instanceof TypeError ? new Error('Feedback could not connect. Check your connection and try again.') : cause
      return null
    } finally {
      clearTimeout(timer)
      if (generation === discoveryGeneration) {
        if (requestController === controller) requestController = null
        discoveryPromise = null
      }
    }
  })()
  discoveryPromise = promise
  return promise
}

async function submit(payload) {
  const current = discovery || await discover({ silent: false })
  if (!current) throw new Error('Feedback settings could not be verified. Your draft is still here.')
  const endpoint = new URL(`/api/app-runtime/widgets/submit/${encodeURIComponent(current.widgetId)}`, host)
  if (endpoint.href !== current.submissionUrl) throw new Error('Feedback settings changed. Your draft is still here.')
  return postFeedback(endpoint.href, { ...payload, widgetId: current.widgetId }, 'builtin')
}

function mountReceiver() {
  if (widget || !visible.value) return
  error.value = ''
  try {
    widget = mountFeedbackWidget({
      config: effectiveConfig.value,
      user: userContext(),
      widgetId: discovery?.widgetId || '',
      onSubmit: submit,
      onOpen: () => {
        const user = userContext()
        const local = prepareLocal?.({ user })
        if (local && typeof local.then === 'function') throw new Error('The local feedback receiver must prepare synchronously.')
        return local || { config: effectiveConfig.value, user, onSubmit: submit, onAsk: null }
      },
    })
  } catch (cause) {
    widget?.destroy?.()
    widget = null
    error.value = cause?.message || 'Feedback could not open.'
  }
}
function refreshDiscovery() { if (visible.value) void discover({ force: true }) }
function reset() {
  discoveryGeneration += 1
  requestController?.abort()
  requestController = null
  discoveryPromise = null
  widget?.destroy()
  widget = null
  error.value = ''
}

watch(visible, value => {
  if (!value) reset()
  else { void discover({ force: true }); mountReceiver() }
})
watch(effectiveConfig, value => widget?.update({ config: value }), { deep: true })
onMounted(() => {
  if (visible.value) { void discover(); mountReceiver() }
  window.addEventListener('focus', refreshDiscovery)
  unsubscribe = window.GoalmaticAuth?.onAuthChange?.(() => widget?.update({ user: userContext() }))
})
onBeforeUnmount(() => {
  reset()
  window.removeEventListener('focus', refreshDiscovery)
  if (typeof unsubscribe === 'function') unsubscribe()
})
</script>

<template>
  <div v-if="visible && error" class="gm-feedback-error" role="alert">
    {{ error }}
    <button type="button" @click="mountReceiver">Try again</button>
  </div>
</template>

<style scoped>
.gm-feedback-error{position:fixed;right:16px;bottom:16px;z-index:2147482999;box-sizing:border-box;width:300px;max-width:calc(100vw - 32px);padding:14px;background:#fff;color:#782f36;border:1px solid #ebc8ce;border-radius:12px;box-shadow:0 4px 18px #142a2515;font:14px/1.5 system-ui,sans-serif}
.gm-feedback-error button{display:block;margin-top:10px;padding:7px 10px;border:1px solid currentColor;border-radius:8px;background:transparent;color:inherit;font:inherit;font-weight:700;cursor:pointer}
</style>
