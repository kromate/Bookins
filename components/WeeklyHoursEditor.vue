<script setup lang="ts">
// Weekly hours editor shared by Availability (the owner and each team member) and the Team dialog.
// `days` is the reactive array from `makeDays()` (Sunday first, as stored); rows show Monday first and edit it in place.
// Each row draws its hours to scale on a day bar. `idPrefix` keeps ids unique when two editors are on screen.
import { computed } from 'vue'
import DayBar from './DayBar.vue'
import GmTimePicker from './ui/GmTimePicker.vue'
import { cloneWindows, dayIssues, endMinute, minute, time } from '../weekly-hours.ts'

const props = withDefaults(defineProps<{ days: EditableDay[]; disabled?: boolean; compact?: boolean; idPrefix?: string; color?: string }>(), { disabled: false, compact: false, idPrefix: 'hours', color: '' })
// notice: { kind: 'error' | 'info', text } so the page can toast it.
const emit = defineEmits<{ notice: [notice: { kind: 'error' | 'info'; text: string }] }>()
const issues = computed(() => dayIssues(props.days))
const ordered = computed(() => [...props.days.filter((day) => day.weekday !== 0), ...props.days.filter((day) => day.weekday === 0)])
// "Use for Monday to Friday" is offered once, on the first open weekday, instead of on every row.
const copySource = computed(() => ordered.value.find((day) => day.active && day.weekday >= 1 && day.weekday <= 5)?.weekday)
const barWindows = (day: EditableDay) => (day.active ? day.windows.map((item) => ({ start: minute(item.start), end: endMinute(item.end) })) : [])

function addWindow(day: EditableDay) {
  const last = [...day.windows].map((item) => endMinute(item.end)).filter(Number.isFinite).sort((a, b) => a - b).pop()
  const start = Number.isFinite(last) ? (last ?? 0) + 60 : 9 * 60
  if (start >= 23 * 60) {
    emit('notice', { kind: 'error', text: `There is no room left after ${day.windows.at(-1)?.end || 'the last time range'} on ${day.name}.` })
    return
  }
  day.windows.push({ start: time(start), end: time(Math.min(start + 120, 1439)) })
}

function removeWindow(day: EditableDay, index: number) {
  if (day.windows.length <= 1) return
  day.windows.splice(index, 1)
}

