// Pure service helpers: record serialization (fields + description trailer), slugs, and CSV
// import/export. No Vue, no window: used by booking.js, the tests, and (read-only) by pages.
import { csvCell, neutralizeFormula, parseCsv, toCsv } from './csv.js'
import { splitDescription, withMeta } from './service-meta.js'

export const MAX_IMPORT_ROWS = 1000

export function slugBase(name) {
  const base = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'service'
}

export function uniqueServiceSlug(name, existing, existingServices = []) {
  const base = slugBase(name)
  const taken = new Set(
    existingServices.filter((item) => item && item.id !== existing?.id).map((item) => item.slug),
  )
  if (existing?.slug && (existing.slug === base || new RegExp(`^${base}-\\d+$`).test(existing.slug)) && !taken.has(existing.slug))
    return existing.slug
  let slug = base
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`
  return slug
}

const finiteOrUndefined = (value) => {
  if (value === '' || value == null || typeof value === 'boolean') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

/**
 * Owner-facing view of a service record: the clean description, and category / order / rebook / prep /
 * staff metadata read from the real fields first, then the description trailer (hosted `page-get`
 * only carries the trailer). Pages should always show `text`, never `description`.
 */
export function serviceDisplayMeta(service) {
  const { text, meta } = splitDescription(service?.description)
  const category = String(service?.category ?? '').trim() || meta.c || ''
  return {
    text,
    category,
    sortOrder: finiteOrUndefined(service?.sort_order) ?? meta.o,
    rebookAfterDays: finiteOrUndefined(service?.rebook_after_days),
    prepNotes: String(service?.prep_notes ?? '').trim() || meta.p || '',
    staffId: meta.s || '',
    staffName: meta.n || '',
    baseId: meta.b || '',
  }
}

/**
 * The record value to write for a service: every field plus the description trailer, kept in sync.
 * `input` uses the form shape { name, description, durationMinutes, scheduleId, price, currency,
 * visibility, active, location, category, sortOrder, rebookAfterDays, prepNotes, slug?, staffId?,
 * staffName?, baseId? }. Anything the input omits keeps the value of `existing`.
 */
export function serializeService(input = {}, existing = null, existingServices = []) {
  const current = existing ? serviceDisplayMeta(existing) : {}
  const has = (key) => input[key] !== undefined
  const category = String(has('category') ? input.category : current.category ?? '').trim().slice(0, 80)
  const sortOrder = has('sortOrder') ? finiteOrUndefined(input.sortOrder) : current.sortOrder
  const rebook = has('rebookAfterDays') ? finiteOrUndefined(input.rebookAfterDays) : current.rebookAfterDays
  const prep = String(has('prepNotes') ? input.prepNotes : current.prepNotes ?? '').trim().slice(0, 400)
  const staffId = has('staffId') ? input.staffId : current.staffId
  const staffName = has('staffName') ? input.staffName : current.staffName
  const baseId = has('baseId') ? input.baseId : current.baseId
  const text = splitDescription(has('description') ? input.description : existing?.description).text
  const value = {
    slug: input.slug ? String(input.slug) : uniqueServiceSlug(input.name, existing, existingServices),
    name: input.name,
    description: withMeta(text, { c: category, o: sortOrder, s: staffId, n: staffName, b: baseId, p: prep }),
    duration_minutes: input.durationMinutes,
    schedule_id: input.scheduleId,
    price: input.price || 0,
    currency: input.currency || 'NGN',
    visibility: input.visibility,
    active: input.active,
    location: String(input.location ?? existing?.location ?? '').trim().slice(0, 300),
    category,
    prep_notes: prep,
    revision: String(Date.now()),
    updated_at: new Date().toISOString(),
  }
  if (sortOrder !== undefined) value.sort_order = Math.round(sortOrder)
  if (rebook !== undefined) value.rebook_after_days = Math.round(rebook)
  return value
}

// ---- CSV import / export ----

export const SERVICE_CSV_COLUMNS = [
  'category',
  'name',
  'description',
  'duration_minutes',
  'price',
  'currency',
  'visibility',
  'location',
  'active',
  'staff',
  'sort_order',
  'rebook_after_days',
  'prep_notes',
]

const HEADER_ALIASES = {
  category: ['category', 'group', 'section', 'service category'],
  name: ['name', 'service', 'service name', 'title', 'treatment', 'service title'],
  description: ['description', 'desc', 'details', 'about', 'service description'],
  duration_minutes: ['duration minutes', 'duration', 'minutes', 'mins', 'length', 'duration min', 'time', 'duration mins', 'service duration'],
  price: ['price', 'cost', 'amount', 'fee', 'rate', 'display price'],
  currency: ['currency', 'ccy'],
  visibility: ['visibility', 'visible', 'public', 'listing'],
  location: ['location', 'address', 'venue', 'where'],
  active: ['active', 'enabled', 'status', 'available'],
  staff: ['staff', 'team', 'provider', 'stylist', 'staff member', 'team member', 'professional', 'staff names'],
  sort_order: ['sort order', 'sort', 'order', 'position', 'display order', 'rank'],
  rebook_after_days: ['rebook after days', 'rebook', 'rebook days', 'rebook after', 'rebook nudge days', 'return after days'],
  prep_notes: ['prep notes', 'prep', 'preparation', 'preparation notes', 'instructions', 'before your visit', 'arrival notes'],
  slug: ['slug', 'id', 'service id', 'handle'],
}
const normalizeHeader = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const ALIAS_LOOKUP = new Map(
  Object.entries(HEADER_ALIASES).flatMap(([field, aliases]) => aliases.map((alias) => [normalizeHeader(alias), field])),
)

const CURRENCY_CODES = ['NGN', 'GHS', 'KES', 'ZAR', 'UGX', 'TZS', 'USD', 'EUR', 'GBP']
const CURRENCY_SYMBOLS = { '₦': 'NGN', '₵': 'GHS', '$': 'USD', '€': 'EUR', '£': 'GBP' }

/** { value, currency } from "N5,000", "₦ 12 500", "NGN 3000", "free". Throws a plain-language Error. */
export function parsePrice(raw) {
  let text = String(raw ?? '').trim()
  if (!text || /^(free|none|n\/a|-|0)$/i.test(text)) return { value: 0, currency: '' }
  let currency = ''
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) {
      currency = code
      text = text.replaceAll(symbol, '')
    }
  }
  const code = CURRENCY_CODES.find((item) => new RegExp(`\\b${item}\\b`, 'i').test(text))
  if (code) {
    currency = code
    text = text.replace(new RegExp(`\\b${code}\\b`, 'ig'), '')
  }
  if (/^\s*N\s*(?=[\d.,])/i.test(text)) {
    currency ||= 'NGN'
    text = text.replace(/^\s*N\s*/i, '')
  }
  text = text.replace(/[,\s]/g, '')
  if (text.startsWith('-')) throw new Error('Price cannot be negative.')
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Price "${String(raw).trim()}" is not a number.`)
  const value = Math.round(Number(text) * 100) / 100
  if (value > 1_000_000_000) throw new Error('Price is too large.')
  return { value, currency }
}

