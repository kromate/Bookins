// Prefilled guest messages that open in the owner's own WhatsApp, SMS, or email app.
// Bookins never sends these itself and never claims delivery: the owner "opens" each one.
// Pure module: no window access at import.
import { contactOffers, isActiveBooking, isOptedOut, isTimeOff } from './records.js'
import { hasTeam, isOwnerMember, ownerStaff, staffForBooking } from './team.js'
import { splitDescription } from './service-meta.js'

/** The six slots of the message journey, in the order a client experiences them. */
export const JOURNEY_SLOTS = ['confirmation', 'reminder24', 'reminder2', 'prep', 'thanks', 'rebook']
export const TEMPLATE_KINDS = [...JOURNEY_SLOTS, 'reschedule', 'cancellation', 'campaign']
/** v0.5 names still accepted everywhere a kind is passed. */
export const LEGACY_KIND_ALIASES = Object.freeze({ reminder: 'reminder24', followup: 'thanks' })
export const CHANNELS = ['whatsapp', 'sms', 'email']
export const SLOT_LABELS = Object.freeze({
  confirmation: 'Confirmation',
  reminder24: 'Reminder, 24 hours before',
  reminder2: 'Reminder, 2 hours before',
  prep: 'Preparation and arrival info',
  thanks: 'Thank-you after the visit',
  rebook: 'Rebook nudge',
  reschedule: 'Booking moved',
  cancellation: 'Booking cancelled',
  campaign: 'Campaign',
})

export const canonicalKind = (kind) => LEGACY_KIND_ALIASES[kind] || kind

export const TEMPLATE_VARIABLES = [
  'guest_name',
  'first_name',
  'service',
  'date',
  'time',
  'timezone',
  'duration',
  'business',
  'location',
  'reference',
  'booking_link',
  'staff',
  'prep_notes',
  'rebook_link',
  'business_phone',
  'last_service',
  'offer',
  'offer_code',
  'offer_expires',
]

const defaults = {
  confirmation: {
    subject: 'Your {{service}} is confirmed',
    body:
      'Hi {{first_name}}, your {{service}} with {{business}} is confirmed for {{date}} at {{time}} ({{timezone}}).\n' +
      'Location: {{location}}\nReference: {{reference}}\n\nReply here if you need to change anything.',
  },
  reminder24: {
    subject: 'Reminder: {{service}} on {{date}}',
    body:
      'Hi {{first_name}}, a friendly reminder of your {{service}} with {{business}} on {{date}} at {{time}} ({{timezone}}).\n' +
      'Location: {{location}}\n\nPlease reply if you can no longer make it.',
  },
  reminder2: {
    subject: 'See you soon: {{service}} at {{time}}',
    body:
      'Hi {{first_name}}, see you in about 2 hours for your {{service}} at {{time}}.\n' +
      'Location: {{location}}\n\nRunning late? Reply here and let us know.',
  },
  prep: {
    subject: 'Before your {{service}} on {{date}}',
    body:
      'Hi {{first_name}}, a few notes before your {{service}} with {{business}} on {{date}} at {{time}}:\n' +
      '{{prep_notes}}\n\nSee you soon!',
  },
  thanks: {
    subject: 'Thank you for visiting {{business}}',
    body:
      'Hi {{first_name}}, thank you for your {{service}} with {{business}}. ' +
      'Whenever you are ready for your next visit, you can book here: {{booking_link}}',
  },
  rebook: {
    subject: 'Time for your next {{last_service}}?',
    body:
      'Hi {{first_name}}, it has been a while since your {{last_service}} with {{business}}. ' +
      'Ready for your next visit? Book here: {{rebook_link}}',
  },
  reschedule: {
    subject: 'Your {{service}} has moved',
    body:
      'Hi {{first_name}}, your {{service}} with {{business}} is now on {{date}} at {{time}} ({{timezone}}).\n' +
      'Reference: {{reference}}\n\nReply here if the new time does not work for you.',
  },
  cancellation: {
    subject: 'Your {{service}} on {{date}} is cancelled',
    body:
      'Hi {{first_name}}, your {{service}} with {{business}} on {{date}} at {{time}} has been cancelled.\n' +
      'You can book a new time here: {{booking_link}}',
  },
  campaign: {
    subject: '{{business}}: {{offer}}',
    body:
      'Hi {{first_name}}, {{business}} here. {{offer}}\n' +
      'Offer code: {{offer_code}}\nValid until: {{offer_expires}}\n' +
      'Book here: {{booking_link}}\n\nReply STOP to opt out.',
  },
}

