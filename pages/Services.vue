<script setup>
import { computed, inject, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import GmSelect from '../components/ui/GmSelect.vue'
import GmDialog from '../components/ui/GmDialog.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmConfirm from '../components/ui/GmConfirm.vue'
import GmHint from '../components/ui/GmHint.vue'
import { useSetupState } from '../setup.js'
import QrCode from '../components/QrCode.vue'
import ServiceImportDialog from '../components/ServiceImportDialog.vue'
import ServiceTeamFields from '../components/ServiceTeamFields.vue'
import BulkTeamChoiceDialog from '../components/BulkTeamChoiceDialog.vue'
import {
  STAFF_COPY_MAX,
  STAFF_COPY_WARN,
  copyText,
  createServiceLink,
  createStaffServices,
  deleteService,
  deleteStaffServiceCopies,
  exportServicesCsv,
  hasTeam,
  isStaffActive,
  isStaffCopy,
  isTimeOff,
  revokeServiceLink,
  saveService,
  saveStaff,
  scheduleForStaff,
  serviceDisplayMeta,
  staffById,
  staffCopies,
  staffServiceCopyEstimate,
  syncStaffServices,
  teamMembers,
} from '../booking.js'
import { isOwnerMember, ownerStaff, parseServiceIds, serviceBaseId } from '../team.js'
import { displayName } from '../team-ui.js'
import { smallestIntervalFor } from '../weekly-hours.js'
import { whatsappShareUrl } from '../messaging.js'
import { isDemo, registerDemoGuard } from '../runtime.js'

const state = inject('bookingState')
const refresh = inject('refreshBookings')
const router = useRouter()
const route = useRoute()
const setup = useSetupState()
const toast = inject('toast', null)
const show = ref(false)
const selectPortalTarget = ref(null)
const keepServiceButton = ref(null)
const saving = ref(false)
const deleting = ref(false)
const editing = ref(null)
const pendingDelete = ref(null)
const error = ref('')
const serviceBaseline = ref('')
const dialogPrompt = ref(false)
const pendingRoute = ref('')
const allowLeave = ref(false)
const currencies = ['NGN', 'GHS', 'KES', 'ZAR', 'UGX', 'TZS', 'XOF', 'USD']
const form = reactive({
  name: '',
  description: '',
  durationMinutes: 30,
  price: 0,
  currency: 'NGN',
  visibility: 'public',
  active: true,
  location: '',
  category: '',
  sortOrder: '',
  rebookAfterDays: '',
  prepNotes: '',
})
const teamEnabled = ref(false)
const teamSelected = ref([])
const importOpen = ref(false)
const importBusy = ref(false)
const bulkOpen = ref(false)
const bulkBusy = ref(false)
const capPrompt = ref(false)
// Availability must exist before a service can be created (services use the owner's schedule).
const ownerSchedule = computed(() => scheduleForStaff(state, ownerStaff(state)) || (hasTeam(state) ? null : state.schedules[0]) || null)
const needsAvailability = computed(() => !ownerSchedule.value || !setup.value.hasAvailability)
const scheduleInterval = computed(() => Number(ownerSchedule.value?.slot_interval_minutes || 0))

// The interval Availability will preselect when the owner follows the "raise the interval" link.
const neededInterval = computed(() => {
  const value = Number(form.durationMinutes)
  return Number.isInteger(value) && value > scheduleInterval.value ? smallestIntervalFor(value) : 0
})
const intervalLink = computed(() =>
  neededInterval.value ? { path: '/availability', query: { interval: String(Number(form.durationMinutes)) } } : { path: '/availability' },
)
const durationError = computed(() => {
  const value = Number(form.durationMinutes)
  if (!Number.isInteger(value) || value < 5) return 'Enter a duration of at least 5 minutes.'
  if (value % 5 !== 0) return 'Duration must be a multiple of 5 minutes.'
  if (scheduleInterval.value && value > scheduleInterval.value)
    return `This is longer than your ${scheduleInterval.value}-minute booking interval. Bookins reserves one interval per booking, so raise the interval to at least ${value} minutes in Availability or shorten the service.`
  return ''
})
const sortOrderError = computed(() => {
  const raw = String(form.sortOrder ?? '').trim()
  if (raw === '') return ''
  const value = Number(raw)
  return Number.isInteger(value) && Math.abs(value) <= 100000 ? '' : 'Enter a whole number, for example 1, 2, 3.'
})
const rebookError = computed(() => {
  const raw = String(form.rebookAfterDays ?? '').trim()
  if (raw === '') return ''
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 && value <= 730 ? '' : 'Enter a number of days from 1 to 730, or leave it blank.'
})
const editingMeta = computed(() => (editing.value ? serviceDisplayMeta(editing.value) : null))
const categories = computed(() =>
  [...new Set(state.services.filter((item) => !isStaffCopy(item)).map((item) => serviceDisplayMeta(item).category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
)

// ---- team service copies ----
const showTeam = computed(() => hasTeam(state))
const copyMemberIds = computed(() =>
  editing.value ? [...new Set(staffCopies(state, editing.value).map((copy) => serviceDisplayMeta(copy).staffId))] : [],
)
const teamPeople = computed(() => teamMembers(state, { includeInactive: true }).filter((member) => !isOwnerMember(member)))
const pickerMembers = computed(() =>
  teamPeople.value
    .filter((member) => isStaffActive(member) || copyMemberIds.value.includes(member.id))
    .map((member) => ({ id: member.id, name: member.name, role: member.role, color: member.color, inactive: !isStaffActive(member) })),
)
const memberIssues = computed(() => {
  const out = {}
  for (const member of pickerMembers.value) {
    const record = staffById(state, member.id)
    const schedule = scheduleForStaff(state, record)
    const interval = Number(schedule?.slot_interval_minutes || 0)
    if (member.inactive) out[member.id] = 'Not active. Reactivate them on the Team page to offer this.'
    else if (!schedule) out[member.id] = `Set working hours for ${member.name} on the Team page first.`
    else if (interval && Number(form.durationMinutes) > interval) out[member.id] = `${member.name}'s booking interval is ${interval} min, shorter than this ${form.durationMinutes}-minute service.`
  }
  return out
})
const memberNotes = computed(() => {
  const out = {}
  for (const member of teamPeople.value) {
    const ids = parseServiceIds(member)
    if (ids.length && !ids.includes(editing.value?.id)) out[member.id] = 'Not on their service list yet. Saving adds it.'
  }
  return out
})
// Members whose copies will exist after saving (a member with a blocking issue keeps an existing copy but gets no new one).
const teamCreatable = computed(() => (teamEnabled.value ? teamSelected.value.filter((id) => !memberIssues.value[id]) : []))
const teamEstimate = computed(() => {
  const base = staffServiceCopyEstimate(state, { serviceIds: [editing.value?.id || '__new__'], staffIds: teamCreatable.value })
  const kept = teamEnabled.value ? copyMemberIds.value.filter((id) => teamSelected.value.includes(id)) : []
  const removing = copyMemberIds.value.length - kept.length
  const total = base.existing - removing + base.adding
  return { ...base, removing, total, overCap: base.adding > 0 && total > STAFF_COPY_WARN, overMax: base.adding > 0 && total > STAFF_COPY_MAX }
})
const copiesOf = (service) => state.services.filter((item) => serviceBaseId(item) === service.id)
const memberName = (copy) => serviceDisplayMeta(copy).staffName || staffById(state, serviceDisplayMeta(copy).staffId)?.name || 'Team member'
const memberColor = (copy) => staffById(state, serviceDisplayMeta(copy).staffId)?.color || ''
const nameConflict = computed(() => {
  const name = form.name.trim().toLowerCase()
  if (!name) return ''
  const other = state.services.find(
    (item) => !isStaffCopy(item) && item.id !== editing.value?.id && String(item.name || '').trim().toLowerCase() === name,
  )
  return other ? `You already have a service called "${displayName(other.name)}". Choose a different name.` : ''
})
const submitReason = computed(() => {
  if (isDemo.value) return 'The demo is read-only.'
  if (needsAvailability.value) return 'Set your availability first, then create the service.'
  if (nameConflict.value) return nameConflict.value
  if (durationError.value) return 'Fix the duration: it must be a multiple of 5 minutes and fit your booking interval.'
  if (sortOrderError.value) return sortOrderError.value
  if (rebookError.value) return rebookError.value
  if (showTeam.value && teamEnabled.value && !teamSelected.value.length) return 'Choose at least one team member, or turn off "Let guests choose a team member".'
  if (showTeam.value && teamEstimate.value.overMax) return `That would make ${teamEstimate.value.total} team copies; the limit is ${STAFF_COPY_MAX}. Offer this with fewer people.`
  return ''
})
const upcomingCount = (service) => {
  const now = Date.now()
  const ids = new Set([service.id, ...copiesOf(service).map((copy) => copy.id)])
  return state.bookings.filter(
    (item) => ids.has(item.service_id) && !isTimeOff(item) && item.status === 'confirmed' && Date.parse(item.ends_at || item.starts_at) > now,
  ).length
}
const deleteUpcoming = computed(() => (pendingDelete.value ? upcomingCount(pendingDelete.value) : 0))
const pausing = ref(false)
const linkBusy = ref('')
const linkError = ref({})
const copiedLink = ref('')
const pendingRevoke = ref(null)
const nowMs = ref(Date.now())
let copiedTimer = 0
onBeforeUnmount(() => window.clearTimeout(copiedTimer))
const linkExpired = (service) => {
  const expiry = Date.parse(service.public_link_expires_at || '')
  return Boolean(service.public_link_url) && Number.isFinite(expiry) && expiry <= nowMs.value
}
const linkLive = (service) => Boolean(service.public_link_url) && !linkExpired(service)
const shareText = (service) => `Book ${displayName(service.name)}${state.profile?.display_name ? ` with ${state.profile.display_name}` : ''}: ${service.public_link_url}`
const whatsappShare = (service) => whatsappShareUrl(shareText(service))
const setLinkError = (service, message) => { linkError.value = { ...linkError.value, [service.id]: message } }

async function makeLink(service) {
  if (isDemo.value || linkBusy.value) return
  linkBusy.value = service.id
  nowMs.value = Date.now()
  setLinkError(service, '')
  try {
    await createServiceLink(service)
    await refresh()
    toast?.success('Direct link created')
  } catch (reason) {
    const message = reason?.message || 'The direct link could not be created.'
    setLinkError(service, message)
    toast?.error(message)
  } finally {
    linkBusy.value = ''
  }
}

async function copyServiceLink(service) {
  setLinkError(service, '')
  try {
    await copyText(service.public_link_url)
    copiedLink.value = service.id
    toast?.('Link copied')
    window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => { copiedLink.value = '' }, 1600)
  } catch {
    setLinkError(service, 'Your browser blocked copying. Select the link and copy it manually.')
    toast?.error('Could not copy the link. Select it and copy manually.')
  }
}

async function confirmRevoke() {
  const service = pendingRevoke.value
  if (isDemo.value || !service || linkBusy.value) return
  linkBusy.value = service.id
  setLinkError(service, '')
  try {
    await revokeServiceLink(service)
    pendingRevoke.value = null
    await refresh()
    toast?.success('Direct link revoked. Anyone holding it can no longer book.')
  } catch (reason) {
    const message = reason?.message || 'The direct link could not be revoked.'
    setLinkError(service, message)
    toast?.error(message)
    pendingRevoke.value = null
  } finally {
    linkBusy.value = ''
  }
}
const currencyOptions = currencies.map((value) => ({ value, label: value }))
const visibilityOptions = [
  { value: 'public', label: 'Public booking page' },
  { value: 'private', label: 'Private (not on the public page)' },
]
const statusOptions = [
  { value: true, label: 'Active' },
  { value: false, label: 'Paused' },
]

const normalizeService = () => JSON.stringify({
  name: form.name.trim(),
  description: form.description.trim(),
  durationMinutes: Number(form.durationMinutes),
  price: Number(form.price || 0),
  currency: form.currency,
  visibility: form.visibility,
  active: form.active,
  location: form.location.trim(),
  category: form.category.trim(),
  sortOrder: String(form.sortOrder ?? '').trim(),
  rebookAfterDays: String(form.rebookAfterDays ?? '').trim(),
  prepNotes: form.prepNotes.trim(),
  team: showTeam.value ? { on: teamEnabled.value, ids: [...teamSelected.value].sort() } : null,
})
const serviceDirty = computed(() => show.value && normalizeService() !== serviceBaseline.value)
const syncServiceBaseline = () => { serviceBaseline.value = normalizeService() }
const removeModeGuard = registerDemoGuard('bookins-services', () => {
  if (saving.value || deleting.value) return 'Wait for the current service action to finish.'
  if (bulkBusy.value) return 'Wait for the team copies to finish before switching modes.'
  if (bulkOpen.value) return 'Close the team choice window before switching modes.'
  if (importBusy.value) return 'Wait for the import to finish, or stop it, before switching modes.'
  if (importOpen.value) return 'Close the import before switching modes.'
  if (pendingDelete.value) return 'Close the delete confirmation before switching modes.'
  if (serviceDirty.value) return 'Finish or discard the open service before switching modes.'
  return ''
})
onBeforeUnmount(removeModeGuard)

onBeforeRouteLeave((to) => {
  if (saving.value || deleting.value) { error.value = 'Wait for the current service action to finish before leaving.'; return false }
  if (bulkBusy.value) { error.value = 'Team copies are being created. Wait for them to finish before leaving.'; return false }
  if (importBusy.value) { error.value = 'An import is running. Stop it or wait for it to finish before leaving.'; return false }
  if (allowLeave.value) {
    allowLeave.value = false
    return true
  }
  if (!serviceDirty.value) return true
  pendingRoute.value = to.fullPath
  dialogPrompt.value = true
  return false
})

function open(service = null) {
  if (saving.value || deleting.value) return
  error.value = ''
  dialogPrompt.value = false
  editing.value = service
  const meta = service ? serviceDisplayMeta(service) : null
  Object.assign(
    form,
    service
      ? {
          name: service.name,
          description: meta.text,
          durationMinutes: service.duration_minutes,
          price: service.price || 0,
          currency: service.currency || 'NGN',
          visibility: service.visibility,
          active: service.active !== false,
          location: service.location || '',
          category: meta.category,
          sortOrder: meta.sortOrder ?? '',
          rebookAfterDays: meta.rebookAfterDays || '',
          prepNotes: meta.prepNotes,
        }
      : {
          name: '',
          description: '',
          durationMinutes: Math.min(scheduleInterval.value || 30, 30),
          price: 0,
          currency: 'NGN',
          visibility: 'public',
          active: true,
          location: '',
          category: '',
          sortOrder: '',
          rebookAfterDays: '',
          prepNotes: '',
        },
  )
  const had = service ? [...new Set(staffCopies(state, service).map((copy) => serviceDisplayMeta(copy).staffId))] : []
  teamEnabled.value = had.length > 0
  teamSelected.value = had
  syncServiceBaseline()
  show.value = true
}

function close() {
  if (saving.value) return
  if (serviceDirty.value) {
    dialogPrompt.value = true
    return
  }
  show.value = false
  editing.value = null
  dialogPrompt.value = false
}

function discardChanges() {
  if (saving.value || deleting.value) return
  if (serviceDirty.value && serviceBaseline.value) {
    const { team: _team, ...saved } = JSON.parse(serviceBaseline.value)
    Object.assign(form, saved)
  }
  error.value = ''
  show.value = false
  editing.value = null
  dialogPrompt.value = false
  const route = pendingRoute.value
  pendingRoute.value = ''
  if (route) {
    allowLeave.value = true
    router.push(route)
  }
}

function keepEditing() {
  dialogPrompt.value = false
  pendingRoute.value = ''
}

function requestDeleteClose() {
  pendingDelete.value = null
  error.value = ''
}

function askDelete(service) {
  error.value = ''
  pendingDelete.value = service
}

function focusKeepService(event) {
  event.preventDefault()
  keepServiceButton.value?.focus({ preventScroll: true })
}

function priceLabel(service) {
  if (!Number(service.price)) return 'Free'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: service.currency || 'NGN',
      maximumFractionDigits: 0,
    }).format(service.price)
  } catch {
    return `${service.currency || 'NGN'} ${Number(service.price).toLocaleString()}`
  }
}

