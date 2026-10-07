<script setup>
// Team: everyone who takes appointments. A member is a person plus their own calendar (a schedule), which is what
// lets two people be booked at the same time. The owner is always member #1 ("You"), implicit until saved.
import { computed, inject, onBeforeUnmount, reactive, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmConfirm from '../components/ui/GmConfirm.vue'
import GmDialog from '../components/ui/GmDialog.vue'
import GmHint from '../components/ui/GmHint.vue'
import WeeklyHoursEditor from '../components/WeeklyHoursEditor.vue'
import IntervalField from '../components/IntervalField.vue'
import TeamServicePicker from '../components/TeamServicePicker.vue'
import {
  deactivateStaff,
  hasTeam,
  isActiveBooking,
  isOwnerMember,
  isStaffActive,
  isStaffCopy,
  ownerStaff,
  reactivateStaff,
  saveSchedule,
  saveStaff,
  servicesForStaff,
  staffCopies,
  staffForBooking,
  staffServiceCopyEstimate,
  teamMembers,
} from '../booking.js'
import { STAFF_COPY_MAX, STAFF_COPY_WARN, parseServiceIds } from '../team.js'
import { STAFF_COLORS, displayName, memberColor, memberFirstName, memberInitial, memberName, nextFreeColor, ownerSaveName, scheduleOf } from '../team-ui.js'
import {
  applyScheduleToDays,
  copyDaysInto,
  dayIssues,
  daysSignature,
  makeDays,
  summarizeHours,
  weeklyHoursTotal,
  weeklyWindowsFromDays,
  windowsAreSaveable,
} from '../weekly-hours.js'
import { isDemo, registerDemoGuard } from '../runtime.js'

const state = inject('bookingState')
const refresh = inject('refreshBookings')
const toast = inject('toast', null)
const ok = (message, options) => toast?.(message, options)
let errorToastId = null
const bad = (message) => {
  if (errorToastId != null) toast?.dismiss?.(errorToastId)
  errorToastId = toast?.error ? toast.error(message) : toast?.(message, { kind: 'error' })
}
const demoHint = computed(() => (isDemo.value ? 'The demo is read-only. Exit Demo to change your team.' : ''))

// ---- list ----
const now = ref(Date.now())
const clock = window.setInterval(() => { now.value = Date.now() }, 60_000)
const team = computed(() => hasTeam(state))
const baseServices = computed(() => (state.services || []).filter((item) => !isStaffCopy(item)))
const upcomingCount = (member) =>
  (state.bookings || []).filter(
    (item) => item.status === 'confirmed' && isActiveBooking(item) && Date.parse(item.ends_at) > now.value && staffForBooking(state, item).id === member.id,
  ).length

function describe(member) {
  const schedule = scheduleOf(state, member)
  const owner = isOwnerMember(member)
  const ids = parseServiceIds(member)
  const offered = servicesForStaff(state, member).length
  const copies = staffCopies(state, null, member).filter((item) => item.active !== false).length
  return {
    member,
    owner,
    schedule,
    hours: summarizeHours(schedule),
    services: !ids.length ? (baseServices.value.length ? `All ${baseServices.value.length} service${baseServices.value.length === 1 ? '' : 's'}` : 'All services') : `${offered} of ${baseServices.value.length} service${baseServices.value.length === 1 ? '' : 's'}`,
    onPage: copies,
    upcoming: upcomingCount(member),
    color: memberColor(member),
    initial: memberInitial(state, member),
  }
}
const rows = computed(() => teamMembers(state, { includeInactive: true }).map(describe))
const activeRows = computed(() => rows.value.filter((row) => isStaffActive(row.member)))
const inactiveRows = computed(() => rows.value.filter((row) => !isStaffActive(row.member)))

// ---- add / edit dialog ----
const open = ref(false)
const editing = ref(null) // the saved member being edited; null while adding
const editingOwner = ref(false)
const saving = ref(false)
const formError = ref('')
const discardOpen = ref(false)
const days = reactive(makeDays())
const form = reactive({ name: '', role: '', color: STAFF_COLORS[0], photoUrl: '', phone: '', email: '', allServices: true, serviceIds: [], intervalMinutes: 60 })
const baseline = ref('')
const hadSchedule = ref(false)
const ownerSchedule = computed(() => scheduleOf(state, ownerStaff(state)))
const hoursReady = computed(() => !editingOwner.value)
const snapshot = () => JSON.stringify({ form: { ...form, serviceIds: [...form.serviceIds].sort() }, hours: hoursReady.value ? daysSignature(days) : '' })
const dirty = computed(() => open.value && snapshot() !== baseline.value)
const issues = computed(() => dayIssues(days))
const hoursIssue = computed(() => {
  if (!hoursReady.value) return ''
  const bad = days.find((day) => issues.value[day.weekday])
  if (bad) return `Fix ${bad.name}: ${issues.value[bad.weekday]}`
  return days.some((day) => day.active) ? '' : 'Open at least one day so this person can be booked.'
})
const copyReason = computed(() => (ownerSchedule.value ? '' : 'Set your own hours in Availability first, then you can copy them.'))
const weeklyHours = computed(() => weeklyHoursTotal(days))
const colorChoices = computed(() => (STAFF_COLORS.includes(form.color.toLowerCase()) || !form.color ? STAFF_COLORS : [form.color, ...STAFF_COLORS]))
const formComplete = computed(() => Boolean(form.name.trim()))
const saveReason = computed(() => {
  if (isDemo.value) return demoHint.value
  if (!formComplete.value) return 'Enter a name first.'
  if (hoursIssue.value) return hoursIssue.value
  if (!form.allServices && !form.serviceIds.length) return 'Choose at least one service, or switch to All services.'
  return ''
})
const removeGuard = registerDemoGuard('bookins-team-dialog', () => (open.value ? 'Close the team member window before switching modes.' : ''))
onBeforeUnmount(() => {
  removeGuard()
  window.clearInterval(clock)
})

function loadHoursFrom(schedule) {
  copyDaysInto(days, makeDays())
  if (!schedule) return false
  try {
    applyScheduleToDays(days, schedule)
    return true
  } catch {
    return false
  }
}

function openAdd() {
  if (isDemo.value) return
  editing.value = null
  editingOwner.value = false
  formError.value = ''
  discardOpen.value = false
  Object.assign(form, { name: '', role: '', color: nextFreeColor(teamMembers(state, { includeInactive: true })), photoUrl: '', phone: '', email: '', allServices: true, serviceIds: [], intervalMinutes: Number(ownerSchedule.value?.slot_interval_minutes) || 60 })
  // A sensible start: the owner's own hours, which the owner can change before saving.
  loadHoursFrom(ownerSchedule.value)
  hadSchedule.value = false
  baseline.value = snapshot()
  open.value = true
}

function openEdit(member) {
  if (isDemo.value) return
  editing.value = member
  editingOwner.value = isOwnerMember(member)
  formError.value = ''
  discardOpen.value = false
  const ids = parseServiceIds(member)
  Object.assign(form, {
    name: member.implicit ? ownerSaveName(state) : member.name || '',
    role: member.role || '',
    color: member.color || memberColor(member),
    photoUrl: member.photo_url || '',
    phone: member.phone || '',
    email: member.email || '',
    allServices: !ids.length,
    serviceIds: ids.filter((id) => baseServices.value.some((item) => item.id === id)),
    intervalMinutes: 60,
  })
  const schedule = scheduleOf(state, member)
  form.intervalMinutes = Number((schedule || ownerSchedule.value)?.slot_interval_minutes) || 60
  hadSchedule.value = Boolean(schedule)
  if (!editingOwner.value) loadHoursFrom(schedule || ownerSchedule.value)
  baseline.value = snapshot()
  open.value = true
}

function closeDialog() {
  if (saving.value) return
  discardOpen.value = false
  open.value = false
}
function requestClose() {
  if (saving.value) return
  if (dirty.value) discardOpen.value = true
  else closeDialog()
}

function copyFromMe() {
  if (!ownerSchedule.value) return
  if (loadHoursFrom(ownerSchedule.value)) ok(`Copied your hours. They are not saved until you press ${editing.value ? 'Save changes' : 'Add to team'}.`)
  else bad('Your saved hours could not be read, so they were not copied.')
}
function onEditorNotice(notice) {
  if (notice.kind === 'error') formError.value = notice.text
  else { formError.value = ''; ok(notice.text) }
}
// The longest service this person is offered: their booking interval has to fit it for guests to pick them.
const offeredServices = computed(() => (form.allServices ? baseServices.value : baseServices.value.filter((item) => form.serviceIds.includes(item.id))).filter((item) => item.active !== false))
const offeredMax = computed(() => Math.max(0, ...offeredServices.value.map((item) => Number(item.duration_minutes || 0))))
const offeredLongest = computed(() => displayName(offeredServices.value.find((item) => Number(item.duration_minutes || 0) === offeredMax.value)?.name || ''))
// Live "N services x M members = K copies" for the services ticked, against the workspace limit.
const pickEstimate = computed(() => {
  if (form.allServices || !form.serviceIds.length) return null
  const people = new Set(teamMembers(state).filter((member) => !isOwnerMember(member)).map((member) => member.id))
  people.add(editing.value?.id && !editing.value.implicit ? editing.value.id : '__new__')
  const base = staffServiceCopyEstimate(state, { serviceIds: form.serviceIds, staffIds: [...people] })
  return { services: form.serviceIds.length, members: people.size, pairs: form.serviceIds.length * people.size, existing: base.existing, total: base.total, max: STAFF_COPY_MAX, warnAt: STAFF_COPY_WARN, overMax: base.overMax }
})

function scheduleSettings(existing) {
  const source = existing || ownerSchedule.value
  return {
    timezone: source?.timezone || state.profile?.timezone || 'Africa/Lagos',
    slotIntervalMinutes: hoursReady.value && Number(form.intervalMinutes) ? Number(form.intervalMinutes) : Number(source?.slot_interval_minutes) || 60,
    minimumNoticeMinutes: Number(source?.minimum_notice_minutes) || 60,
    bookingHorizonDays: Number(source?.booking_horizon_days) || 60,
  }
}

async function submit() {
  if (isDemo.value || saving.value) return
  formError.value = ''
  if (saveReason.value) {
    formError.value = saveReason.value
    bad(saveReason.value)
    return
  }
  const weeklyWindows = hoursReady.value ? weeklyWindowsFromDays(days) : []
  if (hoursReady.value && !windowsAreSaveable(weeklyWindows)) {
    formError.value = 'Fix the highlighted days before saving.'
    return
  }
  saving.value = true
  const adding = !editing.value
  let member = editing.value
  try {
    const saved = await saveStaff(member, {
      name: form.name,
      role: form.role,
      color: form.color,
      photoUrl: form.photoUrl,
      phone: form.phone,
      email: form.email,
      serviceIds: form.allServices ? [] : form.serviceIds,
      ...(editingOwner.value ? { isOwner: true } : {}),
    })
    member = { ...(editing.value && !editing.value.implicit ? editing.value : {}), ...saved, id: saved?.id || editing.value?.id }
    // From here a retry updates this person instead of adding a second one.
    editing.value = member
  } catch (reason) {
    formError.value = reason?.message || 'The team member could not be saved.'
    bad(formError.value)
    saving.value = false
    return
  }
  try {
    if (hoursReady.value) {
      // Only write hours when they are new or were edited; a name or colour change leaves the schedule alone.
      const existing = scheduleOf(state, member)
      if (!existing || daysSignature(days) !== hoursBaseline(existing) || Number(form.intervalMinutes) !== Number(existing.slot_interval_minutes))
        await saveSchedule(existing, { name: existing?.name || `${form.name.trim()} hours`, ...scheduleSettings(existing), weeklyWindows }, member)
    }
  } catch (reason) {
    await refresh()
    hadSchedule.value = false
    formError.value = `${form.name.trim()} was saved, but their hours were not: ${reason?.message || 'try again.'} Fix it and press Save again.`
    bad(formError.value)
    saving.value = false
    return
  }
  const reloaded = (await refresh()) === true
  saving.value = false
  open.value = false
  const first = memberFirstName(member)
  if (!reloaded) bad('Saved, but Bookins could not reload to confirm. Use Refresh to check.')
  else if (adding) ok(`${first} added to your team. You can now assign bookings to ${first} from Bookings.`)
  else ok(editingOwner.value ? 'Your team profile was saved.' : `${first} was saved.`)
}

function hoursBaseline(existing) {
  const probe = makeDays()
  try {
    applyScheduleToDays(probe, existing)
    return daysSignature(probe)
  } catch {
    return ''
  }
}

// ---- deactivate / reactivate ----
const statusBusy = ref(false)
const confirming = ref('') // member id whose list confirmation is open
const dialogConfirmOpen = ref(false)

async function deactivate(member) {
  if (isDemo.value || statusBusy.value) return
  statusBusy.value = true
  try {
    const result = await deactivateStaff(member, state)
    await refresh()
    const copies = result?.hidden || 0
    const first = memberFirstName(member)
    ok(`${first} deactivated.${copies ? ` ${copies} service ${copies === 1 ? 'copy is' : 'copies are'} hidden from your booking page.` : ''} Their bookings are kept.`, {
      action: { label: 'Undo', onClick: () => reactivate(member, true) },
      duration: 7000,
    })
    if (open.value) closeDialogAfterStatus()
  } catch (reason) {
    bad(reason?.message || 'The team member could not be deactivated.')
  } finally {
    statusBusy.value = false
    confirming.value = ''
  }
}

async function reactivate(member, undo = false) {
  if (isDemo.value || (statusBusy.value && !undo)) return
  statusBusy.value = true
  try {
    const result = await reactivateStaff(member, state)
    await refresh()
    const restored = result?.restored || 0
    ok(`${memberFirstName(member)} is active again.${restored ? ` ${restored} service ${restored === 1 ? 'copy is' : 'copies are'} back on your booking page.` : ''}`)
    if (open.value) closeDialogAfterStatus()
  } catch (reason) {
    bad(reason?.message || 'The team member could not be reactivated.')
  } finally {
    statusBusy.value = false
    confirming.value = ''
  }
}
function closeDialogAfterStatus() {
  discardOpen.value = false
  open.value = false
}
const deactivateMessage = (member) =>
  `${memberFirstName(member)} will no longer appear on your booking page: their service copies are hidden from guests, and you cannot assign new bookings to them. Their existing bookings, history and hours are kept, and you can reactivate them any time.${open.value && dirty.value ? ' Edits you have not saved in this window are discarded.' : ''}`
const reactivateMessage = (member) =>
  `${memberFirstName(member)} will be available for assigning bookings again, and their service copies reappear on your booking page.`
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <p class="eyebrow">Your people</p>
        <h1>Team</h1>
        <p class="lede">Everyone who takes appointments. Each person has their own calendar (working hours and time off), so two people can be booked at the same time while one person is never double-booked.</p>
      </div>
      <div class="page-header-actions">
        <GmButton variant="primary" data-tour="tour-team-add" :disabled-reason="demoHint" @click="openAdd"><template #leading><AppIcon name="plus" :size="18" /></template>Add team member</GmButton>
      </div>
    </div>

    <p v-if="isDemo" class="muted demo-note">{{ demoHint }} The sample team shows how it works.</p>

    <div data-tour="tour-team-list" class="team-wrap">
      <ul class="member-list" aria-label="Team members">
        <li v-for="row in activeRows" :key="row.member.id" class="card member-card">
          <span class="member-avatar" :style="{ background: row.color }" aria-hidden="true">
            <img v-if="row.member.photo_url" :src="row.member.photo_url" alt="" loading="lazy" referrerpolicy="no-referrer" @error="(event) => (event.target.style.display = 'none')" />
            <span v-else>{{ row.initial }}</span>
          </span>
          <div class="member-main">
            <div class="member-title">
              <h2>{{ row.owner ? (row.member.implicit ? ownerSaveName(state) : row.member.name) : row.member.name }}</h2>
              <span v-if="row.owner" class="chip accent">You</span>
              <span class="chip success dot">Active</span>
              <span v-if="!row.owner && !row.schedule" class="chip warning">No hours yet</span>
            </div>
            <p v-if="row.member.role || row.member.phone || row.member.email" class="member-contact">
              <span v-if="row.member.role">{{ row.member.role }}</span>
              <span v-if="row.member.phone">{{ row.member.phone }}</span>
              <span v-if="row.member.email">{{ row.member.email }}</span>
            </p>
            <ul class="member-facts">
              <li><AppIcon name="clock" :size="16" /><span>{{ row.hours.text }}<template v-if="row.hours.hoursPerWeek"> · {{ row.hours.hoursPerWeek }} h a week</template></span></li>
              <li><AppIcon name="services" :size="16" /><span>{{ row.services }}<GmHint :text="row.owner ? 'Which services you can be assigned. Guests only see people you have set up on a service.' : 'The services you can assign to this person in Bookings. Whether guests can pick them is set per service in Services.'" label="About services offered" /></span></li>
              <li><AppIcon name="bookings" :size="16" /><span>{{ row.upcoming }} upcoming booking{{ row.upcoming === 1 ? '' : 's' }}<template v-if="row.onPage"> · on your booking page ({{ row.onPage }} service{{ row.onPage === 1 ? '' : 's' }})</template></span></li>
            </ul>
          </div>
          <div class="member-actions">
            <GmButton variant="secondary" size="sm" :disabled-reason="demoHint" @click="openEdit(row.member)"><template #leading><AppIcon name="edit" :size="16" /></template>Edit</GmButton>
            <router-link class="secondary small-button action-link" :to="row.owner ? '/availability' : { path: '/availability', query: { staff: row.member.id } }">Hours</router-link>
            <router-link class="ghost small-button action-link" :to="{ path: '/bookings', query: { staff: row.member.id } }">Bookings</router-link>
            <GmConfirm
              v-if="!row.owner"
              :open="confirming === row.member.id"
              :title="`Deactivate ${memberFirstName(row.member)}?`"
              :message="deactivateMessage(row.member)"
              confirm-label="Deactivate"
              cancel-label="Keep active"
              tone="danger"
              :busy="statusBusy"
              @update:open="(value) => { if (value) confirming = row.member.id; else if (!statusBusy) confirming = '' }"
              @confirm="deactivate(row.member)"
            >
              <GmButton variant="ghost" size="sm" :disabled-reason="demoHint" :aria-label="`Deactivate ${row.member.name}`" @click="confirming = row.member.id">Deactivate</GmButton>
            </GmConfirm>
          </div>
        </li>
      </ul>

      <p v-if="team" class="team-tip muted" data-team-tip>
        <AppIcon name="info" :size="16" />
        <span><strong>Many services?</strong> You do not have to open each service. On the <RouterLink to="/services">Services page</RouterLink>, use "Let guests choose a team member for…" to do it for all services or a whole category. Or add a <code>staff</code> column to your services CSV (names separated by ; or |, for example <code>Amaka; Tolu</code>) and import it.</span>
      </p>

      <div v-if="!team" class="card team-empty">
        <span class="empty-icon"><AppIcon name="team" /></span>
        <h2>Working with other people?</h2>
        <p>Right now it is just you, and everything works exactly as before. Add someone and they get their own calendar: their own working hours and time off.</p>
        <ul class="explain">
          <li><strong>Two people, same time.</strong> Each person is booked separately, so Amaka and Tolu can both have a 10:00 appointment. One person can never be double-booked.</li>
          <li><strong>You assign the work.</strong> In Bookings you assign or reassign a booking to a person, one at a time or in bulk. A move is refused if they are busy or on time off.</li>
          <li><strong>Guests choose, you do not auto-assign.</strong> Letting a guest pick a person is set up per service in Services. "Any professional" (Bookins picks whoever is free) is not available yet.</li>
        </ul>
        <div class="empty-actions">
          <GmButton variant="primary" :disabled-reason="demoHint" @click="openAdd">Add your first team member</GmButton>
        </div>
      </div>

      <template v-if="inactiveRows.length">
        <h2 class="section-title inactive-title">Inactive <GmHint text="Inactive people are hidden from your booking page and cannot be assigned new bookings. Their bookings, history and hours are kept." label="About inactive team members" /></h2>
        <ul class="member-list" aria-label="Inactive team members">
          <li v-for="row in inactiveRows" :key="row.member.id" class="card member-card is-inactive">
            <span class="member-avatar" :style="{ background: row.color }" aria-hidden="true"><span>{{ row.initial }}</span></span>
            <div class="member-main">
              <div class="member-title">
                <h2>{{ row.member.name }}</h2>
                <span class="chip neutral">Inactive</span>
              </div>
              <p v-if="row.member.role" class="member-contact"><span>{{ row.member.role }}</span></p>
              <ul class="member-facts">
                <li><AppIcon name="bookings" :size="16" /><span>{{ row.upcoming }} upcoming booking{{ row.upcoming === 1 ? '' : 's' }} still on their calendar</span></li>
              </ul>
            </div>
            <div class="member-actions">
              <GmConfirm
                :open="confirming === row.member.id"
                :title="`Reactivate ${memberFirstName(row.member)}?`"
                :message="reactivateMessage(row.member)"
                confirm-label="Reactivate"
                cancel-label="Not now"
                :busy="statusBusy"
                @update:open="(value) => { if (value) confirming = row.member.id; else if (!statusBusy) confirming = '' }"
                @confirm="reactivate(row.member)"
              >
                <GmButton variant="secondary" size="sm" :disabled-reason="demoHint" @click="confirming = row.member.id">Reactivate</GmButton>
              </GmConfirm>
              <GmButton variant="ghost" size="sm" :disabled-reason="demoHint" @click="openEdit(row.member)">Edit</GmButton>
              <router-link class="ghost small-button action-link" :to="{ path: '/bookings', query: { staff: row.member.id } }">Bookings</router-link>
            </div>
          </li>
        </ul>
      </template>
    </div>

    <GmDialog
      :open="open"
      :title="editing && !editing.implicit ? 'Edit team member' : editingOwner ? 'Your team profile' : 'Add team member'"
      :busy="saving"
      content-class="card modal member-dialog"
      overlay-class="modal-backdrop"
      @update:open="(value) => { if (!value) requestClose() }"
    >
      <form novalidate @submit.prevent="submit">
        <div class="modal-header">
          <div>
            <p class="eyebrow">{{ editingOwner ? 'You' : editing ? 'Team member' : 'New team member' }}</p>
            <h2>{{ editingOwner ? 'Your team profile' : editing ? `Edit ${form.name.trim() || 'team member'}` : 'Add team member' }}</h2>
          </div>
          <button class="icon-button" type="button" aria-label="Close" @click="requestClose"><AppIcon name="close" /></button>
        </div>

        <div v-if="formError" class="notice error" role="alert"><AppIcon name="alert" :size="18" />{{ formError }}</div>

        <p v-if="editingOwner" class="field-hint form-hint">This is how you appear next to your own bookings. Your working hours are edited in Availability.</p>
        <p v-else-if="!editing" class="field-hint form-hint">They get their own calendar. Two people can be booked at the same time; the same person cannot.</p>

        <div class="field">
          <label for="member-name">Name</label>
          <input id="member-name" v-model="form.name" maxlength="120" autocomplete="off" required :aria-invalid="formError && !form.name.trim() ? 'true' : undefined" />
        </div>
        <div class="field-row">
          <div class="field">
            <label for="member-role">Role <span class="optional">(optional)</span></label>
            <input id="member-role" v-model="form.role" maxlength="120" placeholder="Senior stylist" autocomplete="off" />
          </div>
          <div class="field">
            <label for="member-phone">Phone <span class="optional">(optional)</span></label>
            <input id="member-phone" v-model="form.phone" type="tel" maxlength="40" autocomplete="off" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="member-email">Email <span class="optional">(optional)</span></label>
            <input id="member-email" v-model="form.email" type="email" maxlength="254" autocomplete="off" />
          </div>
          <div class="field">
            <label for="member-photo">Photo link <span class="optional">(optional)</span> <GmHint text="A link to a picture, for example from your website or social page. Bookins shows their initial if there is none or it cannot load." label="About the photo link" /></label>
            <input id="member-photo" v-model="form.photoUrl" type="url" maxlength="2000" placeholder="https://" autocomplete="off" />
          </div>
        </div>

        <fieldset class="field colour-field">
          <legend>Colour <GmHint text="Used for this person's chip, and on the week view in Bookings, so you can tell calendars apart at a glance." label="About colours" /></legend>
          <div class="swatches" role="radiogroup" aria-label="Colour">
            <label v-for="color in colorChoices" :key="color" class="swatch" :style="{ '--swatch': color }" :title="color">
              <input v-model="form.color" type="radio" name="member-color" :value="color" /><span class="swatch-dot" aria-hidden="true"><AppIcon v-if="form.color === color" name="check" :size="16" /></span>
              <span class="visually-hidden">{{ color }}</span>
            </label>
          </div>
        </fieldset>

        <fieldset class="field services-field">
          <legend>Services they offer <GmHint text="The services you can assign to this person. It does not publish anything: what guests can pick is set per service in Services." label="About services offered" /></legend>
          <div class="segmented" role="group" aria-label="Services they offer">
            <button type="button" :class="{ 'is-active': form.allServices }" :aria-pressed="form.allServices" @click="form.allServices = true">All services</button>
            <button type="button" :class="{ 'is-active': !form.allServices }" :aria-pressed="!form.allServices" :disabled="!baseServices.length" @click="form.allServices = false">Choose services</button>
          </div>
          <p v-if="!baseServices.length" class="field-hint">You have no services yet. They will be able to offer every service you add.</p>
          <TeamServicePicker v-else-if="!form.allServices" v-model:selected="form.serviceIds" :services="baseServices" :estimate="pickEstimate" :disabled="saving" />
          <p v-else class="field-hint">Offers all {{ baseServices.length }} of your services, including ones you add later.</p>
        </fieldset>

        <section v-if="hoursReady" class="hours-box" aria-labelledby="member-hours-title">
          <div class="hours-head">
            <div>
              <h3 id="member-hours-title">Working hours <GmHint text="Their own calendar. Guests and assignments only use these hours; time off is added per person in Availability. Times are in the same timezone as your own schedule." label="About working hours" /></h3>
              <p class="field-hint">{{ weeklyHours }} hours a week<template v-if="!hadSchedule"> · starts as a copy of yours, change it below</template></p>
            </div>
            <GmButton variant="secondary" size="sm" :disabled-reason="copyReason" @click="copyFromMe">Copy hours from me</GmButton>
          </div>
          <IntervalField
            id="member-interval"
            v-model="form.intervalMinutes"
            :max-duration="offeredMax"
            :longest-name="offeredLongest"
            :strict="false"
            :disabled="saving"
            who="their"
            class="hours-interval"
          />
          <WeeklyHoursEditor :days="days" compact :disabled="saving" @notice="onEditorNotice" />
        </section>
        <p v-else class="field-hint form-hint">Your own hours and time off: <router-link to="/availability" @click="closeDialog">open Availability</router-link>.</p>

        <section v-if="editing && !editing.implicit && !editingOwner" class="status-box" aria-labelledby="member-status-title">
          <div>
            <h3 id="member-status-title">Status <span class="chip dot" :class="isStaffActive(editing) ? 'success' : 'neutral'">{{ isStaffActive(editing) ? 'Active' : 'Inactive' }}</span></h3>
            <p class="field-hint">{{ isStaffActive(editing) ? 'Deactivating hides them from your booking page and from new assignments. Bookings and hours are kept.' : 'Inactive: hidden from your booking page and new assignments.' }} This takes effect right away, separately from Save.</p>
          </div>
          <GmConfirm
            v-model:open="dialogConfirmOpen"
            :title="isStaffActive(editing) ? `Deactivate ${memberFirstName(editing)}?` : `Reactivate ${memberFirstName(editing)}?`"
            :message="isStaffActive(editing) ? deactivateMessage(editing) : reactivateMessage(editing)"
            :confirm-label="isStaffActive(editing) ? 'Deactivate' : 'Reactivate'"
            cancel-label="Not now"
            :tone="isStaffActive(editing) ? 'danger' : 'default'"
            :busy="statusBusy"
            @confirm="isStaffActive(editing) ? deactivate(editing) : reactivate(editing)"
          >
            <GmButton variant="secondary" size="sm" :disabled="saving" :disabled-reason="demoHint" @click="dialogConfirmOpen = true">{{ isStaffActive(editing) ? 'Deactivate' : 'Reactivate' }}</GmButton>
          </GmConfirm>
        </section>

        <div class="form-actions modal-footer">
          <GmButton variant="primary" type="submit" :pending="saving" pending-label="Saving…" :disabled-reason="saveReason">{{ editing ? 'Save changes' : 'Add to team' }}</GmButton>
          <GmConfirm
            v-model:open="discardOpen"
            title="Discard your changes?"
            message="What you typed has not been saved and will be lost."
            confirm-label="Discard"
            cancel-label="Keep editing"
            tone="danger"
            @confirm="closeDialog"
          >
            <GmButton variant="secondary" :disabled="saving" @click="requestClose">Cancel</GmButton>
          </GmConfirm>
        </div>
        <p v-if="saveReason && !isDemo" class="field-hint save-reason" role="status">{{ saveReason }}</p>
      </form>
    </GmDialog>
  </section>
</template>

<style scoped>
.demo-note { margin: 0 0 var(--space-3); font-size: var(--text-sm); }
.team-wrap { display: grid; gap: var(--space-4); }
.member-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-3); }
.member-card { padding: var(--space-4); display: grid; grid-template-columns: 56px minmax(0, 1fr) auto; align-items: start; gap: var(--space-4); box-shadow: none; }
.member-card.is-inactive { background: #fafafc; }
.member-card.is-inactive .member-avatar { opacity: 0.55; }
.member-avatar { width: 56px; height: 56px; display: grid; place-items: center; overflow: hidden; color: #fff; border-radius: 50%; font-size: var(--text-xl); font-weight: 750; }
.member-avatar img { width: 100%; height: 100%; display: block; object-fit: cover; }
.member-main { min-width: 0; display: grid; gap: var(--space-2); }
.member-title { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.member-title h2 { margin: 0; font-size: var(--text-lg); overflow-wrap: anywhere; }
.member-contact { margin: 0; display: flex; flex-wrap: wrap; gap: 2px var(--space-3); color: var(--muted); font-size: var(--text-sm); }
.member-contact span { overflow-wrap: anywhere; }
.member-facts { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.member-facts li { display: flex; align-items: center; gap: 8px; color: var(--ink-soft, var(--ink)); font-size: var(--text-sm); }
.member-facts li > svg { flex: none; color: var(--muted); }
.member-facts li > span { min-width: 0; display: inline-flex; align-items: center; flex-wrap: wrap; gap: 0 4px; }
.member-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); max-width: 440px; }
.action-link { min-height: var(--control-h-sm); display: inline-flex; align-items: center; justify-content: center; text-decoration: none; }
.inactive-title { margin: var(--space-4) 0 0; display: flex; align-items: center; gap: 4px; }

.team-empty { padding: var(--space-6) var(--space-5); display: grid; justify-items: center; gap: var(--space-3); text-align: center; box-shadow: none; }
.team-empty h2 { margin: 0; }
.team-empty > p { max-width: 62ch; margin: 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.6; }
.explain { max-width: 62ch; margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-3); text-align: left; }
.explain li { padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--accent-faint); font-size: var(--text-sm); line-height: 1.55; }
.empty-actions { margin-top: var(--space-2); display: flex; justify-content: center; flex-wrap: wrap; gap: var(--space-2); }

