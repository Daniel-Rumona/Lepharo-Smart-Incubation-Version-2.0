import { useCallback, useEffect, useState } from 'react'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useOptionalGuide } from './GuideContext'
import { guideTarget } from './guideTargets'
import type { TourStop } from './guideTypes'

/**
 * The walkthrough a new SME is offered on their first visit to My Home, after the
 * welcome wizard. Scripted rather than composed by the assistant, so it is the same
 * for everyone and works even when the assistant is down. Each stop opens its page;
 * missing targets (an empty list, a hidden button on phones) are skipped.
 */
export const SME_WELCOME_TOUR: TourStop[] = [
    {
        route: '/incubatee',
        label: 'My Home',
        steps: [
            {
                popover: {
                    title: 'Welcome to Smart Incubation',
                    description:
                        'This short tour shows you where everything is: about two minutes, five pages. You can close it at any time and carry on later from your account menu.'
                }
            },
            {
                element: guideTarget('incubatee-dashboard-metrics'),
                popover: {
                    title: 'Your progress at a glance',
                    description: 'How many interventions you are on, what is outstanding and what you have completed.',
                    side: 'bottom',
                    align: 'start'
                }
            },
            {
                element: guideTarget('incubatee-needs-attention'),
                popover: {
                    title: 'Things waiting on you',
                    description:
                        'Work to confirm, agreements and surveys to sign, and appointments to answer appear here. When nothing needs you, it disappears.',
                    side: 'bottom',
                    align: 'start'
                }
            },
            {
                element: guideTarget('incubatee-schedule'),
                popover: {
                    title: 'Your week',
                    description: 'Upcoming sessions by day. Open one for its time, place or meeting link.',
                    side: 'top',
                    align: 'start'
                }
            }
        ]
    },
    {
        route: '/incubatee/interventions',
        label: 'Interventions',
        steps: [
            {
                element: guideTarget('sme-interventions-summary'),
                popover: {
                    title: 'Your support plan',
                    description:
                        'Interventions are the support the programme gives you, such as training, advice and help with compliance. These are the ones in your development plan.',
                    side: 'bottom',
                    align: 'start'
                }
            },
            {
                element: guideTarget('sme-interventions-toolbar'),
                popover: {
                    title: 'Find one, or ask for more',
                    description:
                        'Filter by status, or switch to My requests to see support you have asked for. Open any intervention to follow its progress.',
                    side: 'bottom',
                    align: 'start'
                }
            },
            {
                popover: {
                    title: 'Confirm when it is done',
                    description:
                        'When the team marks an intervention complete, you are asked to confirm it. Only confirm when you received the support. Your confirmation is what counts as delivered.'
                }
            }
        ]
    },
    {
        route: '/incubatee/appointments',
        label: 'Appointments',
        steps: [
            {
                element: guideTarget('sme-appointments-summary'),
                popover: {
                    title: 'Your sessions',
                    description: 'Every meeting, training and consultation booked with you, and which still need your answer.',
                    side: 'bottom',
                    align: 'start'
                }
            },
            {
                element: guideTarget('sme-appointments-list'),
                popover: {
                    title: 'Answer each invitation',
                    description:
                        'Accept or decline so the team knows to expect you. Online sessions show their meeting link here.',
                    side: 'top',
                    align: 'start'
                }
            }
        ]
    },
    {
        route: '/incubatee/metrics',
        label: 'Revenue and employees',
        steps: [
            {
                element: guideTarget('sme-metrics-summary'),
                popover: {
                    title: 'Your business numbers',
                    description:
                        'Your monthly revenue and staff, recorded by the programme team. They show how your business is growing.',
                    side: 'bottom',
                    align: 'start'
                }
            },
            {
                element: guideTarget('sme-metrics-history'),
                popover: {
                    title: 'Check they are right',
                    description:
                        'The programme uses these figures to see which support helps businesses grow. If a month looks wrong, tell the team through Feedback.',
                    side: 'top',
                    align: 'start'
                }
            }
        ]
    },
    {
        route: '/incubatee/compliance',
        label: 'Compliance',
        steps: [
            {
                element: guideTarget('sme-compliance-summary'),
                popover: {
                    title: 'Your documents',
                    description:
                        'Which compliance documents are still needed, which have expired and which are accepted. Upload them here; you will get a reminder before one expires.',
                    side: 'bottom',
                    align: 'start'
                }
            },
            {
                element: '.account-menu-trigger',
                popover: {
                    title: 'Help is always here',
                    description:
                        'Open your account menu for a guide to whichever page you are on, or to take this tour again.',
                    side: 'bottom',
                    align: 'end'
                }
            },
            {
                element: '.workspace-assistant-button',
                popover: {
                    title: 'Ask the assistant',
                    description: 'Ask questions in your own words, such as "what do I still need to upload?"',
                    side: 'bottom',
                    align: 'end'
                }
            },
            {
                popover: {
                    title: 'You are all set',
                    description: 'That is the tour. Everything waiting on you will show on My Home.'
                }
            }
        ]
    }
]

