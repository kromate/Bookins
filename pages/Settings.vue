<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import BookinsLogo from '../components/BookinsLogo.vue'
import GmDialog from '../components/ui/GmDialog.vue'
import GmSelect from '../components/ui/GmSelect.vue'
import QrCode from '../components/QrCode.vue'
import { copyText, createPublicLink, isTimeOff, revokePublicLink, saveMessageTemplates, saveProfile } from '../booking.js'
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_KINDS,
  TEMPLATE_VARIABLES,
  messageVars,
  renderTemplate,
  resolveTemplates,
  whatsappShareUrl,
} from '../messaging.js'
import { isDemo, registerDemoGuard } from '../runtime.js'

import { displayTimeZone, timezoneOptions } from '../time-display.js'

const timezoneItems = computed(() => timezoneOptions(form.timezone))
const state = inject('bookingState')
const refresh = inject('refreshBookings')
const toast = inject('toast', null)
const router = useRouter()
const saving = ref(false)
const linking = ref(false)
const revoking = ref(false)
const busy = computed(() => saving.value || linking.value || revoking.value)
const confirmRevoke = ref(false)
const linkHeading = ref(null)
const copied = ref(false)
const notice = ref('')
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
    ? new Date(expiresMs.value).toLocaleDateString(undefined, { dateStyle: 'medium' })
    : 'Unknown',
)
const scheduleZone = computed(() => state.schedules[0]?.timezone || '')
const zoneMismatch = computed(() => Boolean(scheduleZone.value) && form.timezone !== scheduleZone.value)
const canShare = computed(() =>
  Boolean(
    state.profile &&
    state.schedules.length &&
    state.services.some((item) => item.active !== false && item.visibility === 'public'),
  ),
)
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
  if (confirmRevoke.value) return 'Close the link confirmation before switching modes.'
  if (dirty.value) return 'Finish or discard your unsaved profile changes before switching modes.'
  if (templatesDirty.value || savingTemplates.value) return 'Save or discard your message template edits before switching modes.'
  return ''
})
onBeforeUnmount(() => {
  removeModeGuard()
  sectionObserver?.disconnect()
  window.clearTimeout(copiedTimer)
  window.clearInterval(clockTimer)
  window.clearTimeout(flashTimer)
  window.clearTimeout(copiedKeyTimer)
})

onBeforeRouteLeave((to) => {
  if (busy.value) { error.value = 'Wait for the current settings action to finish before leaving.'; return false }
  if (allowLeave.value) {
    allowLeave.value = false
    return true
  }
  if (!dirty.value && !confirmRevoke.value) return true
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
  confirmRevoke.value = false
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

let flashTimer = 0
function flash(message) {
  notice.value = message
  toast?.(message)
  window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => {
    notice.value = ''
  }, 2200)
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
      flash('Profile saved.')
    } else {
      profileBaseline.value = normalizeProfile(form)
      error.value = STALE_MESSAGE
    }
  } catch (reason) {
    error.value = reason?.message || 'The profile could not be saved.'
  } finally {
    saving.value = false
  }
}

async function createLink() {
  if (isDemo.value || busy.value) return
  if (!state.profile?.id) {
    error.value = 'Save your profile before creating a booking link.'
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
    if (await reloadChecked()) {
      if (!dirty.value) syncProfileDraft()
      flash('Your booking link is ready to share.')
    } else {
      error.value = STALE_MESSAGE
    }
  } catch (reason) {
    error.value = reason?.message || 'The public link could not be created.'
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
      flash('Booking link revoked.')
    } else {
      error.value = STALE_MESSAGE
    }
    await nextTick()
    linkHeading.value?.focus()
  } catch (reason) {
    error.value = reason?.message || 'The public link could not be revoked.'
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
    error.value = 'Your browser blocked copying. Select the link above and copy it manually.'
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
    error.value = 'Your browser blocked copying. Select the text and copy it manually.'
  }
}

// ----- in-page section nav -----
const sections = [
  { id: 'settings-profile', label: 'Profile' },
  { id: 'settings-link', label: 'Booking link & share kit' },
  { id: 'settings-templates', label: 'Message templates' },
  { id: 'settings-delivery', label: 'Delivery status' },
]
const activeSection = ref(sections[0].id)
let sectionObserver = null
function goToSection(id) {
  activeSection.value = id
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') return
  sectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visible) activeSection.value = visible.target.id
    },
    { rootMargin: '-90px 0px -60% 0px' },
  )
  for (const section of sections) {
    const element = document.getElementById(section.id)
    if (element) sectionObserver.observe(element)
  }
})

