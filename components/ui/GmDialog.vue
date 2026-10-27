<script setup lang="ts">
import { watch } from 'vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'radix-vue'

// Variants: `drawer` (a record or form, from the right; full screen on phones), `confirm` (a short centred question,
// for deletes and revokes), `wide` (multi-step work such as the campaign builder or the CSV import).
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ open?: boolean; title: string; contentClass?: string; overlayClass?: string; busy?: boolean; portalTarget?: string | HTMLElement; variant?: 'drawer' | 'confirm' | 'wide' }>(), { open: false, contentClass: '', overlayClass: '', busy: false, portalTarget: 'body', variant: 'drawer' })
const emit = defineEmits<{ 'update:open': [value: boolean]; 'open-auto-focus': [event: Event] }>()
let opener: HTMLElement | null = null
// Capture before the modal mounts and makes the surrounding page inert.
watch(() => props.open, open => {
  if (open && typeof document !== 'undefined') opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
}, { flush: 'sync', immediate: true })
function restoreFocus(event: Event) {
  event.preventDefault()
  if (opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true })
  opener = null
}
function updateOpen(value: boolean) {
  if (!props.busy || value) emit('update:open', value)
}
function guardDismiss(event: Event) {
  if (props.busy) event.preventDefault()
}
// Toasts render above the dialog; using one (Dismiss / Undo) must not count as clicking outside the dialog.
function guardOutside(event: Event & { detail?: { originalEvent?: Event } }) {
  const target = event.detail?.originalEvent?.target || event.target
  if (props.busy || (target instanceof Element && target.closest('.toast-region, [data-feedback-widget], .gm-picker-content, .gm-select-content'))) event.preventDefault()
}
</script>

<template>
  <DialogRoot :open="open" @update:open="updateOpen">
    <DialogPortal :to="portalTarget">
      <DialogOverlay class="gm-dialog-overlay" :class="[`gm-dialog-overlay--${variant}`, overlayClass]">
        <DialogContent
          v-bind="$attrs"
          class="gm-dialog-content"
          :class="[`gm-dialog-content--${variant}`, contentClass]"
          @close-auto-focus="restoreFocus"
          @open-auto-focus="emit('open-auto-focus', $event)"
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
.gm-dialog-overlay.gm-dialog-overlay { position: fixed; inset: 0; z-index: 100; display: flex; justify-content: flex-end; align-items: stretch; overflow: hidden; overscroll-behavior: contain; padding: 0; background: rgb(26 31 61 / 50%); }
.gm-dialog-content.gm-dialog-content { box-sizing: border-box; min-width: 0; max-width: 100vw; overflow-y: auto; overscroll-behavior: contain; border-radius: 0; box-shadow: var(--shadow-3, 0 24px 64px rgb(26 31 61 / 18%)); }
.gm-dialog-content:not(.modal) { background: transparent; }
.gm-dialog-content.modal { display: flex; flex-direction: column; }
.gm-dialog-content.modal > form { flex: 1; display: flex; flex-direction: column; min-height: 100%; }
.gm-dialog-content.modal > form > .modal-footer { margin-top: auto; }
/* The form is a flex column, so sections with overflow:hidden (disclosures, boxed editors) would otherwise shrink to their borders. */
.gm-dialog-content.modal > form > :not(.modal-footer) { flex-shrink: 0; }

/* drawer */
.gm-dialog-content.gm-dialog-content--drawer { width: min(620px, 100vw); height: 100dvh; max-height: 100dvh; border-left: 1px solid var(--gm-color-border-subtle, #dde1ea); }
/* confirm: a short centred question */
.gm-dialog-overlay.gm-dialog-overlay--confirm { align-items: center; justify-content: center; padding: 16px; }
.gm-dialog-content.gm-dialog-content--confirm { width: min(460px, 100%); height: auto; max-height: calc(100dvh - 32px); border-radius: var(--radius-lg, 14px); border-top: 4px solid var(--gm-color-danger, #b42318); }
/* wide: multi-step work */
.gm-dialog-overlay.gm-dialog-overlay--wide { align-items: center; justify-content: center; padding: 24px; }
.gm-dialog-content.gm-dialog-content--wide { width: min(1120px, 100%); height: min(860px, calc(100dvh - 48px)); max-height: calc(100dvh - 48px); border-radius: var(--radius-lg, 14px); }

.gm-dialog-content:not(.modal) > .modal { width: 100%; min-height: 100%; max-height: none; overflow: visible; border-radius: 0; }
.gm-dialog-content.modal > .modal-header,
.gm-dialog-content.modal > form > .modal-header,
.gm-dialog-content:not(.modal) > .modal > .modal-header,
.gm-dialog-content:not(.modal) > .modal > form > .modal-header,
.gm-dialog-content:not(.modal) > .modal > .import-body > .modal-header,
.gm-dialog-content.modal > .import-body > .modal-header {
  position: sticky;
  top: calc(var(--card-padding, 24px) * -1);
  z-index: 12;
  margin: calc(var(--card-padding, 24px) * -1) calc(var(--card-padding, 24px) * -1) var(--space-4, 16px);
  padding: var(--space-4, 16px) var(--card-padding, 24px);
  border-bottom: 1px solid var(--gm-color-border-subtle, #dde1ea);
  background: var(--gm-color-surface, #fff);
}
.gm-dialog-content .modal-footer { z-index: 12; padding-bottom: max(var(--space-3, 12px), env(safe-area-inset-bottom)); background: var(--gm-color-surface, #fff); }
.gm-dialog-content:focus, .gm-dialog-content:focus-visible { outline: none; }
.gm-dialog-accessible-title { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (prefers-reduced-motion: no-preference) {
  .gm-dialog-overlay[data-state="open"] { animation: gm-dialog-enter 160ms var(--ease, ease-out); }
  .gm-dialog-content--drawer[data-state="open"] { animation: gm-dialog-drawer var(--dur-panel, 200ms) var(--ease, ease-out); }
  .gm-dialog-content--confirm[data-state="open"], .gm-dialog-content--wide[data-state="open"] { animation: gm-dialog-rise var(--dur-panel, 200ms) var(--ease, ease-out); }
}
@media (max-width: 700px) {
  .gm-dialog-content.gm-dialog-content--drawer, .gm-dialog-content.gm-dialog-content--wide { width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; padding-bottom: env(safe-area-inset-bottom); }
  .gm-dialog-overlay.gm-dialog-overlay--wide { padding: 0; }
  .gm-dialog-overlay.gm-dialog-overlay--confirm { align-items: flex-end; padding: 0; }
  .gm-dialog-content.gm-dialog-content--confirm { width: 100%; border-radius: var(--radius-lg, 14px) var(--radius-lg, 14px) 0 0; padding-bottom: max(var(--card-padding, 16px), env(safe-area-inset-bottom)); }
  .gm-dialog-content.modal > .modal-header,
  .gm-dialog-content.modal > form > .modal-header,
  .gm-dialog-content:not(.modal) > .modal > .modal-header,
  .gm-dialog-content:not(.modal) > .modal > form > .modal-header,
  .gm-dialog-content:not(.modal) > .modal > .import-body > .modal-header,
  .gm-dialog-content.modal > .import-body > .modal-header {
    padding-top: max(var(--space-4, 16px), env(safe-area-inset-top));
  }
}
@keyframes gm-dialog-enter { from { opacity: 0; } to { opacity: 1; } }
@keyframes gm-dialog-drawer { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
@keyframes gm-dialog-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
</style>