/** Aliases (`reminder`, `followup`) are readable but not enumerable, so loops see each slot once. */
function withAliases(target) {
  for (const [alias, kind] of Object.entries(LEGACY_KIND_ALIASES))
    Object.defineProperty(target, alias, { value: target[kind], enumerable: false })
  return target
}

export const DEFAULT_TEMPLATES = Object.freeze(withAliases(defaults))

const DEFAULT_CHANNEL = 'whatsapp'
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const validChannel = (value) => (CHANNELS.includes(value) ? value : DEFAULT_CHANNEL)
const nonBlank = (value) => typeof value === 'string' && value.trim()

function parseSaved(profile) {
  let parsed = {}
  try {
    const value = JSON.parse(profile?.message_templates_json || '{}')
    if (isRecord(value)) parsed = value
  } catch {
    parsed = {}
  }
  if (parsed.v === 2 || isRecord(parsed.slots)) {
    return { slots: isRecord(parsed.slots) ? parsed.slots : {}, overrides: isRecord(parsed.serviceOverrides) ? parsed.serviceOverrides : {} }
  }
  // v1: { confirmation, reminder, reschedule, cancellation, followup } with subject and body only.
  const slots = {}
  for (const [key, value] of Object.entries(parsed)) {
    const kind = canonicalKind(key)
    if (isRecord(value) && !(kind !== key && isRecord(parsed[kind]))) slots[kind] = value
  }
  return { slots, overrides: {} }
}

/** Slot templates merged with the owner's saved ones: { [kind]: { channel, subject, body, enabled } }. v1 JSON loads too. */
export function resolveTemplates(profile) {
  const { slots } = parseSaved(profile)
  const resolved = {}
  for (const kind of TEMPLATE_KINDS) {
    const custom = isRecord(slots[kind]) ? slots[kind] : {}
    resolved[kind] = {
      channel: validChannel(custom.channel),
      subject: nonBlank(custom.subject) ? custom.subject : defaults[kind].subject,
      body: nonBlank(custom.body) ? custom.body : defaults[kind].body,
      enabled: custom.enabled !== false,
    }
  }
  return withAliases(resolved)
}

/** { templates, serviceOverrides } where overrides are { [serviceId]: { [kind]: { body } } }. */
export function resolveTemplateConfig(profile) {
  const { overrides } = parseSaved(profile)
  const serviceOverrides = {}
  for (const [serviceId, perKind] of Object.entries(overrides)) {
    if (!isRecord(perKind)) continue
    for (const [key, value] of Object.entries(perKind)) {
      if (isRecord(value) && nonBlank(value.body)) {
        serviceOverrides[serviceId] ||= {}
        serviceOverrides[serviceId][canonicalKind(key)] = { body: value.body }
      }
    }
  }
  return { templates: resolveTemplates(profile), serviceOverrides }
}

/**
 * The v2 JSON to store in `profiles.message_templates_json`. Only slots that differ from the
 * defaults are written, so improved defaults reach owners who never customized a slot.
 */
