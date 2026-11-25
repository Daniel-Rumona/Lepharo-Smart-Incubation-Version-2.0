import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Dropdown, Empty, Input, Segmented, Select, Space, Tooltip, Typography, message, theme } from 'antd'
import {
    AlertOutlined,
    ArrowRightOutlined,
    CloudDownloadOutlined,
    ReloadOutlined,
    SettingOutlined,
    TeamOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricsGrid } from '@/components/dashboards/metrics/MetricsGrid'
import '@/components/shared/setup-segmented.css'
import { useIsMobile } from '@/hooks/useIsMobile'
import { isStaffRole } from '@/lib/roleLabels'
import { CompactDrawer, type CompactMode } from './CompactDrawer'
import { CompetenciesModal } from './CompetenciesModal'
import { CheckInsDrawer } from './CheckInsDrawer'
import { PepDrawer } from './PepDrawer'
import { CalibrationPanel, type CalibrationRow } from './CalibrationPanel'
import { CompliancePanel, type ComplianceRow } from './CompliancePanel'
import { CyclesModal } from './CyclesModal'
import { CycleTimeline } from './CycleTimeline'
import { MyPerformanceCard } from './MyPerformanceCard'
import { PeopleList } from './PeopleList'
import { loadAttendanceEvidence } from './attendance'
import { nextStep, type Viewer } from './nextStep'
import { cleanRole, type LegacyCompact, type PerformanceCompact, type Person, type StaffMember } from './people'
import {
    annualScore,
    compactFromLegacy,
    compactStatus,
    compactStatusMeta,
    cycleForDate,
    defaultCompactContent,
    outstandingActions,
    phaseScore,
    ratingLabel,
    reviewStage,
    type CheckIn,
    type Competency,
    type EnhancementPlan,
    type PerformanceCycle,
    type PhaseKey,
    type ReviewRecord
} from './ipm'

const { Text } = Typography

// Rating bands, best first, with the theme colour used in the rating bar.
const RATING_BANDS = [
    { label: 'Exceptional', colorToken: 'colorSuccess' },
    { label: 'More than Satisfactory', colorToken: 'colorInfo' },
    { label: 'Satisfactory', colorToken: 'colorWarning' },
    { label: 'Unsatisfactory', colorToken: 'colorError' },
    { label: 'Very Unsatisfactory', colorToken: 'colorErrorActive' },
    { label: 'Not Rated', colorToken: 'colorTextQuaternary' }
] as const

type Tab = 'staff' | 'calibration' | 'compliance'
type Focus = 'all' | 'mine' | 'attention'

/** Test and control logins sit outside the IPM process. */
const isControlEmail = (email?: string) => String(email || '').toLowerCase().endsWith('@quantilytix.co.za')

const toDateText = (value: any) => {
    if (!value) return ''
    if (typeof value === 'string') return value
    if (value?.toDate) return dayjs(value.toDate()).format('YYYY-MM-DD')
    return ''
}

const EMPTY_COMPACT = defaultCompactContent()

