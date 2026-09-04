<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import BookinsLogo from '../components/BookinsLogo.vue'
import { loadGuestOpenings, loadGuestPage, submitGuestBooking } from '../booking.js'

const loading = ref(true)
const pageError = ref('')
const slotError = ref('')
const submitError = ref('')
const page = ref(null)
const selectedService = ref(null)
const openings = ref([])
const selectedSlot = ref(null)
const slotsLoading = ref(false)
const submitting = ref(false)
const confirmation = ref(null)
const notes = ref('')
const contact = reactive({ name: '', email: '', phone: '' })

function localDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const today = localDate()
const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)
const startDate = ref(localDate(tomorrow))
const step = computed(() => selectedSlot.value ? 3 : selectedService.value ? 2 : 1)
const openingGroups = computed(() => {
  const groups = new Map()
  for (const opening of openings.value) {
    const date = new Date(opening.startsAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    if (!groups.has(date)) groups.set(date, [])
    groups.get(date).push(opening)
  }
  return [...groups.entries()].map(([label, slots]) => ({ label, slots }))
})

function plusDays(date, count) {
  const value = new Date(`${date}T00:00:00`)
  value.setDate(value.getDate() + count)
  return localDate(value)
}

function priceLabel(service) {
  if (!Number(service.price)) return 'Free'
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: service.currency || 'NGN', maximumFractionDigits: 0 }).format(service.price) } catch { return `${service.currency || 'NGN'} ${Number(service.price).toLocaleString()}` }
}

