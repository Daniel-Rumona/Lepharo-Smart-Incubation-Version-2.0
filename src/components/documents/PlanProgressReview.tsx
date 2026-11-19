import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Col, Collapse, Empty, Progress, Row, Space, Spin, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import ResponsiveSheet from '@/components/common/ResponsiveSheet'
import { checkPlanProgress, type PlanProgressResult, type ProgressVerdict } from '@/services/planProgressService'

const { Text, Paragraph } = Typography
const verdicts: Record<ProgressVerdict, { label: string; color: string }> = {
    on_track: { label: 'On track', color: '#1677ff' },
    behind: { label: 'Behind plan', color: '#d4380d' },
    complete: { label: 'Complete', color: '#389e0d' },
    not_due: { label: 'Not due yet', color: '#595959' },
    insufficient_evidence: { label: 'Needs evidence', color: '#ad6800' }
}

export default function PlanProgressReview({ document, onClose }: {
    document: { id: string; title: string; attachment?: { url: string } } | null
    onClose: () => void
}) {
    const [result, setResult] = useState<PlanProgressResult | null>(null)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [attempt, setAttempt] = useState(0)
    const requestId = useRef(0)

    useEffect(() => {
        const id = ++requestId.current
        setResult(null)
        setError('')
        setLoading(false)
        if (!document) return
        const controller = new AbortController()
        let timedOut = false
        const timeout = window.setTimeout(() => { timedOut = true; controller.abort() }, 180000)
        setLoading(true)
        checkPlanProgress(document.id, controller.signal)
            .then(data => { if (requestId.current === id) setResult(data) })
            .catch(reason => {
                if (requestId.current !== id) return
                if (timedOut) setError('The review took too long. Please retry in a moment.')
                else if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The progress review failed. Please retry.')
            })
            .finally(() => { window.clearTimeout(timeout); if (requestId.current === id) setLoading(false) })
        return () => { ++requestId.current; window.clearTimeout(timeout); controller.abort() }
    }, [document?.id, document?.attachment?.url, attempt])

    const verdict = result ? verdicts[result.overall] || verdicts.insufficient_evidence : null
    const metrics = result?.metrics
    return (
        <ResponsiveSheet open={!!document} onClose={onClose} title='Implementation plan progress' width={1050}
            footer={<Space wrap><Button onClick={onClose}>Close</Button><Button icon={<ReloadOutlined />} disabled={loading} onClick={() => setAttempt(value => value + 1)}>{error ? 'Retry' : 'Check again'}</Button></Space>}>
            <Space direction='vertical' size={20} style={{ width: '100%' }}>
                <div>
                    <Text strong>{document?.title}</Text>
                    <Paragraph type='secondary' style={{ marginBottom: 0 }}>AI compares the uploaded plan with live programme and department records. This assessment does not change the document’s validation status.</Paragraph>
                </div>
                {loading && <div role='status' style={{ padding: '40px 12px', textAlign: 'center' }}><Spin size='large' /><Paragraph style={{ marginTop: 20 }}>Reading the plan and comparing delivery evidence…</Paragraph><Text type='secondary'>This can take a minute or two.</Text></div>}
                {error && <Alert type='error' showIcon message='Progress check unavailable' description={error} />}
                {result && verdict && metrics && <>
                    <Card size='small' style={{ borderLeft: `4px solid ${verdict.color}` }}>
                        <Space wrap><Tag color={verdict.color}>{verdict.label}</Tag><Text type='secondary'>AI assessment · as of {dayjs(result.asOf).format('D MMM YYYY')}</Text></Space>
                        <Paragraph style={{ marginTop: 12, marginBottom: 8 }}>{result.summary}</Paragraph>
                        <Text type='secondary'>{result.departmentName} · Checked {dayjs(result.checkedAt).format('D MMM YYYY HH:mm')}</Text>
                    </Card>
                    <div>
                        <Text strong>Plan milestone assessment</Text>
                        <div role='img' aria-label={Object.entries(verdicts).map(([key, value]) => `${value.label}: ${result.milestones.filter(m => m.status === key).length}`).join(', ')}
                            style={{ display: 'flex', height: 18, borderRadius: 8, overflow: 'hidden', margin: '12px 0' }}>
                            {Object.entries(verdicts).map(([key, value]) => {
                                const count = result.milestones.filter(m => m.status === key).length
                                return count ? <div key={key} style={{ flex: count, background: value.color }} /> : null
                            })}
                        </div>
                        <Space wrap>{Object.entries(verdicts).map(([key, value]) => <Tag key={key} color={value.color}>{value.label}: {result.milestones.filter(m => m.status === key).length}</Tag>)}</Space>
                        <Paragraph type='secondary' style={{ marginTop: 8 }}>AI-assessed milestone counts, not a weighted project completion percentage.</Paragraph>
                    </div>
                    <Row gutter={[12, 12]}>
                        <Col xs={24} sm={12}><Card size='small' title='Recorded assignments'>
                            {metrics.assignments ? <Progress percent={Math.round(metrics.completedAssignments / metrics.assignments * 100)} format={() => `${metrics.completedAssignments} / ${metrics.assignments}`} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No matching assignments' />}
                            <Text type='secondary'>Completed records · {metrics.overdueAssignments} overdue · {metrics.uniqueSmmes} distinct SMMEs assigned</Text>
                        </Card></Col>
                        <Col xs={24} sm={12}><Card size='small' title='MOV approval'>
                            {metrics.movs ? <Progress percent={Math.round(metrics.approvedMovs / metrics.movs * 100)} strokeColor='#389e0d' format={() => `${metrics.approvedMovs} / ${metrics.movs}`} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No matching MOVs' />}
                            <Text type='secondary'>Approved MOV records; attached evidence has not been independently verified.</Text>
                        </Card></Col>
                    </Row>
                    <div>
                        <Text strong>Milestone comparison</Text>
                        <Collapse style={{ marginTop: 10 }} items={result.milestones.map((milestone, index) => ({
                            key: index,
                            label: <Space wrap><Tag color={verdicts[milestone.status]?.color}>{verdicts[milestone.status]?.label || 'Needs evidence'}</Tag><Text>{milestone.title}</Text></Space>,
                            children: <Space direction='vertical' size={12} style={{ width: '100%' }}>
                                <div><Text strong>Plan: </Text><Text>{milestone.planBasis}</Text></div>
                                <Space wrap><Text>Target: {milestone.target || 'Not specified'}</Text><Text>Due: {milestone.dueDate ? `${dayjs(milestone.dueDate).format('D MMM YYYY')} (${milestone.dateConfidence})` : 'Not specified'}</Text></Space>
                                <Paragraph style={{ marginBottom: 0 }}>{milestone.observed}</Paragraph>
                                <Text strong>Supporting records</Text>
                                {milestone.evidenceRefs.length ? milestone.evidenceRefs.map(ref => {
                                    const evidence = result.evidence.find(e => e.ref === ref)
                                    return evidence ? <Card size='small' key={ref} style={{ width: '100%' }}>
                                        <Text strong>{evidence.title || 'Delivery record'}{evidence.detail ? ` · ${evidence.detail}` : ''}</Text>
                                        {evidence.businessName && <div><Text>{evidence.businessName}</Text></div>}
                                        <Paragraph style={{ margin: '4px 0' }}>{evidence.status || 'Status not recorded'}{evidence.deliveryDate ? ` · Delivered ${evidence.deliveryDate}` : evidence.completedAt ? ` · Completion recorded ${evidence.completedAt}` : ''}{evidence.evidenceAttached ? ' · Attachment recorded' : ''}</Paragraph>
                                        {evidence.notes.map((note, n) => <Paragraph key={n} type='secondary' style={{ marginBottom: 4 }}>{note}</Paragraph>)}
                                        <Text type='secondary' style={{ fontSize: 11, overflowWrap: 'anywhere' }}>{ref}</Text>
                                    </Card> : null
                                }) : <Text type='secondary'>No matching delivery evidence was established.</Text>}
                            </Space>
                        }))} />
                    </div>
                    {!!result.nextSteps.length && <div><Text strong>Next steps</Text><ul style={{ paddingLeft: 20 }}>{result.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ul></div>}
                    <Alert type='info' showIcon message='Evidence coverage' description={<>
                        <div>Assignment totals can include repeated activities for the same business. Missing evidence does not prove that work was not done.</div>
                        <div>Sources checked: assignments, MOVs and evidence packs, group deliveries, development plans and appointment sessions. Delivery attachments themselves are not read.</div>
                        {!!result.limitations.length && <ul style={{ paddingLeft: 20, marginBottom: 0 }}>{result.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>}
                    </>} />
                </>}
            </Space>
        </ResponsiveSheet>
    )
}
