<script setup>
import { formatDay } from '../format-date.js'
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import BookinsLogo from '../components/BookinsLogo.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmConfirm from '../components/ui/GmConfirm.vue'
import GmHint from '../components/ui/GmHint.vue'
import { useSetupState } from '../setup.js'
import GmSelect from '../components/ui/GmSelect.vue'
import QrCode from '../components/QrCode.vue'
import { copyText, createPublicLink, hasTeam, isLocalPreview, isOwnerMember, isStaffCopy, isTimeOff, revokePublicLink, saveMessageTemplates, saveProfile, staffForBooking } from '../booking.js'
import {
  CHANNELS,
  DEFAULT_TEMPLATES,
  JOURNEY_SLOTS,
  SLOT_LABELS,
  TEMPLATE_KINDS,
  TEMPLATE_VARIABLES,
  messageVars,
  renderTemplate,
  resolveTemplateConfig,
  serializeTemplates,
  whatsappShareUrl,
} from '../messaging.js'
import { isDemo, registerDemoGuard } from '../runtime.js'

import { displayTimeZone, timezoneOptions } from '../time-display.js'

const timezoneItems = computed(() => timezoneOptions(form.timezone))
const state = inject('bookingState')
const refresh = inject('refreshBookings')
const toast = inject('toast', null)
const setup = useSetupState()
const router = useRouter()
const route = useRoute()
const saving = ref(false)
const linking = ref(false)
const revoking = ref(false)
const busy = computed(() => saving.value || linking.value || revoking.value)
const confirmRevoke = ref(false)
const linkHeading = ref(null)
const copied = ref(false)
const error = ref('')
const form = reactive({ displayName: '', bio: '', timezone: 'Africa/Lagos', photoUrl: '' })
const profileBaseline = ref('')
const leavePrompt = ref(false)
const pendingRoute = ref('')
const allowLeave = ref(false)
const publicUrl = computed(() => state.profile?.public_link_url || '')
const clock = ref(Date.now())
const clockTimer = window.setInterval(() => { clock.value = Date.now() }, 60_000)
const remoteChanged = ref(false)
const revokedUrl = ref('')
const expiresMs = computed(() => Date.parse(state.profile?.public_link_expires_at || ''))
const linkExpired = computed(() => Boolean(publicUrl.value) && Number.isFinite(expiresMs.value) && expiresMs.value <= clock.value)
const expires = computed(() =>
  Number.isFinite(expiresMs.value)
    ? formatDay(expiresMs.value)
    : 'Unknown',
)
const scheduleZone = computed(() => state.schedules[0]?.timezone || '')
const zoneMismatch = computed(() => Boolean(scheduleZone.value) && form.timezone !== scheduleZone.value)
const localPreview = isLocalPreview()
const hasPublicService = computed(() => state.services.some((item) => item.active !== false && item.visibility === 'public'))
const canShare = computed(() => Boolean(state.profile?.id && state.schedules.length && hasPublicService.value))
const missingForLink = computed(() => {
  const missing = []
  if (!state.profile?.id) missing.push('save your profile (a display name)')
  if (!state.schedules.length) missing.push('set your weekly hours')
  if (!hasPublicService.value) missing.push('add an active, public service')
  return missing
})
const linkBlockReason = computed(() => {
  if (isDemo.value) return 'Demo is read-only. Guest preview does not create public links.'
  if (!missingForLink.value.length) return ''
  return `Before you can create a link: ${missingForLink.value.join(', ')}.`
})
const initials = computed(
  () =>
    form.displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'B',
)

onMounted(() => {
  if (!state.profile) {
    profileBaseline.value = normalizeProfile(form)
    return
  }
  syncProfileDraft()
})

watch(
  () => state.profile,
  () => {
    if (busy.value) return
    if (dirty.value) remoteChanged.value = true
    else syncProfileDraft()
  },
)

async function reloadChecked() {
  return (await refresh()) === true
}
const STALE_MESSAGE = 'Saved, but Bookins could not reload your workspace, so what you see may be out of date. Use Refresh to check.'

// Link operations must never persist the unsaved draft: merge link fields onto the stored profile.
const storedProfileInput = (link) => ({
  displayName: state.profile?.display_name || '',
  bio: state.profile?.bio || '',
  timezone: state.profile?.timezone || 'Africa/Lagos',
  photoUrl: state.profile?.photo_url || '',
  publicLinkUrl: link.url,
  publicLinkExpiresAt: link.expiresAt,
})

function normalizeProfile(value) {
  return JSON.stringify({
    displayName: String(value.displayName || '').trim(),
    bio: String(value.bio || '').trim(),
    timezone: String(value.timezone || '').trim(),
    photoUrl: String(value.photoUrl || '').trim(),
  })
}

function syncProfileDraft() {
  remoteChanged.value = false
  Object.assign(form, {
    displayName: state.profile?.display_name || '',
    bio: state.profile?.bio || '',
    timezone: state.profile?.timezone || 'Africa/Lagos',
    photoUrl: state.profile?.photo_url || '',
  })
  profileBaseline.value = normalizeProfile(form)
}

const dirty = computed(() => normalizeProfile(form) !== profileBaseline.value)
const removeModeGuard = registerDemoGuard('bookins-settings', () => {
  if (busy.value) return 'Wait for the current settings action to finish.'
  if (dirty.value) return 'Finish or discard your unsaved profile changes before switching modes.'
  if (templatesDirty.value || savingTemplates.value) return 'Save or discard your message journey edits before switching modes.'
  return ''
})
onBeforeUnmount(() => {
  removeModeGuard()
  window.clearTimeout(copiedTimer)
  window.clearInterval(clockTimer)
  window.clearTimeout(copiedKeyTimer)
  window.removeEventListener('scroll', updateActiveSection)
  window.removeEventListener('resize', updateActiveSection)
})

onBeforeRouteLeave((to) => {
  if (busy.value) { error.value = 'Wait for the current settings action to finish before leaving.'; return false }
  if (allowLeave.value) {
    allowLeave.value = false
    return true
  }
  if (!dirty.value && !templatesDirty.value) return true
  pendingRoute.value = to.fullPath
  leavePrompt.value = true
  return false
})

function discardChanges() {
  if (busy.value) return
  Object.assign(form, {
    displayName: state.profile?.display_name || '',
    bio: state.profile?.bio || '',
    timezone: state.profile?.timezone || 'Africa/Lagos',
    photoUrl: state.profile?.photo_url || '',
  })
  profileBaseline.value = normalizeProfile(form)
  reseedJourney()
  leavePrompt.value = false
  const route = pendingRoute.value
  pendingRoute.value = ''
  if (route) {
    allowLeave.value = true
    router.push(route)
  }
}

function keepEditing() {
  leavePrompt.value = false
  pendingRoute.value = ''
}

