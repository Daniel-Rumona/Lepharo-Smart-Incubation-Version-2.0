import React, { useEffect, useState } from 'react'
import {
    Table,
    Grid,
    Tag,
    Space,
    Typography,
    Divider,
    Select,
    Card,
    Row,
    Col,
    notification,
    Button,
    Modal,
    Statistic,
    Input,
    Collapse,
    DatePicker,
    Descriptions,
    Progress,
    Tooltip
} from 'antd'
import {
    collection,
    getDocs,
    query,
    where,
    doc,
    updateDoc,
    arrayUnion,
    setDoc,
    getDoc
} from 'firebase/firestore'
import {
    getAuth,
    EmailAuthProvider,
    reauthenticateWithCredential,
    onAuthStateChanged
} from 'firebase/auth'
import { db } from '@/firebase'
import dayjs from 'dayjs'
import { Helmet } from 'react-helmet'
import {
    TeamOutlined,
    FileDoneOutlined,
    CalendarOutlined,
    BarChartOutlined
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import { chunk } from '@/types/types'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { assignedInterventionService } from '@/services/assignedInterventionService'

const { Panel } = Collapse
const { Text } = Typography
const { Option } = Select
const { RangePicker } = DatePicker

const isCompletedInterventionRecord = (item: any) => {
    const normalizedStatus = String(item?.assignmentStatus || item?.status || '')
        .trim()
        .toLowerCase()
    const participantCompletion = String(item?.participantCompletionStatus || '')
        .trim()
        .toLowerCase()

    return (
        !!item?.confirmedAt ||
        normalizedStatus === 'completed' ||
        participantCompletion === 'confirmed'
    )
}

const getCompletedRequiredKeys = (items: any[], required: any) => {
    const completedKeys = new Set<string>()

        ; (items || []).forEach((item: any) => {
            if (!isCompletedInterventionRecord(item)) return

            const itemId =
                item.templateId || item.interventionId || item.interventionTemplateId || null
            const itemTitle = String(item.interventionTitle || item.title || '')
                .trim()
                .toLowerCase()
            const matchedKey =
                (itemId ? required?.canonicalById?.get(String(itemId)) : undefined) ||
                required?.canonicalByTitle?.get(itemTitle)

            if (matchedKey) completedKeys.add(matchedKey)
        })

    return completedKeys
}

const InterventionDatabaseView = () => {
    const [loading, setLoading] = useState(true)
    const [records, setRecords] = useState<any[]>([])
    const [filtered, setFiltered] = useState<any[]>([])
    const [summaryModal, setSummaryModal] = useState<{
        title: string
        context: string
    } | null>(null)

    const [programOptions, setProgramOptions] = useState<
        { id: string; name: string }[]
    >([])

    const { programId } = useActiveProgramId()

    const genderOptions = React.useMemo(
        () =>
            Array.from(new Set(records.map(r => r.gender).filter(Boolean))).sort(),
        [records]
    )

    // filters are ONLY for gender & group now – program comes from useActiveProgramId
    const [filters, setFilters] = useState({
        gender: 'all',
        group: 'all'
    })

    const screens = Grid.useBreakpoint()
    const isMobile = !screens.md
    const isMdUp = screens.md

    const [requiredMap, setRequiredMap] = useState<
        Record<
            string,
            {
                count: number
                ids: Set<string>
                titles: Set<string>
                keys: Set<string>
                canonicalById: Map<string, string>
                canonicalByTitle: Map<string, string>
            }
        >
    >({})
    const [participantIdByEmail, setParticipantIdByEmail] = useState<
        Record<string, string>
    >({})

    const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(
        null
    )
    const [modalArea, setModalArea] = useState<'all' | string>('all')

    const [programMap, setProgramMap] = useState<{ [key: string]: string }>({})
    const [consultantMap, setConsultantMap] = useState<
        Record<string, { name: string; type: string }>
    >({})

    const [participantInfoMap, setParticipantInfoMap] = useState<
        Record<string, { name?: string; sector?: string }>
    >({})

    const [applicationMap, setApplicationMap] = useState<
        Record<string, { gapGroup?: string; gender?: string; branchId?: string }>
    >({})

    const [branchMap, setBranchMap] = useState<Record<string, string>>({})

    const [consultantRates, setConsultantRates] = useState<{
        [key: string]: number
    }>({})
    const [selectedView, setSelectedView] = useState<any | null>(null)
    const [password, setPassword] = useState('')
    const [showDetails, setShowDetails] = useState<string | null>(null)
    const [hasAccess, setHasAccess] = useState<string | null>(null)
    const [participantMap, setParticipantMap] = useState<{
        [key: string]: string
    }>({})
    const [currentUser, setCurrentUser] = useState<any>(null)
    const [actionLoading, setActionLoading] = useState('')
    const [deptNameById, setDeptNameById] = useState<Record<string, string>>({})
    const [deptIdByInterventionId, setDeptIdByInterventionId] = useState<
        Record<string, string>
    >({})

    // Depts that use a narrative Summary instead of file POEs
    const SUMMARY_DEPTS = [
        'Legal Advisory Services',
        'Wellness Services',
        'PDS (Personal Development Services)'
    ]

    const isSummaryDept = (area: string | undefined | null) =>
        SUMMARY_DEPTS.some(
            d =>
                d.toLowerCase() ===
                String(area || '')
                    .trim()
                    .toLowerCase()
        )

    // ─────────────────────────────────────────────
    // 1) Load only current user
    // ─────────────────────────────────────────────
    useEffect(() => {
        const auth = getAuth()

        const unsub = onAuthStateChanged(auth, async user => {
            if (!user) return

            setLoading(true)
            setCurrentUser(user)

            try {
                const userSnap = await getDocs(
                    query(collection(db, 'users'), where('email', '==', user.email))
                )

                if (userSnap.empty) {
                    notification.error({ message: 'User not found' })
                    return
                }

                const userData = userSnap.docs[0].data()
            } catch (err) {
                console.error(err)
                notification.error({ message: 'Failed to load user' })
            } finally {
                setLoading(false)
            }
        })

        return () => unsub()
    }, [])

    // ─────────────────────────────────────────────
    // 2) Wait for programId
    //     THEN load everything else
    // ─────────────────────────────────────────────
    useEffect(() => {

        const loadData = async () => {
            setLoading(true)

            try {
                // participants → name + sector + email index
                const participantsSnap = await getDocs(collection(db, 'participants'))
                const pNameMap: Record<string, string> = {}
                const pInfoLocal: Record<string, { name?: string; sector?: string }> =
                    {}
                const idByEmail: Record<string, string> = {}

                participantsSnap.forEach(d => {
                    const data: any = d.data()
                    const name = data.beneficiaryName || data.name
                    const sector = data.sector || ''
                    const email: string = data.email || ''

                    pNameMap[d.id] = name
                    pInfoLocal[d.id] = { name, sector }

                    if (email) idByEmail[email.toLowerCase()] = d.id
                })

                setParticipantMap(pNameMap)
                setParticipantInfoMap(pInfoLocal)
                setParticipantIdByEmail(idByEmail)

                // consultants + ops staff
                const [consultantSnap, opsSnap] = await Promise.all([
                    getDocs(collection(db, 'consultants')),
                    getDocs(
                        query(
                            collection(db, 'operationsStaff'),

                        )
                    )
                ])

                const peopleMap: Record<string, { name: string; type: string }> = {}

                consultantSnap.forEach(d => {
                    const data: any = d.data()
                    peopleMap[d.id] = {
                        name:
                            data.name ||
                            data.fullName ||
                            data.displayName ||
                            data.email ||
                            d.id,
                        type: data.type || 'Consultant'
                    }
                })

                opsSnap.forEach(d => {
                    const data: any = d.data()
                    peopleMap[d.id] = {
                        name:
                            data.name ||
                            data.fullName ||
                            data.displayName ||
                            data.email ||
                            d.id,
                        type: 'HOD'
                    }
                })

                setConsultantMap(peopleMap)

                // departments
                const deptsSnap = await getDocs(collection(db, 'departments'))
                const deptNameMap: Record<string, string> = {}
                deptsSnap.forEach(d => {
                    const dd: any = d.data()
                    deptNameMap[d.id] = dd.name || dd.title || dd.departmentName || d.id
                })
                setDeptNameById(deptNameMap)

                // programs
                const programsSnap = await getDocs(collection(db, 'programs'))
                const prMap: any = {}
                programsSnap.forEach(d => {
                    prMap[d.id] = d.data().name
                })
                setProgramMap(prMap)

                // applications filtered by programId
                const applicationsRef = collection(db, 'applications')

                const appsQuery =
                    programId === 'all'
                        ? query(applicationsRef)
                        : query(
                            applicationsRef,

                            where('programId', '==', String(programId))
                        )

                const appsSnap = await getDocs(appsQuery)


                const appMapLocal: Record<
                    string,
                    { gapGroup?: string; gender?: string; branchId?: string }
                > = {}

                const requiredLocal: Record<
                    string,
                    {
                        count: number
                        ids: Set<string>
                        titles: Set<string>
                        keys: Set<string>
                        canonicalById: Map<string, string>
                        canonicalByTitle: Map<string, string>
                    }
                > = {}


                appsSnap.forEach(d => {
                    const a: any = d.data()

                    const appEmail = String(a.email || '').trim().toLowerCase()
                    const directParticipantId = String(a.participantId || '').trim()

                    let pid: string | null = null

                    if (directParticipantId) {
                        pid = directParticipantId
                    } else if (appEmail && idByEmail[appEmail]) {
                        pid = idByEmail[appEmail]
                    }

                    if (!pid) {
                        console.groupCollapsed('[Application not linked to participant]', d.id)
                        console.log('application data:', a)
                        console.log('participantId:', a.participantId)
                        console.log('email:', a.email)
                        console.log(
                            'matched participantId by email:',
                            appEmail ? idByEmail[appEmail] : null
                        )
                        console.groupEnd()
                        return
                    }

                    if (!appMapLocal[pid]) {
                        appMapLocal[pid] = {
                            gapGroup: a.gapGroup || a.group || a.currentGroup || a.groupCategory,
                            gender: a.gender,
                            branchId: a.branchId || a.assignedBranch || a.branch
                        }
                    }

                    const reqArr =
                        a?.interventions?.required ||
                        a?.intervetions?.required ||
                        a?.requiredInterventions ||
                        []

                    const ids = new Set<string>()
                    const titles = new Set<string>()
                    const keys = new Set<string>()
                    const canonicalById = new Map<string, string>()
                    const canonicalByTitle = new Map<string, string>()

                    if (Array.isArray(reqArr)) {
                        reqArr.forEach((r: any) => {
                            const id = String(r?.id || r?.interventionId || '').trim()

                            const title = String(
                                r?.title || r?.interventionTitle || r?.name || ''
                            )
                                .trim()
                                .toLowerCase()

                            const canonicalKey = id
                                ? `id:${id}`
                                : title
                                    ? `title:${title}`
                                    : ''

                            if (!canonicalKey) return
                            keys.add(canonicalKey)
                            if (id) {
                                ids.add(id)
                                canonicalById.set(id, canonicalKey)
                            }
                            if (title) {
                                titles.add(title)
                                canonicalByTitle.set(title, canonicalKey)
                            }
                        })
                    }

                    const prev = requiredLocal[pid]
                    if (!prev) {
                        requiredLocal[pid] = {
                            count: keys.size,
                            ids,
                            titles,
                            keys,
                            canonicalById,
                            canonicalByTitle
                        }
                    } else {
                        ids.forEach(id => prev.ids.add(id))
                        titles.forEach(title => prev.titles.add(title))
                        keys.forEach(key => prev.keys.add(key))
                        canonicalById.forEach((key, id) => prev.canonicalById.set(id, key))
                        canonicalByTitle.forEach((key, title) =>
                            prev.canonicalByTitle.set(title, key)
                        )
                        prev.count = prev.keys.size
                    }
                })

                console.log('applicationMap keys:', Object.keys(appMapLocal).length)
                console.log('requiredMap keys:', Object.keys(requiredLocal).length)
                console.table(
                    Object.entries(appMapLocal).slice(0, 20).map(([pid, v]) => ({
                        participantId: pid,
                        gapGroup: v.gapGroup || '(missing)',
                        gender: v.gender || '(missing)',
                        branchId: v.branchId || '(missing)'
                    }))
                )

                setRequiredMap(requiredLocal)
                setApplicationMap(appMapLocal)

                // branches
                const branchesSnap = await getDocs(collection(db, 'branches'))
                const brMapLocal: Record<string, string> = {}
                branchesSnap.forEach(d => {
                    const b: any = d.data()
                    brMapLocal[d.id] = b.name || b.branchName || d.id
                })
                setBranchMap(brMapLocal)

                // assignedInterventions is the canonical operational source.
                const assignedRows = await assignedInterventionService.list(
                    programId === 'all' ? {} : { programId: String(programId) }
                )

                const interventionDeptMap: Record<string, string> = {}
                const grouped = new Map<string, any>()

                assignedRows.forEach((row: any) => {
                    const d = { id: row.id }
                    const data: any = row

                    if (data?.interventionId && data?.departmentId) {
                        interventionDeptMap[String(data.interventionId)] = String(
                            data.departmentId
                        )
                    }

                    const key = `${data.programId}_${data.participantId}`
                    const pid = data.participantId

                    const appInfo = appMapLocal[pid] || {}
                    const participantInfo = pInfoLocal[pid] || {}
                    const branchName = appInfo.branchId
                        ? brMapLocal[appInfo.branchId]
                        : undefined

                    if (pid && !appMapLocal[pid]) {
                        console.warn('[Missing application metadata for participant]', {
                            participantId: pid,
                            beneficiaryName: pNameMap[pid],
                            programId: data.programId,
                            interventionDocId: d.id
                        })
                    }

                    if (!grouped.has(key)) {
                        grouped.set(key, {
                            programId: data.programId,
                            participantId: pid,
                            beneficiaryName: participantInfo.name,
                            province: data.province,
                            quarter: data.quarter,
                            hub: data.hub,
                            group: appInfo.gapGroup || 'Not specified',
                            sector: participantInfo.sector || 'Not specified',
                            gender: appInfo.gender || 'Not specified',
                            branchId: appInfo.branchId || null,
                            branchName: branchName || 'Unknown',
                            interventions: []
                        })
                    }

                    grouped.get(key).interventions.push({ id: d.id, ...data })
                })

                setDeptIdByInterventionId(interventionDeptMap)

                const groupedRecords = Array.from(grouped.values())
                setRecords(groupedRecords)
                setFiltered(groupedRecords)

                // resolve departments from interventionIds
                const uniqueInterventionIds = Array.from(
                    new Set(
                        groupedRecords.flatMap(gr =>
                            (gr.interventions || [])
                                .map((iv: any) => iv?.interventionId)
                                .filter(Boolean)
                        )
                    )
                ) as string[]

                const resolveDeptMaps = async (interventionIds: string[]) => {
                    const interToDept: Record<string, string> = {}
                    const deptIds = new Set<string>()

                    for (const ids of chunk(interventionIds, 30)) {
                        await Promise.all(
                            ids.map(async iid => {
                                try {
                                    const directSnap = await getDoc(doc(db, 'interventions', iid))

                                    if (directSnap.exists()) {
                                        const d = directSnap.data() as any

                                        if (d?.departmentId) {
                                            interToDept[iid] = String(d.departmentId)
                                            deptIds.add(String(d.departmentId))
                                        }
                                        return
                                    }

                                    const qSnap = await getDocs(
                                        query(
                                            collection(db, 'interventions'),
                                            where('interventionId', '==', iid)
                                        )
                                    )

                                    if (!qSnap.empty) {
                                        const d = qSnap.docs[0].data() as any

                                        if (d?.departmentId) {
                                            interToDept[iid] = String(d.departmentId)
                                            deptIds.add(String(d.departmentId))
                                        }
                                    }
                                } catch (err) {
                                    console.error('Error resolving intervention', iid, err)
                                }
                            })
                        )
                    }

                    const deptNameMap2: Record<string, string> = {}

                    await Promise.all(
                        Array.from(deptIds).map(async depId => {
                            try {
                                const depSnap = await getDoc(doc(db, 'departments', depId))
                                if (depSnap.exists()) {
                                    const dd = depSnap.data() as any
                                    deptNameMap2[depId] =
                                        dd?.name || dd?.title || dd?.departmentName || depId
                                } else {
                                    deptNameMap2[depId] = depId
                                }
                            } catch (err) {
                                deptNameMap2[depId] = depId
                            }
                        })
                    )

                    setDeptIdByInterventionId(interToDept)
                    setDeptNameById(deptNameMap2)
                }

                await resolveDeptMaps(uniqueInterventionIds)

                const uniqueProgramIds = [
                    ...new Set(groupedRecords.map(d => d.programId))
                ]
                setProgramOptions(
                    uniqueProgramIds.map(id => ({
                        id,
                        name: prMap[id] || id
                    }))
                )
            } catch (err) {
                console.error(err)
                notification.error({ message: 'Failed to load data' })
            } finally {
                setLoading(false)
            }
        }

        loadData()
    }, [programId])

    useEffect(() => {
        const fetchConsultants = async () => {
            const snapshot = await getDocs(collection(db, 'consultants'))
            const rateMap: any = {}
            snapshot.forEach(doc => {
                const data = doc.data()
                rateMap[doc.id] = data.rate || 0
            })
            setConsultantRates(rateMap)
        }
        fetchConsultants()
    }, [])

    // get a proper Date from various shapes
    const getInterventionDate = (iv: any): dayjs.Dayjs | null => {
        const candidates = [
            iv.confirmedAt,
            iv.completedAt,
            iv.updatedAt,
            iv.createdAt,
            iv.date
        ]

        for (const c of candidates) {
            if (!c) continue
            if (typeof c?.toDate === 'function') return dayjs(c.toDate()) // Firestore Timestamp
            if (c instanceof Date) return dayjs(c) // JS Date
            if (typeof c === 'number') return dayjs(c) // millis
            if (typeof c === 'string') {
                const d = dayjs(c)
                if (d.isValid()) return d // ISO string
            }
        }
        return null
    }

    // build last-12-months series from your existing `records`
    const interventionsByMonth = React.useMemo(() => {
        const now = dayjs()
        const keys: string[] = []
        const categories: string[] = []
        for (let i = 11; i >= 0; i--) {
            keys.push(now.subtract(i, 'month').format('YYYY-MM'))
            categories.push(now.subtract(i, 'month').format('MMM YYYY'))
        }
        const counts: Record<string, number> = Object.fromEntries(
            keys.map(k => [k, 0])
        )

        records.forEach(rec => {
            ; (rec.interventions || []).forEach((iv: any) => {
                const d = getInterventionDate(iv)
                if (!d) return
                const k = dayjs(d).format('YYYY-MM')
                if (k in counts) counts[k] += 1
            })
        })

        return { categories, data: keys.map(k => counts[k]) }
    }, [records])

    const miniChartOptions = React.useMemo(
        () => ({
            chart: { type: 'column', height: 200, spacing: [8, 8, 8, 8] },
            title: {
                text: 'Interventions (last 12 months)',
                style: { fontSize: '12px', fontWeight: '600' }
            },
            xAxis: {
                categories: interventionsByMonth.categories,
                labels: { style: { fontSize: '10px' } }
            },
            yAxis: { min: 0, title: { text: '' }, gridLineDashStyle: 'ShortDot' },
            legend: { enabled: false },
            credits: { enabled: false },
            tooltip: { pointFormat: '<b>{point.y}</b> interventions' },
            plotOptions: {
                column: { borderRadius: 4, pointPadding: 0.1, groupPadding: 0.1 }
            },
            series: [{ name: 'Interventions', data: interventionsByMonth.data }]
        }),
        [interventionsByMonth]
    )

    const groupOptions = React.useMemo(
        () => Array.from(new Set(records.map(r => r.group).filter(Boolean))).sort(),
        [records]
    )

    // Helpers
    const inRange = (
        dd: dayjs.Dayjs,
        range: [dayjs.Dayjs, dayjs.Dayjs] | null
    ) => {
        if (!range) return true
        const [s, e] = range
        const t = dd.valueOf()
        return t >= s.startOf('day').valueOf() && t <= e.endOf('day').valueOf()
    }

    // Flatten interventions so we can chart + filter consistently
    const allInterventions = React.useMemo(() => {
        return records.flatMap(rec =>
            (rec.interventions || []).map((iv: any) => ({
                ...iv,
                _programId: rec.programId,
                _participantId: rec.participantId,
                _group: rec.group || 'Not specified',
                _gender: rec.gender || 'Not specified'
            }))
        )
    }, [records])

    // Apply filters – program filter is driven directly by useActiveProgramId
    const filteredInterventions = React.useMemo(() => {
        return allInterventions.filter(iv => {
            const d = getInterventionDate(iv)

            const passDate = !dateRange || (d !== null && inRange(d, dateRange))

            const passProgram =
                !programId || programId === 'all' || iv._programId === String(programId)

            const passGroup = filters.group === 'all' || iv._group === filters.group
            const passGender =
                filters.gender === 'all' || iv._gender === filters.gender

            return passProgram && passGroup && passGender && passDate
        })
    }, [allInterventions, filters, dateRange, programId])

    // Filtered records for the table: keep a record if it has any intervention that passes filters
    const filteredRecords = React.useMemo(() => {
        const setIds = new Set(
            filteredInterventions.map(iv => iv._participantId + '|' + iv._programId)
        )
        return records.filter(rec =>
            setIds.has(rec.participantId + '|' + rec.programId)
        )
    }, [records, filteredInterventions])

    // engagement
    const engagement = React.useMemo(() => {
        const total = filteredRecords.length || 0
        const engaged = filteredRecords.filter(
            r => (r.interventions?.length || 0) > 0
        ).length
        return { total, engaged, pct: Math.round((engaged / (total || 1)) * 100) }
    }, [filteredRecords])

    // Build quick lookup for earliest & latest intervention dates per participant
    const byParticipantDates = React.useMemo(() => {
        const earliestEver = new Map<string, dayjs.Dayjs>()
        const latestAny = new Map<string, dayjs.Dayjs>()
        records.forEach(rec => {
            ; (rec.interventions || []).forEach((iv: any) => {
                const d = getInterventionDate(iv)
                if (!d) return
                const pid = rec.participantId
                const e = earliestEver.get(pid)
                if (!e || d.isBefore(e)) earliestEver.set(pid, d)
                const l = latestAny.get(pid)
                if (!l || d.isAfter(l)) latestAny.set(pid, d)
            })
        })
        return { earliestEver, latestAny }
    }, [records])

    // Helper: is date in current selected range
    const isInRange = (
        d: dayjs.Dayjs | null,
        range: [dayjs.Dayjs, dayjs.Dayjs] | null
    ) =>
        !!(
            d &&
            range &&
            d.valueOf() >= range[0].startOf('day').valueOf() &&
            d.valueOf() <= range[1].endOf('day').valueOf()
        )

    // Active in range: participants with ≥1 intervention in filteredInterventions
    const engagedParticipantIdsInRange = React.useMemo(() => {
        const s = new Set<string>()
        filteredInterventions.forEach(iv => {
            s.add(iv._participantId)
        })
        return s
    }, [filteredInterventions])

    // Newly engaged: earliest-ever intervention for participant lies inside selected range
    const newlyEngagedCount = React.useMemo(() => {
        let c = 0
        engagedParticipantIdsInRange.forEach(pid => {
            const earliest = byParticipantDates.earliestEver.get(pid) || null
            if (isInRange(earliest, dateRange)) c += 1
        })
        return c
    }, [engagedParticipantIdsInRange, byParticipantDates, dateRange])

    // Recently active (≤30 days from today), regardless of selected range
    const recentlyActiveCount = React.useMemo(() => {
        const now = dayjs()
        let c = 0
        engagedParticipantIdsInRange.forEach(pid => {
            const latest = byParticipantDates.latestAny.get(pid) || null
            if (latest && now.diff(latest, 'day') <= 30) c += 1
        })
        return c
    }, [engagedParticipantIdsInRange, byParticipantDates])

    // POE coverage in the selected range: interventions that have evidence (summary or resources)
    const poeCoverage = React.useMemo(() => {
        const inRangeCount = filteredInterventions.length
        if (!inRangeCount) return { covered: 0, pct: 0 }
        let covered = 0
        filteredInterventions.forEach((iv: any) => {
            const hasSummary = Array.isArray(iv.resources)
                ? iv.resources.some(
                    (r: any) =>
                        String(r?.type || '').toLowerCase() === 'summary' ||
                        String(r?.label || '')
                            .toLowerCase()
                            .includes('summary')
                )
                : false
            const hasResources =
                Array.isArray(iv.resources) && iv.resources.length > 0
            if (hasSummary || hasResources) covered += 1
        })
        return {
            covered,
            pct: Math.round((covered / inRangeCount) * 100)
        }
    }, [filteredInterventions])

    // Required completion (avg) for participants visible under filters
    const requiredCompletionAvg = React.useMemo(() => {
        const participants = new Set(filteredRecords.map(r => r.participantId))
        let totalPct = 0
        let count = 0

        filteredRecords.forEach(rec => {
            const req = requiredMap[rec.participantId]
            const requiredCount = req?.count ?? 0

            const completedKeys = getCompletedRequiredKeys(rec.interventions || [], req)

            if (requiredCount > 0) {
                totalPct +=
                    (Math.min(completedKeys.size, requiredCount) / requiredCount) * 100
                count += 1
            }
        })

        const avg = count ? Math.round(totalPct / count) : 0
        return { avg, countParticipants: count }
    }, [filteredRecords, requiredMap])

    // Interventions by month (YYYY-MM)
    const byMonth = React.useMemo(() => {
        const m: Record<string, number> = {}
        filteredInterventions.forEach(iv => {
            const d = getInterventionDate(iv)
            const key = d ? dayjs(d).format('YYYY-MM') : 'Unknown'
            m[key] = (m[key] || 0) + 1
        })
        // sort months, keep "Unknown" last
        const known = Object.keys(m)
            .filter(k => k !== 'Unknown')
            .sort()
        const cats = [...known, ...(m.Unknown ? ['Unknown'] : [])]
        const data = cats.map(c => m[c])
        return { categories: cats, data }
    }, [filteredInterventions])

    // By Area of Support
    const byArea = React.useMemo(() => {
        const m: Record<string, number> = {}
        filteredInterventions.forEach(iv => {
            const k = iv.areaOfSupport || 'Unknown'
            m[k] = (m[k] || 0) + 1
        })
        return Object.entries(m).map(([name, y]) => ({ name, y }))
    }, [filteredInterventions])

    // By Program
    const byProgram = React.useMemo(() => {
        const m: Record<string, number> = {}
        filteredInterventions.forEach(iv => {
            const k = programMap[iv._programId] || iv._programId || 'Unknown'
            m[k] = (m[k] || 0) + 1
        })
        const entries = Object.entries(m).sort((a, b) => b[1] - a[1])
        return {
            categories: entries.map(([k]) => k),
            data: entries.map(([, v]) => v)
        }
    }, [filteredInterventions, programMap])

    const columns = [
        {
            title: 'Beneficiary',
            dataIndex: 'beneficiaryName',
            width: 180,
            ellipsis: true,
            render: (text: string, record: any) => (
                <div style={{ maxWidth: 160 }}>
                    <Text
                        ellipsis
                        style={{
                            display: 'block',
                            maxWidth: '100%'
                        }}
                    >
                        {text || 'Unknown'}
                    </Text>

                    {programId === 'all' && (
                        <Tag
                            style={{
                                fontSize: 10,
                                padding: '0 4px',
                                borderRadius: 6,
                                marginTop: 2,
                                maxWidth: '100%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            {programMap[record.programId] || 'Unknown program'}
                        </Tag>
                    )}
                </div>
            )
        },
        {
            title: 'Branch',
            dataIndex: 'branchName',
            responsive: ['lg'],
            ellipsis: true,
            width: 140,
            render: (_: any, record: any) => (
                <Text
                    strong
                    style={{
                        maxWidth: 120,
                        display: 'inline-block',
                        whiteSpace: 'nowrap'
                    }}
                >
                    {record.branchName || 'Unknown'}
                </Text>
            )
        },
        {
            title: 'Sector',
            dataIndex: 'sector',
            responsive: ['lg'],
            ellipsis: true,
            width: 160,
            render: (s: string) => s || <Text type='secondary'>Not specified</Text>
        },
        {
            title: 'Group',
            dataIndex: 'group',
            responsive: ['md'],
            ellipsis: true,
            width: 140,
            render: (g: string) => g || <Text type='secondary'>Not specified</Text>
        },
        {
            title: 'Gender',
            dataIndex: 'gender',
            responsive: ['lg'],
            width: 120,
            render: (g: string) => g || <Text type='secondary'>Not specified</Text>
        },
        {
            title: 'Progress',
            width: 180,
            render: (_: any, record: any) => {
                const req = requiredMap[record.participantId]
                const requiredCount = req?.count ?? 0

                const completedMatched = getCompletedRequiredKeys(
                    record.interventions || [],
                    req
                ).size
                const completedRecords = (record.interventions || []).filter(
                    isCompletedInterventionRecord
                ).length

                const completed =
                    requiredCount > 0
                        ? Math.min(completedMatched, requiredCount)
                        : completedRecords
                const pct =
                    requiredCount > 0
                        ? Math.min(100, Math.round((completed / requiredCount) * 100))
                        : 0
                return (
                    <Space direction='vertical' size={0} style={{ minWidth: 160 }}>
                        <Text strong>
                            {completed} {' Completed '}
                        </Text>
                        {requiredCount > 0 && <Progress percent={pct} size='small' />}
                    </Space>
                )
            }
        },
        {
            title: 'POE',
            fixed: isMobile ? 'right' : undefined,
            width: 90,
            render: (_: any, record: any) => (
                <Button type='link' onClick={() => setSelectedView(record)}>
                    View
                </Button>
            )
        }
    ]

    // IN-RANGE totals
    const totalInterventions = filteredInterventions.length
    const totalBeneficiaries = new Set(
        filteredInterventions.map(iv => iv._participantId)
    ).size

    const interventionsPerQuarter = records.reduce((acc, rec) => {
        const q = rec.quarter || 'Unknown'
        acc[q] = (acc[q] || 0) + (rec.interventions?.length || 0)
        return acc
    }, {} as Record<string, number>)

    const participantTotals = React.useMemo(() => {
        const m: Record<string, number> = {}
        records.forEach(rec => {
            const pid = rec.participantId
            m[pid] = (m[pid] || 0) + (rec.interventions?.length || 0)
        })
        return m
    }, [records])

    const filterBar = (
        <Row gutter={[16, 16]} align='middle'>
            <Col xs={24} md={8}>
                <Select
                    style={{ width: '100%' }}
                    value={filters.group}
                    onChange={val =>
                        setFilters(prev => ({ ...prev, group: val }))
                    }
                >
                    <Option value='all'>All Groups</Option>
                    {groupOptions.map(g => (
                        <Option key={g} value={g}>
                            {g}
                        </Option>
                    ))}
                </Select>
            </Col>

            <Col xs={24} md={8}>
                <Select
                    style={{ width: '100%' }}
                    value={filters.gender}
                    onChange={val =>
                        setFilters(prev => ({ ...prev, gender: val }))
                    }
                >
                    <Option value='all'>All Genders</Option>
                    {genderOptions.map(g => (
                        <Option key={g} value={g}>
                            {g}
                        </Option>
                    ))}
                </Select>
            </Col>

            <Col xs={24} md={8}>
                <RangePicker
                    style={{ width: '100%' }}
                    onChange={setDateRange}
                    value={dateRange}
                    allowClear
                />
            </Col>
        </Row>
    )

    return (
        <div style={{ padding: 24, height: '100vh' }}>
            <Helmet>
                <title>Interventions Database</title>
            </Helmet>
            {loading ? (
                <LoadingOverlay tip='Loading interventions' />
            ) : (
                <>
                    <Row gutter={[16, 16]} align="stretch" style={{ marginBottom: 10 }}>
                        <Col xs={24} sm={12} md={6}>
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4 }}
                            >
                                <MotionCard>
                                    <MotionCard.Metric
                                        title="Total Beneficiaries"
                                        value={totalBeneficiaries}
                                        icon={<TeamOutlined style={{ fontSize: 18, color: '#722ed1' }} />}
                                        iconBg="rgba(114,46,209,.12)"
                                        subtitle="Beneficiaries in current scope."
                                    />
                                </MotionCard>
                            </motion.div>
                        </Col>

                        <Col xs={24} sm={12} md={6}>
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4, delay: 0.1 }}
                            >
                                <MotionCard>
                                    <MotionCard.Metric
                                        title="Total Interventions"
                                        value={totalInterventions}
                                        icon={<FileDoneOutlined style={{ fontSize: 18, color: '#1890ff' }} />}
                                        iconBg="rgba(24,144,255,.12)"
                                        subtitle="Interventions in filtered range."
                                    />
                                </MotionCard>
                            </motion.div>
                        </Col>

                        <Col xs={24} sm={12} md={6}>
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4, delay: 0.2 }}
                            >
                                <MotionCard>
                                    <Tooltip
                                        title={`${poeCoverage.covered} of ${filteredInterventions.length} interventions have evidence`}
                                    >
                                        <div>
                                            <MotionCard.Metric
                                                title="POE Coverage"
                                                value={`${Number(poeCoverage.pct || 0).toFixed(0)}%`}
                                                icon={<CalendarOutlined style={{ fontSize: 18, color: '#52c41a' }} />}
                                                iconBg="rgba(82,196,26,.12)"
                                                subtitle="Interventions with uploaded evidence."
                                            />
                                        </div>
                                    </Tooltip>
                                </MotionCard>
                            </motion.div>
                        </Col>

                        <Col xs={24} sm={12} md={6}>
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4, delay: 0.3 }}
                            >
                                <MotionCard>
                                    <Tooltip
                                        title={
                                            requiredCompletionAvg.countParticipants
                                                ? `Avg completion across ${requiredCompletionAvg.countParticipants} participants with defined requirements`
                                                : 'No participants with defined completion requirements yet'
                                        }
                                    >
                                        <div>
                                            <MotionCard.Metric
                                                title="Overall Progress"
                                                value={
                                                    requiredCompletionAvg.countParticipants
                                                        ? `${Number(requiredCompletionAvg.avg || 0).toFixed(0)}%`
                                                        : '0%'
                                                }
                                                icon={<BarChartOutlined style={{ fontSize: 18, color: '#fa8c16' }} />}
                                                iconBg="rgba(250,140,22,.12)"
                                                subtitle={
                                                    requiredCompletionAvg.countParticipants
                                                        ? 'Average completion across required items.'
                                                        : 'No completion requirements available yet.'
                                                }
                                            />
                                        </div>
                                    </Tooltip>
                                </MotionCard>
                            </motion.div>
                        </Col>
                    </Row>



                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                    >
                        <MotionCard
                            hoverable
                            filterBar={filterBar}
                            filterBarProps={{
                                background: '#f8fafc',
                                borderColor: '#d9e8ff',
                                borderRadius: 14,
                                boxShadow: 'inset 0 2px 8px rgba(15,23,42,0.05)',
                                padding: 16,
                                marginBottom: 16
                            }}
                            style={{
                                borderRadius: 8,
                                border: '1px solid #bae7ff'
                            }}
                        >
                            <Table
                                columns={columns as any}
                                dataSource={filteredRecords}
                                rowKey={(r: any) => r.id || `${r.participantId}_${r.programId}`}
                                size={isMobile ? 'small' : 'middle'}
                                scroll={{ x: isMobile ? true : undefined }}
                                pagination={{ responsive: true, pageSize: isMobile ? 5 : 10, position: ['bottomCenter'], showSizeChanger: false }}
                            />
                        </MotionCard>
                    </motion.div>

                    <Modal
                        title={`Beneficiary Details: ${participantMap[selectedView?.participantId] || 'Unknown'
                            }`}
                        open={!!selectedView}
                        onCancel={() => {
                            setSelectedView(null)
                            setShowDetails(null)
                            setPassword('')
                            setHasAccess(null)
                        }}
                        footer={[
                            <Button key='close' onClick={() => setSelectedView(null)}>
                                Close
                            </Button>
                        ]}
                        width={900}
                    >
                        {selectedView && (
                            <>
                                <Descriptions
                                    bordered
                                    size='small'
                                    column={1}
                                    style={{ marginBottom: 16 }}
                                >
                                    <Descriptions.Item label='Participant'>
                                        {participantMap[selectedView.participantId] || 'Unknown'}
                                    </Descriptions.Item>
                                    <Descriptions.Item label='Sector'>
                                        {selectedView.sector || 'Not specified'}
                                    </Descriptions.Item>
                                    <Descriptions.Item label='Group'>
                                        {selectedView.group || 'Not specified'}
                                    </Descriptions.Item>
                                    <Descriptions.Item label='Branch'>
                                        {selectedView.branchName || 'Unknown'}
                                    </Descriptions.Item>
                                    <Descriptions.Item label='Gender'>
                                        {selectedView.gender || 'Not specified'}
                                    </Descriptions.Item>
                                    <Descriptions.Item label='Participation Rate'>
                                        {selectedView.participationRate !== undefined
                                            ? `${selectedView.participationRate}%`
                                            : 'Unknown'}
                                    </Descriptions.Item>
                                </Descriptions>

                                <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
                                    <Select
                                        value={modalArea}
                                        style={{ width: '100%' }}
                                        onChange={val => {
                                            setModalArea(val)
                                            setShowDetails(null)
                                            setHasAccess(null)
                                            setPassword('')
                                        }}
                                    >
                                        <Option value='all'>All Areas</Option>
                                        {Array.from(
                                            new Set(
                                                (selectedView.interventions || []).map(
                                                    (i: any) => i.areaOfSupport || 'Unknown'
                                                )
                                            )
                                        )
                                            .sort()
                                            .map(area => (
                                                <Option key={area} value={area}>
                                                    {area}
                                                </Option>
                                            ))}
                                    </Select>
                                </div>

                                <Divider>{`Completed Interventions (${selectedView.interventions?.filter((i: any) =>
                                    modalArea === 'all'
                                        ? true
                                        : (i.areaOfSupport || 'Unknown') === modalArea
                                ).length || 0
                                    })`}</Divider>

                                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                    <ul>
                                        {[...(selectedView.interventions || [])]
                                            .filter((item: any) =>
                                                modalArea === 'all'
                                                    ? true
                                                    : (item.areaOfSupport || 'Unknown') === modalArea
                                            )
                                            .map((item: any, index: number) => (
                                                <li key={index} style={{ marginBottom: 12 }}>
                                                    <Space direction='vertical'>
                                                        {(() => {
                                                            const deptId =
                                                                item.departmentId ||
                                                                deptIdByInterventionId[
                                                                String(item.interventionId)
                                                                ] ||
                                                                null
                                                            const deptName = deptId
                                                                ? deptNameById[deptId]
                                                                : undefined

                                                            return (
                                                                <Text strong>
                                                                    {(() => {
                                                                        const iid = String(
                                                                            item.interventionId || ''
                                                                        )
                                                                        const depId =
                                                                            item.departmentId ||
                                                                            (iid
                                                                                ? deptIdByInterventionId[iid]
                                                                                : undefined)
                                                                        const depName = depId
                                                                            ? deptNameById[depId]
                                                                            : undefined

                                                                        return `${item.interventionTitle || 'Untitled'
                                                                            }${depName ? ` (${depName})` : ''}`
                                                                    })()}
                                                                </Text>
                                                            )
                                                        })()}
                                                        <Button
                                                            type='link'
                                                            onClick={() => {
                                                                setPassword('')
                                                                if (showDetails === item.id) {
                                                                    setShowDetails(null)
                                                                    setHasAccess(null)
                                                                } else {
                                                                    setShowDetails(item.id)
                                                                    setHasAccess(null)
                                                                }
                                                            }}
                                                        >
                                                            {showDetails === item.id
                                                                ? 'Hide details'
                                                                : `🔑 ${item.interventionKey}`}
                                                        </Button>
                                                    </Space>

                                                    {showDetails === item.id && (
                                                        <div style={{ marginTop: 8 }}>
                                                            {hasAccess === item.id ? (
                                                                <>
                                                                    <Divider />
                                                                    <Descriptions
                                                                        bordered
                                                                        column={1}
                                                                        size='small'
                                                                        style={{ marginTop: 16 }}
                                                                    >
                                                                        <Descriptions.Item label='Completed At'>
                                                                            {(() => {
                                                                                const d = getInterventionDate(item)
                                                                                return d
                                                                                    ? d.format('YYYY-MM-DD')
                                                                                    : 'Unknown'
                                                                            })()}
                                                                        </Descriptions.Item>
                                                                        <Descriptions.Item label='Consultants'>
                                                                            {(item.consultantIds || []).length > 0 ? (
                                                                                (item.consultantIds || []).map(
                                                                                    (id: string) => {
                                                                                        const consultant = consultantMap[id]
                                                                                        const name = consultant?.name || id
                                                                                        const type =
                                                                                            consultant?.type || 'Unknown'
                                                                                        return (
                                                                                            <>
                                                                                                {name}
                                                                                                <Tag
                                                                                                    key={id}
                                                                                                    color='blue'
                                                                                                    style={{ marginLeft: 10 }}
                                                                                                >
                                                                                                    ({type})
                                                                                                </Tag>
                                                                                            </>
                                                                                        )
                                                                                    }
                                                                                )
                                                                            ) : (
                                                                                <Text type='secondary'>None</Text>
                                                                            )}
                                                                        </Descriptions.Item>

                                                                        <Descriptions.Item label='Time Spent'>
                                                                            {Array.isArray(item.timeSpent)
                                                                                ? item.timeSpent.join(', ')
                                                                                : item.timeSpent || 'N/A'}{' '}
                                                                            hrs
                                                                        </Descriptions.Item>

                                                                        <Descriptions.Item
                                                                            label={
                                                                                isSummaryDept(item.areaOfSupport)
                                                                                    ? 'Summary'
                                                                                    : 'POE'
                                                                            }
                                                                        >
                                                                            {isSummaryDept(item.areaOfSupport) ? (
                                                                                (() => {
                                                                                    const summary =
                                                                                        item.resources?.find(
                                                                                            (r: any) =>
                                                                                                r.type === 'summary' &&
                                                                                                r.context
                                                                                        ) ||
                                                                                        item.resources?.find((r: any) =>
                                                                                            String(r.label || '')
                                                                                                .toLowerCase()
                                                                                                .includes('summary')
                                                                                        )

                                                                                    return summary ? (
                                                                                        <Button
                                                                                            type='link'
                                                                                            onClick={() =>
                                                                                                setSummaryModal({
                                                                                                    title: item.interventionTitle,
                                                                                                    context:
                                                                                                        summary.context ||
                                                                                                        'No summary text provided.'
                                                                                                })
                                                                                            }
                                                                                        >
                                                                                            📄 View Summary
                                                                                        </Button>
                                                                                    ) : (
                                                                                        <Text type='secondary'>
                                                                                            No Summary Provided
                                                                                        </Text>
                                                                                    )
                                                                                })()
                                                                            ) : item.resources?.length ? (
                                                                                <ul
                                                                                    style={{
                                                                                        paddingLeft: 20,
                                                                                        marginBottom: 0
                                                                                    }}
                                                                                >
                                                                                    {item.resources.map(
                                                                                        (res: any, i: number) => (
                                                                                            <li key={i}>
                                                                                                <a
                                                                                                    href={res.link}
                                                                                                    target='_blank'
                                                                                                    rel='noopener noreferrer'
                                                                                                >
                                                                                                    {res.label ||
                                                                                                        `Resource ${i + 1}`}
                                                                                                </a>
                                                                                            </li>
                                                                                        )
                                                                                    )}
                                                                                </ul>
                                                                            ) : (
                                                                                'None'
                                                                            )}
                                                                        </Descriptions.Item>
                                                                    </Descriptions>
                                                                </>
                                                            ) : (
                                                                <Space
                                                                    direction='horizontal'
                                                                    style={{
                                                                        width: '100%'
                                                                    }}
                                                                >
                                                                    <Input.Password
                                                                        placeholder='Enter password'
                                                                        value={password}
                                                                        onChange={e => setPassword(e.target.value)}
                                                                        onPressEnter={() => {
                                                                            const auth = getAuth()
                                                                            const user = auth.currentUser
                                                                            if (!user || !user.email) {
                                                                                notification.error({
                                                                                    message: 'No user logged in'
                                                                                })
                                                                                return
                                                                            }
                                                                            const credential =
                                                                                EmailAuthProvider.credential(
                                                                                    user.email,
                                                                                    password
                                                                                )
                                                                            reauthenticateWithCredential(
                                                                                user,
                                                                                credential
                                                                            )
                                                                                .then(() => {
                                                                                    setHasAccess(item.id)
                                                                                    setPassword('')
                                                                                })
                                                                                .catch(() => {
                                                                                    notification.error({
                                                                                        message: 'Incorrect password'
                                                                                    })
                                                                                    setPassword('')
                                                                                })
                                                                        }}
                                                                    />
                                                                    <Space direction='horizontal'>
                                                                        <Button
                                                                            type='primary'
                                                                            onClick={() => {
                                                                                const auth = getAuth()
                                                                                const user = auth.currentUser
                                                                                if (!user || !user.email) {
                                                                                    notification.error({
                                                                                        message: 'No user logged in'
                                                                                    })
                                                                                    return
                                                                                }
                                                                                const credential =
                                                                                    EmailAuthProvider.credential(
                                                                                        user.email,
                                                                                        password
                                                                                    )
                                                                                reauthenticateWithCredential(
                                                                                    user,
                                                                                    credential
                                                                                )
                                                                                    .then(() => {
                                                                                        setHasAccess(item.id)
                                                                                        setPassword('')
                                                                                    })
                                                                                    .catch(() => {
                                                                                        notification.error({
                                                                                            message: 'Incorrect password'
                                                                                        })
                                                                                        setPassword('')
                                                                                    })
                                                                            }}
                                                                        >
                                                                            Reveal Details
                                                                        </Button>

                                                                        <Button
                                                                            type='primary'
                                                                            danger
                                                                            onClick={() => {
                                                                                setShowDetails(null)
                                                                                setHasAccess(null)
                                                                                setPassword('')
                                                                            }}
                                                                        >
                                                                            Cancel
                                                                        </Button>
                                                                    </Space>
                                                                </Space>
                                                            )}
                                                        </div>
                                                    )}
                                                </li>
                                            ))}
                                    </ul>
                                </div>
                            </>
                        )}
                    </Modal>

                    <Modal
                        open={!!summaryModal}
                        onCancel={() => setSummaryModal(null)}
                        title={`${summaryModal?.title || ''} Summary`}
                        footer={[
                            <Button key='close' onClick={() => setSummaryModal(null)}>
                                Close
                            </Button>
                        ]}
                        width={700}
                    >
                        <div
                            style={{
                                whiteSpace: 'pre-wrap',
                                maxHeight: '60vh',
                                overflowY: 'auto',
                                paddingRight: 8
                            }}
                        >
                            {summaryModal?.context}
                        </div>
                    </Modal>
                </>
            )}
        </div>
    )
}

export default InterventionDatabaseView
