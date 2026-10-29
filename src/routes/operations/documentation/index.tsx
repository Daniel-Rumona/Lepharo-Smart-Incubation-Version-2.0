import React, { useEffect, useMemo, useState } from 'react'
import {
    Row,
    Col,
    Typography,
    Space,
    Button,
    Table,
    Modal,
    Form,
    Select,
    Upload,
    Input,
    message,
    Popconfirm,
    Tag,
    Segmented,
    DatePicker,
    Result,
    Empty,
    Badge,
    Drawer,
    Grid,
    Skeleton,
    Pagination,
    Popover,
    Tooltip
} from 'antd'
import {
    UploadOutlined,
    FileTextOutlined,
    TeamOutlined,
    WarningOutlined,
    DeleteOutlined,
    RetweetOutlined,
    ExclamationCircleOutlined,
    MessageOutlined,
    SettingOutlined,
    CalendarOutlined,
    BellOutlined,
    InboxOutlined,
    FilterOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    ClockCircleOutlined
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { Helmet } from 'react-helmet'

// hooks
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { useActiveProgramId } from '@/lib/useActiveProgramId'

// firebase
import { db } from '@/firebase'
import {
    addDoc,
    collection,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    Timestamp,
    where,
    updateDoc,
    doc,
    getDoc,
    deleteDoc
} from 'firebase/firestore'
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL
} from 'firebase/storage'

// UI
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import { sendNotification } from '@/utils/sendNotification'
import ResponsiveSheet from '@/components/common/ResponsiveSheet'

const { Text } = Typography
const { RangePicker } = DatePicker

type ReplacementRequest = {
    status: 'requested' | 'resolved'
    message: string
    requestedById: string
    requestedByName?: string
    requestedAt: Timestamp
    resolvedAt?: Timestamp
    resolvedById?: string
    resolvedByName?: string
}

type DocType =
    | 'implementation_plan'
    | 'weekly_report'
    | 'internal_operations'

type ImplPlanDoc = {
    id: string

    kind: 'document'

    docType: DocType

    programId: string | null

    departmentId: string | null

    departmentName: string | null

    title: string

    attachment: {
        name: string
        url: string
    }

    previousAttachments?: Array<{
        name: string
        url: string
        replacedAt: Timestamp
    }>

    replacementRequest?: ReplacementRequest

    overviewSummary?: string | null

    status?:
    | 'pending'
    | 'ratified'
    | 'queried'

    createdById: string

    createdByName?: string

    createdAt: Timestamp

    updatedAt: Timestamp
}

type DeptRow = {
    id: string
    name: string
}

const norm = (value?: string) =>
    String(value || '')
        .trim()
        .toLowerCase()

const startsWithAny = (
    value?: string,
    prefixes: string[] = []
) =>
    Boolean(
        value &&
        prefixes.some(prefix =>
            norm(value).startsWith(
                norm(prefix)
            )
        )
    )

const triggerEmail = async (
    kind:
        | 'upload'
        | 'ratify'
        | 'query',
    meta: Record<string, any>
) => {
    try {
        console.log(
            '[Email trigger stub]',
            kind,
            meta
        )
    } catch (error) {
        console.error(
            'Failed to trigger email:',
            error
        )
    }
}

/*
 * Loading state that mirrors the real layout: metric tiles, one-line filter
 * bar, then the stacked department cards (or the table for department users).
 */
const DocumentationSkeleton: React.FC<{
    tiles: number
    asCards: boolean
    isMobile: boolean
}> = ({ tiles, asCards, isMobile }) => (
    <div aria-busy='true' role='status'>
        <Row gutter={[16, 16]}>
            {Array.from({ length: tiles }).map((_, index) => (
                <Col
                    key={index}
                    xs={12}
                    md={12}
                    xl={tiles === 2 ? 12 : 6}
                >
                    <MetricTile loading title='' value='' />
                </Col>
            ))}
        </Row>

        <DashboardFilterBar style={{ marginTop: 16, marginBottom: 16 }}>
            {isMobile ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                    <Skeleton.Button active block style={{ height: 40, borderRadius: 12 }} />
                    <div style={{ display: 'flex', gap: 8 }}>
                        <Skeleton.Button active block style={{ flex: 1, height: 32 }} />
                        <Skeleton.Button active block shape='round' style={{ flex: 1, height: 32 }} />
                    </div>
                </div>
            ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'nowrap', width: '100%' }}>
                    <Skeleton.Button active style={{ width: 360, minWidth: 0, height: 40, borderRadius: 12 }} />
                    <Skeleton.Input active style={{ flex: '1 1 160px', width: '100%', minWidth: 0 }} />
                    <Skeleton.Input active style={{ width: 140, minWidth: 0 }} />
                    <Skeleton.Input active style={{ width: 170, minWidth: 0 }} />
                    <Skeleton.Input active style={{ width: 250, minWidth: 0 }} />
                    <Skeleton.Button active shape='round' style={{ width: 150, minWidth: 0 }} />
                </div>
            )}
        </DashboardFilterBar>

        {asCards ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {Array.from({ length: isMobile ? 4 : 5 }).map((_, index) => (
                    <MotionCard key={index}>
                        {isMobile ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                    <Skeleton.Input active size='small' style={{ width: 130, minWidth: 0, height: 18 }} />
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <Skeleton.Button active size='small' style={{ width: 44, minWidth: 0, borderRadius: 8 }} />
                                        <Skeleton.Button active size='small' style={{ width: 44, minWidth: 0, borderRadius: 8 }} />
                                    </div>
                                </div>
                                <Skeleton.Input active size='small' style={{ width: 110, minWidth: 0, height: 12 }} />
                                <Skeleton.Button active block style={{ height: 32 }} />
                            </div>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                <div style={{ flex: '0 0 220px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <Skeleton.Input active size='small' style={{ width: 160, minWidth: 0, height: 18 }} />
                                    <Skeleton.Input active size='small' style={{ width: 110, minWidth: 0, height: 12 }} />
                                </div>
                                <div style={{ flex: '1 1 auto', display: 'flex', gap: 8 }}>
                                    {Array.from({ length: 4 }).map((__, marker) => (
                                        <Skeleton.Button
                                            key={marker}
                                            active
                                            size='small'
                                            style={{ width: 96, minWidth: 0, borderRadius: 8 }}
                                        />
                                    ))}
                                </div>
                                <Skeleton.Button active style={{ width: 130, minWidth: 0 }} />
                            </div>
                        )}
                    </MotionCard>
                ))}
            </div>
        ) : (
            <MotionCard loading skeleton='table' skeletonRows={6} skeletonColumns={5} />
        )}
    </div>
)

