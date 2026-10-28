<script setup lang="ts">
// Campaigns: build an audience from booking history, write one message, then open each message yourself in
// WhatsApp / SMS / your own mail app, or export a CSV. Bookins never sends anything, so the only progress it can
// show is "opened by you". No delivery, open-rate or revenue claims anywhere on this page.
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmConfirm from '../components/ui/GmConfirm.vue'
import GmDatePicker from '../components/ui/GmDatePicker.vue'
import GmDialog from '../components/ui/GmDialog.vue'
import GmHint from '../components/ui/GmHint.vue'
import GmSelect from '../components/ui/GmSelect.vue'
import GmTextSuggest from '../components/ui/GmTextSuggest.vue'
import { formatDay } from '../format-date.ts'
import { isDemo } from '../runtime.ts'
import { useSetupState } from '../setup.ts'
import { ownerTimeZone } from '../time-display.ts'
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
} from '../booking.ts'
import { CAMPAIGN_CAP, EMAIL_BATCH_SIZE, normalizeCampaign } from '../campaigns.ts'
import { DEFAULT_TEMPLATES, gmailComposeUrl } from '../messaging.ts'
import type { CampaignChannel, CampaignFilters, CampaignRecipient, SegmentContact } from '../campaigns.ts'
import { errorMessage } from '../error-message.ts'
import type { LocationQuery } from 'vue-router'

interface CampaignFilterForm {
  serviceContains: string
  categoryContains: string
  lastVisitBeforeDays: string
  lastVisitWithinDays: string
  noVisitSinceDays: string
  visitsAtLeast: string
  noShowsAtLeast: string
  spendAtLeast: string
  staffId: string
  tag: string
  source: string
  neverRebooked: boolean
  newThisMonth: boolean
  dueToRebook: boolean
}
type FilterTextKey = keyof Pick<CampaignFilterForm, 'serviceContains' | 'categoryContains' | 'lastVisitBeforeDays' | 'lastVisitWithinDays' | 'noVisitSinceDays' | 'visitsAtLeast' | 'noShowsAtLeast' | 'spendAtLeast' | 'staffId' | 'tag' | 'source'>
type Preset = (typeof SEGMENT_PRESETS)[number]
type SendTab = Exclude<CampaignChannel, 'any'> | 'csv'
type EmailBatch = ReturnType<typeof emailBatches>[number]

const state = inject<WorkspaceState>('bookingState', { profile: null, schedules: [], services: [], bookings: [], contacts: [], staff: [], campaigns: [] })
const refresh = inject<RefreshWorkspace>('refreshBookings', async () => true)
const toast = inject<ToastApi | null>('toast', null)
const setup = useSetupState()
const route = useRoute()
const router = useRouter()

const zone = computed(() => ownerTimeZone(state.schedules?.[0]?.timezone || state.profile?.timezone))
const campaigns = computed(() => state.campaigns || [])
const teamOn = computed(() => hasTeam(state))
const currency = computed(() => state.services?.find((item) => item.currency)?.currency || 'NGN')

// ---------------------------------------------------------------- consent note (first use)
const CONSENT_TEXT = 'Only message people who agreed to hear from you. Ask for a STOP reply and mark them opted out here.'
const CONSENT_LAW = "Check local rules, e.g. Nigeria's NDPA, with your adviser."

