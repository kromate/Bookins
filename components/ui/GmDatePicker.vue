<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useAttrs, useId, watch } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'radix-vue'

defineOptions({ inheritAttrs: false })
const props = defineProps({
  modelValue: { type: String, default: '' },
  min: { type: String, default: '' },
  max: { type: String, default: '' },
  disabled: Boolean,
  required: Boolean,
  id: { type: String, default: '' },
  label: { type: String, default: '' },
  name: { type: String, default: undefined },
  form: { type: String, default: undefined },
  portalTarget: { type: [String, Object], default: 'body' },
})
const emit = defineEmits(['update:modelValue', 'change', 'update:open', 'invalid'])
const attrs = useAttrs()
const generatedId = `gm-date-${useId()}`
const controlId = computed(() => props.id || generatedId)
const accessibleLabel = computed(() => props.label || attrs['aria-label'] || 'Date')
const open = ref(false)
const nativeControl = ref(null)
const trigger = ref(null)
const missingRequired = ref(false)
const today = civilFromDate(new Date())
const initial = parseCivil(props.modelValue) || today
const viewYear = ref(initial.year)
const viewMonth = ref(initial.month)
const focusedValue = ref(formatCivil(initial))
const dayButtons = new Map()

watch(open, (value) => {
  emit('update:open', value)
  if (typeof window !== 'undefined') {
    if (value) window.addEventListener('keydown', closeFromEscape, true)
    else window.removeEventListener('keydown', closeFromEscape, true)
  }
  if (!value) return
  const selected = parseCivil(props.modelValue) || clampCivil(today)
  viewYear.value = selected.year
  viewMonth.value = selected.month
  focusedValue.value = formatCivil(selected)
  nextTick(focusCurrentDay)
})
onBeforeUnmount(() => { if (typeof window !== 'undefined') window.removeEventListener('keydown', closeFromEscape, true) })
watch(() => props.modelValue, (value) => {
  if (value) missingRequired.value = false
})

function civilFromDate(date) {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
}
function parseCivil(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
  if (!match) return null
  const result = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  const check = new Date(result.year, result.month - 1, result.day, 12)
  return check.getFullYear() === result.year && check.getMonth() + 1 === result.month && check.getDate() === result.day ? result : null
}
function formatCivil({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
function addDays(value, amount) {
  const date = new Date(value.year, value.month - 1, value.day + amount, 12)
  return civilFromDate(date)
}
function addMonths(value, amount) {
  const date = new Date(value.year, value.month - 1 + amount, 1, 12)
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12).getDate()
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: Math.min(value.day, lastDay) }
}
function clampCivil(value) {
  const key = formatCivil(value)
  if (props.min && key < props.min) return parseCivil(props.min) || value
  if (props.max && key > props.max) return parseCivil(props.max) || value
  return value
}
function unavailable(value) {
  const key = formatCivil(value)
  return Boolean((props.min && key < props.min) || (props.max && key > props.max))
}
const monthLabel = computed(() => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(viewYear.value, viewMonth.value - 1, 1, 12)))
const displayValue = computed(() => {
  const value = parseCivil(props.modelValue)
  return value
    ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value.year, value.month - 1, value.day, 12))
    : 'Choose a date'
})
const days = computed(() => {
  const first = { year: viewYear.value, month: viewMonth.value, day: 1 }
  const mondayOffset = (new Date(first.year, first.month - 1, 1, 12).getDay() + 6) % 7
  const start = addDays(first, -mondayOffset)
  return Array.from({ length: 42 }, (_, index) => {
    const value = addDays(start, index)
    const key = formatCivil(value)
    return {
      ...value,
      key,
      currentMonth: value.month === viewMonth.value,
      today: key === formatCivil(today),
      selected: key === props.modelValue,
      disabled: unavailable(value),
    }
  })
})
const canGoPrevious = computed(() => !props.min || formatCivil(addMonths({ year: viewYear.value, month: viewMonth.value, day: 1 }, -1)).slice(0, 7) >= props.min.slice(0, 7))
const canGoNext = computed(() => !props.max || formatCivil(addMonths({ year: viewYear.value, month: viewMonth.value, day: 1 }, 1)).slice(0, 7) <= props.max.slice(0, 7))

