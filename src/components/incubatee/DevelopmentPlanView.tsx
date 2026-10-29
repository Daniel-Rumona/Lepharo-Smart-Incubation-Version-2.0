import React from 'react'
import { Button, Collapse, Empty, Popconfirm, Skeleton, Tooltip, Typography, theme } from 'antd'
import {
    CheckCircleFilled,
    CheckOutlined,
    ClockCircleOutlined,
    DeleteOutlined,
    LockOutlined
} from '@ant-design/icons'
import './DevelopmentPlanView.css'

const { Text } = Typography

/**
 * Where a department's part of the plan stands, from the SME's side:
 * - ready: the department has submitted; the SME should review and confirm
 * - confirmed: the SME has confirmed it
 * - waiting: the department has not submitted yet
 * - no-signoff: only compulsory items, which need no confirmation
 */
export type PlanDeptStatus = 'ready' | 'confirmed' | 'waiting' | 'no-signoff'

export type PlanIntervention = {
    key: string
    title: string
    departmentName: string
    compulsory: boolean
    /** The plan entry itself, handed back on remove. */
    raw: any
}

export type PlanDept = {
    id: string
    name: string
    status: PlanDeptStatus
    /** Display date the SME confirmed, when confirmed. */
    confirmedAt?: string
    interventions: PlanIntervention[]
}

type Props = {
    loading: boolean
    departments: PlanDept[]
    finalized: boolean
    confirmingId: string | null
    finalizing: boolean
    removingDeptId: string | null
    onConfirm: (deptId: string) => void
    onRemove: (deptId: string, intervention: any) => void
}

const STATUS_META: Record<PlanDeptStatus, { label: string; order: number }> = {
    ready: { label: 'Ready for you', order: 0 },
    confirmed: { label: 'Confirmed', order: 1 },
    'no-signoff': { label: 'No sign-off needed', order: 2 },
    waiting: { label: 'Waiting for department', order: 3 }
}

/**
 * The SME's development plan: one summary of how far confirmation has got,
 * then each department as an expandable row with what it will deliver and a
 * single Confirm action. Shared by desktop and phones; the stylesheet only
 * re-flows it. Colours come from the antd theme as --dp-* custom properties,
 * so it follows the colour mode and accent.
 */
