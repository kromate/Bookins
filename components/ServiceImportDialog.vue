<script setup>
// Services CSV import: 1 add a file, 2 check it, 3 import. Nothing is written until step 3, and every row is one
// complete create or update, so a re-run (or a closed tab) never duplicates a service.
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import GmButton from './ui/GmButton.vue'
import GmConfirm from './ui/GmConfirm.vue'
import GmDialog from './ui/GmDialog.vue'
import GmHint from './ui/GmHint.vue'
import {
  createStaffServices,
  importErrorReportCsv,
  importServices,
  hasTeam,
  parseServiceCsv,
  saveStaff,
  serviceCsvTemplate,
  STAFF_COPY_MAX,
  STAFF_COPY_WARN,
  staffCopies,
  teamMembers,
} from '../booking.js'
import { SERVICE_CSV_COLUMNS } from '../services.js'
import { displayName } from '../team-ui.js'
import { durationWords, smallestIntervalFor } from '../weekly-hours.js'
import { isOwnerMember, ownerStaff, parseServiceIds, scheduleForStaff } from '../team.js'
import { isDemo } from '../runtime.js'

// `resume`: opened from "Continue your import" after fixing the interval, so pick the saved file up straight away.
const props = defineProps({ open: { type: Boolean, default: false }, resume: { type: Boolean, default: false } })
const emit = defineEmits(['update:open', 'busy', 'imported'])

const state = inject('bookingState')
const refresh = inject('refreshBookings', async () => true)
const toast = inject('toast', null)
const localPreview = inject('localPreview', false)

const MAX_FILE_BYTES = 2 * 1024 * 1024
const PREVIEW_LIMIT = 200
const DRAFT_KEY = 'bookins:services-import-draft:v1'

const step = ref(1)
const source = ref('')
const fileName = ref('')
const readError = ref('')
const loadingFile = ref(false)
const dragging = ref(false)
const mapping = ref({})
const parsed = ref(null)
const filter = ref('all')
const running = ref(false)
const phase = ref('')
const progress = ref({ done: 0, total: 0, created: 0, updated: 0, failed: 0 })
const summary = ref(null)
const closePrompt = ref(false)
const capPrompt = ref(false)
const draft = ref('')
const headingRef = ref(null)
let controller = null
let runRows = []

watch(running, (value) => emit('busy', value))

// ---- schedule and existing data ----
const ownerSchedule = computed(() => scheduleForStaff(state, ownerStaff(state)) || (hasTeam(state) ? null : state.schedules?.[0]) || null)
const interval = computed(() => Number(ownerSchedule.value?.slot_interval_minutes || 0))
const defaultCurrency = computed(() => state.services?.find((item) => item.currency)?.currency || 'NGN')
const teamPeople = computed(() => teamMembers(state).filter((member) => !isOwnerMember(member)))

function runParse() {
  parsed.value = parseServiceCsv(source.value, {
    schedule: ownerSchedule.value,
    schedules: state.schedules || [],
    services: state.services || [],
    defaultCurrency: defaultCurrency.value,
    mapping: mapping.value,
  })
}

function analyze() {
  readError.value = ''
  if (!source.value.trim()) {
    readError.value = 'Paste your rows or choose a file first.'
    return
  }
  runParse()
  if (parsed.value.error && !parsed.value.headers.length) {
    readError.value = parsed.value.error
    parsed.value = null
    return
  }
  filter.value = 'all'
  goTo(2)
}

function setMapping(name, field) {
  const next = { ...mapping.value }
  if (field) next[name] = field
  else delete next[name]
  mapping.value = next
  runParse()
}

// ---- reading input ----
const FIELD_LABELS = {
  name: 'Service name',
  category: 'Category',
  description: 'Description',
  duration_minutes: 'Duration (minutes)',
  price: 'Price',
  currency: 'Currency',
  visibility: 'Visibility (public or private)',
  location: 'Location',
  active: 'Active (yes or no)',
  staff: 'Team members who offer it',
  sort_order: 'Sort order',
  rebook_after_days: 'Rebook after days',
  prep_notes: 'Prep notes',
  slug: 'Service ID (advanced)',
}
const FIELD_OPTIONS = [...SERVICE_CSV_COLUMNS, 'slug']

function readFile(file) {
  readError.value = ''
  if (!file) return
  if (/\.(xlsx|xls|numbers|ods)$/i.test(file.name)) {
    readError.value = 'That is a spreadsheet file, not a CSV. In Excel or Google Sheets choose File > Download (or Save as) > CSV, then choose that file.'
    return
  }
  if (file.size > MAX_FILE_BYTES) {
    readError.value = 'That file is larger than 2 MB. Split it into smaller files (up to 1,000 rows each) and import them one at a time.'
    return
  }
  loadingFile.value = true
  const reader = new FileReader()
  reader.onload = () => {
    loadingFile.value = false
    source.value = String(reader.result || '')
    fileName.value = file.name
    mapping.value = {}
    analyze()
  }
  reader.onerror = () => {
    loadingFile.value = false
    readError.value = 'Bookins could not read that file. Try saving it as CSV again, or paste the rows instead.'
  }
  reader.readAsText(file, 'utf-8')
}
const onFileInput = (event) => {
  readFile(event.target.files?.[0])
  event.target.value = ''
}
const onDrop = (event) => {
  dragging.value = false
  readFile(event.dataTransfer?.files?.[0])
}
function onPaste() {
  fileName.value = ''
  mapping.value = {}
}

