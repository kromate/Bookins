import { readonly, ref } from 'vue'

const MODES = new Set(['live', 'demo'])
const LIVE_MUTATIONS = new Set([
  'saveProfile',
  'saveSchedule',
  'saveService',
  'deleteService',
  'cancelBooking',
  'createPublicLink',
  'revokePublicLink',
  'createOwnerBooking',
  'rescheduleBooking',
  'setBookingStatus',
  'saveBookingNotes',
  'createTimeOff',
  'removeTimeOff',
  'createServiceLink',
  'revokeServiceLink',
  'saveMessageTemplates',
  'saveContact',
  'saveStaff',
  'deactivateStaff',
  'reactivateStaff',
  'createStaffServices',
  'deleteStaffServiceCopies',
  'assignBookingStaff',
  'bulkAssignStaff',
  'markMessageOpened',
  'saveCampaign',
  'deleteCampaign',
  'touchCampaign',
  'setMarketingOptOut',
  'recordOffer',
  'markCampaignRecipientOpened',
])

const isExplicitRejection = (error) =>
  error?.outcome === 'rejected' || error?.outcome === 'not_started'

export function createDemoBoundary({ initialMode = 'live' } = {}) {
  const activeMode = ref(MODES.has(initialMode) ? initialMode : 'live')
  const pending = ref(0)
  const uncertain = ref(false)
  const switchFailure = ref('')
  const guards = new Map()

  const invokeOwner = async (name, liveCall, demoCall) => {
    if (activeMode.value === 'demo') return demoCall()
    pending.value += 1
    try {
      return await liveCall()
    } catch (error) {
      if (LIVE_MUTATIONS.has(name) && !isExplicitRejection(error)) uncertain.value = true
      throw error
    } finally {
      pending.value -= 1
    }
  }

  const registerGuard = (id, getReason) => {
    const entry = { getReason }
    guards.set(id, entry)
    return () => {
      if (guards.get(id) === entry) guards.delete(id)
    }
  }

  const switchMode = (next) => {
    switchFailure.value = ''
    if (!MODES.has(next)) {
      switchFailure.value = `Invalid next mode: ${String(next)}.`
      return false
    }
    if (next === activeMode.value) return false
    if (pending.value) {
      switchFailure.value = 'Wait for live operations to finish before switching modes.'
      return false
    }
    if (uncertain.value) {
      switchFailure.value = 'An earlier change could not be confirmed. Reload and check its result before switching.'
      return false
    }
    for (const { getReason } of guards.values()) {
      const reason = getReason()
      if (typeof reason === 'string' && reason.trim()) {
        switchFailure.value = reason.trim()
        return false
      }
    }
    activeMode.value = next
    return true
  }

  return {
    mode: readonly(activeMode),
    pendingLive: readonly(pending),
    uncertainLiveWrite: readonly(uncertain),
    switchError: readonly(switchFailure),
    invokeOwner,
    registerGuard,
    switchMode,
  }
}
