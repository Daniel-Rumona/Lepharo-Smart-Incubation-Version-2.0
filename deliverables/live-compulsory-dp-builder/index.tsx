// src/pages/diagnostic-plan/DiagnosticPlanBuilder.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Checkbox,
    Collapse,
    Divider,
    Empty,
    Modal,
    Select,
    Space,
    Steps,
    Table,
    Tag,
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
    serverTimestamp,
    updateDoc,
    where
} from 'firebase/firestore'
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { DashboardHeaderCard, MotionCard } from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { roundBtn } from '@/components/shared/StyledButton'
import { createOrUpdateDiagnosticPlanMovDraft } from '@/services/movService'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'

const { Text } = Typography

type DeliveryMethod = 'InPerson' | 'Virtual' | 'Hybrid'
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

// BEGIN COMPULSORY BUILDER HELPERS
const buildRequiredPlanItems = (selected: BuilderItem[], catalog: any[]): BuilderItem[] => {
    const result: BuilderItem[] = []
    const ids = new Set<string>()
    for (const item of [...selected, ...catalog.filter(iv => iv.compulsory === true).map(iv => ({
        id: String(iv.id || '').trim(),
        title: String(iv.interventionTitle || iv.title || 'Intervention').trim(),
        source: 'Department' as const
    }))]) {
        const id = String(item.id || '').trim()
        if (!id || ids.has(id)) continue
        ids.add(id)
        result.push({ ...item, id })
    }
    return result
}
// END COMPULSORY BUILDER HELPERS

const toMillis = (value: any): number => {
    if (!value) return 0
    if (typeof value === 'number') return value
    if (value instanceof Date) return value.getTime()
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (typeof value?.seconds === 'number') return value.seconds * 1000
    return 0
}

const keyOf = (item: BuilderItem) =>
    `${String(item.id || '').trim()}::${String(item.title || '').trim().toLowerCase()}`

