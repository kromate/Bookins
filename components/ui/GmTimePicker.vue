<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useAttrs, useId, watch } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'radix-vue'

defineOptions({ inheritAttrs: false })
const props = defineProps({
  modelValue: { type: String, default: '' },
  step: { type: Number, default: 60 },
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
const generatedId = `gm-time-${useId()}`
const controlId = computed(() => props.id || generatedId)
const accessibleLabel = computed(() => props.label || attrs['aria-label'] || 'Time')
const open = ref(false)
const nativeControl = ref(null)
const trigger = ref(null)
const missingRequired = ref(false)
const draftHour = ref('09')
const draftMinute = ref('00')

const validTime = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '')
const hours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))
const minutes = computed(() => {
  const values = new Set()
  if (props.step > 0 && props.step % 60 === 0) {
    const increment = props.step / 60
    const base = validTime(props.min) ? Number(props.min.slice(0, 2)) * 60 + Number(props.min.slice(3, 5)) : 0
    for (let minute = base; minute < 24 * 60; minute += increment) values.add(String(minute % 60).padStart(2, '0'))
  } else {
    for (let minute = 0; minute < 60; minute += 1) values.add(String(minute).padStart(2, '0'))
  }
  if (validTime(props.modelValue)) values.add(props.modelValue.slice(3, 5))
  values.add(draftMinute.value)
  return [...values].sort()
})
const draftValue = computed(() => `${draftHour.value}:${draftMinute.value}`)
const draftAllowed = computed(() => selectable(draftValue.value))
const displayValue = computed(() => validTime(props.modelValue) ? props.modelValue : 'Choose a time')
const nativeStep = computed(() => {
  if (!validTime(props.modelValue) || props.step <= 0) return props.step
  const [hour, minute] = props.modelValue.split(':').map(Number)
  const base = validTime(props.min) ? props.min.split(':').map(Number) : [0, 0]
  const elapsedSeconds = (hour * 60 + minute - (base[0] * 60 + base[1])) * 60
  return elapsedSeconds % props.step === 0 ? props.step : 'any'
})

watch(open, (value) => {
  emit('update:open', value)
  if (typeof window !== 'undefined') {
    if (value) window.addEventListener('keydown', closeFromEscape, true)
    else window.removeEventListener('keydown', closeFromEscape, true)
  }
  if (!value) return
  const source = validTime(props.modelValue) ? props.modelValue : firstAllowed()
  draftHour.value = source.slice(0, 2)
  draftMinute.value = source.slice(3, 5)
  nextTick(() => document.querySelector(`[data-gm-time-hour="${draftHour.value}"]`)?.scrollIntoView({ block: 'nearest' }))
})
onBeforeUnmount(() => { if (typeof window !== 'undefined') window.removeEventListener('keydown', closeFromEscape, true) })
watch(() => props.modelValue, (value) => {
  if (value) missingRequired.value = false
})

