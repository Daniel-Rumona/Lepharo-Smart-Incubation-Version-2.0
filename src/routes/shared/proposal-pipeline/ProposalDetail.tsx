import { useEffect, useState } from 'react'
import {
    Avatar, Button, Empty, List, Popconfirm, Segmented, Space, Spin, Tag, Timeline,
    Tooltip, Typography, message
} from 'antd'
import {
    ArrowRightOutlined, ClockCircleOutlined, DeleteOutlined, DownloadOutlined, EditOutlined,
    FileTextOutlined, GlobalOutlined, HistoryOutlined, InfoCircleOutlined, SafetyCertificateOutlined,
    TeamOutlined, UserOutlined
} from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import {
    deleteProposalDocument, listProposalDocuments, listProposalHistory, uploadProposalDocument
} from '@/services/proposalService'
import type { Proposal, ProposalActor, ProposalDocument, ProposalHistoryEntry } from '@/types/proposal'
import {
    ADVANCE_TO, DeadlineCell, DeadlineHint, DocumentCategoryRows, activationStep, advanceLabel,
    dateLabel, dayLabel, money, ownerIcon, statusColor
} from './proposalUi'

const { Text } = Typography

type DetailTab = 'overview' | 'documents' | 'history'

const millis = (value: any) =>
    value?.toMillis?.() || value?.toDate?.()?.getTime?.() || (value ? new Date(value).getTime() : 0)

/**
 * The right panel: one proposal's header and actions, then its overview,
 * documents and history. Documents and history reload whenever the proposal
 * changes, so an upload or a status move shows up without a manual refresh.
 */
export function ProposalDetail({
    proposal,
    actor,
    onEdit,
    onStatus,
    onActivation
}: {
    proposal: Proposal
    actor: ProposalActor
    onEdit: () => void
    onStatus: () => void
    onActivation: () => void
}) {
    const [tab, setTab] = useState<DetailTab>('overview')
    const [documents, setDocuments] = useState<ProposalDocument[]>([])
    const [history, setHistory] = useState<ProposalHistoryEntry[]>([])
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState(false)
    const reduceMotion = useReducedMotion()
    const updatedAt = millis(proposal.updatedAt)

    useEffect(() => setTab('overview'), [proposal.id])

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        Promise.all([listProposalDocuments(proposal), listProposalHistory(proposal.id)])
            .then(([documentRecords, historyRecords]) => {
                if (cancelled) return
                setDocuments(documentRecords)
                setHistory(historyRecords)
            })
            .catch(error => {
                console.error('[ProposalPipeline] Detail load failed', error)
                if (!cancelled) message.error('Some proposal details could not be loaded.')
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [proposal.id, updatedAt])

    const upload = async (file: File, category: string) => {
        setBusy(true)
        try {
            await uploadProposalDocument(proposal, file, category, actor)
            message.success(`${file.name} uploaded`)
        } catch (error: any) {
            message.error(error?.message || 'Document upload failed.')
        } finally {
            setBusy(false)
        }
    }

    const remove = async (document: ProposalDocument) => {
        setBusy(true)
        try {
            await deleteProposalDocument(proposal, document, actor)
            message.success('Document removed')
        } catch (error: any) {
            message.error(error?.message || 'Document could not be removed.')
        } finally {
            setBusy(false)
        }
    }

    const enter = (delay = 0) => reduceMotion
        ? {}
        : {
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.26, ease: 'easeOut' as const, delay }
        }

    const canActivate = activationStep(proposal.status) > 0
    const advanceTarget = ADVANCE_TO[proposal.status]

    return (
        <div className='ws-detail'>
            <MotionCard>
                <motion.header key={`head-${proposal.id}`} className='ws-detail-head' {...enter()}>
                    <span className='proposal-detail-icon'><FileTextOutlined /></span>
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{proposal.title}</h2>
                        <div className='ws-detail-sub'>
                            {proposal.proposalNumber} · {proposal.clientName} · {money(proposal.estimatedValue)}
                        </div>
                        <div className='ws-detail-tags'>
                            <Tag color={statusColor[proposal.status]}>{proposal.status}</Tag>
                            <Tag>{proposal.category}</Tag>
                            <Tag icon={<GlobalOutlined />}>
                                {proposal.scope}{proposal.province ? ` · ${proposal.province}` : ''}
                            </Tag>
                            <DeadlineHint proposal={proposal} />
                        </div>
                    </div>
                    <Space wrap className='proposal-detail-actions'>
                        <Button icon={<EditOutlined />} onClick={onEdit}>Edit</Button>
                        {canActivate && <Tooltip title='Activation progress'>
                            <Button icon={<SafetyCertificateOutlined />} onClick={onActivation}
                                aria-label='Activation progress' />
                        </Tooltip>}
                        <Tooltip title={advanceTarget ? `Move to ${advanceTarget}` : 'No further stage. You can still archive it.'}>
                            <Button type={advanceTarget ? 'primary' : 'default'} onClick={onStatus}
                                icon={advanceTarget ? <ArrowRightOutlined /> : <ClockCircleOutlined />}
                                iconPosition='end'>
                                {advanceLabel(proposal.status)}
                            </Button>
                        </Tooltip>
                    </Space>
                </motion.header>

                <div className='ws-detail-tabs'>
                    <Segmented block value={tab} onChange={value => setTab(value as DetailTab)}
                        options={[
                            { value: 'overview', label: 'Overview', icon: <InfoCircleOutlined /> },
                            {
                                value: 'documents',
                                label: `Documents${documents.length ? ` (${documents.length})` : ''}`,
                                icon: <FileTextOutlined />
                            },
                            { value: 'history', label: 'History', icon: <HistoryOutlined /> }
                        ]} />
                    <div className='ws-detail-pane'>
                        <Spin spinning={loading || busy}>
                            <motion.div key={`${proposal.id}-${tab}`} {...enter(0.06)}>
                                {tab === 'overview' && <OverviewTab proposal={proposal} />}
                                {tab === 'documents' && <div className='ws-detail-body'>
                                    <DocumentCategoryRows
                                        documents={documents}
                                        onAdd={(category, file) => { upload(file, category) }}
                                        renderDocumentActions={document => <>
                                            <Button size='small' icon={<DownloadOutlined />}
                                                onClick={() => window.open(document.url, '_blank')}>Open</Button>
                                            {document.id !== 'legacy-proposal-document' &&
                                                <Popconfirm title='Remove this document?' onConfirm={() => remove(document)}>
                                                    <Button size='small' danger icon={<DeleteOutlined />}
                                                        aria-label={`Remove ${document.name}`} />
                                                </Popconfirm>}
                                        </>} />
                                </div>}
                                {tab === 'history' && <div className='ws-detail-body'>
                                    {history.length
                                        ? <Timeline items={history.map(entry => ({
                                            color: entry.action === 'status_changed' ? 'blue' : 'green',
                                            children: <div><Text strong>{entry.note || entry.action}</Text>
                                                <div><Text type='secondary'>
                                                    {entry.createdBy?.name || 'System'} · {dateLabel(entry.createdAt)}
                                                </Text></div></div>
                                        }))} />
                                        : <Empty description='No history entries yet' />}
                                </div>}
                            </motion.div>
                        </Spin>
                    </div>
                </div>
            </MotionCard>
        </div>
    )
}