.form-hint { margin: 0 0 var(--space-4); }
.optional { color: var(--muted); font-weight: 400; }
.modal .field { min-width: 0; }
.modal .field-row .field { margin-bottom: var(--space-4); }
.colour-field, .services-field { margin: 0 0 var(--space-4); padding: 0; border: 0; min-width: 0; }
.colour-field legend, .services-field legend { padding: 0; margin-bottom: 6px; display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-sm); font-weight: 650; }
.swatches { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.swatch { position: relative; width: 44px; height: 44px; display: grid; place-items: center; cursor: pointer; }
.swatch input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.swatch-dot { width: 32px; height: 32px; display: grid; place-items: center; color: #fff; border-radius: 50%; background: var(--swatch); box-shadow: 0 0 0 2px #fff, 0 0 0 3px var(--line-strong); }
.swatch input:checked + .swatch-dot { box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--swatch); }
.swatch input:focus-visible + .swatch-dot { outline: 3px solid rgba(35, 54, 220, 0.4); outline-offset: 4px; }
.services-field .segmented { margin-bottom: var(--space-2); }
.hours-box { margin: 0 0 var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-sm); overflow: hidden; }
.hours-head { padding: var(--space-3); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2); background: var(--surface-soft); }
.hours-head h3 { margin: 0; display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-sm); }
.hours-head .field-hint { margin: 2px 0 0; }
.status-box { margin: 0 0 var(--space-4); padding: var(--space-3); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--accent-faint); }
.status-box h3 { margin: 0; display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
.status-box .field-hint { max-width: 46ch; margin: 4px 0 0; }
.save-reason { margin: var(--space-2) 0 0; color: var(--muted); text-align: right; }

@media (max-width: 700px) {
  .member-card { grid-template-columns: 48px minmax(0, 1fr); gap: var(--space-3); padding: var(--space-3); }
  .member-avatar { width: 48px; height: 48px; font-size: var(--text-lg); }
  .member-actions { grid-column: 1 / -1; max-width: none; justify-content: flex-start; }
  .team-empty { padding: var(--space-5) var(--space-4); }
  .save-reason { text-align: left; }
  .modal-footer > button, .modal-footer > a { flex: 1 1 auto; }
}
.hours-interval { margin: 0; padding: var(--space-3) var(--space-3) var(--space-2); }
.team-tip { margin: var(--space-3) 0 0; padding: var(--space-3); display: flex; gap: var(--space-2); align-items: flex-start; border: 1px dashed var(--line-strong); border-radius: var(--radius-sm); font-size: var(--text-sm); line-height: 1.5; }
.team-tip svg { flex: none; margin-top: 2px; }
.team-tip code { padding: 1px 5px; border-radius: 4px; background: var(--surface-soft); font-family: var(--font-mono); font-size: var(--text-xs); }
</style>

<style>
.member-dialog { width: min(660px, 100%); }
</style>
