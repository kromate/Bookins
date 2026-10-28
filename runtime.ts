import { computed, readonly, ref } from 'vue'
import { createDemoPlatform } from './demo/adapter.ts'
import { createDemoBoundary } from './demo/boundary.ts'

const MODE_KEY = 'bookins:owner-mode:v1'
const RETURN_ROUTE_KEY = 'bookins:live-return-route:v1'
const DEFAULT_ROUTE = '/'
const LOCAL_ROUTE = /^\/(?:services|availability|bookings|messages|insights|team|campaigns|contacts|settings)?(?:[?#].*)?$/

type DemoMode = 'live' | 'demo'
let memoryMode: DemoMode = 'live'
let memoryReturnRoute = DEFAULT_ROUTE
let modeCommitHandler: (() => Promise<unknown> | unknown) | null = null

const readSession = (key: string, fallback: string) => {
  try {
    return globalThis.sessionStorage?.getItem(key) || fallback
  } catch {
    return fallback
  }
}

const writeSession = (key: string, value: string) => {
  try {
    globalThis.sessionStorage?.setItem(key, value)
  } catch {
    // The in-memory value remains available when tab storage is unavailable.
  }
}

const validRoute = (value: unknown) => (typeof value === 'string' && LOCAL_ROUTE.test(value) ? value : DEFAULT_ROUTE)

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

export const runOwnerCall = <T>(name: string, liveCall: () => Promise<T> | T, args: unknown[] = []): Promise<T> =>
  boundary.invokeOwner(name, liveCall, () => {
    const method: unknown = Reflect.get(getDemoOwner(), name)
    if (typeof method !== 'function') throw new Error(`Demo operation ${name} is unavailable.`)
    return Reflect.apply(method, getDemoOwner(), args) as Promise<T> | T
  })

export const registerDemoGuard = boundary.registerGuard

export const registerModeCommitHandler = (handler: (() => Promise<unknown> | unknown) | null | undefined) => {
  modeCommitHandler = typeof handler === 'function' ? handler : null
  return () => {
    if (modeCommitHandler === handler) modeCommitHandler = null
  }
}

export const rememberLiveRoute = (route: unknown) => {
  memoryReturnRoute = validRoute(route)
  writeSession(RETURN_ROUTE_KEY, memoryReturnRoute)
  return memoryReturnRoute
}

export const liveReturnRoute = () => memoryReturnRoute

export const setDemoMode = async (enabled: boolean) => {
  const next: DemoMode = enabled === true ? 'demo' : 'live'
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
