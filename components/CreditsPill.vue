<script setup>
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { BILLING_URL, creditsBalance, describeCredits, loadCredits } from './shell-runtime.js'

defineProps({ idPrefix: { type: String, default: 'credits' } })

const open = ref(false)
const refreshing = ref(false)
const info = computed(() => describeCredits(creditsBalance.value))

async function toggle() {
  open.value = !open.value
  if (!open.value || refreshing.value) return
  refreshing.value = true
  try {
    await loadCredits()
  } finally {
    refreshing.value = false
  }
}
</script>

<template>
  <div v-if="info" class="credits-pill-wrap">
    <button type="button" class="credits-pill" :aria-expanded="open" :aria-controls="`${idPrefix}-panel`" @click="toggle">
      <AppIcon name="bolt" :size="17" />
      <strong>{{ info.label }}</strong>
      <span>{{ info.caption }}</span>
      <AppIcon name="chevron" :size="15" class="credits-chevron" />
    </button>
    <div v-if="open" :id="`${idPrefix}-panel`" class="credits-panel">
      <p class="credits-note">Shared Goalmatic credits. They are used across Goalmatic and its Apps.</p>
      <dl v-if="info.rows.length" class="credits-rows">
        <template v-for="row in info.rows" :key="row.name"><dt>{{ row.name }}</dt><dd>{{ row.amount }}</dd></template>
      </dl>
      <a :href="BILLING_URL" target="_blank" rel="noopener">{{ info.review ? 'Review billing' : 'Manage credits' }}<AppIcon name="external" :size="13" /></a>
    </div>
  </div>
</template>