function slotTime(slot) {
  return new Date(slot.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function selectSlot(slot) {
  selectedSlot.value = slot
  submitError.value = ''
}

function back() {
  if (selectedSlot.value) {
    selectedSlot.value = null
    return
  }
  selectedService.value = null
  openings.value = []
}

async function start() {
  loading.value = true
  pageError.value = ''
  try {
    page.value = await loadGuestPage()
    if (page.value.services.length === 1) await choose(page.value.services[0])
  } catch (reason) {
    pageError.value = reason?.message || 'Ask the owner for a new booking link.'
  } finally {
    loading.value = false
  }
}

async function choose(service) {
  selectedService.value = service
  selectedSlot.value = null
  submitError.value = ''
  await loadOpenings()
}

async function loadOpenings() {
  if (!selectedService.value) return
  slotsLoading.value = true
  slotError.value = ''
  selectedSlot.value = null
  try {
    const result = await loadGuestOpenings(selectedService.value.id, startDate.value, plusDays(startDate.value, 6))
    openings.value = (result.openings || []).slice(0, 32)
  } catch (reason) {
    openings.value = []
    slotError.value = reason?.message || 'Availability could not load. Try again.'
  } finally {
    slotsLoading.value = false
  }
}

async function submit() {
  submitting.value = true
  submitError.value = ''
  try {
    confirmation.value = await submitGuestBooking({ serviceId: selectedService.value.id, startsAt: selectedSlot.value.startsAt, contact: { ...contact }, notes: notes.value }, crypto.randomUUID())
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (reason) {
    submitError.value = reason?.message || 'That slot could not be booked. Choose another.'
    await loadOpenings()
  } finally {
    submitting.value = false
  }
}

onMounted(start)
</script>

<template>
  <div class="public-shell">
    <header class="public-header"><a href="/" aria-label="Bookins"><BookinsLogo /></a><span><AppIcon name="lock" :size="14" />Secure booking page</span></header>
    <main>
      <div v-if="loading" class="public-state"><span class="public-spinner" /><h1>Opening the booking page…</h1><p>Checking services and available times.</p></div>
      <div v-else-if="pageError" class="public-state error-state"><span class="state-symbol">!</span><h1>This booking link is unavailable.</h1><p>{{ pageError }}</p><button class="secondary" type="button" @click="start">Try again</button></div>

      <div v-else-if="confirmation" class="confirmation-wrap">
        <article class="confirmation-card">
          <span class="confirmation-check"><AppIcon name="check" :size="30" :stroke-width="2.3" /></span><p class="eyebrow">Booking confirmed</p><h1>You are booked.</h1><p class="confirmation-copy">Your time has been reserved with {{ page.profile.displayName }}.</p>
          <div class="confirmation-event"><span><AppIcon name="calendar" :size="22" /></span><div><strong>{{ confirmation.serviceName }}</strong><small>{{ new Date(confirmation.startsAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }) }}</small><small>{{ confirmation.timezone }}</small></div></div>
          <dl><div><dt>Reference</dt><dd>{{ confirmation.reference }}</dd></div><div><dt>Confirmation</dt><dd>Saved on this screen</dd></div></dl>
          <p class="truth-note">Save this reference. Email, calendar delivery, and online payment are not included in this release.</p>
        </article>
      </div>

      <template v-else>
        <section class="host-card">
          <span v-if="!page.profile.photoUrl" class="host-avatar">{{ page.profile.displayName.slice(0, 1).toUpperCase() }}</span><img v-else :src="page.profile.photoUrl" alt="">
          <div><p class="eyebrow">Book a session with</p><h1>{{ page.profile.displayName }}</h1><p>{{ page.profile.bio }}</p><span><AppIcon name="clock" :size="14" />Times shown in {{ page.profile.timezone }}</span></div>
        </section>

        <div class="stepper" aria-label="Booking progress"><span v-for="(label, index) in ['Service', 'Time', 'Details']" :key="label" :class="{ active: step === index + 1, done: step > index + 1 }"><i>{{ step > index + 1 ? '✓' : index + 1 }}</i>{{ label }}</span></div>

        <div class="booking-card">
          <section class="booking-content">
            <button v-if="step > 1" class="back-button" type="button" @click="back"><AppIcon name="arrow-left" :size="16" />Back</button>

            <template v-if="step === 1">
              <div class="booking-heading"><p class="eyebrow">Step 1 of 3</p><h2>Choose a service</h2><p>Select the session that best fits what you need.</p></div>
              <div v-if="page.services.length" class="service-options"><button v-for="service in page.services" :key="service.id" class="service-option" type="button" @click="choose(service)"><span class="service-option-icon"><AppIcon name="sparkle" :size="19" /></span><span class="service-option-copy"><strong>{{ service.name }}</strong><small>{{ service.description }}</small><span><b><AppIcon name="clock" :size="13" />{{ service.durationMinutes }} min</b><b>{{ priceLabel(service) }}</b></span></span><AppIcon name="chevron" :size="18" /></button></div>
              <div v-else class="public-empty"><AppIcon name="calendar" :size="24" /><h2>No services are available</h2><p>Ask the owner to activate a public service, then try this link again.</p></div>
            </template>

            <template v-else-if="step === 2">
              <div class="booking-heading"><p class="eyebrow">Step 2 of 3</p><h2>Choose a date and time</h2><p>{{ selectedService.name }} · {{ selectedService.durationMinutes }} minutes</p></div>
              <div class="date-control"><label for="booking-start-date"><AppIcon name="calendar" :size="17" /><span>Show times from</span></label><input id="booking-start-date" v-model="startDate" type="date" :min="today" @change="loadOpenings"></div>
              <div v-if="slotsLoading" class="slots-loading"><span class="public-spinner small" /><p>Checking available times…</p></div>
              <div v-else-if="slotError" class="public-inline-error"><p>{{ slotError }}</p><button class="secondary small-button" type="button" @click="loadOpenings">Try again</button></div>
              <div v-else-if="openingGroups.length" class="slot-groups"><section v-for="group in openingGroups" :key="group.label"><h3>{{ group.label }}</h3><div><button v-for="slot in group.slots" :key="slot.startsAt" type="button" @click="selectSlot(slot)">{{ slotTime(slot) }}</button></div></section></div>
              <div v-else class="public-empty"><AppIcon name="clock" :size="24" /><h2>No openings in this week</h2><p>Choose another starting date to see the next seven days.</p></div>
            </template>

            <template v-else>
              <div class="booking-heading"><p class="eyebrow">Step 3 of 3</p><h2>Tell us about you</h2><p>We will use these details only for this booking.</p></div>
              <div v-if="submitError" class="public-inline-error" role="alert"><p>{{ submitError }}</p></div>
              <form class="guest-form" @submit.prevent="submit"><div class="field"><label for="booking-guest-name">Full name</label><input id="booking-guest-name" v-model.trim="contact.name" autocomplete="name" required maxlength="160" placeholder="Your name"></div><div class="field"><label for="booking-guest-email">Email address</label><input id="booking-guest-email" v-model.trim="contact.email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></div><div class="field"><label for="booking-guest-phone">Phone number, optional</label><input id="booking-guest-phone" v-model.trim="contact.phone" type="tel" autocomplete="tel" maxlength="40" placeholder="+234 800 000 0000"></div><div class="field"><label for="booking-guest-notes">Anything the host should know? <span>Optional</span></label><textarea id="booking-guest-notes" v-model.trim="notes" maxlength="2000" placeholder="Share a little context for the session."></textarea></div><button class="primary confirm-button" :disabled="submitting">{{ submitting ? 'Confirming your booking…' : 'Confirm booking' }}<AppIcon v-if="!submitting" name="chevron" :size="16" /></button><p class="fine-print">Your booking is confirmed on screen. Bookins does not promise email, calendar, or payment delivery in this release.</p></form>
            </template>
          </section>

          <aside v-if="selectedService" class="booking-summary">
            <p class="eyebrow">Your booking</p><h2>{{ selectedService.name }}</h2><p>{{ selectedService.description }}</p>
            <dl><div><dt><AppIcon name="clock" :size="15" />Duration</dt><dd>{{ selectedService.durationMinutes }} minutes</dd></div><div><dt><AppIcon name="wallet" :size="15" />Price</dt><dd>{{ priceLabel(selectedService) }}</dd></div><div v-if="selectedSlot"><dt><AppIcon name="calendar" :size="15" />Time</dt><dd>{{ new Date(selectedSlot.startsAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }}</dd></div></dl>
            <p v-if="selectedService.price" class="payment-note">Payment is arranged directly with the host.</p>
          </aside>
        </div>
      </template>
    </main>
    <footer><BookinsLogo compact /><span>Simple scheduling for African businesses.</span></footer>
  </div>
</template>

<style scoped>
.public-shell{min-height:100vh;color:#101928;background:radial-gradient(circle at 85% 8%,#e9edff 0,transparent 30%),linear-gradient(180deg,#f8f9ff 0,#fff 38%)}.public-header{height:72px;padding:0 max(22px,calc((100vw - 1120px)/2));display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(221,225,241,.9);background:rgba(255,255,255,.84);backdrop-filter:blur(14px)}.public-header>a{display:flex;text-decoration:none}.public-header>span{display:flex;align-items:center;gap:6px;color:#697087;font-size:11px}.public-shell main{max-width:1120px;margin:0 auto;padding:42px 22px 70px}.host-card{margin-bottom:26px;display:flex;align-items:center;gap:17px}.host-avatar,.host-card img{width:70px;height:70px;display:grid;place-items:center;object-fit:cover;color:#fff;border-radius:20px;background:linear-gradient(145deg,#4154ef,#2336dc);font-size:22px;font-weight:850;box-shadow:0 14px 28px rgba(35,54,220,.2)}.host-card h1{margin:0 0 4px;font-size:31px}.host-card p:not(.eyebrow){max-width:65ch;margin:0 0 7px;color:#697087;font-size:12px}.host-card div>span{display:flex;align-items:center;gap:5px;color:#4f5971;font-size:10px}.stepper{max-width:610px;margin:0 0 18px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.stepper span{min-height:40px;padding:0 10px;display:flex;align-items:center;gap:8px;color:#8a91a2;border:1px solid #e4e7ef;border-radius:10px;background:#fff;font-size:10px;font-weight:750}.stepper i{width:22px;height:22px;display:grid;place-items:center;border-radius:50%;background:#f0f2f6;font-style:normal;font-size:9px}.stepper span.active{color:#2336dc;border-color:#cfd5ff;background:#f7f8ff}.stepper span.active i{color:#fff;background:#2336dc}.stepper span.done{color:#147a4d}.stepper span.done i{color:#147a4d;background:#eaf8f1}.booking-card{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(290px,.65fr);overflow:hidden;border:1px solid #e2e5ef;border-radius:22px;background:#fff;box-shadow:0 24px 70px rgba(31,42,86,.09)}.booking-content{min-height:530px;padding:30px}.booking-summary{padding:30px;border-left:1px solid #e4e7ef;background:#f8f9fc}.booking-heading{margin-bottom:22px}.booking-heading h2{margin-bottom:5px;font-size:24px}.booking-heading>p:last-child{margin:0;color:#697087;font-size:12px}.back-button{min-height:34px;margin:0 0 17px;padding:0;display:flex;align-items:center;gap:5px;color:#697087;border:0;background:transparent;font-size:11px;font-weight:700}.service-options{display:grid;gap:10px}.service-option{width:100%;min-height:112px;padding:16px;display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:center;gap:13px;color:#101928;border:1px solid #e2e5ef;border-radius:14px;background:#fff;text-align:left;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}.service-option:hover{transform:translateY(-1px);border-color:#bfc7ff;box-shadow:0 10px 24px rgba(35,54,220,.08)}.service-option-icon{width:42px;height:42px;display:grid;place-items:center;color:#2336dc;border-radius:12px;background:#eef1ff}.service-option-copy{min-width:0;display:grid;gap:5px}.service-option-copy>strong{font-size:14px}.service-option-copy>small{overflow:hidden;color:#697087;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.service-option-copy>span{display:flex;gap:13px}.service-option-copy b{display:flex;align-items:center;gap:4px;color:#4b5670;font-size:10px}.date-control{margin-bottom:20px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:15px;border:1px solid #e2e5ef;border-radius:12px;background:#fafbfc}.date-control label{display:flex;align-items:center;gap:7px;color:#4b5670;font-size:11px;font-weight:700}.date-control input{min-height:38px;padding:0 10px;color:#101928;border:1px solid #cfd4e2;border-radius:9px;background:#fff}.slot-groups{display:grid;gap:20px}.slot-groups section h3{margin-bottom:9px;color:#344054;font-size:12px;letter-spacing:0}.slot-groups section>div{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.slot-groups button{min-height:40px;color:#2336dc;border:1px solid #cfd5ff;border-radius:9px;background:#fff;font-size:11px;font-weight:750}.slot-groups button:hover{color:#fff;background:#2336dc}.slots-loading{min-height:220px;display:grid;place-items:center;align-content:center;color:#697087}.slots-loading p{margin:10px 0 0;font-size:11px}.public-empty{min-height:230px;display:grid;place-items:center;align-content:center;color:#2336dc;text-align:center}.public-empty h2{margin:13px 0 5px;font-size:17px}.public-empty p{max-width:380px;margin:0;color:#697087;font-size:11px}.public-inline-error{margin-bottom:16px;padding:13px;color:#b42318;border:1px solid #f0c8c4;border-radius:10px;background:#fff1f0}.public-inline-error p{margin:0;font-size:11px}.public-inline-error button{margin-top:10px}.guest-form{max-width:540px}.guest-form .field{margin-bottom:14px}.guest-form label span{color:#8990a1;font-weight:500}.confirm-button{width:100%;margin-top:3px}.fine-print{margin:12px 0 0;color:#7b8293;font-size:9px;text-align:center}.booking-summary h2{font-size:20px}.booking-summary>p:not(.eyebrow):not(.payment-note){color:#697087;font-size:11px}.booking-summary dl{margin:22px 0 0;display:grid;gap:13px}.booking-summary dl div{padding-bottom:13px;border-bottom:1px solid #e3e6ee}.booking-summary dt{display:flex;align-items:center;gap:6px;color:#7a8295;font-size:9px;font-weight:750;text-transform:uppercase}.booking-summary dd{margin:6px 0 0;color:#344054;font-size:11px;font-weight:700}.payment-note{margin:18px 0 0;padding:11px;color:#8a6700;border-radius:9px;background:#fff7e5;font-size:9px}.public-state{max-width:600px;margin:120px auto;text-align:center}.public-state h1{margin-bottom:7px;font-size:29px}.public-state p{color:#697087;font-size:12px}.public-spinner{width:34px;height:34px;margin:0 auto 18px;display:block;border:3px solid #dce1ff;border-top-color:#2336dc;border-radius:50%;animation:spin .8s linear infinite}.public-spinner.small{width:26px;height:26px;margin:0}.state-symbol{width:48px;height:48px;margin:0 auto 16px;display:grid;place-items:center;color:#b42318;border-radius:50%;background:#fff1f0;font-size:22px;font-weight:850}.confirmation-wrap{max-width:640px;margin:40px auto}.confirmation-card{padding:40px;border:1px solid #e2e5ef;border-radius:22px;background:#fff;box-shadow:0 24px 70px rgba(31,42,86,.09);text-align:center}.confirmation-check{width:64px;height:64px;margin:0 auto 20px;display:grid;place-items:center;color:#fff;border-radius:50%;background:#15915a;box-shadow:0 12px 28px rgba(21,145,90,.22)}.confirmation-card h1{margin-bottom:7px}.confirmation-copy{color:#697087;font-size:12px}.confirmation-event{margin:26px 0 14px;padding:16px;display:grid;grid-template-columns:46px 1fr;align-items:center;gap:12px;border-radius:13px;background:#f5f7ff;text-align:left}.confirmation-event>span{width:44px;height:44px;display:grid;place-items:center;color:#2336dc;border-radius:12px;background:#e8ecff}.confirmation-event div{display:grid;gap:3px}.confirmation-event strong{font-size:13px}.confirmation-event small{color:#697087;font-size:10px}.confirmation-card dl{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:9px}.confirmation-card dl div{padding:13px;border:1px solid #e2e5ef;border-radius:10px}.confirmation-card dt{color:#7b8293;font-size:8px;font-weight:800;text-transform:uppercase}.confirmation-card dd{margin:5px 0 0;font-size:11px;font-weight:750}.truth-note{margin:18px 0 0;color:#7b8293;font-size:9px}.public-shell footer{max-width:1120px;margin:0 auto;padding:0 22px 32px;display:flex;align-items:center;justify-content:center;gap:8px;color:#7b8293;font-size:9px}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:820px){.public-header{height:64px;padding:0 16px}.public-header>span{font-size:9px}.public-shell main{padding:28px 14px 50px}.host-card{align-items:flex-start}.host-avatar,.host-card img{width:56px;height:56px;border-radius:16px}.host-card h1{font-size:25px}.booking-card{grid-template-columns:1fr}.booking-content{min-height:500px;padding:21px}.booking-summary{grid-row:1;padding:18px;border-left:0;border-bottom:1px solid #e4e7ef}.booking-summary>p:not(.eyebrow),.booking-summary dl,.booking-summary .payment-note{display:none}.stepper{max-width:none}.slot-groups section>div{grid-template-columns:repeat(3,minmax(0,1fr))}.date-control{align-items:flex-start;flex-direction:column}.date-control input{width:100%}}@media(max-width:480px){.stepper span{justify-content:center;font-size:0}.stepper i{font-size:9px}.slot-groups section>div{grid-template-columns:repeat(2,minmax(0,1fr))}.service-option{grid-template-columns:40px minmax(0,1fr)}.service-option>svg{display:none}.service-option-copy>small{white-space:normal}.confirmation-card{padding:26px 18px}.confirmation-card dl{grid-template-columns:1fr}}
@media(max-width:480px){.stepper span{gap:5px;font-size:9px}}
</style>