// ----- message templates -----
const activeKind = ref(TEMPLATE_KINDS[0])
const showSaveBar = computed(() => !isDemo.value && (dirty.value || templatesDirty.value))
const templateLabels = {
  confirmation: 'Booking confirmation',
  reminder: 'Reminder',
  reschedule: 'Rescheduled',
  cancellation: 'Cancelled',
  followup: 'Follow-up',
}
const cloneTemplates = (source) =>
  Object.fromEntries(TEMPLATE_KINDS.map((kind) => [kind, { subject: source[kind].subject, body: source[kind].body }]))
const templates = reactive(cloneTemplates(resolveTemplates(state.profile)))
const templateBaseline = ref(JSON.stringify(templates))
const templatesDirty = computed(() => JSON.stringify(templates) !== templateBaseline.value)
const savingTemplates = ref(false)
const templateFields = {}
const lastField = reactive({})
const setTemplateField = (kind, field) => (element) => {
  if (element) templateFields[`${kind}:${field}`] = element
}
watch(
  () => state.profile?.message_templates_json,
  () => {
    if (savingTemplates.value || templatesDirty.value) return
    Object.assign(templates, cloneTemplates(resolveTemplates(state.profile)))
    templateBaseline.value = JSON.stringify(templates)
  },
)
const sampleBooking = computed(() => {
  const latest = [...state.bookings]
    .filter((item) => !isTimeOff(item) && item.guest_name)
    .sort((left, right) => Date.parse(right.starts_at) - Date.parse(left.starts_at))[0]
  if (latest) return { booking: latest, real: true }
  const start = new Date(Date.now() + 2 * 86_400_000)
  start.setMinutes(0, 0, 0)
  return {
    real: false,
    booking: {
      guest_name: 'Ada Obi',
      service_name: state.services[0]?.name || 'Consultation',
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 30 * 60_000).toISOString(),
      timezone: state.schedules[0]?.timezone || state.profile?.timezone || 'UTC',
      reference: 'BK-SAMPLE',
    },
  }
})
const previewVars = computed(() => {
  const { booking } = sampleBooking.value
  return messageVars(booking, {
    profile: state.profile,
    service: state.services.find((item) => item.id === booking.service_id) || state.services[0],
    timezone: state.schedules[0]?.timezone,
    bookingLink: shareReady.value ? publicUrl.value : state.profile?.public_link_url,
  })
})
const preview = (kind) => ({
  subject: renderTemplate(templates[kind].subject, previewVars.value),
  body: renderTemplate(templates[kind].body, previewVars.value),
})
const isDefault = (kind) =>
  templates[kind].subject === DEFAULT_TEMPLATES[kind].subject && templates[kind].body === DEFAULT_TEMPLATES[kind].body

