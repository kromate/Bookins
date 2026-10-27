<script setup lang="ts" generic="T extends string | number | boolean = string">
import { computed, nextTick, ref, useId, watch, watchPostEffect } from 'vue'
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectIcon,
  SelectPortal,
  SelectContent,
  SelectViewport,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from 'radix-vue'

defineOptions({ inheritAttrs: false })
type SelectValueType = string | number | boolean
interface SelectOption<V extends SelectValueType> { value: V; label: string; disabled?: boolean }
const props = withDefaults(defineProps<{ id?: string; modelValue?: T; options: SelectOption<T>[]; placeholder?: string; label: string; name?: string; form?: string; autocomplete?: string; disabled?: boolean; required?: boolean; loading?: boolean; invalid?: boolean; searchable?: boolean; searchPlaceholder?: string; describedBy?: string; theme?: 'light' | 'dark'; portalTarget?: string | HTMLElement }>(), { placeholder: 'Select an option', disabled: false, required: false, loading: false, invalid: false, searchable: false, searchPlaceholder: 'Search options', theme: 'light', portalTarget: 'body' })
const emit = defineEmits<{ 'update:modelValue': [value: T]; change: [value: T]; 'update:open': [value: boolean]; invalid: [] }>()
const missingRequired = ref(false)
const open = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)
const searchQuery = ref('')
watch(open, async (value) => {
  emit('update:open', value)
  if (!value) {
    searchQuery.value = ''
    return
  }
  if (!props.searchable) return
  await nextTick()
  window.requestAnimationFrame(() => searchInput.value?.focus({ preventScroll: true }))
})
const nativeControl = ref<HTMLSelectElement | null>(null)
// Form reset restores the initial value, not the current reactive selection.
const initialValue = props.modelValue
const errorId = useId() + '-select-error'
const descriptionIds = computed(
  () =>
    [props.describedBy, missingRequired.value ? errorId : undefined].filter(Boolean).join(' ') ||
    undefined,
)
watch(
  () => props.modelValue,
  (value) => {
    if (value !== undefined && value !== null && value !== '') missingRequired.value = false
  },
)
const onInvalid = (event: Event) => {
  if (!(event.target instanceof HTMLSelectElement)) return
  event.preventDefault()
  missingRequired.value = true
  const owner = event.target.form
  const firstInvalid = owner ? [...owner.elements].find((control) => {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) return false
    return control.willValidate && !control.validity.valid
  }) : event.target
  if (firstInvalid === event.target && event.currentTarget instanceof Element) event.currentTarget.querySelector<HTMLElement>('.gm-select-trigger')?.focus()
  emit('invalid')
}
const selectedIndex = computed(() =>
  props.options.findIndex((option) => option.value === props.modelValue),
)
const selected = computed(() => props.options[selectedIndex.value])
const filteredOptions = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  if (!props.searchable || !query) return props.options
  return props.options.filter((option) => option.label.toLocaleLowerCase().includes(query))
})
// HTML required selects treat only the first empty option as the missing-value placeholder.
const nativeSelectedIndex = computed(() => props.required && props.modelValue === '' ? 0 : selectedIndex.value + 1)
const optionKey = (value: SelectValueType) => typeof value + ':' + String(value)
const internalValue = computed(() => (selected.value ? optionKey(selected.value.value) : ''))
const syncNativeSelection = () => {
  if (nativeControl.value) nativeControl.value.selectedIndex = nativeSelectedIndex.value
}
watchPostEffect(syncNativeSelection)
const onFormReset = async (event: Event) => {
  // A later listener can cancel reset; wait until dispatch finishes before changing the model.
  await Promise.resolve()
  if (event.defaultPrevented) return
  open.value = false
  missingRequired.value = false
  emit('update:modelValue', (initialValue ?? '') as T)
  await nextTick()
  syncNativeSelection()
}
watchPostEffect((onCleanup) => {
  // Reading form tracks reassociation when the explicit form prop changes.
  const formId = props.form
  const owner = nativeControl.value?.form
  if (!owner || (formId && owner.id !== formId)) return
  owner.addEventListener('reset', onFormReset)
  onCleanup(() => owner.removeEventListener('reset', onFormReset))
})
watch(
  () => [props.required, props.disabled, props.loading],
  () => {
    if (!props.required || props.disabled || props.loading) missingRequired.value = false
  },
)
const choose = (value: string) => {
  const option = props.options.find((option) => optionKey(option.value) === value)
  if (
    option &&
    !option.disabled &&
    !props.disabled &&
    !props.loading &&
    !nativeControl.value?.matches(':disabled')
  ) {
    emit('update:modelValue', option.value)
    emit('change', option.value)
  }
}
const chooseNative = (event: Event) => {
  if (!(event.target instanceof HTMLSelectElement)) return
  const option = props.options[event.target.selectedIndex - 1]
  if (option) choose(optionKey(option.value))
}
const onSearchKeydown = (event: KeyboardEvent) => {
  event.stopPropagation()
  if (event.key === 'Escape') {
    event.preventDefault()
    open.value = false
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const options = [...(searchInput.value?.closest('.gm-select-content')?.querySelectorAll('[role="option"]:not([data-disabled])') || [])]
  const target = event.key === 'ArrowDown' ? options[0] : options.at(-1)
  if (!target) return
  event.preventDefault()
  if (target instanceof HTMLElement) target.focus()
}
</script>

<template>
  <div
    class="gm-select-shell"
    @invalid.capture="onInvalid"
  >
    <!-- Native form semantics stay separate from Radix's string-only menu values. -->
    <select
      ref="nativeControl"
      class="gm-select-native"
      tabindex="-1"
      aria-hidden="true"
      :name="name"
      :form="form"
      :autocomplete="autocomplete"
      :required="required"
      :disabled="disabled || loading"
      @change="chooseNative"
    >
      <option
        value=""
        disabled
        :selected="nativeSelectedIndex === 0"
        >{{ placeholder }}</option
      >
      <option
        v-for="(option, index) in options"
        :key="optionKey(option.value)"
        :value="String(option.value)"
        :disabled="option.disabled"
        :selected="index + 1 === nativeSelectedIndex"
        >{{ option.label }}</option
      >
    </select>
    <SelectRoot
      v-model:open="open"
      :model-value="internalValue"
      :disabled="disabled || loading"
      @update:model-value="choose"
    >
      <SelectTrigger as-child>
        <button
          v-bind="$attrs"
          :id="id"
          type="button"
          class="gm-select-trigger"
          :class="{ 'gm-select--dark': theme === 'dark' }"
          :disabled="disabled || loading"
          :aria-label="label"
          :aria-required="required || undefined"
          :aria-describedby="descriptionIds"
          :aria-invalid="invalid || missingRequired || undefined"
          :aria-busy="loading || undefined"
        >
          <SelectValue
            class="gm-select-value"
            :placeholder="placeholder"
          >
            {{
              selected?.label ||
              (loading
                ? 'Loading options…'
                : modelValue !== undefined && modelValue !== null && modelValue !== ''
                  ? 'Selection unavailable'
                  : placeholder)
            }}
          </SelectValue>
          <SelectIcon class="gm-select-chevron">
            <svg class="gm-select-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </SelectIcon>
        </button>
      </SelectTrigger>
      <SelectPortal :to="portalTarget">
        <SelectContent
          class="gm-select-content"
          :class="{ 'gm-select--dark': theme === 'dark' }"
          position="popper"
          :side-offset="6"
          :collision-padding="12"
        >
          <div
            v-if="searchable"
            class="gm-select-search-wrap"
          >
            <svg
              class="gm-select-search-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              ref="searchInput"
              v-model="searchQuery"
              class="gm-select-search"
              type="search"
              inputmode="search"
              autocomplete="off"
              :placeholder="searchPlaceholder"
              :aria-label="`${searchPlaceholder} for ${label}`"
              @keydown="onSearchKeydown"
              @pointerdown.stop
            />
          </div>
          <SelectScrollUpButton
            class="gm-select-scroll"
          >
            <svg
              class="gm-select-symbol"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              focusable="false"
            >
              <path d="m18 15-6-6-6 6" />
            </svg>
          </SelectScrollUpButton>
          <SelectViewport class="gm-select-viewport">
            <SelectItem
              v-for="option in filteredOptions"
              :key="optionKey(option.value)"
              :value="optionKey(option.value)"
              :disabled="option.disabled"
              :text-value="option.label"
              class="gm-select-item"
            >
              <SelectItemText>{{ option.label }}</SelectItemText>
              <SelectItemIndicator
                class="gm-select-check"
              >
                <svg
                  class="gm-select-symbol"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  focusable="false"
                >
                  <path d="m20 6-11 11-5-5" />
                </svg>
              </SelectItemIndicator>
            </SelectItem>
            <p
              v-if="!filteredOptions.length"
              class="gm-select-empty"
              >{{ searchQuery ? 'No matching options' : 'No options available' }}</p
            >
          </SelectViewport>
          <SelectScrollDownButton
            class="gm-select-scroll"
          >
            <svg
              class="gm-select-symbol"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              focusable="false"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </SelectScrollDownButton>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
    <p
      v-if="missingRequired"
      :id="errorId"
      class="gm-select-error"
      :class="{ 'gm-select--dark': theme === 'dark' }"
      role="alert"
      >Choose an option for {{ label.toLowerCase() }}.</p
    >
  </div>
</template>

<style>
/* Portalled content lacks the parent SFC scope attribute. Keep every selector namespaced. */
.gm-select-shell {
  position: relative;
  min-width: 0;
}
.gm-select-trigger,
.gm-select-content,
.gm-select-item,
.gm-select-search {
  box-sizing: border-box;
}
.gm-select-shell > .gm-select-native {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
/* Host form styles must not give hidden form controls normal field dimensions. */
.gm-select-shell select[aria-hidden='true'] {
  min-width: 0;
  min-height: 0;
  max-width: 1px;
  max-height: 1px;
  padding: 0;
  border: 0;
}
.gm-select-error {
  margin: 6px 0 0;
  color: #b91c1c;
  font-size: 13px;
  line-height: 1.4;
}
.gm-select-error.gm-select--dark {
  color: #fca5a5;
}
.gm-select-trigger,
.gm-select-content {
  --select-bg: #fff;
  --select-text: #18181b;
  --select-border: #dce3ea;
  --select-hover: #f4efff;
  --select-accent: #601ded;
  --select-muted: #64616d;
}
.gm-select-search-wrap {
  position: relative;
  padding: 8px 8px 4px;
}
.gm-select-search-icon {
  position: absolute;
  left: 19px;
  top: 50%;
  width: 16px;
  height: 16px;
  color: var(--select-muted);
  pointer-events: none;
  transform: translateY(-38%);
}
.gm-select-search {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 9px 12px 9px 36px;
  border: 1px solid var(--select-border);
  border-radius: 8px;
  background: var(--select-bg);
  color: var(--select-text);
  font: inherit;
  font-size: 16px;
}
.gm-select-search:focus {
  border-color: var(--select-accent);
  outline: 2px solid color-mix(in srgb, var(--select-accent) 28%, transparent);
  outline-offset: 0;
}
.gm-select-search::-webkit-search-cancel-button { cursor: pointer; }
.gm-select-trigger.gm-select--dark,
.gm-select-content.gm-select--dark {
  --select-bg: #201d28;
  --select-text: #f5f2fb;
  --select-border: #51495f;
  --select-hover: #342849;
  --select-accent: #c1a2ff;
  --select-muted: #bcb4c8;
}
.gm-select-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--select-border);
  border-radius: var(--gm-radius-control, 10px);
  background: var(--select-bg);
  color: var(--select-text);
  font: inherit;
  font-size: 14px;
  text-align: start;
  cursor: pointer;
}
.gm-select-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gm-select-symbol {
  display: block;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.gm-select-chevron {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--select-muted);
  transition: transform var(--dur-fast, 160ms) var(--ease, ease);
}
@media (max-width: 700px) {
  .gm-select-trigger { font-size: 16px; }
}
.gm-select-trigger[data-state='open'] .gm-select-chevron { transform: rotate(180deg); }
.gm-select-trigger:focus-visible {
  outline: 2px solid var(--select-accent);
  outline-offset: 2px;
}
.gm-select-trigger[aria-invalid='true'] {
  border-color: #dc2626;
}
.gm-select-trigger[data-disabled] {
  opacity: 0.55;
  cursor: not-allowed;
}
.gm-select-content {
  z-index: 1000;
  width: var(--radix-select-trigger-width);
  min-width: min(160px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  overflow: hidden;
  border: 1px solid var(--select-border);
  border-radius: 12px;
  background: var(--select-bg);
  color: var(--select-text);
  box-shadow: 0 8px 28px #17102324;
  font:
    14px/1.45 -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}
.gm-select-viewport {
  padding: 4px;
  max-height: min(320px, max(0px, calc(var(--radix-select-content-available-height, 100dvh) - 50px)));
  touch-action: pan-y;
}
.gm-select-item {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 10px 34px 10px 12px;
  border-radius: 8px;
  outline: none;
  cursor: default;
  overflow-wrap: anywhere;
  user-select: none;
}
.gm-select-item[data-highlighted] {
  background: var(--select-hover);
  box-shadow: inset 0 0 0 1px var(--select-accent);
}
.gm-select-item[data-state='checked'] {
  color: var(--select-accent);
  font-weight: 600;
}
.gm-select-item[data-disabled] {
  opacity: 0.45;
  pointer-events: none;
}
.gm-select-check {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  color: var(--select-accent);
}
.gm-select-scroll {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 24px;
  background: var(--select-bg);
  color: var(--select-muted);
}
.gm-select-empty {
  margin: 0;
  padding: 14px;
  color: var(--select-muted);
}
@media (prefers-reduced-motion: no-preference) {
  .gm-select-trigger {
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }
}
</style>
