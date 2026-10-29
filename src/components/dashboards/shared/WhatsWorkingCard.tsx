import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Empty, List, Space, Tag, Typography, message } from 'antd'
import { ReloadOutlined, RiseOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {
    formatPoints,
    impactForProgramme,
    refreshImpact,
    type InterventionImpact
} from '@/services/interventionImpactService'

const { Text } = Typography

type Props = {
    programId?: string | null
    /** Managers may recompute now instead of waiting for the monthly run. */
    canRefresh?: boolean
    /** Staff also see early signals; funders only ever see reportable results. */
    includeEarly?: boolean
}

/**
 * "What's working": interventions whose completers' revenue moved differently from
 * similar SMEs, from functions/src/interventionImpact.ts. Only reportable results
 * (10+ SMEs each side) carry a funder line.
 */
export default function WhatsWorkingCard({ programId, canRefresh = false, includeEarly = false }: Props) {
    const [rows, setRows] = useState<InterventionImpact[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [version, setVersion] = useState(0)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        impactForProgramme(programId)
            .then(result => { if (!cancelled) setRows(result) })
            .catch(error => {
                console.error('Could not load impact results', error)
                if (!cancelled) setRows([])
            })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [programId, version])

    const visible = useMemo(() => rows
        .filter(row => row.status === 'reportable' || (includeEarly && row.status === 'early'))
        .sort((a, b) =>
            (a.status === 'reportable' ? 0 : 1) - (b.status === 'reportable' ? 0 : 1) ||
            (b.liftPercent ?? 0) - (a.liftPercent ?? 0)
        ), [rows, includeEarly])

    const onRefresh = async () => {
        setRefreshing(true)
        try {
            const summary = await refreshImpact()
            message.success(`Impact recalculated: ${summary.reportable} reportable, ${summary.early} early signals.`)
            setVersion(value => value + 1)
        } catch (error: any) {
            message.error(error?.message || 'Could not recalculate impact right now.')
        } finally {
            setRefreshing(false)
        }
    }

    const computedAt = rows.find(row => row.computedAt)?.computedAt
    const anyDemo = visible.some(row => row.demo)

    return (
        <Card
            title={<Space><RiseOutlined style={{ color: 'var(--app-accent)' }} /><span>What's working</span></Space>}
            extra={
                <Space>
                    {computedAt ? <Text type='secondary' style={{ fontSize: 12 }}>Updated {dayjs(computedAt).format('D MMM YYYY')}</Text> : null}
                    {canRefresh ? (
                        <Button size='small' shape='round' icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>
                            Recalculate
                        </Button>
                    ) : null}
                </Space>
            }
            loading={loading}
        >
            {!visible.length ? (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description='No intervention has enough SMEs with revenue before and after it yet.'
                />
            ) : (
                <>
                    <List
                        dataSource={visible}
                        renderItem={row => (
                            <List.Item>
                                <List.Item.Meta
                                    title={
                                        <Space size={8} wrap>
                                            <Text strong>{row.interventionTitle}</Text>
                                            <Tag
                                                color={(row.liftPercent ?? 0) > 0 ? 'green' : (row.liftPercent ?? 0) < 0 ? 'red' : 'default'}
                                                style={{ borderRadius: 999 }}
                                            >
                                                {formatPoints(row.liftPercent)} pts
                                            </Tag>
                                            {row.status === 'early' ? <Tag color='gold' style={{ borderRadius: 999 }}>Early signal</Tag> : null}
                                            {row.demo ? <Tag color='purple' style={{ borderRadius: 999 }}>Demo data</Tag> : null}
                                        </Space>
                                    }
                                    description={
                                        row.headline ||
                                        `${row.treatedCount} SMEs against ${row.comparisonCount} similar SMEs; likely range ` +
                                        `${formatPoints(row.rangeLowPercent)} to ${formatPoints(row.rangeHighPercent)} points.`
                                    }
                                />
                            </List.Item>
                        )}
                    />
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        Points are the difference in revenue growth against similar SMEs in the same programme that hadn't had the
                        intervention yet. They show a link, not proof of cause.
                        {anyDemo ? ' Results marked demo come from seeded test SMEs and must not be reported.' : ''}
                    </Text>
                </>
            )}
        </Card>
    )
}
