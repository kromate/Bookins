<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import GmButton from './GmButton.vue'
const props = defineProps({ steps: { type: Array, required: true }, state: { type: Object, required: true } })
defineEmits(['next', 'back', 'skip', 'restart', 'retry', 'finish'])
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
  <section v-if="state.open && current" ref="panel" class="gm-walkthrough" :aria-labelledby="titleId">
    <div aria-live="polite" aria-atomic="true">
      <p>Step {{ state.index + 1 }} of {{ steps.length }}</p>
      <h2 :id="titleId">{{ current.title }}</h2>
      <p>{{ current.explanation }}</p>
      <p><strong>What to expect:</strong> {{ current.expected }}</p>
    </div>
    <p v-if="state.status === 'loading'" role="status">Opening the sample page…</p>
    <p v-if="state.error" role="alert">{{ state.error }}</p>
    <div class="gm-walkthrough-actions">
      <GmButton variant="ghost" @click="$emit('skip')">Skip tour</GmButton>
      <GmButton v-if="state.index" variant="secondary" :disabled="state.status === 'loading'" @click="$emit('back')">Back</GmButton>
      <GmButton v-if="state.status === 'error'" variant="secondary" @click="$emit('retry')">Retry page</GmButton>
      <GmButton v-if="state.index < steps.length - 1" :disabled="state.status === 'loading'" @click="$emit('next')">Next</GmButton>
      <GmButton v-else :disabled="state.status === 'loading'" @click="$emit('finish')">Finish tour</GmButton>
    </div>
    <details><summary>All steps</summary><ol><li v-for="step in steps" :key="step.id"><strong>{{ step.title }}</strong><p>{{ step.explanation }}</p><p>{{ step.expected }}</p></li></ol><GmButton variant="secondary" @click="$emit('restart')">Restart walkthrough</GmButton></details>
  </section>
</template>
<style>
.gm-walkthrough { min-width: 0; padding: 20px; font-size: 14px; border: 1px solid var(--gm-color-border-subtle, #dce3ea); border-radius: 12px; background: var(--gm-color-surface, #fff); color: var(--gm-color-text, #202124); overflow-wrap: anywhere; }
.gm-walkthrough h2 { margin: 8px 0; font-size: 18px; }
.gm-walkthrough p { line-height: 1.6; }
.gm-walkthrough-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-block: 16px; }
.gm-walkthrough summary { min-height: 44px; display: list-item; align-content: center; cursor: pointer; }
.gm-walkthrough summary:focus-visible { outline: 2px solid var(--gm-color-focus, #601ded); outline-offset: 3px; }
</style>
