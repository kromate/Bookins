<template>
  <section>
    <div class="page-header">
      <div>
        <p class="eyebrow">Relationships</p>
        <h1>Contacts</h1>
        <p class="lede">A read-only contact history derived from bookings in this workspace.</p>
      </div>
      <span class="chip">{{ contacts.length }} {{ contacts.length === 1 ? 'contact' : 'contacts' }}</span>
    </div>

    <div v-if="contacts.length" class="contact-list">
      <article v-for="contact in contacts" :key="contact.email" class="card contact">
        <div class="avatar">{{ initials(contact.name) }}</div>
        <div class="contact-main">
          <h2>{{ contact.name }}</h2>
          <a :href="`mailto:${contact.email}`">{{ contact.email }}</a>
          <p class="muted">{{ contact.phone || 'No phone supplied' }}</p>
        </div>
        <dl>
          <div><dt>Bookings</dt><dd>{{ contact.bookingCount }}</dd></div>
          <div><dt>Confirmed</dt><dd>{{ contact.confirmedCount }}</dd></div>
          <div><dt>Most recent</dt><dd>{{ recent(contact.latestAt) }}</dd></div>
        </dl>
      </article>
    </div>

    <div v-else class="empty">
      <h2>No contacts yet</h2>
      <p class="muted">A guest appears here after their first booking. Contacts never create a second customer datastore.</p>
    </div>
  </section>
</template>

<script setup>
import { computed, inject } from 'vue'

const state = inject('bookingState')
const contacts = computed(() => {
  const byEmail = new Map()
  for (const booking of state.bookings) {
    const email = String(booking.guest_email || '').trim().toLowerCase()
    if (!email) continue
    const startsAt = String(booking.starts_at || '')
    const current = byEmail.get(email) || {
      email,
      name: booking.guest_name || email,
      phone: booking.guest_phone || '',
      bookingCount: 0,
      confirmedCount: 0,
      latestAt: startsAt,
    }
    current.bookingCount += 1
    if (booking.status === 'confirmed') current.confirmedCount += 1
    if (Date.parse(startsAt) > Date.parse(current.latestAt || '')) {
      current.latestAt = startsAt
      current.name = booking.guest_name || current.name
      current.phone = booking.guest_phone || current.phone
    }
    byEmail.set(email, current)
  }
  return [...byEmail.values()].sort((left, right) => Date.parse(right.latestAt) - Date.parse(left.latestAt))
})

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

function recent(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString(undefined, { dateStyle: 'medium' })
}
</script>

<style scoped>
.contact-list{display:grid;gap:12px}.contact{display:grid;grid-template-columns:54px minmax(0,1fr) auto;align-items:center;gap:18px}.avatar{display:grid;place-items:center;width:54px;height:54px;border-radius:16px;color:#2435c1;background:var(--accent-soft);font-weight:850}.contact-main h2{margin:0 0 5px}.contact-main a{color:#3346db;font-weight:700;text-decoration:none}.contact-main p{margin:5px 0 0}.contact dl{display:grid;grid-template-columns:repeat(3,minmax(90px,1fr));gap:10px;margin:0}.contact dl div{padding:10px 12px;border-radius:10px;background:#f6f7fb}.contact dt{color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.contact dd{margin:5px 0 0;font-weight:800}@media(max-width:760px){.contact{grid-template-columns:54px 1fr}.contact dl{grid-column:1/-1}.contact dl{grid-template-columns:1fr 1fr}.contact dl div:last-child{grid-column:1/-1}}
</style>
