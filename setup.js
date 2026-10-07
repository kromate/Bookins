// Single source of truth for first-run setup progress (profile -> availability -> service -> link).
// Pages call `useSetupState()` (inside setup) or `computeSetupState(state)` (plain, e.g. tests).
import { computed, inject, unref } from 'vue'
import { hasTeam, teamMembers } from './team.js'

function openWindowCount(schedule) {
  try {
    const windows = JSON.parse(schedule?.weekly_windows_json || '[]')
    return Array.isArray(windows) ? new Set(windows.map((item) => item?.weekday)).size : 0
  } catch {
    return 0
  }
}

export function computeSetupState(state, now = Date.now()) {
  const profile = state?.profile || null
  const hasProfile = Boolean(String(profile?.display_name || '').trim())
  const hasAvailability = (state?.schedules || []).some((schedule) => openWindowCount(schedule) > 0)
  const hasService = (state?.services || []).some((item) => item.active !== false)
  const url = profile?.public_link_url || ''
  const expiry = Date.parse(profile?.public_link_expires_at || '')
  const linkExpired = Boolean(url) && Number.isFinite(expiry) && expiry <= now
  const hasLink = Boolean(url) && !linkExpired

  const steps = [
    {
      key: 'profile',
      label: 'Complete your public profile',
      to: '/settings',
      done: hasProfile,
      description: 'Your name and details appear on your booking page.',
      lockedReason: '',
    },
    {
      key: 'availability',
      label: 'Set your weekly availability',
      to: '/availability',
      done: hasAvailability,
      description: 'Choose the hours guests can book. Services use these hours.',
      lockedReason: '',
    },
    {
      key: 'service',
      label: 'Create your first service',
      to: '/services',
      done: hasService,
      description: 'Create something guests can book, with a duration and visibility.',
      lockedReason: hasAvailability ? '' : 'Needs availability',
    },
    {
      key: 'link',
      label: linkExpired ? 'Renew your expired booking link' : 'Publish your booking link',
      to: '/settings',
      done: hasLink,
      description: linkExpired
        ? 'Your booking link has expired. Create a new one so guests can book.'
        : 'Create the link guests use to book with you.',
      lockedReason: '',
    },
  ]
  const pending = steps.find((step) => !step.done)
  const nextStep = pending
    ? { key: pending.key, label: pending.label, to: pending.to, description: pending.description }
    : { key: 'done', label: 'Review your booking page', to: '/settings', description: 'Everything is set up. Share your link to start taking bookings.' }
  const completed = steps.filter((step) => step.done).length
  return {
    hasProfile,
    hasAvailability,
    hasService,
    hasLink,
    linkExpired,
    steps,
    nextStep,
    isComplete: completed === steps.length,
    completed,
    total: steps.length,
    progress: Math.round((completed / steps.length) * 100),
    canCreateService: hasAvailability,
    // Teams are optional and not a setup step: 1 means just the owner.
    hasTeam: hasTeam(state),
    teamSize: teamMembers(state || {}).length,
  }
}

// Reactive version. Optionally pass the workspace state (reactive object or ref); defaults to the injected one.
export function useSetupState(stateArg) {
  const source = stateArg || inject('bookingState', null)
  const clock = inject('setupNow', null)
  return computed(() => computeSetupState(unref(source), unref(clock) || Date.now()))
}
