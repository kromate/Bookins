<script setup>
// "Who offers this?" section of the service form. Pure presentation: Services.vue owns the data and the writes.
// Each chosen team member gets a copy of the service on their own schedule, so guests can pick "With Amaka".
import { computed, nextTick, ref, useId } from 'vue'
import GmHint from './ui/GmHint.vue'

const props = defineProps({
  members: { type: Array, default: () => [] }, // team members (not the owner): { id, name, role, color, inactive }
  ownerName: { type: String, default: 'You' },
  issues: { type: Object, default: () => ({}) }, // memberId -> plain-language reason they cannot be picked
  notes: { type: Object, default: () => ({}) }, // memberId -> extra info shown under the name
  copyMembers: { type: Array, default: () => [] }, // member ids that already have a copy
  estimate: { type: Object, default: null }, // { total, adding, removing, warnAt, max, overCap, overMax }
  disabled: Boolean,
})
const selected = defineModel('selected', { type: Array, default: () => [] })
const enabled = defineModel('enabled', { type: Boolean, default: false })
const uid = useId()
const list = ref(null)
const removing = computed(() => props.copyMembers.filter((id) => !selected.value.includes(id)).length)
const removingAll = computed(() => !enabled.value && props.copyMembers.length)

function toggle(id, checked) {
  const next = new Set(selected.value)
  if (checked) next.add(id)
  else next.delete(id)
  selected.value = [...next]
}
function setEnabled(value) {
  enabled.value = value
  // Turning it on with nothing chosen: pre-select everyone who can take it, so the choice is visible.
  if (value && !selected.value.length)
    selected.value = props.members.filter((member) => !props.issues[member.id]).map((member) => member.id)
  // The list opens below the switch, often under the sticky footer: bring it into view.
  if (value) nextTick(() => list.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
}
</script>

<template>
  <section class="form-section team-fields" data-tour="tour-services-team">
    <h3>Who offers this?</h3>
    <div class="switch-row">
      <label class="switch" :for="`${uid}-guest-choice`">
        <input
          :id="`${uid}-guest-choice`"
          type="checkbox"
          role="switch"
          :checked="enabled"
          :disabled="disabled"
          @change="setEnabled($event.target.checked)"
        />
        <span class="switch-track" aria-hidden="true"><span class="switch-thumb" /></span>
        <span class="switch-label">Let guests choose a team member</span>
      </label>
      <GmHint
        text="Bookins makes one copy of this service per person, linked to that person's own working hours. Guests then pick 'With Amaka' or 'With Tolu' on your booking page, and the booking lands on that person's schedule, so two people can work at the same time."
        label="About letting guests choose a team member"
      />
    </div>
    <p class="field-hint">
      {{ enabled ? 'Guests pick a person when they book. You always offer it yourself, on your own hours.' : 'Off: guests book this service with you, on your own hours.' }}
    </p>

    <fieldset v-if="enabled" ref="list" class="member-list" :disabled="disabled">
      <legend class="visually-hidden">Team members who offer this service</legend>
      <div class="member-row owner-row">
        <input type="checkbox" checked disabled :id="`${uid}-owner`" />
        <label :for="`${uid}-owner`">
          <strong>{{ ownerName }}</strong>
          <span>Always offered. The main service books on your hours.</span>
        </label>
      </div>
      <div v-for="member in members" :key="member.id" class="member-row" :class="{ blocked: issues[member.id] }">
        <input
          :id="`${uid}-${member.id}`"
          type="checkbox"
          :checked="selected.includes(member.id)"
          :disabled="disabled || (Boolean(issues[member.id]) && !selected.includes(member.id))"
          :aria-describedby="issues[member.id] || notes[member.id] ? `${uid}-${member.id}-note` : undefined"
          @change="toggle(member.id, $event.target.checked)"
        />
        <label :for="`${uid}-${member.id}`">
          <strong>
            <span v-if="member.color" class="swatch" :style="{ background: member.color }" aria-hidden="true" />{{ member.name }}
            <span v-if="member.role" class="role">{{ member.role }}</span>
            <span v-if="copyMembers.includes(member.id)" class="chip neutral">Has a copy</span>
            <span v-if="member.inactive" class="chip paused">Inactive</span>
          </strong>
          <span :id="`${uid}-${member.id}-note`" :class="{ 'field-error': issues[member.id] }">
            {{ issues[member.id] || notes[member.id] || 'Guests can book this with them.' }}
          </span>
        </label>
      </div>
      <p v-if="!members.length" class="field-hint">Add team members on the <RouterLink to="/team">Team page</RouterLink> first.</p>
    </fieldset>

    <p v-if="enabled && estimate && (estimate.adding || removing)" class="field-hint" :class="{ 'field-error': estimate.overMax }" role="status">
      Saving {{ estimate.adding ? `adds ${estimate.adding} team ${estimate.adding === 1 ? 'copy' : 'copies'}` : '' }}{{ estimate.adding && removing ? ' and ' : '' }}{{ removing ? `removes ${removing}` : '' }}.
      Your workspace would then hold {{ estimate.total }} of {{ estimate.max }} allowed team copies<template v-if="estimate.overMax">. That is over the limit: offer this with fewer people.</template><template v-else-if="estimate.overCap"> (you will be asked to confirm above {{ estimate.warnAt }}).</template><template v-else>.</template>
    </p>
    <p v-if="removingAll" class="notice warning" role="status">
      Saving removes {{ copyMembers.length }} team {{ copyMembers.length === 1 ? 'copy' : 'copies' }}. Guests will book this service with you only. Past bookings keep their history.
    </p>
  </section>
</template>

<style scoped>
.switch-row { display: flex; align-items: center; gap: var(--space-2); }
.switch { display: inline-flex; align-items: center; gap: var(--space-3); min-height: var(--control-h); cursor: pointer; font-weight: 650; }
.switch input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.switch-track { position: relative; flex: none; width: 44px; height: 26px; border-radius: 999px; background: var(--line-strong, #c9cfdd); transition: background var(--dur-fast) var(--ease); }
.switch-thumb { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgb(16 25 40 / 30%); transition: transform var(--dur-fast) var(--ease); }
.switch input:checked + .switch-track { background: var(--accent); }
.switch input:checked + .switch-track .switch-thumb { transform: translateX(18px); }
.switch input:focus-visible + .switch-track { outline: 2px solid var(--accent); outline-offset: 2px; }
.switch input:disabled ~ * { opacity: 0.6; cursor: not-allowed; }
.member-list { margin: var(--space-3) 0 0; padding: 0; border: 1px solid var(--line); border-radius: var(--radius-sm); min-width: 0; }
.member-row { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-3); border-top: 1px solid var(--line); }
.member-row:first-of-type { border-top: 0; }
.member-row input { flex: none; width: 20px; height: 20px; margin-top: 2px; accent-color: var(--accent); }
.member-row label { display: grid; gap: 2px; min-width: 0; cursor: pointer; font-weight: 400; }
.member-row label strong { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.member-row label > span { color: var(--muted); font-size: var(--text-sm); line-height: 1.4; }
.member-row .field-error { color: var(--danger); }
.member-row.blocked label { cursor: not-allowed; }
.role { color: var(--muted); font-size: var(--text-sm); font-weight: 400; }
.swatch { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.owner-row { background: var(--muted-soft, #f1f3f8); border-radius: var(--radius-sm) var(--radius-sm) 0 0; }
.team-fields .notice { margin-top: var(--space-2); }
</style>