const variableToken = (name) => '{' + '{' + name + '}' + '}'
function insertVariable(kind, name) {
  if (isDemo.value || savingTemplates.value) return
  const field = lastField[kind] || 'body'
  const element = templateFields[`${kind}:${field}`]
  const token = variableToken(name)
  const current = templates[kind][field]
  const start = element?.selectionStart ?? current.length
  const end = element?.selectionEnd ?? start
  templates[kind][field] = current.slice(0, start) + token + current.slice(end)
  nextTick(() => {
    if (!element) return
    element.focus()
    const caret = start + token.length
    element.setSelectionRange(caret, caret)
  })
}
function resetTemplate(kind) {
  if (isDemo.value || savingTemplates.value) return
  templates[kind].subject = DEFAULT_TEMPLATES[kind].subject
  templates[kind].body = DEFAULT_TEMPLATES[kind].body
}
async function saveTemplates() {
  if (isDemo.value || savingTemplates.value || busy.value) return
  if (!state.profile?.id) {
    error.value = 'Save your profile before saving message templates.'
    return
  }
  const custom = {}
  for (const kind of TEMPLATE_KINDS) {
    const subject = templates[kind].subject.trim() ? templates[kind].subject : DEFAULT_TEMPLATES[kind].subject
    const body = templates[kind].body.trim() ? templates[kind].body : DEFAULT_TEMPLATES[kind].body
    if (subject !== DEFAULT_TEMPLATES[kind].subject || body !== DEFAULT_TEMPLATES[kind].body) custom[kind] = { subject, body }
  }
  savingTemplates.value = true
  error.value = ''
  try {
    await saveMessageTemplates(state.profile, custom)
    if (await reloadChecked()) {
      Object.assign(templates, cloneTemplates(resolveTemplates(state.profile)))
      templateBaseline.value = JSON.stringify(templates)
      flash('Message templates saved.')
    } else {
      templateBaseline.value = JSON.stringify(templates)
      error.value = STALE_MESSAGE
    }
  } catch (reason) {
    error.value = reason?.message || 'Message templates could not be saved.'
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
      <span class="chip accent version-chip">Bookins v0.5.0 candidate</span>
    </div>

    <div v-if="notice" class="notice" role="status"><AppIcon name="check" :size="18" />{{ notice }}</div>
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
          @submit.prevent="submit"
        >
          <div class="section-heading"
            ><div
              ><p class="eyebrow">Public profile</p><h2>How guests see you</h2
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
              ><label for="profile-name">Display name</label
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
              ><label for="profile-timezone">Booking timezone</label
              ><GmSelect id="profile-timezone" v-model="form.timezone" :options="timezoneItems" label="Booking timezone" :disabled="isDemo || busy" required described-by="profile-timezone-help" />
                <p id="profile-timezone-help" class="field-hint">Choose a city or timezone. With a keyboard, type the city name while the list is open.</p
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
        </form>

        <div id="settings-link" class="link-section">
          <article class="card booking-page-card">
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
                ><span><i />{{ linkExpired ? 'Expired' : 'Active' }}</span><small>{{ linkExpired ? 'Expired' : 'Expires' }} {{ expires }}</small></div
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
              <button
                class="revoke-link"
                type="button"
                :disabled="isDemo || busy"
                @click="confirmRevoke = true"
                >Revoke this booking link</button
              >
            </template>
            <template v-else>
              <div class="readiness-list">
                <span :class="{ done: state.profile }"
                  ><AppIcon
                    :name="state.profile ? 'check' : 'chevron'"
                    :size="14"
                  />Saved profile</span
                >
                <span :class="{ done: state.schedules.length }"
                  ><AppIcon
                    :name="state.schedules.length ? 'check' : 'chevron'"
                    :size="14"
                  />Weekly availability</span
                >
                <span
                  :class="{
                    done: state.services.some(
                      (item) => item.active !== false && item.visibility === 'public',
                    ),
                  }"
                  ><AppIcon
                    :name="
                      state.services.some(
                        (item) => item.active !== false && item.visibility === 'public',
                      )
                        ? 'check'
                        : 'chevron'
                    "
                    :size="14"
                  />Public active service</span
                >
              </div>
              <button
                class="primary create-link"
                type="button"
                :disabled="busy || !canShare || isDemo"
                @click="createLink"
                >{{ linking ? 'Creating…' : 'Create booking link'
                }}<AppIcon
                  name="chevron"
                  :size="15"
              /></button>
              <p
                v-if="!canShare"
                class="readiness-hint"
                >Finish the missing setup items before creating a link.</p
              >
              <p v-if="isDemo" class="readiness-hint">Guest preview does not create grants or public links.</p>
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
          <p class="eyebrow">Message templates</p>
          <h2 id="templates-title">Messages to your guests</h2>
          <p class="muted">These open in your own WhatsApp, SMS, or email. Bookins does not send them.</p>
          <p class="field-hint">
            Preview uses {{ sampleBooking.real ? `your most recent booking (${sampleBooking.booking.guest_name})` : 'a sample booking' }}.
          </p>
          <div class="tab-bar template-tabs" role="group" aria-label="Choose a message template">
            <button
              v-for="kind in TEMPLATE_KINDS"
              :key="kind"
              type="button"
              :class="{ 'is-active': activeKind === kind }"
              :aria-pressed="activeKind === kind"
              @click="activeKind = kind"
              >{{ templateLabels[kind] }}<span v-if="!isDefault(kind)" class="custom-dot" title="Customised"><span class="visually-hidden">(customised)</span></span></button
            >
          </div>
          <template v-for="kind in TEMPLATE_KINDS" :key="kind">
            <div v-if="activeKind === kind" class="template-block">
              <div class="template-head">
                <h3>{{ templateLabels[kind] }}</h3>
                <button class="ghost small-button" type="button" :disabled="isDemo || savingTemplates || isDefault(kind)" @click="resetTemplate(kind)">Reset to default</button>
              </div>
              <div class="template-grid">
                <div class="template-edit">
                  <div class="field">
                    <label :for="`tpl-${kind}-subject`">Subject (email)</label>
                    <input :id="`tpl-${kind}-subject`" :ref="setTemplateField(kind, 'subject')" v-model="templates[kind].subject" :disabled="isDemo || savingTemplates" maxlength="200" @focus="lastField[kind] = 'subject'" />
                  </div>
                  <div class="field">
                    <label :for="`tpl-${kind}-body`">Message</label>
                    <textarea :id="`tpl-${kind}-body`" :ref="setTemplateField(kind, 'body')" v-model="templates[kind].body" :disabled="isDemo || savingTemplates" rows="6" maxlength="2000" @focus="lastField[kind] = 'body'"></textarea>
                    <p class="field-hint">{{ templates[kind].body.length }}/2000 characters</p>
                  </div>
                  <p class="var-label" :id="`tpl-${kind}-vars`">Insert a variable at the cursor</p>
                  <div class="var-chips" role="group" :aria-label="`Insert a variable into ${templateLabels[kind]}`">
                    <button v-for="name in TEMPLATE_VARIABLES" :key="name" class="chip var-chip" type="button" :disabled="isDemo || savingTemplates" @mousedown.prevent @click="insertVariable(kind, name)">{{ variableToken(name) }}</button>
                  </div>
                </div>
                <div class="template-preview" aria-live="polite">
                  <span class="field-label">Preview</span>
                  <strong>{{ preview(kind).subject }}</strong>
                  <p>{{ preview(kind).body }}</p>
                </div>
              </div>
            </div>
          </template>
          <p v-if="templatesDirty && !isDemo" class="field-hint">Unsaved template changes. Use the save bar below.</p>
        </section>

        <article id="settings-delivery" class="card provider-card">
          <p class="eyebrow">Delivery status</p><h2>What this release confirms</h2>
          <ul
            ><li
              ><span class="status-icon ready"
                ><AppIcon
                  name="check"
                  :size="14" /></span
              ><div
                ><strong>On-screen booking confirmation</strong><small>Available now</small></div
              ></li
            ><li
              ><span class="status-icon pending">·</span
              ><div
                ><strong>Email and calendar delivery</strong><small>Not connected yet</small></div
              ></li
            ><li
              ><span class="status-icon pending">·</span
              ><div
                ><strong>Online payments</strong><small>Prices are arranged with you</small></div
              ></li
            ></ul
          >
        </article>
      </div>
    </div>

    <div v-if="showSaveBar" class="sticky-save-bar" role="status">
      <span>{{ leavePrompt ? 'Leave without saving these changes?' : dirty && templatesDirty ? 'Unsaved profile and template changes' : dirty ? 'Unsaved profile changes' : 'Unsaved template changes' }}</span>
      <div class="cluster">
        <button v-if="leavePrompt" class="secondary" type="button" @click="keepEditing">Keep editing</button>
        <button v-if="dirty" class="ghost" type="button" :disabled="busy" @click="discardChanges">Discard changes</button>
        <button v-if="templatesDirty" class="secondary" type="button" :class="{ 'is-pending': savingTemplates }" :disabled="isDemo || savingTemplates || busy" @click="saveTemplates">{{ savingTemplates ? 'Saving…' : 'Save templates' }}</button>
        <button v-if="dirty" class="primary" type="submit" form="settings-profile" :class="{ 'is-pending': saving }" :disabled="busy || isDemo">{{ saving ? 'Saving…' : 'Save profile' }}</button>
      </div>
    </div>

    <GmDialog
      :open="confirmRevoke"
      title="Stop this booking link?"
      :busy="revoking"
      overlay-class="modal-backdrop"
      content-class="card modal revoke-modal"
      role="alertdialog"
      @update:open="open => { if (!revoking) confirmRevoke = open }"
    >
      <span class="revoke-icon"><AppIcon name="link" /></span><p class="eyebrow">Revoke link</p
        ><h2 id="revoke-title">Stop this booking link?</h2
        ><p class="muted"
          >Anyone opening it will see an expired-link state. Your profile, services, and existing
          bookings stay intact.</p
        ><p v-if="error" role="alert" class="notice error">{{ error }}</p>
        <div class="form-actions"
          ><button
            class="secondary"
            type="button"
            :disabled="revoking"
            @click="confirmRevoke = false"
            >Keep link</button>
          <button
            class="danger"
            type="button"
            :disabled="revoking"
            @click="revoke"
            >{{ revoking ? 'Revoking…' : 'Revoke link' }}</button
          ></div>
    </GmDialog>
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
.revoke-link { min-height: var(--control-h); margin: var(--space-2) auto 0; padding: 0 12px; display: block; color: var(--danger); border: 0; background: transparent; font-size: var(--text-sm); text-decoration: underline; }
.readiness-list { margin: var(--space-4) 0; display: grid; gap: 8px; }
.readiness-list span { min-height: 40px; padding: 0 12px; display: flex; align-items: center; gap: 8px; color: var(--muted); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: var(--text-sm); }
.readiness-list span.done { color: var(--success); border-color: #c8ead9; background: var(--success-soft); }
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
.template-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
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

.revoke-modal { max-width: 460px; text-align: center; }
.revoke-icon { width: 48px; height: 48px; margin: 0 auto var(--space-3); display: grid; place-items: center; color: var(--danger); border-radius: 50%; background: var(--danger-soft); }
.revoke-modal .form-actions { margin-top: var(--space-4); justify-content: center; }

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
  .notice-action { margin-left: 0; }
}
</style>
