<script setup>
// Campaigns: build an audience from booking history, write one message, then open each message yourself in
// WhatsApp / SMS / your own mail app, or export a CSV. Bookins never sends anything, so the only progress it can
// show is "opened by you". No delivery, open-rate or revenue claims anywhere on this page.
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmConfirm from '../components/ui/GmConfirm.vue'
import GmHint from '../components/ui/GmHint.vue'
import { formatDay } from '../format-date.js'
import { isDemo } from '../runtime.js'
import { useSetupState } from '../setup.js'
import { displayTimeZone } from '../time-display.js'
import {
  SEGMENT_PRESETS,
  campaignQueue,
  contactTags,
  deleteCampaign,
  emailBatches,
  exportCampaignCsv,
  hasTeam,
  markCampaignRecipientOpened,
  normalizeFilters,
  recordOffer,
  saveCampaign,
  segmentContacts,
  serviceDisplayMeta,
  teamMembers,
  touchCampaign,
} from '../booking.js'
import { CAMPAIGN_CAP, EMAIL_BATCH_SIZE, normalizeCampaign } from '../campaigns.js'
import { DEFAULT_TEMPLATES } from '../messaging.js'

const state = inject('bookingState')
const refresh = inject('refreshBookings', async () => true)
const toast = inject('toast', null)
const setup = useSetupState()
const route = useRoute()
const router = useRouter()

const zone = computed(() => displayTimeZone(state.schedules?.[0]?.timezone))
const campaigns = computed(() => state.campaigns || [])
const teamOn = computed(() => hasTeam(state))
const currency = computed(() => state.services?.find((item) => item.currency)?.currency || 'NGN')

// ---------------------------------------------------------------- consent note (first use)
const CONSENT_KEY = 'bookins:campaign-consent-seen:v1'
const CONSENT_TEXT = 'Only message people who agreed to hear from you. Ask for a STOP reply and mark them opted out here.'
const CONSENT_LAW = "Check local rules, e.g. Nigeria's NDPA, with your adviser."
const readConsent = () => {
  try {
    return window.localStorage.getItem(CONSENT_KEY) === '1'
  } catch {
    return false
  }
}
const consentSeen = ref(readConsent())
function dismissConsent() {
  consentSeen.value = true
  try {
    window.localStorage.setItem(CONSENT_KEY, '1')
  } catch {
    // The note simply shows again next visit when storage is unavailable.
  }
}

// ---------------------------------------------------------------- draft model
const NUMBER_FIELDS = [
  { key: 'lastVisitBeforeDays', label: 'Last visit more than', unit: 'days ago', hint: 'Their most recent visit (in the services above, if set) was longer ago than this.' },
  { key: 'lastVisitWithinDays', label: 'Last visit within', unit: 'days', hint: 'Their most recent visit was this recently or sooner. Good for upselling something to people who just came in.' },
  { key: 'noVisitSinceDays', label: 'No visit or booking for', unit: 'days', hint: 'Nothing attended or booked in this many days. Use it to win back lapsed clients.' },
  { key: 'visitsAtLeast', label: 'Visits at least', unit: 'visits', hint: 'A visit is a completed booking, or a confirmed one that has already ended.' },
  { key: 'noShowsAtLeast', label: 'No-shows at least', unit: 'no-shows', hint: 'Bookings you marked No-show in Bookings.' },
  { key: 'spendAtLeast', label: 'Estimated spend at least', unit: '', hint: 'Added up from the display prices of their visits. Bookins does not take payments, so this is an estimate.' },
]
const blankFilters = () => ({
  serviceContains: '',
  categoryContains: '',
  lastVisitBeforeDays: '',
  lastVisitWithinDays: '',
  noVisitSinceDays: '',
  visitsAtLeast: '',
  noShowsAtLeast: '',
  spendAtLeast: '',
  staffId: '',
  tag: '',
  source: '',
  neverRebooked: false,
  newThisMonth: false,
  dueToRebook: false,
})
const formFromFilters = (filters) => ({ ...blankFilters(), ...normalizeFilters(filters) })

const defaultTemplate = DEFAULT_TEMPLATES.campaign
const draft = reactive({
  id: '',
  name: '',
  filters: blankFilters(),
  channel: 'whatsapp',
  subject: defaultTemplate.subject,
  body: defaultTemplate.body,
  offerText: '',
  offerCode: '',
  offerExpires: '', // YYYY-MM-DD, stored inside the offer text as "Valid until 30 Nov 2026."
})

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const expiryLabel = (iso) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : ''
}
const joinOffer = (text, iso) => {
  const clean = String(text || '').trim()
  return clean && iso ? `${clean} Valid until ${expiryLabel(iso)}.` : clean
}
function splitOffer(stored) {
  const match = /\s*Valid until (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\.?$/.exec(stored || '')
  if (!match) return { text: String(stored || '').trim(), expires: '' }
  const month = String(MONTHS.indexOf(match[2]) + 1).padStart(2, '0')
  return { text: String(stored).slice(0, match.index).trim(), expires: `${match[3]}-${month}-${match[1].padStart(2, '0')}` }
}
const cleanCode = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40)

const snapshot = () =>
  JSON.stringify({
    name: draft.name.trim(),
    filters: normalizeFilters(draft.filters),
    channel: draft.channel,
    subject: draft.subject,
    body: draft.body,
    offerText: draft.offerText.trim(),
    offerCode: cleanCode(draft.offerCode),
    offerExpires: draft.offerExpires,
  })
const baseline = ref('')
const dirty = computed(() => snapshot() !== baseline.value)

const savedRecord = computed(() => campaigns.value.find((item) => item.id === draft.id) || null)

function resetDraft() {
  Object.assign(draft, {
    id: '',
    name: '',
    filters: blankFilters(),
    channel: 'whatsapp',
    subject: defaultTemplate.subject,
    body: defaultTemplate.body,
    offerText: '',
    offerCode: '',
    offerExpires: '',
  })
  baseline.value = snapshot()
}
function loadCampaign(record) {
  const normalized = normalizeCampaign(record)
  const offer = splitOffer(normalized.offerText)
  Object.assign(draft, {
    id: record.id || '',
    name: normalized.name,
    filters: formFromFilters(normalized.filters),
    channel: normalized.template.channel,
    subject: normalized.template.subject,
    body: normalized.template.body,
    offerText: offer.text,
    offerCode: normalized.offerCode,
    offerExpires: offer.expires,
  })
  baseline.value = snapshot()
}
resetDraft()

// ---------------------------------------------------------------- audience
const filtersNow = computed(() => normalizeFilters(draft.filters))
const filterCount = computed(() => Object.keys(filtersNow.value).length)
const segment = computed(() => segmentContacts(state, filtersNow.value, { timezone: zone.value }))
const everyone = computed(() => segmentContacts(state, {}, { timezone: zone.value }))
const hasHistory = computed(() => everyone.value.total + everyone.value.optedOut.length + everyone.value.unreachable > 0)
const showAllRows = ref(false)
const PREVIEW_ROWS = 25
const previewRows = computed(() => (showAllRows.value ? segment.value.contacts : segment.value.contacts.slice(0, PREVIEW_ROWS)))
const optedOutRows = computed(() => segment.value.optedOut.slice(0, 12))

