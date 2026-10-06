// Prefilled guest messages that open in the owner's own WhatsApp, SMS, or email app.
// Bookins never sends these itself. Pure module: no window access at import.

export const TEMPLATE_KINDS = ['confirmation', 'reminder', 'reschedule', 'cancellation', 'followup']

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
]

export const DEFAULT_TEMPLATES = Object.freeze({
  confirmation: {
    subject: 'Your {{service}} is confirmed',
    body:
      'Hi {{first_name}}, your {{service}} with {{business}} is confirmed for {{date}} at {{time}} ({{timezone}}).\n' +
      'Location: {{location}}\nReference: {{reference}}\n\nReply here if you need to change anything.',
  },
  reminder: {
    subject: 'Reminder: {{service}} on {{date}}',
    body:
      'Hi {{first_name}}, a friendly reminder of your {{service}} with {{business}} on {{date}} at {{time}} ({{timezone}}).\n' +
      'Location: {{location}}\n\nPlease reply if you can no longer make it.',
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
  followup: {
    subject: 'Thank you for visiting {{business}}',
    body:
      'Hi {{first_name}}, thank you for your {{service}} with {{business}}. ' +
      'Whenever you are ready for your next visit, you can book here: {{booking_link}}',
  },
})

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Defaults merged with the owner's saved templates (`profiles.message_templates_json`). */
export function resolveTemplates(profile) {
  let saved = {}
  try {
    const parsed = JSON.parse(profile?.message_templates_json || '{}')
    if (isRecord(parsed)) saved = parsed
  } catch {
    saved = {}
  }
  return Object.fromEntries(
    TEMPLATE_KINDS.map((kind) => {
      const custom = isRecord(saved[kind]) ? saved[kind] : {}
      return [
        kind,
        {
          subject: typeof custom.subject === 'string' && custom.subject.trim() ? custom.subject : DEFAULT_TEMPLATES[kind].subject,
          body: typeof custom.body === 'string' && custom.body.trim() ? custom.body : DEFAULT_TEMPLATES[kind].body,
        },
      ]
    }),
  )
}

/** Replaces {{variable}} tokens. Unknown or missing variables render empty. Plain text only. */
export function renderTemplate(template, vars = {}) {
  return String(template || '')
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key) => (vars[key] == null ? '' : String(vars[key])))
    .replace(/^[^\S\n]*Location:[^\S\n]*$\n?/gm, '')
}

function formatIn(instant, timeZone, options) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, ...options }).format(new Date(instant))
  } catch {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(new Date(instant))
  }
}

/** Template variables for one booking, with date and time in the booking timezone. */
export function messageVars(booking, { profile, service, timezone, bookingLink } = {}) {
  const zone = booking?.timezone || timezone || profile?.timezone || 'UTC'
  const name = String(booking?.guest_name || '').trim()
  const startsAt = booking?.starts_at
  const minutes =
    startsAt && booking?.ends_at ? Math.round((Date.parse(booking.ends_at) - Date.parse(startsAt)) / 60_000) : 0
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
    booking_link: bookingLink || profile?.public_link_url || '',
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

const TIMEZONE_COUNTRIES = {
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

/**
 * Everything a "Message guest" menu needs for one template kind:
 * { text, subject, whatsapp, sms, email } where links are '' when unusable.
 */
export function composeMessage(kind, booking, context = {}) {
  const templates = resolveTemplates(context.profile)
  const template = templates[kind] || templates.confirmation
  const vars = messageVars(booking, context)
  const subject = renderTemplate(template.subject, vars)
  const text = renderTemplate(template.body, vars)
  const country = countryFromTimezone(context.profile?.timezone)
  return {
    subject,
    text,
    whatsapp: whatsappUrl(booking?.guest_phone, text, country),
    sms: smsUrl(booking?.guest_phone, text, country),
    email: mailtoUrl(booking?.guest_email, subject, text),
  }
}