const EmployeePerformancePage: React.FC = () => {
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const userRole = cleanRole(user?.role)
    const { hasRole, nameOf } = useDepartmentRoles()
    const userDepartmentId = String((user as any)?.departmentId || '').trim()
    const isDirector = userRole === 'director'
    const isHR = userRole === 'hr' || hasRole(userDepartmentId, 'hr')
    // HR and the CEO run the process and see everyone; anyone else sees
    // themselves and the people who report to them, as the rules allow.
    const canSeeAll = isDirector || isHR
    const myUid = String(user?.id || '')
    const isMobile = useIsMobile()
    const { token } = theme.useToken()

    const [loading, setLoading] = useState(true)
    const [staff, setStaff] = useState<StaffMember[]>([])
    const [compacts, setCompacts] = useState<PerformanceCompact[]>([])
    const [cycles, setCycles] = useState<PerformanceCycle[]>([])
    const [selectedCycleId, setSelectedCycleId] = useState<string>()
    const [reviewRecords, setReviewRecords] = useState<ReviewRecord[]>([])
    const [competencies, setCompetencies] = useState<Competency[]>([])
    const [checkIns, setCheckIns] = useState<CheckIn[]>([])
    const [plans, setPlans] = useState<EnhancementPlan[]>([])
    const [userNames, setUserNames] = useState<Map<string, string>>(new Map())
    const [branchNames, setBranchNames] = useState<Map<string, string>>(new Map())
    const [attendance, setAttendance] = useState<Record<string, string[]>>({})

    const [tab, setTab] = useState<Tab>('staff')
    const [search, setSearch] = useState('')
    const [departmentFilter, setDepartmentFilter] = useState<string>()
    const [bandFilter, setBandFilter] = useState<string>()
    const [focus, setFocus] = useState<Focus>('all')
    const [compactTarget, setCompactTarget] = useState<{ person: Person; mode: CompactMode; tab: string } | null>(null)
    const [checkInsPerson, setCheckInsPerson] = useState<Person | null>(null)
    const [pepPerson, setPepPerson] = useState<Person | null>(null)
    const [cyclesOpen, setCyclesOpen] = useState(false)
    const [competenciesOpen, setCompetenciesOpen] = useState(false)

    const loadPerformanceDocs = async (name: string) => {
        if (canSeeAll) return (await getDocs(collection(db, name))).docs
        if (!myUid) return []
        const [mine, team] = await Promise.all([
            getDocs(query(collection(db, name), where('employeeAuthUid', '==', myUid))),
            getDocs(query(collection(db, name), where('lineManagerId', '==', myUid)))
        ])
        return [...new Map([...mine.docs, ...team.docs].map(d => [d.id, d])).values()]
    }

    const loadData = async () => {
        setLoading(true)
        try {
            const [usersSnap, compactDocs, cycleSnap, competencySnap, checkInDocs, planDocs, reviewDocs, branchSnap] = await Promise.all([
                getDocs(collection(db, 'users')),
                loadPerformanceDocs('employeePerformanceCompacts'),
                getDocs(collection(db, 'performanceCycles')),
                getDocs(collection(db, 'ipmCompetencies')),
                loadPerformanceDocs('performanceCheckIns'),
                loadPerformanceDocs('performanceEnhancementPlans'),
                loadPerformanceDocs('performanceReviews'),
                // Centres are stored as branches; their names label the score roll-up.
                canSeeAll ? getDocs(collection(db, 'branches')) : Promise.resolve(null)
            ])

            const members = usersSnap.docs
                .map(d => {
                    const data: any = d.data()
                    return {
                        id: d.id,
                        authUid: data.uid || data.authUid || data.userId || d.id,
                        name: data.name || data.fullName || data.email?.split('@')[0],
                        email: data.email,
                        role: data.role,
                        position: data.position || data.jobTitle,
                        department: data.department || data.departmentName,
                        departmentId: data.departmentId || null,
                        branchId: data.assignedBranch || data.branchId || null,
                        status: data.status || 'Active',
                        lineManagerId: data.lineManagerId || null
                    } as StaffMember
                })
                .filter(member => isStaffRole(member.role))
                .filter(member => !isControlEmail(member.email))
                .filter(member => canSeeAll || member.id === myUid || member.lineManagerId === myUid)

            const known = (uid: string) => members.some(m => m.id === uid || m.authUid === uid)
            const compactRows = compactDocs
                .map(d => {
                    const data: any = d.data()
                    return {
                        id: d.id,
                        employeeId: String(data.employeeAuthUid || data.employeeId || ''),
                        cycleId: data.cycleId,
                        financialYear: data.financialYear || 'FY2026/27',
                        status: data.status || 'draft',
                        sectionWeights: data.sectionWeights,
                        items: data.items || [],
                        reviews: data.reviews || {},
                        pdp: data.pdp || [],
                        revisions: data.revisions || [],
                        signoff: data.signoff || {},
                        createdAt: data.createdAt,
                        legacy: data.cycleId
                            ? undefined
                            : {
                                  phase: data.phase,
                                  ratings: data.ratings,
                                  overallSelfComment: data.overallSelfComment,
                                  overallManagerComment: data.overallManagerComment,
                                  createdAtText: data.createdAtText || toDateText(data.createdAt)
                              }
                    } as PerformanceCompact
                })
                .filter(compact => known(compact.employeeId))

            const cycleRows = cycleSnap.docs
                .map(d => ({ ...(d.data() as PerformanceCycle), id: d.id }))
                .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))
            const currentCycleId = cycleForDate(new Date()).id

            setStaff(members)
            // Every user, not only the staff listed: a line manager can sit outside the list.
            setUserNames(
                new Map(
                    usersSnap.docs.flatMap(d => {
                        const data: any = d.data()
                        const name = String(data.name || data.fullName || data.email || d.id)
                        const authUid = data.uid || data.authUid || data.userId
                        return [[d.id, name], ...(authUid ? [[String(authUid), name]] : [])] as [string, string][]
                    })
                )
            )
            setBranchNames(new Map((branchSnap?.docs || []).map(d => [d.id, String(d.get('name') || d.id)])))
            setCompacts(compactRows)
            setCycles(cycleRows)
            setCheckIns(checkInDocs.map(d => ({ ...(d.data() as CheckIn), id: d.id })))
            setPlans(planDocs.map(d => ({ ...(d.data() as EnhancementPlan), id: d.id })))
            setReviewRecords(reviewDocs.map(d => ({ ...(d.data() as ReviewRecord), id: d.id })))
            setCompetencies(
                competencySnap.docs
                    .map(d => ({ ...(d.data() as Competency), id: d.id }))
                    .filter(c => c.active !== false)
                    .sort((a, b) => a.cluster.localeCompare(b.cluster) || a.name.localeCompare(b.name))
            )
            setSelectedCycleId(current =>
                current && cycleRows.some(c => c.id === current)
                    ? current
                    : (cycleRows.find(c => c.id === currentCycleId) || cycleRows[0])?.id
            )
            // Attendance is supporting evidence in the compact only; a failed lookup must not hide the page.
            loadAttendanceEvidence(members)
                .then(setAttendance)
                .catch(error => {
                    console.warn('[EmployeePerformance] attendance evidence unavailable.', error)
                    setAttendance({})
                })
        } catch (error) {
            console.error(error)
            message.error('Failed to load performance.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadData()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, userRole, userDepartmentId, isHR])

    const selectedCycle = useMemo(() => cycles.find(c => c.id === selectedCycleId) || null, [cycles, selectedCycleId])

    const nameById = useMemo(
        () =>
            new Map([
                ...userNames,
                ...(staff.flatMap(m => [[m.id, m.name || m.email || ''], ...(m.authUid ? [[m.authUid, m.name || m.email || '']] : [])]) as [string, string][])
            ]),
        [staff, userNames]
    )
    const nameOfUid = (uid?: string | null) => (uid ? nameById.get(uid) : undefined)

    // Everything the page shows about each person in the selected cycle.
    const people = useMemo<Person[]>(() => {
        const today = dayjs().format('YYYY-MM-DD')
        const viewer: Viewer = { uid: myUid, isHr: isHR, isCeo: isDirector }
        const byUid = <T extends { employeeAuthUid: string }>(list: T[]) => {
            const map = new Map<string, T[]>()
            list.forEach(item => map.set(item.employeeAuthUid, [...(map.get(item.employeeAuthUid) || []), item]))
            return map
        }
        const checkInsBy = byUid(checkIns)
        const plansBy = byUid(plans)
        const recordsBy = byUid(selectedCycle ? reviewRecords.filter(r => r.cycleId === selectedCycle.id) : [])
        const compactBy = new Map(selectedCycle ? compacts.filter(c => c.cycleId === selectedCycle.id).map(c => [c.employeeId, c]) : [])

        return staff.map(member => {
            const uid = member.authUid || member.id
            const isSelf = !!myUid && (member.id === myUid || member.authUid === myUid)
            const compact = compactBy.get(uid) || compactBy.get(member.id)
            const records = Object.fromEntries((recordsBy.get(uid) || []).map(r => [r.phase, r])) as Partial<Record<PhaseKey, ReviewRecord>>
            const midYear = compact ? phaseScore(compact.reviews.midYear?.score, records.midYear) : null
            const yearEnd = compact ? phaseScore(compact.reviews.yearEnd?.score, records.yearEnd) : null
            const memberCheckIns = checkInsBy.get(uid) || []
            // The CEO's own performance is agreed with the board, outside this process.
            const actions =
                selectedCycle && cleanRole(member.role) !== 'director'
                    ? outstandingActions(selectedCycle, today, {
                          uid,
                          lineManagerId: member.lineManagerId,
                          compact: compact ? { signoff: compact.signoff } : null,
                          checkInDates: memberCheckIns.map(c => c.date),
                          reviews: records
                      })
                    : []
            const name = member.name || member.email || member.id
            return {
                ...member,
                name,
                uid,
                isSelf,
                // Nobody manages their own compact: their line manager (or HR) does.
                canManage: !isSelf && (canSeeAll || (!!myUid && member.lineManagerId === myUid)),
                compact,
                records,
                score: annualScore(midYear, yearEnd),
                checkIns: memberCheckIns,
                plans: plansBy.get(uid) || [],
                actions,
                step: nextStep(actions, { uid, name, lineManagerId: member.lineManagerId, isSelf }, viewer, uid => nameById.get(uid))
            }
        })
    }, [staff, compacts, reviewRecords, checkIns, plans, selectedCycle, myUid, isHR, isDirector, canSeeAll, nameById])

    const departments = useMemo(
        () =>
            [...new Set(staff.map(m => m.departmentId).filter(Boolean).map(String))]
                .map(id => ({ value: id, label: nameOf(id) }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        [staff, nameOf]
    )

    const bandOf = (person: Person) => (person.score !== null ? ratingLabel(person.score) : 'Not Rated')
    const needsAttention = (person: Person) => (person.score !== null && person.score < 2.5) || !!person.step?.overdue

    // HR's staff list: search, department, rating band and the tile focus.
    const filtered = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return people.filter(
            person =>
                (!needle ||
                    [person.name, person.email, person.position, person.department].some(v => String(v || '').toLowerCase().includes(needle))) &&
                (!departmentFilter || person.departmentId === departmentFilter) &&
                (!bandFilter || bandOf(person) === bandFilter) &&
                (focus === 'all' || (focus === 'mine' ? !!person.step?.mine : needsAttention(person)))
        )
    }, [people, search, departmentFilter, bandFilter, focus])

    const bands = useMemo(() => RATING_BANDS.map(band => ({ ...band, count: people.filter(p => bandOf(p) === band.label).length })), [people])

    const openCompact = (person: Person, tabKey = 'compact') => {
        if (!selectedCycle) {
            message.info(canSeeAll ? 'Open a performance cycle first.' : 'HR has not opened a performance cycle yet.')
            return
        }
        if (person.isSelf && !person.compact) {
            message.info('Your line manager has not started your compact yet.')
            return
        }
        setCompactTarget({ person, mode: person.isSelf ? 'self' : 'manage', tab: tabKey })
    }

    const openStep = (person: Person) => {
        const step = person.step
        if (!step) return openCompact(person)
        if (step.target === 'check-ins') return setCheckInsPerson(person)
        if (step.target === 'review') return openCompact(person, step.action.phase)
        if (step.target === 'calibration') {
            if (canSeeAll) setTab('calibration')
            else message.info('HR calibrates ratings, and the CEO validates them.')
            return
        }
        if (step.target === 'employees') {
            if (canSeeAll) navigate('/operations/hr/employees')
            else message.info('HR assigns line managers on the Employees page.')
            return
        }
        openCompact(person)
    }

    // What the compact drawer starts from: this cycle's compact, else the
    // employee's pre-cycle ratings for the same year, else the default template.
    const compactInitial = useMemo(() => {
        const person = compactTarget?.person
        if (!person) return null
        if (person.compact?.sectionWeights) {
            const c = person.compact
            return {
                content: { sectionWeights: c.sectionWeights, items: c.items, reviews: c.reviews, pdp: c.pdp, revisions: c.revisions },
                signoff: c.signoff || {},
                exists: true,
                createdAt: c.createdAt,
                legacy: false
            }
        }
        const legacy = selectedCycle
            ? compacts.filter(c => c.legacy && c.financialYear === selectedCycle.label && (c.employeeId === person.uid || c.employeeId === person.id))
            : []
        if (legacy.length) {
            return { content: compactFromLegacy(legacy.map(c => c.legacy as LegacyCompact)), signoff: {}, exists: false, createdAt: undefined, legacy: true }
        }
        return { content: defaultCompactContent(), signoff: {}, exists: false, createdAt: undefined, legacy: false }
    }, [compactTarget, compacts, selectedCycle])

    // Keep an open drawer's person in step with reloaded data.
    const current = (person: Person | null) => (person ? people.find(p => p.id === person.id) || person : null)
    const compactPerson = current(compactTarget?.person || null)
    const checkInsFor = current(checkInsPerson)
    const pepFor = current(pepPerson)

    const calibrationRows: CalibrationRow[] = people
        .filter(p => !p.isSelf && p.compact)
        .map(p => ({
            key: p.id,
            employeeUid: p.uid,
            name: p.name || p.id,
            department: p.department,
            departmentId: p.departmentId,
            lineManagerName: nameOfUid(p.lineManagerId),
            scores: { midYear: p.compact!.reviews.midYear?.score ?? null, yearEnd: p.compact!.reviews.yearEnd?.score ?? null },
            records: p.records
        }))

    const complianceRows: ComplianceRow[] = people
        .filter(p => cleanRole(p.role) !== 'director')
        .map(p => ({
            key: p.id,
            name: p.name || p.id,
            department: p.department,
            departmentId: p.departmentId,
            branchId: p.branchId,
            branchName: p.branchId ? branchNames.get(p.branchId) : undefined,
            lineManagerName: nameOfUid(p.lineManagerId),
            score: p.score,
            state: {
                uid: p.uid,
                lineManagerId: p.lineManagerId,
                compact: p.compact ? { signoff: p.compact.signoff } : null,
                checkInDates: p.checkIns.map(c => c.date),
                reviews: p.records
            }
        }))

    const exportCsv = () => {
        const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
        const header = ['Employee', 'Email', 'Department', 'Line manager', 'Compact', 'Mid-year', 'Year-end', 'Annual rating', 'Next step']
        const lines = filtered.map(p =>
            [
                p.name,
                p.email,
                p.department,
                nameOfUid(p.lineManagerId),
                p.compact ? compactStatusMeta(compactStatus(p.compact.signoff)).label : 'Not started',
                p.records.midYear ? reviewStage(p.records.midYear) : '',
                p.records.yearEnd ? reviewStage(p.records.yearEnd) : '',
                p.score ?? '',
                p.step?.text || ''
            ]
                .map(cell)
                .join(',')
        )
        const blob = new Blob([[header.map(cell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `performance-${selectedCycle?.id || 'all'}-${dayjs().format('YYYYMMDD')}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    const handlers = {
        onStep: openStep,
        onOpenCompact: (person: Person) => openCompact(person),
        onOpenCheckIns: (person: Person) => setCheckInsPerson(person),
        onOpenPlan: (person: Person) => setPepPerson(person)
    }

    const me = people.find(p => p.isSelf) || null
    const team = people.filter(p => !p.isSelf)
    const waitingOnMe = people.filter(p => p.step?.mine).length
    const attention = people.filter(needsAttention).length
    const rated = people.filter(p => p.score !== null).length
    const toggleFocus = (next: Focus) => setFocus(currentFocus => (currentFocus === next ? 'all' : next))
    const focusStyle = (key: Focus): React.CSSProperties =>
        focus === key ? { outline: `2px solid ${token.colorPrimary}`, borderRadius: 16 } : {}

    // The cycle picker and where the year stands, above every view.
    const cycleBar = (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            {cycles.length > 1 || canSeeAll ? (
                <Select
                    placeholder='Cycle'
                    value={selectedCycleId}
                    onChange={setSelectedCycleId}
                    style={{ width: isMobile ? '100%' : 150 }}
                    options={cycles.map(c => ({ value: c.id, label: c.label }))}
                    notFoundContent='No cycle opened'
                />
            ) : null}
            {selectedCycle ? (
                <div style={{ flex: '1 1 420px', minWidth: 0 }}>
                    <CycleTimeline cycle={selectedCycle} />
                </div>
            ) : null}
            {canSeeAll ? (
                <Space style={{ marginLeft: isMobile ? 0 : 'auto' }}>
                    <Tooltip title='Export CSV'>
                        <Button shape='circle' icon={<CloudDownloadOutlined />} onClick={exportCsv} aria-label='Export CSV' />
                    </Tooltip>
                    <Tooltip title='Refresh'>
                        <Button shape='circle' icon={<ReloadOutlined />} onClick={loadData} aria-label='Refresh' />
                    </Tooltip>
                    <Dropdown
                        trigger={['click']}
                        menu={{
                            items: [
                                { key: 'cycles', label: 'Performance cycles' },
                                { key: 'competencies', label: `Competency library (${competencies.length})` }
                            ],
                            onClick: ({ key }) => (key === 'cycles' ? setCyclesOpen(true) : setCompetenciesOpen(true))
                        }}
                    >
                        <Button shape='circle' icon={<SettingOutlined />} aria-label='Cycles and competencies' />
                    </Dropdown>
                </Space>
            ) : null}
        </div>
    )

    const noCycle = !loading && !selectedCycle ? (
        <Alert
            type='warning'
            showIcon
            style={{ marginBottom: 16 }}
            message={`No performance cycle is open for ${cycleForDate(new Date()).label}`}
            description={
                canSeeAll
                    ? 'Open the cycle to set its review windows and start compacting.'
                    : 'HR opens each financial year before compacts can be captured.'
            }
            action={
                canSeeAll ? (
                    <Button type='primary' onClick={() => setCyclesOpen(true)}>
                        Open cycle
                    </Button>
                ) : null
            }
        />
    ) : null

    // HR and the CEO: staff, calibration and compliance.
    const overseerView = (
        <>
            <Segmented
                value={tab}
                onChange={value => setTab(value as Tab)}
                options={[
                    { value: 'staff', label: 'Staff' },
                    { value: 'calibration', label: 'Calibration' },
                    { value: 'compliance', label: 'Compliance' }
                ]}
                block={isMobile}
                style={{ marginBottom: 16 }}
            />
            {tab === 'staff' ? (
                <>
                    <MetricsGrid
                        metrics={[
                            {
                                key: 'staff',
                                important: true,
                                loading,
                                icon: <TeamOutlined />,
                                tone: 'accent',
                                title: 'Staff',
                                value: people.length,
                                subtitle: `${rated} rated this cycle`,
                                onClick: () => setFocus('all')
                            },
                            {
                                key: 'mine',
                                important: true,
                                loading,
                                icon: <ArrowRightOutlined />,
                                tone: 'info',
                                title: 'Waiting on You',
                                mobileTitle: 'For you',
                                value: waitingOnMe,
                                subtitle: 'Your next steps',
                                onClick: () => toggleFocus('mine'),
                                wrapperStyle: focusStyle('mine')
                            },
                            {
                                key: 'attention',
                                loading,
                                icon: <AlertOutlined />,
                                tone: 'danger',
                                title: 'Needs Attention',
                                value: attention,
                                subtitle: 'Rated below 2.5, or overdue',
                                onClick: () => toggleFocus('attention'),
                                wrapperStyle: focusStyle('attention')
                            }
                        ]}
                    />
                    <MotionCard
                        style={{ marginTop: 16 }}
                        loading={loading}
                        skeleton={isMobile ? 'list' : 'table'}
                        skeletonRows={8}
                        skeletonColumns={5}
                        filterBar={
                            <div className='setup-toolbar'>
                                <div className='setup-toolbar-search'>
                                    <Input.Search allowClear placeholder='Search name, email, position, department' value={search} onChange={e => setSearch(e.target.value)} />
                                </div>
                                <div className='setup-toolbar-filter'>
                                    <Select
                                        allowClear
                                        placeholder='Department'
                                        value={departmentFilter}
                                        onChange={setDepartmentFilter}
                                        style={{ width: '100%' }}
                                        options={departments}
                                    />
                                </div>
                            </div>
                        }
                    >
                        {people.length ? (
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: token.colorFillSecondary }}>
                                    {bands
                                        .filter(band => band.count > 0)
                                        .map(band => (
                                            <Tooltip key={band.label} title={`${band.label}: ${band.count}`}>
                                                <div
                                                    style={{
                                                        flex: band.count,
                                                        background: token[band.colorToken],
                                                        opacity: bandFilter && bandFilter !== band.label ? 0.3 : 1,
                                                        cursor: 'pointer'
                                                    }}
                                                    onClick={() => setBandFilter(bandFilter === band.label ? undefined : band.label)}
                                                />
                                            </Tooltip>
                                        ))}
                                </div>
                                <Space wrap size={[14, 4]} style={{ marginTop: 8 }}>
                                    {bands.map(band => (
                                        <Text
                                            key={band.label}
                                            type={bandFilter && bandFilter !== band.label ? 'secondary' : undefined}
                                            style={{ fontSize: 12, cursor: 'pointer' }}
                                            onClick={() => setBandFilter(bandFilter === band.label ? undefined : band.label)}
                                        >
                                            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, marginRight: 6, background: token[band.colorToken] }} />
                                            {band.label} <Text type='secondary' style={{ fontSize: 12 }}>{band.count}</Text>
                                        </Text>
                                    ))}
                                </Space>
                            </div>
                        ) : null}
                        <PeopleList people={filtered} showLineManager nameOf={nameOfUid} emptyText='No staff match these filters.' {...handlers} />
                    </MotionCard>
                </>
            ) : null}
            {tab === 'calibration' ? (
                <MotionCard loading={loading}>
                    <CalibrationPanel
                        cycle={selectedCycle}
                        rows={calibrationRows}
                        isCeo={isDirector}
                        departments={departments}
                        user={{ id: myUid, name: user?.name || user?.email || '' }}
                        onSaved={loadData}
                    />
                </MotionCard>
            ) : null}
            {tab === 'compliance' ? <CompliancePanel cycle={selectedCycle} rows={complianceRows} departments={departments} nameOf={nameOfUid} /> : null}
        </>
    )

    // Everyone else: their own year, then the people who report to them.
    const personalView = (
        <Space direction='vertical' size={16} style={{ width: '100%' }}>
            {me && selectedCycle ? (
                <MyPerformanceCard
                    person={me}
                    cycle={selectedCycle}
                    lineManagerName={nameOfUid(me.lineManagerId)}
                    onStep={openStep}
                    onOpenCompact={handlers.onOpenCompact}
                    onOpenCheckIns={handlers.onOpenCheckIns}
                    onOpenPlan={handlers.onOpenPlan}
                />
            ) : null}
            {team.length ? (
                <Card
                    style={{ borderRadius: 16 }}
                    title={
                        <Space>
                            <TeamOutlined />
                            {`My team · ${team.length}`}
                        </Space>
                    }
                    extra={
                        waitingOnMe - (me?.step?.mine ? 1 : 0) > 0 ? (
                            <Text type='secondary'>{`${waitingOnMe - (me?.step?.mine ? 1 : 0)} waiting on you`}</Text>
                        ) : null
                    }
                    styles={{ body: { padding: isMobile ? 12 : 16 } }}
                >
                    <PeopleList people={team} showLineManager={false} nameOf={nameOfUid} emptyText='Nobody reports to you yet.' {...handlers} />
                </Card>
            ) : null}
            {!loading && !me && !team.length ? <Empty description='You are not part of the performance process yet.' /> : null}
        </Space>
    )

    return (
        <div style={{ padding: isMobile ? '5px 12px 16px' : 24, minHeight: '100vh' }}>
            {cycleBar}
            {noCycle}
            {canSeeAll ? overseerView : loading ? <Card loading style={{ borderRadius: 16 }} /> : personalView}

            <CompactDrawer
                open={!!compactTarget}
                onClose={() => setCompactTarget(null)}
                mode={compactTarget?.mode || 'manage'}
                initialTab={compactTarget?.tab}
                employee={compactPerson}
                lineManagerName={nameOfUid(compactPerson?.lineManagerId)}
                cycle={selectedCycle}
                initial={compactInitial?.content || EMPTY_COMPACT}
                initialSignoff={compactInitial?.signoff}
                exists={!!compactInitial?.exists}
                isLegacySeed={compactInitial?.legacy}
                competencies={competencies}
                canSignAsManager={!!myUid && compactPerson?.lineManagerId === myUid}
                canCheckAsHr={canSeeAll}
                reviewRecords={compactPerson?.records}
                existingCreatedAt={compactInitial?.createdAt}
                attendanceSignals={compactPerson ? attendance[compactPerson.id] : undefined}
                user={{ id: myUid, name: user?.name || user?.email || '', role: user?.role || '' }}
                onSaved={loadData}
            />

            <CheckInsDrawer
                open={!!checkInsFor}
                onClose={() => setCheckInsPerson(null)}
                mode={checkInsFor?.isSelf ? 'self' : 'manage'}
                employee={checkInsFor}
                lineManagerName={nameOfUid(checkInsFor?.lineManagerId)}
                cycle={selectedCycle}
                goals={checkInsFor?.compact?.items || []}
                checkIns={checkInsFor?.checkIns || []}
                score={checkInsFor?.score ?? null}
                user={{ id: myUid, name: user?.name || user?.email || '', role: user?.role || '' }}
                onSaved={loadData}
            />

            <PepDrawer
                open={!!pepFor}
                onClose={() => setPepPerson(null)}
                mode={pepFor?.isSelf ? 'self' : 'manage'}
                employee={pepFor}
                cycle={selectedCycle}
                plans={pepFor?.plans || []}
                user={{ id: myUid, name: user?.name || user?.email || '', role: user?.role || '' }}
                onSaved={loadData}
            />

            <CompetenciesModal open={competenciesOpen} onClose={() => setCompetenciesOpen(false)} competencies={competencies} userId={myUid} onChanged={loadData} />

            <CyclesModal
                open={cyclesOpen}
                onClose={() => setCyclesOpen(false)}
                cycles={cycles}
                userId={myUid}
                onSaved={cycleId => {
                    setSelectedCycleId(cycleId)
                    loadData()
                }}
            />
        </div>
    )
}

export default EmployeePerformancePage
