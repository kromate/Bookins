import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyScheduleToDays,
  copyDaysInto,
  INTERVAL_CHOICES,
  dayIssue,
  durationWords,
  intervalFromQuery,
  intervalLabel,
  intervalOptionsFor,
  smallestIntervalFor,
  daysSignature,
  makeDays,
  summarizeHours,
  weeklyHoursTotal,
  weeklyWindowsFromDays,
  windowsAreSaveable,
} from '../weekly-hours.js'
import { OWNER_COLOR, displayName, STAFF_COLORS, memberColor, memberFirstName, memberName, nextFreeColor } from '../team-ui.js'

const schedule = (windows) => ({ weekly_windows_json: JSON.stringify(windows) })
const week = (days, startMinute, endMinute) => days.map((weekday) => ({ weekday, startMinute, endMinute }))

test('default days are Monday to Friday 09:00-17:00 and total 40 hours', () => {
  const days = makeDays()
  assert.equal(weeklyHoursTotal(days), 40)
  const windows = weeklyWindowsFromDays(days)
  assert.equal(windows.length, 5)
  assert.ok(windowsAreSaveable(windows))
  assert.equal(windowsAreSaveable([]), false)
})

test('a schedule round-trips through the editor days', () => {
  const days = makeDays()
  applyScheduleToDays(days, schedule([...week([1, 2, 3], 600, 1080), { weekday: 6, startMinute: 540, endMinute: 780 }]))
  assert.deepEqual(days.filter((day) => day.active).map((day) => day.weekday), [1, 2, 3, 6])
  assert.deepEqual(weeklyWindowsFromDays(days).at(-1), { weekday: 6, startMinute: 540, endMinute: 780 })
  assert.throws(() => applyScheduleToDays(makeDays(), { weekly_windows_json: '{}' }))
})

test('day issues match the engine rules', () => {
  const day = { name: 'Monday', weekday: 1, active: true, windows: [{ start: '10:00', end: '09:00' }] }
  assert.match(dayIssue(day), /end time after/)
  day.windows = [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }]
  assert.match(dayIssue(day), /overlap/)
  day.windows = [{ start: '', end: '12:00' }]
  assert.match(dayIssue(day), /both a start/)
  day.active = false
  assert.equal(dayIssue(day), '')
})

test('copying hours onto another set of days copies windows, not references', () => {
  const source = makeDays()
  source[1].windows = [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }]
  const target = makeDays()
  copyDaysInto(target, source)
  assert.equal(daysSignature(target), daysSignature(source))
  target[1].windows[0].start = '07:00'
  assert.notEqual(daysSignature(target), daysSignature(source))
})

test('hours are summarised in one line', () => {
  assert.deepEqual(summarizeHours(null), { text: 'No hours set', hoursPerWeek: 0, openDays: 0 })
  assert.equal(summarizeHours(schedule(week([1, 2, 3, 4, 5, 6], 600, 1080))).text, 'Mon-Sat 10:00-18:00')
  assert.equal(summarizeHours(schedule(week([1, 2, 3, 4, 5, 6], 600, 1080))).hoursPerWeek, 48)
  assert.equal(
    summarizeHours(schedule([...week([1, 2, 3], 540, 1020), ...week([6], 600, 780)])).text,
    'Mon-Wed 09:00-17:00; Sat 10:00-13:00',
  )
  assert.match(summarizeHours(schedule([1, 2, 3, 4].map((weekday, index) => ({ weekday, startMinute: 540 + index * 30, endMinute: 1020 })))).text, /hours vary/)
  assert.equal(summarizeHours({ weekly_windows_json: 'nope' }).text, 'No hours set')
})

test('member colours are stable, valid and not reused while the palette lasts', () => {
  const owner = { id: 'owner', is_owner: true }
  assert.equal(memberColor(owner), OWNER_COLOR)
  assert.equal(memberColor({ id: 'x', color: '#112233' }), '#112233')
  const derived = memberColor({ id: 'staff-abc' })
  assert.ok(STAFF_COLORS.includes(derived))
  assert.equal(derived, memberColor({ id: 'staff-abc' }))
  assert.equal(nextFreeColor([{ id: 'a', color: STAFF_COLORS[0] }]), STAFF_COLORS[1])
  assert.equal(memberName(owner), 'You')
  assert.equal(memberFirstName({ id: 's', name: 'Amaka Eze' }), 'Amaka')
})

