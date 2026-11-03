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

/** One page of a multi-page tour. */
export type TourStop = {
  route: string
  /** Shown in the progress line, e.g. "Interventions · 1 of 3". */
  label: string
  /** A function is called once the page has loaded, so steps can match what is on it. */
  steps: DriveStep[] | (() => DriveStep[])
}
