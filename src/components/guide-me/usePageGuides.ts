import { useEffect } from 'react'

import { useGuide } from './GuideContext'
import type { PageGuideRegistration } from './guideTypes'

export const usePageGuides = (
  registration: PageGuideRegistration
) => {
  const {
    registerPageGuides,
    unregisterPageGuides
  } = useGuide()

  useEffect(() => {
    registerPageGuides(registration)

    return () => {
      unregisterPageGuides(registration.pageId)
    }
  }, [
    registration,
    registerPageGuides,
    unregisterPageGuides
  ])
}
