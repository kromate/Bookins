import { getDemoGuest } from '../runtime.ts'

export const demoGuestApi = {
  loadGuestPage: () => getDemoGuest().loadGuestPage(),
  loadGuestOpenings: (serviceId: string, fromDate: string, throughDate: string) => getDemoGuest().loadGuestOpenings(serviceId, fromDate, throughDate),
  submitGuestBooking: (_input: UnknownRecord, _idempotencyKey: string) => getDemoGuest().submitGuestBooking(),
}