function flash(message, options) {
  return toast?.(message, options)
}
// The "Profile saved [Create booking link]" toast is stale as soon as a link exists.
let profileToastId = 0
function dismissProfileToast() {
  if (profileToastId) toast?.dismiss?.(profileToastId)
  profileToastId = 0
}
watch(publicUrl, (url) => { if (url) dismissProfileToast() })
function failToast(message) {
  toast?.error?.(message)
}
function goTo(path) { router.push(path) }
function profileNextAction() {
  const next = setup.value.nextStep
  if (!next || next.key === 'profile' || next.key === 'done') return undefined
  if (next.key === 'availability') return { label: 'Set your hours', onClick: () => goTo('/availability') }
  if (next.key === 'service') return { label: 'Create a service', onClick: () => goTo('/services') }
  return { label: 'Create booking link', onClick: () => goToSection('settings-link') }
}

async function submit() {
  if (isDemo.value || busy.value) return
  saving.value = true
  error.value = ''
  try {
    await saveProfile(state.profile, {
      ...form,
      publicLinkUrl: publicUrl.value,
      publicLinkExpiresAt: state.profile?.public_link_expires_at || '',
    })
    if (await reloadChecked()) {
      syncProfileDraft()
      const action = profileNextAction()
      dismissProfileToast()
      const id = flash(action ? 'Profile saved' : 'Profile saved. Guests will see these details on your booking page.', action ? { action, duration: 8000 } : undefined)
      if (action) profileToastId = id || 0
    } else {
      profileBaseline.value = normalizeProfile(form)
      failToast(STALE_MESSAGE)
    }
  } catch (reason) {
    failToast(reason?.message || 'The profile could not be saved.')
  } finally {
    saving.value = false
  }
}

async function createLink() {
  if (isDemo.value || busy.value) return
  if (!state.profile?.id) {
    failToast('Save your profile before creating a booking link.')
    return
  }
  linking.value = true
  error.value = ''
  const previousUrl = publicUrl.value
  let url = ''
  try {
    const result = await createPublicLink({ kind: 'profile' })
    url = `${location.origin}${result.routePath || '/book'}#${result.token}`
    try {
      await saveProfile(state.profile, storedProfileInput({ url, expiresAt: result.expiresAt }))
    } catch (reason) {
      let cleanup = ''
      try {
        await revokePublicLink(url)
        cleanup = ' The new link was revoked, so nothing was left active.'
      } catch {
        cleanup = ' The new link could not be revoked and may still be live, but Bookins did not store it, so you cannot copy or revoke it here. Contact support if this matters.'
      }
      throw new Error(`${reason?.message || 'The profile could not store the new link.'}${cleanup}`)
    }
    if (previousUrl) {
      // Best effort: retire the expired grant so it cannot linger.
      try { await revokePublicLink(previousUrl) } catch { /* already expired or gone */ }
    }
    dismissProfileToast()
    if (await reloadChecked()) {
      if (!dirty.value) syncProfileDraft()
      dismissProfileToast()
      flash('Booking link created. Copy it or use the share kit.', { duration: 6000, action: { label: 'Copy link', onClick: copy } })
    } else {
      failToast(STALE_MESSAGE)
    }
  } catch (reason) {
    failToast(reason?.message || 'The public link could not be created.')
  } finally {
    linking.value = false
  }
}

async function revoke() {
  if (isDemo.value || busy.value) return
  if (!state.profile?.id) return
  revoking.value = true
  error.value = ''
  try {
    const url = publicUrl.value
    // If an earlier attempt already revoked the grant but failed to clear the profile, only retry the clear.
    if (revokedUrl.value !== url) {
      await revokePublicLink(url)
      revokedUrl.value = url
    }
    try {
      await saveProfile(state.profile, storedProfileInput({ url: '', expiresAt: '' }))
    } catch (reason) {
      throw new Error(`The link was revoked, but your profile still lists it (${reason?.message || 'save failed'}). Press Revoke again to finish clearing it.`)
    }
    revokedUrl.value = ''
    confirmRevoke.value = false
    if (await reloadChecked()) {
      if (!dirty.value) syncProfileDraft()
      flash('Booking link revoked. Anyone opening it now sees an expired-link page.')
    } else {
      failToast(STALE_MESSAGE)
    }
    await nextTick()
    linkHeading.value?.focus()
  } catch (reason) {
    failToast(reason?.message || 'The public link could not be revoked.')
  } finally {
    revoking.value = false
  }
}

let copiedTimer = 0
async function copy() {
  try {
    await copyText(publicUrl.value)
    copied.value = true
    toast?.('Booking link copied')
    window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => { copied.value = false }, 1600)
  } catch {
    failToast('Your browser blocked copying. Select the link above and copy it manually.')
  }
}

// ----- share kit -----
const shareReady = computed(() => Boolean(publicUrl.value) && !linkExpired.value)
const shareName = computed(() => state.profile?.display_name || form.displayName || 'me')
const shareText = computed(() => `Hi! You can book a time with ${shareName.value} here: ${publicUrl.value}`)
const whatsappShare = computed(() => whatsappShareUrl(shareText.value))
const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const BUTTON_STYLE =
  'display:inline-block;padding:12px 22px;background:#2336dc;color:#ffffff;border-radius:8px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;font-weight:600;line-height:1.2;text-decoration:none'
const buttonSnippet = computed(
  () => `<a href="${escapeAttr(publicUrl.value)}" target="_blank" rel="noopener" style="${BUTTON_STYLE}">Book an appointment</a>`,
)
const copiedKey = ref('')
let copiedKeyTimer = 0
async function copyShare(key, value) {
  try {
    await copyText(value)
    copiedKey.value = key
    toast?.(key === 'snippet' ? 'Button code copied' : 'Booking link copied')
    window.clearTimeout(copiedKeyTimer)
    copiedKeyTimer = window.setTimeout(() => { copiedKey.value = '' }, 1600)
  } catch {
    failToast('Your browser blocked copying. Select the text and copy it manually.')
  }
}

