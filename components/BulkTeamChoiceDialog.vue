<script setup>
// "Let guests choose a team member for..." in bulk: one guest-page copy per (service, person), made with the same
// createStaffServices flow as the single-service form (own hours, "With Amaka" on the booking page, cap confirm).
import { computed, inject, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import GmButton from './ui/GmButton.vue'
import GmConfirm from './ui/GmConfirm.vue'
import GmDialog from './ui/GmDialog.vue'
import GmHint from './ui/GmHint.vue'
import {
  STAFF_COPY_MAX,
  STAFF_COPY_WARN,
  createStaffServices,
  isStaffCopy,
  saveStaff,
  scheduleForStaff,
  serviceDisplayMeta,
  staffServiceCopyEstimate,
  teamMembers,
} from '../booking.js'
import { isOwnerMember, parseServiceIds } from '../team.js'
import { memberColor } from '../team-ui.js'
import { isDemo } from '../runtime.js'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['update:open', 'busy'])
const state = inject('bookingState')
const refresh = inject('refreshBookings', async () => true)
const toast = inject('toast', null)

const scope = ref('all') // 'all' | 'categories'
const pickedCategories = ref([])
const pickedMembers = ref([])
const running = ref(false)
const progress = ref({ done: 0, total: 0 })
const capPrompt = ref(false)
const error = ref('')
let stopRequested = false

const baseServices = computed(() => (state.services || []).filter((item) => !isStaffCopy(item)))
const categories = computed(() => {
  // Same order as the Services page: by the lowest sort order in the category, uncategorised last.
  const found = new Map()
  for (const service of baseServices.value) {
    const meta = serviceDisplayMeta(service)
    const key = meta.category || ''
    const entry = found.get(key) || { key, count: 0, rank: Number.MAX_SAFE_INTEGER, label: key || 'Other services' }
    entry.count += 1
    entry.rank = Math.min(entry.rank, meta.sortOrder ?? Number.MAX_SAFE_INTEGER)
    found.set(key, entry)
  }
  return [...found.values()].sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.rank - b.rank || a.label.localeCompare(b.label)))
})
const scoped = computed(() =>
  scope.value === 'all'
    ? baseServices.value
    : baseServices.value.filter((service) => pickedCategories.value.includes(serviceDisplayMeta(service).category || '')),
)

const people = computed(() => teamMembers(state).filter((member) => !isOwnerMember(member)))
const needsHours = (member) => !scheduleForStaff(state, member)
const chosenPeople = computed(() => people.value.filter((member) => pickedMembers.value.includes(member.id) && !needsHours(member)))

// Which (service, person) pairs can be made: the person needs hours and an interval at least as long as the service.
const intervalOf = (member) => Number(scheduleForStaff(state, member)?.slot_interval_minutes || 0)
const tooLongFor = (member) => scoped.value.filter((service) => Number(service.duration_minutes) > intervalOf(member))
const preflight = computed(() => {
  const services = scoped.value
  const members = chosenPeople.value
  const pairs = services.length * members.length
  let adding = 0
  let skipped = 0
  let existing = staffServiceCopyEstimate(state, { serviceIds: [], staffIds: [] }).existing
  for (const service of services) {
    const eligible = members.filter((member) => Number(service.duration_minutes) <= intervalOf(member))
    skipped += members.length - eligible.length
    const estimate = staffServiceCopyEstimate(state, { serviceIds: [service.id], staffIds: eligible.map((member) => member.id) })
    adding += estimate.adding
    existing = estimate.existing
  }
  const total = existing + adding
  return {
    services: services.length,
    members: members.length,
    pairs,
    skipped,
    adding,
    already: pairs - skipped - adding,
    total,
    max: STAFF_COPY_MAX,
    warnAt: STAFF_COPY_WARN,
    overCap: adding > 0 && total > STAFF_COPY_WARN,
    overMax: adding > 0 && total > STAFF_COPY_MAX,
  }
})
const shortMembers = computed(() => chosenPeople.value.map((member) => ({ member, count: tooLongFor(member).length })).filter((item) => item.count))

const reason = computed(() => {
  if (isDemo.value) return 'The demo is read-only.'
  if (!people.value.length) return 'Add a team member on the Team page first.'
  if (scope.value === 'categories' && !pickedCategories.value.length) return 'Choose at least one category, or switch to All services.'
  if (!scoped.value.length) return 'There are no services in that choice.'
  if (!chosenPeople.value.length) return 'Choose at least one team member who has working hours.'
  if (preflight.value.overMax) return `That would make ${preflight.value.total} guest-page copies; the limit is ${STAFF_COPY_MAX}. Choose fewer services or people.`
  if (!preflight.value.adding) return 'Nothing new to create: every choice already has a copy, or cannot be made.'
  return ''
})