// ---------------------------------------------------------------- draft model
const NUMBER_FIELDS: ReadonlyArray<{ key: FilterTextKey; label: string; unit: string; hint: string }> = [
  { key: 'lastVisitBeforeDays', label: 'Last visit more than', unit: 'days ago', hint: 'Their most recent visit (in the services above, if set) was longer ago than this.' },
  { key: 'lastVisitWithinDays', label: 'Last visit within', unit: 'days', hint: 'Their most recent visit was this recently or sooner. Good for upselling something to people who just came in.' },
  { key: 'noVisitSinceDays', label: 'No visit or booking for', unit: 'days', hint: 'Nothing attended or booked in this many days. Use it to win back lapsed clients.' },
  { key: 'visitsAtLeast', label: 'Visits at least', unit: 'visits', hint: 'A visit is a completed booking, or a confirmed one that has already ended.' },
  { key: 'noShowsAtLeast', label: 'No-shows at least', unit: 'no-shows', hint: 'Bookings you marked No-show in Bookings.' },
  { key: 'spendAtLeast', label: 'Estimated spend at least', unit: '', hint: 'Added up from the display prices of their visits. Bookins does not take payments, so this is an estimate.' },
]
const blankFilters = (): CampaignFilterForm => ({
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
const formFromFilters = (filters: unknown): CampaignFilterForm => {
  const normalized = normalizeFilters(filters)
  return {
    serviceContains: normalized.serviceContains || '', categoryContains: normalized.categoryContains || '',
    lastVisitBeforeDays: normalized.lastVisitBeforeDays == null ? '' : String(normalized.lastVisitBeforeDays),
    lastVisitWithinDays: normalized.lastVisitWithinDays == null ? '' : String(normalized.lastVisitWithinDays),
    noVisitSinceDays: normalized.noVisitSinceDays == null ? '' : String(normalized.noVisitSinceDays),
    visitsAtLeast: normalized.visitsAtLeast == null ? '' : String(normalized.visitsAtLeast),
    noShowsAtLeast: normalized.noShowsAtLeast == null ? '' : String(normalized.noShowsAtLeast),
    spendAtLeast: normalized.spendAtLeast == null ? '' : String(normalized.spendAtLeast),
    staffId: normalized.staffId || '', tag: normalized.tag || '', source: normalized.source || '',
    neverRebooked: normalized.neverRebooked === true, newThisMonth: normalized.newThisMonth === true, dueToRebook: normalized.dueToRebook === true,
  }
}

const defaultTemplate = DEFAULT_TEMPLATES.campaign
const CAMPAIGN_DEFAULT_SUBJECT = 'A note from {{business}}'
const draft = reactive({
  id: '',
  name: '',
  filters: blankFilters(),
  channel: 'whatsapp' as Exclude<CampaignChannel, 'any'>,
  subject: CAMPAIGN_DEFAULT_SUBJECT,
  body: defaultTemplate.body,
  offerText: '',
  offerCode: '',
  offerExpires: '', // YYYY-MM-DD, stored inside the offer text as "Valid until 30 Nov 2026."
})

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const expiryLabel = (iso: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : ''
}
const joinOffer = (text: string, iso: string) => {
  const clean = String(text || '').trim()
  return clean && iso ? `${clean} Valid until ${expiryLabel(iso)}.` : clean
}
function splitOffer(stored: unknown) {
  const match = /\s*Valid until (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\.?$/.exec(String(stored || ''))
  if (!match) return { text: String(stored || '').trim(), expires: '' }
  const month = String(MONTHS.indexOf(match[2] || '') + 1).padStart(2, '0')
  return { text: String(stored).slice(0, match.index).trim(), expires: `${match[3] || ''}-${month}-${String(match[1] || '').padStart(2, '0')}` }
}
const cleanCode = (value: unknown) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40)

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
    subject: CAMPAIGN_DEFAULT_SUBJECT,
    body: defaultTemplate.body,
    offerText: '',
    offerCode: '',
    offerExpires: '',
  })
  baseline.value = snapshot()
}
function loadCampaign(record: CampaignRecord) {
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
  const set = new Set<string>()
  for (const record of state.contacts || []) for (const tag of contactTags(record)) set.add(tag)
  return [...set].sort((a, b) => a.localeCompare(b))
})
const serviceOptions = computed(() => {
  const set = new Set<string>()
  for (const service of state.services || []) {
    if (service.name) set.add(service.name)
    const category = serviceDisplayMeta(service).category
    if (category) set.add(category)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
})
const categoryOptions = computed(() => [...new Set((state.services || []).map((item) => serviceDisplayMeta(item).category).filter(Boolean))].sort())
const staffOptions = computed(() => [
  { value: '', label: 'Anyone' },
  ...teamMembers(state).map((member) => ({ value: String(member.id || ''), label: member.name || 'Team member' })),
])
const sourceOptions = [
  { value: '', label: 'Either way' },
  { value: 'guest', label: 'Booked online' },
  { value: 'owner', label: 'Added by me' },
]

const sameFilters = (a: unknown, b: unknown) => {
  const left = normalizeFilters(a)
  const right = normalizeFilters(b)
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => left[key as keyof CampaignFilters] === right[key as keyof CampaignFilters])
}
const activePreset = computed(() => SEGMENT_PRESETS.find((preset) => sameFilters(preset.filters, draft.filters))?.id || '')
const audienceGroupOptions = computed(() => [{ value: 'all', label: 'All eligible clients' }, ...SEGMENT_PRESETS.map(preset => ({ value: preset.id, label: preset.name })), ...(filterCount.value && !activePreset.value ? [{ value: 'custom', label: 'Custom audience', disabled: true }] : [])])
function chooseAudienceGroup(value: string | number | boolean) {
  if (typeof value !== 'string') return
  if (value === 'all') clearFilters()
  else { const preset = SEGMENT_PRESETS.find(item => item.id === value); if (preset) applyPreset(preset) }
}
const autoName = ref('')
function applyPreset(preset: Preset) {
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

const money = (amount: number) => {
  if (!amount) return '—'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.value, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency.value} ${Math.round(amount).toLocaleString()}`
  }
}
const day = (value: TimestampInput) => (value ? formatDay(value, zone.value) : 'No visit yet')
const optOutReason = (contact: SegmentContact['contact']) => {
  const at = contact.record?.marketing_opt_out_at
  return at ? `Opted out on ${formatDay(at, zone.value)}` : 'Opted out (asked to stop)'
}

// ---------------------------------------------------------------- message
const CHANNELS: Array<{ value: Exclude<CampaignChannel, 'any'>; label: string }> = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
]
const VARIABLES = [
  { name: 'first_name', label: 'First name', hint: "The client's first name." },
  { name: 'last_service', label: 'Last service', hint: 'The service they last had with you.' },
  { name: 'offer', label: 'Offer', hint: 'Your offer text from below.' },
  { name: 'offer_code', label: 'Offer code', hint: 'Your offer code from below.' },
  { name: 'offer_expires', label: 'Offer end date', hint: 'The expiry date from below. Left out when no date is set.' },
  { name: 'business', label: 'Business name', hint: 'Your business name from Settings.' },
  { name: 'booking_link', label: 'Booking link', hint: 'Your public booking link.' },
  { name: 'business_phone', label: 'Business phone', hint: 'The [[wa:...]] number in your bio, if you added one.' },
]
const bodyField = ref<HTMLTextAreaElement | null>(null)
function insertVariable(name: string) {
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
function onCodeInput(event: Event) {
  draft.offerCode = cleanCode((event.target as HTMLInputElement).value)
}

// The campaign object handed to the data layer. {{offer_expires}} is filled here (the data layer leaves it blank),
// and when the template does not place it the expiry is appended to the offer text instead.
const usesExpiryVariable = computed(() => /\{\{\s*offer_expires\s*\}\}/.test(`${draft.subject} ${draft.body}`))
const effectiveSubject = computed(() =>
  draft.subject === defaultTemplate.subject && !draft.offerText.trim() ? CAMPAIGN_DEFAULT_SUBJECT : draft.subject,
)
const effective = computed(() => {
  const expires = expiryLabel(draft.offerExpires)
  const fill = (text: string) => (expires ? text.replace(/\{\{\s*offer_expires\s*\}\}/g, expires) : text)
  return {
    id: draft.id,
    name: draft.name,
    segment: filtersNow.value,
    template: { channel: draft.channel, subject: fill(effectiveSubject.value), body: fill(draft.body) },
    offerText: joinOffer(draft.offerText, usesExpiryVariable.value ? '' : draft.offerExpires),
    offerCode: cleanCode(draft.offerCode),
    created_at: savedRecord.value?.created_at || '',
  }
})
const warnings = computed(() => {
  const list: string[] = []
  if (!dirty.value && !draft.id) return list
  const text = `${draft.subject} ${draft.body}`
  if (/\{\{\s*offer\s*\}\}/.test(text) && !draft.offerText.trim()) list.push('Your message uses {{offer}} but no offer text is set.')
  if (draft.offerExpires && !draft.offerText.trim()) list.push('An expiry date needs offer text to go with it.')
  return list
})
const previewQueue = computed(() => campaignQueue(state, effective.value, 'any', { timezone: zone.value }))
const preview = computed(() => {
  if (draft.channel === 'email') {
    const batch = previewQueue.value.recipients.broadcast
    return { text: batch.text, subject: batch.subject, who: '', batch: true }
  }
  const first = previewQueue.value.recipients[0]
  return first
    ? { text: first.text, subject: first.subject, who: first.contact.name, batch: false }
    : { text: previewQueue.value.recipients.broadcast.text, subject: previewQueue.value.recipients.broadcast.subject, who: '', batch: false }
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
function campaignInput(extra: Partial<CampaignRecord> = {}) {
  return {
    name: draft.name,
    segment: filtersNow.value,
    template: { channel: draft.channel, subject: effectiveSubject.value, body: draft.body },
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
    saveError.value = errorMessage(reason, 'The campaign could not be saved.')
    toast?.error('The campaign could not be saved.')
  } finally {
    saving.value = false
  }
}

// Row menus are <details data-menu>; App.vue closes them on Escape, outside clicks and item clicks.
const rowBusy = ref('')
async function duplicate(record: CampaignRecord) {
  if (isDemo.value || rowBusy.value) return
  rowBusy.value = String(record.id || '')
  try {
    const copy = normalizeCampaign(record)
    await saveCampaign(null, {
      name: `${copy.name} (copy)`,
      segment: copy.filters,
      template: copy.template,
      offerText: copy.offerText,
      offerCode: copy.offerCode,
      status: 'draft',
      audienceCount: Number(record.audience_count) || 0,
    })
    await refresh({ silent: true })
    toast?.success(`Duplicated "${copy.name}". Progress starts fresh for the copy.`)
  } catch (reason) {
    toast?.error(errorMessage(reason, 'The campaign could not be duplicated.'))
  } finally {
    rowBusy.value = ''
  }
}
const deleteTarget = ref('')
async function removeCampaign(record: CampaignRecord) {
  if (isDemo.value || rowBusy.value) return
  rowBusy.value = String(record.id || '')
  try {
    await deleteCampaign(record)
    await refresh({ silent: true })
    if (draft.id === record.id) resetDraft()
    toast?.success(`Deleted "${record.name}". Offers already recorded on contacts are kept.`)
  } catch (reason) {
    toast?.error(errorMessage(reason, 'The campaign could not be deleted.'))
  } finally {
    rowBusy.value = ''
    deleteTarget.value = ''
  }
}
async function setStatus(record: CampaignRecord, status: 'active' | 'done') {
  if (isDemo.value) return
  try {
    await saveCampaign(record, { status })
    await refresh({ silent: true })
    toast?.success(status === 'done' ? `"${record.name}" marked done.` : `"${record.name}" is active again.`)
  } catch (reason) {
    toast?.error(errorMessage(reason, 'The status could not be changed.'))
  }
}

// ---------------------------------------------------------------- unsaved changes
const pendingRoute = ref('')
const allowLeave = ref(false)
const builderEl = ref<HTMLElement | null>(null)
const builderOpen = ref(false)
const builderStep = ref(1)
const closeAfterDiscard = ref(false)
const stepTitle = computed(() => ['Choose who', 'Write the message', 'Review and reach out'][builderStep.value - 1])
const nextReason = computed(() => {
  if (builderStep.value === 1 && !draft.name.trim()) return 'Give the campaign a name first.'
  if (builderStep.value === 1 && !segment.value.total) return 'Choose an audience with at least one person.'
  if (builderStep.value === 2 && !draft.body.trim()) return 'Write the message first.'
  return ''
})
const STEPS = ['Audience', 'Message', 'Review'] as const
const scrollToBuilder = () => nextTick(() => builderEl.value?.querySelector('.builder-body')?.scrollTo({ top: 0, behavior: 'smooth' }))
function startNew() {
  resetDraft()
  builderStep.value = 1
  builderOpen.value = true
  scrollToBuilder()
}
function editCampaign(record: CampaignRecord) {
  loadCampaign(record)
  builderStep.value = 1
  builderOpen.value = true
  scrollToBuilder()
}
const discardOpen = ref(false)
function discardChanges() {
  discardOpen.value = false
  if (savedRecord.value) loadCampaign(savedRecord.value)
  else resetDraft()
  if (closeAfterDiscard.value) builderOpen.value = false
  closeAfterDiscard.value = false
  const nextRoute = pendingRoute.value
  pendingRoute.value = ''
  if (nextRoute) {
    allowLeave.value = true
    router.push(nextRoute)
  }
}
function requestCloseBuilder() {
  if (saving.value) return
  if (dirty.value) {
    closeAfterDiscard.value = true
    discardOpen.value = true
    return
  }
  builderOpen.value = false
}
function nextStep() {
  if (nextReason.value) return
  builderStep.value = Math.min(3, builderStep.value + 1)
  scrollToBuilder()
}
function previousStep() {
  builderStep.value = Math.max(1, builderStep.value - 1)
  scrollToBuilder()
}
onBeforeRouteLeave((to) => {
  if (allowLeave.value) {
    allowLeave.value = false
    return true
  }
  if (!dirty.value) return true
  pendingRoute.value = to.fullPath
  discardOpen.value = true
  return false
})
const onBeforeUnload = (event: BeforeUnloadEvent) => {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

// Deep links: /campaigns?preset=due-rebook, ?tag=VIP, ?service=Braids, ?campaign=<id>
function applyQuery(query: LocationQuery) {
  if (!query || !Object.keys(query).length) return
  if (query.campaign) {
    const record = campaigns.value.find((item) => item.id === query.campaign)
    if (record) editCampaign(record)
  } else if (query.preset || query.tag || query.service) {
    resetDraft()
    const preset = SEGMENT_PRESETS.find((item) => item.id === query.preset)
    if (preset) applyPreset(preset)
    if (query.tag) draft.filters.tag = String(query.tag)
    if (query.service) draft.filters.serviceContains = String(query.service)
    if (!draft.name.trim()) draft.name = query.tag ? `Clients tagged ${query.tag}` : query.service ? `${query.service} clients` : ''
    baseline.value = snapshot()
    builderStep.value = 1
    builderOpen.value = true
  }
  router.replace({ path: route.path, query: {} })
  scrollToBuilder()
}
onMounted(() => applyQuery(route.query))
watch(() => route.query, (query) => applyQuery(query))

// ---------------------------------------------------------------- send: assisted queue
const SEND_TABS: Array<{ value: SendTab; label: string; open?: string }> = [
  { value: 'whatsapp', label: 'WhatsApp', open: 'Open WhatsApp' },
  { value: 'sms', label: 'SMS', open: 'Open SMS' },
  { value: 'email', label: 'Email' },
  { value: 'csv', label: 'Export CSV' },
]
const sendTab = ref<SendTab>('whatsapp')
watch(() => draft.channel, value => { sendTab.value = value })
const sessionOpened = reactive(new Set<string>())
const stepIndex = ref(-1)
const touched = new Set<string>()
watch(
  () => draft.id,
  () => {
    sessionOpened.clear()
    stepIndex.value = -1
    sendTab.value = draft.channel
  },
  { immediate: true },
)
const sendChannel = computed<CampaignChannel>(() => (sendTab.value === 'csv' ? 'any' : sendTab.value))
const queue = computed(() => (draft.id ? campaignQueue(state, effective.value, sendChannel.value, { timezone: zone.value }) : null))
const emptyRecipients = Object.assign([] as CampaignRecipient[], { broadcast: { subject: '', text: '' } })
const recipients = computed(() => queue.value?.recipients || emptyRecipients)
const queueView = computed(() => queue.value || { total: 0, optedOut: 0, unreachable: 0, capped: false })
const setSendTab = (value: string | number | boolean) => {
  if (value === 'whatsapp' || value === 'sms' || value === 'email' || value === 'csv') sendTab.value = value
}
const isOpened = (recipient: CampaignRecipient) => Boolean(recipient.openedAt) || sessionOpened.has(recipient.contact.email)
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
function persistOpened(items: CampaignRecipient[]) {
  const record = savedRecord.value
  if (isDemo.value || !record) return Promise.resolve()
  writeChain = writeChain
    .then(async () => {
      const recordId = String(record.id || '')
      if (!touched.has(recordId)) {
        touched.add(recordId)
        await touchCampaign(record)
        if (record.status === 'draft') await saveCampaign(record, { status: 'active' })
      }
      for (const item of items) await markCampaignRecipientOpened({ email: item.contact.email, name: item.contact.name, phone: item.contact.phone, record: item.contact.record }, { ...record, offer_code: effective.value.offerCode })
      await refresh({ silent: true })
    })
    .catch((reason) => {
      toast?.error(errorMessage(reason, 'Could not remember who you opened. You can keep going; progress may reset after a refresh.'))
    })
  return writeChain
}
function advanceFrom(index: number) {
  const list = recipients.value
  const next = list.findIndex((item, position) => position > index && !isOpened(item))
  stepIndex.value = next
}
function onOpenLink(recipient: CampaignRecipient) {
  const index = recipients.value.indexOf(recipient)
  sessionOpened.add(recipient.contact.email)
  advanceFrom(index)
  persistOpened([recipient])
}
function markWithoutOpening(recipient: CampaignRecipient) {
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
    const candidate = list[index]
    if (candidate && !isOpened(candidate)) {
      stepIndex.value = index
      return
    }
  }
}
const back = () => {
  if (currentIndex.value > 0) stepIndex.value = currentIndex.value - 1
}

const batches = computed(() => (sendTab.value === 'email' ? emailBatches(recipients.value) : []))
const gmailFor = (mailto: string) => gmailComposeUrl(mailto)
const batchRecipients = (batch: EmailBatch): CampaignRecipient[] => batch.emails.map((email) => recipients.value.find((item) => item.contact.email.toLowerCase() === email)).filter((item): item is CampaignRecipient => Boolean(item))
const batchOpened = (batch: EmailBatch) => batchRecipients(batch).length > 0 && batchRecipients(batch).every(isOpened)
function onOpenBatch(batch: EmailBatch) {
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
async function setRedeemed(recipient: CampaignRecipient, redeemed: boolean) {
  if (isDemo.value || redeeming.value) return
  redeeming.value = recipient.contact.email
  try {
    await recordOffer({ email: recipient.contact.email, name: recipient.contact.name, phone: recipient.contact.phone, record: recipient.contact.record }, { code: recipient.offerCode, status: redeemed ? 'redeemed' : 'offered' })
    await refresh({ silent: true })
    toast?.success(redeemed ? `${recipient.contact.name} marked as redeemed. Honour the offer by hand when they book.` : `${recipient.contact.name} set back to offered.`)
  } catch (reason) {
    toast?.error(errorMessage(reason, 'The offer could not be updated.'))
  } finally {
    redeeming.value = ''
  }
}

// ---------------------------------------------------------------- list
const statusLabel: Record<string, string> = { draft: 'Draft', active: 'Active', done: 'Done' }
const statusClass: Record<string, string> = { draft: 'neutral', active: 'success', done: 'info' }
const campaignStatusLabel = (record: CampaignRecord) => statusLabel[String(record.status || '')] || 'Draft'
const campaignStatusClass = (record: CampaignRecord) => statusClass[String(record.status || '')] || 'neutral'
// Cached per workspace data (not per keystroke): one audience pass per saved campaign.
const audienceCounts = computed(() => new Map(campaigns.value.map((record) => [record.id, segmentContacts(state, normalizeFilters(record.segment_json), { timezone: zone.value }).total])))
const liveAudience = (record: CampaignRecord) => audienceCounts.value.get(record.id) ?? 0
const lastOpened = (record: CampaignRecord) => (record.last_opened_at ? formatDay(record.last_opened_at, zone.value) : '')
const defaultPreset = SEGMENT_PRESETS[0]
const activePresetDescription = computed(() => SEGMENT_PRESETS.find((item) => item.id === activePreset.value)?.description || '')

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
    <header class="page-header">
      <div>
        <h1>Campaigns</h1>
        <p class="lede">Choose clients from your booking history, write one message, then open it for each person in your own WhatsApp, SMS or mail app. Bookins does not send anything.</p>
      </div>
      <GmButton :variant="campaigns.length ? 'primary' : 'secondary'" data-tour="tour-campaigns-builder" @click="startNew"><template #leading><AppIcon name="plus" :size="18" /></template>New campaign</GmButton>
    </header>

    <!-- Saved campaigns -->
    <section aria-labelledby="saved-heading">
      <h2 id="saved-heading" class="list-title">Your campaigns <span v-if="campaigns.length" class="count-pill tnum">{{ campaigns.length }}</span></h2>
      <ul v-if="campaigns.length" class="ledger campaign-list">
        <li v-for="record in campaigns" :key="record.id" class="campaign-row" :class="{ 'is-current': draft.id === record.id && builderOpen }">
          <div class="campaign-main">
            <h3 class="truncate">{{ record.name }}</h3>
            <p class="meta tnum">
              <span class="chip" :class="campaignStatusClass(record)">{{ campaignStatusLabel(record) }}</span>
              <span>{{ liveAudience(record) }} {{ liveAudience(record) === 1 ? 'client' : 'clients' }} match today</span>
              <span v-if="Number(record.audience_count) && Number(record.audience_count) !== liveAudience(record)" class="faint">{{ record.audience_count }} when saved</span>
              <span v-if="lastOpened(record)" class="faint">Last opened by you {{ lastOpened(record) }}</span>
            </p>
          </div>
          <div class="row-actions">
            <button class="secondary small" type="button" :aria-label="`Open ${record.name}`" @click="editCampaign(record)">Open</button>
            <details class="menu" data-menu>
              <summary class="ghost small-button icon-summary" :aria-label="`More actions for ${record.name}`"><AppIcon name="more" :size="18" /></summary>
              <div class="menu-panel">
                <GmButton variant="ghost" size="sm" :disabled-reason="isDemo ? 'Demo is read-only. Exit Demo to duplicate campaigns.' : ''" :pending="rowBusy === record.id" @click="duplicate(record)"><template #leading><AppIcon name="copy" :size="16" /></template>Duplicate</GmButton>
                <GmButton v-if="record.status === 'done'" variant="ghost" size="sm" :disabled-reason="isDemo ? 'Demo is read-only.' : ''" @click="setStatus(record, 'active')">Reopen</GmButton>
                <GmButton v-else-if="record.status === 'active'" variant="ghost" size="sm" :disabled-reason="isDemo ? 'Demo is read-only.' : ''" @click="setStatus(record, 'done')">Mark done</GmButton>
                <GmConfirm
                  :open="deleteTarget === record.id"
                  title="Delete this campaign?"
                  :message="`&quot;${record.name}&quot; will be removed. Offers already recorded on contacts are kept.`"
                  confirm-label="Delete campaign"
                  tone="danger"
                  :busy="rowBusy === record.id"
                  @update:open="deleteTarget = $event ? String(record.id || '') : ''"
                  @confirm="removeCampaign(record)"
                >
                  <GmButton variant="ghost" size="sm" :disabled-reason="isDemo ? 'Demo is read-only. Exit Demo to delete campaigns.' : ''" @click="deleteTarget = String(record.id || '')"><template #leading><AppIcon name="trash" :size="16" /></template>Delete</GmButton>
                </GmConfirm>
              </div>
            </details>
          </div>
        </li>
      </ul>
      <div v-else class="empty">
        <h3>No campaigns yet</h3>
        <p>A campaign is a saved group of clients plus a message. {{ hasHistory ? 'Start with a ready-made group, like clients who are due to rebook.' : 'Once clients have booked with you, you can message them from here.' }}</p>
        <div class="empty-actions">
          <button v-if="hasHistory && defaultPreset" class="primary" type="button" @click="startNew(); defaultPreset && applyPreset(defaultPreset)">Start with "{{ defaultPreset.name }}"</button>
          <template v-else>
            <button v-if="setup.hasLink" class="primary" type="button" @click="copyBookingLink">Copy your booking link</button>
            <RouterLink v-else class="primary" :to="setup.nextStep.to">{{ setup.nextStep.label }}</RouterLink>
          </template>
        </div>
      </div>
    </section>

    <!-- Guided builder -->
    <GmDialog
      :open="builderOpen"
      :title="`${draft.id ? 'Edit' : 'New'} campaign: ${stepTitle}`"
      variant="wide"
      content-class="campaign-dialog"
      :busy="saving"
      @update:open="$event || requestCloseBuilder()"
    >
    <div ref="builderEl" class="builder" data-tour="tour-campaigns-builder">
      <header class="builder-head">
        <div class="builder-title">
          <h2>{{ draft.id ? draft.name || 'Edit campaign' : 'New campaign' }}</h2>
          <ol class="builder-steps" aria-label="Campaign steps">
            <li v-for="(label, index) in STEPS" :key="label" :class="{ active: builderStep === index + 1, done: builderStep > index + 1 }" :aria-current="builderStep === index + 1 ? 'step' : undefined">{{ label }}</li>
          </ol>
        </div>
        <GmConfirm
          v-model:open="discardOpen"
          title="Discard unsaved changes?"
          :message="draft.id ? 'Your edits to this campaign will be lost.' : 'This new campaign has not been saved.'"
          confirm-label="Discard changes"
          cancel-label="Keep editing"
          tone="danger"
          @confirm="discardChanges"
          @cancel="closeAfterDiscard = false; pendingRoute = ''"
        >
          <button class="icon-button" type="button" aria-label="Close campaign" :disabled="saving" @click="requestCloseBuilder"><AppIcon name="close" /></button>
        </GmConfirm>
      </header>

      <div class="builder-body">
      <div class="builder-main">

      <!-- 1. Audience -->
      <section v-if="builderStep === 1" class="block" aria-labelledby="audience-heading">
        <div class="block-head">
          <h3 id="audience-heading">Choose who</h3>
          <GmHint text="Everything here is worked out in your browser from your bookings and contacts. Cancelled bookings and time off are ignored. Opted-out contacts are always left out." label="How audiences work" />
        </div>
        <div class="field">
          <label for="campaign-name">Campaign name <span class="optional">(only you see it)</span></label>
          <input id="campaign-name" v-model="draft.name" class="input" maxlength="120" placeholder="Bring back lapsed clients" autocomplete="off" />
        </div>

        <div v-if="!hasHistory" class="empty compact">
          <h4>No clients to message yet</h4>
          <p>Campaigns are built from the people who have booked with you. Share your booking link, and once clients book they will appear here.</p>
          <button v-if="setup.hasLink" class="primary" type="button" @click="copyBookingLink">Copy your booking link</button>
          <RouterLink v-else class="primary" :to="setup.nextStep.to">{{ setup.nextStep.label }}</RouterLink>
        </div>

        <template v-else>
          <div class="field"><label for="audience-group">Client group</label><GmSelect id="audience-group" :model-value="activePreset || (filterCount ? 'custom' : 'all')" :options="audienceGroupOptions" label="Client group" @update:model-value="chooseAudienceGroup" /></div>
          <p v-if="activePreset" class="field-hint">{{ activePresetDescription }}</p>

          <details class="advanced-section">
            <summary>Audience filters <span v-if="filterCount" class="count-pill">{{ filterCount }}</span><span v-else class="summary-note">Optional</span></summary>
          <fieldset class="filters">
            <legend class="visually-hidden">Audience filters</legend>
            <div class="field">
              <label for="f-service">Past service contains <GmHint text="Matches the name of any service they booked, or its category. Other filters then look only at those visits." label="About the service filter" /></label>
              <GmTextSuggest id="f-service" v-model="draft.filters.serviceContains" class="input" :options="serviceOptions" label="Past service contains" placeholder="e.g. braids" autocomplete="off" />
            </div>
            <div class="field">
              <label for="f-category">Category contains</label>
              <GmTextSuggest id="f-category" v-model="draft.filters.categoryContains" class="input" :options="categoryOptions" label="Category contains" placeholder="e.g. Nails" autocomplete="off" />
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
              <GmSelect id="f-staff" v-model="draft.filters.staffId" :options="staffOptions" label="Filter by team member" />
            </div>
            <div class="field">
              <label for="f-tag">Tag <GmHint text="One of your own tags from Contacts, such as VIP." label="About the tag filter" /></label>
              <GmTextSuggest id="f-tag" v-model="draft.filters.tag" class="input" :options="tagOptions" label="Tag" placeholder="Any tag" autocomplete="off" />
            </div>
            <div class="field">
              <label for="f-source">Booked how <GmHint text="Whether their first booking came from your public booking page or was added by you." label="About the source filter" /></label>
              <GmSelect id="f-source" v-model="draft.filters.source" :options="sourceOptions" label="Filter by how the client booked" />
            </div>
            <div class="checks">
              <label class="check"><input v-model="draft.filters.dueToRebook" type="checkbox" /> Due to rebook <GmHint text="Their last visit was longer ago than the 'rebook after' days you set on that service. Set it in Services." label="About due to rebook" /></label>
              <label class="check"><input v-model="draft.filters.neverRebooked" type="checkbox" /> Only ever booked once <GmHint text="Clients with exactly one booking: they came, but never came back." label="About never rebooked" /></label>
              <label class="check"><input v-model="draft.filters.newThisMonth" type="checkbox" /> New this month <GmHint text="Their first booking was made this calendar month. A nice fit for a thank-you." label="About new this month" /></label>
            </div>
          </fieldset>
          </details>

          <div class="audience-inline">
            <p class="tnum"><strong>{{ segment.total }}</strong> {{ segment.total === 1 ? 'client' : 'clients' }} match<template v-if="filterCount">, {{ filterCount }} {{ filterCount === 1 ? 'filter' : 'filters' }} on</template></p>
            <button v-if="filterCount" class="link-button" type="button" @click="clearFilters">Clear filters</button>
          </div>

          <details v-if="segment.total || segment.optedOut.length" class="audience-preview"><summary>See who matches ({{ segment.total }})</summary>
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
          </details>
          <div v-if="!segment.total && !segment.optedOut.length" class="empty compact">
            <h4>No one matches these filters</h4>
            <p>Try fewer filters or a wider time window.</p>
            <button v-if="filterCount" class="secondary" type="button" @click="clearFilters">Clear filters</button>
          </div>
        </template>
      </section>

      <!-- 2. Message -->
      <section v-if="builderStep === 2" class="block" aria-labelledby="message-heading">
        <div class="block-head">
          <h3 id="message-heading">Write the message</h3>
        </div>

        <div class="field">
          <label for="campaign-channel">Main channel <GmHint text="Where you plan to reach people first. You can still choose a different way when you reach out." label="About the main channel" /></label>
          <GmSelect id="campaign-channel" v-model="draft.channel" :options="CHANNELS" label="Main channel" />
        </div>

        <div v-if="draft.channel === 'email'" class="field">
          <label for="campaign-subject">Subject</label>
          <input id="campaign-subject" v-model="draft.subject" class="input" maxlength="300" />
        </div>
        <div class="field">
          <label for="campaign-body">Message <GmHint text="Click a variable below to drop it into your message. Each person's own details are filled in when you open their message. Email batches use a name-free version." label="About the message" /></label>
          <textarea id="campaign-body" ref="bodyField" v-model="draft.body" class="body-field" maxlength="2000" rows="7"></textarea>
          <div class="var-chips" role="group" aria-label="Insert a personal detail">
            <span class="var-label">Insert</span>
            <button v-for="variable in VARIABLES" :key="variable.name" class="chip-button" type="button" :title="variable.hint" :aria-label="`Insert ${variable.label}`" @click="insertVariable(variable.name)">{{ variable.label }}</button>
          </div>
          <p class="field-hint">A "Reply STOP to opt out" line is always added if your message does not already have one.</p>
        </div>

        <details class="advanced-section offer-section" :open="Boolean(draft.offerText || draft.offerCode || draft.offerExpires) || undefined">
          <summary>Offer details <span class="summary-note">Optional</span></summary>
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
            <GmDatePicker id="offer-expires" v-model="draft.offerExpires" label="Offer expiry date" />
          </div>
        </div>
        <p class="field-hint">Offers are words only. Bookins cannot apply a discount for you, so you honour it by hand when the client books.</p>
        </details>
        <p v-for="warning in warnings" :key="warning" class="notice warning" role="status"><AppIcon name="alert" :size="18" />{{ warning }}</p>
      </section>

      <!-- 3. Review and reach out -->
      <section v-if="builderStep === 3" class="block" aria-labelledby="reach-heading">
        <div class="block-head">
          <h3 id="reach-heading">Review and reach out</h3>
          <GmHint :text="`${CONSENT_TEXT} ${CONSENT_LAW}`" label="About consent" />
        </div>
        <dl class="review-summary">
          <div><dt>Campaign</dt><dd>{{ draft.name }}</dd></div>
          <div><dt>Audience</dt><dd class="tnum">{{ segment.total }} {{ segment.total === 1 ? 'client' : 'clients' }}</dd></div>
          <div><dt>Main channel</dt><dd>{{ CHANNELS.find((option) => option.value === draft.channel)?.label }}</dd></div>
        </dl>
        <p v-if="saveError" class="notice error" role="alert"><AppIcon name="alert" :size="18" />{{ saveError }}</p>

        <div v-if="!draft.id" class="empty compact">
          <h4>Save to start reaching clients</h4>
          <p>Saving lets Bookins remember whose message you have opened.</p>
        </div>

        <template v-else>
          <div class="reach-intro">
            <h4>Reach your clients</h4>
            <p>Open each message in your own app and press send there. Bookins records what you opened, not what you sent.</p>
          </div>
          <div class="field reach-way">
            <label for="reach-way">Reach them by</label>
            <GmSelect id="reach-way" :model-value="sendTab" :options="SEND_TABS" label="Reach them by" @update:model-value="setSendTab" />
          </div>

          <div class="queue-summary" role="status">
            <strong class="tnum">{{ queueView.total }}</strong> {{ queueView.total === 1 ? 'client' : 'clients' }} in this queue
            <span v-if="skipped" class="chip warning">{{ skipped }} opted out, left out</span>
            <span v-if="queueView.unreachable" class="chip neutral">{{ queueView.unreachable }} can't be reached this way</span>
            <span v-if="draft.id && dirty" class="chip warning">Using your unsaved edits</span>
          </div>
          <p v-if="queueView.capped" class="notice warning" role="status"><AppIcon name="alert" :size="18" />One campaign is capped at {{ CAMPAIGN_CAP }} people to keep it manageable. This queue shows the first {{ CAMPAIGN_CAP }} of {{ queueView.total }}. Narrow the audience with filters (for example a longer time since their last visit) and cover the rest in another campaign.</p>

          <div v-if="!recipients.length" class="empty compact">
            <h4>No one to reach this way</h4>
            <p>{{ sendTab === 'email' ? 'Nobody in this audience has a real email address.' : sendTab === 'csv' ? 'The audience is empty. Adjust the filters above.' : 'Nobody in this audience has a phone number we can open.' }}</p>
          </div>

          <!-- WhatsApp / SMS stepper -->
          <template v-else-if="sendTab === 'whatsapp' || sendTab === 'sms'">
            <div class="progress" role="status">
              <span class="tnum"><strong>{{ openedCount }}</strong> of {{ recipients.length }} opened or marked by you</span>
              <span class="bar" aria-hidden="true"><span :style="{ width: `${(openedCount / recipients.length) * 100}%` }" /></span>
            </div>

            <div v-if="current" class="stepper" data-testid="stepper">
              <p class="step-meta tnum">Client {{ currentIndex + 1 }} of {{ recipients.length }}<span v-if="isOpened(current)" class="chip success">Opened or marked by you</span></p>
              <h4>{{ current.contact.name }}</h4>
              <p class="step-sub">{{ current.stats.lastService ? `Last had ${current.stats.lastService}` : 'No past service' }}, {{ day(current.stats.lastAt) }}</p>
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
            <p class="field-hint">Choose Gmail or this device's mail app. Both open a draft with up to {{ EMAIL_BATCH_SIZE }} people in BCC, so nobody sees anyone else's address. It sends from your own address; Bookins does not send it.</p>
            <ul class="batches">
              <li v-for="batch in batches" :key="batch.index" class="batch" :class="{ done: batchOpened(batch) }">
                <div>
                  <strong class="tnum">Batch {{ batch.index }} of {{ batch.total }}</strong>
                  <span class="meta tnum">{{ batch.count }} {{ batch.count === 1 ? 'person' : 'people' }} in BCC</span>
                  <span v-if="batchOpened(batch)" class="chip success">Opened by you</span>
                </div>
                <div v-if="batch.url" class="batch-actions">
                  <a class="primary" :href="batch.url" @click="onOpenBatch(batch)"><AppIcon name="mail" :size="16" />Open mail app</a>
                  <a class="secondary" :href="gmailFor(batch.url)" target="_blank" rel="noopener noreferrer" @click="onOpenBatch(batch)"><AppIcon name="external" :size="16" />Open Gmail</a>
                </div>
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
      </section>
      </div>

      <aside class="builder-aside" aria-label="Audience and preview">
        <div class="aside-block" role="status" aria-live="polite">
          <p class="aside-label">Audience</p>
          <p class="aside-count tnum"><strong>{{ segment.total }}</strong> {{ segment.total === 1 ? 'client' : 'clients' }}</p>
          <p v-if="activePreset" class="aside-note">{{ audienceGroupOptions.find((option) => option.value === activePreset)?.label }}</p>
          <p v-else-if="filterCount" class="aside-note">Custom, {{ filterCount }} {{ filterCount === 1 ? 'filter' : 'filters' }}</p>
          <p v-else class="aside-note">All eligible clients</p>
          <ul class="aside-facts tnum">
            <li v-if="segment.optedOut.length">{{ segment.optedOut.length }} opted out, always left out</li>
            <li v-if="segment.unreachable">{{ segment.unreachable }} with no phone or real email</li>
          </ul>
        </div>
        <div class="aside-block message-preview">
          <p class="aside-label"><template v-if="preview.batch">Email batch preview, no names</template><template v-else>Preview<template v-if="preview.who"> for {{ preview.who }}</template></template></p>
          <p v-if="draft.channel === 'email'" class="preview-subject"><strong>Subject:</strong> {{ preview.subject }}</p>
          <p class="preview-text">{{ preview.text }}</p>
          <p v-if="!preview.who && !preview.batch" class="aside-note">No one to preview yet. Details are filled in per client.</p>
        </div>
        <p class="aside-consent">{{ CONSENT_TEXT }} {{ CONSENT_LAW }}</p>
      </aside>
      </div>

      <footer class="builder-nav">
        <button v-if="builderStep > 1" class="secondary" type="button" @click="previousStep"><AppIcon name="arrow-left" :size="16" />Back</button>
        <span v-else />
        <div class="builder-next">
          <GmButton v-if="builderStep < 3" :disabled-reason="nextReason" reason-visible @click="nextStep">Next<template #trailing><AppIcon name="chevron" :size="15" /></template></GmButton>
          <GmButton v-else :pending="saving" pending-label="Saving…" :disabled-reason="saveReason" reason-visible @click="save">{{ draft.id ? 'Save changes' : 'Save campaign' }}</GmButton>
        </div>
      </footer>
    </div>
    </GmDialog>
  </section>
</template>

<style scoped>
.campaigns { display: grid; gap: var(--space-4); }
.campaigns .page-header { margin-bottom: 0; }
.list-title { margin: 0 0 var(--space-3); display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-md); }
.block { min-width: 0; display: grid; gap: var(--space-3); align-content: start; }
.block > .field { margin-bottom: 0; }
.block-head { display: flex; align-items: center; gap: var(--space-2); }
.block-head h3 { margin: 0; font-size: var(--text-lg); }
.block :is(h4) { margin: 0; font-size: var(--text-md); }
.optional { color: var(--muted); font-weight: var(--weight-medium); }

/* Builder: a wide dialog with the step on the left and the audience and preview on the right. */
.builder { height: 100%; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: var(--surface); }
.builder-head { padding: var(--space-4) var(--space-5); display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); border-bottom: 1px solid var(--line); }
.builder-title { min-width: 0; display: grid; gap: var(--space-2); }
.builder-head h2 { margin: 0; font-size: var(--text-xl); overflow-wrap: anywhere; }
.builder-steps { margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); list-style: none; counter-reset: step; }
.builder-steps li { min-height: 28px; display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: var(--text-sm); font-weight: var(--weight-medium); counter-increment: step; }
.builder-steps li::before { content: counter(step); width: 22px; height: 22px; display: grid; place-items: center; border: 1px solid var(--line-strong); border-radius: 50%; font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.builder-steps li.active { color: var(--ink); font-weight: var(--weight-strong); }
.builder-steps li.active::before { color: #fff; border-color: var(--accent); background: var(--accent); }
.builder-steps li.done { color: var(--ink-soft); }
.builder-steps li.done::before { color: var(--accent); border-color: var(--accent-line); background: var(--accent-soft); }
.builder-body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: grid; grid-template-columns: minmax(0, 1fr) 340px; align-items: start; }
.builder-main { min-width: 0; padding: var(--space-5); }
.builder-aside { position: sticky; top: 0; min-height: 100%; padding: var(--space-5); display: grid; gap: var(--space-4); align-content: start; border-left: 1px solid var(--line); background: var(--surface-soft); }
.aside-block { display: grid; gap: var(--space-1); }
.aside-block p { margin: 0; }
.aside-label { color: var(--muted); font-size: var(--text-xs); font-weight: var(--weight-strong); }
.aside-count { font-size: var(--text-md); }
.aside-count strong { font-size: var(--text-2xl); letter-spacing: -0.02em; }
.aside-note { color: var(--ink-soft); font-size: var(--text-sm); }
.aside-facts { margin: var(--space-1) 0 0; padding: 0; display: grid; gap: 2px; color: var(--ink-soft); list-style: none; font-size: var(--text-sm); }
.aside-consent { margin: 0; padding-top: var(--space-3); color: var(--muted); border-top: 1px solid var(--line); font-size: var(--text-xs); line-height: 1.55; }
.builder-nav { padding: var(--space-3) var(--space-5) max(var(--space-3), env(safe-area-inset-bottom)); display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); border-top: 1px solid var(--line); background: var(--surface); }
.builder-nav > :first-child { flex: none; }
/* Next or Save stays on the right with its reason beside it, so the footer has two sides. */
.builder-next { min-width: 0; display: flex; flex-direction: row-reverse; align-items: center; gap: var(--space-3); }
.builder-next :deep(.gm-button) { flex: none; white-space: nowrap; }
.builder-next :deep(.gm-button__reason) { min-width: 0; margin: 0; text-align: right; }
.faint { color: var(--muted); font-size: var(--text-sm); }
.meta { margin: 4px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); color: var(--ink-soft); font-size: var(--text-sm); }
.campaign-row { padding: var(--space-3) var(--space-4); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
.campaign-row.is-current { box-shadow: inset 4px 0 0 var(--accent); }
.campaign-main { min-width: 0; flex: 1 1 260px; }
.campaign-main h3 { margin: 0; font-size: var(--text-md); font-weight: var(--weight-strong); }
.row-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.icon-summary { width: var(--control-h-sm); padding: 0; display: inline-flex; align-items: center; justify-content: center; }
.chip-button { min-height: 36px; padding: 0 12px; color: var(--ink-soft); border: 1px solid var(--line-strong); border-radius: var(--radius-pill); background: var(--surface); font-size: var(--text-sm); font-weight: var(--weight-medium); cursor: pointer; transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease); }
.chip-button:hover { color: var(--accent); border-color: var(--accent-line); background: var(--accent-faint); }
.filters { margin: 0; padding: var(--space-4); min-width: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-3) var(--space-4); border: 0; border-top: 1px solid var(--line); background: var(--surface); }
.filters .field { margin: 0; min-width: 0; }
.unit-input { display: flex; align-items: center; gap: var(--space-2); }
.unit-input .input { min-width: 0; flex: 1; }
.unit-input span { color: var(--muted); font-size: var(--text-sm); white-space: nowrap; }
.checks { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); }
.check { min-height: var(--control-h-sm); display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); font-weight: var(--weight-medium); cursor: pointer; }
.check input { width: 20px; height: 20px; accent-color: var(--accent); }
.audience-inline { display: none; align-items: center; justify-content: space-between; gap: var(--space-3); font-size: var(--text-sm); }
.audience-inline p { margin: 0; }
.audience-inline strong { font-size: var(--text-lg); }
.table-wrap { max-width: 100%; overflow-x: auto; }
table.preview { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
table.preview th, table.preview td { padding: 10px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; }
table.preview thead th { color: var(--muted); font-size: var(--text-xs); font-weight: var(--weight-strong); white-space: nowrap; }
table.preview tbody th { font-weight: var(--weight-strong); }
table.preview td .chip + .chip { margin-left: 4px; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.is-opted-out { color: var(--muted); background: var(--surface-soft); }
.is-opted-out th { text-decoration: line-through; text-decoration-color: var(--muted); }
.table-foot { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.var-chips { margin-top: var(--space-2); display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.var-label { margin-right: 2px; color: var(--muted); font-size: var(--text-xs); font-weight: var(--weight-strong); }
.body-field { min-height: 150px; }
.message-preview { display: grid; gap: var(--space-2); }
.message-preview p { margin: 0; }
.message-preview .preview-text { padding: var(--space-3); border: 1px solid var(--line); border-radius: 4px 12px 12px 12px; background: var(--surface); }
.preview-label { color: var(--muted); font-size: var(--text-xs); font-weight: var(--weight-strong); }
.preview-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--text-sm); line-height: 1.55; }
.preview-subject { font-size: var(--text-sm); }
.form-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.queue-summary { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); font-size: var(--text-sm); }
.queue-summary strong { font-size: var(--text-lg); }
.review-summary { margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); }
.review-summary > div { padding: var(--space-3); display: grid; gap: 4px; border-radius: var(--radius-sm); background: var(--surface-soft); }
.review-summary dt { color: var(--muted); font-size: var(--text-xs); }
.review-summary dd { margin: 0; font-size: var(--text-md); font-weight: var(--weight-strong); overflow-wrap: anywhere; }
.reach-intro p { margin: 4px 0 0; color: var(--muted); font-size: var(--text-sm); }
.reach-way { max-width: 320px; }
.advanced-section { margin: 0; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-soft); overflow: hidden; }
.advanced-section > summary { min-height: var(--control-h); padding: 0 var(--space-3); display: flex; align-items: center; gap: var(--space-2); color: var(--ink); cursor: pointer; font-size: var(--text-sm); font-weight: var(--weight-strong); }
.advanced-section > summary .summary-note { margin-left: auto; color: var(--muted); font-size: var(--text-xs); font-weight: var(--weight-medium); }
.offer-section > .field-row, .offer-section > .field-hint { margin-inline: var(--space-3); }
.offer-section > .field-row { margin-top: var(--space-2); }
.offer-section > .field-hint { margin-bottom: var(--space-3); }
.progress { display: grid; gap: 6px; font-size: var(--text-sm); }
.progress .bar { height: 6px; border-radius: 999px; background: var(--accent-soft); overflow: hidden; }
.progress .bar span { display: block; height: 100%; background: var(--accent); transition: width var(--dur-panel) var(--ease); }
.stepper { padding: var(--space-4); display: grid; gap: var(--space-2); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 2px var(--radius) var(--radius) 2px; background: var(--surface); }
.stepper h4 { margin: 0; font-size: var(--text-xl); }
.stepper p { margin: 0; }
.step-meta { display: flex; align-items: center; gap: var(--space-2); color: var(--muted); font-size: var(--text-sm); }
.step-sub { color: var(--ink-soft); font-size: var(--text-sm); }
.stepper .preview-text { padding: var(--space-3); border-radius: var(--radius-sm); background: var(--surface-sunken); }
.step-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.step-actions a.primary { min-height: var(--control-h); padding: 0 18px; display: inline-flex; align-items: center; gap: 8px; border-radius: var(--radius-sm); text-decoration: none; }
.batches { margin: 0; padding: 0; display: grid; gap: var(--space-2); list-style: none; }
.batch { padding: var(--space-3); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
.batch > div { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.batch > .batch-actions { justify-content: flex-end; }
.batch.done { background: var(--success-soft); }
.batch a:is(.primary, .secondary) { min-height: var(--control-h-sm); padding: 0 16px; display: inline-flex; align-items: center; gap: 8px; border-radius: var(--radius-sm); text-decoration: none; }
.offer-stats { padding: var(--space-3); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-4); border-radius: var(--radius-sm); background: var(--accent-soft); font-size: var(--text-sm); }
.recipients summary, .audience-preview > summary { min-height: var(--control-h-sm); display: flex; align-items: center; color: var(--accent); font-size: var(--text-sm); font-weight: var(--weight-strong); cursor: pointer; }
.recipient-list { margin: var(--space-2) 0 0; padding: 0; display: grid; gap: 6px; list-style: none; }
.recipient-list li { padding: var(--space-2) var(--space-3); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); }
.recipient-list li.is-current { border-color: var(--accent); }
.recipient-list .who { min-width: 0; flex: 1 1 160px; display: grid; }
.recipient-list .status { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
@media (max-width: 900px) {
  .builder-body { grid-template-columns: 1fr; }
  .builder-aside { position: static; min-height: 0; border-left: 0; border-top: 1px solid var(--line); }
  .audience-inline { display: flex; }
}
@media (max-width: 700px) {
  .builder-head { padding: max(var(--space-4), env(safe-area-inset-top)) var(--space-4) var(--space-3); }
  .builder-main, .builder-aside { padding: var(--space-4); }
  .builder-nav { padding-inline: var(--space-4); }
  .review-summary { grid-template-columns: 1fr; }
  .filters { padding: var(--space-3); grid-template-columns: 1fr; }
  table.preview thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  table.preview, table.preview tbody, table.preview tr, table.preview th, table.preview td { display: block; }
  table.preview tr { padding: var(--space-2) 0; border-bottom: 1px solid var(--line); }
  table.preview th, table.preview td { padding: 3px 0; border: 0; text-align: left; }
  table.preview tbody th { font-size: var(--text-md); }
  table.preview td::before { content: attr(data-label) ': '; color: var(--muted); font-size: var(--text-xs); }
  table.preview td[colspan] { display: block; }
  .row-actions { width: 100%; }
  .step-actions > * { flex: 1 1 auto; justify-content: center; }
  .batch > .batch-actions { width: 100%; justify-content: flex-start; }
  .batch > .batch-actions a { flex: 1 1 auto; justify-content: center; }
}
</style>
