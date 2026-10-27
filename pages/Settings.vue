<script setup lang="ts">
import AgendaSettings from '../components/AgendaSettings.vue'
import { formatDay } from '../format-date.ts'
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmConfirm from '../components/ui/GmConfirm.vue'
import GmHint from '../components/ui/GmHint.vue'
import { useSetupState } from '../setup.ts'
import GmSelect from '../components/ui/GmSelect.vue'
import QrCode from '../components/QrCode.vue'
import { copyText, createPublicLink, hasTeam, isLocalPreview, isOwnerMember, isStaffCopy, isTimeOff, revokePublicLink, saveBookingAppearance, saveMessageTemplates, saveProfile, staffForBooking } from '../booking.ts'
import { BOOKING_LAYOUTS, BOOKING_THEMES, bookingTheme, normalizeBookingAppearance } from '../booking-appearance.ts'
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
  type MessageChannel,
  type MessageTemplate,
  type TemplateConfig,
  type TemplateKind,
} from '../messaging.ts'
import { isDemo, registerDemoGuard } from '../runtime.ts'
import { errorMessage } from '../error-message.ts'
import type { RouteLocationRaw } from 'vue-router'

import { displayTimeZone, timezoneOptions } from '../time-display.ts'

interface ProfileForm { displayName: string; bio: string; timezone: string; photoUrl: string }
interface LinkResult { url: string; expiresAt?: string }
interface Section { id: string; label: string }
type EditableField = 'subject' | 'body' | `ov:${string}`
interface JourneyState { templates: Record<TemplateKind, MessageTemplate>; overrides: TemplateConfig['serviceOverrides'] }

const timestampDate = (value: TimestampInput): Date => {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') return new Date(value)
  if (value && 'toDate' in value) return value.toDate()
  if (value && '_seconds' in value) return new Date(value._seconds * 1000)
  return new Date(Number.NaN)
}
const timestampMillis = (value: TimestampInput) => timestampDate(value).getTime()

const timezoneItems = computed(() => timezoneOptions(form.timezone))
const state = inject<WorkspaceState>('bookingState', { profile: null, schedules: [], services: [], bookings: [], contacts: [], staff: [], campaigns: [] })
const refresh = inject<RefreshWorkspace>('refreshBookings', async () => true)
const toast = inject<ToastApi | null>('toast', null)
const setup = useSetupState()
const router = useRouter()
const route = useRoute()
const saving = ref(false)
const savingAppearance = ref(false)
const linking = ref(false)
const revoking = ref(false)
const busy = computed(() => saving.value || savingAppearance.value || linking.value || revoking.value)
const confirmRevoke = ref(false)
const linkHeading = ref<HTMLElement | null>(null)
const copied = ref(false)
const error = ref('')
const form = reactive({ displayName: '', bio: '', timezone: 'Africa/Lagos', photoUrl: '' })
const appearance = reactive(normalizeBookingAppearance(state.profile?.booking_page_settings_json))
const appearanceBaseline = ref(JSON.stringify(normalizeBookingAppearance(state.profile?.booking_page_settings_json)))
const profilePhotoFailed = ref(false)
watch(() => form.photoUrl, () => { profilePhotoFailed.value = false })
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
    ? formatDay(expiresMs.value, form.timezone)
    : 'Unknown',
)
const scheduleZone = computed(() => state.schedules[0]?.timezone || '')
const zoneMismatch = computed(() => Boolean(scheduleZone.value) && form.timezone !== scheduleZone.value)
const localPreview = isLocalPreview()
const hasPublicService = computed(() => state.services.some((item) => item.active !== false && item.visibility === 'public'))
const canShare = computed(() => Boolean(state.profile?.id && state.schedules.length && hasPublicService.value))
const missingForLink = computed(() => {
  const missing: string[] = []
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
    const savedProfile = normalizeProfile(profileInput(state.profile))
    if (dirty.value) remoteChanged.value = savedProfile !== profileBaseline.value
    else syncProfileDraft()
    if (!appearanceDirty.value) syncAppearanceDraft()
  },
)

async function reloadChecked() {
  return (await refresh()) === true
}
const STALE_MESSAGE = 'Saved, but Bookins could not reload your workspace, so what you see may be out of date. Use Refresh to check.'

// Link operations must never persist the unsaved draft: merge link fields onto the stored profile.
const storedProfileInput = (link: LinkResult) => ({
  displayName: state.profile?.display_name || '',
  bio: state.profile?.bio || '',
  timezone: state.profile?.timezone || 'Africa/Lagos',
  photoUrl: state.profile?.photo_url || '',
  publicLinkUrl: link.url,
  publicLinkExpiresAt: link.expiresAt,
})

function normalizeProfile(value: ProfileForm) {
  return JSON.stringify({
    displayName: String(value.displayName || '').trim(),
    bio: String(value.bio || '').trim(),
    timezone: String(value.timezone || '').trim(),
    photoUrl: String(value.photoUrl || '').trim(),
  })
}

function profileInput(profile: ProfileRecord | null | undefined = null): ProfileForm {
  return {
    displayName: profile?.display_name || '',
    bio: profile?.bio || '',
    timezone: profile?.timezone || 'Africa/Lagos',
    photoUrl: profile?.photo_url || '',
  }
}

function syncProfileDraft() {
  remoteChanged.value = false
  Object.assign(form, profileInput(state.profile))
  profileBaseline.value = normalizeProfile(form)
}

