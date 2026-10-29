import { useEffect, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { useDepartmentRoles } from '@/services/departmentRoles'
import type { UpcomingExtraItem } from '@/components/modals/UpcomingAppointmentsCard'

const toDay = (value: any): Dayjs | null => {
    if (!value) return null
    const parsed = value?.toDate
        ? dayjs(value.toDate())
        : value?.seconds
            ? dayjs(value.seconds * 1000)
            : dayjs(value)
    return parsed.isValid() ? parsed : null
}

/** Date-only strings ("2026-10-14") carry no time of day. */
const isDateOnly = (value: any) =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())

const isClosedStatus = (value: any) => {
    const status = String(value || '').toLowerCase()
    return (
        status.includes('complete') ||
        status.includes('done') ||
        status.includes('cancel')
    )
}

/**
 * Deadlines, events and tasks for the next 7 days, shaped for the shared
 * UpcomingAppointmentsCard so they appear beside appointments.
 *
 * `interventions` are the dashboard's already-loaded, programme-scoped
 * assigned interventions; their due dates become deadlines.
 */
export const useUpcomingWeekExtras = (
    programId: string | null | undefined,
    interventions: any[] = []
) => {
    const { nameOf } = useDepartmentRoles()
    const [events, setEvents] = useState<UpcomingExtraItem[]>([])
    const [tasks, setTasks] = useState<UpcomingExtraItem[]>([])

    useEffect(() => {
        let cancelled = false

        const windowStart = dayjs().startOf('day')
        const windowEnd = windowStart.add(6, 'day').endOf('day')
        const inWindow = (d: Dayjs | null) =>
            !!d && !d.isBefore(windowStart) && !d.isAfter(windowEnd)

        const loadEvents = async (): Promise<UpcomingExtraItem[]> => {
            const snap = await getDocs(collection(db, 'events'))

            return snap.docs.flatMap((docSnap): UpcomingExtraItem[] => {
                const data = docSnap.data() as any

                // Events are not always programme-tagged; only drop ones that
                // are explicitly tagged to a different programme.
                if (
                    programId &&
                    data.programId &&
                    String(data.programId) !== String(programId)
                ) {
                    return []
                }

                const raw = data.start || data.startDate || data.date
                const start = toDay(raw)
                if (!start || !inWindow(start)) return []

                const dateOnly = isDateOnly(raw)
                const timed = data.startTime ? toDay(data.startTime) : null
                const withTime =
                    dateOnly && timed
                        ? start.hour(timed.hour()).minute(timed.minute())
                        : start

                return [
                    {
                        id: `event:${docSnap.id}`,
                        kind:
                            String(data.type || '').toLowerCase() === 'deadline'
                                ? 'deadline'
                                : 'event',
                        title: String(data.title || data.name || 'Untitled event'),
                        subtitle:
                            data.departmentName ||
                            data.department ||
                            data.location ||
                            undefined,
                        start: withTime,
                        allDay: dateOnly && !timed
                    }
                ]
            })
        }

        const loadTasks = async (): Promise<UpcomingExtraItem[]> => {
            if (!programId) return []

            const snap = await getDocs(
                query(collection(db, 'tasks'), where('programId', '==', programId))
            )

            return snap.docs.flatMap((docSnap): UpcomingExtraItem[] => {
                const data = docSnap.data() as any
                if (isClosedStatus(data.status)) return []

                const start = toDay(data.dueAt)
                if (!start || !inWindow(start)) return []

                return [
                    {
                        id: `task:${docSnap.id}`,
                        kind: 'task',
                        title: String(data.title || 'Task'),
                        subtitle: 'Task due',
                        start
                    }
                ]
            })
        }

        void Promise.allSettled([loadEvents(), loadTasks()]).then(
            ([eventRes, taskRes]) => {
                if (cancelled) return

                if (eventRes.status === 'rejected') {
                    console.error('[UpcomingWeekExtras] events failed', eventRes.reason)
                }
                if (taskRes.status === 'rejected') {
                    console.error('[UpcomingWeekExtras] tasks failed', taskRes.reason)
                }

                setEvents(eventRes.status === 'fulfilled' ? eventRes.value : [])
                setTasks(taskRes.status === 'fulfilled' ? taskRes.value : [])
            }
        )

        return () => {
            cancelled = true
        }
    }, [programId])

    const deadlines = useMemo<UpcomingExtraItem[]>(() => {
        const windowStart = dayjs().startOf('day')
        const windowEnd = windowStart.add(6, 'day').endOf('day')

        return interventions.flatMap((row): UpcomingExtraItem[] => {
            if (
                isClosedStatus(row.status) ||
                isClosedStatus(row.assigneeCompletionStatus)
            ) {
                return []
            }

            const start = toDay(row.dueDate)
            if (!start || start.isBefore(windowStart) || start.isAfter(windowEnd)) {
                return []
            }

            return [
                {
                    id: `due:${row.id}`,
                    kind: 'deadline',
                    title: String(row.interventionTitle || 'Intervention due'),
                    subtitle: row.beneficiaryName || (row.departmentId ? nameOf(row.departmentId) : undefined),
                    start,
                    allDay: true
                }
            ]
        })
    }, [interventions, nameOf])

    return useMemo(
        () => [...events, ...tasks, ...deadlines],
        [events, tasks, deadlines]
    )
}
