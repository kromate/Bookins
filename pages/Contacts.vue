<script setup>
import { formatDay } from '../format-date.js'
import { csvCell } from '../csv.js'
import { computed, inject, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import GmConfirm from '../components/ui/GmConfirm.vue'
import GmHint from '../components/ui/GmHint.vue'
import { useSetupState } from '../setup.js'
import { contactTags, hasRealEmail, isTimeOff, saveContact } from '../booking.js'
import { composeMessage } from '../messaging.js'
import { isDemo } from '../runtime.js'
import { displayTimeZone } from '../time-display.js'

const state = inject('bookingState')
const refresh = inject('refreshBookings', async () => true)
const toast = inject('toast', null)
const setup = useSetupState()
const query = ref('')
const tagFilter = ref('')
const now = Date.now()
const zone = computed(() => displayTimeZone(state.schedules?.[0]?.timezone))
const records = computed(() => state.contacts || [])

const contacts = computed(() => {
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
    if (!current.bookingCount) {
      current.name = record.name || current.name
      current.phone = record.phone || current.phone
    }
    byEmail.set(email, current)
  }
  const search = query.value.trim().toLowerCase()
  return [...byEmail.values()]
    .filter((contact) => !tagFilter.value || contact.tags.includes(tagFilter.value))
    .filter(
      (contact) =>
        !search ||
        [contact.name, hasRealEmail(contact.email) ? contact.email : '', contact.phone, contact.tags.join(' ')].some((value) =>
          String(value || '').toLowerCase().includes(search),
        ),
    )
    .sort((left, right) => {
      const l = Date.parse(left.nextAt || left.lastAt) || 0
      const r = Date.parse(right.nextAt || right.lastAt) || 0
      return r - l
    })
})

const allTags = computed(() => {
  const set = new Set()
  for (const record of records.value) for (const tag of contactTags(record)) set.add(tag)
  return [...set].sort((a, b) => a.localeCompare(b))
})

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
const draft = ref({ notes: '', tags: [], tagInput: '' })
const saving = ref(false)
const saveError = ref('')

