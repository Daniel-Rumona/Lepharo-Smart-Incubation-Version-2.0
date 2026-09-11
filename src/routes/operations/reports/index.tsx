import React, { useEffect, useMemo, useState } from 'react'
import {
    Card,
    Typography,
    Button,
    Row,
    Col,
    DatePicker,
    Select,
    Form,
    Divider,
    Modal,
    Drawer,
    Space,
    Tag,
    Empty,
    InputNumber
} from 'antd'
import { FilterOutlined, FullscreenOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import { Helmet } from 'react-helmet'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import HighchartsMore from 'highcharts/highcharts-more'
import HighchartsFunnel from 'highcharts/modules/funnel'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    collection,
    onSnapshot,
    query,
    where,
    Timestamp,
    getDocs
} from 'firebase/firestore'
import { db } from '@/firebase'
import { DashboardHeaderCard } from '@/components/dashboards/metrics/Header'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { filterReportRecords, loadReportVisibilityContext } from '@/utils/reportVisibility'

dayjs.extend(isoWeek)
if (typeof HighchartsMore === 'function') HighchartsMore(Highcharts)
if (typeof HighchartsFunnel === 'function') HighchartsFunnel(Highcharts)

const { Title, Text } = Typography
const { RangePicker } = DatePicker
const { Option } = Select

type TimePeriod = 'week' | 'month' | 'quarter' | 'year' | 'custom'
const timePeriods: { value: TimePeriod; label: string }[] = [
    { value: 'week', label: 'Weekly' },
    { value: 'month', label: 'Monthly' },
    { value: 'quarter', label: 'Quarterly' },
    { value: 'year', label: 'Yearly' },
    { value: 'custom', label: 'Custom Range' }
]

function getRange(tp: TimePeriod, custom?: [dayjs.Dayjs, dayjs.Dayjs] | null) {
    if (tp === 'custom' && custom) return custom
    const now = dayjs()
    switch (tp) {
        case 'week':
            return [now.startOf('isoWeek'), now.endOf('isoWeek')] as [
                dayjs.Dayjs,
                dayjs.Dayjs
            ]
        case 'quarter':
            return [now.startOf('quarter'), now.endOf('quarter')] as [
                dayjs.Dayjs,
                dayjs.Dayjs
            ]
        case 'year':
            return [now.startOf('year'), now.endOf('year')] as [
                dayjs.Dayjs,
                dayjs.Dayjs
            ]
        case 'month':
        default:
            return [now.startOf('month'), now.endOf('month')] as [
                dayjs.Dayjs,
                dayjs.Dayjs
            ]
    }
}

// ---------------- Types ----------------
type ApplicationIntervention = {
    area?: string
    status?: 'required' | 'assigned' | 'in_progress' | 'completed'
}

type Application = {
    id: string
    programName: string
    applicationStatus:
    | 'submitted'
    | 'accepted'
    | 'rejected'
    | 'withdrawn'
    | 'pending'
    participantId?: string | null
    createdAt?: Timestamp
    gapGroup?: 'A' | 'B' | 'C' | string
    gender?: 'Male' | 'Female' | 'Other' | 'Unspecified' | string
    interventions?:
    | ApplicationIntervention[]
    | Record<string, ApplicationIntervention>
    | ApplicationIntervention
    | null
}

type Participant = {
    id: string
    name?: string
    programName?: string
    createdAt?: Timestamp
    beeLevel?: number | string
    blackOwnedPercent?: number
    femaleOwnedPercent?: number
    youthOwnedPercent?: number
    gender?: string
    idNumber?: string
    sector?: string
    ward?: string
}



type BucketItem = {
    id?: string
    title?: string
    area?: string
}

type InterventionsBuckets = {
    required?: BucketItem[] | Record<string, BucketItem>
    assigned?: BucketItem[] | Record<string, BucketItem>
    completed?: BucketItem[] | Record<string, BucketItem>
    participationRate?: number
}

// ---------------- Helpers ----------------
const ChartCard: React.FC<{ title: string; children: React.ReactNode }> = ({
    title,
    children
}) => {
    const [open, setOpen] = useState(false)
    return (
        <>
            <Card
                title={title}
                extra={
                    <Button
                        type='link'
                        icon={<FullscreenOutlined />}
                        iconPosition='end'
                        onClick={() => setOpen(true)}
                    >
                        Expand
                    </Button>
                }
                style={{
                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                    transition: 'all 0.3s ease',
                    borderRadius: 12,
                    border: '1px solid #d6e4ff'
                }}
            >
                {children}
            </Card>
            <Modal
                open={open}
                onCancel={() => setOpen(false)}
                footer={null}
                width='80%'
                style={{ top: 40 }}
            >
                <Title level={4}>{title}</Title>
                {children}
            </Modal>
        </>
    )
}

const DataOrEmpty: React.FC<{
    hasData: boolean
    children: React.ReactNode
}> = ({ hasData, children }) => {
    if (!hasData) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
    return <>{children}</>
}

const hasSeriesData = (
    ...arrs: Array<
        number[] | [string, number][] | { y: number }[] | undefined | null
    >
): boolean => {
    return arrs.some(a => {
        if (!a || !a.length) return false
        const flat = (a as any[]).flat()
        return flat.some((v: any) => {
            if (Array.isArray(v)) return Number(v[1]) > 0
            if (typeof v === 'object' && v && 'y' in v) return Number(v.y) > 0
            return Number(v) > 0
        })
    })
}

const coerceBeeLevel = (v: unknown): number | null => {
    if (v == null) return null
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') {
        const m = v.match(/\d+/)
        if (m) return Number(m[0])
    }
    return null
}

