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
    Statistic,
    Popconfirm,
    Tag,
    Segmented,
    DatePicker,
    Result
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
    CalendarOutlined
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { Helmet } from 'react-helmet'

// hooks
import { useFullIdentity } from '@/hooks/useFullIdentity'
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
    deleteDoc
} from 'firebase/firestore'
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL
} from 'firebase/storage'

// UI
import {
    DashboardHeaderCard,
    MotionCard
} from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'

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

    const deptStr =
        String(
            user?.departmentName ||
            (user as any)?.department ||
            ''
        ).toLowerCase()

    const isME =
        roleStr === 'me' ||
        deptStr.includes('m&e')

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

                    const filtered =
                        rows.filter(
                            row =>
                                !startsWithAny(
                                    row.name,
                                    [
                                        'IhF',
                                        'HRM'
                                    ]
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

    const headerTitle =
        activeSegment ===
            'implementation_plan'
            ? 'Implementation Plans'
            : activeSegment ===
                'weekly_report'
                ? 'Weekly Reports'
                : 'Internal Operations'

    const headerSubtitle =
        activeSegment ===
            'implementation_plan'
            ? 'Departmental implementation plan documents'
            : activeSegment ===
                'weekly_report'
                ? 'Weekly departmental performance reports'
                : 'Internal documents not tied to a program'

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
                <LoadingOverlay tip='Loading documents…' />
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
                    <DashboardHeaderCard
                        title={
                            headerTitle
                        }
                        subtitle={
                            headerSubtitle
                        }
                        extraRight={
                            <Space>
                                <Segmented
                                    value={
                                        activeSegment
                                    }
                                    onChange={
                                        value => {
                                            setActiveSegment(
                                                value as DocType
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
                                        }
                                    }
                                    options={[
                                        {
                                            label:
                                                (
                                                    <Space>
                                                        <CalendarOutlined />
                                                        Weekly
                                                        Reports
                                                    </Space>
                                                ),

                                            value:
                                                'weekly_report'
                                        },

                                        {
                                            label:
                                                (
                                                    <Space>
                                                        <FileTextOutlined />
                                                        Implementation
                                                        Plans
                                                    </Space>
                                                ),

                                            value:
                                                'implementation_plan'
                                        },

                                        {
                                            label:
                                                (
                                                    <Space>
                                                        <SettingOutlined />
                                                        Internal
                                                        Operations
                                                    </Space>
                                                ),

                                            value:
                                                'internal_operations'
                                        }
                                    ]}
                                />

                                {!isDirector && (
                                    <Button
                                        variant='filled'
                                        shape='round'
                                        color='geekblue'
                                        style={{
                                            border:
                                                '1px solid dodgerblue'
                                        }}
                                        icon={
                                            <UploadOutlined />
                                        }
                                        onClick={
                                            openUploadDoc
                                        }
                                        disabled={
                                            !isInternalOps &&
                                            isAllPrograms
                                        }
                                    >
                                        {activeSegment ===
                                            'implementation_plan'
                                            ? 'Upload Plan Document'
                                            : activeSegment ===
                                                'weekly_report'
                                                ? 'Upload Weekly Report'
                                                : 'Upload Internal Document'}
                                    </Button>
                                )}
                            </Space>
                        }
                    />

                    {activeSegment ===
                        'implementation_plan' &&
                        !isDepartmentView && (
                            <>
                                <Row
                                    gutter={[
                                        16,
                                        16
                                    ]}
                                    style={{
                                        marginTop:
                                            12
                                    }}
                                >
                                    <Col
                                        xs={
                                            24
                                        }
                                        md={
                                            8
                                        }
                                    >
                                        <MotionCard>
                                            <Space align='center'>
                                                <FileTextOutlined
                                                    style={{
                                                        fontSize:
                                                            24
                                                    }}
                                                />

                                                <Statistic
                                                    title='Total Plans'
                                                    value={
                                                        totalPlans
                                                    }
                                                />
                                            </Space>
                                        </MotionCard>
                                    </Col>

                                    <Col
                                        xs={
                                            24
                                        }
                                        md={
                                            8
                                        }
                                    >
                                        <MotionCard>
                                            <Space align='center'>
                                                <TeamOutlined
                                                    style={{
                                                        fontSize:
                                                            24
                                                    }}
                                                />

                                                <Statistic
                                                    title='Departments Submitted (any period)'
                                                    value={
                                                        departmentsSubmitted
                                                    }
                                                />
                                            </Space>
                                        </MotionCard>
                                    </Col>

                                    <Col
                                        xs={
                                            24
                                        }
                                        md={
                                            8
                                        }
                                    >
                                        <MotionCard>
                                            <Space align='center'>
                                                <WarningOutlined
                                                    style={{
                                                        fontSize:
                                                            24
                                                    }}
                                                />

                                                <Statistic
                                                    title='Missing Departments (overall)'
                                                    value={
                                                        missingDepartments
                                                    }
                                                />
                                            </Space>
                                        </MotionCard>
                                    </Col>
                                </Row>

                                {missingDepartments >
                                    0 && (
                                        <div
                                            style={{
                                                marginTop:
                                                    8
                                            }}
                                        >
                                            <MotionCard>
                                                <Text type='secondary'>
                                                    Missing:{' '}
                                                    {expectedDeptIds
                                                        .filter(
                                                            id =>
                                                                !submittedDeptIds.has(
                                                                    id
                                                                )
                                                        )
                                                        .map(
                                                            id =>
                                                                expectedDeptMap[
                                                                id
                                                                ] ||
                                                                id
                                                        )
                                                        .join(
                                                            ', '
                                                        ) ||
                                                        '—'}
                                                </Text>
                                            </MotionCard>
                                        </div>
                                    )}
                            </>
                        )}

                    {activeSegment ===
                        'weekly_report' &&
                        (
                            isDirector ||
                            isProjectAdmin
                        ) && (
                            <Row
                                gutter={[
                                    16,
                                    16
                                ]}
                                style={{
                                    marginTop:
                                        12
                                }}
                            >
                                <Col
                                    xs={
                                        24
                                    }
                                    md={
                                        6
                                    }
                                >
                                    <MotionCard>
                                        <Space align='center'>
                                            <FileTextOutlined
                                                style={{
                                                    fontSize:
                                                        24
                                                }}
                                            />

                                            <Statistic
                                                title='Reports Submitted This Week'
                                                value={
                                                    weeklyTotal
                                                }
                                            />
                                        </Space>
                                    </MotionCard>
                                </Col>

                                <Col
                                    xs={
                                        24
                                    }
                                    md={
                                        6
                                    }
                                >
                                    <MotionCard>
                                        <Space align='center'>
                                            <TeamOutlined
                                                style={{
                                                    fontSize:
                                                        24
                                                }}
                                            />

                                            <Statistic
                                                title='Departments Submitted (This Week)'
                                                value={
                                                    weeklyDeptSubmitted
                                                }
                                            />
                                        </Space>
                                    </MotionCard>
                                </Col>

                                <Col
                                    xs={
                                        24
                                    }
                                    md={
                                        6
                                    }
                                >
                                    <MotionCard>
                                        <Space align='center'>
                                            <WarningOutlined
                                                style={{
                                                    fontSize:
                                                        24
                                                }}
                                            />

                                            <Statistic
                                                title='Missing Departments (This Week)'
                                                value={
                                                    weeklyDeptMissing
                                                }
                                            />
                                        </Space>
                                    </MotionCard>
                                </Col>

                                <Col
                                    xs={
                                        24
                                    }
                                    md={
                                        6
                                    }
                                >
                                    <MotionCard>
                                        <Space align='center'>
                                            <FileTextOutlined
                                                style={{
                                                    fontSize:
                                                        24
                                                }}
                                            />

                                            <Statistic
                                                title='Ratified / Pending+Queried (This Week)'
                                                value={`${weeklyRatified} / ${weeklyPendingOrQueried}`}
                                            />
                                        </Space>
                                    </MotionCard>
                                </Col>
                            </Row>
                        )}

                    <MotionCard
                        style={{
                            marginTop:
                                16
                        }}
                        filterBar={
                            <Row
                                gutter={
                                    12
                                }
                                align='middle'
                                wrap={
                                    false
                                }
                            >
                                <Col flex='auto'>
                                    <Input.Search
                                        allowClear
                                        placeholder='Search by title, department/uploader…'
                                        value={
                                            searchText
                                        }
                                        onChange={
                                            event =>
                                                setSearchText(
                                                    event.target.value
                                                )
                                        }
                                        style={{
                                            width:
                                                '100%'
                                        }}
                                    />
                                </Col>

                                <Col flex='180px'>
                                    <Select
                                        style={{
                                            width:
                                                '100%'
                                        }}
                                        value={
                                            statusFilter
                                        }
                                        onChange={
                                            value =>
                                                setStatusFilter(
                                                    value
                                                )
                                        }
                                        options={[
                                            {
                                                label:
                                                    'All statuses',
                                                value:
                                                    'all'
                                            },
                                            {
                                                label:
                                                    'Pending',
                                                value:
                                                    'pending'
                                            },
                                            {
                                                label:
                                                    'Ratified',
                                                value:
                                                    'ratified'
                                            },
                                            {
                                                label:
                                                    'Queried',
                                                value:
                                                    'queried'
                                            }
                                        ]}
                                    />
                                </Col>

                                {isGlobalViewer &&
                                    !isInternalOps && (
                                        <Col flex='200px'>
                                            <Select
                                                style={{
                                                    width:
                                                        '100%'
                                                }}
                                                value={
                                                    deptFilter
                                                }
                                                onChange={
                                                    value =>
                                                        setDeptFilter(
                                                            value
                                                        )
                                                }
                                                placeholder='Department'
                                                options={[
                                                    {
                                                        label:
                                                            'All departments',
                                                        value:
                                                            'all'
                                                    },

                                                    ...departmentOptions.map(
                                                        department => ({
                                                            label:
                                                                department.name,

                                                            value:
                                                                department.id
                                                        })
                                                    )
                                                ]}
                                            />
                                        </Col>
                                    )}

                                <Col flex='260px'>
                                    <RangePicker
                                        style={{
                                            width:
                                                '100%'
                                        }}
                                        value={
                                            dateRange as any
                                        }
                                        onChange={
                                            values =>
                                                setDateRange(
                                                    values &&
                                                        values.length ===
                                                        2
                                                        ? values as [
                                                            Dayjs,
                                                            Dayjs
                                                        ]
                                                        : null
                                                )
                                        }
                                    />
                                </Col>
                            </Row>
                        }
                        filterBarProps={{
                            padding:
                                14,

                            borderRadius:
                                10,

                            background:
                                '#fafafa',

                            borderColor:
                                '#f0f0f0',

                            boxShadow:
                                'inset 0 1px 2px rgba(0,0,0,0.04)'
                        }}
                    >
                        <Table
                            rowKey='id'
                            dataSource={
                                filteredDocs
                            }
                            columns={
                                docCols as any
                            }
                            loading={
                                loadingDocs
                            }
                            pagination={{
                                pageSize:
                                    10
                            }}
                        />
                    </MotionCard>

                    <Modal
                        open={
                            docOpen
                        }
                        title={
                            uploadModalTitle
                        }
                        onCancel={() =>
                            setDocOpen(
                                false
                            )
                        }
                        onOk={
                            saveDoc
                        }
                        okText='Upload'
                        okButtonProps={{
                            loading:
                                isUploadingDoc,

                            disabled:
                                isUploadingDoc
                        }}
                        destroyOnClose
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
                                <Upload
                                    beforeUpload={() =>
                                        false
                                    }
                                    maxCount={
                                        1
                                    }
                                    accept='.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx'
                                >
                                    <Button
                                        icon={
                                            <UploadOutlined />
                                        }
                                    >
                                        Select
                                        File
                                    </Button>
                                </Upload>
                            </Form.Item>
                        </Form>
                    </Modal>

                    <Modal
                        open={
                            replaceOpen
                        }
                        title='Replace Document'
                        onCancel={() => {
                            setReplaceOpen(
                                false
                            )

                            setReplacingId(
                                null
                            )
                        }}
                        onOk={
                            saveReplace
                        }
                        okText='Replace'
                        okButtonProps={{
                            loading:
                                isReplacing,

                            disabled:
                                isReplacing
                        }}
                        destroyOnClose
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
                                <Upload
                                    beforeUpload={() =>
                                        false
                                    }
                                    maxCount={
                                        1
                                    }
                                    accept='.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx'
                                >
                                    <Button
                                        icon={
                                            <UploadOutlined />
                                        }
                                    >
                                        Select
                                        File
                                    </Button>
                                </Upload>
                            </Form.Item>
                        </Form>
                    </Modal>

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