const tagOptions = computed(() => {
  const set = new Set()
  for (const record of state.contacts || []) for (const tag of contactTags(record)) set.add(tag)
  return [...set].sort((a, b) => a.localeCompare(b))
})
const serviceOptions = computed(() => {
  const set = new Set()
  for (const service of state.services || []) {
    if (service.name) set.add(service.name)
    const category = serviceDisplayMeta(service).category
    if (category) set.add(category)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
})
const categoryOptions = computed(() => [...new Set((state.services || []).map((item) => serviceDisplayMeta(item).category).filter(Boolean))].sort())
const staffOptions = computed(() => teamMembers(state).map((member) => ({ value: member.id, label: member.name || 'Team member' })))

const sameFilters = (a, b) => {
  const left = normalizeFilters(a)
  const right = normalizeFilters(b)
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key])
}
const activePreset = computed(() => SEGMENT_PRESETS.find((preset) => sameFilters(preset.filters, draft.filters))?.id || '')
const autoName = ref('')
function applyPreset(preset) {
  draft.filters = formFromFilters(preset.filters)
  showAllRows.value = false
  if (!draft.id && (!draft.name.trim() || draft.name === autoName.value)) {
    draft.name = preset.name
    autoName.value = preset.name
  }
}
function clearFilters() {
  draft.filters = blankFilters()
  showAllRows.value = false
}

