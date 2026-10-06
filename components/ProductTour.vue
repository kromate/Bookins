<script setup>
// One tour panel for both modes: Demo (sample data, guide steps) and Live (owner workspace, read-only highlights).
// Also renders the one-time "New to Bookins?" offer in Live. Start it with `inject('startTour')()` or the exposed start().
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import GmWalkthrough from './ui/GmWalkthrough.vue'
import { createWalkthrough } from '../demo/useWalkthrough.js'
import { demoGuideRoutes, demoGuideSteps, liveGuideRoutes, liveGuideSteps } from '../demo/guide.js'
import { isDemo } from '../runtime.js'
import { useSetupState } from '../setup.js'

const SEEN_KEY = 'bookins:tour-seen:v1'
const route = useRoute()
const router = useRouter()
const loaded = inject('bookingLoaded')
const workspace = inject('bookingState')
const setup = useSetupState(workspace)
const panelHost = ref(null)
const offerVisible = ref(false)

function readSeen() {
  try { return globalThis.localStorage?.getItem(SEEN_KEY) === '1' } catch { return false }
}
function writeSeen() {
  try { globalThis.localStorage?.setItem(SEEN_KEY, '1') } catch { /* storage unavailable: offer may repeat, tour still works */ }
}

// ---- anchors -------------------------------------------------------------
const isVisible = element => {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth
}
function findAnchor(id) {
  const matches = [...document.querySelectorAll(`[data-tour="${id}"]`)]
  const byId = document.getElementById(id)
  if (byId && !matches.includes(byId)) matches.push(byId)
  return matches.find(isVisible) || null
}
function waitForAnchor(id, signal, timeout = 1500) {
  return new Promise(resolve => {
    let observer, timer
    const done = value => { observer?.disconnect(); clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(value) }
    const abort = () => done(null)
    const check = () => { const found = findAnchor(id); if (found) done(found) }
    observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    timer = setTimeout(() => done(null), timeout)
    signal.addEventListener('abort', abort, { once: true })
    check()
  })
}
let highlighted = null
function clearHighlight() {
  highlighted?.classList.remove('bookins-tour-target')
  highlighted = null
  setPanelStyle()
  panelDock.value = ''
  document.body.style.removeProperty('--tour-pad')
}
// ---- panel placement -------------------------------------------------------
// The panel must never cover the highlighted target. Desktop: float beside/below/above the target (viewport-clamped),
// scrolling the target into the free region when nothing fits. Mobile: dock to the screen edge farther from the target.
const PAD = 12 // outline (3px) + offset (6px) + breathing room
const EDGE = 16
const panelDock = ref('')
const isNarrow = () => window.matchMedia('(max-width: 900px)').matches
const instantScroll = top => window.scrollTo({ top: Math.max(0, top), behavior: 'instant' })
function stickyTop() {
  const bar = document.querySelector('.topbar')
  if (!bar || getComputedStyle(bar).position !== 'sticky') return 0
  return Math.max(0, bar.getBoundingClientRect().bottom)
}
const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
function padded(rect) {
  return { left: rect.left - PAD, right: rect.right + PAD, top: rect.top - PAD, bottom: rect.bottom + PAD }
}
const MIN_SIDE_WIDTH = 300
// Pure: where could a panel go on desktop without touching the padded target? `heightFor(width)` measures the panel at a
// width (side placements may narrow it). Returns null when nothing fits.
function desktopPlacement(rect, maxWidth, heightFor, vw, vh, top) {
  const t = padded(rect)
  const options = []
  const rightRoom = vw - EDGE - (t.right + 8)
  const leftRoom = t.left - 8 - EDGE
  for (const [name, room] of [['right', rightRoom], ['left', leftRoom]]) {
    const width = Math.min(maxWidth, Math.floor(room))
    if (width < MIN_SIDE_WIDTH) continue
    const height = heightFor(width)
    const y = Math.min(Math.max(rect.top, top + 8), Math.max(top + 8, vh - height - EDGE))
    options.push({ name, width, height, left: name === 'right' ? t.right + 8 : t.left - 8 - width, top: y })
  }
  const height = heightFor(maxWidth)
  const x = Math.min(Math.max(rect.left, EDGE), Math.max(EDGE, vw - maxWidth - EDGE))
  options.push({ name: 'below', width: maxWidth, height, left: x, top: t.bottom + 8 })
  options.push({ name: 'above', width: maxWidth, height, left: x, top: t.top - 8 - height })
  for (const o of options) {
    const box = { left: o.left, top: o.top, right: o.left + o.width, bottom: o.top + o.height }
    const inside = box.left >= EDGE - 1 && box.right <= vw - EDGE + 1 && box.top >= top + 7 && box.bottom <= vh - EDGE + 1
    if (inside && !intersects(box, t)) return o
  }
  return null
}
const PANEL_KEYS = ['left', 'top', 'right', 'bottom', 'width', 'maxHeight']
function setPanelStyle(values = {}) {
  const el = panelHost.value
  if (!el) return
  for (const key of PANEL_KEYS) el.style[key] = values[key] ?? ''
}
function applyDesktop(o, vh, top) {
  panelDock.value = ''
  setPanelStyle({ left: `${Math.round(o.left)}px`, top: `${Math.round(o.top)}px`, right: 'auto', bottom: 'auto', width: `${Math.round(o.width)}px`, maxHeight: `${vh - top - 24}px` })
}
function panelBox() {
  const el = panelHost.value
  return el ? el.getBoundingClientRect() : null
}
function overlapsPanel(element) {
  const box = panelBox()
  return Boolean(box && intersects(box, padded(element.getBoundingClientRect())))
}
// Bring the target fully on screen: centred when it fits, otherwise its top just under the sticky header.
function showTarget(element, top, vh) {
  const rect = element.getBoundingClientRect()
  const free = vh - top
  const wanted = rect.height + 2 * PAD <= free ? top + (free - rect.height) / 2 : top + PAD + 4
  instantScroll(window.scrollY + rect.top - wanted)
}
const inView = (rect, top, vh) => rect.top >= top - 1 && rect.bottom <= vh + 1
// A target too tall to show beside the panel: highlight its first meaningful part instead of the whole block.
function narrowTarget(element) {
  const own = element.getBoundingClientRect().height
  let node = element
  for (let depth = 0; depth < 6 && node; depth++) {
    const all = [...node.children].filter(child => { const r = child.getBoundingClientRect(); return r.width >= 40 && r.height >= 40 })
    const kids = all.filter(child => child.getBoundingClientRect().height < own - 8)
    const pick = kids.find(child => child.getBoundingClientRect().height >= 80) || kids[0]
    if (pick) return pick
    node = all[0] || null // a wrapper as tall as the target itself: look inside it
  }
  return null
}
function moveHighlight(next) {
  highlighted?.classList.remove('bookins-tour-target')
  highlighted = next
  next.classList.add('bookins-tour-target')
}
// Returns true when the (whole) target is on screen and clear of the panel.
async function layoutMobile(element, scroll, top, vh) {
  setPanelStyle()
  const place = async dock => {
    panelDock.value = dock
    await nextTick()
    const box = panelBox()
    const ph = box ? box.height : 0
    document.body.style.setProperty('--tour-pad', `${Math.round(ph + 32)}px`)
    if (!scroll) return
    const regionA = (dock === 'top' ? ph + 16 : top + 8) + PAD
    const regionB = (dock === 'bottom' ? vh - ph - 12 : vh - 8) - PAD
    const rect = element.getBoundingClientRect()
    const wanted = rect.height <= regionB - regionA ? regionA + (regionB - regionA - rect.height) / 2 : regionA
    instantScroll(window.scrollY + rect.top - wanted)
    await nextTick()
  }
  const ok = () => !overlapsPanel(element) && inView(element.getBoundingClientRect(), top, vh)
  const rect = element.getBoundingClientRect()
  const first = rect.top + rect.height / 2 > vh / 2 ? 'top' : 'bottom'
  await place(first)
  if (!scroll || ok()) return true
  await place(first === 'top' ? 'bottom' : 'top')
  return ok()
}
function layoutDesktop(element, scroll, vw, vh, top, final) {
  const host = panelHost.value
  panelDock.value = ''
  const maxWidth = Math.min(400, vw - 2 * EDGE)
  const heightFor = width => {
    host.style.width = `${width}px`
    host.style.maxHeight = `${vh - top - 24}px`
    return Math.min(host.offsetHeight, vh - top - 24)
  }
  document.body.style.setProperty('--tour-pad', `${Math.round(heightFor(maxWidth) + 48)}px`)
  const fitHere = () => {
    const rect = element.getBoundingClientRect()
    if (scroll && !inView(rect, top, vh)) return null // the whole target must be on screen, not just clear of the panel
    return desktopPlacement(rect, maxWidth, heightFor, vw, vh, top)
  }
  const search = () => {
    let found
    if (scroll) {
      showTarget(element, top, vh)
      found = fitHere()
      if (!found) {
        // Panel below: push the target to the top. Panel above: push it to the bottom.
        instantScroll(window.scrollY + element.getBoundingClientRect().top - (top + PAD + 4))
        found = fitHere()
        if (!found) {
          instantScroll(window.scrollY + element.getBoundingClientRect().bottom - (vh - PAD - 4))
          found = fitHere()
        }
      }
    } else found = fitHere()
    return found
  }
  host.classList.remove('tour-panel--compact')
  let spot = search()
  if (!spot) {
    // Tight on space: a shorter panel (no progress bar or reassurance line) may clear the target.
    host.classList.add('tour-panel--compact')
    spot = search()
    if (!spot) host.classList.remove('tour-panel--compact')
  }
  if (spot) { applyDesktop(spot, vh, top); return true }
  if (!final) return false
  // Nothing clears the target even so: park the panel at the emptier end of the screen.
  if (scroll) showTarget(element, top, vh)
  const rect = element.getBoundingClientRect()
  const height = heightFor(maxWidth)
  const toBottom = vh - rect.bottom >= rect.top - top
  applyDesktop({ left: Math.max(EDGE, vw - maxWidth - EDGE), top: toBottom ? vh - height - EDGE : top + 8, width: maxWidth }, vh, top)
  return false
}
// scroll = false: only reposition (resize / user scroll). scroll = true: also move the target into free space.
async function layout(scroll) {
  if (!highlighted || !panelHost.value) { setPanelStyle(); panelDock.value = ''; return }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const top = stickyTop()
  const narrow = isNarrow()
  for (let attempt = 0; attempt < 7; attempt++) {
    const element = highlighted
    const child = scroll ? narrowTarget(element) : null
    const final = !child || attempt === 6
    const ok = narrow ? await layoutMobile(element, scroll, top, vh) : layoutDesktop(element, scroll, vw, vh, top, final)
    if (ok || !scroll || !child || attempt === 6) return
    moveHighlight(child)
  }
}
let layoutQueued = false
function queueLayout(scroll = false) {
  if (layoutQueued && !scroll) return
  layoutQueued = true
  requestAnimationFrame(() => { layoutQueued = false; layout(scroll) })
}
async function reveal(element) {
  clearHighlight()
  highlighted = element
  element.classList.add('bookins-tour-target')
  await nextTick()
  await layout(true)
  await nextTick()
  if (highlighted === element) await layout(false)
}
let resizeObserver
let lastPanelHeight = 0
watch(panelHost, el => {
  resizeObserver?.disconnect()
  lastPanelHeight = 0
  if (!el || typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => {
    const height = el.offsetHeight
    if (Math.abs(height - lastPanelHeight) < 2) return
    lastPanelHeight = height
    if (highlighted) queueLayout(true)
  })
  resizeObserver.observe(el)
})
const onViewportChange = () => { if (highlighted) queueLayout(false) }
const onResize = () => { if (highlighted) queueLayout(true) }

