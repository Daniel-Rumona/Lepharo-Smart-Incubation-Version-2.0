import { driver } from 'driver.js'
import type { AppGuide } from './guideTypes'

type RunGuideOptions = {
  onDestroyed?: () => void
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

    onDestroyed: () => {
      options.onDestroyed?.()
    }
  })

  driverObj.drive()

  return driverObj
}
