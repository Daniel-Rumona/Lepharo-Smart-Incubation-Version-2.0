import dayjs from 'dayjs'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where
} from 'firebase/firestore'

import { db } from '@/firebase'

type Period = {
    month: number
    year: number
    spanMonths?: number
}

export type ExecutiveQuarterlyReportParams = {
    programId: string
    period: Period
    preparedBy?: string
}

export type ExecutiveQuarterlyReportData = {
    /*
     * Existing template property retained.
     * Its value is now the actual programId.
     */
    project_code: string

    project_name: string
    report_quarter: string
    report_date_display: string
    reporting_period_label: string
    prepared_by: string

    executive_summary_paragraphs: Array<{
        paragraph: string
    }>

    milestones: Array<{
        activity: string
        date_display: string
        status: string
        comments: string
    }>

    stakeholder_engagement: Array<{
        activity: string
        date_display: string
        status: string
    }>

    project_resourcing: Array<{
        activity: string
        date_display: string
        status: string
    }>

    mapping_rows: Array<{
        activity: string
        date_display: string
        areas_wards: string
        team_resources: string
        duration: string
        status: string
    }>

    mapping_activity_points: Array<{
        point: string
    }>

    onboarding_progress_paragraphs: Array<{
        paragraph: string
    }>

    kpi_rows: Array<{
        kpi: string
        indicator: string
        target: string
        achieved: string
        variance: string
        comments: string
        status: string
    }>

    progress_update_paragraphs: Array<{
        paragraph: string
    }>

    feature_update_title: string

    feature_update_paragraphs: Array<{
        paragraph: string
    }>

    feature_focus_areas: Array<{
        point: string
    }>

    problems_encountered: Array<{
        challenge: string
        obstacle: string
        risk_level: string
        reason: string
    }>

    risk_assessment: Array<{
        risk: string
        potential_impact: string
        mitigation_strategy: string
        outcomes: string
    }>

    risk_narrative_paragraphs: Array<{
        paragraph: string
    }>

    issues_log: Array<{
        issue: string
        status_action: string
    }>

    budget_lines: Array<{
        line_item: string
        budget_display: string
        expenditure_display: string
        variance_display: string
        comment: string
    }>

    total_budget_display: string
    total_expenditure_display: string
    total_remaining_display: string
    budget_general_comment: string

    budget_narrative_paragraphs: Array<{
        paragraph: string
    }>

    human_resources: Array<{
        implementation: string
        administration: string
        professional: string
    }>

    material_resources: Array<{
        resource: string
        usage: string
    }>

    next_reporting_period_label: string

    upcoming_milestones: Array<{
        milestone: string
    }>

    planned_activities: Array<{
        activity: string
    }>

    annexures: Array<{
        annexure: string
    }>

    project_health: Array<{
        phase: string
        health_area: string
        green_marker: string
        amber_marker: string
        red_marker: string
    }>

    recommendation_paragraphs: Array<{
        paragraph: string
    }>

    reporting_period_statement: string

    conclusion_paragraphs: Array<{
        paragraph: string
    }>
}

type ProgramDoc = {
    name?: string
    budget?: number
    phase?: string
}

type DepartmentDoc = {
    id: string
    name: string
    isActive: boolean
    interventionsDepartment: boolean
}

type AssignedInterventionDoc = {
    id?: string

    programId?: string
    departmentId?: string

    areaOfSupport?: string

    beneficiaryName?: string
    participantId?: string
    participantEmail?: string

    interventionTitle?: string
    interventionId?: string

    status?: string
    assignmentStatus?: string

    assigneeAcceptanceStatus?: string
    participantAcceptanceStatus?: string

    assigneeCompletionStatus?: string
    participantCompletionStatus?: string

    movDocumentId?: string

    createdAt?: any
    updatedAt?: any
    completedAt?: any

    tracking?: {
        documentsUploaded?: Array<unknown>
    }

    progressUpdates?: Array<{
        resources?: Array<unknown>
    }>
}