function startEdit(contact) {
  if (saving.value) return
  editingEmail.value = contact.email
  draft.value = { notes: contact.notes, tags: [...contact.tags], tagInput: '' }
  saveError.value = ''
}
const discardOpen = ref(false)
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
function cancelEdit() {
  if (saving.value) return
  discardOpen.value = false
  editingEmail.value = ''
  saveError.value = ''
}
function requestCancel() {
  if (saving.value) return
  if (dirty.value) discardOpen.value = true
  else cancelEdit()
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
    editingEmail.value = ''
    toast?.success(`Notes and tags saved for ${contact.name}.`)
  } catch (reason) {
    saveError.value = reason?.message || 'The client record could not be saved.'
    toast?.error('Notes and tags could not be saved.')
  } finally {
    saving.value = false
  }
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
  const rows = [['Name', 'Email', 'Phone', 'Total bookings', 'Confirmed', 'Completed', 'Cancelled', 'No-shows', 'Tags', 'Notes', 'Last booking', 'Next booking', 'Dates timezone']]
  for (const contact of contacts.value)
    rows.push([contact.name, hasRealEmail(contact.email) ? contact.email : '', contact.phone, contact.bookingCount, contact.confirmedCount, contact.completedCount, contact.cancelledCount, contact.noShowCount, contact.tags.join('; '), contact.notes, day(contact.lastAt), day(contact.nextAt), zone.value])
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
        ><p class="eyebrow">Client records</p><h1>Contacts</h1
        ><p class="lede"
          >Every client appears once (matched by email), with booking history, private notes, and tags kept together. Clients without an email are grouped by phone number.</p
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
      <p class="contact-count"
        ><strong>{{ contacts.length }} {{ contacts.length === 1 ? 'contact' : 'contacts' }}</strong
        ><span>Built from booking history plus your private notes and tags. Dates shown in {{ zone }}.</span
        ><GmHint text="Contacts are built automatically from your bookings: everyone who booked appears once, matched by email (phone for clients without one). Time off is not counted. Notes and tags are the only things you add yourself." label="How contacts are built" /></p
      >
    </div>

    <div v-if="allTags.length" class="tag-filter" role="group" aria-label="Filter by tag">
      <button class="chip-button" type="button" :class="{ on: !tagFilter }" :aria-pressed="!tagFilter" @click="tagFilter = ''">All</button>
      <button
        v-for="tag in allTags"
        :key="tag"
        class="chip-button"
        type="button"
        :class="{ on: tagFilter === tag }"
        :aria-pressed="tagFilter === tag"
        @click="tagFilter = tagFilter === tag ? '' : tag"
        >{{ tag }}</button
      >
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
      >
        <div class="contact-main">
          <span class="avatar" :style="avatarStyle(contact.name)" aria-hidden="true">{{ initials(contact.name) }}</span>
          <div class="contact-id">
            <h2 class="truncate">{{ contact.name }}</h2>
            <p class="contact-line">
              <a v-if="hasRealEmail(contact.email)" :href="`mailto:${contact.email}`" class="truncate">{{ contact.email }}</a>
              <span v-else class="no-email">No email</span>
              <span class="contact-phone"><AppIcon name="phone" :size="14" />{{ contact.phone || 'No phone supplied' }}</span>
            </p>
            <div v-if="contact.tags.length || contact.noShowCount" class="tag-row">
              <span v-if="contact.noShowCount" class="chip danger">{{ contact.noShowCount }} no-show{{ contact.noShowCount === 1 ? '' : 's' }}</span>
              <GmHint v-if="contact.noShowCount" text="A no-show is a booking you marked 'No-show' in Bookings after the client did not turn up. Cancelled bookings are not counted." label="What a no-show count means" />
              <span v-for="tag in contact.tags" :key="tag" class="chip accent">{{ tag }}</span>
            </div>
          </div>
          <div class="contact-stats">
            <span class="chip neutral tnum">{{ contact.bookingCount }} {{ contact.bookingCount === 1 ? 'booking' : 'bookings' }}</span>
            <span class="stat-line">Last: {{ dateLabel(contact.lastAt) }}</span>
            <span class="stat-line">Next: {{ dateLabel(contact.nextAt) }}</span>
          </div>
        </div>
        <p class="outcomes tnum">{{ contact.confirmedCount }} confirmed · {{ contact.completedCount }} completed · {{ contact.noShowCount }} no-show · {{ contact.cancelledCount }} cancelled</p>
        <p v-if="contact.notes && editingEmail !== contact.email" class="notes-preview"><strong>Private notes</strong>{{ contact.notes }}</p>

        <form v-if="editingEmail === contact.email" class="edit-panel" @submit.prevent="saveEdit(contact)">
          <div class="field">
            <label :for="`notes-${contact.email}`">Private notes <GmHint text="Only you can see these notes. Guests never do, and Bookins does not send them anywhere." label="About private notes" /></label>
            <textarea :id="`notes-${contact.email}`" v-model="draft.notes" maxlength="4000" :disabled="isDemo || saving" placeholder="Only you see these notes."></textarea>
          </div>
          <div class="field">
            <label :for="`tags-${contact.email}`">Tags <GmHint text="Tags are your own labels, such as VIP or Referral. Only you see them. Use them to filter this list; separate several with commas." label="About tags" /></label>
            <div v-if="draft.tags.length" class="tag-row">
              <button v-for="tag in draft.tags" :key="tag" class="chip accent removable" type="button" :disabled="isDemo || saving" :aria-label="`Remove tag ${tag}`" @click="removeTag(tag)">{{ tag }} ×</button>
            </div>
            <div class="tag-input">
              <input
                :id="`tags-${contact.email}`"
                v-model="draft.tagInput"
                :list="`tag-suggestions-${contact.email}`"
                maxlength="40"
                :disabled="isDemo || saving"
                placeholder="Add a tag, e.g. VIP"
                @keydown.enter.prevent="addTag" />
              <button class="secondary small-button" type="button" :disabled="isDemo || saving || !draft.tagInput.trim()" @click="addTag">Add</button>
            </div>
            <datalist :id="`tag-suggestions-${contact.email}`"><option v-for="tag in tagSuggestions" :key="tag" :value="tag" /></datalist>
          </div>
          <p v-if="saveError" class="notice error" role="alert">{{ saveError }}</p>
          <div class="form-actions">
            <button class="primary small-button" :disabled="isDemo || saving">{{ saving ? 'Saving…' : 'Save' }}</button>
            <GmConfirm
              v-model:open="discardOpen"
              title="Discard your changes?"
              message="Your notes and tags for this contact have not been saved."
              confirm-label="Discard changes"
              align="start"
              cancel-label="Keep editing"
              tone="danger"
              @confirm="cancelEdit"
            >
              <button class="secondary small-button" type="button" :disabled="saving" @click="requestCancel">Cancel</button>
            </GmConfirm>
          </div>
        </form>
        <div v-else class="card-actions">
          <GmHint wrap :text="isDemo ? 'Demo is read-only. Exit Demo to edit contacts.' : 'Save or discard the notes you are editing first.'" :disabled="!(isDemo || (editingEmail && dirty))" v-slot="{ describedby }">
            <button class="secondary small-button" type="button" :aria-disabled="(isDemo || (!!editingEmail && dirty)) || undefined" :aria-describedby="(isDemo || (editingEmail && dirty)) ? describedby : undefined" @click="!(isDemo || (editingEmail && dirty)) && startEdit(contact)"><AppIcon name="edit" :size="16" />{{ contact.notes || contact.tags.length ? 'Edit notes and tags' : 'Add notes and tags' }}</button>
          </GmHint>
          <details v-if="followUp(contact)" class="message-menu">
            <summary class="secondary small-button" :aria-label="`Message ${contact.name}`">Message</summary>
            <div class="message-links">
              <a v-if="followUp(contact).whatsapp" :href="followUp(contact).whatsapp" target="_blank" rel="noreferrer" :aria-label="`Open WhatsApp to message ${contact.name}`">Open WhatsApp</a>
              <a v-if="followUp(contact).sms" :href="followUp(contact).sms" :aria-label="`Open SMS to message ${contact.name}`">Open SMS</a>
              <a v-if="followUp(contact).email" :href="followUp(contact).email" :aria-label="`Open email to message ${contact.name}`">Open email</a>
              <small>Opens a follow-up message in your own app. Bookins does not send it.</small>
            </div>
          </details>
          <RouterLink
            class="contact-action"
            :to="{ path: '/bookings', query: { email: contact.email } }"
            >View history<AppIcon
              name="chevron"
              :size="16"
          /></RouterLink>
        </div>
      </article>
    </div>

    <div
      v-else
      class="empty"
    >
      <span class="empty-icon"><AppIcon name="contacts" /></span>
      <h2>{{ query || tagFilter ? 'No contacts match your filters' : 'No contacts yet' }}</h2>
      <p>{{
        query || tagFilter
          ? 'Try a different name, email, phone number, or tag.'
          : 'A client appears here automatically after their first booking, with their history, private notes and tags. Share your booking link to get your first one.'
      }}</p>
      <button
        v-if="query || tagFilter"
        class="secondary"
        type="button"
        @click="query = ''; tagFilter = ''"
        >Clear filters</button
      >
      <template v-else>
        <button v-if="setup.hasLink" class="primary" type="button" @click="copyBookingLink">Copy your booking link</button>
        <RouterLink v-else class="primary" to="/settings">{{ setup.hasProfile ? 'Create your booking link' : 'Set up your booking link' }}</RouterLink>
      </template>
    </div>
    </div>
  </section>