const dirty = computed(() => normalizeProfile(form) !== profileBaseline.value)
const serializedAppearance = () => JSON.stringify(normalizeBookingAppearance(appearance))
const appearanceDirty = computed(() => serializedAppearance() !== appearanceBaseline.value)
const activeTheme = computed(() => bookingTheme(appearance))
const previewMonth = computed(() => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date()))
function syncAppearanceDraft() {
  Object.assign(appearance, normalizeBookingAppearance(state.profile?.booking_page_settings_json))
  appearanceBaseline.value = serializedAppearance()
}
const removeModeGuard = registerDemoGuard('bookins-settings', () => {
  if (busy.value) return 'Wait for the current settings action to finish.'
  if (dirty.value) return 'Finish or discard your unsaved profile changes before switching modes.'
  if (appearanceDirty.value) return 'Save or discard your booking page changes before switching modes.'
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
  if (!dirty.value && !appearanceDirty.value && !templatesDirty.value) return true
  pendingRoute.value = to.fullPath
  leavePrompt.value = true
  return false
})

function discardChanges() {
  if (busy.value) return
  error.value = ''
  syncProfileDraft()
  syncAppearanceDraft()
  reseedJourney()
  leavePrompt.value = false
  const route = pendingRoute.value
  pendingRoute.value = ''
  if (route) {
    allowLeave.value = true
    router.push(route)
  }
}

async function saveAppearance() {
  if (isDemo.value || busy.value || savingTemplates.value) return
  if (!state.profile?.id) {
    failToast('Save your profile before changing your booking page.')
    return
  }
  savingAppearance.value = true
  error.value = ''
  try {
    await saveBookingAppearance(state.profile, normalizeBookingAppearance(appearance))
    if (await reloadChecked()) {
      syncAppearanceDraft()
      flash('Booking page saved. Existing links without an appearance override now use this look.')
    } else {
      appearanceBaseline.value = serializedAppearance()
      failToast(STALE_MESSAGE)
    }
  } catch (reason) {
    failToast(errorMessage(reason, 'The booking page could not be saved.'))
  } finally {
    savingAppearance.value = false
  }
}

function keepEditing() {
  leavePrompt.value = false
  pendingRoute.value = ''
}

