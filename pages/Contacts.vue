<script setup>
import { formatDay } from '../format-date.js'
import { csvCell } from '../csv.js'
import { computed, inject, nextTick, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmConfirm from '../components/ui/GmConfirm.vue'
import GmDialog from '../components/ui/GmDialog.vue'
import GmHint from '../components/ui/GmHint.vue'
import GmSelect from '../components/ui/GmSelect.vue'
import GmTextSuggest from '../components/ui/GmTextSuggest.vue'
import { useSetupState } from '../setup.js'
import { contactTags, hasRealEmail, isTimeOff, recordOffer, saveContact, setMarketingOptOut } from '../booking.js'
import { contactOffers, isOptedOut } from '../records.js'
import { composeMessage, gmailComposeUrl } from '../messaging.js'
import { isDemo } from '../runtime.js'
import { displayTimeZone } from '../time-display.js'

const state = inject('bookingState')
const refresh = inject('refreshBookings', async () => true)
const toast = inject('toast', null)
const setup = useSetupState()
const query = ref('')
const tagFilter = ref('')
const optFilter = ref(false)
const now = Date.now()
const zone = computed(() => displayTimeZone(state.schedules?.[0]?.timezone))
const records = computed(() => state.contacts || [])
const gmailFor = (mailto) => gmailComposeUrl(mailto)

const allContacts = computed(() => {
  const byEmail = new Map()
  const blank = (email, name = '', phone = '') => ({
    email,
    name: name || email,
    phone,
    bookingCount: 0,
    confirmedCount: 0,
    completedCount: 0,
    noShowCount: 0,
    cancelledCount: 0,
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
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
  for (const booking of bookings) {
    const email = String(booking.guest_email || '').trim().toLowerCase()
    if (!email) continue
    const startsAt = String(booking.starts_at || '')
    const time = Date.parse(startsAt)
    const current = byEmail.get(email) || blank(email, booking.guest_name, booking.guest_phone || '')
    current.bookingCount += 1
    if (booking.status === 'cancelled') current.cancelledCount += 1
    if (booking.status === 'completed') current.completedCount += 1
    if (booking.status === 'no_show') current.noShowCount += 1
    if (booking.status === 'confirmed') current.confirmedCount += 1
    if (booking.status === 'confirmed' && time > now && !current.nextAt) current.nextAt = startsAt
    if (['confirmed', 'completed'].includes(booking.status) && time <= now) current.lastAt = startsAt
    // Sorted ascending, so the latest booking wins name and phone.
    current.name = booking.guest_name || current.name
    current.phone = booking.guest_phone || current.phone
    current.latest = booking
    byEmail.set(email, current)
  }
  for (const record of records.value) {
    const email = String(record.email || '').trim().toLowerCase()
    if (!email) continue
    const current = byEmail.get(email) || blank(email, record.name, record.phone || '')
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
  const set = new Set()
  for (const record of records.value) for (const tag of contactTags(record)) set.add(tag)
  return [...set].sort((a, b) => a.localeCompare(b))
})
const tagFilterOptions = computed(() => [
  { value: '', label: 'All contacts' },
  ...allTags.value.map((tag) => ({ value: tag, label: tag })),
])

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

const hues = [228, 262, 190, 150, 28, 340, 205, 95]
function avatarStyle(name) {
  const code = String(name || '?').trim().toUpperCase().charCodeAt(0) || 0
  const hue = hues[code % hues.length]
  return { background: `hsl(${hue} 70% 94%)`, color: `hsl(${hue} 55% 32%)` }
}

function dateLabel(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'None'
    : formatDay(date, zone.value)
}

// Follow-up message links for the contact's latest booking. Bookins never sends; it opens the owner's own app.
function followUp(contact) {
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
const draft = ref({ notes: '', tags: [], tagInput: '' })
const saving = ref(false)
const saveError = ref('')
const editTriggers = new Map()
function setEditTrigger(email, element) {
  if (element) editTriggers.set(email, element)
  else editTriggers.delete(email)
}
function editRefFor(contact) {
  const email = contact.email
  return element => setEditTrigger(email, element)
}
function focusEditTrigger(email) {
  nextTick(() => {
    const trigger = editTriggers.get(email)
    if (trigger?.isConnected) trigger.focus({ preventScroll: true })
  })
}

function startEdit(contact) {
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
function viewContact(contact) {
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
function removeTag(tag) {
  draft.value.tags = draft.value.tags.filter((item) => item !== tag)
}
const tagSuggestions = computed(() =>
  allTags.value.filter((tag) => !draft.value.tags.some((item) => item.toLowerCase() === tag.toLowerCase())),
)

async function saveEdit(contact) {
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
    saveError.value = reason?.message || 'The client record could not be saved.'
    toast?.error('Notes and tags could not be saved.')
  } finally {
    saving.value = false
  }
}

// Marketing opt-out and offers. Opted-out contacts are never included in any campaign queue, email batch or CSV.
const marketingBusy = ref('')
const demoReason = 'Demo is read-only. Exit Demo to change this.'
async function toggleOptOut(contact) {
  if (isDemo.value || marketingBusy.value) return
  const next = !contact.optedOut
  marketingBusy.value = contact.email
  try {
    await setMarketingOptOut(contact, next)
    await refresh({ silent: true })
    toast?.success(next ? `${contact.name} is opted out. They will not appear in any campaign.` : `${contact.name} is no longer marked as opted out.`)
  } catch (reason) {
    toast?.error(reason?.message || 'Could not update marketing preference.')
  } finally {
    marketingBusy.value = ''
  }
}
const offerBusy = ref('')
async function markRedeemed(contact, offer) {
  if (isDemo.value || offerBusy.value) return
  offerBusy.value = `${contact.email}|${offer.code}`
  try {
    await recordOffer(contact, { code: offer.code, status: 'redeemed' })
    await refresh({ silent: true })
    toast?.success(`${offer.code} marked as redeemed for ${contact.name}.`)
  } catch (reason) {
    toast?.error(reason?.message || 'Could not update the offer.')
  } finally {
    offerBusy.value = ''
  }
}
// "Add to campaign" opens Campaigns with a group like this client's: their first tag, else their last service.
function campaignQuery(contact) {
  if (contact.tags.length) return { tag: contact.tags[0] }
  const service = contact.latest?.service_name
  return service ? { service } : {}
}
function campaignHint(contact) {
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
  const day = (value) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime())
      ? ''
      : new Intl.DateTimeFormat('en-CA', { timeZone: zone.value, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  }
  const rows = [['Name', 'Email', 'Phone', 'Total bookings', 'Confirmed', 'Completed', 'Cancelled', 'No-shows', 'Tags', 'Notes', 'Last booking', 'Next booking', 'Dates timezone', 'Opted out']]
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
    <div class="page-header contacts-header">
      <div
        ><h1>Contacts</h1
        ><p class="lede"
          >Find a client and open their details.</p
        ></div
      >
      <div class="header-tools page-header-actions">
        <label class="search-field"
          ><AppIcon
            name="search"
            :size="18" /><span class="visually-hidden">Search contacts</span
          ><input
            v-model="query"
            type="search"
            placeholder="Search contacts"
        /></label>
        <GmHint :text="contacts.length ? '' : 'Nothing to export yet. Contacts appear after a client books.'" wrap :disabled="!!contacts.length" v-slot="{ describedby }">
          <button
            class="secondary"
            type="button"
            :aria-disabled="!contacts.length || undefined"
            :aria-describedby="contacts.length ? undefined : describedby"
            @click="contacts.length && exportCsv()"
            >Export CSV</button
          >
        </GmHint>
      </div>
    </div>

    <div class="toolbar contact-toolbar">
      <strong>{{ contacts.length }} {{ contacts.length === 1 ? 'contact' : 'contacts' }}</strong>
      <div v-if="allTags.length" class="field compact-filter">
        <label for="contact-tag-filter">Filter by tag</label>
        <GmSelect id="contact-tag-filter" v-model="tagFilter" :options="tagFilterOptions" label="Filter contacts by tag" />
      </div>
      <label v-if="optedOutCount" class="filter-check"><input v-model="optFilter" type="checkbox" />Opted out ({{ optedOutCount }})</label>
    </div>

    <div data-tour="tour-contacts-list">
    <div
      v-if="contacts.length"
      class="contact-list"
    >
      <article
        v-for="contact in contacts"
        :key="contact.email"
        class="card contact-row"
        :class="{ 'is-opted-out': contact.optedOut }"
      >
        <div class="contact-main">
          <span class="avatar" :style="avatarStyle(contact.name)" aria-hidden="true">{{ initials(contact.name) }}</span>
          <div class="contact-id">
            <h2 class="truncate">{{ contact.name }}</h2>
            <p class="contact-line">
              <span v-if="hasRealEmail(contact.email)" class="truncate">{{ contact.email }}</span>
              <span v-else class="no-email">No email</span>
              <span class="contact-phone"><AppIcon name="phone" :size="14" />{{ contact.phone || 'No phone supplied' }}</span>
            </p>
          </div>
          <div class="contact-stats">
            <span class="stat-line">Last: {{ dateLabel(contact.lastAt) }}</span>
            <span class="stat-line">Next: {{ dateLabel(contact.nextAt) }}</span>
          </div>
          <button class="secondary small" type="button" @click="viewContact(contact)">View details</button>
        </div>
      </article>
    </div>

    <div
      v-else
      class="empty"
    >
      <span class="empty-icon"><AppIcon name="contacts" /></span>
      <h2>{{ query || tagFilter || optFilter ? 'No contacts match your filters' : 'No contacts yet' }}</h2>
      <p>{{
        query || tagFilter || optFilter
          ? 'Try a different name, email, phone number, or tag.'
          : 'A client appears here automatically after their first booking, with their history, private notes and tags. Share your booking link to get your first one.'
      }}</p>
      <button
        v-if="query || tagFilter || optFilter"
        class="secondary"
        type="button"
        @click="query = ''; tagFilter = ''; optFilter = false"
        >Clear filters</button
      >
      <template v-else>
        <button v-if="setup.hasLink" class="primary" type="button" @click="copyBookingLink">Copy your booking link</button>
        <RouterLink v-else class="primary" to="/settings">{{ setup.hasProfile ? 'Create your booking link' : 'Set up your booking link' }}</RouterLink>
      </template>
    </div>
    </div>

    <GmDialog
      :open="Boolean(selectedContact)"
      :title="selectedContact ? selectedContact.name : 'Contact details'"
      content-class="card modal contact-drawer"
      :busy="saving"
      @update:open="$event || requestCloseDetails()"
    >
      <div v-if="selectedContact" class="drawer-shell">
        <header class="drawer-head drawer-sticky-head">
          <div class="drawer-person">
            <span class="avatar large" :style="avatarStyle(selectedContact.name)" aria-hidden="true">{{ initials(selectedContact.name) }}</span>
            <div>
              <h2>{{ selectedContact.name }}</h2>
              <p>{{ hasRealEmail(selectedContact.email) ? selectedContact.email : 'No email' }} · {{ selectedContact.phone || 'No phone supplied' }}</p>
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
            <button class="ghost small-button" type="button" :disabled="saving" @click="requestCloseDetails">Close</button>
          </GmConfirm>
        </header>

        <section class="detail-section booking-summary" aria-labelledby="booking-summary-title">
          <h3 id="booking-summary-title">Bookings</h3>
          <div class="summary-grid">
            <span><strong>{{ selectedContact.bookingCount }}</strong> total</span>
            <span><strong>{{ dateLabel(selectedContact.lastAt) }}</strong> last booking</span>
            <span><strong>{{ dateLabel(selectedContact.nextAt) }}</strong> next booking</span>
          </div>
          <p class="outcomes tnum">{{ selectedContact.confirmedCount }} confirmed · {{ selectedContact.completedCount }} completed · {{ selectedContact.noShowCount }} no-show · {{ selectedContact.cancelledCount }} cancelled</p>
          <RouterLink class="contact-action" :to="{ path: '/bookings', query: { email: selectedContact.email } }">View booking history<AppIcon name="chevron" :size="16" /></RouterLink>
        </section>

        <section class="detail-section" aria-labelledby="notes-title">
          <div class="section-head">
            <h3 id="notes-title">Private notes and tags</h3>
            <GmHint wrap :text="isDemo ? 'Demo is read-only. Exit Demo to edit contacts.' : ''" :disabled="!isDemo" v-slot="{ describedby }">
              <button
                v-if="editingEmail !== selectedContact.email"
                :ref="editRefFor(selectedContact)"
                class="secondary small-button"
                type="button"
                :aria-disabled="isDemo || undefined"
                :aria-describedby="isDemo ? describedby : undefined"
                @click="!isDemo && startEdit(selectedContact)"
              ><AppIcon name="edit" :size="16" />Edit</button>
            </GmHint>
          </div>

          <form v-if="editingEmail === selectedContact.email" class="edit-panel" @submit.prevent="saveEdit(selectedContact)">
            <div class="field">
              <label :for="`notes-${selectedContact.email}`">Private notes</label>
              <textarea :id="`notes-${selectedContact.email}`" v-model="draft.notes" maxlength="4000" :disabled="isDemo || saving" placeholder="Only you see these notes."></textarea>
            </div>
            <div class="field">
              <label :for="`tags-${selectedContact.email}`">Tags</label>
              <div v-if="draft.tags.length" class="tag-row">
                <button v-for="tag in draft.tags" :key="tag" class="chip accent removable" type="button" :disabled="isDemo || saving" :aria-label="`Remove tag ${tag}`" @click="removeTag(tag)">{{ tag }} ×</button>
              </div>
              <div class="tag-input">
                <GmTextSuggest :id="`tags-${selectedContact.email}`" v-model="draft.tagInput" :options="tagSuggestions" label="Tags" maxlength="40" :disabled="isDemo || saving" placeholder="Add a tag" @enter="addTag" />
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
            <p v-if="selectedContact.notes" class="notes-preview">{{ selectedContact.notes }}</p>
            <p v-else class="empty-copy">No private notes yet.</p>
            <div v-if="selectedContact.tags.length" class="tag-row"><span v-for="tag in selectedContact.tags" :key="tag" class="chip accent">{{ tag }}</span></div>
          </template>
        </section>

        <section class="detail-section" aria-labelledby="marketing-title">
          <h3 id="marketing-title">Marketing</h3>
          <div class="marketing-row">
            <GmHint wrap :text="isDemo ? demoReason : ''" :disabled="!isDemo" v-slot="{ describedby }">
              <label class="switch" :class="{ off: isDemo || marketingBusy === selectedContact.email }">
                <input type="checkbox" role="switch" :checked="selectedContact.optedOut" :disabled="isDemo || marketingBusy === selectedContact.email" :aria-describedby="isDemo ? describedby : undefined" @change="toggleOptOut(selectedContact)" />
                <span>Opted out of campaign messages</span>
              </label>
            </GmHint>
            <GmHint text="Turn this on when a client asks to stop. They are left out of every campaign list, email batch and CSV export." label="About marketing opt-out" />
          </div>
          <p v-if="selectedContact.lastCampaignAt" class="field-hint">Last campaign opened by you {{ dateLabel(selectedContact.lastCampaignAt) }}</p>
          <ul v-if="selectedContact.offers.length" class="offers" :aria-label="`Offers for ${selectedContact.name}`">
            <li v-for="offer in selectedContact.offers" :key="offer.code">
              <span class="chip mono" :class="offer.status === 'redeemed' ? 'info' : 'accent'">{{ offer.code }}</span>
              <span class="offer-status">{{ offer.status === 'redeemed' ? 'Redeemed' : 'Offered' }}{{ offer.at ? ` ${dateLabel(offer.at)}` : '' }}</span>
              <GmButton v-if="offer.status !== 'redeemed'" variant="secondary" size="sm" :disabled-reason="isDemo ? demoReason : ''" :pending="offerBusy === `${selectedContact.email}|${offer.code}`" @click="markRedeemed(selectedContact, offer)">Mark redeemed</GmButton>
            </li>
          </ul>
        </section>

        <section class="detail-section" aria-labelledby="contact-actions-title">
          <h3 id="contact-actions-title">Actions</h3>
          <div class="drawer-actions">
            <details v-if="followUp(selectedContact)" class="message-menu">
              <summary class="secondary" :aria-label="`Message ${selectedContact.name}`">Message</summary>
              <div class="message-links">
                <a v-if="followUp(selectedContact).whatsapp" :href="followUp(selectedContact).whatsapp" target="_blank" rel="noreferrer">Open WhatsApp</a>
                <a v-if="followUp(selectedContact).sms" :href="followUp(selectedContact).sms">Open SMS</a>
                <a v-if="followUp(selectedContact).email" :href="followUp(selectedContact).email">Open mail app</a>
                <a v-if="gmailFor(followUp(selectedContact).email)" :href="gmailFor(followUp(selectedContact).email)" target="_blank" rel="noopener noreferrer">Open Gmail</a>
                <small>Bookins fills in the message. You press send in your own app.</small>
              </div>
            </details>
            <GmHint v-if="selectedContact.optedOut" wrap text="Opted-out contacts are never added to a campaign. Turn off the opt-out switch first." v-slot="{ describedby }">
              <button class="secondary" type="button" aria-disabled="true" :aria-describedby="describedby"><AppIcon name="campaigns" :size="16" />Add to campaign</button>
            </GmHint>
            <RouterLink v-else class="secondary add-campaign" :to="{ path: '/campaigns', query: campaignQuery(selectedContact) }" :title="campaignHint(selectedContact)"><AppIcon name="campaigns" :size="16" />Add to campaign</RouterLink>
          </div>
        </section>

      </div>
    </GmDialog>
  </section>
</template>

<style scoped>
.contact-row.is-opted-out { background: #fafafc; }
.marketing { display: grid; gap: var(--space-2); }
.marketing-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.switch { min-height: var(--control-h-sm); display: inline-flex; align-items: center; gap: 10px; color: var(--ink-soft); font-size: var(--text-sm); font-weight: 650; cursor: pointer; }
.switch.off { cursor: not-allowed; opacity: 0.7; }
.switch input { width: 20px; height: 20px; accent-color: var(--accent); }
.offers { margin: 0; padding: 0; display: grid; gap: 6px; list-style: none; }
.offers li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); font-size: var(--text-sm); }
.offer-status { color: var(--muted); }
a.add-campaign { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
.card-actions [aria-disabled='true'],
.header-tools [aria-disabled='true'] { opacity: 0.55; cursor: not-allowed; }
.contact-toolbar { margin-bottom: var(--space-3); display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-3); }
.contact-toolbar > strong { margin-right: auto; align-self: center; }
.compact-filter { width: 210px; margin: 0; }
.filter-check { min-height: var(--control-h); display: inline-flex; align-items: center; gap: 8px; font-size: var(--text-sm); font-weight: 650; }
.filter-check input { width: 18px; height: 18px; accent-color: var(--accent); }
.header-tools { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.header-tools .search-field { width: 280px; max-width: 100%; }
.contact-list { display: grid; gap: var(--space-3); }
.contact-row { padding: var(--space-3) var(--space-4); min-width: 0; }
.contact-main { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto auto; align-items: center; gap: var(--space-3); }
.avatar { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; font-size: var(--text-sm); font-weight: 750; }
.contact-id { min-width: 0; }
.contact-id h2 { margin: 0; font-size: var(--text-md); font-weight: 650; }
.contact-line { margin: 2px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 2px var(--space-3); color: var(--muted); font-size: var(--text-sm); }
.contact-line > span { max-width: 100%; }
.contact-phone { display: inline-flex; align-items: center; gap: 6px; }
.no-email { color: var(--muted); font-weight: 650; }
.tag-row { margin: var(--space-2) 0 0; display: flex; flex-wrap: wrap; gap: 6px; }
.chip.removable { cursor: pointer; min-height: var(--control-h-sm); border: 0; }
.contact-stats { display: grid; justify-items: end; gap: 2px; }
.stat-line { color: var(--muted); font-size: var(--text-xs); }
.outcomes { margin: 0; color: var(--muted); font-size: var(--text-xs); }
.notes-preview { margin: 0; padding: var(--space-3); display: grid; gap: 4px; color: var(--ink-soft); border-radius: var(--radius-sm); background: #f1f3f8; font-size: var(--text-sm); line-height: 1.5; white-space: pre-wrap; }
.notes-preview strong { color: var(--muted); font-size: var(--text-xs); letter-spacing: 0.04em; text-transform: uppercase; }
.edit-panel { padding: var(--space-4); display: grid; gap: var(--space-3); border: 1px solid var(--accent-line, var(--line)); border-radius: var(--radius-sm); background: #fbfbff; }
.edit-panel textarea { min-height: 96px; }
.edit-panel label { font-size: var(--text-sm); }
.tag-input { display: flex; gap: var(--space-2); }
.tag-input input { min-width: 0; flex: 1; }
.card-actions { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-2); }
.message-menu summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; }
.message-menu summary::-webkit-details-marker { display: none; }
.message-links { margin-top: 6px; padding: var(--space-3); display: grid; gap: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; }
.message-links a { min-height: 32px; display: inline-flex; align-items: center; color: var(--accent); font-size: var(--text-sm); font-weight: 650; text-decoration: none; }
.message-links small { color: var(--muted); font-size: var(--text-xs); }
.contact-action { min-height: var(--control-h-sm); margin-left: auto; display: inline-flex; align-items: center; gap: 4px; color: var(--accent); text-decoration: none; font-size: var(--text-sm); font-weight: 650; }
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
.summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); }
.summary-grid span { padding: var(--space-3); display: grid; gap: 3px; border-radius: var(--radius-sm); background: var(--surface-soft); color: var(--muted); font-size: var(--text-xs); }
.summary-grid strong { color: var(--ink); font-size: var(--text-md); overflow-wrap: anywhere; }
.booking-summary .contact-action { margin-left: 0; justify-self: start; }
.empty-copy { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.drawer-actions { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-2); }
.drawer-actions .message-links { position: relative; }
@media (max-width: 700px) {
  .drawer-sticky-head { top: calc(var(--space-4) * -1); margin: calc(var(--space-4) * -1) calc(var(--space-4) * -1) var(--space-4); padding: max(var(--space-4), env(safe-area-inset-top)) max(var(--space-4), env(safe-area-inset-right)) var(--space-4) max(var(--space-4), env(safe-area-inset-left)); }
  .header-tools .search-field { width: 100%; }
  .compact-filter { width: 100%; }
  .contact-main { grid-template-columns: 44px minmax(0, 1fr) auto; }
  .contact-stats { grid-column: 2 / -1; display: flex; flex-wrap: wrap; align-items: center; justify-items: start; gap: var(--space-2) var(--space-3); }
  .contact-main > button { grid-column: 2 / -1; width: 100%; justify-self: stretch; }
  .summary-grid { grid-template-columns: 1fr; }
  .message-links a { min-height: 44px; }
}
</style>
