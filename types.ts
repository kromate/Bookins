export type UnknownRecord = Record<string, unknown>
export type TimestampInput = string | number | Date | { toDate(): Date } | { _seconds: number; _nanoseconds?: number } | null | undefined
export type MaybePromise<T> = T | Promise<T>
export interface ToastOptions {
  kind?: 'success' | 'error' | 'info'
  duration?: number
  action?: { label: string; onClick(): void }
}
export interface ToastApi {
  (message: string, options?: ToastOptions): number | undefined
  success(message: string): number | void
  error(message: string): number | void
  info(message: string): number | void
  dismiss(id: number): void
}
export type RefreshWorkspace = (options?: { silent?: boolean } | Event) => Promise<boolean>

export interface ProfileRecord {
  id?: string
  display_name?: string
  bio?: string
  photo_url?: string
  timezone?: string
  public_link_url?: string
  public_link_expires_at?: string
  message_templates_json?: string
  booking_page_settings_json?: string
  booking_theme?: string
  booking_layout?: string
  calendar_connected?: boolean | string | number
  updated_at?: string
  [key: string]: unknown
}

export interface WeeklyWindow { weekday: number; startMinute: number; endMinute: number }
export interface ScheduleRecord {
  id?: string
  name?: string
  timezone?: string
  slot_interval_minutes?: number | string
  minimum_notice_minutes?: number | string
  booking_horizon_days?: number | string
  weekly_windows_json?: string
  active?: boolean | string | number
  revision?: number | string
  updated_at?: string
  [key: string]: unknown
}
export interface ScheduleModel {
  timezone: string
  slotIntervalMinutes: number
  minimumNoticeMinutes: number
  bookingHorizonDays: number
  weeklyWindows: WeeklyWindow[]
}
export interface TimeRange { startsAt: string; endsAt: string }
export interface Opening extends TimeRange { timezone: string; localDate: string; localTime: string }

export interface ServiceMeta {
  c?: string
  o?: number
  s?: string
  n?: string
  p?: string
  b?: string
}
export interface ServiceRecord {
  id?: string
  slug?: string
  name?: string
  description?: string
  duration_minutes?: number | string
  price?: number | string
  currency?: string
  schedule_id?: string
  visibility?: string
  location?: string
  active?: boolean | string | number
  revision?: number | string
  updated_at?: string
  category?: string
  sort_order?: number | string
  rebook_after_days?: number | string
  prep_notes?: string
  public_link_url?: string
  public_link_expires_at?: string
  [key: string]: unknown
}
export interface PresentedService extends ServiceRecord {
  description: string
  category: string
  sortOrder: number
  staffId: string
  staffName: string
  baseId: string
  prepNotes: string
}

export interface BookingRecord {
  id?: string
  reference?: string
  service_id?: string
  service_name?: string
  schedule_id?: string
  staff_id?: string
  staff_name?: string
  starts_at?: TimestampInput
  ends_at?: TimestampInput
  timezone?: string
  status?: string
  guest_name?: string
  guest_email?: string
  guest_phone?: string
  notes?: string
  owner_notes?: string
  source?: string
  created_at?: TimestampInput
  updated_at?: TimestampInput
  reminder_opened_at?: string
  followup_opened_at?: string
  reminder24_opened_at?: string
  reminder2_opened_at?: string
  rebook_opened_at?: string
  calendar_event_id?: string
  calendar_sync_status?: string
  calendar_sync_error?: string
  management_token?: string
  management_token_hash?: string
  management_expires_at?: string
  reservation_key?: string
  cancelled_at?: string
  cancellation_reason?: string
  series_id?: string
  prep_opened_at?: string
  [key: string]: unknown
}

export interface ContactRecord {
  id?: string
  name?: string
  email?: string
  phone?: string
  tags_json?: string
  notes?: string
  marketing_opt_out?: boolean | string | number
  marketing_opt_out_at?: string
  last_campaign_at?: string
  offers_json?: string
  created_at?: TimestampInput
  updated_at?: TimestampInput
  [key: string]: unknown
}
export interface OfferRecord { code: string; status: 'offered' | 'redeemed'; at: string }

