<script setup>
// Messages: the live queue of messages the owner can open in their own WhatsApp, SMS or email app.
// Bookins prepares the text; the owner presses send in their own app. Nothing is sent automatically and
// delivery is never claimed, so every state here says "opened by you".
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmHint from '../components/ui/GmHint.vue'
import GmSelect from '../components/ui/GmSelect.vue'
import { copyText, hasTeam, markMessageOpened, messageQueue, staffForBooking, teamMembers } from '../booking.js'
import { CHANNELS, SLOT_LABELS, gmailComposeUrl } from '../messaging.js'
import { isDemo } from '../runtime.js'
import { useSetupState } from '../setup.js'

const state = inject('bookingState')
const refresh = inject('refreshBookings', async () => true)
const toast = inject('toast', null)
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

const scheduleZone = computed(() => state.schedules[0]?.timezone || state.profile?.timezone || 'UTC')
const queue = computed(() => messageQueue(state, { now: now.value, timezone: scheduleZone.value }))
const team = computed(() => hasTeam(state))

// ---- kinds ----
const KIND_CHIP = Object.freeze({
  confirmation: 'Confirmation',
  reminder24: '24h reminder',
  reminder2: '2h reminder',
  prep: 'Prep info',
  thanks: 'Thank-you',
  rebook: 'Rebook nudge',
})
const KIND_TONE = Object.freeze({ reminder24: 'info', reminder2: 'warning', prep: 'neutral', thanks: 'success', rebook: 'accent' })
const kindLabel = (kind) => KIND_CHIP[kind] || SLOT_LABELS[kind] || kind
const QUEUE_KINDS = ['reminder24', 'reminder2', 'prep', 'thanks', 'rebook']

// Messages the owner turned off in Settings are not listed.
const visibleQueue = computed(() => {
  const keep = (item) => item.message.enabled !== false
  return {
    due: queue.value.due.filter(keep),
    upcoming: queue.value.upcoming.filter(keep),
    done: queue.value.done,
  }
})
const hiddenKinds = computed(() => {
  const kinds = new Set()
  for (const item of [...queue.value.due, ...queue.value.upcoming]) if (item.message.enabled === false) kinds.add(item.kind)
  return [...kinds].map(kindLabel)
})

// ---- filters ----
const tab = ref('due')
const kindFilter = ref('')
const staffFilter = ref('')
const staffOf = (item) => staffForBooking(state, item.booking)
const matches = (item) =>
  (!kindFilter.value || item.kind === kindFilter.value) && (!staffFilter.value || staffOf(item).id === staffFilter.value)
const filtered = computed(() => ({
  due: visibleQueue.value.due.filter(matches),
  upcoming: visibleQueue.value.upcoming.filter(matches),
  done: visibleQueue.value.done.filter(matches).slice(0, 100),
}))
const counts = computed(() => ({ due: filtered.value.due.length, upcoming: filtered.value.upcoming.length, done: filtered.value.done.length }))
// While the stepper is walking the due messages, those items are shown in the stepper only, never again in the list below.
const steppedIds = computed(() => (batch.value && !batchFinished.value && tab.value === 'due' ? new Set(batch.value.items.map((item) => item.id)) : null))
const rows = computed(() => (steppedIds.value ? filtered.value[tab.value].filter((item) => !steppedIds.value.has(item.id)) : filtered.value[tab.value]))
const filtersActive = computed(() => Boolean(kindFilter.value || staffFilter.value))
const kindOptions = computed(() => [
  { value: '', label: 'All types' },
  ...QUEUE_KINDS.map((kind) => ({ value: kind, label: kindLabel(kind) })),
])
const staffOptions = computed(() => [
  { value: '', label: 'All staff' },
  ...teamMembers(state).map((member) => ({ value: member.id, label: member.name })),
])
function clearFilters() { kindFilter.value = ''; staffFilter.value = '' }

const hasAnyBooking = computed(() => state.bookings.some((item) => item.status !== 'blocked' && item.service_id !== 'time-off'))
const totalVisible = computed(() => visibleQueue.value.due.length + visibleQueue.value.upcoming.length + visibleQueue.value.done.length)

