import React, { useEffect, useMemo, useState } from 'react'
import {
    Col,
    Empty,
    Grid,
    List,
    Pagination,
    Row,
    Select,
    Space,
    Table,
    Tag,
    Typography,
    message
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    CalendarOutlined,
    DollarCircleOutlined,
    SafetyCertificateOutlined,
    TeamOutlined,
    UserOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { collection, getDocs, query, where } from 'firebase/firestore'
import dayjs, { Dayjs } from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import '@/styles/incubatee-metrics.css'

dayjs.extend(customParseFormat)

const { Paragraph, Text, Title } = Typography
const { useBreakpoint } = Grid

type MonthlyPerformanceRow = {
    key: string
    month?: string
    revenue?: number
    headPermanent?: number
    headTemporary?: number
    createdAt?: any
    updatedAt?: any
    [key: string]: any
}

const numberValue = (value: unknown) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

const totalEmployees = (row?: MonthlyPerformanceRow | null) =>
    numberValue(row?.headPermanent) + numberValue(row?.headTemporary)

const rowDate = (row: MonthlyPerformanceRow): Dayjs | null => {
    const timestamp = row.createdAt || row.updatedAt
    if (typeof timestamp?.toDate === 'function') {
        const parsed = dayjs(timestamp.toDate())
        if (parsed.isValid()) return parsed
    }

    const month = String(row.month || '').trim()
    if (!month) return null
    const strict = dayjs(month, ['MMMM YYYY', 'MMM YYYY', 'YYYY-MM'], true)
    if (strict.isValid()) return strict
    const fallback = dayjs(month)
    return fallback.isValid() ? fallback : null
}

const monthLabel = (row: MonthlyPerformanceRow) =>
    String(row.month || '').trim() || rowDate(row)?.format('MMMM YYYY') || 'Unknown month'

const currencyFormatter = new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0
})