type ApplicationDoc = {
    programId?: string

    applicationStatus?: string
    status?: string

    ward?: string
    area?: string

    createdAt?: any
    submittedAt?: any

    interventions?: {
        required?: Array<{
            area?: string
            areaOfSupport?: string
            title?: string
        }>

        assigned?: Array<{
            area?: string
            areaOfSupport?: string
            title?: string
        }>

        completed?: Array<{
            area?: string
            areaOfSupport?: string
            title?: string
        }>
    }
}

const DASH = '-'
const TEMPLATE_EMPTY = 'To be updated'

function norm(value: unknown) {
    return String(value ?? '').trim()
}

function low(value: unknown) {
    return norm(value).toLowerCase()
}

/*
 * No maximum range.
 *
 * Examples:
 * spanMonths: 1
 * spanMonths: 3
 * spanMonths: 6
 * spanMonths: 12
 * spanMonths: 24
 */
function periodRange(period: Period) {
    const requestedSpan =
        Number(period.spanMonths ?? 3)

    const span =
        Number.isFinite(requestedSpan) &&
        requestedSpan > 0
            ? Math.floor(requestedSpan)
            : 1

    const start = dayjs(
        `${period.year}-${String(period.month).padStart(2, '0')}-01`
    ).startOf('month')

    const end = start
        .add(span - 1, 'month')
        .endOf('month')

    return {
        start,
        end,
        span
    }
}

function formatPeriodLabel(
    start: dayjs.Dayjs,
    end: dayjs.Dayjs
) {
    if (
        start.isSame(
            end,
            'month'
        )
    ) {
        return start.format(
            'MMMM YYYY'
        )
    }

    return `${start.format('MMMM YYYY')} to ${end.format('MMMM YYYY')}`
}

function quarterLabel(
    start: dayjs.Dayjs
) {
    return `Quarter ${Math.floor(start.month() / 3) + 1}`
}

function nextQuarterLabel(
    end: dayjs.Dayjs
) {
    const next =
        end.add(
            1,
            'day'
        )

    return `Quarter ${Math.floor(next.month() / 3) + 1}`
}

function asDate(
    value: any
): Date | undefined {
    if (!value) {
        return undefined
    }

    if (
        typeof value?.toDate ===
        'function'
    ) {
        return value.toDate()
    }

    if (
        value instanceof Date
    ) {
        return value
    }

    return undefined
}

function displayDate(
    value: any
) {
    const date =
        asDate(value)

    return date
        ? dayjs(date).format(
              'DD MMM YYYY'
          )
        : DASH
}

function isInRange(
    value: any,
    start: dayjs.Dayjs,
    end: dayjs.Dayjs
) {
    const date =
        asDate(value)

    if (!date) {
        return false
    }

    const milliseconds =
        date.getTime()

    return (
        milliseconds >=
            start
                .toDate()
                .getTime() &&
        milliseconds <=
            end
                .toDate()
                .getTime()
    )
}

function statusLabel(
    value: unknown
) {
    const status =
        low(value)

    if (!status) {
        return 'Ongoing'
    }

    if (
        status ===
        'in-progress'
    ) {
        return 'In progress'
    }

    return status
        .split(
            /[\s_-]+/
        )
        .filter(
            Boolean
        )
        .map(
            part =>
                part
                    .charAt(0)
                    .toUpperCase() +
                part.slice(1)
        )
        .join(' ')
}

function hasEvidenceOrCompletion(
    item: AssignedInterventionDoc
) {
    if (
        low(
            item.assignmentStatus
        ) ===
        'completed'
    ) {
        return true
    }

    if (
        low(
            item.status
        ) ===
        'completed'
    ) {
        return true
    }

    if (
        low(
            item.assigneeCompletionStatus
        ) ===
        'completed'
    ) {
        return true
    }

    if (
        low(
            item.participantCompletionStatus
        ) ===
        'confirmed'
    ) {
        return true
    }

    if (
        norm(
            item.movDocumentId
        )
    ) {
        return true
    }

    if (
        Array.isArray(
            item.tracking
                ?.documentsUploaded
        ) &&
        item.tracking!
            .documentsUploaded!
            .length > 0
    ) {
        return true
    }

    return (
        Array.isArray(
            item.progressUpdates
        ) &&
        item.progressUpdates.some(
            update =>
                Array.isArray(
                    update.resources
                ) &&
                update.resources.length >
                    0
        )
    )
}

