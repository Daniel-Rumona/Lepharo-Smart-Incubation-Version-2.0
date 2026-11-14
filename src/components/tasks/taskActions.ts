import { useCallback, useRef, useState } from 'react'
import { message } from 'antd'
import type { Dayjs } from 'dayjs'
import {
    addDoc,
    collection,
    doc,
    serverTimestamp,
    Timestamp,
    updateDoc,
    writeBatch
} from 'firebase/firestore'
import { db } from '@/firebase'
import { wasStarted, type Assignment, type Priority, type Status, type Task } from './taskTypes'

/**
 * Every Team Workroom write. Field names and status values match the
 * coordinator's page (CoordinatorTaskUpdate.tsx): status, completedAt,
 * assignees[].userId, archived.
 */

export type TaskInput = {
    title: string
    description: string
    programId: string
    departmentId: string
    priority: Priority
    status: Status
    startAt: Dayjs | null
    /** Date-only: stored as the end of the chosen day. */
    dueAt: Dayjs
    assignees: Assignment[]
    interventionId: string | null
    interventionTitle: string | null
}

/** completedAt follows the status: set on entering done, cleared on leaving it. */
const completionFields = (next: Status, previous?: Status) =>
    next === 'done' ? (previous === 'done' ? {} : { completedAt: serverTimestamp() }) : { completedAt: null }

const fields = (input: TaskInput) => ({
    title: input.title.trim(),
    description: input.description.trim(),
    programId: input.programId,
    departmentId: input.departmentId,
    priority: input.priority,
    status: input.status,
    startAt: input.startAt ? Timestamp.fromDate(input.startAt.startOf('day').toDate()) : null,
    dueAt: Timestamp.fromDate(input.dueAt.endOf('day').toDate()),
    assignees: input.assignees,
    interventionId: input.interventionId || null,
    interventionTitle: input.interventionId ? input.interventionTitle || null : null
})

export async function createTask(input: TaskInput, byUid: string) {
    await addDoc(collection(db, 'tasks'), {
        ...fields(input),
        ...completionFields(input.status),
        archived: false,
        createdBy: byUid || 'system',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    })
}

export async function updateTask(task: Task, input: TaskInput) {
    await updateDoc(doc(db, 'tasks', task.id), {
        ...fields(input),
        ...completionFields(input.status, task.status),
        updatedAt: serverTimestamp()
    })
}

export async function completeTask(task: Task) {
    await updateDoc(doc(db, 'tasks', task.id), {
        status: 'done',
        ...completionFields('done', task.status),
        updatedAt: serverTimestamp()
    })
}

/** Back to In progress when a coordinator had started on it, otherwise To do. */
export const reopenStatus = (task: Task): Status => (wasStarted(task) ? 'in_progress' : 'todo')

export async function reopenTask(task: Task) {
    await updateDoc(doc(db, 'tasks', task.id), {
        status: reopenStatus(task),
        completedAt: null,
        updatedAt: serverTimestamp()
    })
}

export async function cancelTask(task: Task) {
    await updateDoc(doc(db, 'tasks', task.id), {
        status: 'cancelled',
        completedAt: null,
        updatedAt: serverTimestamp()
    })
}

const BATCH_LIMIT = 450

async function batchUpdate(ids: string[], data: { [field: string]: any }) {
    for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db)
        ids.slice(i, i + BATCH_LIMIT).forEach(id => batch.update(doc(db, 'tasks', id), data))
        await batch.commit()
    }
}

export const archiveTasks = (ids: string[], byUid: string) =>
    batchUpdate(ids, {
        archived: true,
        archivedAt: serverTimestamp(),
        archivedBy: byUid || null,
        updatedAt: serverTimestamp()
    })

export const restoreTasks = (ids: string[]) =>
    batchUpdate(ids, { archived: false, archivedAt: null, archivedBy: null, updatedAt: serverTimestamp() })

export const friendlyWriteError = (error: any) =>
    error?.code === 'permission-denied'
        ? "You don't have permission to change this task."
        : error?.code === 'not-found'
            ? 'This task no longer exists.'
            : error?.code === 'unavailable'
                ? "You're offline. Reconnect and try again."
                : "That didn't save. Please try again."

/**
 * Runs one write at a time: a second click while one is in flight is ignored,
 * success shows a toast, and failure a clear error. Resolves true on success.
 */
export function useTaskRunner() {
    const [busy, setBusy] = useState<string | null>(null)
    const inFlight = useRef(false)

    const run = useCallback(async (key: string, action: () => Promise<void>, done: string) => {
        if (inFlight.current) return false
        inFlight.current = true
        setBusy(key)
        try {
            await action()
            message.success(done)
            return true
        } catch (error: any) {
            console.error(`[workroom] ${key} failed`, error)
            message.error(friendlyWriteError(error))
            return false
        } finally {
            inFlight.current = false
            setBusy(null)
        }
    }, [])

    return { busy, run }
}