const DocumentationHub: React.FC = () => {
    const { user } =
        useFullIdentity()

    const {
        activeProgramId,
        isAllPrograms
    } =
        useActiveProgramId()

    const myDeptId =
        user?.departmentId ??
        null

    const myDeptName =
        user?.departmentName ??
        (user as any)?.department ??
        null

    const roleStr =
        String(
            user?.role || ''
        ).toLowerCase()

    const { hasRole } = useDepartmentRoles()

    const isME =
        roleStr === 'me' ||
        hasRole(myDeptId, 'monitoring')

    const isDirector =
        roleStr === 'director'

    const isProjectAdmin =
        roleStr === 'projectadmin' ||
        roleStr === 'project_admin'

    const isMainDepartment =
        Boolean(
            (user as any)?.isMainDepartment ||
            (user as any)?.isMainDept ||
            (user as any)?.isMain
        )

    const isGlobalViewer =
        isME ||
        isDirector ||
        isProjectAdmin

    const isDepartmentView =
        !isGlobalViewer

    const [
        activeSegment,
        setActiveSegment
    ] =
        useState<DocType>(
            'weekly_report'
        )

    const isInternalOps =
        activeSegment ===
        'internal_operations'

    const [
        docPlans,
        setDocPlans
    ] =
        useState<
            ImplPlanDoc[]
        >([])

    const [
        loadingDocs,
        setLoadingDocs
    ] =
        useState(false)

    const [
        docOpen,
        setDocOpen
    ] =
        useState(false)

    const [docForm] =
        Form.useForm()

    const [
        isUploadingDoc,
        setIsUploadingDoc
    ] =
        useState(false)

    const [
        loadingDepts,
        setLoadingDepts
    ] =
        useState(false)

    const [
        replaceOpen,
        setReplaceOpen
    ] =
        useState(false)

    const [replaceForm] =
        Form.useForm()

    const [
        replacingId,
        setReplacingId
    ] =
        useState<
            string | null
        >(null)

    const [
        isReplacing,
        setIsReplacing
    ] =
        useState(false)

    const [
        reqOpen,
        setReqOpen
    ] =
        useState(false)

    const [reqForm] =
        Form.useForm()

    const [
        requestingId,
        setRequestingId
    ] =
        useState<
            string | null
        >(null)

    const [
        isRequesting,
        setIsRequesting
    ] =
        useState(false)

    const [
        expectedDeptIds,
        setExpectedDeptIds
    ] =
        useState<
            string[]
        >([])

    const [
        expectedDeptMap,
        setExpectedDeptMap
    ] =
        useState<
            Record<
                string,
                string
            >
        >({})

    const [
        statusUpdatingId,
        setStatusUpdatingId
    ] =
        useState<
            string | null
        >(null)

    const [
        searchText,
        setSearchText
    ] =
        useState('')

    const [
        statusFilter,
        setStatusFilter
    ] =
        useState<
            | 'all'
            | 'pending'
            | 'ratified'
            | 'queried'
        >('all')

    const [
        deptFilter,
        setDeptFilter
    ] =
        useState<
            string | 'all'
        >('all')

    const [
        dateRange,
        setDateRange
    ] =
        useState<
            [
                Dayjs | null,
                Dayjs | null
            ] | null
        >(null)

    /*
     * Internal Operations is not program-scoped.
     *
     * Program documents require either:
     * - All Programs, or
     * - a specific active program.
     *
     * Department users also require a department.
     */
    const scopeReady =
        isInternalOps
            ? Boolean(user)
            : Boolean(
                user &&
                (
                    isAllPrograms ||
                    activeProgramId
                ) &&
                (
                    isGlobalViewer ||
                    myDeptId
                )
            )

    const isPageLoading =
        !user ||
        loadingDepts ||
        loadingDocs

    useEffect(() => {
        if (
            !isGlobalViewer
        ) {
            setDeptFilter(
                'all'
            )
        }
    }, [
        isGlobalViewer
    ])

    /*
     * ---------------------------------------------------------
     * LIVE DOCUMENTS
     * ---------------------------------------------------------
     */
    useEffect(() => {
        if (!scopeReady) {
            return
        }

        setLoadingDocs(
            true
        )

        const constraints:
            any[] = [
                where(
                    'kind',
                    '==',
                    'document'
                ),

                where(
                    'docType',
                    '==',
                    activeSegment
                )
            ]

        if (isInternalOps) {
            /*
             * Internal documents are not attached
             * to a program.
             *
             * Directors/Main Department can view all.
             * Other users see their own uploads.
             */
            const canSeeAllInternal =
                isDirector ||
                isMainDepartment

            if (
                !canSeeAllInternal
            ) {
                constraints.push(
                    where(
                        'createdById',
                        '==',
                        user?.uid ||
                        (user as any)?.id ||
                        ''
                    )
                )
            }
        } else {
            /*
             * Program documents.
             *
             * A specific program adds programId
             * scoping. All Programs intentionally
             * omits this condition.
             */
            if (
                !isAllPrograms &&
                activeProgramId
            ) {
                constraints.push(
                    where(
                        'programId',
                        '==',
                        activeProgramId
                    )
                )
            }

            /*
             * Department users only see their
             * department's documents.
             */
            if (
                isDepartmentView &&
                myDeptId
            ) {
                constraints.push(
                    where(
                        'departmentId',
                        '==',
                        myDeptId
                    )
                )
            }
        }

        const qRef =
            query(
                collection(
                    db,
                    'implementationPlans'
                ),
                ...constraints,
                orderBy(
                    'createdAt',
                    'desc'
                )
            )

        const unsubscribe =
            onSnapshot(
                qRef,

                snapshot => {
                    const rows:
                        ImplPlanDoc[] =
                        snapshot.docs.map(
                            documentSnapshot => {
                                const data =
                                    documentSnapshot.data() as any

                                return {
                                    ...data,

                                    id:
                                        documentSnapshot.id,

                                    kind:
                                        data.kind ||
                                        'document',

                                    docType:
                                        data.docType ||
                                        'implementation_plan',

                                    programId:
                                        typeof data.programId ===
                                            'string'
                                            ? data.programId
                                            : null,

                                    departmentId:
                                        typeof data.departmentId ===
                                            'string'
                                            ? data.departmentId
                                            : null,

                                    departmentName:
                                        data.departmentName ||
                                        null
                                }
                            }
                        )

                    setDocPlans(
                        rows
                    )

                    setLoadingDocs(
                        false
                    )
                },

                error => {
                    console.error(
                        error
                    )

                    message.error(
                        'Failed to load documents.'
                    )

                    setLoadingDocs(
                        false
                    )
                }
            )

        return () =>
            unsubscribe()
    }, [
        scopeReady,
        activeProgramId,
        isAllPrograms,
        isDepartmentView,
        myDeptId,
        activeSegment,
        isInternalOps,
        user?.uid,
        (user as any)?.id,
        isDirector,
        isMainDepartment
    ])

    /*
     * ---------------------------------------------------------
     * DEPARTMENTS
     * ---------------------------------------------------------
     */
    useEffect(() => {
        const loadDepts =
            async () => {
                if (
                    isInternalOps
                ) {
                    setExpectedDeptIds(
                        []
                    )

                    setExpectedDeptMap(
                        {}
                    )

                    return
                }

                setLoadingDepts(
                    true
                )

                try {
                    const snapshot =
                        await getDocs(
                            collection(
                                db,
                                'departments'
                            )
                        )

                    const rows:
                        DeptRow[] =
                        snapshot.docs.map(
                            departmentDoc => {
                                const data =
                                    departmentDoc.data() as any

                                const name =
                                    String(
                                        data.title ||
                                        data.name ||
                                        ''
                                    )

                                return {
                                    id:
                                        departmentDoc.id,
                                    name
                                }
                            }
                        )

                    // A program can declare its participating departments
                    // (Programs > Coverage). When it does, only those are
                    // expected to submit; otherwise fall back to every department.
                    let participatingIds: string[] = []

                    if (activeProgramId) {
                        const programSnapshot =
                            await getDoc(
                                doc(
                                    db,
                                    'programs',
                                    activeProgramId
                                )
                            )

                        const declared =
                            (programSnapshot.data() as any)
                                ?.participatingDepartmentIds

                        if (Array.isArray(declared)) {
                            participatingIds =
                                declared.map(String)
                        }
                    }

                    const filtered =
                        rows.filter(
                            row =>
                                !startsWithAny(
                                    row.name,
                                    [
                                        'IhF',
                                        'HRM'
                                    ]
                                ) &&
                                (
                                    !participatingIds.length ||
                                    participatingIds.includes(
                                        row.id
                                    )
                                )
                        )

                    setExpectedDeptIds(
                        filtered.map(
                            row =>
                                row.id
                        )
                    )

                    setExpectedDeptMap(
                        filtered.reduce(
                            (
                                accumulator,
                                row
                            ) => {
                                accumulator[
                                    row.id
                                ] =
                                    row.name

                                return accumulator
                            },
                            {} as Record<
                                string,
                                string
                            >
                        )
                    )
                } catch (error) {
                    console.error(
                        'Failed to load departments:',
                        error
                    )

                    setExpectedDeptIds(
                        []
                    )

                    setExpectedDeptMap(
                        {}
                    )
                } finally {
                    setLoadingDepts(
                        false
                    )
                }
            }

        void loadDepts()
    }, [
        activeProgramId,
        isInternalOps
    ])

    /*
     * ---------------------------------------------------------
     * METRICS
     * ---------------------------------------------------------
     */
    const totalPlans =
        docPlans.length

    const submittedDeptIds =
        useMemo(() => {
            const ids =
                new Set<string>()

            docPlans.forEach(
                plan => {
                    if (
                        plan.departmentId
                    ) {
                        ids.add(
                            String(
                                plan.departmentId
                            )
                        )
                    }
                }
            )

            return ids
        }, [
            docPlans
        ])

    const departmentsSubmitted =
        useMemo(
            () =>
                expectedDeptIds.reduce(
                    (
                        count,
                        id
                    ) =>
                        count +
                        (
                            submittedDeptIds.has(
                                id
                            )
                                ? 1
                                : 0
                        ),
                    0
                ),
            [
                expectedDeptIds,
                submittedDeptIds
            ]
        )

    const missingDepartments =
        useMemo(
            () =>
                expectedDeptIds.reduce(
                    (
                        count,
                        id
                    ) =>
                        count +
                        (
                            !submittedDeptIds.has(
                                id
                            )
                                ? 1
                                : 0
                        ),
                    0
                ),
            [
                expectedDeptIds,
                submittedDeptIds
            ]
        )

    /*
     * ---------------------------------------------------------
     * PAGE STATE
     * ---------------------------------------------------------
     */
    const missingState =
        useMemo(() => {
            if (!user) {
                return null
            }

            if (
                isInternalOps
            ) {
                return null
            }

            if (
                !isAllPrograms &&
                !activeProgramId
            ) {
                return {
                    status:
                        'info' as const,

                    title:
                        'No active program selected',

                    subTitle:
                        'This page needs an active program before implementation plans or weekly reports can be viewed.'
                }
            }

            if (
                !isGlobalViewer &&
                !myDeptId
            ) {
                return {
                    status:
                        'warning' as const,

                    title:
                        'No department assigned',

                    subTitle:
                        'Your account is not linked to a department yet, so department-scoped documents cannot be loaded.'
                }
            }

            return null
        }, [
            user,
            isInternalOps,
            activeProgramId,
            isAllPrograms,
            isGlobalViewer,
            myDeptId
        ])

    /*
     * ---------------------------------------------------------
     * WEEKLY REPORT METRICS
     * ---------------------------------------------------------
     */
    const {
        weeklyTotal,
        weeklyRatified,
        weeklyPendingOrQueried,
        weeklyDeptSubmitted,
        weeklyDeptMissing
    } =
        useMemo(() => {
            const canSeeWeekly =
                (
                    isDirector ||
                    isProjectAdmin
                ) &&
                activeSegment ===
                'weekly_report'

            if (!canSeeWeekly) {
                return {
                    weeklyTotal:
                        0,

                    weeklyRatified:
                        0,

                    weeklyPendingOrQueried:
                        0,

                    weeklyDeptSubmitted:
                        0,

                    weeklyDeptMissing:
                        0
                }
            }

            const start =
                dayjs()
                    .startOf(
                        'week'
                    )
                    .valueOf()

            const end =
                dayjs()
                    .endOf(
                        'week'
                    )
                    .valueOf()

            const docsThisWeek =
                docPlans.filter(
                    document => {
                        if (
                            !document.createdAt
                        ) {
                            return false
                        }

                        const createdAt =
                            document.createdAt
                                .toDate()
                                .getTime()

                        return (
                            createdAt >=
                            start &&
                            createdAt <=
                            end
                        )
                    }
                )

            const deptSet =
                new Set<string>()

            docsThisWeek.forEach(
                document => {
                    if (
                        document.departmentId
                    ) {
                        deptSet.add(
                            String(
                                document.departmentId
                            )
                        )
                    }
                }
            )

            const ratified =
                docsThisWeek.filter(
                    document =>
                        document.status ===
                        'ratified'
                ).length

            const pendingOrQueried =
                docsThisWeek.filter(
                    document =>
                        document.status !==
                        'ratified'
                ).length

            const deptSubmittedCount =
                expectedDeptIds.reduce(
                    (
                        count,
                        id
                    ) =>
                        count +
                        (
                            deptSet.has(
                                id
                            )
                                ? 1
                                : 0
                        ),
                    0
                )

            const deptMissingCount =
                expectedDeptIds.length -
                deptSubmittedCount

            return {
                weeklyTotal:
                    docsThisWeek.length,

                weeklyRatified:
                    ratified,

                weeklyPendingOrQueried:
                    pendingOrQueried,

                weeklyDeptSubmitted:
                    deptSubmittedCount,

                weeklyDeptMissing:
                    deptMissingCount
            }
        }, [
            docPlans,
            expectedDeptIds,
            isDirector,
            isProjectAdmin,
            activeSegment
        ])

    /*
     * ---------------------------------------------------------
     * DEPARTMENT OPTIONS
     * ---------------------------------------------------------
     */
    const departmentOptions =
        useMemo(() => {
            const map =
                new Map<
                    string,
                    string
                >()

            expectedDeptIds.forEach(
                id => {
                    map.set(
                        id,
                        expectedDeptMap[
                        id
                        ] ||
                        id
                    )
                }
            )

            docPlans.forEach(
                document => {
                    if (
                        document.departmentId
                    ) {
                        const id =
                            String(
                                document.departmentId
                            )

                        if (
                            !map.has(
                                id
                            )
                        ) {
                            map.set(
                                id,
                                document.departmentName ||
                                expectedDeptMap[
                                id
                                ] ||
                                id
                            )
                        }
                    }
                }
            )

            return Array.from(
                map.entries()
            ).map(
                ([
                    id,
                    name
                ]) => ({
                    id,
                    name
                })
            )
        }, [
            docPlans,
            expectedDeptIds,
            expectedDeptMap
        ])

    /*
     * ---------------------------------------------------------
     * FILTERED DOCUMENTS
     * ---------------------------------------------------------
     */
    const filteredDocs =
        useMemo(() => {
            return docPlans.filter(
                document => {
                    if (
                        searchText.trim()
                    ) {
                        const haystack =
                            [
                                document.title,
                                document.departmentName,
                                document.createdByName,
                                document.attachment
                                    ?.name
                            ]
                                .filter(
                                    Boolean
                                )
                                .join(
                                    ' '
                                )
                                .toLowerCase()

                        if (
                            !haystack.includes(
                                searchText
                                    .trim()
                                    .toLowerCase()
                            )
                        ) {
                            return false
                        }
                    }

                    if (
                        statusFilter !==
                        'all'
                    ) {
                        const status =
                            document.status ||
                            'pending'

                        if (
                            status !==
                            statusFilter
                        ) {
                            return false
                        }
                    }

                    if (
                        !isInternalOps &&
                        deptFilter !==
                        'all'
                    ) {
                        if (
                            !document.departmentId ||
                            String(
                                document.departmentId
                            ) !==
                            String(
                                deptFilter
                            )
                        ) {
                            return false
                        }
                    }

                    if (
                        dateRange &&
                        dateRange[0] &&
                        dateRange[1]
                    ) {
                        const [
                            start,
                            end
                        ] =
                            dateRange

                        const created =
                            dayjs(
                                document.createdAt.toDate()
                            )

                        if (
                            created.isBefore(
                                start.startOf(
                                    'day'
                                )
                            ) ||
                            created.isAfter(
                                end.endOf(
                                    'day'
                                )
                            )
                        ) {
                            return false
                        }
                    }

                    return true
                }
            )
        }, [
            docPlans,
            searchText,
            statusFilter,
            deptFilter,
            dateRange,
            isInternalOps
        ])

    /*
     * ---------------------------------------------------------
     * UPLOAD
     * ---------------------------------------------------------
     */
    const openUploadDoc =
        () => {
            docForm.resetFields()

            setDocOpen(
                true
            )
        }

    const saveDoc =
        async () => {
            if (
                isUploadingDoc
            ) {
                return
            }

            try {
                const values =
                    await docForm.validateFields()

                if (
                    !isInternalOps &&
                    (
                        isAllPrograms ||
                        !activeProgramId
                    )
                ) {
                    message.warning(
                        'Select a specific program before uploading.'
                    )

                    return
                }

                let fileObj:
                    File | undefined =
                    values.file

                if (
                    fileObj &&
                    (
                        fileObj as any
                    ).originFileObj
                ) {
                    fileObj =
                        (
                            fileObj as any
                        ).originFileObj
                }

                if (!fileObj) {
                    message.error(
                        'Please select a document to upload.'
                    )

                    return
                }

                setIsUploadingDoc(
                    true
                )

                const storage =
                    getStorage()

                const uploaderId =
                    user?.uid ||
                    (user as any)?.id ||
                    'unknown'

                const baseFolder =
                    isInternalOps
                        ? `internal-operations/uploads/${uploaderId}`
                        : `implementation-plans/uploads/${activeProgramId}`

                const path =
                    `${baseFolder}/${Date.now()}_${fileObj.name}`

                const snapshot =
                    await uploadBytes(
                        ref(
                            storage,
                            path
                        ),
                        fileObj
                    )

                const url =
                    await getDownloadURL(
                        snapshot.ref
                    )

                const overviewSummary =
                    activeSegment ===
                        'weekly_report'
                        ? String(
                            values.overviewSummary ||
                            ''
                        ).trim() ||
                        null
                        : undefined

                const basePayload:
                    Omit<
                        ImplPlanDoc,
                        'id'
                    > = {
                    kind:
                        'document',

                    docType:
                        activeSegment,

                    title:
                        values.title,

                    programId:
                        isInternalOps
                            ? null
                            : activeProgramId!,

                    departmentId:
                        user?.departmentId ??
                        null,

                    departmentName:
                        myDeptName,

                    attachment:
                    {
                        name:
                            fileObj.name,
                        url
                    },

                    status:
                        'pending',

                    createdById:
                        user?.uid ||
                        (user as any)?.id ||
                        '',

                    createdByName:
                        user?.name ||
                        user?.email ||
                        '',

                    createdAt:
                        Timestamp.now(),

                    updatedAt:
                        Timestamp.now()
                }

                const payload:
                    any =
                    activeSegment ===
                        'weekly_report'
                        ? {
                            ...basePayload,

                            overviewSummary:
                                overviewSummary ??
                                null
                        }
                        : basePayload

                const documentRef =
                    await addDoc(
                        collection(
                            db,
                            'implementationPlans'
                        ),
                        payload
                    )

                await triggerEmail(
                    'upload',
                    {
                        docId:
                            documentRef.id,

                        docType:
                            activeSegment,

                        title:
                            values.title,

                        departmentName:
                            myDeptName,

                        uploaderName:
                            user?.name ||
                            user?.email,

                        uploaderEmail:
                            user?.email,

                        programId:
                            isInternalOps
                                ? null
                                : activeProgramId,

                        overviewSummary:
                            activeSegment ===
                                'weekly_report'
                                ? overviewSummary ??
                                null
                                : undefined
                    }
                )

                message.success(
                    activeSegment ===
                        'implementation_plan'
                        ? 'Plan document uploaded.'
                        : activeSegment ===
                            'weekly_report'
                            ? 'Weekly report uploaded.'
                            : 'Internal operations document uploaded.'
                )

                setDocOpen(
                    false
                )

                docForm.resetFields()
            } catch (
            error: any
            ) {
                if (
                    !error?.errorFields
                ) {
                    console.error(
                        error
                    )

                    message.error(
                        'Failed to upload document.'
                    )
                }
            } finally {
                setIsUploadingDoc(
                    false
                )
            }
        }

    /*
     * ---------------------------------------------------------
     * DELETE
     * ---------------------------------------------------------
     */
    const handleDelete =
        async (
            record:
                ImplPlanDoc
        ) => {
            try {
                await deleteDoc(
                    doc(
                        db,
                        'implementationPlans',
                        record.id
                    )
                )

                message.success(
                    'Document deleted.'
                )
            } catch (
            error
            ) {
                console.error(
                    error
                )

                message.error(
                    'Delete failed.'
                )
            }
        }

    /*
     * ---------------------------------------------------------
     * REPLACE
     * ---------------------------------------------------------
     */
    const openReplace =
        (
            record:
                ImplPlanDoc
        ) => {
            setReplacingId(
                record.id
            )

            replaceForm.resetFields()

            replaceForm.setFieldsValue(
                {
                    title:
                        record.title
                }
            )

            setReplaceOpen(
                true
            )
        }

    const saveReplace =
        async () => {
            if (
                !replacingId ||
                isReplacing
            ) {
                return
            }

            try {
                const values =
                    await replaceForm.validateFields()

                let fileObj:
                    File | undefined =
                    values.file

                if (
                    fileObj &&
                    (
                        fileObj as any
                    ).originFileObj
                ) {
                    fileObj =
                        (
                            fileObj as any
                        ).originFileObj
                }

                if (!fileObj) {
                    message.error(
                        'Select a replacement file.'
                    )

                    return
                }

                setIsReplacing(
                    true
                )

                const storage =
                    getStorage()

                const uploaderId =
                    user?.uid ||
                    (user as any)?.id ||
                    'unknown'

                const baseFolder =
                    activeSegment ===
                        'internal_operations'
                        ? `internal-operations/uploads/${uploaderId}`
                        : `implementation-plans/uploads/${activeProgramId}`

                const path =
                    `${baseFolder}/${Date.now()}_${fileObj.name}`

                const snapshot =
                    await uploadBytes(
                        ref(
                            storage,
                            path
                        ),
                        fileObj
                    )

                const url =
                    await getDownloadURL(
                        snapshot.ref
                    )

                const recordRef =
                    doc(
                        db,
                        'implementationPlans',
                        replacingId
                    )

                const previous =
                    docPlans.find(
                        document =>
                            document.id ===
                            replacingId
                    )

                const previousList =
                    Array.isArray(
                        previous?.previousAttachments
                    )
                        ? previous.previousAttachments
                        : []

                const newPrevious =
                    previous?.attachment
                        ? [
                            ...previousList,

                            {
                                ...previous.attachment,

                                replacedAt:
                                    Timestamp.now()
                            }
                        ]
                        : previousList

                const update:
                    Partial<ImplPlanDoc> =
                {
                    title:
                        values.title ||
                        previous?.title,

                    attachment:
                    {
                        name:
                            fileObj.name,

                        url
                    },

                    previousAttachments:
                        newPrevious,

                    updatedAt:
                        Timestamp.now()
                }

                if (
                    previous
                        ?.replacementRequest
                        ?.status ===
                    'requested'
                ) {
                    update.replacementRequest =
                    {
                        ...previous.replacementRequest,

                        status:
                            'resolved',

                        resolvedAt:
                            Timestamp.now(),

                        resolvedById:
                            user?.uid ||
                            (user as any)?.id ||
                            '',

                        resolvedByName:
                            user?.name ||
                            user?.email ||
                            ''
                    }
                }

                if (
                    previous?.status ===
                    'queried'
                ) {
                    update.status =
                        'pending'
                }

                await updateDoc(
                    recordRef,
                    update as any
                )

                message.success(
                    'Document replaced successfully.'
                )

                setReplaceOpen(
                    false
                )

                setReplacingId(
                    null
                )

                replaceForm.resetFields()
            } catch (
            error: any
            ) {
                if (
                    !error?.errorFields
                ) {
                    console.error(
                        error
                    )

                    message.error(
                        'Failed to replace document.'
                    )
                }
            } finally {
                setIsReplacing(
                    false
                )
            }
        }

    /*
     * ---------------------------------------------------------
     * QUERY / REQUEST REPLACEMENT
     * ---------------------------------------------------------
     */
    const openRequest =
        (
            record:
                ImplPlanDoc
        ) => {
            setRequestingId(
                record.id
            )

            reqForm.resetFields()

            setReqOpen(
                true
            )
        }

    const saveRequest =
        async () => {
            if (
                !requestingId ||
                isRequesting
            ) {
                return
            }

            try {
                const values =
                    await reqForm.validateFields()

                const recordRef =
                    doc(
                        db,
                        'implementationPlans',
                        requestingId
                    )

                const record =
                    docPlans.find(
                        document =>
                            document.id ===
                            requestingId
                    )

                const payload:
                    Partial<ImplPlanDoc> =
                {
                    status:
                        'queried',

                    replacementRequest:
                    {
                        status:
                            'requested',

                        message:
                            values.message,

                        requestedById:
                            user?.uid ||
                            (user as any)?.id ||
                            '',

                        requestedByName:
                            user?.name ||
                            user?.email ||
                            '',

                        requestedAt:
                            Timestamp.now()
                    }
                }

                setIsRequesting(
                    true
                )

                await updateDoc(
                    recordRef,
                    payload as any
                )

                await triggerEmail(
                    'query',
                    {
                        docId:
                            requestingId,

                        docType:
                            record?.docType,

                        title:
                            record?.title,

                        departmentName:
                            record?.departmentName,

                        programId:
                            record?.programId,

                        queryBy:
                            user?.name ||
                            user?.email,

                        queryByEmail:
                            user?.email,

                        message:
                            values.message
                    }
                )

                message.success(
                    'Request sent.'
                )

                setReqOpen(
                    false
                )

                setRequestingId(
                    null
                )

                reqForm.resetFields()
            } catch (
            error: any
            ) {
                if (
                    !error?.errorFields
                ) {
                    console.error(
                        error
                    )

                    message.error(
                        'Failed to send request.'
                    )
                }
            } finally {
                setIsRequesting(
                    false
                )
            }
        }

    /*
     * ---------------------------------------------------------
     * RATIFY
     * ---------------------------------------------------------
     */
    const ratifyDoc =
        async (
            record:
                ImplPlanDoc
        ) => {
            if (
                statusUpdatingId
            ) {
                return
            }

            try {
                setStatusUpdatingId(
                    record.id
                )

                const recordRef =
                    doc(
                        db,
                        'implementationPlans',
                        record.id
                    )

                await updateDoc(
                    recordRef,
                    {
                        status:
                            'ratified',

                        updatedAt:
                            Timestamp.now()
                    }
                )

                await triggerEmail(
                    'ratify',
                    {
                        docId:
                            record.id,

                        docType:
                            record.docType,

                        title:
                            record.title,

                        departmentName:
                            record.departmentName,

                        programId:
                            record.programId,

                        ratifiedBy:
                            user?.name ||
                            user?.email,

                        ratifiedByEmail:
                            user?.email
                    }
                )

                message.success(
                    'Report ratified.'
                )
            } catch (
            error
            ) {
                console.error(
                    error
                )

                message.error(
                    'Failed to ratify report.'
                )
            } finally {
                setStatusUpdatingId(
                    null
                )
            }
        }

    /*
     * ---------------------------------------------------------
     * PERMISSIONS
     * ---------------------------------------------------------
     */
    const myUserId =
        user?.uid ||
        (user as any)?.id ||
        ''

    const canSeeAllInternalOps =
        isDirector ||
        isMainDepartment

    const canModifyInternalDoc =
        (
            record:
                ImplPlanDoc
        ) =>
            canSeeAllInternalOps ||
            record.createdById ===
            myUserId

    /*
     * ---------------------------------------------------------
     * TABLE
     * ---------------------------------------------------------
     */
    const docCols =
        [
            ...(
                isInternalOps
                    ? [
                        {
                            title:
                                'Uploaded By',

                            dataIndex:
                                'createdByName',

                            render:
                                (
                                    value:
                                        string
                                ) =>
                                    value ||
                                    '—',

                            responsive:
                                [
                                    'md'
                                ]
                        } as any
                    ]
                    : [
                        {
                            title:
                                'Department',

                            dataIndex:
                                'departmentName',

                            render:
                                (
                                    value:
                                        string
                                ) =>
                                    value ||
                                    '—',

                            responsive:
                                [
                                    'md'
                                ]
                        } as any
                    ]
            ),

            {
                title:
                    'Uploaded',

                dataIndex:
                    'createdAt',

                render:
                    (
                        timestamp:
                            Timestamp
                    ) =>
                        timestamp
                            ? dayjs(
                                timestamp.toDate()
                            ).format(
                                'YYYY-MM-DD HH:mm'
                            )
                            : '—'
            },

            ...(
                activeSegment ===
                    'weekly_report'
                    ? [
                        {
                            title:
                                'Overview Summary',

                            dataIndex:
                                'overviewSummary',

                            responsive:
                                [
                                    'lg'
                                ],

                            render:
                                (
                                    value:
                                        | string
                                        | null
                                        | undefined
                                ) => {
                                    if (
                                        !value
                                    ) {
                                        return (
                                            <Text type='secondary'>
                                                —
                                            </Text>
                                        )
                                    }

                                    const short =
                                        value.length >
                                            80
                                            ? `${value.slice(0, 80)}…`
                                            : value

                                    return (
                                        <Text
                                            title={
                                                value
                                            }
                                        >
                                            {
                                                short
                                            }
                                        </Text>
                                    )
                                }
                        } as any
                    ]
                    : []
            ),

            {
                title:
                    'Status',

                dataIndex:
                    'status',

                render:
                    (
                        status:
                            ImplPlanDoc['status']
                    ) => {
                        if (
                            status ===
                            'ratified'
                        ) {
                            return (
                                <Tag color='green'>
                                    Ratified
                                </Tag>
                            )
                        }

                        if (
                            status ===
                            'queried'
                        ) {
                            return (
                                <Tag color='red'>
                                    Queried
                                </Tag>
                            )
                        }

                        return (
                            <Tag color='blue'>
                                Pending
                            </Tag>
                        )
                    },

                responsive:
                    [
                        'md'
                    ]
            },

            {
                title:
                    'Download',

                dataIndex:
                    'attachment',

                render:
                    (
                        attachment:
                            ImplPlanDoc['attachment']
                    ) =>
                        attachment?.url ? (
                            <a
                                href={
                                    attachment.url
                                }
                                target='_blank'
                                rel='noopener noreferrer'
                            >
                                <FileTextOutlined />{' '}
                                {
                                    attachment.name
                                }
                            </a>
                        ) : (
                            <Text type='secondary'>
                                —
                            </Text>
                        )
            },

            {
                title:
                    'Replacement',

                key:
                    'replacement',

                render:
                    (
                        _:
                            any,
                        record:
                            ImplPlanDoc
                    ) => {
                        const request =
                            record.replacementRequest

                        if (
                            !request
                        ) {
                            return (
                                <Tag color='default'>
                                    No request
                                </Tag>
                            )
                        }

                        if (
                            request.status ===
                            'requested'
                        ) {
                            return (
                                <Space
                                    size='small'
                                    direction='vertical'
                                >
                                    <Tag
                                        color='orange'
                                        icon={
                                            <ExclamationCircleOutlined />
                                        }
                                    >
                                        Requested
                                    </Tag>

                                    <Text
                                        type='secondary'
                                        style={{
                                            maxWidth:
                                                280,

                                            display:
                                                'inline-block'
                                        }}
                                    >
                                        {
                                            request.message
                                        }
                                    </Text>
                                </Space>
                            )
                        }

                        return (
                            <Tag color='green'>
                                Resolved
                            </Tag>
                        )
                    }
            },

            {
                title:
                    'Actions',

                key:
                    'actions',

                render:
                    (
                        _:
                            any,
                        record:
                            ImplPlanDoc
                    ) => {
                        const actions:
                            React.ReactNode[] =
                            []

                        if (
                            isInternalOps
                        ) {
                            if (
                                canModifyInternalDoc(
                                    record
                                )
                            ) {
                                actions.push(
                                    <Popconfirm
                                        key='del'
                                        title='Delete this document?'
                                        onConfirm={() =>
                                            handleDelete(
                                                record
                                            )
                                        }
                                    >
                                        <Button
                                            size='small'
                                            danger
                                            icon={
                                                <DeleteOutlined />
                                            }
                                        />
                                    </Popconfirm>
                                )

                                actions.push(
                                    <Button
                                        key='rep'
                                        size='small'
                                        icon={
                                            <RetweetOutlined />
                                        }
                                        onClick={() =>
                                            openReplace(
                                                record
                                            )
                                        }
                                    >
                                        {record
                                            .replacementRequest
                                            ?.status ===
                                            'requested'
                                            ? 'Respond (Replace)'
                                            : 'Replace'}
                                    </Button>
                                )
                            }

                            if (
                                canSeeAllInternalOps
                            ) {
                                actions.push(
                                    <Button
                                        key='req'
                                        size='small'
                                        icon={
                                            <MessageOutlined />
                                        }
                                        onClick={() =>
                                            openRequest(
                                                record
                                            )
                                        }
                                    >
                                        Request
                                        Replacement
                                    </Button>
                                )
                            }
                        } else {
                            if (
                                isDepartmentView
                            ) {
                                actions.push(
                                    <Popconfirm
                                        key='del'
                                        title='Delete this document?'
                                        onConfirm={() =>
                                            handleDelete(
                                                record
                                            )
                                        }
                                    >
                                        <Button
                                            size='small'
                                            danger
                                            icon={
                                                <DeleteOutlined />
                                            }
                                        />
                                    </Popconfirm>
                                )

                                actions.push(
                                    <Button
                                        key='rep'
                                        size='small'
                                        icon={
                                            <RetweetOutlined />
                                        }
                                        onClick={() =>
                                            openReplace(
                                                record
                                            )
                                        }
                                    >
                                        {record
                                            .replacementRequest
                                            ?.status ===
                                            'requested'
                                            ? 'Respond (Replace)'
                                            : 'Replace'}
                                    </Button>
                                )
                            } else if (
                                isGlobalViewer
                            ) {
                                if (
                                    activeSegment ===
                                    'weekly_report' &&
                                    isDirector
                                ) {
                                    actions.push(
                                        <Button
                                            key='ratify'
                                            size='small'
                                            type='primary'
                                            onClick={() =>
                                                ratifyDoc(
                                                    record
                                                )
                                            }
                                            loading={
                                                statusUpdatingId ===
                                                record.id
                                            }
                                            disabled={
                                                statusUpdatingId ===
                                                record.id
                                            }
                                        >
                                            Ratify
                                        </Button>
                                    )

                                    actions.push(
                                        <Button
                                            key='query'
                                            size='small'
                                            icon={
                                                <MessageOutlined />
                                            }
                                            onClick={() =>
                                                openRequest(
                                                    record
                                                )
                                            }
                                        >
                                            Query
                                        </Button>
                                    )
                                } else {
                                    actions.push(
                                        <Button
                                            key='req'
                                            size='small'
                                            icon={
                                                <MessageOutlined />
                                            }
                                            onClick={() =>
                                                openRequest(
                                                    record
                                                )
                                            }
                                        >
                                            Request
                                            Replacement
                                        </Button>
                                    )
                                }
                            }
                        }

                        if (
                            !actions.length
                        ) {
                            return (
                                <Text type='secondary'>
                                    —
                                </Text>
                            )
                        }

                        return (
                            <Space>
                                {
                                    actions
                                }
                            </Space>
                        )
                    }
            }
        ]

    /*
     * ---------------------------------------------------------
     * IMPLEMENTATION PLAN CARDS (one per participating department)
     * ---------------------------------------------------------
     */
    const isPlanSegment = activeSegment === 'implementation_plan'
    const isWeeklySegment = activeSegment === 'weekly_report'
    const showCards =
        (isPlanSegment || isWeeklySegment) && isGlobalViewer

    const screens = Grid.useBreakpoint()
    const isMobile = screens.md === false
    // Internal Operations is a table on desktop and the same card design on mobile.
    const showInternalCards = isInternalOps && isMobile

    const [remindingDeptId, setRemindingDeptId] = useState<string | null>(null)
    const [remindedKeys, setRemindedKeys] = useState<Set<string>>(new Set())
    const [cardPage, setCardPage] = useState(1)
    const [cardPageSize, setCardPageSize] = useState(6)

    useEffect(() => {
        setCardPage(1)
    }, [activeSegment, searchText, statusFilter, deptFilter, dateRange, activeProgramId])

    // Weekly report windows. No range = the current week (still in progress).
    // With a range: consecutive 7-day blocks from its start, counting only
    // blocks that have fully ended (and fit in the range), so mid-month we show
    // the weeks that have passed - never future ones.
    const weekWindows = useMemo(() => {
        if (!isWeeklySegment) return []

        if (!dateRange || !dateRange[0] || !dateRange[1]) {
            return [{
                start: dayjs().startOf('week'),
                end: dayjs().endOf('week'),
                inProgress: true
            }]
        }

        const windows: { start: Dayjs; end: Dayjs; inProgress: boolean }[] = []
        const rangeEnd = dateRange[1].endOf('day')
        const limit = rangeEnd.isBefore(dayjs()) ? rangeEnd : dayjs()

        for (
            let start = dateRange[0].startOf('day');
            !start.add(7, 'day').subtract(1, 'millisecond').isAfter(limit);
            start = start.add(7, 'day')
        ) {
            windows.push({
                start,
                end: start.add(7, 'day').subtract(1, 'millisecond'),
                inProgress: false
            })
        }

        return windows
    }, [isWeeklySegment, dateRange])

    const cardMillis = (plan: ImplPlanDoc) => plan.createdAt?.toMillis?.() ?? 0

    const buildCard = (id: string, name: string, deptDocs: ImplPlanDoc[], isSelf = false) => {
        const docs = deptDocs.slice().sort((a, b) => cardMillis(b) - cardMillis(a))
        const weeks = weekWindows.map(window => {
            const inWindow = docs.filter(plan => {
                const at = cardMillis(plan)
                return at >= window.start.valueOf() && at <= window.end.valueOf()
            })
            return { ...window, docs: inWindow, doc: inWindow[0] ?? null }
        })

        return {
            id,
            name,
            isSelf,
            latest: docs[0] ?? null,
            count: docs.length,
            weeks,
            missingWeeks: weeks.filter(week => !week.doc).length
        }
    }

    const docsByDept = useMemo(() => {
        const map = new Map<string, ImplPlanDoc[]>()
        docPlans.forEach(plan => {
            if (!plan.departmentId) return
            const id = String(plan.departmentId)
            const list = map.get(id) ?? []
            list.push(plan)
            map.set(id, list)
        })
        return map
    }, [docPlans])

    // The project admin submits their own plan/report too: pinned card with an
    // Upload button (instead of a reminder) above the department list.
    const selfCard = useMemo(() => {
        if (!showCards || !isProjectAdmin) return null
        const ownDocs = docPlans.filter(plan =>
            (myDeptId && String(plan.departmentId) === String(myDeptId)) ||
            (!myDeptId && plan.createdById === ((user as any)?.uid || (user as any)?.id))
        )
        return buildCard(
            String(myDeptId || 'self'),
            `${myDeptName || 'Project Administration'} (You)`,
            ownDocs,
            true
        )
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showCards, isProjectAdmin, docPlans, myDeptId, myDeptName, user, weekWindows])

    const planCards = useMemo(() => {
        if (!showCards) return []

        const needle = searchText.trim().toLowerCase()

        return expectedDeptIds
            .filter(id => !(isProjectAdmin && myDeptId && id === String(myDeptId)))
            .map(id => buildCard(id, expectedDeptMap[id] || id, docsByDept.get(id) ?? []))
            .filter(card => {
                if (deptFilter !== 'all' && card.id !== deptFilter) return false

                if (needle) {
                    const haystack = `${card.name} ${card.latest?.title ?? ''}`.toLowerCase()
                    if (!haystack.includes(needle)) return false
                }

                if (isWeeklySegment) {
                    if (statusFilter !== 'all') {
                        return card.weeks.some(week => (week.doc?.status ?? 'pending') === statusFilter && week.doc)
                    }
                    return true
                }

                if (statusFilter !== 'all') {
                    if (!card.latest || (card.latest.status ?? 'pending') !== statusFilter) return false
                }

                if (dateRange && dateRange[0] && dateRange[1]) {
                    const created = card.latest?.createdAt?.toDate?.()
                    if (!created) return false
                    if (created < dateRange[0].startOf('day').toDate() || created > dateRange[1].endOf('day').toDate()) {
                        return false
                    }
                }

                return true
            })
            .sort((a, b) =>
                isWeeklySegment
                    ? b.missingWeeks - a.missingWeeks || a.name.localeCompare(b.name)
                    : Number(Boolean(a.latest)) - Number(Boolean(b.latest)) || a.name.localeCompare(b.name)
            )
    }, [showCards, isWeeklySegment, isProjectAdmin, myDeptId, docsByDept, expectedDeptIds, expectedDeptMap, searchText, deptFilter, statusFilter, dateRange, weekWindows])

    const pagedCards = useMemo(
        () => planCards.slice((cardPage - 1) * cardPageSize, cardPage * cardPageSize),
        [planCards, cardPage, cardPageSize]
    )

    const pagedInternal = useMemo(
        () => filteredDocs.slice((cardPage - 1) * cardPageSize, cardPage * cardPageSize),
        [filteredDocs, cardPage, cardPageSize]
    )

    // Nudge a department's HOD(s) in-app to upload for the active program.
    const remindDepartment = async (departmentId: string, departmentName: string, detail?: string) => {
        const key = `${activeSegment}:${departmentId}`
        const noun = isWeeklySegment ? 'weekly report' : 'implementation plan'

        try {
            setRemindingDeptId(departmentId)

            const hodSnapshot = await getDocs(
                query(collection(db, 'users'), where('departmentId', '==', departmentId))
            )
            const recipientIds = hodSnapshot.docs
                .filter(snapshot => {
                    const data = snapshot.data() as any
                    return (
                        String(data.role || '').toLowerCase() === 'operations' &&
                        !['inactive', 'disabled', 'deleted'].includes(String(data.status || '').toLowerCase())
                    )
                })
                .map(snapshot => snapshot.id)

            if (!recipientIds.length) {
                message.warning(`No active HOD found for ${departmentName}.`)
                return
            }

            await sendNotification({
                type: isWeeklySegment ? 'weekly_report_reminder' : 'implementation_plan_reminder',
                message: `Reminder: please upload the ${departmentName} ${noun}${detail ? ` (${detail})` : ''} in the Documentation Hub.`,
                recipientIds,
                programId: activeProgramId ?? null,
                departmentId,
                link: '/documentation',
                requestedByName: user?.name || user?.email || ''
            })

            setRemindedKeys(previous => new Set(previous).add(key))
            message.success(`Reminder sent to ${departmentName}.`)
        } catch (error) {
            console.error('Failed to send reminder:', error)
            message.error('Failed to send reminder.')
        } finally {
            setRemindingDeptId(null)
        }
    }

    // Card border colour reflects submission state.
    const cardTone = (card: {
        latest: ImplPlanDoc | null
        weeks: { doc: ImplPlanDoc | null; inProgress: boolean }[]
    }) => {
        const RED = '#ff4d4f'
        const AMBER = '#faad14'
        const GREEN = '#52c41a'
        const ORANGE = '#fa8c16'
        const BLUE = '#1677ff'

        if (isWeeklySegment) {
            if (!card.weeks.length) return undefined
            if (card.weeks.some(week => !week.doc && !week.inProgress)) return RED
            if (card.weeks.some(week => !week.doc)) return AMBER
            const docs = card.weeks.map(week => week.doc!)
            if (docs.some(item => item.status === 'queried')) return ORANGE
            return docs.every(item => item.status === 'ratified') ? GREEN : BLUE
        }

        if (!card.latest) return RED
        const status = card.latest.status ?? 'pending'
        return status === 'ratified' ? GREEN : status === 'queried' ? ORANGE : BLUE
    }

    const planStatusColor: Record<string, string> = {
        ratified: 'green',
        queried: 'orange',
        pending: 'blue'
    }

    const planCardActions = (record: ImplPlanDoc) => {
        const actionsColumn: any = (docCols as any[]).find(column => column.key === 'actions')
        return actionsColumn?.render?.(null, record)
    }

    const formatWeek = (start: Dayjs, end: Dayjs) =>
        start.month() === end.month()
            ? `${start.format('D')}–${end.format('D MMM')}`
            : `${start.format('D MMM')}–${end.format('D MMM')}`

    const internalMetrics = useMemo(() => {
        const monthStart = dayjs().startOf('month')
        const departments = new Set<string>()
        let thisMonth = 0
        let awaitingReview = 0

        docPlans.forEach(document => {
            if (document.departmentId) departments.add(String(document.departmentId))
            if (document.createdAt?.toDate && !dayjs(document.createdAt.toDate()).isBefore(monthStart)) {
                thisMonth += 1
            }
            if (document.status === 'pending' || document.status === 'queried') awaitingReview += 1
        })

        return { total: docPlans.length, departments: departments.size, thisMonth, awaitingReview }
    }, [docPlans])

    const [filtersOpen, setFiltersOpen] = useState(false)

    const activeFilterCount =
        (searchText.trim() ? 1 : 0) +
        (statusFilter !== 'all' ? 1 : 0) +
        (isGlobalViewer && !isInternalOps && deptFilter !== 'all' ? 1 : 0) +
        (dateRange ? 1 : 0)

    const resetFilters = () => {
        setSearchText('')
        setStatusFilter('all')
        setDeptFilter('all')
        setDateRange(null)
    }

    const segmentedSwitcher = (
        <Segmented
            block={isMobile}
            style={isMobile ? undefined : { flex: '0 0 auto' }}
            value={activeSegment}
            onChange={value => {
                setActiveSegment(value as DocType)
                resetFilters()
            }}
            options={[
                { label: isMobile ? 'Weekly' : 'Weekly Reports', value: 'weekly_report', icon: <CalendarOutlined /> },
                { label: isMobile ? 'Plans' : 'Implementation Plans', value: 'implementation_plan', icon: <FileTextOutlined /> },
                { label: isMobile ? 'Internal' : 'Internal Operations', value: 'internal_operations', icon: <SettingOutlined /> }
            ]}
        />
    )

    // Same four controls in the desktop one-line bar and the mobile filters drawer.
    const filterControls = (stacked: boolean) => {
        const cell = (style: React.CSSProperties, node: React.ReactNode, label: string, key: string) =>
            stacked ? (
                <div key={key}>
                    <Text type='secondary' style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>{label}</Text>
                    {node}
                </div>
            ) : (
                <div key={key} style={style}>{node}</div>
            )

        return [
            cell(
                { flex: '1 1 160px', minWidth: 140 },
                <Input.Search
                    allowClear
                    placeholder='Search by title, department/uploader…'
                    value={searchText}
                    onChange={event => setSearchText(event.target.value)}
                    style={{ width: '100%' }}
                />,
                'Search', 'search'
            ),
            cell(
                { flex: '0 1 140px', minWidth: 120 },
                stacked ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {[
                            { value: 'all', label: 'All', color: '#8c8c8c' },
                            { value: 'pending', label: 'Pending', color: '#1677ff' },
                            { value: 'ratified', label: 'Ratified', color: '#52c41a' },
                            { value: 'queried', label: 'Queried', color: '#fa8c16' }
                        ].map(option => {
                            const selected = statusFilter === option.value

                            return (
                                <button
                                    key={option.value}
                                    type='button'
                                    aria-pressed={selected}
                                    onClick={() => setStatusFilter(option.value as typeof statusFilter)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        padding: '10px 12px',
                                        borderRadius: 12,
                                        cursor: 'pointer',
                                        font: 'inherit',
                                        fontWeight: selected ? 600 : 500,
                                        color: selected ? option.color : 'inherit',
                                        border: `1px solid ${selected ? option.color : 'rgba(128, 128, 128, 0.28)'}`,
                                        background: selected ? `${option.color}14` : 'transparent',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <span
                                        style={{
                                            width: 8,
                                            height: 8,
                                            borderRadius: '50%',
                                            background: option.color,
                                            flex: '0 0 auto'
                                        }}
                                    />
                                    {option.label}
                                </button>
                            )
                        })}
                    </div>
                ) : (
                    <Select
                        style={{ width: '100%' }}
                        value={statusFilter}
                        onChange={value => setStatusFilter(value)}
                        options={[
                            { label: 'All statuses', value: 'all' },
                            { label: 'Pending', value: 'pending' },
                            { label: 'Ratified', value: 'ratified' },
                            { label: 'Queried', value: 'queried' }
                        ]}
                    />
                ),
                'Status', 'status'
            ),
            ...(isGlobalViewer && !isInternalOps
                ? [cell(
                    { flex: '0 1 170px', minWidth: 130 },
                    <Select
                        style={{ width: '100%' }}
                        value={deptFilter}
                        onChange={value => setDeptFilter(value)}
                        placeholder='Department'
                        options={[
                            { label: 'All departments', value: 'all' },
                            ...departmentOptions.map(department => ({
                                label: department.name,
                                value: department.id
                            }))
                        ]}
                    />,
                    'Department', 'dept'
                )]
                : []),
            cell(
                { flex: '0 1 250px', minWidth: 210 },
                <RangePicker
                    style={{ width: '100%' }}
                    presets={[
                        { label: 'This Week', value: [dayjs().startOf('week'), dayjs().endOf('week')] },
                        { label: 'This Month', value: [dayjs().startOf('month'), dayjs().endOf('month')] },
                        { label: 'Last Month', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] }
                    ]}
                    value={dateRange as any}
                    onChange={values =>
                        setDateRange(
                            values && values.length === 2
                                ? values as [Dayjs, Dayjs]
                                : null
                        )
                    }
                />,
                'Date range', 'range'
            )
        ]
    }

    const showUploadInBar = !isDirector && !(isProjectAdmin && showCards)

    const uploadButton = (
        <Button
            variant='filled'
            shape='round'
            color='primary'
            style={{ flex: '0 0 auto' }}
            icon={<UploadOutlined />}
            onClick={openUploadDoc}
            disabled={!isInternalOps && isAllPrograms}
        >
            Upload
        </Button>
    )

    const uploadModalTitle =
        activeSegment ===
            'implementation_plan'
            ? 'Upload Implementation Plan'
            : activeSegment ===
                'weekly_report'
                ? 'Upload Weekly Report'
                : 'Upload Internal Operations Document'

    const uploadLabel =
        activeSegment ===
            'implementation_plan'
            ? 'Plan Document'
            : activeSegment ===
                'weekly_report'
                ? 'Weekly Report Document'
                : 'Internal Document'

    const titlePlaceholder =
        activeSegment ===
            'implementation_plan'
            ? 'e.g. Q4 Implementation Plan — Operations'
            : activeSegment ===
                'weekly_report'
                ? 'e.g. Week 3 Report — Legal Advisory Services'
                : 'e.g. Internal SOP — Procurement Workflow'

    return (
        <div
            style={{
                padding:
                    24,

                minHeight:
                    '100vh'
            }}
        >
            <Helmet>
                <title>
                    Documentation Hub | Smart Incubation
                </title>
            </Helmet>

            {isPageLoading ? (
                <DocumentationSkeleton
                    asCards={
                        ((activeSegment === 'implementation_plan' ||
                            activeSegment === 'weekly_report') &&
                            isGlobalViewer) ||
                        showInternalCards
                    }
                    isMobile={isMobile}
                    tiles={
                        isMobile || activeSegment === 'implementation_plan'
                            ? 2
                            : 4
                    }
                />
            ) : missingState ? (
                <Result
                    status={
                        missingState.status
                    }
                    title={
                        missingState.title
                    }
                    subTitle={
                        missingState.subTitle
                    }
                    extra={
                        <Button
                            onClick={() => {
                                setActiveSegment(
                                    'internal_operations'
                                )

                                setSearchText(
                                    ''
                                )

                                setStatusFilter(
                                    'all'
                                )

                                setDeptFilter(
                                    'all'
                                )

                                setDateRange(
                                    null
                                )
                            }}
                        >
                            Open Internal Operations
                        </Button>
                    }
                />
            ) : (
                <>
                    {activeSegment === 'implementation_plan' && !isDepartmentView && (
                        <Row gutter={[16, 16]}>
                            <Col xs={12} md={12}>
                                <MetricTile
                                    icon={<FileTextOutlined />}
                                    title='Total Plans'
                                    value={totalPlans}
                                />
                            </Col>
                            <Col xs={12} md={12}>
                                <MetricTile
                                    icon={<TeamOutlined />}
                                    title={isMobile ? 'Submitted' : 'Departments Submitted (any period)'}
                                    value={departmentsSubmitted}
                                />
                            </Col>
                        </Row>
                    )}

                    {activeSegment === 'weekly_report' && (isDirector || isProjectAdmin) && (
                        <Row gutter={[16, 16]}>
                            <Col xs={12} md={12} xl={6}>
                                <MetricTile
                                    icon={<FileTextOutlined />}
                                    title={isMobile ? 'Reports' : 'Reports Submitted This Week'}
                                    value={weeklyTotal}
                                />
                            </Col>
                            <Col xs={12} md={12} xl={6}>
                                <MetricTile
                                    icon={<TeamOutlined />}
                                    title={isMobile ? 'Depts Submitted' : 'Departments Submitted (This Week)'}
                                    value={weeklyDeptSubmitted}
                                />
                            </Col>
                            <Col xs={12} md={12} xl={6} style={{ display: isMobile ? 'none' : undefined }}>
                                <MetricTile
                                    icon={<WarningOutlined />}
                                    title='Missing Departments (This Week)'
                                    value={weeklyDeptMissing}
                                />
                            </Col>
                            <Col xs={12} md={12} xl={6} style={{ display: isMobile ? 'none' : undefined }}>
                                <MetricTile
                                    icon={<FileTextOutlined />}
                                    title='Ratified / Pending+Queried (This Week)'
                                    value={`${weeklyRatified} / ${weeklyPendingOrQueried}`}
                                />
                            </Col>
                        </Row>
                    )}

                    {isInternalOps && (
                        <Row gutter={[16, 16]}>
                            <Col xs={12} md={12} xl={6}>
                                <MetricTile
                                    icon={<SettingOutlined />}
                                    title={isMobile ? 'Documents' : 'Total Documents'}
                                    value={internalMetrics.total}
                                />
                            </Col>
                            <Col xs={12} md={12} xl={6}>
                                <MetricTile
                                    icon={<TeamOutlined />}
                                    title={isMobile ? 'Departments' : 'Departments Contributing'}
                                    value={internalMetrics.departments}
                                />
                            </Col>
                            <Col xs={12} md={12} xl={6} style={{ display: isMobile ? 'none' : undefined }}>
                                <MetricTile
                                    icon={<CalendarOutlined />}
                                    title='Added This Month'
                                    value={internalMetrics.thisMonth}
                                />
                            </Col>
                            <Col xs={12} md={12} xl={6} style={{ display: isMobile ? 'none' : undefined }}>
                                <MetricTile
                                    icon={<ExclamationCircleOutlined />}
                                    title='Pending / Queried'
                                    value={internalMetrics.awaitingReview}
                                />
                            </Col>
                        </Row>
                    )}

                    <DashboardFilterBar style={{ marginTop: 16, marginBottom: 16 }}>
                        {isMobile ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                                {segmentedSwitcher}
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <Button
                                        block
                                        icon={<FilterOutlined />}
                                        onClick={() => setFiltersOpen(true)}
                                        style={{ flex: 1 }}
                                    >
                                        Filters
                                        {activeFilterCount > 0 && (
                                            <Badge count={activeFilterCount} size='small' style={{ marginInlineStart: 8 }} />
                                        )}
                                    </Button>
                                    {showUploadInBar && <div style={{ flex: 1 }}>{React.cloneElement(uploadButton, { block: true })}</div>}
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'nowrap', width: '100%' }}>
                                {segmentedSwitcher}
                                {filterControls(false)}
                                {showUploadInBar && uploadButton}
                            </div>
                        )}
                    </DashboardFilterBar>

                    <Drawer
                        open={isMobile && filtersOpen}
                        title='Filters'
                        placement='bottom'
                        height='auto'
                        onClose={() => setFiltersOpen(false)}
                        rootClassName='modal-style-drawer responsive-sheet-drawer'
                        styles={{
                            body: { padding: '4px 16px 8px' },
                            footer: { padding: '12px 16px calc(12px + env(safe-area-inset-bottom))' }
                        }}
                        footer={
                            <div style={{ display: 'flex', gap: 8 }}>
                                <Button block disabled={activeFilterCount === 0} onClick={resetFilters}>
                                    Reset
                                </Button>
                                <Button block type='primary' onClick={() => setFiltersOpen(false)}>
                                    Show results
                                </Button>
                            </div>
                        }
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {filterControls(true)}
                        </div>
                    </Drawer>

                    {showCards ? (
                        planCards.length === 0 && !selfCard ? (
                            <MotionCard>
                                <Empty description='No participating departments match these filters.' />
                            </MotionCard>
                        ) : (
                            <>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    {[...(selfCard ? [selfCard] : []), ...pagedCards].map(card => {
                                        const reminded = remindedKeys.has(`${activeSegment}:${card.id}`)
                                        const reminding = remindingDeptId === card.id

                                        const tone = cardTone(card)
                                        const cardStyle: React.CSSProperties = tone
                                            ? { border: `1px solid ${tone}` }
                                            : {}

                                        const reminderButton = (detail?: string) => card.isSelf ? (
                                            <Button
                                                type='primary'
                                                shape='round'
                                                icon={<UploadOutlined />}
                                                onClick={openUploadDoc}
                                                disabled={isAllPrograms}
                                            >
                                                {isAllPrograms ? 'Select a program to upload' : 'Upload'}
                                            </Button>
                                        ) : (
                                            <Popconfirm
                                                title={`Remind ${card.name}'s HOD to upload?`}
                                                okText='Send reminder'
                                                onConfirm={() => remindDepartment(card.id, card.name, detail)}
                                            >
                                                <Button icon={<BellOutlined />} loading={reminding} disabled={reminded}>
                                                    {reminded ? 'Reminder sent' : 'Send reminder'}
                                                </Button>
                                            </Popconfirm>
                                        )

                                        if (isWeeklySegment) {
                                            const missing = card.weeks.filter(week => !week.doc)
                                            const detail = missing.map(week => formatWeek(week.start, week.end)).join(', ')

                                            return (
                                                <MotionCard key={card.id} style={cardStyle}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                                                        <div style={{ flex: isMobile ? '1 1 auto' : '0 0 220px', minWidth: isMobile ? 0 : 180 }}>
                                                            <Text strong style={{ fontSize: 15 }}>{card.name}</Text>
                                                            <div>
                                                                <Text type='secondary' style={{ fontSize: 12 }}>
                                                                    {card.weeks.length
                                                                        ? `${card.weeks.length - card.missingWeeks} of ${card.weeks.length} week${card.weeks.length === 1 ? '' : 's'} uploaded`
                                                                        : 'No completed weeks in this range yet'}
                                                                </Text>
                                                            </div>
                                                        </div>

                                                        <div style={{ flex: isMobile ? '0 1 auto' : '1 1 280px', maxWidth: '100%', display: 'flex', gap: isMobile ? 6 : 8, flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : undefined }}>
                                                            {card.weeks.map((week, index) => {
                                                                const uploaded = Boolean(week.doc)
                                                                const color = uploaded ? '#52c41a' : week.inProgress ? '#faad14' : '#ff4d4f'
                                                                const label = week.inProgress ? 'This week' : isMobile ? `W${index + 1}` : `Wk ${index + 1}`
                                                                const marker = (
                                                                    <div
                                                                        style={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: 6,
                                                                            padding: isMobile ? '4px 8px' : '4px 10px',
                                                                            flex: '0 0 auto',
                                                                            borderRadius: 8,
                                                                            fontSize: 12,
                                                                            color,
                                                                            border: `1px solid ${color}`,
                                                                            background: `${color}14`,
                                                                            cursor: uploaded ? 'pointer' : 'default'
                                                                        }}
                                                                    >
                                                                        {uploaded
                                                                            ? <CheckCircleOutlined />
                                                                            : week.inProgress
                                                                                ? <ClockCircleOutlined />
                                                                                : <CloseCircleOutlined />}
                                                                        <span>
                                                                            <strong>{label}</strong>{isMobile && !week.inProgress ? '' : <> · {formatWeek(week.start, week.end)}</>}
                                                                        </span>
                                                                    </div>
                                                                )

                                                                if (!week.doc) {
                                                                    return (
                                                                        <Tooltip
                                                                            key={index}
                                                                            title={week.inProgress ? 'Not uploaded yet - still due this week' : 'Not uploaded'}
                                                                        >
                                                                            {marker}
                                                                        </Tooltip>
                                                                    )
                                                                }

                                                                const weekDoc = week.doc
                                                                const weekStatus = weekDoc.status ?? 'pending'

                                                                return (
                                                                    <Popover
                                                                        key={index}
                                                                        trigger='click'
                                                                        content={
                                                                            <Space direction='vertical' size={8}>
                                                                                <a href={weekDoc.attachment?.url} target='_blank' rel='noreferrer'>
                                                                                    <FileTextOutlined /> {weekDoc.title || weekDoc.attachment?.name}
                                                                                </a>
                                                                                <Space size={8} wrap>
                                                                                    <Tag color={planStatusColor[weekStatus] ?? 'default'}>
                                                                                        {weekStatus.charAt(0).toUpperCase() + weekStatus.slice(1)}
                                                                                    </Tag>
                                                                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                                                                        {weekDoc.createdAt?.toDate
                                                                                            ? dayjs(weekDoc.createdAt.toDate()).format('DD MMM YYYY')
                                                                                            : ''}
                                                                                        {weekDoc.createdByName ? ` · ${weekDoc.createdByName}` : ''}
                                                                                    </Text>
                                                                                </Space>
                                                                                {planCardActions(weekDoc)}
                                                                            </Space>
                                                                        }
                                                                    >
                                                                        {marker}
                                                                    </Popover>
                                                                )
                                                            })}
                                                        </div>

                                                        {(missing.length > 0 || card.isSelf) && (
                                                            <div className='doc-card-actions' style={isMobile ? { flex: '1 1 100%', width: '100%' } : { flex: '0 0 auto' }}>{reminderButton(detail)}</div>
                                                        )}
                                                    </div>
                                                </MotionCard>
                                            )
                                        }

                                        const uploaded = Boolean(card.latest)
                                        const latestStatus = card.latest?.status ?? 'pending'

                                        return (
                                            <MotionCard key={card.id} style={cardStyle}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                                                    <div style={{ flex: isMobile ? '1 1 auto' : '0 0 220px', minWidth: isMobile ? 0 : 180 }}>
                                                        <Text strong style={{ fontSize: 15 }}>{card.name}</Text>
                                                        <div style={{ display: 'inline-block', marginLeft: 8 }}>
                                                            <Tag
                                                                color={uploaded ? 'success' : 'error'}
                                                                icon={uploaded ? <CheckCircleOutlined /> : <WarningOutlined />}
                                                            >
                                                                {uploaded ? 'Uploaded' : 'Not uploaded'}
                                                            </Tag>
                                                        </div>
                                                    </div>

                                                    <div style={{ flex: isMobile ? '1 1 100%' : '1 1 280px', minWidth: 0 }}>
                                                        {uploaded && card.latest ? (
                                                            <Space direction='vertical' size={4}>
                                                                <a href={card.latest.attachment?.url} target='_blank' rel='noreferrer'>
                                                                    <FileTextOutlined /> {card.latest.title || card.latest.attachment?.name}
                                                                </a>
                                                                <Space size={8} wrap>
                                                                    <Tag color={planStatusColor[latestStatus] ?? 'default'} style={{ marginInlineEnd: 0 }}>
                                                                        {latestStatus.charAt(0).toUpperCase() + latestStatus.slice(1)}
                                                                    </Tag>
                                                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                                                        {card.latest.createdAt?.toDate
                                                                            ? dayjs(card.latest.createdAt.toDate()).format('DD MMM YYYY')
                                                                            : ''}
                                                                        {card.latest.createdByName ? ` · ${card.latest.createdByName}` : ''}
                                                                        {card.count > 1 ? ` · latest of ${card.count} uploads` : ''}
                                                                    </Text>
                                                                </Space>
                                                            </Space>
                                                        ) : (
                                                            <Text type='secondary'>
                                                                No implementation plan has been uploaded for this program yet.
                                                            </Text>
                                                        )}
                                                    </div>

                                                    <div className='doc-card-actions' style={isMobile ? { flex: '1 1 100%', width: '100%' } : { flex: '0 0 auto' }}>
                                                        {card.isSelf
                                                            ? <Space>{uploaded && card.latest ? planCardActions(card.latest) : null}{reminderButton()}</Space>
                                                            : uploaded && card.latest ? planCardActions(card.latest) : reminderButton()}
                                                    </div>
                                                </div>
                                            </MotionCard>
                                        )
                                    })}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                                    <Pagination
                                        current={cardPage}
                                        pageSize={cardPageSize}
                                        total={planCards.length}
                                        showSizeChanger={false}
                                        onChange={(page, size) => {
                                            setCardPage(page)
                                            setCardPageSize(size)
                                        }}
                                    />
                                </div>
                            </>
                        )
                    ) : showInternalCards ? (
                        filteredDocs.length === 0 ? (
                            <MotionCard>
                                <Empty description='No documents match these filters.' />
                            </MotionCard>
                        ) : (
                            <>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    {pagedInternal.map(record => {
                                        const status = record.status ?? 'pending'
                                        const tone = status === 'ratified' ? '#52c41a' : status === 'queried' ? '#fa8c16' : '#1677ff'

                                        return (
                                            <MotionCard key={record.id} style={{ border: `1px solid ${tone}` }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                                    <a href={record.attachment?.url} target='_blank' rel='noreferrer'>
                                                        <FileTextOutlined /> {record.title || record.attachment?.name}
                                                    </a>
                                                    <Space size={8} wrap>
                                                        <Tag color={planStatusColor[status] ?? 'default'} style={{ marginInlineEnd: 0 }}>
                                                            {status.charAt(0).toUpperCase() + status.slice(1)}
                                                        </Tag>
                                                        {record.replacementRequest?.status === 'requested' && (
                                                            <Tag color='gold' style={{ marginInlineEnd: 0 }}>Replacement requested</Tag>
                                                        )}
                                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                                            {record.createdAt?.toDate
                                                                ? dayjs(record.createdAt.toDate()).format('DD MMM YYYY')
                                                                : ''}
                                                            {record.createdByName ? ` · ${record.createdByName}` : ''}
                                                        </Text>
                                                    </Space>
                                                    <div className='doc-card-actions' style={{ width: '100%' }}>
                                                        {planCardActions(record)}
                                                    </div>
                                                </div>
                                            </MotionCard>
                                        )
                                    })}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                                    <Pagination
                                        current={cardPage}
                                        pageSize={cardPageSize}
                                        total={filteredDocs.length}
                                        showSizeChanger={false}
                                        onChange={page => setCardPage(page)}
                                    />
                                </div>
                            </>
                        )
                    ) : (
                        <MotionCard>
                            <Table
                                rowKey='id'
                                dataSource={filteredDocs}
                                columns={docCols as any}
                                loading={loadingDocs}
                                pagination={{ pageSize: 10, position: ['bottomCenter'], showSizeChanger: false }}
                            />
                        </MotionCard>
                    )}

                    <style>{`
                        @media (max-width: 767.98px) {
                            .doc-card-actions .ant-space { display: flex; flex-direction: column; width: 100%; }
                            .doc-card-actions .ant-space-item { width: 100%; }
                            .doc-card-actions .ant-btn { width: 100%; }
                        }
                    `}</style>

                    <ResponsiveSheet
                        modalStyle
                        open={docOpen}
                        title={uploadModalTitle}
                        onClose={() => setDocOpen(false)}
                        footer={
                            <Button
                                type='primary'
                                size='large'
                                block
                                loading={isUploadingDoc}
                                disabled={isUploadingDoc}
                                onClick={saveDoc}
                            >
                                Submit
                            </Button>
                        }
                    >
                        <Form
                            form={
                                docForm
                            }
                            layout='vertical'
                        >
                            <Form.Item
                                name='title'
                                label='Document Title'
                                rules={[
                                    {
                                        required:
                                            true,

                                        message:
                                            'Provide a title'
                                    }
                                ]}
                            >
                                <Input
                                    placeholder={
                                        titlePlaceholder
                                    }
                                />
                            </Form.Item>

                            {activeSegment ===
                                'weekly_report' && (
                                    <Form.Item
                                        name='overviewSummary'
                                        label='Overview Summary (optional)'
                                    >
                                        <Input.TextArea
                                            rows={
                                                4
                                            }
                                            placeholder='Short high-level summary for the CEO (optional).'
                                        />
                                    </Form.Item>
                                )}

                            <Form.Item
                                name='file'
                                label={
                                    uploadLabel
                                }
                                valuePropName='file'
                                getValueFromEvent={
                                    event => {
                                        if (
                                            !event
                                        ) {
                                            return undefined
                                        }

                                        return Array.isArray(
                                            event
                                        )
                                            ? event[0]
                                            : event?.file ??
                                            event?.fileList?.[0]
                                    }
                                }
                                rules={[
                                    {
                                        required:
                                            true,

                                        message:
                                            'Select a document to upload'
                                    }
                                ]}
                            >
                                <Upload.Dragger
                                    beforeUpload={() => false}
                                    maxCount={1}
                                    accept='.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx'
                                >
                                    <p className='ant-upload-drag-icon'>
                                        <InboxOutlined />
                                    </p>
                                    <p className='ant-upload-text'>
                                        Click or drag a file here to upload
                                    </p>
                                    <p className='ant-upload-hint'>
                                        PDF, Word, Excel or PowerPoint
                                    </p>
                                </Upload.Dragger>
                            </Form.Item>
                        </Form>
                    </ResponsiveSheet>

                    <ResponsiveSheet
                        modalStyle
                        open={replaceOpen}
                        title='Replace Document'
                        onClose={() => {
                            setReplaceOpen(false)
                            setReplacingId(null)
                        }}
                        footer={
                            <Button
                                type='primary'
                                size='large'
                                block
                                loading={isReplacing}
                                disabled={isReplacing}
                                onClick={saveReplace}
                            >
                                Submit
                            </Button>
                        }
                    >
                        <Form
                            form={
                                replaceForm
                            }
                            layout='vertical'
                        >
                            <Form.Item
                                name='title'
                                label='Document Title'
                            >
                                <Input placeholder='Keep or update the title' />
                            </Form.Item>

                            <Form.Item
                                name='file'
                                label='New File'
                                valuePropName='file'
                                getValueFromEvent={
                                    event => {
                                        if (
                                            !event
                                        ) {
                                            return undefined
                                        }

                                        return Array.isArray(
                                            event
                                        )
                                            ? event[0]
                                            : event?.file ??
                                            event?.fileList?.[0]
                                    }
                                }
                                rules={[
                                    {
                                        required:
                                            true,

                                        message:
                                            'Select a new document to upload'
                                    }
                                ]}
                            >
                                <Upload.Dragger
                                    beforeUpload={() => false}
                                    maxCount={1}
                                    accept='.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx'
                                >
                                    <p className='ant-upload-drag-icon'>
                                        <InboxOutlined />
                                    </p>
                                    <p className='ant-upload-text'>
                                        Click or drag a file here to upload
                                    </p>
                                    <p className='ant-upload-hint'>
                                        PDF, Word, Excel or PowerPoint
                                    </p>
                                </Upload.Dragger>
                            </Form.Item>
                        </Form>
                    </ResponsiveSheet>

                    <Modal
                        open={
                            reqOpen
                        }
                        title={
                            activeSegment ===
                                'weekly_report' &&
                                isDirector
                                ? 'Query Weekly Report'
                                : 'Request Replacement'
                        }
                        onCancel={() => {
                            setReqOpen(
                                false
                            )

                            setRequestingId(
                                null
                            )
                        }}
                        onOk={
                            saveRequest
                        }
                        okText={
                            activeSegment ===
                                'weekly_report' &&
                                isDirector
                                ? 'Send Query'
                                : 'Send Request'
                        }
                        okButtonProps={{
                            loading:
                                isRequesting,

                            disabled:
                                isRequesting
                        }}
                        destroyOnClose
                    >
                        <Form
                            form={
                                reqForm
                            }
                            layout='vertical'
                        >
                            <Form.Item
                                name='message'
                                label={
                                    activeSegment ===
                                        'weekly_report' &&
                                        isDirector
                                        ? 'Query message to department'
                                        : 'Message'
                                }
                                rules={[
                                    {
                                        required:
                                            true,

                                        message:
                                            'Please provide a short reason/instructions'
                                    }
                                ]}
                            >
                                <Input.TextArea
                                    rows={
                                        4
                                    }
                                    placeholder='E.g., Please include the updated intervention schedule and sign-off page.'
                                />
                            </Form.Item>
                        </Form>
                    </Modal>
                </>
            )}
        </div>
    )
}

export default DocumentationHub
