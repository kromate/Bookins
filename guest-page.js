// Pure helpers for the public /book page (no Vue, no network) so they can be unit-tested in node.

import { BOOKING_LAYOUTS, BOOKING_THEMES } from './booking-appearance.js'

// ---- host bio: hidden WhatsApp contact marker ----
// The page-get profile has no phone field, so an owner may put `[[wa:+234...]]` in the bio. It is parsed here,
// never displayed, and only honoured when it is an international number (leading +, 8-15 digits).
const WA_MARKER = /\[\[wa:([^\]]{0,40})\]\]/gi

export function parseBio(bio) {
  let whatsapp = ''
  let stripped = false
  let text = String(bio ?? '')
    .replace(WA_MARKER, (_, value) => {
      stripped = true
      const candidate = value.trim()
      if (!whatsapp && /^\+[\d\s().-]+$/.test(candidate)) {
        const digits = candidate.replace(/\D/g, '')
        if (digits.length >= 8 && digits.length <= 15 && digits[0] !== '0') whatsapp = digits
      }
      return ''
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  // "WhatsApp us: [[wa:...]]" must not leave "WhatsApp us:" dangling once the marker is gone.
  if (stripped) text = text.replace(/(^|\n|[.!?]\s+)[^\n.!?]*:$/, '$1').trim()
  return { text, whatsapp }
}

// ---- URL parameters ----
export const LAYOUTS = BOOKING_LAYOUTS.map(item => item.value)
// Keep the legacy values in the URL contract. Book.vue normalizes them to indigo/midnight.
export const THEMES = [...BOOKING_THEMES.map(item => item.id), 'light', 'dark']

const control = /[\u0000-\u001f\u007f]/g

/** Prefill and display options from `?name=&email=&phone=&layout=&theme=&service=`; every value is sanitised. */
export function readPageParams(search = '') {
  const params = new URLSearchParams(String(search).replace(/^\?/, ''))
  const text = (key, max) => (params.get(key) ?? '').replace(control, ' ').trim().slice(0, max)
  const phone = text('phone', 40)
  const layout = text('layout', 10).toLowerCase()
  const theme = text('theme', 10).toLowerCase()
  return {
    name: text('name', 160),
    email: text('email', 254),
    phone: /^[+()\-.\s\d]{6,40}$/.test(phone) ? phone : '',
    layout: LAYOUTS.includes(layout) ? layout : '',
    theme: THEMES.includes(theme) ? theme : '',
    service: text('service', 120),
  }
}

export const slugify = value =>
  String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// ---- services ----
export const normalizeSearch = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Collapses one service and its per-member copies into ONE row (see service-meta.js presentService).
 *
 * Grouping: a copy has `staffId` and `baseId` (the owner's service id); the owner's own service is the base
 * (its `id` is the copies' `baseId`). Legacy copies without `baseId` group by name and attach to a same-name
 * service that has no staff.
 *
 * Choice rule: `options` is the base (the host, `owner: true`, first) plus each copy, copies sorted by staff
 * name. A copy that only shadows the base (no staff name, or the host's own name) is dropped. `team` is true
 * only when 2+ options remain, so a base and one differently named member offer "With <host>" / "With Tolu",
 * while a base with one shadow copy, or one lone member, is a single row with no choice.
 * `copies` always lists every presented item in the group (for slug/id lookups and search).
 * Prep notes and description are shared: the first non-empty value, base first.
 */
export function teamRows(items, { hostName = '' } = {}) {
  const nameKey = item => normalizeSearch(item.name).trim()
  const host = normalizeSearch(hostName).trim()
  const rows = []
  const byBase = new Map()
  const ownerByName = new Map()
  for (const item of items) {
    if (!item.staffId && !ownerByName.has(nameKey(item))) ownerByName.set(nameKey(item), item.id)
  }
  const rowFor = key => {
    let row = byBase.get(key)
    if (!row) {
      row = { items: [] }
      rows.push(row)
      byBase.set(key, row)
    }
    return row
  }
  for (const item of items) {
    let key
    if (!item.staffId) key = item.id
    else if (item.baseId) key = item.baseId
    else key = ownerByName.get(nameKey(item)) || `name:${nameKey(item)}`
    rowFor(key).items.push(item)
  }
  return rows.map(row => {
    const base = row.items.find(item => !item.staffId) || null
    const members = row.items.filter(item => item.staffId)
    const seen = new Set()
    const kept = members
      .filter(item => !seen.has(item.staffId) && seen.add(item.staffId))
      .filter(item => !base || (item.staffName && normalizeSearch(item.staffName).trim() !== host))
      .sort((a, b) => (a.staffName || '~').localeCompare(b.staffName || '~'))
    const options = [...(base ? [{ copy: base, owner: true }] : []), ...kept.map(copy => ({ copy, owner: false }))]
    const team = options.length > 1
    const shown = team ? options : [options[0]]
    const first = shown[0].copy
    const prices = shown.map(option => Number(option.copy.price) || 0)
    const listed = [...(base ? [base] : []), ...kept]
    const ordered = [...listed, ...row.items.filter(item => !listed.includes(item))]
    const pick = key => ordered.map(item => item[key]).find(Boolean) || ''
    return {
      ...first,
      key: team ? `team:${base ? base.id : first.baseId || nameKey(first)}` : first.id,
      team,
      options: shown,
      copies: ordered,
      description: pick('description'),
      prepNotes: pick('prepNotes'),
      durationMinutes: Math.min(...shown.map(option => Number(option.copy.durationMinutes) || 0)),
      price: Math.min(...prices),
      priceVaries: new Set(prices).size > 1,
    }
  })
}

/** Rows (and groups) whose name, category, description or staff match every word of the query. */
export function filterGroups(groups, query) {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean)
  if (!words.length) return groups
  return groups
    .map(group => ({
      ...group,
      rows: group.rows.filter(row => {
        const haystack = normalizeSearch(
          [row.name, row.category, row.description, ...row.copies.map(copy => copy.staffName)].join(' '),
        )
        return words.every(word => haystack.includes(word))
      }),
    }))
    .filter(group => group.rows.length)
}
