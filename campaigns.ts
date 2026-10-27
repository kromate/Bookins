// Campaign segmentation and the assisted-send queue (pure). Bookins never sends a campaign: it builds
// an audience from booking history, composes the text, and the owner opens each message in their own
// WhatsApp / SMS / email app ("opened by you"). No delivery, open-rate, or discount claims anywhere.
import { toCsv } from './csv.ts'
import { localFields } from './scheduling.ts'
import { serviceDisplayMeta } from './services.ts'
import { contactOffers, contactTags, hasRealEmail, isActiveBooking, isOptedOut, isTimeOff } from './records.ts'
import { countryFromTimezone, messageLinks, messageVars, normalizePhone, renderTemplate, DEFAULT_TEMPLATES } from './messaging.ts'
import { staffForBooking } from './team.ts'

export const CAMPAIGN_CAP = 200
export const EMAIL_BATCH_SIZE = 40
const MAX_MAILTO_LENGTH = 1900
const DAY = 86_400_000
const CHANNELS = ['any', 'whatsapp', 'sms', 'email'] as const
export type CampaignChannel = typeof CHANNELS[number]
export interface CampaignFilters {
  lastVisitBeforeDays?: number
  lastVisitWithinDays?: number
  visitsAtLeast?: number
  noVisitSinceDays?: number
  noShowsAtLeast?: number
  spendAtLeast?: number
  serviceContains?: string
  categoryContains?: string
  staffId?: string
  tag?: string
  neverRebooked?: boolean
  newThisMonth?: boolean
  dueToRebook?: boolean
  source?: 'guest' | 'owner'
  channel?: Exclude<CampaignChannel, 'any'>
}
export interface NormalizedCampaign {
  id: string
  name: string
  filters: CampaignFilters
  template: { channel: Exclude<CampaignChannel, 'any'>; subject: string; body: string }
  offerText: string
  offerCode: string
  createdAt: TimestampInput
  record: CampaignRecord | null
}
interface CampaignItem {
  booking: BookingRecord
  start: number
  end: number
  status: string
  serviceName: string
  category: string
  price: number
  rebookDays: number
  visit: boolean
  staffId?: string
  source: 'guest' | 'owner'
  createdAt: number
}
export interface CampaignContact {
  email: string
  name: string
  phone: string
  tags: string[]
  notes: unknown
  record: ContactRecord | null
  marketing_opt_out: boolean
  last_campaign_at: string
  offers: OfferRecord[]
}
export interface CampaignStats {
  bookings: number
  visits: number
  noShows: number
  spend: number
  firstAt: string
  lastAt: string
  nextAt: string
  latestAt: string
  lastService: string
  services: string[]
  categories: string[]
  staffIds: Array<string | undefined>
  source: string
  reachable: { whatsapp: boolean; sms: boolean; email: boolean }
}
interface CampaignEntry { contact: CampaignContact; stats: CampaignStats; items: CampaignItem[] }
export interface SegmentContact { contact: CampaignContact; stats: CampaignStats }
export interface CampaignRecipient extends SegmentContact {
  subject: string
  text: string
  links: { whatsapp: string; sms: string; email: string }
  link: string
  openedAt: string
  redeemed: boolean
  offerCode: string
}

export const SEGMENT_PRESETS = Object.freeze([
  { id: 'due-rebook', name: 'Due to rebook', description: 'Last visit was longer ago than the service\'s "rebook after" days.', filters: { dueToRebook: true } },
  { id: 'vips', name: 'VIPs (3+ visits)', description: 'Clients with three or more visits.', filters: { visitsAtLeast: 3 } },
  { id: 'lapsed-90', name: 'Lapsed 90 days', description: 'Visited before, but nothing booked or attended in 90 days.', filters: { visitsAtLeast: 1, noVisitSinceDays: 90 } },
  { id: 'braids-upsell', name: 'Braids clients (upsell)', description: 'Clients who had a braids service in the last 60 days.', filters: { serviceContains: 'braids', lastVisitWithinDays: 60 } },
  { id: 'new-this-month', name: 'New this month', description: 'Clients whose first booking was this month (thank-you).', filters: { newThisMonth: true } },
])

const numberKeys = ['lastVisitBeforeDays', 'lastVisitWithinDays', 'visitsAtLeast', 'noVisitSinceDays', 'noShowsAtLeast', 'spendAtLeast'] as const
const textKeys = ['serviceContains', 'categoryContains', 'staffId', 'tag'] as const
const flagKeys = ['neverRebooked', 'newThisMonth', 'dueToRebook'] as const

