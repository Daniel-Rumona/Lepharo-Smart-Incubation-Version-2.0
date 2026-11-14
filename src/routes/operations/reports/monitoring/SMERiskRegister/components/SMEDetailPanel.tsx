import { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Col,
    Progress,
    Row,
    Segmented,
    Space,
    Tag,
    Typography,
    theme
} from 'antd'
import {
    ApartmentOutlined,
    ClockCircleOutlined,
    DeploymentUnitOutlined,
    FileDoneOutlined,
    FileProtectOutlined,
    HistoryOutlined,
    MessageOutlined,
    SafetyCertificateOutlined,
    ShopOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'

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
import { isOverdueForService } from '../riskEngine'
import { getRiskTag } from './riskPresentation'
import CommunicationPanel from './CommunicationPanel'

const { Text } = Typography

type Section =
    | 'overview'
    | 'services'
    | 'compliance'
    | 'communication'

export type SMEDetailPanelProps = {
    row: SMERow | null
    /** Room kept clear at the header's right, e.g. for a modal's close button. */
    headerInsetRight?: number
    /** Shown between the header and the section tabs, e.g. the suggested next step. */
    nextStep?: React.ReactNode
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
                // Fill the column, so the four boxes in a row match the tallest.
                height: '100%',
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

/** One SME's risk detail: header, section tabs and the chosen section. Used in the register's right panel and, on narrow screens, in a modal. */
export default function SMEDetailPanel({
    row,
    headerInsetRight = 0,
    nextStep,
    isDepartmentScopedView,
    resolvedProgramId,
    scopedDepartmentId,
    scopedDepartmentName,
    getSMEChallenges,
    getCommunicationAttempts,
    getReminderEmails,
    getBounceStatus
}: SMEDetailPanelProps) {
    const { token } = theme.useToken()
    const navigate = useNavigate()
    const [section, setSection] = useState<Section>('overview')

    useEffect(() => {
        setSection('overview')
    }, [row?.key])

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
            }
        ]

    return (
        <div style={{ minWidth: 0 }}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    minWidth: 0,
                    paddingRight: headerInsetRight,
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

                {row.applicationId && (
                    <Button
                        icon={<DeploymentUnitOutlined />}
                        onClick={() => navigate(`/twin/${row.applicationId}`)}
                        style={{ flex: '0 0 auto' }}
                    >
                        Open digital twin
                    </Button>
                )}
            </div>

            {nextStep}

            <Segmented<Section>
                block
                value={section}
                onChange={setSection}
                options={sections.map(item => ({ value: item.key, label: item.label, icon: item.icon }))}
                style={{ marginTop: 14 }}
            />

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
                                    {/* How long ago, red once overdue; the date and expected interval underneath. */}
                                    <Text
                                        strong
                                        type={isOverdueForService(row) ? 'danger' : undefined}
                                        style={{ fontSize: 16 }}
                                    >
                                        {row.lastInterventionDate
                                            ? `${row.daysSinceLastService} day${row.daysSinceLastService === 1 ? '' : 's'} ago`
                                            : 'Never'}
                                    </Text>
                                    <Text
                                        type="secondary"
                                        style={{ display: 'block', fontSize: 11 }}
                                    >
                                        {[
                                            row.lastInterventionDate
                                                ? dayjs(row.lastInterventionDate).format('D MMM YYYY')
                                                : 'No service yet',
                                            row.expectedServiceIntervalDays
                                                ? `due every ${row.expectedServiceIntervalDays} days`
                                                : null
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </Text>
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
                    <CommunicationPanel
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
        </div>
    )
}