const uniq = (items: BuilderItem[]) => {
    const seen = new Set<string>()

    return items.filter(item => {
        const key = keyOf(item)
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

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

    const userDepartmentId = String((user as any)?.departmentId || '').trim()
    const userDepartmentName = String((user as any)?.departmentName || '').trim()
    const roleRaw = String((user as any)?.role || '').toLowerCase().trim()
    const isCoordinator = roleRaw === 'coordinator'

    const isParentDept =
        roleRaw === 'operations' && (user as any)?.isParentDepartment === true

    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)

    const [step, setStep] = useState(0)
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [confirmNoInterventions, setConfirmNoInterventions] = useState(false)

    const [dpDeliveryMethod, setDpDeliveryMethod] =
        useState<DeliveryMethod | undefined>(undefined)

    const [gapSuggestions, setGapSuggestions] = useState<BuilderItem[]>([])
    const [requiredItems, setRequiredItems] = useState<BuilderItem[]>([])
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

    const hasGapStep = gapSuggestions.length > 0

    const stepItems = useMemo(
        () =>
            hasGapStep
                ? [
                    { title: 'Gap Analysis' },
                    { title: 'SME Selected' },
                    { title: 'Department Additions' },
                    { title: 'Confirm' }
                ]
                : [
                    { title: 'SME Selected' },
                    { title: 'Department Additions' },
                    { title: 'Confirm' }
                ],
        [hasGapStep]
    )

    const smeStepIndex = hasGapStep ? 1 : 0
    const departmentStepIndex = hasGapStep ? 2 : 1
    const confirmStepIndex = hasGapStep ? 3 : 2

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
                            'Understand the Development Plan builder, its stages and how to return to the participant list.',
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
                                element: guideTarget('dp-builder-steps'),
                                popover: {
                                    title: 'Builder stages',
                                    description:
                                        'Move through SME-selected interventions, department additions and final confirmation. A Gap Analysis stage appears when gap suggestions are available.',
                                    side: 'bottom',
                                    align: 'start'
                                }
                            },
                            {
                                element: guideTarget('dp-builder-current-step'),
                                waitForElement: 5000,
                                popover: {
                                    title: 'Current stage',
                                    description:
                                        'Complete the information shown in the current stage, then use Next to continue through the builder.',
                                    side: 'top',
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
                            'Walk through the current Development Plan from selections to final submission.',
                        kind: 'process',
                        order: 2,
                        steps: () => {
                            const steps: any[] = [
                                {
                                    element: guideTarget('dp-builder-steps'),
                                    popover: {
                                        title: 'Development Plan stages',
                                        description:
                                            'The workflow moves from the SME selections to your department additions and then to confirmation.',
                                        side: 'bottom',
                                        align: 'start'
                                    }
                                }
                            ]

                            if (hasGapStep && step <= 0) {
                                steps.push(
                                    {
                                        element: guideTarget('dp-builder-gap-step'),
                                        waitForElement: 5000,
                                        popover: {
                                            title: 'Gap Analysis suggestions',
                                            description:
                                                'Review suggestions relevant to your department. Accepted suggestions are added as Department interventions.',
                                            side: 'top',
                                            align: 'start'
                                        }
                                    },
                                    {
                                        element: guideTarget('dp-builder-gap-next'),
                                        waitForElement: 1500,
                                        advanceOnClick: true,
                                        popover: {
                                            title: 'Continue',
                                            description:
                                                'When the gap suggestions are ready, continue to the SME-selected interventions.',
                                            side: 'top',
                                            align: 'center',
                                            showButtons: ['close']
                                        }
                                    }
                                )
                            }

                            if (step <= smeStepIndex) {
                                steps.push(
                                    {
                                        element: guideTarget('dp-builder-sme-step'),
                                        waitForElement: 5000,
                                        popover: {
                                            title: 'SME-selected interventions',
                                            description:
                                                'These interventions came from the SME application for your department. They are required here and cannot be removed by the department.',
                                            side: 'top',
                                            align: 'start'
                                        }
                                    },
                                    {
                                        element: guideTarget('dp-builder-sme-next'),
                                        waitForElement: 1500,
                                        advanceOnClick: true,
                                        popover: {
                                            title: 'Continue to department additions',
                                            description:
                                                'Continue after reviewing the interventions selected by the SME.',
                                            side: 'top',
                                            align: 'center',
                                            showButtons: ['close']
                                        }
                                    }
                                )
                            }

                            if (step <= departmentStepIndex) {
                                steps.push(
                                    {
                                        element: guideTarget('dp-builder-department-step'),
                                        waitForElement: 5000,
                                        popover: {
                                            title: 'Department additions',
                                            description:
                                                'Add any additional interventions from your own department catalogue that should form part of this SME’s Development Plan.',
                                            side: 'top',
                                            align: 'start'
                                        }
                                    },
                                    {
                                        element: guideTarget('dp-builder-department-catalog'),
                                        waitForElement: 1500,
                                        popover: {
                                            title: 'Available interventions',
                                            description:
                                                'Open the catalogue and select the department interventions that apply. Existing department additions also appear here when editing.',
                                            side: 'right',
                                            align: 'start'
                                        }
                                    },
                                    {
                                        element: guideTarget('dp-builder-department-next'),
                                        waitForElement: 1500,
                                        advanceOnClick: true,
                                        popover: {
                                            title: 'Review the plan',
                                            description:
                                                'Continue when the department additions are complete.',
                                            side: 'top',
                                            align: 'center',
                                            showButtons: ['close']
                                        }
                                    }
                                )
                            }

                            if (step <= confirmStepIndex) {
                                steps.push(
                                    {
                                        element: guideTarget('dp-builder-confirm-step'),
                                        waitForElement: 5000,
                                        popover: {
                                            title: 'Review and confirm',
                                            description:
                                                'Review the final SME and Department intervention list before submitting your department’s Development Plan confirmation.',
                                            side: 'top',
                                            align: 'start'
                                        }
                                    },
                                    {
                                        element: guideTarget('dp-builder-save-action'),
                                        waitForElement: 1500,
                                        advanceOnClick: true,
                                        popover: {
                                            title: 'Save Plan',
                                            description:
                                                'Open the final confirmation window.',
                                            side: 'top',
                                            align: 'center',
                                            showButtons: ['close']
                                        }
                                    },
                                    {
                                        element: '.guide-dp-builder-confirm-modal',
                                        waitForElement: 5000,
                                        popover: {
                                            title: 'Final confirmation',
                                            description:
                                                'Confirm the submission details before the department is marked as confirmed.',
                                            side: 'left',
                                            align: 'start'
                                        }
                                    },
                                    {
                                        element: guideTarget('dp-builder-confirmation-input'),
                                        waitForElement: 1500,
                                        popover: {
                                            title: 'Submission requirement',
                                            description:
                                                'If interventions exist, select the delivery method. If there are no interventions, explicitly confirm that your department has none for this SME.',
                                            side: 'right',
                                            align: 'start'
                                        }
                                    },
                                    {
                                        element: '.guide-dp-builder-submit',
                                        waitForElement: 1500,
                                        popover: {
                                            title: 'Submit Plan',
                                            description:
                                                'Submit when the confirmation requirement is complete. The plan is saved and, when interventions exist, its MOV is prepared for SME signature.',
                                            side: 'top',
                                            align: 'center'
                                        }
                                    }
                                )
                            }

                            return steps
                        }
                    }
                ]
                : []
        }),
        [
            canUseBuilderGuide,
            confirmStepIndex,
            departmentStepIndex,
            hasGapStep,
            smeStepIndex,
            step
        ]
    )

    usePageGuides(guideRegistration)

    useEffect(() => {
        const load = async () => {
            if (!participantId || !activeProgramId || !userDepartmentId) return

            setLoading(true)

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

                setRequiredItems(uniq(requiredForDepartment))

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

                // Gap suggestions will be connected later.
                // Any accepted suggestion is saved as Department source.
                setGapSuggestions([])

                const planQuery = query(
                    collection(db, 'diagnosticPlans'),
                    where('participantId', '==', participantId),
                    where('programId', '==', activeProgramId)
                )
                const planSnapshot = await getDocs(planQuery)

                let latest: { id: string; data: any; ms: number } | null = null

                planSnapshot.docs.forEach(document => {
                    const data = document.data()
                    const ms = toMillis(data?.createdAt)

                    if (!latest || ms > latest.ms) {
                        latest = { id: document.id, data, ms }
                    }
                })

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

                setDepartmentSelected(uniq(savedDepartmentItems))
            } catch (error) {
                console.error('[DiagnosticPlanBuilder] Failed to load:', error)
                message.error('Failed to load builder data')
            } finally {
                setLoading(false)
            }
        }

        load()
    }, [participantId, activeProgramId, userDepartmentId])

    useEffect(() => {
        const maxStep = stepItems.length - 1
        if (step > maxStep) setStep(maxStep)
    }, [step, stepItems.length])

    const goNext = () =>
        setStep(current => Math.min(current + 1, stepItems.length - 1))

    const goBack = () => setStep(current => Math.max(current - 1, 0))

    const compulsoryIds = useMemo(() => new Set<string>(
        interventionsCatalog.filter(item => item.compulsory === true)
            .map(item => String(item.id || '').trim()).filter(Boolean)
    ), [interventionsCatalog])

    const finalList = useMemo(
        () => buildRequiredPlanItems([...requiredItems, ...departmentSelected], interventionsCatalog),
        [requiredItems, departmentSelected, interventionsCatalog]
    )

    const hasInterventions = finalList.length > 0
    const hasNoInterventions = !hasInterventions

    useEffect(() => {
        if (hasInterventions) {
            setConfirmNoInterventions(false)
        }
    }, [hasInterventions])

    const removeFromFinal = (item: BuilderItem) => {
        if (compulsoryIds.has(String(item.id).trim())) {
            message.info('Compulsory interventions are included automatically and cannot be removed here.')
            return
        }
        if (item.source === 'SME') {
            message.info('SME-selected interventions cannot be removed here.')
            return
        }

        const key = keyOf(item)
        setDepartmentSelected(current =>
            current.filter(selected => keyOf(selected) !== key)
        )
    }

    const baseColumns = useMemo(
        () => [
            {
                title: 'Intervention',
                dataIndex: 'title'
            },
            {
                title: 'Source',
                dataIndex: 'source',
                width: 140,
                render: (source: PlanSource) => (
                    <Tag color={source === 'SME' ? 'green' : 'gold'}>
                        {source}
                    </Tag>
                )
            }
        ],
        []
    )

    const confirmColumns = useMemo(
        () => [
            ...baseColumns,
            {
                title: 'Action',
                width: 110,
                render: (_: unknown, item: BuilderItem) =>
                    item.source === 'Department' && !compulsoryIds.has(String(item.id).trim()) ? (
                        <Button
                            danger
                            type="link"
                            onClick={() => removeFromFinal(item)}
                        >
                            Remove
                        </Button>
                    ) : (
                        <Text type="secondary">{compulsoryIds.has(String(item.id).trim()) ? 'Compulsory' : 'Required'}</Text>
                    )
            }
        ],
        [baseColumns, compulsoryIds]
    )

    const canSubmit = hasInterventions
        ? Boolean(dpDeliveryMethod)
        : confirmNoInterventions

    const openConfirmation = () => {
        if (hasNoInterventions) {
            setConfirmNoInterventions(false)
        }
        setConfirmOpen(true)
    }

    const savePlan = async () => {
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

        const departmentInterventions = safeFinalList.map(item => ({
            id: item.id,
            title: item.title,
            source: item.source,
            departmentId: userDepartmentId,
            compulsory: compulsoryIds.has(String(item.id).trim())
        }))

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
                const otherDepartments = (
                    existingPlanData?.interventions || []
                ).filter((item: any) => !belongsToCurrentDepartment(item))

                const nextConfirmedByDeptId = {
                    ...(existingPlanData?.confirmedByDeptId || {}),
                    [userDepartmentId]: departmentConfirmation
                }

                const nextSmmeConfirmedByDeptId = {
                    ...(existingPlanData?.smmeConfirmedByDeptId || {})
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

                await updateDoc(doc(db, 'diagnosticPlans', existingPlanId), {
                    interventions: [
                        ...otherDepartments,
                        ...departmentInterventions
                    ],
                    confirmedByDeptId: nextConfirmedByDeptId,
                    smmeConfirmedByDeptId: nextSmmeConfirmedByDeptId,
                    updatedAt: serverTimestamp(),

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
            setConfirmOpen(false)
            navigate('/operations/plan')
        } catch (error) {
            console.error('[DiagnosticPlanBuilder] Failed to save:', error)
            message.error('Failed to save plan')
        } finally {
            setSaving(false)
        }
    }

    if (isParentDept) {
        return (
            <Card style={{ minHeight: '100vh' }}>
                <Alert
                    type="info"
                    showIcon
                    message="Parent departments do not build here."
                    description="View the confirmed interventions from the Developmental Plans page."
                />
                <Divider />
                <Button
                    icon={<ArrowLeftOutlined />}
                    iconPosition="start"
                    style={roundBtn}
                    onClick={() => navigate('/operations/plan')}
                >
                    Back to Selections
                </Button>
            </Card>
        )
    }

    if (!participantId) {
        return (
            <Card style={{ minHeight: '100vh' }}>
                <Alert type="warning" showIcon message="No participant selected." />
                <Divider />
                <Button
                    icon={<ArrowLeftOutlined />}
                    iconPosition="start"
                    style={roundBtn}
                    onClick={() => navigate('/operations/plan')}
                >
                    Back to Selections
                </Button>
            </Card>
        )
    }

    if (coordinatorEditLocked) {
        return (
            <Card style={{ minHeight: '100vh' }}>
                <Alert
                    type="warning"
                    showIcon
                    message="This Developmental Plan is locked."
                    description="Send an edit request from the confirmed plan view and wait for your HOD to approve it."
                />
                <Divider />
                <Button
                    icon={<ArrowLeftOutlined />}
                    iconPosition="start"
                    style={roundBtn}
                    onClick={() => navigate('/operations/plan')}
                >
                    Back to Developmental Plans
                </Button>
            </Card>
        )
    }

    const existingPlanInfo = existingPlanId ? (
        <Tag color="blue">Existing Plan Found</Tag>
    ) : (
        <Tag color="orange">No Plan Yet</Tag>
    )

    const departmentCollapseItems = [
        ...(existingPlanId && departmentSelected.length > 0
            ? [
                {
                    key: 'previous',
                    label: 'Previously Added by Department',
                    children: (
                        <Table
                            dataSource={departmentSelected}
                            columns={confirmColumns as any}
                            rowKey={keyOf}
                            pagination={false}
                            size="small"
                        />
                    )
                }
            ]
            : []),
        {
            key: 'catalog',
            label: 'Available Department Interventions',
            children:
                interventionsCatalog.length === 0 ? (
                    <Empty description="No interventions found for this department" />
                ) : (
                    <Checkbox.Group
                        style={{ width: '100%' }}
                        value={Array.from(new Set([...departmentSelected.map(item => item.id), ...compulsoryIds]))}
                        onChange={values => {
                            const selectedIds = new Set(
                                (values as string[]).map(String)
                            )

                            const selectedItems: BuilderItem[] =
                                interventionsCatalog
                                    .filter(item =>
                                        selectedIds.has(String(item.id)) || item.compulsory === true
                                    )
                                    .filter(isSameDeptIntervention)
                                    .map(item => ({
                                        id: String(item.id),
                                        title: String(
                                            item.interventionTitle ||
                                            item.title ||
                                            ''
                                        ).trim(),
                                        source: 'Department' as const
                                    }))
                                    .filter(item => item.id && item.title)

                            setDepartmentSelected(uniq(selectedItems))
                        }}
                    >
                        <Space direction="vertical" size={10}>
                            {interventionsCatalog.map(item => (
                                <Checkbox
                                    key={String(item.id)}
                                    value={String(item.id)}
                                    disabled={item.compulsory === true}
                                >
                                    {String(
                                        item.interventionTitle || item.title || ''
                                    )}
                                    {item.compulsory === true && <Tag color="red" style={{ marginLeft: 8 }}>Compulsory</Tag>}
                                </Checkbox>
                            ))}
                        </Space>
                    </Checkbox.Group>
                )
        }
    ]

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Development Plan Builder | Smart Incubation</title>
            </Helmet>

            <div data-guide="dp-builder-header">
                <DashboardHeaderCard
                    title={
                        beneficiaryName
                            ? `Developmental Plan: ${beneficiaryName}`
                            : 'Developmental Plan Builder'
                    }
                    subtitle={
                        <Space wrap>
                            <span>{`Department: ${userDepartmentName || '—'}`}</span>
                            {existingPlanInfo}
                        </Space>
                    }
                    extraRight={
                        <Button
                            data-guide="dp-builder-back"
                            icon={<ArrowLeftOutlined />}
                            iconPosition="start"
                            color="primary"
                            variant="filled"
                            style={roundBtn}
                            onClick={() => navigate('/operations/plan')}
                        >
                            Back to Selections
                        </Button>
                    }
                />
            </div>

            <MotionCard style={{ marginTop: 12 }}>
                <Steps
                    data-guide="dp-builder-steps"
                    type="navigation"
                    size="small"
                    current={step}
                    onChange={setStep}
                    items={stepItems}
                />
            </MotionCard>

            {loading && <LoadingOverlay tip="Loading data..." />}

            <Divider />

            {hasGapStep && step === 0 && (
                <div
                    data-guide="dp-builder-current-step"
                    style={{ width: '100%' }}
                >
                    <MotionCard data-guide="dp-builder-gap-step">
                        <Alert
                            type="info"
                            showIcon
                            message="Gap suggestions for your department"
                            description="Accepted gap suggestions will be recorded as Department interventions."
                            style={{ marginBottom: 12 }}
                        />

                        <Table
                            dataSource={gapSuggestions}
                            columns={[
                                ...baseColumns,
                                {
                                    title: 'Action',
                                    render: (_: unknown, item: BuilderItem) => (
                                        <Button
                                            type="link"
                                            onClick={() =>
                                                setDepartmentSelected(current =>
                                                    uniq([
                                                        ...current,
                                                        {
                                                            ...item,
                                                            source: 'Department'
                                                        }
                                                    ])
                                                )
                                            }
                                        >
                                            Accept
                                        </Button>
                                    )
                                }
                            ]}
                            rowKey={keyOf}
                            pagination={false}
                            size="small"
                        />

                        <Divider />
                        <Space wrap>
                            <Button onClick={() => navigate('/operations/plan')}>
                                Cancel
                            </Button>
                            <Button
                                data-guide="dp-builder-gap-next"
                                type="primary"
                                onClick={goNext}
                            >
                                Next
                            </Button>
                        </Space>
                    </MotionCard>
                </div>
            )}

            {step === smeStepIndex && (
                <div
                    data-guide="dp-builder-current-step"
                    style={{ width: '100%' }}
                >
                    <MotionCard data-guide="dp-builder-sme-step">
                        <Alert
                            type="info"
                            showIcon
                            message="Interventions selected by the SME"
                            description="These came from the SME's application and cannot be removed by the department."
                            style={{ marginBottom: 12 }}
                        />

                        {requiredItems.length === 0 ? (
                            <Empty description="The SME selected no interventions for this department" />
                        ) : (
                            <Table
                                dataSource={requiredItems}
                                columns={baseColumns as any}
                                rowKey={keyOf}
                                pagination={false}
                                size="small"
                            />
                        )}

                        <Divider />
                        <Space wrap>
                            <Button
                                icon={<ArrowLeftOutlined />}
                                iconPosition="start"
                                style={roundBtn}
                                onClick={() =>
                                    hasGapStep
                                        ? goBack()
                                        : navigate('/operations/plan')
                                }
                            >
                                Back
                            </Button>

                            <Button
                                data-guide="dp-builder-sme-next"
                                icon={<ArrowRightOutlined />}
                                iconPosition="end"
                                style={roundBtn}
                                color="primary"
                                variant="filled"
                                onClick={goNext}
                            >
                                Next
                            </Button>
                        </Space>
                    </MotionCard>
                </div>
            )}

            {step === departmentStepIndex && (
                <div
                    data-guide="dp-builder-current-step"
                    style={{ width: '100%' }}
                >
                    <MotionCard data-guide="dp-builder-department-step">
                        <Alert
                            type="info"
                            showIcon
                            message="Add interventions from your department"
                            description="Anything added here will be recorded with Department as its source."
                            style={{ marginBottom: 12 }}
                        />

                        <div data-guide="dp-builder-department-catalog">
                            <Collapse accordion items={departmentCollapseItems} />
                        </div>

                        <Divider />
                        <Space wrap>
                            <Button
                                icon={<ArrowLeftOutlined />}
                                iconPosition="start"
                                style={roundBtn}
                                onClick={goBack}
                            >
                                Back
                            </Button>
                            <Button
                                data-guide="dp-builder-department-next"
                                icon={<ArrowRightOutlined />}
                                iconPosition="end"
                                style={roundBtn}
                                color="primary"
                                variant="filled"
                                onClick={goNext}
                            >
                                Next
                            </Button>
                        </Space>
                    </MotionCard>
                </div>
            )}

            {step === confirmStepIndex && (
                <div
                    data-guide="dp-builder-current-step"
                    style={{ width: '100%' }}
                >
                    <MotionCard data-guide="dp-builder-confirm-step">
                        <Alert
                            type={hasInterventions ? 'success' : 'warning'}
                            showIcon
                            message={
                                hasInterventions
                                    ? 'Review and confirm the Developmental Plan'
                                    : 'No interventions selected for this department'
                            }
                            description={
                                hasInterventions
                                    ? 'Optional department interventions can be removed. Compulsory interventions are included automatically and need no SME DP sign-off.'
                                    : 'You may still submit, but you must explicitly confirm that this SME has no interventions under your department.'
                            }
                            style={{ marginBottom: 12 }}
                        />

                        {hasInterventions ? (
                            <Table
                                dataSource={finalList}
                                columns={confirmColumns as any}
                                rowKey={keyOf}
                                pagination={false}
                                size="small"
                            />
                        ) : (
                            <Empty description="No SME or Department interventions selected" />
                        )}

                        {hasInterventions && !dpDeliveryMethod && (
                            <Alert
                                type="warning"
                                showIcon
                                message="Delivery method required"
                                description="The delivery method will be selected in the confirmation window."
                                style={{ marginTop: 12 }}
                            />
                        )}

                        <Divider />
                        <Space wrap>
                            <Button
                                icon={<ArrowLeftOutlined />}
                                iconPosition="start"
                                style={roundBtn}
                                onClick={goBack}
                            >
                                Back
                            </Button>
                            <Button
                                data-guide="dp-builder-save-action"
                                type="primary"
                                style={roundBtn}
                                onClick={openConfirmation}
                                disabled={!participantId}
                            >
                                Save Plan
                            </Button>
                        </Space>
                    </MotionCard>
                </div>
            )}

            <Modal
                className="guide-dp-builder-confirm-modal"
                title={
                    hasInterventions
                        ? 'Confirm Developmental Plan'
                        : 'Confirm No Interventions'
                }
                open={confirmOpen}
                onCancel={() => {
                    if (!saving) setConfirmOpen(false)
                }}
                onOk={savePlan}
                okText={hasInterventions ? 'Submit Plan' : 'Confirm No Interventions'}
                confirmLoading={saving}
                closable={!saving}
                maskClosable={!saving}
                okButtonProps={{
                    disabled: !canSubmit,
                    className: 'guide-dp-builder-submit'
                }}
            >
                <div data-guide="dp-builder-confirmation-input">
                    {hasInterventions ? (
                        <>
                            <Alert
                                type="warning"
                                showIcon
                                message="Confirm your department's submission"
                                description={
                                    existingPlanId
                                        ? 'Only your department interventions will be replaced. Other departments remain untouched.'
                                        : 'A new Developmental Plan will be created for this SME and program.'
                                }
                                style={{ marginBottom: 16 }}
                            />

                            <div style={{ marginBottom: 8 }}>
                                <Text strong>Delivery Method *</Text>
                            </div>

                            <Select
                                style={{ width: '100%' }}
                                placeholder="Select delivery method"
                                value={dpDeliveryMethod}
                                onChange={value =>
                                    setDpDeliveryMethod(value as DeliveryMethod)
                                }
                                options={[
                                    { value: 'InPerson', label: 'In person' },
                                    { value: 'Virtual', label: 'Virtual' },
                                    { value: 'Hybrid', label: 'Hybrid' }
                                ]}
                            />
                        </>
                    ) : (
                        <>
                            <Alert
                                type="warning"
                                showIcon
                                message="This department has no interventions for the SME"
                                description="Submitting this confirmation will automatically mark the SME confirmation as complete for this department because there is nothing for the SME to approve."
                                style={{ marginBottom: 16 }}
                            />

                            <Checkbox
                                checked={confirmNoInterventions}
                                onChange={event =>
                                    setConfirmNoInterventions(event.target.checked)
                                }
                            >
                                I confirm that this SME has no interventions under my
                                department.
                            </Checkbox>
                        </>
                    )}
                </div>
            </Modal>
        </div>
    )
}

export default DiagnosticPlanBuilder