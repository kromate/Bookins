// Typed facade over the byte-exact generated Feedback Studio runtime.
export {
  boot,
  mountFeedbackWidget,
  normalizeWidget,
  placementGeometry,
  postFeedback,
  resolveWidgetPlacement,
  sanitizePublicWidgetConfig,
} from './feedback-widget-runtime.js'
export type { FeedbackWidgetConfig, FeedbackWidgetHandle } from './feedback-widget-runtime.js'
