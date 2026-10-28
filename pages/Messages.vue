<script setup lang="ts">
// Messages: the live queue of messages the owner can open in their own WhatsApp, SMS or email app.
// Bookins prepares the text; the owner presses send in their own app. Nothing is sent automatically and
// delivery is never claimed, so every state here says "opened by you".
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmDialog from '../components/ui/GmDialog.vue'
import GmHint from '../components/ui/GmHint.vue'
import GmSelect from '../components/ui/GmSelect.vue'
import { copyText, hasTeam, markMessageOpened, messageQueue, staffForBooking, teamMembers } from '../booking.ts'
import { CHANNELS, SLOT_LABELS, gmailComposeUrl, type MessageChannel, type QueueItem, type TemplateKind } from '../messaging.ts'
import { displayName, memberName } from '../team-ui.ts'
import { isDemo } from '../runtime.ts'
import { useSetupState } from '../setup.ts'
import { errorMessage } from '../error-message.ts'
import { ownerDefaultTimeZone } from '../time-display.ts'

type QueueTab = 'due' | 'upcoming' | 'done'
type DetailChannel = MessageChannel | 'gmail'
interface BatchState {
  items: QueueItem[]
  index: number
  opened: Set<string>
  skipped: Set<string>
}

const state = inject<WorkspaceState>('bookingState', { profile: null, schedules: [], services: [], bookings: [], contacts: [], staff: [], campaigns: [] })
const refresh = inject<RefreshWorkspace>('refreshBookings', async () => true)
const toast = inject<ToastApi | null>('toast', null)
const setup = useSetupState()

// ---- clock: reminders move between Upcoming and Due as time passes, and when the window regains focus ----
const now = ref(Date.now())
const tick = () => { now.value = Date.now() }
const clockTimer = window.setInterval(tick, 30_000)
const onVisible = () => { if (document.visibilityState === 'visible') tick() }
onMounted(() => {
  window.addEventListener('focus', tick)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  window.clearInterval(clockTimer)
  window.removeEventListener('focus', tick)
  document.removeEventListener('visibilitychange', onVisible)
})

const scheduleZone = computed(() => state.schedules[0]?.timezone || state.profile?.timezone || ownerDefaultTimeZone())
const queue = computed(() => messageQueue(state, { now: now.value, timezone: scheduleZone.value }))
const team = computed(() => hasTeam(state))

// ---- kinds ----
const KIND_CHIP: Readonly<Partial<Record<TemplateKind, string>>> = Object.freeze({
  confirmation: 'Confirmation',
  reminder24: 'Day-before reminder',
  reminder2: '2-hour reminder',
  prep: 'Preparation',
  thanks: 'Thank you',
  rebook: 'Time to rebook',
})
const kindLabel = (kind: TemplateKind) => KIND_CHIP[kind] || SLOT_LABELS[kind] || kind
const QUEUE_KINDS: TemplateKind[] = ['reminder24', 'reminder2', 'prep', 'thanks', 'rebook']

// Messages the owner turned off in Settings are not listed.
const visibleQueue = computed(() => {
  const keep = (item: QueueItem) => item.message.enabled !== false
  return {
    due: queue.value.due.filter(keep),
    upcoming: queue.value.upcoming.filter(keep),
    done: queue.value.done,
  }
})
const hiddenKinds = computed(() => {
  const kinds = new Set<TemplateKind>()
  for (const item of [...queue.value.due, ...queue.value.upcoming]) if (item.message.enabled === false) kinds.add(item.kind)
  return [...kinds].map(kindLabel)
})

// ---- filters ----
const tab = ref<QueueTab>('due')
const kindFilter = ref('')
const staffFilter = ref('')
const staffOf = (item: QueueItem) => staffForBooking(state, item.booking)
const matches = (item: QueueItem) =>
  (!kindFilter.value || item.kind === kindFilter.value) && (!staffFilter.value || staffOf(item).id === staffFilter.value)
