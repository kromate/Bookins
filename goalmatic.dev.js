import { createApp, defineAsyncComponent } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './.goalmatic/tailwind.css'

const GOALMATIC_APP_SDK_URL = 'https://goalmatic.site/sdk/goalmatic-app-sdk-v1.js?v=1.3.1'
const goalmaticApiKey = String(import.meta.env.VITE_GOALMATIC_API_KEY || '').trim()
const goalmaticApiBase = String(import.meta.env.VITE_GOALMATIC_API_BASE_URL || '').trim()

function showRuntimeNotice(message, kind) {
  const notice = document.createElement('div')
  notice.dataset.goalmaticRuntimeNotice = kind
  notice.setAttribute('role', kind === 'error' ? 'alert' : 'status')
  notice.style.cssText = 'box-sizing:border-box;width:100%;padding:10px 16px;background:' + (kind === 'error' ? '#fef2f2' : '#fffbeb') + ';color:' + (kind === 'error' ? '#991b1b' : '#92400e') + ';font:500 13px/1.45 system-ui,sans-serif;text-align:center'
  notice.textContent = message
  document.body.prepend(notice)
}

function waitForGoalmaticSignIn(runtime) {
  if (runtime.context) return Promise.resolve()
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.dataset.goalmaticSignIn = 'required'
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:#f6f4fb;color:#17131f;font:14px/1.5 system-ui,sans-serif'
    const card = document.createElement('section')
    card.style.cssText = 'box-sizing:border-box;width:min(100%,420px);padding:28px;border:1px solid #e4deef;border-radius:24px;background:white;box-shadow:0 24px 80px rgba(49,31,85,.14);text-align:center'
    const title = document.createElement('h1')
    title.style.cssText = 'margin:0;font-size:22px'
    title.textContent = 'Connect this local App to Goalmatic'
    const copy = document.createElement('p')
    copy.style.cssText = 'margin:10px 0 20px;color:#746d80'
    copy.textContent = 'Sign in to choose a workspace, approve this App’s permissions, and use your shared credits.'
    const status = document.createElement('p')
    status.setAttribute('role', 'alert')
    status.style.cssText = 'min-height:21px;margin:0 0 12px;color:#991b1b'
    const button = document.createElement('button')
    button.type = 'button'
    button.style.cssText = 'min-height:44px;padding:0 18px;border:0;border-radius:12px;background:#5a32d6;color:white;font:700 14px system-ui,sans-serif;cursor:pointer'
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
        status.textContent = error instanceof Error ? error.message : 'Could not connect to Goalmatic.'
        button.disabled = false
        button.textContent = 'Try again'
      }
    })
    card.append(title, copy, status, button)
    overlay.append(card)
    document.body.append(overlay)
  })
}

async function configureGoalmaticRuntime() {
  if (!goalmaticApiKey) {
    showRuntimeNotice('Offline preview. Goalmatic account data and credits are not connected.', 'offline')
    return
  }
  const { initializeGoalmatic } = await import(/* @vite-ignore */ GOALMATIC_APP_SDK_URL)
  if (typeof initializeGoalmatic !== 'function') throw new Error('The Goalmatic SDK is missing initializeGoalmatic')
  const goalmaticRuntime = initializeGoalmatic(goalmaticApiBase
    ? { apiKey: goalmaticApiKey, apiBase: goalmaticApiBase }
    : { apiKey: goalmaticApiKey })
  await goalmaticRuntime.ready
  await waitForGoalmaticSignIn(goalmaticRuntime)
}

const pageModules = import.meta.glob('./pages/**/*.vue')
const componentModules = import.meta.glob('./components/**/*.vue')

function routeFromFile(file) {
  const segments = file.replace(/^\.\/pages\//, '').replace(/\.vue$/, '').split('/')
  const route = segments.flatMap((segment) => {
    if (/^index$/i.test(segment)) return []
    const catchAll = segment.match(/^\[\.\.\.(.+)\]$/)
    if (catchAll) return [':' + catchAll[1] + '(.*)*']
    const dynamic = segment.match(/^\[(.+)\]$/)
    if (dynamic) return [':' + dynamic[1]]
    return [segment.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()]
  }).join('/')
  return '/' + route
}

const routes = Object.entries(pageModules).map(([source, load]) => ({ path: routeFromFile(source), component: load }))
if (routes.some((route) => route.path === '/')) routes.push({ path: '/:pathMatch(.*)*', redirect: '/' })
async function start() {
  try {
    await configureGoalmaticRuntime()
  } catch {
    showRuntimeNotice('Goalmatic runtime could not start. Check VITE_GOALMATIC_API_KEY and its allowed origin.', 'error')
    return
  }
  const router = createRouter({ history: createWebHistory(), routes })
  const app = createApp(App)
  for (const [source, load] of Object.entries(componentModules)) {
    const name = source.split('/').pop().replace(/\.vue$/, '')
    app.component(name, defineAsyncComponent(load))
  }
  app.use(router)
  app.mount('#app')
}

void start()
