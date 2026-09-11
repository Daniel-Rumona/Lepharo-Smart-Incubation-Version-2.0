import { useEffect, useMemo, useState } from 'react'
import { App } from 'antd'
import { collection, getDocs, query, where } from 'firebase/firestore'

import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { canViewControlReportData } from '@/utils/reportVisibility'

import {
    buildRow,
    firstNonEmpty,
    getApplicationId,
    getBounceStatus as getBounceStatusFor,
    getCommunicationAttempts as getCommunicationAttemptsFor,
    getEmail,
    getInterventionParticipantId,
    getParticipantId,
    getReminderEmails as getReminderEmailsFor,
    getSMEChallenges as getSMEChallengesFor,
    isInternalQuantilytixEmail,
    normalizeDepartmentName,
    normalizeLower,
    normalizeText,
    toDate,
} from './riskEngine'
import type { AnyDoc, BounceStatus, OperationalChallenge, ReminderEmailLog, SMERow } from './types'

export function useSMERiskRegisterData(programIdProp?: string) {
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const { programId: activeProgramId, isAllPrograms } = useActiveProgramId()

    const resolvedProgramId =
        programIdProp !== undefined ? programIdProp : isAllPrograms ? undefined : activeProgramId

    const [loading, setLoading] = useState(true)
    const [participants, setParticipants] = useState<AnyDoc[]>([])
    const [applications, setApplications] = useState<AnyDoc[]>([])
    const [diagnosticPlans, setDiagnosticPlans] = useState<AnyDoc[]>([])
    const [assignments, setAssignments] = useState<AnyDoc[]>([])
    const [departments, setDepartments] = useState<AnyDoc[]>([])
    const [sessions, setSessions] = useState<AnyDoc[]>([])
    const [operationalChallenges, setOperationalChallenges] = useState<OperationalChallenge[]>([])
    const [reminderEmails, setReminderEmails] = useState<ReminderEmailLog[]>([])
    const [emailSuppressions, setEmailSuppressions] = useState<BounceStatus[]>([])

    const currentDepartment = useMemo(() => {
        if (!user?.departmentId) return undefined
        return departments.find((dep) => String(dep.id) === String(user.departmentId))
    }, [departments, user?.departmentId])

    // Monitoring departments own the consolidated risk view in the same way as
    // the main department. Other departments remain limited to their services.
    const canViewAllDepartments =
        currentDepartment?.isMain === true || currentDepartment?.isMonitoring === true
    const isDepartmentScopedView = !!user?.departmentId && !canViewAllDepartments
    const scopedDepartment = useMemo(() => {
        if (!isDepartmentScopedView || !user?.departmentId) return undefined

        const name = normalizeDepartmentName(
            firstNonEmpty(
                currentDepartment?.name,
                currentDepartment?.title,
                currentDepartment?.departmentName,
                currentDepartment?.displayName,
                user?.departmentName
            )
        )

        return {
            departmentId: String(user.departmentId),
            departmentName: name || String(user?.departmentName || 'My Department'),
        }
    }, [currentDepartment, isDepartmentScopedView, user?.departmentId, user?.departmentName])

    const departmentScopeLabel = scopedDepartment?.departmentName || 'My Department'
    const expectedDepartmentsLabel = isDepartmentScopedView
        ? 'Department Services'
        : 'DP Departments'
    const servicedDepartmentsLabel = isDepartmentScopedView
        ? 'Services Delivered'
        : 'Serviced Departments'
    const missingDepartmentsLabel = isDepartmentScopedView
        ? 'Needs My Follow-Up'
        : 'Departments Needing Follow-Up'

    useEffect(() => {
        setLoading(true)
        let cancelled = false

        const participantsRef = collection(db, 'participants')
        const participantsQuery = query(participantsRef)

        const applicationsRef = collection(db, 'applications')
        const applicationConstraints = [where('applicationStatus', '==', 'accepted')]
        if (resolvedProgramId)
            applicationConstraints.push(where('programId', '==', resolvedProgramId))
        const applicationsQuery = query(applicationsRef, ...applicationConstraints)

        const diagnosticPlansRef = collection(db, 'diagnosticPlans')
        const diagnosticPlansQuery = resolvedProgramId
            ? query(diagnosticPlansRef, where('programId', '==', resolvedProgramId))
            : query(diagnosticPlansRef)

        const assignmentsRef = collection(db, 'assignedInterventions')
        const assignmentConstraints = []
        if (resolvedProgramId)
            assignmentConstraints.push(where('programId', '==', resolvedProgramId))
        const assignmentsQuery = query(assignmentsRef, ...assignmentConstraints)

        const departmentsQuery = query(collection(db, 'departments'))

        const sessionsRef = collection(db, 'userSessions')

        const challengesRef = collection(db, 'operationalChallenges')

        // Keep in sync with the SME reminder types tagged in functions/src (emailDevPlan.ts,
        // workflowEmailFunctions.ts, emailCampaigns.ts, complianceExpiry.ts).
        const reminderEmailsQuery = query(
            collection(db, 'emailLogs'),
            where('type', 'in', [
                'DEV_PLAN_SME_REMINDER',
                'INTERVENTION_REMINDER',
                'COMPLIANCE_REMINDER',
                'COMPLIANCE_EXPIRY_REMINDER',
            ])
        )

        const emailSuppressionsRef = collection(db, 'emailSuppressions')

        const load = async () => {
            try {
                const [
                    participantsSnap,
                    applicationsSnap,
                    diagnosticPlansSnap,
                    assignmentsSnap,
                    departmentsSnap,
                    sessionsSnap,
                    challengesSnap,
                    reminderEmailsSnap,
                    emailSuppressionsSnap,
                ] = await Promise.all([
                    getDocs(participantsQuery),
                    getDocs(applicationsQuery),
                    getDocs(diagnosticPlansQuery),
                    getDocs(assignmentsQuery),
                    getDocs(departmentsQuery),
                    getDocs(sessionsRef),
                    getDocs(challengesRef),
                    getDocs(reminderEmailsQuery),
                    getDocs(emailSuppressionsRef),
                ])

                if (cancelled) return

                setParticipants(participantsSnap.docs.map((d) => ({ id: d.id, ...d.data() })))
                setApplications(applicationsSnap.docs.map((d) => ({ id: d.id, ...d.data() })))
                setDiagnosticPlans(diagnosticPlansSnap.docs.map((d) => ({ id: d.id, ...d.data() })))
                setAssignments(assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })))
                setDepartments(departmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })))
                setSessions(sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() })))
                setOperationalChallenges(
                    challengesSnap.docs.map(
                        (d) => ({ id: d.id, ...d.data() } as OperationalChallenge)
                    )
                )
                setReminderEmails(
                    reminderEmailsSnap.docs.map((d) => {
                        const data = d.data() as AnyDoc
                        return {
                            id: d.id,
                            ...data,
                            createdAt: toDate(data.createdAt),
                        } as ReminderEmailLog
                    })
                )
                setEmailSuppressions(
                    emailSuppressionsSnap.docs.map((d) => {
                        const data = d.data() as AnyDoc
                        return {
                            ...data,
                            updatedAt: toDate(data.updatedAt),
                        } as BounceStatus
                    })
                )
            } catch (error) {
                console.error('Failed to load SME risk register data', error)
                if (!cancelled) message.error('Failed to load SME risk register data')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        load()

        return () => {
            cancelled = true
        }
    }, [resolvedProgramId])

    const rows = useMemo<SMERow[]>(() => {
        const participantByParticipantId = new Map<string, AnyDoc>()
        const participantByApplicationId = new Map<string, AnyDoc>()
        const diagnosticPlanByParticipantId = new Map<string, AnyDoc>()
        const assignmentsByParticipant = new Map<string, AnyDoc[]>()

        const departmentsById: Record<string, AnyDoc> = {}
        const departmentsByName: Record<string, AnyDoc> = {}

        departments.forEach((dep) => {
            departmentsById[String(dep.id)] = dep
            const depName = normalizeDepartmentName(dep?.name)
            if (depName) departmentsByName[depName.toLowerCase()] = dep
        })

        participants.forEach((participant) => {
            const participantId = getParticipantId(participant)
            const applicationId = getApplicationId(participant)
            if (participantId) participantByParticipantId.set(participantId, participant)
            if (applicationId) participantByApplicationId.set(applicationId, participant)
        })

        diagnosticPlans.forEach((dp) => {
            const pid = normalizeText(dp?.participantId)
            if (pid) diagnosticPlanByParticipantId.set(pid, dp)
        })

        assignments.forEach((item) => {
            const pid = getInterventionParticipantId(item)
            if (!pid) return
            if (!assignmentsByParticipant.has(pid)) assignmentsByParticipant.set(pid, [])
            assignmentsByParticipant.get(pid)!.push(item)
        })

        const builtRows = applications
            .filter((app) => normalizeLower(app.applicationStatus) === 'accepted')
            .map((application) => {
                const participantId = getParticipantId(application)
                const linkedParticipant =
                    participantByParticipantId.get(participantId) ||
                    participantByApplicationId.get(getApplicationId(application) || '')

                const email = getEmail(application) ?? getEmail(linkedParticipant)
                if (isInternalQuantilytixEmail(email) && !canViewControlReportData(user?.email))
                    return null

                const dp = diagnosticPlanByParticipantId.get(participantId)
                const relatedAssignments = assignmentsByParticipant.get(participantId) ?? []

                return buildRow({
                    participant: linkedParticipant ?? {},
                    application,
                    diagnosticPlan: dp,
                    assignments: relatedAssignments,
                    sessions,
                    departmentsById,
                    departmentsByName,
                    scopedDepartment,
                })
            })
            .filter(Boolean) as SMERow[]

        return builtRows.filter((row) => !scopedDepartment || row.expectedDepartmentsCount > 0)
    }, [
        participants,
        applications,
        diagnosticPlans,
        assignments,
        departments,
        sessions,
        scopedDepartment,
    ])

    const getSMEChallenges = (participantId: string) =>
        getSMEChallengesFor(operationalChallenges, participantId, resolvedProgramId)

    const getCommunicationAttempts = (participantId: string) =>
        getCommunicationAttemptsFor(operationalChallenges, participantId, resolvedProgramId)

    const getReminderEmails = (participantId: string) =>
        getReminderEmailsFor(reminderEmails, participantId)

    const getBounceStatus = (participantId: string) =>
        getBounceStatusFor(emailSuppressions, participantId)

    return {
        loading,
        rows,
        departments,
        operationalChallenges,
        resolvedProgramId,
        isDepartmentScopedView,
        scopedDepartment,
        departmentScopeLabel,
        expectedDepartmentsLabel,
        servicedDepartmentsLabel,
        missingDepartmentsLabel,
        getSMEChallenges,
        getCommunicationAttempts,
        getReminderEmails,
        getBounceStatus,
    }
}