function moveMonth(amount) {
  const focused = parseCivil(focusedValue.value) || { year: viewYear.value, month: viewMonth.value, day: 1 }
  const next = clampCivil(addMonths(focused, amount))
  viewYear.value = next.year
  viewMonth.value = next.month
  focusedValue.value = formatCivil(next)
}
function registerDay(key, element) {
  if (element) dayButtons.set(key, element)
  else dayButtons.delete(key)
}
function focusCurrentDay() {
  dayButtons.get(focusedValue.value)?.focus({ preventScroll: true })
}
function focusCivil(value) {
  const next = clampCivil(value)
  focusedValue.value = formatCivil(next)
  viewYear.value = next.year
  viewMonth.value = next.month
  nextTick(focusCurrentDay)
}
function onDayKeydown(event, value) {
  let next = null
  if (event.key === 'ArrowLeft') next = addDays(value, -1)
  else if (event.key === 'ArrowRight') next = addDays(value, 1)
  else if (event.key === 'ArrowUp') next = addDays(value, -7)
  else if (event.key === 'ArrowDown') next = addDays(value, 7)
  else if (event.key === 'Home') next = addDays(value, -((new Date(value.year, value.month - 1, value.day, 12).getDay() + 6) % 7))
  else if (event.key === 'End') next = addDays(value, 6 - ((new Date(value.year, value.month - 1, value.day, 12).getDay() + 6) % 7))
  else if (event.key === 'PageUp') next = addMonths(value, -1)
  else if (event.key === 'PageDown') next = addMonths(value, 1)
  if (!next) return
  event.preventDefault()
  focusCivil(next)
}
function choose(value) {
  if (props.disabled || unavailable(value)) return
  const next = formatCivil(value)
  emit('update:modelValue', next)
  emit('change', next)
  open.value = false
}
function clear() {
  emit('update:modelValue', '')
  emit('change', '')
  open.value = false
}
function closeFromEscape(event) {
  if (!open.value || event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  open.value = false
  nextTick(() => trigger.value?.focus({ preventScroll: true }))
}
function onInvalid(event) {
  if (event.target !== nativeControl.value) return
  event.preventDefault()
  missingRequired.value = true
  trigger.value?.focus()
  emit('invalid')
}
</script>

<template>
  <span class="gm-picker-shell" @invalid.capture="onInvalid">
    <input
      ref="nativeControl"
      class="gm-picker-native"
      type="date"
      tabindex="-1"
      aria-hidden="true"
      :name="name"
      :form="form"
      :value="modelValue"
      :min="min || undefined"
      :max="max || undefined"
      :required="required"
      :disabled="disabled"
    />
    <PopoverRoot v-model:open="open">
      <PopoverTrigger as-child>
        <button
          :id="controlId"
          ref="trigger"
          v-bind="$attrs"
          class="gm-picker-trigger"
          type="button"
          :disabled="disabled"
          :aria-label="accessibleLabel"
          :aria-required="required || undefined"
          :aria-invalid="missingRequired || undefined"
        >
          <span :class="{ 'gm-picker-placeholder': !modelValue }">{{ displayValue }}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v3M17 2v3M3.5 9h17M5 4.5h14a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z" /></svg>
        </button>
      </PopoverTrigger>
      <PopoverPortal :to="portalTarget">
        <PopoverContent :aria-label="accessibleLabel" class="gm-picker-content gm-date-content" :side-offset="6" :collision-padding="12" @open-auto-focus.prevent>
          <div class="gm-picker-heading">
            <button type="button" :disabled="!canGoPrevious" aria-label="Previous month" @click="moveMonth(-1)">‹</button>
            <strong aria-live="polite">{{ monthLabel }}</strong>
            <button type="button" :disabled="!canGoNext" aria-label="Next month" @click="moveMonth(1)">›</button>
          </div>
          <div class="gm-date-weekdays" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
          <div class="gm-date-grid" role="group" :aria-label="monthLabel">
            <button
              v-for="day in days"
              :key="day.key"
              :ref="(element) => registerDay(day.key, element)"
              type="button"
              :tabindex="day.key === focusedValue ? 0 : -1"
              :disabled="day.disabled"
              :class="{ 'is-outside': !day.currentMonth, 'is-today': day.today, 'is-selected': day.selected }"
              :aria-label="new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(new Date(day.year, day.month - 1, day.day, 12))"
              :aria-pressed="day.selected"
              @click="choose(day)"
              @keydown="onDayKeydown($event, day)"
            >{{ day.day }}</button>
          </div>
          <div class="gm-picker-footer">
            <button v-if="modelValue && !required" type="button" class="gm-picker-text-button" @click="clear">Clear</button>
            <button type="button" class="gm-picker-text-button" @click="open = false">Cancel</button>
            <span />
            <button type="button" class="gm-picker-text-button" @click="focusCivil(clampCivil(today))">Today</button>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </span>
</template>

<style>
.gm-picker-shell { position: relative; display: block; min-width: 0; }
.gm-picker-native { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.gm-picker-shell input[aria-hidden='true'] { min-width: 0; min-height: 0; max-width: 1px; max-height: 1px; padding: 0; border: 0; }
.gm-picker-trigger { box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; padding: 10px 12px; display: inline-flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--gm-color-text, #18181b); border: 1px solid var(--gm-color-border, #dce3ea); border-radius: var(--gm-radius-control, 10px); background: var(--gm-color-surface, #fff); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.gm-picker-trigger svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; color: var(--muted, #64616d); }
.gm-picker-trigger:focus-visible, .gm-picker-content button:focus-visible { outline: 2px solid var(--gm-color-focus, #2336dc); outline-offset: 2px; }
.gm-picker-trigger[aria-invalid='true'] { border-color: var(--gm-color-danger, #b42318); }
.gm-picker-trigger:disabled { opacity: .55; cursor: not-allowed; }
.gm-picker-placeholder { color: var(--muted, #64616d); }
.gm-picker-content { box-sizing: border-box; z-index: 1100; max-height: min(calc(100dvh - 24px), var(--radix-popover-content-available-height, calc(100dvh - 24px))); overflow-y: auto; overscroll-behavior: contain; max-width: calc(100vw - 24px); padding: 12px; color: var(--gm-color-text, #18181b); border: 1px solid var(--gm-color-border-subtle, #dce3ea); border-radius: 12px; background: var(--gm-color-surface, #fff); box-shadow: 0 14px 38px rgb(16 25 40 / 18%); font: 14px/1.4 var(--gm-font-body, system-ui, sans-serif); }
.gm-date-content { width: min(328px, calc(100vw - 24px)); }
.gm-picker-heading { min-height: 38px; display: grid; grid-template-columns: 38px 1fr 38px; align-items: center; gap: 4px; }
.gm-picker-heading strong { text-align: center; font-size: 14px; }
.gm-picker-heading button, .gm-date-grid button { display: grid; place-items: center; padding: 0; color: inherit; border: 0; border-radius: 8px; background: transparent; font: inherit; cursor: pointer; }
.gm-picker-heading button { width: 38px; height: 38px; font-size: 24px; }
.gm-picker-heading button:hover:not(:disabled), .gm-date-grid button:hover:not(:disabled) { background: var(--gm-color-brand-subtle, #f4efff); }
.gm-picker-heading button:disabled, .gm-date-grid button:disabled { opacity: .3; cursor: not-allowed; }
.gm-date-weekdays, .gm-date-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
.gm-date-weekdays { margin: 8px 0 4px; color: var(--muted, #64616d); font-size: 11px; text-align: center; }
.gm-date-weekdays span { padding: 4px 0; }
.gm-date-grid button { aspect-ratio: 1; min-width: 0; font-variant-numeric: tabular-nums; }
.gm-date-grid button.is-outside { color: var(--muted, #64616d); opacity: .62; }
.gm-date-grid button.is-today { box-shadow: inset 0 0 0 1px var(--gm-color-brand, #2336dc); }
.gm-date-grid button.is-selected { color: var(--gm-color-on-brand, #fff); background: var(--gm-color-brand, #2336dc); font-weight: 700; }
.gm-picker-footer { min-height: 38px; margin-top: 8px; padding-top: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid var(--gm-color-border-subtle, #dce3ea); }
.gm-picker-footer > span { flex: 1; }
.gm-picker-text-button { min-height: 36px; padding: 0 10px; color: var(--gm-color-brand, #2336dc); border: 0; border-radius: 8px; background: transparent; font: inherit; font-weight: 700; cursor: pointer; }
.gm-picker-text-button:hover { background: var(--gm-color-brand-subtle, #f4efff); }
@media (max-width: 700px) { .gm-picker-trigger { font-size: 16px; } }
</style>