// ---- demo ----------------------------------------------------------------
const waitForGuestPreview = (signal) => new Promise((resolve, reject) => {
  const finish = () => {
    observer?.disconnect()
    signal.removeEventListener('abort', abort)
  }
  const abort = () => {
    finish()
    reject(new Error('Demo ended'))
  }
  const check = () => {
    if (signal.aborted || !isDemo.value) return abort()
    if (document.querySelector('[data-demo-guest-ready="true"]')) {
      finish()
      resolve()
    }
  }
  const observer = new MutationObserver(check)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true })
  signal.addEventListener('abort', abort, { once: true })
  check()
})

const demoGuide = createWalkthrough({
  steps: demoGuideSteps,
  routes: demoGuideRoutes,
  navigate: async (step, { signal }) => {
    if (signal.aborted || !isDemo.value) throw new Error('Demo ended')
    if (router.currentRoute.value.path !== step.route) {
      const failure = await router.push(step.route)
      if (failure) throw new Error('Page navigation cancelled')
    }
    if (signal.aborted || !isDemo.value) throw new Error('Page navigation cancelled')
    await nextTick()
    if (step.route === '/demo/guest') await waitForGuestPreview(signal)
    if (
      signal.aborted ||
      !isDemo.value ||
      route.path !== step.route ||
      (step.route !== '/demo/guest' && loaded?.value !== true)
    )
      throw new Error('Sample page is not ready')
  },
})

