import React, { useEffect, useState } from 'react'
import { Button, DatePicker, Modal, Space, Tag, Typography, theme } from 'antd'
import {
    CheckCircleFilled,
    DownloadOutlined,
    FilePptOutlined,
    LoadingOutlined,
    RiseOutlined,
    WhatsAppOutlined
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { IconChip } from '@/components/dashboards/metrics/MetricTile'
import './centre-report-modal.css'

const { Text, Title } = Typography

type ReportId = 'executive' | 'national'
type Generated = { url: string; fileName: string }

const REPORTS: Array<{ id: ReportId; title: string; summary: string; icon: React.ReactNode; tone: 'accent' | 'info'; sections: string[] }> = [
    {
        id: 'executive',
        title: 'Executive Report',
        summary: 'The monthly executive & operations deck for your centre.',
        icon: <FilePptOutlined />,
        tone: 'accent',
        sections: ['Team', 'Centre management', 'Facilities', 'SMMEs & locality', 'Workshops', 'Staff attendance', 'Needs', 'Challenges']
    },
    {
        id: 'national',
        title: 'National Report',
        summary: "Your centre's interventions progress, for the national meeting.",
        icon: <RiseOutlined />,
        tone: 'info',
        sections: ['Programme summary', 'Progress by department', 'Sessions & attendance', 'Attention list']
    }
]

const callable = httpsCallable<{ reportId: ReportId; month: string }, Generated>(functions, 'generateReport', { timeout: 300_000 })

const download = ({ url, fileName }: Generated) => {
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
}

/**
 * Pick a report and a month, then download it as a PowerPoint. Reports are built on the server
 * (functions/src/reports), exactly as when they are requested on WhatsApp under Reports.
 */
const CentreReportModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const { user } = useFullIdentity()
    const { token } = theme.useToken()
    const [reportId, setReportId] = useState<ReportId>('executive')
    // Early in a month the report is usually for the month just ended.
    const [month, setMonth] = useState<Dayjs>(() => dayjs().subtract(dayjs().date() < 10 ? 1 : 0, 'month'))
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [generated, setGenerated] = useState<Generated | null>(null)
    const [centreName, setCentreName] = useState('')
    const branchId = String(user?.assignedBranch || '')

    useEffect(() => {
        if (!open || !branchId) return
        let active = true
        getDoc(doc(db, 'branches', branchId))
            .then(snapshot => active && setCentreName(String(snapshot.data()?.name || snapshot.data()?.branchName || '')))
            .catch(() => undefined)
        return () => { active = false }
    }, [open, branchId])

    // A fresh start every time the modal opens.
    useEffect(() => {
        if (open) {
            setGenerated(null)
            setError(null)
        }
    }, [open])

    const report = REPORTS.find(item => item.id === reportId)!
    const thisMonth = dayjs().startOf('month')
    const lastMonth = thisMonth.subtract(1, 'month')

    const build = async () => {
        setBusy(true)
        setError(null)
        try {
            const result = await callable({ reportId, month: month.format('YYYY-MM') })
            setGenerated(result.data)
            download(result.data)
        } catch (failure: any) {
            console.error('Report failed', failure)
            setError(failure?.message || 'The report could not be generated. Please try again.')
        } finally {
            setBusy(false)
        }
    }

    const footer = generated
        ? [
            <Button key='another' onClick={() => setGenerated(null)}>Generate another</Button>,
            <Button key='close' type='primary' onClick={onClose}>Done</Button>
        ]
        : [
            <Button key='cancel' onClick={onClose} disabled={busy}>Cancel</Button>,
            <Button
                key='generate'
                type='primary'
                icon={busy ? <LoadingOutlined /> : <DownloadOutlined />}
                onClick={build}
                disabled={!branchId || busy}
            >
                {busy ? 'Building…' : 'Generate PowerPoint'}
            </Button>
        ]

    return (
        <Modal
            open={open}
            onCancel={busy ? undefined : onClose}
            maskClosable={!busy}
            closable={!busy}
            footer={footer}
            width={720}
            className='centre-report-modal'
            title={
                <Space size={12} align='center'>
                    <IconChip tone='accent' icon={<FilePptOutlined />} size={36} radius={10} />
                    <div>
                        <Title level={5} style={{ margin: 0 }}>Centre reports</Title>
                        <Text type='secondary' style={{ fontSize: 13 }}>
                            {centreName ? `${centreName} centre` : 'Your centre'} · PowerPoint on the Lepharo template
                        </Text>
                    </div>
                </Space>
            }
        >
            {!branchId ? (
                <div className='centre-report-empty'>
                    <Text type='warning'>Your profile has no assigned centre, so there is no report to build.</Text>
                </div>
            ) : generated ? (
                <div className='centre-report-done'>
                    <CheckCircleFilled style={{ fontSize: 40, color: token.colorSuccess }} />
                    <Title level={5} style={{ margin: '12px 0 4px' }}>{report.title} is ready</Title>
                    <Text type='secondary'>{generated.fileName}</Text>
                    <Button type='link' icon={<DownloadOutlined />} onClick={() => download(generated)} style={{ marginTop: 8 }}>
                        Download again
                    </Button>
                </div>
            ) : (
                <div className='centre-report-body'>
                    <Text strong className='centre-report-label'>Report</Text>
                    <div className='centre-report-cards' role='radiogroup' aria-label='Report'>
                        {REPORTS.map(item => {
                            const selected = item.id === reportId
                            return (
                                <button
                                    key={item.id}
                                    type='button'
                                    role='radio'
                                    aria-checked={selected}
                                    disabled={busy}
                                    className={`centre-report-card ${selected ? 'centre-report-card-selected' : ''}`}
                                    style={{
                                        borderColor: selected ? token.colorPrimary : token.colorBorderSecondary,
                                        background: selected ? token.colorPrimaryBg : token.colorBgContainer,
                                        borderRadius: token.borderRadiusLG
                                    }}
                                    onClick={() => setReportId(item.id)}
                                >
                                    <div className='centre-report-card-head'>
                                        <IconChip tone={item.tone} icon={item.icon} size={34} radius={10} />
                                        <div className='centre-report-card-titles'>
                                            <Text strong>{item.title}</Text>
                                            <Text type='secondary' className='centre-report-card-summary'>{item.summary}</Text>
                                        </div>
                                        <span
                                            className='centre-report-card-check'
                                            style={{ borderColor: selected ? token.colorPrimary : token.colorBorder, background: selected ? token.colorPrimary : 'transparent' }}
                                            aria-hidden
                                        />
                                    </div>
                                    <div className='centre-report-card-sections'>
                                        {item.sections.map(section => (
                                            <Tag key={section} bordered={false} className='centre-report-section'>{section}</Tag>
                                        ))}
                                    </div>
                                </button>
                            )
                        })}
                    </div>

                    <Text strong className='centre-report-label'>Month</Text>
                    <div className='centre-report-month'>
                        <DatePicker
                            picker='month'
                            allowClear={false}
                            value={month}
                            onChange={value => value && setMonth(value)}
                            disabledDate={date => date.isAfter(dayjs(), 'month')}
                            disabled={busy}
                            format='MMMM YYYY'
                            className='centre-report-month-picker'
                        />
                        <Space size={8} wrap>
                            {[{ label: 'This month', value: thisMonth }, { label: 'Last month', value: lastMonth }].map(option => (
                                <Button
                                    key={option.label}
                                    size='small'
                                    type={month.isSame(option.value, 'month') ? 'primary' : 'default'}
                                    ghost={month.isSame(option.value, 'month')}
                                    disabled={busy}
                                    onClick={() => setMonth(option.value)}
                                >
                                    {option.label}
                                </Button>
                            ))}
                        </Space>
                    </div>

                    {busy ? (
                        <div className='centre-report-note' style={{ background: token.colorFillTertiary, borderRadius: token.borderRadius }}>
                            <LoadingOutlined style={{ color: token.colorPrimary }} />
                            <Text>Building your {report.title} for {month.format('MMMM YYYY')} - this usually takes 10 to 20 seconds.</Text>
                        </div>
                    ) : error ? (
                        <div className='centre-report-note' style={{ background: token.colorErrorBg, borderRadius: token.borderRadius }}>
                            <Text type='danger'>{error}</Text>
                        </div>
                    ) : (
                        <div className='centre-report-note' style={{ background: token.colorFillTertiary, borderRadius: token.borderRadius }}>
                            <WhatsAppOutlined style={{ color: '#25D366' }} />
                            <Text type='secondary'>You can also ask for these on WhatsApp: say <Text strong>menu</Text> and choose <Text strong>Reports</Text>.</Text>
                        </div>
                    )}
                </div>
            )}
        </Modal>
    )
}

export default CentreReportModal
