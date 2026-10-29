import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
    collection,
    collectionGroup,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { resolveAssignmentLifecycle } from '@/services/assignmentLifecycleService'
import { resolveComplianceRequirements, type AgreementTemplate } from '@/services/complianceResolver'
import { hasSmeGapSubmission, isAgreementAvailable, isIncubateeAgreementSigned } from '@/utils/agreementStatus'
import { normalizeAppointmentRecord } from '@/services/appointmentService'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'
import {
    type DevPlanDept,
    loadDeptInterventionCatalog,
    loadDevPlanDepartments,
    pendingSmeDepartments,
    resolveIncubateeParticipantId
} from '@/services/devPlanConfirmationService'

/**
 * Everything waiting on the signed-in SME, from one set of listeners: the
 * dashboard's "Needs your attention" list and the "Waiting for you" prompt both
 * read it, so they can never disagree.
 */

// ---------- Forms (department surveys sent to the SME) ----------
export type ResponseType = 'multiple' | 'scale' | 'short'

export interface Question {
    id: string
    type: ResponseType
    questionText: string
    required?: boolean
    options?: string[]
    multipleMode?: 'single' | 'multi'
    min?: number
    max?: number
    step?: number
    placeholder?: string
}

interface DepartmentFormTemplate {
    id: string
    title?: string
    description?: string
    type?: string
    department?: string
    questions?: Question[]
}

export interface DocumentRow {
    id: string // sentForms/{id}
    responseDocId: string // responses/{participantId}
    title: string
    type: string
    description: string
    department?: string
    status: 'pending' | 'in-progress' | 'completed'
    dueDate?: string
    requestedBy?: string
    questions: Question[]
    draftData?: any
    answers?: Record<string, any>
    submittedAt?: any
    completed?: boolean
    templateId?: string
}

const templateCache = new Map<string, DepartmentFormTemplate | null>()
async function getTemplateById(templateId?: string | null) {
    if (!templateId) return null
    if (templateCache.has(templateId)) return templateCache.get(templateId)!
    try {
        const snap = await getDoc(doc(db, 'departmentForms', templateId))
        const tpl = snap.exists() ? ({ id: snap.id, ...snap.data() } as DepartmentFormTemplate) : null
        templateCache.set(templateId, tpl)
        return tpl
    } catch (e) {
        console.error('Template fetch failed:', e)
        templateCache.set(templateId, null)
        return null
    }
}

// ---------- Shapes ----------
export type WaitingPlanDepartment = DevPlanDept & { completedAt: Date | null }

export type WaitingCompletion = {
    id: string
    title: string
    subIntervention: string
    facilitator: string
    date: string
    full: any
}

export type WaitingAgreement = { agreementId: string; title: string }

export type SmeWaiting = {
    participantId: string | null
    /** True until every source has answered once. */
    loading: boolean
    /** True until the plan alone has answered (the plan review page waits on just this). */
    plansLoading: boolean
    /** Appointments the SME hasn't answered, today or later, soonest first. */
    appointments: any[]
    /** Departments whose part of the plan waits on the SME's confirmation. */
    plans: WaitingPlanDepartment[]
    /** Delivered interventions waiting for the SME to confirm or reject. */
    completions: WaitingCompletion[]
    /** Required agreements the SME hasn't signed (and that are already available). */
    agreements: WaitingAgreement[]
    /** Every form sent to the SME; `pendingForms` are the ones not yet submitted. */
    forms: DocumentRow[]
    pendingForms: DocumentRow[]
    /** The plan walkthrough's inputs. */
    planId: string | null
    plan: any
    planDepartments: DevPlanDept[]
    catalogByDeptId: Record<string, any[]>
    total: number
}

const EMPTY: SmeWaiting = {
    participantId: null,
    loading: false,
    plansLoading: false,
    appointments: [],
    plans: [],
    completions: [],
    agreements: [],
    forms: [],
    pendingForms: [],
    planId: null,
    plan: null,
    planDepartments: [],
    catalogByDeptId: {},
    total: 0
}

const SmeWaitingContext = createContext<SmeWaiting>(EMPTY)

const toDateSafe = (val: any): Date | null => {
    if (!val) return null
    if (val instanceof Date) return val
    if (typeof val === 'string') {
        if (/^\d{2}:\d{2}$/.test(val)) return null
        const d = new Date(val)
        return isNaN(d.getTime()) ? null : d
    }
    if (typeof val?.toDate === 'function') return val.toDate()
    if (val?.seconds) return new Date(val.seconds * 1000)
    return null
}

const isOn = (value: any) => value === true || (value && typeof value === 'object' && value.confirmed === true)

