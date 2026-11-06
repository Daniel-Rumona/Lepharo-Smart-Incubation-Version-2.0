import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Col,
    Grid,
    List,
    message,
    Pagination,
    Progress,
    Result,
    Row,
    Skeleton,
    Space,
    Table,
    Tag,
    theme,
    Typography
} from 'antd'
import {
    AppstoreOutlined,
    ArrowRightOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    FileTextOutlined,
    PlusOutlined
} from '@ant-design/icons'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where
} from 'firebase/firestore'
import { auth, db } from '@/firebase'
import { Helmet } from 'react-helmet'
import { useNavigate } from 'react-router-dom'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'
import { hasSmeGapSubmission } from '@/utils/agreementStatus'
import { getSmeApplications } from '@/lib/acceptedApplication'

const { Text } = Typography
const { useBreakpoint } = Grid

type ApplicationRecord = {
    id: string
    participantId?: string
    programName?: string
    applicationStatus?: string
    complianceScore?: number
    growthPlanDocUrl?: string
    gapCompleted?: boolean
    [key: string]: any
}

type ApplicationStatus =
    | 'accepted'
    | 'pending'
    | 'rejected'
    | string

const MOBILE_PAGE_SIZE = 5

const normalizeApplicationStatus = (
    value?: string | null
): ApplicationStatus => {
    const status = String(value || '')
        .trim()
        .toLowerCase()

    if (status === 'declined') {
        return 'rejected'
    }

    return status || 'pending'
}

const getStatusColor = (status?: string) => {
    switch (normalizeApplicationStatus(status)) {
        case 'accepted':
            return 'green'

        case 'rejected':
            return 'red'

        case 'pending':
            return 'gold'

        default:
            return 'blue'
    }
}

const getStatusLabel = (status?: string) => {
    const normalizedStatus =
        normalizeApplicationStatus(status)

    return (
        normalizedStatus.charAt(0).toUpperCase() +
        normalizedStatus.slice(1)
    )
}

/**
 * The SME hasn't submitted the GAP analysis for this application yet.
 * Not gated on acceptance — without a GAP submission the application itself
 * is still incomplete, whether it's pending a decision or already accepted.
 * Once rejected there's nothing left to complete.
 */
const needsGapCompletion = (application: ApplicationRecord) =>
    normalizeApplicationStatus(application.applicationStatus) !== 'rejected' &&
    !application.gapCompleted

