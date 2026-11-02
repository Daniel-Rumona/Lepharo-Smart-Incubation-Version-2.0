import React, { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Col, DatePicker, Drawer, Empty, Grid, Input, Popover, Row, Segmented, message } from 'antd'
import { useSearchParams } from 'react-router-dom'
import {
    CalendarOutlined,
    ClockCircleOutlined,
    FieldTimeOutlined,
    FilterOutlined,
    PlusOutlined,
    SearchOutlined,
    SettingOutlined,
    TeamOutlined,
    UnorderedListOutlined,
    BarChartOutlined
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Helmet } from 'react-helmet'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import { ChoiceFilter, FilterPanel } from '@/components/workspace'
import { LeaveCalendar } from './LeaveCalendar'
import { LeaveRequestList, displayNameOf, type LeaveSort } from './LeaveRequestList'
import { LeaveRequestDetail } from './LeaveRequestDetail'
import { LeaveBalances } from './LeaveBalances'
import { AssignLeaveModal } from './AssignLeaveModal'
import { LeaveSettingsModal } from './LeaveSettingsModal'
import { LEAVE_TYPES, isOnLeaveOn, requestDays } from './leavePolicy'
import { useLeaveData } from './useLeaveData'
import { typeLabel, type LeaveRequest, type LeaveStatus } from './types'
import './leave.css'

type View = 'requests' | 'balances' | 'calendar'

const STATUS_LABEL: Record<LeaveStatus, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }

/**
 * Leave management for HR and directors (read-only for other staff who can
 * open it): requests in a list with the selected one beside it, everyone's
 * balances, and the team calendar.
 */