const useWaitingSources = (enabled: boolean): SmeWaiting => {
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()

    const [participantId, setParticipantId] = useState<string | null>(null)
    const [resolved, setResolved] = useState(false)

    // Plan
    const [planDepartments, setPlanDepartments] = useState<DevPlanDept[]>([])
    const [planId, setPlanId] = useState<string | null>(null)
    const [plan, setPlan] = useState<any>(null)
    const [planReady, setPlanReady] = useState(false)
    const [catalogByDeptId, setCatalogByDeptId] = useState<Record<string, any[]>>({})

    // Appointments, completions, agreements, forms
    const [appointmentRows, setAppointmentRows] = useState<any[]>([])
    const [appointmentsReady, setAppointmentsReady] = useState(false)
    const [assignments, setAssignments] = useState<any[]>([])
    const [assignmentsReady, setAssignmentsReady] = useState(false)
    const [acceptedApp, setAcceptedApp] = useState<any>(null)
    const [signedAgreements, setSignedAgreements] = useState<Record<string, any>>({})
    const [requiredAgreements, setRequiredAgreements] = useState<
        Array<{ agreementId: string; title: string; template?: AgreementTemplate }>
    >([])
    const [agreementsReady, setAgreementsReady] = useState(false)
    const [gapSubmitted, setGapSubmitted] = useState(false)
    const [forms, setForms] = useState<DocumentRow[]>([])

    // ---- Who is this SME?
    useEffect(() => {
        setParticipantId(null)
        setResolved(false)
        if (!enabled || !user?.email) return
        let cancelled = false
        resolveIncubateeParticipantId(user)
            .then(pid => {
                if (cancelled) return
                setParticipantId(pid)
                setResolved(true)
            })
            .catch(error => {
                console.error('Waiting items: participant could not be resolved', error)
                if (!cancelled) setResolved(true)
            })
        return () => { cancelled = true }
    }, [enabled, user?.email, user?.id, user?.participantDocId, user?.participantId, user?.profileId, user?.uid])

    // ---- Development plan (latest, live) and the departments that sign it
    useEffect(() => {
        setPlan(null)
        setPlanId(null)
        setPlanReady(false)
        if (!participantId) return
        let cancelled = false
        loadDevPlanDepartments()
            .then(depts => { if (!cancelled) setPlanDepartments(depts) })
            .catch(error => console.error('Waiting items: plan departments failed', error))
        const off = onSnapshot(
            query(collection(db, 'diagnosticPlans'), where('participantId', '==', participantId)),
            snapshot => {
                const latest = [...snapshot.docs].sort(
                    (a, b) =>
                        (toDateSafe(b.data()?.createdAt)?.getTime() || 0) -
                        (toDateSafe(a.data()?.createdAt)?.getTime() || 0)
                )[0]
                setPlanId(latest?.id || null)
                setPlan(latest ? latest.data() : null)
                setPlanReady(true)
            },
            error => {
                console.error('Waiting items: plan listener failed', error)
                setPlanReady(true)
            }
        )
        return () => { cancelled = true; off() }
    }, [participantId])

    // SME sign-off is recorded in two maps (the roadmap and the builder write
    // different ones); a department counts as signed when either says so.
    const planForSignOff = useMemo(() => {
        if (!plan) return plan
        const merged: Record<string, any> = {}
        const add = (map: Record<string, any> = {}) =>
            Object.entries(map).forEach(([id, value]) => {
                if (isOn(value)) merged[id] = { ...(typeof value === 'object' ? value : {}), confirmed: true }
            })
        add(plan.smmeConfirmedByDeptId)
        add(plan.incubateeDepartmentConfirmationsByDeptId)
        return { ...plan, incubateeDepartmentConfirmationsByDeptId: merged }
    }, [plan])

    // Catalogs for departments awaiting sign-off decide whether every item is
    // compulsory (then the SME has nothing to confirm).
    const signOffCandidates = useMemo(() => {
        if (!planForSignOff || planForSignOff.finalConfirmation) return []
        const deptOk = planForSignOff.confirmedByDeptId || {}
        const smeOk = planForSignOff.incubateeDepartmentConfirmationsByDeptId || {}
        return planDepartments.filter(d => !!deptOk[d.id] && !smeOk[d.id]?.confirmed)
    }, [planForSignOff, planDepartments])

    useEffect(() => {
        const missing = signOffCandidates.filter(d => !(d.id in catalogByDeptId))
        if (!missing.length) return
        let cancelled = false
        Promise.all(
            missing.map(async d => {
                try {
                    return [d.id, await loadDeptInterventionCatalog(d)] as const
                } catch (error) {
                    console.error('Waiting items: catalog failed for', d.name, error)
                    return [d.id, [] as any[]] as const
                }
            })
        ).then(entries => {
            if (!cancelled) setCatalogByDeptId(prev => ({ ...prev, ...Object.fromEntries(entries) }))
        })
        return () => { cancelled = true }
    }, [signOffCandidates, catalogByDeptId])

    const catalogsReady = signOffCandidates.every(d => d.id in catalogByDeptId)
    const plans = useMemo<WaitingPlanDepartment[]>(() => {
        if (!catalogsReady) return []
        return pendingSmeDepartments(planForSignOff, planDepartments, catalogByDeptId)
            .map(dept => {
                const confirmation = planForSignOff?.confirmedByDeptId?.[dept.id]
                return {
                    ...dept,
                    completedAt: confirmation && typeof confirmation === 'object' ? toDateSafe(confirmation.confirmedAt) : null
                }
            })
            .sort(
                (a, b) =>
                    (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0) || a.name.localeCompare(b.name)
            )
    }, [catalogsReady, planForSignOff, planDepartments, catalogByDeptId])

    // ---- Appointments
    useEffect(() => {
        setAppointmentRows([])
        setAppointmentsReady(false)
        if (!participantId) return
        let disposed = false
        let revision = 0
        const q = activeProgramId
            ? query(collection(db, 'appointments'), where('smeId', '==', participantId), where('programId', '==', activeProgramId))
            : query(collection(db, 'appointments'), where('smeId', '==', participantId))
        const off = onSnapshot(
            q,
            async snap => {
                const current = ++revision
                try {
                    const hydrated = await hydrateAppointmentViews(snap.docs.map(d => ({ id: d.id, data: d.data() as any })))
                    if (disposed || current !== revision) return
                    setAppointmentRows(hydrated.map(d => normalizeAppointmentRecord(d.id, d)))
                } catch (error) {
                    console.error('Waiting items: appointments failed', error)
                } finally {
                    if (!disposed && current === revision) setAppointmentsReady(true)
                }
            },
            error => {
                console.error('Waiting items: appointments listener failed', error)
                if (!disposed) setAppointmentsReady(true)
            }
        )
        return () => { disposed = true; off() }
    }, [participantId, activeProgramId])

    const appointments = useMemo(() => {
        const today = dayjs().startOf('day')
        return appointmentRows
            .filter(a => !['cancelled', 'canceled', 'completed'].includes(String(a.status || '').toLowerCase()))
            .filter(a => String(a.userConfirmation || 'pending').toLowerCase() === 'pending')
            .map(a => ({ a, start: toDateSafe(a.startTime) || (a.date ? toDateSafe(a.date) : null) }))
            .filter(({ start }) => !start || !dayjs(start).isBefore(today))
            .sort((x, y) => (x.start?.getTime() || 0) - (y.start?.getTime() || 0))
            .map(({ a }) => a)
    }, [appointmentRows])

    // ---- Completions waiting for the SME
    useEffect(() => {
        setAssignments([])
        setAssignmentsReady(false)
        if (!participantId) return
        return onSnapshot(
            query(collection(db, 'assignedInterventions'), where('participantId', '==', participantId)),
            snap => {
                setAssignments(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
                setAssignmentsReady(true)
            },
            error => {
                console.error('Waiting items: interventions listener failed', error)
                setAssignmentsReady(true)
            }
        )
    }, [participantId])

    const completions = useMemo<WaitingCompletion[]>(
        () =>
            assignments
                // Appointment answers are handled with the appointment; only a
                // delivered intervention awaiting the SME's confirmation is a completion.
                .filter(item => resolveAssignmentLifecycle(item).key === 'awaiting-participant-confirmation')
                .map(item => {
                    const sub = String(item.subInterventionTitle || item.subInterventionName || item.subIntervention || '').trim()
                    const facilitator = String(item.assigneeName || item.facilitatorName || item.consultantName || '').trim()
                    return {
                        id: item.id,
                        title: item.interventionTitle,
                        subIntervention:
                            sub && sub.toLowerCase() !== String(item.interventionTitle || '').trim().toLowerCase() ? sub : '',
                        facilitator: facilitator || 'Not assigned yet',
                        date: item.dueDate?.seconds
                            ? dayjs(item.dueDate.seconds * 1000).format('YYYY-MM-DD')
                            : item.dueDate
                                ? dayjs(item.dueDate).format('YYYY-MM-DD')
                                : '-',
                        full: item
                    }
                }),
        [assignments]
    )

    // ---- Agreements: the accepted application, what it has signed, what the programme requires
    useEffect(() => {
        setAcceptedApp(null)
        setSignedAgreements({})
        setAgreementsReady(false)
        if (!participantId) return
        let disposed = false
        let revision = 0
        const off = onSnapshot(
            query(collection(db, 'applications'), where('participantId', '==', participantId)),
            async snap => {
                const current = ++revision
                const accepted = snap.docs
                    .map(d => ({ id: d.id, ...(d.data() as any) }))
                    .filter(a => String(a.applicationStatus || '').toLowerCase() === 'accepted')
                const app =
                    (activeProgramId ? accepted.find(a => String(a.programId || '') === String(activeProgramId)) : null) ||
                    accepted[0] ||
                    null
                const merged: Record<string, any> = { ...(app?.signedAgreements || {}) }
                if (app?.id) {
                    try {
                        const agreementSnap = await getDocs(collection(db, 'applications', app.id, 'agreements'))
                        agreementSnap.forEach(d => {
                            if (!merged[d.id]) merged[d.id] = d.data()
                        })
                    } catch (error) {
                        console.error('Waiting items: agreements failed', error)
                    }
                }
                if (disposed || current !== revision) return
                setAcceptedApp(app)
                setSignedAgreements(merged)
                if (!app?.programId) setAgreementsReady(true)
            },
            error => {
                console.error('Waiting items: applications listener failed', error)
                if (!disposed) setAgreementsReady(true)
            }
        )
        return () => { disposed = true; off() }
    }, [participantId, activeProgramId])

    useEffect(() => {
        setRequiredAgreements([])
        if (!acceptedApp?.programId) return
        let disposed = false
        resolveComplianceRequirements(acceptedApp.programId, { includeAllDepartments: true })
            .then(resolvedRequirements => {
                if (disposed) return
                const templates = new Map(resolvedRequirements.agreements.map(t => [t.agreementId, t]))
                setRequiredAgreements(
                    resolvedRequirements.requirements
                        .filter(r => r.kind === 'agreement' && r.agreementId)
                        .map(r => ({ agreementId: r.agreementId!, title: r.title, template: templates.get(r.agreementId!) }))
                )
            })
            .catch(error => console.error('Waiting items: requirements failed', error))
            .finally(() => { if (!disposed) setAgreementsReady(true) })
        return () => { disposed = true }
    }, [acceptedApp?.programId])

    useEffect(() => {
        setGapSubmitted(false)
        if (!participantId) return
        return onSnapshot(
            query(collection(db, 'gapAnalysis'), where('participantId', '==', participantId)),
            snapshot => setGapSubmitted(hasSmeGapSubmission({ gapRecords: snapshot.docs.map(d => ({ id: d.id, ...d.data() })) })),
            error => console.error('Waiting items: GAP listener failed', error)
        )
    }, [participantId])

    const agreements = useMemo<WaitingAgreement[]>(() => {
        const acceptedAt = toDateSafe(acceptedApp?.acceptedAt || acceptedApp?.dateAccepted)
        return requiredAgreements
            .filter(requirement => {
                // Agreements such as the MOA only become available some months in, and the
                // MOA not at all until that rule is set: the same test as the compliance page.
                if (!isAgreementAvailable(requirement.agreementId, acceptedAt, requirement.template?.availabilityDelayMonths)) {
                    return false
                }
                const value = signedAgreements?.[requirement.agreementId]
                if (
                    requirement.agreementId === 'gap-analysis' &&
                    hasSmeGapSubmission({
                        application: acceptedApp,
                        agreement: value,
                        gapRecords: gapSubmitted ? [{ id: 'submitted' }] : []
                    })
                ) {
                    return false
                }
                return !isIncubateeAgreementSigned(value, requirement.agreementId)
            })
            .map(({ agreementId, title }) => ({ agreementId, title }))
    }, [acceptedApp, requiredAgreements, signedAgreements, gapSubmitted])

    // ---- Forms sent to the SME (department surveys)
    useEffect(() => {
        setForms([])
        if (!participantId) return
        let disposed = false
        let fallbackFormsUnsub: null | (() => void) = null
        let fallbackResponseUnsubs: Array<() => void> = []
        let directRowsVersion = 0
        const directResponses = new Map<string, { responseSnap: any; formSnap: any }>()

        const buildDocumentRow = async (respSnap: any, suppliedFormSnap?: any) => {
            const resp = respSnap.data() as any
            const formRef = respSnap.ref.parent.parent!
            const formSnap = suppliedFormSnap || (await getDoc(formRef))
            const form = (formSnap.exists() ? formSnap.data() : {}) as any
            const templateId: string | undefined = resp?.templateId || form?.templateId || undefined
            const tpl = await getTemplateById(templateId)
            const status: DocumentRow['status'] = resp.completed
                ? 'completed'
                : resp.answersDraft && Object.keys(resp.answersDraft || {}).length
                    ? 'in-progress'
                    : 'pending'
            return {
                id: formRef.id,
                responseDocId: respSnap.id,
                status,
                dueDate: form.dueDate || '',
                requestedBy: form.requestedBy || form.department || '',
                draftData: resp.answersDraft || undefined,
                answers: resp.answers || undefined,
                submittedAt: resp.submittedAt ?? null,
                completed: !!resp.completed,
                templateId,
                title: tpl?.title ?? form.title ?? 'Untitled Form',
                description: tpl?.description ?? form.description ?? '',
                type: tpl?.type ?? form.type ?? 'marketing',
                department: tpl?.department ?? form.department ?? form.requestedBy ?? '',
                questions:
                    (tpl?.questions as Question[] | undefined) ??
                    ((Array.isArray(form.questions) ? form.questions : undefined) as Question[] | undefined) ??
                    ((Array.isArray(resp.questions) ? resp.questions : undefined) as Question[] | undefined) ??
                    []
            } as DocumentRow
        }

        const publishDirectRows = async () => {
            const version = ++directRowsVersion
            const rows = await Promise.all(
                Array.from(directResponses.values()).map(({ responseSnap, formSnap }) => buildDocumentRow(responseSnap, formSnap))
            )
            if (!disposed && version === directRowsVersion) setForms(rows)
        }

        // Some accounts can't read the responses collection group; listen per form instead.
        const startDirectResponseListeners = () => {
            if (fallbackFormsUnsub || disposed) return
            setForms([])
            fallbackFormsUnsub = onSnapshot(
                collection(db, 'sentForms'),
                formsSnap => {
                    fallbackResponseUnsubs.forEach(unsubscribe => unsubscribe())
                    fallbackResponseUnsubs = []
                    directResponses.clear()
                    void publishDirectRows()
                    fallbackResponseUnsubs = formsSnap.docs.map(formSnap =>
                        onSnapshot(
                            doc(db, 'sentForms', formSnap.id, 'responses', participantId),
                            responseSnap => {
                                if (responseSnap.exists()) directResponses.set(formSnap.id, { responseSnap, formSnap })
                                else directResponses.delete(formSnap.id)
                                void publishDirectRows()
                            },
                            error => console.error('Waiting items: form response listener failed', error)
                        )
                    )
                },
                error => console.error('Waiting items: sent forms listener failed', error)
            )
        }

        const groupUnsub = onSnapshot(
            query(collectionGroup(db, 'responses'), where('participantId', '==', participantId)),
            async snap => {
                const rows = await Promise.all(snap.docs.map(respSnap => buildDocumentRow(respSnap)))
                if (!disposed) setForms(rows)
            },
            error => {
                if (error.code === 'permission-denied') {
                    startDirectResponseListeners()
                    return
                }
                console.error('Waiting items: responses listener failed', error)
            }
        )

        return () => {
            disposed = true
            groupUnsub()
            fallbackFormsUnsub?.()
            fallbackResponseUnsubs.forEach(unsubscribe => unsubscribe())
        }
    }, [participantId])

    const pendingForms = useMemo(() => forms.filter(f => f.status !== 'completed'), [forms])

    if (!enabled) return EMPTY

    const loading =
        !resolved ||
        (!!participantId && (!planReady || !catalogsReady || !appointmentsReady || !assignmentsReady || !agreementsReady))

    return {
        participantId,
        loading,
        plansLoading: !resolved || (!!participantId && (!planReady || !catalogsReady)),
        appointments,
        plans,
        completions,
        agreements,
        forms,
        pendingForms,
        planId,
        plan,
        planDepartments,
        catalogByDeptId,
        total: appointments.length + plans.length + completions.length + agreements.length + pendingForms.length
    }
}

/** Mount once, around the app layout, for incubatees. */
export const SmeWaitingProvider: React.FC<{ enabled: boolean; children: React.ReactNode }> = ({ enabled, children }) => {
    const value = useWaitingSources(enabled)
    return <SmeWaitingContext.Provider value={value}>{children}</SmeWaitingContext.Provider>
}

/** Supplies a fixed value instead of live data (previews and tests). */
export const SmeWaitingValueProvider = SmeWaitingContext.Provider

/** What is waiting on the signed-in SME. Empty outside SmeWaitingProvider. */
export const useSmeWaiting = () => useContext(SmeWaitingContext)
