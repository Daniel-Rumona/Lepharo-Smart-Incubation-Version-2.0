import { mergeCompulsoryInterventions } from '@/utils/compulsoryInterventions'
// src/pages/diagnostic-plan/DiagnosticPlanBuilder.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Checkbox,
    Grid,
    Input,
    Modal,
    Popconfirm,
    Result,
    Segmented,
    Typography,
    message
} from 'antd'
import {
    addDoc,
    collection,
    deleteField,
    doc,
    getDocs,
    query,
    runTransaction,
    serverTimestamp,
    where
} from 'firebase/firestore'
import {
    ArrowLeftOutlined,
    CheckOutlined,
    CloseOutlined,
    FileSearchOutlined,
    PlusOutlined,
    SearchOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { builderKey, relabelFromCatalog, uniqueBuilderItems } from '@/utils/planBuilderItems'
import { createOrUpdateDiagnosticPlanMovDraft } from '@/services/movService'
import { loadGapSuggestions, type GapSuggestion } from '@/services/gapSuggestionsService'
import { getOwnedSectionsForDept } from '@/routes/gap/sections'
import { useDepartmentRoles } from '@/services/departmentRoles'
import GapResponsesModal from '@/routes/gap/view/GapResponsesModal'
import { StatusPill } from '@/routes/operations/movs/movParts'
import '@/routes/operations/movs/movs.css'
import '@/components/workspace'
import './builder.css'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'

const { Text } = Typography
const { useBreakpoint } = Grid

type DeliveryMethod = 'InPerson' | 'Virtual' | 'Phone' | 'Hybrid'
type PlanSource = 'SME' | 'Department'

type BuilderItem = {
    id: string
    title: string
    source: PlanSource
}

type AppRequiredItem = {
    id: string
    departmentId: string
    title: string
}

const toMillis = (value: any): number => {
    if (!value) return 0
    if (typeof value === 'number') return value
    if (value instanceof Date) return value.getTime()
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (typeof value?.seconds === 'number') return value.seconds * 1000
    return 0
}

// An intervention is its id; a rename must not make it look like a second one.
const keyOf = (item: BuilderItem) => builderKey(item)

const uniq = (items: BuilderItem[]) => uniqueBuilderItems(items)

/**
 * Read compatibility for plans created before the source cleanup.
 * New writes only use SME or Department.
 */
const normalizePlanSource = (value: unknown): PlanSource => {
    const source = String(value || '').trim().toLowerCase()

    if (source === 'sme' || source === 'required') {
        return 'SME'
    }

    return 'Department'
}

const DiagnosticPlanBuilder: React.FC = () => {
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const [params] = useSearchParams()
    const participantId = params.get('participantId') || ''
    const { activeProgramId } = useActiveProgramId()

    const screens = useBreakpoint()
    const isMobile = !screens.md

    const userDepartmentId = String((user as any)?.departmentId || '').trim()
    const userDepartmentName = String((user as any)?.departmentName || '').trim()
    const { roleOf } = useDepartmentRoles()
    const userDepartmentRole = roleOf(userDepartmentId)
    const roleRaw = String((user as any)?.role || '').toLowerCase().trim()
    const isCoordinator = roleRaw === 'coordinator'

    const isParentDept =
        roleRaw === 'operations' && (user as any)?.isParentDepartment === true

    /**
     * 'ready' only after everything loaded. Saving replaces this department's
     * interventions on the plan, so saving from a half-loaded (or failed) page
     * would wipe them or create a duplicate plan.
     */
    const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
    const loading = loadState === 'loading' || loadState === 'idle'
    const [saving, setSaving] = useState(false)
    const [catalogSearch, setCatalogSearch] = useState('')
    /** finalList + delivery method as loaded, to tell whether anything changed. */
    const [savedKey, setSavedKey] = useState<string | null>(null)

    const [confirmNoInterventions, setConfirmNoInterventions] = useState(false)
    const [gapResponsesOpen, setGapResponsesOpen] = useState(false)

    const [dpDeliveryMethod, setDpDeliveryMethod] =
        useState<DeliveryMethod | undefined>(undefined)

    const [gapSuggestions, setGapSuggestions] = useState<GapSuggestion[]>([])
    const [gapLoading, setGapLoading] = useState(false)
    const [gapId, setGapId] = useState<string | null>(null)
    const [gapUnconfirmed, setGapUnconfirmed] = useState(false)
    const [requiredItems, setRequiredItems] = useState<BuilderItem[]>([])
    const [previousDepartmentItems, setPreviousDepartmentItems] = useState<BuilderItem[]>([])
    const [departmentSelected, setDepartmentSelected] = useState<BuilderItem[]>([])

    const [beneficiaryName, setBeneficiaryName] = useState('')

    const [existingPlanId, setExistingPlanId] = useState<string | null>(null)
    const [existingPlanData, setExistingPlanData] = useState<any | null>(null)

    const [interventionsCatalog, setInterventionsCatalog] = useState<any[]>([])

    const isDepartmentConfirmed = useMemo(() => {
        if (!existingPlanData || !userDepartmentId) return false

        const value = existingPlanData?.confirmedByDeptId?.[userDepartmentId]
        return value === true || value?.confirmed === true
    }, [existingPlanData, userDepartmentId])

    const isEditUnlockedForDepartment = useMemo(() => {
        const edit = existingPlanData?.devPlanEdit || {}
        if (edit?.unlocked !== true) return false

        const unlockedDeptId = String(edit?.unlockedForDeptId || '').trim()
        return !!unlockedDeptId && unlockedDeptId === userDepartmentId
    }, [existingPlanData, userDepartmentId])

    const coordinatorEditLocked =
        isCoordinator &&
        !!existingPlanId &&
        isDepartmentConfirmed &&
        !isEditUnlockedForDepartment

    const belongsToCurrentDepartment = (item: any) => {
        const departmentId = String(item?.departmentId || '').trim()
        const legacyAddedByDepartmentId = String(item?.addedByDeptId || '').trim()

        return (
            departmentId === userDepartmentId ||
            legacyAddedByDepartmentId === userDepartmentId
        )
    }

    const isSameDeptIntervention = (item: any) => {
        const departmentMatches =
            String(item?.departmentId || '').trim() === userDepartmentId
        const hasId = Boolean(String(item?.id || '').trim())
        const hasTitle = Boolean(
            String(item?.interventionTitle || item?.title || '').trim()
        )

        return departmentMatches && hasId && hasTitle
    }

    /**
     * Whether the GAP panel appears at all. Decided from the department alone,
     * not from the loaded suggestions, so the panel does not pop in and reflow
     * the page once the mapping resolves — it renders its own loading and empty
     * states instead. ROM and M&E deliver no section, so they never see it.
     */
    const ownedSections = useMemo(
        () => getOwnedSectionsForDept(userDepartmentRole),
        [userDepartmentRole]
    )
    const hasGapPanel = ownedSections.length > 0

    const canUseBuilderGuide =
        !isParentDept &&
        Boolean(participantId) &&
        !coordinatorEditLocked

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'diagnostic-plan-builder',
            pageTitle: 'Development Plan Builder',
            guides: canUseBuilderGuide
                ? [
                    {
                        id: 'diagnostic-plan-builder-overview',
                        title: 'Quick tour',
                        description:
                            'Understand the Development Plan builder, where interventions come from and how to return to the participant list.',
                        kind: 'page',
                        order: 1,
                        steps: [
                            {
                                element: guideTarget('dp-builder-header'),
                                popover: {
                                    title: 'Development Plan Builder',
                                    description:
                                        'This workspace builds or updates the Development Plan for the selected SME and your department.',
                                    side: 'bottom',
                                    align: 'start'
                                }
                            },
                            {
                                element: guideTarget('dp-builder-sources'),
                                waitForElement: 5000,
                                popover: {
                                    title: 'Where interventions come from',
                                    description:
                                        'Add interventions from the GAP Analysis suggestions or from your own catalogue. Anything the SME chose is already on the plan.',
                                    side: 'right',
                                    align: 'start'
                                }
                            },
                            {
                                element: guideTarget('dp-builder-plan-summary'),
                                waitForElement: 5000,
                                popover: {
                                    title: 'The plan so far',
                                    description:
                                        'Everything on the plan for your department, including what the SME chose and compulsory items. Choose the delivery method here and confirm.',
                                    side: 'left',
                                    align: 'start'
                                }
                            },
                            {
                                element: guideTarget('dp-builder-back'),
                                popover: {
                                    title: 'Back to Development Plans',
                                    description:
                                        'Return to the Development Plans list without submitting from here.',
                                    side: 'bottom',
                                    align: 'end'
                                }
                            }
                        ]
                    },
                    {
                        id: 'diagnostic-plan-builder-flow',
                        title: 'Build the Development Plan',
                        description:
                            'Walk through assembling the Development Plan and submitting it.',
                        kind: 'process',
                        order: 2,
                        steps: () => {
                            const steps: any[] = []

                            if (hasGapPanel) {
                                steps.push({
                                    element: guideTarget('dp-builder-gap-panel'),
                                    waitForElement: 5000,
                                    popover: {
                                        title: 'Gaps from the GAP Analysis',
                                        description:
                                            'Each row pairs a gap the SME reported with an intervention from your catalogue that addresses it, plus the reason for the match. Accept the ones you agree with — they are recorded as Department interventions.',
                                        side: 'right',
                                        align: 'start'
                                    }
                                })
                            }

                            steps.push(
                                {
                                    element: guideTarget('dp-builder-department-panel'),
                                    waitForElement: 5000,
                                    popover: {
                                        title: 'Your department catalogue',
                                        description:
                                            'Click any other intervention your department will deliver for this SME. Click it again to take it off.',
                                        side: 'right',
                                        align: 'start'
                                    }
                                },
                                {
                                    element: guideTarget('dp-builder-plan-summary'),
                                    waitForElement: 5000,
                                    popover: {
                                        title: 'Review the plan',
                                        description:
                                            'Check the list. Department interventions can be removed with the cross; SME choices and compulsory items stay.',
                                        side: 'left',
                                        align: 'start'
                                    }
                                },
                                {
                                    element: guideTarget('dp-builder-confirmation-input'),
                                    waitForElement: 1500,
                                    popover: {
                                        title: 'Delivery and confirmation',
                                        description:
                                            'Choose how the plan was delivered, or, if your department has nothing for this SME, tick the box to say so.',
                                        side: 'left',
                                        align: 'start'
                                    }
                                },
                                {
                                    element: guideTarget('dp-builder-save-action'),
                                    waitForElement: 1500,
                                    popover: {
                                        title: 'Confirm the plan',
                                        description:
                                            'Confirms your department. When there are interventions, the SME is asked to sign them.',
                                        side: 'top',
                                        align: 'center'
                                    }
                                }
                            )

                            return steps
                        }
                    }
                ]
                : []
        }),
        [canUseBuilderGuide, hasGapPanel]
    )

    usePageGuides(guideRegistration)

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            if (!participantId || !activeProgramId || !userDepartmentId) return

            setLoadState('loading')
            setSavedKey(null)

            try {
                const appQuery = query(
                    collection(db, 'applications'),
                    where('participantId', '==', participantId),
                    where('programId', '==', activeProgramId)
                )
                const appSnapshot = await getDocs(appQuery)
                const application = appSnapshot.docs[0]?.data() as any

                setBeneficiaryName(
                    String(
                        application?.beneficiaryName ||
                        application?.participantName ||
                        ''
                    )
                )

                const requiredRaw = (application?.interventions?.required || []) as AppRequiredItem[]

                const requiredForDepartment: BuilderItem[] = requiredRaw
                    .filter(
                        item =>
                            String(item?.departmentId || '').trim() ===
                            userDepartmentId
                    )
                    .map(item => ({
                        id: String(item.id || '').trim(),
                        title: String(item.title || '').trim(),
                        source: 'SME' as const
                    }))
                    .filter(item => item.id && item.title)

                const catalogQuery = query(
                    collection(db, 'interventions'),
                    where('departmentId', '==', userDepartmentId)
                )
                const catalogSnapshot = await getDocs(catalogQuery)

                const catalog = catalogSnapshot.docs
                    .map(document => ({
                        id: document.id,
                        ...(document.data() as any)
                    }))
                    .filter(isSameDeptIntervention)

                setInterventionsCatalog(catalog)

                // Gap suggestions come from the GAP Analysis mapping and are
                // accepted as Department source. Titles are resolved against the
                // catalogue above so a suggestion can never fall outside this
                // department — the save path would reject it anyway.
                const catalogueTitles = new Map<string, string>(
                    catalog.map((item: any) => [
                        String(item.id || '').trim(),
                        String(
                            item.title || item.interventionTitle || item.name || ''
                        ).trim()
                    ])
                )

                // Saved requirements and plan entries carry the title from when they were
                // written. Show the library's current name, so a renamed intervention is
                // one line, and saving writes the current name back.
                setRequiredItems(uniq(relabelFromCatalog(requiredForDepartment, catalogueTitles)))

                setGapLoading(true)
                loadGapSuggestions(participantId, userDepartmentRole, catalogueTitles, activeProgramId)
                    .then(result => {
                        setGapSuggestions(result.suggestions)
                        setGapId(result.gapId)
                        setGapUnconfirmed(result.unconfirmed)
                    })
                    .catch(error => {
                        console.error('Failed to load gap suggestions', error)
                        setGapSuggestions([])
                    })
                    .finally(() => setGapLoading(false))

                const planQuery = query(
                    collection(db, 'diagnosticPlans'),
                    where('participantId', '==', participantId)
                )
                const planSnapshot = await getDocs(planQuery)

                // This programme's latest plan; a legacy plan with no programId
                // counts only when the programme has none of its own.
                let latest: { id: string; data: any; ms: number; own: boolean } | null = null

                for (const document of planSnapshot.docs) {
                    const data = document.data()
                    const own = data?.programId === activeProgramId
                    if (!own && data?.programId) continue
                    const ms = toMillis(data?.createdAt)

                    if (!latest || (own && !latest.own) || (own === latest.own && ms > latest.ms)) {
                        latest = { id: document.id, data, ms, own }
                    }
                }

                const planId = latest?.id || null
                const plan = latest?.data || null

                setExistingPlanId(planId)
                setExistingPlanData(plan)

                const savedDeliveryMethod =
                    plan?.confirmedByDeptId?.[userDepartmentId]?.deliveryMethod ||
                    plan?.deliveryMethod ||
                    undefined

                setDpDeliveryMethod(
                    savedDeliveryMethod as DeliveryMethod | undefined
                )

                const savedDepartmentItems: BuilderItem[] = (
                    plan?.interventions || []
                )
                    .filter(belongsToCurrentDepartment)
                    .filter(
                        (item: any) =>
                            normalizePlanSource(item?.source) === 'Department'
                    )
                    .map((item: any) => ({
                        id: String(item?.id || '').trim(),
                        title: String(item?.title || '').trim(),
                        source: 'Department' as const
                    }))
                    .filter((item: BuilderItem) => item.id && item.title)

                setPreviousDepartmentItems(uniq(relabelFromCatalog(savedDepartmentItems, catalogueTitles)))
                setDepartmentSelected([])
                if (!cancelled) setLoadState('ready')
            } catch (error) {
                console.error('[DiagnosticPlanBuilder] Failed to load:', error)
                if (!cancelled) setLoadState('failed')
            }
        }

        load()
        return () => {
            cancelled = true
        }
    }, [participantId, activeProgramId, userDepartmentId, userDepartmentRole])
    const finalList = useMemo(
        () => uniq([...requiredItems, ...previousDepartmentItems, ...departmentSelected,
            ...interventionsCatalog.filter(item => item.compulsory === true).map(item => ({
                id: item.id,
                title: item.interventionTitle || item.title || 'Intervention',
                source: 'Department' as const
            }))]),
        [requiredItems, previousDepartmentItems, departmentSelected, interventionsCatalog]
    )

    const hasInterventions = finalList.length > 0
    const hasNoInterventions = !hasInterventions

    // Compulsory catalogue items are always on the plan, so they can't be removed.
    const compulsoryIds = useMemo(
        () => new Set(interventionsCatalog.filter(item => item.compulsory === true).map(item => String(item.id || '').trim())),
        [interventionsCatalog]
    )
    const isCompulsoryItem = (item: BuilderItem) => compulsoryIds.has(String(item.id || '').trim())

    /** Rows for the GAP panel, flagged against what is already in the plan. */
    const gapRows = useMemo(
        () =>
            gapSuggestions.map(item => ({
                ...item,
                inPlan: finalList.some(
                    selected =>
                        keyOf(selected) ===
                        keyOf({ id: item.id, title: item.title, source: 'Department' })
                )
            })),
        [gapSuggestions, finalList]
    )

    useEffect(() => {
        if (hasInterventions) {
            setConfirmNoInterventions(false)
        }
    }, [hasInterventions])

    const currentKey = `${finalList.map(keyOf).sort().join('|')}#${dpDeliveryMethod || ''}`
    // Snapshot what was loaded the moment loading finishes.
    useEffect(() => {
        if (loadState === 'ready' && savedKey === null) setSavedKey(currentKey)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadState])
    const isDirty = savedKey !== null && savedKey !== currentKey

    useEffect(() => {
        if (!isDirty || saving) return
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault()
            event.returnValue = ''
        }
        window.addEventListener('beforeunload', onBeforeUnload)
        return () => window.removeEventListener('beforeunload', onBeforeUnload)
    }, [isDirty, saving])

    const leave = () => {
        if (!isDirty) return navigate('/operations/plan')
        Modal.confirm({
            title: 'Leave without saving?',
            content: 'The interventions you added or removed here have not been saved.',
            okText: 'Leave',
            cancelText: 'Stay',
            centered: true,
            onOk: () => navigate('/operations/plan')
        })
    }

    const removeFromFinal = (item: BuilderItem) => {
        if (item.source === 'SME') {
            message.info('SME-selected interventions cannot be removed here.')
            return
        }

        const key = keyOf(item)
        setPreviousDepartmentItems(current =>
            current.filter(selected => keyOf(selected) !== key)
        )
        setDepartmentSelected(current =>
            current.filter(selected => keyOf(selected) !== key)
        )
    }

    const canSubmit = hasInterventions
        ? Boolean(dpDeliveryMethod)
        : confirmNoInterventions


    const savePlan = async () => {
        if (loadState !== 'ready') return message.error('The plan has not finished loading, so it cannot be saved yet.')
        if (!participantId) return message.error('Missing participantId')
        if (!activeProgramId) return message.error('Missing programId')
        if (!userDepartmentId) {
            return message.error('Missing departmentId on user profile')
        }
        if (hasInterventions && !dpDeliveryMethod) {
            return message.error(
                'Select a delivery method for this Developmental Plan.'
            )
        }
        if (hasNoInterventions && !confirmNoInterventions) {
            return message.warning(
                'Confirm that this SME has no interventions under your department.'
            )
        }
        if (coordinatorEditLocked) {
            return message.error(
                'This plan is locked. Ask your HOD to approve an edit request first.'
            )
        }

        const catalogIds = new Set(
            interventionsCatalog
                .map(item => String(item?.id || '').trim())
                .filter(Boolean)
        )
        const requiredKeys = new Set(requiredItems.map(keyOf))

        const isAllowed = (item: BuilderItem) => {
            if (item.source === 'SME') {
                return requiredKeys.has(keyOf(item))
            }

            return catalogIds.has(String(item.id || '').trim())
        }

        const safeFinalList = finalList.filter(isAllowed)

        if (hasInterventions && safeFinalList.length === 0) {
            return message.error(
                'None of the selected interventions belong to your department.'
            )
        }

        const departmentInterventions = mergeCompulsoryInterventions(safeFinalList.map(item => ({
            id: item.id,
            title: item.title,
            source: item.source,
            departmentId: userDepartmentId
        })), interventionsCatalog)

        const userId = String(
            (user as any)?.uid ||
            (user as any)?.id ||
            (user as any)?.email ||
            'unknown'
        ).trim()

        const departmentConfirmation = {
            confirmed: true,
            confirmedAt: serverTimestamp(),
            confirmedBy: userId,
            noInterventions: hasNoInterventions,
            deliveryMethod: hasInterventions ? dpDeliveryMethod : null
        }

        const automaticSmmeConfirmation = {
            confirmed: true,
            confirmedAt: serverTimestamp(),
            confirmedBy: 'system',
            confirmationReason: 'no_interventions'
        }

        setSaving(true)

        try {
            let savedPlanId = existingPlanId
            if (existingPlanId) {
              const planRef = doc(db, 'diagnosticPlans', existingPlanId)
              await runTransaction(db, async transaction => {
                const fresh = await transaction.get(planRef)
                const current = (fresh.exists() ? fresh.data() : existingPlanData) || {}
                const otherDepartments = (
                    current?.interventions || []
                ).filter((item: any) => !belongsToCurrentDepartment(item))

                const idsOf = (items: any[]) => items.map(item => String(item?.id || '').trim()).filter(Boolean).sort().join('|')
                const changed =
                    idsOf((current?.interventions || []).filter(belongsToCurrentDepartment)) !==
                    idsOf(departmentInterventions)
                const smeHadConfirmed = current?.incubateeDepartmentConfirmationsByDeptId?.[userDepartmentId]?.confirmed === true

                const nextConfirmedByDeptId = {
                    ...(current?.confirmedByDeptId || {}),
                    [userDepartmentId]: departmentConfirmation
                }

                const nextSmmeConfirmedByDeptId = {
                    ...(current?.smmeConfirmedByDeptId || {})
                }

                if (hasNoInterventions) {
                    nextSmmeConfirmedByDeptId[userDepartmentId] =
                        automaticSmmeConfirmation
                } else if (
                    nextSmmeConfirmedByDeptId[userDepartmentId]
                        ?.confirmationReason === 'no_interventions'
                ) {
                    delete nextSmmeConfirmedByDeptId[userDepartmentId]
                }

                transaction.update(planRef, {
                    interventions: [
                        ...otherDepartments,
                        ...departmentInterventions
                    ],
                    confirmedByDeptId: nextConfirmedByDeptId,
                    smmeConfirmedByDeptId: nextSmmeConfirmedByDeptId,
                    updatedAt: serverTimestamp(),

                    // A changed offer needs the SME's sign-off again (unless already finalised).
                    ...(changed && smeHadConfirmed && !current?.finalConfirmation
                        ? { [`incubateeDepartmentConfirmationsByDeptId.${userDepartmentId}`]: deleteField() }
                        : {}),

                    // Remove old top-level fields when this plan is saved.
                    updatedByDeptId: deleteField(),
                    updatedByDeptName: deleteField(),
                    deliveryMethod: deleteField(),

                    ...(isCoordinator && isEditUnlockedForDepartment
                        ? {
                            'devPlanEdit.unlocked': false,
                            'devPlanEdit.completedAt': serverTimestamp(),
                            'devPlanEdit.completedByCoordinatorId':
                                String(
                                    (user as any)?.coordinatorId ||
                                    (user as any)?.uid ||
                                    (user as any)?.id ||
                                    ''
                                ).trim() || null
                        }
                        : {})
                })
              })
            } else {
                const createdPlan = await addDoc(collection(db, 'diagnosticPlans'), {
                    participantId,
                    programId: activeProgramId,
                    interventions: departmentInterventions,
                    confirmedByDeptId: {
                        [userDepartmentId]: departmentConfirmation
                    },
                    ...(hasNoInterventions
                        ? {
                            smmeConfirmedByDeptId: {
                                [userDepartmentId]: automaticSmmeConfirmation
                            }
                        }
                        : {}),
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                })
                savedPlanId = createdPlan.id
            }

            let movCreationFailed = false
            if (hasInterventions && savedPlanId) {
                try {
                    await createOrUpdateDiagnosticPlanMovDraft({
                        db,
                        user: {
                            uid: String((user as any)?.uid || (user as any)?.id || ''),
                            name: String((user as any)?.name || ''),
                            email: String((user as any)?.email || ''),
                            departmentName: userDepartmentName,
                            signatureUrl: String((user as any)?.signatureUrl || ''),
                            digitalSignature: String((user as any)?.digitalSignature || '')
                        },
                        assigneeRole: isCoordinator ? 'coordinator' : 'operations',
                        diagnosticPlanId: savedPlanId,
                        participantId,
                        programId: activeProgramId,
                        departmentId: userDepartmentId,
                        departmentName: userDepartmentName,
                        beneficiaryName,
                        deliveryMethod: dpDeliveryMethod || '',
                        status: 'awaiting_smme'
                    })
                } catch (movError) {
                    movCreationFailed = true
                    console.error('[DiagnosticPlanBuilder] Plan saved but MOV creation failed:', movError)
                }
            }

            const savedMessage =
                hasNoInterventions
                    ? 'No interventions confirmed for this department'
                    : movCreationFailed
                        ? 'Developmental Plan saved, but its MOV still needs to be created.'
                        : 'Developmental Plan saved and MOV prepared for SME signature'
                ; (movCreationFailed ? message.warning : message.success)(savedMessage)
            setSavedKey(currentKey)
            navigate('/operations/plan')
        } catch (error) {
            console.error('[DiagnosticPlanBuilder] Failed to save:', error)
            message.error('Failed to save plan')
        } finally {
            setSaving(false)
        }
    }

    const backToList = (
        <Button shape="round" onClick={() => navigate('/operations/plan')}>
            Back to Development Plans
        </Button>
    )

    if (isParentDept) {
        return (
            <div className="ws-page">
                <Result
                    status="info"
                    title="Parent departments don't build plans"
                    subTitle="Your child departments build them. You can see what they confirmed on the Development Plans page."
                    extra={backToList}
                />
            </div>
        )
    }

    if (!participantId) {
        return (
            <div className="ws-page">
                <Result status="warning" title="No SME selected" subTitle="Open the builder from an SME on the Development Plans page." extra={backToList} />
            </div>
        )
    }

    if (coordinatorEditLocked) {
        return (
            <div className="ws-page">
                <Result
                    status="warning"
                    title="This plan is locked"
                    subTitle="Your department has confirmed it. To change it, request an edit from the plan view and wait for your HOD to approve it."
                    extra={backToList}
                />
            </div>
        )
    }

    if (!userDepartmentId) {
        return (
            <div className="ws-page">
                <Result
                    status="warning"
                    title="Your profile has no department"
                    subTitle="A plan is built for one department. Ask an administrator to set your department, then open this page again."
                    extra={<Button shape="round" onClick={() => navigate('/operations/plan')}>Back to Development Plans</Button>}
                />
            </div>
        )
    }

    const inPlanKeys = new Set(finalList.map(keyOf))
    const isInPlan = (id: string, title: string) => inPlanKeys.has(keyOf({ id, title, source: 'Department' }))

    const addDepartmentItem = (id: string, title: string) =>
        setDepartmentSelected(current => uniq([...current, { id, title, source: 'Department' as const }]))

    // Compulsory items are always on the plan, so they never show as choices.
    const catalogChoices = interventionsCatalog
        .filter(item => item.compulsory !== true)
        .map(item => ({ id: String(item.id), title: String(item.interventionTitle || item.title || '').trim() }))
        .filter(item => item.id && item.title)
        .filter(item => !catalogSearch.trim() || item.title.toLowerCase().includes(catalogSearch.trim().toLowerCase()))
        .sort((a, b) => a.title.localeCompare(b.title))

    const sourceLabel = (item: BuilderItem) =>
        item.source === 'SME'
            ? { tone: 'success', label: 'Chosen by SME' }
            : isCompulsoryItem(item)
                ? { tone: 'neutral', label: 'Compulsory' }
                : { tone: 'accent', label: 'Department' }

    const alreadyConfirmed = isDepartmentConfirmed && !isDirty
    const submitLabel = hasNoInterventions
        ? 'Confirm: nothing from us'
        : isDepartmentConfirmed
            ? 'Save changes'
            : `Confirm plan (${finalList.length})`
    const submitBlocked = loadState !== 'ready' || !canSubmit || alreadyConfirmed
    const submitHint =
        loadState === 'failed'
            ? 'The plan could not be loaded, so it cannot be saved.'
            : alreadyConfirmed
                ? 'Your department has confirmed this plan. Change it to save again.'
                : hasInterventions && !dpDeliveryMethod
                    ? 'Choose how the plan was delivered.'
                    : hasNoInterventions && !confirmNoInterventions
                        ? 'Tick the box to confirm there is nothing for this SME.'
                        : null

    const submitButton = (block?: boolean) => (
        <Popconfirm
            title={hasNoInterventions ? 'Confirm nothing from your department?' : 'Confirm this plan?'}
            description={
                hasNoInterventions
                    ? 'The SME has nothing to sign for your department.'
                    : `${finalList.length} intervention${finalList.length === 1 ? '' : 's'}, delivered ${({ InPerson: 'in person', Virtual: 'virtually', Phone: 'by phone', Hybrid: 'hybrid' } as Record<string, string>)[dpDeliveryMethod || ''] || ''}. The SME is asked to sign it.`
            }
            okText="Confirm"
            disabled={submitBlocked}
            onConfirm={savePlan}
        >
            <Button
                data-guide="dp-builder-save-action"
                type="primary"
                shape="round"
                block={block}
                loading={saving}
                disabled={submitBlocked}
            >
                {submitLabel}
            </Button>
        </Popconfirm>
    )

    return (
        <div className="ws-page dpb">
            <Helmet>
                <title>Development Plan Builder | Smart Incubation</title>
            </Helmet>

            <MotionCard style={{ marginBottom: 12 }}>
                <div className="dpb-head" data-guide="dp-builder-header">
                    <Button
                        data-guide="dp-builder-back"
                        shape="circle"
                        icon={<ArrowLeftOutlined />}
                        aria-label="Back to Development Plans"
                        onClick={leave}
                    />
                    <div className="dpb-head-text">
                        <div className="dpb-head-name">{beneficiaryName || 'Development plan'}</div>
                        <div className="dpb-head-sub">
                            Development plan · {userDepartmentName || 'Your department'}
                            {isDepartmentConfirmed && <StatusPill tone="success">Confirmed</StatusPill>}
                            {isEditUnlockedForDepartment && <StatusPill tone="info">Unlocked for editing</StatusPill>}
                        </div>
                    </div>
                    {gapId && (
                        <Button shape="round" icon={<FileSearchOutlined />} onClick={() => setGapResponsesOpen(true)}>
                            <span className="dpb-hide-xs">GAP answers</span>
                        </Button>
                    )}
                </div>
            </MotionCard>

            {loadState === 'failed' && (
                <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="The plan could not be loaded"
                    description="Nothing has been changed. Reload the page to try again."
                    action={<Button size="small" onClick={() => window.location.reload()}>Reload</Button>}
                />
            )}

            <div className="dpb-layout">
                <div className="dpb-sources" data-guide="dp-builder-sources">
                    {hasGapPanel && (
                        <MotionCard loading={loading}>
                            <div data-guide="dp-builder-gap-panel">
                                <h3 className="ws-section-title">
                                    Suggested from the GAP Analysis
                                    {!gapLoading && gapRows.length > 0 && <span className="dpb-count">{gapRows.length}</span>}
                                </h3>
                                {gapLoading ? (
                                    <div className="dpb-muted">Matching the SME's gaps to your interventions…</div>
                                ) : gapUnconfirmed ? (
                                    <Alert
                                        type="warning"
                                        showIcon
                                        message="ROM hasn't confirmed this GAP Analysis yet"
                                        description="Its answers aren't final, so there are no suggestions. You can still add from your catalogue."
                                    />
                                ) : gapRows.length === 0 ? (
                                    <div className="dpb-muted">
                                        {gapId
                                            ? 'No gap in your section matched an intervention in your catalogue.'
                                            : 'No GAP Analysis has been captured for this SME.'}
                                    </div>
                                ) : (
                                    <>
                                        <div className="dpb-list">
                                            {gapRows.map(item => (
                                                <div key={`${item.section}-${item.questionIndex}-${item.id}`} className="dpb-suggestion">
                                                    <div className="dpb-suggestion-main">
                                                        <div className="dpb-gap-q">
                                                            <span className="mv-flag is-danger">{item.answer}</span> {item.question}
                                                        </div>
                                                        <div className="dpb-item-title">{item.title}</div>
                                                        {item.rationale && <div className="dpb-muted">{item.rationale}</div>}
                                                    </div>
                                                    <div className="dpb-suggestion-side">
                                                        <span className="dpb-match" title="How closely the AI thinks this matches">{item.confidence}% match</span>
                                                        {item.inPlan ? (
                                                            <span className="dpb-added"><CheckOutlined /> Added</span>
                                                        ) : (
                                                            <Button size="small" shape="round" icon={<PlusOutlined />} onClick={() => addDepartmentItem(item.id, item.title)}>
                                                                Add
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="dpb-muted dpb-note">AI suggestions: check each one before adding it.</div>
                                    </>
                                )}
                            </div>
                        </MotionCard>
                    )}

                    <MotionCard loading={loading}>
                        <div data-guide="dp-builder-department-panel">
                            <h3 className="ws-section-title">Your catalogue</h3>
                            {interventionsCatalog.filter(item => item.compulsory !== true).length > 8 && (
                                <Input
                                    allowClear
                                    prefix={<SearchOutlined />}
                                    placeholder="Search your interventions"
                                    value={catalogSearch}
                                    onChange={event => setCatalogSearch(event.target.value)}
                                    style={{ marginBottom: 10 }}
                                />
                            )}
                            <div className="dpb-list" data-guide="dp-builder-department-catalog">
                                {catalogChoices.length === 0 ? (
                                    <div className="dpb-muted">
                                        {catalogSearch ? 'No interventions match.' : 'Your department has no other interventions to offer.'}
                                    </div>
                                ) : (
                                    catalogChoices.map(item => {
                                        const added = isInPlan(item.id, item.title)
                                        return (
                                            <button
                                                key={item.id}
                                                type="button"
                                                className={`dpb-choice${added ? ' is-added' : ''}`}
                                                aria-pressed={added}
                                                onClick={() =>
                                                    added
                                                        ? removeFromFinal({ id: item.id, title: item.title, source: 'Department' })
                                                        : addDepartmentItem(item.id, item.title)
                                                }
                                            >
                                                <span className="dpb-choice-mark">{added ? <CheckOutlined /> : <PlusOutlined />}</span>
                                                <span className="dpb-item-title">{item.title}</span>
                                            </button>
                                        )
                                    })
                                )}
                            </div>
                        </div>
                    </MotionCard>
                </div>

                <div className="dpb-plan" data-guide="dp-builder-plan-summary">
                    <MotionCard loading={loading}>
                        <h3 className="ws-section-title">
                            The plan <span className="dpb-count">{finalList.length}</span>
                        </h3>
                        {hasInterventions ? (
                            <div className="dpb-list">
                                {finalList.map(item => {
                                    const label = sourceLabel(item)
                                    const removable = item.source !== 'SME' && !isCompulsoryItem(item)
                                    return (
                                        <div key={keyOf(item)} className="dpb-plan-row">
                                            <span className="dpb-item-title">{item.title}</span>
                                            <StatusPill tone={label.tone}>{label.label}</StatusPill>
                                            {removable ? (
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    shape="circle"
                                                    icon={<CloseOutlined />}
                                                    aria-label={`Remove ${item.title}`}
                                                    onClick={() => removeFromFinal(item)}
                                                />
                                            ) : (
                                                <span className="dpb-row-spacer" />
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="dpb-muted">Nothing added yet. Add from the suggestions or your catalogue.</div>
                        )}

                        <div className="dpb-confirm" data-guide="dp-builder-confirmation-input">
                            {hasInterventions ? (
                                <>
                                    <span className="ws-filter-label">How was the plan delivered?</span>
                                    <Segmented
                                        block
                                        // '' (not undefined): undefined makes Segmented uncontrolled,
                                        // so it looked like "In person" was chosen when nothing was.
                                        value={dpDeliveryMethod || ''}
                                        onChange={value => setDpDeliveryMethod(value as DeliveryMethod)}
                                        options={[
                                            { value: 'InPerson', label: 'In person' },
                                            { value: 'Virtual', label: 'Virtual' },
                                            { value: 'Phone', label: 'Phone' },
                                            { value: 'Hybrid', label: 'Hybrid' }
                                        ]}
                                    />
                                </>
                            ) : (
                                <Checkbox
                                    checked={confirmNoInterventions}
                                    onChange={event => setConfirmNoInterventions(event.target.checked)}
                                >
                                    This SME needs nothing from {userDepartmentName || 'my department'}
                                </Checkbox>
                            )}
                            {!isMobile && submitButton(true)}
                            {submitHint && <div className="dpb-muted">{submitHint}</div>}
                        </div>
                    </MotionCard>
                </div>
            </div>

            {/* On phones the plan scrolls away, so the confirm button rides along at the bottom. */}
            {isMobile && (
                <div className="dpb-mobile-bar">
                    <span>
                        {finalList.length} intervention{finalList.length === 1 ? '' : 's'}
                    </span>
                    {submitButton()}
                </div>
            )}

            <GapResponsesModal
                open={gapResponsesOpen}
                onClose={() => setGapResponsesOpen(false)}
                gapId={gapId}
                sections={ownedSections}
                companyName={beneficiaryName}
            />
        </div>
    )
}

export default DiagnosticPlanBuilder
