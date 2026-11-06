import dayjs from 'dayjs'
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where
} from 'firebase/firestore'
import { auth, db } from '@/firebase'
import { countLeaveDays, type Employee, type LeaveRequest, type LeaveType } from './types'

/** Firestore writes for leave decisions. Field names match the staff Leave page and the email trigger. */

const actorEmail = () => auth.currentUser?.email || 'system'
const today = () => dayjs().format('YYYY-MM-DD')

/**
 * Recomputes the "on leave" flags facilitators and operations staff carry
 * (used by assignment screens) from the person's approved leave.
 */
export async function refreshOnLeaveFlags(userId: string) {
    const snap = await getDocs(
        query(collection(db, 'leaveRequests'), where('employeeId', '==', userId), where('status', '==', 'approved'))
    )
    const now = dayjs()
    let onNow = false
    let next: { from: string; to: string } | null = null
    snap.forEach(d => {
        const r = d.data() as LeaveRequest
        if (!now.isBefore(dayjs(r.from), 'day') && !now.isAfter(dayjs(r.to), 'day')) onNow = true
        if (dayjs(r.from).isAfter(now, 'day') && (!next || dayjs(r.from).isBefore(dayjs(next.from)))) {
            next = { from: r.from, to: r.to }
        }
    })
    const upcoming = next as { from: string; to: string } | null
    const payload = {
        onLeave: onNow,
        onLeaveScheduled: onNow || !!upcoming,
        nextLeaveFrom: upcoming?.from || null,
        nextLeaveTo: upcoming?.to || null,
        onLeaveUpdatedAt: serverTimestamp()
    }
    await Promise.all(
        (['consultants', 'operationsStaff'] as const).map(async name => {
            const ref = doc(db, name, userId)
            if ((await getDoc(ref)).exists()) await setDoc(ref, payload, { merge: true })
        })
    )
}

// The flags are a convenience copy; a failure there shouldn't undo the decision.
const refreshQuietly = (userId: string) =>
    refreshOnLeaveFlags(userId).catch(error => console.warn('[leave] on-leave flags not refreshed', error))

export async function approveLeave(request: LeaveRequest) {
    await updateDoc(doc(db, 'leaveRequests', request.id), {
        status: 'approved',
        approvedBy: actorEmail(),
        approvedDate: today(),
        rejectionReason: null
    })
    await refreshQuietly(request.employeeId)
}

export async function rejectLeave(request: LeaveRequest, reason: string) {
    await updateDoc(doc(db, 'leaveRequests', request.id), {
        status: 'rejected',
        rejectionReason: reason,
        approvedBy: actorEmail(),
        approvedDate: today()
    })
    await refreshQuietly(request.employeeId)
}

export async function updateLeave(
    request: LeaveRequest,
    changes: { type: LeaveType; from: string; to: string; reason: string }
) {
    await updateDoc(doc(db, 'leaveRequests', request.id), {
        ...changes,
        days: countLeaveDays(changes.from, changes.to),
        updatedBy: actorEmail(),
        updatedAt: serverTimestamp()
    })
    if (request.status === 'approved') await refreshQuietly(request.employeeId)
}

/** Ends approved leave that is under way: today becomes its last day. */
export async function endLeaveToday(request: LeaveRequest) {
    await updateDoc(doc(db, 'leaveRequests', request.id), {
        to: today(),
        days: countLeaveDays(request.from, today()),
        updatedBy: actorEmail(),
        updatedAt: serverTimestamp()
    })
    await refreshQuietly(request.employeeId)
}

/** HR records leave directly for staff (already approved). */
export async function assignLeave(
    employees: Employee[],
    leave: { type: LeaveType; from: string; to: string; reason: string }
) {
    const by = actorEmail()
    await Promise.all(
        employees.map(async employee => {
            await addDoc(collection(db, 'leaveRequests'), {
                employeeId: employee.id,
                employeeEmail: employee.email || '',
                employeeName: employee.name || '',
                employeePhoto: employee.photoURL || '',
                ...leave,
                days: countLeaveDays(leave.from, leave.to),
                status: 'approved',
                appliedDate: today(),
                approvedBy: by,
                approvedDate: today(),
                putByEmail: by,
                createdAt: serverTimestamp()
            })
            await refreshQuietly(employee.id)
        })
    )
}