function flash(message: string, options?: ToastOptions) {
  return toast?.(message, options)
}
// The "Profile saved [Create booking link]" toast is stale as soon as a link exists.
let profileToastId = 0
function dismissProfileToast() {
  if (profileToastId) toast?.dismiss?.(profileToastId)
  profileToastId = 0
}
watch(publicUrl, (url) => { if (url) dismissProfileToast() })
function failToast(message: string) {
  toast?.error?.(message)
}
function goTo(path: RouteLocationRaw) { router.push(path) }
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
    failToast(errorMessage(reason, 'The profile could not be saved.'))
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
      await saveProfile(state.profile, storedProfileInput({ url, expiresAt: result.expiresAt || '' }))
    } catch (reason) {
      let cleanup = ''
      try {
        await revokePublicLink(url)
        cleanup = ' The new link was revoked, so nothing was left active.'
      } catch {
        cleanup = ' The new link could not be revoked and may still be live, but Bookins did not store it, so you cannot copy or revoke it here. Contact support if this matters.'
      }
      throw new Error(`${errorMessage(reason, 'The profile could not store the new link.')}${cleanup}`)
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
    failToast(errorMessage(reason, 'The public link could not be created.'))
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
      throw new Error(`The link was revoked, but your profile still lists it (${errorMessage(reason, 'save failed')}). Press Revoke again to finish clearing it.`)
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
    failToast(errorMessage(reason, 'The public link could not be revoked.'))
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
const escapeAttr = (value: unknown) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const BUTTON_STYLE =
  'display:inline-block;padding:12px 22px;background:#2e3fa8;color:#ffffff;border-radius:8px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;font-weight:600;line-height:1.2;text-decoration:none'
const buttonSnippet = computed(
  () => `<a href="${escapeAttr(publicUrl.value)}" target="_blank" rel="noopener" style="${BUTTON_STYLE}">Book an appointment</a>`,
)
const copiedKey = ref('')
let copiedKeyTimer = 0
async function copyShare(key: string, value: string) {
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
const sections: Section[] = [
  { id: 'settings-profile', label: 'Profile' },
  { id: 'settings-booking-page', label: 'Booking page' },
  { id: 'settings-link', label: 'Booking link' },
  { id: 'settings-templates', label: 'Messages' },
  { id: 'settings-delivery', label: 'Delivery and agenda' },
]
const activeSection = ref(sections[0]?.id || '')
let scrollLock = 0
function goToSection(id: string) {
  activeSection.value = id
  scrollLock = Date.now() + 900
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}
// Scroll-spy: the active section is the last one whose top has passed the sticky header zone.
function updateActiveSection() {
  if (Date.now() < scrollLock) return
  const line = window.innerHeight * 0.3
  let current = sections[0]?.id || ''
  for (const section of sections) {
    const element = document.getElementById(section.id)
    if (element && element.getBoundingClientRect().top <= line) current = section.id
  }
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = sections.at(-1)?.id || current
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
const JOURNEY_KINDS: TemplateKind[] = [...JOURNEY_SLOTS, 'reschedule', 'cancellation']
const CHANNEL_LABELS: Record<MessageChannel, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' }
const SLOT_WHEN: Partial<Record<TemplateKind, string>> = {
  confirmation: 'For a new booking. Open it from Bookings right after someone books.',
  reminder24: 'Listed on Messages from 24 hours before the appointment.',
  reminder2: 'Listed on Messages from 2 hours before the appointment.',
  prep: 'Listed on Messages from 48 hours before, only for services that have prep notes.',
  thanks: 'Listed on Messages for 24 hours after a visit is marked completed.',
  rebook: 'Listed on Messages when a client is due back, per the service\'s "rebook after" days, and has no newer booking.',
  reschedule: 'For a booking that moved. Open it from Bookings after you reschedule.',
  cancellation: 'For a cancelled booking. Open it from Bookings after you cancel.',
}
const SLOT_TABS: Partial<Record<TemplateKind, string>> = {
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
const VARIABLE_HELP: Record<string, string> = {
  staff: 'The team member the booking is with. Empty when you work alone.',
  prep_notes: 'The prep notes saved on the service (Services page). Empty when the service has none.',
  booking_link: 'Your public booking link.',
  rebook_link: 'The link a client uses to book again (your booking link).',
  business_phone: 'The number you put in your bio as [[wa:+234...]]. Empty if you did not add one.',
}
// Chips read as plain words ("Client name"); the {{token}} they insert is in the tooltip and the message itself.
const VARIABLE_LABELS: Record<string, string> = { guest_name: 'Client name', first_name: 'First name', timezone: 'Time zone', business: 'Business name', reference: 'Booking reference', staff: 'Team member', prep_notes: 'Prep notes', business_phone: 'Business phone' }
const variableLabel = (name: string) => VARIABLE_LABELS[name] || name.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
const SMS_PART = 160

// Always carries every kind (including ones this page does not show) so saving never drops saved wording.
const cloneJourney = (config: TemplateConfig): JourneyState => ({
  templates: Object.fromEntries(
    TEMPLATE_KINDS.map((kind) => {
      const slot = config.templates[kind]
      return [kind, { channel: slot.channel, subject: slot.subject, body: slot.body, enabled: slot.enabled !== false }]
    }),
  ) as Record<TemplateKind, MessageTemplate>,
  overrides: structuredClone(config.serviceOverrides || {}),
})
const journey = reactive(cloneJourney(resolveTemplateConfig(state.profile)))
const journeyPayload = () => serializeTemplates({ templates: journey.templates, serviceOverrides: journey.overrides })
const serializedJourney = () => JSON.stringify(journeyPayload())
const journeyBaseline = ref(serializedJourney())
const templatesDirty = computed(() => serializedJourney() !== journeyBaseline.value)
const showSaveBar = computed(() => !isDemo.value && (dirty.value || appearanceDirty.value || templatesDirty.value))
const activeKind = ref<TemplateKind>(JOURNEY_KINDS[0] || 'confirmation')
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
const warnBeforeUnload = (event: BeforeUnloadEvent) => {
  if (isDemo.value || (!dirty.value && !appearanceDirty.value && !templatesDirty.value)) return
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
  const real = state.bookings.filter((item) => !isTimeOff(item) && item.guest_name && item.status !== 'cancelled' && Number.isFinite(timestampMillis(item.starts_at)))
  const upcoming = real.filter((item) => timestampMillis(item.starts_at) >= nowMs).sort((left, right) => timestampMillis(left.starts_at) - timestampMillis(right.starts_at))
  const past = real.filter((item) => timestampMillis(item.starts_at) < nowMs).sort((left, right) => timestampMillis(right.starts_at) - timestampMillis(left.starts_at))
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
    value: String(item.id || ''),
    label: `${item.guest_name}, ${item.service_name || 'Booking'}, ${timestampDate(item.starts_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`,
  })),
  { value: SAMPLE_KEY, label: 'Sample booking (Ada Obi)' },
])
const previewKey = computed(() => (previewOptions.value.some((option) => option.value === previewPick.value) ? previewPick.value : previewOptions.value[0]?.value || SAMPLE_KEY))
const previewBooking = computed(() => recentBookings.value.find((item) => item.id === previewKey.value) || sampleBooking.value)
const previewIsReal = computed(() => previewBooking.value.id !== SAMPLE_KEY)
const serviceById = (id: string | undefined) => state.services.find((item) => item.id === id)
function varsFor(booking: BookingRecord, service: ServiceRecord | undefined) {
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
const renderPreview = (text: string, vars: Record<string, string> = previewVars.value) => renderTemplate(text, vars)
const previewSubject = (kind: TemplateKind) => renderPreview(journey.templates[kind].subject)
const previewBody = (kind: TemplateKind) => renderPreview(journey.templates[kind].body)
const usesVariable = (text: string, name: string) => new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(text)
const missingPrepNote = (kind: TemplateKind) =>
  [journey.templates[kind].body, ...Object.values(journey.overrides).map((per) => per?.[kind]?.body || '')].some((text) => usesVariable(text, 'prep_notes')) &&
  !previewVars.value.prep_notes
const overrideMissingPrep = (kind: TemplateKind, serviceId: string) => {
  const service = serviceById(serviceId)
  const booking = { ...previewBooking.value, service_id: serviceId, service_name: service?.name || previewBooking.value.service_name }
  return usesVariable(journey.overrides[serviceId]?.[kind]?.body || '', 'prep_notes') && !varsFor(booking, service).prep_notes
}
const smsParts = (kind: TemplateKind) => Math.max(1, Math.ceil(previewBody(kind).length / SMS_PART))

const isDefault = (kind: TemplateKind) => {
  const slot = journey.templates[kind]
  const base = DEFAULT_TEMPLATES[kind]
  return slot.subject === base.subject && slot.body === base.body && slot.channel === 'whatsapp' && slot.enabled !== false
}
const resetReason = (kind: TemplateKind) => (isDemo.value ? 'Demo is read-only.' : isDefault(kind) ? 'Already using the default wording, channel and setting.' : '')

// Variable insertion at the cursor of whichever field was focused last (subject, message, or a service override).
const variableToken = (name: string) => '{' + '{' + name + '}' + '}'
const fieldElements: Record<string, HTMLInputElement | HTMLTextAreaElement> = {}
const lastField = reactive<Partial<Record<TemplateKind, EditableField>>>({})
const setField = (kind: TemplateKind, field: EditableField) => (element: unknown) => {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) fieldElements[`${kind}:${field}`] = element
}
const fieldValue = (kind: TemplateKind, field: EditableField) => {
  if (field.startsWith('ov:')) return journey.overrides[field.slice(3)]?.[kind]?.body ?? ''
  return field === 'subject' ? journey.templates[kind].subject : journey.templates[kind].body
}
function writeField(kind: TemplateKind, field: EditableField, value: string) {
  if (field.startsWith('ov:')) {
    const entry = journey.overrides[field.slice(3)]?.[kind]
    if (entry) entry.body = value
  } else if (field === 'subject') journey.templates[kind].subject = value
  else journey.templates[kind].body = value
}
function insertVariable(kind: TemplateKind, name: string) {
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
function resetTemplate(kind: TemplateKind) {
  if (isDemo.value || savingTemplates.value) return
  Object.assign(journey.templates[kind], { ...DEFAULT_TEMPLATES[kind], channel: 'whatsapp', enabled: true })
  toast?.info?.(`${SLOT_LABELS[kind]} is back to the default wording. Save to keep it.`)
}

// Per-service overrides: a different message body for one service (for example prep notes for one treatment).
const overridableServices = computed(() => state.services.filter((item) => item.active !== false && !isStaffCopy(item)))
const serviceName = (id: string) => serviceById(id)?.name || 'Removed service'
const overridesFor = (kind: TemplateKind) => Object.entries(journey.overrides).filter(([, per]) => per?.[kind]).map(([id]) => ({ id, name: serviceName(id) }))
const overrideOptions = (kind: TemplateKind) =>
  overridableServices.value.filter((item) => item.id && !journey.overrides[item.id]?.[kind]).map((item) => ({ value: String(item.id || ''), label: item.name || 'Service' }))
function addOverride(kind: TemplateKind, serviceId: string | number | boolean) {
  if (typeof serviceId !== 'string') return
  if (!serviceId || isDemo.value || savingTemplates.value) return
  journey.overrides[serviceId] ||= {}
  journey.overrides[serviceId][kind] = { body: journey.templates[kind].body }
  lastField[kind] = `ov:${serviceId}`
  toast?.info?.(`Added a ${serviceName(serviceId)} version of this message. Save to keep it.`)
}
function removeOverride(kind: TemplateKind, serviceId: string) {
  if (isDemo.value || savingTemplates.value) return
  if (!journey.overrides[serviceId]) return
  delete journey.overrides[serviceId][kind]
  if (!Object.keys(journey.overrides[serviceId]).length) delete journey.overrides[serviceId]
  if (lastField[kind] === `ov:${serviceId}`) lastField[kind] = 'body'
  toast?.info?.(`Removed the ${serviceName(serviceId)} version. Save to keep this change.`)
}
const overrideEntry = (kind: TemplateKind, serviceId: string) => {
  journey.overrides[serviceId] ||= {}
  journey.overrides[serviceId][kind] ||= { body: '' }
  return journey.overrides[serviceId][kind]
}
const selectSnippet = (event: FocusEvent) => {
  if (event.target instanceof HTMLTextAreaElement) event.target.select()
}
const overridePreview = (kind: TemplateKind, serviceId: string) => {
  const service = serviceById(serviceId)
  const booking = { ...previewBooking.value, service_id: serviceId, service_name: service?.name || previewBooking.value.service_name }
  return renderTemplate(journey.overrides[serviceId]?.[kind]?.body || '', varsFor(booking, service))
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
    failToast(errorMessage(reason, 'Your message journey could not be saved.'))
  } finally {
    savingTemplates.value = false
  }
}
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1>Settings</h1>
        <p class="lede">Your business details, booking page, booking link and message wording.</p>
      </div>
    </header>

    <div v-if="error" class="notice error" role="alert"><AppIcon name="alert" :size="18" /><span>{{ error }}</span></div>
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
          <div class="section-heading">
            <div>
              <h2>Your business details <span v-if="!state.profile?.id" class="chip warning">Not saved yet</span></h2>
              <p class="muted">Shown at the top of your booking page.</p>
            </div>
          </div>
          <div class="form-section">
            <div class="field"
              ><label for="profile-name">Business name <GmHint text="The name guests see at the top of your booking page and in confirmations. Use your own name or your business name." label="About display name" /></label
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
              ><label for="profile-timezone">Time zone shown on your booking page <GmHint text="This is the time zone named on your booking page. Your bookable hours use the time zone set in Availability, so keep the two the same." label="About the booking page time zone" /></label
              ><GmSelect id="profile-timezone" v-model="form.timezone" :options="timezoneItems" label="Time zone shown on your booking page" :disabled="isDemo || busy" required searchable search-placeholder="Search by city" described-by="profile-timezone-help" />
                <p id="profile-timezone-help" class="field-hint">Type a city name to search. Your hours themselves are set in <router-link to="/availability">Availability</router-link>.</p
              ><p v-if="zoneMismatch" class="field-hint zone-warning" role="status">Your hours in Availability use {{ displayTimeZone(scheduleZone) }}, which is different. <button class="link-button" type="button" :disabled="busy" @click="form.timezone = scheduleZone">Use {{ scheduleZone }} here too</button></p
            ></div>
            <details class="profile-photo-options"><summary>Profile photo <span>Optional</span></summary>
            <div class="field"
              ><label for="profile-photo">Photo link</label
              ><input
                id="profile-photo"
                v-model.trim="form.photoUrl"
                :disabled="isDemo || busy"
                type="url"
                placeholder="https://example.com/photo.jpg"
                :aria-describedby="profilePhotoFailed ? 'profile-photo-error' : 'profile-photo-hint'"
              /><p v-if="profilePhotoFailed" id="profile-photo-error" class="field-hint field-error" role="status">This image could not be loaded. Check that the link is public and starts with https://.</p><p v-else id="profile-photo-hint" class="field-hint">Use a square image with a public HTTPS URL.</p></div
            >          <div class="profile-identity"
            ><span
              v-if="!form.photoUrl || profilePhotoFailed"
              class="profile-avatar"
              >{{ initials }}</span
            ><img
              v-else
              :src="form.photoUrl"
              alt="Profile preview"
              @error="profilePhotoFailed = true"
            /><div
              ><strong>{{ form.displayName || 'Your display name' }}</strong
              ><small>{{ form.timezone }}</small></div
            ></div
          >
            </details>
          </div>
          <p class="save-note" :class="{ unsaved: dirty && !isDemo }">{{ isDemo ? 'Sample details. Demo is read-only.' : dirty ? 'Unsaved. Use Save profile in the bar at the bottom.' : state.profile?.id ? 'Saved.' : 'Enter a business name to save your profile.' }}</p>
        </form>

        <article id="settings-booking-page" class="card appearance-card">
          <div class="section-heading">
            <div>
              <h2>Booking page style</h2>
              <p class="muted">The colours and calendar guests see. Booking links that have their own style keep it.</p>
            </div>
          </div>
          <div class="appearance-workspace">
          <fieldset class="appearance-fieldset" :disabled="isDemo || busy || savingTemplates">
            <legend>Colours</legend>
            <div class="theme-grid">
              <label v-for="theme in BOOKING_THEMES" :key="theme.id" class="theme-choice" :class="{ selected: appearance.theme === theme.id }" :style="{ '--theme-accent': theme.accent, '--theme-on-accent': theme.onAccent, '--theme-background': theme.background, '--theme-card': theme.card, '--theme-ink': theme.ink, '--theme-muted': theme.muted }">
                <input v-model="appearance.theme" type="radio" name="booking-theme" :value="theme.id" />
                <span class="theme-swatch" aria-hidden="true"><i /><i /><i /></span>
                <strong>{{ theme.label }}</strong>
                <small>{{ theme.description }}</small>
              </label>
            </div>
            <div class="field appearance-layout">
              <label for="booking-layout">Calendar layout</label>
              <GmSelect id="booking-layout" v-model="appearance.layout" :options="BOOKING_LAYOUTS" label="Calendar layout" />
              <p class="field-hint">Guests can switch layouts.</p>
            </div>
          </fieldset>
          <div class="appearance-preview-wrap"><p id="appearance-preview-label" class="appearance-preview-label">What guests see</p><div class="appearance-preview" role="img" aria-labelledby="appearance-preview-label" :style="{ '--preview-accent': activeTheme.accent, '--preview-on-accent': activeTheme.onAccent, '--preview-background': activeTheme.background, '--preview-card': activeTheme.card, '--preview-ink': activeTheme.ink, '--preview-muted': activeTheme.muted }">
            <div class="preview-top"><span>{{ form.displayName || 'Your booking page' }}</span><small>{{ activeTheme.label }}</small></div>
            <template v-if="appearance.layout === 'month'">
              <div class="preview-month"><strong>{{ previewMonth }}</strong><span>Select a date</span></div>
              <div class="preview-days"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
              <div class="preview-calendar"><i v-for="day in 21" :key="day" :class="{ selected: day === 11, muted: day < 4 }">{{ day }}</i></div>
            </template>
            <template v-else-if="appearance.layout === 'week'">
              <div class="preview-month"><strong>This week</strong><span>Pick a day and time</span></div>
              <div class="preview-week"><span v-for="day in ['Mon 12', 'Tue 13', 'Wed 14', 'Thu 15', 'Fri 16', 'Sat 17', 'Sun 18']" :key="day" :class="{ selected: day === 'Wed 14' }">{{ day }}</span></div>
              <div class="preview-times"><span>10:00</span><span class="selected">11:30</span><span>14:00</span></div>
            </template>
            <template v-else>
              <div class="preview-month"><strong>Choose a day</strong><span>Times by day</span></div>
              <div class="preview-columns">
                <div v-for="day in [{ label: 'Tue 13', times: ['10:00', '13:30'] }, { label: 'Wed 14', times: ['11:30', '15:00'] }, { label: 'Thu 15', times: ['09:30', '14:00'] }]" :key="day.label" :class="{ selected: day.label === 'Wed 14' }"><strong>{{ day.label }}</strong><span v-for="time in day.times" :key="time" :class="{ selected: time === '11:30' }">{{ time }}</span></div>
              </div>
            </template>
          </div>
          </div>
          </div>
          <p class="save-note" :class="{ unsaved: appearanceDirty && !isDemo }">{{ isDemo ? 'Demo is read-only.' : !state.profile?.id ? 'Save your profile first, then you can save a style.' : appearanceDirty ? 'Unsaved. Use Save booking page in the bar at the bottom.' : 'Saved.' }}</p>
        </article>

        <div id="settings-link" class="link-section">
          <article class="card booking-page-card" data-tour="tour-settings-link">
            <h2 ref="linkHeading" tabindex="-1">{{ linkExpired ? 'Your booking link has expired' : publicUrl ? 'Your booking link' : 'Create your booking link' }}</h2>
            <p class="muted">Guests who open it see your details, choose a time and book.</p>

            <template v-if="publicUrl">
              <div class="link-box"
                ><AppIcon
                  name="link"
                  :size="17"
                /><code>{{ publicUrl }}</code></div
              >
              <div class="link-status" :class="{ expired: linkExpired }"
                ><span><i aria-hidden="true" />{{ linkExpired ? 'Expired' : 'Active' }}</span><small>{{ linkExpired ? 'Expired' : 'Expires' }} {{ expires }} <GmHint text="Booking links expire for your guests' safety. Before it does, create a new link here and share that one instead; the old one stops working." label="About link expiry" /></small></div
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
            <h2>Share it</h2>
            <div class="share-top">
              <div class="share-qr"><QrCode :value="publicUrl" :size="160" label="QR code for your booking link" filename="bookins-booking-link.png" /></div>
              <div class="share-actions">
                <p class="muted">Send the link where your clients already are, or print the QR code for your counter or door.</p>
                <a class="primary" :href="whatsappShare" target="_blank" rel="noreferrer">Share on WhatsApp<AppIcon name="external" :size="15" /></a>
              </div>
            </div>
            <div class="form-section">
              <div class="field">
                <label for="share-snippet">Website button</label>
                <textarea id="share-snippet" class="snippet" readonly rows="4" :value="buttonSnippet" @focus="selectSnippet"></textarea>
                <p class="field-hint">Paste this into your website or bio. It is a plain link with no script or embed.</p>
              </div>
              <div class="form-actions">
                <button class="secondary" type="button" @click="copyShare('snippet', buttonSnippet)">{{ copiedKey === 'snippet' ? 'Copied' : 'Copy button code' }}</button>
              </div>
              <div class="snippet-preview">
                <span class="field-label">How the button looks</span>
                <a :href="publicUrl" target="_blank" rel="noopener" :style="BUTTON_STYLE">Book an appointment</a>
              </div>
            </div>
          </article>
        </div>

        <section id="settings-templates" class="card templates-card" aria-labelledby="templates-title">
          <h2 id="templates-title">Message wording</h2>
          <p class="muted">The wording Bookins fills in when you open a message in your own WhatsApp, SMS or email app. Bookins does not send anything and cannot see whether you pressed send.</p>
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
                  <p class="var-label" :id="`tpl-${kind}-vars`">Insert a booking detail at the cursor <GmHint text="Click a detail to drop it where your cursor is, in the subject, the message or a service version. It is replaced with the real booking details when the message opens." label="About booking details" /></p>
                  <div class="var-chips" role="group" :aria-labelledby="`tpl-${kind}-vars`">
                    <button v-for="name in VARIABLE_NAMES" :key="name" class="var-chip" type="button" :title="VARIABLE_HELP[name] || variableToken(name)" :disabled="isDemo || savingTemplates" @mousedown.prevent @click="insertVariable(kind, name)">{{ variableLabel(name) }}</button>
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
                    <textarea :id="`tpl-${kind}-ov-${entry.id}`" :ref="setField(kind, `ov:${entry.id}`)" v-model="overrideEntry(kind, entry.id).body" :disabled="isDemo || savingTemplates" rows="5" maxlength="2000" @focus="lastField[kind] = `ov:${entry.id}`"></textarea>
                    <p class="field-hint">{{ overrideEntry(kind, entry.id).body.length }}/2000 characters</p>
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
          <h2>What reaches your clients</h2>
          <dl class="delivery-list">
            <div><dt>On-screen confirmation</dt><dd><span class="state on">Always on</span>Guests see their confirmation right after booking.</dd></div>
            <div><dt>Messages from your own apps</dt><dd><span class="state on">Always on</span>You open each one and press send yourself.</dd></div>
            <div><dt>Google Calendar</dt><dd><span class="state">Optional</span>Add bookings when you choose; linked events follow moves and cancellations. Your workspace approval policy applies. Clients are never invited.</dd></div>
            <div><dt>Daily agenda email to you</dt><dd><span class="state">Optional</span>Emails your day's bookings to your own account address only, never to guests. A queued run is not proof that the email arrived.</dd></div>
            <div><dt>Automatic guest emails, online payments</dt><dd><span class="state off">Not available</span>Prices are arranged between you and the client.</dd></div>
          </dl>
          <AgendaSettings />
        </article>
      </div>
    </div>

    <div v-if="showSaveBar" class="sticky-save-bar" role="status">
      <span>{{ dirty && appearanceDirty && templatesDirty ? 'Unsaved profile, booking page and message changes' : dirty && appearanceDirty ? 'Unsaved profile and booking page changes' : dirty && templatesDirty ? 'Unsaved profile and message changes' : appearanceDirty && templatesDirty ? 'Unsaved booking page and message changes' : dirty ? 'Unsaved profile changes' : appearanceDirty ? 'Unsaved booking page changes' : 'Unsaved message changes' }}</span>
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
        <button v-if="appearanceDirty" class="secondary" type="button" :class="{ 'is-pending': savingAppearance }" :disabled="isDemo || savingAppearance || busy || !state.profile?.id" @click="saveAppearance">{{ savingAppearance ? 'Saving…' : 'Save booking page' }}</button>
        <button v-if="dirty" class="primary" type="submit" form="settings-profile" :class="{ 'is-pending': saving }" :disabled="busy || isDemo">{{ saving ? 'Saving…' : 'Save profile' }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.notice-action { margin-left: auto; flex: none; }
.field-error { color: var(--danger); }
.save-note { margin: var(--space-3) 0 0; color: var(--muted); font-size: var(--text-sm); }
.save-note.unsaved { color: var(--warning); font-weight: var(--weight-strong); }
.settings-shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: var(--space-5); align-items: start; }
.settings-nav { position: sticky; top: calc(var(--topbar-h) + var(--space-3)); display: grid; gap: 4px; }
.settings-nav button { position: relative; min-height: var(--control-h); padding: 0 14px; text-align: left; color: var(--ink-soft); border: 0; border-radius: var(--radius-sm); background: transparent; font-size: var(--text-sm); font-weight: var(--weight-medium); transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
.settings-nav button:hover { color: var(--ink); background: var(--surface-sunken); }
.settings-nav button.is-active { color: var(--ink); background: var(--surface); font-weight: var(--weight-strong); box-shadow: inset 4px 0 0 var(--accent); }
.settings-content { min-width: 0; display: grid; gap: var(--space-4); }
.settings-content > *, .link-section > * { scroll-margin-top: calc(var(--topbar-h) + var(--space-4)); }
.link-section { scroll-margin-top: calc(var(--topbar-h) + var(--space-4)); display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: var(--space-4); align-items: start; }
.section-heading h2 { margin: 0 0 4px; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.section-heading .muted { margin: 0 0 var(--space-4); font-size: var(--text-sm); }
.profile-identity { margin-bottom: var(--space-4); padding: 12px; display: flex; align-items: center; gap: 12px; border-radius: var(--radius-sm); background: var(--surface-soft); }
.profile-avatar, .profile-identity img { width: 48px; height: 48px; display: grid; place-items: center; object-fit: cover; color: var(--on-accent); border-radius: 50%; background: var(--accent); font-size: var(--text-sm); font-weight: var(--weight-strong); }
.profile-identity div { display: grid; gap: 3px; min-width: 0; }
.profile-identity strong { font-size: var(--text-md); overflow-wrap: anywhere; }
.profile-identity small { color: var(--muted); font-size: var(--text-xs); }
.zone-warning { color: var(--warning); }
.zone-warning button { margin-left: 4px; }

.booking-page-card { position: relative; overflow: hidden; min-width: 0; border-left: 4px solid var(--accent); border-radius: 2px var(--card-radius) var(--card-radius) 2px; }
.booking-page-card h2, .share-card h2 { margin: 0 0 6px; }
.booking-page-card h2:focus { outline: none; }
.booking-page-card > .muted { margin: 0; font-size: var(--text-sm); }
.link-box { margin: var(--space-4) 0 var(--space-2); padding: 12px; display: flex; align-items: center; gap: 8px; color: var(--accent); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-soft); }
.link-box svg { flex: none; }
.link-box code { min-width: 0; overflow: hidden; color: var(--ink-soft); font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }
.link-status { margin-bottom: var(--space-3); display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.link-status span { display: flex; align-items: center; gap: 6px; color: var(--success); font-size: var(--text-sm); font-weight: var(--weight-strong); }
.link-status.expired span { color: var(--danger); }
.link-status i { width: 8px; height: 8px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 3px var(--success-soft); }
.link-status.expired i { background: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }
.link-status small { color: var(--muted); font-size: var(--text-xs); }
.booking-page-card .form-actions > * { flex: 1; justify-content: center; }
.revoke-row { margin-top: var(--space-3); display: flex; justify-content: center; }
.revoke-link { color: var(--danger); }
.profile-actions { margin-top: var(--space-4); }
.appearance-card { display: grid; gap: var(--space-4); }
.appearance-workspace { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 0.8fr); gap: var(--space-5); align-items: start; }
.appearance-fieldset { margin: 0; padding: 0; border: 0; }
.appearance-fieldset > legend { margin-bottom: 10px; font-size: var(--text-sm); font-weight: 700; }
.theme-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.theme-choice { position: relative; display: grid; gap: 4px; min-height: 136px; padding: 11px; cursor: pointer; color: var(--theme-ink); border: 1px solid color-mix(in srgb, var(--theme-muted) 32%, transparent); border-radius: 12px; background: var(--theme-background); transition: transform var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease); }
.theme-choice:hover { transform: translateY(-1px); }
.theme-choice.selected { border-color: var(--theme-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-accent) 22%, transparent); }
.theme-choice input { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; }
.theme-swatch { display: flex; gap: 4px; align-items: end; min-height: 54px; padding: 7px; border-radius: 8px; background: var(--theme-card); }
.theme-swatch i { display: block; flex: 1; min-height: 24px; border-radius: 4px; background: var(--theme-background); }
.theme-swatch i:nth-child(2) { min-height: 36px; background: var(--theme-accent); }
.theme-swatch i:nth-child(3) { min-height: 30px; background: color-mix(in srgb, var(--theme-accent) 22%, var(--theme-card)); }
.theme-choice strong { margin-top: 3px; font-size: var(--text-sm); }
.theme-choice small { color: var(--theme-muted); font-size: var(--text-xs); }
.appearance-layout { max-width: 330px; margin-top: var(--space-4); }
.appearance-preview-wrap { display: grid; gap: 8px; }
.appearance-preview-label { margin: 0; font-size: var(--text-sm); font-weight: 700; }
.appearance-preview { display: grid; gap: 11px; max-width: 460px; padding: 16px; color: var(--preview-ink); border: 1px solid color-mix(in srgb, var(--preview-muted) 26%, transparent); border-radius: 14px; background: var(--preview-background); }
.preview-top, .preview-month, .preview-days, .preview-times { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.preview-top small, .preview-month span, .preview-days { color: var(--preview-muted); font-size: var(--text-xs); }
.preview-month strong { font-size: var(--text-sm); }
.preview-days { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; }
.preview-calendar { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
.preview-calendar i { display: grid; aspect-ratio: 1; place-items: center; font-style: normal; font-size: var(--text-xs); border-radius: 4px; background: var(--preview-card); }
.preview-calendar i.muted { opacity: .42; }
/* B8: text on the accent uses the theme's on-accent colour (dark on Midnight's light accent). */
.preview-calendar i.selected, .preview-times .selected, .preview-week .selected, .preview-columns > .selected > strong, .preview-columns .selected { color: var(--preview-on-accent); background: var(--preview-accent); }
.preview-week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
.preview-week span { display: grid; min-height: 52px; place-items: center; padding: 4px; text-align: center; border-radius: 5px; background: var(--preview-card); font-size: var(--text-xs); }
.preview-times { justify-content: start; }
.preview-times span { padding: 7px 9px; font-size: var(--text-xs); border: 1px solid color-mix(in srgb, var(--preview-muted) 32%, transparent); border-radius: 5px; background: var(--preview-card); }
.preview-columns { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.preview-columns > div { display: grid; gap: 5px; padding: 6px; border-radius: 6px; background: color-mix(in srgb, var(--preview-card) 82%, var(--preview-background)); }
.preview-columns strong, .preview-columns span { display: grid; min-height: 25px; place-items: center; padding: 3px; text-align: center; border-radius: 4px; font-size: var(--text-xs); }
.preview-columns span { background: var(--preview-card); }
.appearance-actions { margin-top: 0; }
.readiness-hint a { color: var(--accent); }
.readiness-list { margin: var(--space-4) 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.readiness-list li { min-height: 44px; padding: 0 8px 0 12px; display: flex; align-items: center; gap: 8px; color: var(--muted); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: var(--text-sm); }
.readiness-list li > span { flex: 1; }
.readiness-list li.done { color: var(--success); border-color: color-mix(in srgb, var(--success) 25%, transparent); background: var(--success-soft); }
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
.field-label { color: var(--muted); font-size: var(--text-xs); font-weight: var(--weight-strong); }

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
.prep-hint { margin: 4px 0 0 !important; color: var(--warning); }
.prep-hint a { color: var(--accent); }
.override-block { margin-top: var(--space-4); padding-top: var(--space-3); display: grid; gap: var(--space-3); border-top: 1px dashed var(--line-strong); }
.override-head h4 { margin: 0; display: flex; align-items: center; gap: 4px; font-size: var(--text-sm); font-weight: var(--weight-strong); }
.override-row { padding: var(--space-3); display: grid; gap: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
.override-row .field { margin: 0; }
.override-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.override-add { display: grid; gap: 6px; max-width: 360px; }
.template-head h3 { margin: 0; font-size: var(--text-md); }
.template-grid { margin-top: var(--space-3); display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: var(--space-4); align-items: start; }
.template-edit { min-width: 0; }
.var-label { margin: var(--space-2) 0 6px !important; display: flex; align-items: center; gap: 4px; font-size: var(--text-sm); font-weight: var(--weight-strong); }
.var-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.var-chip { min-height: 36px; padding: 0 12px; cursor: pointer; color: var(--ink-soft); border: 1px solid var(--line-strong); border-radius: var(--radius-pill); background: var(--surface); font-size: var(--text-sm); font-weight: var(--weight-medium); transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease); }
.var-chip:hover:not(:disabled) { color: var(--accent); border-color: var(--accent-line); background: var(--accent-faint); }
.var-chip:disabled { cursor: not-allowed; opacity: 0.55; }
.template-preview { padding: var(--space-3); display: grid; gap: 6px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-soft); font-size: var(--text-sm); min-width: 0; overflow-wrap: anywhere; }
.template-preview p { margin: 0; white-space: pre-wrap; color: var(--ink-soft); }

.provider-card h2 { margin: 0; }
.delivery-list { margin: var(--space-3) 0 var(--space-4); display: grid; border-top: 1px solid var(--line); }
.delivery-list > div { padding: var(--space-3) 0; display: grid; grid-template-columns: minmax(160px, 0.8fr) minmax(0, 2fr); gap: var(--space-1) var(--space-4); border-bottom: 1px solid var(--line); }
.delivery-list dt { font-size: var(--text-sm); font-weight: var(--weight-strong); }
.delivery-list dd { margin: 0; color: var(--ink-soft); font-size: var(--text-sm); line-height: 1.5; }
.delivery-list .state { margin-right: var(--space-2); color: var(--muted); font-weight: var(--weight-strong); }
.delivery-list .state.on { color: var(--success); }
.delivery-list .state.off { color: var(--ink-soft); }

/* Share-kit helper text must wrap, never truncate. */
.share-actions p, .share-card .field-hint, .share-card .muted { white-space: normal; overflow: visible; text-overflow: clip; display: block; -webkit-line-clamp: unset; max-width: none; }
.snippet { min-height: 120px; }

@media (max-width: 1050px) {
  .settings-shell { grid-template-columns: 1fr; gap: var(--space-3); }
  .settings-nav { position: sticky; top: var(--topbar-h); z-index: 20; display: flex; gap: 6px; padding: 8px 0; overflow-x: auto; scroll-snap-type: x proximity; background: var(--surface-soft); scrollbar-width: none; }
  .settings-nav::-webkit-scrollbar { display: none; }
  .settings-nav { background: var(--canvas); }
  .settings-nav button { flex: none; white-space: nowrap; scroll-snap-align: start; border: 1px solid var(--line); background: var(--surface); border-radius: var(--radius-pill); }
  .settings-nav button.is-active { border-color: var(--accent); box-shadow: none; }
  .settings-content > *, .link-section > * { scroll-margin-top: calc(var(--topbar-h) + 64px); }
  .link-section { scroll-margin-top: calc(var(--topbar-h) + 64px); }
  .appearance-workspace { grid-template-columns: 1fr; }
}
@media (max-width: 800px) {
  .template-grid { grid-template-columns: 1fr; }
  .link-section { grid-template-columns: minmax(0, 1fr); }
  .theme-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 700px) {
  .notice { flex-wrap: wrap; }
  .notice-action { margin-left: 0; }
  .delivery-list > div { grid-template-columns: 1fr; }
}
.profile-photo-options > summary { min-height: 44px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: var(--text-sm); font-weight: var(--weight-strong); }
.profile-photo-options > summary span { color: var(--muted); font-size: var(--text-xs); font-weight: var(--weight-medium); }
.profile-photo-options .profile-identity { margin-top: var(--space-4); }
</style>