export function serializeTemplates({ templates = {}, serviceOverrides = {} } = {}) {
  const slots = {}
  for (const kind of TEMPLATE_KINDS) {
    const slot = templates[kind]
    if (!isRecord(slot)) continue
    const subject = nonBlank(slot.subject) ? slot.subject : defaults[kind].subject
    const body = nonBlank(slot.body) ? slot.body : defaults[kind].body
    const channel = validChannel(slot.channel)
    const enabled = slot.enabled !== false
    if (subject !== defaults[kind].subject || body !== defaults[kind].body || channel !== DEFAULT_CHANNEL || !enabled)
      slots[kind] = { channel, subject, body, enabled }
  }
  const overrides = {}
  for (const [serviceId, perKind] of Object.entries(serviceOverrides)) {
    if (!isRecord(perKind)) continue
    for (const [key, value] of Object.entries(perKind)) {
      if (isRecord(value) && nonBlank(value.body)) {
        overrides[serviceId] ||= {}
        overrides[serviceId][canonicalKind(key)] = { body: value.body }
      }
    }
  }
  return { v: 2, slots, serviceOverrides: overrides }
}

/** The template to use for `kind`, with the service override body applied when there is one. */
export function templateFor(config, kind, serviceId = '') {
  const canonical = canonicalKind(kind)
  const templates = config?.templates || resolveTemplates(null)
  const base = templates[canonical] || templates.confirmation
  const override = serviceId ? config?.serviceOverrides?.[serviceId]?.[canonical] : null
  return override?.body ? { ...base, body: override.body, overridden: true } : { ...base, overridden: false }
}

/**
 * Replaces {{variable}} tokens. Unknown or missing variables render empty. Plain text only.
 * A line that is only "Label: {{variable}}" disappears when the variable is empty, and runs of
 * blank lines collapse, so optional details never leave a dangling label.
 */
export function renderTemplate(template, vars = {}) {
  const value = (key) => (vars[key] == null ? '' : String(vars[key]))
  const lines = String(template || '').split('\n').filter((line) => {
    const match = /^[^\S\n]*[A-Za-z][\w ]{0,30}:[^\S\n]*\{\{\s*([a-z_]+)\s*\}\}[^\S\n]*$/.exec(line)
    return !(match && value(match[1]) === '')
  })
  return lines
    .join('\n')
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key) => value(key))
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

function formatIn(instant, timeZone, options) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, ...options }).format(new Date(instant))
  } catch {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(new Date(instant))
  }
}

const WA_CONTACT = /\[\[wa:\s*(\+?[\d\s().-]{6,25})\s*\]\]/i

