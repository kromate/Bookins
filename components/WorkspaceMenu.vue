<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { loadAccounts, switchAccount, workspaceAccounts } from './shell-runtime.js'

const props = defineProps({
  label: { type: String, required: true },
  userLabel: { type: String, default: '' },
  avatarUrl: { type: String, default: '' },
  isDemo: Boolean,
  localPreview: Boolean,
  busy: Boolean,
  inline: Boolean, // always-open list (mobile More sheet) instead of a dropdown
  idPrefix: { type: String, default: 'workspace' },
})
const emit = defineEmits(['toggle-mode', 'switched', 'close'])

const root = ref(null)
const trigger = ref(null)
const open = ref(false)
const switchingId = ref('')
const error = ref('')

const accounts = computed(() => (props.isDemo ? [] : workspaceAccounts.value))
const currentAccount = computed(() => accounts.value.find((account) => account.current) || null)
const initials = computed(
  () => props.label.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'G',
)
const subtitle = computed(() =>
  props.isDemo
    ? 'Demo · Read-only'
    : props.localPreview
      ? 'Local preview'
      : currentAccount.value?.name
        ? `${currentAccount.value.name}${props.userLabel ? ` · ${props.userLabel}` : ''}`
        : props.userLabel || 'Goalmatic workspace',
)
const menuId = computed(() => `${props.idPrefix}-menu`)
const shown = computed(() => props.inline || open.value)

async function toggle() {
  open.value = !open.value
  error.value = ''
  if (!open.value) return
  void loadAccounts()
  await nextTick()
  root.value?.querySelector('[role="menuitem"]')?.focus()
}
function close({ restoreFocus = false } = {}) {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}
async function choose(account) {
  if (!account?.id || account.current || switchingId.value) return close()
  switchingId.value = account.id
  error.value = ''
  try {
    await switchAccount(account)
    close()
    emit('switched', account)
  } catch (reason) {
    error.value = reason?.message || 'The workspace could not be switched.'
  } finally {
    switchingId.value = ''
  }
}
function toggleMode() {
  close()
  emit('toggle-mode')
}
function keydown(event) {
  if (props.inline) return
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    event.stopPropagation()
    close({ restoreFocus: true })
    return
  }
  if (event.key === 'Tab') { close(); return }
  if (!open.value || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const items = [...root.value.querySelectorAll('[role^="menuitem"]:not(:disabled)')]
  const index = items.indexOf(document.activeElement)
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[next]?.focus()
}
function outside(event) {
  if (open.value && !root.value?.contains(event.target)) close()
}
onMounted(() => {
  document.addEventListener('pointerdown', outside, true)
  void loadAccounts()
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside, true))
defineExpose({ close })
</script>

<template>
  <div ref="root" class="ws-switcher" :class="{ inline }" @keydown="keydown">
    <component
      :is="inline ? 'div' : 'button'"
      :ref="inline ? undefined : 'trigger'"
      class="ws-card"
      :type="inline ? undefined : 'button'"
      :aria-haspopup="inline ? undefined : 'menu'"
      :aria-expanded="inline ? undefined : open"
      :aria-controls="inline ? undefined : menuId"
      :disabled="inline ? undefined : busy"
      :aria-busy="busy || undefined"
      @click="inline ? undefined : toggle()"
    >
      <span class="ws-avatar"><img v-if="avatarUrl && !isDemo" :src="avatarUrl" alt="" width="36" height="36" referrerpolicy="no-referrer" /><template v-else>{{ initials }}</template></span>
      <span class="ws-copy"><strong>{{ label }}</strong><small>{{ subtitle }}</small></span>
      <AppIcon v-if="!inline" name="chevron" :size="16" class="ws-chevron" />
    </component>
    <div v-if="shown" :id="menuId" class="ws-menu" role="menu" aria-label="Bookins workspace">
      <button type="button" class="ws-mode" role="menuitem" :disabled="busy" @click="toggleMode">
        <AppIcon name="swap" :size="15" />
        <span class="ws-mode-copy">{{ isDemo ? 'Switch back to Live' : 'Switch to Demo' }}</span>
        <i class="ws-dot" aria-hidden="true" />
      </button>
      <slot />
      <template v-if="accounts.length">
        <hr class="ws-divider" />
        <p class="ws-heading">Workspaces</p>
        <div class="ws-options">
          <button
            v-for="account in accounts"
            :key="account.id"
            type="button"
            role="menuitemradio"
            :aria-checked="Boolean(account.current)"
            :class="{ selected: account.current }"
            :disabled="Boolean(switchingId) || busy"
            @click="choose(account)"
          >
            <span>{{ account.name }}</span>
            <AppIcon v-if="account.current" name="check" :size="15" />
            <span v-else-if="switchingId === account.id" class="ws-spinner" role="status" aria-label="Switching workspace" />
          </button>
        </div>
      </template>
      <p v-else-if="localPreview && !isDemo" class="ws-note">Sample workspace. Data stays in this browser.</p>
      <p v-if="error" class="ws-error" role="alert">{{ error }}</p>
    </div>
  </div>
</template>
