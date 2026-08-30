import { createApp, defineAsyncComponent } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './.goalmatic/tailwind.css'

const GOALMATIC_APP_SDK_URL = 'https://goalmatic.site/sdk/goalmatic-app-sdk-v1.js'
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
