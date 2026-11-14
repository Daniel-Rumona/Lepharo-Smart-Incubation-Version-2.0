import React, { useEffect, useMemo, useState } from 'react'
import {
    App,
    Button,
    Col,
    Empty,
    Modal,
    Row,
    Skeleton,
    Space,
    Typography
} from 'antd'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import 'highcharts/highcharts-more'
import 'highcharts/modules/variable-pie'
import 'highcharts/modules/drilldown'
import dayjs, { Dayjs } from 'dayjs'
import {
    ExpandAltOutlined
} from '@ant-design/icons'

// Firestore
import { db } from '@/firebase'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where
} from 'firebase/firestore'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import './incubateesInsights.css'
import { isReportRecordVisible, loadReportVisibilityContext } from '@/utils/reportVisibility'
import {
    REPORT_CHART_COLORS,
    REPORT_CHART_PALETTE
} from '@/components/reports/reportChartTheme'

const { Text } = Typography



const getAgeFromID = (idNumber?: string | null) => {
    if (!idNumber || idNumber.length < 6) return undefined
    const yy = parseInt(idNumber.slice(0, 2), 10)
    const mm = parseInt(idNumber.slice(2, 4), 10) - 1
    const dd = parseInt(idNumber.slice(4, 6), 10)
    const year = yy <= 30 ? 2000 + yy : 1900 + yy
    const dob = new Date(year, mm, dd)
    if (Number.isNaN(dob.getTime())) return undefined
    const t = new Date()
    let age = t.getFullYear() - dob.getFullYear()
    const m = t.getMonth() - dob.getMonth()
    if (m < 0 || (m === 0 && t.getDate() < dob.getDate())) age--
    return age
}

type GroupLetter = 'A' | 'B' | 'C' | 'Graduated'
type Gender = 'Male' | 'Female' | 'Other' | 'Unspecified'
type AgeBand = '<25' | '25-34' | '35-44' | '45-54' | '55+'

type GroupHistoryItem = {
    by?: string
    date?: any
    docs?: any
    from?: GroupLetter | null
    to?: GroupLetter | null
    reason?: string
}

type ApplicationDoc = {
    id: string
    participantId: string
    programId?: string
    createdAt?: Date
    groupHistory?: GroupHistoryItem[]
    gapGroup?: GroupLetter
    group?: GroupLetter
    currentGroup?: GroupLetter
}
type ParticipantDoc = {
    id: string
    fullName?: string
    gender?: Gender
    idNumber?: string
    sector?: string
    industry?: string
    sectorName?: string
    province?: string
    beeLevel?: string
    youthOwnership?: number
    blackOwnership?: number
    femaleOwnership?: number
}

type IncubateeRow = {
    id: string
    name: string
    gender: Gender
    age?: number
    ageBand?: AgeBand
    group?: GroupLetter
    sector: string
    province: string
    beeLevel: string
    youthOwnership?: number
    blackOwnership?: number
    femaleOwnership?: number
    programId?: string
    createdAt?: Date
}

type ProgramMeta = {
    id: string
    isMultiBranch?: boolean
    name?: string
}

// The demographic filters live in the page's Filters panel; this view reads
// them and reports which values exist so the panel can offer them.
export type IncubateeFilters = {
    gender: string[]
    ageBand: string[]
    sector: string[]
    province: string[]
    bee: string[]
}

export const EMPTY_INCUBATEE_FILTERS: IncubateeFilters = {
    gender: [],
    ageBand: [],
    sector: [],
    province: [],
    bee: []
}

export type IncubateeFilterOptions = {
    genders: string[]
    ageBands: string[]
    sectors: string[]
    provinces: string[]
    beeLevels: string[]
    // Province only applies to all programmes or a multi-branch one.
    canFilterProvince: boolean
}

type Props = {
    programId?: string
    range: [Dayjs, Dayjs]
    filters?: IncubateeFilters
    onFilterOptionsChange?: (options: IncubateeFilterOptions) => void
}

