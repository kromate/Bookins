<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import GmButton from './ui/GmButton.vue'
import GmTimePicker from './ui/GmTimePicker.vue'
import { isDemo } from '../runtime.ts'
import { ownerDefaultTimeZone } from '../time-display.ts'

interface AgendaStatus extends UnknownRecord { flowId?: string; cron?: string; enabled?: boolean; timezone?: string; executionId?: string }
const state = inject<WorkspaceState>('bookingState', { profile: null, schedules: [], services: [], bookings: [], contacts: [], staff: [], campaigns: [] })
const localPreview = inject('localPreview', false)
const status = ref<AgendaStatus | null>(null)
const pending = ref('')
const error = ref('')
const notice = ref('')
const runKey = ref('')
const RUN_CACHE_KEY = 'bookins:agenda-pending-run:v1'
const validTime = computed(() => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time.value))
const time = ref('07:00')
// Only sent when the owner presses Enable or Save; the same unsaved default the profile form shows until a zone is saved.
const timezone = computed(() => state.profile?.timezone || ownerDefaultTimeZone())
// B14: say so when the default is in use rather than a time zone the owner chose.
const zoneIsDefault = computed(() => !state.profile?.timezone)
const available = computed(() => !isDemo.value && !localPreview && typeof window.GoalmaticApp?.execute === 'function')
const flowUrl = computed(() => status.value?.flowId ? `https://goalmatic.io/flows/${encodeURIComponent(status.value.flowId)}` : 'https://goalmatic.io/flows')
async function execute(operation: string, input: UnknownRecord = {}, key?: string): Promise<AgendaStatus> {
  const executeRuntime = window.GoalmaticApp?.execute
  if (!executeRuntime) throw new Error('The workflow runtime is unavailable.')
  const value = await executeRuntime(operation, { flowId: 'owner-daily-agenda', ...input }, {
    capabilityId: 'owner-daily-agenda-workflow', ...(key ? { idempotencyKey: key } : {}),
  })
  const outer = value && typeof value === 'object' ? value as UnknownRecord : {}
  const data = outer.data && typeof outer.data === 'object' ? outer.data as AgendaStatus : null
  return data ?? outer as AgendaStatus
}
async function load() {
  if (!available.value) return
  pending.value = 'load'
  error.value = ''
  try {
    status.value = await execute('workflows.schedule-status')
    const parts = String(status.value.cron || '').split(' ')
    if (/^\d+$/.test(parts[0] || '') && /^\d+$/.test(parts[1] || '')) time.value = `${String(parts[1]).padStart(2, '0')}:${String(parts[0]).padStart(2, '0')}`
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : 'The agenda status could not be loaded. Check the App permissions in Goalmatic, then retry.'
  } finally { pending.value = '' }
}
async function configure(enabled: boolean) {
  if (pending.value || !available.value || !validTime.value) return
  pending.value = enabled ? 'enable' : 'pause'
  error.value = ''; notice.value = ''
  try {
    const [hour, minute] = time.value.split(':').map(Number)
    status.value = await execute('workflows.schedule-configure', {
      cron: `${minute} ${hour} * * *`, timezone: timezone.value, enabled,
      plainText: `Every day at ${time.value}`,
    }, `bookins:agenda-config:${crypto.randomUUID()}`)
    notice.value = enabled ? 'Daily agenda enabled. Check your inbox after the next scheduled run.' : 'Daily agenda paused.'
  } catch (reason) { error.value = reason instanceof Error ? reason.message : 'The agenda schedule could not be saved.' }
  finally { pending.value = '' }
}
async function sendTest() {
  if (pending.value || !status.value?.enabled) return
  pending.value = 'test'; error.value = ''; notice.value = ''
  runKey.value ||= window.GoalmaticApp?.cache?.get?.(RUN_CACHE_KEY) || `bookins:agenda:${crypto.randomUUID()}`
  window.GoalmaticApp?.cache?.set?.(RUN_CACHE_KEY, runKey.value)
  try {
    const result = await execute('workflows.run', {}, runKey.value)
    notice.value = `Test queued${result.executionId ? ` (${result.executionId})` : ''}. Check workflow history and your inbox to confirm delivery.`
    window.GoalmaticApp?.cache?.remove?.(RUN_CACHE_KEY)
    runKey.value = ''
  } catch (reason) { error.value = reason instanceof Error ? reason.message : 'The test could not be queued. Retry uses the same request to avoid duplicates.' }
  finally { pending.value = '' }
}
onMounted(load)
</script>

<template>
  <section class="agenda-settings" aria-labelledby="agenda-title">
    <div><h3 id="agenda-title">Daily agenda email</h3><p class="muted">Your appointments and tomorrow's reminder links, emailed only to your Goalmatic account address.</p></div>
    <p v-if="!available" class="muted">Open the connected App in Live mode to manage your agenda.</p>
    <template v-else>
      <p v-if="pending === 'load'" role="status">Checking agenda status…</p>
      <p v-else-if="status" class="agenda-status"><span class="chip dot" :class="status.enabled ? 'success' : 'neutral'">{{ status.enabled ? 'On' : 'Paused' }}</span><span v-if="status.enabled">Every day at {{ time }} ({{ status.timezone }})</span></p>
      <label for="agenda-time">Send each day at <GmTimePicker id="agenda-time" v-model="time" label="Daily agenda time" :disabled="Boolean(pending)" required /></label>
      <p class="field-hint">Time is in {{ timezone }}<template v-if="zoneIsDefault">, the default until you save a time zone in your business details above</template>. Turning this on schedules a recurring email to you.</p>
      <div class="agenda-actions">
        <GmButton :disabled="!status || !validTime || Boolean(pending)" :pending="pending === 'enable'" @click="configure(true)">{{ status?.enabled ? 'Save agenda time' : 'Enable daily agenda' }}</GmButton>
        <GmButton v-if="status?.enabled" variant="secondary" :disabled="Boolean(pending)" :pending="pending === 'pause'" @click="configure(false)">Pause agenda</GmButton>
        <GmButton variant="secondary" :disabled="!status?.enabled || Boolean(pending)" :pending="pending === 'test'" @click="sendTest">Send test to me</GmButton>
        <a class="secondary" :href="flowUrl" target="_blank" rel="noopener">Open workflow history</a>
      </div>
      <p v-if="status && !status.enabled" class="field-hint">Enable the agenda before sending a test.</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <div v-if="error" class="notice error" role="alert"><span>{{ error }}</span><button type="button" class="secondary" :disabled="Boolean(pending)" @click="load">Retry</button></div>
    </template>
  </section>
</template>

<style scoped>
/* Body text matches the delivery list above (14px); the status reads as a chip with a dot, not a second heading. */
.agenda-settings { display: grid; gap: 12px; margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--line); font-size: var(--text-sm); }
.agenda-settings p { margin: 0; }
.agenda-settings label { display: grid; gap: 8px; max-width: 240px; }
.agenda-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.agenda-actions a { display: inline-flex; align-items: center; text-decoration: none; }
.agenda-status { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.agenda-status > span:not(.chip) { color: var(--ink-soft); }
</style>
