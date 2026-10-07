<script setup>
// Start-time interval picker with the plain-language rule behind it. Shared by Availability (the owner and each
// team member) and the Team dialog. `maxDuration` is the longest service this schedule has to fit.
import { computed, ref } from 'vue'
import GmHint from './ui/GmHint.vue'
import GmSelect from './ui/GmSelect.vue'
import { durationWords, intervalOptionsFor } from '../weekly-hours.js'

const props = defineProps({
  id: { type: String, default: 'slot-interval' },
  maxDuration: { type: Number, default: 0 },
  longestName: { type: String, default: '' },
  disabled: Boolean,
  // true: intervals shorter than the longest service cannot be picked. false: they can, with a warning.
  strict: { type: Boolean, default: true },
  // Soft pulse after "Fix interval in Availability" sent the owner here.
  highlight: Boolean,
  who: { type: String, default: 'your' },
  // A team exists: a long service can be kept off this calendar by choosing which services the person offers.
  team: Boolean,
})
const model = defineModel({ type: Number, default: 60 })
const root = ref(null)
const options = computed(() => intervalOptionsFor(props.maxDuration, model.value, { strict: props.strict }))
const tooShort = computed(() => props.maxDuration > model.value)
const words = computed(() => durationWords(model.value))
defineExpose({ el: root })
</script>

<template>
  <div ref="root" class="field interval-field" :class="{ highlight }">
    <label :for="id">Start-time interval <GmHint text="How far apart appointment start times are. With 60 minutes, guests can start at 9:00, 10:00, 11:00. A 30 minute service on a 60 minute interval leaves 30 minutes free before the next one. Long services (for example a 4 hour install) need an interval at least as long." label="About the start-time interval" /></label>
    <GmSelect :id="id" v-model="model" :options="options" label="Start-time interval" :disabled="disabled" :described-by="`${id}-help`" />
    <p :id="`${id}-help`" class="field-hint" :class="{ 'field-error': tooShort && !strict }">
      <template v-if="maxDuration && tooShort && !strict">This is shorter than {{ longestName ? `${longestName}` : 'the longest service' }} ({{ maxDuration }} minutes), so that service cannot be offered on {{ who }} calendar until the interval is at least {{ maxDuration }} minutes. Raise it, or offer fewer services above.</template>
      <template v-else-if="maxDuration">Must be at least as long as {{ who }} longest active service ({{ longestName }}, {{ maxDuration }} minutes), so shorter intervals are unavailable.<template v-if="team"> To keep a shorter interval, choose which services this person offers on the <RouterLink to="/team">Team page</RouterLink> and leave the long ones off.</template></template>
      <template v-else-if="!strict">How often this person's appointments can start. It needs to be at least as long as the longest service they offer.</template>
      <template v-else>You have no services yet, so any interval works. Once you add one, the interval must be at least as long as it.</template>
    </p>
    <p class="interval-explain">
      Every service on this schedule must be no longer than the interval, and bookings can only start every {{ model }} minutes ({{ words }}). For a 4-hour service use a 4-hour interval, but then short services on the same schedule also start only every 4 hours. Give long services their own team member/calendar if you also need short ones.
    </p>
    <slot />
  </div>
</template>

<style scoped>
.interval-explain { margin: var(--space-2) 0 0; padding: var(--space-2) var(--space-3); color: var(--ink-soft, var(--muted)); border-left: 3px solid var(--line-strong); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; background: var(--surface-soft); font-size: var(--text-xs); line-height: 1.55; }
.interval-field { border-radius: var(--radius-sm); transition: box-shadow var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease); }
.interval-field.highlight { margin: calc(var(--space-2) * -1); padding: var(--space-2); background: rgb(35 54 220 / 6%); box-shadow: 0 0 0 2px var(--accent); }
</style>