/** Keeps only valid filters: trimmed text, non-negative numbers, `true` flags, a known channel. */
export function normalizeFilters(filters: unknown): CampaignFilters {
  let source: unknown = filters
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source)
    } catch {
      source = {}
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {}
  const record = source as UnknownRecord
  const out: CampaignFilters = {}
  for (const key of textKeys) {
    const value = String(record[key] ?? '').trim()
    if (value) out[key] = value.slice(0, 120)
  }
  for (const key of numberKeys) {
    const raw = record[key]
    if (raw === '' || raw == null || typeof raw === 'boolean') continue
    const value = Number(raw)
    if (Number.isFinite(value) && value >= 0) out[key] = value
  }
  for (const key of flagKeys) if (record[key] === true || record[key] === 'true') out[key] = true
  if (record.source === 'guest' || record.source === 'owner') out.source = record.source
  if (record.channel === 'whatsapp' || record.channel === 'sms' || record.channel === 'email') out.channel = record.channel
  return out
}

const parseJson = (text: unknown): UnknownRecord => {
  try {
    const value: unknown = JSON.parse(typeof text === 'string' ? text : '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
  } catch {
    return {}
  }
}

/** One shape for a saved campaign record or an unsaved draft. */
export function normalizeCampaign(campaign: UnknownRecord | CampaignRecord = {}): NormalizedCampaign {
  const source = campaign as UnknownRecord
  const templateCandidate = source.template || parseJson(source.template_json)
  const template = templateCandidate && typeof templateCandidate === 'object' && !Array.isArray(templateCandidate) ? templateCandidate as UnknownRecord : {}
  return {
    id: String(source.id || ''),
    name: String(source.name || ''),
    filters: normalizeFilters(source.segment ?? source.segment_json),
    template: {
      channel: template.channel === 'sms' || template.channel === 'email' ? template.channel : 'whatsapp',
      subject: typeof template.subject === 'string' && template.subject.trim() ? template.subject : DEFAULT_TEMPLATES.campaign.subject,
      body: typeof template.body === 'string' && template.body.trim() ? template.body : DEFAULT_TEMPLATES.campaign.body,
    },
    offerText: String(source.offerText ?? source.offer_text ?? '').trim(),
    offerCode: String(source.offerCode ?? source.offer_code ?? '').trim(),
    createdAt: source.created_at as TimestampInput,
    record: source.id ? campaign as CampaignRecord : null,
  }
}

const asMs = (value: TimestampInput) => {
  if (value instanceof Date) return value.getTime()
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().getTime()
  if (value && typeof value === 'object' && '_seconds' in value) return Number(value._seconds) * 1000 + Number(value._nanoseconds ?? 0) / 1_000_000
  return typeof value === 'string' ? Date.parse(value) : Number(value)
}
const lower = (value: unknown) => String(value ?? '').toLowerCase()

/** Per-contact entries (contact + stats + the booking items they were derived from). */
function buildEntries(state: WorkspaceState, nowMs: number, timezone: string): CampaignEntry[] {
  const services = new Map<string, ServiceRecord>((state?.services || []).flatMap((service) => service.id ? [[service.id, service]] : []))
  interface RawEntry { email: string; items: CampaignItem[]; latestBooking: BookingRecord | null; record: ContactRecord | null }
  const entries = new Map<string, RawEntry>()
  const bookings = (state?.bookings || [])
    .filter((booking) => !isTimeOff(booking))
    .sort((a, b) => asMs(a.starts_at) - asMs(b.starts_at))
  const blank = (email: string): RawEntry => ({ email, items: [], latestBooking: null, record: null })
  for (const booking of bookings) {
    const email = lower(booking.guest_email).trim()
    if (!email) continue
    const entry = entries.get(email) || blank(email)
    entries.set(email, entry)
    entry.latestBooking = booking
    if (!isActiveBooking(booking)) continue
    const start = asMs(booking.starts_at)
    if (!Number.isFinite(start)) continue
    const service = services.get(String(booking.service_id ?? ''))
    const meta = service ? serviceDisplayMeta(service) : { category: '' }
    const end = asMs(booking.ends_at) || start
    entry.items.push({
      booking,
      start,
      end,
      status: booking.status || '',
      serviceName: booking.service_name || service?.name || '',
      category: meta.category,
      price: Number(service?.price) || 0,
      rebookDays: Number(service?.rebook_after_days) || 0,
      visit: booking.status === 'completed' || (booking.status === 'confirmed' && end <= nowMs),
      staffId: staffForBooking(state, booking).id,
      source: booking.source === 'owner' ? 'owner' : 'guest',
      createdAt: asMs(booking.created_at),
    })
  }
  for (const record of state?.contacts || []) {
    const email = lower(record.email).trim()
    if (!email || email.startsWith('time-off@')) continue
    const entry = entries.get(email) || blank(email)
    entry.record = record
    entries.set(email, entry)
  }
  const country = countryFromTimezone(timezone || state?.profile?.timezone)
  return [...entries.values()].map((entry) => {
    const { items, record, latestBooking } = entry
    const past = items.filter((item) => item.start <= nowMs)
    const latest = items.at(-1)
    const lastPast = past.at(-1)
    const visits = items.filter((item) => item.visit)
    const phone = String(latestBooking?.guest_phone || record?.phone || '').trim()
    const email = entry.email
    const contact = {
      email,
      name: String(latestBooking?.guest_name || record?.name || email).trim(),
      phone,
      tags: contactTags(record),
      notes: record?.notes || '',
      record,
      marketing_opt_out: isOptedOut(record),
      last_campaign_at: record?.last_campaign_at || '',
      offers: contactOffers(record),
    }
    const iso = (ms: number | undefined) => (Number.isFinite(ms) ? new Date(ms ?? 0).toISOString() : '')
    const stats = {
      bookings: items.length,
      visits: visits.length,
      noShows: items.filter((item) => item.status === 'no_show').length,
      spend: visits.reduce((sum, item) => sum + item.price, 0),
      firstAt: iso(items[0]?.start),
      lastAt: iso(lastPast?.start),
      nextAt: iso(items.find((item) => item.start > nowMs)?.start),
      latestAt: iso(latest?.start),
      lastService: (lastPast || latest)?.serviceName || '',
      services: [...new Set(items.map((item) => item.serviceName).filter(Boolean))],
      categories: [...new Set(items.map((item) => item.category).filter(Boolean))],
      staffIds: [...new Set(items.map((item) => item.staffId))],
      source: items[0]?.source || '',
      reachable: {
        whatsapp: Boolean(normalizePhone(phone, country)),
        sms: Boolean(normalizePhone(phone, country)),
        email: hasRealEmail(email),
      },
    }
    return { contact, stats, items }
  })
}

const reachableOn = (stats: CampaignStats, channel: CampaignChannel) =>
  channel === 'email' ? stats.reachable.email : channel === 'whatsapp' || channel === 'sms' ? stats.reachable.whatsapp : stats.reachable.whatsapp || stats.reachable.email

function matches(entry: CampaignEntry, filters: CampaignFilters, nowMs: number, timezone: string) {
  const { contact, stats, items } = entry
  const scoped = Boolean(filters.serviceContains || filters.categoryContains)
  const pool = scoped
    ? items.filter(
        (item) =>
          (!filters.serviceContains ||
            lower(item.serviceName).includes(lower(filters.serviceContains)) ||
            lower(item.category).includes(lower(filters.serviceContains))) &&
          (!filters.categoryContains || lower(item.category).includes(lower(filters.categoryContains))),
      )
    : items
  if (scoped && !pool.length) return false
  const latest = pool.at(-1)
  const pastPool = pool.filter((item) => item.start <= nowMs)
  if (filters.lastVisitBeforeDays != null && !(latest && latest.start < nowMs - filters.lastVisitBeforeDays * DAY)) return false
  if (filters.lastVisitWithinDays != null && !(pastPool.length && (pastPool.at(-1)?.start ?? 0) >= nowMs - filters.lastVisitWithinDays * DAY)) return false
  if (filters.visitsAtLeast != null && pool.filter((item) => item.visit).length < filters.visitsAtLeast) return false
  if (filters.noVisitSinceDays != null && !(items.length && (items.at(-1)?.start ?? Number.POSITIVE_INFINITY) < nowMs - filters.noVisitSinceDays * DAY)) return false
  if (filters.noShowsAtLeast != null && pool.filter((item) => item.status === 'no_show').length < filters.noShowsAtLeast) return false
  if (filters.staffId && !pool.some((item) => item.staffId === filters.staffId)) return false
  if (filters.tag && !contact.tags.some((tag) => lower(tag) === lower(filters.tag))) return false
  if (filters.source && items[0]?.source !== filters.source) return false
  if (filters.neverRebooked && items.length !== 1) return false
  if (filters.newThisMonth) {
    const first = items[0]
    if (!first) return false
    const at = Number.isFinite(first.createdAt) ? first.createdAt : first.start
    if (localFields(at, timezone).date.slice(0, 7) !== localFields(nowMs, timezone).date.slice(0, 7)) return false
  }
  if (filters.spendAtLeast != null && stats.spend < filters.spendAtLeast) return false
  if (filters.dueToRebook) {
    const last = items.at(-1)
    if (!(last && last.visit && last.rebookDays > 0 && (nowMs - last.end) / DAY >= last.rebookDays)) return false
  }
  return true
}

/**
 * Contacts matching `filters`, built from non-cancelled, non-time-off booking history (a contact's "visits" are
 * completed bookings and confirmed bookings that have ended; spend is the sum of those services' display prices).
 * Always excludes opted-out contacts (listed in `optedOut`). `filters.channel` ('whatsapp' | 'sms' | 'email')
 * keeps only clients reachable that way: email needs a real address (placeholder `@bookins.invalid` never
 * counts), WhatsApp and SMS need a dialable phone. Without a channel a client needs either.
 * Filters: serviceContains, categoryContains, lastVisitBeforeDays, lastVisitWithinDays, visitsAtLeast,
 * noVisitSinceDays, noShowsAtLeast, staffId, tag, source, neverRebooked, newThisMonth, spendAtLeast, dueToRebook.
 * Options: { now, timezone }. Returns { contacts: [{ contact, stats }], total, optedOut: [{ contact, stats }], unreachable }.
 */
export function segmentContacts(state: WorkspaceState, filters: unknown = {}, { now = Date.now(), timezone }: { now?: TimestampInput; timezone?: string } = {}) {
  const nowMs = asMs(now)
  const zone = timezone || state?.profile?.timezone || 'UTC'
  const clean = normalizeFilters(filters)
  const channel = clean.channel || 'any'
  const contacts: SegmentContact[] = []
  const optedOut: SegmentContact[] = []
  let unreachable = 0
  for (const entry of buildEntries(state, nowMs, zone)) {
    if (!matches(entry, clean, nowMs, zone)) continue
    const item = { contact: entry.contact, stats: entry.stats }
    if (entry.contact.marketing_opt_out) optedOut.push(item)
    else if (!reachableOn(entry.stats, channel)) unreachable += 1
    else contacts.push(item)
  }
  const byName = (a: SegmentContact, b: SegmentContact) => a.contact.name.localeCompare(b.contact.name) || a.contact.email.localeCompare(b.contact.email)
  contacts.sort(byName)
  optedOut.sort(byName)
  return { contacts, total: contacts.length, optedOut, unreachable }
}

const OPT_OUT_FOOTER = 'Reply STOP to opt out.'
const withFooter = (text: string) => (/\bSTOP\b/i.test(text) ? text : `${text}\n\n${OPT_OUT_FOOTER}`.trim())

function composeCampaign(campaign: NormalizedCampaign, state: WorkspaceState, contact: Pick<CampaignContact, 'name'>, stats: CampaignStats | null, _nowMs: number, { generic = false }: { generic?: boolean } = {}) {
  const profile = state?.profile
  const vars = messageVars(
    { guest_name: generic ? 'there' : contact.name },
    {
      profile,
      timezone: profile?.timezone,
      lastService: stats?.lastService || '',
      offer: { text: campaign.offerText, code: campaign.offerCode, expires: '' },
    },
  )
  if (generic) vars.first_name = 'there'
  return {
    subject: renderTemplate(campaign.template.subject, vars),
    text: withFooter(renderTemplate(campaign.template.body, vars)),
  }
}

/**
 * The assisted-send queue for one channel: up to 200 recipients (the rest stay in `all`, counted in `total`),
 * each with composed text and the single link to open in the owner's own app. `campaign` is a saved record or a
 * draft { segment, template: { subject, body, channel }, offerText, offerCode }. `recipients.broadcast` is the
 * name-free { subject, text } used for email BCC batches. A reply-STOP footer is always present.
 * Returns { recipients, all, total, capped, channel, optedOut, unreachable }.
 */
export function campaignQueue(state: WorkspaceState, campaign: UnknownRecord | CampaignRecord, channel: CampaignChannel = 'whatsapp', { now = Date.now(), timezone }: { now?: TimestampInput; timezone?: string } = {}) {
  const normalized = normalizeCampaign(campaign)
  const nowMs = asMs(now)
  const zone = timezone || state?.profile?.timezone || 'UTC'
  const segment = segmentContacts(state, { ...normalized.filters, channel }, { now: nowMs, timezone: zone })
  const country = countryFromTimezone(state?.profile?.timezone)
  const resolvedChannel = channel === 'any' ? normalized.template.channel : channel
  const all: CampaignRecipient[] = segment.contacts.map(({ contact, stats }) => {
    const { subject, text } = composeCampaign(normalized, state, contact, stats, nowMs)
    const links = messageLinks({ phone: contact.phone, email: contact.email, subject, text, country })
    const code = normalized.offerCode
    const offer = code ? contact.offers.find((item) => item.code === code) : null
    const sinceCampaign = normalized.createdAt && contact.last_campaign_at && Date.parse(contact.last_campaign_at) >= asMs(normalized.createdAt)
    return {
      contact,
      stats,
      subject,
      text,
      links,
      link: links[resolvedChannel] || '',
      openedAt: offer?.at || (sinceCampaign ? contact.last_campaign_at : ''),
      redeemed: offer?.status === 'redeemed',
      offerCode: code,
    }
  })
  const recipients = all.slice(0, CAMPAIGN_CAP) as CampaignRecipient[] & { broadcast: { subject: string; text: string } }
  Object.defineProperty(recipients, 'broadcast', {
    value: composeCampaign(normalized, state, { name: '' }, null, nowMs, { generic: true }),
    enumerable: false,
  })
  return {
    recipients,
    all,
    total: all.length,
    capped: all.length > CAMPAIGN_CAP,
    channel,
    optedOut: segment.optedOut.length,
    unreachable: segment.unreachable,
  }
}

/**
 * Splits email recipients into BCC batches for the owner's own mail app. Each batch holds at most `size`
 * (default 40) addresses and a mailto URL short enough for mail clients (~1900 characters), so very long
 * messages produce more, smaller batches. Opted-out contacts and placeholder addresses are never included.
 * `message` defaults to `recipients.broadcast`. Returns [{ index, total, count, emails, url, label, error? }].
 */
export function emailBatches(recipients: CampaignRecipient[] & { broadcast?: { subject: string; text: string } }, size = EMAIL_BATCH_SIZE, message?: { subject?: string; text?: string; body?: string }) {
  const content = message || recipients?.broadcast || recipients?.[0] || { subject: '', text: '' }
  const emails: string[] = []
  for (const recipient of recipients || []) {
    if (recipient.contact?.marketing_opt_out) continue
    const email = lower(recipient.contact?.email).trim()
    if (hasRealEmail(email) && !emails.includes(email)) emails.push(email)
  }
  const body = content.text || ('body' in content ? content.body : '') || ''
  const tail = `&subject=${encodeURIComponent(content.subject || '')}&body=${encodeURIComponent(body)}`
  const urlFor = (list: string[]) => `mailto:?bcc=${list.map(encodeURIComponent).join(',')}${tail}`
  const limit = Math.max(1, Math.min(EMAIL_BATCH_SIZE, Math.floor(Number(size)) || EMAIL_BATCH_SIZE))
  const groups: string[][] = []
  let current: string[] = []
  for (const email of emails) {
    if (current.length && (current.length >= limit || urlFor([...current, email]).length > MAX_MAILTO_LENGTH)) {
      groups.push(current)
      current = []
    }
    current.push(email)
  }
  if (current.length) groups.push(current)
  return groups.map((list, index) => {
    const url = urlFor(list)
    const tooLong = url.length > MAX_MAILTO_LENGTH
    return {
      index: index + 1,
      total: groups.length,
      count: list.length,
      emails: list,
      label: `Batch ${index + 1} of ${groups.length}`,
      url: tooLong ? '' : url,
      ...(tooLong ? { error: 'This message is too long for an email link. Shorten it, or use Export CSV.' } : {}),
    }
  })
}

/** CSV of recipients for Mailchimp or Google Contacts. Opted-out contacts and placeholder emails are never written. */
export function exportCampaignCsv(recipients: CampaignRecipient[] = []) {
  const rows: unknown[][] = [['name', 'first_name', 'email', 'phone', 'last_service', 'last_visit', 'visits', 'offer_code', 'message']]
  for (const recipient of recipients) {
    if (recipient.contact?.marketing_opt_out) continue
    const { contact, stats } = recipient
    rows.push([
      contact.name,
      String(contact.name || '').split(/\s+/)[0] || '',
      hasRealEmail(contact.email) ? contact.email : '',
      contact.phone,
      stats?.lastService || '',
      stats?.lastAt ? stats.lastAt.slice(0, 10) : '',
      stats?.visits ?? 0,
      recipient.offerCode || '',
      recipient.text || '',
    ])
  }
  return toCsv(rows)
}