// ---- live ----------------------------------------------------------------
const liveGuide = createWalkthrough({
  steps: liveGuideSteps,
  routes: liveGuideRoutes,
  navigate: async (step, { signal }) => {
    if (signal.aborted || isDemo.value) throw new Error('Tour ended')
    clearHighlight()
    if (router.currentRoute.value.path !== step.route) {
      const failure = await router.push(step.route)
      if (failure) throw new Error('Page navigation cancelled')
    }
    await nextTick()
    if (signal.aborted || isDemo.value || route.path !== step.route || loaded?.value !== true) throw new Error('Page is not ready')
    const target = await waitForAnchor(step.targetId, signal)
    if (signal.aborted) throw new Error('Tour ended')
    if (!target) throw Object.assign(new Error(`No tour anchor ${step.targetId} on ${step.route}`), { skipStep: true })
    await reveal(target)
  },
})

const guide = computed(() => (isDemo.value ? demoGuide : liveGuide))
const current = computed(() => guide.value.steps[guide.value.state.index])
const extra = computed(() => {
  const step = current.value
  if (isDemo.value || !step) return null
  if (step.requires === 'availability' && !setup.value.hasAvailability) {
    return { note: 'You have not set your availability yet. Set it first, then create services.', action: { label: 'Go to Availability', to: '/availability' } }
  }
  return null
})

