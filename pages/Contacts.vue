<script setup>
import { computed, inject, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'

const state = inject('bookingState')
const query = ref('')

const contacts = computed(() => {
  const byEmail = new Map()
  for (const booking of state.bookings) {
    const email = String(booking.guest_email || '').trim().toLowerCase()
    if (!email) continue
    const startsAt = String(booking.starts_at || '')
    const current = byEmail.get(email) || { email, name: booking.guest_name || email, phone: booking.guest_phone || '', bookingCount: 0, confirmedCount: 0, latestAt: startsAt, nextAt: '' }
    current.bookingCount += 1
    if (booking.status === 'confirmed') current.confirmedCount += 1
    if (booking.status === 'confirmed' && Date.parse(startsAt) > Date.now() && (!current.nextAt || Date.parse(startsAt) < Date.parse(current.nextAt))) current.nextAt = startsAt
    if (Date.parse(startsAt) > Date.parse(current.latestAt || '')) {
      current.latestAt = startsAt
      current.name = booking.guest_name || current.name
      current.phone = booking.guest_phone || current.phone
    }
    byEmail.set(email, current)
  }
  const search = query.value.trim().toLowerCase()
  return [...byEmail.values()]
    .filter(contact => !search || [contact.name, contact.email, contact.phone].some(value => String(value || '').toLowerCase().includes(search)))
    .sort((left, right) => Date.parse(right.latestAt) - Date.parse(left.latestAt))
})

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

function dateLabel(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}
</script>

<template>
  <section>
    <div class="page-header contacts-header">
      <div><p class="eyebrow">Guest history</p><h1>Contacts</h1><p class="lede">Every guest appears once, with their booking history kept together. Contacts are read-only and come directly from appointments.</p></div>
      <label class="search-box"><AppIcon name="search" :size="17" /><span class="visually-hidden">Search contacts</span><input v-model="query" type="search" placeholder="Search contacts"></label>
    </div>

    <div class="contact-summary"><span class="contact-summary-icon"><AppIcon name="contacts" :size="18" /></span><div><strong>{{ contacts.length }} {{ contacts.length === 1 ? 'contact' : 'contacts' }}</strong><small>Built from confirmed and cancelled booking history</small></div></div>

    <div v-if="contacts.length" class="contact-grid">
      <article v-for="contact in contacts" :key="contact.email" class="card contact-card">
        <div class="contact-head"><span class="avatar">{{ initials(contact.name) }}</span><div><h2>{{ contact.name }}</h2><a :href="`mailto:${contact.email}`">{{ contact.email }}</a></div></div>
        <div class="contact-phone"><AppIcon name="phone" :size="15" /><span>{{ contact.phone || 'No phone supplied' }}</span></div>
        <dl>
          <div><dt>Bookings</dt><dd>{{ contact.bookingCount }}</dd></div>
          <div><dt>Confirmed</dt><dd>{{ contact.confirmedCount }}</dd></div>
          <div><dt>{{ contact.nextAt ? 'Next booking' : 'Most recent' }}</dt><dd>{{ dateLabel(contact.nextAt || contact.latestAt) }}</dd></div>
        </dl>
        <RouterLink class="contact-action" :to="`/bookings`">View booking history<AppIcon name="chevron" :size="14" /></RouterLink>
      </article>
    </div>

    <div v-else class="empty">
      <span class="empty-icon"><AppIcon name="contacts" /></span>
      <h2>{{ query ? 'No contacts match your search' : 'No contacts yet' }}</h2>
      <p>{{ query ? 'Try a different name, email, or phone number.' : 'A guest will appear here after their first booking. Bookins does not create a second customer database.' }}</p>
      <button v-if="query" class="secondary" type="button" @click="query = ''">Clear search</button>
    </div>
  </section>
</template>

<style scoped>
.search-box{width:250px;min-height:44px;padding:0 12px;display:flex;align-items:center;gap:8px;color:var(--muted);border:1px solid var(--line-strong);border-radius:11px;background:#fff}.search-box input{width:100%;min-width:0;min-height:40px;border:0;outline:0;background:transparent}.contact-summary{margin-bottom:16px;padding:13px 16px;display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:12px;background:#fff}.contact-summary-icon{width:34px;height:34px;display:grid;place-items:center;color:var(--accent);border-radius:10px;background:var(--accent-soft)}.contact-summary div{display:grid;gap:2px}.contact-summary strong{font-size:12px}.contact-summary small{color:var(--muted);font-size:10px}.contact-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.contact-card{display:flex;flex-direction:column;box-shadow:none}.contact-head{display:grid;grid-template-columns:48px minmax(0,1fr);align-items:center;gap:11px}.avatar{width:48px;height:48px;display:grid;place-items:center;color:#fff;border-radius:14px;background:linear-gradient(145deg,#4154ef,#2336dc);font-size:12px;font-weight:850}.contact-head h2{margin:0 0 3px;font-size:17px}.contact-head a{display:block;overflow:hidden;color:var(--accent);font-size:11px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.contact-phone{margin:17px 0;padding:11px;display:flex;align-items:center;gap:7px;color:var(--muted);border-radius:9px;background:#f6f7fa;font-size:11px}.contact-card dl{margin:0 0 16px;display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.contact-card dl div{padding:10px 8px;border:1px solid var(--line);border-radius:9px}.contact-card dt{color:var(--muted);font-size:8px;font-weight:800;letter-spacing:.05em;text-transform:uppercase}.contact-card dd{margin:5px 0 0;font-size:12px;font-weight:800}.contact-action{min-height:39px;margin-top:auto;display:flex;align-items:center;justify-content:space-between;color:var(--accent);border-top:1px solid var(--line);text-decoration:none;font-size:11px;font-weight:750}@media(max-width:1120px){.contact-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.search-box{width:100%}.contact-grid{grid-template-columns:1fr}}
</style>
