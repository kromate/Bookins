(data) => {
  // Source of the TRANSFORM_DATA step of workflow `owner-daily-agenda`. `node scripts/sync-agenda-workflow.mjs`
  // writes it (comments stripped, defaults injected) into .goalmatic/app.json; a test keeps them identical.
  // Platform rules this source must obey (the platform runs HTML/mention clean-up over the whole string):
  // no less-than character, no consecutive opening braces, no entity text, no at-step tokens.
  if (typeof data === 'string') throw new Error('The agenda could not read its Bookins tables.');
  const list = (v) => (Array.isArray(v) ? v : []);
  const bookings = data && Array.isArray(data.bookings) ? data.bookings : data && data.payload ? list(data.payload.records) : [];
  const profile = list(data && data.profiles)[0] || {};
  const services = {};
  list(data && data.services).forEach((s) => { if (s && s.id) services[s.id] = s; });
  const now = Date.now();
  const clean = (v) => String(v === null || v === undefined ? '' : v).replace(/[\r\n]+/g, ' ').trim();
  const dateMs = (value) => {
    if (value && typeof value.toDate === 'function') {
      const date = value.toDate();
      return date instanceof Date ? date.getTime() : NaN;
    }
    if (value && typeof value === 'object' && Number.isFinite(Number(value._seconds))) {
      return Number(value._seconds) * 1000 + (Number(value._nanoseconds) || 0) / 1000000;
    }
    if (typeof value === 'number') return value >= 100000000000 ? value : value * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const dayIn = (ms, tz) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); } catch (e) { return new Date(ms).toISOString().slice(0, 10); } };
  const timeIn = (ms, tz) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(ms)); } catch (e) { return new Date(ms).toISOString().slice(11, 16) + ' UTC'; } };
  const nextDay = (day) => new Date(Date.parse(day + 'T12:00:00.000Z') + 86400000).toISOString().slice(0, 10);
  const isOff = (r) => clean(r.status) === 'blocked' || clean(r.service_id) === 'time-off';
  const email = (r) => (/@bookins\.invalid$/i.test(clean(r.guest_email)) ? '' : clean(r.guest_email));

  // ---- message templates (same rules as messaging.js) ----
  const DEFAULTS = __DEFAULTS__;
  const COUNTRY_CODES = __COUNTRY_CODES__;
  const TZ_COUNTRIES = __TZ_COUNTRIES__;
  const parseJson = (text) => { try { const v = JSON.parse(text || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } };
  const saved = parseJson(profile.message_templates_json);
  const isV2 = saved.v === 2 || (saved.slots && typeof saved.slots === 'object');
  const savedSlot = isV2 ? (saved.slots || {}).reminder24 : saved.reminder24 || saved.reminder;
  const slot = savedSlot && typeof savedSlot === 'object' ? savedSlot : {};
  const overrides = isV2 && saved.serviceOverrides && typeof saved.serviceOverrides === 'object' ? saved.serviceOverrides : {};
  const channelPref = ['whatsapp', 'sms', 'email'].indexOf(slot.channel) !== -1 ? slot.channel : 'whatsapp';
  const slotEnabled = slot.enabled !== false;
  const baseBody = typeof slot.body === 'string' && slot.body.trim() ? slot.body : DEFAULTS.body;
  const subjectTemplate = typeof slot.subject === 'string' && slot.subject.trim() ? slot.subject : DEFAULTS.subject;
  const tokenPattern = /\u007b\u007b\s*([a-z_]+)\s*\u007d\u007d/g;
  const labelLine = /^[^\S\n]*[A-Za-z][\w ]{0,30}:[^\S\n]*\u007b\u007b\s*([a-z_]+)\s*\u007d\u007d[^\S\n]*$/;
  const render = (template, vars) => {
    const val = (k) => (vars[k] === null || vars[k] === undefined ? '' : String(vars[k]));
    return String(template || '').split('\n').filter((line) => { const m = labelLine.exec(line); return !(m && val(m[1]) === ''); }).join('\n').replace(tokenPattern, (_, k) => val(k)).replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  };
  const country = TZ_COUNTRIES[clean(profile.timezone)] || 'NG';
  const dial = (phone) => {
    const raw = clean(phone); if (!raw) return '';
    let digits = raw.replace(/\D/g, '');
    if (raw.charAt(0) !== '+') {
      if (digits.indexOf('00') === 0) digits = digits.slice(2);
      else if (digits.charAt(0) === '0') digits = COUNTRY_CODES[country] + digits.slice(1);
      else if (!Object.keys(COUNTRY_CODES).some((k) => digits.indexOf(COUNTRY_CODES[k]) === 0)) return '';
    }
    return digits.length >= 8 && 15 >= digits.length ? digits : '';
  };
  const waContact = /\[\[wa:\s*(\+?[\d\s().-]{6,25})\s*\]\]/i;
  const bioMatch = waContact.exec(String(profile.bio || ''));
  const business = clean(profile.display_name) || 'your host';
  const trailer = /\n?\[\[bk:(\{.*\})\]\]\s*$/s;
  const prepOf = (svc) => { if (!svc) return ''; if (clean(svc.prep_notes)) return clean(svc.prep_notes); const m = trailer.exec(String(svc.description || '')); if (!m) return ''; try { return clean(JSON.parse(m[1]).p); } catch (e) { return ''; } };
  const reminderFor = (r, tz, start) => {
    const svc = services[clean(r.service_id)];
    const name = clean(r.guest_name);
    const minutes = Math.round((dateMs(r.ends_at) - start) / 60000);
    const link = clean(profile.public_link_url);
    const vars = {
      guest_name: name, first_name: name.split(/\s+/)[0] || name, service: clean(r.service_name) || (svc ? clean(svc.name) : ''),
      date: new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(start)),
      time: new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(start)),
      timezone: tz, duration: minutes > 0 ? minutes + ' min' : '', business: business, location: svc ? clean(svc.location) : '',
      reference: clean(r.reference), booking_link: link, staff: clean(r.staff_name), prep_notes: prepOf(svc), rebook_link: link,
      business_phone: bioMatch ? bioMatch[1].trim() : '', last_service: clean(r.service_name), offer: '', offer_code: '', offer_expires: '',
    };
    const override = overrides[clean(r.service_id)] && overrides[clean(r.service_id)].reminder24;
    const body = override && typeof override.body === 'string' && override.body.trim() ? override.body : baseBody;
    const text = render(body, vars);
    const subject = render(subjectTemplate, vars);
    const links = {
      whatsapp: dial(r.guest_phone) ? 'https://wa.me/' + dial(r.guest_phone) + '?text=' + encodeURIComponent(text) : '',
      sms: dial(r.guest_phone) ? 'sms:+' + dial(r.guest_phone) + '?&body=' + encodeURIComponent(text) : '',
      email: email(r) ? 'mailto:' + encodeURIComponent(email(r)) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text) : '',
    };
    const order = [channelPref].concat(['whatsapp', 'sms', 'email'].filter((c) => c !== channelPref));
    const pick = order.filter((c) => links[c])[0] || '';
    return { channel: pick, link: pick ? links[pick] : '' };
  };

  // ---- agenda ----
  const today = []; const timeOff = []; const fresh = []; const reminders = [];
  const channelLabel = { whatsapp: 'Open WhatsApp', sms: 'Open SMS', email: 'Open email' };
  bookings.forEach((r) => {
    if (!r) return;
    const tz = clean(r.timezone) || 'UTC';
    const start = dateMs(r.starts_at);
    const end = dateMs(r.ends_at);
    if (isNaN(start)) return;
    const status = clean(r.status);
    const todayKey = dayIn(now, tz);
    if (isOff(r)) {
      if (status === 'blocked' && !isNaN(end) && end > now && todayKey >= dayIn(start, tz) && dayIn(end, tz) >= todayKey) timeOff.push(timeIn(start, tz) + '-' + timeIn(end, tz) + ' ' + (clean(r.notes) || 'Time off') + ' (' + tz + ')');
      return;
    }
    const who = clean(r.staff_name) && clean(r.staff_name) !== business ? ' with ' + clean(r.staff_name) : '';
    if (status !== 'cancelled' && dayIn(start, tz) === todayKey) today.push({ start, line: timeIn(start, tz) + ' ' + clean(r.service_name) + ' - ' + (clean(r.guest_name) || 'Guest') + who + (clean(r.guest_phone) ? ', ' + clean(r.guest_phone) : '') + (email(r) ? ', ' + email(r) : '') + ' (' + tz + ', ' + clean(r.reference) + ')' });
    const created = dateMs(r.created_at);
    if (!isNaN(created) && 86400000 >= now - created && status !== 'cancelled' && start > now) fresh.push({ start, line: dayIn(start, tz) + ' ' + timeIn(start, tz) + ' ' + clean(r.service_name) + ' - ' + (clean(r.guest_name) || 'Guest') + (clean(r.source) === 'owner' ? ' (added by you)' : '') + ' (' + tz + ')' });
    if (slotEnabled && status === 'confirmed' && dayIn(start, tz) === nextDay(todayKey) && !clean(r.reminder24_opened_at) && !clean(r.reminder_opened_at)) {
      const made = reminderFor(r, tz, start);
      reminders.push({ start, line: timeIn(start, tz) + ' ' + (clean(r.guest_name) || 'Guest') + ', ' + clean(r.service_name) + (made.link ? ' - ' + channelLabel[made.channel] + ': ' + made.link : ' - no phone or email to message') });
    }
  });
  const byStart = (a, b) => a.start - b.start;
  today.sort(byStart); fresh.sort(byStart); reminders.sort(byStart);
  const shown = reminders.slice(0, 40);
  const lines = ['Good morning. Here is your Bookins agenda.', '', 'TODAY (' + today.length + ')'];
  if (today.length) today.forEach((i) => lines.push('- ' + i.line)); else lines.push('- No appointments today.');
  if (timeOff.length) { lines.push('', 'TIME OFF TODAY'); timeOff.forEach((l) => lines.push('- ' + l)); }
  lines.push('', 'NEW IN THE LAST 24 HOURS (' + fresh.length + ')');
  if (fresh.length) fresh.forEach((i) => lines.push('- ' + i.line)); else lines.push('- No new bookings.');
  lines.push('', 'REMINDERS TO OPEN FOR TOMORROW (' + reminders.length + ')');
  if (!slotEnabled) lines.push('- The 24-hour reminder is switched off in Bookins > Messages.');
  else if (shown.length) { shown.forEach((i) => lines.push('- ' + i.line)); if (reminders.length > shown.length) lines.push('- ' + (reminders.length - shown.length) + ' more are waiting in Bookins > Messages.'); }
  else lines.push('- Nothing to remind about tomorrow.');
  lines.push('', 'Open Bookins to message clients, reschedule, or mark appointments completed.');
  lines.push('Reminder links were prepared when this email was built. Opening one only fills in a message in your own WhatsApp, SMS or email app: Bookins sends nothing to guests. Bookings moved or cancelled since then are not reflected here, so check Bookins > Messages first.');
  lines.push('Sent from noreply@goalmatic.io to the account owner only. Guests are not emailed. Based on your most recently created 200 bookings.');
  const subject = 'Bookins: ' + (today.length ? today.length + ' appointment' + (today.length === 1 ? '' : 's') + ' today' : 'no appointments today') + (fresh.length ? ', ' + fresh.length + ' new' : '') + (reminders.length ? ', ' + reminders.length + ' to remind' : '');
  return { subject, body: lines.join('\n') };
}
