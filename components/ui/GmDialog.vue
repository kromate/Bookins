<script setup>
import { watch } from 'vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'radix-vue'

defineOptions({ inheritAttrs: false })
const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  contentClass: { type: String, default: '' },
  overlayClass: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  portalTarget: { type: [String, Object], default: 'body' },
})
const emit = defineEmits(['update:open'])
let opener = null
// Capture before the modal mounts and makes the surrounding page inert.
watch(() => props.open, open => {
  if (open && typeof document !== 'undefined') opener = document.activeElement
}, { flush: 'sync', immediate: true })
function restoreFocus(event) {
  event.preventDefault()
  if (opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true })
  opener = null
}
function updateOpen(value) {
  if (!props.busy || value) emit('update:open', value)
}
function guardDismiss(event) {
  if (props.busy) event.preventDefault()
}
</script>

<template>
  <DialogRoot :open="open" @update:open="updateOpen">
    <DialogPortal :to="portalTarget">
      <DialogOverlay class="gm-dialog-overlay" :class="overlayClass">
        <DialogContent
          v-bind="$attrs"
          class="gm-dialog-content"
          :class="contentClass"
          :aria-describedby="undefined"
          :aria-busy="busy || undefined"
          @close-auto-focus="restoreFocus"
          @escape-key-down="guardDismiss"
          @interact-outside="guardDismiss"
        >
          <DialogTitle as="span" class="gm-dialog-accessible-title">{{ title }}</DialogTitle>
          <slot />
        </DialogContent>
      </DialogOverlay>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.gm-dialog-overlay { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; overflow-y: auto; padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); background: rgb(16 25 40 / 50%); backdrop-filter: blur(3px); }
.gm-dialog-content { box-sizing: border-box; min-width: 0; max-width: 100%; max-height: calc(100dvh - 24px); overflow-y: auto; overscroll-behavior: contain; }
.gm-dialog-accessible-title { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (prefers-reduced-motion: no-preference) {
  .gm-dialog-overlay[data-state="open"] { animation: gm-dialog-enter 160ms var(--ease, ease-out); }
  .gm-dialog-content[data-state="open"] { animation: gm-dialog-pop var(--dur-panel, 200ms) var(--ease, ease-out); }
}
/* Phones: dialogs become bottom sheets. */
@media (max-width: 700px) {
  .gm-dialog-overlay { place-items: end center; padding: 0; }
  .gm-dialog-content { width: 100%; max-height: 92dvh; border-radius: 18px 18px 0 0 !important; padding-bottom: max(var(--space-4, 16px), env(safe-area-inset-bottom)); }
  @media (prefers-reduced-motion: no-preference) {
    .gm-dialog-content[data-state="open"] { animation-name: gm-dialog-sheet; }
  }
}
@keyframes gm-dialog-enter { from { opacity: 0; } to { opacity: 1; } }
@keyframes gm-dialog-pop { from { opacity: 0; transform: translateY(8px) scale(0.985); } to { opacity: 1; transform: none; } }
@keyframes gm-dialog-sheet { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
</style>
