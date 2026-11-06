import { driver } from 'driver.js'
import type { Config } from 'driver.js'
import type { AppGuide } from './guideTypes'

type RunGuideOptions = {
  onDestroyed?: () => void
  /** Overrides for this run, e.g. a multi-page tour's own buttons and Next handling. */
  config?: Partial<Config>
  /** The step to open on, e.g. the last one when going back a page. */
  startAt?: number
}

export const runGuide = (
  guide: AppGuide,
  options: RunGuideOptions = {}
) => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  const steps =
    typeof guide.steps === 'function'
      ? guide.steps()
      : guide.steps

  if (!steps.length) return null

  const driverObj = driver({
    animate: true,
    duration: 350,

    showProgress: true,
    progressText: '{{current}} of {{total}}',

    smoothScroll: true,
    allowScroll: true,
    allowKeyboardControl: true,

    // Keep the explicit close button working, but do not destroy the tour
    // when the user interacts with an AntD dropdown/picker rendered in a portal.
    allowClose: true,
    overlayClickBehavior: () => {
      // Intentionally do nothing.
      // AntD Select/DatePicker/Dropdown content is commonly rendered outside
      // the highlighted element, so those clicks must not terminate Guide Me.
    },

    overlayColor: '#0f172a',
    overlayOpacity: isDark ? 0.72 : 0.56,

    stagePadding: isDark ? 10 : 8,
    stageRadius: 12,
    popoverOffset: 12,

    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',

    popoverClass: 'lph-guide-popover',

    // Role/state-specific controls may legitimately be absent.
    skipMissingElement: true,

    steps,

    ...options.config,

    onDestroyed: () => {
      options.onDestroyed?.()
    }
  })

  driverObj.drive(Math.min(Math.max(options.startAt ?? 0, 0), steps.length - 1))

  return driverObj
}
