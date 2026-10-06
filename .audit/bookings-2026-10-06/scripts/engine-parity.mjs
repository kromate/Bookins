// Standalone parity harness. Logic COPIED from booking.js (local), demo/adapter.js (demo) and
// runtimeService.ts (hosted reference, re-implemented with Intl instead of date-fns-tz).
// Usage: node engine-parity.mjs            (spawns itself under several TZ values)
import { spawnSync } from 'node:child_process'
const TZ_RUNS = ['Africa/Lagos', 'UTC', 'America/New_York', 'Pacific/Auckland']
if (!process.env.CHILD) {
  let bad = 0
  for (const tz of TZ_RUNS) {
    console.log(`\n===== process TZ=${tz} =====`)
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname], { env: { ...process.env, TZ: tz, CHILD: '1' }, encoding: 'utf8' })
    process.stdout.write(r.stdout); process.stderr.write(r.stderr)
    bad += (r.stdout.match(/^FAIL/gm) || []).length
  }
  console.log(`\nTOTAL FAIL lines across TZ runs: ${bad}`)
  process.exit(0)
}

// ---------- hosted reference (runtimeService.ts:126-195) ----------
const fmt = (d, tz, o) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', ...o }).format(d)
function parts(d, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}
function fromZoned(local, tz) { // iterate to find instant whose tz wall clock == local
  const [date, time] = local.split('T'); let guess = Date.parse(`${date}T${time}Z`)
  for (let i = 0; i < 3; i++) { const w = parts(new Date(guess), tz).replace(' ', 'T'); guess += Date.parse(`${date}T${time}Z`) - Date.parse(`${w}:00Z`) }
  return new Date(guess)
}
function wallClockInstant(date, minute, tz) {
  const hh = String(Math.floor(minute / 60)).padStart(2, '0'), mm = String(minute % 60).padStart(2, '0')
  const inst = fromZoned(`${date}T${hh}:${mm}:00`, tz)
  return parts(inst, tz) === `${date} ${hh}:${mm}` ? inst : null
}
const overlaps = (a, b) => Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt)
function hosted({ schedule: s, durationMinutes: d, fromDate, throughDate, now, busy }) {
  const first = new Date(`${fromDate}T00:00:00.000Z`), last = new Date(`${throughDate}T00:00:00.000Z`)
  const n = Math.floor((last - first) / 864e5) + 1
  if (n < 1 || n > 31) throw new Error('range')
  const i = s.slotIntervalMinutes
  if (d > i) throw new Error('duration>interval')
  const min = now.getTime() + Math.max(0, s.minimumNoticeMinutes) * 6e4
  const hor = now.getTime() + Math.min(365, Math.max(1, s.bookingHorizonDays)) * 864e5
  const out = []
  for (let o = 0; o < n && out.length < 200; o++) {
    const date = new Date(first.getTime() + o * 864e5).toISOString().slice(0, 10)
    const wd = new Date(`${date}T12:00:00.000Z`).getUTCDay()
    for (const w of s.weeklyWindows.filter(x => x.weekday === wd))
      for (let m = w.startMinute; m + d <= w.endMinute; m += i) {
        const st = wallClockInstant(date, m, s.timezone); if (!st) continue
        const en = new Date(st.getTime() + d * 6e4)
        if (st.getTime() < min || st.getTime() > hor) continue
        const op = { startsAt: st.toISOString(), endsAt: en.toISOString() }
        if (busy.some(b => overlaps(op, b))) continue
        out.push({ ...op, timezone: s.timezone, localDate: date, localTime: fmt(st, s.timezone, { hour: '2-digit', minute: '2-digit' }) })
      }
  }
  return out
}

