import React from 'react'
import { Button, Popconfirm, Tag } from 'antd'
import { AimOutlined, DeleteOutlined, EditOutlined, HistoryOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar } from '@/components/workspace'
import { getKpiTypeLabel, getUnitLabel, prettyFilters, prettySourceLabel, type KPI } from '@/components/kpis/builder/kpiModel'
import { formatPeriodKey, formatTarget, hasTarget, isDeliverable, isManual, isShared } from './kpiRegisterDefs'
import { kpiIcon } from './KpiList'

type Props = {
    kpi: KPI
    deleting: boolean
    onEdit: () => void
    onTargets: () => void
    onDelete: () => void
}

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <dt>{label}</dt>
        <dd>{children}</dd>
    </div>
)

/** The selected KPI: what it is, its current target, how it is measured and who owns it. */
export const KpiDetail: React.FC<Props> = ({ kpi, deleting, onEdit, onTargets, onDelete }) => {
    const reduceMotion = useReducedMotion()
    const enter = reduceMotion
        ? {}
        : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.26, ease: 'easeOut' as const } }

    const shared = isShared(kpi)
    const contributors = kpi.contributorDepartmentNames || []
    const frequency = kpi.reminderCadence === 'quarterly' ? 'Quarterly' : 'Monthly'

    return (
        <div className='ws-detail'>
            <MotionCard>
                <motion.header key={`head-${kpi.id}`} className='ws-detail-head' {...enter}>
                    <span className='kpr-detail-icon' aria-hidden='true'>{kpiIcon(kpi)}</span>
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{kpi.kpiLabel}</h2>
                        <div className='ws-detail-sub'>{kpi.department || 'No department'}</div>
                        <div className='ws-detail-tags'>
                            <Tag bordered={false} className={`kpr-tag ${isManual(kpi) ? 'is-manual' : 'is-live'}`}>
                                {isManual(kpi) ? 'Manual' : 'Live'}
                            </Tag>
                            <Tag>{kpi.appliesToAllPrograms ? 'All programmes' : 'This programme'}</Tag>
                            {shared && <Tag>{kpi.sharedKpiMode === 'allocated' ? 'Shared · allocated' : 'Shared'}</Tag>}
                        </div>
                    </div>
                    <div className='ws-detail-actions'>
                        <Button icon={<EditOutlined />} onClick={onEdit}>Edit</Button>
                        <Popconfirm
                            title='Delete KPI'
                            description='This removes the KPI, its targets, and detaches linked interventions.'
                            okText='Delete'
                            okButtonProps={{ danger: true, loading: deleting }}
                            onConfirm={onDelete}
                        >
                            <Button danger icon={<DeleteOutlined />} loading={deleting}>Delete</Button>
                        </Popconfirm>
                    </div>
                </motion.header>

                <motion.div key={`body-${kpi.id}`} className='kpr-detail-body' {...enter}>
                    <section className={`kpr-target${hasTarget(kpi) ? '' : ' is-missing'}`}>
                        <span className='kpr-target-icon' aria-hidden='true'><AimOutlined /></span>
                        <div className='kpr-target-text'>
                            <div className='kpr-target-label'>{hasTarget(kpi) ? `Target · ${formatPeriodKey(kpi.latestTargetPeriodKey)}` : 'No target yet'}</div>
                            <div className='kpr-target-value'>
                                {hasTarget(kpi) ? formatTarget(kpi, kpi.latestTarget) : 'Set one so progress can be tracked'}
                            </div>
                        </div>
                        <Button type='primary' icon={<HistoryOutlined />} onClick={onTargets}>
                            {hasTarget(kpi) ? 'Manage targets' : 'Set target'}
                        </Button>
                    </section>

                    <section>
                        <h3 className='ws-section-title'>How it's measured</h3>
                        <dl className='ws-facts'>
                            {isDeliverable(kpi) ? (
                                <>
                                    <Fact label='Deliverable'>{kpi.deliverable || 'Not set'}</Fact>
                                    <Fact label='Measured by'>{kpi.measurementIndicator || 'Not set'}</Fact>
                                    <Fact label='Reported'>{frequency}</Fact>
                                </>
                            ) : (
                                <>
                                    <Fact label='Tracking'>{isManual(kpi) ? `Reported ${frequency.toLowerCase()}` : 'Calculated live'}</Fact>
                                    {!isManual(kpi) && <Fact label='Data source'>{prettySourceLabel(kpi.sourceType)}</Fact>}
                                    <Fact label='Calculation'>{getKpiTypeLabel(kpi)}</Fact>
                                    <Fact label='Unit'>{getUnitLabel(kpi.unit)}</Fact>
                                </>
                            )}
                        </dl>
                        {!isDeliverable(kpi) && !isManual(kpi) && (
                            <p className='kpr-conditions'>
                                {kpi.filters?.length ? prettyFilters(kpi.filters, kpi.sourceType) : 'Counts every matching record — no conditions.'}
                            </p>
                        )}
                    </section>

                    {/* A single department's KPI is already named in the header; only shared ones have more to say. */}
                    {shared && (
                    <section>
                        <h3 className='ws-section-title'>Ownership</h3>
                        {kpi.leadDepartmentName && (
                            <dl className='ws-facts'>
                                <Fact label='Lead department'>{kpi.leadDepartmentName}</Fact>
                            </dl>
                        )}
                        {contributors.length > 0 && (
                            <div className='kpr-contributors'>
                                {contributors.map(name => (
                                    <span key={name} className='kpr-contributor'>
                                        <EntityAvatar name={name} size={20} />
                                        {name}
                                    </span>
                                ))}
                            </div>
                        )}
                    </section>
                    )}

                    {kpi.description && (
                        <section>
                            <h3 className='ws-section-title'>Notes</h3>
                            <p className='ws-prose'>{kpi.description}</p>
                        </section>
                    )}
                </motion.div>
            </MotionCard>
        </div>
    )
}