export const MonthlyPerformanceForm: React.FC = () => {
    const { user } = useFullIdentity()
    const screens = useBreakpoint()
    const isMobile = !screens.md

    const [data, setData] = useState<MonthlyPerformanceRow[]>([])
    const [loading, setLoading] = useState(true)
    const [participantId, setParticipantId] = useState<string | null>(null)
    const [yearFilter, setYearFilter] = useState<string>('all')
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(8)

    useEffect(() => {
        let cancelled = false
        const resolveParticipant = async () => {
            const directParticipantId = String(user?.participantId || '').trim()
            const email = String(user?.email || '').trim()

            if (directParticipantId) {
                setParticipantId(directParticipantId)
                return
            }
            if (!email) {
                setParticipantId(null)
                setLoading(false)
                return
            }

            try {
                const emailCandidates = Array.from(new Set([email, email.toLowerCase()]))
                const snapshots = await Promise.all(
                    emailCandidates.map(candidate =>
                        getDocs(
                            query(
                                collection(db, 'participants'),
                                where('email', '==', candidate)
                            )
                        )
                    )
                )
                const match = snapshots.find(snapshot => !snapshot.empty)
                if (!cancelled) {
                    setParticipantId(match?.docs[0]?.id || null)
                    if (!match) setLoading(false)
                }
            } catch (error) {
                console.error('Failed to resolve metrics participant:', error)
                if (!cancelled) {
                    setParticipantId(null)
                    setLoading(false)
                    message.error('Unable to resolve your participant profile.')
                }
            }
        }

        resolveParticipant()
        return () => {
            cancelled = true
        }
    }, [user?.email, user?.participantId])

    useEffect(() => {
        let cancelled = false
        const fetchData = async () => {
            if (!participantId) {
                setData([])
                setLoading(false)
                return
            }

            setLoading(true)
            try {
                const snapshot = await getDocs(
                    collection(db, `monthlyPerformance/${participantId}/history`)
                )
                const rows = snapshot.docs
                    .map(item => ({
                        key: item.id,
                        ...item.data()
                    } as MonthlyPerformanceRow))
                    .sort((a, b) => {
                        const aDate = rowDate(a)?.valueOf() || 0
                        const bDate = rowDate(b)?.valueOf() || 0
                        return bDate - aDate
                    })
                if (!cancelled) setData(rows)
            } catch (error) {
                console.error('Failed to load monthly performance data:', error)
                if (!cancelled) {
                    setData([])
                    message.error('Failed to load revenue and employee data.')
                }
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        fetchData()
        return () => {
            cancelled = true
        }
    }, [participantId])

    const totalRevenue = useMemo(
        () => data.reduce((sum, row) => sum + numberValue(row.revenue), 0),
        [data]
    )
    const latestRecord = data[0] || null
    const currentEmployees = totalEmployees(latestRecord)

    const metrics: DashboardMetric[] = [
        {
            key: 'revenue',
            title: 'Total revenue',
            mobileTitle: 'Revenue',
            value: currencyFormatter.format(totalRevenue),
            subtitle: 'Revenue recorded across all reporting periods',
            mobileSubtitle: 'All periods',
            icon: <DollarCircleOutlined style={{ color: '#15803d' }} />,
            iconBg: 'rgba(21,128,61,.12)',
            important: true
        },
        {
            key: 'employees',
            title: 'Current employees',
            mobileTitle: 'Employees',
            value: currentEmployees,
            subtitle: latestRecord
                ? `Latest reporting period: ${monthLabel(latestRecord)}`
                : 'No employee records available',
            mobileSubtitle: latestRecord ? monthLabel(latestRecord) : 'No records',
            icon: <TeamOutlined style={{ color: '#1677ff' }} />,
            iconBg: 'rgba(22,119,255,.12)',
            important: true
        }
    ]

    const yearOptions = useMemo(() => {
        const years = Array.from(
            new Set(
                data
                    .map(row => rowDate(row)?.format('YYYY'))
                    .filter(Boolean) as string[]
            )
        ).sort((a, b) => Number(b) - Number(a))

        return [
            { value: 'all', label: 'All reporting years' },
            ...years.map(year => ({ value: year, label: year }))
        ]
    }, [data])

    const filteredData = useMemo(
        () =>
            yearFilter === 'all'
                ? data
                : data.filter(row => rowDate(row)?.format('YYYY') === yearFilter),
        [data, yearFilter]
    )

    useEffect(() => {
        setPage(1)
    }, [yearFilter])

    useEffect(() => {
        const maximumPage = Math.max(1, Math.ceil(filteredData.length / pageSize))
        if (page > maximumPage) setPage(maximumPage)
    }, [filteredData.length, page, pageSize])

    const paginatedData = useMemo(
        () => filteredData.slice((page - 1) * pageSize, page * pageSize),
        [filteredData, page, pageSize]
    )

    const columns: ColumnsType<MonthlyPerformanceRow> = [
        {
            title: 'Reporting month',
            key: 'month',
            width: 190,
            render: (_, row) => (
                <Space>
                    <CalendarOutlined />
                    <Text strong>{monthLabel(row)}</Text>
                </Space>
            )
        },
        {
            title: 'Revenue',
            key: 'revenue',
            width: 180,
            align: 'right',
            render: (_, row) => (
                <Text strong>{currencyFormatter.format(numberValue(row.revenue))}</Text>
            )
        },
        {
            title: 'Permanent employees',
            key: 'permanent',
            width: 180,
            align: 'right',
            render: (_, row) => numberValue(row.headPermanent)
        },
        {
            title: 'Temporary employees',
            key: 'temporary',
            width: 180,
            align: 'right',
            render: (_, row) => numberValue(row.headTemporary)
        },
        {
            title: 'Total employees',
            key: 'totalEmployees',
            width: 160,
            align: 'right',
            render: (_, row) => (
                <Tag color="blue" icon={<UserOutlined />}>
                    {totalEmployees(row)}
                </Tag>
            )
        }
    ]

    const filterBar = (
        <Row gutter={[12, 12]} className="metrics-filter-row">
            <Col xs={24} md={12}>
                <Select
                    value={yearFilter}
                    onChange={setYearFilter}
                    options={yearOptions}
                    style={{ width: '100%' }}
                    aria-label="Filter by reporting year"
                />
            </Col>
            <Col xs={24} md={12}>
                <div className="metrics-readonly-note">
                    <SafetyCertificateOutlined />
                    <Text type="secondary">
                        Revenue and employee records are managed by the responsible departments.
                    </Text>
                </div>
            </Col>
        </Row>
    )

    return (
        <main className="incubatee-metrics-page">
            <Helmet>
                <title>Revenue and Employees | Smart Incubation</title>
            </Helmet>

            <MetricsGrid metrics={metrics} />

            <MotionCard
                className="metrics-history-card"
                filterBar={filterBar}
                filterBarProps={{
                    background: '#f8fbff',
                    borderColor: '#d9e8ff',
                    borderRadius: 14,
                    padding: 16
                }}
            >
                {isMobile ? (
                    <>
                        <List
                            loading={loading}
                            dataSource={paginatedData}
                            locale={{
                                emptyText: <Empty description="No revenue or employee records found" />
                            }}
                            renderItem={row => (
                                <List.Item className="metrics-mobile-list-item">
                                    <article className="metrics-mobile-card">
                                        <div className="metrics-mobile-card__header">
                                            <Text strong>{monthLabel(row)}</Text>
                                            <Tag color="green">
                                                {currencyFormatter.format(numberValue(row.revenue))}
                                            </Tag>
                                        </div>
                                        <div className="metrics-mobile-card__employees">
                                            <div>
                                                <Text type="secondary">Permanent</Text>
                                                <Text strong>{numberValue(row.headPermanent)}</Text>
                                            </div>
                                            <div>
                                                <Text type="secondary">Temporary</Text>
                                                <Text strong>{numberValue(row.headTemporary)}</Text>
                                            </div>
                                            <div>
                                                <Text type="secondary">Total</Text>
                                                <Text strong>{totalEmployees(row)}</Text>
                                            </div>
                                        </div>
                                    </article>
                                </List.Item>
                            )}
                        />
                        {filteredData.length > 0 && (
                            <Pagination
                                className="metrics-mobile-pagination"
                                current={page}
                                pageSize={pageSize}
                                total={filteredData.length}
                                showSizeChanger
                                pageSizeOptions={[5, 8, 10, 20]}
                                onChange={(nextPage, nextPageSize) => {
                                    setPage(nextPage)
                                    setPageSize(nextPageSize)
                                }}
                                showTotal={total => `${total} reporting periods`}
                            />
                        )}
                    </>
                ) : (
                    <Table<MonthlyPerformanceRow>
                        rowKey="key"
                        loading={loading}
                        columns={columns}
                        dataSource={filteredData}
                        scroll={{ x: 900 }}
                        locale={{
                            emptyText: <Empty description="No revenue or employee records found" />
                        }}
                        pagination={{
                            current: page,
                            pageSize,
                            total: filteredData.length,
                            showSizeChanger: true,
                            pageSizeOptions: [5, 8, 10, 20],
                            showTotal: total => `${total} reporting periods`,
                            onChange: (nextPage, nextPageSize) => {
                                setPage(nextPage)
                                setPageSize(nextPageSize)
                            }
                        }}
                    />
                )}
            </MotionCard>

        </main>
    )
}
