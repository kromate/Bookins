<script setup>
// Accessible hint / tooltip.
//  - Icon variant (default): a 44px "?" button. Hover, focus and tap show the text; Esc, blur, scroll or an outside tap hides it.
//  - Wrap variant (`wrap`): wraps any control (typically an aria-disabled or disabled button) so the reason is shown
//    on hover, focus-within and tap. The wrapper does not affect layout (`display: contents`).
// The bubble is `role="tooltip"` and linked with aria-describedby (icon variant: automatically; wrap variant: use
// the `describedby` slot prop on the control, or pass `describe-wrapper` for non-focusable content).
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

const props = defineProps({
  text: { type: String, default: '' },
  id: { type: String, default: '' },
  label: { type: String, default: '' }, // accessible name for the "?" button; defaults to "More info"
  wrap: { type: Boolean, default: false },
  placement: { type: String, default: 'top', validator: value => ['top', 'bottom'].includes(value) },
  describeWrapper: { type: Boolean, default: false }, // makes the wrapper focusable (for non-focusable children)
  disabled: { type: Boolean, default: false }, // suppress the bubble (e.g. control is enabled)
})

const autoId = useId()
const bubbleId = computed(() => props.id || `gm-hint-${autoId}`)
const open = ref(false)
const root = ref(null)
const bubble = ref(null)
const pos = ref({ left: 0, top: 0, ready: false })
let closeTimer = null
let hoverIntent = false

const active = computed(() => open.value && !props.disabled)

function anchorElement() {
  const el = root.value
  if (!el) return null
  if (props.wrap) return props.describeWrapper ? el : [...el.children].find(child => !child.classList.contains('gm-hint__bubble')) || el
  return el.querySelector('.gm-hint__trigger') || el
}

async function place() {
  await nextTick()
  const anchor = anchorElement()
  const tip = bubble.value
  if (!anchor || !tip) return
  const a = anchor.getBoundingClientRect()
  const t = tip.getBoundingClientRect()
  const gap = 8
  const margin = 8
  let top = props.placement === 'top' ? a.top - t.height - gap : a.bottom + gap
  if (props.placement === 'top' && top < margin) top = a.bottom + gap
  else if (props.placement === 'bottom' && top + t.height > window.innerHeight - margin) top = a.top - t.height - gap
  let left = a.left + a.width / 2 - t.width / 2
  left = Math.max(margin, Math.min(left, window.innerWidth - t.width - margin))
  pos.value = { left, top: Math.max(margin, top), ready: true }
}

function show() {
  if (props.disabled) return
  clearTimeout(closeTimer)
  open.value = true
}
function hide() {
  clearTimeout(closeTimer)
  open.value = false
  pos.value = { ...pos.value, ready: false }
}

watch(active, value => {
  if (typeof document === 'undefined') return
  if (value) {
    place()
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', key, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
  } else cleanup()
})
function cleanup() {
  document.removeEventListener('pointerdown', outside, true)
  document.removeEventListener('keydown', key, true)
  window.removeEventListener('scroll', hide, true)
  window.removeEventListener('resize', hide)
}
onBeforeUnmount(() => { clearTimeout(closeTimer); cleanup() })

function outside(event) {
  if (!root.value?.contains(event.target)) hide()
}
function key(event) {
  if (event.key === 'Escape' && open.value) {
    hide() // Hints close without closing a surrounding dialog only when the hint itself has focus.
    if (root.value?.contains(document.activeElement)) event.stopPropagation()
  }
}

function onEnter(event) {
  if (event.pointerType === 'touch') return
  hoverIntent = true
  show()
}
function onLeave() {
  hoverIntent = false
  if (!root.value?.contains(document.activeElement)) hide()
}
function onFocusIn(event) {
  // Only keyboard focus opens the hint; a mouse click focuses first and would flash it open then shut.
  if (event.target.matches?.(':focus-visible')) show()
}
function onFocusOut(event) {
  if (!root.value?.contains(event.relatedTarget) && !hoverIntent) hide()
}
function onClick(event) {
  if (props.disabled) return
  const touchOrKeyboard = event.detail === 0 || event.pointerType === 'touch' || !hoverIntent
  if (props.wrap) {
    show()
    if (touchOrKeyboard) closeTimer = setTimeout(hide, 5000)
    return
  }
  if (touchOrKeyboard) {
    if (open.value) hide()
    else { show(); closeTimer = setTimeout(hide, 6000) }
  } else show()
}
</script>

<template>
  <span
    ref="root"
    class="gm-hint"
    :class="{ 'gm-hint--wrap': wrap && !describeWrapper }"
    :tabindex="wrap && describeWrapper ? 0 : undefined"
    :aria-describedby="wrap && describeWrapper ? bubbleId : undefined"
    @pointerenter="onEnter"
    @pointerleave="onLeave"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @click="onClick"
  >
    <template v-if="wrap"><slot :describedby="bubbleId" /></template>
    <button
      v-else
      type="button"
      class="gm-hint__trigger"
      :aria-label="label || 'More info'"
      :aria-describedby="bubbleId"
    ><span aria-hidden="true">?</span></button>
    <!-- Teleported so a transformed or animated ancestor cannot offset the fixed-position bubble. -->
    <Teleport to="body">
      <span
        v-if="active"
        :id="bubbleId"
        ref="bubble"
        class="gm-hint__bubble"
        role="tooltip"
        :style="{ left: `${pos.left}px`, top: `${pos.top}px`, visibility: pos.ready ? 'visible' : 'hidden' }"
      ><slot name="content">{{ text }}</slot></span>
      <!-- Keep the id resolvable for aria-describedby when closed. -->
      <span v-else :id="bubbleId" hidden role="tooltip">{{ text }}</span>
    </Teleport>
  </span>
</template>

<style>
.gm-hint { position: relative; display: inline-flex; align-items: center; vertical-align: middle; max-width: 100%; }
.gm-hint--wrap { display: contents; }
.gm-hint__trigger {
  display: inline-grid; place-items: center; inline-size: 44px; block-size: 44px; margin: -12px -10px; padding: 0;
  border: 0; background: transparent; color: var(--muted, #5d6578); cursor: help; touch-action: manipulation;
}
.gm-hint__trigger > span {
  display: grid; place-items: center; inline-size: 20px; block-size: 20px; border: 1.5px solid currentColor; border-radius: 50%;
  font: 700 12px/1 var(--font-ui, system-ui); transition: color var(--dur-fast, 160ms), background var(--dur-fast, 160ms);
}
.gm-hint__trigger:hover > span, .gm-hint__trigger[aria-expanded='true'] > span { color: var(--accent, #2336dc); background: var(--accent-soft, #eef0ff); }
.gm-hint__trigger:focus-visible { outline: none; }
.gm-hint__trigger:focus-visible > span { outline: 3px solid var(--accent, #2336dc); outline-offset: 2px; }
.gm-hint__bubble {
  position: fixed; z-index: 120; box-sizing: border-box; max-width: min(260px, calc(100vw - 16px)); padding: 8px 12px;
  border-radius: 10px; background: var(--ink, #172033); color: #fff; box-shadow: var(--shadow-lg, 0 8px 24px rgb(0 0 0 / 0.2));
  font: 500 var(--text-sm, 14px)/1.45 var(--font-ui, system-ui); text-align: left; white-space: normal; text-transform: none; letter-spacing: normal; pointer-events: none;
}
</style>
