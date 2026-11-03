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
import { useNavigate } from 'react-router-dom'
import type { DriveStep } from 'driver.js'

import 'driver.js/dist/driver.css'
import './guideTheme.css'

import type { AppGuide, PageGuideRegistration, TourStop } from './guideTypes'
import { runGuide } from './driverRunner'
import { waitForGuideTargets } from './showMe'
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

    /** Runs a tour that isn't registered by the page, e.g. one the assistant composed. */
    runSteps: (title: string, steps: DriveStep[]) => void

    /**
     * Runs a tour across several pages: opens each stop's route, waits for it to
     * load, then walks its steps. Closing it part-way calls onExit with the stop.
     */
    runTour: (stops: TourStop[], options?: RunTourOptions) => void
}

export type RunTourOptions = {
    fromStop?: number
    onStop?: (index: number) => void
    onFinish?: () => void
    onExit?: (index: number) => void
}

const GuideContext = createContext<GuideContextValue | null>(null)

export const GuideProvider = ({ children }: PropsWithChildren) => {
    const navigate = useNavigate()
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

    const runSteps = useCallback((title: string, steps: DriveStep[]) => {
        if (!steps.length) return
        setModalOpen(false)
        activeDriverRef.current?.destroy()
        activeDriverRef.current = runGuide(
            { id: 'assistant-tour', title, steps },
            {
                onDestroyed: () => {
                    activeDriverRef.current = null
                }
            }
        )
    }, [])

    // Bumped on every new tour, so a stop still loading from an older one stands down.
    const tourRunRef = useRef(0)

    const runTour = useCallback((stops: TourStop[], options: RunTourOptions = {}) => {
        const run = ++tourRunRef.current
        setModalOpen(false)

        // fromEnd: arrived with Back from the next page, so open on this page's last step.
        const play = async (index: number, fromEnd = false): Promise<void> => {
            const stop = stops[index]
            if (!stop || run !== tourRunRef.current) return
            if (window.location.pathname !== stop.route) navigate(stop.route)
            await waitForGuideTargets(stop.route)
            if (run !== tourRunRef.current) return
            options.onStop?.(index)

            const isLastStop = index === stops.length - 1
            const next = () => {
                if (isLastStop) options.onFinish?.()
                else void play(index + 1)
            }

            // Next on a page's last step moves to the next page, Back on its first step
            // to the previous one; closing ends the tour. Settled here rather than in
            // onDestroyed, which Driver.js skips when the step points at nothing.
            let settled = false
            const settle = (move: 'next' | 'back' | 'exit') => {
                if (settled) return
                settled = true
                activeDriverRef.current = null
                if (move === 'next') next()
                else if (move === 'back') void play(index - 1, true)
                else options.onExit?.(index)
            }

            const steps = typeof stop.steps === 'function' ? stop.steps() : stop.steps
            // Driver.js disables Back on a first step; past the first page it goes back a page.
            const tourSteps = index > 0 && steps.length
                ? [
                    {
                        ...steps[0],
                        popover: { ...steps[0].popover, disableButtons: [], prevBtnText: 'Previous page' }
                    },
                    ...steps.slice(1)
                ]
                : steps

            activeDriverRef.current?.destroy()
            activeDriverRef.current = runGuide(
                { id: 'multi-page-tour', title: stop.label, steps: tourSteps },
                {
                    startAt: fromEnd ? tourSteps.length - 1 : 0,
                    config: {
                        progressText: `${stop.label} · {{current}} of {{total}}`,
                        doneBtnText: isLastStop ? 'Finish' : 'Next page',
                        onNextClick: (_element, _step, { driver }) => {
                            if (!driver.isLastStep()) return driver.moveNext()
                            driver.destroy()
                            settle('next')
                        },
                        onPrevClick: (_element, _step, { driver }) => {
                            if (!driver.isFirstStep() || index === 0) return driver.movePrevious()
                            driver.destroy()
                            settle('back')
                        },
                        onCloseClick: (_element, _step, { driver }) => {
                            driver.destroy()
                            settle('exit')
                        }
                    },
                    // Escape and other ways out still end up here.
                    onDestroyed: () => settle('exit')
                }
            )
            // A stop whose steps are all missing on this screen is skipped.
            if (!activeDriverRef.current) next()
        }

        void play(options.fromStop ?? 0)
    }, [navigate])

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
            startGuideOnPage,
            runSteps,
            runTour
        }),
        [
            runSteps,
            runTour,
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
