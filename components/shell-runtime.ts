// Shell-level Goalmatic runtime reads shared by the workspace menu and credits pill.
// Contracts mirror Social Studio (src/composables/useSocialStudio.js): GoalmaticApp.getAccounts() / switchAccount(id),
// GoalmaticCredits.refresh() or execute('billing.credits-status'). Anything the runtime does not expose stays empty,
// and the UI that depends on it is omitted rather than faked.
import { computed, ref } from 'vue'

export const APPS_URL = 'https://goalmatic.io/dashboard/apps'
export const BILLING_URL = 'https://goalmatic.io/settings/billing'

interface WorkspaceAccount extends PlatformAccount { current?: boolean }
interface CreditSummary extends UnknownRecord {
  paymentVerificationRequired?: boolean
  canGenerate?: boolean
  unlimited?: boolean
  remaining?: number
  balance?: number
  planRemaining?: number
  subscriptionRemaining?: number
  purchasedRemaining?: number
}

const accounts = ref<WorkspaceAccount[]>([])
const credits = ref<CreditSummary | number | null>(null)
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
    if (generation === accountGeneration) accounts.value = Array.isArray(list)
      ? list.flatMap((account): WorkspaceAccount[] => account && typeof account === 'object' ? [account as WorkspaceAccount] : [])
      : []
  } catch {
    if (generation === accountGeneration) accounts.value = []
  }
  return accounts.value
}

export async function switchAccount(account: WorkspaceAccount) {
  const runtime = app()
  if (typeof runtime?.switchAccount !== 'function') throw new Error('Workspace switching is available inside the installed App.')
  if (!account.id) throw new Error('Choose a workspace to switch to.')
  await runtime.switchAccount(account.id)
  accounts.value = accounts.value.map((item) => ({ ...item, current: item.id === account.id }))
}

export async function loadCredits() {
  const runtime = app()
  const creditApi = typeof window === 'undefined' ? null : window.GoalmaticCredits
  const execute = runtime?.execute
  if (typeof creditApi?.refresh !== 'function' && typeof execute !== 'function') {
    credits.value = null
    return null
  }
  const generation = ++creditGeneration
  try {
    const value =
      typeof creditApi?.refresh === 'function'
        ? await creditApi.refresh()
        : typeof execute === 'function'
          ? await execute('billing.credits-status', {}, { capabilityId: 'billing.credits-status' })
          : null
    if (generation === creditGeneration) credits.value = typeof value === 'number' || (value && typeof value === 'object') ? value as CreditSummary | number : null
  } catch {
    if (generation === creditGeneration) credits.value = null
  }
  return credits.value
}

// { label, caption, rows[], review } or null when the runtime gave no usable balance.
export function describeCredits(value: CreditSummary | number | null | undefined) {
  if (value == null) return null
  const record: CreditSummary = typeof value === 'number' ? {} : value
  const review = Boolean(record.paymentVerificationRequired)
  const blocked = review && record.canGenerate === false
  let label: number | string | null = null
  if (typeof value === 'number') label = value
  else if (record.unlimited) label = 'Unlimited'
  else {
    const remaining = record.remaining ?? record.balance
    if (typeof remaining === 'number' && Number.isFinite(remaining)) label = remaining
  }
  if (label == null && !blocked) return null
  const rows = [
    ['Plan credits', record.planRemaining ?? record.subscriptionRemaining] as const,
    ['Purchased credits', record.purchasedRemaining] as const,
  ]
    .filter(([, amount]) => typeof amount === 'number' && Number.isFinite(amount))
    .map(([name, amount]) => ({ name, amount: Number(amount).toLocaleString() }))
  const text = typeof label === 'number' ? label.toLocaleString() : label
  return blocked
    ? { label: 'Billing review', caption: 'required', rows, review: true }
    : { label: text, caption: label === 'Unlimited' ? 'credits' : 'credits available', rows, review }
}