function servicePayload() {
  const sort = String(form.sortOrder ?? '').trim()
  const rebook = String(form.rebookAfterDays ?? '').trim()
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    durationMinutes: Number(form.durationMinutes),
    price: Number(form.price || 0),
    currency: form.currency,
    visibility: form.visibility,
    active: form.active,
    location: form.location.trim(),
    category: form.category.trim(),
    // Sort order cannot be cleared once set (an empty field keeps the saved order); rebook "0" means off.
    sortOrder: sort === '' ? editingMeta.value?.sortOrder : Number(sort),
    rebookAfterDays: rebook === '' ? (editingMeta.value?.rebookAfterDays ? 0 : undefined) : Number(rebook),
    prepNotes: form.prepNotes.trim(),
  }
}

// Creates, refreshes and removes this service's per-member copies to match the form. Returns a short summary.
async function applyTeamCopies(saved) {
  const had = copyMemberIds.value
  const keep = teamEnabled.value ? teamSelected.value : []
  const outcome = { created: 0, updated: 0, removed: 0, skipped: [] }
  let services = state.services
  if (!teamEnabled.value && had.length) {
    outcome.removed = (await deleteStaffServiceCopies(state, saved)).removed
    services = services.filter((item) => serviceBaseId(item) !== saved.id)
  } else {
    for (const id of had.filter((memberId) => !keep.includes(memberId))) {
      outcome.removed += (await deleteStaffServiceCopies(state, saved, { id })).removed
      services = services.filter((item) => !(serviceBaseId(item) === saved.id && serviceDisplayMeta(item).staffId === id))
    }
  }
  const wanted = teamCreatable.value
  if (!wanted.length) return outcome
  // A member whose service list is restricted gets this service added to it (that is what "offers this" means).
  const staff = []
  for (const member of state.staff || []) {
    const ids = parseServiceIds(member)
    if (wanted.includes(member.id) && ids.length && !ids.includes(saved.id)) {
      const next = [...ids, saved.id]
      await saveStaff(member, { serviceIds: next })
      staff.push({ ...member, service_ids_json: JSON.stringify(next) })
    } else staff.push(member)
  }
  const made = await createStaffServices({ ...state, services, staff }, saved, wanted, { confirmOverCap: true })
  outcome.created = made.created.length
  outcome.updated = made.updated.length
  outcome.skipped = made.skipped.map((item) => item.reason)
  return outcome
}

