<script setup lang="ts">
import { formatDay } from '../format-date.ts'
import { csvCell } from '../csv.ts'
import { computed, inject, nextTick, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmConfirm from '../components/ui/GmConfirm.vue'
import GmDialog from '../components/ui/GmDialog.vue'
import GmHint from '../components/ui/GmHint.vue'
import GmSelect from '../components/ui/GmSelect.vue'
import GmTextSuggest from '../components/ui/GmTextSuggest.vue'
import { useSetupState } from '../setup.ts'
import { contactTags, hasRealEmail, isTimeOff, recordOffer, saveContact, setMarketingOptOut } from '../booking.ts'
import { contactOffers, isOptedOut } from '../records.ts'
import { composeMessage, gmailComposeUrl } from '../messaging.ts'
import { isDemo } from '../runtime.ts'
import { ownerTimeZone } from '../time-display.ts'
import { errorMessage } from '../error-message.ts'

interface ContactView {
  email: string
  name: string
  phone: string
  bookingCount: number
  confirmedCount: number
  completedCount: number
  noShowCount: number
  cancelledCount: number
  visitCount: number
  lastAt: string
  nextAt: string
  latest: BookingRecord | null
  record: ContactRecord | null
  tags: string[]
  notes: string
  optedOut: boolean
  optedOutAt: string
  lastCampaignAt: string
  offers: OfferRecord[]
}

const state = inject<WorkspaceState>('bookingState', { profile: null, schedules: [], services: [], bookings: [], contacts: [], staff: [], campaigns: [] })
const refresh = inject<RefreshWorkspace>('refreshBookings', async () => true)
const toast = inject<ToastApi | null>('toast', null)
const setup = useSetupState()
const query = ref('')
const tagFilter = ref('')
const optFilter = ref(false)
const now = Date.now()
const zone = computed(() => ownerTimeZone(state.schedules?.[0]?.timezone || state.profile?.timezone))
const records = computed(() => state.contacts || [])
const gmailFor = (mailto: string) => gmailComposeUrl(mailto)

const allContacts = computed(() => {
  const byEmail = new Map<string, ContactView>()
  const blank = (email: string, name = '', phone = ''): ContactView => ({
    email,
    name: name || email,
    phone,
    bookingCount: 0,
    confirmedCount: 0,
    completedCount: 0,
    noShowCount: 0,
    cancelledCount: 0,
    visitCount: 0,
    lastAt: '',
    nextAt: '',
    latest: null,
    record: null,
    tags: [],
    notes: '',
    optedOut: false,
    optedOutAt: '',
    lastCampaignAt: '',
    offers: [],
  })
  const bookings = state.bookings
    .filter((item) => !isTimeOff(item))
    .sort((a, b) => Date.parse(String(a.starts_at || '')) - Date.parse(String(b.starts_at || '')))
  for (const booking of bookings) {
    const email = String(booking.guest_email || '').trim().toLowerCase()
    if (!email) continue
    const startsAt = String(booking.starts_at || '')
    const time = Date.parse(startsAt)
    const current = byEmail.get(email) || blank(email, booking.guest_name || '', booking.guest_phone || '')
    current.bookingCount += 1
    if (booking.status === 'cancelled') current.cancelledCount += 1
    if (booking.status === 'completed') current.completedCount += 1
    if (booking.status === 'no_show') current.noShowCount += 1
    if (booking.status === 'confirmed') current.confirmedCount += 1
    if (booking.status === 'confirmed' && time > now && !current.nextAt) current.nextAt = startsAt
    if (['confirmed', 'completed'].includes(String(booking.status || '')) && time <= now) {
      // A visit: a completed booking, or a confirmed one whose start time has passed.
      current.lastAt = startsAt
      current.visitCount += 1
    }
    // Sorted ascending, so the latest booking wins name and phone.
    current.name = booking.guest_name || current.name
    current.phone = booking.guest_phone || current.phone
    current.latest = booking
    byEmail.set(email, current)
  }
  for (const record of records.value) {
    const email = String(record.email || '').trim().toLowerCase()
    if (!email) continue
    const current = byEmail.get(email) || blank(email, record.name || '', record.phone || '')
    current.record = record
    current.tags = contactTags(record)
    current.notes = record.notes || ''
    current.optedOut = isOptedOut(record)
    current.optedOutAt = record.marketing_opt_out_at || ''
    current.lastCampaignAt = record.last_campaign_at || ''
    current.offers = contactOffers(record)
    if (!current.bookingCount) {
      current.name = record.name || current.name
      current.phone = record.phone || current.phone
    }
    byEmail.set(email, current)
  }
  return [...byEmail.values()]
    .sort((left, right) => {
      const l = Date.parse(left.nextAt || left.lastAt) || 0
      const r = Date.parse(right.nextAt || right.lastAt) || 0
      return r - l
    })
})
const contacts = computed(() => {
  const search = query.value.trim().toLowerCase()
  return allContacts.value
    .filter((contact) => !tagFilter.value || contact.tags.includes(tagFilter.value))
    .filter((contact) => !optFilter.value || contact.optedOut)
    .filter(
      (contact) =>
        !search ||
        [contact.name, hasRealEmail(contact.email) ? contact.email : '', contact.phone, contact.tags.join(' ')].some((value) =>
          String(value || '').toLowerCase().includes(search),
        ),
    )
})

const optedOutCount = computed(() => records.value.filter(isOptedOut).length)
const allTags = computed(() => {
  const set = new Set<string>()
  for (const record of records.value) for (const tag of contactTags(record)) set.add(tag)
  return [...set].sort((a, b) => a.localeCompare(b))
})
const tagFilterOptions = computed(() => [
  { value: '', label: 'All contacts' },
  ...allTags.value.map((tag) => ({ value: tag, label: tag })),
])

function initials(name: string) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function contactDate(value: TimestampInput): Date {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') return new Date(value)
  if (value && 'toDate' in value) return value.toDate()
  if (value && '_seconds' in value) return new Date(value._seconds * 1000)
  return new Date(Number.NaN)
}

function dateLabel(value: TimestampInput) {
  const date = contactDate(value)
  return Number.isNaN(date.getTime())
    ? 'None'
    : formatDay(date, zone.value)
}

// Follow-up message links for the contact's latest booking. Bookins never sends; it opens the owner's own app.
function followUp(contact: ContactView) {
  if (!contact.latest) return null
  const booking = contact.latest
  const service = state.services.find((item) => item.id === booking.service_id)
  const message = composeMessage('followup', booking, {
    profile: state.profile,
    service,
    bookingLink: state.profile?.public_link_url || '',
  })
  return message.whatsapp || message.sms || message.email ? message : null
}

// Notes and tags editor.
const editingEmail = ref('')
const selectedEmail = ref('')
const selectedContact = computed(() => allContacts.value.find((item) => item.email === selectedEmail.value) || null)
const detailContact = computed<ContactView>(() => selectedContact.value || {
  email: '', name: '', phone: '', bookingCount: 0, confirmedCount: 0, completedCount: 0, noShowCount: 0,
  cancelledCount: 0, visitCount: 0, lastAt: '', nextAt: '', latest: null, record: null, tags: [], notes: '', optedOut: false,
  optedOutAt: '', lastCampaignAt: '', offers: [],
})
const detailFollowUp = computed(() => followUp(detailContact.value))
const draft = ref<{ notes: string; tags: string[]; tagInput: string }>({ notes: '', tags: [], tagInput: '' })
const saving = ref(false)
const saveError = ref('')
const editTriggers = new Map<string, HTMLElement>()
function setEditTrigger(email: string, element: unknown) {
  if (element instanceof HTMLElement) editTriggers.set(email, element)
  else editTriggers.delete(email)
}
function editRefFor(contact: ContactView) {
  const email = contact.email
  return (element: unknown) => setEditTrigger(email, element)
}
function focusEditTrigger(email: string) {
  nextTick(() => {
    const trigger = editTriggers.get(email)
    if (trigger?.isConnected) trigger.focus({ preventScroll: true })
  })
}

function startEdit(contact: ContactView) {
  if (saving.value) return
  editingEmail.value = contact.email
  draft.value = { notes: contact.notes, tags: [...contact.tags], tagInput: '' }
  saveError.value = ''
  nextTick(() => document.getElementById(`notes-${contact.email}`)?.focus({ preventScroll: true }))
}
const discardOpen = ref(false)
const closeDiscardOpen = ref(false)
const editing = computed(() => contacts.value.find((item) => item.email === editingEmail.value) || null)
const dirty = computed(() => {
  const contact = editing.value
  if (!contact) return false
  const pending = draft.value.tagInput.trim()
  const tags = pending ? [...draft.value.tags, pending] : draft.value.tags
  return (
    draft.value.notes !== contact.notes ||
    tags.length !== contact.tags.length ||
    tags.some((tag, index) => tag !== contact.tags[index])
  )
})
const closeAfterDiscard = ref(false)
function cancelEdit() {
  if (saving.value) return
  const email = editingEmail.value
  discardOpen.value = false
  closeDiscardOpen.value = false
  editingEmail.value = ''
  saveError.value = ''
  if (closeAfterDiscard.value) selectedEmail.value = ''
  closeAfterDiscard.value = false
  focusEditTrigger(email)
}
function requestCancel() {
  if (saving.value) return
  closeAfterDiscard.value = false
  if (dirty.value) discardOpen.value = true
  else cancelEdit()
}
function viewContact(contact: ContactView) {
  selectedEmail.value = contact.email
}
function requestCloseDetails() {
  if (saving.value) return
  if (editingEmail.value && dirty.value) {
    closeAfterDiscard.value = true
    closeDiscardOpen.value = true
    return
  }
  editingEmail.value = ''
  selectedEmail.value = ''
  saveError.value = ''
}
function discardAndClose() {
  closeAfterDiscard.value = true
  cancelEdit()
}
function addTag() {
  const raw = draft.value.tagInput.split(',').map((tag) => tag.trim()).filter(Boolean)
  for (const tag of raw)
    if (!draft.value.tags.some((item) => item.toLowerCase() === tag.toLowerCase()) && draft.value.tags.length < 20)
      draft.value.tags.push(tag.slice(0, 40))
  draft.value.tagInput = ''
}
function removeTag(tag: string) {
  draft.value.tags = draft.value.tags.filter((item) => item !== tag)
}
const tagSuggestions = computed(() =>
  allTags.value.filter((tag) => !draft.value.tags.some((item) => item.toLowerCase() === tag.toLowerCase())),
)

async function saveEdit(contact: ContactView) {
  if (isDemo.value || saving.value) return
  if (draft.value.tagInput.trim()) addTag()
  saving.value = true
  saveError.value = ''
  try {
    await saveContact(contact.record, {
      email: contact.email,
      name: contact.name,
      phone: contact.phone,
      notes: draft.value.notes,
      tags: draft.value.tags,
    })
    await refresh()
    discardOpen.value = false
    const email = editingEmail.value
    editingEmail.value = ''
    focusEditTrigger(email)
    toast?.success(`Notes and tags saved for ${contact.name}.`)
  } catch (reason) {
    saveError.value = errorMessage(reason, 'The client record could not be saved.')
    toast?.error('Notes and tags could not be saved.')
  } finally {
    saving.value = false
  }
}

// Marketing opt-out and offers. Opted-out contacts are never included in any campaign queue, email batch or CSV.
const marketingBusy = ref('')
const demoReason = 'Demo is read-only. Exit Demo to change this.'
async function toggleOptOut(contact: ContactView) {
  if (isDemo.value || marketingBusy.value) return
  const next = !contact.optedOut
  marketingBusy.value = contact.email
  try {
    await setMarketingOptOut({ email: contact.email, name: contact.name, phone: contact.phone, record: contact.record }, next)
    await refresh({ silent: true })
    toast?.success(next ? `${contact.name} is opted out. They will not appear in any campaign.` : `${contact.name} is no longer marked as opted out.`)
  } catch (reason) {
    toast?.error(errorMessage(reason, 'Could not update marketing preference.'))
  } finally {
    marketingBusy.value = ''
  }
}
const offerBusy = ref('')
async function markRedeemed(contact: ContactView, offer: OfferRecord) {
  if (isDemo.value || offerBusy.value) return
  offerBusy.value = `${contact.email}|${offer.code}`
  try {
    await recordOffer({ email: contact.email, name: contact.name, phone: contact.phone, record: contact.record }, { code: offer.code, status: 'redeemed' })
    await refresh({ silent: true })
    toast?.success(`${offer.code} marked as redeemed for ${contact.name}.`)
  } catch (reason) {
    toast?.error(errorMessage(reason, 'Could not update the offer.'))
  } finally {
    offerBusy.value = ''
  }
}
// "Add to campaign" opens Campaigns with a group like this client's: their first tag, else their last service.
function campaignQuery(contact: ContactView) {
  if (contact.tags.length) return { tag: contact.tags[0] }
  const service = contact.latest?.service_name
  return service ? { service } : {}
}
function campaignHint(contact: ContactView) {
  if (contact.tags.length) return `Starts a campaign for clients tagged "${contact.tags[0]}".`
  if (contact.latest?.service_name) return `Starts a campaign for clients who had ${contact.latest.service_name}.`
  return 'Opens Campaigns to build a group.'
}

async function copyBookingLink() {
  const url = state.profile?.public_link_url || ''
  try {
    await navigator.clipboard.writeText(url)
    toast?.success('Booking link copied. Share it with your first client.')
  } catch {
    toast?.error('Could not copy the link. Open Settings to copy it.')
  }
}

function exportCsv() {
  const day = (value: TimestampInput) => {
    const date = contactDate(value)
    return Number.isNaN(date.getTime())
      ? ''
      : new Intl.DateTimeFormat('en-CA', { timeZone: zone.value, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  }
  const rows: unknown[][] = [['Name', 'Email', 'Phone', 'Total bookings', 'Confirmed', 'Completed', 'Cancelled', 'No-shows', 'Tags', 'Notes', 'Last booking', 'Next booking', 'Dates timezone', 'Opted out']]
  for (const contact of contacts.value)
    rows.push([contact.name, hasRealEmail(contact.email) ? contact.email : '', contact.phone, contact.bookingCount, contact.confirmedCount, contact.completedCount, contact.cancelledCount, contact.noShowCount, contact.tags.join('; '), contact.notes, day(contact.lastAt), day(contact.nextAt), zone.value, contact.optedOut ? 'Yes' : 'No'])
  const body = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['\ufeff' + body + '\r\n'], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'contacts.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast?.success(`Exported ${contacts.value.length} ${contacts.value.length === 1 ? 'contact' : 'contacts'}`)
}
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1>Clients</h1>
        <p class="lede">Everyone who has booked with you, with their visits, private notes and tags.</p>
      </div>
      <details class="menu" data-menu>
        <summary class="secondary">More<AppIcon class="chevron-down" name="chevron" :size="14" /></summary>
        <div class="menu-panel">
          <button type="button" :disabled="!contacts.length" @click="exportCsv"><AppIcon name="download" :size="16" />Export {{ contacts.length === allContacts.length ? 'all' : 'these' }} as CSV</button>
        </div>
      </details>
    </header>

    <div class="toolbar contact-toolbar">
      <label class="search-field"><AppIcon name="search" :size="18" /><span class="visually-hidden">Search clients</span><input v-model="query" type="search" placeholder="Name, phone, email or tag" /></label>
      <div v-if="allTags.length" class="compact-filter">
        <GmSelect id="contact-tag-filter" v-model="tagFilter" :options="tagFilterOptions" label="Filter clients by tag" />
      </div>
      <label v-if="optedOutCount" class="filter-check"><input v-model="optFilter" type="checkbox" />Only opted out ({{ optedOutCount }})</label>
      <p class="toolbar-count tnum" aria-live="polite">{{ contacts.length }} {{ contacts.length === 1 ? 'client' : 'clients' }}</p>
    </div>

    <div data-tour="tour-contacts-list">
    <template v-if="contacts.length">
      <div class="ledger-head contact-cols" aria-hidden="true"><span /><span>Client</span><span>Last visit</span><span class="num">Visits</span><span class="num">No-shows</span><span>Tags</span></div>
      <ul class="ledger contact-list" aria-label="Clients">
        <li v-for="contact in contacts" :key="contact.email" :class="{ 'is-opted-out': contact.optedOut }">
          <button class="ledger-row contact-cols" type="button" :aria-label="`Open ${contact.name}`" @click="viewContact(contact)">
            <span class="avatar" aria-hidden="true">{{ initials(contact.name) }}</span>
            <span class="contact-id">
              <strong class="truncate">{{ contact.name }}</strong>
              <span class="contact-line">
                <span class="tnum">{{ contact.phone || 'No phone' }}</span>
                <span v-if="hasRealEmail(contact.email)" class="truncate">{{ contact.email }}</span>
                <span v-if="contact.optedOut" class="opt-out-tag">Opted out</span>
              </span>
            </span>
            <span class="cell" data-label="Last visit">{{ contact.lastAt ? dateLabel(contact.lastAt) : 'Not yet' }}<small v-if="contact.nextAt">Next {{ dateLabel(contact.nextAt) }}</small></span>
            <span class="cell num tnum" data-label="Visits">{{ contact.visitCount }}</span>
            <span class="cell num tnum" data-label="No-shows" :class="{ 'has-no-shows': contact.noShowCount }">{{ contact.noShowCount }}</span>
            <span class="cell tags"><span v-for="tag in contact.tags.slice(0, 3)" :key="tag" class="chip neutral">{{ tag }}</span><small v-if="contact.tags.length > 3">+{{ contact.tags.length - 3 }}</small></span>
          </button>
        </li>
      </ul>
    </template>

    <div v-else class="empty">
      <h2>{{ query || tagFilter || optFilter ? 'No clients match' : 'No clients yet' }}</h2>
      <p>{{
        query || tagFilter || optFilter
          ? 'Try a different name, phone number, email or tag.'
          : `A client appears here automatically after their first booking, with their history, private notes and tags. ${setup.hasLink ? 'Share your booking link to get your first one.' : 'Finish setup to get a booking link you can share.'}`
      }}</p>
      <div class="empty-actions">
        <button v-if="query || tagFilter || optFilter" class="secondary" type="button" @click="query = ''; tagFilter = ''; optFilter = false">Clear filters</button>
        <template v-else>
          <button v-if="setup.hasLink" class="primary" type="button" @click="copyBookingLink">Copy your booking link</button>
          <RouterLink v-else class="primary" :to="setup.nextStep.to">{{ setup.nextStep.label }}</RouterLink>
        </template>
      </div>
    </div>
    </div>

    <GmDialog
      :open="Boolean(selectedContact)"
      :title="selectedContact ? detailContact.name : 'Contact details'"
      content-class="card modal contact-drawer"
      :busy="saving"
      @update:open="$event || requestCloseDetails()"
    >
      <div v-if="selectedContact" class="drawer-shell">
        <header class="drawer-head drawer-sticky-head">
          <div class="drawer-person">
            <span class="avatar large" aria-hidden="true">{{ initials(detailContact.name) }}</span>
            <div>
              <h2>{{ detailContact.name }}</h2>
              <p class="tnum">{{ detailContact.phone || 'No phone' }}</p>
              <p v-if="hasRealEmail(detailContact.email)">{{ detailContact.email }}</p>
            </div>
          </div>
          <GmConfirm
            v-model:open="closeDiscardOpen"
            title="Discard your changes?"
            message="Your notes and tags have not been saved."
            confirm-label="Discard and close"
            cancel-label="Keep editing"
            tone="danger"
            @confirm="discardAndClose"
          >
            <button class="icon-button" type="button" aria-label="Close client details" :disabled="saving" @click="requestCloseDetails"><AppIcon name="close" /></button>
          </GmConfirm>
        </header>

        <section class="detail-section" aria-labelledby="contact-actions-title">
          <h3 id="contact-actions-title" class="visually-hidden">Actions</h3>
          <div class="drawer-actions">
            <details v-if="detailFollowUp" class="menu" data-menu>
              <summary class="primary" :aria-label="`Message ${detailContact.name}`"><AppIcon name="messages" :size="16" />Message</summary>
              <div class="menu-panel start">
                <a v-if="detailFollowUp.whatsapp" :href="detailFollowUp.whatsapp" target="_blank" rel="noreferrer">Open WhatsApp</a>
                <a v-if="detailFollowUp.sms" :href="detailFollowUp.sms">Open SMS</a>
                <a v-if="detailFollowUp.email" :href="detailFollowUp.email">Open mail app</a>
                <a v-if="gmailFor(detailFollowUp.email)" :href="gmailFor(detailFollowUp.email)" target="_blank" rel="noopener noreferrer">Open Gmail</a>
                <small class="menu-note">Bookins fills in a follow-up. You press send in your own app.</small>
              </div>
            </details>
            <RouterLink class="secondary history-link" :to="{ path: '/bookings', query: { email: detailContact.email } }">Booking history</RouterLink>
            <GmHint v-if="detailContact.optedOut" wrap text="Opted-out clients are never added to a campaign. Turn off the opt-out first." v-slot="{ describedby }">
              <button class="secondary" type="button" aria-disabled="true" :aria-describedby="describedby"><AppIcon name="campaigns" :size="16" />Add to campaign</button>
            </GmHint>
            <RouterLink v-else class="secondary add-campaign" :to="{ path: '/campaigns', query: campaignQuery(detailContact) }" :title="campaignHint(detailContact)"><AppIcon name="campaigns" :size="16" />Add to campaign</RouterLink>
          </div>
        </section>

        <section class="detail-section" aria-labelledby="booking-summary-title">
          <h3 id="booking-summary-title">Visits</h3>
          <dl class="detail-list tnum">
            <div><dt>Last visit</dt><dd>{{ detailContact.lastAt ? dateLabel(detailContact.lastAt) : 'Not yet' }}</dd></div>
            <div><dt>Next booking</dt><dd>{{ detailContact.nextAt ? dateLabel(detailContact.nextAt) : 'None booked' }}</dd></div>
            <div><dt>Visits</dt><dd>{{ detailContact.visitCount }}</dd></div>
            <div><dt>All bookings</dt><dd>{{ detailContact.bookingCount }}, of which {{ detailContact.cancelledCount }} cancelled and {{ detailContact.noShowCount }} {{ detailContact.noShowCount === 1 ? 'no-show' : 'no-shows' }}</dd></div>
          </dl>
        </section>

        <section class="detail-section" aria-labelledby="notes-title">
          <div class="section-head">
            <h3 id="notes-title">Private notes and tags</h3>
            <GmHint wrap :text="isDemo ? 'Demo is read-only. Exit Demo to edit contacts.' : ''" :disabled="!isDemo" v-slot="{ describedby }">
              <button
                v-if="editingEmail !== detailContact.email"
                :ref="editRefFor(detailContact)"
                class="secondary small-button"
                type="button"
                :aria-disabled="isDemo || undefined"
                :aria-describedby="isDemo ? describedby : undefined"
                @click="!isDemo && startEdit(detailContact)"
              ><AppIcon name="edit" :size="16" />Edit</button>
            </GmHint>
          </div>

          <form v-if="editingEmail === detailContact.email" class="edit-panel" @submit.prevent="saveEdit(detailContact)">
            <div class="field">
              <label :for="`notes-${detailContact.email}`">Private notes</label>
              <textarea :id="`notes-${detailContact.email}`" v-model="draft.notes" maxlength="4000" :disabled="isDemo || saving" placeholder="Only you see these notes."></textarea>
            </div>
            <div class="field">
              <label :for="`tags-${detailContact.email}`">Tags</label>
              <div v-if="draft.tags.length" class="tag-row">
                <button v-for="tag in draft.tags" :key="tag" class="chip neutral removable" type="button" :disabled="isDemo || saving" :aria-label="`Remove tag ${tag}`" @click="removeTag(tag)">{{ tag }}<AppIcon name="close" :size="14" /></button>
              </div>
              <div class="tag-input">
                <GmTextSuggest :id="`tags-${detailContact.email}`" v-model="draft.tagInput" :options="tagSuggestions" label="Tags" maxlength="40" :disabled="isDemo || saving" placeholder="Add a tag" @enter="addTag" />
                <button class="secondary small-button" type="button" :disabled="isDemo || saving || !draft.tagInput.trim()" @click="addTag">Add</button>
              </div>
            </div>
            <p v-if="saveError" class="notice error" role="alert">{{ saveError }}</p>
            <div class="form-actions">
              <button class="primary small-button" :disabled="isDemo || saving">{{ saving ? 'Saving…' : 'Save changes' }}</button>
              <GmConfirm
                v-model:open="discardOpen"
                title="Discard your changes?"
                message="Your notes and tags have not been saved."
                confirm-label="Discard changes"
                cancel-label="Keep editing"
                tone="danger"
                @confirm="cancelEdit"
              >
                <button class="secondary small-button" type="button" :disabled="saving" @click="requestCancel">Cancel</button>
              </GmConfirm>
            </div>
          </form>
          <template v-else>
            <p v-if="detailContact.notes" class="notes-preview">{{ detailContact.notes }}</p>
            <p v-else class="empty-copy">No private notes yet.</p>
            <div v-if="detailContact.tags.length" class="tag-row"><span v-for="tag in detailContact.tags" :key="tag" class="chip neutral">{{ tag }}</span></div>
          </template>
        </section>

        <section class="detail-section" aria-labelledby="marketing-title">
          <h3 id="marketing-title">Campaign messages</h3>
          <div class="marketing-row">
            <GmHint wrap :text="isDemo ? demoReason : ''" :disabled="!isDemo" v-slot="{ describedby }">
              <label class="switch" :class="{ off: isDemo || marketingBusy === detailContact.email }">
                <input type="checkbox" role="switch" :checked="detailContact.optedOut" :disabled="isDemo || marketingBusy === detailContact.email" :aria-describedby="isDemo ? describedby : undefined" @change="toggleOptOut(detailContact)" />
                <span>Opted out of campaign messages</span>
              </label>
            </GmHint>
            <GmHint text="Turn this on when a client asks to stop. They are left out of every campaign list, email batch and CSV export." label="About marketing opt-out" />
          </div>
          <p v-if="detailContact.lastCampaignAt" class="field-hint">Last campaign opened by you {{ dateLabel(detailContact.lastCampaignAt) }}</p>
          <ul v-if="detailContact.offers.length" class="offers" :aria-label="`Offers for ${detailContact.name}`">
            <li v-for="offer in detailContact.offers" :key="offer.code">
              <span class="chip mono" :class="offer.status === 'redeemed' ? 'info' : 'accent'">{{ offer.code }}</span>
              <span class="offer-status">{{ offer.status === 'redeemed' ? 'Redeemed' : 'Offered' }}{{ offer.at ? ` ${dateLabel(offer.at)}` : '' }}</span>
              <GmButton v-if="offer.status !== 'redeemed'" variant="secondary" size="sm" :disabled-reason="isDemo ? demoReason : ''" :pending="offerBusy === `${detailContact.email}|${offer.code}`" @click="markRedeemed(detailContact, offer)">Mark redeemed</GmButton>
            </li>
          </ul>
        </section>
      </div>
    </GmDialog>
  </section>
</template>

<style scoped>
.marketing-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.switch { min-height: var(--control-h-sm); display: inline-flex; align-items: center; gap: 10px; color: var(--ink-soft); font-size: var(--text-sm); font-weight: var(--weight-strong); cursor: pointer; }
.switch.off { cursor: not-allowed; opacity: 0.7; }
.switch input { width: 20px; height: 20px; accent-color: var(--accent); }
.offers { margin: 0; padding: 0; display: grid; gap: 6px; list-style: none; }
.offers li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); font-size: var(--text-sm); }
.offer-status { color: var(--muted); }
a.add-campaign, a.history-link { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
.contact-toolbar { margin-bottom: var(--space-3); align-items: center; }
.contact-toolbar .search-field { width: 300px; max-width: 100%; }
.compact-filter { width: 210px; }
.filter-check { min-height: var(--control-h); display: inline-flex; align-items: center; gap: 8px; font-size: var(--text-sm); font-weight: var(--weight-medium); }
.filter-check input { width: 18px; height: 18px; accent-color: var(--accent); }
.toolbar-count { margin: 0 0 0 auto; color: var(--muted); font-size: var(--text-sm); }
.contact-cols { grid-template-columns: 40px minmax(0, 2fr) minmax(120px, 1fr) 64px 76px minmax(0, 1fr); }
.ledger-head.contact-cols { padding-inline: var(--space-4); }
/* The column header is the top of the list card, not a strip above it. */
@media (min-width: 901px) {
  .ledger-head.contact-cols { border: 1px solid var(--line); border-radius: var(--card-radius) var(--card-radius) 0 0; }
  .ledger-head.contact-cols + .contact-list { border-top: 0; border-top-left-radius: 0; border-top-right-radius: 0; }
}
.contact-list li.is-opted-out .ledger-row { background: var(--surface-soft); }
.contact-id { min-width: 0; display: grid; gap: 2px; }
.contact-id strong { font-size: var(--text-md); font-weight: var(--weight-strong); }
.contact-line { display: flex; flex-wrap: wrap; align-items: center; gap: 2px var(--space-3); color: var(--muted); font-size: var(--text-sm); }
.contact-line > span { max-width: 100%; }
.opt-out-tag { color: var(--warning); font-weight: var(--weight-strong); }
.cell { min-width: 0; display: grid; gap: 2px; color: var(--ink-soft); font-size: var(--text-sm); }
.cell small { color: var(--muted); font-size: var(--text-xs); }
.cell.num, .ledger-head .num { text-align: right; }
.cell.has-no-shows { color: var(--warning); font-weight: var(--weight-strong); }
.cell.tags { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.avatar.large { color: var(--ink-soft); background: var(--surface-sunken); }
.contact-list .avatar { color: var(--ink-soft); background: var(--surface-sunken); }
.tag-row { margin: var(--space-2) 0 0; display: flex; flex-wrap: wrap; gap: 6px; }
.chip.removable { min-height: var(--control-h-sm); gap: 6px; border: 0; cursor: pointer; }
.notes-preview { margin: 0; padding: var(--space-3); color: var(--ink-soft); border-radius: var(--radius-sm); background: var(--surface-sunken); font-size: var(--text-sm); line-height: 1.5; white-space: pre-wrap; }
.edit-panel { padding: var(--space-4); display: grid; gap: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-soft); }
.edit-panel textarea { min-height: 96px; }
.edit-panel label { font-size: var(--text-sm); }
.tag-input { display: flex; gap: var(--space-2); }
.tag-input input { min-width: 0; flex: 1; }
.drawer-actions .menu > summary { display: inline-flex; align-items: center; gap: 6px; }
.menu-note { padding: var(--space-2) var(--space-3) var(--space-1); color: var(--muted); font-size: var(--text-xs); }
.drawer-shell { min-height: 100%; display: grid; gap: var(--space-4); align-content: start; }
.drawer-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.drawer-person { min-width: 0; display: flex; align-items: center; gap: var(--space-3); }
.drawer-person > div { min-width: 0; }
.drawer-head > :last-child { flex: none; }
.drawer-sticky-head { position: sticky; top: calc(var(--space-5) * -1); z-index: 12; margin: calc(var(--space-5) * -1) calc(var(--space-5) * -1) var(--space-4); padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--line); background: var(--surface); }
.avatar.large { width: 52px; height: 52px; flex: 0 0 auto; }
.drawer-head h2 { margin: 0; font-size: var(--text-xl); overflow-wrap: anywhere; }
.drawer-head p { margin: 3px 0 0; color: var(--muted); font-size: var(--text-sm); overflow-wrap: anywhere; }
.detail-section { padding-top: var(--space-4); display: grid; gap: var(--space-3); border-top: 1px solid var(--line); }
.detail-section h3 { margin: 0; font-size: var(--text-md); }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.empty-copy { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.drawer-actions { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-2); }
.detail-section:first-of-type { padding-top: 0; border-top: 0; }
@media (max-width: 900px) {
  .contact-cols { grid-template-columns: 40px minmax(0, 1fr) auto; }
  .ledger-head.contact-cols { display: none; }
  .contact-cols .cell { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 4px var(--space-2); }
  .contact-cols .cell.num { text-align: left; }
  .contact-cols .cell[data-label]::before { content: attr(data-label) ': '; color: var(--muted); }
  .contact-cols .cell.tags:empty { display: none; }
}
@media (max-width: 700px) {
  .drawer-sticky-head { top: calc(var(--space-4) * -1); margin: calc(var(--space-4) * -1) calc(var(--space-4) * -1) var(--space-4); padding: max(var(--space-4), env(safe-area-inset-top)) max(var(--space-4), env(safe-area-inset-right)) var(--space-4) max(var(--space-4), env(safe-area-inset-left)); }
  .contact-toolbar .search-field, .compact-filter { width: 100%; }
  .toolbar-count { margin-left: 0; }
}
</style>
