import { computed, readonly, ref } from 'vue'
import { createDemoPlatform } from './demo/adapter.js'
import { createDemoBoundary } from './demo/boundary.js'

const MODE_KEY = 'bookins:owner-mode:v1'
const RETURN_ROUTE_KEY = 'bookins:live-return-route:v1'
const DEFAULT_ROUTE = '/'
const LOCAL_ROUTE = /^\/(?:services|availability|bookings|messages|insights|team|campaigns|contacts|settings)?(?:[?#].*)?$/

let memoryMode = 'live'
let memoryReturnRoute = DEFAULT_ROUTE
let modeCommitHandler = null

const readSession = (key, fallback) => {
  try {
    return globalThis.sessionStorage?.getItem(key) || fallback
  } catch {
    return fallback
  }
}

const writeSession = (key, value) => {
  try {
    globalThis.sessionStorage?.setItem(key, value)
  } catch {
    // The in-memory value remains available when tab storage is unavailable.
  }
}

const validRoute = (value) => (typeof value === 'string' && LOCAL_ROUTE.test(value) ? value : DEFAULT_ROUTE)

memoryMode = readSession(MODE_KEY, memoryMode) === 'demo' ? 'demo' : 'live'
memoryReturnRoute = validRoute(readSession(RETURN_ROUTE_KEY, memoryReturnRoute))

let activeDemo = createDemoPlatform()
const boundary = createDemoBoundary({ initialMode: memoryMode })

export const mode = boundary.mode
export const isDemo = computed(() => boundary.mode.value === 'demo')
const demoSwitchingState = ref(false)
export const demoSwitching = readonly(demoSwitchingState)
export const demoSwitchError = computed(() => boundary.switchError.value)
export const pendingLive = boundary.pendingLive
export const uncertainLiveWrite = boundary.uncertainLiveWrite

export const getDemoOwner = () => activeDemo.owner
export const getDemoGuest = () => activeDemo.guest

export const runOwnerCall = (name, liveCall, args = []) =>
  boundary.invokeOwner(name, liveCall, () => getDemoOwner()[name](...args))

export const registerDemoGuard = boundary.registerGuard

export const registerModeCommitHandler = (handler) => {
  modeCommitHandler = typeof handler === 'function' ? handler : null
  return () => {
    if (modeCommitHandler === handler) modeCommitHandler = null
  }
}

export const rememberLiveRoute = (route) => {
  memoryReturnRoute = validRoute(route)
  writeSession(RETURN_ROUTE_KEY, memoryReturnRoute)
  return memoryReturnRoute
}

export const liveReturnRoute = () => memoryReturnRoute

export const setDemoMode = async (enabled) => {
  const next = enabled === true ? 'demo' : 'live'
  if (demoSwitchingState.value) return false
  if (!boundary.switchMode(next)) return false
  if (next === 'demo') activeDemo = createDemoPlatform()
  writeSession(MODE_KEY, next)
  demoSwitchingState.value = true
  try {
    const loading = modeCommitHandler?.()
    if (loading) await loading
    return true
  } finally {
    demoSwitchingState.value = false
  }
}
