import type { DriveStep } from 'driver.js'

export type GuideKind = 'page' | 'task' | 'process'

export type AppGuide = {
  id: string
  title: string
  description?: string
  kind?: GuideKind
  order?: number
  disabled?: boolean
  disabledReason?: string
  steps: DriveStep[] | (() => DriveStep[])
}

export type PageGuideRegistration = {
  pageId: string
  pageTitle?: string
  guides: AppGuide[]
}
