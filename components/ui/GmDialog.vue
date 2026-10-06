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
// Toasts render above the dialog; using one (Dismiss / Undo) must not count as clicking outside the dialog.
function guardOutside(event) {
  const target = event.detail?.originalEvent?.target || event.target
  if (props.busy || (target instanceof Element && target.closest('.toast-region, [data-feedback-widget]'))) event.preventDefault()
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
          @interact-outside="guardOutside"
        >
          <DialogTitle as="span" class="gm-dialog-accessible-title">{{ title }}</DialogTitle>
          <slot />
        </DialogContent>
      </DialogOverlay>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.gm-dialog-overlay { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; overflow-y: auto; overscroll-behavior: contain; padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); background: rgb(16 25 40 / 50%); backdrop-filter: blur(3px); }
.gm-dialog-content { box-sizing: border-box; min-width: 0; max-width: 100%; max-height: calc(100dvh - 24px); overflow-y: auto; overscroll-behavior: contain; }
.gm-dialog-overlay { padding-bottom: max(84px, env(safe-area-inset-bottom)); } /* strip under the card where toasts appear */
.gm-dialog-content { max-height: calc(100dvh - 96px); }
.gm-dialog-content:not(.modal) { width: min(620px, 100%); background: transparent; }
.gm-dialog-content:not(.modal) > .modal { width: 100%; max-height: none; overflow: visible; }
.gm-dialog-content:focus, .gm-dialog-content:focus-visible { outline: none; }
.gm-dialog-accessible-title { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (prefers-reduced-motion: no-preference) {
  .gm-dialog-overlay[data-state="open"] { animation: gm-dialog-enter 160ms var(--ease, ease-out); }
  .gm-dialog-content[data-state="open"] { animation: gm-dialog-pop var(--dur-panel, 200ms) var(--ease, ease-out); }
}
/* Phones: dialogs become bottom sheets. */
@media (max-width: 700px) {
  .gm-dialog-overlay { place-items: end center; padding: 0; }
  /* Toasts sit at the top of the screen on phones: leave ~76px free above the sheet. */
  .gm-dialog-content { width: 100%; max-height: calc(100dvh - 76px - env(safe-area-inset-top)); border-radius: 18px 18px 0 0 !important; padding-bottom: max(var(--space-4, 16px), env(safe-area-inset-bottom)); }
  @media (prefers-reduced-motion: no-preference) {
    .gm-dialog-content[data-state="open"] { animation-name: gm-dialog-sheet; }
  }
}
@keyframes gm-dialog-enter { from { opacity: 0; } to { opacity: 1; } }
@keyframes gm-dialog-pop { from { opacity: 0; transform: translateY(8px) scale(0.985); } to { opacity: 1; transform: none; } }
@keyframes gm-dialog-sheet { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
</style>