async function submit(confirmedCap = false) {
  if (isDemo.value || saving.value || deleting.value) return
  const schedule = ownerSchedule.value
  if (!schedule || needsAvailability.value) {
    // Keep the dialog and everything typed; the availability card in the dialog explains the next step.
    error.value = 'Set your availability first. Your service details are kept here.'
    return
  }
  if (durationError.value || nameConflict.value || sortOrderError.value || rebookError.value) {
    error.value = durationError.value || nameConflict.value || sortOrderError.value || rebookError.value
    return
  }
  if (showTeam.value && (submitReason.value || '')) {
    error.value = submitReason.value
    return
  }
  if (showTeam.value && teamEstimate.value.overCap && confirmedCap !== true) {
    capPrompt.value = true
    return
  }
  const wasEditing = Boolean(editing.value)
  saving.value = true
  error.value = ''
  let savedService = null
  try {
    const scheduleId = editing.value?.schedule_id && state.schedules.some((item) => item.id === editing.value.schedule_id) ? editing.value.schedule_id : schedule.id
    const saved = await saveService(editing.value, { ...servicePayload(), scheduleId }, state.services)
    savedService = { ...(editing.value || {}), ...(saved || {}) }
    let copies = null
    if (showTeam.value || copyMemberIds.value.length) copies = await applyTeamCopies(savedService)
    await refresh()
    show.value = false
    editing.value = null
    const bits = []
    if (copies?.created || copies?.updated) bits.push(`${copies.created + copies.updated} team ${copies.created + copies.updated === 1 ? 'copy' : 'copies'} ${copies.created ? 'created' : 'refreshed'}`)
    if (copies?.removed) bits.push(`${copies.removed} team ${copies.removed === 1 ? 'copy' : 'copies'} removed`)
    toast?.success(`${wasEditing ? 'Service updated' : 'Service created'}${bits.length ? `. ${bits.join(', ')}.` : ''}`)
    if (copies?.skipped.length) toast?.error(`Some team copies were not created: ${[...new Set(copies.skipped)].join(' ')}`)
  } catch (reason) {
    error.value = reason?.message || 'The service could not be saved.'
    if (savedService) {
      // The service itself was saved; only the team copies failed. Reload so the form reflects what exists.
      await refresh()
      toast?.error(`The service was saved, but its team copies were not: ${error.value} Open it and save again to retry.`)
      show.value = false
      editing.value = null
      error.value = ''
    } else toast?.error(`${error.value} Your changes are still in the form.`)
  } finally {
    saving.value = false
  }
}

async function pauseInstead() {
  const service = pendingDelete.value
  if (isDemo.value || !service || pausing.value) return
  pausing.value = true
  error.value = ''
  try {
    const saved = await saveService(service, {
      name: service.name,
      durationMinutes: service.duration_minutes,
      price: service.price || 0,
      currency: service.currency || 'NGN',
      visibility: service.visibility,
      active: false,
      location: service.location || '',
      scheduleId: service.schedule_id || ownerSchedule.value?.id,
    }, state.services)
    // Team copies follow the main service, so pausing it pauses them too.
    if (copiesOf(service).length) await syncStaffServices(state, { ...service, ...(saved || {}), active: false })
    pendingDelete.value = null
    await refresh()
    toast?.success('Service paused. Existing bookings are unchanged; resume it any time.')
  } catch (reason) {
    error.value = reason?.message || 'The service could not be paused.'
    toast?.error(error.value)
  } finally {
    pausing.value = false
  }
}