function reset() {
  scope.value = 'all'
  pickedCategories.value = []
  pickedMembers.value = people.value.filter((member) => !needsHours(member)).map((member) => member.id)
  progress.value = { done: 0, total: 0 }
  error.value = ''
  capPrompt.value = false
  stopRequested = false
}
watch(() => props.open, (value) => { if (value && !running.value) reset() }, { immediate: true })
watch(running, (value) => emit('busy', value))

const withId = (list, id, checked) => {
  const next = new Set(list)
  if (checked) next.add(id)
  else next.delete(id)
  return [...next]
}
const toggleCategory = (key, checked) => { pickedCategories.value = withId(pickedCategories.value, key, checked) }
const toggleMember = (id, checked) => { pickedMembers.value = withId(pickedMembers.value, id, checked) }

function requestSubmit() {
  if (reason.value || running.value) return
  if (preflight.value.overCap) { capPrompt.value = true; return }
  run()
}

async function run() {
  if (reason.value || running.value) return
  running.value = true
  error.value = ''
  stopRequested = false
  const services = scoped.value
  const staffIds = chosenPeople.value.map((member) => member.id)
  progress.value = { done: 0, total: services.length }
  const tally = { created: 0, updated: 0, skipped: 0 }
  try {
    // A person with a restricted service list gets these services added to it ("offers this").
    const staff = []
    for (const member of state.staff || []) {
      const ids = parseServiceIds(member)
      if (staffIds.includes(member.id) && ids.length) {
        const next = [...new Set([...ids, ...services.map((service) => service.id)])]
        if (next.length !== ids.length) await saveStaff(member, { serviceIds: next })
        staff.push({ ...member, service_ids_json: JSON.stringify(next) })
      } else staff.push(member)
    }
    let known = [...(state.services || [])]
    for (const service of services) {
      if (stopRequested) break
      const made = await createStaffServices({ ...state, services: known, staff }, service, staffIds, { confirmOverCap: true })
      known = [...known, ...made.created]
      tally.created += made.created.length
      tally.updated += made.updated.length
      tally.skipped += made.skipped.length
      progress.value = { ...progress.value, done: progress.value.done + 1 }
    }
    await refresh()
    const stopped = stopRequested
    emit('update:open', false)
    const parts = [`${tally.created} guest-page ${tally.created === 1 ? 'copy' : 'copies'} created`]
    if (tally.updated) parts.push(`${tally.updated} refreshed`)
    if (tally.skipped) parts.push(`${tally.skipped} skipped because the person has no hours or a shorter interval than the service`)
    const text = `${stopped ? `Stopped after ${progress.value.done} of ${services.length} services. ` : ''}${parts.join(', ')}.`
    if (tally.skipped || stopped) toast?.info?.(text, { duration: 9000 })
    else toast?.success(text)
  } catch (reason) {
    error.value = reason?.message || 'The copies could not be created.'
    toast?.error(`${progress.value.done} of ${services.length} services were done before this stopped: ${error.value} Run it again to finish; nothing is duplicated.`)
    await refresh()
  } finally {
    running.value = false
  }
}

function requestClose() {
  if (running.value) return
  emit('update:open', false)
}
</script>

