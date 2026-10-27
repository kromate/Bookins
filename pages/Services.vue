<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import GmSelect from '../components/ui/GmSelect.vue'
import GmTextSuggest from '../components/ui/GmTextSuggest.vue'
import GmDialog from '../components/ui/GmDialog.vue'
import GmButton from '../components/ui/GmButton.vue'
import GmConfirm from '../components/ui/GmConfirm.vue'
import GmHint from '../components/ui/GmHint.vue'
import { useSetupState } from '../setup.ts'
import QrCode from '../components/QrCode.vue'
import SlotMeter from '../components/SlotMeter.vue'
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
} from '../booking.ts'
import { isOwnerMember, ownerStaff, parseServiceIds, serviceBaseId } from '../team.ts'
import { displayName } from '../team-ui.ts'
import { smallestIntervalFor } from '../weekly-hours.ts'
import { whatsappShareUrl } from '../messaging.ts'
import { isDemo, registerDemoGuard } from '../runtime.ts'
import { errorMessage } from '../error-message.ts'

interface ServiceEntry { service: ServiceRecord; meta: ReturnType<typeof serviceDisplayMeta> }
interface ServiceGroup { category: string; entries: ServiceEntry[]; rank: number }
interface TeamCopyOutcome { created: number; updated: number; removed: number; skipped: string[] }

const timestampMillis = (value: TimestampInput): number => {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string' || typeof value === 'number') return new Date(value).getTime()
  if (value && 'toDate' in value) return value.toDate().getTime()
  if (value && '_seconds' in value) return value._seconds * 1000
  return Number.NaN
}