export function toArray<T>(v: T[] | Record<string, T> | undefined | null): T[] {
    if (!v) return []
    if (Array.isArray(v)) return v.filter(Boolean)
    if (typeof v === 'object') return Object.values(v).filter(Boolean)
    return []
}

// flatten the 3 buckets and attach a status to each item
const flattenBuckets = (b: InterventionsBuckets | null | undefined) => {
    const req = toArray<BucketItem>(b?.required).map(iv => ({
        ...iv,
        status: 'required' as const
    }))
    const asg = toArray<BucketItem>(b?.assigned).map(iv => ({
        ...iv,
        status: 'assigned' as const
    }))
    const cmp = toArray<BucketItem>(b?.completed).map(iv => ({
        ...iv,
        status: 'completed' as const
    }))
    return [...req, ...asg, ...cmp]
}

// ---- derive age from SA ID number (participants) ----
const getAgeFromID = (id?: string): number | null => {
    const s = (id || '').trim()
    if (!/^\d{6}/.test(s)) return null
    const yy = parseInt(s.slice(0, 2), 10)
    const mm = parseInt(s.slice(2, 4), 10) - 1
    const dd = parseInt(s.slice(4, 6), 10)
    const currentYear = new Date().getFullYear()
    const century = yy <= currentYear % 100 ? 2000 : 1900
    const birthDate = new Date(century + yy, mm, dd)
    if (isNaN(birthDate.getTime())) return null
    const today = new Date()
    let age = today.getFullYear() - birthDate.getFullYear()
    const m = today.getMonth() - birthDate.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--
    return age
}

const normalize = (s?: string) => (s || '').toString().trim().toLowerCase()

const toDate = (v: any): Date | null => {
    if (!v) return null
    if (typeof v.toDate === 'function') return v.toDate()
    if (typeof v.seconds === 'number') {
        const ms = v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6)
        return new Date(ms)
    }
    if (typeof v._seconds === 'number') {
        const ms = v._seconds * 1000 + Math.floor((v._nanoseconds || 0) / 1e6)
        return new Date(ms)
    }
    if (typeof v === 'number') return new Date(v)
    if (typeof v === 'string') {
        const d = new Date(v)
        return isNaN(d.getTime()) ? null : d
    }
    if (v instanceof Date) return v
    return null
}

const fmtMonth = (d: Date) => dayjs(d).format('YYYY-MM')
const monthLabel = (ym: string) => dayjs(`${ym}-01`).format('MMM YYYY')


// ---------------- Component ----------------
type CohortMode = 'accepted' | 'applied'

