<script setup>
// Anchored inline confirmation. The default slot is the TRIGGER; the popover renders right next to it
// (above by default, flips below when there is no room, shifted to stay on screen), so it is always visible
// near the control that was clicked, including inside a scrolling GmDialog and on phones.
//
//   <GmConfirm v-model:open="discardOpen" title="Discard unsaved changes?" message="Your edits to this service will be lost."
//              confirm-label="Discard changes" cancel-label="Keep editing" tone="danger" @confirm="discard">
//     <button type="button" @click="requestCancel">Cancel</button>
//   </GmConfirm>
//
// The parent owns `open` (set it true from the trigger's click). Focus goes to the first action (cancel = the safe
// choice), Esc cancels, Tab stays inside the popover, and focus returns to what was focused before it opened.
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  message: { type: String, default: '' },
  confirmLabel: { type: String, default: 'Confirm' },
  cancelLabel: { type: String, default: 'Cancel' },
  tone: { type: String, default: 'default', validator: value => ['default', 'danger'].includes(value) },
  placement: { type: String, default: 'top', validator: value => ['top', 'bottom'].includes(value) },
  align: { type: String, default: 'end', validator: value => ['start', 'end'].includes(value) },
  busy: { type: Boolean, default: false }, // locks the popover while a save/delete is running
})
const emit = defineEmits(['update:open', 'confirm', 'cancel'])

const uid = useId()
const titleId = `gm-confirm-title-${uid}`
const bodyId = `gm-confirm-body-${uid}`
const root = ref(null)
const pop = ref(null)
const cancelButton = ref(null)
const shift = ref(0)
const flipped = ref(false)
let opener = null

const side = computed(() => (props.placement === 'top') !== flipped.value ? 'top' : 'bottom')

function close(event) {
  emit('update:open', false)
  emit(event)
}
function cancel() {
  if (props.busy) return
  close('cancel')
}
function confirm() {
  if (props.busy) return
  emit('update:open', false)
  emit('confirm')
}

function fit() {
  const tip = pop.value
  if (!tip) return
  shift.value = 0
  flipped.value = false
  const rect = tip.getBoundingClientRect()
  const margin = 12
  let dx = 0
  if (rect.left < margin) dx = margin - rect.left
  else if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right
  shift.value = dx
  const wrapper = root.value.getBoundingClientRect()
  const preferTop = props.placement === 'top'
  const fitsTop = wrapper.top - rect.height - 8 >= margin
  const fitsBottom = wrapper.bottom + rect.height + 8 <= window.innerHeight - margin
  if (preferTop && !fitsTop && fitsBottom) flipped.value = true
  else if (!preferTop && !fitsBottom && fitsTop) flipped.value = true
}

watch(() => props.open, async open => {
  if (typeof document === 'undefined') return
  if (open) {
    opener = document.activeElement
    window.addEventListener('keydown', keydown, true)
    document.addEventListener('pointerdown', outside, true)
    await nextTick()
    fit()
    await nextTick()
    pop.value?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    cancelButton.value?.focus({ preventScroll: true })
  } else {
    stop()
    await nextTick()
    const target = opener?.isConnected ? opener : root.value?.querySelector('button, a[href], [tabindex]')
    target?.focus?.({ preventScroll: true })
    opener = null
  }
})
function stop() {
  window.removeEventListener('keydown', keydown, true)
  document.removeEventListener('pointerdown', outside, true)
}
onBeforeUnmount(stop)

function keydown(event) {
  if (!props.open) return
  if (event.key === 'Escape') {
    // Capture phase on window: runs before an enclosing dialog's own Escape handling.
    event.preventDefault()
    event.stopPropagation()
    cancel()
    return
  }
  if (event.key === 'Tab' && pop.value?.contains(document.activeElement)) {
    const controls = [...pop.value.querySelectorAll('button:not(:disabled)')]
    const first = controls[0], last = controls.at(-1)
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  }
}
function outside(event) {
  if (props.busy || root.value?.contains(event.target)) return
  cancel()
}
</script>

<template>
  <span ref="root" class="gm-confirm">
    <slot />
    <div
      v-if="open"
      ref="pop"
      class="gm-confirm__pop"
      :class="[`gm-confirm__pop--${side}`, `gm-confirm__pop--${align}`, { 'gm-confirm__pop--danger': tone === 'danger' }]"
      :style="{ '--gm-confirm-shift': `${shift}px` }"
      role="alertdialog"
      aria-modal="false"
      :aria-labelledby="titleId"
      :aria-describedby="bodyId"
      :aria-busy="busy || undefined"
    >
      <p :id="titleId" class="gm-confirm__title">{{ title }}</p>
      <p :id="bodyId" class="gm-confirm__body"><slot name="message">{{ message }}</slot></p>
      <div class="gm-confirm__actions">
        <button ref="cancelButton" type="button" class="secondary small" :disabled="busy" @click="cancel">{{ cancelLabel }}</button>
        <button type="button" class="small" :class="tone === 'danger' ? 'danger solid' : 'primary'" :disabled="busy" @click="confirm">{{ confirmLabel }}</button>
      </div>
    </div>
  </span>
</template>

<style>
.gm-confirm { position: relative; display: inline-flex; max-width: 100%; }
.gm-confirm__pop {
  position: absolute; z-index: 60; box-sizing: border-box; inline-size: 320px; max-inline-size: calc(100vw - 24px); padding: 14px 16px;
  border: 1px solid var(--line, #dfe3ec); border-radius: var(--radius, 14px); background: var(--surface, #fff); color: var(--ink, #172033);
  box-shadow: var(--shadow-lg, 0 12px 32px rgb(0 0 0 / 0.18)); text-align: left; white-space: normal;
  transform: translateX(var(--gm-confirm-shift, 0px));
}
.gm-confirm__pop--top { bottom: calc(100% + 8px); }
.gm-confirm__pop--bottom { top: calc(100% + 8px); }
.gm-confirm__pop--end { right: 0; }
.gm-confirm__pop--start { left: 0; }
.gm-confirm__pop--danger { border-color: var(--danger-line, var(--danger, #b42318)); }
.gm-confirm__title { margin: 0; font-weight: 700; font-size: var(--text-md, 16px); }
.gm-confirm__body { margin: 4px 0 0; color: var(--muted, #5d6578); font-size: var(--text-sm, 14px); line-height: 1.45; }
.gm-confirm__body:empty { display: none; }
.gm-confirm__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
@media (prefers-reduced-motion: no-preference) { .gm-confirm__pop { animation: gm-confirm-in var(--dur-fast, 160ms) var(--ease, ease-out); } }
@keyframes gm-confirm-in { from { opacity: 0; } to { opacity: 1; } }
</style>