const filtered = computed(() => ({
  due: visibleQueue.value.due.filter(matches),
  upcoming: visibleQueue.value.upcoming.filter(matches),
  done: visibleQueue.value.done.filter(matches).slice(0, 100),
}))
const counts = computed(() => ({ due: filtered.value.due.length, upcoming: filtered.value.upcoming.length, done: filtered.value.done.length }))
// While the stepper is walking the due messages, those items are shown in the stepper only, never again in the list below.
const steppedIds = computed(() => (batch.value && !batchFinished.value && tab.value === 'due' ? new Set(batch.value.items.map((item) => item.id)) : null))
const rows = computed(() => {
  const hidden = steppedIds.value
  return hidden ? filtered.value[tab.value].filter((item) => !hidden.has(item.id)) : filtered.value[tab.value]
})
// One row per appointment (or per client, for rebook nudges): its messages sit together as buttons.
interface MessageGroup { key: string; item: QueueItem; items: QueueItem[] }
const groupedRows = computed<MessageGroup[]>(() => {
  const groups = new Map<string, MessageGroup>()
  for (const item of rows.value) {
    const key = item.kind === 'rebook' ? `rebook:${item.contact.email || item.booking.id}` : String(item.booking.id || item.id)
    const group = groups.get(key)
    if (group) group.items.push(item)
    else groups.set(key, { key, item, items: [item] })
  }
  return [...groups.values()]
})
const filtersActive = computed(() => Boolean(kindFilter.value || staffFilter.value))
const kindOptions = computed(() => [
  { value: '', label: 'All messages' },
  ...QUEUE_KINDS.map((kind) => ({ value: kind, label: kindLabel(kind) })),
])
const staffOptions = computed(() => [
  { value: '', label: 'Everyone' },
  ...teamMembers(state).map((member) => ({ value: String(member.id || ''), label: memberName(member) })),
])
function clearFilters() { kindFilter.value = ''; staffFilter.value = '' }

const hasAnyBooking = computed(() => state.bookings.some((item) => item.status !== 'blocked' && item.service_id !== 'time-off'))
const totalVisible = computed(() => visibleQueue.value.due.length + visibleQueue.value.upcoming.length + visibleQueue.value.done.length)