export interface StaffRecord {
  id?: string
  implicit?: boolean
  removed?: boolean
  name?: string
  role?: string
  photo_url?: string
  color?: string
  phone?: string
  email?: string
  active?: boolean | string | number
  schedule_id?: string
  service_ids_json?: string
  is_owner?: boolean | string | number
  revision?: number | string
  updated_at?: string
  [key: string]: unknown
}

export interface CampaignRecord {
  id?: string
  name?: string
  segment_json?: string
  template_json?: string
  offer_text?: string
  offer_code?: string
  status?: string
  audience_count?: number | string
  created_at?: TimestampInput
  last_opened_at?: string
  [key: string]: unknown
}

export interface WorkspaceState {
  profile: ProfileRecord | null
  profiles?: ProfileRecord[]
  schedules: ScheduleRecord[]
  services: ServiceRecord[]
  bookings: BookingRecord[]
  contacts: ContactRecord[]
  staff: StaffRecord[]
  campaigns: CampaignRecord[]
}

export interface EditableWindow { start: string; end: string }
export interface EditableDay { name: string; weekday: number; active: boolean; windows: EditableWindow[] }
export interface BookingSubject { kind: 'profile' | 'service'; serviceId?: string }
export interface ContactInput { name?: string; email?: string; phone?: string }

export interface PlatformErrorShape extends Error {
  code?: string
  status?: number
  retryable?: boolean
  outcome?: unknown
}
export interface PlatformResult extends UnknownRecord {
  id?: string
  record?: UnknownRecord
  records?: UnknownRecord[]
  complete?: boolean
  outcome?: unknown
  url?: string
}
export interface PlatformAccount extends UnknownRecord { id?: string; name?: string; displayName?: string }
export interface GoalmaticAppRuntime {
  execute?(operationId: string, input?: UnknownRecord, options?: UnknownRecord): Promise<unknown>
  ready?(): Promise<unknown>
  query?(action: string, input?: UnknownRecord): Promise<unknown>
  command?(action: string, input?: UnknownRecord, options?: UnknownRecord): Promise<unknown>
  getAccounts?(): Promise<unknown>
  switchAccount?(accountId: string): Promise<unknown>
  getCredits?(): Promise<unknown>
  getSession?(): Promise<unknown>
  cache?: { get?(key: string): string | null | undefined; set?(key: string, value: string): void; remove?(key: string): void }
}
export interface GoalmaticDataRuntime {
  listRecords?(request: UnknownRecord): Promise<unknown>
  createRecord?(request: UnknownRecord): Promise<unknown>
  updateRecord?(request: UnknownRecord): Promise<unknown>
  deleteRecord?(request: UnknownRecord): Promise<unknown>
  fetchAll?(table: string, options?: UnknownRecord): Promise<unknown>
  submit?(table: string, value: UnknownRecord, options?: UnknownRecord): Promise<unknown>
  update?(table: string, id: string, value: UnknownRecord, options?: UnknownRecord): Promise<unknown>
  remove?(table: string, id: string, options?: UnknownRecord): Promise<unknown>
}
export interface GoalmaticSharesRuntime {
  create?(subject: BookingSubject, options?: UnknownRecord): Promise<unknown>
  revoke?(token: string): Promise<unknown>
}
export interface GoalmaticAuthRuntime {
  user?: UnknownRecord
  config?: UnknownRecord & { sessionPersistenceWarning?: string; installationAuth?: unknown }
  getUser?(): Promise<unknown>
  retrySessionPersistence?(): Promise<unknown>
  onAuthChange?(handler: (event: unknown) => void): (() => void) | void
  onSessionWarning?(handler: (event: unknown) => void): (() => void) | void
  refresh?(): Promise<unknown>
  signIn?(): Promise<unknown>
}