async function remove() {
  if (isDemo.value || !pendingDelete.value) return
  deleting.value = true
  error.value = ''
  try {
    if (!isStaffCopy(pendingDelete.value) && copiesOf(pendingDelete.value).length) await deleteStaffServiceCopies(state, pendingDelete.value)
    await deleteService(pendingDelete.value.id)
    pendingDelete.value = null
    await refresh()
    toast?.success('Service deleted. Existing booking history was kept.')
  } catch (reason) {
    error.value = reason?.message || 'The service could not be deleted.'
    toast?.error(error.value)
  } finally {
    deleting.value = false
  }
}

// ---- list: search, categories, order ----
const search = ref('')
const collapsed = ref({})
const baseEntries = computed(() => state.services.filter((item) => !isStaffCopy(item)).map((service) => ({ service, meta: serviceDisplayMeta(service) })))
const orphanCopies = computed(() => {
  const ids = new Set(baseEntries.value.map((entry) => entry.service.id))
  return state.services.filter((item) => isStaffCopy(item) && !ids.has(serviceBaseId(item)))
})
const matchesSearch = (entry) => {
  const words = search.value.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = [entry.service.name, entry.meta.category, entry.meta.text, ...copiesOf(entry.service).map(memberName)].join(' ').toLowerCase()
  return words.every((word) => haystack.includes(word))
}
const groups = computed(() => {
  const byCategory = new Map()
  for (const entry of baseEntries.value.filter(matchesSearch)) {
    const key = entry.meta.category || ''
    if (!byCategory.has(key)) byCategory.set(key, [])
    byCategory.get(key).push(entry)
  }
  const order = (entry) => entry.meta.sortOrder ?? Number.MAX_SAFE_INTEGER
  // Categories follow the lowest sort order among their services (then name); uncategorised services come last.
  return [...byCategory.entries()]
    .map(([category, entries]) => {
      const sorted = entries.sort((a, b) => order(a) - order(b) || String(a.service.name).localeCompare(String(b.service.name)))
      return { category, entries: sorted, rank: Math.min(...sorted.map(order)) }
    })
    .sort((a, b) => (a.category === '' ? 1 : b.category === '' ? -1 : a.rank - b.rank || a.category.localeCompare(b.category)))
})
const showHeadings = computed(() => groups.value.some((group) => group.category))
const groupLabel = (group) => group.category || 'Other services'
const toggleGroup = (key) => { collapsed.value = { ...collapsed.value, [key]: !collapsed.value[key] } }

// ---- bulk: let guests choose a team member ----
const activePeople = computed(() => teamPeople.value.filter((member) => isStaffActive(member)))
const bulkReason = computed(() => {
  if (isDemo.value) return 'The demo is read-only. Switch to your own workspace to change services.'
  if (!activePeople.value.length) return 'Add an active team member on the Team page first.'
  if (!activePeople.value.some((member) => scheduleForStaff(state, member))) return 'Set working hours for a team member first (Team page).'
  if (saving.value || deleting.value) return 'Wait for the current service action to finish.'
  return ''
})

