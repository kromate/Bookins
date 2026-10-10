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
  if (props.busy || (target instanceof Element && target.closest('.toast-region, [data-feedback-widget], .gm-picker-content, .gm-select-content'))) event.preventDefault()
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
.gm-dialog-overlay.gm-dialog-overlay { position: fixed; inset: 0; z-index: 100; display: flex; justify-content: flex-end; align-items: stretch; overflow: hidden; overscroll-behavior: contain; padding: 0; background: rgb(16 25 40 / 50%); backdrop-filter: blur(3px); }
.gm-dialog-content.gm-dialog-content { box-sizing: border-box; width: min(620px, 100vw); min-width: 0; max-width: 100vw; height: 100dvh; max-height: 100dvh; overflow-y: auto; overscroll-behavior: contain; border-radius: 0 !important; box-shadow: -16px 0 42px rgb(16 25 40 / 18%); }
.gm-dialog-content:not(.modal) { background: transparent; }
.gm-dialog-content.modal { display:flex; flex-direction:column; }
.gm-dialog-content.modal > form { flex:1; display:flex; flex-direction:column; min-height:100%; }
.gm-dialog-content.modal > form > .modal-footer { margin-top:auto; }

.gm-dialog-content:not(.modal) > .modal { width: 100%; min-height: 100%; max-height: none; overflow: visible; border-radius: 0; }
.gm-dialog-content.modal > .modal-header,
.gm-dialog-content.modal > form > .modal-header,
.gm-dialog-content:not(.modal) > .modal > .modal-header,
.gm-dialog-content:not(.modal) > .modal > form > .modal-header,
.gm-dialog-content:not(.modal) > .modal > .import-body > .modal-header {
  position: sticky;
  top: calc(var(--space-5, 24px) * -1);
  z-index: 12;
  margin: calc(var(--space-5, 24px) * -1) calc(var(--space-5, 24px) * -1) var(--space-4, 16px);
  padding: var(--space-4, 16px) var(--space-5, 24px);
  border-bottom: 1px solid var(--gm-color-border-subtle, #dce3ea);
  background: var(--gm-color-surface, #fff);
}
.gm-dialog-content .modal-footer { z-index: 12; padding-bottom: max(var(--space-4, 16px), env(safe-area-inset-bottom)); background: var(--gm-color-surface, #fff); }
.gm-dialog-content:focus, .gm-dialog-content:focus-visible { outline: none; }
.gm-dialog-accessible-title { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (prefers-reduced-motion: no-preference) {
  .gm-dialog-overlay[data-state="open"] { animation: gm-dialog-enter 160ms var(--ease, ease-out); }
  .gm-dialog-content[data-state="open"] { animation: gm-dialog-drawer var(--dur-panel, 200ms) var(--ease, ease-out); }
}
@media (max-width: 700px) {
  .gm-dialog-content.gm-dialog-content { width: 100vw; max-width: 100vw; padding-bottom: env(safe-area-inset-bottom); }
  .gm-dialog-content.modal > .modal-header,
  .gm-dialog-content.modal > form > .modal-header,
  .gm-dialog-content:not(.modal) > .modal > .modal-header,
  .gm-dialog-content:not(.modal) > .modal > form > .modal-header,
  .gm-dialog-content:not(.modal) > .modal > .import-body > .modal-header {
    top: calc(var(--space-4, 16px) * -1);
    margin: calc(var(--space-4, 16px) * -1) calc(var(--space-4, 16px) * -1) var(--space-4, 16px);
    padding: max(var(--space-4, 16px), env(safe-area-inset-top)) max(var(--space-4, 16px), env(safe-area-inset-right)) var(--space-4, 16px) max(var(--space-4, 16px), env(safe-area-inset-left));
  }
}
@keyframes gm-dialog-enter { from { opacity: 0; } to { opacity: 1; } }
@keyframes gm-dialog-drawer { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
</style>
