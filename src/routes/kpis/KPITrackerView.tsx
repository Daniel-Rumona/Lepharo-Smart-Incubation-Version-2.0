import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { DatePicker, Drawer, Empty, Grid, Input, Segmented, message } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { addDoc, collection, doc, getDocs, updateDoc } from 'firebase/firestore'
import dayjs, { Dayjs } from 'dayjs'
import { motion, useReducedMotion } from 'framer-motion'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useColorMode } from '@/contexts/ThemeContext'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'
import { DepartmentSelect } from '@/components/kpis/builder/DepartmentSelect'
import {
    STATUS_ORDER,
    computeRow,
    computeTrend,
    periodStart,
    readDef,
    readTarget,
    type KpiDef,
    type KpiRow,
    type KpiStatus,
    type TargetDoc,
    type TrendPoint
} from './tracker/trackerModel'
import { TrackerList, type TrackerSort } from './tracker/TrackerList'
import { TrackerDetail } from './tracker/TrackerDetail'
import { DepartmentCompare, type DeptSnapshot } from './tracker/DepartmentCompare'
import './kpi-register.css'
import './tracker/kpi-tracker.css'

const { useBreakpoint } = Grid

/** The status strip: "To update" gathers everything waiting on someone (an actual or a target). */
type StatusFilter = 'all' | 'behind' | 'update' | 'on-track' | 'achieved'
const STATUS_SEGMENTS: { value: StatusFilter; label: string; short: string; count: 'total' | 'behind' | 'update' | 'onTrack' | 'achieved'; tone: string }[] = [
    { value: 'all', label: 'All', short: 'All', count: 'total', tone: 'neutral' },
    { value: 'behind', label: 'Behind', short: 'Behind', count: 'behind', tone: 'danger' },
    { value: 'update', label: 'To update', short: 'Update', count: 'update', tone: 'warning' },
    { value: 'on-track', label: 'On track', short: 'On track', count: 'onTrack', tone: 'info' },
    { value: 'achieved', label: 'Achieved', short: 'Done', count: 'achieved', tone: 'success' }
]
const matchesStatus = (status: KpiStatus, filter: StatusFilter) =>
    filter === 'all'
    || (filter === 'update' ? status === 'to-update' || status === 'no-target' : status === filter)