/** Owners may put `[[wa:+234...]]` in their bio as a contact number. Returns { text (bio without it), phone }. */
export function parseBioContact(bio) {
  const raw = String(bio ?? '')
  const match = WA_CONTACT.exec(raw)
  if (!match) return { text: raw.trim(), phone: '' }
  return { text: raw.replace(WA_CONTACT, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim(), phone: match[1].trim() }
}

function prepNotesOf(service) {
  if (!service) return ''
  return String(service.prep_notes || '').trim() || splitDescription(service.description).meta.p || ''
}

/**
 * Template variables for one booking, with date and time in the booking timezone.
 * Optional context: profile, service, timezone, bookingLink, rebookLink, staff (team member),
 * businessPhone, lastService, offer ({ text, code, expires }).
 */
export function messageVars(booking, { profile, service, timezone, bookingLink, rebookLink, staff, businessPhone, lastService, offer } = {}) {
  const zone = booking?.timezone || timezone || profile?.timezone || 'UTC'
  const name = String(booking?.guest_name || '').trim()
  const startsAt = booking?.starts_at
  const minutes =
    startsAt && booking?.ends_at ? Math.round((Date.parse(booking.ends_at) - Date.parse(startsAt)) / 60_000) : 0
  const link = bookingLink || profile?.public_link_url || ''
  // Bookings made before the business name was saved may carry the old literal "Owner" snapshot; never show it.
  const snapshot = String(booking?.staff_name || '').trim()
  const staffName =
    (snapshot && snapshot !== 'Owner' ? snapshot : '') ||
    (staff && !staff.implicit ? String(staff.name || '').trim() : '') ||
    (staff?.implicit ? String(profile?.display_name || '').trim() : '')
  return {
    guest_name: name,
    first_name: name.split(/\s+/)[0] || name,
    service: booking?.service_name || service?.name || '',
    date: startsAt ? formatIn(startsAt, zone, { weekday: 'long', day: 'numeric', month: 'long' }) : '',
    time: startsAt ? formatIn(startsAt, zone, { hour: 'numeric', minute: '2-digit', hour12: true }) : '',
    timezone: zone,
    duration: minutes > 0 ? `${minutes} min` : '',
    business: String(profile?.display_name || '').trim() || 'your host',
    location: service?.location || '',
    reference: booking?.reference || '',
    booking_link: link,
    staff: staffName,
    prep_notes: prepNotesOf(service),
    rebook_link: rebookLink || link,
    business_phone: businessPhone || parseBioContact(profile?.bio).phone,
    last_service: lastService || booking?.service_name || service?.name || '',
    offer: String(offer?.text || '').trim(),
    offer_code: String(offer?.code || '').trim(),
    offer_expires: String(offer?.expires || '').trim(),
  }
}

// Country calling codes for local numbers written with a leading 0.
export const COUNTRY_CODES = Object.freeze({
  NG: '234',
  GH: '233',
  KE: '254',
  ZA: '27',
  UG: '256',
  TZ: '255',
  RW: '250',
  CI: '225',
  SN: '221',
  CM: '237',
  EG: '20',
})

export const TIMEZONE_COUNTRIES = {
  'Africa/Lagos': 'NG',
  'Africa/Accra': 'GH',
  'Africa/Nairobi': 'KE',
  'Africa/Johannesburg': 'ZA',
  'Africa/Kampala': 'UG',
  'Africa/Dar_es_Salaam': 'TZ',
  'Africa/Kigali': 'RW',
  'Africa/Abidjan': 'CI',
  'Africa/Dakar': 'SN',
  'Africa/Douala': 'CM',
  'Africa/Cairo': 'EG',
}

export function countryFromTimezone(timezone) {
  return TIMEZONE_COUNTRIES[timezone] || 'NG'
}

/** E.164 digits without '+', or '' when the number cannot be dialled internationally. */
export function normalizePhone(phone, defaultCountry = 'NG') {
  const raw = String(phone || '').trim()
  if (!raw) return ''
  let digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2)
  } else if (digits.startsWith('0')) {
    const code = COUNTRY_CODES[defaultCountry]
    if (!code) return ''
    digits = code + digits.slice(1)
  } else if (!Object.values(COUNTRY_CODES).some((code) => digits.startsWith(code))) {
    return ''
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : ''
}

export function whatsappUrl(phone, text, defaultCountry) {
  const digits = normalizePhone(phone, defaultCountry)
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text || '')}` : ''
}

export function smsUrl(phone, text, defaultCountry) {
  const digits = normalizePhone(phone, defaultCountry)
  return digits ? `sms:+${digits}?&body=${encodeURIComponent(text || '')}` : ''
}

export function mailtoUrl(email, subject, body) {
  const address = String(email || '').trim()
  // `.invalid` is reserved and used for Bookins placeholder addresses (walk-ins, time off).
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || /\.invalid$/i.test(address)) return ''
  return `mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`
}

export function whatsappShareUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text || '')}`
}

/** WhatsApp, SMS and email links for one recipient; '' where the contact detail is missing or unusable. */
export function messageLinks({ phone, email, subject, text, country }) {
  return {
    whatsapp: whatsappUrl(phone, text, country),
    sms: smsUrl(phone, text, country),
    email: mailtoUrl(email, subject, text),
  }
}

