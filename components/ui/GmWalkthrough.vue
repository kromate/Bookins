<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import GmButton from './GmButton.vue'
const props = defineProps({
  steps: { type: Array, required: true },
  state: { type: Object, required: true },
  label: { type: String, default: '' }, // small header text, e.g. "Bookins tour"
  notice: { type: String, default: '' }, // reassurance line, e.g. "Nothing is changed by this tour."
  jump: { type: Boolean, default: true }, // show the "All steps" list
  extra: { type: Object, default: null }, // per-step { note, action: { label, to } }
})
defineEmits(['next', 'back', 'skip', 'restart', 'retry', 'finish', 'action'])
const titleId = useId()
const current = computed(() => props.steps[props.state.index])
const panel = ref(null)
let opener = null
function restoreFocus() {
  if (opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true })
}
watch(() => props.state.open, async open => {
  if (typeof document === 'undefined') return
  if (open) opener = document.activeElement
  else if (panel.value?.contains(document.activeElement)) {
    await nextTick()
    if (!props.state.open) restoreFocus()
  }
}, { flush: 'sync', immediate: true })
onBeforeUnmount(() => {
  if (typeof document !== 'undefined' && panel.value?.contains(document.activeElement)) restoreFocus()
})
</script>
<template>
  <section v-if="state.open && current" ref="panel" class="gm-walkthrough" :aria-labelledby="titleId" tabindex="-1">
    <div class="gm-walkthrough-progress" aria-hidden="true"><span :style="{ width: `${((state.index + 1) / steps.length) * 100}%` }" /></div>
    <div aria-live="polite" aria-atomic="true">
      <p v-if="label" class="gm-walkthrough-label">{{ label }}</p>
      <p>Step {{ state.index + 1 }} of {{ steps.length }}</p>
      <h2 :id="titleId">{{ current.title }}</h2>
      <p>{{ current.explanation }}</p>
      <p v-if="current.expected"><strong>What to expect:</strong> {{ current.expected }}</p>
      <p v-if="extra?.note" class="gm-walkthrough-note">{{ extra.note }}</p>
    </div>
    <p v-if="notice" class="gm-walkthrough-notice">{{ notice }}</p>
    <p v-if="extra?.action"><GmButton variant="secondary" size="sm" @click="$emit('action', extra.action)">{{ extra.action.label }}</GmButton></p>
    <p v-if="state.status === 'loading'" role="status">{{ label ? 'Opening the page…' : 'Opening the sample page…' }}</p>
    <p v-if="state.error" role="alert">{{ state.error }}</p>
    <div class="gm-walkthrough-actions">
      <GmButton variant="ghost" @click="$emit('skip')">Skip tour</GmButton>
      <GmButton v-if="state.index" variant="secondary" :disabled="state.status === 'loading'" @click="$emit('back')">Back</GmButton>
      <GmButton v-if="state.status === 'error'" variant="secondary" @click="$emit('retry')">Retry page</GmButton>
      <GmButton v-if="state.index < steps.length - 1" :disabled="state.status === 'loading'" @click="$emit('next')">Next</GmButton>
      <GmButton v-else :disabled="state.status === 'loading'" @click="$emit('finish')">Finish tour</GmButton>
    </div>
    <details v-if="jump"><summary>All steps</summary><ol><li v-for="step in steps" :key="step.id"><strong>{{ step.title }}</strong><p>{{ step.explanation }}</p><p v-if="step.expected">{{ step.expected }}</p></li></ol><GmButton variant="secondary" @click="$emit('restart')">Restart walkthrough</GmButton></details>
  </section>
</template>
<style>
.gm-walkthrough { min-width: 0; padding: 20px; font-size: 14px; border: 1px solid var(--gm-color-border-subtle, #dce3ea); border-radius: 12px; background: var(--gm-color-surface, #fff); color: var(--gm-color-text, #202124); overflow-wrap: anywhere; }
.gm-walkthrough:focus { outline: none; }
.gm-walkthrough-progress { height: 4px; margin: -20px -20px 14px; border-radius: 12px 12px 0 0; background: var(--accent-soft, #eef0ff); overflow: hidden; }
.gm-walkthrough-progress span { display: block; height: 100%; background: var(--gm-color-brand, #2336dc); transition: width var(--dur-panel, 200ms) var(--ease, ease); }
.gm-walkthrough-label { margin: 0; color: var(--gm-color-brand, #2336dc); font-size: 12px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.gm-walkthrough-note { padding: 8px 12px; border-radius: 10px; background: var(--warning-soft, #fff6e0); }
.gm-walkthrough-notice { margin: 0; color: var(--muted, #5d6578); font-size: 13px; }
.gm-walkthrough h2 { margin: 8px 0; font-size: 18px; }
.gm-walkthrough p { line-height: 1.6; }
.gm-walkthrough-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; margin-block: 16px; }
.gm-walkthrough-actions .gm-button { padding-inline: 12px; }
.gm-walkthrough summary { min-height: 44px; display: list-item; align-content: center; cursor: pointer; }
.gm-walkthrough summary:focus-visible { outline: 2px solid var(--gm-color-focus, #601ded); outline-offset: 3px; }
</style>
