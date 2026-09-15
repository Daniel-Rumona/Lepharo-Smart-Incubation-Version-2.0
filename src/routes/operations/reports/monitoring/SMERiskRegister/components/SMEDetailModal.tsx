import { useEffect, useMemo, useState } from 'react'
import {
    Col,
    Modal,
    Progress,
    Row,
    Space,
    Tag,
    Typography,
    theme
} from 'antd'
import {
    ApartmentOutlined,
    ClockCircleOutlined,
    FileDoneOutlined,
    FileProtectOutlined,
    HistoryOutlined,
    MessageOutlined,
    RadarChartOutlined,
    SafetyCertificateOutlined,
    ShopOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'

import type {
    BounceStatus,
    CommunicationAttempt,
    OperationalChallenge,
    ReminderEmailLog,
    SMERow
} from '../types'
import CompliancePanel from './CompliancePanel'
import DepartmentServiceCollapse from './DepartmentServiceCollapse'
import FlaggedReasonsPanel from './FlaggedReasonsPanel'
import { getInactivityTag, getRiskTag } from './riskPresentation'
import RiskOutlookPanel from './RiskOutlookPanel'

const { Text } = Typography

type Section =
    | 'overview'
    | 'services'
    | 'compliance'
    | 'communication'
    | 'outlook'

type Props = {
    open: boolean
    row: SMERow | null
    onClose: () => void
    isDepartmentScopedView: boolean
    resolvedProgramId?: string
    scopedDepartmentId?: string
    scopedDepartmentName?: string
    getSMEChallenges: (
        participantId: string
    ) => OperationalChallenge[]
    getCommunicationAttempts: (
        participantId: string
    ) => Array<CommunicationAttempt & { attemptedAt?: any }>
    getReminderEmails: (
        participantId: string
    ) => ReminderEmailLog[]
    getBounceStatus: (
        participantId: string
    ) => BounceStatus | undefined
}

function SummaryItem({
    icon,
    label,
    children
}: {
    icon: React.ReactNode
    label: string
    children: React.ReactNode
}) {
    const { token } = theme.useToken()

    return (
        <div
            style={{
                minHeight: 78,
                padding: 11,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 11,
                background: token.colorFillQuaternary
            }}
        >
            <Space size={6}>
                <span
                    style={{
                        color: token.colorPrimary,
                        display: 'inline-flex'
                    }}
                >
                    {icon}
                </span>
                <Text
                    type="secondary"
                    style={{ fontSize: 11 }}
                >
                    {label}
                </Text>
            </Space>

            <div style={{ marginTop: 7 }}>{children}</div>
        </div>
    )
}

export default function SMEDetailModal({
    open,
    row,
    onClose,
    isDepartmentScopedView,
    resolvedProgramId,
    scopedDepartmentId,
    scopedDepartmentName,
    getSMEChallenges,
    getCommunicationAttempts,
    getReminderEmails,
    getBounceStatus
}: Props) {
    const { token } = theme.useToken()
    const [section, setSection] = useState<Section>('overview')

    useEffect(() => {
        if (open) setSection('overview')
    }, [open, row?.key])

    const communicationCount = useMemo(() => {
        if (!row) return 0

        return (
            getCommunicationAttempts(row.participantId).length +
            getReminderEmails(row.participantId).length
        )
    }, [
        row,
        getCommunicationAttempts,
        getReminderEmails
    ])

    if (!row) return null

    const coveragePercent = row.expectedDepartmentsCount
        ? Math.round(
            (row.servicedDepartmentsCount /
                row.expectedDepartmentsCount) *
            100
        )
        : 0

    const documentsCompleted = Number(row.docsCompleted || 0)
    const documentsTotal = Number(row.docsTotal || 0)
    const documentsMissing = Math.max(
        0,
        documentsTotal - documentsCompleted
    )

    const sections: Array<{
        key: Section
        label: string
        icon: React.ReactNode
    }> = [
            {
                key: 'overview',
                label: 'Overview',
                icon: <SafetyCertificateOutlined />
            },
            {
                key: 'services',
                label: `Services (${row.expectedDepartmentsCount})`,
                icon: <ApartmentOutlined />
            },
            {
                key: 'compliance',
                label: `Compliance (${documentsCompleted}/${documentsTotal})`,
                icon: <FileProtectOutlined />
            },
            {
                key: 'communication',
                label: `Communication (${communicationCount})`,
                icon: <MessageOutlined />
            },
            {
                key: 'outlook',
                label: 'Risk Outlook',
                icon: <RadarChartOutlined />
            }
        ]

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width={1080}
            centered
            title={null}
            styles={{
                body: {
                    paddingTop: 4
                }
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    minWidth: 0,
                    paddingRight: 28,
                    paddingBottom: 14,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`
                }}
            >
                <div
                    style={{
                        width: 46,
                        height: 46,
                        borderRadius: 13,
                        display: 'grid',
                        placeItems: 'center',
                        background: token.colorPrimaryBg,
                        color: token.colorPrimary,
                        fontSize: 20,
                        flex: '0 0 auto'
                    }}
                >
                    <ShopOutlined />
                </div>

                <div
                    style={{
                        minWidth: 0,
                        flex: '1 1 auto'
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap'
                        }}
                    >
                        <Text
                            strong
                            ellipsis={{ tooltip: row.smeName }}
                            style={{
                                display: 'block',
                                fontSize: 18,
                                maxWidth: 420
                            }}
                        >
                            {row.smeName}
                        </Text>

                        {getRiskTag(row.riskLevel)}

                        <Text strong>
                            {row.riskScore}% risk
                        </Text>

                        <Tag
                            style={{
                                marginInlineEnd: 0,
                                borderRadius: 999
                            }}
                        >
                            Group {row.currentGroup || 'Not recorded'}
                        </Tag>

                        <Tag
                            style={{
                                marginInlineEnd: 0,
                                borderRadius: 999
                            }}
                        >
                            Joined:{' '}
                            {row.dateJoined
                                ? dayjs(row.dateJoined).format('DD MMM YYYY')
                                : 'Not recorded'}
                        </Tag>

                        <Tag
                            color={documentsMissing > 0 ? 'gold' : 'green'}
                            style={{
                                marginInlineEnd: 0,
                                borderRadius: 999
                            }}
                        >
                            Documents: {documentsCompleted}/{documentsTotal}
                        </Tag>

                        <Tag
                            color={row.hasAccessedSystem ? 'blue' : 'default'}
                            style={{
                                marginInlineEnd: 0,
                                borderRadius: 999
                            }}
                        >
                            System:{' '}
                            {row.hasAccessedSystem
                                ? row.lastSystemAccessDate
                                    ? `last accessed ${dayjs(
                                        row.lastSystemAccessDate
                                    ).format('DD MMM YYYY')}`
                                    : 'accessed'
                                : 'never accessed'}
                        </Tag>
                    </div>

                    <Text
                        type="secondary"
                        style={{
                            display: 'block',
                            marginTop: 4,
                            fontSize: 12
                        }}
                    >
                        {row.ownerName || 'Owner not recorded'}
                    </Text>
                </div>
            </div>

            <div
                style={{
                    marginTop: 14,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 12,
                    padding: 3,
                    background: token.colorFillQuaternary,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))`,
                    gap: 3,
                    width: '100%'
                }}
            >
                {sections.map(item => {
                    const active = item.key === section

                    return (
                        <button
                            key={item.key}
                            type="button"
                            onClick={() =>
                                setSection(item.key)
                            }
                            style={{
                                height: 38,
                                minWidth: 0,
                                border: active
                                    ? `1px solid ${token.colorPrimaryBorder}`
                                    : '1px solid transparent',
                                borderRadius: 8,
                                background: active
                                    ? token.colorBgContainer
                                    : 'transparent',
                                color: active
                                    ? token.colorPrimaryText
                                    : token.colorTextSecondary,
                                boxShadow: active
                                    ? token.boxShadowTertiary
                                    : 'none',
                                padding: '0 8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 6,
                                cursor: 'pointer',
                                fontWeight: active ? 600 : 500,
                                overflow: 'hidden',
                                transition:
                                    'background .18s ease, border-color .18s ease, color .18s ease, box-shadow .18s ease'
                            }}
                        >
                            <span
                                style={{
                                    display: 'inline-flex',
                                    flex: '0 0 auto'
                                }}
                            >
                                {item.icon}
                            </span>

                            <span
                                style={{
                                    minWidth: 0,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    fontSize: 12
                                }}
                            >
                                {item.label}
                            </span>
                        </button>
                    )
                })}
            </div>

            <div
                style={{
                    marginTop: 14,
                    minHeight: 340
                }}
            >
                {section === 'overview' && (
                    <Space
                        direction="vertical"
                        size={14}
                        style={{ width: '100%' }}
                    >
                        <Row gutter={[10, 10]}>
                            <Col xs={12} lg={6}>
                                <SummaryItem
                                    icon={
                                        <SafetyCertificateOutlined />
                                    }
                                    label="Risk"
                                >
                                    <Space size={6} wrap>
                                        {getRiskTag(
                                            row.riskLevel
                                        )}
                                        <Text
                                            strong
                                            style={{
                                                fontSize: 16
                                            }}
                                        >
                                            {row.riskScore}%
                                        </Text>
                                    </Space>
                                </SummaryItem>
                            </Col>

                            <Col xs={12} lg={6}>
                                <SummaryItem
                                    icon={
                                        <ApartmentOutlined />
                                    }
                                    label={
                                        isDepartmentScopedView
                                            ? 'Service progress'
                                            : 'Coverage'
                                    }
                                >
                                    <Text
                                        strong
                                        style={{
                                            fontSize: 16
                                        }}
                                    >
                                        {
                                            row.servicedDepartmentsCount
                                        }
                                        /
                                        {
                                            row.expectedDepartmentsCount
                                        }
                                    </Text>

                                    <Progress
                                        percent={
                                            coveragePercent
                                        }
                                        showInfo={false}
                                        size="small"
                                        style={{
                                            marginTop: 6
                                        }}
                                    />
                                </SummaryItem>
                            </Col>

                            <Col xs={12} lg={6}>
                                <SummaryItem
                                    icon={
                                        <FileDoneOutlined />
                                    }
                                    label="Intervention touches"
                                >
                                    <Text
                                        strong
                                        style={{
                                            fontSize: 16
                                        }}
                                    >
                                        {row.totalTouches}
                                    </Text>
                                    <Text
                                        type="secondary"
                                        style={{
                                            display: 'block',
                                            fontSize: 11
                                        }}
                                    >
                                        {row.completedTouches}{' '}
                                        completed
                                    </Text>
                                </SummaryItem>
                            </Col>

                            <Col xs={12} lg={6}>
                                <SummaryItem
                                    icon={
                                        <ClockCircleOutlined />
                                    }
                                    label="Last service"
                                >
                                    <Text
                                        strong
                                        style={{
                                            fontSize: 14
                                        }}
                                    >
                                        {row.lastInterventionDate
                                            ? dayjs(
                                                row.lastInterventionDate
                                            ).format(
                                                'DD MMM YYYY'
                                            )
                                            : 'No service yet'}
                                    </Text>

                                    <div
                                        style={{
                                            marginTop: 4
                                        }}
                                    >
                                        {getInactivityTag(
                                            row.inactivityBucket
                                        )}
                                    </div>
                                </SummaryItem>
                            </Col>
                        </Row>

                        <FlaggedReasonsPanel
                            row={row}
                            isDepartmentScopedView={
                                isDepartmentScopedView
                            }
                            resolvedProgramId={
                                resolvedProgramId
                            }
                            scopedDepartmentId={
                                scopedDepartmentId
                            }
                            scopedDepartmentName={
                                scopedDepartmentName
                            }
                            bounceStatus={getBounceStatus(
                                row.participantId
                            )}
                        />
                    </Space>
                )}

                {section === 'services' && (
                    <DepartmentServiceCollapse
                        row={row}
                        isDepartmentScopedView={
                            isDepartmentScopedView
                        }
                    />
                )}

                {section === 'compliance' && (
                    <CompliancePanel row={row} />
                )}

                {section === 'communication' && (
                    <RiskOutlookPanel
                        mode="communication"
                        row={row}
                        getSMEChallenges={getSMEChallenges}
                        getCommunicationAttempts={
                            getCommunicationAttempts
                        }
                        getReminderEmails={
                            getReminderEmails
                        }
                        getBounceStatus={getBounceStatus}
                    />
                )}

                {section === 'outlook' && (
                    <RiskOutlookPanel
                        row={row}
                        getSMEChallenges={getSMEChallenges}
                        getCommunicationAttempts={
                            getCommunicationAttempts
                        }
                        getReminderEmails={
                            getReminderEmails
                        }
                        getBounceStatus={getBounceStatus}
                    />
                )}
            </div>
        </Modal>
    )
}