</template>

<style scoped>
.tag-filter { margin-bottom: var(--space-4); display: flex; flex-wrap: wrap; gap: var(--space-2); }
.chip-button { min-height: var(--control-h-sm); padding: 0 14px; color: var(--ink-soft); border: 1px solid var(--line-strong); border-radius: var(--radius-pill); background: #fff; font-size: var(--text-sm); font-weight: 650; cursor: pointer; transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease); }
.chip-button.on { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.header-tools [aria-disabled='true'] { opacity: 0.55; cursor: not-allowed; }
.contact-toolbar { margin-bottom: var(--space-3); }
.contact-count { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); }
.contact-count strong { font-size: var(--text-md); }
.contact-count span { color: var(--muted); font-size: var(--text-sm); }
.header-tools { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.header-tools .search-field { width: 280px; max-width: 100%; }
.contact-list { display: grid; gap: var(--space-3); }
.contact-row { padding: var(--space-4); display: grid; gap: var(--space-3); min-width: 0; }
.contact-main { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: start; gap: var(--space-3); }
.avatar { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; font-size: var(--text-sm); font-weight: 750; }
.contact-id { min-width: 0; }
.contact-id h2 { margin: 0; font-size: var(--text-md); font-weight: 650; }
.contact-line { margin: 2px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 2px var(--space-3); color: var(--muted); font-size: var(--text-sm); }
.contact-line a { max-width: 100%; color: var(--accent); font-weight: 600; }
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
@media (max-width: 700px) {
  .header-tools .search-field { width: 100%; }
  .contact-main { grid-template-columns: 44px minmax(0, 1fr); }
  .contact-stats { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; justify-items: start; gap: var(--space-2) var(--space-3); }
}
</style>
