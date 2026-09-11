import React, { useEffect, useMemo, useState } from 'react'
import {
    Avatar,
    Button,
    Col,
    DatePicker,
    Input,
    message,
    Pagination,
    Rate,
    Result,
    Row,
    Select,
    Skeleton,
    Space,
    Statistic,
    Tag,
    Typography,
    Segmented,
    Divider
} from 'antd'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import { Helmet } from 'react-helmet'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import {
    MessageOutlined,
    StarOutlined,
    WarningOutlined,
    SearchOutlined,
    SmileOutlined,
    BarChartOutlined
} from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { useFullIdentity } from '@/hooks/useFullIdentity'

const { Text, Paragraph } = Typography
const { Search } = Input
const { RangePicker } = DatePicker
const FEEDBACK_PAGE_SIZE = 6

const AI_BACKEND_URL = String(
    import.meta.env.VITE_AI_BACKEND_URL ||
    'https://yoursdvniel-lepharo-smart-incubation.hf.space'
).replace(/\/$/, '')

type Sentiment = 'Positive' | 'Neutral' | 'Negative'
type ViewMode = 'visualisations' | 'feedback'
type RatingFilter = 'All' | '5' | '4+' | '3 and below' | 'Unrated'
type SortMode = 'latest' | 'highest' | 'lowest' | 'sme'
type ChartGroupBy = 'intervention' | 'sector' | 'gender'
type SentimentStatus = 'idle' | 'loading' | 'ready' | 'error'

interface Feedback {
    id: string
    participantId?: string
    sme: string
    interventionTitle: string
    comment: string
    rating?: number
    completedAt?: string
    completedAtRaw?: number
    sentiment?: Sentiment
    sector?: string
    gender?: string
}

type ParticipantMeta = {
    sector?: string
    gender?: string
}

