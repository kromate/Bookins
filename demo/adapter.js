import { listServiceOpenings } from '../scheduling.js'
import { clone, createDemoDataset } from './fixtures.js'

const readOnly = () => {
  const error = new Error('Demo is read-only. Nothing was changed. Exit Demo to use this action.')
  error.code = 'DEMO_READ_ONLY'
  throw error
}

const guestPage = (dataset) => {
  const profile = dataset.profiles[0] || {}
  return {
    profile: {
      displayName: profile.display_name || 'Demo booking preview',
      bio: profile.bio || '',
      photoUrl: profile.photo_url || null,
      timezone: profile.timezone || 'UTC',
    },
    services: dataset.services
      .filter((item) => item.active !== false && item.visibility === 'public')
      .map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        durationMinutes: item.duration_minutes,
        price: item.price || 0,
        currency: item.currency || 'NGN',
      })),
  }
}

const guestOpenings = (dataset, serviceId, fromDate, throughDate, demoNow) =>
  listServiceOpenings({
    services: dataset.services,
    schedules: dataset.schedules,
    bookings: dataset.bookings,
    serviceId,
    fromDate,
    throughDate,
    now: demoNow,
  })

export const createDemoPlatform = (now = new Date()) => {
  const demoNow = new Date(now)
  const dataset = createDemoDataset(demoNow)
  const owner = {
    async loadOwnerWorkspace() {
      return {
        profile: clone(dataset.profiles[0] || null),
        schedules: clone(dataset.schedules),
        services: clone(dataset.services),
        bookings: clone(dataset.bookings),
        contacts: clone(dataset.contacts || []),
      }
    },
    async saveProfile() { return readOnly() },
    async saveSchedule() { return readOnly() },
    async saveService() { return readOnly() },
    async deleteService() { return readOnly() },
    async cancelBooking() { return readOnly() },
    async createPublicLink() { return readOnly() },
    async revokePublicLink() { return readOnly() },
    async createOwnerBooking() { return readOnly() },
    async rescheduleBooking() { return readOnly() },
    async setBookingStatus() { return readOnly() },
    async saveBookingNotes() { return readOnly() },
    async createTimeOff() { return readOnly() },
    async removeTimeOff() { return readOnly() },
    async createServiceLink() { return readOnly() },
    async revokeServiceLink() { return readOnly() },
    async saveMessageTemplates() { return readOnly() },
    async saveContact() { return readOnly() },
  }
  const guest = {
    async loadGuestPage() { return clone(guestPage(dataset)) },
    async loadGuestOpenings(serviceId, fromDate, throughDate) {
      return clone(guestOpenings(dataset, serviceId, fromDate, throughDate, demoNow))
    },
    async submitGuestBooking() { return readOnly() },
  }
  return Object.freeze({ owner: Object.freeze(owner), guest: Object.freeze(guest) })
}
