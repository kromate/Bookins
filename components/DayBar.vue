<script setup lang="ts">
// One day's open hours drawn to scale on a time rail. Used by the hours editor, the Team roster and Availability.
// Decorative for screen readers when `label` is empty (the same hours are written out next to it).
import { computed } from 'vue'

interface MinuteWindow { start: number; end: number }
const props = withDefaults(defineProps<{
  windows: MinuteWindow[]
  /** First and last minute of the visible track. Widened automatically to fit every window. */
  from?: number
  to?: number
  color?: string
  label?: string
  compact?: boolean
}>(), { from: 7 * 60, to: 21 * 60, color: '', label: '', compact: false })

const valid = computed(() => props.windows.filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start))
const range = computed(() => {
  const first = Math.min(props.from, ...valid.value.map((item) => item.start))
  const last = Math.max(props.to, ...valid.value.map((item) => item.end))
  return { first, span: Math.max(60, last - first) }
})
const segments = computed(() => valid.value.map((item) => ({
  key: `${item.start}-${item.end}`,
  left: ((item.start - range.value.first) / range.value.span) * 100,
  width: ((item.end - item.start) / range.value.span) * 100,
})))
</script>

<template>
  <span
    class="day-bar"
    :class="{ 'is-compact': compact, 'is-closed': !segments.length }"
    :style="color ? { '--day-bar-fill': color } : undefined"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
  >
    <i v-for="segment in segments" :key="segment.key" :style="{ left: `${segment.left}%`, width: `${segment.width}%` }" />
  </span>
</template>

<style scoped>
.day-bar {
  position: relative;
  display: block;
  width: 100%;
  min-width: 48px;
  height: 10px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--surface-sunken);
}
.day-bar.is-compact { height: 6px; }
.day-bar.is-closed { background: repeating-linear-gradient(135deg, var(--surface-sunken) 0 4px, var(--surface) 4px 8px); }
.day-bar i {
  position: absolute;
  top: 0;
  bottom: 0;
  min-width: 3px;
  border-left: 3px solid color-mix(in srgb, var(--day-bar-fill, var(--accent)) 78%, #000);
  border-radius: 1px 3px 3px 1px;
  background: var(--day-bar-fill, var(--accent));
}
</style>
