<script setup>
// "Choose services" list for the Team dialog, built for 60+ services: search, one checkbox per category,
// Select all / none, and a live count of the guest-page copies those services could become.
import { computed, ref, useId } from 'vue'
import { serviceDisplayMeta } from '../booking.js'
import { displayName } from '../team-ui.js'

const props = defineProps({
  services: { type: Array, default: () => [] }, // base services
  disabled: Boolean,
  // { services, members, pairs, existing, adding, total, max, warnAt, overMax } or null
  estimate: { type: Object, default: null },
})
const selected = defineModel('selected', { type: Array, default: () => [] })
const uid = useId()
const search = ref('')

const entries = computed(() =>
  props.services.map((service) => ({ service, category: serviceDisplayMeta(service).category || '', name: displayName(service.name) })),
)
const visible = computed(() => {
  const words = search.value.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return entries.value
  return entries.value.filter((entry) => words.every((word) => `${entry.name} ${entry.category}`.toLowerCase().includes(word)))
})
const groups = computed(() => {
  const byCategory = new Map()
  for (const entry of visible.value) {
    if (!byCategory.has(entry.category)) byCategory.set(entry.category, [])
    byCategory.get(entry.category).push(entry)
  }
  return [...byCategory.entries()]
    .map(([category, list]) => ({ category, label: category || 'Other services', list }))
    .sort((a, b) => (a.category === '' ? 1 : b.category === '' ? -1 : a.label.localeCompare(b.label)))
})
const showHeadings = computed(() => groups.value.some((group) => group.category))
const chosen = computed(() => new Set(selected.value))
const visibleChosen = computed(() => visible.value.filter((entry) => chosen.value.has(entry.service.id)).length)

function set(ids, on) {
  const next = new Set(selected.value)
  for (const id of ids) {
    if (on) next.add(id)
    else next.delete(id)
  }
  selected.value = [...next]
}
const idsOf = (list) => list.map((entry) => entry.service.id)
const stateOf = (group) => {
  const count = group.list.filter((entry) => chosen.value.has(entry.service.id)).length
  return { all: count === group.list.length, some: count > 0 && count < group.list.length, count }
}
const filtered = computed(() => Boolean(search.value.trim()))
</script>

<template>
  <div class="picker">
    <div class="picker-tools">
      <input v-model="search" type="search" class="picker-search" aria-label="Search services to choose" placeholder="Search services or categories" :disabled="disabled" />
      <div class="picker-buttons">
        <button type="button" class="ghost small-button" :disabled="disabled || !visible.length" @click="set(idsOf(visible), true)">{{ filtered ? 'Select all shown' : 'Select all' }}</button>
        <button type="button" class="ghost small-button" :disabled="disabled || !visibleChosen" @click="set(idsOf(visible), false)">{{ filtered ? 'Select none shown' : 'Select none' }}</button>
      </div>
    </div>
    <p class="picker-count tnum" role="status">{{ selected.length }} of {{ services.length }} {{ services.length === 1 ? 'service' : 'services' }} chosen<template v-if="filtered"> · {{ visible.length }} shown</template></p>

    <div class="picker-list" tabindex="-1">
      <p v-if="!visible.length" class="field-hint">No services match “{{ search }}”.</p>
      <section v-for="group in groups" :key="group.category || '__none'" class="picker-group">
        <label v-if="showHeadings" class="picker-category">
          <input
            type="checkbox"
            :checked="stateOf(group).all"
            :indeterminate.prop="stateOf(group).some"
            :disabled="disabled"
            :aria-label="`Select all ${group.label} services`"
            @change="set(idsOf(group.list), $event.target.checked)"
          />
          <strong>{{ group.label }}</strong>
          <small class="muted">{{ stateOf(group).count }} of {{ group.list.length }}</small>
        </label>
        <ul class="service-picks">
          <li v-for="entry in group.list" :key="entry.service.id">
            <label class="pick"><input type="checkbox" :checked="chosen.has(entry.service.id)" :disabled="disabled" @change="set([entry.service.id], $event.target.checked)" /><span>{{ entry.name }} <small class="muted">{{ entry.service.duration_minutes }} min</small></span></label>
          </li>
        </ul>
      </section>
    </div>

    <p v-if="estimate && selected.length" :id="`${uid}-estimate`" class="picker-estimate" :class="{ over: estimate.overMax }" role="status" aria-live="polite" data-team-preflight>
      <strong>{{ estimate.services }} {{ estimate.services === 1 ? 'service' : 'services' }} x {{ estimate.members }} {{ estimate.members === 1 ? 'member' : 'members' }} = {{ estimate.pairs }} guest-page {{ estimate.pairs === 1 ? 'copy' : 'copies' }}</strong>
      if guests may choose any of your team for these (limit {{ estimate.max }}). {{ estimate.existing }} {{ estimate.existing === 1 ? 'copy exists' : 'copies exist' }} now, so that would bring you to {{ estimate.total }}.<template v-if="estimate.overMax"> That is over the limit: offer fewer services per person.</template>
      Choosing services here only decides what you can assign; copies are made in Services.
    </p>
  </div>
</template>

<style scoped>
.picker { margin-top: var(--space-2); display: grid; gap: var(--space-2); min-width: 0; }
.picker-tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.picker-search { flex: 1 1 200px; min-width: 0; min-height: 40px; padding: 0 var(--space-3); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); }
.picker-buttons { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.picker-count { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.picker-list { max-height: 320px; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.picker-list > .field-hint { padding: var(--space-3); margin: 0; }
.picker-group + .picker-group { border-top: 1px solid var(--line); }
.picker-category { position: sticky; top: 0; z-index: 1; min-height: 44px; padding: 0 var(--space-3); display: flex; align-items: center; gap: var(--space-3); background: var(--surface-soft); cursor: pointer; font-weight: 400; }
.picker-category input, .pick input { flex: none; width: 20px; height: 20px; accent-color: var(--accent); }
.picker-category small { margin-left: auto; }
.service-picks { margin: 0; padding: 0; list-style: none; }
.pick { min-height: 44px; padding: 0 var(--space-3) 0 var(--space-5); display: flex; align-items: center; gap: var(--space-3); cursor: pointer; font-weight: 400; }
.pick small { white-space: nowrap; }
.picker-estimate { margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--surface-soft); font-size: var(--text-sm); line-height: 1.5; }
.picker-estimate.over { color: var(--danger); background: #fff1f0; }
</style>