<template>
  <GmDialog
    :open="open"
    title="Let guests choose a team member"
    :busy="running"
    content-class="card modal bulk-team-dialog"
    overlay-class="modal-backdrop"
    @update:open="(value) => { if (!value) requestClose() }"
  >
    <form novalidate @submit.prevent="requestSubmit">
      <div class="modal-header">
        <div>
          <p class="eyebrow">Many services at once</p>
          <h2>Let guests choose a team member</h2>
          <p class="muted">Each person gets a copy of each service on their own working hours, so your booking page offers "With Amaka". Past bookings and your own service are unchanged.</p>
        </div>
        <button class="icon-button" type="button" aria-label="Close" :disabled="running" @click="requestClose"><AppIcon name="close" /></button>
      </div>

      <div v-if="error" class="notice error" role="alert"><AppIcon name="alert" :size="18" />{{ error }}</div>

      <fieldset class="block">
        <legend>Which services?</legend>
        <div class="segmented" role="group" aria-label="Which services">
          <button type="button" :class="{ 'is-active': scope === 'all' }" :aria-pressed="scope === 'all'" :disabled="running" @click="scope = 'all'">All services ({{ baseServices.length }})</button>
          <button type="button" :class="{ 'is-active': scope === 'categories' }" :aria-pressed="scope === 'categories'" :disabled="running" @click="scope = 'categories'">By category</button>
        </div>
        <ul v-if="scope === 'categories'" class="checks">
          <li v-for="category in categories" :key="category.key || '__none'">
            <label class="check"><input type="checkbox" :checked="pickedCategories.includes(category.key)" :disabled="running" @change="toggleCategory(category.key, $event.target.checked)" /><span>{{ category.label }} <small>{{ category.count }} {{ category.count === 1 ? 'service' : 'services' }}</small></span></label>
          </li>
        </ul>
      </fieldset>

      <fieldset class="block">
        <legend>Which people? <GmHint text="Only active team members with working hours can be chosen. A person whose booking interval is shorter than a service is skipped for that service." label="About which people" /></legend>
        <p v-if="!people.length" class="field-hint">Add team members on the <RouterLink to="/team" @click="requestClose">Team page</RouterLink> first.</p>
        <ul v-else class="checks">
          <li v-for="member in people" :key="member.id">
            <label class="check" :class="{ blocked: needsHours(member) }">
              <input type="checkbox" :checked="pickedMembers.includes(member.id) && !needsHours(member)" :disabled="running || needsHours(member)" @change="toggleMember(member.id, $event.target.checked)" />
              <span><i class="swatch" :style="{ background: memberColor(member) }" aria-hidden="true" />{{ member.name }}<small v-if="member.role"> {{ member.role }}</small><small v-if="needsHours(member)" class="issue"> Set working hours on the Team page first.</small></span>
            </label>
          </li>
        </ul>
      </fieldset>

      <div class="preflight" :class="{ bad: preflight.overMax, warn: preflight.overCap && !preflight.overMax }" role="status" aria-live="polite" data-bulk-preflight>
        <strong>{{ preflight.services }} {{ preflight.services === 1 ? 'service' : 'services' }} x {{ preflight.members }} {{ preflight.members === 1 ? 'person' : 'people' }} = {{ preflight.pairs }} guest-page {{ preflight.pairs === 1 ? 'copy' : 'copies' }}</strong>
        <span>{{ preflight.adding }} new<template v-if="preflight.already">, {{ preflight.already }} already exist</template><template v-if="preflight.skipped">, {{ preflight.skipped }} cannot be made</template>. Your workspace would then hold {{ preflight.total }} of {{ preflight.max }} allowed copies (limit {{ preflight.max }}; you confirm above {{ preflight.warnAt }}).</span>
        <span v-for="item in shortMembers" :key="item.member.id" class="issue">{{ item.member.name }}: {{ item.count }} {{ item.count === 1 ? 'service is' : 'services are' }} longer than their {{ intervalOf(item.member) }}-minute interval and will be skipped. Raise it in <RouterLink :to="{ path: '/availability', query: { staff: item.member.id } }" @click="requestClose">Availability</RouterLink>.</span>
      </div>

      <div v-if="running" class="progress" role="status">
        <progress :max="progress.total || 1" :value="progress.done" aria-label="Creating copies" />
        <span>{{ progress.done }} of {{ progress.total }} services done.</span>
      </div>

      <div class="form-actions modal-footer">
        <GmConfirm
          v-model:open="capPrompt"
          :title="`Create ${preflight.adding} guest-page copies?`"
          :message="`This brings your team copies to ${preflight.total}, over ${preflight.warnAt}. Each copy is a separate choice for guests on your booking page. You can remove copies later by editing a service.`"
          confirm-label="Create copies"
          cancel-label="Go back"
          :busy="running"
          @confirm="run"
        >
          <GmButton variant="primary" type="submit" :pending="running" pending-label="Creating…" :disabled-reason="reason">Create {{ preflight.adding }} {{ preflight.adding === 1 ? 'copy' : 'copies' }}</GmButton>
        </GmConfirm>
        <GmButton v-if="running" variant="secondary" type="button" @click="stopRequested = true">Stop after this service</GmButton>
        <GmButton v-else variant="secondary" type="button" @click="requestClose">Cancel</GmButton>
      </div>
      <p v-if="reason && !isDemo" class="field-hint reason" role="status">{{ reason }}</p>
    </form>
  </GmDialog>
</template>

<style scoped>
.block { margin: 0 0 var(--space-4); padding: 0; border: 0; min-width: 0; }
.block legend { margin-bottom: var(--space-2); padding: 0; font-weight: 700; }
.checks { margin: var(--space-2) 0 0; padding: 0; list-style: none; display: grid; gap: 2px; max-height: 220px; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.check { min-height: 44px; padding: 0 var(--space-3); display: flex; align-items: center; gap: var(--space-3); cursor: pointer; font-weight: 400; }
.check input { flex: none; width: 20px; height: 20px; accent-color: var(--accent); }
.check small { color: var(--muted); }
.check.blocked { cursor: not-allowed; }
.issue { color: var(--danger); font-size: var(--text-sm); }
.swatch { width: 10px; height: 10px; margin-right: 6px; border-radius: 50%; display: inline-block; }
.preflight { margin-bottom: var(--space-3); padding: var(--space-3); display: grid; gap: 4px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-soft); font-size: var(--text-sm); line-height: 1.5; }
.preflight.warn { border-color: #d9a400; background: #fff9e6; }
.preflight.bad { border-color: var(--danger); background: #fff1f0; }
.progress { margin-bottom: var(--space-3); display: grid; gap: 4px; font-size: var(--text-sm); }
.progress progress { width: 100%; }
.reason { margin: var(--space-2) 0 0; color: var(--danger); }
</style>