async function fetchSentiments(feedbacks: Feedback[]): Promise<Map<string, Sentiment>> {
    const sentiments = new Map<string, Sentiment>()
    const batchSize = 50
    const analyzableFeedbacks = feedbacks.filter(item => item.comment.trim().length > 0)

    for (let index = 0; index < analyzableFeedbacks.length; index += batchSize) {
        const batch = analyzableFeedbacks.slice(index, index + batchSize)
        const response = await fetch(`${AI_BACKEND_URL}/sentiment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: batch.map(item => ({ id: item.id, text: item.comment }))
            })
        })

        const data = await response.json().catch(() => null)
        if (!response.ok || !Array.isArray(data?.results)) {
            throw new Error(data?.detail || `Sentiment endpoint returned ${response.status}`)
        }

        for (const result of data.results) {
            if (
                typeof result?.id === 'string' &&
                (result.sentiment === 'Positive' ||
                    result.sentiment === 'Neutral' ||
                    result.sentiment === 'Negative')
            ) {
                sentiments.set(result.id, result.sentiment)
            }
        }
    }

    return sentiments
}

function getTimestampDate(value: any): Date | null {
    if (!value) return null
    if (value instanceof Date) return value
    if (typeof value === 'object' && value !== null && typeof (value as any).toDate === 'function') {
        const date = (value as any).toDate()
        return date instanceof Date ? date : null
    }
    if (typeof value === 'number') {
        const date = new Date(value)
        return isNaN(date.getTime()) ? null : date
    }
    if (typeof value === 'string') {
        const date = new Date(value)
        return isNaN(date.getTime()) ? null : date
    }
    return null
}

export const FeedbackWorkspace: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const [consultantId, setConsultantId] = useState<string | null>(null)
    const [feedbacks, setFeedbacks] = useState<Feedback[]>([])
    const [loading, setLoading] = useState(true)
    const [searchText, setSearchText] = useState('')
    const [sentimentFilter, setSentimentFilter] = useState<'All' | Sentiment>('All')
    const [ratingFilter, setRatingFilter] = useState<RatingFilter>('All')
    const [sortBy, setSortBy] = useState<SortMode>('latest')
    const [viewMode, setViewMode] = useState<ViewMode>('visualisations')
    const [chartGroupBy, setChartGroupBy] = useState<ChartGroupBy>('intervention')
    const [sentimentStatus, setSentimentStatus] = useState<SentimentStatus>('idle')
    const [feedbackPage, setFeedbackPage] = useState(1)
    const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
    const [messageApi, contextHolder] = message.useMessage()

    useEffect(() => {
        const resolveCoordinator = async () => {
            if (identityLoading) return
            setConsultantId(null)
            setLoading(true)
            if (!user?.email) {
                setLoading(false)
                return
            }

            try {
                const consultantSnap = await getDocs(
                    query(collection(db, 'coordinators'), where('email', '==', user.email))
                )

                if (consultantSnap.empty) {
                    messageApi.info('No coordinator profile linked to this account.')
                    setLoading(false)
                    return
                }

                setConsultantId(consultantSnap.docs[0].id)
            } catch (error) {
                console.error('Error fetching coordinator info:', error)
                messageApi.error('Failed to fetch coordinator information.')
                setLoading(false)
            }
        }

        resolveCoordinator()
    }, [identityLoading, messageApi, user?.email])

    useEffect(() => {
        if (!consultantId) return

        const q = query(
            collection(db, 'assignedInterventions'),
            where('assigneeId', '==', consultantId),
            where('assignmentStatus', '==', 'completed'),
            where('participantCompletionStatus', '==', 'confirmed')
        )

        const unsubscribe = onSnapshot(
            q,
            async snapshot => {
                try {
                    const baseData = snapshot.docs
                        .map(docSnap => {
                            const d = docSnap.data()
                            const comment = String(d.feedback?.comments || '').trim()
                            if (!comment) return null

                            const completedAtDate = getTimestampDate(d.assigneeCompletedAt || d.updatedAt)
                            const completedAtRaw = completedAtDate ? completedAtDate.getTime() : 0

                            return {
                                id: docSnap.id,
                                participantId: d.participantId,
                                sme: d.participantName || 'Unknown SME',
                                interventionTitle: d.interventionTitle || 'Untitled',
                                comment,
                                rating:
                                    typeof d.feedback.rating === 'number'
                                        ? d.feedback.rating
                                        : undefined,
                                completedAt: completedAtDate
                                    ? dayjs(completedAtDate).format('DD MMM YYYY')
                                    : undefined,
                                completedAtRaw
                            } as Feedback
                        })
                        .filter(Boolean) as Feedback[]

                    const uniqueParticipantIds = Array.from(
                        new Set(
                            baseData
                                .map(item => item.participantId)
                                .filter((id): id is string => Boolean(id))
                        )
                    )

                    setFeedbacks(
                        baseData.map(item => ({
                            ...item,
                            sector: 'Unspecified',
                            gender: 'Unspecified'
                        }))
                    )
                    setLoading(false)

                    setSentimentStatus(baseData.length ? 'loading' : 'ready')
                    const sentimentPromise = fetchSentiments(baseData)
                        .then(result => {
                            setSentimentStatus('ready')
                            setFeedbacks(current =>
                                current.map(item => ({
                                    ...item,
                                    sentiment: result.get(item.id) || item.sentiment
                                }))
                            )
                            return result
                        })
                        .catch(error => {
                            console.error('Sentiment analysis failed:', error)
                            setSentimentStatus('error')
                            messageApi.warning(
                                'Feedback loaded, but sentiment analysis is temporarily unavailable.'
                            )
                            return new Map<string, Sentiment>()
                        })

                    const participantMetaEntries = await Promise.all(
                        uniqueParticipantIds.map(async participantId => {
                            try {
                                const participantSnap = await getDoc(
                                    doc(db, 'participants', participantId)
                                )

                                if (!participantSnap.exists()) {
                                    return [
                                        participantId,
                                        {
                                            sector: 'Unspecified',
                                            gender: 'Unspecified'
                                        }
                                    ] as const
                                }

                                const p = participantSnap.data()

                                return [
                                    participantId,
                                    {
                                        sector:
                                            p.sector ||
                                            p.businessSector ||
                                            p.industry ||
                                            p.sectorName ||
                                            'Unspecified',
                                        gender: p.gender || p.sex || 'Unspecified'
                                    }
                                ] as const
                            } catch (error) {
                                console.error(
                                    'Error fetching participant metadata:',
                                    participantId,
                                    error
                                )

                                return [
                                    participantId,
                                    {
                                        sector: 'Unspecified',
                                        gender: 'Unspecified'
                                    }
                                ] as const
                            }
                        })
                    )

                    const participantMetaMap = new Map<string, ParticipantMeta>(
                        participantMetaEntries
                    )

                    setFeedbacks(current =>
                        current.map(item => {
                            const meta = item.participantId
                                ? participantMetaMap.get(item.participantId)
                                : undefined

                            return {
                                ...item,
                                sector: meta?.sector || item.sector || 'Unspecified',
                                gender: meta?.gender || item.gender || 'Unspecified'
                            }
                        })
                    )

                    void sentimentPromise
                } catch (error) {
                    console.error('Error enriching feedback data:', error)
                    messageApi.error('Failed to enrich feedback data.')
                    setLoading(false)
                }
            },
            error => {
                console.error('Error fetching feedback:', error)
                messageApi.error('Failed to load feedback.')
                setLoading(false)
            }
        )

        return () => unsubscribe()
    }, [consultantId, messageApi])

    const metrics = useMemo(() => {
        const total = feedbacks.length
        const ratedItems = feedbacks.filter(item => typeof item.rating === 'number')

        const avgRating =
            ratedItems.length > 0
                ? Number(
                    (
                        ratedItems.reduce((sum, item) => sum + (item.rating || 0), 0) /
                        ratedItems.length
                    ).toFixed(1)
                )
                : 0

        const positive = feedbacks.filter(f => f.sentiment === 'Positive').length
        const neutral = feedbacks.filter(f => f.sentiment === 'Neutral').length
        const negative = feedbacks.filter(f => f.sentiment === 'Negative').length
        const lowRated = feedbacks.filter(
            f => typeof f.rating === 'number' && (f.rating || 0) <= 2
        ).length

        let dominantSentiment: Sentiment | null = null
        if (positive + neutral + negative > 0) {
            dominantSentiment = 'Neutral'
            if (positive >= neutral && positive >= negative) dominantSentiment = 'Positive'
            else if (negative >= positive && negative >= neutral) dominantSentiment = 'Negative'
        }

        return {
            total,
            avgRating,
            lowRated,
            dominantSentiment
        }
    }, [feedbacks])

    const filteredFeedbacks = useMemo(() => {
        const data = feedbacks.filter(item => {
            const queryText = searchText.trim().toLowerCase()

            const matchesSearch =
                !queryText ||
                item.sme.toLowerCase().includes(queryText) ||
                item.interventionTitle.toLowerCase().includes(queryText) ||
                item.comment.toLowerCase().includes(queryText) ||
                (item.sector || '').toLowerCase().includes(queryText) ||
                (item.gender || '').toLowerCase().includes(queryText)

            const matchesSentiment =
                sentimentFilter === 'All' || item.sentiment === sentimentFilter

            const matchesRating =
                ratingFilter === 'All'
                    ? true
                    : ratingFilter === '5'
                        ? item.rating === 5
                        : ratingFilter === '4+'
                            ? (item.rating || 0) >= 4
                            : ratingFilter === '3 and below'
                                ? typeof item.rating === 'number' && item.rating <= 3
                                : typeof item.rating !== 'number'

            const [rangeStart, rangeEnd] = dateRange || []
            const matchesDateRange =
                !rangeStart && !rangeEnd
                    ? true
                    : Boolean(
                        item.completedAtRaw &&
                        (!rangeStart || item.completedAtRaw >= rangeStart.startOf('day').valueOf()) &&
                        (!rangeEnd || item.completedAtRaw <= rangeEnd.endOf('day').valueOf())
                    )

            return matchesSearch && matchesSentiment && matchesRating && matchesDateRange
        })

        data.sort((a, b) => {
            if (sortBy === 'highest') return (b.rating || 0) - (a.rating || 0)
            if (sortBy === 'lowest') return (a.rating || 0) - (b.rating || 0)
            if (sortBy === 'sme') return a.sme.localeCompare(b.sme)
            return (b.completedAtRaw || 0) - (a.completedAtRaw || 0)
        })

        return data
    }, [feedbacks, searchText, sentimentFilter, ratingFilter, sortBy, dateRange])

    useEffect(() => {
        setFeedbackPage(1)
    }, [searchText, sentimentFilter, ratingFilter, sortBy, dateRange])

    useEffect(() => {
        const lastPage = Math.max(1, Math.ceil(filteredFeedbacks.length / FEEDBACK_PAGE_SIZE))
        if (feedbackPage > lastPage) setFeedbackPage(lastPage)
    }, [feedbackPage, filteredFeedbacks.length])

    const paginatedFeedbacks = useMemo(() => {
        const start = (feedbackPage - 1) * FEEDBACK_PAGE_SIZE
        return filteredFeedbacks.slice(start, start + FEEDBACK_PAGE_SIZE)
    }, [feedbackPage, filteredFeedbacks])

    const analyzedSentimentCount = useMemo(
        () => filteredFeedbacks.filter(item => Boolean(item.sentiment)).length,
        [filteredFeedbacks]
    )

    const groupedAverageSeries = useMemo(() => {
        if (!filteredFeedbacks.length) {
            return {
                categories: [] as string[],
                values: [] as number[]
            }
        }

        const groupMap = new Map<string, { total: number; count: number }>()

        filteredFeedbacks.forEach(item => {
            if (typeof item.rating !== 'number') return

            let key = 'Unspecified'
            if (chartGroupBy === 'intervention') key = item.interventionTitle || 'Untitled'
            if (chartGroupBy === 'sector') key = item.sector || 'Unspecified'
            if (chartGroupBy === 'gender') key = item.gender || 'Unspecified'

            const current = groupMap.get(key) || { total: 0, count: 0 }
            current.total += item.rating
            current.count += 1
            groupMap.set(key, current)
        })

        const entries = Array.from(groupMap.entries())
            .map(([name, values]) => ({
                name,
                avg: values.count ? Number((values.total / values.count).toFixed(2)) : 0
            }))
            .sort((a, b) => b.avg - a.avg)
            .slice(0, 12)

        return {
            categories: entries.map(item => item.name),
            values: entries.map(item => item.avg)
        }
    }, [filteredFeedbacks, chartGroupBy])

    const ratingRadarOptions = useMemo(() => {
        const buckets = [1, 2, 3, 4, 5].map(star =>
            filteredFeedbacks.filter(item => item.rating === star).length
        )

        return {
            chart: {
                polar: true,
                type: 'area',
                height: 380,
                backgroundColor: 'transparent',
                animation: { duration: 700 }
            },
            title: { text: 'Rating Distribution' },
            credits: { enabled: false },
            pane: {
                size: '78%'
            },
            xAxis: {
                categories: ['1 Star', '2 Stars', '3 Stars', '4 Stars', '5 Stars'],
                tickmarkPlacement: 'on',
                lineWidth: 0
            },
            yAxis: {
                min: 0,
                title: { text: '' },
                gridLineInterpolation: 'polygon',
                gridLineColor: '#ded7f5',
                gridLineWidth: 1
            },
            tooltip: {
                pointFormat: 'Count: <b>{point.y}</b>'
            },
            legend: { enabled: false },
            plotOptions: {
                series: {
                    animation: { duration: 850 },
                    marker: {
                        enabled: true,
                        radius: 4,
                        fillColor: '#ffffff',
                        lineColor: '#9254de',
                        lineWidth: 2
                    },
                    dataLabels: {
                        enabled: true,
                        format: '{point.y}'
                    }
                }
            },
            series: [
                {
                    type: 'area',
                    name: 'Ratings',
                    color: '#9254de',
                    fillColor: 'rgba(146, 84, 222, 0.14)',
                    lineWidth: 2,
                    data: buckets
                }
            ]
        } as Highcharts.Options
    }, [filteredFeedbacks])

    const sentimentDistributionOptions = useMemo(() => {
        const positive = filteredFeedbacks.filter(f => f.sentiment === 'Positive').length
        const neutral = filteredFeedbacks.filter(f => f.sentiment === 'Neutral').length
        const negative = filteredFeedbacks.filter(f => f.sentiment === 'Negative').length

        return {
            chart: {
                type: 'pie',
                height: 380,
                backgroundColor: 'transparent',
                animation: { duration: 700 },
                spacingLeft: 20,
                spacingRight: 20,
                spacingTop: 20,
                spacingBottom: 20
            },
            title: { text: 'Sentiment Distribution' },
            credits: { enabled: false },
            legend: {
                enabled: false
            },
            tooltip: {
                pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)'
            },
            plotOptions: {
                pie: {
                    animation: { duration: 850 },
                    innerSize: '58%',
                    size: '78%',
                    center: ['50%', '50%'],
                    allowPointSelect: true,
                    showInLegend: false,
                    dataLabels: {
                        enabled: true,
                        distance: 18,
                        connectorWidth: 1,
                        connectorColor: '#595959',
                        softConnector: true,
                        crookDistance: '70%',
                        format: '{point.name}: {point.y} ({point.percentage:.1f}%)',
                        style: {
                            color: '#000000',
                            fontSize: '12px',
                            fontWeight: '500',
                            textOutline: 'none'
                        }
                    }
                }
            },
            series: [
                {
                    type: 'pie',
                    name: 'Sentiment',
                    data: [
                        { name: 'Positive', y: positive, color: '#52c41a' },
                        { name: 'Neutral', y: neutral, color: '#faad14' },
                        { name: 'Negative', y: negative, color: '#ff4d4f' }
                    ]
                }
            ]
        } as Highcharts.Options
    }, [filteredFeedbacks])

    const averageRatingOptions = useMemo(() => {
        const title =
            chartGroupBy === 'intervention'
                ? 'Average Rating by Intervention'
                : chartGroupBy === 'sector'
                    ? 'Average Rating by SME Sector'
                    : 'Average Rating by Gender'

        const useHorizontalBars = chartGroupBy === 'intervention'
        const chartType: Highcharts.Options['chart'] = {
            type: useHorizontalBars ? 'bar' : 'column',
            height: useHorizontalBars
                ? Math.max(380, groupedAverageSeries.categories.length * 42)
                : 400,
            backgroundColor: 'transparent'
        }

        return {
            chart: {
                ...chartType
            },
            title: { text: title },
            xAxis: {
                categories: groupedAverageSeries.categories,
                title: { text: undefined }
            },
            yAxis: {
                min: 0,
                max: 5,
                title: { text: 'Average Rating' }
            },
            credits: { enabled: false },
            legend: { enabled: false },
            tooltip: {
                pointFormat: 'Average Rating: <b>{point.y:.2f}</b>'
            },
            plotOptions: {
                series: {
                    animation: { duration: 850 },
                    borderRadius: 6,
                    dataLabels: {
                        enabled: true,
                        format: '{point.y:.2f}'
                    }
                }
            },
            series: [
                {
                    type: useHorizontalBars ? 'bar' : 'column',
                    name: 'Average Rating',
                    color: '#1677ff',
                    data: groupedAverageSeries.values.map((value, index) => ({
                        y: value,
                        color:
                            chartGroupBy === 'gender'
                                ? getGenderChartColor(groupedAverageSeries.categories[index])
                                : '#1677ff'
                    }))
                }
            ]
        } as Highcharts.Options
    }, [chartGroupBy, groupedAverageSeries])

    const ratingTrendSeries = useMemo(() => {
        const grouped = new Map<
            string,
            { timestamp: number; label: string; total: number; count: number }
        >()

        filteredFeedbacks.forEach(item => {
            if (!item.completedAtRaw || typeof item.rating !== 'number') return
            const date = dayjs(item.completedAtRaw)
            const key = date.format('YYYY-MM-DD')
            const current = grouped.get(key) || {
                timestamp: date.startOf('day').valueOf(),
                label: date.format('DD MMM'),
                total: 0,
                count: 0
            }
            current.total += item.rating
            current.count += 1
            grouped.set(key, current)
        })

        const points = Array.from(grouped.values()).sort(
            (a, b) => a.timestamp - b.timestamp
        )

        return {
            categories: points.map(point => point.label),
            values: points.map(point => Number((point.total / point.count).toFixed(2)))
        }
    }, [filteredFeedbacks])

    const ratingTrendOptions = useMemo(
        () =>
            ({
                chart: {
                    type: 'areaspline',
                    height: 400,
                    backgroundColor: 'transparent',
                    animation: { duration: 700 }
                },
                title: { text: 'Average Rating Trend' },
                subtitle: { text: 'How feedback ratings change over time' },
                credits: { enabled: false },
                legend: { enabled: false },
                xAxis: {
                    categories: ratingTrendSeries.categories,
                    tickmarkPlacement: 'on'
                },
                yAxis: {
                    min: 0,
                    max: 5,
                    tickInterval: 1,
                    title: { text: 'Average Rating' },
                    plotBands: [
                        { from: 0, to: 2.5, color: 'rgba(255, 77, 79, 0.05)' },
                        { from: 2.5, to: 4, color: 'rgba(250, 173, 20, 0.05)' },
                        { from: 4, to: 5, color: 'rgba(82, 196, 26, 0.05)' }
                    ]
                },
                tooltip: {
                    pointFormat: 'Average Rating: <b>{point.y:.2f}</b>'
                },
                plotOptions: {
                    series: {
                        animation: { duration: 900 },
                        marker: {
                            enabled: true,
                            radius: 4,
                            fillColor: '#ffffff',
                            lineColor: '#1677ff',
                            lineWidth: 2
                        },
                        dataLabels: {
                            enabled: ratingTrendSeries.values.length <= 12,
                            format: '{point.y:.1f}'
                        }
                    },
                    areaspline: {
                        color: '#1677ff',
                        fillColor: 'rgba(22, 119, 255, 0.10)',
                        lineWidth: 3
                    }
                },
                series: [
                    {
                        type: 'areaspline',
                        name: 'Average Rating',
                        data: ratingTrendSeries.values
                    }
                ]
            }) as Highcharts.Options,
        [ratingTrendSeries]
    )

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Feedback Workspace | Smart Incubation</title>
            </Helmet>

            {contextHolder}

            <Space direction="vertical" size={18} style={{ width: '100%' }}>
                <Row gutter={[16, 16]}>
                    <Col xs={24} sm={12} lg={6}>
                        <MotionCard>
                            <MotionCard.Metric
                                icon={<MessageOutlined style={{ color: '#1677ff', fontSize: 18 }} />}
                                iconBg="rgba(22,119,255,0.12)"
                                title="Total Feedback"
                                value={metrics.total}
                                subtitle="All submitted feedback"
                            />
                        </MotionCard>
                    </Col>

                    <Col xs={24} sm={12} lg={6}>
                        <MotionCard>
                            <MotionCard.Metric
                                icon={<StarOutlined style={{ color: '#faad14', fontSize: 18 }} />}
                                iconBg="rgba(250,173,20,0.14)"
                                title="Average Rating"
                                value={`${metrics.avgRating.toFixed(1)} / 5`}
                                subtitle="Across all responses"
                            />
                        </MotionCard>
                    </Col>

                    <Col xs={24} sm={12} lg={6}>
                        <MotionCard>
                            <MotionCard.Metric
                                icon={<WarningOutlined style={{ color: '#ff4d4f', fontSize: 18 }} />}
                                iconBg="rgba(255,77,79,0.12)"
                                title="Low Ratings"
                                value={metrics.lowRated}
                                subtitle="Ratings below threshold"
                            />
                        </MotionCard>
                    </Col>

                    <Col xs={24} sm={12} lg={6}>
                        <MotionCard>
                            <MotionCard.Metric
                                icon={
                                    <SmileOutlined
                                        style={{
                                            color: metrics.dominantSentiment
                                                ? getSentimentTextColor(metrics.dominantSentiment)
                                                : '#8c8c8c',
                                            fontSize: 18
                                        }}
                                    />
                                }
                                iconBg="rgba(114,46,209,0.12)"
                                title="Dominant Sentiment"
                                value={
                                    <span
                                        style={{
                                            color: metrics.dominantSentiment
                                                ? getSentimentTextColor(metrics.dominantSentiment)
                                                : '#8c8c8c'
                                        }}
                                    >
                                        {metrics.dominantSentiment ||
                                            (sentimentStatus === 'loading'
                                                ? 'Analyzing'
                                                : 'Unavailable')}
                                    </span>
                                }
                                subtitle="Overall feedback mood"
                            />
                        </MotionCard>
                    </Col>
                </Row>

                <MotionCard>
                    <Row gutter={[12, 12]} align="middle">
                        <Col xs={24} lg={12} xxl={6}>
                            <Segmented
                                block
                                value={viewMode}
                                onChange={value => setViewMode(value as ViewMode)}
                                options={[
                                    {
                                        label: (
                                            <Space size={6}>
                                                <BarChartOutlined />
                                                Visualisations
                                            </Space>
                                        ),
                                        value: 'visualisations'
                                    },
                                    {
                                        label: (
                                            <Space size={6}>
                                                <MessageOutlined />
                                                Feedback
                                            </Space>
                                        ),
                                        value: 'feedback'
                                    }
                                ]}
                            />
                        </Col>

                        <Col xs={24} lg={12} xxl={6}>
                            <Search
                                allowClear
                                placeholder="Search SME, intervention, sector, gender or comment"
                                value={searchText}
                                onChange={e => setSearchText(e.target.value)}
                                prefix={<SearchOutlined />}
                            />
                        </Col>

                        <Col xs={24} md={12} xxl={6}>
                            <RangePicker
                                value={dateRange}
                                onChange={values => setDateRange(values)}
                                allowClear
                                style={{ width: '100%' }}
                                placeholder={['From date', 'To date']}
                            />
                        </Col>

                        <Col xs={24} md={12} xxl={3}>
                            <Select
                                value={sentimentFilter}
                                onChange={value => setSentimentFilter(value)}
                                style={{ width: '100%' }}
                                options={[
                                    { label: 'All Sentiments', value: 'All' },
                                    { label: 'Positive', value: 'Positive' },
                                    { label: 'Neutral', value: 'Neutral' },
                                    { label: 'Negative', value: 'Negative' }
                                ]}
                            />
                        </Col>

                        <Col xs={24} md={12} xxl={3}>
                            <Select
                                value={ratingFilter}
                                onChange={value => setRatingFilter(value)}
                                style={{ width: '100%' }}
                                options={[
                                    { label: 'All Ratings', value: 'All' },
                                    { label: '5 Stars', value: '5' },
                                    { label: '4+ Stars', value: '4+' },
                                    { label: '3 and below', value: '3 and below' },
                                    { label: 'Unrated', value: 'Unrated' }
                                ]}
                            />
                        </Col>
                    </Row>
                </MotionCard>

                {loading ? (
                    <Row gutter={[16, 16]}>
                        {[0, 1, 2].map(item => (
                            <Col xs={24} md={12} xl={8} key={item}>
                                <MotionCard>
                                    <Skeleton active avatar paragraph={{ rows: 4 }} />
                                </MotionCard>
                            </Col>
                        ))}
                    </Row>
                ) : filteredFeedbacks.length === 0 ? (
                    <Result
                        status="info"
                        title="No Feedback Found"
                        subTitle="No feedback matches your current filters."
                        extra={
                            <Button
                                type="primary"
                                onClick={() => {
                                    setSearchText('')
                                    setSentimentFilter('All')
                                    setRatingFilter('All')
                                    setDateRange(null)
                                }}
                            >
                                Reset Filters
                            </Button>
                        }
                    />
                ) : viewMode === 'visualisations' ? (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Row gutter={[16, 16]}>
                            <Col xs={24} xl={12}>
                                <MotionCard
                                >
                                    <HighchartsReact
                                        highcharts={Highcharts}
                                        options={ratingRadarOptions}
                                    />
                                </MotionCard>
                            </Col>

                            <Col xs={24} xl={12}>
                                <MotionCard>
                                    {analyzedSentimentCount > 0 ? (
                                        <HighchartsReact
                                            highcharts={Highcharts}
                                            options={sentimentDistributionOptions}
                                        />
                                    ) : (
                                        <div
                                            style={{
                                                minHeight: 380,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center'
                                            }}
                                        >
                                            <Result
                                                status="info"
                                                title={
                                                    sentimentStatus === 'loading'
                                                        ? 'Analyzing feedback sentiment'
                                                        : 'Sentiment analysis unavailable'
                                                }
                                                subTitle={
                                                    sentimentStatus === 'loading'
                                                        ? 'Results will appear when the AI analysis completes.'
                                                        : 'Feedback remains available while the analysis service recovers.'
                                                }
                                            />
                                        </div>
                                    )}
                                </MotionCard>
                            </Col>
                        </Row>

                        <Row gutter={[16, 16]}>
                            <Col xs={24} xl={12}>
                                <MotionCard style={{ height: '100%' }}>
                                    <Select
                                        value={chartGroupBy}
                                        onChange={value => setChartGroupBy(value)}
                                        style={{ width: '100%', marginBottom: 8 }}
                                        options={[
                                            { label: 'By Intervention', value: 'intervention' },
                                            { label: 'By SME Sector', value: 'sector' },
                                            { label: 'By Gender', value: 'gender' }
                                        ]}
                                    />
                                    <HighchartsReact
                                        highcharts={Highcharts}
                                        options={averageRatingOptions}
                                    />
                                </MotionCard>
                            </Col>
                            <Col xs={24} xl={12}>
                                <MotionCard style={{ height: '100%' }}>
                                    {ratingTrendSeries.values.length ? (
                                        <HighchartsReact
                                            highcharts={Highcharts}
                                            options={ratingTrendOptions}
                                        />
                                    ) : (
                                        <Result
                                            status="info"
                                            title="No dated ratings available"
                                            subTitle="The rating trend appears when feedback has completion dates."
                                        />
                                    )}
                                </MotionCard>
                            </Col>
                        </Row>
                    </Space>
                ) : (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>


                        <Row gutter={[16, 16]}>
                            {paginatedFeedbacks.map(item => (
                                <Col xs={24} md={12} xl={8} key={item.id}>
                                    <MotionCard style={{ height: '100%' }}>
                                        <Space
                                            direction="vertical"
                                            size={12}
                                            style={{ width: '100%' }}
                                        >
                                            <Space align="start">
                                                <Avatar style={{ background: '#1677ff' }}>
                                                    {getInitials(item.sme)}
                                                </Avatar>

                                                <div>
                                                    <Text strong>{item.sme}</Text>
                                                    <div>
                                                        <Text type="secondary">
                                                            {item.interventionTitle}
                                                        </Text>
                                                    </div>
                                                </div>
                                            </Space>

                                            <Space wrap>
                                                {item.completedAt && <Tag>{item.completedAt}</Tag>}
                                                {item.sector && <Tag>{item.sector}</Tag>}
                                                {item.gender && <Tag>{item.gender}</Tag>}
                                                {item.sentiment ? (
                                                    <Tag color={getSentimentTagColor(item.sentiment)}>
                                                        {item.sentiment}
                                                    </Tag>
                                                ) : (
                                                    <Tag>
                                                        {sentimentStatus === 'loading'
                                                            ? 'Analyzing sentiment…'
                                                            : 'Sentiment unavailable'}
                                                    </Tag>
                                                )}
                                                {(item.rating || 0) <= 2 &&
                                                    typeof item.rating === 'number' && (
                                                        <Tag color="red">
                                                            Needs attention
                                                        </Tag>
                                                    )}
                                            </Space>

                                            <div>
                                                <Text strong>Rating</Text>
                                                <div style={{ marginTop: 6 }}>
                                                    <Rate disabled value={item.rating || 0} />
                                                </div>
                                            </div>

                                            <div>
                                                <Text strong>Comment</Text>
                                                <Paragraph
                                                    style={{
                                                        marginTop: 8,
                                                        marginBottom: 0
                                                    }}
                                                    ellipsis={{
                                                        rows: 4,
                                                        expandable: true,
                                                        symbol: 'more'
                                                    }}
                                                >
                                                    {item.comment}
                                                </Paragraph>
                                            </div>

                                            <Divider style={{ margin: '4px 0' }} />
                                        </Space>
                                    </MotionCard>
                                </Col>
                            ))}
                        </Row>

                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <Pagination
                                current={feedbackPage}
                                pageSize={FEEDBACK_PAGE_SIZE}
                                total={filteredFeedbacks.length}
                                showSizeChanger={false}
                                onChange={setFeedbackPage}
                            />
                        </div>
                    </Space>
                )}
            </Space>
        </div>
    )
}

function getSentimentTagColor(sentiment: Sentiment) {
    if (sentiment === 'Positive') return 'green'
    if (sentiment === 'Negative') return 'red'
    return 'gold'
}

function getSentimentTextColor(sentiment: Sentiment) {
    if (sentiment === 'Positive') return '#52c41a'
    if (sentiment === 'Negative') return '#ff4d4f'
    return '#faad14'
}

function getGenderChartColor(gender?: string) {
    const normalized = String(gender || '').trim().toLowerCase()
    if (normalized === 'female' || normalized === 'woman' || normalized === 'women') {
        return '#eb2f96'
    }
    if (normalized === 'male' || normalized === 'man' || normalized === 'men') {
        return '#1677ff'
    }
    return '#8c8c8c'
}

function getInitials(name: string) {
    return name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0]?.toUpperCase())
        .join('')
}

function getAverage(items: Feedback[]) {
    const rated = items.filter(item => typeof item.rating === 'number')
    if (!rated.length) return 0
    return rated.reduce((sum, item) => sum + (item.rating || 0), 0) / rated.length
}
