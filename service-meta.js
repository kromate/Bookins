// Extra service/booking-page metadata that the hosted engine cannot carry yet.
//
// The hosted `page-get` returns only id, slug, name, description, duration, price, and currency for a
// service (see .audit/bookings-2026-10-07/01-plan.md F6). Until the platform returns real fields, owner-set
// metadata rides in a machine-readable trailer on the LAST line of `description`:
//
//   Gentle, long-lasting braids.\n[[bk:{"c":"Braids","o":12,"s":"staff-id","p":"Arrive with washed hair"}]]
//
// Keys: c category, o sort order, s staff id (a per-staff service copy), n staff display name
// (so the guest page can say "With Amaka" without a staff lookup), b base service id of a per-staff
// copy (so copies group under their base service), p prep notes.
// `splitDescription` strips the trailer for display; `withMeta` writes it back. Both are pure.

const TRAILER = /\n?\[\[bk:(\{.*\})\]\]\s*$/s
const MAX_DESCRIPTION = 2000

const clean = (value, max) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max)

/** { text, meta } where `text` is the owner-visible description with the trailer removed. */
export function splitDescription(description) {
  const raw = String(description ?? '')
  const match = TRAILER.exec(raw)
  if (!match) return { text: raw.trim(), meta: {} }
  let meta = {}
  try {
    const parsed = JSON.parse(match[1])
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = normalizeMeta(parsed)
  } catch {
    meta = {}
  }
  return { text: raw.slice(0, match.index).trim(), meta }
}

export function normalizeMeta(value = {}) {
  const meta = {}
  const category = clean(value.c ?? value.category, 80)
  if (category) meta.c = category
  const order = Number(value.o ?? value.sort_order)
  if (Number.isFinite(order)) meta.o = Math.round(order)
  const staff = clean(value.s ?? value.staff_id, 120)
  if (staff) meta.s = staff
  const staffName = clean(value.n ?? value.staff_name, 80)
  if (staffName) meta.n = staffName
  const prep = clean(value.p ?? value.prep_notes, 400)
  if (prep) meta.p = prep
  const base = clean(value.b ?? value.base_id, 120)
  if (base) meta.b = base
  return meta
}

/** The description with `meta` written as a trailer, kept within the Table's 2000-character limit. */
export function withMeta(text, meta = {}) {
  const normalized = normalizeMeta(meta)
  const trailer = Object.keys(normalized).length ? `\n[[bk:${JSON.stringify(normalized)}]]` : ''
  const body = String(text ?? '').trim().slice(0, Math.max(0, MAX_DESCRIPTION - trailer.length))
  return `${body}${trailer}`.trim()
}

/** Guest-page view of a `page-get` service: display fields plus parsed metadata. */
export function presentService(service) {
  const { text, meta } = splitDescription(service?.description)
  return {
    ...service,
    // A leading apostrophe only guards spreadsheet exports against formulas; never show it to guests.
    name: /^'[=+\-@]/.test(String(service?.name ?? '')) ? String(service.name).slice(1) : service?.name,
    description: text,
    category: meta.c || '',
    sortOrder: Number.isFinite(meta.o) ? meta.o : Number.MAX_SAFE_INTEGER,
    staffId: meta.s || '',
    staffName: meta.n || '',
    baseId: meta.b || '',
    prepNotes: meta.p || '',
  }
}

/** Groups presented services by category (uncategorised last), each group sorted by sortOrder then name. */
export function groupServices(services) {
  const presented = services.map(presentService)
  const groups = new Map()
  for (const service of presented) {
    const key = service.category || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(service)
  }
  const sorter = (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
  return [...groups.entries()]
    .map(([name, items]) => ({ name, items: items.sort(sorter) }))
    .sort((a, b) => (a.name === '' ) - (b.name === '') || a.name.localeCompare(b.name))
}
