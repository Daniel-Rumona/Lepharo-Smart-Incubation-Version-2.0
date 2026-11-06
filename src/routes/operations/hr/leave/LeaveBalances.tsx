import React, { useMemo } from 'react'
import { Empty, Table, Tooltip } from 'antd'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar } from '@/components/workspace'
import { LEAVE_TYPES, capFor, remainingFor } from './leavePolicy'
import { typeLabel, type Employee, type LeaveRequest, type LeaveSettings, type LeaveType } from './types'

type Props = {
    employees: Employee[]
    requests: LeaveRequest[]
    settings: LeaveSettings
    loading: boolean
}

/** Days used against the cap, as a short bar with "used/cap" beside it. */
const UsageCell: React.FC<{ used: number; cap: number }> = ({ used, cap }) => {
    const share = cap > 0 ? Math.min(1, used / cap) : 0
    const tone = share >= 1 ? 'is-full' : share >= 0.75 ? 'is-high' : ''
    return (
        <Tooltip title={`${used} of ${cap} days used · ${Math.max(0, cap - used)} left`}>
            <div className={`lv-usage ${tone}`}>
                <span className='lv-usage-track' aria-hidden='true'>
                    <span style={{ width: `${share * 100}%` }} />
                </span>
                <span className='lv-usage-figure'>
                    {used}/{cap}
                </span>
            </div>
        </Tooltip>
    )
}

/** Every staff member's leave used per type, against the policy's caps. */
export const LeaveBalances: React.FC<Props> = ({ employees, requests, settings, loading }) => {
    const rows = useMemo(
        () =>
            employees.map(employee => ({
                employee,
                used: Object.fromEntries(
                    LEAVE_TYPES.map(type => {
                        const cap = capFor(settings, type) ?? 0
                        const remaining = remainingFor(requests, settings, employee.id, type) ?? cap
                        return [type, Math.max(0, cap - remaining)]
                    })
                ) as Record<LeaveType, number>
            })),
        [employees, requests, settings]
    )

    return (
        <MotionCard>
            <Table
                size='middle'
                rowKey={r => r.employee.id}
                loading={loading}
                dataSource={rows}
                scroll={{ x: 900 }}
                pagination={{ pageSize: 12, position: ['bottomCenter'], showSizeChanger: false }}
                locale={{ emptyText: <Empty description='No staff match these filters' /> }}
                columns={[
                    {
                        title: 'Employee',
                        key: 'employee',
                        fixed: 'left',
                        width: 240,
                        sorter: (a, b) => (a.employee.name || '').localeCompare(b.employee.name || ''),
                        render: (_, r) => (
                            <div className='lv-person'>
                                <EntityAvatar name={r.employee.name || r.employee.email || '?'} photo={r.employee.photoURL} size={32} />
                                <div className='lv-person-text'>
                                    <div className='ws-row-name'>{r.employee.name || r.employee.email || '—'}</div>
                                    <div className='ws-row-meta'>
                                        {r.employee.departmentName || r.employee.branchName || '—'}
                                    </div>
                                </div>
                            </div>
                        )
                    },
                    ...LEAVE_TYPES.map(type => ({
                        title: typeLabel(type),
                        key: type,
                        sorter: (a: (typeof rows)[number], b: (typeof rows)[number]) => a.used[type] - b.used[type],
                        render: (_: unknown, r: (typeof rows)[number]) => (
                            <UsageCell used={r.used[type]} cap={capFor(settings, type) ?? 0} />
                        )
                    }))
                ]}
            />
        </MotionCard>
    )
}
