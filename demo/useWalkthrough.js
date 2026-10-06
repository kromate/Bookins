import { reactive, readonly } from 'vue'

export function createWalkthrough({ steps, routes, navigate, timeoutMs = 5000 }) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 50 || !Array.isArray(routes) || typeof navigate !== 'function') throw new Error('A walkthrough needs steps, known routes and a navigation adapter')
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('Walkthrough timeout must be between 100 and 30000ms')
  const ids = new Set()
  const checked = steps.map(step => {
    if (!step || typeof step.id !== 'string' || !/^[a-z0-9-]+$/.test(step.id) || ids.has(step.id)) throw new Error('Walkthrough step IDs must be unique lowercase words')
    ids.add(step.id)
    if (typeof step.route !== 'string' || !step.route.startsWith('/') || step.route.startsWith('//') || !routes.includes(step.route)) throw new Error('Walkthrough step must reference a known local route')
    for (const field of ['title', 'explanation', 'expected']) if (typeof step[field] !== 'string' || !step[field].trim() || step[field].length > 2000) throw new Error(`Walkthrough step needs ${field}`)
    if (step.targetId !== undefined && !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(step.targetId)) throw new Error('Walkthrough target must be a stable ID, not a selector')
    return Object.freeze({ ...step })
  })
  const state = reactive({ open: false, index: 0, status: 'idle', error: '' })
  let generation = 0
  let active = null
  let timer = null
  function cancel() {
    generation++
    clearTimeout(timer)
    timer = null
    active?.abort()
    active = null
  }
  async function move(index) {
    if (!Number.isInteger(index) || index < 0 || index >= checked.length) return false
    cancel()
    const ticket = generation
    const controller = new AbortController()
    active = controller
    state.open = true
    state.index = index
    state.status = 'loading'
    state.error = ''
    try {
      await Promise.race([
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw new Error('Navigation cancelled')
          return navigate(checked[index], { signal: controller.signal })
        }),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Page readiness timed out')) }, timeoutMs) }),
        new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Navigation cancelled')), { once: true })),
      ])
      if (ticket !== generation) return false
      state.status = 'ready'
      return true
    } catch {
      if (ticket !== generation) return false
      state.status = 'error'
      state.error = 'This page is not ready. You can retry, read the explanation, or skip the tour.'
      return false
    } finally {
      if (ticket === generation) { clearTimeout(timer); timer = null; active = null }
    }
  }
  function close() { cancel(); state.open = false; state.status = 'idle'; state.error = '' }
  return {
    state: readonly(state), steps: Object.freeze(checked),
    start: () => move(0), restart: () => move(0), retry: () => move(state.index),
    next: () => state.status === 'loading' ? Promise.resolve(false) : move(state.index + 1),
    back: () => state.status === 'loading' ? Promise.resolve(false) : move(state.index - 1),
    close, dispose: close,
  }
}
