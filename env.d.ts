/// <reference types="vite/client" />

import type {
  BookingRecord as BookinsBookingRecord,
  BookingSubject as BookinsBookingSubject,
  CampaignRecord as BookinsCampaignRecord,
  ContactInput as BookinsContactInput,
  ContactRecord as BookinsContactRecord,
  EditableDay as BookinsEditableDay,
  EditableWindow as BookinsEditableWindow,
  GoalmaticAppRuntime,
  GoalmaticAuthRuntime,
  GoalmaticDataRuntime,
  GoalmaticSharesRuntime,
  OfferRecord as BookinsOfferRecord,
  Opening as BookinsOpening,
  PlatformErrorShape as BookinsPlatformErrorShape,
  PlatformAccount as BookinsPlatformAccount,
  PlatformResult as BookinsPlatformResult,
  PresentedService as BookinsPresentedService,
  ProfileRecord as BookinsProfileRecord,
  ScheduleModel as BookinsScheduleModel,
  ScheduleRecord as BookinsScheduleRecord,
  ServiceMeta as BookinsServiceMeta,
  ServiceRecord as BookinsServiceRecord,
  StaffRecord as BookinsStaffRecord,
  TimeRange as BookinsTimeRange,
  TimestampInput as BookinsTimestampInput,
  UnknownRecord as BookinsUnknownRecord,
  ToastApi as BookinsToastApi,
  ToastOptions as BookinsToastOptions,
  WeeklyWindow as BookinsWeeklyWindow,
  WorkspaceState as BookinsWorkspaceState,
} from './types'

declare module '@vue/runtime-dom' {
  interface HTMLAttributes {
    [attribute: `data-${string}`]: unknown
  }
}

declare global {
  type BookingRecord = BookinsBookingRecord
  type BookingSubject = BookinsBookingSubject
  type CampaignRecord = BookinsCampaignRecord
  type ContactInput = BookinsContactInput
  type ContactRecord = BookinsContactRecord
  type EditableDay = BookinsEditableDay
  type EditableWindow = BookinsEditableWindow
  type OfferRecord = BookinsOfferRecord
  type Opening = BookinsOpening
  type PlatformErrorShape = BookinsPlatformErrorShape
  type PlatformAccount = BookinsPlatformAccount
  type PlatformResult = BookinsPlatformResult
  type PresentedService = BookinsPresentedService
  type ProfileRecord = BookinsProfileRecord
  type ScheduleModel = BookinsScheduleModel
  type ScheduleRecord = BookinsScheduleRecord
  type ServiceMeta = BookinsServiceMeta
  type ServiceRecord = BookinsServiceRecord
  type StaffRecord = BookinsStaffRecord
  type TimeRange = BookinsTimeRange
  type TimestampInput = BookinsTimestampInput
  type UnknownRecord = BookinsUnknownRecord
  type ToastApi = BookinsToastApi
  type ToastOptions = BookinsToastOptions
  type RefreshWorkspace = import('./types').RefreshWorkspace
  type WeeklyWindow = BookinsWeeklyWindow
  type WorkspaceState = BookinsWorkspaceState

  interface Window {
    GoalmaticApp?: GoalmaticAppRuntime
    GoalmaticData?: GoalmaticDataRuntime
    GoalmaticShares?: GoalmaticSharesRuntime
    GoalmaticAuth?: GoalmaticAuthRuntime
    GoalmaticCredits?: { refresh?(): Promise<unknown> }
    GoalmaticGuest?: GoalmaticAppRuntime
  }
  interface Navigator {
    connection?: { effectiveType?: string; saveData?: boolean }
  }
}

export {}
