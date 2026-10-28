<script setup lang="ts">
// A service's length drawn inside one start-time interval, so "a service can't be longer than the interval" is visible
// before it becomes an error. The written caption carries the same facts for screen readers.
import { computed } from 'vue'

const props = withDefaults(defineProps<{ duration: number; interval: number; caption?: boolean }>(), { caption: true })
const fits = computed(() => !props.interval || props.duration <= props.interval)
const fill = computed(() => (props.interval ? Math.min(100, (props.duration / props.interval) * 100) : 100))
const free = computed(() => Math.max(0, props.interval - props.duration))
const text = computed(() => {
  if (!props.interval) return `${props.duration} min`
  if (!fits.value) return `${props.duration} min is longer than the ${props.interval}-min interval`
  return free.value ? `${props.duration} min, then ${free.value} min free` : `${props.duration} min fills the interval`
})
</script>

<template>
  <span class="slot-meter" :class="{ 'is-over': !fits }">
    <span class="slot-meter__track" aria-hidden="true"><i :style="{ width: `${fill}%` }" /></span>
    <span v-if="caption" class="slot-meter__caption tnum">{{ text }}</span>
    <span v-else class="visually-hidden">{{ text }}</span>
  </span>
</template>

<style scoped>
.slot-meter { min-width: 0; display: grid; gap: 4px; }
.slot-meter__track { position: relative; display: block; height: 8px; overflow: hidden; border: 1px dashed var(--line-strong); border-radius: 2px 4px 4px 2px; background: var(--surface); }
/* The booked length is solid; the dashed track left over is free time. */
.slot-meter__track i { position: absolute; inset: 0 auto 0 0; display: block; background: var(--accent); }
.slot-meter.is-over .slot-meter__track { border-style: solid; border-color: var(--danger-line); }
.slot-meter.is-over .slot-meter__track i { background: var(--danger); }
.slot-meter__caption { color: var(--muted); font-size: var(--text-xs); line-height: 1.3; }
.slot-meter.is-over .slot-meter__caption { color: var(--danger); font-weight: var(--weight-strong); }
</style>