test('the owner never borrows a team member\'s schedule', async () => {
  const { scheduleOf } = await import('../team-ui.js')
  const schedules = [{ id: 's-amaka' }]
  const staff = [{ id: 'amaka', schedule_id: 's-amaka', is_owner: false }]
  const owner = { id: 'owner', implicit: true, is_owner: true }
  assert.equal(scheduleOf({ schedules, staff }, owner), null)
  assert.equal(scheduleOf({ schedules, staff }, staff[0]).id, 's-amaka')
  assert.equal(scheduleOf({ schedules: [{ id: 's-own' }, ...schedules], staff }, owner).id, 's-own')
  assert.equal(scheduleOf({ schedules: [{ id: 's-own' }], staff: [] }, owner).id, 's-own')
})

test('interval options reach the long hair services the engine already allows', () => {
  for (const value of [150, 180, 240, 300, 360, 480]) assert.ok(INTERVAL_CHOICES.includes(value))
  assert.ok(INTERVAL_CHOICES.every((value) => value % 5 === 0 && value <= 1440))
  const options = intervalOptionsFor(240, 60)
  const enabled = options.filter((option) => !option.disabled).map((option) => option.value)
  assert.equal(Math.min(...enabled), 240)
  assert.ok(enabled.includes(480))
  assert.match(options.find((option) => option.value === 120).label, /too short/)
  assert.equal(options.find((option) => option.value === 240).label, 'Every 240 minutes (4 hours)')
})

test('no service means nothing is disabled, and a saved odd interval stays listed', () => {
  assert.ok(intervalOptionsFor(0, 60).every((option) => !option.disabled))
  const odd = intervalOptionsFor(0, 75)
  assert.ok(odd.some((option) => option.value === 75))
  assert.deepEqual(odd.map((option) => option.value), [...odd.map((option) => option.value)].sort((a, b) => a - b))
  assert.ok(intervalOptionsFor(240, 60, { strict: false }).every((option) => !option.disabled))
})

test('smallestIntervalFor picks the first interval that fits', () => {
  assert.equal(smallestIntervalFor(0), 0)
  assert.equal(smallestIntervalFor(45), 45)
  assert.equal(smallestIntervalFor(130), 150)
  assert.equal(smallestIntervalFor(240), 240)
  assert.equal(smallestIntervalFor(241), 300)
  assert.equal(smallestIntervalFor(500), 600)
  assert.equal(smallestIntervalFor(1000), 1440)
  assert.equal(smallestIntervalFor(2000), 1440)
  assert.ok(intervalOptionsFor(500, 60).find((option) => option.value === 600 && !option.disabled))
})

test('interval wording and query parsing', () => {
  assert.equal(durationWords(240), '4 hours')
  assert.equal(durationWords(150), '2.5 hours')
  assert.equal(durationWords(60), '1 hour')
  assert.equal(durationWords(45), '45 minutes')
  assert.equal(intervalLabel(60), 'Every 60 minutes')
  assert.equal(intervalFromQuery('240'), 240)
  assert.equal(intervalFromQuery(['300', '60']), 300)
  assert.equal(intervalFromQuery('242'), 0)
  assert.equal(intervalFromQuery('abc'), 0)
  assert.equal(intervalFromQuery('2000'), 0)
  assert.equal(intervalFromQuery(undefined), 0)
})

test('displayName hides the one apostrophe a formula-neutralised name carries', () => {
  assert.equal(displayName("'=SUM(1+1) Hacker nails"), '=SUM(1+1) Hacker nails')
  assert.equal(displayName("'+44 hair"), '+44 hair')
  assert.equal(displayName("'-Braids"), '-Braids')
  assert.equal(displayName("'@home visit"), '@home visit')
  assert.equal(displayName("''=x"), "''=x")
  assert.equal(displayName("'Tis the season"), "'Tis the season")
  assert.equal(displayName("Nails 'n' lashes"), "Nails 'n' lashes")
  assert.equal(displayName(undefined), '')
})
