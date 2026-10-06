import { getDemoGuest } from '../runtime.js'

export const demoGuestApi = {
  loadGuestPage: (...args) => getDemoGuest().loadGuestPage(...args),
  loadGuestOpenings: (...args) => getDemoGuest().loadGuestOpenings(...args),
  submitGuestBooking: (...args) => getDemoGuest().submitGuestBooking(...args),
}