/**
 * The walkthrough for someone still applying: a registered SME with no accepted
 * application, who only sees the applicant portal. Accepted SMEs get the tour above.
 */
export const APPLICANT_WELCOME_TOUR: TourStop[] = [
    {
        route: '/applicant',
        label: 'Applications',
        steps: [
            {
                popover: {
                    title: 'Welcome to Smart Incubation',
                    description:
                        'This short tour shows how applying works: four pages, about a minute. You can close it at any time and carry on later from your account menu.'
                }
            },
            {
                element: guideTarget('applicant-programmes'),
                popover: {
                    title: 'Programmes open to you',
                    description: 'Each card is a programme taking applications. Open one to read who it is for and what it offers.',
                    side: 'top',
                    align: 'start'
                }
            },
            {
                element: guideTarget('apply-btn-first'),
                popover: {
                    title: 'Apply',
                    description: 'Start an application here. You can apply to more than one programme.',
                    side: 'top',
                    align: 'start'
                }
            }
        ]
    },
    {
        route: '/applicant/profile',
        label: 'My Profile',
        // Worded by how far along the profile is, read from the page once it has loaded.
        steps: () => {
            const raw = document.querySelector(guideTarget('applicant-profile-progress'))?.getAttribute('data-profile-progress')
            // Unknown (page not loaded) reads as not finished, without a percentage.
            const progress = raw ? Number(raw) : NaN
            const known = Number.isFinite(progress)
            const complete = known && progress >= 100
            return [
                {
                    element: guideTarget('applicant-profile-progress'),
                    popover: complete
                        ? {
                            title: 'Your profile is complete',
                            description:
                                'Your applications draw on this profile. Keep it current, especially your contact details and your latest revenue and headcount.',
                            side: 'bottom',
                            align: 'start'
                        }
                        : {
                            title: 'Finish your profile first',
                            description: `${known ? `It is ${progress}% done. ` : ''}You need a complete profile before you can apply, and it saves retyping your details in every application.`,
                            side: 'bottom',
                            align: 'start'
                        }
                },
                {
                    element: guideTarget('applicant-profile-sections'),
                    popover: complete
                        ? {
                            title: 'Update it any time',
                            description:
                                'Open a section to change it. Changes update your profile, not applications you have already submitted.',
                            side: 'top',
                            align: 'start'
                        }
                        : {
                            title: 'Fill in each section',
                            description:
                                'Open each section and complete what is missing. Sections still to do are marked.',
                            side: 'top',
                            align: 'start'
                        }
                }
            ]
        }
    },
    {
        route: '/applicant/tracker',
        label: 'Tracker',
        steps: [
            {
                element: guideTarget('applications-status-metrics'),
                popover: {
                    title: 'Where your applications stand',
                    description: 'How many applications you have made, and how many are pending or decided.',
                    side: 'bottom',
                    align: 'start'
                }
            },
            {
                element: guideTarget('applications-results'),
                popover: {
                    title: 'Each application',
                    description:
                        'Its status and the next step. Once you are accepted, you move into the full SME workspace and get a tour of that too.',
                    side: 'top',
                    align: 'start'
                }
            }
        ]
    },
    {
        route: '/applicant/inquiries',
        label: 'Inquiries',
        steps: [
            {
                element: guideTarget('new-inquiry-btn'),
                popover: {
                    title: 'Ask us anything',
                    description: 'Questions about a programme or your application go here, and the team replies in this list.',
                    side: 'bottom',
                    align: 'end'
                }
            },
            {
                element: '.account-menu-trigger',
                popover: {
                    title: 'Help is always here',
                    description: 'Open your account menu for a guide to whichever page you are on, or to take this tour again.',
                    side: 'bottom',
                    align: 'end'
                }
            },
            {
                popover: {
                    title: 'You are all set',
                    description: 'Start with your profile, then apply to a programme that suits your business. Good luck!'
                }
            }
        ]
    }
]

