import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import type { DriveStep } from 'driver.js'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useOptionalGuide } from './GuideContext'
import { guideTarget } from './guideTargets'

/**
 * A short "what's new" walkthrough of the redesigned workspace, started once on
 * each person's first visit after the redesign. Bump TOUR_ID to show a later
 * round of changes to everyone again.
 */
const TOUR_ID = 'whatsNew2026Layout'

const localKey = (uid: string) => `lph.${TOUR_ID}.${uid}`

// Pages with their own full-screen chrome, where the top bar is not shown.
const SKIP_PATHS = [/^\/welcome/, /^\/chat/, /\/builder(?:\/|$)/, /^\/whatsapp-consent/]

const visible = (selector: string) => {
    const element = document.querySelector<HTMLElement>(selector)
    return !!element && element.getClientRects().length > 0
}

/** Steps for what is on screen now: phones have a bottom bar instead of top tabs. */
const buildSteps = (): DriveStep[] => {
    const isMobile = !visible('.workspace-primary-nav') && visible('.workspace-bottom-nav')
    const steps: DriveStep[] = [
        {
            popover: {
                title: 'Welcome to the new look',
                description:
                    'We have redesigned the workspace to give your work more room. This takes under a minute and shows you what moved.'
            }
        }
    ]

    if (isMobile) {
        steps.push({
            element: '.workspace-bottom-nav',
            popover: {
                title: 'Your pages are along the bottom',
                description:
                    'The side menu is gone. Your main pages are in this bar, and everything else is under More.',
                side: 'top',
                align: 'center'
            }
        })
    } else if (visible('.workspace-primary-nav')) {
        steps.push({
            element: '.workspace-primary-nav',
            popover: {
                title: 'Navigation has moved to the top bar',
                description:
                    'The side menu is gone. Your main pages are now tabs along the top, and the rest are under More, so pages use the full width of the screen.',
                side: 'bottom',
                align: 'start'
            }
        })
    }

    if (visible('.account-menu-trigger')) {
        steps.push({
            element: '.account-menu-trigger',
            popover: {
                title: 'Light, dark and your colour',
                description:
                    'Open your account menu and go to Appearance to switch between light and dark mode (or follow your device), and to pick an accent colour.',
                side: 'bottom',
                align: 'end'
            }
        })
    }

    if (visible(guideTarget('language-switch'))) {
        steps.push({
            element: guideTarget('language-switch'),
            popover: {
                title: 'Choose your language',
                description: 'Switch the language the platform is shown in. Your choice is remembered next time.',
                side: 'bottom',
                align: 'end'
            }
        })
    }

    steps.push({
        popover: {
            title: 'Pages have a new layout too',
            description:
                'Most pages have been rearranged to fit the wider space, so some buttons and filters sit in new places. If you cannot find something, open your account menu and choose Guide for this page.'
        }
    })

    if (visible('.account-menu-trigger')) {
        steps.push({
            element: '.account-menu-trigger',
            popover: {
                title: 'That is it',
                description: 'You can come back to page guides from your account menu at any time.',
                side: 'bottom',
                align: 'end'
            }
        })
    }

    return steps
}

/** Mounted once in the workspace layout; starts the tour on a first visit. */
export const WhatsNewTour = () => {
    const { user, isViewingAs } = useFullIdentity()
    const guide = useOptionalGuide()
    const location = useLocation()
    const startedRef = useRef(false)
    const uid = user?.uid || ''

    const seen = (() => {
        if (!uid) return true
        if ((user as any)?.welcomeTours?.[TOUR_ID]?.status) return true
        try {
            return !!localStorage.getItem(localKey(uid))
        } catch {
            return false
        }
    })()

    const skipHere = SKIP_PATHS.some(pattern => pattern.test(location.pathname))

    useEffect(() => {
        if (!guide || !uid || isViewingAs || seen || skipHere || startedRef.current) return

        const save = (status: 'completed' | 'dismissed') => {
            try {
                localStorage.setItem(localKey(uid), status)
            } catch {
                // Firestore still has it.
            }
            setDoc(
                doc(db, 'users', uid),
                { welcomeTours: { [TOUR_ID]: { status, updatedAt: serverTimestamp() } } },
                { merge: true }
            ).catch(error => console.warn('Could not save the what is new tour', error))
        }

        // Give the page a moment to settle so the top bar is in place.
        const timer = window.setTimeout(() => {
            if (startedRef.current || !document.querySelector('.workspace-topbar')) return
            startedRef.current = true
            guide.runTour(
                [{ route: window.location.pathname, label: "What's new", steps: buildSteps }],
                {
                    onFinish: () => save('completed'),
                    // Closing early counts as seen: it is shown once, not nagged.
                    onExit: () => save('dismissed')
                }
            )
        }, 1500)
        return () => window.clearTimeout(timer)
    }, [guide, uid, isViewingAs, seen, skipHere])

    return null
}

export default WhatsNewTour