const ApplicationTracker = () => {
    const screens = useBreakpoint()
    const isMobile = !screens.md
    const { token } = theme.useToken()

    const navigate = useNavigate()

    const [applications, setApplications] = useState<
        ApplicationRecord[]
    >([])

    const [loading, setLoading] = useState(true)
    const [mobilePage, setMobilePage] = useState(1)

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'applicant-tracker',
            pageTitle: 'Application Tracker',
            guides: [
                {
                    id: 'tracker-walkthrough',
                    title: 'How to check your application status',
                    description:
                        'See where each of your applications stands and what happens next.',
                    kind: 'page',
                    steps: [
                        {
                            element: guideTarget(
                                'applications-status-metrics'
                            ),
                            popover: {
                                title: 'Status at a glance',
                                description:
                                    'A quick count of your applications by status.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('applications-results'),
                            popover: {
                                title: 'Your applications',
                                description:
                                    'Each row shows the programme, status, and compliance progress. If an application was rejected, you can view its diagnostic needs from here.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                }
            ]
        }),
        []
    )

    usePageGuides(guideRegistration)

    useEffect(() => {
        const fetchApplications = async () => {
            const currentUser = auth.currentUser

            if (!currentUser) {
                setLoading(false)
                return
            }

            try {
                setLoading(true)

                // The SME's linked participant; email only until it is linked.
                const userSnap = await getDoc(doc(db, 'users', currentUser.uid))
                const smeApplications = await getSmeApplications({
                    uid: currentUser.uid,
                    participantId: userSnap.data()?.participantId,
                    email: currentUser.email
                })

                const apps: ApplicationRecord[] = await Promise.all(
                    smeApplications.map(async applicationDoc => {
                        const data = applicationDoc as any
                        let participant: any = null

                        if (data.participantId) {
                            try {
                                const participantDoc = await getDoc(
                                    doc(db, 'participants', data.participantId)
                                )
                                if (participantDoc.exists()) {
                                    participant = participantDoc.data()
                                }
                            } catch (err) {
                                console.error('Error loading participant:', err)
                            }
                        }

                        return {
                            id: applicationDoc.id,
                            ...data,
                            gapCompleted: hasSmeGapSubmission({
                                application: data,
                                participant,
                                agreement: data.signedAgreements?.['gap-analysis']
                            })
                        }
                    })
                )

                setApplications(apps)
                setMobilePage(1)
            } catch (err) {
                console.error(
                    'Error loading applications:',
                    err
                )

                message.error(
                    'Could not load applications.'
                )
            } finally {
                setLoading(false)
            }
        }

        fetchApplications()
    }, [])

    const statusCounts = useMemo(() => {
        return applications.reduce(
            (counts, application) => {
                const status =
                    normalizeApplicationStatus(
                        application.applicationStatus
                    )

                if (status === 'accepted') {
                    counts.Accepted += 1
                }

                if (status === 'pending') {
                    counts.Pending += 1
                }

                if (status === 'rejected') {
                    counts.Rejected += 1
                }

                return counts
            },
            {
                Accepted: 0,
                Pending: 0,
                Rejected: 0,
                Total: applications.length
            }
        )
    }, [applications])

    const metricCards = useMemo(() => {
        const allMetric = {
            key: 'all',
            title: 'All Applications',
            value: statusCounts.Total,
            icon: <AppstoreOutlined />,
            tone: 'accent' as const
        }

        const pendingMetric = {
            key: 'pending',
            title: 'Pending',
            value: statusCounts.Pending,
            icon: <ClockCircleOutlined />,
            tone: 'warning' as const
        }

        const rejectedMetric = {
            key: 'rejected',
            title: 'Rejected',
            value: statusCounts.Rejected,
            icon: <CloseCircleOutlined />,
            tone: 'danger' as const
        }

        if (!isMobile) {
            return [
                allMetric,
                pendingMetric,
                rejectedMetric
            ]
        }

        const secondaryMetric =
            statusCounts.Pending > 0
                ? pendingMetric
                : statusCounts.Rejected > 0
                    ? rejectedMetric
                    : pendingMetric

        return [allMetric, secondaryMetric]
    }, [
        isMobile,
        statusCounts.Pending,
        statusCounts.Rejected,
        statusCounts.Total
    ])

    const paginatedMobileApplications = useMemo(() => {
        const start =
            (mobilePage - 1) * MOBILE_PAGE_SIZE

        return applications.slice(
            start,
            start + MOBILE_PAGE_SIZE
        )
    }, [applications, mobilePage])

    const applicationColumns = [
        {
            title: 'Program',
            dataIndex: 'programName',
            key: 'programName',
            render: (programName?: string) => (
                <Text strong>
                    {programName ||
                        'Programme not specified'}
                </Text>
            )
        },
        {
            title: 'Status',
            dataIndex: 'applicationStatus',
            key: 'applicationStatus',
            width: 140,
            render: (status?: string) => (
                <Tag color={getStatusColor(status)}>
                    {getStatusLabel(status)}
                </Tag>
            )
        },
        {
            title: 'Next Step',
            key: 'gapAnalysis',
            width: 200,
            render: (
                _: unknown,
                record: ApplicationRecord
            ) => {
                if (!needsGapCompletion(record)) {
                    return (
                        <Text type="secondary">—</Text>
                    )
                }

                return (
                    <Button
                        type="primary"
                        shape="round"
                        size="small"
                        icon={<ArrowRightOutlined />}
                        iconPosition="end"
                        onClick={() =>
                            navigate('/incubatee/gap-analysis', {
                                state: {
                                    participantId:
                                        record.participantId
                                }
                            })
                        }
                    >
                        Continue GAP Analysis
                    </Button>
                )
            }
        },
        {
            title: 'Compliance',
            dataIndex: 'complianceScore',
            key: 'complianceScore',
            width: 140,
            render: (score?: number) => (
                <Text strong>
                    {Number(score || 0)}%
                </Text>
            )
        },
        {
            title: 'Diagnostic Needs',
            key: 'growthPlan',
            width: 250,
            render: (
                _: unknown,
                record: ApplicationRecord
            ) => {
                const status =
                    normalizeApplicationStatus(
                        record.applicationStatus
                    )

                if (
                    status !== 'rejected' ||
                    !record.growthPlanDocUrl
                ) {
                    return (
                        <Text type="secondary">
                            Not available
                        </Text>
                    )
                }

                return (
                    <Button
                        type="link"
                        href={record.growthPlanDocUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        size="small"
                        icon={<FileTextOutlined />}
                        style={{
                            paddingInline: 0
                        }}
                    >
                        View Diagnostic Needs
                    </Button>
                )
            }
        }
    ]

    const renderMobileApplicationCard = (
        application: ApplicationRecord
    ) => {
        const status =
            normalizeApplicationStatus(
                application.applicationStatus
            )

        const hasDiagnosticNeeds =
            status === 'rejected' &&
            Boolean(application.growthPlanDocUrl)

        const showGapCta = needsGapCompletion(application)
        const complianceScore = Math.min(100, Math.max(0, Number(application.complianceScore || 0)))

        return (
            <List.Item
                key={application.id}
                style={{
                    padding: 0,
                    border: 0,
                    marginBottom: 10
                }}
            >
                {/* Phones only: a soft tinted block per application, with no
                    border or shadow, so each one reads as one item with its
                    own action. */}
                <div
                    style={{
                        width: '100%',
                        padding: 14,
                        borderRadius: 14,
                        background: token.colorFillQuaternary
                    }}
                >
                    <Space
                        direction="vertical"
                        size={14}
                        style={{
                            width: '100%'
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                alignItems:
                                    'flex-start',
                                justifyContent:
                                    'space-between',
                                gap: 12
                            }}
                        >
                            <div
                                style={{
                                    minWidth: 0,
                                    flex: 1
                                }}
                            >
                                <Text
                                    type="secondary"
                                    style={{
                                        display: 'block',
                                        fontSize: 12,
                                        marginBottom: 3
                                    }}
                                >
                                    Programme
                                </Text>

                                <Text
                                    strong
                                    style={{
                                        fontSize: 15,
                                        display: 'block'
                                    }}
                                >
                                    {application.programName ||
                                        'Programme not specified'}
                                </Text>
                            </div>

                            <Tag
                                color={getStatusColor(
                                    application.applicationStatus
                                )}
                                style={{
                                    marginInlineEnd: 0,
                                    flexShrink: 0
                                }}
                            >
                                {getStatusLabel(
                                    application.applicationStatus
                                )}
                            </Tag>
                        </div>

                        {/* A detail of this application, not a section of its own. */}
                        <div>
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 12
                                }}
                            >
                                <Text type="secondary" style={{ fontSize: 13 }}>
                                    Compliance
                                </Text>
                                <Text strong style={{ fontSize: 13 }}>
                                    {complianceScore}%
                                </Text>
                            </div>
                            <Progress
                                percent={complianceScore}
                                showInfo={false}
                                size="small"
                                strokeColor={complianceScore >= 100 ? token.colorSuccess : token.colorPrimary}
                                trailColor={token.colorBorderSecondary}
                                style={{ margin: 0 }}
                            />
                        </div>

                        {showGapCta && (
                            <Button
                                block
                                type="primary"
                                shape="round"
                                icon={<ArrowRightOutlined />}
                                iconPosition="end"
                                onClick={() =>
                                    navigate('/incubatee/gap-analysis', {
                                        state: {
                                            participantId:
                                                application.participantId
                                        }
                                    })
                                }
                            >
                                Continue GAP Analysis
                            </Button>
                        )}

                        {hasDiagnosticNeeds && (
                            <Button
                                block
                                shape="round"
                                icon={
                                    <FileTextOutlined />
                                }
                                href={
                                    application.growthPlanDocUrl
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                View Diagnostic Needs
                            </Button>
                        )}
                    </Space>
                </div>
            </List.Item>
        )
    }

    const renderApplicationsContent = () => {
        if (loading) {
            if (isMobile) {
                return (
                    <Space
                        direction="vertical"
                        size={12}
                        style={{
                            width: '100%'
                        }}
                    >
                        {Array.from({
                            length: 3
                        }).map((_, index) => (
                            <div
                                key={index}
                                style={{
                                    padding: 14,
                                    borderRadius: 14,
                                    background: token.colorFillQuaternary
                                }}
                            >
                                <Skeleton
                                    active
                                    title
                                    paragraph={{
                                        rows: 2
                                    }}
                                />
                            </div>
                        ))}
                    </Space>
                )
            }

            return (
                <Table<ApplicationRecord>
                    rowKey="id"
                    columns={applicationColumns}
                    dataSource={[]}
                    loading
                    pagination={false}
                    scroll={{ x: 800 }}
                />
            )
        }

        if (applications.length === 0) {
            return (
                <Result
                    status="info"
                    title="No applications yet"
                    subTitle="You have not applied for any programmes yet. Browse the available programmes to get started."
                    extra={
                        <Button
                            type="primary"
                            shape="round"
                            icon={<PlusOutlined />}
                            onClick={() =>
                                navigate(
                                    '/applicant/programs'
                                )
                            }
                        >
                            Apply For Program
                        </Button>
                    }
                />
            )
        }

        if (isMobile) {
            return (
                <>
                    <List
                        split={false}
                        dataSource={
                            paginatedMobileApplications
                        }
                        renderItem={
                            renderMobileApplicationCard
                        }
                        style={{
                            width: '100%'
                        }}
                    />

                    {applications.length >
                        MOBILE_PAGE_SIZE && (
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent:
                                        'center',
                                    marginTop: 18
                                }}
                            >
                                <Pagination
                                    current={mobilePage}
                                    pageSize={
                                        MOBILE_PAGE_SIZE
                                    }
                                    total={
                                        applications.length
                                    }
                                    showSizeChanger={
                                        false
                                    }
                                    onChange={
                                        setMobilePage
                                    }
                                />
                            </div>
                        )}
                </>
            )
        }

        return (
            <Table<ApplicationRecord>
                rowKey="id"
                columns={applicationColumns}
                dataSource={applications}
                pagination={{
                    pageSize: 5,
                    showSizeChanger: false,
                    position: ['bottomCenter']
                }}
                scroll={{ x: 800 }}
            />
        )
    }

    return (
        <div
            style={{
                padding: isMobile
                    ? '12px 16px'
                    : '10px 24px'
            }}
        >
            <Helmet>
                <title>
                    My Applications | Smart Incubation
                    Platform
                </title>

                <meta
                    name="description"
                    content="Track your submitted applications and their status."
                />
            </Helmet>

            <Space
                direction="vertical"
                size={16}
                style={{
                    width: '100%'
                }}
            >
                <Row
                    data-guide="applications-status-metrics"
                    gutter={[12, 12]}
                    wrap={false}
                >
                    {metricCards.map(metric => (
                        <Col
                            key={metric.key}
                            flex="1 1 0"
                            style={{
                                minWidth: 0
                            }}
                        >
                            {loading ? (
                                <Skeleton
                                    active
                                    title={false}
                                    paragraph={{
                                        rows: 2,
                                        width: [
                                            '65%',
                                            '30%'
                                        ]
                                    }}
                                />
                            ) : (
                                <MetricTile
                                    title={metric.title}
                                    value={metric.value}
                                    icon={metric.icon}
                                    tone={
                                        metric.tone
                                    }
                                    wrapperStyle={{
                                        minHeight:
                                            isMobile
                                                ? 56
                                                : 62
                                    }}
                                />
                            )}
                        </Col>
                    ))}
                </Row>

                {/* On phones the list sits straight on the page under a heading;
                    wider screens keep the table in its card. */}
                {isMobile ? (
                    <section>
                        <Text strong style={{ display: 'block', fontSize: 16, marginBottom: 10 }}>
                            My Applications
                        </Text>
                        <div data-guide="applications-results">
                            {renderApplicationsContent()}
                        </div>
                    </section>
                ) : (
                    <MotionCard
                        title="My Applications"
                        styles={{
                            body: {
                                padding: 16
                            }
                        }}
                    >
                        <div data-guide="applications-results">
                            {renderApplicationsContent()}
                        </div>
                    </MotionCard>
                )}
            </Space>
        </div>
    )
}

export default ApplicationTracker