export type WelcomeTourKind = 'sme' | 'applicant'

const TOURS: Record<WelcomeTourKind, TourStop[]> = {
    sme: SME_WELCOME_TOUR,
    applicant: APPLICANT_WELCOME_TOUR
}

/** Applicants live in the applicant portal; everyone else in the SME workspace. */
export const welcomeTourKindFor = (pathname: string): WelcomeTourKind =>
    pathname === '/applicant' || pathname.startsWith('/applicant/') ? 'applicant' : 'sme'

export type WelcomeTourStatus = 'in_progress' | 'completed' | 'dismissed'
export type WelcomeTourState = { status?: WelcomeTourStatus; stop?: number }

// Each tour keeps its own progress, so an applicant who took theirs is still
// offered the SME tour once accepted. The identity is read once at sign-in, so
// the latest state is also kept locally.
const localKey = (uid: string, kind: WelcomeTourKind) => `lph.welcomeTour.${kind}.${uid}`
// "Later" hides the offer until the next sign-in.
const laterKey = (uid: string, kind: WelcomeTourKind) => `lph.welcomeTour.${kind}.later.${uid}`

const readLocal = (uid: string, kind: WelcomeTourKind): WelcomeTourState | null => {
    try {
        const raw = localStorage.getItem(localKey(uid, kind))
        return raw ? JSON.parse(raw) as WelcomeTourState : null
    } catch {
        return null
    }
}

/** A welcome tour: whether to offer it, and starting, resuming or dismissing it. */
export const useWelcomeTour = (kind: WelcomeTourKind) => {
    const { user, isViewingAs } = useFullIdentity()
    const guide = useOptionalGuide()
    const uid = user?.uid || ''
    const [state, setState] = useState<WelcomeTourState>({})
    const [later, setLater] = useState(false)

    useEffect(() => {
        if (!uid) return
        setState(readLocal(uid, kind) || (user as any)?.welcomeTours?.[kind] || {})
        try {
            setLater(sessionStorage.getItem(laterKey(uid, kind)) === '1')
        } catch {
            setLater(false)
        }
    }, [uid, user, kind])

    const save = useCallback((next: WelcomeTourState) => {
        setState(next)
        if (!uid || isViewingAs) return
        try {
            localStorage.setItem(localKey(uid, kind), JSON.stringify(next))
        } catch {
            // Storage blocked: Firestore still has it.
        }
        setDoc(
            doc(db, 'users', uid),
            { welcomeTours: { [kind]: { ...next, updatedAt: serverTimestamp() } } },
            { merge: true }
        ).catch(error => console.warn('Could not save welcome tour progress', error))
    }, [uid, isViewingAs, kind])

    const stops = TOURS[kind]

    const start = useCallback((fromStop = 0) => {
        if (!guide) return
        save({ status: 'in_progress', stop: fromStop })
        guide.runTour(stops, {
            fromStop,
            onStop: stop => save({ status: 'in_progress', stop }),
            onFinish: () => save({ status: 'completed' }),
            // Closed part-way: offer to continue from this stop next time.
            onExit: stop => save({ status: 'in_progress', stop })
        })
    }, [guide, save, stops])

    const dismiss = useCallback(() => save({ status: 'dismissed' }), [save])

    const remindLater = useCallback(() => {
        setLater(true)
        try {
            if (uid) sessionStorage.setItem(laterKey(uid, kind), '1')
        } catch {
            // Hidden for this visit only.
        }
    }, [uid, kind])

    const isSme = user?.role === 'incubatee'
    // Accepted SMEs finish the setup wizard first; applicants are set up on registering.
    const setupDone = (user as any)?.firstLoginComplete === true
    const shouldOffer = isSme && setupDone && !isViewingAs && !later &&
        state.status !== 'completed' && state.status !== 'dismissed'

    return {
        kind,
        available: isSme && !!guide,
        shouldOffer,
        resumeStop: state.status === 'in_progress' && (state.stop ?? 0) > 0 ? state.stop ?? 0 : 0,
        stopCount: stops.length,
        start,
        dismiss,
        remindLater
    }
}