// ---- display helpers ----
const zoneFor = (item) => item.booking.timezone || scheduleZone.value
function fmt(value, timeZone, options) {
  try { return new Intl.DateTimeFormat(undefined, { timeZone, ...options }).format(new Date(value)) }
  catch { return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...options }).format(new Date(value)) }
}
const dayTime = (value, zone) => fmt(value, zone, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const dayOnly = (value, zone) => fmt(value, zone, { weekday: 'short', day: 'numeric', month: 'short' })
function relative(ms) {
  const abs = Math.abs(ms)
  const minutes = Math.round(abs / 60_000)
  let text
  if (minutes < 60) text = `${Math.max(minutes, 1)} min`
  else if (abs < 48 * 3_600_000) text = `${Math.round(abs / 3_600_000)} h`
  else text = `${Math.round(abs / 86_400_000)} days`
  return ms >= 0 ? `in ${text}` : `${text} ago`
}
function whenLabel(item) {
  const zone = zoneFor(item)
  if (item.kind === 'thanks') return `Visit ${dayTime(item.booking.starts_at, zone)}`
  if (item.kind === 'rebook') return `Last visit ${dayOnly(item.booking.starts_at, zone)}`
  return `Appointment ${dayTime(item.booking.starts_at, zone)}`
}
function dueNote(item) {
  if (item.openedAt) return `Opened by you ${dayTime(item.openedAt, scheduleZone.value)}`
  const dueMs = Date.parse(item.due_at)
  if (tab.value === 'upcoming') return `Due ${dayTime(dueMs, scheduleZone.value)} (${relative(dueMs - now.value)})`
  if (item.kind === 'reminder24' || item.kind === 'reminder2' || item.kind === 'prep') return `Starts ${relative(Date.parse(item.booking.starts_at) - now.value)}`
  if (item.kind === 'rebook') return `Due since ${dayOnly(dueMs, zoneFor(item))}`
  return ''
}

// ---- channels ----
const CHANNEL_LABEL = { whatsapp: 'Open WhatsApp', sms: 'Open SMS', email: 'Open mail app' }
const channelsFor = (item) => [item.message.channel, ...CHANNELS.filter((channel) => channel !== item.message.channel)].filter((channel, index, list) => list.indexOf(channel) === index)
const usableChannels = (item) => channelsFor(item).filter((channel) => item.links[channel])
function unusableNote(item) {
  const usable = usableChannels(item)
  if (!usable.length) return 'No usable phone number or real email on this booking, so nothing can be opened. Copy the message and send it another way, or add a phone number to the contact.'
  const phoneMissing = !item.links.whatsapp && !item.links.sms
  const emailMissing = !item.links.email
  if (phoneMissing && emailMissing) return ''
  if (phoneMissing) return 'WhatsApp and SMS are hidden: this booking has no usable phone number.'
  if (emailMissing) return 'Email is hidden: this booking has no real email address.'
  return ''
}
const linkAttrs = (channel) => (channel === 'whatsapp' ? { target: '_blank', rel: 'noopener noreferrer' } : {})
const gmailFor = (item) => gmailComposeUrl(item.links.email)

// ---- row state ----
const expanded = ref(new Set())
function toggleExpanded(id) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}
const busyIds = ref(new Set())
const setBusy = (id, on) => {
  const next = new Set(busyIds.value)
  if (on) next.add(id)
  else next.delete(id)
  busyIds.value = next
}
const demoReason = 'Demo is read-only, so nothing is saved. Switch to Live to mark messages.'

async function copyMessage(item) {
  try {
    await copyText(item.message.text)
    toast?.success('Message copied. Paste it into any app and press send there.')
  } catch {
    toast?.error('Your browser blocked copying. Open the message to select and copy it.')
  }
}