const money = (amount) => {
  if (!amount) return '—'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.value, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency.value} ${Math.round(amount).toLocaleString()}`
  }
}
const day = (value) => (value ? formatDay(value, zone.value) : 'No visit yet')
const optOutReason = (contact) => {
  const at = contact.record?.marketing_opt_out_at
  return at ? `Opted out on ${formatDay(at, zone.value)}` : 'Opted out (asked to stop)'
}

// ---------------------------------------------------------------- message
const CHANNELS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
]
const VARIABLES = [
  { name: 'first_name', hint: "The client's first name." },
  { name: 'last_service', hint: 'The service they last had with you.' },
  { name: 'offer', hint: 'Your offer text from below.' },
  { name: 'offer_code', hint: 'Your offer code from below.' },
  { name: 'offer_expires', hint: 'The expiry date from below. Left out when no date is set.' },
  { name: 'business', hint: 'Your business name from Settings.' },
  { name: 'booking_link', hint: 'Your public booking link.' },
  { name: 'business_phone', hint: 'The [[wa:...]] number in your bio, if you added one.' },
]
const bodyField = ref(null)
function insertVariable(name) {
  const token = `{{${name}}}`
  const el = bodyField.value
  if (!el) {
    draft.body += token
    return
  }
  const start = el.selectionStart ?? draft.body.length
  const end = el.selectionEnd ?? start
  draft.body = draft.body.slice(0, start) + token + draft.body.slice(end)
  nextTick(() => {
    el.focus()
    el.setSelectionRange(start + token.length, start + token.length)
  })
}
function onCodeInput(event) {
  draft.offerCode = cleanCode(event.target.value)
}

// The campaign object handed to the data layer. {{offer_expires}} is filled here (the data layer leaves it blank),
// and when the template does not place it the expiry is appended to the offer text instead.
const usesExpiryVariable = computed(() => /\{\{\s*offer_expires\s*\}\}/.test(`${draft.subject} ${draft.body}`))
const effective = computed(() => {
  const expires = expiryLabel(draft.offerExpires)
  const fill = (text) => (expires ? text.replace(/\{\{\s*offer_expires\s*\}\}/g, expires) : text)
  return {
    id: draft.id,
    name: draft.name,
    segment: filtersNow.value,
    template: { channel: draft.channel, subject: fill(draft.subject), body: fill(draft.body) },
    offerText: joinOffer(draft.offerText, usesExpiryVariable.value ? '' : draft.offerExpires),
    offerCode: cleanCode(draft.offerCode),
    created_at: savedRecord.value?.created_at || '',
  }
})
const warnings = computed(() => {
  const list = []
  if (!dirty.value && !draft.id) return list
  const text = `${draft.subject} ${draft.body}`
  if (/\{\{\s*offer\s*\}\}/.test(text) && !draft.offerText.trim()) list.push('Your message uses {{offer}} but no offer text is set.')
  if (draft.offerExpires && !draft.offerText.trim()) list.push('An expiry date needs offer text to go with it.')
  return list
})
const previewQueue = computed(() => campaignQueue(state, effective.value, 'any', { timezone: zone.value }))
const preview = computed(() => {
  const first = previewQueue.value.recipients[0]
  return first
    ? { text: first.text, subject: first.subject, who: first.contact.name }
    : { text: previewQueue.value.recipients.broadcast.text, subject: previewQueue.value.recipients.broadcast.subject, who: '' }
})

// ---------------------------------------------------------------- save, duplicate, delete
const saving = ref(false)
const saveError = ref('')
const saveReason = computed(() => {
  if (isDemo.value) return 'Demo is read-only. Exit Demo to save campaigns.'
  if (!draft.name.trim()) return 'Give the campaign a name first.'
  if (draft.id && !dirty.value) return 'No changes to save.'
  return ''
})
function campaignInput(extra = {}) {
  return {
    name: draft.name,
    segment: filtersNow.value,
    template: { channel: draft.channel, subject: draft.subject, body: draft.body },
    offerText: joinOffer(draft.offerText, draft.offerExpires),
    offerCode: cleanCode(draft.offerCode),
    audienceCount: segment.value.total,
    ...extra,
  }
}
async function save() {
  if (saving.value || saveReason.value) return
  saving.value = true
  saveError.value = ''
  try {
    const result = await saveCampaign(savedRecord.value, campaignInput())
    await refresh({ silent: true })
    const fresh = campaigns.value.find((item) => item.id === (result?.id || draft.id)) || result
    if (fresh) loadCampaign(fresh)
    else baseline.value = snapshot()
    toast?.success(`Campaign "${draft.name}" saved.`)
  } catch (reason) {
    saveError.value = reason?.message || 'The campaign could not be saved.'
    toast?.error('The campaign could not be saved.')
  } finally {
    saving.value = false
  }
}

const rowBusy = ref('')
async function duplicate(record) {
  if (isDemo.value || rowBusy.value) return
  rowBusy.value = record.id
  try {
    const copy = normalizeCampaign(record)
    await saveCampaign(null, {
      name: `${copy.name} (copy)`,
      segment: copy.filters,
      template: copy.template,
      offerText: copy.offerText,
      offerCode: copy.offerCode,
      status: 'draft',
      audienceCount: record.audience_count,
    })
    await refresh({ silent: true })
    toast?.success(`Duplicated "${copy.name}". Progress starts fresh for the copy.`)
  } catch (reason) {
    toast?.error(reason?.message || 'The campaign could not be duplicated.')
  } finally {
    rowBusy.value = ''
  }
}
const deleteTarget = ref('')
async function removeCampaign(record) {
  if (isDemo.value || rowBusy.value) return
  rowBusy.value = record.id
  try {
    await deleteCampaign(record)
    await refresh({ silent: true })
    if (draft.id === record.id) resetDraft()
    toast?.success(`Deleted "${record.name}". Offers already recorded on contacts are kept.`)
  } catch (reason) {
    toast?.error(reason?.message || 'The campaign could not be deleted.')
  } finally {
    rowBusy.value = ''
    deleteTarget.value = ''
  }
}
async function setStatus(record, status) {
  if (isDemo.value) return
  try {
    await saveCampaign(record, { status })
    await refresh({ silent: true })
    toast?.success(status === 'done' ? `"${record.name}" marked done.` : `"${record.name}" is active again.`)
  } catch (reason) {
    toast?.error(reason?.message || 'The status could not be changed.')
  }
}

// ---------------------------------------------------------------- unsaved changes
const confirmKey = ref('')
const pendingAction = ref(null)
const setConfirm = (key, open) => {
  if (open) confirmKey.value = key
  else if (confirmKey.value === key) confirmKey.value = ''
}
function guarded(key, action) {
  if (dirty.value) {
    pendingAction.value = action
    confirmKey.value = key
  } else action()
}
function runPending() {
  const action = pendingAction.value
  pendingAction.value = null
  confirmKey.value = ''
  action?.()
}
const builderEl = ref(null)
const scrollToBuilder = () => nextTick(() => builderEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
function startNew() {
  resetDraft()
  scrollToBuilder()
}
function editCampaign(record) {
  loadCampaign(record)
  scrollToBuilder()
}
const discardOpen = ref(false)
function discardChanges() {
  discardOpen.value = false
  if (savedRecord.value) loadCampaign(savedRecord.value)
  else resetDraft()
}
const onBeforeUnload = (event) => {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

// Deep links: /campaigns?preset=due-rebook, ?tag=VIP, ?service=Braids, ?campaign=<id>
function applyQuery(query) {
  if (!query || !Object.keys(query).length) return
  if (query.campaign) {
    const record = campaigns.value.find((item) => item.id === query.campaign)
    if (record) loadCampaign(record)
  } else if (query.preset || query.tag || query.service) {
    resetDraft()
    const preset = SEGMENT_PRESETS.find((item) => item.id === query.preset)
    if (preset) applyPreset(preset)
    if (query.tag) draft.filters.tag = String(query.tag)
    if (query.service) draft.filters.serviceContains = String(query.service)
    if (!draft.name.trim()) draft.name = query.tag ? `Clients tagged ${query.tag}` : query.service ? `${query.service} clients` : ''
    baseline.value = snapshot()
  }
  router.replace({ path: route.path, query: {} })
  scrollToBuilder()
}
onMounted(() => applyQuery(route.query))
watch(() => route.query, (query) => applyQuery(query))

// ---------------------------------------------------------------- send: assisted queue
const SEND_TABS = [
  { value: 'whatsapp', label: 'WhatsApp', open: 'Open WhatsApp' },
  { value: 'sms', label: 'SMS', open: 'Open SMS' },
  { value: 'email', label: 'Email' },
  { value: 'csv', label: 'Export CSV' },
]
const sendTab = ref('whatsapp')
const sessionOpened = reactive(new Set())
const stepIndex = ref(-1)
const touched = new Set()
watch(
  () => draft.id,
  () => {
    sessionOpened.clear()
    stepIndex.value = -1
    sendTab.value = draft.channel
  },
  { immediate: true },
)
const sendChannel = computed(() => (sendTab.value === 'csv' ? 'any' : sendTab.value))
const queue = computed(() => (draft.id ? campaignQueue(state, effective.value, sendChannel.value, { timezone: zone.value }) : null))
const recipients = computed(() => queue.value?.recipients || [])
const isOpened = (recipient) => Boolean(recipient.openedAt) || sessionOpened.has(recipient.contact.email)
const openedCount = computed(() => recipients.value.filter(isOpened).length)
const currentIndex = computed(() => {
  if (stepIndex.value >= 0 && stepIndex.value < recipients.value.length) return stepIndex.value
  return recipients.value.findIndex((item) => !isOpened(item))
})
const current = computed(() => recipients.value[currentIndex.value] || null)
const allOpened = computed(() => recipients.value.length > 0 && openedCount.value >= recipients.value.length)
const openLabel = computed(() => SEND_TABS.find((item) => item.value === sendTab.value)?.open || 'Open')
const offerStats = computed(() => {
  if (!draft.offerCode) return null
  const list = recipients.value
  return { offered: list.filter((item) => item.openedAt || sessionOpened.has(item.contact.email)).length, redeemed: list.filter((item) => item.redeemed).length }
})

let writeChain = Promise.resolve()
function persistOpened(items) {
  const record = savedRecord.value
  if (isDemo.value || !record) return Promise.resolve()
  writeChain = writeChain
    .then(async () => {
      if (!touched.has(record.id)) {
        touched.add(record.id)
        await touchCampaign(record)
        if (record.status === 'draft') await saveCampaign(record, { status: 'active' })
      }
      for (const item of items) await markCampaignRecipientOpened(item.contact, { ...record, offer_code: effective.value.offerCode })
      await refresh({ silent: true })
    })
    .catch((reason) => {
      toast?.error(reason?.message || 'Could not remember who you opened. You can keep going; progress may reset after a refresh.')
    })
  return writeChain
}
function advanceFrom(index) {
  const list = recipients.value
  const next = list.findIndex((item, position) => position > index && !isOpened(item))
  stepIndex.value = next
}
function onOpenLink(recipient) {
  const index = recipients.value.indexOf(recipient)
  sessionOpened.add(recipient.contact.email)
  advanceFrom(index)
  persistOpened([recipient])
}
function markWithoutOpening(recipient) {
  const index = recipients.value.indexOf(recipient)
  sessionOpened.add(recipient.contact.email)
  advanceFrom(index)
  persistOpened([recipient])
}
const canSkip = computed(() => recipients.value.some((item, index) => index !== currentIndex.value && !isOpened(item)))
function skip() {
  const list = recipients.value
  for (let step = 1; step < list.length; step += 1) {
    const index = (currentIndex.value + step) % list.length
    if (!isOpened(list[index])) {
      stepIndex.value = index
      return
    }
  }
}
const back = () => {
  if (currentIndex.value > 0) stepIndex.value = currentIndex.value - 1
}

const batches = computed(() => (sendTab.value === 'email' ? emailBatches(recipients.value) : []))
const batchRecipients = (batch) => batch.emails.map((email) => recipients.value.find((item) => item.contact.email.toLowerCase() === email)).filter(Boolean)
const batchOpened = (batch) => batchRecipients(batch).length > 0 && batchRecipients(batch).every(isOpened)
function onOpenBatch(batch) {
  const items = batchRecipients(batch)
  for (const item of items) sessionOpened.add(item.contact.email)
  persistOpened(items)
  toast?.info(`${batch.label} marked as opened by you (${batch.count} in BCC).`)
}

const skipped = computed(() => (queue.value ? queue.value.optedOut : 0))
function exportCsv() {
  const list = recipients.value
  if (!list.length) return
  const body = exportCampaignCsv(list)
  const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${(draft.name || 'campaign').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'campaign'}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast?.success(`Exported ${list.length} ${list.length === 1 ? 'person' : 'people'}. Opted-out contacts are never included.`)
}

// ---------------------------------------------------------------- offers
const redeeming = ref('')
async function setRedeemed(recipient, redeemed) {
  if (isDemo.value || redeeming.value) return
  redeeming.value = recipient.contact.email
  try {
    await recordOffer(recipient.contact, { code: recipient.offerCode, status: redeemed ? 'redeemed' : 'offered' })
    await refresh({ silent: true })
    toast?.success(redeemed ? `${recipient.contact.name} marked as redeemed. Honour the offer by hand when they book.` : `${recipient.contact.name} set back to offered.`)
  } catch (reason) {
    toast?.error(reason?.message || 'The offer could not be updated.')
  } finally {
    redeeming.value = ''
  }
}

// ---------------------------------------------------------------- list
const statusLabel = { draft: 'Draft', active: 'Active', done: 'Done' }
const statusClass = { draft: 'neutral', active: 'success', done: 'info' }
// Cached per workspace data (not per keystroke): one audience pass per saved campaign.
const audienceCounts = computed(() => new Map(campaigns.value.map((record) => [record.id, segmentContacts(state, normalizeFilters(record.segment_json), { timezone: zone.value }).total])))
const liveAudience = (record) => audienceCounts.value.get(record.id) ?? 0
const lastOpened = (record) => (record.last_opened_at ? formatDay(record.last_opened_at, zone.value) : '')

async function copyBookingLink() {
  try {
    await navigator.clipboard.writeText(state.profile?.public_link_url || '')
    toast?.success('Booking link copied. Share it with your first client.')
  } catch {
    toast?.error('Could not copy the link. Open Settings to copy it.')
  }
}
</script>

<template>
  <section class="campaigns">
    <div class="page-header">
      <div>
        <p class="eyebrow">Win clients back</p>
        <h1>Campaigns</h1>
        <p class="lede">Pick a group of clients from your booking history, write one message, then open each message yourself in WhatsApp, SMS or your own email app. Bookins never sends anything for you.</p>
      </div>
      <div class="page-header-actions">
        <GmConfirm
          :open="confirmKey === 'new'"
          title="Discard unsaved changes?"
          message="Starting a new campaign will lose your edits to this one."
          confirm-label="Discard and start new"
          cancel-label="Keep editing"
          tone="danger"
          @update:open="setConfirm('new', $event)"
          @confirm="runPending"
          @cancel="pendingAction = null"
        >
          <button class="secondary" type="button" @click="guarded('new', startNew)"><AppIcon name="plus" :size="16" />New campaign</button>
        </GmConfirm>
      </div>
    </div>

    <div v-if="!consentSeen" class="notice info consent" role="note">
      <AppIcon name="info" :size="18" />
      <div>
        <p><strong>Before you message anyone</strong></p>
        <p>{{ CONSENT_TEXT }} {{ CONSENT_LAW }}</p>
        <button class="secondary small-button" type="button" @click="dismissConsent">Got it</button>
      </div>
    </div>

    <!-- Saved campaigns -->
    <article class="card block" aria-labelledby="saved-heading">
      <div class="block-head">
        <h2 id="saved-heading">Your campaigns</h2>
        <span v-if="campaigns.length" class="chip neutral tnum">{{ campaigns.length }}</span>
      </div>
      <ul v-if="campaigns.length" class="campaign-list">
        <li v-for="record in campaigns" :key="record.id" class="campaign-row" :class="{ 'is-current': draft.id === record.id }">
          <div class="campaign-main">
            <h3 class="truncate">{{ record.name }}</h3>
            <p class="meta">
              <span class="chip caps" :class="statusClass[record.status] || 'neutral'">{{ statusLabel[record.status] || 'Draft' }}</span>
              <span class="tnum">{{ liveAudience(record) }} {{ liveAudience(record) === 1 ? 'person' : 'people' }} now</span>
              <span v-if="Number(record.audience_count) && Number(record.audience_count) !== liveAudience(record)" class="faint tnum">({{ record.audience_count }} when saved)</span>
              <span v-if="lastOpened(record)" class="faint">Last opened by you {{ lastOpened(record) }}</span>
            </p>
          </div>
          <div class="row-actions">
            <GmConfirm
              :open="confirmKey === `edit-${record.id}`"
              title="Discard unsaved changes?"
              message="Opening another campaign will lose your edits to the current one."
              confirm-label="Discard and open"
              cancel-label="Keep editing"
              tone="danger"
              @update:open="setConfirm(`edit-${record.id}`, $event)"
              @confirm="runPending"
              @cancel="pendingAction = null"
            >
              <button class="secondary small-button" type="button" :aria-label="`Edit ${record.name}`" @click="guarded(`edit-${record.id}`, () => editCampaign(record))"><AppIcon name="edit" :size="16" />Edit</button>
            </GmConfirm>
            <GmButton variant="secondary" size="sm" :disabled-reason="isDemo ? 'Demo is read-only. Exit Demo to duplicate campaigns.' : ''" :pending="rowBusy === record.id" :aria-label="`Duplicate ${record.name}`" @click="duplicate(record)"><template #leading><AppIcon name="copy" :size="16" /></template>Duplicate</GmButton>
            <GmButton v-if="record.status === 'done'" variant="secondary" size="sm" :disabled-reason="isDemo ? 'Demo is read-only.' : ''" @click="setStatus(record, 'active')">Reopen</GmButton>
            <GmButton v-else-if="record.status === 'active'" variant="secondary" size="sm" :disabled-reason="isDemo ? 'Demo is read-only.' : ''" @click="setStatus(record, 'done')">Mark done</GmButton>
            <GmConfirm
              :open="deleteTarget === record.id"
              title="Delete this campaign?"
              :message="`&quot;${record.name}&quot; will be removed. Offers already recorded on contacts are kept.`"
              confirm-label="Delete campaign"
              tone="danger"
              :busy="rowBusy === record.id"
              @update:open="deleteTarget = $event ? record.id : ''"
              @confirm="removeCampaign(record)"
            >
              <GmButton variant="ghost" size="sm" :disabled-reason="isDemo ? 'Demo is read-only. Exit Demo to delete campaigns.' : ''" :aria-label="`Delete ${record.name}`" @click="deleteTarget = record.id"><template #leading><AppIcon name="trash" :size="16" /></template>Delete</GmButton>
            </GmConfirm>
          </div>
        </li>
      </ul>
      <div v-else class="empty compact">
        <span class="empty-icon"><AppIcon name="campaigns" /></span>
        <h3>No campaigns yet</h3>
        <p>A campaign is a saved group of clients plus a message. {{ hasHistory ? 'Start with a ready-made group, like clients who are due to rebook.' : 'Once clients have booked with you, you can message them from here.' }}</p>
        <button v-if="hasHistory" class="primary" type="button" @click="applyPreset(SEGMENT_PRESETS[0]); scrollToBuilder()">Start with "{{ SEGMENT_PRESETS[0].name }}"</button>
        <template v-else>
          <button v-if="setup.hasLink" class="primary" type="button" @click="copyBookingLink">Copy your booking link</button>
          <RouterLink v-else class="primary" to="/settings">Create your booking link</RouterLink>
        </template>
      </div>
    </article>

    <!-- Builder -->
    <div ref="builderEl" class="builder" data-tour="tour-campaigns-builder">
      <article class="card block">
        <div class="block-head">
          <h2>{{ draft.id ? 'Edit campaign' : 'New campaign' }}</h2>
          <span v-if="draft.id" class="chip neutral">Saved</span>
          <span v-else class="chip warning">Not saved yet</span>
        </div>
        <div class="field">
          <label for="campaign-name">Campaign name <GmHint text="Only you see this. Use something you will recognise, like 'Braids refresh, October'." label="About the campaign name" /></label>
          <input id="campaign-name" v-model="draft.name" class="input" maxlength="120" placeholder="e.g. Bring back lapsed clients" autocomplete="off" />
        </div>
      </article>

      <!-- 1. Audience -->
      <article class="card block" aria-labelledby="audience-heading">
        <div class="block-head">
          <h2 id="audience-heading"><span class="step">1</span>Choose who</h2>
          <GmHint text="Everything here is worked out in your browser from your bookings and contacts. Cancelled bookings and time off are ignored. Opted-out contacts are always left out." label="How audiences work" />
        </div>

        <div v-if="!hasHistory" class="empty compact">
          <span class="empty-icon"><AppIcon name="contacts" /></span>
          <h3>No clients to message yet</h3>
          <p>Campaigns are built from the people who have booked with you. Share your booking link, and once clients book they will appear here.</p>
          <button v-if="setup.hasLink" class="primary" type="button" @click="copyBookingLink">Copy your booking link</button>
          <RouterLink v-else class="primary" to="/settings">Create your booking link</RouterLink>
        </div>

        <template v-else>
          <p class="field-hint presets-label">Start from a ready-made group</p>
          <div class="preset-row" role="group" aria-label="Ready-made groups">
            <button
              v-for="preset in SEGMENT_PRESETS"
              :key="preset.id"
              class="chip-button"
              type="button"
              :class="{ on: activePreset === preset.id }"
              :aria-pressed="activePreset === preset.id"
              :title="preset.description"
              @click="applyPreset(preset)"
              >{{ preset.name }}</button
            >
          </div>
          <p v-if="activePreset" class="field-hint">{{ SEGMENT_PRESETS.find((item) => item.id === activePreset).description }}</p>

          <fieldset class="filters">
            <legend class="visually-hidden">Audience filters</legend>
            <div class="field">
              <label for="f-service">Past service contains <GmHint text="Matches the name of any service they booked, or its category. Other filters then look only at those visits." label="About the service filter" /></label>
              <input id="f-service" v-model="draft.filters.serviceContains" class="input" list="f-service-list" placeholder="e.g. braids" autocomplete="off" />
              <datalist id="f-service-list"><option v-for="option in serviceOptions" :key="option" :value="option" /></datalist>
            </div>
            <div class="field">
              <label for="f-category">Category contains</label>
              <input id="f-category" v-model="draft.filters.categoryContains" class="input" list="f-category-list" placeholder="e.g. Nails" autocomplete="off" />
              <datalist id="f-category-list"><option v-for="option in categoryOptions" :key="option" :value="option" /></datalist>
            </div>
            <div v-for="field in NUMBER_FIELDS" :key="field.key" class="field">
              <label :for="`f-${field.key}`">{{ field.label }} <GmHint :text="field.hint" :label="`About ${field.label}`" /></label>
              <div class="unit-input">
                <input :id="`f-${field.key}`" v-model="draft.filters[field.key]" class="input tnum" type="number" min="0" inputmode="numeric" placeholder="Any" />
                <span v-if="field.unit || field.key === 'spendAtLeast'">{{ field.key === 'spendAtLeast' ? currency : field.unit }}</span>
              </div>
            </div>
            <div v-if="teamOn" class="field">
              <label for="f-staff">Seen by <GmHint text="Only clients who had a visit with this team member." label="About the team member filter" /></label>
              <select id="f-staff" v-model="draft.filters.staffId" class="input">
                <option value="">Anyone</option>
                <option v-for="option in staffOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </div>
            <div class="field">
              <label for="f-tag">Tag <GmHint text="One of your own tags from Contacts, such as VIP." label="About the tag filter" /></label>
              <input id="f-tag" v-model="draft.filters.tag" class="input" list="f-tag-list" placeholder="Any tag" autocomplete="off" />
              <datalist id="f-tag-list"><option v-for="option in tagOptions" :key="option" :value="option" /></datalist>
            </div>
            <div class="field">
              <label for="f-source">Booked how <GmHint text="Whether their first booking came from your public booking page or was added by you." label="About the source filter" /></label>
              <select id="f-source" v-model="draft.filters.source" class="input">
                <option value="">Either way</option>
                <option value="guest">Booked online</option>
                <option value="owner">Added by me</option>
              </select>
            </div>
            <div class="checks">
              <label class="check"><input v-model="draft.filters.dueToRebook" type="checkbox" /> Due to rebook <GmHint text="Their last visit was longer ago than the 'rebook after' days you set on that service. Set it in Services." label="About due to rebook" /></label>
              <label class="check"><input v-model="draft.filters.neverRebooked" type="checkbox" /> Only ever booked once <GmHint text="Clients with exactly one booking: they came, but never came back." label="About never rebooked" /></label>
              <label class="check"><input v-model="draft.filters.newThisMonth" type="checkbox" /> New this month <GmHint text="Their first booking was made this calendar month. A nice fit for a thank-you." label="About new this month" /></label>
            </div>
          </fieldset>

          <div class="audience-bar" role="status" aria-live="polite" :class="{ empty: !segment.total }">
            <p class="audience-count">
              <strong class="tnum">{{ segment.total }}</strong>
              <span>{{ segment.total === 1 ? 'person' : 'people' }} will get this message<template v-if="filterCount"> ({{ filterCount }} {{ filterCount === 1 ? 'filter' : 'filters' }})</template></span>
            </p>
            <p v-if="segment.optedOut.length" class="audience-note"><span class="chip warning">{{ segment.optedOut.length }} opted out</span> always left out</p>
            <p v-if="segment.unreachable" class="audience-note"><span class="chip neutral">{{ segment.unreachable }} unreachable</span> have no phone or real email</p>
            <button v-if="filterCount" class="ghost small-button" type="button" @click="clearFilters">Clear filters</button>
          </div>

          <div v-if="segment.total || segment.optedOut.length" class="table-wrap">
            <table class="preview">
              <caption class="visually-hidden">People in this audience</caption>
              <thead>
                <tr><th scope="col">Name</th><th scope="col">Last visit</th><th scope="col">Last service</th><th scope="col" class="num">Visits</th><th scope="col" class="num">Est. spend</th><th scope="col">Can reach by</th></tr>
              </thead>
              <tbody>
                <tr v-for="row in previewRows" :key="row.contact.email">
                  <th scope="row" data-label="Name">{{ row.contact.name }}</th>
                  <td data-label="Last visit">{{ day(row.stats.lastAt) }}</td>
                  <td data-label="Last service">{{ row.stats.lastService || '—' }}</td>
                  <td class="num tnum" data-label="Visits">{{ row.stats.visits }}</td>
                  <td class="num tnum" data-label="Est. spend">{{ money(row.stats.spend) }}</td>
                  <td data-label="Can reach by">
                    <span v-if="row.stats.reachable.whatsapp" class="chip neutral">WhatsApp / SMS</span>
                    <span v-if="row.stats.reachable.email" class="chip neutral">Email</span>
                  </td>
                </tr>
                <tr v-for="row in optedOutRows" :key="`out-${row.contact.email}`" class="is-opted-out">
                  <th scope="row" data-label="Name">{{ row.contact.name }}</th>
                  <td colspan="4" data-label="Reason">{{ optOutReason(row.contact) }}. Never included.</td>
                  <td data-label="Status"><span class="chip warning">Opted out</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!showAllRows && segment.total > PREVIEW_ROWS" class="table-foot">
            Showing the first {{ PREVIEW_ROWS }} of {{ segment.total }}. <button class="link-button" type="button" @click="showAllRows = true">Show everyone</button>
          </p>
          <p v-if="segment.optedOut.length > optedOutRows.length" class="table-foot">and {{ segment.optedOut.length - optedOutRows.length }} more opted-out contacts.</p>
          <p v-if="segment.optedOut.length" class="field-hint">Greyed rows asked to stop. Change this on their card in <RouterLink to="/contacts">Contacts</RouterLink>.</p>
          <div v-if="!segment.total && !segment.optedOut.length" class="empty compact">
            <span class="empty-icon"><AppIcon name="search" /></span>
            <h3>No one matches these filters</h3>
            <p>Try fewer filters or a wider time window.</p>
            <button v-if="filterCount" class="secondary" type="button" @click="clearFilters">Clear filters</button>
          </div>
        </template>
      </article>

      <!-- 2. Message -->
      <article class="card block" aria-labelledby="message-heading">
        <div class="block-head">
          <h2 id="message-heading"><span class="step">2</span>Write the message</h2>
        </div>

        <div class="field">
          <span class="field-label" id="channel-label">Main channel <GmHint text="Where you plan to reach people first. You can still choose a different way when you reach out." label="About the main channel" /></span>
          <div class="segmented" role="group" aria-labelledby="channel-label">
            <button v-for="option in CHANNELS" :key="option.value" type="button" :aria-pressed="draft.channel === option.value" :class="{ 'is-active': draft.channel === option.value }" @click="draft.channel = option.value">{{ option.label }}</button>
          </div>
        </div>

        <div v-if="draft.channel === 'email'" class="field">
          <label for="campaign-subject">Subject</label>
          <input id="campaign-subject" v-model="draft.subject" class="input" maxlength="300" />
        </div>
        <div class="field">
          <label for="campaign-body">Message <GmHint text="Click a variable below to drop it into your message. Each person's own details are filled in when you open their message. Email batches use a name-free version." label="About the message" /></label>
          <textarea id="campaign-body" ref="bodyField" v-model="draft.body" class="body-field" maxlength="2000" rows="7"></textarea>
          <div class="var-chips" role="group" aria-label="Insert a variable">
            <button v-for="variable in VARIABLES" :key="variable.name" class="chip-button var" type="button" :title="variable.hint" @click="insertVariable(variable.name)" v-text="`{{${variable.name}}}`"></button>
          </div>
          <p class="field-hint">A "Reply STOP to opt out" footer is always added if your message does not already have one.</p>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="offer-text">Offer text (optional) <GmHint text="A discount is just words, such as '10% off if you book before 30 Nov, mention HAIR10'. Bookins cannot apply discounts at booking, so you honour the offer by hand." label="About offers" /></label>
            <textarea id="offer-text" v-model="draft.offerText" rows="2" maxlength="400" placeholder="10% off your next visit, mention the code when you book"></textarea>
          </div>
          <div class="field">
            <label for="offer-code">Offer code <GmHint text="Used to track who was offered it and who redeemed it. Letters and numbers only." label="About the offer code" /></label>
            <input id="offer-code" class="input mono" :value="draft.offerCode" maxlength="40" placeholder="HAIR10" autocomplete="off" @input="onCodeInput" />
          </div>
          <div class="field">
            <label for="offer-expires">Valid until <GmHint text="Shown in the message as 'Valid until 30 Nov 2026'. Bookins does not enforce it, so you decide at the till." label="About the expiry" /></label>
            <input id="offer-expires" v-model="draft.offerExpires" class="input" type="date" />
          </div>
        </div>
        <p class="field-hint">Offers are words only. Bookins cannot apply a discount for you, so you honour it by hand when the client books.</p>
        <p v-for="warning in warnings" :key="warning" class="notice warning" role="status"><AppIcon name="alert" :size="18" />{{ warning }}</p>

        <div class="message-preview" aria-live="polite">
          <p class="preview-label">Preview<template v-if="preview.who"> for {{ preview.who }}</template><template v-else> (no one to preview yet)</template></p>
          <p v-if="draft.channel === 'email'" class="preview-subject"><strong>Subject:</strong> {{ preview.subject }}</p>
          <p class="preview-text">{{ preview.text }}</p>
        </div>

        <p v-if="saveError" class="notice error" role="alert"><AppIcon name="alert" :size="18" />{{ saveError }}</p>
        <div class="form-actions">
          <GmButton :pending="saving" pending-label="Saving…" :disabled-reason="saveReason" reason-visible @click="save">{{ draft.id ? 'Save changes' : 'Save campaign' }}</GmButton>
        </div>
      </article>

      <!-- 3. Reach out -->
      <article class="card block" aria-labelledby="reach-heading">
        <div class="block-head">
          <h2 id="reach-heading"><span class="step">3</span>Reach your clients</h2>
          <GmHint :text="`${CONSENT_TEXT} ${CONSENT_LAW}`" label="About consent" />
        </div>
        <p class="field-hint">Bookins builds the list and the message, then you open each one in your own app. It cannot see what happens after you press send in your own app, so progress here is only what you opened.</p>

        <div v-if="!draft.id" class="empty compact">
          <span class="empty-icon"><AppIcon name="lock" /></span>
          <h3>Save the campaign to start</h3>
          <p>Saving keeps your place, so you can stop and carry on later where you left off.</p>
          <GmButton :pending="saving" pending-label="Saving…" :disabled-reason="saveReason" reason-visible @click="save">Save campaign</GmButton>
        </div>

        <template v-else>
          <div class="segmented send-tabs" role="tablist" aria-label="How to reach people">
            <button v-for="tab in SEND_TABS" :key="tab.value" type="button" role="tab" :aria-selected="sendTab === tab.value" :class="{ 'is-active': sendTab === tab.value }" @click="sendTab = tab.value">{{ tab.label }}</button>
          </div>

          <div class="queue-summary" role="status">
            <strong class="tnum">{{ queue.total }}</strong> {{ queue.total === 1 ? 'person' : 'people' }} in this queue
            <span v-if="skipped" class="chip warning">{{ skipped }} opted out, left out</span>
            <span v-if="queue.unreachable" class="chip neutral">{{ queue.unreachable }} can't be reached this way</span>
            <span v-if="draft.id && dirty" class="chip warning">Using your unsaved edits</span>
          </div>
          <p v-if="queue.capped" class="notice warning" role="status"><AppIcon name="alert" :size="18" />One campaign is capped at {{ CAMPAIGN_CAP }} people to keep it manageable. This queue shows the first {{ CAMPAIGN_CAP }} of {{ queue.total }}. Narrow the audience with filters (for example a longer time since their last visit) and cover the rest in another campaign.</p>

          <div v-if="!recipients.length" class="empty compact">
            <span class="empty-icon"><AppIcon name="user" /></span>
            <h3>No one to reach this way</h3>
            <p>{{ sendTab === 'email' ? 'Nobody in this audience has a real email address.' : sendTab === 'csv' ? 'The audience is empty. Adjust the filters above.' : 'Nobody in this audience has a phone number we can open.' }}</p>
          </div>

          <!-- WhatsApp / SMS stepper -->
          <template v-else-if="sendTab === 'whatsapp' || sendTab === 'sms'">
            <div class="progress" role="status">
              <span class="tnum"><strong>{{ openedCount }}</strong> of {{ recipients.length }} opened or marked by you</span>
              <span class="bar" aria-hidden="true"><span :style="{ width: `${(openedCount / recipients.length) * 100}%` }" /></span>
            </div>

            <div v-if="current" class="stepper" data-testid="stepper">
              <p class="step-meta tnum">Person {{ currentIndex + 1 }} of {{ recipients.length }}<span v-if="isOpened(current)" class="chip success">Opened or marked by you</span></p>
              <h3>{{ current.contact.name }}</h3>
              <p class="step-sub">{{ current.stats.lastService ? `Last had ${current.stats.lastService}` : 'No past service' }} · {{ day(current.stats.lastAt) }}</p>
              <p class="preview-text">{{ current.text }}</p>
              <div class="step-actions">
                <a class="primary" :href="current.link" :target="sendTab === 'whatsapp' ? '_blank' : undefined" rel="noopener noreferrer" @click="onOpenLink(current)"><AppIcon :name="sendTab === 'whatsapp' ? 'external' : 'phone'" :size="16" />{{ openLabel }}</a>
                <button class="secondary" type="button" :disabled="currentIndex < 1" @click="back"><AppIcon name="arrow-left" :size="16" />Back</button>
                <button class="secondary" type="button" :disabled="!canSkip" @click="skip">Skip</button>
                <GmHint wrap text="Use this if you already messaged them another way. It only records that you handled them; Bookins cannot tell whether you opened or sent anything." v-slot="{ describedby }">
                  <button class="ghost" type="button" :aria-describedby="describedby" :disabled="isOpened(current)" @click="markWithoutOpening(current)">Mark as opened</button>
                </GmHint>
              </div>
              <p class="field-hint">{{ openLabel }} opens the chat with this message ready. Press send there yourself. Bookins records them as opened by you and moves to the next person. "Mark as opened" records them without opening the link.</p>
            </div>
            <div v-else class="notice success" role="status">
              <AppIcon name="check" :size="18" />
              <div>
                <p><strong>You have opened or marked everyone in this queue.</strong></p>
                <GmButton v-if="savedRecord && savedRecord.status !== 'done'" variant="secondary" size="sm" :disabled-reason="isDemo ? 'Demo is read-only.' : ''" @click="setStatus(savedRecord, 'done')">Mark campaign done</GmButton>
              </div>
            </div>
          </template>

          <!-- Email batches -->
          <template v-else-if="sendTab === 'email'">
            <p class="field-hint">Opens your own mail app with up to {{ EMAIL_BATCH_SIZE }} people in BCC, so nobody sees anyone else's address. It sends from your own address; Bookins does not send it.</p>
            <ul class="batches">
              <li v-for="batch in batches" :key="batch.index" class="batch" :class="{ done: batchOpened(batch) }">
                <div>
                  <strong class="tnum">Batch {{ batch.index }} of {{ batch.total }}</strong>
                  <span class="meta tnum">{{ batch.count }} {{ batch.count === 1 ? 'person' : 'people' }} in BCC</span>
                  <span v-if="batchOpened(batch)" class="chip success">Opened by you</span>
                </div>
                <a v-if="batch.url" class="primary" :href="batch.url" @click="onOpenBatch(batch)"><AppIcon name="mail" :size="16" />Open email app</a>
                <p v-else class="field-error">{{ batch.error }}</p>
              </li>
            </ul>
            <div class="message-preview">
              <p class="preview-label">What each batch says (no names, so it works for everyone)</p>
              <p class="preview-subject"><strong>Subject:</strong> {{ recipients.broadcast.subject }}</p>
              <p class="preview-text">{{ recipients.broadcast.text }}</p>
            </div>
          </template>

          <!-- CSV -->
          <template v-else>
            <p class="field-hint">Download everyone in this audience as a spreadsheet for Mailchimp, Google Contacts or your own mail tool. Opted-out contacts and addresses that are not real emails are never written.</p>
            <p class="field-hint">Columns: name, first_name, email, phone, last_service, last_visit, visits, offer_code, message.</p>
            <div class="form-actions">
              <button class="primary" type="button" @click="exportCsv"><AppIcon name="download" :size="16" />Download CSV ({{ recipients.length }})</button>
            </div>
          </template>

          <!-- Offers + recipient list -->
          <div v-if="offerStats" class="offer-stats" role="status">
            <strong>Offer {{ draft.offerCode }}</strong>
            <span class="tnum">{{ offerStats.offered }} offered (opened or marked by you)</span>
            <span class="tnum">{{ offerStats.redeemed }} redeemed</span>
            <GmHint text="Bookins cannot apply or check a discount. When a client uses the code, press Mark redeemed so you can see who took it up." label="About offer tracking" />
          </div>

          <details v-if="recipients.length && sendTab !== 'csv'" class="recipients">
            <summary>See everyone in this queue ({{ recipients.length }})</summary>
            <ul class="recipient-list">
              <li v-for="(recipient, index) in recipients" :key="recipient.contact.email" :class="{ 'is-current': (sendTab === 'whatsapp' || sendTab === 'sms') && index === currentIndex }">
                <div class="who">
                  <strong class="truncate">{{ recipient.contact.name }}</strong>
                  <span class="faint truncate">{{ recipient.stats.lastService || 'No past service' }}</span>
                </div>
                <div class="status">
                  <span v-if="isOpened(recipient)" class="chip success">Opened by you</span>
                  <span v-else class="chip neutral">Not opened yet</span>
                  <span v-if="recipient.offerCode && recipient.redeemed" class="chip info">Redeemed</span>
                  <span v-else-if="recipient.offerCode && isOpened(recipient)" class="chip accent">Offered</span>
                  <button v-if="sendTab === 'whatsapp' || sendTab === 'sms'" class="ghost small-button" type="button" @click="stepIndex = index">Go to</button>
                  <GmButton v-if="recipient.offerCode && isOpened(recipient) && !recipient.redeemed" variant="secondary" size="sm" :disabled-reason="isDemo ? 'Demo is read-only.' : ''" :pending="redeeming === recipient.contact.email" @click="setRedeemed(recipient, true)">Mark redeemed</GmButton>
                  <GmButton v-else-if="recipient.offerCode && recipient.redeemed" variant="ghost" size="sm" :disabled-reason="isDemo ? 'Demo is read-only.' : ''" :pending="redeeming === recipient.contact.email" @click="setRedeemed(recipient, false)">Undo</GmButton>
                </div>
              </li>
            </ul>
          </details>
        </template>
      </article>
    </div>

    <div v-if="dirty" class="sticky-save-bar" role="status">
      <span>Unsaved changes</span>
      <div class="cluster">
        <GmConfirm
          v-model:open="discardOpen"
          title="Discard unsaved changes?"
          :message="draft.id ? 'Your edits to this campaign will be lost.' : 'This new campaign has not been saved.'"
          confirm-label="Discard changes"
          cancel-label="Keep editing"
          tone="danger"
          @confirm="discardChanges"
        >
          <button class="secondary small" type="button" @click="discardOpen = true">Discard</button>
        </GmConfirm>
        <GmButton size="sm" :pending="saving" pending-label="Saving…" :disabled-reason="saveReason" @click="save">{{ draft.id ? 'Save changes' : 'Save campaign' }}</GmButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.campaigns { display: grid; gap: var(--space-4); }
.campaigns .page-header { margin-bottom: 0; }
.block { min-width: 0; display: grid; gap: var(--space-3); align-content: start; }
.block-head { display: flex; align-items: center; gap: var(--space-2); }
.block-head h2 { margin: 0; display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-lg); }
.block-head .chip { margin-left: auto; }
.block-head h2 + .chip { margin-left: 0; }
.step { width: 26px; height: 26px; display: inline-grid; place-items: center; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-size: var(--text-sm); font-weight: 750; }
.builder { display: grid; gap: var(--space-4); }
.consent p { margin: 0 0 var(--space-2); }
.consent .small-button { margin-top: var(--space-1); }
.faint { color: var(--muted); font-size: var(--text-sm); }
.meta { margin: 4px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); color: var(--ink-soft); font-size: var(--text-sm); }
.campaign-list { margin: 0; padding: 0; display: grid; gap: var(--space-2); list-style: none; }
.campaign-row { padding: var(--space-3); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; }
.campaign-row.is-current { border-color: var(--accent); background: var(--accent-faint, #f7f8ff); }
.campaign-main { min-width: 0; flex: 1 1 260px; }
.campaign-main h3 { margin: 0; font-size: var(--text-md); font-weight: 650; }
.row-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.presets-label { margin: 0; }
.preset-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.chip-button { min-height: var(--control-h-sm); padding: 0 14px; color: var(--ink-soft); border: 1px solid var(--line-strong); border-radius: var(--radius-pill); background: #fff; font-size: var(--text-sm); font-weight: 650; cursor: pointer; transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease); }
.chip-button.on { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.chip-button.var { font-family: var(--font-mono); font-weight: 600; font-size: var(--text-xs); }
.filters { margin: 0; padding: var(--space-4); min-width: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-3) var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-soft, #fafbff); }
.filters .field { margin: 0; min-width: 0; }
.unit-input { display: flex; align-items: center; gap: var(--space-2); }
.unit-input .input { min-width: 0; flex: 1; }
.unit-input span { color: var(--muted); font-size: var(--text-sm); white-space: nowrap; }
.checks { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); }
.check { min-height: var(--control-h-sm); display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); font-weight: 600; cursor: pointer; }
.check input { width: 20px; height: 20px; accent-color: var(--accent); }
.audience-bar { padding: var(--space-3) var(--space-4); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-4); border: 1px solid var(--accent-line, var(--line)); border-radius: var(--radius-sm); background: var(--accent-soft); }
.audience-bar.empty { border-color: var(--line-strong); background: #f1f3f8; }
.audience-bar p { margin: 0; }
.audience-count { display: flex; align-items: baseline; gap: var(--space-2); }
.audience-count strong { font-size: var(--text-2xl); letter-spacing: -0.02em; }
.audience-note { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--ink-soft); font-size: var(--text-sm); }
.audience-bar .ghost { margin-left: auto; }
.table-wrap { max-width: 100%; overflow-x: auto; }
table.preview { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
table.preview th, table.preview td { padding: 10px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; }
table.preview thead th { color: var(--muted); font-size: var(--text-xs); font-weight: 700; white-space: nowrap; }
table.preview tbody th { font-weight: 650; }
table.preview td .chip + .chip { margin-left: 4px; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.is-opted-out { opacity: 0.6; background: #f6f6f9; }
.is-opted-out th { text-decoration: line-through; text-decoration-color: var(--muted); }
.table-foot { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.link-button { min-height: 0; padding: 0; border: 0; background: none; color: var(--accent); font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
.field-label { font-size: var(--text-sm); font-weight: 650; }
.var-chips { margin-top: var(--space-2); display: flex; flex-wrap: wrap; gap: 6px; }
.body-field { min-height: 150px; }
.message-preview { padding: var(--space-4); display: grid; gap: var(--space-2); border: 1px dashed var(--line-strong); border-radius: var(--radius-sm); background: #fbfbff; }
.message-preview p { margin: 0; }
.preview-label { color: var(--muted); font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.preview-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--text-sm); line-height: 1.55; }
.preview-subject { font-size: var(--text-sm); }
.form-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.send-tabs { max-width: 100%; justify-self: start; overflow-x: auto; }
.queue-summary { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); font-size: var(--text-sm); }
.queue-summary strong { font-size: var(--text-lg); }
.progress { display: grid; gap: 6px; font-size: var(--text-sm); }
.progress .bar { height: 6px; border-radius: 999px; background: var(--accent-soft); overflow: hidden; }
.progress .bar span { display: block; height: 100%; background: var(--accent); transition: width var(--dur-panel) var(--ease); }
.stepper { padding: var(--space-4); display: grid; gap: var(--space-2); border: 1px solid var(--accent-line, var(--line)); border-radius: var(--radius); background: #fff; box-shadow: var(--shadow); }
.stepper h3 { margin: 0; font-size: var(--text-xl); }
.stepper p { margin: 0; }
.step-meta { display: flex; align-items: center; gap: var(--space-2); color: var(--muted); font-size: var(--text-sm); }
.step-sub { color: var(--ink-soft); font-size: var(--text-sm); }
.stepper .preview-text { padding: var(--space-3); border-radius: var(--radius-sm); background: #f1f3f8; }
.step-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.step-actions a.primary { min-height: var(--control-h); padding: 0 18px; display: inline-flex; align-items: center; gap: 8px; border-radius: var(--radius-sm); text-decoration: none; }
.batches { margin: 0; padding: 0; display: grid; gap: var(--space-2); list-style: none; }
.batch { padding: var(--space-3); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; }
.batch > div { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.batch.done { background: #f6fbf8; }
.batch a.primary { min-height: var(--control-h-sm); padding: 0 16px; display: inline-flex; align-items: center; gap: 8px; border-radius: var(--radius-sm); text-decoration: none; }
.offer-stats { padding: var(--space-3); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-4); border-radius: var(--radius-sm); background: var(--accent-soft); font-size: var(--text-sm); }
.recipients summary { min-height: var(--control-h-sm); display: flex; align-items: center; color: var(--accent); font-size: var(--text-sm); font-weight: 650; cursor: pointer; }
.recipient-list { margin: var(--space-2) 0 0; padding: 0; display: grid; gap: 6px; list-style: none; }
.recipient-list li { padding: var(--space-2) var(--space-3); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); }
.recipient-list li.is-current { border-color: var(--accent); }
.recipient-list .who { min-width: 0; flex: 1 1 160px; display: grid; }
.recipient-list .status { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
@media (max-width: 700px) {
  .filters { padding: var(--space-3); grid-template-columns: 1fr; }
  .audience-bar .ghost { margin-left: 0; }
  table.preview thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  table.preview, table.preview tbody, table.preview tr, table.preview th, table.preview td { display: block; }
  table.preview tr { padding: var(--space-2) 0; border-bottom: 1px solid var(--line); }
  table.preview th, table.preview td { padding: 3px 0; border: 0; text-align: left; }
  table.preview tbody th { font-size: var(--text-md); }
  table.preview td::before { content: attr(data-label) ': '; color: var(--muted); font-size: var(--text-xs); }
  table.preview td[colspan] { display: block; }
  .row-actions { width: 100%; }
  .step-actions > * { flex: 1 1 auto; justify-content: center; }
}
</style>
