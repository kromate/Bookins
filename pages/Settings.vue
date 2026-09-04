<script setup>
import { computed, inject, onMounted, reactive, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import BookinsLogo from '../components/BookinsLogo.vue'
import { copyText, createPublicLink, revokePublicLink, saveProfile } from '../booking.js'

const state = inject('bookingState')
const refresh = inject('refreshBookings')
const saving = ref(false)
const linking = ref(false)
const revoking = ref(false)
const confirmRevoke = ref(false)
const copied = ref(false)
const notice = ref('')
const error = ref('')
const form = reactive({ displayName: '', bio: '', timezone: 'Africa/Lagos', photoUrl: '' })
const publicUrl = computed(() => state.profile?.public_link_url || '')
const expires = computed(() => state.profile?.public_link_expires_at ? new Date(state.profile.public_link_expires_at).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Unknown')
const canShare = computed(() => Boolean(state.profile && state.schedules.length && state.services.some(item => item.active !== false && item.visibility === 'public')))
const initials = computed(() => form.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'B')

onMounted(() => {
  if (!state.profile) return
  Object.assign(form, {
    displayName: state.profile.display_name || '',
    bio: state.profile.bio || '',
    timezone: state.profile.timezone || 'Africa/Lagos',
    photoUrl: state.profile.photo_url || '',
  })
})

function flash(message) {
  notice.value = message
  window.setTimeout(() => { notice.value = '' }, 2200)
}

async function submit() {
  saving.value = true
  error.value = ''
  try {
    await saveProfile(state.profile, { ...form, publicLinkUrl: publicUrl.value, publicLinkExpiresAt: state.profile?.public_link_expires_at || '' })
    await refresh()
    flash('Profile saved.')
  } catch (reason) {
    error.value = reason?.message || 'The profile could not be saved.'
  } finally {
    saving.value = false
  }
}

async function createLink() {
  linking.value = true
  error.value = ''
  try {
    const result = await createPublicLink({ kind: 'profile' })
    const url = `${location.origin}${result.routePath || '/book'}#${result.token}`
    await saveProfile(state.profile, { ...form, publicLinkUrl: url, publicLinkExpiresAt: result.expiresAt })
    await refresh()
    flash('Your booking link is ready to share.')
  } catch (reason) {
    error.value = reason?.message || 'The public link could not be created.'
  } finally {
    linking.value = false
  }
}

async function revoke() {
  revoking.value = true
  error.value = ''
  try {
    await revokePublicLink(publicUrl.value)
    await saveProfile(state.profile, { ...form, publicLinkUrl: '', publicLinkExpiresAt: '' })
    await refresh()
    confirmRevoke.value = false
    flash('Booking link revoked.')
  } catch (reason) {
    error.value = reason?.message || 'The public link could not be revoked.'
  } finally {
    revoking.value = false
  }
}

async function copy() {
  await copyText(publicUrl.value)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 1600)
}
</script>

<template>
  <section>
    <div class="page-header">
      <div><p class="eyebrow">Configuration</p><h1>Settings</h1><p class="lede">Shape what guests see and manage the release-pinned link that connects them to this Bookins workspace.</p></div>
      <span class="chip version-chip">Bookins v0.3.0 candidate</span>
    </div>

    <div v-if="notice" class="notice" role="status">{{ notice }}</div>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>

    <div class="settings-layout">
      <form class="card profile-form" @submit.prevent="submit">
        <div class="section-heading"><div><p class="eyebrow">Public profile</p><h2>How guests see you</h2><p class="muted">This information appears at the top of your booking page.</p></div></div>
        <div class="profile-identity"><span v-if="!form.photoUrl" class="profile-avatar">{{ initials }}</span><img v-else :src="form.photoUrl" alt="Profile preview"><div><strong>{{ form.displayName || 'Your display name' }}</strong><small>{{ form.timezone }}</small></div></div>
        <div class="field"><label for="profile-name">Display name</label><input id="profile-name" v-model.trim="form.displayName" maxlength="160" required placeholder="Your name or business"></div>
        <div class="field"><label for="profile-bio">Short bio</label><textarea id="profile-bio" v-model.trim="form.bio" maxlength="1500" placeholder="Tell guests what you help with and what to expect."></textarea><p class="field-hint">{{ form.bio.length }}/1500 characters</p></div>
        <div class="field"><label for="profile-timezone">Booking timezone</label><input id="profile-timezone" v-model.trim="form.timezone" list="profile-timezones" required><datalist id="profile-timezones"><option value="Africa/Lagos"></option><option value="Africa/Accra"></option><option value="Africa/Nairobi"></option><option value="Africa/Johannesburg"></option><option value="Africa/Cairo"></option><option value="Africa/Casablanca"></option><option value="UTC"></option></datalist></div>
        <div class="field"><label for="profile-photo">Photo URL</label><input id="profile-photo" v-model.trim="form.photoUrl" type="url" placeholder="https://example.com/photo.jpg"><p class="field-hint">Use a square image with a public HTTPS URL.</p></div>
        <button class="primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save profile' }}</button>
      </form>

      <div class="settings-side">
        <article class="card booking-page-card">
          <div class="booking-card-mark"><BookinsLogo compact /></div>
          <p class="eyebrow">Public booking page</p>
          <h2>{{ publicUrl ? 'Your link is active' : 'Create your booking link' }}</h2>
          <p class="muted">The link is tied to this App installation and release. Guests can only read your public profile, see available times, and make a booking.</p>

          <template v-if="publicUrl">
            <div class="link-box"><AppIcon name="link" :size="17" /><code>{{ publicUrl }}</code></div>
            <div class="link-status"><span><i />Active</span><small>Expires {{ expires }}</small></div>
            <div class="form-actions"><button class="primary" type="button" @click="copy"><AppIcon name="copy" :size="16" />{{ copied ? 'Copied' : 'Copy link' }}</button><a class="secondary" :href="publicUrl" target="_blank" rel="noreferrer">Preview<AppIcon name="external" :size="15" /></a></div>
            <button class="revoke-link" type="button" @click="confirmRevoke = true">Revoke this booking link</button>
          </template>
          <template v-else>
            <div class="readiness-list">
              <span :class="{ done: state.profile }"><AppIcon :name="state.profile ? 'check' : 'chevron'" :size="13" />Saved profile</span>
              <span :class="{ done: state.schedules.length }"><AppIcon :name="state.schedules.length ? 'check' : 'chevron'" :size="13" />Weekly availability</span>
              <span :class="{ done: state.services.some(item => item.active !== false && item.visibility === 'public') }"><AppIcon :name="state.services.some(item => item.active !== false && item.visibility === 'public') ? 'check' : 'chevron'" :size="13" />Public active service</span>
            </div>
            <button class="primary create-link" type="button" :disabled="linking || !canShare" @click="createLink">{{ linking ? 'Creating…' : 'Create booking link' }}<AppIcon name="chevron" :size="15" /></button>
            <p v-if="!canShare" class="readiness-hint">Finish the missing setup items before creating a link.</p>
          </template>
        </article>

        <article class="card provider-card">
          <p class="eyebrow">Delivery status</p><h2>What this release confirms</h2>
          <ul><li><span class="status-icon ready"><AppIcon name="check" :size="13" /></span><div><strong>On-screen booking confirmation</strong><small>Available now</small></div></li><li><span class="status-icon pending">·</span><div><strong>Email and calendar delivery</strong><small>Not connected yet</small></div></li><li><span class="status-icon pending">·</span><div><strong>Online payments</strong><small>Prices are arranged with you</small></div></li></ul>
        </article>
      </div>
    </div>

    <div v-if="confirmRevoke" class="modal-backdrop" @click.self="confirmRevoke = false">
      <div class="card modal revoke-modal" role="alertdialog" aria-modal="true" aria-labelledby="revoke-title"><span class="revoke-icon"><AppIcon name="link" /></span><p class="eyebrow">Revoke link</p><h2 id="revoke-title">Stop this booking link?</h2><p class="muted">Anyone opening it will see an expired-link state. Your profile, services, and existing bookings stay intact.</p><div class="form-actions"><button class="danger" type="button" :disabled="revoking" @click="revoke">{{ revoking ? 'Revoking…' : 'Revoke link' }}</button><button class="secondary" type="button" :disabled="revoking" @click="confirmRevoke = false">Keep link</button></div></div>
    </div>
  </section>
</template>

<style scoped>
.version-chip{min-height:30px;color:var(--accent);background:var(--accent-soft)}.settings-layout{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(340px,.75fr);gap:18px;align-items:start}.settings-side{display:grid;gap:18px}.section-heading .muted{margin-bottom:0;font-size:12px}.profile-identity{margin-bottom:20px;padding:13px;display:flex;align-items:center;gap:11px;border-radius:12px;background:var(--accent-faint)}.profile-avatar,.profile-identity img{width:48px;height:48px;display:grid;place-items:center;object-fit:cover;color:#fff;border-radius:13px;background:linear-gradient(145deg,#4154ef,#2336dc);font-size:12px;font-weight:850}.profile-identity div{display:grid;gap:3px}.profile-identity strong{font-size:13px}.profile-identity small{color:var(--muted);font-size:10px}.booking-page-card{position:relative;overflow:hidden}.booking-card-mark{position:absolute;right:18px;top:18px}.booking-page-card>.muted{margin-right:58px;font-size:12px}.link-box{margin:18px 0 10px;padding:12px;display:flex;align-items:center;gap:8px;color:var(--accent);border-radius:10px;background:var(--accent-soft)}.link-box code{min-width:0;overflow:hidden;color:#4b5670;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.link-status{margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px}.link-status span{display:flex;align-items:center;gap:6px;color:var(--success);font-size:10px;font-weight:750}.link-status i{width:7px;height:7px;border-radius:50%;background:#1f9d63;box-shadow:0 0 0 3px #e8f7ef}.link-status small{color:var(--muted);font-size:9px}.booking-page-card .form-actions>*{flex:1}.revoke-link{min-height:36px;margin:12px auto 0;display:block;color:var(--danger);border:0;background:transparent;font-size:10px;text-decoration:underline}.readiness-list{margin:18px 0;display:grid;gap:8px}.readiness-list span{min-height:38px;padding:0 11px;display:flex;align-items:center;gap:8px;color:var(--muted);border:1px solid var(--line);border-radius:9px;font-size:11px}.readiness-list span.done{color:var(--success);border-color:#c8ead9;background:var(--success-soft)}.create-link{width:100%}.readiness-hint{margin:10px 0 0;color:var(--muted);font-size:10px;text-align:center}.provider-card ul{padding:0;margin:16px 0 0;display:grid;gap:11px;list-style:none}.provider-card li{display:flex;align-items:center;gap:10px}.status-icon{width:28px;height:28px;display:grid;place-items:center;flex:none;border-radius:8px}.status-icon.ready{color:var(--success);background:var(--success-soft)}.status-icon.pending{color:var(--warning);background:var(--warning-soft);font-size:20px}.provider-card li div{display:grid;gap:2px}.provider-card li strong{font-size:11px}.provider-card li small{color:var(--muted);font-size:9px}.revoke-modal{max-width:460px;text-align:center}.revoke-icon{width:48px;height:48px;margin:0 auto 16px;display:grid;place-items:center;color:var(--danger);border-radius:50%;background:var(--danger-soft)}.revoke-modal .form-actions{margin-top:22px;justify-content:center}@media(max-width:1050px){.settings-layout{grid-template-columns:1fr}.settings-side{grid-template-columns:1fr 1fr}}@media(max-width:700px){.settings-side{grid-template-columns:1fr}.modal-backdrop{padding:10px;align-items:end}.modal{width:100%;border-radius:20px 20px 12px 12px}}
</style>