const OperationsReports: React.FC = () => {
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()

    // Filters
    const [timePeriod, setTimePeriod] = useState<TimePeriod>('month')
    const [customDateRange, setCustomDateRange] = useState<
        [dayjs.Dayjs, dayjs.Dayjs] | null
    >(null)
    const [advOpen, setAdvOpen] = useState(false)

    // Advanced filters (participants)
    const [advBeeLevels, setAdvBeeLevels] = useState<number[]>([])
    const [advBlackOwnedRange, setAdvBlackOwnedRange] = useState<
        [number | undefined, number | undefined]
    >([undefined, undefined])
    const [advFemaleOwnedRange, setAdvFemaleOwnedRange] = useState<
        [number | undefined, number | undefined]
    >([undefined, undefined])
    const [advYouthOwnedRange, setAdvYouthOwnedRange] = useState<
        [number | undefined, number | undefined]
    >([undefined, undefined])

    // Cohort selector (default accepted)
    const [cohortMode, setCohortMode] = useState<CohortMode>('accepted')

    const [form] = Form.useForm()
    const [start, end] = useMemo(
        () => getRange(timePeriod, customDateRange),
        [timePeriod, customDateRange]
    )

    // Data
    const [applications, setApplications] = useState<Application[]>([])
    const [participants, setParticipants] = useState<Participant[]>([])
    // For manuallyCreated applications: GAP & Pre-Inc status from complianceDocuments
    const [manualComplianceMap, setManualComplianceMap] = useState<
        Record<string, { gapSigned: boolean; preSigned: boolean }>
    >({})


    useEffect(() => {
        let cancelled = false

        // accepted + manual (manuallyCreated)
        const manualAccepted = applications.filter(a => {
            const isManual = (a as any).manuallyCreated
            return a.applicationStatus === 'accepted' && isManual
        })

        if (!manualAccepted.length) {
            if (!cancelled) setManualComplianceMap({})
            return
        }

        const fetchCompliance = async () => {
            const result: Record<
                string,
                { gapSigned: boolean; preSigned: boolean }
            > = {}

            for (const app of manualAccepted) {
                try {
                    const snap = await getDocs(
                        collection(db, 'applications', app.id, 'complianceDocuments')
                    )

                    let gapSigned = false
                    let preSigned = false

                    snap.forEach(docSnap => {
                        const data = docSnap.data() as any

                        const slug = String(
                            data.slug || data.docType || data.type || ''
                        ).toLowerCase()

                        const status = String(
                            data.status || data.verificationStatus || ''
                        ).toLowerCase()
                        const isValid =
                            !status ||
                            ['valid', 'approved', 'verified', 'active', 'pending'].includes(status)

                        if (!isValid) return

                        if (slug.includes('gap') && slug.includes('analysis')) {
                            gapSigned = true
                        }
                        if (
                            slug.includes('pre') &&
                            (slug.includes('incubation') || slug.includes('incubation-contract'))
                        ) {
                            preSigned = true
                        }
                    })

                    result[app.id] = { gapSigned, preSigned }
                } catch (err) {
                    console.error(
                        'Failed to load complianceDocuments for app',
                        app.id,
                        err
                    )
                }
            }

            if (!cancelled) {
                console.log('Result:', result)
                setManualComplianceMap(result)
            }
        }

        fetchCompliance()

        return () => {
            cancelled = true
        }
    }, [applications])


    // Unified agreement checker: normal apps use signedAgreements,
    // manuallyCreated apps use complianceDocuments via manualComplianceMap
    const hasAgreement = (app: any, slug: string): boolean => {
        if (!app) return false

        const isManual = app.manuallyCreated

        if (isManual) {
            const flags =
                manualComplianceMap[app.id] || { gapSigned: false, preSigned: false }

            if (slug === 'gap-analysis') return !!flags.gapSigned
            if (slug === 'pre-incubation-contract') return !!flags.preSigned
            return false
        }

        const m = app.signedAgreements || {}
        return Object.keys(m).some(k => k.toLowerCase() === slug)
    }


    // Subscribe to applications (filtered by company + active programId)
    useEffect(() => {
        if (!activeProgramId) return

        const appsQ = query(
            collection(db, 'applications'),
            where('programId', '==', activeProgramId)
        )

        const unsubApps = onSnapshot(appsQ, snap => {
            void loadReportVisibilityContext(user?.email).then(context => {
                setApplications(filterReportRecords(
                    snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })),
                    user?.email,
                    context
                ) as Application[])
            })
        })

        return () => unsubApps()
    }, [activeProgramId])

    const participantById = useMemo(() => {
        const map = new Map<string, Participant>()
        participants.forEach(p => map.set(p.id, p))
        return map
    }, [participants])

    // Filter apps by time window only (program already enforced at query level)
    const timeFilteredApps = useMemo(() => {
        return applications.filter(a => {
            const createdDate = toDate((a as any).createdAt)

            if (createdDate) {
                const t = dayjs(createdDate)
                if (!t.isBetween(start, end, 'day', '[]')) return false
            }

            return true
        })
    }, [applications, start, end])

    // Accepted apps subset (still time-filtered)
    const acceptedApps = useMemo(
        () => timeFilteredApps.filter(a => a.applicationStatus === 'accepted'),
        [timeFilteredApps]
    )

    // Onboarded apps (accepted) within time window
    const onboardedAppsInRange = useMemo(
        () => timeFilteredApps.filter(a => a.applicationStatus === 'accepted'),
        [timeFilteredApps]
    )

    // Months between start and end (for monthly charts)
    const months = useMemo(() => {
        const arr: string[] = []
        let cur = start.startOf('month')
        const last = end.endOf('month')
        while (cur.isBefore(last) || cur.isSame(last, 'month')) {
            arr.push(cur.format('YYYY-MM'))
            cur = cur.add(1, 'month')
        }
        return arr
    }, [start, end])

    // Onboarded vs Signed Docs (monthly)
    const onboardedVsSigned = useMemo(() => {
        const onboardedMap: Record<string, number> = {}
        const gapMap: Record<string, number> = {}
        const preMap: Record<string, number> = {}

        const monthKeys = months.length
            ? months
            : Array.from(
                new Set(
                    onboardedAppsInRange
                        .map(a => toDate((a as any).submittedAt))
                        .filter(Boolean)
                        .map(d => fmtMonth(d as Date))
                )
            ).sort()

        onboardedAppsInRange.forEach(a => {
            const d = toDate((a as any).submittedAt)
            if (!d) return
            const k = fmtMonth(d)
            onboardedMap[k] = (onboardedMap[k] || 0) + 1

            if (hasAgreement(a, 'gap-analysis'))
                gapMap[k] = (gapMap[k] || 0) + 1

            if (hasAgreement(a, 'pre-incubation-contract'))
                preMap[k] = (preMap[k] || 0) + 1
        })

        return {
            categories: monthKeys.map(monthLabel),
            onboarded: monthKeys.map(m => onboardedMap[m] || 0),
            gapSigned: monthKeys.map(m => gapMap[m] || 0),
            preSigned: monthKeys.map(m => preMap[m] || 0)
        }
    }, [months, onboardedAppsInRange, manualComplianceMap])


    const onboardedVsSignedHasData =
        onboardedVsSigned.onboarded.some(v => v > 0) ||
        onboardedVsSigned.gapSigned.some(v => v > 0) ||
        onboardedVsSigned.preSigned.some(v => v > 0)

    // Outstanding docs pie (GAP + Pre-incubation)
    const outstandingPieData = useMemo(() => {
        const onboardedTotal = onboardedAppsInRange.length

        const gapSignedTotal = onboardedAppsInRange.reduce(
            (s, a) => s + (hasAgreement(a, 'gap-analysis') ? 1 : 0),
            0
        )

        const preSignedTotal = onboardedAppsInRange.reduce(
            (s, a) =>
                s + (hasAgreement(a, 'pre-incubation-contract') ? 1 : 0),
            0
        )

        return [
            {
                name: 'GAP Analysis Pending',
                y: Math.max(0, onboardedTotal - gapSignedTotal)
            },
            {
                name: 'Pre-Incubation Pending',
                y: Math.max(0, onboardedTotal - preSignedTotal)
            }
        ]
    }, [onboardedAppsInRange, manualComplianceMap])


    const outstandingPieHasData = outstandingPieData.some(p => p.y > 0)


    // Subscribe to participants by email (batched 'in' queries)
    useEffect(() => {
        const sourceApps =
            cohortMode === 'accepted' ? acceptedApps : timeFilteredApps

        const emailSet = new Set(
            sourceApps
                .map(a =>
                    String((a as any).email || '')
                        .trim()
                        .toLowerCase()
                )
                .filter(Boolean)
        )
        const emails = Array.from(emailSet)

        if (emails.length === 0) {
            setParticipants([])
            return
        }

        const batches: string[][] = []
        for (let i = 0; i < emails.length; i += 10) {
            batches.push(emails.slice(i, i + 10))
        }

        setParticipants([])
        const accByEmail = new Map<string, any>()
        const unsubs = batches.map(batch => {
            const qy = query(
                collection(db, 'participants'),
                where('email', 'in', batch)
            )
            return onSnapshot(qy, snap => {
                snap.docs.forEach(d => {
                    const data = d.data() as any
                    const e = String(data.email || '').toLowerCase()
                    if (e && filterReportRecords([{ id: d.id, ...data }], user?.email).length) {
                        accByEmail.set(e, { id: d.id, ...data })
                    }
                })
                setParticipants(Array.from(accByEmail.values()))
            })
        })

        return () => {
            unsubs.forEach(fn => fn())
        }
    }, [cohortMode, timeFilteredApps, acceptedApps, user?.email])

    // Are advanced filters active?
    const advActive = useMemo(() => {
        const [bMin, bMax] = advBlackOwnedRange
        const [fMin, fMax] = advFemaleOwnedRange
        const [yMin, yMax] = advYouthOwnedRange
        return (
            advBeeLevels.length > 0 ||
            bMin != null ||
            bMax != null ||
            fMin != null ||
            fMax != null ||
            yMin != null ||
            yMax != null
        )
    }, [
        advBeeLevels,
        advBlackOwnedRange,
        advFemaleOwnedRange,
        advYouthOwnedRange
    ])

    // Apply advanced filters ONLY if active (accepted only)
    const acceptedAppsFiltered = useMemo(() => {
        if (!advActive) return acceptedApps

        const inRange = (val: number | undefined, min?: number, max?: number) => {
            if (typeof val !== 'number') return false
            if (typeof min === 'number' && val < min) return false
            if (typeof max === 'number' && val > max) return false
            return true
        }

        const [bMin, bMax] = advBlackOwnedRange
        const [fMin, fMax] = advFemaleOwnedRange
        const [yMin, yMax] = advYouthOwnedRange

        return acceptedApps.filter(a => {
            if (!a.participantId) return false
            const p = participantById.get(a.participantId)
            if (!p) return false

            const pBee = coerceBeeLevel(p.beeLevel)
            if (advBeeLevels.length > 0) {
                if (pBee == null) return false
                if (!advBeeLevels.includes(pBee)) return false
            }

            if (
                (bMin != null || bMax != null) &&
                !inRange(p.blackOwnedPercent, bMin, bMax)
            )
                return false
            if (
                (fMin != null || fMax != null) &&
                !inRange(p.femaleOwnedPercent, fMin, fMax)
            )
                return false
            if (
                (yMin != null || yMax != null) &&
                !inRange(p.youthOwnedPercent, yMin, yMax)
            )
                return false

            return true
        })
    }, [
        acceptedApps,
        advActive,
        participantById,
        advBeeLevels,
        advBlackOwnedRange,
        advFemaleOwnedRange,
        advYouthOwnedRange
    ])

    // participants filtered by time (for cohortMode=applied)
    const participantsFiltered = useMemo(() => {
        return participants.filter(p => {
            const createdDate = toDate((p as any).createdAt)

            if (createdDate) {
                const t = dayjs(createdDate)
                if (!t.isBetween(start, end, 'day', '[]')) return false
            }

            return true
        })
    }, [participants, start, end])

    // Build the cohort that drives gender/age/ownership charts
    const cohortParticipants = useMemo(() => {
        if (cohortMode === 'applied') {
            return participantsFiltered
        }
        const ids = new Set(
            acceptedAppsFiltered.map(a => a.participantId).filter(Boolean) as string[]
        )
        return Array.from(ids)
            .map(id => participantById.get(id))
            .filter(Boolean) as Participant[]
    }, [cohortMode, participantsFiltered, acceptedAppsFiltered, participantById])

    // ---------------- Demographics (from PARTICIPANTS cohort) ----------------
    const genderCounts = useMemo(() => {
        const c: Record<string, number> = {}
        cohortParticipants.forEach((p: any) => {
            const g = String(p.gender || 'Unspecified')
            c[g] = (c[g] || 0) + 1
        })
        return Object.entries(c).map(([name, y]) => ({ name, y }))
    }, [cohortParticipants])

    const ageBuckets = [
        { label: '15–24', min: 15, max: 24 },
        { label: '25–34', min: 25, max: 34 },
        { label: '35–44', min: 35, max: 44 },
        { label: '45–54', min: 45, max: 54 },
        { label: '55–64', min: 55, max: 64 },
        { label: '65+', min: 65, max: 200 }
    ]

    const pyramidData = useMemo(() => {
        const categories = ageBuckets.map(b => b.label)
        const male = ageBuckets.map(
            b =>
                cohortParticipants.filter((p: any) => {
                    const g = String(p.gender || '').toLowerCase()
                    const age = getAgeFromID(p.idNumber) ?? -1
                    return g === 'male' && age >= b.min && age <= b.max
                }).length
        )
        const female = ageBuckets.map(
            b =>
                cohortParticipants.filter((p: any) => {
                    const g = String(p.gender || '').toLowerCase()
                    const age = getAgeFromID(p.idNumber) ?? -1
                    return g === 'female' && age >= b.min && age <= b.max
                }).length
        )
        return { categories, male, female }
    }, [cohortParticipants])

    // Group distribution (accepted only)
    const groupCounts = useMemo(() => {
        const c: Record<string, number> = { A: 0, B: 0, C: 0, Unspecified: 0 }
        acceptedAppsFiltered.forEach(a => {
            const g = (a.gapGroup || 'Unspecified').toString().toUpperCase()
            if (g === 'A' || g === 'B' || g === 'C') c[g]++
            else c.Unspecified++
        })
        return [
            { name: 'Group A', y: c.A },
            { name: 'Group B', y: c.B },
            { name: 'Group C', y: c.C },
            { name: 'Unspecified', y: c.Unspecified }
        ].filter(d => d.y > 0 || c.A + c.B + c.C + c.Unspecified === 0)
    }, [acceptedAppsFiltered])
    // SME Sector distribution (from applications.profile.*)
    // SME Sector distribution (via participantId → participants.sector)
    const sectorCounts = useMemo(() => {
        const counts: Record<string, number> = {}

        acceptedAppsFiltered.forEach(a => {
            if (!a.participantId) return
            const p = participantById.get(a.participantId)
            if (!p) return

            let sector: any = (p as any).sector
            if (Array.isArray(sector)) sector = sector[0] // always take first if array

            const key =
                (sector ?? 'Unspecified').toString().trim() || 'Unspecified'

            counts[key] = (counts[key] || 0) + 1
        })

        return Object.entries(counts).map(([name, y]) => ({ name, y }))
    }, [acceptedAppsFiltered, participantById])

    // Ward / Hub distribution:
    // 1) application.profile first value
    // 2) application.ward
    // 3) application.hub
    // 4) participant.ward
    // 5) participant.hub
    const wardCounts = useMemo(() => {
        const counts: Record<string, number> = {}

        acceptedAppsFiltered.forEach(a => {
            let ward: any = undefined

            // 1️⃣ application.profile (first value)
            const profile = (a as any).profile
            if (profile && typeof profile === 'object') {
                const vals = Object.values(profile)
                if (vals.length && vals[0]) ward = vals[0]
            }

            // 2️⃣ application.ward
            if (!ward) {
                let appWard: any = (a as any).ward
                if (Array.isArray(appWard)) appWard = appWard[0]
                if (appWard) ward = appWard
            }

            // 3️⃣ application.hub
            if (!ward) {
                let appHub: any = (a as any).hub
                if (Array.isArray(appHub)) appHub = appHub[0]
                if (appHub) ward = appHub
            }

            // 4️⃣ / 5️⃣ participant.ward / participant.hub
            if (!ward && a.participantId) {
                const p = participantById.get(a.participantId)
                if (p) {
                    let pWard: any = (p as any).ward
                    if (Array.isArray(pWard)) pWard = pWard[0]

                    let pHub: any = (p as any).hub
                    if (Array.isArray(pHub)) pHub = pHub[0]

                    ward = pWard || pHub
                }
            }

            const key =
                (ward ?? 'Unspecified').toString().trim() || 'Unspecified'

            counts[key] = (counts[key] || 0) + 1
        })

        return Object.entries(counts).map(([name, y]) => ({ name, y }))
    }, [acceptedAppsFiltered, participantById])




    // Gap Analysis & Funnel (accepted only)
    const gapAnalysis = useMemo(() => {
        const byArea: Record<
            string,
            { required: number; assigned: number; completed: number }
        > = {}

        acceptedAppsFiltered.forEach(a => {
            const items = flattenBuckets(a.interventions as any)
            items.forEach(iv => {
                const area = iv.area || iv.areaOfSupport || 'Unspecified'
                if (iv.area) { }
                else {
                    console.log('No area:', iv)
                }
                if (!byArea[area]) {
                    byArea[area] = { required: 0, assigned: 0, completed: 0 }
                }
                if (iv.status === 'completed') byArea[area].completed++
                else if (iv.status === 'assigned') byArea[area].assigned++
                else byArea[area].required++
            })
        })

        const areas = Object.keys(byArea).filter(
            k =>
                byArea[k].required > 0 ||
                byArea[k].assigned > 0 ||
                byArea[k].completed > 0
        )
        console.log('Areas', areas)

        return {
            areas,
            required: areas.map(k => byArea[k].required),
            assigned: areas.map(k => byArea[k].assigned),
            completed: areas.map(k => byArea[k].completed)
        }
    }, [acceptedAppsFiltered])

    const funnelSeries = useMemo(() => {
        const submitted = timeFilteredApps.length
        const accepted = timeFilteredApps.filter(
            a => a.applicationStatus === 'accepted'
        ).length

        let assignedCount = 0
        let completedCount = 0

        acceptedAppsFiltered.forEach(a => {
            const b = a.interventions as InterventionsBuckets | undefined
            assignedCount += toArray(b?.assigned).length
            completedCount += toArray(b?.completed).length
        })

        return [
            ['Applications Submitted', submitted],
            ['Accepted', Math.min(accepted, submitted)],
            ['Interventions Assigned', Math.min(assignedCount, accepted)],
            ['Interventions Completed', Math.min(completedCount, assignedCount)]
        ].filter(([_, v]) => v > 0) as [string, number][]
    }, [timeFilteredApps, acceptedAppsFiltered])

    // Ownership (participants cohort)
    const ownershipAverages = useMemo(() => {
        const vals = cohortParticipants as any[]
        const avg = (
            key: 'blackOwnedPercent' | 'femaleOwnedPercent' | 'youthOwnedPercent'
        ) => {
            const arr = vals
                .map(v => Number(v?.[key]))
                .filter(n => Number.isFinite(n))
            if (!arr.length) return 0
            const sum = arr.reduce((a, b) => a + b, 0)
            return Math.max(
                0,
                Math.min(100, Math.round((sum / arr.length) * 10) / 10)
            )
        }
        return {
            black: avg('blackOwnedPercent'),
            female: avg('femaleOwnedPercent'),
            youth: avg('youthOwnedPercent')
        }
    }, [cohortParticipants])

    // ---------------- Charts ----------------

    const onboardedVsSignedOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: 'column', height: 320 },
            title: { text: 'Onboarded vs Signed Documents (Monthly)' },
            credits: { enabled: false },
            xAxis: { categories: onboardedVsSigned.categories },
            yAxis: { min: 0, allowDecimals: false, title: { text: 'Count' } },
            tooltip: { shared: true },
            plotOptions: {
                column: {
                    borderRadius: 4,
                    dataLabels: { enabled: true }
                }
            },
            series: [
                { type: 'column', name: 'Onboarded', data: onboardedVsSigned.onboarded },
                { type: 'column', name: 'GAP Signed', data: onboardedVsSigned.gapSigned },
                {
                    type: 'column',
                    name: 'Pre-Incubation Signed',
                    data: onboardedVsSigned.preSigned
                }
            ]
        }),
        [onboardedVsSigned]
    )

    const outstandingDocsPieOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: 'pie', height: 320 },
            // 🔹 Let the Card provide the title – keep this empty
            title: { text: '' },
            credits: { enabled: false },
            // 🔹 Force axes off in case of leftover config
            xAxis: { visible: false },
            yAxis: { visible: false },
            tooltip: { pointFormat: '<b>{point.y}</b>' },
            plotOptions: {
                pie: {
                    innerSize: '55%',
                    dataLabels: {
                        enabled: true,
                        format: '{point.name}: {point.y}'
                    }
                }
            },
            series: [
                {
                    type: 'pie',
                    name: 'Outstanding',
                    data: outstandingPieData
                }
            ]
        }),
        [outstandingPieData]
    )


    const genderPieOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: 'pie' },
            credits: { enabled: false },
            title: { text: '' },
            tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
            plotOptions: {
                pie: {
                    allowPointSelect: true,
                    showInLegend: true,
                    dataLabels: {
                        enabled: true,
                        formatter: function () {
                            // @ts-ignore
                            return this.point.y > 0
                                ? `${this.point.name}: ${this.point.y}`
                                : ''
                        }
                    }
                }
            },
            series: [{ name: 'Participants', type: 'pie', data: genderCounts }]
        }),
        [genderCounts]
    )

    const pyramidOptions: Highcharts.Options = {
        chart: { type: 'bar' },
        credits: { enabled: false },
        title: { text: '' },
        xAxis: [
            {
                categories: pyramidData.categories,
                reversed: false,
                labels: { step: 1 }
            },
            {
                categories: pyramidData.categories,
                reversed: false,
                linkedTo: 0,
                labels: { step: 1 },
                opposite: true
            }
        ],
        yAxis: {
            title: { text: null },
            labels: {
                formatter() {
                    return Math.abs(Number(this.value)).toString()
                }
            }
        },
        plotOptions: { series: { stacking: 'normal' } },
        series: [
            { name: 'Male', type: 'bar', data: pyramidData.male.map(v => -v) },
            { name: 'Female', type: 'bar', data: pyramidData.female }
        ]
    }

    const groupPieOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: 'pie' },
            credits: { enabled: false },
            title: { text: 'Group Distribution (A / B / C)' },
            tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
            plotOptions: {
                pie: {
                    allowPointSelect: true,
                    showInLegend: true,
                    dataLabels: {
                        enabled: true,
                        formatter: function () {
                            // @ts-ignore
                            return this.point.y > 0
                                ? `${this.point.name}: ${this.point.y}`
                                : ''
                        }
                    }
                }
            },
            series: [{ name: 'Applications', type: 'pie', data: groupCounts }]
        }),
        [groupCounts]
    )

    const sectorPieOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: 'pie' },
            credits: { enabled: false },
            title: { text: '' },
            tooltip: {
                pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)'
            },
            plotOptions: {
                pie: {
                    allowPointSelect: true,
                    showInLegend: true,
                    dataLabels: {
                        enabled: true,
                        formatter: function () {
                            // @ts-ignore
                            return this.point.y > 0
                                ? `${this.point.name}: ${this.point.y}`
                                : ''
                        }
                    }
                }
            },
            series: [{ name: 'SMEs', type: 'pie', data: sectorCounts }]
        }),
        [sectorCounts]
    )

    const wardPieOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: 'pie' },
            credits: { enabled: false },
            title: { text: '' },
            tooltip: {
                pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)'
            },
            plotOptions: {
                pie: {
                    allowPointSelect: true,
                    showInLegend: true,
                    dataLabels: {
                        enabled: true,
                        formatter: function () {
                            // @ts-ignore
                            return this.point.y > 0
                                ? `${this.point.name}: ${this.point.y}`
                                : ''
                        }
                    }
                }
            },
            series: [{ name: 'SMEs', type: 'pie', data: wardCounts }]
        }),
        [wardCounts]
    )


    const gapColumnOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: 'column' },
            credits: { enabled: false },
            title: { text: '' },
            legend: { enabled: false },
            xAxis: {
                categories: gapAnalysis.areas,
                title: { text: 'Area of Support' }
            },
            yAxis: { min: 0, title: { text: 'Interventions' } },
            tooltip: { shared: true },
            plotOptions: {
                column: {
                    grouping: true,
                    borderRadius: 4,
                    dataLabels: {
                        enabled: true,
                        crop: false,
                        overflow: 'none',
                        style: { textOutline: 'none', fontWeight: '700' }
                    }
                }
            },
            series: [
                { name: 'Pending', type: 'column', data: gapAnalysis.required, color: '#f59e0b' },
                { name: 'Assigned', type: 'column', data: gapAnalysis.assigned, color: '#2563eb' },
                { name: 'Completed', type: 'column', data: gapAnalysis.completed, color: '#16a34a' }
            ]
        }),
        [gapAnalysis]
    )

    const funnelOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: 'funnel' },
            credits: { enabled: false },
            title: { text: '' },
            plotOptions: {
                series: {
                    dataLabels: {
                        enabled: true,
                        format: '<b>{point.name}</b>: {point.y}',
                        softConnector: true
                    },
                    neckWidth: '30%',
                    neckHeight: '25%'
                }
            },
            series: [{ name: 'Count', type: 'funnel', data: funnelSeries as any }]
        }),
        [funnelSeries]
    )

    const ownershipDonutOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: 'pie' },
            credits: { enabled: false },
            title: { text: '' },
            tooltip: { pointFormat: '<b>{point.y}%</b>' },
            plotOptions: {
                pie: {
                    innerSize: '60%',
                    dataLabels: { enabled: true, format: '{point.name}: {point.y}%' }
                }
            },
            series: [
                {
                    name: 'Ownership',
                    type: 'pie',
                    data: [
                        { name: 'Black-owned', y: ownershipAverages.black },
                        { name: 'Female-owned', y: ownershipAverages.female },
                        { name: 'Youth-owned', y: ownershipAverages.youth }
                    ]
                }
            ]
        }),
        [ownershipAverages]
    )

    // ---------------- Handlers ----------------
    const handleTimePeriodChange = (v: TimePeriod) => setTimePeriod(v)
    const handleDateRangeChange = (d: any) => setCustomDateRange(d || null)

    // ---------------- Render ----------------
    return (
        <div style={{ padding: 20, minHeight: '100vh' }}>
            <Helmet>
                <title>Operations Reports</title>
            </Helmet>
            <DashboardHeaderCard
                title='Reports & Analytics'
                subtitle='Applications-led analytics with program filters enforced by the active program.'
            />

            {/* Top Filters (time + advanced only) */}
            <Card
                style={{
                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                    transition: 'all 0.3s ease',
                    borderRadius: 8,
                    border: '1px solid #d6e4ff',
                    marginTop: 16,
                    marginBottom: 16
                }}
            >
                <Form
                    form={form}
                    layout='vertical'
                    initialValues={{ timePeriod: 'month' }}
                >
                    <Row gutter={16} align='bottom' wrap={false}>
                        <Col flex='220px'>
                            <Form.Item
                                name='timePeriod'
                                label='Time Period'
                                rules={[{ required: true }]}
                                style={{ marginBottom: 0 }}
                            >
                                <Select onChange={handleTimePeriodChange}>
                                    {timePeriods.map(p => (
                                        <Option key={p.value} value={p.value}>
                                            {p.label}
                                        </Option>
                                    ))}
                                </Select>
                            </Form.Item>
                        </Col>

                        {timePeriod === 'custom' && (
                            <Col flex='300px'>
                                <Form.Item
                                    name='dateRange'
                                    label='Date Range'
                                    rules={[{ required: true }]}
                                    style={{ marginBottom: 0 }}
                                >
                                    <RangePicker
                                        style={{ width: '100%' }}
                                        onChange={handleDateRangeChange}
                                    />
                                </Form.Item>
                            </Col>
                        )}

                        <Col>
                            <Text type='secondary'>
                                Window: <b>{start.format('DD MMM YYYY')}</b> —{' '}
                                <b>{end.format('DD MMM YYYY')}</b>
                            </Text>
                        </Col>

                        <Col flex='none'>
                            <Form.Item label=' ' colon={false} style={{ marginBottom: 0 }}>
                                <Space>
                                    <Button
                                        icon={<FilterOutlined />}
                                        onClick={() => setAdvOpen(true)}
                                    >
                                        Advanced Filters
                                    </Button>
                                </Space>
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Card>

            {/* Demographics, Onboarding & Grouping */}
            <Row gutter={[16, 16]}>
                {/* Onboarded vs Signed Docs */}
                <Col xs={24} md={12}>
                    <ChartCard title='Onboarded vs Signed Docs'>
                        <DataOrEmpty
                            hasData={hasSeriesData(
                                onboardedVsSigned.onboarded,
                                onboardedVsSigned.gapSigned,
                                onboardedVsSigned.preSigned
                            )}
                        >
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={onboardedVsSignedOptions}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>

                {/* Outstanding Documents */}
                <Col xs={24} md={12}>
                    <ChartCard title='Outstanding Documents (Onboarded Only)'>
                        <DataOrEmpty hasData={hasSeriesData(outstandingPieData as any)}>
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={outstandingDocsPieOptions}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>

                {/* Gender Distribution */}
                <Col xs={24} md={8}>
                    <ChartCard title='Gender Distribution'>
                        <DataOrEmpty hasData={hasSeriesData(genderCounts as any)}>
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={genderPieOptions}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>

                {/* Age Distribution */}
                <Col xs={24} md={8}>
                    <ChartCard title='Age Distribution (Pyramid)'>
                        <DataOrEmpty
                            hasData={hasSeriesData(pyramidData.male, pyramidData.female)}
                        >
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={pyramidOptions}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>

                {/* Ownership Breakdown */}
                <Col xs={24} md={8}>
                    <ChartCard title='Ownership Breakdown (Avg %)'>
                        <DataOrEmpty
                            hasData={hasSeriesData(
                                [['Black-owned', ownershipAverages.black]],
                                [['Female-owned', ownershipAverages.female]],
                                [['Youth-owned', ownershipAverages.youth]]
                            )}
                        >
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={ownershipDonutOptions}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
            </Row>

            {/* SME Sector & Ward Distribution (accepted applications) */}
            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} md={12}>
                    <ChartCard title='SME Sector Distribution'>
                        <DataOrEmpty hasData={hasSeriesData(sectorCounts as any)}>
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={sectorPieOptions}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>

                <Col xs={24} md={12}>
                    <ChartCard title='Ward Distribution'>
                        <DataOrEmpty hasData={hasSeriesData(wardCounts as any)}>
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={wardPieOptions}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
            </Row>



            <Divider />

            {/* Gap Analysis + Funnel (accepted only) */}
            <Row gutter={[16, 16]}>
                <Col xs={24} md={14}>
                    <ChartCard title='Interventions Gap Analysis by Department'>
                        <DataOrEmpty
                            hasData={hasSeriesData(
                                gapAnalysis.required,
                                gapAnalysis.assigned,
                                gapAnalysis.completed
                            )}
                        >
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={gapColumnOptions}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
                <Col xs={24} md={10}>
                    <ChartCard title='Applications → Delivery Funnel'>
                        <DataOrEmpty hasData={hasSeriesData(funnelSeries)}>
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={funnelOptions}
                            />
                        </DataOrEmpty>
                    </ChartCard>
                </Col>
            </Row>

            {/* Advanced Filters Drawer */}
            <Drawer
                title='Advanced Filters (Participant attributes)'
                placement='right'
                width={420}
                onClose={() => setAdvOpen(false)}
                open={advOpen}
            >
                <Space direction='vertical' style={{ width: '100%' }} size='large'>
                    {/* Cohort selector */}
                    <div>
                        <Text strong>Cohort</Text>
                        <Select
                            style={{ width: '100%', marginTop: 8 }}
                            value={cohortMode}
                            onChange={(v: CohortMode) => setCohortMode(v)}
                            options={[
                                { value: 'accepted', label: 'Accepted' },
                                { value: 'applied', label: 'Applied (All Participants)' }
                            ]}
                        />
                        <Text type='secondary' style={{ display: 'block', marginTop: 4 }}>
                            Gender, Age and Ownership charts follow this cohort.
                        </Text>
                    </div>

                    <div>
                        <Text strong>B-BBEE Level</Text>
                        <Select
                            mode='multiple'
                            allowClear
                            style={{ width: '100%', marginTop: 8 }}
                            placeholder='Filter by B-BBEE level'
                            value={advBeeLevels}
                            onChange={(vals: number[]) => setAdvBeeLevels(vals)}
                            options={[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({
                                value: n,
                                label: `Level ${n}`
                            }))}
                        />
                    </div>

                    <div>
                        <Text strong>Black Owned % (min / max)</Text>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <InputNumber
                                min={0}
                                max={100}
                                style={{ width: '50%' }}
                                value={advBlackOwnedRange[0]}
                                onChange={v =>
                                    setAdvBlackOwnedRange([v ?? undefined, advBlackOwnedRange[1]])
                                }
                                placeholder='Min'
                            />
                            <InputNumber
                                min={0}
                                max={100}
                                style={{ width: '50%' }}
                                value={advBlackOwnedRange[1]}
                                onChange={v =>
                                    setAdvBlackOwnedRange([advBlackOwnedRange[0], v ?? undefined])
                                }
                                placeholder='Max'
                            />
                        </div>
                    </div>

                    <div>
                        <Text strong>Female Owned % (min / max)</Text>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <InputNumber
                                min={0}
                                max={100}
                                style={{ width: '50%' }}
                                value={advFemaleOwnedRange[0]}
                                onChange={v =>
                                    setAdvFemaleOwnedRange([
                                        v ?? undefined,
                                        advFemaleOwnedRange[1]
                                    ])
                                }
                                placeholder='Min'
                            />
                            <InputNumber
                                min={0}
                                max={100}
                                style={{ width: '50%' }}
                                value={advFemaleOwnedRange[1]}
                                onChange={v =>
                                    setAdvFemaleOwnedRange([
                                        advFemaleOwnedRange[0],
                                        v ?? undefined
                                    ])
                                }
                                placeholder='Max'
                            />
                        </div>
                    </div>

                    <div>
                        <Text strong>Youth Owned % (min / max)</Text>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <InputNumber
                                min={0}
                                max={100}
                                style={{ width: '50%' }}
                                value={advYouthOwnedRange[0]}
                                onChange={v =>
                                    setAdvYouthOwnedRange([v ?? undefined, advYouthOwnedRange[1]])
                                }
                                placeholder='Min'
                            />
                            <InputNumber
                                min={0}
                                max={100}
                                style={{ width: '50%' }}
                                value={advYouthOwnedRange[1]}
                                onChange={v =>
                                    setAdvYouthOwnedRange([advYouthOwnedRange[0], v ?? undefined])
                                }
                                placeholder='Max'
                            />
                        </div>
                    </div>

                    <Divider />

                    <Space>
                        <Button
                            onClick={() => {
                                setAdvBeeLevels([])
                                setAdvBlackOwnedRange([undefined, undefined])
                                setAdvFemaleOwnedRange([undefined, undefined])
                                setAdvYouthOwnedRange([undefined, undefined])
                            }}
                        >
                            Reset
                        </Button>
                        <Button type='primary' onClick={() => setAdvOpen(false)}>
                            Apply
                        </Button>
                    </Space>
                </Space>
            </Drawer>
        </div>
    )
}

export default OperationsReports