/** Minutes from "60", "90 min", "1h", "1h30", "1.5 hours". Returns NaN when unreadable. */
export function parseDuration(raw) {
  const text = String(raw ?? '').trim().toLowerCase()
  if (!text) return NaN
  let match = /^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)?$/.exec(text)
  if (match) return Number(match[1])
  match = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)(?:\s*(\d+)\s*(?:m|min|mins|minutes)?)?$/.exec(text)
  if (match) return Math.round(Number(match[1]) * 60 + Number(match[2] || 0))
  return NaN
}

const YES = new Set(['yes', 'y', 'true', '1', 'active', 'on'])
const NO = new Set(['no', 'n', 'false', '0', 'inactive', 'off', 'paused'])

function parseWholeNumber(raw, label, { min = 0, max = 100000 } = {}) {
  const text = String(raw ?? '').trim()
  if (!text) return undefined
  const number = Number(text)
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`)
  return number
}

const slugFor = (category, name) => slugBase(`${category} ${name}`).slice(0, 80).replace(/-+$/, '') || 'service'

function sameService(existing, values) {
  const current = serviceDisplayMeta(existing)
  return (
    current.text === values.description &&
    String(existing.name) === values.name &&
    Number(existing.duration_minutes) === values.durationMinutes &&
    Number(existing.price || 0) === values.price &&
    String(existing.currency || 'NGN') === values.currency &&
    String(existing.visibility) === values.visibility &&
    (existing.active !== false) === values.active &&
    String(existing.location || '') === values.location &&
    current.category === values.category &&
    current.sortOrder === values.sortOrder &&
    current.rebookAfterDays === values.rebookAfterDays &&
    current.prepNotes === values.prepNotes
  )
}

/**
 * Parses a services CSV (or spreadsheet paste) into per-row previews. Nothing is written.
 * options: { schedule (record, required), schedules (all, for updates on another schedule), services (existing),
 * defaultCurrency, mapping ({ 'Header text': 'field' } overrides auto-mapping) }.
 * Returns { rows: [{ line, status: 'new'|'update'|'skip'|'error', slug, values, errors[], notes[], existingId, existing }],
 * counts: { new, update, skip, error }, headers: [{ name, field }], unmapped: [name], error? }.
 * `error` is set when the whole file cannot be read (no header, no name column, too many rows).
 */
export function parseServiceCsv(text, { schedule, schedules = [], services = [], defaultCurrency = 'NGN', mapping = {} } = {}) {
  const empty = (error, headers = [], unmapped = []) => ({
    rows: [],
    counts: { new: 0, update: 0, skip: 0, error: 0 },
    headers,
    unmapped,
    error,
  })
  const table = parseCsv(text)
  if (!table.length || table[0].every((cell) => !String(cell).trim())) return empty('The file is empty. Add a header row and your services.')
  const headers = table[0].map((name) => {
    const label = String(name).trim()
    const mapped = mapping[label] || ALIAS_LOOKUP.get(normalizeHeader(label)) || null
    return { name: label, field: mapped }
  })
  // The first column mapped to a field wins; later duplicates are reported as unmapped.
  const seen = new Set()
  for (const header of headers) {
    if (header.field && seen.has(header.field)) header.field = null
    if (header.field) seen.add(header.field)
  }
  const unmapped = headers.filter((header) => !header.field && header.name).map((header) => header.name)
  if (!seen.has('name')) return empty('Could not find a service name column. Add a column called "name".', headers, unmapped)
  if (!seen.has('duration_minutes')) return empty('Could not find a duration column. Add a column called "duration_minutes".', headers, unmapped)
  if (!schedule) return empty('Set your weekly availability first: services need a booking interval to import.', headers, unmapped)
  const dataRows = table.slice(1).filter((cells) => cells.some((cell) => String(cell).trim()))
  if (dataRows.length > MAX_IMPORT_ROWS)
    return empty(`This file has ${dataRows.length} rows. Import up to ${MAX_IMPORT_ROWS} at a time.`, headers, unmapped)

  const existingBySlug = new Map(services.map((service) => [service.slug, service]))
  // Hand-made sheets have no slug column, so a service typed with the same name as an existing one would
  // otherwise get a new category-prefixed slug and become a duplicate. Match base services by name instead.
  const existingByName = new Map()
  for (const service of services) {
    if (splitDescription(service.description).meta.s) continue // per-member copies are not import targets
    const key = String(service.name || '').trim().toLowerCase()
    if (key && !existingByName.has(key)) existingByName.set(key, service)
  }
  const scheduleById = new Map([schedule, ...schedules].filter(Boolean).map((item) => [item.id, item]))
  const seenSlugs = new Map()
  const rows = []
  const counts = { new: 0, update: 0, skip: 0, error: 0 }

  table.slice(1).forEach((cells, index) => {
    if (!cells.some((cell) => String(cell).trim())) return
    const line = index + 2
    const raw = {}
    headers.forEach((header, column) => {
      if (header.field) raw[header.field] = String(cells[column] ?? '').trim()
    })
    const errors = []
    const notes = []
    const attempt = (label, fn, fallback) => {
      try {
        return fn()
      } catch (error) {
        errors.push(error.message)
        return fallback
      }
    }

    const name = neutralizeFormula(raw.name || '')
    if (!name) errors.push('Name is required.')
    else if (name.length > 120) errors.push('Name is longer than 120 characters.')
    const category = neutralizeFormula(raw.category || '')
    if (category.length > 80) errors.push('Category is longer than 80 characters.')
    const description = neutralizeFormula(raw.description || '') || name
    const location = neutralizeFormula(raw.location || '')
    if (location.length > 300) errors.push('Location is longer than 300 characters.')
    const prepNotes = neutralizeFormula(raw.prep_notes || '')
    if (prepNotes.length > 400) errors.push('Prep notes are longer than 400 characters.')

    let slug = (raw.slug ? slugBase(raw.slug) : slugFor(category, name)).slice(0, 80)
    let existing = existingBySlug.get(slug) || null
    if (!existing && !raw.slug) {
      const byName = existingByName.get(name.trim().toLowerCase())
      if (byName) {
        existing = byName
        slug = byName.slug
        notes.push('Matched your existing service with the same name, so this updates it instead of adding a duplicate.')
      }
    }
    const targetSchedule = (existing && scheduleById.get(existing.schedule_id)) || schedule

    const durationMinutes = raw.duration_minutes === '' ? NaN : parseDuration(raw.duration_minutes)
    const interval = Number(targetSchedule.slot_interval_minutes)
    if (raw.duration_minutes === '') errors.push('Duration is required.')
    else if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) errors.push(`Duration "${raw.duration_minutes}" is not a number of minutes.`)
    else if (!Number.isInteger(durationMinutes) || durationMinutes % 5 !== 0) errors.push(`Duration ${durationMinutes} minutes must be a multiple of 5.`)
    else if (Number.isFinite(interval) && interval > 0 && durationMinutes > interval)
      errors.push(
        `Duration ${durationMinutes} min exceeds your ${interval}-minute booking interval. Increase the interval in Availability, or shorten this service.`,
      )

    const priced = attempt('price', () => parsePrice(raw.price), { value: 0, currency: '' })
    const currencyText = String(raw.currency || '').trim().toUpperCase()
    if (currencyText && !/^[A-Z]{3}$/.test(currencyText)) errors.push(`Currency "${raw.currency}" must be a 3-letter code such as NGN.`)
    const currency = /^[A-Z]{3}$/.test(currencyText) ? currencyText : priced.currency || defaultCurrency || 'NGN'

    const visibilityText = String(raw.visibility || '').trim().toLowerCase()
    let visibility = 'public'
    if (['private', 'hidden', 'no', 'false', '0'].includes(visibilityText)) visibility = 'private'
    else if (visibilityText && !['public', 'visible', 'yes', 'true', '1'].includes(visibilityText))
      errors.push(`Visibility "${raw.visibility}" must be public or private.`)

    const activeText = String(raw.active || '').trim().toLowerCase()
    let active = true
    if (activeText && NO.has(activeText)) active = false
    else if (activeText && !YES.has(activeText)) errors.push(`Active "${raw.active}" must be yes or no.`)

    const sortOrder = attempt('sort', () => parseWholeNumber(raw.sort_order, 'Sort order', { min: -100000, max: 100000 }))
    const rebookAfterDays = attempt('rebook', () => parseWholeNumber(raw.rebook_after_days, 'Rebook after days', { min: 1, max: 730 }))
    const staffNames = String(raw.staff || '')
      .split(/[|;]/)
      .map((item) => item.trim())
      .filter(Boolean)

    const values = {
      slug,
      name,
      description,
      durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : undefined,
      scheduleId: targetSchedule.id,
      price: priced.value,
      currency,
      visibility,
      active,
      location,
      category,
      sortOrder,
      rebookAfterDays,
      prepNotes,
      staffNames,
    }

    let status = 'error'
    if (!errors.length) {
      if (seenSlugs.has(slug)) {
        status = 'skip'
        notes.push(`Same service as line ${seenSlugs.get(slug)}; skipped.`)
      } else {
        seenSlugs.set(slug, line)
        if (existing && sameService(existing, values)) {
          status = 'skip'
          notes.push('No changes.')
        } else status = existing ? 'update' : 'new'
      }
    }
    counts[status] += 1
    rows.push({ line, status, slug, values, errors, notes, existingId: existing?.id || '', existing })
  })
  return { rows, counts, headers, unmapped }
}

/** Plain-language reasons per failed row: parse errors plus failed writes, ready for `toCsv`. */
export function importErrorReportCsv(rows = [], failed = []) {
  const lines = [['line', 'name', 'reason']]
  for (const row of rows) if (row.status === 'error') lines.push([row.line, row.values?.name || '', row.errors.join(' ')])
  const byLine = new Map(rows.map((row) => [row.line, row]))
  for (const item of failed) lines.push([item.line, byLine.get(item.line)?.values?.name || '', item.reason])
  return toCsv(lines)
}

/** Services as CSV (round-trips through `parseServiceCsv`). Per-member service copies are left out. */
export function exportServicesCsv(services = [], _schedules = [], { staff = [] } = {}) {
  const rows = [[...SERVICE_CSV_COLUMNS, 'slug']]
  const sorted = [...services]
    .filter((service) => !serviceDisplayMeta(service).staffId)
    .sort((a, b) => {
      const ma = serviceDisplayMeta(a)
      const mb = serviceDisplayMeta(b)
      return ma.category.localeCompare(mb.category) || (ma.sortOrder ?? 1e9) - (mb.sortOrder ?? 1e9) || String(a.name).localeCompare(String(b.name))
    })
  for (const service of sorted) {
    const meta = serviceDisplayMeta(service)
    const names = staff
      .filter((member) => {
        try {
          const ids = JSON.parse(member.service_ids_json || '[]')
          return Array.isArray(ids) && ids.includes(service.id)
        } catch {
          return false
        }
      })
      .map((member) => member.name)
    rows.push([
      meta.category,
      service.name,
      meta.text,
      service.duration_minutes,
      service.price || 0,
      service.currency || 'NGN',
      service.visibility || 'public',
      service.location || '',
      service.active === false ? 'no' : 'yes',
      names.join(' | '),
      meta.sortOrder ?? '',
      meta.rebookAfterDays ?? '',
      meta.prepNotes,
      service.slug,
    ])
  }
  return toCsv(rows)
}

/** Header plus three example rows (the file Zainab-style owners edit in Google Sheets). */
export function serviceCsvTemplate() {
  return toCsv([
    SERVICE_CSV_COLUMNS,
    ['Braids', 'Knotless braids', 'Medium knotless braids, mid-back length.', 240, 45000, 'NGN', 'public', '', 'yes', '', 1, 42, 'Arrive with washed, detangled hair.'],
    ['Braids', 'Braid take-down', 'Careful removal of old braids.', 60, 8000, 'NGN', 'public', '', 'yes', '', 2, '', ''],
    ['Nails', 'Gel manicure', '', 60, 12000, 'NGN', 'public', '', 'yes', '', 1, 21, ''],
  ])
}

export { csvCell }