// ---- export ----
const exportReason = computed(() => (baseEntries.value.length ? '' : 'Add a service first: there is nothing to export yet.'))
function exportCsv() {
  if (!baseEntries.value.length) return
  try {
    const text = exportServicesCsv(state.services, state.schedules, { staff: state.staff || [] })
    const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `bookins-services-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast?.success(`Exported ${baseEntries.value.length} ${baseEntries.value.length === 1 ? 'service' : 'services'}. Edit the file in Google Sheets and import it back any time.`)
  } catch (reason) {
    toast?.error(reason?.message || 'The export could not be created.')
  }
}
const importDisabledReason = computed(() => {
  if (isDemo.value) return 'Import is not available in the demo. Switch to your own workspace to import services. Export still works.'
  if (needsAvailability.value) return 'Set your availability first: imported services need your booking interval.'
  if (saving.value || deleting.value) return 'Wait for the current service action to finish.'
  return ''
})

// Overview "New service" lands here with ?new=1: open the editor, then clean the query.
function openFromQuery() {
  if (!route.query.new) return
  const { new: _drop, ...rest } = route.query
  router.replace({ path: route.path, query: rest })
  if (!isDemo.value) open()
}
onMounted(openFromQuery)
watch(() => route.query.new, openFromQuery)

// "Continue your import" (after the interval was fixed in Availability) lands here with ?import=1.
const resumeImport = ref(false)
function openImportFromQuery() {
  if (!route.query.import) return
  const { import: _drop, ...rest } = route.query
  router.replace({ path: route.path, query: rest })
  if (isDemo.value || importDisabledReason.value) return
  resumeImport.value = true
  importOpen.value = true
}
onMounted(openImportFromQuery)
watch(() => route.query.import, openImportFromQuery)
watch(importOpen, (value) => { if (!value) resumeImport.value = false })
</script>

<template>
  <section>
    <div class="page-header">
      <div
        ><p class="eyebrow">Your offerings</p><h1>Services</h1
        ><p class="lede"
          >Create the sessions people can book. Each service uses your shared availability and can
          be paused without losing its history.</p
        ></div
      >
      <div class="page-header-actions">
        <GmButton
          variant="secondary"
          :disabled-reason="exportReason"
          @click="exportCsv"
          ><template #leading><AppIcon name="download" :size="17" /></template>Export services</GmButton
        ><GmButton
          data-tour="tour-services-import"
          variant="secondary"
          :disabled-reason="importDisabledReason"
          @click="importOpen = true"
          ><template #leading><AppIcon name="copy" :size="17" /></template>Import</GmButton
        ><GmButton
          data-tour="tour-services-new"
          class="primary"
          :disabled-reason="isDemo ? 'The demo is read-only. Switch to your own workspace to add services.' : ''"
          :disabled="saving || deleting"
          @click="open()"
          ><template #leading><AppIcon name="plus" :size="17" /></template>New service</GmButton
        >
      </div>
    </div>

    <div
      v-if="error && !show && !pendingDelete"
      class="notice error"
      role="alert"
      >{{ error }}</div
    >

    <article v-if="needsAvailability && !isDemo" class="card availability-first" data-tour="tour-services-availability">
      <span class="icon-tile info"><AppIcon name="availability" :size="20" /></span>
      <div>
        <p class="eyebrow">Step 1</p>
        <h2>Set your availability first</h2>
        <p class="muted">Services use your weekly hours to offer times to guests, so Bookins needs your hours before it can create a service. It takes about a minute.</p>
      </div>
      <RouterLink class="primary" to="/availability">Set availability<AppIcon name="chevron" :size="15" /></RouterLink>
    </article>

    <div v-if="baseEntries.length" data-tour="tour-services-list">
      <div class="toolbar services-toolbar">
        <div class="search-field">
          <AppIcon name="search" :size="18" />
          <input v-model="search" type="search" aria-label="Search services" placeholder="Search services or categories" />
        </div>
        <GmButton v-if="showTeam" variant="secondary" size="sm" data-tour="tour-services-bulk-team" :disabled-reason="bulkReason" @click="bulkOpen = true"><template #leading><AppIcon name="team" :size="16" /></template>Let guests choose a team member for…</GmButton>
        <span class="muted tnum" role="status">{{ groups.reduce((sum, group) => sum + group.entries.length, 0) }} of {{ baseEntries.length }} {{ baseEntries.length === 1 ? 'service' : 'services' }}</span>
      </div>

      <div v-if="!groups.length" class="empty compact">
        <span class="empty-icon"><AppIcon name="search" /></span>
        <h2>No services match “{{ search }}”</h2>
        <p>Try a shorter word, or clear the search to see everything.</p>
        <button class="secondary" type="button" @click="search = ''">Clear search</button>
      </div>

      <section v-for="group in groups" :key="group.category || '__none'" class="category-group">
        <h2 v-if="showHeadings" class="group-title">
          <button type="button" class="group-toggle" :aria-expanded="!collapsed[group.category]" @click="toggleGroup(group.category)">
            <AppIcon class="group-chevron" name="chevron" :size="16" />{{ groupLabel(group) }}
            <span class="count-pill">{{ group.entries.length }}</span>
          </button>
        </h2>
        <div v-show="!collapsed[group.category]" class="service-grid">
      <article
        v-for="{ service, meta } in group.entries"
        :key="service.id"
        class="card service-card"
      >
        <div class="service-card-top">
          <span class="icon-tile"
            ><AppIcon
              name="services"
              :size="20"
          /></span>
          <div class="service-badges"
            ><span
              class="chip"
              :class="service.active !== false ? 'active' : 'paused'"
              >{{ service.active !== false ? 'Active' : 'Paused' }}</span
            ><span
              class="chip"
              :class="service.visibility"
              :title="service.visibility === 'private' ? 'Hidden from your booking page; bookable only through its direct link.' : 'Listed on your public booking page'"
              >{{ service.visibility === 'private' ? 'Private' : 'Public' }}</span
            ></div
          >
        </div>
        <div class="service-copy"
          ><h3 class="service-name">{{ displayName(service.name) }}</h3
          ><p>{{ meta.text }}</p></div
        >
        <div v-if="meta.prepNotes || meta.rebookAfterDays" class="service-chips">
          <span v-if="meta.prepNotes" class="chip info" :title="`Prep notes: ${meta.prepNotes}`"><AppIcon name="info" :size="13" />Prep notes</span>
          <span v-if="meta.rebookAfterDays" class="chip neutral" :title="`Clients are listed under Rebook in Messages ${meta.rebookAfterDays} days after a finished visit.`"><AppIcon name="refresh" :size="13" />Rebook after {{ meta.rebookAfterDays }} {{ meta.rebookAfterDays === 1 ? 'day' : 'days' }}</span>
        </div>
        <p v-if="service.visibility === 'private'" class="private-note">Private — hidden from your booking page; bookable only through its direct link.</p>
        <p v-if="upcomingCount(service)" class="private-note">{{ upcomingCount(service) }} upcoming {{ upcomingCount(service) === 1 ? 'booking' : 'bookings' }}</p>
        <div class="service-facts"
          ><span
            ><AppIcon
              name="clock"
              :size="16"
            />{{ service.duration_minutes }} min</span
          ><strong class="tnum">{{ priceLabel(service) }}</strong></div
        >
        <div v-if="copiesOf(service).length" class="team-copies">
          <p class="copies-title">
            Team copies
            <GmHint text="Each copy is this same service on one team member's own hours, so guests can pick 'With Amaka'. Copies mirror this service: name, length, price and status. They cannot be edited on their own; edit this service and saving updates every copy." label="About team copies" />
          </p>
          <ul>
            <li v-for="copy in copiesOf(service)" :key="copy.id">
              <span class="swatch" :style="{ background: memberColor(copy) || 'var(--line-strong)' }" aria-hidden="true" />
              <span class="copy-name">With {{ memberName(copy) }}</span>
              <span class="chip" :class="copy.active !== false ? 'active' : 'paused'">{{ copy.active !== false ? 'Active' : 'Paused' }}</span>
            </li>
          </ul>
          <p class="private-note">Follows this service. Edit this service to change them.</p>
        </div>
        <details class="direct-link" :open="Boolean(linkError[service.id]) || undefined">
          <summary class="direct-summary">
            <AppIcon name="link" :size="16" /><span>Direct link</span>
            <span class="chip" :class="linkLive(service) ? 'success' : linkExpired(service) ? 'warning' : 'neutral'">{{ linkLive(service) ? 'Live' : linkExpired(service) ? 'Expired' : 'Not created' }}</span>
            <AppIcon class="direct-chevron" name="chevron" :size="16" />
          </summary>
          <div class="direct-body">
            <p class="private-note">A direct link opens booking for this one service only, so you can share it in a chat or on a poster. {{ service.visibility === 'private' ? 'This service is private, so its direct link is the only way guests can book it.' : 'Optional: your public booking page already lists this service.' }}</p>
            <template v-if="linkLive(service)">
              <code>{{ service.public_link_url }}</code>
              <div class="direct-actions">
                <button class="secondary small-button" type="button" @click="copyServiceLink(service)"><AppIcon name="copy" :size="16" />{{ copiedLink === service.id ? 'Copied' : 'Copy link' }}</button>
                <a class="secondary small-button" :href="whatsappShare(service)" target="_blank" rel="noreferrer">Share on WhatsApp</a>
                <button class="ghost small-button delete-link" type="button" :disabled="isDemo || Boolean(linkBusy)" @click="pendingRevoke = service">Revoke</button>
              </div>
              <QrCode :value="service.public_link_url" :size="140" :label="`QR code for ${displayName(service.name)} direct link`" />
            </template>
            <template v-else-if="linkExpired(service)">
              <p class="private-note">This direct link has expired. Guests opening it see an expired-link page.</p>
              <button class="primary small-button" type="button" :disabled="isDemo || Boolean(linkBusy)" @click="makeLink(service)">{{ linkBusy === service.id ? 'Creating…' : 'Create new link' }}</button>
            </template>
            <button v-else class="secondary small-button" type="button" :disabled="isDemo || Boolean(linkBusy)" @click="makeLink(service)">{{ linkBusy === service.id ? 'Creating…' : 'Create direct link' }}</button>
            <p v-if="linkError[service.id]" class="field-error private-note" role="alert">{{ linkError[service.id] }}</p>
          </div>
        </details>
        <div class="service-actions"
          ><GmButton
            variant="secondary"
            size="sm"
            :disabled-reason="isDemo ? 'The demo is read-only.' : ''"
            :disabled="saving || deleting"
            @click="open(service)"
            ><template #leading><AppIcon name="edit" :size="16" /></template>Edit service</GmButton
          ><GmButton
            variant="ghost"
            size="sm"
            class="icon-delete delete-link"
            :aria-label="`Delete ${displayName(service.name)}`"
            :disabled-reason="isDemo ? 'The demo is read-only.' : ''"
            :disabled="saving || deleting"
            @click="askDelete(service)"
            ><AppIcon name="trash" :size="18" /></GmButton
          ></div
        >
      </article>
        </div>
      </section>

      <section v-if="orphanCopies.length && !search" class="category-group orphans">
        <h2 class="group-title"><span class="group-toggle static">Team copies without a main service <span class="count-pill">{{ orphanCopies.length }}</span></span></h2>
        <p class="muted">These copies belong to a service that was deleted. Guests can still see them. Remove them if you no longer offer them.</p>
        <ul class="orphan-list">
          <li v-for="copy in orphanCopies" :key="copy.id">
            <span><strong>{{ displayName(copy.name) }}</strong> with {{ memberName(copy) }}</span>
            <GmButton variant="ghost" size="sm" class="delete-link" :disabled-reason="isDemo ? 'The demo is read-only.' : ''" @click="askDelete(copy)">Remove</GmButton>
          </li>
        </ul>
      </section>
    </div>

    <div
      v-else
      class="empty"
      data-tour="tour-services-list"
    >
      <span class="empty-icon"><AppIcon name="services" /></span>
      <h2>Create your first service</h2>
      <p>Set a clear name, duration, and price so guests know exactly what they are booking.</p>
      <p v-if="needsAvailability && !isDemo" class="muted">You will be asked to set your availability first.</p>
      <div class="empty-actions">
        <GmButton
          class="primary"
          :disabled-reason="isDemo ? 'The demo is read-only.' : ''"
          :disabled="saving || deleting"
          @click="open()"
          ><template #leading><AppIcon name="plus" :size="17" /></template>Create service</GmButton
        ><GmButton
          variant="secondary"
          :disabled-reason="importDisabledReason"
          @click="importOpen = true"
          ><template #leading><AppIcon name="copy" :size="17" /></template>Import from a spreadsheet</GmButton
        >
      </div>
    </div>

    <GmDialog
      :open="show"
      :title="editing ? 'Update this service' : 'What can people book?'"
      content-class="card modal bookins-service-dialog"
      overlay-class="modal-backdrop bookins-modal-backdrop"
      :busy="saving"
      @update:open="(value) => { if (!value) close() }"
    >
      <form
        ref="selectPortalTarget"
        class="bookins-service-dialog-form"
        @submit.prevent="submit"
      >
        <div class="modal-header"
          ><div
            ><p class="eyebrow">{{ editing ? 'Edit service' : 'New service' }}</p
            ><h2>{{
              editing ? 'Update this service' : 'What can people book?'
            }}</h2
            ><p class="muted"
              >Keep the offer specific. Guests will see this copy before choosing a time.</p
            ></div
          ><button
            class="icon-button"
            type="button"
            aria-label="Close"
            :disabled="saving || deleting"
            @click="close"
            ><AppIcon name="close" /></button
        ></div>
        <div
          v-if="needsAvailability && !isDemo && !editing"
          class="notice warning availability-note"
          role="status"
          ><AppIcon name="availability" :size="18" /><span><strong>Set your availability first.</strong> Services use your weekly hours, so a service can only be created once you have them. You can fill in the details now; they stay here. <RouterLink to="/availability">Set availability</RouterLink></span></div
        >
        <div
          v-if="error"
          class="notice error"
          role="alert"
          >{{ error }}</div
        >
        <section class="form-section">
          <h3>Basics</h3>
          <div class="field"
            ><label for="service-name">Service name <span class="req">(required)</span></label
            ><input
              id="service-name"
              v-model.trim="form.name"
              :disabled="isDemo || saving || deleting"
              maxlength="100"
              required
              :aria-invalid="Boolean(nameConflict)"
              placeholder="30-minute discovery call"
          /><p v-if="nameConflict" class="field-hint field-error" role="alert">{{ nameConflict }}</p></div>
          <div class="field"
            ><label for="service-category">Category (optional) <GmHint text="Groups services under a heading on your booking page and in this list, for example Braids, Nails or Lashes. Pick one you already use or type a new one." label="About categories" /></label
            ><input
              id="service-category"
              v-model.trim="form.category"
              :disabled="isDemo || saving || deleting"
              list="service-category-options"
              maxlength="80"
              autocomplete="off"
              placeholder="Braids, Nails, Consultations…" /><datalist id="service-category-options"><option v-for="item in categories" :key="item" :value="item" /></datalist></div>
          <div class="field"
            ><label for="service-description">Description <span class="req">(required)</span></label
            ><textarea
              id="service-description"
              v-model.trim="form.description"
              :disabled="isDemo || saving || deleting"
              maxlength="1500"
              required
              placeholder="Tell guests what you will cover and what they should prepare."
            ></textarea>
          </div>
        </section>
        <section class="form-section">
          <h3>Duration and price</h3>
          <div class="grid grid-2 form-grid"
            ><div class="field"
              ><label for="service-duration">Duration (minutes) <GmHint text="Duration is how long one appointment lasts. The slot interval, set in Availability, is how often guests can pick a start time (for example every 30 minutes). Each booking reserves one interval, so duration cannot exceed it." label="About duration and slot interval" /></label
              ><input
                id="service-duration"
                v-model.number="form.durationMinutes"
                :disabled="isDemo || saving || deleting"
                type="number"
                min="5"
                step="5"
                                inputmode="numeric"
                required
                :aria-invalid="Boolean(durationError)"
                aria-describedby="service-duration-hint" /><p
                id="service-duration-hint"
                class="field-hint"
                :class="{ 'field-error': durationError }"
                >{{ durationError || (scheduleInterval ? `Up to your ${scheduleInterval}-minute slot interval.` : 'Minutes, in steps of 5.') }}
                <RouterLink v-if="scheduleInterval" :to="intervalLink">{{ neededInterval ? `Set the interval to ${neededInterval} minutes` : 'Change interval' }}</RouterLink></p
              ></div
            ><div class="field price-field"
              ><label for="service-price">Display price <GmHint text="Shown to you and in messages as the price you have agreed with the client. Bookins does not take payments yet, so guests pay you directly. Use 0 for free." label="About display price" /></label
              ><div
                ><GmSelect
                  v-model="form.currency"
                  :options="currencyOptions"
                  label="Currency"
                  :disabled="isDemo || saving || deleting"
                  :portal-target="selectPortalTarget || 'body'" /><input
                  id="service-price"
                  v-model.number="form.price"
                  :disabled="isDemo || saving || deleting"
                  type="number"
                  min="0"
                  step="1"
                  aria-label="Price" /></div
              ><p class="field-hint"
                >Guests pay you directly. Online payment is not active yet.</p
              ></div
            ></div
          >
        </section>
        <details class="form-section advanced-form-section" :open="Boolean(sortOrderError || rebookError) || undefined">
          <summary>Order, reminders and preparation <span>Optional</span></summary>
          <div class="advanced-form-content">
          <div class="grid grid-2 form-grid"
            ><div class="field"
              ><label for="service-sort">Sort order <GmHint text="Lower numbers come first inside the category, on your booking page and in this list. Leave it blank to sort by name. Once a number is set it can be changed but not cleared." label="About sort order" /></label
              ><input
                id="service-sort"
                v-model="form.sortOrder"
                :disabled="isDemo || saving || deleting"
                type="number"
                step="1"
                inputmode="numeric"
                placeholder="1"
                :aria-invalid="Boolean(sortOrderError)"
                aria-describedby="service-sort-hint" /><p id="service-sort-hint" class="field-hint" :class="{ 'field-error': sortOrderError }">{{ sortOrderError || (editingMeta?.sortOrder !== undefined && String(form.sortOrder) === '' ? `Left blank, it keeps the current order (${editingMeta.sortOrder}).` : 'Lower numbers show first. Blank sorts by name.') }}</p></div
            ><div class="field"
              ><label for="service-rebook">Rebook reminder after N days <GmHint text="After a client's visit has been completed this many days, Bookins lists them under Rebook in Messages so you can open a reminder in your own WhatsApp, SMS or email app. Nothing is sent automatically. Leave blank or 0 for no reminder." label="About the rebook reminder" /></label
              ><input
                id="service-rebook"
                v-model="form.rebookAfterDays"
                :disabled="isDemo || saving || deleting"
                type="number"
                min="0"
                max="730"
                step="1"
                inputmode="numeric"
                placeholder="42"
                :aria-invalid="Boolean(rebookError)"
                aria-describedby="service-rebook-hint" /><p id="service-rebook-hint" class="field-hint" :class="{ 'field-error': rebookError }">{{ rebookError || 'Days after a finished visit. Blank means no reminder.' }}</p></div
          ></div>
          <div class="field"
            ><label for="service-prep">Prep notes (shown to the guest before they come) <GmHint text="What the guest should do or bring, for example 'Arrive with washed, detangled hair'. It is added to the preparation message you open for them about two days before the visit, and travels with the service on your booking page. Bookins does not send it for you." label="About prep notes" /></label
            ><textarea
              id="service-prep"
              v-model="form.prepNotes"
              :disabled="isDemo || saving || deleting"
              maxlength="400"
              rows="3"
              placeholder="Arrive with washed, detangled hair. Bring a reference photo."
              aria-describedby="service-prep-hint"
            ></textarea><p id="service-prep-hint" class="field-hint tnum">{{ form.prepNotes.length }}/400</p></div>
          </div>
        </details>
        <details class="form-section advanced-form-section" :open="Boolean(teamEnabled && teamSelected.some((id) => memberIssues[id])) || undefined">
          <summary>Booking options <span>Visibility, status, location and team</span></summary>
          <div class="advanced-form-content">
          <div class="grid grid-2 form-grid"
            ><div class="field"
              ><label for="service-visibility">Visibility <GmHint text="Public services are listed on your booking page. Private services are hidden there and can only be booked through their own direct link, which suits one-to-one or invite-only offers." label="About visibility" /></label
              ><GmSelect
                id="service-visibility"
                v-model="form.visibility"
                :options="visibilityOptions"
                label="Visibility"
                :disabled="isDemo || saving || deleting"
                :portal-target="selectPortalTarget || 'body'" /></div
            ><div class="field"
              ><label for="service-status">Status <GmHint text="Paused services are hidden from guests but keep their history. You can resume them any time." label="About status" /></label
              ><GmSelect
                id="service-status"
                v-model="form.active"
                :options="statusOptions"
                label="Status"
                :disabled="isDemo || saving || deleting"
                :portal-target="selectPortalTarget || 'body'" /></div
          ></div>
          <div class="field"
            ><label for="service-location">Location (optional) <GmHint text="Where the appointment happens: an address, a phone call, or a video link. It goes into your messages to clients and calendar events, but is not shown on the booking page yet." label="About location" /></label
            ><input
              id="service-location"
              v-model.trim="form.location"
              :disabled="isDemo || saving || deleting"
              maxlength="300"
              placeholder="Address, phone call, or a video meeting URL" /></div>
        <ServiceTeamFields
          v-if="showTeam"
          v-model:selected="teamSelected"
          v-model:enabled="teamEnabled"
          :members="pickerMembers"
          :owner-name="ownerStaff(state).name || 'You'"
          :issues="memberIssues"
          :notes="memberNotes"
          :copy-members="copyMemberIds"
          :estimate="teamEstimate"
          :disabled="isDemo || saving || deleting"
        />
          </div>
        </details>
        <p v-if="submitReason && !isDemo" class="submit-reason" role="status">{{ submitReason }}</p>
        <div class="form-actions modal-footer"
          ><GmConfirm
            v-model:open="capPrompt"
            :title="`Create ${teamEstimate.adding} team copies?`"
            :message="`This brings your team copies to ${teamEstimate.total}, over ${STAFF_COPY_WARN}. Each copy is a separate choice for guests on your booking page. You can remove copies later by editing the service.`"
            confirm-label="Save and create copies"
            cancel-label="Go back"
            :busy="saving"
            @confirm="submit(true)"
            ><GmButton
              type="submit"
              class="primary"
              :pending="saving"
              pending-label="Saving…"
              :disabled-reason="submitReason"
              >{{ editing ? 'Save changes' : 'Create service' }}</GmButton
            ></GmConfirm
          ><GmConfirm
            v-model:open="dialogPrompt"
            title="Discard unsaved changes?"
            message="Your edits to this service will be lost."
            confirm-label="Discard changes"
            cancel-label="Keep editing"
            tone="danger"
            :busy="saving"
            @confirm="discardChanges"
            @cancel="keepEditing"
            ><button
              class="secondary"
              type="button"
              :disabled="saving"
              @click="close"
              >Cancel</button
            ></GmConfirm
          ></div
        >
      </form>
    </GmDialog>

    <BulkTeamChoiceDialog v-model:open="bulkOpen" @busy="bulkBusy = $event" />
    <ServiceImportDialog v-model:open="importOpen" :resume="resumeImport" @busy="importBusy = $event" />

    <GmDialog
      :open="Boolean(pendingRevoke)"
      :title="`Revoke link for ${displayName(pendingRevoke?.name) || 'service'}?`"
      content-class="card modal delete-modal bookins-delete-dialog"
      overlay-class="modal-backdrop bookins-modal-backdrop"
      :busy="Boolean(linkBusy)"
      @update:open="(value) => { if (!value) pendingRevoke = null }"
    >
      <div v-if="pendingRevoke" class="bookins-delete-dialog-body">
        <span class="delete-icon">!</span><p class="eyebrow">Revoke direct link</p>
        <h2>Revoke the link for {{ displayName(pendingRevoke.name) }}?</h2>
        <p class="muted">Anyone holding this link, including printed QR codes, will no longer be able to open or book this service. Existing bookings are unchanged.</p>
        <div class="form-actions">
          <button class="danger" type="button" :disabled="isDemo || Boolean(linkBusy)" @click="confirmRevoke">{{ linkBusy ? 'Revoking…' : 'Revoke link' }}</button>
          <button class="secondary" type="button" :disabled="Boolean(linkBusy)" @click="pendingRevoke = null">Keep link</button>
        </div>
      </div>
    </GmDialog>

    <GmDialog
      :open="Boolean(pendingDelete)"
      :title="`Delete ${displayName(pendingDelete?.name) || 'service'}?`"
      content-class="card modal delete-modal bookins-delete-dialog"
      overlay-class="modal-backdrop bookins-modal-backdrop"
      :busy="deleting"
      @open-auto-focus="focusKeepService"
      @update:open="(value) => { if (!value) requestDeleteClose() }"
    >
      <div
        v-if="pendingDelete"
        class="bookins-delete-dialog-body"
      >
        <span class="delete-icon">!</span><p class="eyebrow">Delete service</p
        ><h2>Delete {{ displayName(pendingDelete.name) }}?</h2
        ><p v-if="pendingDelete && copiesOf(pendingDelete).length" class="muted"
          >This also removes its {{ copiesOf(pendingDelete).length }} team {{ copiesOf(pendingDelete).length === 1 ? 'copy' : 'copies' }} (With {{ copiesOf(pendingDelete).map(memberName).join(', ') }}).</p
        ><p v-if="deleteUpcoming" class="muted"
          ><strong>{{ deleteUpcoming }} upcoming confirmed {{ deleteUpcoming === 1 ? 'booking uses' : 'bookings use' }} this service.</strong>
          Deleting it leaves {{ deleteUpcoming === 1 ? 'that appointment' : 'those appointments' }} without a service on your list. Pausing hides it from guests and keeps everything intact.</p
        ><p v-else class="muted"
          >It will disappear from your booking page. Existing bookings and contact history will stay
          available.</p
        >
        <div v-if="error" class="notice error" role="alert">{{ error }}</div>
        <div class="form-actions"
          ><button
            v-if="deleteUpcoming && pendingDelete.active !== false"
            class="primary"
            type="button"
            :disabled="deleting || pausing || isDemo"
            @click="pauseInstead"
            >{{ pausing ? 'Pausing…' : 'Pause instead' }}</button
          ><button
            :class="deleteUpcoming && pendingDelete.active !== false ? 'ghost delete-link' : 'danger'"
            type="button"
            :disabled="deleting || pausing || isDemo"
            @click="remove"
            >{{ deleting ? 'Deleting…' : deleteUpcoming ? 'Delete anyway' : 'Delete service' }}</button
          ><button
            class="secondary"
            type="button"
            ref="keepServiceButton"
            :disabled="deleting || pausing || isDemo"
            @click="requestDeleteClose"
            >Keep service</button
          ></div
        >
      </div>
    </GmDialog>
  </section>
</template>

<style scoped>
.field-error { color: var(--danger); }
.req { color: var(--muted); font-size: var(--text-xs); font-weight: 600; }
.availability-first { margin-bottom: var(--space-4); display: flex; align-items: center; gap: var(--space-4); border-color: var(--accent); background: var(--accent-soft); }
.availability-first > div { min-width: 0; flex: 1; }
.availability-first h2 { margin: 0 0 4px; font-size: var(--text-lg); }
.availability-first p { margin: 0; font-size: var(--text-sm); }
.availability-first .eyebrow { margin-bottom: 4px; }
.availability-first a, .availability-note a { text-decoration: none; }
.availability-first > a { flex: none; display: inline-flex; align-items: center; gap: 4px; }
.availability-note { display: flex; gap: var(--space-2); align-items: flex-start; }
.availability-note a { margin-left: 4px; color: var(--accent); font-weight: 700; text-decoration: underline; }
.submit-reason { margin: 0 0 var(--space-2); color: var(--danger); font-size: var(--text-sm); line-height: 1.45; }
:global(.bookins-service-dialog .form-grid) { align-items: start; }
.advanced-form-section { padding: 0; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-soft); }
.advanced-form-section > summary { min-height: var(--control-h); padding: 0 var(--space-3); display: flex; align-items: center; gap: var(--space-2); cursor: pointer; color: var(--ink); font-size: var(--text-sm); font-weight: 650; }
.advanced-form-section > summary span { margin-left: auto; color: var(--muted); font-size: var(--text-xs); font-weight: 500; text-align: right; }
.advanced-form-content { padding: var(--space-3); border-top: 1px solid var(--line); background: #fff; }
.advanced-form-content > :last-child { margin-bottom: 0; }
:global(.bookins-service-dialog .modal-footer .gm-button) { min-width: 140px; }
.private-note { margin: 0 0 var(--space-2); color: var(--muted); font-size: var(--text-xs); line-height: 1.45; }
.direct-link { margin: var(--space-3) 0 0; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg-soft, #fafbfd); }
.direct-summary { min-height: var(--control-h-sm); padding: 0 var(--space-3); display: flex; align-items: center; gap: var(--space-2); color: var(--ink-soft); font-size: var(--text-sm); font-weight: 650; list-style: none; cursor: pointer; }
.direct-summary::-webkit-details-marker { display: none; }
.direct-summary > span:nth-child(2) { flex: 1; }
.direct-chevron { transition: transform var(--dur-fast) var(--ease); }
.direct-link[open] .direct-chevron { transform: rotate(90deg); }
.direct-body { padding: 0 var(--space-3) var(--space-3); display: grid; gap: var(--space-2); justify-items: start; }
.direct-link code { max-width: 100%; padding: 8px 10px; overflow: hidden; color: var(--ink-soft); border-radius: 8px; background: #f1f3f8; font-family: var(--font-mono); font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }
.direct-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.direct-actions a { display: inline-flex; align-items: center; text-decoration: none; }
.service-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-4);
}
.service-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.service-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.service-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.service-copy {
  margin: var(--space-4) 0 var(--space-3);
}
.service-copy h3 {
  margin: 0 0 4px;
  font-size: var(--text-lg);
}
.services-toolbar { margin-bottom: var(--space-4); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.services-toolbar .search-field { flex: 1 1 260px; }
.category-group { margin-bottom: var(--space-5); }
.group-title { margin: 0 0 var(--space-3); font-size: var(--text-lg); }
.group-toggle { min-height: var(--control-h-sm); padding: 0 4px; display: inline-flex; align-items: center; gap: var(--space-2); border: 0; background: none; color: var(--ink); font: inherit; font-weight: 700; cursor: pointer; border-radius: var(--radius-sm); }
.group-toggle.static { cursor: default; }
.group-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.group-chevron { transition: transform var(--dur-fast) var(--ease); transform: rotate(90deg); }
.group-toggle[aria-expanded='false'] .group-chevron { transform: none; }
.service-chips { margin: 0 0 var(--space-2); display: flex; flex-wrap: wrap; gap: 6px; }
.service-chips .chip { display: inline-flex; align-items: center; gap: 4px; }
.team-copies { margin: var(--space-3) 0 0; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--accent-soft); }
.copies-title { margin: 0 0 var(--space-2); display: flex; align-items: center; gap: 4px; font-size: var(--text-sm); font-weight: 700; }
.team-copies ul { margin: 0 0 var(--space-2); padding: 0; list-style: none; display: grid; gap: 6px; }
.team-copies li { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
.team-copies .private-note { margin: 0; }
.copy-name { flex: 1; min-width: 0; }
.swatch { width: 10px; height: 10px; flex: none; border-radius: 50%; display: inline-block; }
.empty-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-2); }
.orphans .muted { margin: 0 0 var(--space-2); font-size: var(--text-sm); }
.orphan-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-2); }
.orphan-list li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); }
.service-copy p {
  display: -webkit-box;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--text-sm);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.service-facts {
  margin-top: auto;
  padding: var(--space-3) 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--line);
}
.service-facts span {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: var(--text-sm);
}
.service-facts strong {
  font-size: var(--text-md);
}
.service-actions {
  padding-top: var(--space-3);
  display: flex;
  gap: var(--space-2);
}
.service-actions :deep(.gm-button--secondary) {
  flex: 1;
}
.service-actions :deep(.icon-delete) { --button-fg: var(--danger); }
.icon-delete { width: var(--control-h-sm); padding: 0; display: inline-grid; place-items: center; flex: none; }
.delete-link {
  color: var(--danger);
}
:global(.bookins-service-dialog .form-grid) {
  gap: 12px;
}
:global(.bookins-modal-backdrop) {
  background: rgba(16, 25, 40, 0.52);
  backdrop-filter: blur(4px);
}
:global(.bookins-service-dialog),
:global(.bookins-delete-dialog) {
  width: min(620px, 100%);
  box-shadow: var(--shadow-lg);
}
:global(.bookins-service-dialog .price-field > div) {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 7px;
}
:global(.bookins-service-dialog .price-field .gm-select-shell),
:global(.bookins-service-dialog .price-field input) {
  min-width: 0;
}
:global(.bookins-delete-dialog) {
  max-width: 470px;
  text-align: center;
}
:global(.bookins-delete-dialog .delete-icon) {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  display: grid;
  place-items: center;
  color: var(--danger);
  border-radius: 50%;
  background: var(--danger-soft);
  font-size: 22px;
  font-weight: 850;
}
:global(.bookins-delete-dialog .form-actions) {
  margin-top: 22px;
  justify-content: center;
}
@media (max-width: 700px) {
  .service-grid {
    grid-template-columns: 1fr;
  }
  .availability-first { align-items: stretch; flex-direction: column; }
  :global(.bookins-service-dialog .form-grid) {
    grid-template-columns: 1fr;
  }
  :global(.bookins-service-dialog),
  :global(.bookins-delete-dialog) {
    width: 100%;
  }
}
</style>
