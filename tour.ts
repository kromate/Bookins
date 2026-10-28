// Whether the owner has seen (taken or dismissed) the product tour offer. Shared by ProductTour and the Today page,
// which shows the offer inline instead of as a floating card.
const SEEN_KEY = 'bookins:tour-seen:v1'

export function readTourSeen() {
  try { return globalThis.localStorage?.getItem(SEEN_KEY) === '1' } catch { return false }
}

export function writeTourSeen() {
  try { globalThis.localStorage?.setItem(SEEN_KEY, '1') } catch { /* storage unavailable: the offer may repeat; the tour still works */ }
}