const KPITrackerView: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const { nameOf } = useDepartmentRoles()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const { isDark } = useColorMode()
    const screens = useBreakpoint()
    const isPhone = !screens.md
    const reduceMotion = useReducedMotion()
    const rise = (delay: number) =>
        reduceMotion ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: 'easeOut' as const, delay } }

    // Main departments and project admins see every department; others their own.
    const isProjectAdmin = String((user as any)?.role || '').toLowerCase().replace(/\s+/g, '') === 'projectadmin'
    const [isMainDept, setIsMainDept] = useState(false)
    const managesAll = isMainDept || isProjectAdmin
    const [ownDepartment, setOwnDepartment] = useState('')
    const [department, setDepartment] = useState('')

    const [view, setView] = useState<'kpis' | 'departments'>('kpis')
    const [month, setMonth] = useState<Dayjs>(dayjs().startOf('month'))
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
    const [sort, setSort] = useState<TrackerSort>('attention')

    const [defs, setDefs] = useState<KpiDef[]>([])
    const [targetsByKpi, setTargetsByKpi] = useState<Record<string, TargetDoc[]>>({})
    const [defsLoading, setDefsLoading] = useState(true)

    const [rows, setRows] = useState<KpiRow[]>([])
    const [rowsLoading, setRowsLoading] = useState(false)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [detailOpen, setDetailOpen] = useState(false)
    const [saving, setSaving] = useState(false)

    const [trend, setTrend] = useState<TrendPoint[]>([])
    const [trendLoading, setTrendLoading] = useState(false)

    const [snapshots, setSnapshots] = useState<DeptSnapshot[]>([])
    const [snapshotsLoading, setSnapshotsLoading] = useState(false)

    // ---- who am I ----
    useEffect(() => {
        if (identityLoading || !user) return
        ;(async () => {
            try {
                const ownId = String(user.departmentId || '').trim()
                if (ownId) {
                    const snap = await getDocs(collection(db, 'departments'))
                    const dept = snap.docs.find(d => d.id === ownId)?.data() as any
                    if (dept) setIsMainDept(Boolean(dept.isMain))
                }
                setOwnDepartment(ownId)
                setDepartment(current => current || ownId)
            } catch (err) {
                console.error(err)
            }
        })()
    }, [identityLoading, user])

    // ---- every active KPI definition and target, loaded once ----
    useEffect(() => {
        if (identityLoading) return
        if (!user) { setDefsLoading(false); return }
        ;(async () => {
            setDefsLoading(true)
            try {
                const [defsSnap, targetSnap] = await Promise.all([getDocs(collection(db, 'kpiDefinitions')), getDocs(collection(db, 'kpiTargets'))])
                setDefs(defsSnap.docs.filter(d => (d.data() as any).active !== false).map(d => readDef(d.id, d.data())).filter(d => d.departmentId))
                const byKpi: Record<string, TargetDoc[]> = {}
                targetSnap.docs.forEach(d => {
                    const t = readTarget(d.id, d.data())
                    ;(byKpi[t.kpiId] ||= []).push(t)
                })
                setTargetsByKpi(byKpi)
            } catch (err) {
                console.error(err)
                message.error('Failed to load KPIs and targets.')
            } finally {
                setDefsLoading(false)
            }
        })()
    }, [identityLoading, user])

    // A KPI is in view when it belongs to the active programme or applies to all.
    const inProgramme = useCallback(
        (def: KpiDef) => isAllPrograms || def.appliesToAllPrograms || def.programId === activeProgramId,
        [isAllPrograms, activeProgramId]
    )

    // Departments that actually have KPIs in this programme, for the picker and comparison.
    const departmentIds = useMemo(
        () =>
            Array.from(new Set(defs.filter(inProgramme).map(d => d.departmentId)))
                .sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
        [defs, inProgramme, nameOf]
    )

    // A manager without KPIs of their own (or without a department) starts on the first one that has some.
    useEffect(() => {
        if (!managesAll || !departmentIds.length) return
        if (!department || !departmentIds.includes(department)) {
            setDepartment(departmentIds.includes(ownDepartment) ? ownDepartment : departmentIds[0])
        }
    }, [managesAll, departmentIds, department, ownDepartment])

    // ---- the department's KPIs for the month ----
    useEffect(() => {
        if (defsLoading || !department || view !== 'kpis') return
        let cancelled = false
        ;(async () => {
            setRowsLoading(true)
            try {
                const mine = defs.filter(d => d.departmentId === department && inProgramme(d))
                const results = await Promise.all(mine.map(d => computeRow(d, targetsByKpi[d.id] || [], month)))
                if (!cancelled) setRows(results)
            } finally {
                if (!cancelled) setRowsLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [defs, targetsByKpi, department, month, inProgramme, defsLoading, view])

    // ---- every department, only while that view is open ----
    useEffect(() => {
        if (defsLoading || view !== 'departments' || !managesAll) return
        let cancelled = false
        ;(async () => {
            setSnapshotsLoading(true)
            try {
                const next = await Promise.all(departmentIds.map(async id => {
                    const results = await Promise.all(
                        defs.filter(d => d.departmentId === id && inProgramme(d)).map(d => computeRow(d, targetsByKpi[d.id] || [], month))
                    )
                    const count = (s: KpiStatus[]) => results.filter(r => s.includes(r.status)).length
                    return {
                        id,
                        name: nameOf(id),
                        total: results.length,
                        achieved: count(['achieved']),
                        onTrack: count(['on-track']),
                        behind: count(['behind']),
                        toUpdate: count(['to-update', 'no-target'])
                    }
                }))
                if (!cancelled) setSnapshots(next.filter(s => s.total))
            } finally {
                if (!cancelled) setSnapshotsLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [defs, targetsByKpi, departmentIds, month, inProgramme, defsLoading, view, managesAll, nameOf])

    const visibleRows = useMemo(() => {
        const q = search.trim().toLowerCase()
        const filtered = rows.filter(r =>
            matchesStatus(r.status, statusFilter)
            && (!q || [r.def.kpiLabel, r.def.deliverable, r.def.measurementIndicator].filter(Boolean).some(v => String(v).toLowerCase().includes(q)))
        )
        const byName = (a: KpiRow, b: KpiRow) => a.def.kpiLabel.localeCompare(b.def.kpiLabel)
        return filtered.sort((a, b) =>
            sort === 'name'
                ? byName(a, b)
                : sort === 'lowest'
                    ? (a.percent ?? -1) - (b.percent ?? -1) || byName(a, b)
                    : STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byName(a, b)
        )
    }, [rows, search, statusFilter, sort])

    // Keep a selection on desktop: the first KPI when the current one drops out of view.
    useEffect(() => {
        if (!visibleRows.length) { setSelectedId(null); return }
        if (!selectedId || !visibleRows.some(r => r.def.id === selectedId)) setSelectedId(visibleRows[0].def.id)
    }, [visibleRows, selectedId])

    const selectedRow = visibleRows.find(r => r.def.id === selectedId) || null

    // ---- the selected KPI's recent periods ----
    const selectedDef = selectedRow?.def
    useEffect(() => {
        if (!selectedDef || selectedDef.kpiKind === 'qualitative') { setTrend([]); return }
        let cancelled = false
        ;(async () => {
            setTrendLoading(true)
            try {
                const points = await computeTrend(selectedDef, targetsByKpi[selectedDef.id] || [], month)
                if (!cancelled) setTrend(points)
            } finally {
                if (!cancelled) setTrendLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [selectedDef, targetsByKpi, month])

    const counts = useMemo(() => {
        const n = (s: KpiStatus[]) => rows.filter(r => s.includes(r.status)).length
        return { total: rows.length, achieved: n(['achieved']), onTrack: n(['on-track']), behind: n(['behind']), update: n(['to-update', 'no-target']) }
    }, [rows])

    const patchTarget = (kpiId: string, target: TargetDoc) =>
        setTargetsByKpi(current => {
            const list = current[kpiId] || []
            return { ...current, [kpiId]: list.some(t => t.id === target.id) ? list.map(t => (t.id === target.id ? target : t)) : [...list, target] }
        })

    const recordActual = async (row: KpiRow, value: number) => {
        if (!row.targetId) return
        setSaving(true)
        try {
            await updateDoc(doc(db, 'kpiTargets', row.targetId), { actual: value, actualUpdatedBy: user?.uid || 'system', actualUpdatedAt: new Date() })
            const existing = (targetsByKpi[row.def.id] || []).find(t => t.id === row.targetId)
            if (existing) patchTarget(row.def.id, { ...existing, actual: value })
            message.success('Actual recorded.')
        } catch (err) {
            console.error(err)
            message.error('Failed to save the actual value.')
        } finally {
            setSaving(false)
        }
    }

    // Deliverables have no separate target step: the first Done / Not done commits target 1 for the period.
    const recordDone = async (row: KpiRow, done: boolean) => {
        const actual = done ? 1 : 0
        setSaving(true)
        try {
            if (row.targetId) {
                await updateDoc(doc(db, 'kpiTargets', row.targetId), { actual, actualUpdatedBy: user?.uid || 'system', actualUpdatedAt: new Date() })
                const existing = (targetsByKpi[row.def.id] || []).find(t => t.id === row.targetId)
                if (existing) patchTarget(row.def.id, { ...existing, actual })
            } else {
                const by = user?.uid || 'system'
                const ref = await addDoc(collection(db, 'kpiTargets'), {
                    kpiId: row.def.id,
                    kpiLabel: row.def.kpiLabel,
                    departmentId: row.def.departmentId,
                    department: row.def.department,
                    periodType: row.periodType,
                    periodKey: row.periodKey,
                    periodStartAt: periodStart(row.periodType, row.periodKey).toDate(),
                    target: 1,
                    actual,
                    actualUpdatedBy: by,
                    actualUpdatedAt: new Date(),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    createdBy: by,
                    updatedBy: by
                })
                patchTarget(row.def.id, { id: ref.id, target: 1, periodKey: row.periodKey, periodType: row.periodType, actual })
            }
            message.success(done ? 'Marked as done.' : 'Marked as not done.')
        } catch (err) {
            console.error(err)
            message.error('Failed to record this period.')
        } finally {
            setSaving(false)
        }
    }

    const renderDetail = () =>
        selectedRow ? (
            <TrackerDetail
                row={selectedRow}
                trend={trend}
                trendLoading={trendLoading}
                saving={saving}
                onRecordActual={value => recordActual(selectedRow, value)}
                onRecordDone={done => recordDone(selectedRow, done)}
                isDark={isDark}
            />
        ) : null

    const monthText = month.format('MMMM YYYY')
    const loading = identityLoading || defsLoading || rowsLoading

    const openDepartment = useCallback((departmentId: string) => {
        setDepartment(departmentId)
        setStatusFilter('all')
        setView('kpis')
    }, [])

    return (
        <div className='ws-page'>
            <motion.div {...rise(0)}>
                <DashboardFilterBar>
                    <div className='ws-toolbar'>
                        {managesAll && (
                            <Segmented
                                className='trk-view'
                                value={view}
                                onChange={v => setView(v as 'kpis' | 'departments')}
                                options={[{ label: 'KPIs', value: 'kpis' }, { label: 'Departments', value: 'departments' }]}
                                aria-label='View'
                            />
                        )}
                        {view === 'kpis' && (
                            <>
                                <Input
                                    className='ws-toolbar-search'
                                    placeholder='Search KPIs'
                                    prefix={<SearchOutlined />}
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    allowClear
                                    aria-label='Search KPIs'
                                />
                                {managesAll && departmentIds.length > 1 && (
                                    <div className='trk-department'>
                                        <DepartmentSelect
                                            id='trk-department'
                                            departments={departmentIds.map(id => ({ id, name: nameOf(id) }))}
                                            value={department}
                                            onChange={id => { setDepartment(id); setStatusFilter('all') }}
                                        />
                                    </div>
                                )}
                            </>
                        )}
                        <DatePicker
                            className='ws-toolbar-period trk-month'
                            picker='month'
                            value={month}
                            allowClear={false}
                            format='MMMM YYYY'
                            aria-label='Month'
                            disabledDate={current => !!current && current.isAfter(dayjs().endOf('month'))}
                            onChange={value => value && setMonth(value.startOf('month'))}
                        />
                        {view === 'kpis' && (
                            <Segmented
                                className='ws-toolbar-status trk-status-strip'
                                block
                                value={statusFilter}
                                onChange={v => setStatusFilter(v as StatusFilter)}
                                options={STATUS_SEGMENTS.map(seg => ({
                                    value: seg.value,
                                    label: (
                                        <span className='trk-seg'>
                                            {isPhone ? seg.short : seg.label}
                                            {/* The count replaces the old metric tiles; hidden until the month has loaded. */}
                                            {!loading && <span className={`trk-seg-count qtx-tone-${seg.tone}`}>{counts[seg.count]}</span>}
                                        </span>
                                    )
                                }))}
                                aria-label='Filter by standing'
                            />
                        )}
                    </div>
                </DashboardFilterBar>
            </motion.div>

            {view === 'departments' && managesAll ? (
                <DepartmentCompare snapshots={snapshots} loading={snapshotsLoading || defsLoading} periodText={monthText} onOpen={openDepartment} isDark={isDark} />
            ) : !loading && !rows.length ? (
                <MotionCard>
                    <Empty
                        className='ws-detail-empty'
                        description={department ? `${nameOf(department)} has no KPIs for this programme yet.` : 'Your department has no KPIs for this programme yet.'}
                    />
                </MotionCard>
            ) : (
                <div className='ws-layout'>
                    <TrackerList
                        rows={visibleRows}
                        loading={loading}
                        selectedId={selectedRow?.def.id || null}
                        onSelect={row => {
                            setSelectedId(row.def.id)
                            if (isPhone) setDetailOpen(true)
                        }}
                        sort={sort}
                        onSortChange={setSort}
                        resetKey={`${department}|${month.format('YYYY-MM')}|${statusFilter}|${search}`}
                        emptyText={statusFilter === 'all' ? 'No KPIs match your search' : 'No KPIs with this standing'}
                    />
                    {!isPhone && (
                        <div className='ws-detail-sticky'>
                            {loading ? (
                                <MotionCard loading skeleton='text' skeletonRows={10}>{null}</MotionCard>
                            ) : renderDetail() || (
                                <MotionCard>
                                    <Empty className='ws-detail-empty' description='No KPIs with this standing' />
                                </MotionCard>
                            )}
                        </div>
                    )}
                </div>
            )}

            {isPhone && (
                <Drawer
                    className='ws-drawer ws-sheet'
                    open={detailOpen && !!selectedRow}
                    onClose={() => setDetailOpen(false)}
                    placement='bottom'
                    height='88vh'
                    title={selectedRow?.def.kpiLabel || 'KPI'}
                >
                    {renderDetail()}
                </Drawer>
            )}
        </div>
    )
}

export default KPITrackerView