const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
] as const

const ageBands: AgeBand[] = ['<25', '25-34', '35-44', '45-54', '55+']

const GENDER_COLORS = {
    male: '#1677ff',
    female: '#eb2f96',
    other: '#faad14'
}

const chartPalette = REPORT_CHART_PALETTE

const bandCheck = (age: number, band: AgeBand) =>
    band === '<25'
        ? age < 25
        : band === '25-34'
            ? age >= 25 && age <= 34
            : band === '35-44'
                ? age >= 35 && age <= 44
                : band === '45-54'
                    ? age >= 45 && age <= 54
                    : age >= 55

const resolveAgeBand = (age?: number): AgeBand | undefined => {
    if (age === undefined) return undefined
    if (age < 25) return '<25'
    if (age <= 34) return '25-34'
    if (age <= 44) return '35-44'
    if (age <= 54) return '45-54'
    return '55+'
}

function resolveCurrentGroup(
    history?: GroupHistoryItem[]
): GroupLetter | undefined {
    if (!Array.isArray(history) || history.length === 0) return undefined
    const sorted = [...history].sort((a, b) => {
        const da = a.date
            ? new Date(a.date.seconds ? a.date.seconds * 1000 : a.date).getTime()
            : 0
        const db = b.date
            ? new Date(b.date.seconds ? b.date.seconds * 1000 : b.date).getTime()
            : 0
        return da - db
    })
    const first = sorted[0]
    if ((first.from === null || typeof first.from === 'undefined') && first.to) {
        return first.to
    }
    for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].to) return sorted[i].to as GroupLetter
    }
    return undefined
}


const normalizeGender = (value?: string): Gender => {
    const v = (value || '').trim().toLowerCase()
    if (['male', 'm'].includes(v)) return 'Male'
    if (['female', 'f'].includes(v)) return 'Female'
    if (v) return 'Other'
    return 'Unspecified'
}

const normalizeText = (value: any, fallback = 'Unspecified') => {
    if (typeof value === 'string' && value.trim()) return value.trim()
    return fallback
}

const normalizeProvince = (d: any) => {
    return normalizeText(
        d?.province ||
        d?.location?.province ||
        d?.physicalAddress?.province ||
        d?.address?.province ||
        d?.branchProvince,
        'Unspecified'
    )
}

const normalizeBeeLevel = (d: any) => {
    const raw =
        d?.beeLevel ||
        d?.bBeeLevel ||
        d?.bbeeLevel ||
        d?.beeStatus ||
        d?.bee ||
        d?.bbbee ||
        d?.compliance?.beeLevel

    if (typeof raw === 'number') return `Level ${raw}`
    if (typeof raw === 'string' && raw.trim()) {
        const cleaned = raw.trim()
        if (/^level\s*\d$/i.test(cleaned)) return cleaned.replace(/\s+/g, ' ')
        if (/^\d$/.test(cleaned)) return `Level ${cleaned}`
        return cleaned
    }
    return 'Unspecified'
}

const normalizeSector = (d: any) =>
    normalizeText(d?.sector || d?.industry || d?.sectorName, 'Unspecified')

const normalizePercent = (value: any): number | undefined => {
    if (value === null || value === undefined || value === '') return undefined
    const n = Number(value)
    if (Number.isNaN(n)) return undefined
    if (n < 0) return 0
    if (n > 100) return 100
    return n
}


const aggregateCounts = (items: string[]) => {
    const map = new Map<string, number>()
    items.forEach(item => {
        map.set(item, (map.get(item) || 0) + 1)
    })
    return Array.from(map.entries()).sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    )
}



const ExpandBtn: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <Button
        size='small'
        iconPosition='end'
        icon={<ExpandAltOutlined />}
        onClick={onClick}
    >
        Expand
    </Button>
)

