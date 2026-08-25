import { createApp, defineAsyncComponent } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import './.goalmatic/tailwind.css'

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
const router = createRouter({ history: createWebHashHistory(), routes })
const app = createApp(App)
for (const [source, load] of Object.entries(componentModules)) {
  const name = source.split('/').pop().replace(/\.vue$/, '')
  app.component(name, defineAsyncComponent(load))
}
app.use(router)
app.mount('#app')
