type AgendaRecord = Record<string, unknown>
type AgendaTemplate = { subject: string; body: string }
type AgendaChannel = 'whatsapp' | 'sms' | 'email'
type TimedLine = { start: number; line: string }

declare const __DEFAULTS__: AgendaTemplate
declare const __COUNTRY_CODES__: Record<string, string>
declare const __TZ_COUNTRIES__: Record<string, string>

(data: unknown) => {
  // Source of the TRANSFORM_DATA step of workflow `owner-daily-agenda`. The sync script transpiles
  // this file, strips comments, and injects defaults into .goalmatic/app.json; a test keeps them identical.
  // Platform rules for the emitted source: no less-than character, consecutive opening braces,
  // entity text, or at-step tokens because the workflow importer rewrites those sequences.
  if (typeof data === 'string') throw new Error('The agenda could not read its Bookins tables.')
  const isRecord = (value: unknown): value is AgendaRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  const record = (value: unknown): AgendaRecord => isRecord(value) ? value : {}
  const list = (value: unknown): AgendaRecord[] => Array.isArray(value) ? value.filter(isRecord) : []
  const input = record(data)
  const payload = record(input.payload)
  const bookings = Array.isArray(input.bookings) ? list(input.bookings) : list(payload.records)
  const profile = list(input.profiles)[0] ?? {}
  const services: Record<string, AgendaRecord> = {}
  list(input.services).forEach((service) => {
    const id = clean(service.id)
    if (id) services[id] = service
  })
  const now = Date.now()
  function clean(value: unknown): string {
    return String(value === null || value === undefined ? '' : value).replace(/[\r\n]+/g, ' ').trim()
  }
  const dateMs = (value: unknown): number => {
    if (isRecord(value) && typeof value.toDate === 'function') {
      const date = value.toDate()
      return date instanceof Date ? date.getTime() : NaN
    }
    if (isRecord(value) && Number.isFinite(Number(value._seconds))) {
      return Number(value._seconds) * 1000 + (Number(value._nanoseconds) || 0) / 1000000
    }
    if (typeof value === 'number') return value >= 100000000000 ? value : value * 1000
    const parsed = Date.parse(clean(value))
    return Number.isFinite(parsed) ? parsed : NaN
  }
  const dayIn = (ms: number, timezone: string): string => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
    } catch {
      return new Date(ms).toISOString().slice(0, 10)
    }
  }
  const timeIn = (ms: number, timezone: string): string => {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
    } catch {
      return new Date(ms).toISOString().slice(11, 16) + ' UTC'
    }
  }
  const nextDay = (day: string): string => new Date(Date.parse(day + 'T12:00:00.000Z') + 86400000).toISOString().slice(0, 10)
  const isOff = (row: AgendaRecord): boolean => clean(row.status) === 'blocked' || clean(row.service_id) === 'time-off'
  const email = (row: AgendaRecord): string => /@bookins\.invalid$/i.test(clean(row.guest_email)) ? '' : clean(row.guest_email)

  // Message templates follow the same rules as messaging.ts.
  const DEFAULTS: AgendaTemplate = __DEFAULTS__
  const COUNTRY_CODES: Record<string, string> = __COUNTRY_CODES__
  const TZ_COUNTRIES: Record<string, string> = __TZ_COUNTRIES__
  const parseJson = (text: unknown): AgendaRecord => {
    try {
      const value: unknown = JSON.parse(clean(text) || '{}')
      return record(value)
    } catch {
      return {}
    }
  }
  const saved = parseJson(profile.message_templates_json)
  const slots = record(saved.slots)
  const isV2 = saved.v === 2 || isRecord(saved.slots)
  const savedSlot = isV2 ? record(slots.reminder24) : record(saved.reminder24 ?? saved.reminder)
  const overrides = isV2 ? record(saved.serviceOverrides) : {}
  const channelValue = clean(savedSlot.channel)
  const channelPref: AgendaChannel = channelValue === 'sms' || channelValue === 'email' ? channelValue : 'whatsapp'
  const slotEnabled = savedSlot.enabled !== false
  const baseBody = typeof savedSlot.body === 'string' && savedSlot.body.trim() ? savedSlot.body : DEFAULTS.body
  const subjectTemplate = typeof savedSlot.subject === 'string' && savedSlot.subject.trim() ? savedSlot.subject : DEFAULTS.subject
  const tokenPattern = /\u007b\u007b\s*([a-z_]+)\s*\u007d\u007d/g
  const labelLine = /^[^\S\n]*[A-Za-z][\w ]{0,30}:[^\S\n]*\u007b\u007b\s*([a-z_]+)\s*\u007d\u007d[^\S\n]*$/
  const render = (template: string, vars: Record<string, unknown>): string => {
    const val = (key: string): string => vars[key] === null || vars[key] === undefined ? '' : String(vars[key])
    return template.split('\n')
      .filter((line) => {
        const match = labelLine.exec(line)
        return !(match && match[1] && val(match[1]) === '')
      })
      .join('\n')
      .replace(tokenPattern, (_whole, key: string) => val(key))
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+$/, '')
  }
  const country = TZ_COUNTRIES[clean(profile.timezone)] ?? 'NG'
  const dial = (phone: unknown): string => {
    const raw = clean(phone)
    if (!raw) return ''
    let digits = raw.replace(/\D/g, '')
    if (raw.charAt(0) !== '+') {
      if (digits.indexOf('00') === 0) digits = digits.slice(2)
      else if (digits.charAt(0) === '0') digits = (COUNTRY_CODES[country] ?? '') + digits.slice(1)
      else if (!Object.values(COUNTRY_CODES).some((code) => digits.indexOf(code) === 0)) return ''
    }
    return digits.length >= 8 && 15 >= digits.length ? digits : ''
  }
  const waContact = /\[\[wa:\s*(\+?[\d\s().-]{6,25})\s*\]\]/i
  const bioMatch = waContact.exec(clean(profile.bio))
  const business = clean(profile.display_name) || 'your host'
  const trailer = /\n?\[\[bk:(\{.*\})\]\]\s*$/s
  const prepOf = (service: AgendaRecord | undefined): string => {
    if (!service) return ''
    if (clean(service.prep_notes)) return clean(service.prep_notes)
    const match = trailer.exec(clean(service.description))
    if (!match?.[1]) return ''
    try {
      return clean(record(JSON.parse(match[1])).p)
    } catch {
      return ''
    }
  }
  const reminderFor = (row: AgendaRecord, timezone: string, start: number): { channel: AgendaChannel | ''; link: string } => {
    const service = services[clean(row.service_id)]
    const name = clean(row.guest_name)
    const minutes = Math.round((dateMs(row.ends_at) - start) / 60000)
    const link = clean(profile.public_link_url)
    const vars: Record<string, unknown> = {
      guest_name: name,
      first_name: name.split(/\s+/)[0] || name,
      service: clean(row.service_name) || clean(service?.name),
      date: new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(start)),
      time: new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(start)),
      timezone,
      duration: minutes > 0 ? minutes + ' min' : '',
      business,
      location: clean(service?.location),
      reference: clean(row.reference),
      booking_link: link,
      staff: clean(row.staff_name),
      prep_notes: prepOf(service),
      rebook_link: link,
      business_phone: bioMatch?.[1]?.trim() ?? '',
      last_service: clean(row.service_name),
      offer: '',
      offer_code: '',
      offer_expires: '',
    }
    const serviceOverride = record(overrides[clean(row.service_id)])
    const override = record(serviceOverride.reminder24)
    const body = typeof override.body === 'string' && override.body.trim() ? override.body : baseBody
    const text = render(body, vars)
    const subject = render(subjectTemplate, vars)
    const phone = dial(row.guest_phone)
    const address = email(row)
    const links: Record<AgendaChannel, string> = {
      whatsapp: phone ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text) : '',
      sms: phone ? 'sms:+' + phone + '?&body=' + encodeURIComponent(text) : '',
      email: address ? 'mailto:' + encodeURIComponent(address) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text) : '',
    }
    const order: AgendaChannel[] = [channelPref, ...(['whatsapp', 'sms', 'email'] as const).filter((channel) => channel !== channelPref)]
    const pick = order.find((channel) => links[channel])
    return { channel: pick ?? '', link: pick ? links[pick] : '' }
  }

  const today: TimedLine[] = []
  const timeOff: string[] = []
  const fresh: TimedLine[] = []
  const reminders: TimedLine[] = []
  const channelLabel: Record<AgendaChannel, string> = { whatsapp: 'Open WhatsApp', sms: 'Open SMS', email: 'Open email' }
  bookings.forEach((row) => {
    const timezone = clean(row.timezone) || 'UTC'
    const start = dateMs(row.starts_at)
    const end = dateMs(row.ends_at)
    if (isNaN(start)) return
    const status = clean(row.status)
    const todayKey = dayIn(now, timezone)
    if (isOff(row)) {
      if (status === 'blocked' && !isNaN(end) && end > now && todayKey >= dayIn(start, timezone) && dayIn(end, timezone) >= todayKey) {
        timeOff.push(timeIn(start, timezone) + '-' + timeIn(end, timezone) + ' ' + (clean(row.notes) || 'Time off') + ' (' + timezone + ')')
      }
      return
    }
    const who = clean(row.staff_name) && clean(row.staff_name) !== business ? ' with ' + clean(row.staff_name) : ''
    if (status !== 'cancelled' && dayIn(start, timezone) === todayKey) {
      today.push({ start, line: timeIn(start, timezone) + ' ' + clean(row.service_name) + ' - ' + (clean(row.guest_name) || 'Guest') + who + (clean(row.guest_phone) ? ', ' + clean(row.guest_phone) : '') + (email(row) ? ', ' + email(row) : '') + ' (' + timezone + ', ' + clean(row.reference) + ')' })
    }
    const created = dateMs(row.created_at)
    if (!isNaN(created) && 86400000 >= now - created && status !== 'cancelled' && start > now) {
      fresh.push({ start, line: dayIn(start, timezone) + ' ' + timeIn(start, timezone) + ' ' + clean(row.service_name) + ' - ' + (clean(row.guest_name) || 'Guest') + (clean(row.source) === 'owner' ? ' (added by you)' : '') + ' (' + timezone + ')' })
    }
    if (slotEnabled && status === 'confirmed' && dayIn(start, timezone) === nextDay(todayKey) && !clean(row.reminder24_opened_at) && !clean(row.reminder_opened_at)) {
      const made = reminderFor(row, timezone, start)
      const action = made.channel ? channelLabel[made.channel] : ''
      reminders.push({ start, line: timeIn(start, timezone) + ' ' + (clean(row.guest_name) || 'Guest') + ', ' + clean(row.service_name) + (made.link ? ' - ' + action + ': ' + made.link : ' - no phone or email to message') })
    }
  })
  const byStart = (a: TimedLine, b: TimedLine): number => a.start - b.start
  today.sort(byStart)
  fresh.sort(byStart)
  reminders.sort(byStart)
  const shown = reminders.slice(0, 40)
  const lines = ['Good morning. Here is your Bookins agenda.', '', 'TODAY (' + today.length + ')']
  if (today.length) today.forEach((item) => lines.push('- ' + item.line))
  else lines.push('- No appointments today.')
  if (timeOff.length) {
    lines.push('', 'TIME OFF TODAY')
    timeOff.forEach((line) => lines.push('- ' + line))
  }
  lines.push('', 'NEW IN THE LAST 24 HOURS (' + fresh.length + ')')
  if (fresh.length) fresh.forEach((item) => lines.push('- ' + item.line))
  else lines.push('- No new bookings.')
  lines.push('', 'REMINDERS TO OPEN FOR TOMORROW (' + reminders.length + ')')
  if (!slotEnabled) lines.push('- The 24-hour reminder is switched off in Bookins > Messages.')
  else if (shown.length) {
    shown.forEach((item) => lines.push('- ' + item.line))
    if (reminders.length > shown.length) lines.push('- ' + (reminders.length - shown.length) + ' more are waiting in Bookins > Messages.')
  } else lines.push('- Nothing to remind about tomorrow.')
  lines.push('', 'Open Bookins to message clients, reschedule, or mark appointments completed.')
  lines.push('Reminder links were prepared when this email was built. Opening one only fills in a message in your own WhatsApp, SMS or email app: Bookins sends nothing to guests. Bookings moved or cancelled since then are not reflected here, so check Bookins > Messages first.')
  lines.push('Sent from noreply@goalmatic.io to the account owner only. Guests are not emailed. Based on your most recently created 200 bookings.')
  const subject = 'Bookins: ' + (today.length ? today.length + ' appointment' + (today.length === 1 ? '' : 's') + ' today' : 'no appointments today') + (fresh.length ? ', ' + fresh.length + ' new' : '') + (reminders.length ? ', ' + reminders.length + ' to remind' : '')
  return { subject, body: lines.join('\n') }
}
