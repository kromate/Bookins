export interface FeedbackWidgetConfig extends UnknownRecord {
  title?: string
  greeting?: string
  accent?: string
  logoUrl?: string
  font?: string
  delivery?: string
  capture?: UnknownRecord
}

export interface FeedbackWidgetHandle {
  host: HTMLElement
  open(): void
  update(value: UnknownRecord): void
  destroy(): void
}

export function sanitizePublicWidgetConfig(value: UnknownRecord, fallback?: FeedbackWidgetConfig): FeedbackWidgetConfig
export function postFeedback(endpoint: string, payload: UnknownRecord, delivery: string): Promise<unknown>
export function mountFeedbackWidget(options: UnknownRecord): FeedbackWidgetHandle
export function boot(options?: UnknownRecord): unknown
export function normalizeWidget(value: unknown): unknown
export function placementGeometry(value: unknown): unknown
export function resolveWidgetPlacement(value: unknown): unknown