async function start() {
  writeSeen()
  offerVisible.value = false
  await guide.value.start()
  await nextTick()
  panelHost.value?.querySelector('.gm-walkthrough')?.focus({ preventScroll: true })
}
function close() {
  guide.value.close()
}
async function takeAction(action) {
  close()
  await router.push(action.to)
}

watch(() => guide.value.state.open, async open => {
  document.body.classList.toggle('bookins-tour-open', open)
  if (open) return
  clearHighlight()
  writeSeen()
  await nextTick()
  if (document.activeElement === document.body || !document.activeElement) {
    const trigger = [...document.querySelectorAll('[data-bookins-walkthrough-trigger]')].find(isVisible)
    trigger?.focus({ preventScroll: true })
  }
})
watch(isDemo, () => { demoGuide.close(); liveGuide.close(); offerVisible.value = false })
watch(() => route.path, path => {
  const { state } = guide.value
  if (state.open && state.status === 'ready' && path !== current.value?.route) close()
})

// ---- first-run offer ---------------------------------------------------------
const dialogOpen = () => Boolean(document.querySelector('.gm-dialog-content, .more-sheet, .sidebar.open'))
function evaluateOffer() {
  if (offerVisible.value || isDemo.value || readSeen()) return
  if (loaded?.value !== true || guide.value.state.open || route.path === '/book' || dialogOpen()) return
  offerVisible.value = true
}
function dismissOffer() {
  writeSeen()
  offerVisible.value = false
}
function offerKeydown(event) {
  if (event.key !== 'Escape' || event.defaultPrevented || !offerVisible.value || dialogOpen()) return
  dismissOffer()
}
function tourKeydown(event) {
  if (event.key !== 'Escape' || !guide.value.state.open) return
  if (event.defaultPrevented || document.querySelector('.gm-dialog-content')) return
  close()
}
let offerTimer
onMounted(() => {
  document.addEventListener('keydown', offerKeydown)
  document.addEventListener('keydown', tourKeydown)
  window.addEventListener('resize', onResize)
  window.addEventListener('scroll', onViewportChange, { passive: true })
  offerTimer = window.setInterval(() => {
    if (readSeen() || isDemo.value) return
    evaluateOffer()
    if (offerVisible.value) window.clearInterval(offerTimer)
  }, 1500)
})
onBeforeUnmount(() => {
  window.clearInterval(offerTimer)
  document.removeEventListener('keydown', offerKeydown)
  document.removeEventListener('keydown', tourKeydown)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('scroll', onViewportChange)
  resizeObserver?.disconnect()
  clearHighlight()
  document.body.classList.remove('bookins-tour-open')
  demoGuide.dispose()
  liveGuide.dispose()
})
defineExpose({ start, close })
</script>

<template>
  <section v-if="offerVisible && !guide.state.open" class="tour-offer" aria-label="Product tour">
    <p class="tour-offer-title">New to Bookins?</p>
    <p class="tour-offer-copy">Take a 1-minute tour of how to get set up. Nothing is changed.</p>
    <div class="tour-offer-actions">
      <button type="button" class="primary small" @click="start">Take the tour</button>
      <button type="button" class="ghost small" @click="dismissOffer">Not now</button>
    </div>
  </section>
  <div v-if="guide.state.open" ref="panelHost" class="tour-panel" :class="{ 'tour-panel--demo': isDemo }" :data-dock="panelDock || undefined">
    <GmWalkthrough
      :steps="guide.steps"
      :state="guide.state"
      :label="isDemo ? 'Sample walkthrough' : 'Bookins tour'"
      :notice="isDemo ? 'Sample data. The walkthrough never creates a booking or changes anything.' : 'Nothing is changed by this tour.'"
      :jump="isDemo"
      :extra="extra"
      @next="guide.next"
      @back="guide.back"
      @retry="guide.retry"
      @restart="guide.restart"
      @skip="close"
      @finish="close"
      @action="takeAction"
    />
  </div>
</template>