// ----- in-page section nav -----
const sections = [
  { id: 'settings-profile', label: 'Profile' },
  { id: 'settings-link', label: 'Booking link & share kit' },
  { id: 'settings-templates', label: 'Message journey' },
  { id: 'settings-delivery', label: 'Delivery status' },
]
const activeSection = ref(sections[0].id)
let scrollLock = 0
function goToSection(id) {
  activeSection.value = id
  scrollLock = Date.now() + 900
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}
// Scroll-spy: the active section is the last one whose top has passed the sticky header zone.
function updateActiveSection() {
  if (Date.now() < scrollLock) return
  const line = window.innerHeight * 0.3
  let current = sections[0].id
  for (const section of sections) {
    const element = document.getElementById(section.id)
    if (element && element.getBoundingClientRect().top <= line) current = section.id
  }
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = sections[sections.length - 1].id
  activeSection.value = current
}
onMounted(() => {
  window.addEventListener('scroll', updateActiveSection, { passive: true })
  window.addEventListener('resize', updateActiveSection)
  updateActiveSection()
  // Deep links such as /settings#settings-templates (from Messages) jump to that section.
  const target = route.hash.replace(/^#/, '')
  if (target && sections.some((item) => item.id === target)) nextTick(() => goToSection(target))
})

// ----- message journey -----
const JOURNEY_KINDS = [...JOURNEY_SLOTS, 'reschedule', 'cancellation']
const CHANNEL_LABELS = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' }
const SLOT_WHEN = {
  confirmation: 'For a new booking. Open it from Bookings right after someone books.',
  reminder24: 'Listed on Messages from 24 hours before the appointment.',
  reminder2: 'Listed on Messages from 2 hours before the appointment.',
  prep: 'Listed on Messages from 48 hours before, only for services that have prep notes.',
  thanks: 'Listed on Messages for 24 hours after a visit is marked completed.',
  rebook: 'Listed on Messages when a client is due back, per the service\'s "rebook after" days, and has no newer booking.',
  reschedule: 'For a booking that moved. Open it from Bookings after you reschedule.',
  cancellation: 'For a cancelled booking. Open it from Bookings after you cancel.',
}
const SLOT_TABS = {
  confirmation: 'Confirmation',
  reminder24: 'Reminder 24h',
  reminder2: 'Reminder 2h',
  prep: 'Prep / arrival info',
  thanks: 'Thank-you',
  rebook: 'Rebook nudge',
  reschedule: 'Rescheduled',
  cancellation: 'Cancelled',
}
const VARIABLE_NAMES = TEMPLATE_VARIABLES.filter((name) => !['offer', 'offer_code', 'offer_expires'].includes(name))
const VARIABLE_HELP = {
  staff: 'The team member the booking is with. Empty when you work alone.',
  prep_notes: 'The prep notes saved on the service (Services page). Empty when the service has none.',
  booking_link: 'Your public booking link.',
  rebook_link: 'The link a client uses to book again (your booking link).',
  business_phone: 'The number you put in your bio as [[wa:+234...]]. Empty if you did not add one.',
}
const SMS_PART = 160

// Always carries every kind (including ones this page does not show) so saving never drops saved wording.
const cloneJourney = (config) => ({
  templates: Object.fromEntries(
    TEMPLATE_KINDS.map((kind) => {
      const slot = config.templates[kind]
      return [kind, { channel: slot.channel, subject: slot.subject, body: slot.body, enabled: slot.enabled !== false }]
    }),
  ),
  overrides: JSON.parse(JSON.stringify(config.serviceOverrides || {})),
})
const journey = reactive(cloneJourney(resolveTemplateConfig(state.profile)))
const journeyPayload = () => serializeTemplates({ templates: journey.templates, serviceOverrides: journey.overrides })
const serializedJourney = () => JSON.stringify(journeyPayload())
const journeyBaseline = ref(serializedJourney())
const templatesDirty = computed(() => serializedJourney() !== journeyBaseline.value)
const showSaveBar = computed(() => !isDemo.value && (dirty.value || templatesDirty.value))
const activeKind = ref(JOURNEY_KINDS[0])
const savingTemplates = ref(false)
function reseedJourney() {
  const fresh = cloneJourney(resolveTemplateConfig(state.profile))
  for (const key of Object.keys(journey.overrides)) delete journey.overrides[key]
  Object.assign(journey.templates, fresh.templates)
  Object.assign(journey.overrides, fresh.overrides)
  journeyBaseline.value = serializedJourney()
}
watch(
  () => state.profile?.message_templates_json,
  () => {
    if (savingTemplates.value || templatesDirty.value) return
    reseedJourney()
  },
)
// A browser refresh or tab close with unsaved wording asks first.
const warnBeforeUnload = (event) => {
  if (isDemo.value || (!dirty.value && !templatesDirty.value)) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', warnBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload))

// Preview: a real recent booking, or a sample.
const SAMPLE_KEY = '__sample'
const previewPick = ref('')
// Soonest upcoming bookings first (what reminders are about), then the most recent past ones.
const recentBookings = computed(() => {
  const nowMs = Date.now()
  const real = state.bookings.filter((item) => !isTimeOff(item) && item.guest_name && item.status !== 'cancelled' && Number.isFinite(Date.parse(item.starts_at)))
  const upcoming = real.filter((item) => Date.parse(item.starts_at) >= nowMs).sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at))
  const past = real.filter((item) => Date.parse(item.starts_at) < nowMs).sort((left, right) => Date.parse(right.starts_at) - Date.parse(left.starts_at))
  return [...upcoming, ...past].slice(0, 8)
})
const sampleBooking = computed(() => {
  const start = new Date(Date.now() + 2 * 86_400_000)
  start.setMinutes(0, 0, 0)
  const service = state.services.find((item) => item.active !== false && !isStaffCopy(item)) || state.services[0]
  return {
    id: SAMPLE_KEY,
    guest_name: 'Ada Obi',
    service_id: service?.id || '',
    service_name: service?.name || 'Consultation',
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + (Number(service?.duration_minutes) || 30) * 60_000).toISOString(),
    timezone: state.schedules[0]?.timezone || state.profile?.timezone || 'UTC',
    reference: 'BK-SAMPLE',
  }
})
const previewOptions = computed(() => [
  ...recentBookings.value.map((item) => ({
    value: item.id,
    label: `${item.guest_name} · ${item.service_name || 'Booking'} · ${new Date(item.starts_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`,
  })),
  { value: SAMPLE_KEY, label: 'Sample booking (Ada Obi)' },
])
const previewKey = computed(() => (previewOptions.value.some((option) => option.value === previewPick.value) ? previewPick.value : previewOptions.value[0].value))
const previewBooking = computed(() => recentBookings.value.find((item) => item.id === previewKey.value) || sampleBooking.value)
const previewIsReal = computed(() => previewBooking.value.id !== SAMPLE_KEY)
const serviceById = (id) => state.services.find((item) => item.id === id)
function varsFor(booking, service) {
  const sampleService = previewIsReal.value || service?.prep_notes ? service : service && { ...service, prep_notes: 'Arrive 10 minutes early with a clean, dry face.' }
  return messageVars(booking, {
    profile: state.profile,
    service: sampleService,
    timezone: state.schedules[0]?.timezone,
    bookingLink: publicUrl.value,
    rebookLink: publicUrl.value,
    // The implicit owner has no separate staff name: let the preview fall back to the business name.
    staff: hasTeam(state) && previewIsReal.value ? (isOwnerMember(staffForBooking(state, booking)) ? { implicit: true } : staffForBooking(state, booking)) : null,
  })
}
const previewVars = computed(() => varsFor(previewBooking.value, serviceById(previewBooking.value.service_id)))
const renderPreview = (text, vars = previewVars.value) => renderTemplate(text, vars)
const previewSubject = (kind) => renderPreview(journey.templates[kind].subject)
const previewBody = (kind) => renderPreview(journey.templates[kind].body)
const usesVariable = (text, name) => new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(text)
const missingPrepNote = (kind) =>
  [journey.templates[kind].body, ...Object.values(journey.overrides).map((per) => per[kind]?.body || '')].some((text) => usesVariable(text, 'prep_notes')) &&
  !previewVars.value.prep_notes
const overrideMissingPrep = (kind, serviceId) => {
  const service = serviceById(serviceId)
  const booking = { ...previewBooking.value, service_id: serviceId, service_name: service?.name || previewBooking.value.service_name }
  return usesVariable(journey.overrides[serviceId][kind].body, 'prep_notes') && !varsFor(booking, service).prep_notes
}
const smsParts = (kind) => Math.max(1, Math.ceil(previewBody(kind).length / SMS_PART))