function currency(
    value: unknown
) {
    const amount =
        Number(
            value || 0
        )

    if (
        !Number.isFinite(
            amount
        ) ||
        amount <= 0
    ) {
        return 'R0.00'
    }

    return `R${amount.toLocaleString('en-ZA', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`
}

function percent(
    numerator: number,
    denominator: number
) {
    if (!denominator) {
        return '0%'
    }

    return `${Math.round(
        (
            numerator /
            denominator
        ) * 100
    )}%`
}

function countBy<T>(
    items: T[],
    pick: (
        item: T
    ) => string
) {
    const map =
        new Map<
            string,
            number
        >()

    for (
        const item
        of items
    ) {
        const key =
            pick(item) ||
            'Unmapped'

        map.set(
            key,
            (
                map.get(key) ||
                0
            ) + 1
        )
    }

    return map
}

function topEntries(
    map: Map<
        string,
        number
    >,
    limit = 5
) {
    return Array.from(
        map.entries()
    )
        .sort(
            (
                first,
                second
            ) =>
                second[1] -
                first[1]
        )
        .slice(
            0,
            limit
        )
}

function ensureRows<T>(
    rows: T[],
    fallback: T
) {
    return rows.length
        ? rows
        : [
              fallback
          ]
}

/*
 * Program naming is intentionally strict:
 *
 * Identifier -> Firestore program document ID
 * Name       -> programs/{programId}.name
 */
function pickProgramName(
    program:
        | ProgramDoc
        | undefined,
    programId: string
) {
    return (
        norm(
            program?.name
        ) ||
        programId
    )
}

/*
 * ---------------------------------------------------------
 * DATA FETCHERS
 * ---------------------------------------------------------
 */

async function fetchProgram(
    programId: string
): Promise<
    ProgramDoc | undefined
> {
    try {
        const snapshot =
            await getDoc(
                doc(
                    db,
                    'programs',
                    programId
                )
            )

        if (
            !snapshot.exists()
        ) {
            return undefined
        }

        return snapshot.data() as ProgramDoc
    } catch (
        error
    ) {
        console.error(
            `Failed to load program ${programId}:`,
            error
        )

        return undefined
    }
}

async function fetchDepartments():
    Promise<
        DepartmentDoc[]
    > {
    try {
        const snapshot =
            await getDocs(
                collection(
                    db,
                    'departments'
                )
            )

        return snapshot.docs.map(
            departmentDoc => {
                const data =
                    departmentDoc.data()

                return {
                    id:
                        departmentDoc.id,

                    name:
                        norm(
                            data.name
                        ) ||
                        norm(
                            data.departmentName
                        ) ||
                        norm(
                            data.title
                        ) ||
                        departmentDoc.id,

                    isActive:
                        data.active !==
                        false,

                    interventionsDepartment:
                        data.interventionsDepartment ===
                        true
                }
            }
        )
    } catch (
        error
    ) {
        console.error(
            'Failed to load departments:',
            error
        )

        return []
    }
}

async function fetchApplications(
    programId: string
): Promise<
    ApplicationDoc[]
> {
    try {
        const snapshot =
            await getDocs(
                query(
                    collection(
                        db,
                        'applications'
                    ),
                    where(
                        'programId',
                        '==',
                        programId
                    )
                )
            )

        return snapshot.docs.map(
            applicationDoc =>
                applicationDoc.data() as ApplicationDoc
        )
    } catch (
        error
    ) {
        console.error(
            `Failed to load applications for program ${programId}:`,
            error
        )

        return []
    }
}

async function fetchAssignedInterventions(
    programId: string
): Promise<
    AssignedInterventionDoc[]
