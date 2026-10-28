<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from 'radix-vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{ modelValue?: string; modelModifiers?: { trim?: boolean }; options?: string[]; id?: string; label?: string; placeholder?: string; disabled?: boolean; maxlength?: number | string; name?: string; autocomplete?: string; portalTarget?: string | HTMLElement }>(), { modelValue: '', modelModifiers: () => ({}), options: () => [], id: '', label: '', placeholder: '', disabled: false, portalTarget: 'body' })
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [value: string]; enter: []; 'update:open': [value: boolean] }>()

const generatedId = `gm-text-suggest-${useId()}`
const controlId = computed(() => props.id || generatedId)
const input = ref<HTMLInputElement | null>(null)
const open = ref(false)
const activeIndex = ref(-1)
const resolvedPortalTarget = ref<string | HTMLElement>(props.portalTarget)
const listId = `${controlId.value}-options`
const normalizedOptions = computed(() => {
  const unique = new Map<string, string>()
  for (const option of props.options) {
    const value = String(option || '').trim()
    if (value && !unique.has(value.toLocaleLowerCase())) unique.set(value.toLocaleLowerCase(), value)
  }
  return [...unique.values()]
})
const matches = computed(() => {
  const query = props.modelValue.trim().toLocaleLowerCase()
  return normalizedOptions.value.filter((option) => !query || option.toLocaleLowerCase().includes(query))
})
const activeOptionId = computed(() => activeIndex.value >= 0 ? `${listId}-${activeIndex.value}` : undefined)

watch(open, (value) => {
  emit('update:open', value)
  if (!value) activeIndex.value = -1
})
watch(matches, (options) => {
  if (activeIndex.value >= options.length) activeIndex.value = -1
})
watch(() => props.portalTarget, (target) => { resolvedPortalTarget.value = target })
onMounted(() => {
  const dialog = input.value?.closest<HTMLElement>('.gm-dialog-content')
  if (props.portalTarget === 'body') resolvedPortalTarget.value = dialog || 'body'
})
onBeforeUnmount(() => { open.value = false })

function setValue(value: string) {
  const next = props.modelModifiers.trim ? value.trim() : value
  emit('update:modelValue', next)
  emit('change', next)
}
function openSuggestions() {
  if (!props.disabled && matches.value.length) open.value = true
}
function choose(option: string) {
  setValue(option)
  open.value = false
  nextTick(() => input.value?.focus({ preventScroll: true }))
}
function onInput(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return
  setValue(event.target.value)
  openSuggestions()
}
function onKeydown(event: KeyboardEvent) {
  if (props.disabled) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!matches.value.length) return
    event.preventDefault()
    open.value = true
    const direction = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = (activeIndex.value + direction + matches.value.length) % matches.value.length
    return
  }
  if (event.key === 'Escape') {
    if (!open.value) return
    event.preventDefault()
    event.stopPropagation()
    open.value = false
    return
  }
  if (event.key !== 'Enter') return
  event.preventDefault()
  if (open.value && activeIndex.value >= 0) {
    const option = matches.value[activeIndex.value]
    if (option) choose(option)
    return
  }
  open.value = false
  emit('enter')
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverAnchor as-child>
      <input
        :id="controlId"
        ref="input"
        v-bind="$attrs"
        class="gm-text-suggest-input"
        type="text"
        :name="name"
        :autocomplete="autocomplete"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :maxlength="maxlength"
        role="combobox"
        :aria-label="label || undefined"
        :aria-autocomplete="'list'"
        :aria-controls="open ? listId : undefined"
        :aria-expanded="open"
        :aria-activedescendant="activeOptionId"
        @focus="openSuggestions"
        @input="onInput"
        @keydown="onKeydown"
      />
    </PopoverAnchor>
    <PopoverPortal :to="resolvedPortalTarget">
      <PopoverContent
        v-if="matches.length"
        class="gm-text-suggest-content"
        :side-offset="6"
        :collision-padding="12"
        @open-auto-focus.prevent
      >
        <ul :id="listId" class="gm-text-suggest-list" role="listbox">
          <li v-for="(option, index) in matches" :key="option" role="presentation">
            <button
              type="button"
              role="option"
              :id="`${listId}-${index}`"
              tabindex="-1"
              :aria-selected="activeIndex === index"
              :class="{ active: activeIndex === index }"
              @pointerdown.prevent
              @click="choose(option)"
              @mouseenter="activeIndex = index"
            >{{ option }}</button>
          </li>
        </ul>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style>
.gm-text-suggest-input { width: 100%; min-width: 0; }
.gm-text-suggest-content { z-index: 1100; width: var(--radix-popper-anchor-width); max-width: calc(100vw - 24px); padding: 4px; border: 1px solid var(--line, #dce3ea); border-radius: var(--radius-sm, 10px); background: var(--surface, #fff); box-shadow: 0 14px 38px rgb(16 25 40 / 18%); }
.gm-text-suggest-list { max-height: min(240px, var(--radix-popper-available-height)); margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.gm-text-suggest-list button { width: 100%; min-height: 36px; padding: 7px 8px; display: block; color: var(--ink, #101928); border: 0; border-radius: calc(var(--radius-sm, 10px) - 2px); background: transparent; font: inherit; text-align: left; cursor: pointer; }
.gm-text-suggest-list button:hover, .gm-text-suggest-list button.active { color: var(--accent, #2336dc); background: var(--accent-soft, #eef1ff); }
.gm-text-suggest-list button:focus-visible { outline: 2px solid var(--accent, #2336dc); outline-offset: -2px; }
</style>