const isDefault = (kind) => {
  const slot = journey.templates[kind]
  const base = DEFAULT_TEMPLATES[kind]
  return slot.subject === base.subject && slot.body === base.body && slot.channel === 'whatsapp' && slot.enabled !== false
}
const resetReason = (kind) => (isDemo.value ? 'Demo is read-only.' : isDefault(kind) ? 'Already using the default wording, channel and setting.' : '')

// Variable insertion at the cursor of whichever field was focused last (subject, message, or a service override).
const variableToken = (name) => '{' + '{' + name + '}' + '}'
const fieldElements = {}
const lastField = reactive({})
const setField = (kind, field) => (element) => {
  if (element) fieldElements[`${kind}:${field}`] = element
}
const fieldValue = (kind, field) => (field.startsWith('ov:') ? journey.overrides[field.slice(3)]?.[kind]?.body ?? '' : journey.templates[kind][field])
function writeField(kind, field, value) {
  if (field.startsWith('ov:')) {
    const entry = journey.overrides[field.slice(3)]?.[kind]
    if (entry) entry.body = value
  } else journey.templates[kind][field] = value
}
function insertVariable(kind, name) {
  if (isDemo.value || savingTemplates.value) return
  let field = lastField[kind] || 'body'
  let element = fieldElements[`${kind}:${field}`]
  if (!element || !element.isConnected) { field = 'body'; element = fieldElements[`${kind}:body`] }
  const token = variableToken(name)
  const current = fieldValue(kind, field) || ''
  const start = element?.selectionStart ?? current.length
  const end = element?.selectionEnd ?? start
  writeField(kind, field, current.slice(0, start) + token + current.slice(end))
  nextTick(() => {
    if (!element) return
    element.focus()
    const caret = start + token.length
    element.setSelectionRange(caret, caret)
  })
}
function resetTemplate(kind) {
  if (isDemo.value || savingTemplates.value) return
  Object.assign(journey.templates[kind], { ...DEFAULT_TEMPLATES[kind], channel: 'whatsapp', enabled: true })
  toast?.info?.(`${SLOT_LABELS[kind]} is back to the default wording. Save to keep it.`)
}

// Per-service overrides: a different message body for one service (for example prep notes for one treatment).
const overridableServices = computed(() => state.services.filter((item) => item.active !== false && !isStaffCopy(item)))
const serviceName = (id) => serviceById(id)?.name || 'Removed service'
const overridesFor = (kind) => Object.entries(journey.overrides).filter(([, per]) => per?.[kind]).map(([id]) => ({ id, name: serviceName(id) }))
const overrideOptions = (kind) =>
  overridableServices.value.filter((item) => !journey.overrides[item.id]?.[kind]).map((item) => ({ value: item.id, label: item.name }))
function addOverride(kind, serviceId) {
  if (!serviceId || isDemo.value || savingTemplates.value) return
  journey.overrides[serviceId] ||= {}
  journey.overrides[serviceId][kind] = { body: journey.templates[kind].body }
  lastField[kind] = `ov:${serviceId}`
  toast?.info?.(`Added a ${serviceName(serviceId)} version of this message. Save to keep it.`)
}
function removeOverride(kind, serviceId) {
  if (isDemo.value || savingTemplates.value) return
  if (!journey.overrides[serviceId]) return
  delete journey.overrides[serviceId][kind]
  if (!Object.keys(journey.overrides[serviceId]).length) delete journey.overrides[serviceId]
  if (lastField[kind] === `ov:${serviceId}`) lastField[kind] = 'body'
  toast?.info?.(`Removed the ${serviceName(serviceId)} version. Save to keep this change.`)
}
const overridePreview = (kind, serviceId) => {
  const service = serviceById(serviceId)
  const booking = { ...previewBooking.value, service_id: serviceId, service_name: service?.name || previewBooking.value.service_name }
  return renderTemplate(journey.overrides[serviceId][kind].body, varsFor(booking, service))
}

async function saveTemplates() {
  if (isDemo.value || savingTemplates.value || busy.value) return
  if (!state.profile?.id) {
    failToast('Save your profile before saving your message journey.')
    return
  }
  savingTemplates.value = true
  error.value = ''
  try {
    await saveMessageTemplates(state.profile, journeyPayload())
    if (await reloadChecked()) {
      reseedJourney()
      flash('Message journey saved. New messages use your wording.')
    } else {
      journeyBaseline.value = serializedJourney()
      failToast(STALE_MESSAGE)
    }
  } catch (reason) {
    failToast(reason?.message || 'Your message journey could not be saved.')
  } finally {
    savingTemplates.value = false
  }
}
</script>

