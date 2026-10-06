import { createApp, defineAsyncComponent } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './.goalmatic/tailwind.css'

const GOALMATIC_APP_SDK_URL = 'https://goalmatic.site/sdk/goalmatic-app-sdk-v1.js?v=1.5.1'
const goalmaticApiKey = String(import.meta.env.VITE_GOALMATIC_API_KEY || '').trim()
const goalmaticApiBase = String(import.meta.env.VITE_GOALMATIC_API_BASE_URL || '').trim()

function showRuntimeNotice(message, kind) {
  const notice = document.createElement('div')
  notice.dataset.goalmaticRuntimeNotice = kind
  notice.setAttribute('role', kind === 'error' ? 'alert' : 'status')
  notice.style.cssText =
    'box-sizing:border-box;width:100%;padding:10px 16px;background:' +
    (kind === 'error' ? '#fef2f2' : '#fffbeb') +
    ';color:' +
    (kind === 'error' ? '#991b1b' : '#92400e') +
    ';font:500 13px/1.45 system-ui,sans-serif;text-align:center'
  notice.textContent = message
  document.body.prepend(notice)
}

function createGoalmaticRuntimeOverlay() {
  const overlay = document.createElement('div')
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:#f6f4fb;color:#17131f;font:14px/1.5 system-ui,sans-serif'
  return overlay
}

function createGoalmaticRuntimeCard() {
  const card = document.createElement('section')
  card.style.cssText =
    'box-sizing:border-box;width:min(100%,420px);padding:28px;border:1px solid #e4deef;border-radius:24px;background:white;box-shadow:0 24px 80px rgba(49,31,85,.14);text-align:center'
  return card
}

function showGoalmaticRuntimeError(message) {
  const overlay =
    document.querySelector('[data-goalmatic-runtime-loading]') || createGoalmaticRuntimeOverlay()
  delete overlay.dataset.goalmaticRuntimeLoading
  delete overlay.dataset.goalmaticSignIn
  overlay.dataset.goalmaticRuntimeError = 'failed'
  overlay.setAttribute('role', 'alert')
  overlay.setAttribute('aria-live', 'assertive')
  overlay.removeAttribute('aria-busy')
  const card = createGoalmaticRuntimeCard()
  const mark = document.createElement('div')
  mark.setAttribute('aria-hidden', 'true')
  mark.style.cssText =
    'display:grid;width:38px;height:38px;margin:0 auto 18px;place-items:center;border-radius:999px;background:#fef2f2;color:#b42318;font:800 20px/1 system-ui,sans-serif'
  mark.textContent = '!'
  const title = document.createElement('h1')
  title.style.cssText = 'margin:0;font-size:22px'
  title.textContent = 'Goalmatic could not connect'
  const copy = document.createElement('p')
  copy.style.cssText = 'margin:10px 0 20px;color:#746d80'
  copy.textContent = message
  const button = document.createElement('button')
  button.type = 'button'
  button.style.cssText =
    'min-height:44px;padding:0 18px;border:0;border-radius:12px;background:#5a32d6;color:white;font:700 14px system-ui,sans-serif;cursor:pointer'
  button.textContent = 'Try again'
  button.addEventListener('click', () => window.location.reload())
  card.append(mark, title, copy, button)
  overlay.replaceChildren(card)
  if (!overlay.isConnected) document.body.append(overlay)
  button.focus()
}

function waitForGoalmaticSignIn(runtime) {
  const overlay =
    document.querySelector('[data-goalmatic-runtime-loading]') || createGoalmaticRuntimeOverlay()
  if (runtime.context) {
    overlay.remove()
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let unsubscribe = () => {}
    unsubscribe = runtime.subscribe((state) => {
      if (state.status === 'ready') {
        overlay.remove()
        unsubscribe()
        resolve()
      }
    })
    delete overlay.dataset.goalmaticRuntimeLoading
    overlay.dataset.goalmaticSignIn = 'required'
    overlay.removeAttribute('role')
    overlay.removeAttribute('aria-live')
    overlay.removeAttribute('aria-busy')
    const card = createGoalmaticRuntimeCard()
    const title = document.createElement('h1')
    title.style.cssText = 'margin:0;font-size:22px'
    title.textContent = 'Connect this local App to Goalmatic'
    const copy = document.createElement('p')
    copy.style.cssText = 'margin:10px 0 20px;color:#746d80'
    copy.textContent =
      'Sign in to choose a workspace, approve this App’s permissions, and use your shared credits.'
    const status = document.createElement('p')
    status.setAttribute('role', 'alert')
    status.style.cssText = 'min-height:21px;margin:0 0 12px;color:#991b1b'
    const button = document.createElement('button')
    button.type = 'button'
    button.style.cssText =
      'min-height:44px;padding:0 18px;border:0;border-radius:12px;background:#5a32d6;color:white;font:700 14px system-ui,sans-serif;cursor:pointer'
    button.textContent = 'Connect to Goalmatic'
    button.addEventListener('click', async () => {
      button.disabled = true
      button.textContent = 'Connecting…'
      status.textContent = ''
      try {
        await runtime.signIn()
        overlay.remove()
        resolve()
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : 'Could not connect to Goalmatic.'
        button.disabled = false
        button.textContent = 'Try again'
      }
    })
    card.append(title, copy, status, button)
    overlay.replaceChildren(card)
    if (!overlay.isConnected) document.body.append(overlay)
    button.focus()
  })
}