function allowed(value) {
  return validTime(value) && (!props.min || value >= props.min) && (!props.max || value <= props.max)
}
function followsStep(value) {
  if (!validTime(value) || props.step <= 0) return true
  const [hour, minute] = value.split(':').map(Number)
  const base = validTime(props.min) ? props.min.split(':').map(Number) : [0, 0]
  return ((hour * 60 + minute - (base[0] * 60 + base[1])) * 60) % props.step === 0
}
function selectable(value) {
  return allowed(value) && (followsStep(value) || value === props.modelValue)
}
function firstAllowed() {
  for (let value = 0; value < 24 * 60; value += 1) {
    const candidate = `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
    if (allowed(candidate) && followsStep(candidate)) return candidate
  }
  return '09:00'
}
function hourAllowed(hour) {
  return minutes.value.some((minute) => selectable(`${hour}:${minute}`))
}
function minuteAllowed(minute) {
  return selectable(`${draftHour.value}:${minute}`)
}
function chooseHour(hour) {
  if (!hourAllowed(hour)) return
  draftHour.value = hour
  if (!minuteAllowed(draftMinute.value)) draftMinute.value = minutes.value.find(minuteAllowed) || draftMinute.value
}
function chooseMinute(minute) {
  if (minuteAllowed(minute)) draftMinute.value = minute
}
function apply() {
  if (!draftAllowed.value) return
  emit('update:modelValue', draftValue.value)
  emit('change', draftValue.value)
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
function onOptionKeydown(event, selector) {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  const options = [...event.currentTarget.closest(selector).querySelectorAll('button:not(:disabled)')]
  const index = options.indexOf(event.currentTarget)
  if (index < 0) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length
  options[next]?.focus()
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
      type="time"
      tabindex="-1"
      aria-hidden="true"
      :name="name"
      :form="form"
      :value="modelValue"
      :step="nativeStep"
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
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        </button>
      </PopoverTrigger>
      <PopoverPortal :to="portalTarget">
        <PopoverContent :aria-label="accessibleLabel" class="gm-picker-content gm-time-content" :side-offset="6" :collision-padding="12">
          <p class="gm-time-title">{{ accessibleLabel }}</p>
          <div class="gm-time-columns">
            <div>
              <span>Hour</span>
              <div class="gm-time-list gm-time-hours" role="listbox" aria-label="Hour">
                <button
                  v-for="hour in hours"
                  :key="hour"
                  type="button"
                  role="option"
                  :data-gm-time-hour="hour"
                  :aria-selected="draftHour === hour"
                  :tabindex="draftHour === hour ? 0 : -1"
                  :disabled="!hourAllowed(hour)"
                  @click="chooseHour(hour)"
                  @keydown="onOptionKeydown($event, '.gm-time-hours')"
                >{{ hour }}</button>
              </div>
            </div>
            <div aria-hidden="true" class="gm-time-colon">:</div>
            <div>
              <span>Minute</span>
              <div class="gm-time-list gm-time-minutes" role="listbox" aria-label="Minute">
                <button
                  v-for="minute in minutes"
                  :key="minute"
                  type="button"
                  role="option"
                  :aria-selected="draftMinute === minute"
                  :tabindex="draftMinute === minute ? 0 : -1"
                  :disabled="!minuteAllowed(minute)"
                  @click="chooseMinute(minute)"
                  @keydown="onOptionKeydown($event, '.gm-time-minutes')"
                >{{ minute }}</button>
              </div>
            </div>
          </div>
          <div class="gm-picker-footer">
            <button v-if="modelValue && !required" type="button" class="gm-picker-text-button" @click="clear">Clear</button>
            <button type="button" class="gm-picker-text-button" @click="open = false">Cancel</button>
            <span />
            <button type="button" class="gm-picker-apply" :disabled="!draftAllowed" @click="apply">Use {{ draftValue }}</button>
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
.gm-picker-footer { min-height: 38px; margin-top: 8px; padding-top: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid var(--gm-color-border-subtle, #dce3ea); }
.gm-picker-footer > span { flex: 1; }
.gm-picker-text-button { min-height: 36px; padding: 0 10px; color: var(--gm-color-brand, #2336dc); border: 0; border-radius: 8px; background: transparent; font: inherit; font-weight: 700; cursor: pointer; }
.gm-picker-text-button:hover { background: var(--gm-color-brand-subtle, #f4efff); }
.gm-time-content { width: min(270px, calc(100vw - 24px)); }
.gm-time-title { margin: 0 0 8px; font-weight: 700; }
.gm-time-columns { display: grid; grid-template-columns: 1fr 12px 1fr; align-items: end; gap: 4px; }
.gm-time-columns > div:not(.gm-time-colon) { min-width: 0; }
.gm-time-columns > div > span { display: block; margin-bottom: 4px; color: var(--muted, #64616d); font-size: 11px; text-align: center; }
.gm-time-colon { align-self: center; padding-top: 18px; font-size: 20px; font-weight: 700; text-align: center; }
.gm-time-list { height: 196px; padding: 4px; overflow-y: auto; overscroll-behavior: contain; border: 1px solid var(--gm-color-border-subtle, #dce3ea); border-radius: 9px; scrollbar-width: thin; }
.gm-time-list button { width: 100%; min-height: 38px; padding: 0 8px; color: inherit; border: 0; border-radius: 7px; background: transparent; font: inherit; font-variant-numeric: tabular-nums; cursor: pointer; }
.gm-time-list button:hover:not(:disabled) { background: var(--gm-color-brand-subtle, #f4efff); }
.gm-time-list button[aria-selected='true'] { color: var(--gm-color-on-brand, #fff); background: var(--gm-color-brand, #2336dc); font-weight: 700; }
.gm-time-list button:disabled { opacity: .28; cursor: not-allowed; }
.gm-picker-apply { min-height: 36px; padding: 0 12px; color: var(--gm-color-on-brand, #fff); border: 0; border-radius: 8px; background: var(--gm-color-brand, #2336dc); font: inherit; font-weight: 700; cursor: pointer; }
.gm-picker-apply:disabled { opacity: .45; cursor: not-allowed; }
@media (max-width: 700px) { .gm-picker-trigger { font-size: 16px; } }
</style>
