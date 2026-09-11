import React, { useEffect, useState } from 'react'
import { Alert, Card, Progress, Space, Spin, Tag, Typography } from 'antd'
import { TrophyOutlined } from '@ant-design/icons'
import { loadGrowthScore, type GrowthScore } from '@/services/growthScoreService'

const { Text, Title } = Typography

export const GrowthScoreCard: React.FC<{ email?: string | null }> = ({ email }) => {
    const [score, setScore] = useState<GrowthScore | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        if (!email) {
            setScore(null)
            setLoading(false)
            return
        }

        setLoading(true)
        loadGrowthScore(email)
            .then(result => {
                if (!cancelled) setScore(result)
            })
            .catch(error => {
                console.error('Failed to load Growth Score:', error)
                if (!cancelled) setScore(null)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [email])

    return (
        <Card
            style={{ borderRadius: 14, border: '1px solid #d9e8ff', height: '100%' }}
            bodyStyle={{ padding: 14 }}
        >
            <Space direction='vertical' size={10} style={{ width: '100%' }}>
                <Space align='start' style={{ justifyContent: 'space-between', width: '100%' }}>
                    <div>
                        <Space>
                            <TrophyOutlined style={{ color: '#d48806', fontSize: 17 }} />
                            <Title level={5} style={{ margin: 0 }}>Growth Score</Title>
                        </Space>
                    </div>
                    {score && <Tag color={score.total >= 65 ? 'green' : score.total >= 35 ? 'gold' : 'blue'}>{score.band}</Tag>}
                </Space>

                {loading ? <Spin /> : !score ? (
                    <Alert type='info' showIcon message='Your Growth Score will appear once your participant profile is available.' />
                ) : (
                    <>
                        <Space align='center' size={12} wrap>
                            <Progress type='circle' percent={score.total} size={78} strokeWidth={10} strokeColor='#1677ff' format={percent => <strong>{percent}</strong>} />
                            <Text type='secondary' style={{ maxWidth: 420, fontSize: 12 }}>
                                Out of 100, based on verified progress and intervention responses.
                            </Text>
                        </Space>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px 16px' }}>
                          {score.components.map(component => (
                            <div key={component.key}>
                                <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Text strong style={{ fontSize: 12 }}>{component.label}</Text>
                                    <Text style={{ fontSize: 12 }}>{component.score}/{component.maximum}</Text>
                                </Space>
                                <Progress percent={Math.round((component.score / component.maximum) * 100)} showInfo={false} size='small' />
                                <Text type='secondary' style={{ fontSize: 11, lineHeight: 1.2 }}>{component.detail}</Text>
                            </div>
                          ))}
                        </div>
                    </>
                )}
            </Space>
        </Card>
    )
}

export default GrowthScoreCard