<template>
  <section>
    <div class="page-header">
      <div
        ><p class="eyebrow">Configuration</p><h1>Settings</h1
        ><p class="lede"
          >Update your public profile and manage the link guests use to book with you.</p
        ></div
      >
      <span class="chip accent version-chip">Bookins v0.6.0 candidate</span>
    </div>

    <div v-if="error" class="notice error" role="alert"><AppIcon name="info" :size="18" />{{ error }}</div>
    <div v-if="!isDemo && remoteChanged" class="notice warning" role="status">
      <AppIcon name="info" :size="18" />
      <span>A newer saved profile was loaded from your workspace. Your unsaved edits are still shown.</span>
      <button class="secondary small-button notice-action" type="button" :disabled="busy" @click="syncProfileDraft">Load saved version</button>
    </div>

    <div class="settings-shell">
      <nav class="settings-nav" aria-label="Settings sections">
        <button
          v-for="item in sections"
          :key="item.id"
          type="button"
          :class="{ 'is-active': activeSection === item.id }"
          :aria-current="activeSection === item.id ? 'true' : undefined"
          @click="goToSection(item.id)"
          >{{ item.label }}</button
        >
      </nav>

      <div class="settings-content">
        <form
          id="settings-profile"
          class="card profile-form"
          data-tour="tour-settings-profile"
          @submit.prevent="submit"
        >
          <div class="section-heading"
            ><div
              ><p class="eyebrow">Public profile <span v-if="!state.profile?.id" class="chip warning">Not saved yet</span></p><h2>How guests see you</h2
              ><p class="muted">This information appears at the top of your booking page.</p></div
            ></div
          >
          <div class="profile-identity"
            ><span
              v-if="!form.photoUrl"
              class="profile-avatar"
              >{{ initials }}</span
            ><img
              v-else
              :src="form.photoUrl"
              alt="Profile preview"
            /><div
              ><strong>{{ form.displayName || 'Your display name' }}</strong
              ><small>{{ form.timezone }}</small></div
            ></div
          >
          <div class="form-section">
            <div class="field"
              ><label for="profile-name">Display name <GmHint text="The name guests see at the top of your booking page and in confirmations. Use your own name or your business name." label="About display name" /></label
              ><input
                id="profile-name"
                v-model.trim="form.displayName"
                :disabled="isDemo || busy"
                maxlength="160"
                required
                placeholder="Your name or business"
            /></div>
            <div class="field"
              ><label for="profile-bio">Short bio</label
              ><textarea
                id="profile-bio"
                v-model.trim="form.bio"
                :disabled="isDemo || busy"
                maxlength="1500"
                placeholder="Tell guests what you help with and what to expect."
              ></textarea
              ><p class="field-hint">{{ form.bio.length }}/1500 characters</p></div
            >
          </div>
          <div class="form-section">
            <div class="field"
              ><label for="profile-timezone">Booking timezone <GmHint text="Your schedule's timezone is what bookings actually use. Keep this the same as the timezone on the Availability page." label="About booking timezone" /></label
              ><GmSelect id="profile-timezone" v-model="form.timezone" :options="timezoneItems" label="Booking timezone" :disabled="isDemo || busy" required described-by="profile-timezone-help" />
                <p id="profile-timezone-help" class="field-hint">Shown on your booking page. Type a city name to search.</p
              ><p v-if="zoneMismatch" class="field-hint zone-warning" role="status">Your schedule runs in {{ displayTimeZone(scheduleZone) }}, and bookings use the schedule timezone. <button class="ghost small-button" type="button" :disabled="busy" @click="form.timezone = scheduleZone">Use {{ scheduleZone }}</button></p
            ></div>
            <div class="field"
              ><label for="profile-photo">Photo URL</label
              ><input
                id="profile-photo"
                v-model.trim="form.photoUrl"
                :disabled="isDemo || busy"
                type="url"
                placeholder="https://example.com/photo.jpg"
              /><p class="field-hint">Use a square image with a public HTTPS URL.</p></div
            >
          </div>
          <div class="profile-actions stack-sm">
            <GmButton
              type="submit"
              variant="primary"
              :pending="saving"
              pending-label="Saving…"
              :disabled="busy && !saving"
              :disabled-reason="isDemo ? 'Demo is read-only.' : !form.displayName ? 'Enter a display name first.' : state.profile?.id && !dirty ? 'Saved. Change something to save again.' : ''"
              reason-visible
              >Save profile</GmButton
            >
          </div>
        </form>

        <div id="settings-link" class="link-section">
          <article class="card booking-page-card" data-tour="tour-settings-link">
            <div class="booking-card-mark"><BookinsLogo compact /></div>
            <p class="eyebrow">Public booking page</p>
            <h2 ref="linkHeading" tabindex="-1">{{ linkExpired ? 'Your link has expired' : publicUrl ? 'Your link is active' : 'Create your booking link' }}</h2>
            <p class="muted"
              >{{ publicUrl ? 'This link is connected to this Bookins workspace and App version.' : 'Create a link for this Bookins workspace and App version.' }} Guests can only read your public
              profile, see available times, and make a booking.</p
            >

            <template v-if="publicUrl">
              <div class="link-box"
                ><AppIcon
                  name="link"
                  :size="17"
                /><code>{{ publicUrl }}</code></div
              >
              <div class="link-status" :class="{ expired: linkExpired }"
                ><span><i />{{ linkExpired ? 'Expired' : 'Active' }}</span><small>{{ linkExpired ? 'Expired' : 'Expires' }} {{ expires }} <GmHint text="Booking links expire for your guests' safety. Before it does, create a new link here and share that one instead; the old one stops working." label="About link expiry" /></small></div
              >
              <p v-if="linkExpired" class="readiness-hint">Guests opening this link now see an expired-link page. Create a new link and share it again.</p>
              <div class="form-actions"
                ><button
                  v-if="linkExpired"
                  class="primary"
                  type="button"
                  :disabled="busy || !canShare || isDemo"
                  @click="createLink"
                  >{{ linking ? 'Creating…' : 'Create new link' }}</button
                ><button
                  class="primary"
                  type="button"
                  @click="copy"
                  ><AppIcon
                    name="copy"
                    :size="16"
                  />{{ copied ? 'Copied' : 'Copy link' }}</button
                ><a
                  class="secondary"
                  :href="publicUrl"
                  target="_blank"
                  rel="noreferrer"
                  >Preview<AppIcon
                    name="external"
                    :size="15" /></a
              ></div>
              <p v-if="localPreview" class="readiness-hint">Local preview: the Preview tab cannot see this browser's in-memory sample data, so it may say the link is no longer valid. Hosted links work normally.</p>
              <p class="readiness-hint">Want a link for one service? Create it from that service on the <router-link to="/services">Services page</router-link> <GmHint text="A service direct link opens straight to that service, so guests skip choosing one. It is separate from this profile link and has its own expiry." label="About per-service links" />.</p>
              <div class="revoke-row">
                <GmConfirm
                  v-model:open="confirmRevoke"
                  title="Stop this booking link?"
                  message="Anyone opening it will see an expired-link page. Your profile, services and existing bookings stay intact."
                  confirm-label="Revoke link"
                  cancel-label="Keep link"
                  tone="danger"
                  :busy="revoking"
                  @confirm="revoke"
                >
                  <button
                    class="secondary small-button revoke-link"
                    type="button"
                    :disabled="isDemo || busy"
                    @click="confirmRevoke = true"
                    >Revoke this booking link</button
                  >
                </GmConfirm>
              </div>
            </template>
            <template v-else>
              <ul class="readiness-list" aria-label="What you need before creating a link">
                <li :class="{ done: state.profile?.id }">
                  <AppIcon :name="state.profile?.id ? 'check' : 'chevron'" :size="14" />
                  <span>Saved profile</span>
                  <button v-if="!state.profile?.id" class="ghost small-button" type="button" @click="goToSection('settings-profile')">Save profile</button>
                </li>
                <li :class="{ done: state.schedules.length }">
                  <AppIcon :name="state.schedules.length ? 'check' : 'chevron'" :size="14" />
                  <span>Weekly availability</span>
                  <router-link v-if="!state.schedules.length" class="ghost small-button" to="/availability">Set hours</router-link>
                </li>
                <li :class="{ done: hasPublicService }">
                  <AppIcon :name="hasPublicService ? 'check' : 'chevron'" :size="14" />
                  <span>Active public service</span>
                  <router-link v-if="!hasPublicService" class="ghost small-button" to="/services">Add service</router-link>
                </li>
              </ul>
              <div class="stack-sm">
                <GmButton
                  class="create-link"
                  variant="primary"
                  :pending="linking"
                  pending-label="Creating…"
                  :disabled="busy && !linking"
                  :disabled-reason="linkBlockReason"
                  reason-visible
                  @click="createLink"
                  >Create booking link</GmButton
                >
              </div>
            </template>
          </article>

          <article v-if="shareReady" class="card share-card">
            <p class="eyebrow">Share kit</p>
            <h2>Get your link in front of guests</h2>
            <div class="share-top">
              <div class="share-qr"><QrCode :value="publicUrl" :size="160" label="QR code for your booking link" filename="bookins-booking-link.png" /></div>
              <div class="share-actions">
                <p class="muted">Print the QR code or send the link where your guests already are.</p>
                <a class="primary" :href="whatsappShare" target="_blank" rel="noreferrer">Share on WhatsApp<AppIcon name="external" :size="15" /></a>
                <button class="secondary" type="button" @click="copyShare('link', publicUrl)">{{ copiedKey === 'link' ? 'Copied' : 'Copy link' }}</button>
              </div>
            </div>
            <div class="form-section">
              <div class="field">
                <label for="share-snippet">Website button</label>
                <textarea id="share-snippet" class="snippet" readonly rows="4" :value="buttonSnippet" @focus="$event.target.select()"></textarea>
                <p class="field-hint">Paste this into your website or bio. It is a plain link with no script or embed.</p>
              </div>
              <div class="form-actions">
                <button class="secondary" type="button" @click="copyShare('snippet', buttonSnippet)">{{ copiedKey === 'snippet' ? 'Copied' : 'Copy button code' }}</button>
              </div>
              <div class="snippet-preview" aria-label="Button preview">
                <span class="field-label">Preview</span>
                <a :href="publicUrl" target="_blank" rel="noopener" :style="BUTTON_STYLE">Book an appointment</a>
              </div>
            </div>
          </article>
        </div>

        <section id="settings-templates" class="card templates-card" aria-labelledby="templates-title">
          <p class="eyebrow">Message journey</p>
          <h2 id="templates-title">Messages to your clients <GmHint text="Each step of the client journey has its own wording. Bookins fills in the booking details, then opens the message in your own WhatsApp, SMS or email app. You press send yourself." label="About the message journey" /></h2>
          <p class="muted">These open in your own WhatsApp, SMS, or email app. Bookins does not send anything for you and cannot see whether you pressed send.</p>
          <div class="field preview-pick">
            <label for="journey-preview-booking">Preview with <GmHint text="The preview fills the variables from a real recent booking so you see exactly what a client gets. Pick another booking, or the sample." label="About the preview" /></label>
            <GmSelect id="journey-preview-booking" :model-value="previewKey" :options="previewOptions" label="Booking used for the preview" @update:model-value="previewPick = $event" />
            <p class="field-hint">{{ previewIsReal ? 'Using a real booking from your workspace.' : 'No bookings yet, so the preview uses a sample.' }}</p>
          </div>
          <div class="tab-bar template-tabs" role="group" aria-label="Choose a message">
            <button
              v-for="kind in JOURNEY_KINDS"
              :key="kind"
              type="button"
              :class="{ 'is-active': activeKind === kind }"
              :aria-pressed="activeKind === kind"
              @click="activeKind = kind"
              >{{ SLOT_TABS[kind] }}<span v-if="journey.templates[kind].enabled === false" class="chip neutral off-chip">Off</span><span v-else-if="!isDefault(kind)" class="custom-dot" title="Customised"><span class="visually-hidden">(customised)</span></span></button
            >
          </div>
          <template v-for="kind in JOURNEY_KINDS" :key="kind">
            <div v-if="activeKind === kind" class="template-block">
              <div class="template-head">
                <div>
                  <h3>{{ SLOT_LABELS[kind] }}</h3>
                  <p class="field-hint">{{ SLOT_WHEN[kind] }}</p>
                </div>
                <GmButton variant="ghost" size="sm" :disabled="savingTemplates" :disabled-reason="resetReason(kind)" @click="resetTemplate(kind)">Reset to default</GmButton>
              </div>
              <div class="slot-controls">
                <label class="inline-check" :for="`tpl-${kind}-enabled`">
                  <input :id="`tpl-${kind}-enabled`" v-model="journey.templates[kind].enabled" type="checkbox" :disabled="isDemo || savingTemplates" />
                  Offer this message
                  <GmHint text="Turn off to stop listing this message on the Messages page and in message menus. Nothing is deleted." label="About offering this message" />
                </label>
                <div class="channel-pick" role="group" :aria-label="`Preferred channel for ${SLOT_LABELS[kind]}`">
                  <span class="field-label">Preferred channel <GmHint text="The button for this channel is shown first. If a booking has no usable phone or email, the other channels are used." label="About the preferred channel" /></span>
                  <div class="segmented">
                    <button v-for="channel in CHANNELS" :key="channel" type="button" :class="{ 'is-active': journey.templates[kind].channel === channel }" :aria-pressed="journey.templates[kind].channel === channel" :disabled="isDemo || savingTemplates" @click="journey.templates[kind].channel = channel">{{ CHANNEL_LABELS[channel] }}</button>
                  </div>
                </div>
              </div>
              <div class="template-grid">
                <div class="template-edit">
                  <div class="field">
                    <label :for="`tpl-${kind}-subject`">Email subject <GmHint text="Only used when the message opens as an email. WhatsApp and SMS ignore it." label="About the email subject" /></label>
                    <input :id="`tpl-${kind}-subject`" :ref="setField(kind, 'subject')" v-model="journey.templates[kind].subject" :disabled="isDemo || savingTemplates" maxlength="200" @focus="lastField[kind] = 'subject'" />
                  </div>
                  <div class="field">
                    <label :for="`tpl-${kind}-body`">Message</label>
                    <textarea :id="`tpl-${kind}-body`" :ref="setField(kind, 'body')" v-model="journey.templates[kind].body" :disabled="isDemo || savingTemplates" rows="7" maxlength="2000" @focus="lastField[kind] = 'body'"></textarea>
                    <p class="field-hint counter">
                      <span>{{ journey.templates[kind].body.length }}/2000 characters</span>
                      <span v-if="journey.templates[kind].channel === 'sms'">Preview is {{ previewBody(kind).length }} characters, about {{ smsParts(kind) }} SMS {{ smsParts(kind) === 1 ? 'part' : 'parts' }}</span>
                    </p>
                  </div>
                  <p class="var-label" :id="`tpl-${kind}-vars`">Insert a variable at the cursor <GmHint text="Click a chip to drop it where your cursor is, in the subject, the message or a service version. Each chip is replaced with real booking details when the message opens." label="About variables" /></p>
                  <div class="var-chips" role="group" :aria-label="`Insert a variable into ${SLOT_LABELS[kind]}`">
                    <button v-for="name in VARIABLE_NAMES" :key="name" class="chip var-chip" type="button" :title="VARIABLE_HELP[name] || ''" :disabled="isDemo || savingTemplates" @mousedown.prevent @click="insertVariable(kind, name)">{{ variableToken(name) }}</button>
                  </div>
                </div>
                <div class="template-preview" aria-live="polite">
                  <span class="field-label">Preview</span>
                  <strong>{{ previewSubject(kind) }}</strong>
                  <p>{{ previewBody(kind) }}</p>
                  <p v-if="missingPrepNote(kind)" class="field-hint prep-hint">The booking in the preview has no prep notes, so {{ variableToken('prep_notes') }} is empty here. Add prep notes to the service on the <router-link to="/services">Services page</router-link>, or preview another booking.</p>
                </div>
              </div>

              <div class="override-block">
                <div class="override-head">
                  <h4>Different wording for one service <GmHint text="Use this when one service needs its own message, for example a prep note for knotless braids. Clients booking that service get this version; everyone else gets the message above." label="About service versions" /></h4>
                </div>
                <div v-for="entry in overridesFor(kind)" :key="entry.id" class="override-row">
                  <div class="override-top">
                    <strong>{{ entry.name }}</strong>
                    <button class="ghost small-button" type="button" :disabled="isDemo || savingTemplates" @click="removeOverride(kind, entry.id)"><AppIcon name="trash" :size="14" />Remove</button>
                  </div>
                  <div class="field">
                    <label :for="`tpl-${kind}-ov-${entry.id}`">Message for {{ entry.name }}</label>
                    <textarea :id="`tpl-${kind}-ov-${entry.id}`" :ref="setField(kind, `ov:${entry.id}`)" v-model="journey.overrides[entry.id][kind].body" :disabled="isDemo || savingTemplates" rows="5" maxlength="2000" @focus="lastField[kind] = `ov:${entry.id}`"></textarea>
                    <p class="field-hint">{{ journey.overrides[entry.id][kind].body.length }}/2000 characters</p>
                  </div>
                  <div class="template-preview"><span class="field-label">Preview for {{ entry.name }}</span><p>{{ overridePreview(kind, entry.id) }}</p><p v-if="overrideMissingPrep(kind, entry.id)" class="field-hint prep-hint">{{ entry.name }} has no prep notes yet, so {{ variableToken('prep_notes') }} is empty. Add them on the <router-link to="/services">Services page</router-link>, or type the note straight into this version.</p></div>
                </div>
                <div class="override-add">
                  <label :for="`tpl-${kind}-ov-add`" class="field-label">Add a version for a service</label>
                  <GmSelect
                    :id="`tpl-${kind}-ov-add`"
                    :model-value="''"
                    :options="overrideOptions(kind)"
                    :placeholder="overridableServices.length ? (overrideOptions(kind).length ? 'Choose a service' : 'Every service already has a version') : 'Add a service first'"
                    label="Service for a different version"
                    :disabled="isDemo || savingTemplates || !overrideOptions(kind).length"
                    :described-by="!overridableServices.length ? `tpl-${kind}-ov-why` : undefined"
                    @update:model-value="addOverride(kind, $event)"
                  />
                  <p v-if="!overridableServices.length" :id="`tpl-${kind}-ov-why`" class="field-hint">You have no services yet. <router-link to="/services">Add a service</router-link> to give it its own wording.</p>
                </div>
              </div>
            </div>
          </template>
          <p v-if="templatesDirty && !isDemo" class="field-hint">Unsaved message changes. Use Save messages in the bar at the bottom of the page.</p>
        </section>

        <article id="settings-delivery" class="card provider-card">
          <p class="eyebrow">What Bookins does and does not do</p><h2>Delivery and integrations</h2>
          <ul>
            <li><span class="status-icon ready"><AppIcon name="check" :size="14" /></span><div><strong>On-screen booking confirmation</strong><small>Guests see their confirmation right after booking.</small></div></li>
            <li><span class="status-icon ready"><AppIcon name="check" :size="14" /></span><div><strong>Guest messages from your own apps</strong><small>Bookins prepares the message and opens WhatsApp, SMS or email with it filled in. You press send. Nothing is sent to guests automatically, and Bookins cannot tell whether a message was sent.</small></div></li>
            <li><span class="status-icon pending">·</span><div><strong>Google Calendar</strong><small>Optional, per booking, needs your approval each time, and never invites guests. Needs a connected Google account.</small></div></li>
            <li><span class="status-icon pending">·</span><div><strong>Daily agenda email to you</strong><small>A scheduled workflow can email your day's bookings to your own account address only, never to guests. It is off until you turn it on, and it is not yet proven on a real account.</small></div></li>
            <li><span class="status-icon pending">·</span><div><strong>Automatic guest emails and online payments</strong><small>Not available. Bookins sends nothing automatically to guests, and prices are arranged with you.</small></div></li>
          </ul>
        </article>
      </div>
    </div>

    <div v-if="showSaveBar" class="sticky-save-bar" role="status">
      <span>{{ dirty && templatesDirty ? 'Unsaved profile and message changes' : dirty ? 'Unsaved profile changes' : 'Unsaved message changes' }}</span>
      <div class="cluster">
        <GmConfirm
          v-model:open="leavePrompt"
          :title="pendingRoute ? 'Leave without saving?' : 'Discard your changes?'"
          :message="pendingRoute ? 'Your changes have not been saved and will be lost.' : 'Your edits go back to the last saved version.'"
          :confirm-label="pendingRoute ? 'Leave without saving' : 'Discard changes'"
          cancel-label="Keep editing"
          tone="danger"
          :busy="busy"
          @confirm="discardChanges"
          @cancel="keepEditing"
        >
          <button class="ghost" type="button" :disabled="busy" @click="leavePrompt = true">Discard changes</button>
        </GmConfirm>
        <button v-if="templatesDirty" class="secondary" type="button" :class="{ 'is-pending': savingTemplates }" :disabled="isDemo || savingTemplates || busy" @click="saveTemplates">{{ savingTemplates ? 'Saving…' : 'Save messages' }}</button>
        <button v-if="dirty" class="primary" type="submit" form="settings-profile" :class="{ 'is-pending': saving }" :disabled="busy || isDemo">{{ saving ? 'Saving…' : 'Save profile' }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.notice-action { margin-left: auto; flex: none; }
.version-chip { flex: none; }
.settings-shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: var(--space-5); align-items: start; }
.settings-nav { position: sticky; top: calc(var(--topbar-h) + var(--space-3)); display: grid; gap: 4px; }
.settings-nav button { min-height: var(--control-h); padding: 0 14px; text-align: left; color: var(--muted); border: 0; border-radius: var(--radius-sm); background: transparent; font-size: var(--text-sm); font-weight: 600; transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
.settings-nav button:hover { color: var(--ink); background: var(--accent-faint); }
.settings-nav button.is-active { color: var(--accent); background: var(--accent-soft); }
.settings-content { min-width: 0; display: grid; gap: var(--space-4); }
.settings-content > *, .link-section > * { scroll-margin-top: calc(var(--topbar-h) + var(--space-4)); }
.link-section { scroll-margin-top: calc(var(--topbar-h) + var(--space-4)); display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: var(--space-4); align-items: start; }
.section-heading h2 { margin: 0 0 4px; }
.section-heading .muted { margin: 0 0 var(--space-4); font-size: var(--text-sm); }
.profile-identity { margin-bottom: var(--space-4); padding: 13px; display: flex; align-items: center; gap: 12px; border-radius: 12px; background: var(--accent-faint); }
.profile-avatar, .profile-identity img { width: 48px; height: 48px; display: grid; place-items: center; object-fit: cover; color: #fff; border-radius: 13px; background: linear-gradient(145deg, #4154ef, #2336dc); font-size: var(--text-sm); font-weight: 800; }
.profile-identity div { display: grid; gap: 3px; min-width: 0; }
.profile-identity strong { font-size: var(--text-md); overflow-wrap: anywhere; }
.profile-identity small { color: var(--muted); font-size: var(--text-xs); }
.zone-warning { color: #6d5700; }
.zone-warning button { margin-left: 4px; }

.booking-page-card { position: relative; overflow: hidden; min-width: 0; }
.booking-page-card h2, .share-card h2 { margin: 0 0 6px; }
.booking-card-mark { position: absolute; right: var(--space-4); top: var(--space-4); }
.booking-page-card > .muted { margin: 0 58px 0 0; font-size: var(--text-sm); }
.link-box { margin: var(--space-4) 0 var(--space-2); padding: 12px; display: flex; align-items: center; gap: 8px; color: var(--accent); border-radius: var(--radius-sm); background: var(--accent-soft); }
.link-box svg { flex: none; }
.link-box code { min-width: 0; overflow: hidden; color: #3b4766; font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }
.link-status { margin-bottom: var(--space-3); display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.link-status span { display: flex; align-items: center; gap: 6px; color: var(--success); font-size: var(--text-sm); font-weight: 700; }
.link-status.expired span { color: var(--danger); }
.link-status i { width: 8px; height: 8px; border-radius: 50%; background: #1f9d63; box-shadow: 0 0 0 3px #e8f7ef; }
.link-status.expired i { background: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }
.link-status small { color: var(--muted); font-size: var(--text-xs); }
.booking-page-card .form-actions > * { flex: 1; justify-content: center; }
.revoke-row { margin-top: var(--space-3); display: flex; justify-content: center; }
.revoke-link { color: var(--danger); }
.profile-actions { margin-top: var(--space-4); }
.eyebrow .chip { margin-left: 8px; vertical-align: middle; }
.readiness-hint a { color: var(--accent); }
.readiness-list { margin: var(--space-4) 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.readiness-list li { min-height: 44px; padding: 0 8px 0 12px; display: flex; align-items: center; gap: 8px; color: var(--muted); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: var(--text-sm); }
.readiness-list li > span { flex: 1; }
.readiness-list li.done { color: var(--success); border-color: #c8ead9; background: var(--success-soft); }
.create-link { width: 100%; }
.readiness-hint { margin: 10px 0 0; color: var(--muted); font-size: var(--text-xs); text-align: center; }

.share-card { display: grid; gap: var(--space-3); min-width: 0; }
.share-top { display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: center; }
.share-qr { padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-soft); max-width: 100%; }
.share-actions { flex: 1 1 180px; min-width: 0; display: grid; gap: var(--space-2); }
.share-actions .muted { margin: 0 0 var(--space-1); font-size: var(--text-sm); }
.share-actions > a, .share-actions > button { justify-content: center; }
.snippet { font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: var(--text-xs); min-height: 96px; padding-top: 10px; }
.snippet-preview { margin-top: var(--space-3); display: grid; justify-items: start; gap: 8px; padding: var(--space-3); border: 1px dashed var(--line-strong); border-radius: var(--radius-sm); }
.field-label { font-size: var(--text-xs); font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }

.templates-card { display: grid; gap: 6px; }
.templates-card h2, .templates-card p { margin: 0; }
.templates-card .muted { font-size: var(--text-sm); }
.template-tabs { margin-top: var(--space-3); }
.template-tabs button { position: relative; }
.custom-dot { width: 8px; height: 8px; margin-left: 8px; display: inline-block; border-radius: 50%; background: var(--accent); }
.template-block { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--line); }
.template-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.template-head .field-hint { margin-top: 2px; }
.preview-pick { margin: var(--space-3) 0 0; max-width: 460px; }
.off-chip { min-height: 20px; padding: 0 8px; font-size: var(--text-xs); }
.slot-controls { margin-top: var(--space-3); display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--space-4); }
.channel-pick { display: grid; gap: 6px; }
.channel-pick .segmented { width: fit-content; max-width: 100%; }
.inline-check { min-height: var(--control-h-sm, 40px); display: inline-flex; align-items: center; gap: 8px; font-size: var(--text-sm); font-weight: 650; }
.inline-check input { width: 18px; min-height: 0; height: 18px; }
.counter { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; }
.prep-hint { margin: 4px 0 0 !important; color: #6d5700; }
.prep-hint a { color: var(--accent); }
.override-block { margin-top: var(--space-4); padding-top: var(--space-3); display: grid; gap: var(--space-3); border-top: 1px dashed var(--line-strong); }
.override-head h4 { margin: 0; font-size: var(--text-sm); font-weight: 700; }
.override-row { padding: var(--space-3); display: grid; gap: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; }
.override-row .field { margin: 0; }
.override-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.override-add { display: grid; gap: 6px; max-width: 360px; }
.template-head h3 { margin: 0; font-size: var(--text-md); }
.template-grid { margin-top: var(--space-3); display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: var(--space-4); align-items: start; }
.template-edit { min-width: 0; }
.var-label { margin: var(--space-2) 0 6px !important; font-size: var(--text-sm); font-weight: 650; }
.var-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.var-chip { min-height: 40px; padding: 0 12px; cursor: pointer; text-transform: none; color: var(--accent); border: 1px solid var(--accent-line); background: var(--accent-soft); font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: var(--text-xs); font-weight: 600; transition: background var(--dur-fast) var(--ease); }
.var-chip:hover:not(:disabled) { background: #dfe3ff; }
.var-chip:disabled { cursor: not-allowed; opacity: 0.55; }
.template-preview { padding: var(--space-3); display: grid; gap: 6px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-soft); font-size: var(--text-sm); min-width: 0; overflow-wrap: anywhere; }
.template-preview p { margin: 0; white-space: pre-wrap; color: #445071; }

.provider-card ul { padding: 0; margin: var(--space-3) 0 0; display: grid; gap: 12px; list-style: none; }
.provider-card li { display: flex; align-items: center; gap: 12px; }
.provider-card h2 { margin: 0; }
.status-icon { width: 32px; height: 32px; display: grid; place-items: center; flex: none; border-radius: 8px; }
.status-icon.ready { color: var(--success); background: var(--success-soft); }
.status-icon.pending { color: var(--warning); background: var(--warning-soft); font-size: 20px; }
.provider-card li div { display: grid; gap: 2px; }
.provider-card li strong { font-size: var(--text-sm); }
.provider-card li small { color: var(--muted); font-size: var(--text-xs); }

/* Share-kit helper text must wrap, never truncate. */
.share-actions p, .share-card .field-hint, .share-card .muted { white-space: normal; overflow: visible; text-overflow: clip; display: block; -webkit-line-clamp: unset; max-width: none; }
.snippet { min-height: 120px; }

@media (max-width: 1050px) {
  .settings-shell { grid-template-columns: 1fr; gap: var(--space-3); }
  .settings-nav { position: sticky; top: var(--topbar-h); z-index: 20; display: flex; gap: 6px; padding: 8px 0; overflow-x: auto; scroll-snap-type: x proximity; background: var(--surface-soft); scrollbar-width: none; }
  .settings-nav::-webkit-scrollbar { display: none; }
  .settings-nav button { flex: none; white-space: nowrap; scroll-snap-align: start; border: 1px solid var(--line); background: #fff; border-radius: var(--radius-pill); }
  .settings-nav button.is-active { border-color: var(--accent-line); }
  .settings-content > *, .link-section > * { scroll-margin-top: calc(var(--topbar-h) + 64px); }
  .link-section { scroll-margin-top: calc(var(--topbar-h) + 64px); }
}
@media (max-width: 800px) {
  .template-grid { grid-template-columns: 1fr; }
  .link-section { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 700px) {
  .notice { flex-wrap: wrap; }
  .notice-action { margin-left: 0; }
}
</style>
