import React, { useEffect, useMemo, useState } from 'react'
import {
    Empty,
    Modal,
    Segmented,
    Space,
    Tag,
    Typography,
    message,
    Descriptions,
    Button,
    Avatar,
    Divider,
    Row,
    Col,
    Select,
    Tabs
} from 'antd'
import {
    CalendarOutlined,
    LinkOutlined,
    EnvironmentOutlined,
    ClockCircleOutlined,
    UserOutlined,
    VideoCameraOutlined,
    TeamOutlined,
    AppstoreOutlined,
    BarsOutlined,
    CheckSquareOutlined,
    FilterOutlined,
    ApartmentOutlined,
    PhoneOutlined,
    NotificationOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventClickArg, EventInput, EventContentArg } from '@fullcalendar/core'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import dayjs from 'dayjs'
import '@/styles/calender.css'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import AppointmentDetailsModal, {
    type AppointmentDetailsV2Record
} from '@/components/modals/AppointmentDetails'
import {
    appointmentBelongsToAssignee,
    normalizeAppointmentRecord,
    resolveAppointmentActor
} from '@/services/appointmentService'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'
import NoticeBoard from './NoticeBoard'

const { Title, Text } = Typography

type CalendarSource = 'event' | 'appointment' | 'task'
type ViewMode = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth'
type WorkspaceView = 'calendar' | 'notices'

type CalendarRow = {
    id: string
    title: string
    start: Date
    end?: Date
    allDay?: boolean
    source: CalendarSource
    backgroundColor: string
    borderColor: string
    textColor: string
    raw: any
}

type GroupedAppointmentRaw = {
    isGroupAppointment: true
    groupKey: string
    groupTitle?: string
    groupParticipantCount?: number
    groupMembers: any[]
    [key: string]: any
}

const normalizeGroupedAppointment = (sessionId: string, docs: Array<{ id: string; data: any }>): CalendarRow | null => {
    if (!docs.length) return null

    const first = docs[0].data
    const start =
        combineDateTime(first.date, first.startTime) ||
        toDate(first.startTime) ||
        toDate(first.start)

    const end =
        combineDateTime(first.date, first.endTime) ||
        toDate(first.endTime) ||
        toDate(first.end)

    if (!start) return null

    const isVirtual = lower(first.deliveryMethod) === 'virtual'
    const memberNames = docs
        .map(x => x.data?.participantName)
        .filter(Boolean)

    const raw: GroupedAppointmentRaw = {
        ...first,
        isGroupAppointment: true,
        groupKey: String(first.groupKey || '').trim(),
        appointmentSessionId: sessionId,
        groupMembers: docs.map(x => ({
            id: x.id,
            ...x.data
        })),
        groupParticipantCount:
            Number(first.groupParticipantCount) || docs.length
    }

    return {
        // A group key can cover a series of sessions. Calendar entries must
        // represent the one scheduled session, not merge different dates in
        // that series.
        id: `session:${sessionId}`,
        title: String(first.groupTitle || first.interventionTitle || 'Group Appointment'),
        start,
        end: end || undefined,
        allDay: false,
        source: 'appointment',
        backgroundColor: isVirtual ? '#dbeafe' : '#ecfeff',
        borderColor: isVirtual ? '#93c5fd' : '#67e8f9',
        textColor: '#0f172a',
        raw: {
            ...raw,
            participantName: `${raw.groupParticipantCount} participants`,
            participantNamesPreview: memberNames.slice(0, 5)
        }
    }
}

const lower = (v: any) => String(v || '').trim().toLowerCase()
const isInternalDummyEmail = (value: any) => lower(value).endsWith('@quantilytix.co.za')

const getFoodMenuItems = (appt: any) => {
    if (!Array.isArray(appt?.foodMenu)) return []
    return appt.foodMenu.filter((item: any) => item && item.id && (item.name || item.label))
}

const getFoodSelections = (appt: any) => {
    const ownSelections = Array.isArray(appt?.foodSelections) ? appt.foodSelections : []
    const memberSelections = Array.isArray(appt?.groupMembers)
        ? appt.groupMembers.flatMap((member: any) =>
            Array.isArray(member?.foodSelections) ? member.foodSelections : []
        )
        : []

    return [...ownSelections, ...memberSelections]
}

const formatFoodCategory = (value: any) => {
    const category = String(value || '').trim()
    return category ? category.charAt(0).toUpperCase() + category.slice(1) : 'Meal'
}

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (value instanceof Date) return value
    if (typeof value?.toDate === 'function') return value.toDate()
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

const combineDateTime = (dateStr?: string, timeValue?: any): Date | null => {
    if (!dateStr) return null

    const timeDate = toDate(timeValue)
    if (!timeDate) {
        const fallback = new Date(`${dateStr}T00:00:00`)
        return Number.isNaN(fallback.getTime()) ? null : fallback
    }

    const hh = String(timeDate.getHours()).padStart(2, '0')
    const mm = String(timeDate.getMinutes()).padStart(2, '0')
    const combined = new Date(`${dateStr}T${hh}:${mm}:00`)
    return Number.isNaN(combined.getTime()) ? null : combined
}

const matchesProgram = (rowProgramId: any, activeProgramId?: string, isAllPrograms?: boolean) => {
    if (isAllPrograms) return true
    if (!activeProgramId) return true
    return String(rowProgramId || '').trim() === String(activeProgramId).trim()
}

const normalizeEvent = (id: string, data: any): CalendarRow | null => {
    const start =
        toDate(data.start) ||
        toDate(data.startDate) ||
        combineDateTime(data.date, data.startTime)

    const end =
        toDate(data.end) ||
        toDate(data.endDate) ||
        combineDateTime(data.date, data.endTime)

    if (!start) return null

    return {
        id,
        title: String(data.title || data.name || 'Untitled Event'),
        start,
        end: end || undefined,
        allDay: Boolean(data.allDay),
        source: 'event',
        backgroundColor: '#f3e8ff',
        borderColor: '#d8b4fe',
        textColor: '#581c87',
        raw: data
    }
}

