import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Button, Space, Tag, Row, Col, Input, Segmented } from 'antd'
import {
    BarChartOutlined,
    DatabaseOutlined,
    CheckCircleTwoTone,
    ExclamationCircleTwoTone
} from '@ant-design/icons'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import dayjs from 'dayjs'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { isQuantilytixDomain } from '@/utils/quantilytixAccess'
import { chunk } from '@/types/types'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { QA, getQAArray, yes } from './sections'

export { lepharoDepartments } from './sections'


const isManualApplication = (a: any): boolean => {
    if (!a) return false
    return !!(
        a.manuallyCreated === true
    )
}


/** Firestore Timestamp / map / Date normalization */
const toJsDate = (v: any): Date | null => {
    if (!v) return null
    if (v instanceof Date) return v
    if (typeof v?.toDate === 'function') return v.toDate()
    if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000)
    if (typeof v === 'string') {
        const d = new Date(v)
        return isNaN(d.getTime()) ? null : d
    }
    return null
}

const formatDate = (v: any, fmt = 'YYYY-MM-DD') => {
    const d = toJsDate(v)
    return d ? dayjs(d).format(fmt) : '-'
}

/** ===== Component ===== */
const GAPAnalysisTable: React.FC = () => {
    const { user } = useFullIdentity() as any
    const { activeProgramId } = useActiveProgramId()
    const navigate = useNavigate()

    const [loading, setLoading] = useState(true)
    const [records, setRecords] = useState<any[]>([])

    const [searchText, setSearchText] = useState('')
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'confirmed'>('all')

    /** STATUS (works for gapAnalysis + manual complianceDocuments) */
    const getStatus = (r: any): 'Confirmed' | 'Pending' => {
        if (!r) return 'Pending'

        // Manual => status is stored on compliance doc (raw)
        if (r?.manuallyCreated) {
            const raw = r?.gapAgreement?.raw
            if (!raw) return 'Pending'
            if (raw?.status === 'confirmed') return 'Confirmed'
            if (raw?.romReview?.status === 'Confirmed') return 'Confirmed'
            if (raw?.romReview?.confirmedAt) return 'Confirmed'
            if (raw?.verifiedAt) return 'Confirmed'
            if (raw?.acceptedAt) return 'Confirmed' // if your upload already implies completion
            return 'Pending'
        }

        // Non-manual => gapAnalysis
        if (r?.confirmationStatus === 'Confirmed') return 'Confirmed'
        if (r?.romReview?.status === 'Confirmed') return 'Confirmed'
        if (r?.romReview?.confirmedAt) return 'Confirmed'
        return 'Pending'
    }

    // HYBRID fetch: manual apps → complianceDocs, normal apps → gapAnalysis
    useEffect(() => {
        const fetchRecords = async () => {
            if (!activeProgramId) {
                setRecords([])
                setLoading(false)
                return
            }

            setLoading(true)
            try {
                const appsSnap = await getDocs(
                    query(
                        collection(db, 'applications'),
                        where('applicationStatus', '==', 'accepted'),
                        where('programId', '==', activeProgramId)
                    )
                )

                const apps = appsSnap.docs
                    .map(d => {
                        const data = d.data() as any
                        const manual = isManualApplication(data)
                        return { id: d.id, ...data, isManual: manual }
                    })
                    .filter(a => !!a.participantId)

                if (!apps.length) {
                    setRecords([])
                    return
                }

                const manualApps = apps.filter(a => a.isManual)
                const normalApps = apps.filter(a => !a.isManual)

                const appByPid = new Map<
                    string,
                    {
                        appId: string
                        participantId: string
                        company: {
                            name: string
                            region?: string
                            email?: string
                            dateOfEngagement?: any
                        }
                        manuallyCreated?: boolean
                        applicationType?: string
                    }
                >()

                apps.forEach(a => {
                    const pid = String(a.participantId)
                    appByPid.set(pid, {
                        appId: a.id,
                        participantId: pid,
                        company: {
                            name: a.beneficiaryName || a.participantName || '',
                            region: a.region || a.province || '',
                            email: a.email || a.applicantEmail || '',
                            dateOfEngagement: a.dateOfEngagement || a.createdAt || a.submittedAt || null
                        },
                        manuallyCreated: a.isManual,
                        applicationType: (a as any).applicationType || ''
                    })
                })

                const collected: any[] = []

                // NORMAL GAPs
                const normalPids = normalApps.map(a => String(a.participantId))
                for (const ids of chunk(normalPids, 10)) {
                    if (!ids.length) continue
                    const gapSnap = await getDocs(
                        query(collection(db, 'gapAnalysis'), where('participantId', 'in', ids))
                    )

                    gapSnap.docs.forEach(docSnap => {
                        const g = docSnap.data() as any
                        const pid = String(g.participantId)
                        const appMeta = appByPid.get(pid)
                        if (!appMeta) return

                        collected.push({
                            id: docSnap.id,
                            ...g,
                            company: {
                                ...(g.company || {}),
                                name: appMeta.company.name,
                                region: appMeta.company.region,
                                email: appMeta.company.email
                            },
                            submittedAt: g.submittedAt || g.createdAt || g.updatedAt || null,
                            programId: activeProgramId,
                            manuallyCreated: false,
                            gapAgreement: g.gapAgreement || null
                        })

                    })
                }

                // MANUAL GAPs → applications/{appId}/complianceDocuments
                for (const a of manualApps) {
                    const pid = String(a.participantId)
                    const appMeta = appByPid.get(pid)
                    if (!appMeta) continue

                    const docsSnap = await getDocs(
                        query(
                            collection(db, 'applications', a.id, 'complianceDocuments'),
                            where('presetId', '==', 'gap_analysis')
                        )
                    )

                    let manualDoc: any | null = null
                    if (!docsSnap.empty) {
                        const d = docsSnap.docs[0]
                        manualDoc = { id: d.id, ...(d.data() as any) }
                    }

                    const gapAgreement = manualDoc
                        ? {
                            pdfUrl:
                                manualDoc.signedFileURL ||
                                manualDoc.pdfUrl ||
                                manualDoc.fileUrl ||
                                manualDoc.url ||
                                null,
                            signedFileURL: manualDoc.signedFileURL || null,
                            acceptedAt:
                                manualDoc.acceptedAt ||
                                manualDoc.verifiedAt ||
                                manualDoc.uploadedAt ||
                                manualDoc.createdAt ||
                                null,
                            raw: manualDoc
                        }
                        : null

                    collected.push({
                        id: manualDoc?.id || `manual_${appMeta.appId}`,
                        appId: a.id, // keep this (useful for future updates/backfills)
                        participantId: pid,
                        company: appMeta.company,
                        programId: activeProgramId,
                        manuallyCreated: true,
                        gapAgreement
                    })
                }

                setRecords(collected)
            } catch (e) {
                console.error('fetchRecords (hybrid GAP) failed', e)
                setRecords([])
            } finally {
                setLoading(false)
            }
        }

        fetchRecords()
    }, [activeProgramId])

    /**
     * Open the full-page detail view. Manual GAPs live under the application, so
     * their appId rides in the query string to keep the URL refreshable, while the
     * already-loaded record is handed over in router state to skip the round trip.
     */
    const openGap = (record: any) => {
        if (!record?.id) return
        const search = record?.manuallyCreated && record?.appId ? `?appId=${record.appId}` : ''
        navigate(`/operations/gap/${record.id}${search}`, {
            state: record?.manuallyCreated ? { gapRecord: record } : undefined
        })
    }

    const isQuantilytixViewer = isQuantilytixDomain(user?.email)

    const domainFilteredRecords = useMemo(
        () =>
            records.filter(r => {
                const email = String(r?.company?.email || '')
                return isQuantilytixDomain(email) ? isQuantilytixViewer : true
            }),
        [records, isQuantilytixViewer]
    )

    const overall = useMemo(() => {
        const base = domainFilteredRecords
        const total = base.length
        const confirmed = base.filter(r => getStatus(r) === 'Confirmed').length
        const pending = total - confirmed

        let yesCount = 0
        let noCount = 0
        for (const r of base) {
            const allQAs: QA[] = [
                ...getQAArray(r?.sections?.marketingCommunication),
                ...getQAArray(r?.sections?.psychometric),
                ...getQAArray(r?.sections?.financialManagement?.q),
                ...getQAArray(r?.sections?.labourHSE),
                ...getQAArray(r?.sections?.wellness?.q),
                ...getQAArray(r?.sections?.legal?.q),
                ...getQAArray(r?.sections?.marketLinkage),
                ...getQAArray(r?.sections?.qualityManagement),
                ...getQAArray(r?.sections?.trainingNeeds?.yn)
            ]
            for (const qa of allQAs) {
                if (!qa || qa.answer == null) continue
                if (yes(qa.answer)) yesCount++
                else noCount++
            }
        }
        const denom = yesCount + noCount
        const overallYesPct = denom ? Math.round((yesCount / denom) * 1000) / 10 : 0
        return { total, confirmed, pending, overallYesPct }
    }, [domainFilteredRecords])

    /** ✅ SORT: pending first, then company name A→Z */
    const tableData = useMemo(() => {
        let list = domainFilteredRecords

        if (statusFilter === 'pending') list = list.filter(r => getStatus(r) === 'Pending')
        if (statusFilter === 'confirmed') list = list.filter(r => getStatus(r) === 'Confirmed')

        const q = searchText.trim().toLowerCase()
        if (q) {
            list = list.filter(r => {
                const name = String(r?.company?.name || '')
                const email = String(r?.company?.email || '')
                const region = String(r?.company?.region || '')
                return `${name} ${email} ${region}`.toLowerCase().includes(q)
            })
        }

        return [...list].sort((a, b) => {
            const pa = getStatus(a) === 'Pending' ? 0 : 1
            const pb = getStatus(b) === 'Pending' ? 0 : 1
            if (pa !== pb) return pa - pb // pending on top

            const na = String(a?.company?.name || '').toLowerCase()
            const nb = String(b?.company?.name || '').toLowerCase()
            return na.localeCompare(nb) // alphabetical
        })
    }, [domainFilteredRecords, searchText, statusFilter])

    const columns = [
        {
            title: 'Company Name',
            dataIndex: ['company', 'name'],
            key: 'company',
            sorter: (a: any, b: any) =>
                String(a?.company?.name || '').localeCompare(String(b?.company?.name || ''))
        },
        { title: 'Region', dataIndex: ['company', 'region'], key: 'region' },
        { title: 'Email', dataIndex: ['company', 'email'], key: 'email' },
        {
            title: 'Date of Engagement',
            dataIndex: ['company', 'dateOfEngagement'],
            key: 'dateOfEngagement',
            render: (_: any, r: any) => {
                const ts = r?.manuallyCreated
                    ? (r?.company?.dateOfEngagement || r?.gapAgreement?.acceptedAt)
                    : (r?.submittedAt)

                return formatDate(ts, 'YYYY-MM-DD')
            }
        },
        {
            title: 'Status',
            key: 'status',
            render: (_: any, r: any) => {
                const st = getStatus(r)
                return <Tag color={st === 'Confirmed' ? 'green' : 'gold'}>{st}</Tag>
            }
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: any, record: any) => (
                <Space>
                    <Button
                        size='small'
                        type='link'
                        onClick={e => {
                            e.stopPropagation()
                            openGap(record)
                        }}
                    >
                        View
                    </Button>
                </Space>
            )
        }
    ]

    const DashboardCards = () => (
        <Row gutter={[16, 16]} style={{ marginBottom: 10 }}>
            <Col xs={24} sm={12} md={6}>
                <MotionCard.Metric
                    title="Total Assessments"
                    value={overall.total}
                    icon={<DatabaseOutlined style={{ fontSize: 18, color: '#1890ff' }} />}
                    iconBg="rgba(24,144,255,.12)"
                    subtitle="All assessments captured."
                />
            </Col>

            <Col xs={24} sm={12} md={6}>
                <MotionCard.Metric
                    title="Pending Reviews"
                    value={overall.pending}
                    icon={<ExclamationCircleTwoTone twoToneColor="#faad14" />}
                    iconBg="rgba(250,173,20,.12)"
                    subtitle="Awaiting confirmation."
                />
            </Col>

            <Col xs={24} sm={12} md={6}>
                <MotionCard.Metric
                    title="Confirmed Reviews"
                    value={overall.confirmed}
                    icon={<CheckCircleTwoTone twoToneColor="#52c41a" />}
                    iconBg="rgba(82,196,26,.12)"
                    subtitle="Reviews already confirmed."
                />
            </Col>

            <Col xs={24} sm={12} md={6}>
                <MotionCard.Metric
                    title="Overall Yes Rate"
                    value={`${Number(overall.overallYesPct || 0).toFixed(1)}%`}
                    icon={<BarChartOutlined style={{ fontSize: 18, color: '#1890ff' }} />}
                    iconBg="rgba(24,144,255,.12)"
                    subtitle="Average positive response rate."
                />
            </Col>
        </Row>
    )

    return (
        <div style={{ padding: '2px 24px', }}>
            {loading ? (
                <LoadingOverlay tip='Loading Gap Analysis Documents' />
            ) : (
                <>

                    <DashboardCards />

                    <MotionCard
                        filterBar={<Row gutter={[16, 16]} align='middle' justify='space-between'>
                            <Col xs={24} md={12}>
                                <Input.Search
                                    allowClear
                                    placeholder='Search by company or email'
                                    value={searchText}
                                    onChange={e => setSearchText(e.target.value)}
                                    onSearch={val => setSearchText(val)}
                                />
                            </Col>
                            <Col xs={24} md={12} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <Segmented
                                    value={statusFilter}
                                    onChange={v => setStatusFilter(v as any)}
                                    options={[
                                        { label: `All (${overall.total})`, value: 'all' },
                                        { label: `Pending (${overall.pending})`, value: 'pending' },
                                        { label: `Confirmed (${overall.confirmed})`, value: 'confirmed' }
                                    ]}
                                />
                            </Col>
                        </Row>
                        }>
                        <Table
                            columns={columns as any}
                            dataSource={tableData}
                            rowKey='id'
                            pagination={{ pageSize: 5, position: ['bottomCenter'], showSizeChanger: false }}
                            onRow={record => ({
                                onClick: () => openGap(record),
                                style: { cursor: 'pointer' }
                            })}
                        />
                    </MotionCard>
                </>
            )
            }
        </div >
    )
}

export default GAPAnalysisTable