// ---------- local preview copy (booking.js:362-411), `now` injected ----------
function local({ schedule, service, bookings }, fromDate, throughDate, now) {
  const windows = JSON.parse(schedule.weekly_windows_json || '[]')
  const interval = Number(schedule.slot_interval_minutes), duration = Number(service.duration_minutes)
  if (!Number.isInteger(duration) || duration < 5 || duration > interval) throw new Error('fit')
  const busy = bookings.filter(x => x.status !== 'cancelled')
  const start = new Date(`${fromDate}T00:00:00`), end = new Date(`${throughDate}T00:00:00`)
  const openings = []
  for (let date = new Date(start); date <= end && openings.length < 100; date.setDate(date.getDate() + 1))
    for (const w of windows.filter(x => x.weekday === date.getDay()))
      for (let minute = w.startMinute; minute + duration <= w.endMinute; minute += interval) {
        const begins = new Date(date); begins.setHours(Math.floor(minute / 60), minute % 60, 0, 0)
        const ends = new Date(begins.getTime() + duration * 6e4)
        if (begins.getTime() < now.getTime() + Number(schedule.minimum_notice_minutes || 0) * 6e4) continue
        if (busy.some(x => Date.parse(x.starts_at) < ends.getTime() && begins.getTime() < Date.parse(x.ends_at))) continue
        openings.push({ startsAt: begins.toISOString(), endsAt: ends.toISOString(), timezone: schedule.timezone, localDate: begins.toISOString().slice(0, 10) })
      }
  return openings
}
// local submit (booking.js:413-444): reservation-key check only
function localSubmit(db, serviceId, startsAt) {
  const svc = db.service, key = `${svc.schedule_id}|${new Date(startsAt).toISOString()}`
  if (db.bookings.some(b => b.reservation_key === key && b.status !== 'cancelled')) throw new Error('taken')
  const endsAt = new Date(Date.parse(startsAt) + svc.duration_minutes * 6e4).toISOString()
  db.bookings.push({ starts_at: startsAt, ends_at: endsAt, reservation_key: key, status: 'confirmed' })
}
// demo copy (demo/adapter.js:31-63)
function demo(db, from, through, now) {
  const { schedule, service, bookings } = db
  const windows = JSON.parse(schedule.weekly_windows_json), interval = Number(schedule.slot_interval_minutes), duration = Number(service.duration_minutes)
  const out = []
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${through}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1))
    for (const w of windows.filter(x => x.weekday === d.getUTCDay()))
      for (let m = w.startMinute; m + duration <= w.endMinute; m += interval) {
        const b = new Date(d); b.setUTCHours(Math.floor(m / 60), m % 60, 0, 0)
        const e = new Date(b.getTime() + duration * 6e4)
        if (b < now.getTime() + schedule.minimum_notice_minutes * 6e4) continue
        if (bookings.filter(x => x.status !== 'cancelled').some(x => Date.parse(x.starts_at) < e && b < Date.parse(x.ends_at))) continue
        out.push({ startsAt: b.toISOString(), localDate: b.toISOString().slice(0, 10) })
      }
  return out
}

