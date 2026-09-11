import { useEffect, useState, type ReactNode } from 'react'
import { Col, Descriptions, Empty, Row, Segmented, Space, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

import { MotionCard } from '@/components/dashboards/metrics/Header'

import { hasActiveWarnings } from '../riskEngine'
import type { BounceStatus, CommunicationAttempt, OperationalChallenge, ReminderEmailLog, SMERow } from '../types'
import DepartmentServiceCollapse from './DepartmentServiceCollapse'
import FlaggedReasonsPanel from './FlaggedReasonsPanel'
import { getInactivityTag, getRiskTag } from './riskPresentation'
import RiskOutlookPanel from './RiskOutlookPanel'

const { Title, Text } = Typography

function StatBlock({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
            <div style={{ marginTop: 4 }}>{children}</div>
        </div>
    )
}

type Props = {
    row: SMERow | null
    isDepartmentScopedView: boolean
    resolvedProgramId?: string
    scopedDepartmentId?: string
    scopedDepartmentName?: string
    getSMEChallenges: (participantId: string) => OperationalChallenge[]
    getCommunicationAttempts: (participantId: string) => Array<CommunicationAttempt & { attemptedAt?: any }>
    getReminderEmails: (participantId: string) => ReminderEmailLog[]
    getBounceStatus: (participantId: string) => BounceStatus | undefined
}

export default function SMEDetailModal({
    row,
    isDepartmentScopedView,
    resolvedProgramId,
    scopedDepartmentId,
    scopedDepartmentName,
    getSMEChallenges,
    getCommunicationAttempts,
    getReminderEmails,
    getBounceStatus
}: Props) {
    const shouldReduceMotion = useReducedMotion()
    const [section, setSection] = useState<'overview' | 'services' | 'communication' | 'outlook'>('overview')

    useEffect(() => {
        setSection('overview')
    }, [row?.key])

    return (
        <div style={{ alignSelf: 'start' }}>
            {!row && (
                <MotionCard>
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select an SME to review its case" />
                </MotionCard>
            )}
            <AnimatePresence mode="wait">
                {row && (
                    <motion.div
                        key={row.key}
                        initial={shouldReduceMotion ? undefined : { opacity: 0, y: 8 }}
                        animate={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
                        exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
                        transition={{ duration: 0.25 }}
                    >
                        <MotionCard>
                             <Space direction="vertical" size={16} style={{ width: '100%' }}>
                            <div style={{ padding: 18, borderRadius: 16, background: 'linear-gradient(135deg, #102a43 0%, #176b87 100%)', boxShadow: '0 12px 28px rgba(16,42,67,.18)' }}>
                                <Text style={{ color: 'rgba(255,255,255,.72)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em' }}>SME case file</Text>
                                <Title level={4} style={{ margin: '4px 0 8px', color: '#fff', lineHeight: 1.25 }}>{row.smeName}</Title>
                                <Space wrap size={[6, 6]}>
                                    {getRiskTag(row.riskLevel)}
                                    <Tag color="cyan">{row.currentGroup ? `Group ${row.currentGroup}` : 'No group recorded'}</Tag>
                                    <Text style={{ color: 'rgba(255,255,255,.78)' }}>{row.ownerName || 'Owner not recorded'}</Text>
                                </Space>
                            </div>

                            <div style={{ padding: 4, borderRadius: 12, background: '#f5f7fa', border: '1px solid #edf0f5' }}>
                                <Segmented
                                    block
                                    value={section}
                                    onChange={value => setSection(value as typeof section)}
                                    options={[
                                        { label: 'Overview', value: 'overview' },
                                        { label: 'Services', value: 'services' },
                                        { label: 'Communication', value: 'communication' },
                                        { label: 'Risk Outlook', value: 'outlook' }
                                    ]}
                                />
                            </div>
                            {section === 'overview' && (
                            <MotionCard>
                                <Row gutter={[16, 16]}>
                                    <Col xs={12} md={12}>
                                        <StatBlock label="Risk">
                                            <Space size={8}>
                                                {getRiskTag(row.riskLevel)}
                                                <Text strong style={{ fontSize: 18 }}>{row.riskScore}%</Text>
                                            </Space>
                                        </StatBlock>
                                    </Col>
                                    <Col xs={12} md={12}>
                                        <StatBlock label={isDepartmentScopedView ? 'Service Progress' : 'Department Coverage'}>
                                            <Space size={8} wrap>
                                                <Text strong>{row.servicedDepartmentsCount}/{row.expectedDepartmentsCount}</Text>
                                                {row.missingDepartmentsCount > 0 && (
                                                    <Tag color="gold">{row.missingDepartmentsCount} need follow-up</Tag>
                                                )}
                                            </Space>
                                        </StatBlock>
                                    </Col>
                                    <Col xs={12} md={12}>
                                        <StatBlock label="Intervention Touches">
                                            <Text strong>{row.totalTouches}</Text>
                                            <Text type="secondary"> ({row.completedTouches} completed)</Text>
                                        </StatBlock>
                                    </Col>
                                    <Col xs={12} md={12}>
                                        <StatBlock label="Last Service">
                                            <Space size={6} wrap>
                                                <Text>
                                                    {row.lastInterventionDate
                                                        ? dayjs(row.lastInterventionDate).format('DD MMM YYYY')
                                                        : 'No service yet'}
                                                </Text>
                                                {getInactivityTag(row.inactivityBucket)}
                                            </Space>
                                        </StatBlock>
                                    </Col>
                                </Row>

                                <Descriptions bordered size="small" column={1} style={{ marginTop: 16 }}>
                                    <Descriptions.Item label="Owner">{row.ownerName || '—'}</Descriptions.Item>
                                    <Descriptions.Item label="Group">{row.currentGroup || '—'}</Descriptions.Item>
                                    <Descriptions.Item label="Date Joined">
                                        {row.dateJoined
                                            ? dayjs(row.dateJoined).format('DD MMM YYYY')
                                            : 'Not recorded'}
                                    </Descriptions.Item>
                                    <Descriptions.Item label="System Access">
                                        {row.hasAccessedSystem
                                            ? row.lastSystemAccessDate
                                                ? `Accessed ${dayjs(row.lastSystemAccessDate).format('DD MMM YYYY')}`
                                                : 'Accessed system'
                                            : 'Never accessed system'}
                                    </Descriptions.Item>
                                    <Descriptions.Item label="Documents" span={2}>
                                        {row.docsCompleted}/{row.docsTotal} complete
                                    </Descriptions.Item>
                                </Descriptions>
                            </MotionCard>
                            )}

                            {section === 'outlook' && (
                            <MotionCard>
                                <RiskOutlookPanel
                                    row={row}
                                    getSMEChallenges={getSMEChallenges}
                                    getCommunicationAttempts={getCommunicationAttempts}
                                    getReminderEmails={getReminderEmails}
                                    getBounceStatus={getBounceStatus}
                                />
                            </MotionCard>
                            )}

                            {section === 'communication' && (
                            <MotionCard>
                                <RiskOutlookPanel
                                    mode="communication"
                                    row={row}
                                    getSMEChallenges={getSMEChallenges}
                                    getCommunicationAttempts={getCommunicationAttempts}
                                    getReminderEmails={getReminderEmails}
                                    getBounceStatus={getBounceStatus}
                                />
                            </MotionCard>
                            )}

                            {section === 'services' && (
                            <MotionCard>
                                <DepartmentServiceCollapse row={row} isDepartmentScopedView={isDepartmentScopedView} />
                            </MotionCard>
                            )}

                            {section === 'overview' && hasActiveWarnings(row) && (
                                <MotionCard>
                                    <FlaggedReasonsPanel
                                        row={row}
                                        isDepartmentScopedView={isDepartmentScopedView}
                                        resolvedProgramId={resolvedProgramId}
                                        scopedDepartmentId={scopedDepartmentId}
                                        scopedDepartmentName={scopedDepartmentName}
                                        bounceStatus={getBounceStatus(row.participantId)}
                                    />
                                </MotionCard>
                            )}
                        </Space>
                        </MotionCard>

                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