const IncubateesInsights: React.FC<Props> = ({
    programId,
    range,
    filters = EMPTY_INCUBATEE_FILTERS,
    onFilterOptionsChange
}) => {
    const { message } = App.useApp()
    const { user } = useFullIdentity() as any

    const effectiveProgramId = programId || 'all'

    const [rows, setRows] = useState<IncubateeRow[]>([])
    const [loading, setLoading] = useState(true)
    const [programsMeta, setProgramsMeta] = useState<Record<string, ProgramMeta>>({})
    const [open, setOpen] = useState<Record<string, boolean>>({})

    const {
        gender: genderFilter,
        ageBand: ageBandFilter,
        province: provinceFilter,
        sector: sectorFilter,
        bee: beeFilter
    } = filters

    useEffect(() => {
        let cancelled = false
        setLoading(true)

        const constraints = [
            where('applicationStatus', '==', 'accepted')
        ]
        if (programId && programId !== 'all') {
            constraints.push(where('programId', '==', programId))
        }

        const load = async () => {
            try {
                const snap = await getDocs(query(collection(db, 'applications'), ...constraints))
                const visibilityContext = await loadReportVisibilityContext(user?.email)
                try {
                    const apps: ApplicationDoc[] = []

                    snap.forEach(ds => {
                        const d = ds.data() as any
                        if (!isReportRecordVisible(d, user?.email, visibilityContext)) return

                        let createdAt: Date | undefined
                        const rawDate =
                            d.createdAt ||
                            d.applicationDate ||
                            d.appliedAt ||
                            d.createdOn ||
                            d.submittedAt

                        if (rawDate?.toDate) createdAt = rawDate.toDate()
                        else if (rawDate instanceof Date) createdAt = rawDate
                        else if (typeof rawDate === 'string') {
                            const dt = new Date(rawDate)
                            if (!Number.isNaN(dt.getTime())) createdAt = dt
                        }

                        apps.push({
                            id: ds.id,
                            participantId: d.participantId,
                            programId: d.programId,
                            createdAt,
                            gapGroup: d.gapGroup,
                            group: d.group,
                            currentGroup: d.currentGroup,
                            groupHistory: Array.isArray(d.groupHistory) ? d.groupHistory : []
                        })
                    })

                    const pidSet = Array.from(
                        new Set(apps.map(a => a.participantId).filter(Boolean))
                    )
                    const programIds = Array.from(
                        new Set(apps.map(a => a.programId).filter(Boolean))
                    ) as string[]

                    const participants = new Map<string, ParticipantDoc>()
                    const metaMap: Record<string, ProgramMeta> = {}

                    await Promise.all([
                        ...pidSet.map(async pid => {
                            const ref = doc(db, 'participants', pid)
                            const pds = await getDoc(ref)
                            if (pds.exists()) {
                                const d = pds.data() as any
                                if (!isReportRecordVisible(d, user?.email, visibilityContext)) return
                                participants.set(pid, {
                                    id: pds.id,
                                    fullName: d.fullName || d.name || d.companyName || '—',
                                    gender: normalizeGender(d.gender),
                                    idNumber: d.idNumber || d.nationalId || d.id,
                                    sector: normalizeSector(d),
                                    industry: d.industry,
                                    sectorName: d.sectorName,
                                    province: normalizeProvince(d),
                                    beeLevel: normalizeBeeLevel(d),
                                    youthOwnership: normalizePercent(
                                        d.youthOwnership ??
                                        d.ownershipYouth ??
                                        d.youthOwnedPercent ??
                                        d.ownership?.youth
                                    ),
                                    blackOwnership: normalizePercent(
                                        d.blackOwnership ??
                                        d.ownershipBlack ??
                                        d.blackOwnedPercent ??
                                        d.ownership?.black
                                    ),
                                    femaleOwnership: normalizePercent(
                                        d.femaleOwnership ??
                                        d.womenOwnership ??
                                        d.femaleOwnedPercent ??
                                        d.ownership?.female
                                    )
                                })
                            }
                        }),
                        ...programIds.map(async pid => {
                            const pref = doc(db, 'programs', pid)
                            const pds = await getDoc(pref)
                            if (pds.exists()) {
                                const d = pds.data() as any
                                metaMap[pid] = {
                                    id: pds.id,
                                    isMultiBranch: !!d.isMultiBranch,
                                    name: d.programName || d.name || 'Program'
                                }
                            }
                        })
                    ])

                    const shaped: IncubateeRow[] = apps.map(a => {
                        const p = participants.get(a.participantId)
                        const age = getAgeFromID(p?.idNumber)
                        // Group is stored directly on current records. History remains the
                        // fallback for legacy applications created before synchronized moves.
                        const group = a.gapGroup || a.group || a.currentGroup || resolveCurrentGroup(a.groupHistory)

                        return {
                            id: a.id,
                            name: p?.fullName || '—',
                            gender: (p?.gender || 'Unspecified') as Gender,
                            age,
                            ageBand: resolveAgeBand(age),
                            group,
                            sector: p?.sector || 'Unspecified',
                            province: p?.province || 'Unspecified',
                            beeLevel: p?.beeLevel || 'Unspecified',
                            youthOwnership: p?.youthOwnership,
                            blackOwnership: p?.blackOwnership,
                            femaleOwnership: p?.femaleOwnership,
                            programId: a.programId,
                            createdAt: a.createdAt
                        }
                    })
                    if (!cancelled) {
                        setProgramsMeta(metaMap)
                        setRows(shaped)
                    }
                } catch (err) {
                    console.error(err)
                    if (!cancelled) message.error('Failed to load incubatees')
                }
            } catch (err) {
                console.error(err)
                if (!cancelled) message.error('Failed to load incubatees')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        load()

        return () => {
            cancelled = true
        }
    }, [programId, user?.email])

    const canShowProvinceFilter = useMemo(() => {
        if (effectiveProgramId === 'all') return true
        if (!effectiveProgramId) return false
        return !!programsMeta[effectiveProgramId]?.isMultiBranch
    }, [effectiveProgramId, programsMeta])

    // The portfolio for a period is everyone accepted by its end, not only
    // those who applied during it: a cohort accepted last year is still in
    // the programme this month. Filtering on the application date alone hid
    // whole programmes whenever the period moved past their intake.
    const baseRows = useMemo(() => {
        const [, end] = range

        return rows.filter(r => {
            if (
                effectiveProgramId &&
                effectiveProgramId !== 'all' &&
                r.programId !== effectiveProgramId
            ) {
                return false
            }

            if (!r.createdAt) return true
            return !dayjs(r.createdAt).isAfter(end, 'day')
        })
    }, [rows, range, effectiveProgramId])

    const filteredRows = useMemo(() => {
        return baseRows.filter(r => {
            if (genderFilter.length && !genderFilter.includes(r.gender)) return false
            if (ageBandFilter.length && (!r.ageBand || !ageBandFilter.includes(r.ageBand)))
                return false
            if (sectorFilter.length && !sectorFilter.includes(r.sector)) return false
            if (beeFilter.length && !beeFilter.includes(r.beeLevel)) return false
            if (
                canShowProvinceFilter &&
                provinceFilter.length &&
                !provinceFilter.includes(r.province)
            ) {
                return false
            }


            return true
        })
    }, [
        baseRows,
        genderFilter,
        ageBandFilter,
        sectorFilter,
        beeFilter,
        provinceFilter,
        canShowProvinceFilter
    ])

    const genderCounts = useMemo(() => {
        const male = filteredRows.filter(r => r.gender === 'Male').length
        const female = filteredRows.filter(r => r.gender === 'Female').length
        const other = filteredRows.filter(
            r => r.gender !== 'Male' && r.gender !== 'Female'
        ).length
        return { male, female, other }
    }, [filteredRows])

    const agePyramidData = useMemo(() => {
        const male = ageBands.map(
            b =>
                -filteredRows.filter(
                    r =>
                        r.gender === 'Male' && r.age !== undefined && bandCheck(r.age, b)
                ).length
        )
        const female = ageBands.map(
            b =>
                filteredRows.filter(
                    r =>
                        r.gender === 'Female' &&
                        r.age !== undefined &&
                        bandCheck(r.age, b)
                ).length
        )
        return { male, female }
    }, [filteredRows])


    const groupAgg = useMemo(() => {
        const map = new Map<string, number>()
        filteredRows.forEach(r => {
            const key = r.group || 'Unspecified'
            map.set(key, (map.get(key) || 0) + 1)
        })
        return Array.from(map.entries()).sort(
            (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
        )
    }, [filteredRows])

    const ownershipAverages = useMemo(() => {
        const avg = (values: Array<number | undefined>) => {
            const valid = values.filter((v): v is number => typeof v === 'number')
            if (!valid.length) return 0
            return Number(
                (valid.reduce((sum, v) => sum + v, 0) / valid.length).toFixed(1)
            )
        }

        return {
            youth: avg(filteredRows.map(r => r.youthOwnership)),
            black: avg(filteredRows.map(r => r.blackOwnership)),
            female: avg(filteredRows.map(r => r.femaleOwnership))
        }
    }, [filteredRows])

    const sectorAgg = useMemo(() => {
        return aggregateCounts(filteredRows.map(r => r.sector))
    }, [filteredRows])

    const provinceAgg = useMemo(() => {
        return aggregateCounts(filteredRows.map(r => r.province))
    }, [filteredRows])

    const beeAgg = useMemo(() => {
        return aggregateCounts(filteredRows.map(r => r.beeLevel))
    }, [filteredRows])


    const filterOptions = useMemo(() => {
        const genders = Array.from(new Set(baseRows.map(r => r.gender))).sort()
        const provinces = Array.from(new Set(baseRows.map(r => r.province))).sort()
        const sectors = Array.from(new Set(baseRows.map(r => r.sector))).sort()
        const beeLevels = Array.from(new Set(baseRows.map(r => r.beeLevel))).sort()


        return {
            genders,
            provinces,
            sectors,
            beeLevels,
        }
    }, [baseRows])

    useEffect(() => {
        onFilterOptionsChange?.({
            ...filterOptions,
            ageBands: [...ageBands],
            canFilterProvince: canShowProvinceFilter
        })
        // Report only when the available values change, not on every render
        // of a parent that passes a fresh callback.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterOptions, canShowProvinceFilter])

    const shouldShowGenderChart = genderFilter.length === 0
    const shouldShowAgeChart = ageBandFilter.length === 0 && genderFilter.length === 0
    const shouldShowSectorChart = sectorFilter.length === 0
    const shouldShowProvinceChart = canShowProvinceFilter && provinceFilter.length === 0
    const shouldShowBeeChart = beeFilter.length === 0
    const shouldShowOwnershipChart = true
    const shouldShowGroupChart = true

    const simplePieOptions = (
        data: Array<{ name: string; y: number }>,
        label: string
    ): Highcharts.Options => ({
        chart: { type: 'pie', height: 320 },
        title: { text: '' },
        credits: { enabled: false },
        tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
        plotOptions: {
            pie: {
                innerSize: '60%',
                borderWidth: 0,
                showInLegend: true,
                // The legend and tooltip carry names and counts.
                dataLabels: { enabled: false }
            }
        },
        series: [
            {
                type: 'pie',
                name: label,
                data: data
                    .filter(point => point.y > 0)
                    .map((point, index) => ({
                        ...point,
                        color: chartPalette[index % chartPalette.length]
                    }))
            }
        ]
    })

    const genderOptions = simplePieOptions([
        { name: 'Male', y: genderCounts.male },
        { name: 'Female', y: genderCounts.female },
        { name: 'Other/Unspecified', y: genderCounts.other }
    ], 'Incubatees')

    const groupOptions: Highcharts.Options = {
        chart: { type: 'pie', height: 320 },
        title: { text: '' },
        credits: { enabled: false },
        tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
        plotOptions: {
            pie: {
                innerSize: '60%',
                borderWidth: 0,
                showInLegend: true,
                dataLabels: { enabled: false }
            }
        },
        series: [
            {
                type: 'pie',
                name: 'Groups',
                data: groupAgg.map(([name, count], index) => ({
                    name: `Group ${name}`,
                    y: count,
                    color: chartPalette[index % chartPalette.length]
                }))
            }
        ]
    }

    const ageOptions: Highcharts.Options = {
        chart: { type: 'bar', height: 320 },
        title: { text: '' },
        credits: { enabled: false },
        colors: [REPORT_CHART_COLORS.primary, REPORT_CHART_COLORS.success],
        xAxis: [
            {
                categories: ageBands as unknown as string[],
                reversed: false,
                labels: { step: 1 }
            },
            {
                opposite: true,
                reversed: false,
                categories: ageBands as unknown as string[],
                linkedTo: 0,
                labels: { step: 1 }
            }
        ],
        yAxis: {
            title: { text: 'Count' },
            labels: {
                formatter: function () {
                    return Math.abs(Number(this.value)).toString()
                }
            }
        },
        plotOptions: {
            series: {
                stacking: 'normal',
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        return Math.abs(Number(this.y))
                    }
                }
            }
        },
        tooltip: {
            formatter: function () {
                const val = Math.abs(Number(this.y))
                // @ts-ignore
                return `<b>${this.series.name}</b><br/>${this.point.category}: ${val}`
            }
        },
        series: [
            { type: 'bar', name: 'Male', data: agePyramidData.male, color: REPORT_CHART_COLORS.primary },
            { type: 'bar', name: 'Female', data: agePyramidData.female, color: REPORT_CHART_COLORS.success }
        ]
    }

    // One-colour sorted bars: many categories compare better as bars than slices.
    const countBarOptions = (
        entries: Array<[string, number]>,
        name: string
    ): Highcharts.Options => ({
        chart: { type: 'bar', height: Math.max(240, entries.length * 34 + 70) },
        title: { text: '' },
        credits: { enabled: false },
        legend: { enabled: false },
        xAxis: { categories: entries.map(([label]) => label), title: { text: undefined } },
        yAxis: { min: 0, allowDecimals: false, title: { text: undefined } },
        plotOptions: {
            bar: { borderRadius: 3, borderWidth: 0, dataLabels: { enabled: true } }
        },
        tooltip: { pointFormat: '<b>{point.y}</b>' },
        series: [
            {
                type: 'bar',
                name,
                color: REPORT_CHART_COLORS.primary,
                data: entries.map(([, y]) => y)
            }
        ]
    })

    // The eight largest sectors, the rest as "Other".
    const sectorEntries = useMemo<Array<[string, number]>>(() => {
        if (sectorAgg.length <= 9) return sectorAgg
        const other = sectorAgg.slice(8).reduce((sum, [, count]) => sum + count, 0)
        return [...sectorAgg.slice(0, 8), ['Other', other]]
    }, [sectorAgg])

    const sectorOptions = countBarOptions(sectorEntries, 'Incubatees')

    const provinceOptions = countBarOptions(provinceAgg, 'Incubatees')

    // B-BBEE levels are a scale: Level 1 to 8 in order, then anything else.
    const beeEntries = useMemo<Array<[string, number]>>(() => {
        const levelOf = (name: string) => {
            const match = /^level\s*(\d)$/i.exec(name)
            return match ? Number(match[1]) : null
        }
        const rank = (name: string) =>
            levelOf(name) ?? (name === 'Unspecified' ? 99 : 50)
        return [...beeAgg].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    }, [beeAgg])

    const beeOptions: Highcharts.Options = {
        chart: { type: 'column', height: 300 },
        title: { text: '' },
        credits: { enabled: false },
        legend: { enabled: false },
        xAxis: { categories: beeEntries.map(([name]) => name.replace(/^Level\s*/i, 'L')) },
        yAxis: { min: 0, allowDecimals: false, title: { text: undefined } },
        plotOptions: {
            column: { borderRadius: 3, borderWidth: 0, dataLabels: { enabled: true } }
        },
        tooltip: { pointFormat: '<b>{point.y}</b>' },
        series: [
            {
                type: 'column',
                name: 'Incubatees',
                color: REPORT_CHART_COLORS.primary,
                data: beeEntries.map(([, y]) => y)
            }
        ]
    }

    // Average ownership share, each bar drawn over a 100% track.
    const ownershipOptions: Highcharts.Options = {
        chart: { type: 'bar', height: 240 },
        title: { text: '' },
        credits: { enabled: false },
        legend: { enabled: false },
        xAxis: { categories: ['Youth', 'Black', 'Female'], title: { text: undefined } },
        yAxis: {
            min: 0,
            max: 100,
            title: { text: undefined },
            labels: { format: '{value}%' }
        },
        plotOptions: {
            bar: { grouping: false, borderRadius: 4, borderWidth: 0, pointPadding: 0.15 }
        },
        tooltip: { pointFormat: '<b>{point.y}%</b> average' },
        series: [
            {
                type: 'bar',
                name: 'Track',
                data: [100, 100, 100],
                color: 'rgba(128, 128, 128, 0.15)',
                enableMouseTracking: false,
                dataLabels: { enabled: false }
            },
            {
                type: 'bar',
                name: 'Average owned',
                dataLabels: { enabled: true, format: '{point.y}%' },
                data: [
                    { y: ownershipAverages.youth, color: '#722ed1' },
                    { y: ownershipAverages.black, color: '#1677ff' },
                    { y: ownershipAverages.female, color: GENDER_COLORS.female }
                ]
            }
        ]
    }

    // The only non-empty category, when there is just one.
    const onlyCategory = (entries: Array<[string, number]>): [string, number] | null => {
        const present = entries.filter(([, count]) => count > 0)
        return present.length === 1 ? present[0] : null
    }

    const cells: Array<{
        key: string
        title: string
        show: boolean
        span: 4 | 6 | 8
        options: Highcharts.Options
        only: [string, number] | null
    }> = [
        {
            key: 'gender',
            title: 'Gender',
            show: shouldShowGenderChart,
            span: 4,
            options: genderOptions,
            only: onlyCategory([
                ['Male', genderCounts.male],
                ['Female', genderCounts.female],
                ['Other/Unspecified', genderCounts.other]
            ])
        },
        { key: 'age', title: 'Age', show: shouldShowAgeChart, span: 8, options: ageOptions, only: null },
        { key: 'sectors', title: 'Sector', show: shouldShowSectorChart, span: 6, options: sectorOptions, only: onlyCategory(sectorEntries) },
        { key: 'province', title: 'Province', show: shouldShowProvinceChart, span: 6, options: provinceOptions, only: onlyCategory(provinceAgg) },
        { key: 'bee', title: 'B-BBEE level', show: shouldShowBeeChart, span: 4, options: beeOptions, only: onlyCategory(beeEntries) },
        {
            key: 'group',
            title: 'Groups',
            show: shouldShowGroupChart,
            span: 4,
            options: groupOptions,
            only: (() => {
                const one = onlyCategory(groupAgg)
                return one ? [`Group ${one[0]}`, one[1]] as [string, number] : null
            })()
        },
        { key: 'ownership', title: 'Ownership', show: shouldShowOwnershipChart, span: 4, options: ownershipOptions, only: null }
    ]

    const openMod = (k: string) => setOpen(s => ({ ...s, [k]: true }))
    const closeMod = (k: string) => setOpen(s => ({ ...s, [k]: false }))

    if (loading) {
        return (
            <div style={{ marginTop: 10 }} aria-busy="true" aria-label="Loading incubatee insights">
                <MotionCard style={{ marginBottom: 16 }}>
                    <Skeleton active title={{ width: 180 }} paragraph={{ rows: 2 }} />
                </MotionCard>
                <Row gutter={[16, 16]}>
                    {[0, 1, 2, 3, 4, 5].map(item => (
                        <Col key={item} xs={24} md={12} xl={8}>
                            <MotionCard>
                                <Skeleton active title={{ width: 160 }} paragraph={false} />
                                <Skeleton.Node active style={{ width: '100%', height: 260, marginTop: 16 }} />
                            </MotionCard>
                        </Col>
                    ))}
                </Row>
            </div>
        )
    }

    if (baseRows.length === 0) {
        return (
            <MotionCard style={{ marginTop: 10 }}>
                <Empty description='No incubatees had been accepted by the end of this period.' />
            </MotionCard>
        )
    }

    return (
        <div style={{ marginTop: 10 }}>
            {filteredRows.length === 0 ? (
                <MotionCard>
                    <Empty description='No incubatees matched the selected filters.' />
                </MotionCard>
            ) : (
                // A 12-column grid: each chart gets the width its shape needs, and
                // dense packing closes the gaps when filters hide charts.
                <div className='ii-grid'>
                    {cells.filter(cell => cell.show).map(cell =>
                        cell.only ? (
                            // One category: the figure says it better than a chart.
                            <div key={cell.key} className='ii-cell is-single'>
                                <MotionCard title={cell.title}>
                                    <div className='ii-single'>
                                        <span className='ii-single-value'>{cell.only[0]}</span>
                                        <span className='ii-single-label'>
                                            All {cell.only[1]} {cell.only[1] === 1 ? 'SME' : 'SMEs'}
                                        </span>
                                    </div>
                                </MotionCard>
                            </div>
                        ) : (
                            <div key={cell.key} className={`ii-cell ii-span-${cell.span}`}>
                                <MotionCard title={cell.title} extra={<ExpandBtn onClick={() => openMod(cell.key)} />}>
                                    <HighchartsReact highcharts={Highcharts} options={cell.options} />
                                </MotionCard>
                            </div>
                        )
                    )}
                </div>
            )}

            <Modal
                open={!!open.gender}
                onCancel={() => closeMod('gender')}
                footer={null}
                width={900}
                title='Gender distribution'
            >
                <HighchartsReact highcharts={Highcharts} options={genderOptions} />
            </Modal>

            <Modal
                open={!!open.group}
                onCancel={() => closeMod('group')}
                footer={null}
                width={1100}
                title='SME per group'
            >
                <HighchartsReact highcharts={Highcharts} options={groupOptions} />
            </Modal>

            <Modal
                open={!!open.age}
                onCancel={() => closeMod('age')}
                footer={null}
                width={1000}
                title='Age pyramid'
            >
                <HighchartsReact highcharts={Highcharts} options={ageOptions} />
            </Modal>

            <Modal
                open={!!open.sectors}
                onCancel={() => closeMod('sectors')}
                footer={null}
                width={1000}
                title='Incubatees by sector'
            >
                <HighchartsReact highcharts={Highcharts} options={sectorOptions} />
            </Modal>

            <Modal
                open={!!open.province}
                onCancel={() => closeMod('province')}
                footer={null}
                width={1000}
                title='Incubatees by province'
            >
                <HighchartsReact highcharts={Highcharts} options={provinceOptions} />
            </Modal>

            <Modal
                open={!!open.bee}
                onCancel={() => closeMod('bee')}
                footer={null}
                width={1000}
                title='BEE level distribution'
            >
                <HighchartsReact highcharts={Highcharts} options={beeOptions} />
            </Modal>

            <Modal
                open={!!open.ownership}
                onCancel={() => closeMod('ownership')}
                footer={null}
                width={1000}
                title='Ownership details'
            >
                <HighchartsReact highcharts={Highcharts} options={ownershipOptions} />
            </Modal>
        </div>
    )
}

export default IncubateesInsights
