<script setup>
// `disabledReason`: when set the button is aria-disabled (still focusable), clicks are blocked, and the reason is shown
// in a GmHint (hover / focus / tap). Add `reason-visible` to also print it under the button.
// Native `disabled` stays for plain disabled states without a reason (busy states use `pending`).
import { computed, useId } from 'vue'
import GmHint from './GmHint.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps({
  variant: { type: String, default: 'primary', validator: value => ['primary', 'secondary', 'ghost', 'danger'].includes(value) },
  size: { type: String, default: 'md', validator: value => ['sm', 'md'].includes(value) },
  type: { type: String, default: 'button', validator: value => ['button', 'submit', 'reset'].includes(value) },
  disabled: Boolean,
  pending: Boolean,
  pendingLabel: { type: String, default: 'Working…' },
  disabledReason: { type: String, default: '' },
  reasonVisible: Boolean,
})

const emit = defineEmits(['click'])
const reasonId = `gm-button-reason-${useId()}`
const reasoned = computed(() => Boolean(props.disabledReason))
const blocked = computed(() => props.disabled || props.pending || reasoned.value)

function activate(event) {
  if (blocked.value) {
    event.preventDefault()
    // Reasoned clicks must bubble to the hint wrapper so a tap shows the reason.
    if (!reasoned.value) event.stopPropagation()
    return
  }
  emit('click', event)
}
</script>

<template>
  <GmHint :text="disabledReason" wrap :disabled="!reasoned" v-slot="{ describedby }">
    <button
      v-bind="$attrs"
      class="gm-button"
      :class="[`gm-button--${variant}`, `gm-button--${size}`, { 'gm-button--reasoned': reasoned }]"
      :type="type"
      :disabled="disabled && !reasoned"
      :aria-disabled="pending || reasoned || undefined"
      :aria-busy="pending || undefined"
      :aria-describedby="reasoned ? (reasonVisible ? reasonId : describedby) : undefined"
      @click="activate"
    >
      <span class="gm-button__content" :class="{ 'gm-button__content--hidden': pending }" :aria-hidden="pending || undefined">
        <span v-if="$slots.leading" class="gm-button__accessory"><slot name="leading" /></span>
        <span class="gm-button__label"><slot /></span>
        <span v-if="$slots.trailing" class="gm-button__accessory"><slot name="trailing" /></span>
      </span>
      <span class="gm-button__pending" :class="{ 'gm-button__content--hidden': !pending }" :aria-hidden="!pending || undefined">
        <span class="gm-button__spinner" aria-hidden="true" />
        <span>{{ pendingLabel }}</span>
      </span>
    </button>
  </GmHint>
  <span v-if="reasoned && reasonVisible" :id="reasonId" class="gm-button__reason field-hint">{{ disabledReason }}</span>
</template>

<style scoped>
.gm-button {
  --button-bg: var(--gm-color-brand, #4338ca);
  --button-fg: var(--gm-color-on-brand, #fff);
  --button-border: transparent;
  position: relative;
  display: inline-grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  min-block-size: 44px;
  max-inline-size: 100%;
  box-sizing: border-box;
  padding: var(--gm-space-2, 8px) var(--gm-space-4, 16px);
  border: 1px solid var(--button-border);
  border-radius: var(--gm-radius-control, 10px);
  background: var(--button-bg);
  color: var(--button-fg);
  font: 700 0.875rem/1.4 var(--gm-font-body, system-ui, sans-serif);
  text-align: center;
  cursor: pointer;
  touch-action: manipulation;
  transition: transform var(--gm-duration-fast, 120ms) var(--gm-ease-standard, ease), box-shadow var(--gm-duration-fast, 120ms) var(--gm-ease-standard, ease), background var(--gm-duration-fast, 120ms) var(--gm-ease-standard, ease);
}
.gm-button--secondary {
  --button-bg: var(--gm-color-surface, #fff);
  --button-fg: var(--gm-color-text, #172033);
  --button-border: var(--gm-color-border, #d4d9e2);
}
.gm-button--ghost { --button-bg: transparent; --button-fg: var(--gm-color-brand, #4338ca); }
.gm-button--primary { box-shadow: 0 1px 2px rgb(35 54 220 / 0.18); }
.gm-button--danger { --button-bg: var(--gm-color-danger, #b42318); --button-fg: var(--gm-color-on-danger, #fff); }
.gm-button--sm { min-block-size: 40px; padding: var(--gm-space-1, 4px) var(--gm-space-3, 12px); font-size: 0.875rem; }
.gm-button__content, .gm-button__pending {
  grid-area: 1 / 1;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--gm-space-2, 8px);
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.gm-button__label { min-inline-size: 0; }
.gm-button__pending > span:last-child { min-inline-size: 0; }
.gm-button__accessory { display: inline-flex; flex: none; }
.gm-button__content--hidden { visibility: hidden; }
.gm-button__spinner {
  inline-size: 1em;
  block-size: 1em;
  flex: none;
  border: 2px solid currentColor;
  border-inline-end-color: transparent;
  border-radius: 50%;
  animation: gm-button-spin 800ms linear infinite;
}
.gm-button:focus-visible { outline: 3px solid var(--gm-color-focus, #2563eb); outline-offset: 2px; }
.gm-button:disabled, .gm-button--reasoned { opacity: 0.6; cursor: not-allowed; }
.gm-button__reason { display: block; margin-top: 6px; font-size: var(--text-sm, 14px); color: var(--muted, #5d6578); }
.gm-button[aria-busy='true'] { opacity: 1; cursor: progress; }
.gm-button:not([aria-busy='true']) .gm-button__spinner { animation: none; }
@media (hover: hover) { .gm-button:hover:not(:disabled):not([aria-disabled='true']) { transform: translateY(-1px); box-shadow: 0 2px 5px rgb(0 0 0 / 0.12); } }
.gm-button--primary:hover:not(:disabled):not([aria-disabled='true']) { --button-bg: var(--accent-hover, var(--gm-color-brand)); }
.gm-button:active:not(:disabled):not([aria-disabled='true']) { transform: translateY(1px); }
@keyframes gm-button-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .gm-button { transition: none; transform: none !important; } .gm-button__spinner { animation: none; } }
</style>