/**
 * Everything a "Message guest" menu needs for one template kind:
 * { kind, channel, enabled, subject, text, whatsapp, sms, email, preferred } where links are ''
 * when unusable and `preferred` is the first usable link starting with the slot's channel.
 * Context: profile, service, timezone, bookingLink, rebookLink, staff, offer, templateConfig
 * (pass a resolved config to avoid re-parsing the profile in loops).
 */
export function composeMessage(kind, booking, context = {}) {
  const canonical = TEMPLATE_KINDS.includes(canonicalKind(kind)) ? canonicalKind(kind) : 'confirmation'
  const config = context.templateConfig || resolveTemplateConfig(context.profile)
  const template = templateFor(config, canonical, booking?.service_id || context.service?.id || '')
  const vars = messageVars(booking, context)
  const subject = renderTemplate(template.subject, vars)
  const text = renderTemplate(template.body, vars)
  const country = countryFromTimezone(context.profile?.timezone)
  const links = messageLinks({ phone: booking?.guest_phone, email: booking?.guest_email, subject, text, country })
  const order = [template.channel, ...CHANNELS.filter((channel) => channel !== template.channel)]
  const preferred = order.find((channel) => links[channel]) || ''
  return { kind: canonical, channel: template.channel, enabled: template.enabled, subject, text, ...links, preferred }
}

// ---- live message queue (owner-opened, never automatic) ----

/** Booking field that records "opened by you" for each message kind. */
export const OPENED_FIELD = Object.freeze({
  reminder24: 'reminder24_opened_at',
  reminder2: 'reminder2_opened_at',
  prep: 'prep_opened_at',
  thanks: 'followup_opened_at',
  rebook: 'rebook_opened_at',
})
// Written by v0.5.x before the 24h/2h split; still honoured when reading.
const LEGACY_OPENED_FIELD = Object.freeze({ reminder24: 'reminder_opened_at' })