async function waitForGoalmaticRuntimeReady(goalmaticRuntime) {
  let timeoutId = 0
  try {
    await Promise.race([
      (async () => await goalmaticRuntime.ready)(),
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(
          () =>
            reject(
              new Error(
                'Goalmatic is taking longer than expected. Check your connection and try again.',
              ),
            ),
          15000,
        )
      }),
    ])
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function configureGoalmaticRuntime() {
  if (window.GoalmaticApp?.execute && window.GoalmaticAuth?.config?.installationAuth) return null
  if (!goalmaticApiKey) {
    showRuntimeNotice(
      'Offline preview. Goalmatic account data and credits are not connected.',
      'offline',
    )
    return null
  }
  const { initializeGoalmatic } = await import(/* @vite-ignore */ GOALMATIC_APP_SDK_URL)
  if (typeof initializeGoalmatic !== 'function')
    throw new Error('The Goalmatic SDK is missing initializeGoalmatic')
  return initializeGoalmatic(
    goalmaticApiBase
      ? { apiKey: goalmaticApiKey, apiBase: goalmaticApiBase }
      : { apiKey: goalmaticApiKey },
  )
}

async function settleGoalmaticRuntime(goalmaticRuntime) {
  if (!goalmaticRuntime) return
  try {
    await waitForGoalmaticRuntimeReady(goalmaticRuntime)
    await waitForGoalmaticSignIn(goalmaticRuntime)
  } catch (error) {
    showRuntimeNotice(
      error instanceof Error
        ? error.message
        : 'Goalmatic could not restore this local App session.',
      'error',
    )
  }
}

const pageModules = import.meta.glob('./pages/**/*.vue')
const componentModules = import.meta.glob('./components/**/*.vue')
const demoGuestSource = './pages/demo/guest.vue'

function routeFromFile(file) {
  const segments = file
    .replace(/^\.\/pages\//, '')
    .replace(/\.vue$/, '')
    .split('/')
  const route = segments
    .flatMap((segment) => {
      if (/^index$/i.test(segment)) return []
      const catchAll = segment.match(/^\[\.\.\.(.+)\]$/)
      if (catchAll) return [':' + catchAll[1] + '(.*)*']
      const dynamic = segment.match(/^\[(.+)\]$/)
      if (dynamic) return [':' + dynamic[1]]
      return [segment.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()]
    })
    .join('/')
  return '/' + route
}

const routes = Object.entries(pageModules).filter(([source]) => source !== demoGuestSource).map(([source, load]) => ({
  path: routeFromFile(source),
  component: load,
}))
if (pageModules[demoGuestSource]) routes.push({ path: '/demo/guest', component: pageModules[demoGuestSource] })
if (routes.some((route) => route.path === '/'))
  routes.push({ path: '/:pathMatch(.*)*', redirect: '/' })
async function start() {
  let goalmaticRuntime = null
  try {
    goalmaticRuntime = await configureGoalmaticRuntime()
  } catch {
    showRuntimeNotice(
      'Goalmatic runtime could not start. Check VITE_GOALMATIC_API_KEY and its allowed origin.',
      'error',
    )
    return
  }
  const router = createRouter({ history: createWebHistory(), routes })
  const app = createApp(App)
  for (const [source, load] of Object.entries(componentModules)) {
    const name = source
      .split('/')
      .pop()
      .replace(/\.vue$/, '')
    app.component(name, defineAsyncComponent(load))
  }
  app.use(router)
  await settleGoalmaticRuntime(goalmaticRuntime)
  app.mount('#app')
}

void start()