function download(name, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function downloadTemplate() {
  download('bookins-services-template.csv', serviceCsvTemplate())
  toast?.('Template downloaded. Open it in Google Sheets or Excel, add your services, then come back.')
}
function downloadReport() {
  const failed = summary.value?.failed || []
  const text = importErrorReportCsv(summary.value ? runRows : rows.value, failed)
  download('bookins-import-errors.csv', text)
  toast?.('Error report downloaded')
}

// ---- derived preview ----
const rows = computed(() => parsed.value?.rows || [])
const counts = computed(() => parsed.value?.counts || { new: 0, update: 0, skip: 0, error: 0 })
const visibleAll = computed(() => (filter.value === 'all' ? rows.value : rows.value.filter((row) => row.status === filter.value)))
const visibleRows = computed(() => visibleAll.value.slice(0, PREVIEW_LIMIT))
const importable = computed(() => counts.value.new + counts.value.update)
const statusLabel = { new: 'New', update: 'Update', skip: 'Skipped', error: 'Error' }
const statusChip = { new: 'success', update: 'info', skip: 'neutral', error: 'danger' }
const filters = computed(() => [
  { key: 'all', label: 'All', count: rows.value.length },
  ...['new', 'update', 'skip', 'error'].map((key) => ({ key, label: statusLabel[key], count: counts.value[key] })).filter((item) => item.count),
])
const summaryLine = computed(() => {
  const c = counts.value
  const parts = [`${c.new} new`, `${c.update} to update`]
  if (c.skip) parts.push(`${c.skip} skipped`)
  parts.push(`${c.error} ${c.error === 1 ? 'error' : 'errors'}`)
  return parts.join(', ')
})
const mapperColumns = computed(() => (parsed.value?.headers || []).filter((header) => header.name && (!header.field || mapping.value[header.name])))
const unrecognised = computed(() => (parsed.value?.unmapped || []).length)
const recognised = computed(() => (parsed.value?.headers || []).filter((header) => header.field && !mapping.value[header.name]))
const fieldTakenBy = (field, name) => (parsed.value?.headers || []).some((header) => header.field === field && header.name !== name)

// Services longer than the schedule's slot interval cannot be booked: the engine reserves one interval per booking.
const intervalRows = computed(() => rows.value.filter((row) => row.status === 'error' && row.errors.some((text) => /booking interval/i.test(text))))
const longest = computed(() => Math.max(0, ...intervalRows.value.map((row) => Number(row.values.durationMinutes) || 0)))
// The interval Availability will preselect for the longest row.
const neededInterval = computed(() => smallestIntervalFor(longest.value))
const hasLongHairService = computed(() => intervalRows.value.some((row) => row.values.durationMinutes >= 180))

// Team names from the staff column: matched to active team members; the owner is implicit.
function matchPerson(raw) {
  const text = String(raw || '').trim().toLowerCase()
  if (!text) return null
  if (/^(you|me|owner|myself|self)$/.test(text) || text === String(ownerStaff(state).name || '').toLowerCase()) return { owner: true }
  const exact = teamPeople.value.find((member) => String(member.name).trim().toLowerCase() === text)
  if (exact) return { member: exact }
  const first = teamPeople.value.filter((member) => String(member.name).trim().toLowerCase().split(/\s+/)[0] === text)
  return first.length === 1 ? { member: first[0] } : { missing: String(raw).trim() }
}
const staffPlan = computed(() => {
  const plan = new Map()
  for (const row of rows.value) {
    const names = row.values?.staffNames || []
    if (!names.length) continue
    const members = []
    const missing = []
    for (const name of names) {
      const hit = matchPerson(name)
      if (hit?.member && !members.some((m) => m.id === hit.member.id)) members.push(hit.member)
      else if (hit?.missing) missing.push(hit.missing)
    }
    plan.set(row.line, { members, missing })
  }
  return plan
})
const missingNames = computed(() => [...new Set([...staffPlan.value.values()].flatMap((plan) => plan.missing))])
const copyEstimate = computed(() => {
  let adding = 0
  for (const row of rows.value) {
    if (row.status !== 'new' && row.status !== 'update') continue
    for (const member of staffPlan.value.get(row.line)?.members || [])
      if (!row.existingId || !staffCopies(state, { id: row.existingId }, member).length) adding += 1
  }
  const existing = staffCopies(state).length
  const total = existing + adding
  return { adding, existing, total, overCap: adding > 0 && total > STAFF_COPY_WARN, overMax: adding > 0 && total > STAFF_COPY_MAX }
})
const planned = computed(() => rows.value.filter((row) => (row.status === 'new' || row.status === 'update') && staffPlan.value.get(row.line)?.members.length).length)

const importReason = computed(() => {
  if (isDemo.value) return 'Import is not available in the demo. Switch to your own workspace to import services.'
  if (parsed.value?.error) return 'Match your columns first (see above).'
  if (!importable.value) return counts.value.error ? 'No row can be imported yet: fix the errors in your file, then choose it again.' : 'Nothing to import: every row is already saved or skipped.'
  if (copyEstimate.value.overMax) return `This would create ${copyEstimate.value.total} team copies; the limit is ${STAFF_COPY_MAX}. Remove names from the staff column.`
  return ''
})
const previewReason = computed(() => (!source.value.trim() ? 'Paste your rows or choose a file first.' : ''))
const pct = computed(() => (progress.value.total ? Math.round((progress.value.done / progress.value.total) * 100) : 0))

function priceText(row) {
  const price = Number(row.values?.price) || 0
  return price ? `${row.values.currency} ${price.toLocaleString()}` : 'Free'
}
function reasons(row) {
  if (row.status === 'error') return row.errors
  if (row.status === 'skip') return row.notes
  const out = [row.status === 'update' ? `Updates your saved “${displayName(row.existing?.name || row.values.name)}”.` : 'Will be added.']
  const plan = staffPlan.value.get(row.line)
  if (plan?.members.length) out.push(`Offered by ${plan.members.map((m) => m.name).join(', ')} (team copies).`)
  if (plan?.missing.length) out.push(`No team member called ${plan.missing.map((n) => `“${n}”`).join(', ')}; that name is ignored.`)
  return out
}

// ---- running ----
function onImportClick() {
  if (importReason.value || running.value) return
  if (copyEstimate.value.overCap) capPrompt.value = true
  else run()
}

async function run() {
  if (importReason.value || running.value) return
  runRows = rows.value
  controller = new AbortController()
  summary.value = null
  progress.value = { done: 0, total: importable.value, created: 0, updated: 0, failed: 0 }
  phase.value = 'Saving services'
  running.value = true
  goTo(3)
  const done = { created: 0, updated: 0, skipped: counts.value.skip, errors: counts.value.error, failed: [], cancelled: false, remaining: 0, copiesCreated: 0, copiesUpdated: 0, copyIssues: [], fatal: '' }
  try {
    const result = await importServices(runRows, {
      signal: controller.signal,
      concurrency: 4,
      onProgress: (value) => { progress.value = value },
    })
    Object.assign(done, { created: result.created, updated: result.updated, failed: result.failed, cancelled: result.cancelled, remaining: result.remaining })
    phase.value = 'Updating your list'
    const loaded = await refresh()
    const wanted = result.imported.filter((item) => staffPlan.value.get(item.line)?.members.length)
    if (wanted.length && loaded !== false && !controller.signal.aborted) {
      phase.value = 'Creating team copies'
      progress.value = { ...progress.value, done: 0, total: wanted.length }
      // A member with a restricted service list gets these services added to it (that is what "offers this" means).
      const additions = new Map()
      for (const item of wanted)
        for (const member of staffPlan.value.get(item.line).members)
          if (parseServiceIds(member).length) additions.set(member.id, [...(additions.get(member.id) || []), item.id])
      if (additions.size) {
        try {
          for (const [memberId, ids] of additions) {
            const member = state.staff.find((entry) => entry.id === memberId)
            if (member) await saveStaff(member, { serviceIds: [...new Set([...parseServiceIds(member), ...ids])] })
          }
          await refresh()
        } catch (error) {
          done.copyIssues.push(error?.message || 'Could not update a team member\'s service list.')
        }
      }
      let index = 0
      for (const item of wanted) {
        if (controller.signal.aborted) break
        const service = state.services.find((entry) => entry.id === item.id)
        const members = staffPlan.value.get(item.line).members.map((member) => member.id)
        try {
          if (service) {
            const made = await createStaffServices(state, service, members, { confirmOverCap: true })
            done.copiesCreated += made.created.length
            done.copiesUpdated += made.updated.length
            for (const skip of made.skipped) if (!done.copyIssues.includes(skip.reason)) done.copyIssues.push(skip.reason)
          }
        } catch (error) {
          const reason = error?.message || 'Could not create a team copy.'
          if (!done.copyIssues.includes(reason)) done.copyIssues.push(reason)
        }
        index += 1
        progress.value = { ...progress.value, done: index }
      }
      await refresh()
    }
  } catch (error) {
    done.fatal = error?.message || 'The import could not run.'
  } finally {
    running.value = false
    phase.value = ''
    summary.value = done
    controller = null
    goTo(3)
  }
  const imported = done.created + done.updated
  const failedTotal = done.failed.length + done.errors
  if (done.fatal) toast?.error(done.fatal)
  else if (done.cancelled) toast?.info(`Import stopped: ${imported} saved, ${done.remaining} not started. Import the file again to finish; nothing will be duplicated.`)
  else if (failedTotal) toast?.error(`${imported} imported, ${failedTotal} failed. Download the error report to fix them.`)
  else toast?.success(`${imported} ${imported === 1 ? 'service' : 'services'} imported`)
  emit('imported', imported)
  if (!props.open) resetAll()
}

function stopImport() {
  if (!controller || controller.signal.aborted) return
  controller.abort()
  phase.value = 'Stopping after the rows already in flight'
  toast?.info('Stopping. Services already saved stay saved.')
}

async function checkAgain() {
  // After a finished or stopped run: re-read the file against the refreshed list (saved rows now show as skipped).
  summary.value = null
  runParse()
  goTo(2)
}

function startOver() {
  resetAll()
  goTo(1)
}

// ---- close / reset ----
const dirty = computed(() => !summary.value && !running.value && ((step.value === 1 && source.value.trim().length > 0) || step.value === 2))
const closeTitle = computed(() => (running.value ? 'Stop the import and close?' : 'Discard this import?'))
const closeMessage = computed(() =>
  running.value
    ? 'Services already saved stay saved. Import the file again later to finish the rest; nothing will be duplicated.'
    : 'Nothing has been saved yet. The rows you added here will be cleared.',
)
function requestClose() {
  if (running.value || dirty.value) {
    closePrompt.value = true
    return
  }
  emit('update:open', false)
}
function onFooterCancel() {
  if (running.value) stopImport()
  else requestClose()
}
function confirmClose() {
  if (running.value) stopImport()
  emit('update:open', false)
}

function saveDraft() {
  try {
    if (source.value.trim()) sessionStorage.setItem(DRAFT_KEY, source.value.slice(0, 1_500_000))
  } catch { /* storage unavailable: the owner can paste the file again */ }
}
function readDraft() {
  try { return sessionStorage.getItem(DRAFT_KEY) || '' } catch { return '' }
}
function dropDraft() {
  draft.value = ''
  try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
}
function useDraft() {
  source.value = draft.value
  fileName.value = ''
  dropDraft()
  analyze()
}
function leaveForPage() {
  saveDraft()
  emit('update:open', false)
}

function resetAll() {
  step.value = 1
  source.value = ''
  fileName.value = ''
  readError.value = ''
  mapping.value = {}
  parsed.value = null
  filter.value = 'all'
  summary.value = null
  closePrompt.value = false
  capPrompt.value = false
  progress.value = { done: 0, total: 0, created: 0, updated: 0, failed: 0 }
  runRows = []
}

watch(() => props.open, (open) => {
  if (open) {
    if (!running.value) {
      resetAll()
      draft.value = readDraft()
      if (props.resume && draft.value) useDraft()
    }
  } else if (!running.value) resetAll()
})

function goTo(next) {
  step.value = next
  nextTick(() => {
    headingRef.value?.closest('.gm-dialog-content')?.scrollTo({ top: 0 })
    headingRef.value?.focus({ preventScroll: true })
  })
}

function beforeUnload(event) {
  if (running.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
window.addEventListener('beforeunload', beforeUnload)
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  controller?.abort()
})

const stepTitles = ['Add your file', 'Check the rows', 'Import']
const finishedCount = computed(() => (summary.value ? summary.value.created + summary.value.updated : 0))
const failedCount = computed(() => (summary.value ? summary.value.failed.length + summary.value.errors : 0))
</script>

<template>
  <GmDialog
    :open="open"
    title="Import services"
    content-class="card modal service-import-dialog"
    overlay-class="modal-backdrop bookins-modal-backdrop"
    @update:open="(value) => { if (!value) requestClose() }"
  >
    <div class="import-body">
      <div class="modal-header">
        <div>
          <p class="eyebrow">Import services</p>
          <h2 ref="headingRef" tabindex="-1">{{ step === 3 && summary ? 'Import finished' : stepTitles[step - 1] }}</h2>
          <ol class="steps" aria-label="Import progress">
            <li v-for="(title, index) in stepTitles" :key="title" :class="{ current: step === index + 1, done: step > index + 1 }" :aria-current="step === index + 1 ? 'step' : undefined">
              <span class="step-no">{{ step > index + 1 ? '✓' : index + 1 }}</span>{{ title }}
            </li>
          </ol>
        </div>
        <button class="icon-button" type="button" aria-label="Close" @click="requestClose"><AppIcon name="close" /></button>
      </div>

      <p v-if="localPreview" class="notice info" role="status">
        <AppIcon name="info" :size="18" /><span>Local preview: imported services stay in this browser and never reach your hosted App.</span>
      </p>

      <!-- Step 1 -->
      <div v-if="step === 1" class="step-one">
        <div v-if="draft" class="notice info draft" role="status">
          <AppIcon name="info" :size="18" />
          <span>You left to fix something earlier. Your last file is still here.</span>
          <button class="secondary small-button" type="button" @click="useDraft">Use it again</button>
          <button class="ghost small-button" type="button" @click="dropDraft">Discard</button>
        </div>
        <div v-if="readError" class="notice error" role="alert"><AppIcon name="alert" :size="18" /><span>{{ readError }}</span></div>

        <section class="source-card">
          <h3>1. Start from the template <GmHint text="One row per service. Only the service name and duration are required. Prices can be written like 5000, N5,000 or ₦5,000. Duration can be 90, 90 min or 1h30. Leave a column blank to keep the default." label="About the template" /></h3>
          <p class="muted">A CSV with the right columns and three example rows. Open it in Google Sheets or Excel, add your services, then paste or upload it here.</p>
          <button class="secondary" type="button" @click="downloadTemplate"><AppIcon name="download" :size="17" />Download template</button>
        </section>

        <section class="source-card">
          <h3>2. Paste from Google Sheets or Excel</h3>
          <label class="visually-hidden" for="service-import-paste">Pasted rows</label>
          <textarea
            id="service-import-paste"
            v-model="source"
            class="paste-box"
            rows="6"
            spellcheck="false"
            placeholder="Select your header row and services in Sheets, copy, then paste here (tab-separated is fine)."
            @input="onPaste"
          ></textarea>
          <GmButton class="primary" :disabled-reason="previewReason" @click="analyze">Check rows</GmButton>
        </section>

        <section class="source-card">
          <h3>Or drop a CSV file</h3>
          <label class="dropzone" :class="{ dragging }" for="service-import-file" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
            <AppIcon name="download" :size="22" />
            <span><strong>Choose a .csv file</strong> or drop it here</span>
            <small>Up to 1,000 services, 2 MB. Excel (.xlsx) files: use File &gt; Download &gt; CSV first.</small>
            <input id="service-import-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" @change="onFileInput" />
          </label>
          <p v-if="loadingFile" class="muted" role="status">Reading the file…</p>
        </section>
      </div>

      <!-- Step 2 -->
      <div v-else-if="step === 2 && parsed" class="step-two">
        <p class="muted file-line">
          <AppIcon name="copy" :size="16" />
          <span>{{ fileName || 'Pasted rows' }} · {{ rows.length }} {{ rows.length === 1 ? 'row' : 'rows' }}</span>
          <button class="ghost small-button" type="button" @click="goTo(1)">Change file</button>
        </p>

        <div v-if="parsed.error" class="notice error" role="alert"><AppIcon name="alert" :size="18" /><span>{{ parsed.error }}</span></div>

        <section v-if="mapperColumns.length" class="mapper" aria-labelledby="mapper-title">
          <h3 id="mapper-title">Match your columns <GmHint text="Bookins recognised some of your headings automatically. Tell it what the others are, or leave them as 'Not used' and they are ignored." label="About matching columns" /></h3>
          <p class="muted">
            <template v-if="unrecognised">{{ unrecognised }} {{ unrecognised === 1 ? 'column was' : 'columns were' }} not recognised and will be ignored unless you match {{ unrecognised === 1 ? 'it' : 'them' }}.</template>
            <template v-else>Your matches are applied. Change them here if a column looks wrong.</template>
          </p>
          <div class="mapper-grid">
            <div v-for="header in mapperColumns" :key="header.name" class="mapper-row">
              <label :for="`map-${header.name}`"><span class="col-name">{{ header.name }}</span> is…</label>
              <select :id="`map-${header.name}`" class="input" :value="mapping[header.name] || ''" @change="setMapping(header.name, $event.target.value)">
                <option value="">Not used (ignore)</option>
                <option v-for="field in FIELD_OPTIONS" :key="field" :value="field" :disabled="fieldTakenBy(field, header.name)">{{ FIELD_LABELS[field] }}</option>
              </select>
            </div>
          </div>
          <p v-if="recognised.length" class="muted small-print">Recognised: {{ recognised.map((header) => `${header.name} → ${FIELD_LABELS[header.field]}`).join(' · ') }}</p>
        </section>

        <template v-if="!parsed.error">
          <div class="counts" role="status">
            <span class="counts-main"><strong>{{ summaryLine }}</strong><button v-if="counts.error" class="ghost small-button" type="button" @click="downloadReport"><AppIcon name="download" :size="16" />Download error report</button></span>
            <div class="filters" role="group" aria-label="Show rows">
              <button v-for="item in filters" :key="item.key" type="button" class="filter-chip" :class="{ 'is-active': filter === item.key }" :aria-pressed="filter === item.key" @click="filter = item.key">
                {{ item.label }} <span class="count-pill">{{ item.count }}</span>
              </button>
            </div>
          </div>

          <div v-if="intervalRows.length" class="notice warning interval-notice" role="status">
            <AppIcon name="clock" :size="18" />
            <div>
              <p><strong>{{ intervalRows.length }} {{ intervalRows.length === 1 ? 'service is' : 'services are' }} longer than your {{ interval }}-minute booking interval.</strong></p>
              <p>Bookins reserves exactly one booking interval for each appointment, so a service cannot be longer than the interval in Availability<template v-if="hasLongHairService"> (this includes long 3 to 8 hour services such as hair installs)</template>. These rows are not imported until the interval is at least {{ longest }} minutes. The next step takes you to Availability with {{ neededInterval }} minutes ({{ durationWords(neededInterval) }}) already chosen.</p>
              <details class="interval-more">
                <summary>What changes if I raise the interval?</summary>
                <p>Raising the interval to {{ neededInterval }} minutes also changes the start times guests see for all services on this schedule: they start only every {{ neededInterval }} minutes instead of every {{ interval }}, short services included. A schedule has one interval. If you also need short services at short intervals, give the long services their own team member, whose calendar has its own interval (Team page, then Availability), or import the long services for that person with the CSV staff column.</p>
              </details>
              <ul class="affected">
                <li v-for="row in intervalRows.slice(0, 8)" :key="row.line">Row {{ row.line }}: {{ displayName(row.values.name) }} ({{ row.values.durationMinutes }} min)</li>
                <li v-if="intervalRows.length > 8">and {{ intervalRows.length - 8 }} more</li>
              </ul>
              <RouterLink class="secondary small-button fix-link" :to="{ path: '/availability', query: { interval: String(longest), from: 'import' } }" @click="leaveForPage">Fix interval in Availability<AppIcon name="chevron" :size="15" /></RouterLink>
              <span class="muted small-print"> Your file is kept for this session. After you save, a button brings you back to the import.</span>
            </div>
          </div>

          <div v-if="missingNames.length && teamPeople.length" class="notice warning" role="status">
            <AppIcon name="alert" :size="18" />
            <span>These names in your staff column are not on your team and are ignored: {{ missingNames.slice(0, 6).join(', ') }}{{ missingNames.length > 6 ? '…' : '' }}. Add them on the <RouterLink to="/team" @click="leaveForPage">Team page</RouterLink> first if you want guests to choose them.</span>
          </div>
          <div v-else-if="rows.some((row) => row.values.staffNames?.length) && !teamPeople.length" class="notice info" role="status">
            <AppIcon name="info" :size="18" /><span>Your file has team names, but you have no team members yet, so that column is ignored.</span>
          </div>
          <div v-if="copyEstimate.adding" class="notice" :class="copyEstimate.overMax ? 'error' : 'info'" role="status">
            <AppIcon name="team" :size="18" />
            <span>{{ planned }} {{ planned === 1 ? 'service gets' : 'services get' }} team copies: {{ copyEstimate.adding }} new {{ copyEstimate.adding === 1 ? 'copy' : 'copies' }}, so your workspace would hold {{ copyEstimate.total }} (up to {{ STAFF_COPY_MAX }} are allowed). Team members with a restricted service list get these services added to it.<template v-if="copyEstimate.overMax"> That is over the limit; remove names from the staff column.</template><template v-else-if="copyEstimate.overCap"> You will be asked to confirm because it is over {{ STAFF_COPY_WARN }}.</template></span>
          </div>

          <p v-if="!importable && !counts.error" class="muted">Everything in this file is already saved as it is. Nothing to import.</p>

          <div v-if="visibleRows.length" class="table-wrap" role="region" aria-label="Rows in your file" tabindex="0">
            <table class="rows-table">
              <thead><tr><th>Row</th><th>Status</th><th>Service</th><th>Time</th><th>Price</th><th>What will happen</th></tr></thead>
              <tbody>
                <tr v-for="row in visibleRows" :key="row.line" :class="`row-${row.status}`">
                  <td data-label="Row" class="tnum">{{ row.line }}</td>
                  <td data-label="Status"><span class="chip" :class="statusChip[row.status]">{{ statusLabel[row.status] }}</span></td>
                  <td data-label="Service" class="svc"><strong>{{ displayName(row.values.name) || '(no name)' }}</strong><small v-if="row.values.category">{{ row.values.category }}</small></td>
                  <td data-label="Time" class="tnum">{{ row.values.durationMinutes ? `${row.values.durationMinutes} min` : '-' }}</td>
                  <td data-label="Price" class="tnum">{{ priceText(row) }}</td>
                  <td data-label="Details" class="why"><span v-for="text in reasons(row)" :key="text" :class="{ 'row-error': row.status === 'error' }">{{ row.status === 'error' ? `Row ${row.line}: ` : '' }}{{ text }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="visibleAll.length > PREVIEW_LIMIT" class="muted small-print">Showing the first {{ PREVIEW_LIMIT }} of {{ visibleAll.length }} rows. The import still covers every row.</p>
          <p v-else-if="!visibleRows.length && rows.length" class="muted">No rows with this status.</p>
        </template>
      </div>

      <!-- Step 3 -->
      <div v-else-if="step === 3" class="step-three">
        <template v-if="running">
          <p class="phase" role="status" aria-live="polite">{{ phase }}…</p>
          <div class="progress" role="progressbar" aria-label="Import progress" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="pct"><span :style="{ width: `${pct}%` }" /></div>
          <p class="muted tnum">{{ progress.done }} of {{ progress.total }} · {{ progress.created }} added, {{ progress.updated }} updated, {{ progress.failed }} failed</p>
          <p class="muted small-print">Keep this window open. You can stop any time: services already saved stay saved, and importing again finishes the rest without duplicates.</p>
        </template>
        <template v-else-if="summary">
          <div class="result" :class="{ bad: summary.fatal || failedCount }">
            <span class="icon-tile" :class="summary.fatal || failedCount ? 'warning' : 'success'"><AppIcon :name="summary.fatal ? 'alert' : 'check'" :size="22" /></span>
            <div>
              <h3 v-if="summary.fatal">The import could not run</h3>
              <h3 v-else-if="summary.cancelled">Stopped: {{ finishedCount }} imported, {{ summary.remaining }} not started</h3>
              <h3 v-else>{{ finishedCount }} imported, {{ failedCount }} failed</h3>
              <p v-if="summary.fatal" class="muted">{{ summary.fatal }}</p>
              <p v-else class="muted">{{ summary.created }} new, {{ summary.updated }} updated<template v-if="summary.skipped">, {{ summary.skipped }} skipped (no changes)</template>.{{ ' ' }}<template v-if="summary.errors">{{ summary.errors }} {{ summary.errors === 1 ? 'row' : 'rows' }} had problems in the file and {{ summary.errors === 1 ? 'was' : 'were' }} not imported.{{ ' ' }}</template><template v-if="summary.failed.length">{{ summary.failed.length }} could not be saved.</template></p>
              <p v-if="summary.copiesCreated || summary.copiesUpdated" class="muted">Team copies: {{ summary.copiesCreated }} created, {{ summary.copiesUpdated }} refreshed.</p>
              <p v-if="summary.cancelled" class="muted">Choose “Check the file again” to see what is left; saved rows show as skipped, so nothing is duplicated.</p>
              <p v-if="!summary.fatal && !failedCount && !summary.cancelled" class="muted">Importing this file again is safe: it will find nothing new to add.</p>
            </div>
          </div>
          <ul v-if="summary.copyIssues.length" class="issues"><li v-for="text in summary.copyIssues" :key="text">{{ text }}</li></ul>
          <div v-if="summary.failed.length" class="table-wrap short" role="region" aria-label="Rows that could not be saved" tabindex="0">
            <table class="rows-table">
              <thead><tr><th>Row</th><th>Reason</th></tr></thead>
              <tbody><tr v-for="item in summary.failed.slice(0, 20)" :key="item.line"><td data-label="Row" class="tnum">{{ item.line }}</td><td data-label="Reason">{{ item.reason }}</td></tr></tbody>
            </table>
          </div>
          <p v-if="summary.failed.length > 20" class="muted small-print">Showing 20 of {{ summary.failed.length }}. The error report lists them all.</p>
        </template>
      </div>

      <div class="modal-footer form-actions import-footer">
        <GmConfirm v-model:open="closePrompt" :title="closeTitle" :message="closeMessage" :confirm-label="running ? 'Stop and close' : 'Discard'" :cancel-label="running ? 'Keep importing' : 'Keep editing'" tone="danger" align="start" @confirm="confirmClose">
          <button v-if="step === 3 && summary" class="secondary" type="button" @click="emit('update:open', false)">Done</button>
          <button v-else class="secondary" type="button" @click="onFooterCancel">{{ running ? 'Stop import' : 'Cancel' }}</button>
        </GmConfirm>

        <span class="footer-spacer" />

        <template v-if="step === 2 && parsed">
          <button class="ghost back-btn" type="button" @click="goTo(1)">Back</button>
          <GmConfirm v-model:open="capPrompt" :title="`Create ${copyEstimate.adding} team copies?`" :message="`This brings your team copies to ${copyEstimate.total}, over ${STAFF_COPY_WARN}. Each copy is a separate service guests can pick, so long lists get crowded. You can remove copies later by editing the service.`" confirm-label="Import and create copies" cancel-label="Go back" @confirm="run">
            <GmButton class="primary" :disabled-reason="importReason" @click="onImportClick">Import {{ importable }} {{ importable === 1 ? 'service' : 'services' }}</GmButton>
          </GmConfirm>
        </template>
        <template v-else-if="step === 3 && summary">
          <button v-if="failedCount" class="secondary" type="button" @click="downloadReport"><AppIcon name="download" :size="17" />Download error report</button>
          <button v-if="summary.cancelled || summary.fatal" class="secondary" type="button" @click="checkAgain">Check the file again</button>
          <button class="primary" type="button" @click="startOver">Import another file</button>
        </template>
      </div>
    </div>
  </GmDialog>
</template>

<style scoped>
.import-body { min-width: 0; }
.import-body h2:focus { outline: none; }
.steps { margin: var(--space-3) 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); list-style: none; font-size: var(--text-sm); color: var(--muted); }
.steps li { display: inline-flex; align-items: center; gap: 6px; }
.steps li.current { color: var(--ink, #101928); font-weight: 700; }
.step-no { width: 22px; height: 22px; display: inline-grid; place-items: center; border-radius: 50%; background: var(--muted-soft, #f1f3f8); font-size: var(--text-xs); font-weight: 700; }
.steps li.current .step-no { background: var(--accent); color: #fff; }
.steps li.done .step-no { background: var(--success-soft, #e6f6ee); color: var(--success, #0a7d4b); }
.import-body > .notice, .step-one > .notice, .step-two > .notice { margin-bottom: var(--space-3); }
.notice p { margin: 0 0 var(--space-2); }
.step-one, .step-two, .step-three { display: grid; gap: var(--space-3); }
.source-card { display: grid; gap: var(--space-2); justify-items: start; padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-sm); }
.source-card h3 { margin: 0; font-size: var(--text-md); display: flex; align-items: center; gap: 6px; }
.source-card .muted { margin: 0; }
.paste-box { width: 100%; font-family: var(--font-mono); font-size: var(--text-sm); min-height: 120px; resize: vertical; }
.dropzone { position: relative; width: 100%; box-sizing: border-box; display: grid; justify-items: center; gap: 4px; padding: var(--space-5, 24px) var(--space-4); border: 2px dashed var(--line-strong, #c9cfdd); border-radius: var(--radius-sm); text-align: center; cursor: pointer; color: var(--ink-soft); }
.dropzone:hover, .dropzone.dragging, .dropzone:focus-within { border-color: var(--accent); background: var(--accent-soft); }
.dropzone small { color: var(--muted); font-size: var(--text-xs); }
.dropzone input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.draft { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.draft > span { flex: 1; min-width: 200px; }
.file-line { margin: 0; display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.mapper { padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--muted-soft, #f6f7fb); }
.mapper h3 { margin: 0 0 4px; font-size: var(--text-md); display: flex; align-items: center; gap: 6px; }
.mapper > p { margin: 0 0 var(--space-2); }
.mapper-grid { display: grid; gap: var(--space-2); grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.mapper-row { display: grid; gap: 4px; min-width: 0; }
.mapper-row label { font-size: var(--text-sm); }
.col-name { font-weight: 700; word-break: break-word; }
.small-print { font-size: var(--text-xs); margin: 0; }
.counts { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-4); }
.counts-main { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.filters { display: flex; flex-wrap: wrap; gap: 6px; }
.filter-chip { min-height: 36px; padding: 0 12px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: var(--radius-pill, 999px); background: var(--surface, #fff); color: var(--ink-soft); font-size: var(--text-sm); font-weight: 650; cursor: pointer; }
.filter-chip.is-active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.interval-notice { display: flex; gap: var(--space-2); align-items: flex-start; }
.interval-notice > div { min-width: 0; }
.interval-more { margin: 0 0 var(--space-2); font-size: var(--text-sm); }
.interval-more summary { min-height: 32px; display: flex; align-items: center; cursor: pointer; font-weight: 650; }
.affected { margin: 0 0 var(--space-2); padding-left: 18px; font-size: var(--text-sm); }
.fix-link { display: inline-flex; align-items: center; gap: 4px; text-decoration: none; }
.table-wrap { max-height: 340px; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.table-wrap.short { max-height: 220px; }
.rows-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.rows-table th { position: sticky; top: 0; z-index: 1; padding: 8px 10px; text-align: left; background: var(--muted-soft, #f1f3f8); color: var(--muted); font-size: var(--text-xs); font-weight: 700; white-space: nowrap; }
.rows-table td { padding: 8px 10px; border-top: 1px solid var(--line); vertical-align: top; }
.rows-table .svc { min-width: 150px; }
.rows-table .svc strong, .rows-table .svc small { display: block; }
.rows-table .svc small { color: var(--muted); }
.rows-table .why { min-width: 220px; }
.rows-table .why > span { display: block; color: var(--muted); }
.rows-table .why > .row-error { color: var(--danger); }
.row-skip td { color: var(--muted); }
.phase { margin: 0; font-weight: 700; }
.progress { height: 12px; border-radius: 999px; background: var(--muted-soft, #eceff6); overflow: hidden; }
.progress > span { display: block; height: 100%; background: var(--accent); transition: width var(--dur-fast) var(--ease); }
.result { display: flex; gap: var(--space-3); align-items: flex-start; }
.result h3 { margin: 0 0 4px; font-size: var(--text-lg); }
.result p { margin: 0 0 4px; }
.issues { margin: 0; padding-left: 18px; font-size: var(--text-sm); color: var(--muted); }
.import-footer { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.footer-spacer { flex: 1; }
:global(.service-import-dialog) { width: min(900px, 100%); }
@media (max-width: 700px) {
  .back-btn { display: none; }
  .import-footer { justify-content: space-between; }
  .import-footer > .footer-spacer { display: none; }
  .rows-table thead { display: none; }
  .rows-table, .rows-table tbody { display: block; }
  .rows-table tr { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; padding: 10px; border-top: 1px solid var(--line); }
  .rows-table td { display: block; padding: 2px 0; border: 0; }
  .rows-table td[data-label='Row'], .rows-table td[data-label='Status'] { display: inline-block; }
  .rows-table .svc, .rows-table .why { grid-column: 1 / -1; min-width: 0; }
  .rows-table td[data-label='Time']::before, .rows-table td[data-label='Price']::before { content: attr(data-label) ': '; color: var(--muted); }
  .rows-table td[data-label='Row']::before { content: 'Row '; color: var(--muted); }
  .table-wrap { max-height: 46vh; }
}
</style>