export const openedField = (kind) => OPENED_FIELD[canonicalKind(kind)] || ''
export const openedAtFor = (booking, kind) => {
  const canonical = canonicalKind(kind)
  return String(booking?.[OPENED_FIELD[canonical]] || booking?.[LEGACY_OPENED_FIELD[canonical]] || '')
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
export const QUEUE_WINDOWS = Object.freeze({
  reminder24: { due: 24 * HOUR, upcoming: 72 * HOUR },
  reminder2: { due: 2 * HOUR, upcoming: 26 * HOUR },
  prep: { due: 48 * HOUR, upcoming: 96 * HOUR },
  thanksWithin: 24 * HOUR,
  rebookUpcomingDays: 7,
  rebookGraceDays: 120,
})

const asMs = (value) => (value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number(value))
const contactEmail = (booking) => String(booking?.guest_email || '').trim().toLowerCase()

/**
 * Messages the owner can open now, computed LIVE from bookings so a booking cancelled or moved after
 * a digest was written never appears. { due, upcoming, done } of
 * { id, kind, booking, contact, due_at, message, links, openedAt }.
 * - reminder24: confirmed, starting within 24h. reminder2: within 2h. prep: within 48h and the service has prep notes.
 * - thanks: completed within the last 24h. rebook: the contact's latest booking is a completed one
 *   older than the service's rebook_after_days (up to 120 days later), with no newer active booking.
 * Opened items move to `done`. Rebook nudges skip opted-out contacts.
 */
export function messageQueue(state, { now = Date.now(), timezone } = {}) {
  const nowMs = asMs(now)
  const services = new Map((state?.services || []).map((service) => [service.id, service]))
  const contacts = new Map((state?.contacts || []).map((contact) => [String(contact.email || '').toLowerCase(), contact]))
  const config = resolveTemplateConfig(state?.profile)
  const team = hasTeam(state)
  const queue = { due: [], upcoming: [], done: [] }

  const add = (kind, booking, dueAt, bucketWhenOpen) => {
    const service = services.get(booking.service_id)
    const openedAt = openedAtFor(booking, kind)
    const email = contactEmail(booking)
    const record = contacts.get(email) || null
    const staff = team ? staffForBooking(state, booking) : null
    const message = composeMessage(kind, booking, {
      profile: state?.profile,
      service,
      timezone,
      templateConfig: config,
      staff,
      rebookLink: state?.profile?.public_link_url || '',
    })
    const bucket = openedAt ? 'done' : bucketWhenOpen
    queue[bucket].push({
      id: `${kind}:${booking.id}`,
      kind,
      booking,
      contact: {
        email,
        name: record?.name || booking.guest_name || email,
        phone: booking.guest_phone || record?.phone || '',
        record,
        marketing_opt_out: isOptedOut(record),
      },
      due_at: new Date(dueAt).toISOString(),
      message,
      links: { whatsapp: message.whatsapp, sms: message.sms, email: message.email },
      openedAt,
    })
  }

  const active = (state?.bookings || []).filter((booking) => !isTimeOff(booking) && isActiveBooking(booking))
  for (const booking of active) {
    const start = Date.parse(booking.starts_at)
    if (!Number.isFinite(start)) continue
    if (booking.status === 'confirmed' && start > nowMs) {
      const until = start - nowMs
      for (const kind of ['reminder24', 'reminder2']) {
        // Once the 2h reminder is due, the 24h reminder is stale for the same booking.
        if (kind === 'reminder24' && until <= QUEUE_WINDOWS.reminder2.due) continue
        const window = QUEUE_WINDOWS[kind]
        if (until <= window.due) add(kind, booking, start - window.due, 'due')
        else if (until <= window.upcoming) add(kind, booking, start - window.due, 'upcoming')
      }
      if (prepNotesOf(services.get(booking.service_id))) {
        const window = QUEUE_WINDOWS.prep
        if (until <= window.due) add('prep', booking, start - window.due, 'due')
        else if (until <= window.upcoming) add('prep', booking, start - window.due, 'upcoming')
      }
    }
    if (booking.status === 'completed') {
      const end = Date.parse(booking.ends_at) || start
      if (end <= nowMs && nowMs - end <= QUEUE_WINDOWS.thanksWithin) add('thanks', booking, end, 'due')
    }
  }

  // Rebook: judged on each contact's latest active booking, so a newer booking (even a future one) removes the nudge.
  const latestByContact = new Map()
  for (const booking of active) {
    const email = contactEmail(booking)
    if (!email) continue
    const current = latestByContact.get(email)
    if (!current || Date.parse(booking.starts_at) > Date.parse(current.starts_at)) latestByContact.set(email, booking)
  }
  for (const [email, booking] of latestByContact) {
    if (booking.status !== 'completed' || isOptedOut(contacts.get(email))) continue
    const days = Number(services.get(booking.service_id)?.rebook_after_days)
    if (!Number.isFinite(days) || days < 1) continue
    const end = Date.parse(booking.ends_at) || Date.parse(booking.starts_at)
    const dueAt = end + days * DAY
    const elapsed = (nowMs - end) / DAY
    if (elapsed >= days && elapsed <= days + QUEUE_WINDOWS.rebookGraceDays) add('rebook', booking, dueAt, 'due')
    else if (elapsed < days && days - elapsed <= QUEUE_WINDOWS.rebookUpcomingDays) add('rebook', booking, dueAt, 'upcoming')
  }

  const byDue = (a, b) => Date.parse(a.due_at) - Date.parse(b.due_at) || a.id.localeCompare(b.id)
  queue.due.sort(byDue)
  queue.upcoming.sort(byDue)
  queue.done.sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt) || a.id.localeCompare(b.id))
  return queue
}

/** Offer status of a contact for a code: 'redeemed' | 'offered' | ''. */
export const offerStatus = (contact, code) => contactOffers(contact).find((item) => item.code === code)?.status || ''

export { isOwnerMember, ownerStaff }