const normalizeAppointment = (id: string, data: any): CalendarRow | null => {
    const start =
        combineDateTime(data.date, data.startTime) ||
        toDate(data.startTime) ||
        toDate(data.start)

    const end =
        combineDateTime(data.date, data.endTime) ||
        toDate(data.endTime) ||
        toDate(data.end)

    if (!start) return null

    const isVirtual = lower(data.deliveryMethod) === 'virtual'

    return {
        id,
        title: String(data.interventionTitle || data.title || 'Appointment'),
        start,
        end: end || undefined,
        allDay: false,
        source: 'appointment',
        backgroundColor: isVirtual ? '#dbeafe' : '#ecfeff',
        borderColor: isVirtual ? '#93c5fd' : '#67e8f9',
        textColor: '#0f172a',
        raw: data
    }
}

const normalizeTask = (id: string, data: any): CalendarRow | null => {
    const start = toDate(data.dueAt) || toDate(data.startAt) || toDate(data.createdAt)
    if (!start) return null

    return {
        id,
        title: String(data.title || 'Task'),
        start,
        end: undefined,
        allDay: false,
        source: 'task',
        backgroundColor: '#fff7e6',
        borderColor: '#ffd591',
        textColor: '#613400',
        raw: data
    }
}

const MyCalendarPage: React.FC = () => {
    const { user } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    const [loading, setLoading] = useState(true)
    const [eventRows, setEventRows] = useState<CalendarRow[]>([])
    const [appointmentRows, setAppointmentRows] = useState<CalendarRow[]>([])
    const [taskRows, setTaskRows] = useState<CalendarRow[]>([])
    const [viewMode, setViewMode] = useState<ViewMode>(() =>
        typeof window !== 'undefined' && window.innerWidth < 768
            ? 'dayGridMonth'
            : 'timeGridWeek'
    )
    const [isMobile, setIsMobile] = useState(
        () => typeof window !== 'undefined' && window.innerWidth < 768
    )
    const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('calendar')
    const [selectedItem, setSelectedItem] = useState<CalendarRow | null>(null)
    const [consultantDocId, setConsultantDocId] = useState<string | null>(null)
    const [appointmentAssigneeIds, setAppointmentAssigneeIds] = useState<string[]>([])
    const [participantIdentityIds, setParticipantIdentityIds] = useState<string[]>([])

    const [typeFilter, setTypeFilter] = useState<'all' | 'event' | 'appointment' | 'task'>('all')
    const [departmentFilter, setDepartmentFilter] = useState<string>('all')
    const [departmentOptions, setDepartmentOptions] = useState<
        Array<{ value: string; label: string; searchLabel?: string }>
    >([])
    const [deliveryFilter, setDeliveryFilter] = useState<'all' | 'virtual' | 'in_person' | 'telephonically'>('all')

    useEffect(() => {
        if (typeof window === 'undefined') return
        const mediaQuery = window.matchMedia('(max-width: 767px)')
        const updateMobileState = (event?: MediaQueryListEvent) => {
            setIsMobile(event ? event.matches : mediaQuery.matches)
        }
        updateMobileState()
        mediaQuery.addEventListener('change', updateMobileState)
        return () => mediaQuery.removeEventListener('change', updateMobileState)
    }, [])

    const myRole = lower(user?.role)
    const myUid = String(user?.uid || user?.id || '').trim()
    const myEmail = lower(user?.email)
    const myDepartmentId = String(user?.departmentId || '').trim()
    const myBranchId = String((user as any)?.assignedBranch || (user as any)?.branchId || '').trim()

    const myConsultantId = String(
        (user as any)?.consultantDocId ||
        (user as any)?.consultantId ||
        (user as any)?.profileId ||
        ''
    ).trim()

    const [isMainDepartment, setIsMainDepartment] = useState(false)
    const consultantFilterId = consultantDocId || myConsultantId

    const selectedAppointment = useMemo<AppointmentDetailsV2Record | null>(() => {
        if (selectedItem?.source !== 'appointment') return null

        return {
            ...selectedItem.raw,
            id: selectedItem.id,
            start: selectedItem.start,
            end: selectedItem.end
        }
    }, [selectedItem])

    const isCentreCoordinator =
        myRole === 'projectadmin' ||
        myRole === 'project admin'
    const isReceptionist = myRole === 'receptionist'

    const isProjectCoordinator =
        myRole === 'projectmanager' ||
        myRole === 'project manager' ||
        myRole === 'coordinator'

    const isOperations = myRole === 'operations'
    const isConsultant = myRole === 'consultant'
    const isIncubatee = myRole === 'incubatee'

    const canFilterByDepartment = isCentreCoordinator || (isOperations && isMainDepartment)

    useEffect(() => {
        const baseIds = [
            myUid,
            String((user as any)?.participantId || '').trim(),
            String((user as any)?.participantDocId || '').trim(),
            String((user as any)?.profileId || '').trim(),
            String((user as any)?.applicationId || '').trim()
        ].filter(Boolean)

        if (!isIncubatee || !myEmail) {
            setParticipantIdentityIds(Array.from(new Set(baseIds)))
            return
        }

        let cancelled = false
        const run = async () => {
            try {
                const emailCandidates = Array.from(
                    new Set([String(user?.email || '').trim(), myEmail].filter(Boolean))
                )
                const snapshots = await Promise.all(
                    emailCandidates.flatMap(email => [
                        getDocs(query(collection(db, 'participants'), where('email', '==', email))),
                        getDocs(query(collection(db, 'applications'), where('email', '==', email)))
                    ])
                )
                const resolvedIds = [...baseIds]
                snapshots.forEach(snapshot => {
                    snapshot.docs.forEach(item => {
                        const data = item.data() as any
                        resolvedIds.push(
                            item.id,
                            String(data?.participantId || '').trim(),
                            String(data?.userId || '').trim(),
                            String(data?.uid || '').trim(),
                            String(data?.applicationId || '').trim()
                        )
                    })
                })
                if (!cancelled) {
                    setParticipantIdentityIds(Array.from(new Set(resolvedIds.filter(Boolean))))
                }
            } catch (error) {
                console.error('Failed to resolve incubatee calendar identity:', error)
                if (!cancelled) setParticipantIdentityIds(Array.from(new Set(baseIds)))
            }
        }
        run()
        return () => {
            cancelled = true
        }
    }, [isIncubatee, myEmail, myUid, user])


    useEffect(() => {
        let cancelled = false

        const run = async () => {
            if (!canFilterByDepartment) {
                setDepartmentOptions([])
                setDepartmentFilter('all')
                return
            }

            try {
                const constraints: any[] = []
                const snap = await getDocs(query(collection(db, 'departments'), ...constraints))

                const options = snap.docs
                    .map((docSnap) => {
                        const data = docSnap.data() as any
                        const labelText = String(data?.name || data?.departmentName || docSnap.id)

                        return {
                            value: docSnap.id,
                            searchLabel: labelText.toLowerCase(),
                            label: labelText
                        }
                    })
                    .sort((a, b) => a.searchLabel.localeCompare(b.searchLabel))

                if (!cancelled) {
                    setDepartmentOptions([
                        {
                            value: 'all',
                            searchLabel: 'all departments',
                            label: 'All departments'
                        },
                        ...options
                    ])
                }
            } catch (error) {
                console.error('Failed to load departments for filter:', error)
                if (!cancelled) {
                    setDepartmentOptions([
                        {
                            value: 'all',
                            searchLabel: 'all departments',
                            label: 'All departments'
                        }
                    ])
                }
            }
        }

        run()

        return () => {
            cancelled = true
        }
    }, [canFilterByDepartment])
    useEffect(() => {
        let cancelled = false

        if (!myEmail) {
            setConsultantDocId(null)
            setAppointmentAssigneeIds(myUid ? [myUid] : [])
            return
        }

        const run = async () => {
            try {

                const actor = await resolveAppointmentActor(user || {})
                const resolvedId = actor.preferredId || null

                if (!cancelled) {
                    setConsultantDocId(prev => (prev === resolvedId ? prev : resolvedId))
                    setAppointmentAssigneeIds(actor.ids)
                }
            } catch (error) {
                console.error('Failed to resolve consultant doc ID:', error)
                if (!cancelled) {
                    setConsultantDocId(prev => (prev === null ? prev : null))
                    setAppointmentAssigneeIds(myUid ? [myUid] : [])
                }
            }
        }

        run()

        return () => {
            cancelled = true
        }
    }, [myEmail, myConsultantId, myUid, user])

    useEffect(() => {
        let cancelled = false

        const run = async () => {
            if (myRole !== 'operations' || !user?.departmentId) {
                setIsMainDepartment(false)
                return
            }

            try {
                const deptSnap = await getDoc(doc(db, 'departments', String(user.departmentId)))
                const deptData = deptSnap.exists() ? deptSnap.data() : null
                const nextIsMain = Boolean(deptData?.isMain)

                if (!cancelled) {
                    setIsMainDepartment(prev => (prev === nextIsMain ? prev : nextIsMain))
                }
            } catch (error) {
                console.error('Failed to resolve operations department isMain:', error)
                if (!cancelled) {
                    setIsMainDepartment(false)
                }
            }
        }

        run()

        return () => {
            cancelled = true
        }
    }, [myRole, user?.departmentId])

    useEffect(() => {
        if (!myUid || !myRole) {
            setEventRows([])
            setAppointmentRows([])
            setTaskRows([])
            setLoading(false)
            return
        }

        setLoading(true)

        const unsubscribers: Array<() => void> = []
        let doneCount = 0
        const finish = () => {
            doneCount += 1
            if (doneCount >= 3) setLoading(false)
        }

        const baseConstraints: any[] = []
        const participantIds = new Set(participantIdentityIds)
        const matchesMyBranch = (data: any) => {
            const rowBranchId = String(data?.branchId || data?.assignedBranch || '').trim()
            return !myBranchId || !rowBranchId || rowBranchId === myBranchId
        }

        const matchesProgram = (rowProgramId: any) => {
            if (isAllPrograms) return true
            if (!activeProgramId) return true
            return String(rowProgramId || '').trim() === String(activeProgramId).trim()
        }

        unsubscribers.push(
            onSnapshot(
                query(collection(db, 'events'), ...baseConstraints),
                (snap) => {
                    const rows: CalendarRow[] = []

                    snap.forEach((docSnap) => {
                        const data = docSnap.data()
                        if (!matchesProgram(data?.programId)) return

                        let allow = false

                        if (isCentreCoordinator) {
                            allow = true
                        } else if (isReceptionist) {
                            allow = matchesMyBranch(data)
                        } else if (isOperations) {
                            allow = isMainDepartment
                        } else if (isProjectCoordinator) {
                            allow = true
                        } else if (isConsultant) {
                            allow =
                                String(data?.consultantId || '').trim() === consultantFilterId ||
                                lower(data?.consultantEmail) === myEmail
                        } else if (isIncubatee) {
                            const participants = Array.isArray(data?.participants) ? data.participants : []
                            const participantMatch = participants.some((p: any) => {
                                const pid = String(p?.id || p?.participantId || '').trim()
                                const pemail = lower(p?.email)
                                return participantIds.has(pid) || (!!pemail && pemail === myEmail)
                            })
                            const participantIdsOnEvent = Array.isArray(data?.participantIds)
                                ? data.participantIds.map((value: any) => String(value || '').trim())
                                : []
                            const participantEmailsOnEvent = Array.isArray(data?.participantEmails)
                                ? data.participantEmails.map((value: any) => lower(value))
                                : []
                            allow =
                                participantMatch ||
                                participantIdsOnEvent.some((id: string) => participantIds.has(id)) ||
                                participantEmailsOnEvent.includes(myEmail)
                        }

                        if (!allow) return

                        const normalized = normalizeEvent(docSnap.id, data)
                        if (normalized) rows.push(normalized)
                    })

                    setEventRows(rows)
                    finish()
                },
                (error) => {
                    console.error('events snapshot error:', error)
                    message.error('Failed to load events.')
                    setEventRows([])
                    finish()
                }
            )
        )

        unsubscribers.push(
            onSnapshot(
                // Calendar appointments are the v5 invitation/session model.
                // Querying only these records prevents retained legacy
                // appointments without a session link from poisoning the
                // session hydration used to derive today's date and time.
                query(collection(db, 'appointments'), where('schemaVersion', '==', 5)),
                async (snap) => {
                    const individualRows: CalendarRow[] = []
                    const groupedBuckets = new Map<string, Array<{ id: string; data: any }>>()

                    let canonicalViews: Record<string, any>[]
                    try {
                        canonicalViews = await hydrateAppointmentViews(
                            snap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() as any }))
                        )
                    } catch (error) {
                        console.error('Failed to hydrate calendar appointment sessions:', error)
                        message.error('Failed to load appointments.')
                        setAppointmentRows([])
                        finish()
                        return
                    }
                    canonicalViews.forEach(view => {
                        const data = normalizeAppointmentRecord(view.id, view)
                        const docId = view.id
                        const participantEmail = data?.participantEmail || data?.smeEmail

                        // Internal dummy SMEs are useful for workflow testing,
                        // but must not appear in the operational calendar.
                        if (isInternalDummyEmail(participantEmail)) return

                        const programMatch = matchesProgram(data?.programId)

                        let allow = false

                        const appointmentParticipantId = String(data?.participantId || '').trim()
                        const appointmentParticipantEmail = lower(
                            data?.participantEmail ||
                            data?.beneficiaryEmail ||
                            data?.snapshot?.participantEmail ||
                            data?.snapshot?.beneficiaryEmail
                        )
                        const belongsToCurrentAssignee = appointmentBelongsToAssignee(data, {
                            ids: appointmentAssigneeIds,
                            email: myEmail
                        })

                        if (!programMatch) return

                        if (isCentreCoordinator) {
                            allow = true
                        } else if (isReceptionist) {
                            allow = matchesMyBranch(data)
                        } else if (isOperations) {
                            allow = isMainDepartment
                        } else if (isProjectCoordinator) {
                            allow = belongsToCurrentAssignee
                        } else if (isConsultant) {
                            allow = belongsToCurrentAssignee
                        } else if (isIncubatee) {
                            allow =
                                participantIds.has(appointmentParticipantId) ||
                                (!!appointmentParticipantEmail && appointmentParticipantEmail === myEmail)
                        }



                        if (!allow) return

                        const isGroup =
                            Boolean(data?.isGroupAppointment) &&
                            String(data?.groupKey || '').trim().length > 0

                        if (isGroup) {
                            const key = String(data.appointmentSessionId || '').trim()
                            if (!key) return
                            const existing = groupedBuckets.get(key) || []
                            existing.push({ id: docId, data })
                            groupedBuckets.set(key, existing)
                            return
                        }

                        const normalized = normalizeAppointment(docId, data)
                        if (normalized) {
                            individualRows.push(normalized)
                        } else {

                        }
                    })

                    const groupedRows: CalendarRow[] = Array.from(groupedBuckets.entries())
                        .map(([sessionId, docs]) => {
                            const grouped = normalizeGroupedAppointment(sessionId, docs)

                            return grouped
                        })
                        .filter(Boolean) as CalendarRow[]

                    const nextRows = [...individualRows, ...groupedRows]

                    setAppointmentRows(nextRows)
                    finish()
                },
                (error) => {
                    console.error('appointments snapshot error:', error)
                    message.error('Failed to load appointments.')
                    setAppointmentRows([])
                    finish()
                }
            )
        )

        unsubscribers.push(
            onSnapshot(
                query(collection(db, 'tasks'), ...baseConstraints),
                (snap) => {
                    const rows: CalendarRow[] = []

                    snap.forEach((docSnap) => {
                        const data = docSnap.data()
                        if (!matchesProgram(data?.programId)) return

                        const assignees = Array.isArray(data?.assignees) ? data.assignees : []
                        const assignedToMe = assignees.some((a: any) => {
                            const uid = String(a?.userId || '').trim()
                            const deptId = String(a?.departmentId || '').trim()
                            return uid === myUid || (deptId && deptId === String(user?.departmentId || '').trim())
                        })

                        let allow = false

                        if (isCentreCoordinator) {
                            allow = assignedToMe
                        } else if (isReceptionist) {
                            allow = assignedToMe && matchesMyBranch(data)
                        } else if (isOperations) {
                            allow = isMainDepartment || assignedToMe
                        } else if (isProjectCoordinator || isConsultant) {
                            allow = assignedToMe
                        }

                        if (!allow) return

                        const normalized = normalizeTask(docSnap.id, data)
                        if (normalized) rows.push(normalized)
                    })

                    setTaskRows(rows)
                    finish()
                },
                (error) => {
                    console.error('tasks snapshot error:', error)
                    message.error('Failed to load tasks.')
                    setTaskRows([])
                    finish()
                }
            )
        )

        return () => {
            unsubscribers.forEach((u) => u?.())
        }
    }, [
        myUid,
        myRole,
        myEmail,
        user?.departmentId,
        consultantDocId,
        appointmentAssigneeIds,
        participantIdentityIds,
        myConsultantId,
        myBranchId,
        activeProgramId,
        isAllPrograms,
        isMainDepartment
    ])

    const getRowDepartmentId = (row: CalendarRow): string => {
        return String(
            row.raw?.departmentId ||
            row.raw?.department?.id ||
            ''
        ).trim()
    }

    const mergedRows = useMemo(() => {
        return [...eventRows, ...appointmentRows, ...taskRows].sort(
            (a, b) => a.start.getTime() - b.start.getTime()
        )
    }, [eventRows, appointmentRows, taskRows])

    const programFilteredRows = useMemo(() => {
        return mergedRows.filter((row) =>
            matchesProgram(row.raw?.programId, activeProgramId, isAllPrograms)
        )
    }, [mergedRows, activeProgramId, isAllPrograms])

    const visibleRows = useMemo(() => {
        return programFilteredRows.filter((row) => {
            const typeMatch = typeFilter === 'all' || row.source === typeFilter

            const departmentMatch =
                !canFilterByDepartment ||
                departmentFilter === 'all' ||
                getRowDepartmentId(row) === departmentFilter

            const deliveryMethod = lower(row.raw?.deliveryMethod)
            const deliveryMatch =
                deliveryFilter === 'all' ||
                row.source !== 'appointment' ||
                deliveryMethod === lower(deliveryFilter)

            return typeMatch && departmentMatch && deliveryMatch
        })
    }, [
        programFilteredRows,
        typeFilter,
        departmentFilter,
        deliveryFilter,
        canFilterByDepartment
    ])

    const calendarEvents = useMemo<EventInput[]>(() => {
        return visibleRows.map((item) => ({
            id: item.id,
            title: item.title,
            start: item.start,
            end: item.end,
            allDay: item.allDay,
            backgroundColor: item.backgroundColor,
            borderColor: item.borderColor,
            textColor: item.textColor,
            classNames: [`fc-item-${item.source}`],
            extendedProps: {
                source: item.source,
                raw: item.raw
            }
        }))
    }, [visibleRows])

    const handleEventClick = (arg: EventClickArg) => {
        const match = visibleRows.find((x) => x.id === arg.event.id)
        if (match) setSelectedItem(match)
    }

    const renderEventContent = (eventInfo: EventContentArg) => {
        const source = eventInfo.event.extendedProps?.source as CalendarSource
        const raw = eventInfo.event.extendedProps?.raw || {}
        const durationMs =
            eventInfo.event.start && eventInfo.event.end
                ? eventInfo.event.end.getTime() - eventInfo.event.start.getTime()
                : 0
        // Short, consecutive appointments do not have enough vertical space
        // for the regular three-line event card.
        const isCompactTimedEvent =
            !eventInfo.event.allDay &&
            durationMs > 0 &&
            durationMs <= 30 * 60 * 1000
        // Do not use FullCalendar's locale-dependent time text for timed
        // events. In a 12-hour locale it can render 15:00 as “03:00” when
        // the meridiem is hidden, which is misleading for appointments.
        const timeText = eventInfo.event.allDay
            ? eventInfo.timeText
            : formatTimeRange(eventInfo.event.start || undefined, eventInfo.event.end || undefined)

        let badge = 'Event'
        let subtitle = raw?.location || raw?.type || ''

        if (source === 'appointment') {
            badge = raw?.isGroupAppointment ? 'Group' : lower(raw?.deliveryMethod) === 'virtual' ? 'Virtual' : 'Appointment'
            subtitle = raw?.isGroupAppointment
                ? `${raw?.groupParticipantCount || raw?.groupMembers?.length || 0} participants`
                : raw?.participantName || raw?.consultantName || raw?.location || ''
        }

        if (source === 'task') {
            badge = 'Task'
            subtitle = raw?.priority || raw?.status || ''
        }

        return (
            <div className={`smart-event-card ${source}${isCompactTimedEvent ? ' smart-event-card--compact' : ''}`}>
                <div className="smart-event-card__top">
                    <span className={`smart-event-card__badge ${source}`}>{badge}</span>
                    <span className="smart-event-card__time">{timeText}</span>
                </div>
                <div className="smart-event-card__title">{eventInfo.event.title}</div>
                {subtitle ? <div className="smart-event-card__subtitle">{subtitle}</div> : null}
            </div>
        )
    }

    const typeFilterOptions = [
        {
            value: 'all',
            label: (
                <Space size={8}>
                    <FilterOutlined />
                    <span>All types</span>
                </Space>
            )
        },
        {
            value: 'event',
            label: (
                <Space size={8}>
                    <CalendarOutlined />
                    <span>Events</span>
                </Space>
            )
        },
        {
            value: 'appointment',
            label: (
                <Space size={8}>
                    <ClockCircleOutlined />
                    <span>Appointments</span>
                </Space>
            )
        },
        {
            value: 'task',
            label: (
                <Space size={8}>
                    <CheckSquareOutlined />
                    <span>Tasks</span>
                </Space>
            )
        }
    ].filter(option => !isIncubatee || option.value !== 'task')

    const deliveryFilterOptions = [
        {
            value: 'all',
            label: (
                <Space size={8}>
                    <FilterOutlined />
                    <span>All delivery</span>
                </Space>
            )
        },
        {
            value: 'virtual',
            label: (
                <Space size={8}>
                    <VideoCameraOutlined />
                    <span>Online</span>
                </Space>
            )
        },
        {
            value: 'in_person',
            label: (
                <Space size={8}>
                    <EnvironmentOutlined />
                    <span>In person</span>
                </Space>
            )
        },
        {
            value: 'telephonically',
            label: (
                <Space size={8}>
                    <PhoneOutlined />
                    <span>Telephonic</span>
                </Space>
            )
        }
    ]

    return (
        <div className="smart-calendar-workspace">
            <Helmet>
                <title>Calendar & Notices | Smart Incubation</title>
            </Helmet>

            <div className="smart-calendar-page">
                <Tabs
                    className="smart-workspace-tabs"
                    activeKey={workspaceView}
                    onChange={value => setWorkspaceView(value as WorkspaceView)}
                    items={[
                        {
                            key: 'calendar',
                            label: (
                                <Space size={7}>
                                    <CalendarOutlined />
                                    Calendar
                                </Space>
                            )
                        },
                        {
                            key: 'notices',
                            label: (
                                <Space size={7}>
                                    <NotificationOutlined />
                                    Notice board
                                </Space>
                            )
                        }
                    ]}
                />
                <Row gutter={[16, 16]} align="middle" justify="space-between" className="smart-calendar-topbar">
                    {!isMobile && (
                        <Col xs={24} xl={10}>
                            <div className="smart-calendar-title-wrap">
                                <div className="smart-calendar-title-icon">
                                    {workspaceView === 'calendar'
                                        ? <CalendarOutlined />
                                        : <NotificationOutlined />}
                                </div>
                                <div>
                                    <Title level={4} style={{ margin: 0 }}>
                                        {workspaceView === 'calendar' ? 'My calendar' : 'Notice board'}
                                    </Title>
                                    <Text type="secondary">
                                        {workspaceView === 'calendar'
                                            ? isIncubatee
                                                ? 'Appointments and events that include you'
                                                : 'Events, appointments, and due tasks'
                                            : 'Announcements for your branch and programme'}
                                    </Text>
                                </div>
                            </div>
                        </Col>
                    )}

                    <Col xs={24} xl={14}>
                        {workspaceView === 'calendar' && <div className="smart-calendar-actions">
                            <Tag className="smart-pill smart-pill-purple">{eventRows.length} Events</Tag>
                            <Tag className="smart-pill smart-pill-blue">{appointmentRows.length} Appointments</Tag>
                            {!isIncubatee && (
                                <Tag className="smart-pill smart-pill-gold">{taskRows.length} Tasks</Tag>
                            )}
                            <Tag className="smart-pill smart-pill-slate">{calendarEvents.length} Showing</Tag>

                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    flexWrap: 'wrap',
                                    padding: '10px 12px',
                                    border: '1px solid #e6efff',
                                    borderRadius: 14,
                                    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
                                    width: '100%'
                                }}
                            >
                                <Space
                                    size={8}
                                    style={{
                                        color: '#1677ff',
                                        fontWeight: 600,
                                        flex: '0 0 auto'
                                    }}
                                >
                                    <FilterOutlined />
                                    <span>Filters</span>
                                </Space>

                                {/* Type + Delivery */}
                                <div
                                    style={{
                                        display: 'flex',
                                        gap: 10,
                                        flex: '1 1 380px',
                                        minWidth: 0
                                    }}
                                >
                                    <div
                                        style={{
                                            flex: 1,
                                            minWidth: 0
                                        }}
                                    >
                                        <Select
                                            value={typeFilter}
                                            onChange={(value) => setTypeFilter(value)}
                                            style={{ width: '100%' }}
                                            options={typeFilterOptions}
                                            optionLabelProp="label"
                                            suffixIcon={<AppstoreOutlined />}
                                            popupMatchSelectWidth={false}
                                            size="large"
                                        />
                                    </div>

                                    <div
                                        style={{
                                            flex: 1,
                                            minWidth: 0
                                        }}
                                    >
                                        <Select
                                            value={deliveryFilter}
                                            onChange={(value) => setDeliveryFilter(value)}
                                            style={{ width: '100%' }}
                                            options={deliveryFilterOptions}
                                            optionLabelProp="label"
                                            suffixIcon={<ClockCircleOutlined />}
                                            popupMatchSelectWidth={false}
                                            size="large"
                                        />
                                    </div>
                                </div>

                                {canFilterByDepartment ? (
                                    <div
                                        style={{
                                            flex: '1 1 240px',
                                            minWidth: 0
                                        }}
                                    >
                                        <Select
                                            value={departmentFilter}
                                            onChange={(value) => setDepartmentFilter(value)}
                                            style={{ width: '100%' }}
                                            options={departmentOptions}
                                            showSearch
                                            optionFilterProp="searchLabel"
                                            suffixIcon={<ApartmentOutlined />}
                                            placeholder="Filter by department"
                                            popupMatchSelectWidth={false}
                                            size="large"
                                            optionRender={(option) => (
                                                <Space size={8}>
                                                    <ApartmentOutlined />
                                                    <span>{String(option.data.label)}</span>
                                                </Space>
                                            )}
                                            labelRender={(props) => (
                                                <Space size={8}>
                                                    <ApartmentOutlined />
                                                    <span>{String(props.label)}</span>
                                                </Space>
                                            )}
                                        />
                                    </div>
                                ) : null}
                            </div>
                            <Segmented
                                className="smart-calendar-segmented"
                                value={viewMode}
                                onChange={(value) => setViewMode(value as ViewMode)}
                                options={[
                                    {
                                        label: (
                                            <Space size={6}>
                                                <BarsOutlined />
                                                <span>Day</span>
                                            </Space>
                                        ),
                                        value: 'timeGridDay'
                                    },
                                    {
                                        label: (
                                            <Space size={6}>
                                                <CalendarOutlined />
                                                <span>Week</span>
                                            </Space>
                                        ),
                                        value: 'timeGridWeek'
                                    },
                                    {
                                        label: (
                                            <Space size={6}>
                                                <AppstoreOutlined />
                                                <span>Month</span>
                                            </Space>
                                        ),
                                        value: 'dayGridMonth'
                                    }
                                ]}
                            />
                        </div>}
                    </Col>
                </Row>

                {workspaceView === 'notices' ? (
                    <NoticeBoard
                        user={user}
                        activeProgramId={activeProgramId}
                        isAllPrograms={isAllPrograms}
                    />
                ) : loading ? (
                    <div className="smart-calendar-loading">
                        <LoadingOverlay tip="Getting calendar ready" />
                    </div>
                ) : calendarEvents.length === 0 ? (
                    <div className="smart-calendar-empty-wrap">
                        <Empty
                            description={isIncubatee ? "No events or appointments found" : "No events, appointments, or tasks found"}
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                        />
                    </div>
                ) : (
                    <div className="smart-calendar-shell">
                        <FullCalendar
                            key={`${viewMode}-${activeProgramId || 'all'}-${isAllPrograms ? 'all' : 'single'}`}
                            plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
                            initialView={viewMode}
                            headerToolbar={{
                                left: 'prev,next today',
                                center: 'title',
                                right: ''
                            }}
                            events={calendarEvents}
                            eventClick={handleEventClick}
                            eventContent={renderEventContent}
                            nowIndicator
                            editable={false}
                            selectable={false}
                            allDaySlot={viewMode === 'dayGridMonth'}
                            // Timed events that overlap are allocated separate
                            // columns: two use half the lane, three use thirds,
                            // and so on. They never conceal one another.
                            slotEventOverlap={false}
                            slotMinTime={viewMode === 'dayGridMonth' ? '00:00:00' : '08:00:00'}
                            slotMaxTime={viewMode === 'dayGridMonth' ? '24:00:00' : '18:00:00'}
                            slotDuration="00:30:00"
                            slotLabelInterval="01:00"
                            height={
                                viewMode === 'dayGridMonth' || isMobile
                                    ? 'auto'
                                    : 'calc(100vh - 300px)'
                            }
                            contentHeight={isMobile ? 'auto' : '100%'}
                            expandRows={!isMobile}
                            dayMaxEventRows={3}
                            stickyHeaderDates
                            weekends={viewMode !== 'timeGridWeek'}
                            eventTimeFormat={{
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                                meridiem: false
                            }}
                        />
                    </div>
                )}
            </div>

            <Modal
                open={!!selectedItem && selectedItem.source !== 'appointment'}
                onCancel={() => setSelectedItem(null)}
                footer={[
                    <Button key="close" onClick={() => setSelectedItem(null)}>
                        Close
                    </Button>
                ]}
                title={
                    selectedItem?.source === 'event'
                        ? 'Event Details'
                        : selectedItem?.source === 'appointment'
                            ? 'Appointment Details'
                            : 'Task Details'
                }
                width={860}
            >
                {selectedItem && (
                    <div>
                        <div className="smart-calendar-modal-head">
                            <Avatar
                                size={50}
                                className={
                                    selectedItem.source === 'event'
                                        ? 'smart-modal-avatar event'
                                        : selectedItem.source === 'appointment'
                                            ? 'smart-modal-avatar appointment'
                                            : 'smart-modal-avatar task'
                                }
                                icon={
                                    selectedItem.source === 'event' ? (
                                        <AppstoreOutlined />
                                    ) : selectedItem.source === 'appointment' ? (
                                        <ClockCircleOutlined />
                                    ) : (
                                        <CalendarOutlined />
                                    )
                                }
                            />
                            <div>
                                <Title level={5} style={{ margin: 0 }}>
                                    <span style={{ overflowWrap: 'anywhere' }}>
                                        {selectedItem.title}
                                    </span>
                                </Title>
                                <Text type="secondary">
                                    {selectedItem.source === 'event'
                                        ? 'Event schedule details'
                                        : selectedItem.source === 'appointment'
                                            ? 'Appointment schedule details'
                                            : 'Task details'}
                                </Text>
                            </div>
                        </div>

                        <Descriptions bordered column={1} size="middle">
                            <Descriptions.Item label="Type">
                                {selectedItem.source === 'event' ? (
                                    <Tag color="purple">Event</Tag>
                                ) : selectedItem.source === 'appointment' ? (
                                    <Tag color="blue">
                                        {selectedItem.raw?.isGroupAppointment ? 'Group Appointment' : 'Appointment'}
                                    </Tag>
                                ) : (
                                    <Tag color="gold">Task</Tag>
                                )}
                            </Descriptions.Item>

                            <Descriptions.Item label="Start">
                                {dayjs(selectedItem.start).format('DD MMM YYYY HH:mm')}
                            </Descriptions.Item>

                            <Descriptions.Item label="End">
                                {selectedItem.end
                                    ? dayjs(selectedItem.end).format('DD MMM YYYY HH:mm')
                                    : '-'}
                            </Descriptions.Item>

                            {selectedItem.source === 'event' ? (
                                <>
                                    <Descriptions.Item label="Location">
                                        {selectedItem.raw?.location || '-'}
                                    </Descriptions.Item>

                                    <Descriptions.Item label="Description">
                                        {selectedItem.raw?.description || '-'}
                                    </Descriptions.Item>
                                </>
                            ) : selectedItem.source === 'appointment' ? (
                                <>
                                    <Descriptions.Item label="Participant">
                                        {selectedItem.raw?.isGroupAppointment ? (
                                            <Space>
                                                <TeamOutlined />
                                                <span>
                                                    {selectedItem.raw?.groupParticipantCount ||
                                                        selectedItem.raw?.groupMembers?.length ||
                                                        0}{' '}
                                                    participants
                                                </span>
                                            </Space>
                                        ) : (
                                            <Space>
                                                <UserOutlined />
                                                <span>
                                                    {selectedItem.raw?.participantName ||
                                                        selectedItem.raw?.participantId ||
                                                        '-'}
                                                </span>
                                            </Space>
                                        )}
                                    </Descriptions.Item>

                                    <Descriptions.Item label="Facilitator">
                                        <Space>
                                            <TeamOutlined />
                                            <span>
                                                {selectedItem.raw?.consultantName ||
                                                    selectedItem.raw?.consultantId ||
                                                    '-'}
                                            </span>
                                        </Space>
                                    </Descriptions.Item>

                                    <Descriptions.Item label="Delivery Method">
                                        {selectedItem.raw?.deliveryMethod === 'virtual' ? (
                                            <Tag color="blue" icon={<VideoCameraOutlined />}>
                                                Virtual
                                            </Tag>
                                        ) : selectedItem.raw?.deliveryMethod === 'in_person' ? (
                                            <Tag color="cyan" icon={<EnvironmentOutlined />}>
                                                In Person
                                            </Tag>
                                        ) : selectedItem.raw?.deliveryMethod === 'telephonically' ? (
                                            <Tag color="geekblue">Telephonic</Tag>
                                        ) : selectedItem.raw?.deliveryMethod ? (
                                            <Tag>{selectedItem.raw.deliveryMethod}</Tag>
                                        ) : (
                                            '-'
                                        )}
                                    </Descriptions.Item>

                                    <Descriptions.Item label="Status">
                                        {selectedItem.raw?.status || '-'}
                                    </Descriptions.Item>

                                    {!selectedItem.raw?.isGroupAppointment && (
                                        <Descriptions.Item label="User Confirmation">
                                            {selectedItem.raw?.userConfirmation || '-'}
                                        </Descriptions.Item>
                                    )}

                                    {(() => {
                                        const method = lower(selectedItem.raw?.deliveryMethod)

                                        if (method === 'in_person') {
                                            return (
                                                <Descriptions.Item label="Location">
                                                    {selectedItem.raw?.location ? (
                                                        <Space>
                                                            <EnvironmentOutlined />
                                                            <span>{selectedItem.raw.location}</span>
                                                        </Space>
                                                    ) : (
                                                        '-'
                                                    )}
                                                </Descriptions.Item>
                                            )
                                        }

                                        if (method === 'virtual') {
                                            return (
                                                <Descriptions.Item label="Meeting Link">
                                                    {selectedItem.raw?.meetingLink ? (
                                                        <a
                                                            href={selectedItem.raw.meetingLink}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                        >
                                                            <Space>
                                                                <LinkOutlined />
                                                                Open meeting
                                                            </Space>
                                                        </a>
                                                    ) : (
                                                        '-'
                                                    )}
                                                </Descriptions.Item>
                                            )
                                        }

                                        if (method === 'telephonically') {
                                            return null // show nothing
                                        }

                                        // fallback for unknown values
                                        return null
                                    })()}

                                    {selectedItem.raw?.foodMenuEnabled || getFoodMenuItems(selectedItem.raw).length ? (
                                        <Descriptions.Item label="Food Menu">
                                            {getFoodMenuItems(selectedItem.raw).length ? (
                                                <Space wrap>
                                                    {getFoodMenuItems(selectedItem.raw).map((item: any) => (
                                                        <Tag key={item.id}>
                                                            {item.name || item.label}
                                                            {item.category ? ` (${formatFoodCategory(item.category)})` : ''}
                                                        </Tag>
                                                    ))}
                                                </Space>
                                            ) : (
                                                <Text type="secondary">No menu items listed</Text>
                                            )}
                                        </Descriptions.Item>
                                    ) : null}

                                    {getFoodSelections(selectedItem.raw).length ? (
                                        <Descriptions.Item label="Food Selections">
                                            <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                                {getFoodSelections(selectedItem.raw).map((selection: any, index: number) => (
                                                    <div
                                                        key={`${selection.participantId || 'participant'}-${selection.itemId || index}`}
                                                        style={{
                                                            display: 'flex',
                                                            justifyContent: 'space-between',
                                                            gap: 12,
                                                            flexWrap: 'wrap'
                                                        }}
                                                    >
                                                        <Text strong>
                                                            {selection.participantName || selection.participantEmail || 'SME'}
                                                        </Text>
                                                        <Tag color="purple">
                                                            {selection.itemName || selection.name || 'Selected'}
                                                        </Tag>
                                                    </div>
                                                ))}
                                            </Space>
                                        </Descriptions.Item>
                                    ) : null}

                                    {selectedItem.raw?.isGroupAppointment &&
                                        Array.isArray(selectedItem.raw?.groupMembers) ? (
                                        <Descriptions.Item label="Participants">
                                            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                                                <Space
                                                    direction="vertical"
                                                    size={8}
                                                    style={{ width: '100%' }}
                                                >
                                                    {selectedItem.raw.groupMembers.map((member: any) => (
                                                        <div
                                                            key={member.id}
                                                            style={{
                                                                display: 'flex',
                                                                justifyContent: 'space-between',
                                                                gap: 12,
                                                                padding: '8px 10px',
                                                                border: '1px solid #f0f0f0',
                                                                borderRadius: 8
                                                            }}
                                                        >
                                                            <div>
                                                                <div style={{ fontWeight: 500 }}>
                                                                    {member.participantName ||
                                                                        member.participantId ||
                                                                        'Unknown'}
                                                                </div>
                                                                <div
                                                                    style={{
                                                                        fontSize: 12,
                                                                        color: 'rgba(0,0,0,.45)'
                                                                    }}
                                                                >
                                                                    {member.participantEmail || 'No email'}
                                                                </div>
                                                            </div>

                                                            <Space wrap>
                                                                <Tag
                                                                    color={
                                                                        member.userConfirmation === 'confirmed'
                                                                            ? 'green'
                                                                            : member.userConfirmation === 'declined'
                                                                                ? 'red'
                                                                                : 'orange'
                                                                    }
                                                                >
                                                                    {member.userConfirmation || 'pending'}
                                                                </Tag>
                                                                <Tag>{member.status || 'scheduled'}</Tag>
                                                            </Space>
                                                        </div>
                                                    ))}
                                                </Space>
                                            </div>
                                        </Descriptions.Item>
                                    ) : null}
                                </>
                            ) : (
                                <>
                                    <Descriptions.Item label="Status">
                                        {selectedItem.raw?.status || '-'}
                                    </Descriptions.Item>

                                    <Descriptions.Item label="Priority">
                                        {selectedItem.raw?.priority || '-'}
                                    </Descriptions.Item>

                                    <Descriptions.Item label="Description">
                                        {selectedItem.raw?.description || '-'}
                                    </Descriptions.Item>
                                </>
                            )}
                        </Descriptions>
                    </div>
                )}
            </Modal>
            <AppointmentDetailsModal
                open={Boolean(selectedAppointment)}
                appointment={selectedAppointment}
                onClose={() => setSelectedItem(null)}
            />
        </div>
    )
}

const formatTimeRange = (start?: Date, end?: Date) => {
    if (!start) return ''
    const s = dayjs(start).format('HH:mm')
    const e = end ? dayjs(end).format('HH:mm') : ''
    return e ? `${s} - ${e}` : s
}

export default MyCalendarPage