const state = inject<WorkspaceState>('bookingState', { profile: null, schedules: [], services: [], bookings: [], contacts: [], staff: [], campaigns: [] })
const refresh = inject<RefreshWorkspace>('refreshBookings', async () => true)
const router = useRouter()
const route = useRoute()
const setup = useSetupState()
const toast = inject<ToastApi | null>('toast', null)
const show = ref(false)
const selectPortalTarget = ref<HTMLFormElement | null>(null)
const keepServiceButton = ref<HTMLButtonElement | null>(null)
const saving = ref(false)
const deleting = ref(false)
const editing = ref<ServiceRecord | null>(null)
const pendingDelete = ref<ServiceRecord | null>(null)
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
const teamSelected = ref<string[]>([])
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
    return `This is longer than your ${scheduleInterval.value}-minute start-time interval. Each booking takes one interval, so raise the interval to at least ${value} minutes in Availability or shorten the service.`
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
  editing.value ? [...new Set(staffCopies(state, editing.value).map((copy) => serviceDisplayMeta(copy).staffId).filter(Boolean))] : [],
)
const teamPeople = computed(() => teamMembers(state, { includeInactive: true }).filter((member) => !isOwnerMember(member)))
const pickerMembers = computed(() =>
  teamPeople.value
    .filter((member) => isStaffActive(member) || copyMemberIds.value.includes(String(member.id || '')))
    .map((member) => ({ id: String(member.id || ''), name: member.name || 'Team member', role: member.role || '', color: member.color || '', inactive: !isStaffActive(member) })),
)
const memberIssues = computed(() => {
  const out: Record<string, string> = {}
  for (const member of pickerMembers.value) {
    const record = staffById(state, member.id) || member
    const schedule = scheduleForStaff(state, record)
    const interval = Number(schedule?.slot_interval_minutes || 0)
    if (member.inactive) out[member.id] = 'Not active. Reactivate them on the Team page to offer this.'
    else if (!schedule) out[member.id] = `Set working hours for ${member.name} on the Team page first.`
    else if (interval && Number(form.durationMinutes) > interval) out[member.id] = `${member.name}'s start-time interval is ${interval} min, shorter than this ${form.durationMinutes}-minute service.`
  }
  return out
})
const memberNotes = computed(() => {
  const out: Record<string, string> = {}
  for (const member of teamPeople.value) {
    const ids = parseServiceIds(member)
    if (ids.length && editing.value?.id && !ids.includes(editing.value.id)) out[String(member.id || '')] = 'Not on their service list yet. Saving adds it.'
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
const copiesOf = (service: ServiceRecord) => state.services.filter((item) => serviceBaseId(item) === service.id)
const memberName = (copy: ServiceRecord) => serviceDisplayMeta(copy).staffName || staffById(state, serviceDisplayMeta(copy).staffId)?.name || 'Team member'
const nameConflict = computed(() => {
  const name = form.name.trim().toLowerCase()
  if (!name) return ''
  const other = state.services.find(
    (item) => !isStaffCopy(item) && item.id !== editing.value?.id && String(item.name || '').trim().toLowerCase() === name,
  )
  return other ? `You already have a service called "${displayName(other.name)}". Choose a different name.` : ''
})
// Required fields are checked by the app, not the browser: errors show under each field after the first save attempt.
const attempted = ref(false)
const nameError = computed(() => (attempted.value && !form.name.trim() ? 'Enter a name for this service.' : nameConflict.value))
const descriptionError = computed(() => (attempted.value && !form.description.trim() ? 'Add a short description. Guests see it under the name.' : ''))
const submitReason = computed(() => {
  if (isDemo.value) return 'The demo is read-only.'
  if (needsAvailability.value) return 'Set your availability first, then create the service.'
  if (nameConflict.value) return nameConflict.value
  if (durationError.value) return 'Fix the duration: it must be a multiple of 5 minutes and fit your start-time interval.'
  if (sortOrderError.value) return sortOrderError.value
  if (rebookError.value) return rebookError.value
  if (showTeam.value && teamEnabled.value && !teamSelected.value.length) return 'Choose at least one team member, or turn off "Let guests choose a team member".'
  if (showTeam.value && teamEstimate.value.overMax) return `That would make ${teamEstimate.value.total} team copies; the limit is ${STAFF_COPY_MAX}. Offer this with fewer people.`
  return ''
})
const upcomingCount = (service: ServiceRecord) => {
  const now = Date.now()
  const ids = new Set([service.id, ...copiesOf(service).map((copy) => copy.id)])
  return state.bookings.filter(
    (item) => ids.has(item.service_id) && !isTimeOff(item) && item.status === 'confirmed' && timestampMillis(item.ends_at || item.starts_at) > now,
  ).length
}
const deleteUpcoming = computed(() => (pendingDelete.value ? upcomingCount(pendingDelete.value) : 0))
const pausing = ref(false)
const linkBusy = ref('')
const linkError = ref<Record<string, string>>({})
const serviceKey = (service: ServiceRecord) => String(service.id || '')
const copiedLink = ref('')
const pendingRevoke = ref<ServiceRecord | null>(null)
const nowMs = ref(Date.now())
let copiedTimer = 0
onBeforeUnmount(() => window.clearTimeout(copiedTimer))
const linkExpired = (service: ServiceRecord) => {
  const expiry = Date.parse(service.public_link_expires_at || '')
  return Boolean(service.public_link_url) && Number.isFinite(expiry) && expiry <= nowMs.value
}
const linkLive = (service: ServiceRecord) => Boolean(service.public_link_url) && !linkExpired(service)
const shareText = (service: ServiceRecord) => `Book ${displayName(service.name)}${state.profile?.display_name ? ` with ${state.profile.display_name}` : ''}: ${service.public_link_url}`
const whatsappShare = (service: ServiceRecord) => whatsappShareUrl(shareText(service))
const setLinkError = (service: ServiceRecord, message: string) => { linkError.value = { ...linkError.value, [String(service.id || '')]: message } }

async function makeLink(service: ServiceRecord) {
  if (isDemo.value || linkBusy.value) return
  linkBusy.value = String(service.id || '')
  nowMs.value = Date.now()
  setLinkError(service, '')
  try {
    await createServiceLink(service)
    await refresh()
    toast?.success('Direct link created')
  } catch (reason) {
    const message = errorMessage(reason, 'The direct link could not be created.')
    setLinkError(service, message)
    toast?.error(message)
  } finally {
    linkBusy.value = ''
  }
}

async function copyServiceLink(service: ServiceRecord) {
  setLinkError(service, '')
  try {
    await copyText(String(service.public_link_url || ''))
    copiedLink.value = String(service.id || '')
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
  linkBusy.value = String(service.id || '')
  setLinkError(service, '')
  try {
    await revokeServiceLink(service)
    pendingRevoke.value = null
    await refresh()
    toast?.success('Direct link revoked. Anyone holding it can no longer book.')
  } catch (reason) {
    const message = errorMessage(reason, 'The direct link could not be revoked.')
    setLinkError(service, message)
    toast?.error(message)
    pendingRevoke.value = null
  } finally {
    linkBusy.value = ''
  }
}
const currencyOptions = currencies.map((value) => ({ value, label: value }))
const visibilityOptions = [
  { value: 'public', label: 'Listed on your booking page' },
  { value: 'private', label: 'Private: only through its own link' },
]
const statusOptions = [
  { value: true, label: 'Open for booking' },
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

function open(service: ServiceRecord | null = null) {
  if (saving.value || deleting.value) return
  error.value = ''
  attempted.value = false
  dialogPrompt.value = false
  editing.value = service
  const meta = service ? serviceDisplayMeta(service) : null
  Object.assign(
    form,
    service
      ? {
          name: service.name,
          description: meta?.text || '',
          durationMinutes: service.duration_minutes,
          price: service.price || 0,
          currency: service.currency || 'NGN',
          visibility: service.visibility,
          active: service.active !== false,
          location: service.location || '',
          category: meta?.category || '',
          sortOrder: meta?.sortOrder ?? '',
          rebookAfterDays: meta?.rebookAfterDays || '',
          prepNotes: meta?.prepNotes || '',
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
  const had = service ? [...new Set(staffCopies(state, service).map((copy) => serviceDisplayMeta(copy).staffId).filter(Boolean))] : []
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

function askDelete(service: ServiceRecord) {
  error.value = ''
  pendingDelete.value = service
}

function focusKeepService(event: Event) {
  event.preventDefault()
  keepServiceButton.value?.focus({ preventScroll: true })
}

function priceLabel(service: ServiceRecord) {
  if (!Number(service.price)) return 'Free'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: service.currency || 'NGN',
      maximumFractionDigits: 0,
    }).format(Number(service.price))
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
async function applyTeamCopies(saved: ServiceRecord): Promise<TeamCopyOutcome> {
  const had = copyMemberIds.value
  const keep = teamEnabled.value ? teamSelected.value : []
  const outcome: TeamCopyOutcome = { created: 0, updated: 0, removed: 0, skipped: [] }
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
  const staff: StaffRecord[] = []
  for (const member of state.staff || []) {
    const ids = parseServiceIds(member)
    const memberId = String(member.id || '')
    const savedId = String(saved.id || '')
    if (wanted.includes(memberId) && ids.length && savedId && !ids.includes(savedId)) {
      const next = [...ids, savedId]
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
  attempted.value = true
  if (nameError.value || descriptionError.value || durationError.value || sortOrderError.value || rebookError.value) {
    // Each message is shown under its field; the first one is focused and scrolled clear of the sticky header.
    error.value = ''
    await nextTick()
    const field = selectPortalTarget.value?.querySelector<HTMLElement>('[aria-invalid="true"]')
    field?.focus({ preventScroll: true })
    field?.scrollIntoView({ block: 'center' })
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
  let savedService: ServiceRecord | null = null
  try {
    const currentService = editing.value
    const scheduleId = currentService?.schedule_id && state.schedules.some((item) => item.id === currentService.schedule_id) ? currentService.schedule_id : schedule.id
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
    error.value = errorMessage(reason, 'The service could not be saved.')
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
      durationMinutes: Number(service.duration_minutes),
      price: Number(service.price || 0),
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
    error.value = errorMessage(reason, 'The service could not be paused.')
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
    await deleteService(String(pendingDelete.value.id || ''))
    pendingDelete.value = null
    await refresh()
    toast?.success('Service deleted. Existing booking history was kept.')
  } catch (reason) {
    error.value = errorMessage(reason, 'The service could not be deleted.')
    toast?.error(error.value)
  } finally {
    deleting.value = false
  }
}

// ---- list: search, categories, order ----
const search = ref('')
const baseEntries = computed(() => state.services.filter((item) => !isStaffCopy(item)).map((service) => ({ service, meta: serviceDisplayMeta(service) })))
const orphanCopies = computed(() => {
  const ids = new Set(baseEntries.value.map((entry) => entry.service.id))
  return state.services.filter((item) => isStaffCopy(item) && !ids.has(serviceBaseId(item)))
})
const matchesSearch = (entry: ServiceEntry) => {
  const words = search.value.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = [entry.service.name, entry.meta.category, entry.meta.text, ...copiesOf(entry.service).map(memberName)].join(' ').toLowerCase()
  return words.every((word) => haystack.includes(word))
}
const groups = computed(() => {
  const byCategory = new Map<string, ServiceEntry[]>()
  for (const entry of baseEntries.value.filter(matchesSearch)) {
    const key = entry.meta.category || ''
    if (!byCategory.has(key)) byCategory.set(key, [])
    byCategory.get(key)?.push(entry)
  }
  const order = (entry: ServiceEntry) => entry.meta.sortOrder ?? Number.MAX_SAFE_INTEGER
  // Categories follow the lowest sort order among their services (then name); uncategorised services come last.
  return [...byCategory.entries()]
    .map(([category, entries]) => {
      const sorted = entries.sort((a, b) => order(a) - order(b) || String(a.service.name).localeCompare(String(b.service.name)))
      return { category, entries: sorted, rank: Math.min(...sorted.map(order)) }
    })
    .sort((a, b) => (a.category === '' ? 1 : b.category === '' ? -1 : a.rank - b.rank || a.category.localeCompare(b.category)))
})
const showHeadings = computed(() => groups.value.some((group) => group.category))
const groupLabel = (group: ServiceGroup) => group.category || 'Other services'
const serviceCount = computed(() => groups.value.reduce((sum, group) => sum + group.entries.length, 0))
// The start-time interval a service's length is drawn against: its own schedule, else the owner's.
const intervalFor = (service: ServiceRecord) => Number(state.schedules.find((item) => item.id === service.schedule_id)?.slot_interval_minutes || scheduleInterval.value || 0)
const teamLine = (service: ServiceRecord) => {
  const copies = copiesOf(service)
  if (!copies.length) return ''
  return `With you, ${copies.map(memberName).join(', ')}`
}

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
    toast?.error(errorMessage(reason, 'The export could not be created.'))
  }
}
const importDisabledReason = computed(() => {
  if (isDemo.value) return 'Import is not available in the demo. Switch to your own workspace to import services. Export still works.'
  if (needsAvailability.value) return 'Set your availability first: imported services need your start-time interval.'
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
  <section class="services-page">
    <header class="page-header">
      <div>
        <h1>Services</h1>
        <p class="lede">What clients can book, how long it takes, and the price you agree with them.</p>
      </div>
      <div class="page-header-actions">
        <details class="menu" data-menu>
          <summary class="secondary" data-tour="tour-services-import">More<AppIcon class="chevron-down" name="chevron" :size="14" /></summary>
          <div class="menu-panel">
            <GmButton variant="ghost" size="sm" :disabled-reason="importDisabledReason" @click="importOpen = true"><template #leading><AppIcon name="download" :size="16" /></template>Import from a spreadsheet</GmButton>
            <GmButton variant="ghost" size="sm" :disabled-reason="exportReason" @click="exportCsv"><template #leading><AppIcon name="external" :size="16" /></template>Export to a spreadsheet</GmButton>
            <GmButton v-if="showTeam" variant="ghost" size="sm" data-tour="tour-services-bulk-team" :disabled-reason="bulkReason" @click="bulkOpen = true"><template #leading><AppIcon name="team" :size="16" /></template>Let guests choose who</GmButton>
          </div>
        </details>
        <GmButton
          data-tour="tour-services-new"
          variant="primary"
          :disabled-reason="isDemo ? 'The demo is read-only. Switch to your own workspace to add services.' : ''"
          :disabled="saving || deleting"
          @click="open()"
        ><template #leading><AppIcon name="plus" :size="17" /></template>New service</GmButton>
      </div>
    </header>

    <div v-if="error && !show && !pendingDelete" class="notice error" role="alert">{{ error }}</div>

    <div v-if="needsAvailability && !isDemo" class="first-row" data-tour="tour-services-availability">
      <AppIcon name="availability" :size="20" />
      <div>
        <strong>Set your hours before your first service</strong>
        <p>Guests can only book inside your weekly hours, so Bookins needs them before it can offer a service.</p>
      </div>
      <RouterLink class="primary small" to="/availability">Set your hours</RouterLink>
    </div>

    <div v-if="baseEntries.length" data-tour="tour-services-list">
      <div class="toolbar">
        <label class="search-field">
          <AppIcon name="search" :size="18" /><span class="visually-hidden">Search services</span>
          <input v-model="search" type="search" placeholder="Search services or categories" />
        </label>
        <span class="muted tnum count-line" role="status">{{ serviceCount }} of {{ baseEntries.length }} {{ baseEntries.length === 1 ? 'service' : 'services' }}</span>
      </div>

      <div v-if="!groups.length" class="empty compact">
        <h2>No services match “{{ search }}”</h2>
        <p>Try a shorter word, or clear the search.</p>
        <button class="secondary small" type="button" @click="search = ''">Clear search</button>
      </div>

      <section v-for="group in groups" :key="group.category || '__none'" class="price-group" :aria-label="showHeadings ? groupLabel(group) : 'Services'">
        <h2 v-if="showHeadings" class="group-title">{{ groupLabel(group) }} <small class="tnum">{{ group.entries.length }}</small></h2>
        <ul class="ledger price-list">
          <li v-for="{ service, meta } in group.entries" :key="service.id" class="price-row" :class="{ 'is-paused': service.active === false }">
            <div class="price-name">
              <h3>{{ displayName(service.name) }}</h3>
              <p v-if="meta.text" class="price-desc">{{ meta.text }}</p>
              <p class="price-tags">
                <span v-if="service.active === false" class="chip paused">Paused</span>
                <span v-if="service.visibility === 'private'" class="chip private">Private link only</span>
                <span v-if="teamLine(service)" class="team-line">{{ teamLine(service) }}</span>
                <span v-if="meta.rebookAfterDays" class="team-line">Rebook after {{ meta.rebookAfterDays }} {{ meta.rebookAfterDays === 1 ? 'day' : 'days' }}</span>
                <span v-if="upcomingCount(service)" class="team-line">{{ upcomingCount(service) }} upcoming</span>
              </p>
            </div>
            <div class="price-length">
              <SlotMeter :duration="Number(service.duration_minutes) || 0" :interval="intervalFor(service)" />
            </div>
            <strong class="price-amount tnum">{{ priceLabel(service) }}</strong>
            <div class="price-actions">
              <details class="menu share-menu" data-menu>
                <summary class="secondary small" :aria-label="`Share ${displayName(service.name)}`"><AppIcon name="link" :size="15" />Share</summary>
                <div class="menu-panel share-panel" data-keep-menu>
                  <p class="share-title">Direct link for {{ displayName(service.name) }}</p>
                  <p class="share-note">Opens booking for this one service, for a chat, a poster or a bio.<template v-if="service.visibility === 'private'"> It is the only way guests can book this private service.</template></p>
                  <template v-if="linkLive(service)">
                    <code class="share-url">{{ service.public_link_url }}</code>
                    <div class="cluster">
                      <button class="primary small" type="button" @click="copyServiceLink(service)"><AppIcon name="copy" :size="15" />{{ copiedLink === service.id ? 'Copied' : 'Copy link' }}</button>
                      <a class="secondary small" :href="whatsappShare(service)" target="_blank" rel="noreferrer"><AppIcon name="messages" :size="15" />Share in WhatsApp</a>
                    </div>
                    <QrCode :value="service.public_link_url" :size="132" :label="`QR code for the ${displayName(service.name)} direct link`" />
                    <button class="ghost small revoke" type="button" :disabled="isDemo || Boolean(linkBusy)" @click="pendingRevoke = service">Turn off this link</button>
                  </template>
                  <template v-else>
                    <p v-if="linkExpired(service)" class="share-note">This link has expired. Guests opening it see an expired-link page.</p>
                    <button class="primary small" type="button" :disabled="isDemo || Boolean(linkBusy)" @click="makeLink(service)">{{ linkBusy === service.id ? 'Creating…' : linkExpired(service) ? 'Create a new link' : 'Create direct link' }}</button>
                  </template>
                  <p v-if="linkError[serviceKey(service)]" class="field-error" role="alert">{{ linkError[serviceKey(service)] }}</p>
                </div>
              </details>
              <GmButton variant="secondary" size="sm" :disabled-reason="isDemo ? 'The demo is read-only.' : ''" :disabled="saving || deleting" @click="open(service)">Edit</GmButton>
              <details class="menu" data-menu>
                <summary class="icon-button" :aria-label="`More for ${displayName(service.name)}`"><AppIcon name="more" :size="18" /></summary>
                <div class="menu-panel">
                  <GmButton variant="ghost" size="sm" class="danger-item" :disabled-reason="isDemo ? 'The demo is read-only.' : ''" :disabled="saving || deleting" @click="askDelete(service)"><template #leading><AppIcon name="trash" :size="16" /></template>Delete service</GmButton>
                </div>
              </details>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="orphanCopies.length && !search" class="price-group orphans" aria-labelledby="orphans-title">
        <h2 id="orphans-title" class="group-title">Team copies without a main service <small class="tnum">{{ orphanCopies.length }}</small></h2>
        <p class="muted">These belong to a service that was deleted. Guests can still see them; remove them if you no longer offer them.</p>
        <ul class="ledger">
          <li v-for="copy in orphanCopies" :key="copy.id" class="orphan-row">
            <span><strong>{{ displayName(copy.name) }}</strong> with {{ memberName(copy) }}</span>
            <GmButton variant="ghost" size="sm" :disabled-reason="isDemo ? 'The demo is read-only.' : ''" @click="askDelete(copy)">Remove</GmButton>
          </li>
        </ul>
      </section>
    </div>

    <div v-else class="empty" data-tour="tour-services-list">
      <span class="empty-icon"><AppIcon name="services" /></span>
      <h2>Add your first service</h2>
      <p>A clear name, how long it takes and your price, so guests know exactly what they are booking. Many services already? Import them from a spreadsheet.</p>
      <div class="empty-actions">
        <GmButton variant="primary" :disabled-reason="isDemo ? 'The demo is read-only.' : ''" :disabled="saving || deleting" @click="open()"><template #leading><AppIcon name="plus" :size="17" /></template>New service</GmButton>
        <GmButton variant="secondary" :disabled-reason="importDisabledReason" @click="importOpen = true"><template #leading><AppIcon name="download" :size="17" /></template>Import from a spreadsheet</GmButton>
      </div>
    </div>

    <GmDialog
      :open="show"
      :title="editing ? 'Edit service' : 'New service'"
      content-class="card modal bookins-service-dialog"
      :busy="saving"
      @update:open="(value) => { if (!value) close() }"
    >
      <form ref="selectPortalTarget" class="service-form" novalidate @submit.prevent="submit()">
        <div class="modal-header">
          <h2>{{ editing ? `Edit ${displayName(editing.name)}` : 'New service' }}</h2>
          <button class="icon-button" type="button" aria-label="Close" :disabled="saving || deleting" @click="close"><AppIcon name="close" /></button>
        </div>
        <div v-if="needsAvailability && !isDemo && !editing" class="notice warning" role="status">
          <AppIcon name="availability" :size="18" /><span><strong>Set your hours first.</strong> A service can only be created once you have weekly hours. What you type here is kept. <RouterLink to="/availability">Set your hours</RouterLink></span>
        </div>
        <div v-if="error" class="notice error" role="alert">{{ error }}</div>

        <section class="form-section">
          <div class="field">
            <label for="service-name">Name <span class="req">(required)</span></label>
            <input id="service-name" v-model.trim="form.name" :disabled="isDemo || saving || deleting" maxlength="100" required aria-required="true" :aria-invalid="nameError ? 'true' : undefined" :aria-describedby="nameError ? 'service-name-error' : undefined" placeholder="Box braids, medium" />
            <p v-if="nameError" id="service-name-error" class="field-error" role="alert"><AppIcon name="alert" :size="16" />{{ nameError }}</p>
          </div>
          <div class="field">
            <label for="service-description">Description <span class="req">(required)</span></label>
            <textarea id="service-description" v-model.trim="form.description" :disabled="isDemo || saving || deleting" maxlength="1500" required aria-required="true" rows="3" placeholder="What is included, and anything the client should know." :aria-invalid="descriptionError ? 'true' : undefined" :aria-describedby="descriptionError ? 'service-description-error service-description-hint' : 'service-description-hint'"></textarea>
            <p v-if="descriptionError" id="service-description-error" class="field-error" role="alert"><AppIcon name="alert" :size="16" />{{ descriptionError }}</p>
            <p id="service-description-hint" class="field-hint">Shown to guests under the name.</p>
          </div>
        </section>

        <section class="form-section">
          <h3>Length and price</h3>
          <div class="form-grid">
            <div class="field">
              <label for="service-duration">Length in minutes <span class="req">(required)</span></label>
              <input id="service-duration" v-model.number="form.durationMinutes" :disabled="isDemo || saving || deleting" type="number" min="5" step="5" inputmode="numeric" required aria-required="true" :aria-invalid="durationError ? 'true' : undefined" aria-describedby="service-duration-hint" />
              <SlotMeter v-if="scheduleInterval" :duration="Number(form.durationMinutes) || 0" :interval="scheduleInterval" :caption="false" />
              <p id="service-duration-hint" class="field-hint" :class="{ 'field-error': durationError }">
                {{ durationError || (scheduleInterval ? `Fits inside your ${scheduleInterval}-minute start-time interval.` : 'In steps of 5 minutes.') }}
                <RouterLink v-if="scheduleInterval" :to="intervalLink">{{ neededInterval ? `Set the interval to ${neededInterval} min` : 'Change the interval' }}</RouterLink>
              </p>
            </div>
            <div class="field price-field">
              <label for="service-price">Price</label>
              <div class="price-inputs">
                <GmSelect v-model="form.currency" :options="currencyOptions" label="Currency" :disabled="isDemo || saving || deleting" :portal-target="selectPortalTarget || 'body'" />
                <input id="service-price" v-model.number="form.price" :disabled="isDemo || saving || deleting" type="number" min="0" step="1" aria-describedby="service-price-hint" />
              </div>
              <p id="service-price-hint" class="field-hint">{{ Number(form.price) ? 'Clients pay you directly; Bookins only shows the price.' : 'Guests see this as Free. Clients pay you directly.' }}</p>
            </div>
          </div>
        </section>

        <details class="form-section more-section" :open="Boolean(sortOrderError || rebookError) || undefined">
          <summary>Category, order, return reminder and preparation <span>Optional</span></summary>
          <div class="more-body">
            <div class="field">
              <label for="service-category">Category <GmHint text="Groups services under a heading on your booking page and here. Pick one you already use or type a new one." label="About categories" /></label>
              <GmTextSuggest id="service-category" v-model.trim="form.category" :options="categories" label="Category" :disabled="isDemo || saving || deleting" maxlength="80" autocomplete="off" placeholder="Braids, Nails, Consultations…" />
            </div>
            <div class="form-grid">
              <div class="field">
                <label for="service-sort">Order in the list</label>
                <input id="service-sort" v-model="form.sortOrder" :disabled="isDemo || saving || deleting" type="number" step="1" inputmode="numeric" placeholder="1" :aria-invalid="Boolean(sortOrderError)" aria-describedby="service-sort-hint" />
                <p id="service-sort-hint" class="field-hint" :class="{ 'field-error': sortOrderError }">{{ sortOrderError || (editingMeta?.sortOrder !== undefined && String(form.sortOrder) === '' ? `Left blank, it keeps the current order (${editingMeta.sortOrder}).` : 'Lower numbers show first. Blank sorts by name.') }}</p>
              </div>
              <div class="field">
                <label for="service-rebook">Remind me to rebook after (days)</label>
                <input id="service-rebook" v-model="form.rebookAfterDays" :disabled="isDemo || saving || deleting" type="number" min="0" max="730" step="1" inputmode="numeric" placeholder="42" :aria-invalid="Boolean(rebookError)" aria-describedby="service-rebook-hint" />
                <p id="service-rebook-hint" class="field-hint" :class="{ 'field-error': rebookError }">{{ rebookError || 'That many days after a visit, the client is listed in Messages for you to invite back. Blank means never.' }}</p>
              </div>
            </div>
            <div class="field">
              <label for="service-prep">Before they come</label>
              <textarea id="service-prep" v-model="form.prepNotes" :disabled="isDemo || saving || deleting" maxlength="400" rows="3" placeholder="Arrive with washed, detangled hair. Bring a reference photo." aria-describedby="service-prep-hint"></textarea>
              <p id="service-prep-hint" class="field-hint tnum">Shown on your booking page and added to the preparation message you open two days before. {{ form.prepNotes.length }}/400</p>
            </div>
          </div>
        </details>

        <details class="form-section more-section" :open="Boolean(teamEnabled && teamSelected.some((id) => memberIssues[id])) || undefined">
          <summary>Visibility, status, place and team <span>Optional</span></summary>
          <div class="more-body">
            <div class="form-grid">
              <div class="field">
                <label for="service-visibility">Who can see it</label>
                <GmSelect id="service-visibility" v-model="form.visibility" :options="visibilityOptions" label="Who can see it" :disabled="isDemo || saving || deleting" :portal-target="selectPortalTarget || 'body'" />
              </div>
              <div class="field">
                <label for="service-status">Status</label>
                <GmSelect id="service-status" v-model="form.active" :options="statusOptions" label="Status" :disabled="isDemo || saving || deleting" :portal-target="selectPortalTarget || 'body'" />
              </div>
            </div>
            <div class="field">
              <label for="service-location">Where it happens</label>
              <input id="service-location" v-model.trim="form.location" :disabled="isDemo || saving || deleting" maxlength="300" placeholder="Address, phone call or video link" />
              <p class="field-hint">Used in your messages and calendar events. Not shown on the booking page yet.</p>
            </div>
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
        <div class="form-actions modal-footer">
          <GmConfirm
            v-model:open="dialogPrompt"
            title="Discard unsaved changes?"
            message="Your edits to this service will be lost."
            confirm-label="Discard changes"
            cancel-label="Keep editing"
            tone="danger"
            align="start"
            :busy="saving"
            @confirm="discardChanges"
            @cancel="keepEditing"
          ><button class="ghost" type="button" :disabled="saving" @click="close">Cancel</button></GmConfirm>
          <GmConfirm
            v-model:open="capPrompt"
            :title="`Create ${teamEstimate.adding} team copies?`"
            :message="`This brings your team copies to ${teamEstimate.total}, over ${STAFF_COPY_WARN}. Each copy is a separate choice for guests on your booking page. You can remove copies later by editing the service.`"
            confirm-label="Save and create copies"
            cancel-label="Go back"
            :busy="saving"
            @confirm="submit(true)"
          ><GmButton type="submit" variant="primary" :pending="saving" pending-label="Saving…" :disabled-reason="submitReason">{{ editing ? 'Save changes' : 'Create service' }}</GmButton></GmConfirm>
        </div>
      </form>
    </GmDialog>

    <BulkTeamChoiceDialog v-model:open="bulkOpen" @busy="bulkBusy = $event" />
    <ServiceImportDialog v-model:open="importOpen" :resume="resumeImport" @busy="importBusy = $event" />

    <GmDialog
      :open="Boolean(pendingRevoke)"
      variant="confirm"
      :title="`Turn off the link for ${displayName(pendingRevoke?.name) || 'service'}?`"
      content-class="card modal confirm-dialog"
      :busy="Boolean(linkBusy)"
      @update:open="(value) => { if (!value) pendingRevoke = null }"
    >
      <div v-if="pendingRevoke" class="confirm-body">
        <h2>Turn off the link for {{ displayName(pendingRevoke.name) }}?</h2>
        <p>Anyone holding this link, including printed QR codes, can no longer open it or book. Existing bookings are unchanged.</p>
        <div class="form-actions">
          <button class="secondary" type="button" :disabled="Boolean(linkBusy)" @click="pendingRevoke = null">Keep link</button>
          <button class="danger solid" type="button" :disabled="isDemo || Boolean(linkBusy)" @click="confirmRevoke">{{ linkBusy ? 'Turning off…' : 'Turn off link' }}</button>
        </div>
      </div>
    </GmDialog>

    <GmDialog
      :open="Boolean(pendingDelete)"
      variant="confirm"
      :title="`Delete ${displayName(pendingDelete?.name) || 'service'}?`"
      content-class="card modal confirm-dialog"
      :busy="deleting"
      @open-auto-focus="focusKeepService"
      @update:open="(value) => { if (!value) requestDeleteClose() }"
    >
      <div v-if="pendingDelete" class="confirm-body">
        <h2>Delete {{ displayName(pendingDelete.name) }}?</h2>
        <p v-if="copiesOf(pendingDelete).length">This also removes its {{ copiesOf(pendingDelete).length }} team {{ copiesOf(pendingDelete).length === 1 ? 'copy' : 'copies' }} (with {{ copiesOf(pendingDelete).map(memberName).join(', ') }}).</p>
        <p v-if="deleteUpcoming"><strong>{{ deleteUpcoming }} upcoming {{ deleteUpcoming === 1 ? 'booking uses' : 'bookings use' }} this service.</strong> Deleting leaves {{ deleteUpcoming === 1 ? 'that appointment' : 'those appointments' }} without a service on your list. Pausing hides it from guests and keeps everything.</p>
        <p v-else>It disappears from your booking page. Past bookings and client history stay.</p>
        <div v-if="error" class="notice error" role="alert">{{ error }}</div>
        <div class="form-actions">
          <button ref="keepServiceButton" class="secondary" type="button" :disabled="deleting || pausing" @click="requestDeleteClose">Keep service</button>
          <button v-if="deleteUpcoming && pendingDelete.active !== false" class="primary" type="button" :disabled="deleting || pausing || isDemo" @click="pauseInstead">{{ pausing ? 'Pausing…' : 'Pause instead' }}</button>
          <button :class="deleteUpcoming && pendingDelete.active !== false ? 'ghost delete-anyway' : 'danger solid'" type="button" :disabled="deleting || pausing || isDemo" @click="remove">{{ deleting ? 'Deleting…' : deleteUpcoming ? 'Delete anyway' : 'Delete service' }}</button>
        </div>
      </div>
    </GmDialog>
  </section>
</template>

<style scoped>
.services-page { min-width: 0; }
.first-row { margin-bottom: var(--space-4); padding: var(--space-3) var(--space-4); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 2px var(--radius) var(--radius) 2px; background: var(--surface); }
.first-row > svg { color: var(--accent); }
.first-row > div { min-width: 0; flex: 1 1 260px; }
.first-row strong { font-size: var(--text-sm); }
.first-row p { margin: 2px 0 0; color: var(--muted); font-size: var(--text-sm); }
.toolbar { align-items: center; }
.count-line { font-size: var(--text-sm); }
.price-group { margin-bottom: var(--space-5); }
.group-title { margin: 0 0 var(--space-2); display: flex; align-items: baseline; gap: var(--space-2); font-size: var(--text-md); }
.group-title small { color: var(--muted); font-size: var(--text-xs); font-weight: var(--weight-medium); }
.price-row { padding: var(--space-3) var(--space-4); display: grid; grid-template-columns: minmax(0, 1fr) minmax(150px, 220px) minmax(96px, auto) auto; align-items: center; gap: var(--space-3) var(--space-5); }
.price-row.is-paused { background: var(--surface-soft); }
.price-row.is-paused h3 { color: var(--ink-soft); }
.price-name { min-width: 0; }
.price-name h3 { margin: 0; font-size: var(--text-md); overflow-wrap: anywhere; }
.price-desc { margin: 2px 0 0; display: -webkit-box; overflow: hidden; color: var(--muted); font-size: var(--text-sm); -webkit-box-orient: vertical; -webkit-line-clamp: 1; line-clamp: 1; }
.price-tags { margin: 6px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px var(--space-3); }
.price-tags:empty { display: none; }
.team-line { color: var(--ink-soft); font-size: var(--text-xs); }
.price-amount { font-size: var(--text-md); text-align: right; white-space: nowrap; }
.price-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); }
.price-actions .menu > summary.icon-button { display: inline-grid; }
.share-menu > summary { display: inline-flex; }
.share-panel { width: min(320px, calc(100vw - 32px)); padding: var(--space-4); gap: var(--space-2); justify-items: start; }
.share-panel .cluster > * { width: auto; }
.share-panel :is(button, a) { width: auto; }
.share-title { margin: 0; font-weight: var(--weight-strong); }
.share-note { margin: 0; color: var(--muted); font-size: var(--text-xs); }
.share-url { max-width: 100%; padding: 6px 8px; overflow: hidden; color: var(--ink-soft); border-radius: var(--radius-xs); background: var(--surface-sunken); font-family: var(--font-mono); font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }
.revoke { color: var(--danger); }
.menu-panel :deep(.danger-item) { --button-fg: var(--danger); }
.orphans > .muted { margin: 0 0 var(--space-2); font-size: var(--text-sm); }
.orphan-row { padding: var(--space-2) var(--space-4); display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); font-size: var(--text-sm); }

.service-form .form-section { padding-top: var(--space-4); }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 var(--space-4); align-items: start; }
.price-inputs { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: var(--space-2); }
.price-inputs > * { min-width: 0; }
.field-hint a { color: var(--accent); font-weight: var(--weight-strong); }
.more-section { padding: 0; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.more-section + .more-section { margin-top: var(--space-2); }
.more-section > summary { min-height: var(--control-h); padding: 0 var(--space-3); display: flex; align-items: center; gap: var(--space-2); color: var(--ink); cursor: pointer; font-size: var(--text-sm); font-weight: var(--weight-strong); }
.more-section > summary span { margin-left: auto; color: var(--muted); font-size: var(--text-xs); font-weight: var(--weight-regular); }
.more-body { padding: var(--space-3); border-top: 1px solid var(--line); }
.more-body > :last-child { margin-bottom: 0; }
.submit-reason { margin: var(--space-3) 0 0; color: var(--danger); font-size: var(--text-sm); line-height: 1.45; }
.modal-footer { justify-content: space-between; }

.confirm-body { display: grid; gap: var(--space-2); }
.confirm-body h2 { margin: 0; font-size: var(--text-lg); }
.confirm-body p { margin: 0; color: var(--ink-soft); font-size: var(--text-sm); }
.confirm-body .form-actions { margin-top: var(--space-3); justify-content: flex-end; }
.delete-anyway { color: var(--danger); }

@media (max-width: 900px) {
  .price-row { grid-template-columns: minmax(0, 1fr) auto; }
  .price-length { grid-column: 1; }
  .price-amount { grid-column: 2; grid-row: 1; align-self: start; }
  .price-actions { grid-column: 1 / -1; justify-content: flex-start; }
}
@media (max-width: 700px) {
  .form-grid { grid-template-columns: 1fr; }
  .modal-footer > * { flex: 1; }
}
</style>