> {
    try {
        const snapshot =
            await getDocs(
                query(
                    collection(
                        db,
                        'assignedInterventions'
                    ),
                    where(
                        'programId',
                        '==',
                        programId
                    )
                )
            )

        return snapshot.docs.map(
            assignedDoc => ({
                id:
                    assignedDoc.id,

                ...(assignedDoc.data() as any)
            })
        )
    } catch (
        error
    ) {
        console.error(
            `Failed to load assigned interventions for program ${programId}:`,
            error
        )

        return []
    }
}

async function fetchUsers() {
    try {
        const snapshot =
            await getDocs(
                collection(
                    db,
                    'users'
                )
            )

        return snapshot.docs.map(
            userDoc =>
                userDoc.data()
        )
    } catch (
        error
    ) {
        console.error(
            'Failed to load users:',
            error
        )

        return []
    }
}

function applicationDate(
    application:
        ApplicationDoc
) {
    return (
        application.submittedAt ||
        application.createdAt
    )
}

function appStatus(
    application:
        ApplicationDoc
) {
    return (
        low(
            application.applicationStatus
        ) ||
        low(
            application.status
        ) ||
        'unknown'
    )
}

function applicationInterventionCount(
    applications:
        ApplicationDoc[],
    bucket:
        | 'required'
        | 'assigned'
        | 'completed'
) {
    return applications.reduce(
        (
            total,
            application
        ) => {
            const rows =
                application
                    .interventions?.[
                    bucket
                ]

            return (
                total +
                (
                    Array.isArray(
                        rows
                    )
                        ? rows.length
                        : 0
                )
            )
        },
        0
    )
}

/*
 * ---------------------------------------------------------
 * REPORT BUILDER
 * ---------------------------------------------------------
 */