async function markDone(item, { quiet = false } = {}) {
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
    toast?.error(reason?.message || 'That message could not be marked. Try again.')
    return false
  } finally {
    setBusy(item.id, false)
  }
}
async function undo(item, { quiet = false } = {}) {
  if (isDemo.value || busyIds.value.has(item.id)) return
  setBusy(item.id, true)
  try {
    await markMessageOpened(item.booking, item.kind, false)
    await refresh({ silent: true })
    if (!quiet) toast?.info(`Moved back: ${kindLabel(item.kind)} for ${item.contact.name}`)
    else toast?.info('Moved back to the queue.')
  } catch (reason) {
    toast?.error(reason?.message || 'That message could not be moved back. Try again.')
  } finally {
    setBusy(item.id, false)
  }
}

// ---- batch stepper ----
const batch = ref(null) // { items, index, opened: Set, skipped: Set }
const batchCandidates = computed(() => filtered.value.due.filter((item) => usableChannels(item).length))
const batchSkippedUnusable = computed(() => filtered.value.due.length - batchCandidates.value.length)
const batchReason = computed(() => {
  if (!filtered.value.due.length) return 'Nothing is due right now.'
  if (!batchCandidates.value.length) return 'None of the due messages has a usable phone number or real email.'
  return ''
})
const current = computed(() => (batch.value ? batch.value.items[batch.value.index] || null : null))
const batchFinished = computed(() => Boolean(batch.value) && batch.value.index >= batch.value.items.length)
const batchTotal = computed(() => batch.value?.items.length || 0)
const batchProgress = computed(() => {
  if (!batchTotal.value) return 0
  const done = batch.value.index + (current.value && batch.value.opened.has(current.value.id) ? 1 : 0)
  return Math.min(done, batchTotal.value) / batchTotal.value * 100
})
function startBatch() {
  if (batchReason.value) return
  tab.value = 'due'
  batch.value = { items: batchCandidates.value.slice(), index: 0, opened: new Set(), skipped: new Set() }
}
function stopBatch() { batch.value = null }
function goNext() { if (batch.value && batch.value.index < batch.value.items.length) batch.value.index += 1 }
function goBack() { if (batch.value && batch.value.index > 0) batch.value.index -= 1 }
function skip() {
  if (!current.value) return
  if (!batch.value.opened.has(current.value.id)) batch.value.skipped = new Set(batch.value.skipped).add(current.value.id)
  goNext()
}
// Called from the real link click so the browser allows the app to open; marking happens alongside.
function openFromBatch(item) {
  const opened = new Set(batch.value.opened)
  opened.add(item.id)
  batch.value.opened = opened
  const skipped = new Set(batch.value.skipped)
  skipped.delete(item.id)
  batch.value.skipped = skipped
  if (!isDemo.value && !item.openedAt) void markDone(item, { quiet: true })
}
const batchOpenedCount = computed(() => (batch.value ? batch.value.opened.size : 0))
const batchSkippedCount = computed(() => (batch.value ? batch.value.skipped.size : 0))
// Every item in the batch is accounted for: opened, skipped, or passed with Next without opening.
const batchNotOpenedCount = computed(() => Math.max(0, batchTotal.value - batchOpenedCount.value - batchSkippedCount.value))
</script>

