// src/pages/diagnostic-plan/DiagnosticPlanBuilder.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Checkbox,
    Col,
    Collapse,
    Divider,
    Empty,
    Grid,
    Modal,
    Select,
    Space,
    Row,
    Table,
    Tag,
    Typography,
    theme,
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
import { ArrowLeftOutlined, FileSearchOutlined } from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { roundBtn } from '@/components/shared/StyledButton'
import { createOrUpdateDiagnosticPlanMovDraft } from '@/services/movService'
import { loadGapSuggestions, type GapSuggestion } from '@/services/gapSuggestionsService'
import { getOwnedSectionsForDept } from '@/routes/gap/sections'
import GapResponsesModal from '@/routes/gap/view/GapResponsesModal'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'

const { Text } = Typography
const { useBreakpoint } = Grid

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

    const screens = useBreakpoint()
    const isMobile = !screens.md
    const { token } = theme.useToken()

    const userDepartmentId = String((user as any)?.departmentId || '').trim()
    const userDepartmentName = String((user as any)?.departmentName || '').trim()
    const roleRaw = String((user as any)?.role || '').toLowerCase().trim()
    const isCoordinator = roleRaw === 'coordinator'

    const isParentDept =
        roleRaw === 'operations' && (user as any)?.isParentDepartment === true

    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)

    const [confirmOpen, setConfirmOpen] = useState(false)
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
        () => getOwnedSectionsForDept(userDepartmentName),
        [userDepartmentName]
    )
    const hasGapPanel = ownedSections.length > 0
    const hasSmeItems = requiredItems.length > 0

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
                                        'Three sources feed the plan: gaps identified in the GAP Analysis, the interventions the SME selected, and your own department catalogue. Open any panel to add from it.',
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
                                        'Everything you add appears here immediately. This is exactly what will be submitted for your department.',
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

                            if (hasSmeItems) {
                                steps.push({
                                    element: guideTarget('dp-builder-sme-panel'),
                                    waitForElement: 5000,
                                    popover: {
                                        title: 'Interventions selected by the SME',
                                        description:
                                            'These came from the SME application and are always part of the plan. They cannot be removed by the department.',
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
                                            'Tick any additional interventions your department will deliver for this SME.',
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
                                            'Check the combined SME and Department list. Department interventions can still be removed here before submission.',
                                        side: 'left',
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

                            return steps
                        }
                    }
                ]
                : []
        }),
        [canUseBuilderGuide, hasGapPanel, hasSmeItems]
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

                setGapLoading(true)
                loadGapSuggestions(participantId, userDepartmentName, catalogueTitles)
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

                setPreviousDepartmentItems(uniq(savedDepartmentItems))
                setDepartmentSelected([])
            } catch (error) {
                console.error('[DiagnosticPlanBuilder] Failed to load:', error)
                message.error('Failed to load builder data')
            } finally {
                setLoading(false)
            }
        }

        load()
    }, [participantId, activeProgramId, userDepartmentId])
    const finalList = useMemo(
        () => uniq([...requiredItems, ...previousDepartmentItems, ...departmentSelected]),
        [requiredItems, previousDepartmentItems, departmentSelected]
    )

    const hasInterventions = finalList.length > 0
    const hasNoInterventions = !hasInterventions

    useEffect(() => {
        if (hasInterventions) {
            setConfirmNoInterventions(false)
        }
    }, [hasInterventions])

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
                    item.source === 'Department' ? (
                        <Button
                            danger
                            type="link"
                            onClick={() => removeFromFinal(item)}
                        >
                            Remove
                        </Button>
                    ) : (
                        <Text type="secondary">Required</Text>
                    )
            }
        ],
        [baseColumns]
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
            departmentId: userDepartmentId
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

    const previousDepartmentIds = new Set(
        previousDepartmentItems.map(item => String(item.id || '').trim()).filter(Boolean)
    )

    const availableDepartmentCatalog = interventionsCatalog.filter(
        item => !previousDepartmentIds.has(String(item?.id || '').trim())
    )

    const departmentCatalog =
        availableDepartmentCatalog.length === 0 ? (
            <Empty description="No additional interventions available for this department" />
        ) : (
            <Checkbox.Group
                style={{ width: '100%' }}
                value={departmentSelected.map(item => item.id)}
                onChange={values => {
                    const selectedIds = new Set((values as string[]).map(String))

                    const selectedItems: BuilderItem[] = availableDepartmentCatalog
                        .filter(item => selectedIds.has(String(item.id)))
                        .filter(isSameDeptIntervention)
                        .map(item => ({
                            id: String(item.id),
                            title: String(
                                item.interventionTitle || item.title || ''
                            ).trim(),
                            source: 'Department' as const
                        }))
                        .filter(item => item.id && item.title)

                    // Merge rather than replace. A gap suggestion can point at an
                    // intervention that is not in availableDepartmentCatalog (it is
                    // filtered to exclude previously selected ones), and rebuilding
                    // purely from the ticked boxes would silently drop it.
                    const availableIds = new Set(
                        availableDepartmentCatalog.map(item => String(item.id || '').trim())
                    )

                    setDepartmentSelected(current =>
                        uniq([
                            ...current.filter(item => !availableIds.has(item.id)),
                            ...selectedItems
                        ])
                    )
                }}
            >
                <Space direction="vertical" size={10}>
                    {availableDepartmentCatalog.map(item => (
                        <Checkbox key={String(item.id)} value={String(item.id)}>
                            {String(item.interventionTitle || item.title || '')}
                        </Checkbox>
                    ))}
                </Space>
            </Checkbox.Group>
        )


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

    const acceptSuggestion = (item: GapSuggestion) =>
        setDepartmentSelected(current =>
            uniq([
                ...current,
                { id: item.id, title: item.title, source: 'Department' as const }
            ])
        )

    const gapPanel = (
        <div data-guide="dp-builder-gap-panel">
            <Space
                wrap
                align="center"
                style={{
                    width: '100%',
                    justifyContent: 'space-between',
                    marginBottom: 12
                }}
            >
                <Text type="secondary">
                    Gaps identified for your department,
                    matched to your catalogue. Accepting one records it as a
                    Department intervention.
                </Text>
            </Space>

            {gapLoading ? (
                <Alert
                    type="info"
                    showIcon
                    message="Matching gaps to your interventions…"
                />
            ) : gapUnconfirmed ? (
                <Alert
                    type="warning"
                    showIcon
                    message="GAP Analysis not confirmed yet"
                    description="ROM has not confirmed this GAP, so its answers are not final. Build the plan from the SME and Department panels, or ask ROM to confirm first."
                />
            ) : gapRows.length === 0 ? (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                        gapId
                            ? 'No gaps in your section matched an intervention in your catalogue.'
                            : 'No GAP Analysis has been captured for this participant.'
                    }
                />
            ) : (
                <Table
                    dataSource={gapRows}
                    columns={[
                        {
                            title: 'Gap identified',
                            dataIndex: 'question',
                            render: (_: unknown, item: any) => (
                                <div>
                                    <div>{item.question}</div>
                                    <Space size={6} wrap style={{ marginTop: 4 }}>
                                        <Tag color="red">{item.answer}</Tag>
                                        {item.comment ? (
                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                                {item.comment}
                                            </Text>
                                        ) : null}
                                    </Space>
                                </div>
                            )
                        },
                        {
                            title: 'Suggested intervention',
                            dataIndex: 'title',
                            render: (_: unknown, item: any) => (
                                <div>
                                    <div>{item.title}</div>
                                    {item.rationale ? (
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            {item.rationale}
                                        </Text>
                                    ) : null}
                                </div>
                            )
                        },
                        {
                            title: 'Confidence',
                            dataIndex: 'confidence',
                            width: 110,
                            render: (value: number) => (
                                <Tag
                                    color={
                                        value >= 70 ? 'blue' : value >= 40 ? 'orange' : undefined
                                    }
                                >
                                    {value}%
                                </Tag>
                            )
                        },
                        {
                            title: 'Action',
                            width: 110,
                            render: (_: unknown, item: any) =>
                                item.inPlan ? (
                                    <Tag color="green">In plan</Tag>
                                ) : (
                                    <Button
                                        type="link"

                                        onClick={() => acceptSuggestion(item)}
                                    >
                                        Accept
                                    </Button>
                                )
                        }
                    ]}
                    rowKey={item => `${item.section}-${item.questionIndex}-${item.id}`}
                    pagination={false}
                    size="small"
                />
            )}

            <Alert
                type="info"
                showIcon
                message="AI-suggested matches — review each one before accepting."
                style={{ marginTop: 12 }}
            />
        </div>
    )

    const sourcePanels = [
        ...(hasGapPanel
            ? [
                {
                    key: 'gap',
                    label: (
                        <Space>
                            <Text strong>From the GAP Analysis</Text>
                            {gapLoading ? (
                                <Tag>loading…</Tag>
                            ) : gapRows.length ? (
                                <Tag color="gold">{gapRows.length}</Tag>
                            ) : null}
                        </Space>
                    ),
                    children: gapPanel,
                    forceRender: true
                }
            ]
            : []),
        // Omitted entirely when the SME chose nothing for this department —
        // an empty panel is noise, and the absence is already visible in the plan.
        ...(hasSmeItems
            ? [
                {
                    key: 'sme',
                    label: (
                        <Space>
                            <Text strong>Selected by the SME</Text>
                            <Tag color="green">{requiredItems.length}</Tag>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                read-only
                            </Text>
                        </Space>
                    ),
                    forceRender: true,
                    children: (
                        <div data-guide="dp-builder-sme-panel">
                            <Text type="secondary">
                                These came from the SME’s application and cannot be
                                removed by the department.
                            </Text>
                            <div style={{ marginTop: 12 }}>
                                <Table
                                    dataSource={requiredItems}
                                    columns={baseColumns as any}
                                    rowKey={keyOf}
                                    pagination={false}
                                    size="small"
                                />
                            </div>
                        </div>
                    )
                }
            ]
            : []),
        {
            key: 'department',
            label: (
                <Space>
                    <Text strong>Your department catalogue</Text>
                    <Tag>{availableDepartmentCatalog.length}</Tag>
                </Space>
            ),
            forceRender: true,
            children: (
                <div data-guide="dp-builder-department-panel">
                    <Text type="secondary">
                        Tick any additional interventions your department will deliver.
                        Anything already in the plan appears on the right.
                    </Text>
                    <div
                        data-guide="dp-builder-department-catalog"
                        style={{ marginTop: 12 }}
                    >
                        {departmentCatalog}
                    </div>
                </div>
            )
        }
    ]

    return (
        <div style={{ padding: '5px 24px', }}>
            <Helmet>
                <title>Development Plan Builder | Smart Incubation</title>
            </Helmet>

            <MotionCard style={{ marginBottom: 12 }}>
                <div
                    data-guide="dp-builder-header"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 16,
                        width: '100%',
                        flexWrap: 'wrap'
                    }}
                >
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

                    <div style={{ flex: 1, minWidth: 240 }}>
                        <Text strong style={{ fontSize: 16 }}>
                            {beneficiaryName || 'Development Plan'}
                        </Text>
                        {userDepartmentName ? (
                            <Text type="secondary"> · {userDepartmentName}</Text>
                        ) : null}
                    </div>

                    {gapId && (
                        <Button
                            style={roundBtn}
                            icon={<FileSearchOutlined />}
                            onClick={() => setGapResponsesOpen(true)}
                        >
                            GAP responses
                        </Button>
                    )}
                </div>
            </MotionCard>

            {loading && <LoadingOverlay tip="Loading data..." />}

            <Row gutter={[12, 12]} align="top">
                <Col xs={24} lg={15} xl={16}>
                    <MotionCard data-guide="dp-builder-sources">
                        {/*
                          * All panels open by default: seeing every source at once
                          * is the point of dropping the wizard. forceRender keeps
                          * each panel's content in the DOM so the guide tour can
                          * still anchor to a panel the user has collapsed.
                          */}
                        <Collapse
                            defaultActiveKey={['gap', 'sme', 'department']}
                            items={sourcePanels}
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} lg={9} xl={8}>
                    <div
                        data-guide="dp-builder-plan-summary"
                        style={{ position: 'sticky', top: 12 }}
                    >
                        <MotionCard>
                            <Space
                                align="center"
                                style={{
                                    width: '100%',
                                    justifyContent: 'space-between',
                                    marginBottom: 12
                                }}
                            >
                                <Text strong>This plan</Text>
                                <Tag color={hasInterventions ? 'blue' : undefined}>
                                    {finalList.length}
                                </Tag>
                            </Space>

                            {hasInterventions ? (
                                <Table
                                    dataSource={finalList}
                                    columns={confirmColumns as any}
                                    rowKey={keyOf}
                                    pagination={false}
                                    size="small"
                                    showHeader={false}
                                />
                            ) : (
                                <Empty
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    description="Nothing added yet"
                                />
                            )}

                            {hasInterventions && !dpDeliveryMethod && (
                                <Alert
                                    type="warning"
                                    showIcon
                                    message="Delivery method required"
                                    description="You will choose it in the confirmation window."
                                    style={{ marginTop: 12 }}
                                />
                            )}

                            {!hasInterventions && (
                                <Alert
                                    type="warning"
                                    showIcon
                                    message="No interventions selected"
                                    description="You may still submit, but you must explicitly confirm that this SME has none under your department."
                                    style={{ marginTop: 12 }}
                                />
                            )}

                            <Divider />

                            <Button
                                data-guide="dp-builder-save-action"
                                block
                                type="primary"
                                style={roundBtn}
                                onClick={openConfirmation}
                                disabled={!participantId}
                            >
                                Save Plan
                                {hasInterventions ? ` (${finalList.length})` : ''}
                            </Button>
                        </MotionCard>
                    </div>
                </Col>
            </Row>

            {/*
              * The plan panel is sticky on desktop, but the columns stack on
              * mobile and it scrolls away — so Save gets its own fixed bar there.
              */}
            {isMobile && (
                <div
                    style={{
                        position: 'fixed',
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 20,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 16px',
                        background: token.colorBgElevated,
                        borderTop: `1px solid ${token.colorBorderSecondary}`,
                        boxShadow: token.boxShadowSecondary
                    }}
                >
                    <Text style={{ flex: 1 }}>
                        {finalList.length} intervention
                        {finalList.length === 1 ? '' : 's'}
                    </Text>
                    <Button
                        type="primary"
                        style={roundBtn}
                        onClick={openConfirmation}
                        disabled={!participantId}
                    >
                        Save Plan
                    </Button>
                </div>
            )}

            <GapResponsesModal
                open={gapResponsesOpen}
                onClose={() => setGapResponsesOpen(false)}
                gapId={gapId}
                sections={ownedSections}
                companyName={beneficiaryName}
            />

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
