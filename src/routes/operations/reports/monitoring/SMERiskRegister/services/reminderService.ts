import { auth } from '@/firebase'

import type { AnyDoc, DepartmentSummary, SMERow } from '../types'

const FUNCTIONS_BASE = 'https://us-central1-lph-smart-inc.cloudfunctions.net'

export async function callReminderFunction(path: string, payload: AnyDoc) {
    const currentUser = auth.currentUser
    if (!currentUser) throw new Error('You must be logged in to send reminders')
    const idToken = await currentUser.getIdToken()

    const res = await fetch(`${FUNCTIONS_BASE}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload)
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.ok === false) throw new Error(data?.error || `Failed calling ${path}`)
    return data
}

export function sendDepartmentReminders(params: {
    resolvedProgramId?: string
    scopedDepartmentId?: string
    scopedDepartmentName?: string
}) {
    return callReminderFunction('sendDevPlanReminders', {
        programId: params.resolvedProgramId || null,
        departmentId: params.scopedDepartmentId || null,
        departmentName: params.scopedDepartmentName || null
    })
}

export function sendSmmeReminder(row: SMERow, department: DepartmentSummary, resolvedProgramId?: string) {
    return callReminderFunction('remindSmmeDpConfirmation', {
        programId: row.programId || resolvedProgramId || null,
        participantId: row.participantId,
        reminderFromDeptId: department.departmentId,
        reminderFromDeptName: department.departmentName,
        submittedCount: row.deptConfirmedCount,
        totalCount: row.expectedDepartmentsCount
    })
}