<template>
  <section class="messages">
    <div class="page-header">
      <div>
        <p class="eyebrow">Client messages</p>
        <h1>Messages</h1>
        <p class="lede">Reminders, prep notes, thank-yous and rebook nudges for your clients, ready to open in WhatsApp, SMS, Gmail or your mail app.</p>
      </div>
      <div class="page-header-actions">
        <RouterLink class="secondary" :to="{ path: '/settings', hash: '#settings-templates' }">
          <AppIcon name="edit" :size="16" />Edit message wording
        </RouterLink>
      </div>
    </div>

    <div class="notice info" role="note">
      <AppIcon name="info" :size="18" />
      <span><strong>Bookins prepares the message; you press send in your own app. Nothing is sent automatically.</strong> Bookins cannot tell whether a message was sent. "Done" means you opened it.</span>
    </div>
    <div v-if="hiddenKinds.length" class="notice warning" role="status">
      <AppIcon name="info" :size="18" />
      <span>{{ hiddenKinds.join(', ') }} {{ hiddenKinds.length === 1 ? 'is' : 'are' }} turned off in your message journey, so those messages are not listed.
        <RouterLink :to="{ path: '/settings', hash: '#settings-templates' }">Turn on in Settings</RouterLink></span>
    </div>

    <article class="card queue-card" data-tour="tour-messages-queue">
      <div class="queue-top">
        <div class="tab-bar" role="group" aria-label="Message list">
          <button type="button" :class="{ 'is-active': tab === 'due' }" :aria-pressed="tab === 'due'" @click="tab = 'due'">
            Due now <span class="count-pill">{{ counts.due }}</span>
          </button>
          <button type="button" :class="{ 'is-active': tab === 'upcoming' }" :aria-pressed="tab === 'upcoming'" @click="tab = 'upcoming'">
            Upcoming <span class="count-pill">{{ counts.upcoming }}</span>
          </button>
          <button type="button" :class="{ 'is-active': tab === 'done' }" :aria-pressed="tab === 'done'" @click="tab = 'done'">
            Done <span class="count-pill">{{ counts.done }}</span>
          </button>
        </div>
        <div class="queue-tools">
          <div class="field">
            <label for="msg-kind">Type</label>
            <GmSelect id="msg-kind" v-model="kindFilter" :options="kindOptions" label="Filter by message type" />
          </div>
          <div v-if="team" class="field">
            <label for="msg-staff">Staff</label>
            <GmSelect id="msg-staff" v-model="staffFilter" :options="staffOptions" label="Filter by staff member" />
          </div>
          <div v-if="tab === 'due' && !batch" class="batch-start-wrap">
          <GmButton
            variant="primary"
            class="batch-start"
            :disabled-reason="batchReason"
            @click="startBatch"
          >
            <template #leading><AppIcon name="bolt" :size="16" /></template>Start batch ({{ batchCandidates.length }})
          </GmButton>
          <GmHint text="Walks the due messages one by one: tap to open your app with the message filled in, then Next. Each message you open is marked as opened by you." label="About Start batch" />
          </div>
        </div>
      </div>

      <!-- Batch stepper -->
      <section v-if="batch" class="batch" aria-label="Batch of messages" aria-live="polite">
        <template v-if="!batchFinished && current">
          <div class="batch-head">
            <strong class="tnum">{{ batch.index + 1 }} of {{ batchTotal }}</strong>
            <span class="muted">Tap to open, we open your app prefilled. You press send there.</span>
            <button class="ghost small-button batch-close" type="button" @click="stopBatch">End batch</button>
          </div>
          <div class="progress-track" role="progressbar" aria-label="Batch progress" :aria-valuenow="batch.index" :aria-valuemin="0" :aria-valuemax="batchTotal"><span :style="{ width: `${batchProgress}%` }" /></div>
          <div class="batch-card">
            <div class="batch-who">
              <strong>{{ current.contact.name }}</strong>
              <span class="chip" :class="KIND_TONE[current.kind]">{{ kindLabel(current.kind) }}</span>
              <small class="muted">{{ current.booking.service_name }}<template v-if="team"> · {{ staffOf(current).name }}</template> · {{ whenLabel(current) }}</small>
            </div>
            <p class="batch-preview">{{ current.message.text }}</p>
            <div class="batch-actions">
              <template
                v-for="(channel, index) in usableChannels(current)"
                :key="channel"
              ><a
                :class="index === 0 ? 'primary' : 'secondary'"
                :href="current.links[channel]"
                v-bind="linkAttrs(channel)"
                @click="openFromBatch(current)"
              >{{ CHANNEL_LABEL[channel] }}<AppIcon v-if="channel === 'whatsapp'" name="external" :size="15" /></a>
              <a v-if="channel === 'email' && gmailFor(current)" class="secondary" :href="gmailFor(current)" target="_blank" rel="noopener noreferrer" @click="openFromBatch(current)">Open Gmail<AppIcon name="external" :size="15" /></a></template>
              <button class="ghost" type="button" @click="copyMessage(current)"><AppIcon name="copy" :size="16" />Copy message</button>
            </div>
            <p v-if="batch.opened.has(current.id)" class="batch-status ok"><AppIcon name="check" :size="15" />Opened by you{{ isDemo ? ' (Demo: not saved)' : '' }}. Press Next for the following message.</p>
            <p v-else class="batch-status muted">Not opened yet.</p>
          </div>
          <div class="batch-nav">
            <button class="secondary" type="button" :disabled="batch.index === 0" @click="goBack"><AppIcon name="arrow-left" :size="16" />Back</button>
            <button class="ghost" type="button" @click="skip">Skip</button>
            <button :class="batch.opened.has(current.id) ? 'primary' : 'secondary'" type="button" @click="goNext">
              {{ batch.index + 1 === batchTotal ? 'Finish' : 'Next' }}<AppIcon name="chevron" :size="15" />
            </button>
          </div>
        </template>
        <template v-else>
          <div class="batch-done">
            <span class="icon-tile success"><AppIcon name="check" :size="18" /></span>
            <div>
              <strong>Batch finished</strong>
              <p class="muted">Of {{ batchTotal }} {{ batchTotal === 1 ? 'message' : 'messages' }}: opened {{ batchOpenedCount }}, skipped {{ batchSkippedCount }}, not opened {{ batchNotOpenedCount }}. Messages you did not open stay in Due now.<template v-if="batchSkippedUnusable"> {{ batchSkippedUnusable }} had no usable phone or email and were left out.</template></p>
            </div>
            <div class="batch-nav">
              <button v-if="batchTotal" class="secondary" type="button" @click="batch.index = 0">Review again</button>
              <button class="primary" type="button" @click="stopBatch">Close batch</button>
            </div>
          </div>
        </template>
      </section>

      <!-- Rows -->
      <ul v-if="rows.length" class="msg-list" :aria-label="tab === 'due' ? 'Messages due now' : tab === 'upcoming' ? 'Upcoming messages' : 'Messages you opened'">
        <li v-for="item in rows" :key="item.id" class="msg-row">
          <div class="msg-main">
            <div class="msg-title">
              <strong>{{ item.contact.name }}</strong>
              <span class="chip" :class="KIND_TONE[item.kind]">{{ kindLabel(item.kind) }}</span>
            </div>
            <p class="msg-meta muted">
              {{ item.booking.service_name }}<template v-if="team"> · with {{ staffOf(item).name }}</template> · {{ whenLabel(item) }}
            </p>
            <p v-if="dueNote(item)" class="msg-due" :class="{ opened: item.openedAt }">{{ dueNote(item) }}</p>
            <p class="msg-preview"><span class="msg-text" :class="{ clamp: !expanded.has(item.id) }">{{ expanded.has(item.id) ? item.message.text : item.message.text.replace(/\n{2,}/g, '\n') }}</span></p>
            <button class="link-button" type="button" :aria-expanded="expanded.has(item.id)" @click="toggleExpanded(item.id)">{{ expanded.has(item.id) ? 'Show less' : 'Show full message' }}</button>
            <p v-if="tab !== 'done' && unusableNote(item)" class="field-hint msg-unusable">{{ unusableNote(item) }}</p>
          </div>
          <div class="msg-actions">
            <template v-if="tab !== 'done'">
              <div class="msg-channels"><template
                v-for="(channel, index) in usableChannels(item)"
                :key="channel"
              ><a
                :class="index === 0 ? 'primary small' : 'secondary small'"
                :href="item.links[channel]"
                v-bind="linkAttrs(channel)"
              >{{ CHANNEL_LABEL[channel] }}<AppIcon v-if="channel === 'whatsapp'" name="external" :size="14" /></a>
              <a v-if="channel === 'email' && gmailFor(item)" class="secondary small" :href="gmailFor(item)" target="_blank" rel="noopener noreferrer">Open Gmail<AppIcon name="external" :size="14" /></a></template></div>
              <div class="msg-tools">
              <GmButton variant="ghost" size="sm" @click="copyMessage(item)"><template #leading><AppIcon name="copy" :size="15" /></template>Copy message</GmButton>
              <GmButton
                variant="secondary"
                size="sm"
                :disabled="busyIds.has(item.id)"
                :disabled-reason="isDemo ? demoReason : ''"
                @click="markDone(item)"
              ><template #leading><AppIcon name="check" :size="15" /></template>Mark done</GmButton>
              <GmHint text="Mark done means you opened this message in your own app. Bookins cannot see whether you pressed send." label="About Mark done" />
              </div>
            </template>
            <template v-else>
              <GmButton variant="ghost" size="sm" @click="copyMessage(item)"><template #leading><AppIcon name="copy" :size="15" /></template>Copy message</GmButton>
              <GmButton variant="secondary" size="sm" :disabled="busyIds.has(item.id)" :disabled-reason="isDemo ? demoReason : ''" @click="undo(item)">Move back to queue</GmButton>
            </template>
          </div>
        </li>
      </ul>

      <!-- Empty states -->
      <template v-else-if="steppedIds" />
      <div v-else-if="filtersActive && totalVisible" class="empty compact">
        <span class="empty-icon"><AppIcon name="search" :size="20" /></span>
        <h2>No messages match these filters</h2>
        <p>Try another message type or staff member.</p>
        <button class="secondary small-button" type="button" @click="clearFilters">Clear filters</button>
      </div>
      <div v-else-if="!hasAnyBooking" class="empty compact">
        <span class="empty-icon"><AppIcon name="messages" :size="20" /></span>
        <h2>Messages appear once you have bookings</h2>
        <p>Share your booking link or add a booking yourself. Reminders show up here 24 hours and 2 hours before each visit, and thank-yous after.</p>
        <div class="empty-actions">
          <RouterLink v-if="!isDemo && !setup.isComplete" class="primary small" :to="setup.nextStep.to">{{ setup.nextStep.label }}</RouterLink>
          <RouterLink v-else-if="!isDemo" class="primary small" to="/settings">Share your booking link</RouterLink>
          <RouterLink class="secondary small-button" to="/bookings">Open bookings</RouterLink>
        </div>
      </div>
      <div v-else-if="tab === 'due'" class="empty compact">
        <span class="empty-icon"><AppIcon name="check" :size="20" /></span>
        <h2>Nothing to open right now</h2>
        <p>You are caught up. Reminders appear 24 hours and 2 hours before a visit; thank-yous after a visit is marked completed.</p>
        <div class="empty-actions">
          <button v-if="visibleQueue.upcoming.length" class="primary small" type="button" @click="tab = 'upcoming'">See upcoming ({{ visibleQueue.upcoming.length }})</button>
          <RouterLink class="secondary small-button" to="/bookings">Open bookings</RouterLink>
        </div>
      </div>
      <div v-else-if="tab === 'upcoming'" class="empty compact">
        <span class="empty-icon"><AppIcon name="clock" :size="20" /></span>
        <h2>Nothing coming up</h2>
        <p>Messages for bookings in the next few days will wait here until they are due.</p>
        <div class="empty-actions">
          <RouterLink class="secondary small-button" to="/bookings">Open bookings</RouterLink>
        </div>
      </div>
      <div v-else class="empty compact">
        <span class="empty-icon"><AppIcon name="messages" :size="20" /></span>
        <h2>Nothing opened yet</h2>
        <p>Messages you open or mark done appear here, so you can see what you already handled.</p>
        <div class="empty-actions">
          <button v-if="visibleQueue.due.length" class="primary small" type="button" @click="tab = 'due'">Go to Due now ({{ visibleQueue.due.length }})</button>
        </div>
      </div>
    </article>
  </section>