// ---------- fixtures & harness ----------
let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`) }
const NOW = new Date('2026-10-06T08:00:00Z') // Tuesday
const mk = (over = {}, dur = 30) => {
  const wins = [1, 2, 3, 4, 5].map(weekday => ({ weekday, startMinute: 540, endMinute: 1020 }))
  const schedule = { id: 's', timezone: 'Africa/Lagos', weekly_windows_json: JSON.stringify(wins), slot_interval_minutes: 60, minimum_notice_minutes: 60, booking_horizon_days: 60, active: true, ...over }
  return { schedule, service: { id: 'v', schedule_id: 's', duration_minutes: dur }, bookings: [] }
}
const ref = (db, f, t, extra = {}) => hosted({
  schedule: { timezone: db.schedule.timezone, slotIntervalMinutes: db.schedule.slot_interval_minutes, minimumNoticeMinutes: db.schedule.minimum_notice_minutes, bookingHorizonDays: db.schedule.booking_horizon_days, weeklyWindows: JSON.parse(db.schedule.weekly_windows_json), ...extra },
  durationMinutes: db.service.duration_minutes, fromDate: f, throughDate: t, now: NOW,
  busy: db.bookings.filter(b => b.status !== 'cancelled').map(b => ({ startsAt: b.starts_at, endsAt: b.ends_at })),
})
const starts = a => a.map(x => x.startsAt).join(',')

// 1. Timezone parity (Lagos schedule, request 2026-10-07..09)
{ const db = mk(); const L = local(db, '2026-10-07', '2026-10-09', NOW), H = ref(db, '2026-10-07', '2026-10-09')
  check('T1 local slots == hosted slots (Lagos schedule) under process TZ=' + process.env.TZ, starts(L) === starts(H), `local[0]=${L[0]?.startsAt} hosted[0]=${H[0]?.startsAt} (n ${L.length}/${H.length})`)
  const D = demo(db, '2026-10-07', '2026-10-09', NOW)
  check('T1b demo slots == hosted slots for Lagos-tz schedule (demo hard-codes UTC)', starts(D) === starts(H), `demo[0]=${D[0]?.startsAt} hosted[0]=${H[0]?.startsAt}`) }
// 2. localDate vs schedule-local date
{ const wins = [{ weekday: 3, startMinute: 0, endMinute: 120 }]; const db = mk({ weekly_windows_json: JSON.stringify(wins), timezone: 'Africa/Lagos' })
  const H = ref(db, '2026-10-07', '2026-10-07'); const D = demo(db, '2026-10-07', '2026-10-07', NOW)
  const L = process.env.TZ === 'Africa/Lagos' ? local(db, '2026-10-07', '2026-10-07', NOW) : []
  if (L.length) check('T2 local localDate (UTC-derived) equals schedule date for 00:00 Lagos slot', L[0].localDate === H[0].localDate, `local=${L[0].localDate} hosted=${H[0].localDate} startsAt=${L[0].startsAt}`)
  else check('T2 (skipped, runs under Lagos)', true)
  check('T2b demo localDate equals schedule-local date', D[0]?.localDate === H[0]?.localDate, `demo=${D[0]?.localDate} hosted=${H[0]?.localDate}`) }
// 3. Horizon
{ const db = mk({ booking_horizon_days: 14 }); const L = local(db, '2026-12-01', '2026-12-03', NOW), H = ref(db, '2026-12-01', '2026-12-03'), D = demo(db, '2026-12-01', '2026-12-03', NOW)
  check('T3 local enforces booking_horizon_days', L.length === H.length, `local=${L.length} hosted=${H.length}`)
  check('T3b demo enforces booking_horizon_days', D.length === H.length, `demo=${D.length} hosted=${H.length}`) }
// 4. Inactive schedule / private / inactive service
{ const db = mk({ active: false }); let h = 'ok'; /* hosted throws 409 for inactive schedule (runtimeService.ts:280) */
  const L = local(db, '2026-10-07', '2026-10-07', NOW); check('T4 local rejects inactive schedule (hosted: 409)', L.length === 0, `local returned ${L.length} openings`) }
// 5. Submit revalidation (hosted: openings.find(startsAt) at :325)
{ const db = mk(); const cases = { 'past (2020-01-07T09:00Z)': '2020-01-07T09:00:00Z', 'outside window Sat 03:00Z': '2026-10-10T03:00:00Z', 'off-grid 09:17 Lagos': '2026-10-07T08:17:00Z', 'beyond horizon': '2027-06-01T09:00:00Z' }
  for (const [k, v] of Object.entries(cases)) { let accepted = true; try { localSubmit(db, 'v', v) } catch { accepted = false } ; check(`T5 local submit rejects ${k}`, !accepted) } }
// 6. Overlap vs key uniqueness (interval change after booking)
{ const db = mk({ slot_interval_minutes: 60 }, 60); db.bookings.push({ starts_at: '2026-10-07T09:00:00.000Z', ends_at: '2026-10-07T10:00:00.000Z', reservation_key: 's|2026-10-07T09:00:00.000Z', status: 'confirmed' })
  db.schedule.slot_interval_minutes = 60; db.service.duration_minutes = 30 // owner shortens service; then interval 30 grid
  db.schedule.slot_interval_minutes = 30
  const H = ref(db, '2026-10-07', '2026-10-07'); check('T6 hosted list hides 09:30Z (overlaps 09:00-10:00 booking)', !H.some(o => o.startsAt === '2026-10-07T09:30:00.000Z'))
  let accepted = true; try { localSubmit(db, 'v', '2026-10-07T09:30:00.000Z') } catch { accepted = false }
  check('T6b local submit rejects overlapping start 09:30Z (only exact key checked)', !accepted) }
// 7. Cancel releases slot
{ const db = mk(); localSubmit(db, 'v', '2026-10-07T09:00:00.000Z'); db.bookings[0].status = 'cancelled'; db.bookings[0].reservation_key = 'released:x'
  let ok = true; try { localSubmit(db, 'v', '2026-10-07T09:00:00.000Z') } catch { ok = false }; check('T7 cancelled booking releases slot', ok) }
// 8. DST: duplicate/colliding openings
{ const wins = [{ weekday: 0, startMinute: 60, endMinute: 240 }]; const db = mk({ timezone: 'America/New_York', weekly_windows_json: JSON.stringify(wins), slot_interval_minutes: 30, minimum_notice_minutes: 0 }, 30)
  const now = new Date('2027-03-01T00:00:00Z'); const L = local(db, '2027-03-14', '2027-03-14', now)
  const dup = L.length - new Set(L.map(x => x.startsAt)).size
  check('T8 local: no duplicate startsAt on US spring-forward Sunday (TZ=' + process.env.TZ + ')', dup === 0, `${dup} duplicate(s) of ${L.length}`) }
// 9. Hosted: overlapping offered slots across spring-forward (interval==duration==90)
{ const wins = [{ weekday: 0, startMinute: 0, endMinute: 360 }]
  const H = hosted({ schedule: { timezone: 'America/New_York', slotIntervalMinutes: 90, minimumNoticeMinutes: 0, bookingHorizonDays: 365, weeklyWindows: wins }, durationMinutes: 90, fromDate: '2027-03-14', throughDate: '2027-03-14', now: new Date('2027-03-01T00:00:00Z'), busy: [] })
  let pairs = 0; for (let i = 0; i < H.length; i++) for (let j = i + 1; j < H.length; j++) if (overlaps(H[i], H[j])) pairs++
  check('T9 hosted (model): offered openings never overlap each other on DST day', pairs === 0, `${pairs} overlapping pair(s): ${H.map(o => o.localTime).join(' ')}`) }
// 10. Hosted isoDate accepts impossible dates
{ const ok = !Number.isNaN(new Date('2026-02-31T00:00:00.000Z').getTime()); check('T10 hosted isoDate rejects 2026-02-31 (regex+Date())', !ok, ok ? 'accepted; rolls to 2026-03-03' : '') }
// 11. Cap overshoot
{ const wins = [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, startMinute: 0, endMinute: 1440 })); const db = mk({ weekly_windows_json: JSON.stringify(wins), slot_interval_minutes: 5, minimum_notice_minutes: 0 }, 5)
  const L = local(db, '2026-10-07', '2026-10-12', NOW), H = ref(db, '2026-10-07', '2026-10-12')
  check('T11 caps: local<=100, hosted<=200 hold exactly', L.length <= 100 && H.length <= 200, `local=${L.length} (cap 100) hosted=${H.length} (cap 200)`) }
console.log(`\nSUMMARY TZ=${process.env.TZ}: ${pass} pass, ${fail} fail`)