// ---- display helpers ----
const zoneFor = (item: QueueItem) => item.booking.timezone || scheduleZone.value
function messageDate(value: TimestampInput): Date {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') return new Date(value)
  if (value && 'toDate' in value) return value.toDate()
  if (value && '_seconds' in value) return new Date(value._seconds * 1000)
  return new Date(Number.NaN)
}
function fmt(value: TimestampInput, timeZone: string, options: Intl.DateTimeFormatOptions) {
  try { return new Intl.DateTimeFormat(undefined, { timeZone, ...options }).format(messageDate(value)) }
  catch { return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...options }).format(messageDate(value)) }
}
const dayTime = (value: TimestampInput, zone: string) => fmt(value, zone, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const dayOnly = (value: TimestampInput, zone: string) => fmt(value, zone, { weekday: 'short', day: 'numeric', month: 'short' })
function relative(ms: number) {
  const abs = Math.abs(ms)
  const minutes = Math.round(abs / 60_000)
  let text
  if (minutes < 60) text = `${Math.max(minutes, 1)} min`
  else if (abs < 48 * 3_600_000) text = `${Math.round(abs / 3_600_000)} h`
  else text = `${Math.round(abs / 86_400_000)} days`
  return ms >= 0 ? `in ${text}` : `${text} ago`
}
function whenLabel(item: QueueItem) {
  const zone = zoneFor(item)
  if (item.kind === 'thanks') return `Came ${dayTime(item.booking.starts_at, zone)}`
  if (item.kind === 'rebook') return `Last visit ${dayOnly(item.booking.starts_at, zone)}`
  return dayTime(item.booking.starts_at, zone)
}
function dueNote(item: QueueItem) {
  if (item.openedAt) return `Opened by you ${dayTime(item.openedAt, scheduleZone.value)}`
  const dueMs = Date.parse(item.due_at)
  if (tab.value === 'upcoming') return `Due ${relative(dueMs - now.value)}`
  if (item.kind === 'reminder24' || item.kind === 'reminder2' || item.kind === 'prep') return `Starts ${relative(messageDate(item.booking.starts_at).getTime() - now.value)}`
  if (item.kind === 'rebook') return `Due since ${dayOnly(dueMs, zoneFor(item))}`
  return 'Due now'
}

// ---- channels ----
const CHANNEL_LABEL: Record<DetailChannel, string> = { whatsapp: 'Open WhatsApp', sms: 'Open SMS', email: 'Open mail app', gmail: 'Open Gmail' }
const channelLabel = (channel: DetailChannel | '') => channel ? CHANNEL_LABEL[channel] : 'Open message'
const channelsFor = (item: QueueItem): MessageChannel[] => [item.message.channel, ...CHANNELS.filter((channel) => channel !== item.message.channel)].filter((channel, index, list) => list.indexOf(channel) === index)
const usableChannels = (item: QueueItem) => channelsFor(item).filter((channel) => item.links[channel])
function unusableNote(item: QueueItem) {
  const usable = usableChannels(item)
  if (!usable.length) return 'No usable phone number or real email on this booking, so nothing can be opened. Copy the message and send it another way, or add a phone number to the client.'
  const phoneMissing = !item.links.whatsapp && !item.links.sms
  const emailMissing = !item.links.email
  if (phoneMissing && emailMissing) return ''
  if (phoneMissing) return 'WhatsApp and SMS are hidden: this booking has no usable phone number.'
  if (emailMissing) return 'Email is hidden: this booking has no real email address.'
  return ''
}
const linkAttrs = (channel: DetailChannel | '') => (channel === 'whatsapp' || channel === 'gmail' ? { target: '_blank', rel: 'noopener noreferrer' } : {})
const gmailFor = (item: QueueItem) => gmailComposeUrl(item.links.email)

// ---- message details ----
const selected = ref<QueueItem | null>(null)
const selectedChannel = ref<DetailChannel | ''>('')
const selectedHandled = ref(false)
const detailChannelOptions = computed(() => {
  const item = selected.value
  if (!item) return []
  const options: Array<{ value: DetailChannel; label: string }> = usableChannels(item).map((channel) => ({ value: channel, label: CHANNEL_LABEL[channel] }))
  if (gmailFor(item)) options.push({ value: 'gmail', label: 'Open Gmail' })
  return options
})
const selectedHref = computed(() => {
  const item = selected.value
  if (!item) return ''
  const channel = selectedChannel.value
  if (!channel) return ''
  return channel === 'gmail' ? gmailFor(item) : item.links[channel] || ''
})
function openDetails(item: QueueItem) {
  selected.value = item
  selectedHandled.value = Boolean(item.openedAt)
  const preferred = usableChannels(item)[0]
  selectedChannel.value = preferred || (gmailFor(item) ? 'gmail' : '')
}
function closeDetails() {
  selected.value = null
  selectedChannel.value = ''
  selectedHandled.value = false
}
function onOpenSelected() {
  const item = selected.value
  if (!item || item.openedAt) return
  selectedHandled.value = true
  if (isDemo.value) return
  void markDone(item, { quiet: true })
}
async function markSelectedDone() {
  if (!selected.value) return
  if (await markDone(selected.value)) selectedHandled.value = true
}

// ---- row state ----
const busyIds = ref(new Set<string>())
const setBusy = (id: string, on: boolean) => {
  const next = new Set(busyIds.value)
  if (on) next.add(id)
  else next.delete(id)
  busyIds.value = next
}
const demoReason = 'Demo is read-only, so nothing is saved. Switch to Live to mark messages.'

async function copyMessage(item: QueueItem) {
  try {
    await copyText(item.message.text)
    toast?.success('Message copied. Paste it into any app and press send there.')
  } catch {
    toast?.error('Your browser blocked copying. Open the message to select and copy it.')
  }
}

async function markDone(item: QueueItem, { quiet = false }: { quiet?: boolean } = {}) {
  if (isDemo.value || busyIds.value.has(item.id)) return false
  setBusy(item.id, true)
  try {
    await markMessageOpened(item.booking, item.kind)
    await refresh({ silent: true })
    if (!quiet) {
      toast?.(`Marked as opened by you: ${kindLabel(item.kind)} for ${item.contact.name}`, {
        duration: 7000,
        action: { label: 'Undo', onClick: () => undo(item, { quiet: true }) },
      })
    }
    return true
  } catch (reason) {
    toast?.error(errorMessage(reason, 'That message could not be marked. Try again.'))
    return false
  } finally {
    setBusy(item.id, false)
  }
}
async function undo(item: QueueItem, { quiet = false }: { quiet?: boolean } = {}) {
  if (isDemo.value || busyIds.value.has(item.id)) return
  setBusy(item.id, true)
  try {
    await markMessageOpened(item.booking, item.kind, false)
    await refresh({ silent: true })
    if (!quiet) toast?.info(`Moved back: ${kindLabel(item.kind)} for ${item.contact.name}`)
    else toast?.info('Moved back to the queue.')
  } catch (reason) {
    toast?.error(errorMessage(reason, 'That message could not be moved back. Try again.'))
  } finally {
    setBusy(item.id, false)
  }
}

// ---- batch stepper ----
const batch = ref<BatchState | null>(null)
const batchCandidates = computed(() => filtered.value.due.filter((item) => usableChannels(item).length))
const batchSkippedUnusable = computed(() => filtered.value.due.length - batchCandidates.value.length)
const batchReason = computed(() => {
  if (!filtered.value.due.length) return 'Nothing is due right now.'
  if (!batchCandidates.value.length) return 'None of the due messages has a usable phone number or real email.'
  return ''
})
const current = computed(() => (batch.value ? batch.value.items[batch.value.index] || null : null))
const batchChannel = ref<DetailChannel | ''>('')
const batchChannelOptions = computed(() => {
  const item = current.value
  if (!item) return []
  const options: Array<{ value: DetailChannel; label: string }> = usableChannels(item).map(channel => ({ value: channel, label: CHANNEL_LABEL[channel] }))
  if (gmailFor(item)) options.push({ value: 'gmail', label: 'Open Gmail' })
  return options
})
watch(current, item => {
  if (!item) return
  if (!batchChannelOptions.value.some(option => option.value === batchChannel.value)) batchChannel.value = batchChannelOptions.value[0]?.value || ''
})
const batchHref = computed(() => {
  const item = current.value
  const channel = batchChannel.value
  if (!item || !channel) return ''
  return channel === 'gmail' ? gmailFor(item) : item.links[channel] || ''
})
const batchFinished = computed(() => {
  const activeBatch = batch.value
  return Boolean(activeBatch && activeBatch.index >= activeBatch.items.length)
})
const batchTotal = computed(() => batch.value?.items.length || 0)
const batchProgress = computed(() => {
  if (!batchTotal.value) return 0
  const activeBatch = batch.value
  if (!activeBatch) return 0
  const done = activeBatch.index + (current.value && activeBatch.opened.has(current.value.id) ? 1 : 0)
  return Math.min(done, batchTotal.value) / batchTotal.value * 100
})
function startBatch() {
  if (batchReason.value) return
  tab.value = 'due'
  batch.value = { items: batchCandidates.value.slice(), index: 0, opened: new Set<string>(), skipped: new Set<string>() }
}
function stopBatch() { batch.value = null }
function goNext() { if (batch.value && batch.value.index < batch.value.items.length) batch.value.index += 1 }
function goBack() { if (batch.value && batch.value.index > 0) batch.value.index -= 1 }
function skip() {
  const activeBatch = batch.value
  if (!current.value || !activeBatch) return
  if (!activeBatch.opened.has(current.value.id)) activeBatch.skipped = new Set(activeBatch.skipped).add(current.value.id)
  goNext()
}
// Called from the real link click so the browser allows the app to open; marking happens alongside.
function openFromBatch(item: QueueItem) {
  const activeBatch = batch.value
  if (!activeBatch) return
  const opened = new Set(activeBatch.opened)
  opened.add(item.id)
  activeBatch.opened = opened
  const skipped = new Set(activeBatch.skipped)
  skipped.delete(item.id)
  activeBatch.skipped = skipped
  if (!isDemo.value && !item.openedAt) void markDone(item, { quiet: true })
}
const batchOpenedCount = computed(() => (batch.value ? batch.value.opened.size : 0))
const batchSkippedCount = computed(() => (batch.value ? batch.value.skipped.size : 0))
// Every item in the batch is accounted for: opened, skipped, or passed with Next without opening.
const batchNotOpenedCount = computed(() => Math.max(0, batchTotal.value - batchOpenedCount.value - batchSkippedCount.value))
</script>

<template>
  <section class="messages">
    <header class="page-header">
      <div>
        <h1>Messages</h1>
        <p class="lede">Each message opens in your own WhatsApp, SMS or email with the text ready. You press send.</p>
      </div>
      <div class="page-header-actions">
        <RouterLink class="secondary" :to="{ path: '/settings', hash: '#settings-templates' }"><AppIcon name="edit" :size="16" />Edit wording</RouterLink>
        <GmButton v-if="tab === 'due' && !batch && filtered.due.length" variant="primary" :disabled-reason="batchReason" reason-visible @click="startBatch">
          <template #leading><AppIcon name="messages" :size="16" /></template>Open due messages one by one
        </GmButton>
      </div>
    </header>

    <div v-if="hiddenKinds.length" class="notice info" role="status">
      <AppIcon name="info" :size="18" />
      <span>{{ hiddenKinds.join(', ') }} {{ hiddenKinds.length === 1 ? 'is' : 'are' }} turned off, so {{ hiddenKinds.length === 1 ? 'it is' : 'they are' }} not listed. <RouterLink :to="{ path: '/settings', hash: '#settings-templates' }">Turn on in Settings</RouterLink></span>
    </div>

    <div class="queue" data-tour="tour-messages-queue">
      <div class="queue-top">
        <div class="tab-bar" role="group" aria-label="Which messages">
          <button type="button" :aria-pressed="tab === 'due'" @click="tab = 'due'">Due now <span class="count-pill" :class="{ now: counts.due }">{{ counts.due }}</span></button>
          <button type="button" :aria-pressed="tab === 'upcoming'" @click="tab = 'upcoming'">Coming up <span class="count-pill">{{ counts.upcoming }}</span></button>
          <button type="button" :aria-pressed="tab === 'done'" @click="tab = 'done'">Opened <span class="count-pill">{{ counts.done }}</span></button>
        </div>
        <div class="queue-filters">
          <div class="field">
            <label for="msg-kind" class="visually-hidden">Message type</label>
            <GmSelect id="msg-kind" v-model="kindFilter" :options="kindOptions" label="Filter by message type" />
          </div>
          <div v-if="team" class="field">
            <label for="msg-staff" class="visually-hidden">Team member</label>
            <GmSelect id="msg-staff" v-model="staffFilter" :options="staffOptions" label="Filter by team member" />
          </div>
          <button v-if="filtersActive" class="ghost small" type="button" @click="clearFilters">Clear</button>
        </div>
      </div>

      <!-- Batch stepper -->
      <section v-if="batch" class="batch" aria-label="Due messages, one at a time">
        <template v-if="!batchFinished && current">
          <div class="batch-head">
            <strong class="tnum">{{ batch.index + 1 }} of {{ batchTotal }}</strong>
            <span class="muted">One message at a time</span>
            <button class="ghost small batch-close" type="button" @click="stopBatch">Stop</button>
          </div>
          <div class="progress-track" role="progressbar" aria-label="Messages worked through" :aria-valuenow="batch.index + 1" :aria-valuemin="1" :aria-valuemax="batchTotal" :aria-valuetext="`Message ${batch.index + 1} of ${batchTotal}`"><span :style="{ width: `${batchProgress}%` }" /></div>
          <div class="batch-card" aria-live="polite">
            <p class="batch-who"><strong>{{ current.contact.name }}</strong><span class="chip neutral">{{ kindLabel(current.kind) }}</span></p>
            <p class="batch-meta">{{ displayName(current.booking.service_name) }}<template v-if="team"> with {{ memberName(staffOf(current)) }}</template>, {{ whenLabel(current) }}</p>
            <p class="batch-preview">{{ current.message.text }}</p>
            <div class="batch-actions">
              <div class="field batch-channel"><label for="batch-channel">Open with</label><GmSelect id="batch-channel" v-model="batchChannel" :options="batchChannelOptions" label="Where to open this message" /></div>
              <a v-if="batchHref" class="primary" :href="batchHref" v-bind="linkAttrs(batchChannel)" @click="openFromBatch(current)">{{ channelLabel(batchChannel) }}<AppIcon name="external" :size="15" /></a>
              <button class="ghost" type="button" @click="copyMessage(current)"><AppIcon name="copy" :size="16" />Copy</button>
            </div>
            <p v-if="batch.opened.has(current.id)" class="batch-status ok"><AppIcon name="check" :size="15" />Opened by you{{ isDemo ? ' (Demo: not saved)' : '' }}. Press Next.</p>
          </div>
          <div class="batch-nav">
            <button class="secondary" type="button" :disabled="batch.index === 0" @click="goBack"><AppIcon name="arrow-left" :size="16" />Back</button>
            <button class="ghost" type="button" @click="skip">Skip</button>
            <button :class="batch.opened.has(current.id) ? 'primary' : 'secondary'" type="button" @click="goNext">{{ batch.index + 1 === batchTotal ? 'Finish' : 'Next' }}<AppIcon name="chevron" :size="15" /></button>
          </div>
        </template>
        <div v-else class="batch-done" role="status">
          <AppIcon name="check" :size="20" />
          <div>
            <strong>Done</strong>
            <p>Of {{ batchTotal }} {{ batchTotal === 1 ? 'message' : 'messages' }}: opened {{ batchOpenedCount }}, skipped {{ batchSkippedCount }}, not opened {{ batchNotOpenedCount }}. Messages you did not open stay in Due now.<template v-if="batchSkippedUnusable"> {{ batchSkippedUnusable }} had no usable phone or email and were left out.</template></p>
          </div>
          <div class="batch-nav">
            <button v-if="batchTotal" class="secondary" type="button" @click="batch.index = 0">Go through again</button>
            <button class="primary" type="button" @click="stopBatch">Close</button>
          </div>
        </div>
      </section>

      <!-- Rows: one per appointment -->
      <ul v-if="groupedRows.length" class="ledger msg-list" :aria-label="tab === 'due' ? 'Messages due now' : tab === 'upcoming' ? 'Messages coming up' : 'Messages you opened'">
        <li v-for="group in groupedRows" :key="group.key" class="msg-row" :class="{ due: tab === 'due' }">
          <div class="msg-main">
            <p class="msg-who"><strong>{{ group.item.contact.name }}</strong></p>
            <p class="msg-meta">{{ displayName(group.item.booking.service_name) }}<template v-if="team"> with {{ memberName(staffOf(group.item)) }}</template>, {{ whenLabel(group.item) }}</p>
          </div>
          <div class="msg-items">
            <button v-for="item in group.items" :key="item.id" type="button" class="msg-chip" :class="{ opened: item.openedAt }" @click="openDetails(item)">
              <span class="msg-chip-kind">{{ kindLabel(item.kind) }}</span>
              <span class="msg-chip-note">{{ dueNote(item) }}</span>
            </button>
          </div>
        </li>
      </ul>

      <!-- Empty states -->
      <template v-else-if="steppedIds" />
      <div v-else-if="filtersActive && totalVisible" class="empty compact">
        <h2>No messages match these filters</h2>
        <p>Try another message type or person.</p>
        <button class="secondary small" type="button" @click="clearFilters">Clear filters</button>
      </div>
      <div v-else-if="!hasAnyBooking" class="empty compact">
        <h2>Messages appear once you have bookings</h2>
        <p>Reminders show up here the day before and two hours before each visit, and thank-yous after a visit is marked as Came.</p>
        <div class="empty-actions">
          <RouterLink v-if="!isDemo && !setup.isComplete" class="primary small" :to="setup.nextStep.to">{{ setup.nextStep.label }}</RouterLink>
          <RouterLink class="secondary small" to="/bookings">Open bookings</RouterLink>
        </div>
      </div>
      <div v-else-if="tab === 'due'" class="empty compact">
        <h2>Nothing to open right now</h2>
        <p>Reminders appear the day before and two hours before a visit; thank-yous after a visit is marked as Came.</p>
        <div class="empty-actions">
          <button v-if="visibleQueue.upcoming.length" class="secondary small" type="button" @click="tab = 'upcoming'">See what is coming up ({{ visibleQueue.upcoming.length }})</button>
        </div>
      </div>
      <div v-else-if="tab === 'upcoming'" class="empty compact">
        <h2>Nothing coming up</h2>
        <p>Messages for the next few days wait here until they are due.</p>
      </div>
      <div v-else class="empty compact">
        <h2>Nothing opened yet</h2>
        <p>Messages you open, or mark as opened, are listed here so you can see what you already handled.</p>
        <div class="empty-actions">
          <button v-if="visibleQueue.due.length" class="primary small" type="button" @click="tab = 'due'">Go to Due now ({{ visibleQueue.due.length }})</button>
        </div>
      </div>
    </div>

    <GmDialog
      :open="Boolean(selected)"
      :title="selected ? `Message for ${selected.contact.name}` : 'Message details'"
      content-class="card modal message-drawer"
      @update:open="$event || closeDetails()"
    >
      <div v-if="selected" class="drawer-shell">
        <header class="modal-header">
          <div>
            <h2>{{ selected.contact.name }}</h2>
            <p class="muted">{{ kindLabel(selected.kind) }}: {{ displayName(selected.booking.service_name) }}<template v-if="team"> with {{ memberName(staffOf(selected)) }}</template>, {{ whenLabel(selected) }}</p>
          </div>
          <button class="icon-button" type="button" aria-label="Close message" @click="closeDetails"><AppIcon name="close" /></button>
        </header>

        <p class="message-copy">{{ selected.message.text }}</p>
        <p v-if="tab !== 'done' && unusableNote(selected)" class="notice warning" role="status">{{ unusableNote(selected) }}</p>

        <div v-if="detailChannelOptions.length" class="field">
          <label for="message-channel">Open with</label>
          <GmSelect id="message-channel" v-model="selectedChannel" :options="detailChannelOptions" label="Choose where to open this message" />
        </div>

        <div class="form-actions">
          <a v-if="selectedHref" class="primary" :href="selectedHref" v-bind="linkAttrs(selectedChannel)" @click="onOpenSelected">{{ detailChannelOptions.find((option) => option.value === selectedChannel)?.label || 'Open message' }}<AppIcon v-if="selectedChannel === 'whatsapp' || selectedChannel === 'gmail'" name="external" :size="15" /></a>
          <GmButton variant="secondary" @click="copyMessage(selected)"><template #leading><AppIcon name="copy" :size="15" /></template>Copy message</GmButton>
        </div>

        <div class="drawer-foot">
          <template v-if="tab !== 'done' && !selectedHandled">
            <GmButton variant="ghost" size="sm" :disabled="busyIds.has(selected.id)" :disabled-reason="isDemo ? demoReason : ''" @click="markSelectedDone">Mark as opened</GmButton>
            <GmHint text="Use this only if you already sent it another way. Bookins cannot see whether you pressed send." label="About marking as opened" />
          </template>
          <span v-else-if="tab !== 'done'" class="opened-note"><AppIcon name="check" :size="15" />Opened by you{{ isDemo ? ' (Demo: not saved)' : '' }}</span>
          <GmButton v-else variant="ghost" size="sm" :disabled="busyIds.has(selected.id)" :disabled-reason="isDemo ? demoReason : ''" @click="undo(selected)">Move back to the queue</GmButton>
        </div>
      </div>
    </GmDialog>
  </section>
</template>

<style scoped>
.messages { display: grid; gap: var(--space-4); }
.messages .page-header { margin-bottom: 0; }
.messages > .notice { margin-bottom: 0; }
.queue { display: grid; gap: var(--space-4); min-width: 0; }
.queue-top { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--space-3); border-bottom: 1px solid var(--line); }
.queue-top .tab-bar { margin-bottom: -1px; border-bottom: 0; }
.queue-filters { padding-bottom: var(--space-2); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.queue-filters .field { margin: 0; min-width: 170px; }

.msg-row { padding: var(--space-3) var(--space-4); display: grid; grid-template-columns: minmax(200px, 1fr) minmax(0, 1.4fr); align-items: center; gap: var(--space-2) var(--space-5); }
.msg-main { min-width: 0; }
.msg-who { margin: 0; display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-md); overflow-wrap: anywhere; }
.msg-row.due .msg-who::before { content: ''; width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--now); box-shadow: 0 0 0 3px var(--now-soft); }
.msg-meta { margin: 2px 0 0; color: var(--ink-soft); font-size: var(--text-sm); }
.msg-items { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
.msg-chip {
  min-height: 52px; padding: 6px var(--space-3); display: grid; justify-items: start; gap: 1px; color: var(--ink); text-align: left;
  border: 1px solid var(--line-strong); border-left: 4px solid var(--accent); border-radius: 2px var(--radius-sm) var(--radius-sm) 2px; background: var(--surface);
}
.msg-chip:hover { background: var(--accent-faint); }
.msg-chip.opened { border-left-color: var(--success); }
.msg-chip-kind { font-size: var(--text-sm); font-weight: var(--weight-strong); }
.msg-chip-note { color: var(--muted); font-size: var(--text-xs); }

.batch { padding: var(--space-4); display: grid; gap: var(--space-3); border: 1px solid var(--line); border-left: 4px solid var(--now); border-radius: 2px var(--radius) var(--radius) 2px; background: var(--surface); }
.batch-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.batch-head strong { font-size: var(--text-lg); }
.batch-head .muted { flex: 1 1 200px; font-size: var(--text-sm); }
.progress-track { height: 6px; overflow: hidden; border-radius: 3px; background: var(--surface-sunken); }
.progress-track span { display: block; height: 100%; background: var(--accent); transition: width var(--dur-panel) var(--ease); }
.batch-card { display: grid; gap: var(--space-2); }
.batch-who { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); font-size: var(--text-lg); }
.batch-meta { margin: 0; color: var(--ink-soft); font-size: var(--text-sm); }
.batch-preview { margin: 0; padding: var(--space-3); max-height: 220px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; border-radius: var(--radius-sm); background: var(--surface-soft); font-size: var(--text-sm); line-height: 1.55; }
.batch-actions { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-2); }
.batch-channel { margin: 0; min-width: 200px; }
.batch-nav { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); }
.batch-status { margin: 0; display: flex; align-items: center; gap: 6px; font-size: var(--text-sm); }
.batch-status.ok { color: var(--success); font-weight: var(--weight-strong); }
.batch-done { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); color: var(--success); }
.batch-done > div:nth-child(2) { flex: 1 1 240px; min-width: 0; color: var(--ink); }
.batch-done p { margin: 2px 0 0; color: var(--ink-soft); font-size: var(--text-sm); }

.drawer-shell { display: grid; gap: var(--space-4); align-content: start; }
.message-copy { margin: 0; padding: var(--space-4); white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 2px var(--radius-sm) var(--radius-sm) 2px; background: var(--surface-soft); line-height: 1.6; }
.drawer-foot { padding-top: var(--space-3); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); border-top: 1px solid var(--line); }
.opened-note { display: inline-flex; align-items: center; gap: 6px; color: var(--success); font-size: var(--text-sm); font-weight: var(--weight-strong); }

@media (max-width: 800px) {
  .queue-top { border-bottom: 0; }
  .queue-top .tab-bar { width: 100%; border-bottom: 1px solid var(--line); }
  .queue-filters { width: 100%; }
  .queue-filters .field { flex: 1 1 150px; min-width: 0; }
  .msg-row { grid-template-columns: 1fr; }
  .msg-items { justify-content: flex-start; }
  .batch-nav > * { flex: 1; }
}
</style>