</template>

<style scoped>
.messages { display: grid; gap: var(--space-4); }
.messages .page-header { margin-bottom: 0; }
.messages .notice { margin-bottom: 0; }
.notice a { margin-left: 6px; color: var(--accent); font-weight: 700; }
.queue-card { display: grid; gap: var(--space-4); min-width: 0; }
.queue-top { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--space-3); }
.queue-top .tab-bar { margin-bottom: 0; }
.queue-tools { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-3); }
.queue-tools .batch-start-wrap { min-height: var(--control-h); }
.queue-tools .field { margin: 0; min-width: 170px; }
.batch-start-wrap { display: flex; align-items: center; gap: 4px; }
.batch-start { white-space: nowrap; }

.msg-list { margin: 0; padding: 0; list-style: none; display: grid; }
.msg-row { padding: var(--space-4) 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-4); align-items: start; border-bottom: 1px solid var(--line); }
.msg-row:first-child { padding-top: 0; }
.msg-row:last-child { border-bottom: 0; padding-bottom: 0; }
.msg-main { min-width: 0; display: grid; gap: 4px; justify-items: start; }
.msg-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.msg-title strong { font-size: var(--text-md); overflow-wrap: anywhere; }
.msg-meta, .msg-due { margin: 0; font-size: var(--text-sm); }
.msg-due { color: var(--ink-soft); font-weight: 650; }
.msg-due.opened { color: var(--success); }
.msg-preview { margin: 6px 0 0; padding: 10px 12px; width: 100%; color: #445071; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-soft); font-size: var(--text-sm); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.msg-text.clamp { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.link-button { padding: 0; min-height: 32px; color: var(--accent); border: 0; background: none; font-size: var(--text-xs); font-weight: 650; text-decoration: underline; cursor: pointer; }
.msg-unusable { margin: 0; }
.msg-actions { display: grid; justify-items: end; gap: var(--space-2); max-width: 400px; }
.msg-channels, .msg-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--space-2); }
.msg-channels a { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }

