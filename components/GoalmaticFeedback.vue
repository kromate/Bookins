<script setup lang="ts">
// Generated from Feedback Studio's shared integration. Update it with sync-app-feedback.mjs.
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import brand from '../feedback.config.json'
import { mountFeedbackWidget, postFeedback, sanitizePublicWidgetConfig } from './feedback-widget-runtime.facade.ts'
import type { FeedbackWidgetConfig, FeedbackWidgetHandle } from './feedback-widget-runtime.facade.ts'

const host = 'https://feedback-studio.apps.goalmatic.io'
const route = useRoute()
interface Discovery { widgetId: string; submissionUrl: string; config: FeedbackWidgetConfig }
type FeedbackPayload = UnknownRecord
const prepareLocal = inject<((context: { user: UnknownRecord | null }) => UnknownRecord | null) | null>('goalmaticFeedbackOptions', null)
const localConfig = inject<(() => UnknownRecord | null) | null>('goalmaticFeedbackConfig', null)
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

const record = (value: unknown): UnknownRecord | null => value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
function publicConfig(value: unknown): FeedbackWidgetConfig {
  return sanitizePublicWidgetConfig({ ...(record(value) ?? {}), delivery: 'builtin', capture: textOnlyCapture }, coldConfig)
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
let widget: FeedbackWidgetHandle | null = null
let discovery: Discovery | null = null
let discoveryPromise: Promise<Discovery | null> | null = null
let requestController: AbortController | null = null
let unsubscribe: (() => void) | void
let discoveryGeneration = 0
let lastDiscoveryAttempt = 0

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

function validatedDiscovery(value: unknown): Discovery {
  const item = record(value)
  if (!item || item.version !== 1 || !/^fw_[A-Za-z0-9_-]{43}$/.test(String(item.widgetId || '')))
    throw new Error('Feedback settings are unavailable right now.')
  const config = record(item.config)
  if (!config || config.delivery !== 'builtin') throw new Error('This App feedback receiver is not available.')
  const nextConfig = publicConfig(config)
  const widgetId = String(item.widgetId)
  const endpoint = new URL(String(item.submissionUrl || ''), host)
  if (endpoint.origin !== host || endpoint.pathname !== `/api/app-runtime/widgets/submit/${widgetId}` || endpoint.search || endpoint.hash)
    throw new Error('Feedback settings are unavailable right now.')
  return { widgetId, submissionUrl: endpoint.href, config: nextConfig }
}
function savePublicConfig(value: FeedbackWidgetConfig) {
  try { globalThis.localStorage?.setItem(cacheKey, JSON.stringify({ version: 1, config: value })) } catch { /* Public cache is optional. */ }
}

async function discover({ force = false, silent = true }: { force?: boolean; silent?: boolean } = {}): Promise<Discovery | null> {
  if (discovery && !force) return discovery
  if (discoveryPromise && !force) return discoveryPromise
  if (silent && !force && Date.now() - lastDiscoveryAttempt < 60_000) return discovery || null
  lastDiscoveryAttempt = Date.now()
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
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(String(record(body)?.message || 'Feedback settings could not be refreshed.'))
      const next = validatedDiscovery(body)
      if (generation !== discoveryGeneration || !visible.value) return null
      discovery = next
      discoveredConfig.value = next.config
      savePublicConfig(next.config)
      widget?.update({ config: effectiveConfig.value })
      return next
    } catch (cause) {
      if (generation !== discoveryGeneration) return null
      const causeRecord = record(cause)
      if (!silent) throw causeRecord?.name === 'AbortError'
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

async function submit(payload: FeedbackPayload) {
  const current = discovery || await discover({ silent: false })
  if (!current) throw new Error('Feedback settings could not be verified. Your draft is still here.')
  const endpoint = new URL(`/api/app-runtime/widgets/submit/${encodeURIComponent(current.widgetId)}`, host)
  if (endpoint.href !== current.submissionUrl) throw new Error('Feedback settings changed. Your draft is still here.')
  return postFeedback(endpoint.href, { ...payload, widgetId: current.widgetId }, 'builtin')
}

// Goalmatic vouches for the signed-in user, so feedback board links open already signed in.
async function goalmaticHandoff() {
  const response = await fetch('/api/app-runtime/visitor-identity', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ siteId: brand.siteId }),
  })
  if (!response.ok) return null
  const body = await response.json().catch(() => null)
  return typeof body?.token === 'string' ? body.token : null
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
      signIn: goalmaticHandoff,
      onOpen: () => {
        void discover()
        const user = userContext()
        const local = prepareLocal?.({ user })
        if (local && typeof local.then === 'function') throw new Error('The local feedback receiver must prepare synchronously.')
        return local || { config: effectiveConfig.value, user, onSubmit: submit, onAsk: null }
      },
    })
    // On phones the App's More menu owns the launcher, so it cannot cover page actions.
    const mobileStyle = document.createElement('style')
    mobileStyle.textContent = '@media (max-width:900px){.launcher{display:none!important}.panel{bottom:calc(76px + env(safe-area-inset-bottom));max-height:calc(100dvh - 100px)}}'
    widget.host.shadowRoot?.append(mobileStyle)
  } catch (cause) {
    widget?.destroy?.()
    widget = null
    error.value = cause instanceof Error ? cause.message : 'Feedback could not open.'
  }
}
defineExpose({ open: () => { mountReceiver(); widget?.open() } })

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
  else mountReceiver()
})
watch(effectiveConfig, value => widget?.update({ config: value }), { deep: true })
onMounted(() => {
  if (visible.value) mountReceiver()
  unsubscribe = window.GoalmaticAuth?.onAuthChange?.(() => widget?.update({ user: userContext() }))
})
onBeforeUnmount(() => {
  reset()
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
