import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, DatePicker, Modal, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckCircleOutlined, ClockCircleOutlined, CloudDownloadOutlined, FieldTimeOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { MetricsGrid } from '@/components/dashboards/metrics/MetricsGrid'
import { MobileCardList } from '@/components/shared/MobileCardList'
import { useIsMobile } from '@/hooks/useIsMobile'
import { durationMinutes, formatMinutes, uniqueStrings, type EmployeeRow, type TimesheetEntry } from './employeeShared'

const { Text } = Typography
const { RangePicker } = DatePicker

type Range = [dayjs.Dayjs, dayjs.Dayjs]

const lastSevenDays = (): Range => [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')]

const StatusTag: React.FC<{ entry: TimesheetEntry }> = ({ entry }) => (
    <Space size={4} wrap>
        {entry.status === 'checked_in' ? (
            <Tag color='green' style={{ margin: 0 }}>Checked in</Tag>
        ) : entry.status === 'on_break' ? (
            <Tag color='gold' style={{ margin: 0 }}>On break</Tag>
        ) : (
            <Tag style={{ margin: 0 }}>Checked out</Tag>
        )}
        {entry.autoClockedOut ? <Tag color='orange' style={{ margin: 0 }}>Auto</Tag> : null}
    </Space>
)

const isLate = (entry: TimesheetEntry) => durationMinutes(entry.lateBy) > 0
const hasOvertime = (entry: TimesheetEntry) => durationMinutes(entry.overtime) > 0

const csvCell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

type Props = { employee: EmployeeRow | null; onClose: () => void }

export const TimesheetModal: React.FC<Props> = ({ employee, onClose }) => {
    const isMobile = useIsMobile()
    const [range, setRange] = useState<Range>(lastSevenDays)
    const [entries, setEntries] = useState<TimesheetEntry[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!employee) return
        // Ignore a slow response once the employee or range has changed.
        let stale = false
        const [start, end] = range
        setLoading(true)
        setError(null)
        Promise.all(
            uniqueStrings([employee.authUid, employee.id]).map(userId =>
                getDocs(
                    query(
                        collection(db, 'timesheets'),
                        where('userId', '==', userId),
                        where('date', '>=', start.format('YYYY-MM-DD')),
                        where('date', '<=', end.format('YYYY-MM-DD')),
                        orderBy('date', 'desc')
                    )
                )
            )
        )
            .then(snaps => {
                if (stale) return
                const byId = new Map<string, TimesheetEntry>()
                snaps.forEach(snap => snap.docs.forEach(d => byId.set(d.id, { id: d.id, ...d.data() } as TimesheetEntry)))
                setEntries([...byId.values()].sort((a, b) => b.date.localeCompare(a.date)))
            })
            .catch(err => {
                if (stale) return
                console.error('[EmployeesPage] timesheet load failed:', err)
                setEntries([])
                setError('Could not load this timesheet.')
            })
            .finally(() => {
                if (!stale) setLoading(false)
            })
        return () => {
            stale = true
        }
    }, [employee, range])

    const summary = useMemo(
        () => ({
            hours: formatMinutes(entries.reduce((sum, e) => sum + durationMinutes(e.hoursWorked), 0)),
            overtime: formatMinutes(entries.reduce((sum, e) => sum + durationMinutes(e.overtime), 0)),
            late: formatMinutes(entries.reduce((sum, e) => sum + durationMinutes(e.lateBy), 0))
        }),
        [entries]
    )

    const exportCsv = () => {
        if (!employee) return
        const header = 'Date,Check in,Check out,Hours worked,Late by,Overtime,Status,Location'
        const lines = [...entries]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(e =>
                [
                    e.date,
                    e.checkIn || '-',
                    e.checkOut || '-',
                    e.hoursWorked || '0h 0m',
                    e.lateBy || '0m',
                    e.overtime || '0h 0m',
                    e.status,
                    e.locationLabel || e.location || ''
                ]
                    .map(csvCell)
                    .join(',')
            )
        const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `timesheet_${employee.name.replace(/\s+/g, '_')}_${range[0].format('YYYYMMDD')}_${range[1].format('YYYYMMDD')}.csv`
        link.click()
        URL.revokeObjectURL(url)
    }

    const columns: ColumnsType<TimesheetEntry> = [
        { title: 'Date', dataIndex: 'date', key: 'date', render: (v: string) => dayjs(v).format('ddd D MMM') },
        { title: 'In', dataIndex: 'checkIn', key: 'checkIn', render: (v?: string) => v || '—' },
        { title: 'Out', dataIndex: 'checkOut', key: 'checkOut', render: (v?: string) => v || '—' },
        { title: 'Hours', dataIndex: 'hoursWorked', key: 'hoursWorked', render: (v?: string) => v || '0h 0m' },
        {
            title: 'Late',
            key: 'lateBy',
            render: (_, e) => (isLate(e) ? <Tag color='orange'>{e.lateBy}</Tag> : <Text type='secondary'>On time</Text>)
        },
        {
            title: 'Overtime',
            key: 'overtime',
            render: (_, e) => (hasOvertime(e) ? <Tag color='blue'>+{e.overtime}</Tag> : <Text type='secondary'>—</Text>)
        },
        { title: 'Status', key: 'status', render: (_, e) => <StatusTag entry={e} /> },
        {
            title: 'Location',
            key: 'location',
            render: (_, e) => (
                <Space direction='vertical' size={0}>
                    <Text>{e.locationLabel || e.location || '—'}</Text>
                    {typeof e.locationAccuracy === 'number' ? (
                        <Text type='secondary' style={{ fontSize: 12 }}>±{Math.round(e.locationAccuracy)} m</Text>
                    ) : null}
                </Space>
            )
        }
    ]

    return (
        <Modal
            open={Boolean(employee)}
            onCancel={onClose}
            footer={null}
            width={isMobile ? undefined : 1000}
            destroyOnClose
            title={employee ? `Timesheet · ${employee.name}` : 'Timesheet'}
        >
            <div className='setup-toolbar' style={{ marginBottom: 12 }}>
                <div className='setup-toolbar-search'>
                    <RangePicker
                        value={range}
                        onChange={value => value?.[0] && value[1] && setRange([value[0].startOf('day'), value[1].endOf('day')])}
                        allowClear={false}
                        style={{ width: '100%' }}
                        aria-label='Date range'
                    />
                </div>
                <div className='setup-toolbar-action'>
                    <Button icon={<CloudDownloadOutlined />} onClick={exportCsv} disabled={loading || !entries.length}>
                        Export CSV
                    </Button>
                </div>
            </div>

            <div style={{ marginBottom: 12 }}>
                <MetricsGrid
                    mobileColumns={3}
                    metrics={[
                        { key: 'hours', important: true, loading, icon: <ClockCircleOutlined />, tone: 'accent', title: 'Hours worked', mobileTitle: 'Hours', value: summary.hours },
                        { key: 'overtime', important: true, loading, icon: <CheckCircleOutlined />, tone: 'success', title: 'Overtime', value: summary.overtime },
                        { key: 'late', important: true, loading, icon: <FieldTimeOutlined />, tone: 'warning', title: 'Late total', mobileTitle: 'Late', value: summary.late }
                    ]}
                />
            </div>

            {error ? <Alert type='error' showIcon message={error} style={{ marginBottom: 12 }} /> : null}

            {isMobile ? (
                <MobileCardList
                    data={entries}
                    loading={loading}
                    getKey={e => e.id}
                    emptyText='No clock-ins in this range.'
                    renderCard={e => ({
                        title: dayjs(e.date).format('ddd D MMM YYYY'),
                        subtitle: e.locationLabel || e.location || undefined,
                        badge: <StatusTag entry={e} />,
                        fields: [
                            { label: 'In / out', value: `${e.checkIn || '—'} – ${e.checkOut || '—'}` },
                            { label: 'Hours', value: e.hoursWorked || '0h 0m' },
                            { label: 'Late', value: isLate(e) ? e.lateBy : 'On time' },
                            { label: 'Overtime', value: hasOvertime(e) ? `+${e.overtime}` : '—' }
                        ]
                    })}
                />
            ) : (
                <Table<TimesheetEntry>
                    rowKey='id'
                    size='middle'
                    loading={loading}
                    dataSource={entries}
                    columns={columns}
                    pagination={{ pageSize: 8, hideOnSinglePage: true }}
                    locale={{ emptyText: 'No clock-ins in this range.' }}
                    scroll={{ x: 820 }}
                />
            )}
        </Modal>
    )
}

export default TimesheetModal
