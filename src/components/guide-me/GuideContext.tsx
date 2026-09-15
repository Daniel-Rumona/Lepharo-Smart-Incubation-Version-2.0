import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react'
import type { PropsWithChildren } from 'react'

import 'driver.js/dist/driver.css'
import './guideTheme.css'

import type { AppGuide, PageGuideRegistration } from './guideTypes'
import { runGuide } from './driverRunner'
import { GuideModal } from './GuideModal'

type GuideContextValue = {
    registration: PageGuideRegistration | null
    guides: AppGuide[]
    hasGuides: boolean
    modalOpen: boolean

    openGuideModal: () => void
    closeGuideModal: () => void

    registerPageGuides: (registration: PageGuideRegistration) => void
    unregisterPageGuides: (pageId: string) => void

    startGuide: (guideId: string) => void
    stopGuide: () => void

    /**
     * Queue a guide to auto-start once the page it belongs to registers
     * itself (e.g. after navigating there from elsewhere in the app, such
     * as the Help Assistant). No-ops if that page never registers.
     */
    startGuideOnPage: (pageId: string, guideId: string) => void
}

const GuideContext = createContext<GuideContextValue | null>(null)

export const GuideProvider = ({ children }: PropsWithChildren) => {
    const [registration, setRegistration] =
        useState<PageGuideRegistration | null>(null)

    const [modalOpen, setModalOpen] = useState(false)

    const activeDriverRef =
        useRef<ReturnType<typeof runGuide> | null>(null)

    const guides = useMemo(() => {
        return [...(registration?.guides || [])]
            .filter(Boolean)
            .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
    }, [registration])

    const registerPageGuides = useCallback(
        (nextRegistration: PageGuideRegistration) => {
            setRegistration(nextRegistration)
        },
        []
    )

    const unregisterPageGuides = useCallback((pageId: string) => {
        setRegistration(current => {
            if (!current || current.pageId !== pageId) return current
            return null
        })

        setModalOpen(false)
    }, [])

    const openGuideModal = useCallback(() => {
        setModalOpen(true)
    }, [])

    const closeGuideModal = useCallback(() => {
        setModalOpen(false)
    }, [])

    const stopGuide = useCallback(() => {
        activeDriverRef.current?.destroy()
        activeDriverRef.current = null
    }, [])

    const startGuide = useCallback(
        (guideId: string) => {
            const guide = guides.find(item => item.id === guideId)

            if (!guide || guide.disabled) return

            setModalOpen(false)

            // Let the AntD modal finish leaving the DOM before Driver.js starts.
            window.setTimeout(() => {
                activeDriverRef.current?.destroy()

                activeDriverRef.current = runGuide(guide, {
                    onDestroyed: () => {
                        activeDriverRef.current = null
                    }
                })
            }, 180)
        },
        [guides]
    )

    const pendingGuideRef =
        useRef<{ pageId: string; guideId: string } | null>(null)

    const startGuideOnPage = useCallback(
        (pageId: string, guideId: string) => {
            pendingGuideRef.current = { pageId, guideId }
        },
        []
    )

    // Runs once the target page mounts and registers its own guides
    // (e.g. after the Help Assistant navigates there for a pending request).
    useEffect(() => {
        const pending = pendingGuideRef.current

        if (!pending || registration?.pageId !== pending.pageId) return

        pendingGuideRef.current = null

        const timeout = window.setTimeout(() => {
            startGuide(pending.guideId)
        }, 250)

        return () => window.clearTimeout(timeout)
    }, [registration, startGuide])

    const value = useMemo<GuideContextValue>(
        () => ({
            registration,
            guides,
            hasGuides: guides.length > 0,
            modalOpen,
            openGuideModal,
            closeGuideModal,
            registerPageGuides,
            unregisterPageGuides,
            startGuide,
            stopGuide,
            startGuideOnPage
        }),
        [
            registration,
            guides,
            modalOpen,
            openGuideModal,
            closeGuideModal,
            registerPageGuides,
            unregisterPageGuides,
            startGuide,
            stopGuide,
            startGuideOnPage
        ]
    )

    return (
        <GuideContext.Provider value={value}>
            {children}

            <GuideModal
                open={modalOpen}
                pageTitle={registration?.pageTitle}
                guides={guides}
                onClose={closeGuideModal}
                onStart={startGuide}
            />
        </GuideContext.Provider>
    )
}

/**
 * Safe context lookup for shared shells/layouts.
 *
 * GuideLauncher uses this so an accidentally misplaced launcher never crashes
 * the application. Page-level guide registration continues to use useGuide(),
 * which remains strict because guided pages must actually be inside the
 * provider for registration to work.
 */
export const useOptionalGuide = () => useContext(GuideContext)

export const useGuide = () => {
    const context = useOptionalGuide()

    if (!context) {
        throw new Error(
            'useGuide must be used inside GuideProvider. Mount <GuideProvider> above your routed layout.'
        )
    }

    return context
}