const AdminLeaveManagement: React.FC = () => {
    const screens = Grid.useBreakpoint()
    const isMobile = !screens.lg
    const data = useLeaveData()
    const { employees, employeeById, requests, settings, canManage } = data

    const [view, setView] = useState<View>('requests')
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState<'all' | LeaveStatus>('all')
    const [type, setType] = useState('all')
    const [team, setTeam] = useState('all')
    const [period, setPeriod] = useState<[Dayjs, Dayjs] | null>(null)
    const [sort, setSort] = useState<LeaveSort>('newest')
    const [selectedId, setSelectedId] = useState<string>()
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [assignOpen, setAssignOpen] = useState(false)
    const [policyOpen, setPolicyOpen] = useState(false)
    const [assignIds, setAssignIds] = useState<string[]>()

    // ?assign=<userId> (Employees page "Put on leave") opens Record leave with that person ticked.
    const [searchParams, setSearchParams] = useSearchParams()
    const assignParam = searchParams.get('assign')
    useEffect(() => {
        if (!assignParam || data.loading || !settings) return
        if (canManage && employeeById.has(assignParam)) {
            setAssignIds([assignParam])
            setAssignOpen(true)
        } else {
            message.warning('That person can’t be put on leave here (login disabled or not listed).')
        }
        setSearchParams(
            params => {
                params.delete('assign')
                return params
            },
            { replace: true }
        )
    }, [assignParam, data.loading, settings, canManage, employeeById, setSearchParams])

    // ?view=calendar|balances opens that tab; the old /leave-management/calendar link redirects here.
    const viewParam = searchParams.get('view')
    useEffect(() => {
        if (!viewParam) return
        if (viewParam === 'requests' || viewParam === 'balances' || viewParam === 'calendar') setView(viewParam)
        setSearchParams(
            params => {
                params.delete('view')
                return params
            },
            { replace: true }
        )
    }, [viewParam, setSearchParams])

    const today = dayjs()

    const tiles = useMemo(() => {
        const approved = requests.filter(r => r.status === 'approved')
        return {
            pending: requests.filter(r => r.status === 'pending').length,
            onLeave: new Set(approved.filter(r => isOnLeaveOn(r, today)).map(r => r.employeeId)).size,
            upcoming: approved.filter(
                r => dayjs(r.from).isAfter(today, 'day') && !dayjs(r.from).isAfter(today.add(30, 'day'), 'day')
            ).length,
            daysThisYear: approved
                .filter(r => dayjs(r.from).isSame(today, 'year'))
                .reduce((sum, r) => sum + requestDays(r), 0)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requests])

    const teams = useMemo(() => {
        const names = new Set<string>()
        employees.forEach(e => [e.departmentName, e.branchName].forEach(n => n && names.add(n)))
        return Array.from(names).sort()
    }, [employees])

    const inTeam = (employeeId: string) => {
        if (team === 'all') return true
        const e = employeeById.get(employeeId)
        return !!e && (e.departmentName === team || e.branchName === team)
    }

    const visibleRequests = useMemo(() => {
        const q = search.trim().toLowerCase()
        const typeKey = LEAVE_TYPES.find(t => typeLabel(t) === type)
        const list = requests.filter(r => {
            if (status !== 'all' && r.status !== status) return false
            if (typeKey && r.type !== typeKey) return false
            if (!inTeam(r.employeeId)) return false
            if (period && (dayjs(r.to).isBefore(period[0], 'day') || dayjs(r.from).isAfter(period[1], 'day'))) return false
            if (q) {
                const e = employeeById.get(r.employeeId)
                if (!`${displayNameOf(r, e)} ${r.employeeEmail || e?.email || ''}`.toLowerCase().includes(q)) return false
            }
            return true
        })
        return list.sort((a, b) => {
            if (sort === 'name') return displayNameOf(a, employeeById.get(a.employeeId)).localeCompare(displayNameOf(b, employeeById.get(b.employeeId)))
            if (sort === 'starting') return a.from.localeCompare(b.from)
            return (b.appliedDate || '').localeCompare(a.appliedDate || '')
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requests, search, status, type, team, period, sort, employeeById])

    const visibleEmployees = useMemo(() => {
        const q = search.trim().toLowerCase()
        return employees.filter(e => inTeam(e.id) && (!q || `${e.name} ${e.email}`.toLowerCase().includes(q)))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [employees, search, team, employeeById])

    // Select the first request on desktop, and keep the selection valid as filters change.
    useEffect(() => {
        if (isMobile) return
        if (!visibleRequests.some(r => r.id === selectedId)) setSelectedId(visibleRequests[0]?.id)
    }, [visibleRequests, selectedId, isMobile])

    const selected = requests.find(r => r.id === selectedId) || null

    const select = (r: LeaveRequest) => {
        setSelectedId(r.id)
        if (isMobile) setDrawerOpen(true)
    }

    const advancedCount = Number(type !== 'all') + Number(team !== 'all') + Number(!!period)
    const filters = (
        <FilterPanel
            canReset={advancedCount > 0}
            onReset={() => {
                setType('all')
                setTeam('all')
                setPeriod(null)
            }}
        >
            {view === 'requests' && (
                <>
                    <ChoiceFilter
                        id='lv-type'
                        label='Leave type'
                        allLabel='All types'
                        value={type}
                        values={LEAVE_TYPES.map(typeLabel)}
                        onChange={setType}
                    />
                    <div>
                        <label className='ws-filter-label' htmlFor='lv-period'>
                            Dates
                        </label>
                        <DatePicker.RangePicker
                            id='lv-period'
                            style={{ width: '100%' }}
                            value={period}
                            onChange={value => setPeriod(value && value[0] && value[1] ? [value[0], value[1]] : null)}
                        />
                    </div>
                </>
            )}
            <ChoiceFilter id='lv-team' label='Team' allLabel='All teams' value={team} values={teams} onChange={setTeam} />
        </FilterPanel>
    )

    const detail =
        selected && settings ? (
            <LeaveRequestDetail
                request={selected}
                requests={requests}
                employeeById={employeeById}
                settings={settings}
                canManage={canManage}
            />
        ) : null

    const tile = (key: string, title: string, value: number, icon: React.ReactNode, tone: any, onClick?: () => void) => (
        <Col key={key} xs={12} lg={6}>
            <MetricTile icon={icon} tone={tone} title={title} value={value} loading={data.loading} compact={isMobile} onClick={onClick} />
        </Col>
    )

    return (
        <div className='ws-page'>
            <Helmet>
                <title>Leave management</title>
            </Helmet>

            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                {tile('pending', 'Pending', tiles.pending, <ClockCircleOutlined />, 'warning', () => {
                    setView('requests')
                    setStatus('pending')
                })}
                {tile('onLeave', 'On leave today', tiles.onLeave, <TeamOutlined />, 'info')}
                {tile('upcoming', 'Starting in 30 days', tiles.upcoming, <CalendarOutlined />, 'accent')}
                {tile('days', 'Days taken this year', tiles.daysThisYear, <FieldTimeOutlined />, 'success')}
            </Row>

            <DashboardFilterBar>
                <div className='ws-toolbar'>
                    <Segmented
                        className='lv-view'
                        value={view}
                        onChange={v => setView(v as View)}
                        options={[
                            { value: 'requests', label: 'Requests', icon: <UnorderedListOutlined /> },
                            { value: 'balances', label: 'Balances', icon: <BarChartOutlined /> },
                            { value: 'calendar', label: 'Calendar', icon: <CalendarOutlined /> }
                        ]}
                    />
                    {view !== 'calendar' && (
                        <Input
                            className='ws-toolbar-search'
                            placeholder='Search by name or email'
                            prefix={<SearchOutlined />}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            allowClear
                            aria-label='Search leave by employee name or email'
                        />
                    )}
                    {view === 'requests' && (
                        <Segmented
                            className='ws-toolbar-status'
                            block
                            value={status}
                            onChange={v => setStatus(v as typeof status)}
                            options={[
                                { label: 'All', value: 'all' },
                                ...(['pending', 'approved', 'rejected'] as LeaveStatus[]).map(s => ({ label: STATUS_LABEL[s], value: s }))
                            ]}
                        />
                    )}
                    {view !== 'calendar' && (
                        <Popover content={filters} trigger='click' placement='bottomLeft' title='Filters'>
                            <Badge className='ws-toolbar-button' count={advancedCount} size='small' offset={[-6, 4]}>
                                <Button block icon={<FilterOutlined />}>
                                    Filters
                                </Button>
                            </Badge>
                        </Popover>
                    )}
                    {canManage && (
                        <>
                            <Button className='ws-toolbar-button' icon={<SettingOutlined />} onClick={() => setPolicyOpen(true)} disabled={!settings}>
                                Policy
                            </Button>
                            <Button
                                className='ws-toolbar-button'
                                type='primary'
                                icon={<PlusOutlined />}
                                onClick={() => setAssignOpen(true)}
                                disabled={!settings}
                            >
                                Record leave
                            </Button>
                        </>
                    )}
                </div>
            </DashboardFilterBar>

            {view === 'requests' && (
                <div className='ws-layout'>
                    <LeaveRequestList
                        requests={visibleRequests}
                        employeeById={employeeById}
                        loading={data.loading}
                        selectedId={selectedId}
                        onSelect={select}
                        sort={sort}
                        onSortChange={setSort}
                        resetKey={`${search}|${status}|${type}|${team}|${period?.[0]?.valueOf()}|${period?.[1]?.valueOf()}`}
                    />
                    {!isMobile && (
                        <div className='ws-detail-sticky'>
                            {detail || (
                                <MotionCard loading={data.loading} skeleton='text' skeletonRows={8}>
                                    <Empty
                                        className='ws-detail-empty'
                                        description={requests.length ? 'Select a request to review it' : 'No leave requests yet'}
                                    />
                                </MotionCard>
                            )}
                        </div>
                    )}
                </div>
            )}

            {view === 'balances' && settings && (
                <LeaveBalances employees={visibleEmployees} requests={requests} settings={settings} loading={data.loading} />
            )}

            {view === 'calendar' && <LeaveCalendar />}

            {isMobile && (
                <Drawer
                    className='ws-drawer'
                    open={drawerOpen && !!selected}
                    onClose={() => setDrawerOpen(false)}
                    placement='right'
                    width='100%'
                    title={selected ? displayNameOf(selected, employeeById.get(selected.employeeId)) : 'Leave request'}
                >
                    {detail}
                </Drawer>
            )}

            {settings && canManage && (
                <>
                    <AssignLeaveModal
                        open={assignOpen}
                        onClose={() => {
                            setAssignOpen(false)
                            setAssignIds(undefined)
                        }}
                        preselectedIds={assignIds}
                        employees={employees}
                        requests={requests}
                        settings={settings}
                    />
                    <LeaveSettingsModal
                        open={policyOpen}
                        onClose={() => setPolicyOpen(false)}
                        settings={settings}
                        settingsDocId={data.settingsDocId}
                        onSaved={(saved, id) => {
                            data.setSettings(saved)
                            data.setSettingsDocId(id)
                        }}
                    />
                </>
            )}
        </div>
    )
}

export default AdminLeaveManagement