.batch { padding: var(--space-4); display: grid; gap: var(--space-3); border: 1px solid var(--accent-line); border-radius: var(--radius); background: var(--accent-faint); }
.batch-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.batch-head strong { font-size: var(--text-lg); }
.batch-head .muted { flex: 1 1 220px; font-size: var(--text-sm); }
.progress-track { height: 8px; overflow: hidden; border-radius: 99px; background: #dfe3f6; }
.progress-track span { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width var(--dur-panel) var(--ease); }
.batch-card { padding: var(--space-4); display: grid; gap: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; }
.batch-who { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.batch-who strong { font-size: var(--text-lg); overflow-wrap: anywhere; }
.batch-who small { flex-basis: 100%; font-size: var(--text-sm); }
.batch-preview { margin: 0; padding: 12px; color: #445071; border-radius: var(--radius-sm); background: var(--surface-soft); font-size: var(--text-sm); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 220px; overflow-y: auto; }
.batch-actions, .batch-nav { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.batch-actions a { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
.batch-nav { justify-content: space-between; }
.batch-status { margin: 0; display: flex; align-items: center; gap: 6px; font-size: var(--text-sm); }
.batch-status.ok { color: var(--success); font-weight: 650; }
.batch-done { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.batch-done > div:nth-child(2) { flex: 1 1 240px; min-width: 0; }
.batch-done p { margin: 2px 0 0; font-size: var(--text-sm); }
.empty-actions { margin-top: var(--space-3); display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-2); }
.empty.compact .empty-actions a, .empty.compact .empty-actions button { margin-top: 0; text-decoration: none; }
.empty.compact > button, .empty.compact > a { justify-self: center; }
.empty.compact h2 { margin: 0 0 6px; font-size: var(--text-lg); }
.empty.compact p { margin-bottom: 0; }

@media (max-width: 800px) {
  .queue-top .tab-bar { width: 100%; flex-wrap: wrap; overflow: visible; }
  .queue-top .tab-bar { gap: 6px; }
  .queue-top .tab-bar > button { padding: 0 8px; gap: 6px; flex: 1 1 auto; justify-content: center; }
  .msg-row { grid-template-columns: minmax(0, 1fr); gap: var(--space-3); }
  .msg-actions { justify-items: start; max-width: none; }
  .msg-channels, .msg-tools { justify-content: flex-start; }
  .queue-tools { width: 100%; }
  .queue-tools .field { flex: 1 1 140px; min-width: 0; }
  .batch-start { width: 100%; justify-content: center; }
  .batch-nav button { flex: 1; justify-content: center; }
  .batch-actions a, .batch-actions button, .msg-channels a { flex: 1 1 auto; justify-content: center; }
}
</style>
