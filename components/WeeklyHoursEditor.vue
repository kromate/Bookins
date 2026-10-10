<script setup>
// Weekly hours editor shared by Availability (the owner and each team member) and the Team dialog.
// `days` is the reactive array from `makeDays()`; rows edit it in place. `idPrefix` keeps ids unique when
// two editors can be on screen.
import { computed } from 'vue'
import { cloneWindows, dayIssues, endMinute, time } from '../weekly-hours.js'

const props = defineProps({
  days: { type: Array, required: true },
  disabled: Boolean,
  compact: Boolean,
  idPrefix: { type: String, default: 'hours' },
})
// notice: { kind: 'error' | 'info', text } so the page can toast it.
const emit = defineEmits(['notice'])
const issues = computed(() => dayIssues(props.days))

function addWindow(day) {
  const last = [...day.windows].map((item) => endMinute(item.end)).filter(Number.isFinite).sort((a, b) => a - b).pop()
  const start = Number.isFinite(last) ? last + 60 : 9 * 60
  if (start >= 23 * 60) {
    emit('notice', { kind: 'error', text: `There is no room left after ${day.windows.at(-1)?.end || 'the last window'} on ${day.name}.` })
    return
  }
  day.windows.push({ start: time(start), end: time(Math.min(start + 120, 1439)) })
}

function removeWindow(day, index) {
  if (day.windows.length <= 1) return
  day.windows.splice(index, 1)
}

function copyDayToWeekdays(source) {
  if (props.disabled) return
  for (const day of props.days.slice(1, 6)) {
    if (day === source) continue
    day.active = source.active
    day.windows = cloneWindows(source.windows)
  }
  emit('notice', { kind: 'info', text: `Copied ${source.name}'s hours to Monday to Friday. Save to keep them.` })
}
</script>

<template>
  <div class="weekly-hours" :class="{ 'weekly-hours--compact': compact }">
    <div v-for="day in days" :key="day.weekday" class="weekly-hours__day" :class="{ 'is-closed': !day.active }">
      <label class="weekly-hours__toggle"
        ><input v-model="day.active" :disabled="disabled" type="checkbox" /><span aria-hidden="true"><i /></span><strong>{{ day.name }}</strong></label
      >
      <div class="weekly-hours__windows">
        <template v-if="day.active">
          <div v-for="(item, index) in day.windows" :key="index" class="weekly-hours__window-row">
            <div class="weekly-hours__time-range">
              <input v-model="item.start" type="time" required :disabled="disabled" :aria-label="`${day.name} window ${index + 1} start time`" /><span class="weekly-hours__to">to</span
              ><input v-model="item.end" type="time" required :disabled="disabled" :aria-label="`${day.name} window ${index + 1} end time`" />
            </div>
            <button
              v-if="day.windows.length > 1"
              class="ghost small-button weekly-hours__remove"
              type="button"
              :disabled="disabled"
              :aria-label="`Remove ${day.name} window ${index + 1}`"
              @click="removeWindow(day, index)"
              >Remove</button
            >
          </div>
          <div class="weekly-hours__actions">
            <button class="ghost small-button" type="button" :disabled="disabled" @click="addWindow(day)">+ Add window</button>
            <button class="ghost small-button" type="button" :disabled="disabled" @click="copyDayToWeekdays(day)">Copy to Mon-Fri</button>
          </div>
          <p v-if="issues[day.weekday]" class="weekly-hours__issue" role="alert">{{ issues[day.weekday] }}</p>
        </template>
        <span v-else class="weekly-hours__closed-label">Unavailable</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.weekly-hours__day { min-height: 72px; padding: 14px var(--space-5); display: grid; grid-template-columns: 150px minmax(0, 1fr); align-items: start; gap: var(--space-4); border-top: 1px solid var(--line); transition: background var(--dur-fast) var(--ease); }
.weekly-hours__day.is-closed { background: var(--surface-soft); }
.weekly-hours__day.is-closed .weekly-hours__toggle strong { color: var(--muted); font-weight: 600; }
.weekly-hours__toggle { min-height: var(--control-h); display: flex; align-items: center; gap: 12px; cursor: pointer; }
.weekly-hours__toggle strong { font-size: var(--text-sm); font-weight: 650; }
.weekly-hours__toggle input { position: absolute; width: 1px; height: 1px; min-height: 0; opacity: 0; }
.weekly-hours__toggle > span { width: 40px; height: 24px; padding: 3px; display: flex; align-items: center; flex: none; border-radius: 99px; background: #c9cfdd; transition: background var(--dur-fast) var(--ease); }
.weekly-hours__toggle > span i { width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(16, 25, 40, 0.18); transition: transform var(--dur-fast) var(--ease); }
.weekly-hours__toggle input:checked + span { background: var(--accent); }
.weekly-hours__toggle input:checked + span i { transform: translateX(16px); }
.weekly-hours__toggle input:focus-visible + span { outline: 3px solid rgba(35, 54, 220, 0.22); outline-offset: 2px; }
.weekly-hours__windows { display: grid; gap: var(--space-2); min-width: 0; }
.weekly-hours__window-row { display: grid; grid-template-columns: minmax(280px, 360px) max-content; align-items: center; gap: var(--space-2); min-width: 0; }
.weekly-hours__time-range { min-width: 0; min-height: var(--control-h); padding: 0 4px; display: grid; grid-template-columns: minmax(108px, 1fr) auto minmax(108px, 1fr); align-items: center; gap: 4px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: #fff; }
.weekly-hours__time-range:focus-within { border-color: var(--accent); box-shadow: var(--focus-ring); }
.weekly-hours__time-range input { width: 100%; min-width: 0; min-height: 38px; padding: 0 8px; color: var(--ink); border: 0; border-radius: var(--radius-sm); background: transparent; font-size: var(--text-md); font-variant-numeric: tabular-nums; }
.weekly-hours__time-range input:focus, .weekly-hours__time-range input:focus-visible { outline: 0; box-shadow: none; }
.weekly-hours__to { color: var(--muted); font-size: var(--text-sm); }
.weekly-hours__remove { min-width: 88px; padding-inline: 14px; color: var(--danger); white-space: nowrap; }
.weekly-hours__actions { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-2); }
.weekly-hours__issue { margin: 0; color: var(--danger); font-size: var(--text-sm); }
.weekly-hours__closed-label { min-height: var(--control-h); display: inline-flex; align-items: center; color: var(--muted); font-size: var(--text-sm); }

/* Compact: inside dialogs, the day name sits above its windows. */
.weekly-hours--compact .weekly-hours__day { grid-template-columns: 1fr; gap: var(--space-2); padding: 12px var(--space-3); }
.weekly-hours--compact .weekly-hours__toggle { min-height: 40px; }

@media (max-width: 780px) {
  .weekly-hours__day { grid-template-columns: 1fr; gap: var(--space-2); padding: 14px var(--space-4); }
  .weekly-hours__window-row { grid-template-columns: minmax(0, 1fr) max-content; }
}
@media (max-width: 520px) {
  .weekly-hours__window-row { grid-template-columns: 1fr; }
  .weekly-hours__remove { justify-self: start; }
}
@media (max-width: 380px) {
  .weekly-hours__time-range { grid-template-columns: minmax(96px, 1fr) auto minmax(96px, 1fr); }
  .weekly-hours__time-range input { padding-inline: 4px; font-size: 16px; }
}
</style>