export default function DevelopmentPlanView({
    loading,
    departments,
    finalized,
    confirmingId,
    finalizing,
    removingDeptId,
    onConfirm,
    onRemove
}: Props) {
    const { token } = theme.useToken()

    const themeVars = {
        '--dp-accent': token.colorPrimary,
        '--dp-success': token.colorSuccess,
        '--dp-warning': token.colorWarning,
        '--dp-muted': token.colorTextSecondary,
        '--dp-faint': token.colorTextTertiary,
        '--dp-line': token.colorBorderSecondary,
        '--dp-surface': token.colorBgContainer,
        '--dp-fill': token.colorFillQuaternary,
        '--dp-track': token.colorFillSecondary
    } as React.CSSProperties

    if (loading) {
        return (
            <div className="dp dp-single" style={themeVars}>
                <Skeleton active paragraph={{ rows: 6 }} />
            </div>
        )
    }

    if (!departments.length) {
        return (
            <div className="dp dp-single" style={themeVars}>
                <Empty description="No departments are set up for development plans yet." />
            </div>
        )
    }

    // Departments that need a decision from the SME count towards progress.
    const signOff = departments.filter(d => d.status !== 'no-signoff')
    const confirmedCount = signOff.filter(d => d.status === 'confirmed').length
    const readyCount = signOff.filter(d => d.status === 'ready').length
    const submittedCount = signOff.filter(d => d.status !== 'waiting').length

    const sorted = [...departments].sort(
        (a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order || a.name.localeCompare(b.name)
    )
    const firstReady = sorted.find(d => d.status === 'ready')?.id

    const summaryLine = finalized
        ? 'Your plan is finalized. You confirmed every department.'
        : readyCount
            ? `${readyCount} ${readyCount === 1 ? 'department is' : 'departments are'} ready for you to review and confirm.`
            : submittedCount < signOff.length
                ? 'Nothing to confirm right now. Departments still finishing their part appear here when ready.'
                : 'You are up to date.'

    return (
        <div className="dp" style={themeVars}>
            <section className={`dp-summary${finalized ? ' is-finalized' : ''}`} aria-label="Confirmation progress">
                <div className="dp-summary-head">
                    <div className="dp-summary-count">
                        {finalized ? <CheckCircleFilled className="dp-summary-done" /> : null}
                        <span className="dp-summary-number">
                            {confirmedCount}
                            <span className="dp-summary-total">/{signOff.length}</span>
                        </span>
                        <span className="dp-summary-label">departments confirmed by you</span>
                    </div>
                    <span className="dp-summary-sub">
                        {submittedCount} of {signOff.length} submitted by departments
                    </span>
                </div>

                {/* One segment per department, in the same order as the list. */}
                <div className="dp-segments" aria-hidden="true">
                    {sorted
                        .filter(d => d.status !== 'no-signoff')
                        .map(d => (
                            <span key={d.id} className={`dp-segment is-${d.status}`} />
                        ))}
                </div>

                <p className="dp-summary-line">{summaryLine}</p>
            </section>

            <Collapse
                className="dp-depts"
                bordered={false}
                defaultActiveKey={firstReady ? [firstReady] : []}
                expandIconPosition="end"
                items={sorted.map(dept => ({
                    key: dept.id,
                    className: `dp-dept is-${dept.status}`,
                    collapsible: dept.status === 'waiting' && !dept.interventions.length ? 'disabled' : undefined,
                    showArrow: !(dept.status === 'waiting' && !dept.interventions.length),
                    label: (
                        <div className="dp-dept-head">
                            <span className="dp-dept-mark" aria-hidden="true">
                                {dept.status === 'confirmed' ? (
                                    <CheckOutlined />
                                ) : dept.status === 'waiting' ? (
                                    <ClockCircleOutlined />
                                ) : dept.status === 'no-signoff' ? (
                                    <LockOutlined />
                                ) : (
                                    <span className="dp-dept-dot" />
                                )}
                            </span>
                            <span className="dp-dept-name">{dept.name}</span>
                            <span className="dp-dept-meta">
                                <span className={`dp-pill is-${dept.status}`}>{STATUS_META[dept.status].label}</span>
                                {dept.interventions.length ? (
                                    <span className="dp-dept-count">
                                        {dept.interventions.length}{' '}
                                        {dept.interventions.length === 1 ? 'intervention' : 'interventions'}
                                    </span>
                                ) : null}
                            </span>
                        </div>
                    ),
                    children: (
                        <div className="dp-dept-body">
                            {dept.interventions.length ? (
                                <ul className="dp-ivs">
                                    {dept.interventions.map(iv => {
                                        const canRemove = !finalized && !iv.compulsory && dept.status !== 'no-signoff'
                                        return (
                                            <li key={iv.key} className="dp-iv">
                                                <div className="dp-iv-text">
                                                    <Text strong className="dp-iv-title">{iv.title}</Text>
                                                    <span className="dp-iv-area">
                                                        {iv.departmentName}
                                                        {iv.compulsory ? <span className="dp-iv-tag">Compulsory</span> : null}
                                                    </span>
                                                </div>
                                                {canRemove ? (
                                                    <Popconfirm
                                                        title="Remove this intervention?"
                                                        description="Remove it if you already have it in place."
                                                        okText="Remove"
                                                        okButtonProps={{ danger: true }}
                                                        onConfirm={() => onRemove(dept.id, iv.raw)}
                                                    >
                                                        <Tooltip title="Remove">
                                                            <Button
                                                                type="text"
                                                                size="small"
                                                                className="dp-iv-remove"
                                                                aria-label={`Remove ${iv.title}`}
                                                                icon={<DeleteOutlined />}
                                                                loading={removingDeptId === dept.id}
                                                            />
                                                        </Tooltip>
                                                    </Popconfirm>
                                                ) : null}
                                            </li>
                                        )
                                    })}
                                </ul>
                            ) : (
                                <p className="dp-note">No interventions are attached to this department yet.</p>
                            )}

                            {dept.status === 'ready' ? (
                                <div className="dp-confirm">
                                    <span className="dp-note">
                                        Confirming records your agreement with what {dept.name} will deliver.
                                        Remove anything you already have first.
                                    </span>
                                    <Button
                                        type="primary"
                                        icon={<CheckOutlined />}
                                        onClick={() => onConfirm(dept.id)}
                                        loading={confirmingId === dept.id || finalizing}
                                        disabled={finalized || (!!confirmingId && confirmingId !== dept.id)}
                                    >
                                        Confirm {dept.name}
                                    </Button>
                                </div>
                            ) : dept.status === 'confirmed' ? (
                                <p className="dp-note is-done">
                                    <CheckCircleFilled /> You confirmed this{dept.confirmedAt ? ` on ${dept.confirmedAt}` : ''}.
                                </p>
                            ) : dept.status === 'no-signoff' ? (
                                <p className="dp-note">
                                    These are compulsory interventions. They are delivered without department or SME
                                    sign-off.
                                </p>
                            ) : (
                                <p className="dp-note">
                                    This department has not submitted its part of your plan yet.
                                </p>
                            )}
                        </div>
                    )
                }))}
            />
        </div>
    )
}
