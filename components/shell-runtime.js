// Shell-level Goalmatic runtime reads shared by the workspace menu and credits pill.
// Contracts mirror Social Studio (src/composables/useSocialStudio.js): GoalmaticApp.getAccounts() / switchAccount(id),
// GoalmaticCredits.refresh() or execute('billing.credits-status'). Anything the runtime does not expose stays empty,
// and the UI that depends on it is omitted rather than faked.
import { computed, ref } from 'vue'

export const APPS_URL = 'https://goalmatic.io/dashboard/apps'
export const BILLING_URL = 'https://goalmatic.io/settings/billing'

const accounts = ref([])
const credits = ref(null)
let accountGeneration = 0
let creditGeneration = 0

const app = () => (typeof window === 'undefined' ? null : window.GoalmaticApp || null)

export const workspaceAccounts = computed(() => accounts.value)
export const creditsBalance = credits
export const canSwitchWorkspaces = () => typeof app()?.switchAccount === 'function' && typeof app()?.getAccounts === 'function'

export function resetShellRuntime() {
  accountGeneration++
  creditGeneration++
  accounts.value = []
  credits.value = null
}

export async function loadAccounts() {
  const runtime = app()
  if (typeof runtime?.getAccounts !== 'function') {
    accounts.value = []
    return accounts.value
  }
  const generation = ++accountGeneration
  try {
    const list = await runtime.getAccounts()
    if (generation === accountGeneration) accounts.value = Array.isArray(list) ? list : []
  } catch {
    if (generation === accountGeneration) accounts.value = []
  }
  return accounts.value
}

export async function switchAccount(account) {
  const runtime = app()
  if (typeof runtime?.switchAccount !== 'function') throw new Error('Workspace switching is available inside the installed App.')
  await runtime.switchAccount(account.id)
  accounts.value = accounts.value.map((item) => ({ ...item, current: item.id === account.id }))
}

export async function loadCredits() {
  const runtime = app()
  const creditApi = typeof window === 'undefined' ? null : window.GoalmaticCredits
  if (typeof creditApi?.refresh !== 'function' && typeof runtime?.execute !== 'function') {
    credits.value = null
    return null
  }
  const generation = ++creditGeneration
  try {
    const value =
      typeof creditApi?.refresh === 'function'
        ? await creditApi.refresh()
        : await runtime.execute('billing.credits-status', {}, { capabilityId: 'billing.credits-status' })
    if (generation === creditGeneration) credits.value = value ?? null
  } catch {
    if (generation === creditGeneration) credits.value = null
  }
  return credits.value
}

// { label, caption, rows[], review } or null when the runtime gave no usable balance.
export function describeCredits(value) {
  if (value == null) return null
  const review = Boolean(value.paymentVerificationRequired)
  const blocked = review && value.canGenerate === false
  let label = null
  if (typeof value === 'number') label = value
  else if (value.unlimited) label = 'Unlimited'
  else {
    const remaining = value.remaining ?? value.balance
    if (typeof remaining === 'number' && Number.isFinite(remaining)) label = remaining
  }
  if (label == null && !blocked) return null
  const rows = [
    ['Plan credits', value.planRemaining ?? value.subscriptionRemaining],
    ['Purchased credits', value.purchasedRemaining],
  ]
    .filter(([, amount]) => typeof amount === 'number' && Number.isFinite(amount))
    .map(([name, amount]) => ({ name, amount: amount.toLocaleString() }))
  const text = typeof label === 'number' ? label.toLocaleString() : label
  return blocked
    ? { label: 'Billing review', caption: 'required', rows, review: true }
    : { label: text, caption: label === 'Unlimited' ? 'credits' : 'credits available', rows, review }
}
