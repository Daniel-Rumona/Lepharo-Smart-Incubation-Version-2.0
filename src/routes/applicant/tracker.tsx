import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Card,
    Col,
    Grid,
    List,
    message,
    Pagination,
    Result,
    Row,
    Skeleton,
    Space,
    Table,
    Tag,
    Typography
} from 'antd'
import {
    AppstoreOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    FileTextOutlined,
    PlusOutlined
} from '@ant-design/icons'
import {
    collection,
    getDocs,
    query,
    where
} from 'firebase/firestore'
import { auth, db } from '@/firebase'
import { Helmet } from 'react-helmet'
import { useNavigate } from 'react-router-dom'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'

const { Text } = Typography
const { useBreakpoint } = Grid

type ApplicationRecord = {
    id: string
    programName?: string
    applicationStatus?: string
    complianceScore?: number
    growthPlanDocUrl?: string
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

const ApplicationTracker = () => {
    const screens = useBreakpoint()
    const isMobile = !screens.md

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

            if (!currentUser?.email) {
                setLoading(false)
                return
            }

            try {
                setLoading(true)

                const appsSnap = await getDocs(
                    query(
                        collection(db, 'applications'),
                        where(
                            'email',
                            '==',
                            currentUser.email
                        )
                    )
                )

                const apps: ApplicationRecord[] =
                    appsSnap.docs.map(applicationDoc => ({
                        id: applicationDoc.id,
                        ...applicationDoc.data()
                    }))

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
            iconBg: 'rgba(22, 119, 255, 0.12)'
        }

        const pendingMetric = {
            key: 'pending',
            title: 'Pending',
            value: statusCounts.Pending,
            icon: <ClockCircleOutlined />,
            iconBg: 'rgba(250, 173, 20, 0.14)'
        }

        const rejectedMetric = {
            key: 'rejected',
            title: 'Rejected',
            value: statusCounts.Rejected,
            icon: <CloseCircleOutlined />,
            iconBg: 'rgba(255, 77, 79, 0.12)'
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

        return (
            <List.Item
                key={application.id}
                style={{
                    padding: 0,
                    border: 0
                }}
            >
                <Card
                    variant="outlined"
                    styles={{
                        body: {
                            padding: 16
                        }
                    }}
                    style={{
                        width: '100%',
                        borderRadius: 14,
                        borderColor: '#e6efff',
                        boxShadow:
                            '0 6px 20px rgba(0, 0, 0, 0.05)'
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

                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent:
                                    'space-between',
                                gap: 12,
                                paddingTop: 12,
                                borderTop:
                                    '1px solid #f0f0f0'
                            }}
                        >
                            <Text type="secondary">
                                Compliance
                            </Text>

                            <Text strong>
                                {Number(
                                    application.complianceScore ||
                                    0
                                )}
                                %
                            </Text>
                        </div>

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
                </Card>
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
                            <Card
                                key={index}
                                variant="outlined"
                                styles={{
                                    body: {
                                        padding: 16
                                    }
                                }}
                                style={{
                                    borderRadius: 14
                                }}
                            >
                                <Skeleton
                                    active
                                    title
                                    paragraph={{
                                        rows: 2
                                    }}
                                />
                            </Card>
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
                    ? '12px'
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
                                <MotionCard.Metric
                                    title={metric.title}
                                    value={metric.value}
                                    icon={metric.icon}
                                    iconBg={
                                        metric.iconBg
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

                <MotionCard
                    title="My Applications"
                    styles={{
                        body: {
                            padding: isMobile
                                ? 12
                                : 16
                        }
                    }}
                >
                    <div data-guide="applications-results">
                        {renderApplicationsContent()}
                    </div>
                </MotionCard>
            </Space>
        </div>
    )
}

export default ApplicationTracker