export async function buildExecutiveQuarterlyReportData({
    programId,
    period,
    preparedBy
}: ExecutiveQuarterlyReportParams): Promise<ExecutiveQuarterlyReportData> {
    const {
        start,
        end
    } =
        periodRange(
            period
        )

    const [
        program,
        departments,
        applications,
        assigned,
        users
    ] =
        await Promise.all([
            fetchProgram(
                programId
            ),

            fetchDepartments(),

            fetchApplications(
                programId
            ),

            fetchAssignedInterventions(
                programId
            ),

            fetchUsers()
        ])

    /*
     * Program source of truth:
     *
     * programId = programs document ID
     * projectName = program.name
     */
    const projectName =
        pickProgramName(
            program,
            programId
        )

    const appsInPeriod =
        applications.filter(
            application =>
                isInRange(
                    applicationDate(
                        application
                    ),
                    start,
                    end
                )
        )

    const assignedInPeriod =
        assigned.filter(
            item =>
                [
                    item.completedAt,
                    item.updatedAt,
                    item.createdAt
                ].some(
                    value =>
                        isInRange(
                            value,
                            start,
                            end
                        )
                )
        )

    const completedInPeriod =
        assignedInPeriod.filter(
            hasEvidenceOrCompletion
        )

    const pendingInPeriod =
        assignedInPeriod.filter(
            item =>
                !hasEvidenceOrCompletion(
                    item
                )
        )

    const activeDepartments =
        departments.filter(
            department =>
                department.isActive
        )

    const interventionDepartments =
        departments.filter(
            department =>
                department
                    .interventionsDepartment ||
                department
                    .isActive
        )

    const acceptedApps =
        applications.filter(
            application =>
                [
                    'accepted',
                    'approved'
                ].includes(
                    appStatus(
                        application
                    )
                )
        )

    const submittedApps =
        applications.filter(
            application =>
                appStatus(
                    application
                ) !==
                'unknown'
        )

    const requiredTotal =
        applicationInterventionCount(
            applications,
            'required'
        )

    const completedTotal =
        completedInPeriod.length

    const assignedTotal =
        assignedInPeriod.length

    const completionRate =
        percent(
            completedTotal,
            assignedTotal
        )

    /*
     * ---------------------------------------------------------
     * DEPARTMENT LOOKUPS
     * ---------------------------------------------------------
     */

    const deptNameById =
        new Map(
            departments.map(
                department => [
                    department.id,
                    department.name
                ]
            )
        )

    const deptForAssigned =
        (
            item:
                AssignedInterventionDoc
        ) =>
            norm(
                item.departmentId
                    ? deptNameById.get(
                          item.departmentId
                      )
                    : ''
            ) ||
            norm(
                item.areaOfSupport
            ) ||
            'Unmapped'

    const completedByDept =
        countBy(
            completedInPeriod,
            deptForAssigned
        )

    const assignedByDept =
        countBy(
            assignedInPeriod,
            deptForAssigned
        )

    const pendingByDept =
        countBy(
            pendingInPeriod,
            deptForAssigned
        )

    const wardCounts =
        countBy(
            applications,
            application =>
                norm(
                    application.ward
                ) ||
                norm(
                    application.area
                ) ||
                'Unspecified'
        )

    const topCompletedDept =
        topEntries(
            completedByDept,
            1
        )[0]

    const topPendingDept =
        topEntries(
            pendingByDept,
            1
        )[0]

    /*
     * ---------------------------------------------------------
     * MILESTONES
     * ---------------------------------------------------------
     */

    const latestCompletions =
        completedInPeriod
            .slice()
            .sort(
                (
                    first,
                    second
                ) =>
                    (
                        asDate(
                            second.completedAt ||
                            second.updatedAt
                        )?.getTime() ||
                        0
                    ) -
                    (
                        asDate(
                            first.completedAt ||
                            first.updatedAt
                        )?.getTime() ||
                        0
                    )
            )
            .slice(
                0,
                8
            )

    const milestones =
        latestCompletions.map(
            item => ({
                activity:
                    norm(
                        item.interventionTitle
                    ) ||
                    'Completed intervention',

                date_display:
                    displayDate(
                        item.completedAt ||
                        item.updatedAt ||
                        item.createdAt
                    ),

                status:
                    statusLabel(
                        item.assignmentStatus ||
                        item.status ||
                        'completed'
                    ),

                comments:
                    `${
                        norm(
                            item.beneficiaryName
                        ) ||
                        'SMME'
                    } - ${deptForAssigned(
                        item
                    )}`
            })
        )

    /*
     * ---------------------------------------------------------
     * KPI ROWS
     * ---------------------------------------------------------
     */

    const kpiRows =
        topEntries(
            assignedByDept,
            8
        ).map(
            ([
                department,
                total
            ]) => {
                const completed =
                    completedByDept.get(
                        department
                    ) ||
                    0

                const variance =
                    Math.max(
                        0,
                        total -
                            completed
                    )

                return {
                    kpi:
                        `Output - ${department}`,

                    indicator:
                        'Assigned interventions completed',

                    target:
                        String(
                            total
                        ),

                    achieved:
                        String(
                            completed
                        ),

                    variance:
                        String(
                            variance
                        ),

                    comments:
                        `${percent(
                            completed,
                            total
                        )} completed for the selected period.`,

                    status:
                        variance ===
                        0
                            ? 'Complete'
                            : 'Ongoing'
                }
            }
        )

    const mappedAreas =
        topEntries(
            wardCounts,
            6
        )
            .map(
                ([
                    ward,
                    count
                ]) =>
                    `${ward} (${count})`
            )
            .join(
                ', '
            )

    const budget =
        Number(
            program?.budget ||
            0
        )

    /*
     * ---------------------------------------------------------
     * REPORT
     * ---------------------------------------------------------
     */

    return {
        /*
         * There is no program code.
         * The existing template field receives programId.
         */
        project_code:
            programId,

        /*
         * Program display name comes only
         * from programs/{programId}.name.
         */
        project_name:
            projectName,

        report_quarter:
            quarterLabel(
                start
            ),

        report_date_display:
            dayjs().format(
                'DD MMMM YYYY'
            ),

        reporting_period_label:
            formatPeriodLabel(
                start,
                end
            ),

        prepared_by:
            preparedBy ||
            'Lepharo / ROM Department',

        /*
         * -----------------------------------------------------
         * EXECUTIVE SUMMARY
         * -----------------------------------------------------
         */
        executive_summary_paragraphs:
            [
                {
                    paragraph:
                        `${projectName} recorded ${submittedApps.length} application records, ` +
                        `${acceptedApps.length} accepted SMMEs, and ${assignedTotal} assigned interventions ` +
                        `for ${formatPeriodLabel(start, end)}.`
                },

                {
                    paragraph:
                        `${completedTotal} interventions were completed or supported by MOV evidence ` +
                        `during the reporting period, representing ${completionRate} of period workload.`
                },

                {
                    paragraph:
                        `Implementation activity covered ${activeDepartments.length} active departments, with ${
                            topCompletedDept
                                ? `${topCompletedDept[0]} leading completed delivery at ${topCompletedDept[1]} interventions`
                                : 'departmental delivery still being captured'
                        }.`
                },

                {
                    paragraph:
                        pendingInPeriod.length
                            ? `${pendingInPeriod.length} interventions remain pending closure or evidence confirmation and should be prioritised in the next reporting cycle.`
                            : 'No pending evidence gaps were detected in the selected reporting period.'
                }
            ],

        /*
         * -----------------------------------------------------
         * MILESTONES
         * -----------------------------------------------------
         */
        milestones:
            ensureRows(
                milestones,
                {
                    activity:
                        'Implementation activity review',

                    date_display:
                        end.format(
                            'DD MMM YYYY'
                        ),

                    status:
                        'Ongoing',

                    comments:
                        'Milestone detail will update as completed interventions are captured.'
                }
            ),

        /*
         * -----------------------------------------------------
         * STAKEHOLDER ENGAGEMENT
         * -----------------------------------------------------
         */
        stakeholder_engagement:
            ensureRows(
                [
                    {
                        activity:
                            `${appsInPeriod.length} new applications or stakeholder records captured`,

                        date_display:
                            end.format(
                                'DD MMM YYYY'
                            ),

                        status:
                            appsInPeriod.length
                                ? 'Ongoing'
                                : 'No new records'
                    }
                ],
                {
                    activity:
                        TEMPLATE_EMPTY,

                    date_display:
                        DASH,

                    status:
                        DASH
                }
            ),

        /*
         * -----------------------------------------------------
         * PROJECT RESOURCING
         * -----------------------------------------------------
         */
        project_resourcing:
            [
                {
                    activity:
                        `${activeDepartments.length} active departments available for implementation`,

                    date_display:
                        end.format(
                            'DD MMM YYYY'
                        ),

                    status:
                        'Active'
                },

                {
                    activity:
                        `${users.length} system users available in the workspace`,

                    date_display:
                        end.format(
                            'DD MMM YYYY'
                        ),

                    status:
                        users.length
                            ? 'Active'
                            : 'To be verified'
                }
            ],

        /*
         * -----------------------------------------------------
         * MAPPING
         * -----------------------------------------------------
         */
        mapping_rows:
            [
                {
                    activity:
                        'Areas / wards represented in applications',

                    date_display:
                        end.format(
                            'DD MMM YYYY'
                        ),

                    areas_wards:
                        mappedAreas ||
                        'Unspecified',

                    team_resources:
                        String(
                            users.length ||
                            activeDepartments.length ||
                            0
                        ),

                    duration:
                        formatPeriodLabel(
                            start,
                            end
                        ),

                    status:
                        applications.length
                            ? 'Ongoing'
                            : 'To be updated'
                }
            ],

        mapping_activity_points:
            [
                {
                    point:
                        `${applications.length} cumulative application records are available for the selected programme.`
                },

                {
                    point:
                        `${requiredTotal} required intervention entries are captured across applications.`
                }
            ],

        /*
         * -----------------------------------------------------
         * ONBOARDING
         * -----------------------------------------------------
         */
        onboarding_progress_paragraphs:
            [
                {
                    paragraph:
                        `${acceptedApps.length} of ${applications.length} application records are accepted or approved. ` +
                        `${appsInPeriod.length} application records fall within the selected reporting period.`
                }
            ],

        /*
         * -----------------------------------------------------
         * KPI
         * -----------------------------------------------------
         */
        kpi_rows:
            ensureRows(
                kpiRows,
                {
                    kpi:
                        'Output - Programme delivery',

                    indicator:
                        'Assigned interventions completed',

                    target:
                        String(
                            assignedTotal
                        ),

                    achieved:
                        String(
                            completedTotal
                        ),

                    variance:
                        String(
                            Math.max(
                                0,
                                assignedTotal -
                                    completedTotal
                            )
                        ),

                    comments:
                        'KPI detail will update as interventions are assigned and completed.',

                    status:
                        'Ongoing'
                }
            ),

        /*
         * -----------------------------------------------------
         * PROGRESS
         * -----------------------------------------------------
         */
        progress_update_paragraphs:
            [
                {
                    paragraph:
                        `Programme implementation produced ${assignedTotal} assigned intervention records in the period, ` +
                        `with ${completedTotal} completed/evidenced and ${pendingInPeriod.length} still requiring closure.`
                }
            ],

        feature_update_title:
            topCompletedDept
                ? `${topCompletedDept[0]} Delivery Progress`
                : 'Programme Delivery Progress',

        feature_update_paragraphs:
            [
                {
                    paragraph:
                        topCompletedDept
                            ? `${topCompletedDept[0]} recorded the highest number of completed/evidenced interventions in the period.`
                            : 'Feature update detail will become available once department activity is captured.'
                }
            ],

        feature_focus_areas:
            ensureRows(
                topEntries(
                    completedByDept,
                    5
                ).map(
                    ([
                        department,
                        count
                    ]) => ({
                        point:
                            `${department}: ${count} completed/evidenced interventions`
                    })
                ),
                {
                    point:
                        'Focus areas will update from completed intervention data.'
                }
            ),

        /*
         * -----------------------------------------------------
         * PROBLEMS
         * -----------------------------------------------------
         */
        problems_encountered:
            ensureRows(
                pendingInPeriod.length
                    ? [
                          {
                              challenge:
                                  'Pending intervention evidence',

                              obstacle:
                                  topPendingDept
                                      ? `${topPendingDept[0]} has ${topPendingDept[1]} pending records`
                                      : 'Pending records require closure',

                              risk_level:
                                  pendingInPeriod.length >
                                  completedTotal
                                      ? 'High'
                                      : 'Medium',

                              reason:
                                  'MOV, completion, or SME confirmation still outstanding.'
                          }
                      ]
                    : [],
                {
                    challenge:
                        'No major system challenge captured',

                    obstacle:
                        'None recorded',

                    risk_level:
                        'Low',

                    reason:
                        'No pending evidence gap detected for the selected period.'
                }
            ),

        /*
         * -----------------------------------------------------
         * RISK
         * -----------------------------------------------------
         */
        risk_assessment:
            [
                {
                    risk:
                        'Evidence completion delay',

                    potential_impact:
                        pendingInPeriod.length >
                        completedTotal
                            ? 'High'
                            : 'Medium',

                    mitigation_strategy:
                        'Follow up with responsible departments and coordinators on pending MOV evidence.',

                    outcomes:
                        pendingInPeriod.length
                            ? `${pendingInPeriod.length} record(s) require follow-up.`
                            : 'Risk currently controlled.'
                }
            ],

        risk_narrative_paragraphs:
            [
                {
                    paragraph:
                        `Risk classification is based on pending intervention closure and MOV confirmation. ` +
                        `Current evidence completion is ${completionRate}.`
                }
            ],

        /*
         * -----------------------------------------------------
         * ISSUES
         * -----------------------------------------------------
         */
        issues_log:
            ensureRows(
                pendingInPeriod.length
                    ? [
                          {
                              issue:
                                  'Pending MOV / completion confirmation',

                              status_action:
                                  'Departments to close outstanding intervention records before the next reporting period.'
                          }
                      ]
                    : [],
                {
                    issue:
                        'No open issue captured',

                    status_action:
                        'Continue routine monitoring.'
                }
            ),

        /*
         * -----------------------------------------------------
         * BUDGET
         * -----------------------------------------------------
         */
        budget_lines:
            [
                {
                    line_item:
                        `${projectName} programme budget`,

                    budget_display:
                        currency(
                            budget
                        ),

                    expenditure_display:
                        'R0.00',

                    variance_display:
                        currency(
                            budget
                        ),

                    comment:
                        budget
                            ? 'Budget captured on programme record; expenditure integration pending.'
                            : 'No programme budget captured.'
                }
            ],

        total_budget_display:
            currency(
                budget
            ),

        total_expenditure_display:
            'R0.00',

        total_remaining_display:
            currency(
                budget
            ),

        budget_general_comment:
            budget
                ? 'Budget value is sourced from the programme record. Expenditure values require finance data integration.'
                : 'Budget and expenditure values require finance data capture.',

        budget_narrative_paragraphs:
            [
                {
                    paragraph:
                        'Budget utilisation should be reconciled with the finance/income statement before final submission.'
                }
            ],

        /*
         * -----------------------------------------------------
         * RESOURCES
         * -----------------------------------------------------
         */
        human_resources:
            [
                {
                    implementation:
                        `${interventionDepartments.length} implementation departments`,

                    administration:
                        `${users.length} system user profiles`,

                    professional:
                        'Coordinators / department assignees tracked through intervention records'
                }
            ],

        material_resources:
            [
                {
                    resource:
                        'System records and MOV evidence',

                    usage:
                        `${completedTotal} completed/evidenced intervention records available for reporting.`
                }
            ],

        /*
         * -----------------------------------------------------
         * NEXT PERIOD
         * -----------------------------------------------------
         */
        next_reporting_period_label:
            nextQuarterLabel(
                end
            ),

        upcoming_milestones:
            [
                {
                    milestone:
                        'Close pending intervention records and confirm supporting MOV evidence.'
                },

                {
                    milestone:
                        'Update budget and expenditure lines once finance data is available.'
                }
            ],

        planned_activities:
            [
                {
                    activity:
                        'Continue departmental implementation and completion tracking.'
                },

                {
                    activity:
                        'Review departments with outstanding evidence gaps.'
                }
            ],

        /*
         * -----------------------------------------------------
         * ANNEXURES
         * -----------------------------------------------------
         */
        annexures:
            [
                {
                    annexure:
                        'Annexure A - Intervention completion and MOV evidence records'
                },

                {
                    annexure:
                        'Annexure B - Departmental KPI summary'
                }
            ],

        /*
         * -----------------------------------------------------
         * PROJECT HEALTH
         * -----------------------------------------------------
         */
        project_health:
            [
                {
                    phase:
                        norm(
                            program?.phase
                        ) ||
                        'Implementation',

                    health_area:
                        'Programme delivery',

                    green_marker:
                        pendingInPeriod.length <=
                        completedTotal
                            ? 'X'
                            : '',

                    amber_marker:
                        pendingInPeriod.length >
                            completedTotal &&
                        completedTotal >
                            0
                            ? 'X'
                            : '',

                    red_marker:
                        completedTotal ===
                            0 &&
                        pendingInPeriod.length >
                            0
                            ? 'X'
                            : ''
                }
            ],

        /*
         * -----------------------------------------------------
         * RECOMMENDATION
         * -----------------------------------------------------
         */
        recommendation_paragraphs:
            [
                {
                    paragraph:
                        'Prioritise closure of pending intervention records, ensure MOV evidence is uploaded, and reconcile finance values before issuing the final executive submission.'
                }
            ],

        reporting_period_statement:
            `Quarterly report (${formatPeriodLabel(start, end)})`,

        /*
         * -----------------------------------------------------
         * CONCLUSION
         * -----------------------------------------------------
         */
        conclusion_paragraphs:
            [
                {
                    paragraph:
                        `${projectName} remains in active reporting with ${completedTotal} completed/evidenced interventions ` +
                        `and ${pendingInPeriod.length} outstanding closure item(s) for the selected period.`
                }
            ]
    }
}
