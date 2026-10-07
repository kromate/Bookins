// Pure record predicates shared by booking.js, messaging.js, team.js and campaigns.js.
// Kept free of Vue and window access so it can be imported anywhere (including tests).

// Reserved `.invalid` domain (RFC 2606): never deliverable, never someone else's mailbox.
export const PLACEHOLDER_EMAIL_DOMAIN = 'bookins.invalid'
export const TIME_OFF_SERVICE_ID = 'time-off'
export const OWNER_STATUSES = ['confirmed', 'completed', 'no_show']

/**
 * Owner time off is stored as a `blocked` booking so the hosted engine treats it as busy.
 * `isTimeOff` matches every time-off record, including removed (cancelled) ones, so pages can
 * exclude them from clients and metrics. `isActiveTimeOff` matches only blocks still in force.
 */
export const isActiveTimeOff = (booking) => booking?.status === 'blocked'
export const isTimeOff = (booking) => isActiveTimeOff(booking) || booking?.service_id === TIME_OFF_SERVICE_ID
/** A real appointment that still holds its time (not cancelled, not time off). */
export const isActiveBooking = (booking) => OWNER_STATUSES.includes(booking?.status)
export const hasRealEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '')) &&
  !String(email).toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`)

export function contactTags(contact) {
  try {
    const tags = JSON.parse(contact?.tags_json || '[]')
    return Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string') : []
  } catch {
    return []
  }
}

export const isTruthyFlag = (value) => value === true || value === 'true' || value === 1 || value === '1'

/** Parsed `offers_json` of a contact: [{ code, status: 'offered' | 'redeemed', at }]. */
export function contactOffers(contact) {
  try {
    const offers = JSON.parse(contact?.offers_json || '[]')
    return Array.isArray(offers)
      ? offers.filter((item) => item && typeof item.code === 'string' && item.code).map((item) => ({
          code: item.code,
          status: item.status === 'redeemed' ? 'redeemed' : 'offered',
          at: typeof item.at === 'string' ? item.at : '',
        }))
      : []
  } catch {
    return []
  }
}

export const isOptedOut = (contact) => isTruthyFlag(contact?.marketing_opt_out)