/** One labelled fact; empty values read "Not recorded" in the muted colour. */
const Fact = ({ label, children }: { label: string; children?: React.ReactNode }) => (
    <div>
        <dt>{label}</dt>
        <dd>{children || <span className='ws-muted'>Not recorded</span>}</dd>
    </div>
)

function OverviewTab({ proposal }: { proposal: Proposal }) {
    return (
        <div className='ws-detail-body'>
            {proposal.description && <section>
                <h3 className='ws-section-title'>Summary</h3>
                <p className='ws-prose'>{proposal.description}</p>
            </section>}

            <section>
                <h3 className='ws-section-title'>Client</h3>
                <dl className='ws-facts'>
                    <Fact label='Client'>{proposal.clientName}</Fact>
                    <Fact label='Contact'>{proposal.clientContact}</Fact>
                    <Fact label='Email'>
                        {proposal.clientEmail &&
                            <a href={`mailto:${proposal.clientEmail}`}>{proposal.clientEmail}</a>}
                    </Fact>
                    <Fact label='Estimated value'>{money(proposal.estimatedValue)}</Fact>
                </dl>
            </section>

            <section>
                <h3 className='ws-section-title'>Ownership and timeline</h3>
                <dl className='ws-facts'>
                    <Fact label='Owner'>
                        <span className='proposal-fact-owner'>
                            <span>{ownerIcon(proposal.owner.type)} {proposal.owner.name}</span>
                            <small>{proposal.owner.type || 'Individual'}</small>
                        </span>
                    </Fact>
                    <Fact label='Originated by'>{proposal.originator.name}</Fact>
                    <Fact label='Proposal date'>{dayLabel(proposal.proposedDate)}</Fact>
                    <Fact label='Submission deadline'><DeadlineCell proposal={proposal} /></Fact>
                    <Fact label='Last updated'>{dateLabel(proposal.updatedAt)}</Fact>
                </dl>
            </section>

            {/* "All" selections collapse to one tag rather than listing every record. */}
            <section>
                <h3 className='ws-section-title'>Delivery footprint</h3>
                <Space wrap>{proposal.allCentres
                    ? <Tag icon={<GlobalOutlined />} color='blue'>
                        {proposal.province ? `All centres in ${proposal.province}` : 'All centres'} ({proposal.centres.length})
                    </Tag>
                    : proposal.centres.length
                        ? proposal.centres.map(item =>
                            <Tag icon={<GlobalOutlined />} color='blue' key={item.id}>{item.name}</Tag>)
                        : <Text type='secondary'>No centres assigned</Text>}</Space>
            </section>

            <section>
                <h3 className='ws-section-title'>Participating departments</h3>
                <Space wrap>{proposal.allDepartments
                    ? <Tag icon={<TeamOutlined />} color='purple'>All departments ({proposal.departments.length})</Tag>
                    : proposal.departments.length
                        ? proposal.departments.map(item =>
                            <Tag icon={<TeamOutlined />} color='purple' key={item.id}>{item.name}</Tag>)
                        : <Text type='secondary'>No departments selected</Text>}</Space>
            </section>

            {/* Originator and owner are shown above; this lists only added contributors. */}
            <section>
                <h3 className='ws-section-title'>Contributors</h3>
                <List size='small' dataSource={proposal.contributors}
                    locale={{ emptyText: 'No contributors added' }}
                    renderItem={person => <List.Item><List.Item.Meta
                        avatar={<Avatar icon={<UserOutlined />} />} title={person.name}
                        description={person.email || undefined} /></List.Item>} />
            </section>
        </div>
    )
}