function copyDayToWeekdays(source: EditableDay) {
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
    <div v-for="day in ordered" :key="day.weekday" class="weekly-hours__day" :class="{ 'is-closed': !day.active }">
      <label class="weekly-hours__toggle"
        ><input v-model="day.active" :disabled="disabled" type="checkbox" /><span aria-hidden="true"><i /></span><strong>{{ day.name }}</strong></label
      >
      <div class="weekly-hours__windows">
        <template v-if="day.active">
          <div v-for="(item, index) in day.windows" :key="index" class="weekly-hours__window-row">
            <div class="weekly-hours__time-range">
              <GmTimePicker :id="`${idPrefix}-${day.weekday}-${index}-start`" v-model="item.start" required :disabled="disabled" :label="`${day.name} time range ${index + 1} start`" /><span class="weekly-hours__to">to</span
              ><GmTimePicker :id="`${idPrefix}-${day.weekday}-${index}-end`" v-model="item.end" required :disabled="disabled" :label="`${day.name} time range ${index + 1} end`" />
            </div>
            <button
              v-if="day.windows.length > 1"
              class="ghost small weekly-hours__remove"
              type="button"
              :disabled="disabled"
              :aria-label="`Remove ${day.name} time range ${index + 1}`"
              @click="removeWindow(day, index)"
              >Remove</button
            >
          </div>
          <p v-if="issues[day.weekday]" class="weekly-hours__issue" role="alert">{{ issues[day.weekday] }}</p>
          <div class="weekly-hours__actions">
            <button class="link-button" type="button" :disabled="disabled" @click="addWindow(day)">Add a break or second range</button>
            <button v-if="day.weekday === copySource" class="link-button" type="button" :disabled="disabled" @click="copyDayToWeekdays(day)">Use for Monday to Friday</button>
          </div>
        </template>
        <span v-else class="weekly-hours__closed-label">Closed</span>
      </div>
      <DayBar class="weekly-hours__bar" :windows="barWindows(day)" :color="color" />
    </div>
  </div>
</template>

<style scoped>
.weekly-hours { container-type: inline-size; }
.weekly-hours__day { min-height: 72px; padding: var(--space-3) var(--space-5); display: grid; grid-template-columns: 150px minmax(0, 1fr) minmax(120px, 200px); align-items: start; gap: var(--space-4); border-top: 1px solid var(--line); }
.weekly-hours__day.is-closed { background: var(--surface-soft); }
.weekly-hours__day.is-closed .weekly-hours__toggle strong { color: var(--muted); font-weight: var(--weight-medium); }
.weekly-hours__toggle { min-height: var(--control-h); display: flex; align-items: center; gap: 12px; cursor: pointer; }
.weekly-hours__toggle strong { font-size: var(--text-sm); font-weight: var(--weight-strong); }
.weekly-hours__toggle input { position: absolute; width: 1px; height: 1px; min-height: 0; opacity: 0; }
.weekly-hours__toggle > span { width: 40px; height: 24px; padding: 3px; display: flex; align-items: center; flex: none; border-radius: 99px; background: var(--line-strong); transition: background var(--dur-fast) var(--ease); }
.weekly-hours__toggle > span i { width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: var(--shadow-1); transition: transform var(--dur-fast) var(--ease); }
.weekly-hours__toggle input:checked + span { background: var(--accent); }
.weekly-hours__toggle input:checked + span i { transform: translateX(16px); }
.weekly-hours__toggle input:focus-visible + span { outline: 3px solid var(--focus-color); outline-offset: 2px; }
.weekly-hours__windows { display: grid; gap: var(--space-2); min-width: 0; }
.weekly-hours__window-row { display: grid; grid-template-columns: minmax(240px, 340px) max-content; align-items: center; gap: var(--space-2); min-width: 0; }
.weekly-hours__time-range { min-width: 0; min-height: var(--control-h); padding: 0 4px; display: grid; grid-template-columns: minmax(100px, 1fr) auto minmax(100px, 1fr); align-items: center; gap: 4px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); }
.weekly-hours__time-range:focus-within { border-color: var(--accent); box-shadow: var(--focus-ring); }
.weekly-hours__time-range :deep(.gm-picker-trigger) { min-height: 38px; padding: 0 8px; color: var(--ink); border: 0; border-radius: var(--radius-sm); background: transparent; font-size: var(--text-md); font-variant-numeric: tabular-nums; }
.weekly-hours__time-range :deep(.gm-picker-trigger:focus), .weekly-hours__time-range :deep(.gm-picker-trigger:focus-visible) { outline: 0; box-shadow: none; }
.weekly-hours__to { color: var(--muted); font-size: var(--text-sm); }
.weekly-hours__remove { color: var(--danger); }
.weekly-hours__actions { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); }
.weekly-hours__actions .link-button { min-height: 32px; font-size: var(--text-xs); text-decoration: none; }
.weekly-hours__actions .link-button:hover { text-decoration: underline; }
.weekly-hours__issue { margin: 0; color: var(--danger); font-size: var(--text-sm); }
.weekly-hours__closed-label { min-height: var(--control-h); display: inline-flex; align-items: center; color: var(--muted); font-size: var(--text-sm); }
.weekly-hours__bar { align-self: center; }

/* Compact: inside dialogs, the day name sits above its ranges and the bar is a thin line under them. */
.weekly-hours--compact .weekly-hours__day { grid-template-columns: 1fr; gap: var(--space-2); padding: 12px var(--space-3); }
.weekly-hours--compact .weekly-hours__toggle { min-height: 40px; }
.weekly-hours--compact .weekly-hours__bar { grid-column: auto; max-width: none; }

/* Sized by the editor's own width, not the window: on Availability the card is ~545px at 1280px, too narrow for three columns.
   Below 780px the bar drops under the time ranges in the same column; below 560px the day name goes on top as on phones. */
@container (max-width: 779px) {
  .weekly-hours__day { grid-template-columns: 150px minmax(0, 1fr); row-gap: var(--space-2); }
  .weekly-hours__bar { grid-column: 2; max-width: 340px; }
}
@container (max-width: 559px) {
  .weekly-hours__day { grid-template-columns: 1fr; gap: var(--space-2); padding: var(--space-3) var(--space-4); }
  .weekly-hours__bar { grid-column: auto; max-width: none; }
}
@container (max-width: 399px) {
  .weekly-hours__window-row { grid-template-columns: 1fr; }
  .weekly-hours__remove { justify-self: start; }
}

@media (max-width: 900px) {
  .weekly-hours__day { grid-template-columns: 1fr; gap: var(--space-2); padding: var(--space-3) var(--space-4); }
  .weekly-hours__window-row { grid-template-columns: minmax(0, 1fr) max-content; }
  .weekly-hours__bar { grid-column: auto; max-width: none; }
}
@media (max-width: 520px) {
  .weekly-hours__window-row { grid-template-columns: 1fr; }
  .weekly-hours__remove { justify-self: start; }
}
@media (max-width: 380px) {
  .weekly-hours__time-range { grid-template-columns: minmax(90px, 1fr) auto minmax(90px, 1fr); }
  .weekly-hours__time-range :deep(.gm-picker-trigger) { padding-inline: 4px; font-size: 16px; }
}
</style>
