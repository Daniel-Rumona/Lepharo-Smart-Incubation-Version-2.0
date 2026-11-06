import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Empty, Input, Pagination, Segmented } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import dayjs from 'dayjs'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { isQuantilytixDomain } from '@/utils/quantilytixAccess'
import { chunk } from '@/types/types'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar } from '@/components/workspace'
import { StatusPill } from '@/routes/operations/movs/movParts'
import '@/routes/operations/movs/movs.css'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { pickLatestGap } from '@/services/gapSuggestionsService'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { getGapStatus } from './sections'


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
    const [statusFilter, setStatusFilter] = useState<'pending' | 'confirmed' | 'missing' | 'all'>('pending')
    const [page, setPage] = useState(1)

    /** Manual GAPs with nothing uploaded have no record to open yet. */
    const hasRecord = (r: any) => !r?.manuallyCreated || !!r?.gapAgreement?.raw
    const getStatus = (r: any): 'Confirmed' | 'Pending' | 'Missing' =>
        hasRecord(r) ? getGapStatus(r) : 'Missing'

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

                // NORMAL GAPs — one row per participant: this programme's latest GAP.
                const normalPids = normalApps.map(a => String(a.participantId))
                const gapsByPid = new Map<string, any[]>()
                for (const ids of chunk(normalPids, 10)) {
                    if (!ids.length) continue
                    const gapSnap = await getDocs(
                        query(collection(db, 'gapAnalysis'), where('participantId', 'in', ids))
                    )
                    gapSnap.docs.forEach(docSnap => {
                        const g = { id: docSnap.id, ...(docSnap.data() as any) }
                        const pid = String(g.participantId)
                        gapsByPid.set(pid, [...(gapsByPid.get(pid) || []), g])
                    })
                }

                gapsByPid.forEach((gaps, pid) => {
                        const g = pickLatestGap(gaps, activeProgramId)
                        const appMeta = appByPid.get(pid)
                        if (!g || !appMeta) return

                        collected.push({
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

    const counts = useMemo(() => {
        const base = domainFilteredRecords
        return {
            pending: base.filter(r => getStatus(r) === 'Pending').length,
            confirmed: base.filter(r => getStatus(r) === 'Confirmed').length,
            missing: base.filter(r => getStatus(r) === 'Missing').length,
            all: base.length
        }
    }, [domainFilteredRecords])

    // "Not uploaded" only shows when there is something in it.
    const segments = [
        { value: 'pending', label: 'To confirm', tone: 'warning' },
        { value: 'confirmed', label: 'Confirmed', tone: 'success' },
        { value: 'missing', label: 'Not uploaded', tone: 'danger' },
        { value: 'all', label: 'All', tone: 'neutral' }
    ].filter(segment => segment.value !== 'missing' || counts.missing > 0 || statusFilter === 'missing')

    const rows = useMemo(() => {
        let list = domainFilteredRecords
        if (statusFilter === 'pending') list = list.filter(r => getStatus(r) === 'Pending')
        if (statusFilter === 'confirmed') list = list.filter(r => getStatus(r) === 'Confirmed')
        if (statusFilter === 'missing') list = list.filter(r => getStatus(r) === 'Missing')

        const q = searchText.trim().toLowerCase()
        if (q) {
            list = list.filter(r =>
                `${r?.company?.name || ''} ${r?.company?.email || ''} ${r?.company?.region || ''}`
                    .toLowerCase()
                    .includes(q)
            )
        }

        return [...list].sort((x, y) =>
            String(x?.company?.name || '').localeCompare(String(y?.company?.name || ''))
        )
    }, [domainFilteredRecords, searchText, statusFilter])

    useEffect(() => setPage(1), [searchText, statusFilter])

    const PAGE_SIZE = 12
    const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    const PILL: Record<string, { tone: string; label: string }> = {
        Pending: { tone: 'warning', label: 'To confirm' },
        Confirmed: { tone: 'success', label: 'Confirmed' },
        Missing: { tone: 'danger', label: 'Not uploaded' }
    }

    return (
        <div className='ws-page'>
            <Helmet>
                <title>GAP Analysis | Smart Incubation</title>
            </Helmet>
            {loading ? (
                <PageSkeleton variant='list' />
            ) : (
                <>
                    <DashboardFilterBar>
                        <div className='ws-toolbar'>
                            <Segmented
                                className='ws-toolbar-status mv-status-strip'
                                block
                                value={statusFilter}
                                onChange={value => setStatusFilter(value as typeof statusFilter)}
                                aria-label='Filter by status'
                                options={segments.map(segment => ({
                                    value: segment.value,
                                    label: (
                                        <span className='mv-seg'>
                                            {segment.label}
                                            <span className={`mv-seg-count qtx-tone-${segment.tone}`}>
                                                {counts[segment.value as keyof typeof counts]}
                                            </span>
                                        </span>
                                    )
                                }))}
                            />
                            <Input
                                className='ws-toolbar-search'
                                allowClear
                                prefix={<SearchOutlined />}
                                placeholder='Search company, email or region'
                                aria-label='Search GAP Analyses'
                                value={searchText}
                                onChange={e => setSearchText(e.target.value)}
                            />
                        </div>
                    </DashboardFilterBar>

                    <MotionCard>
                        {rows.length === 0 ? (
                            <Empty
                                className='ws-list-empty'
                                description={
                                    statusFilter === 'pending' && !searchText
                                        ? 'Nothing waiting for confirmation.'
                                        : 'No GAP Analyses match.'
                                }
                            />
                        ) : (
                            <>
                                <div className='ws-rows' role='list' aria-label='GAP Analyses'>
                                    {pageRows.map(r => {
                                        const status = getStatus(r)
                                        const name = r?.company?.name || 'Unnamed SME'
                                        const date = r?.manuallyCreated ? r?.gapAgreement?.acceptedAt : r?.submittedAt
                                        const meta = [
                                            r?.company?.region,
                                            date ? `Submitted ${formatDate(date, 'D MMM YYYY')}` : null,
                                            r?.manuallyCreated ? 'Uploaded document' : null
                                        ].filter(Boolean).join(' · ')
                                        const canOpen = status !== 'Missing'
                                        return (
                                            <button
                                                key={r.id}
                                                type='button'
                                                role='listitem'
                                                className='ws-row'
                                                disabled={!canOpen}
                                                title={canOpen ? undefined : 'No GAP Analysis has been uploaded for this SME yet.'}
                                                onClick={() => canOpen && openGap(r)}
                                            >
                                                <EntityAvatar name={name} size={36} />
                                                <div className='ws-row-main'>
                                                    <div className='ws-row-name'>{name}</div>
                                                    <div className='ws-row-meta'>{meta || r?.company?.email || '—'}</div>
                                                </div>
                                                <div className='ws-row-side'>
                                                    <StatusPill tone={PILL[status].tone}>{PILL[status].label}</StatusPill>
                                                </div>
                                            </button>
                                        )
                                    })}
                                </div>
                                {rows.length > PAGE_SIZE && (
                                    <div className='ws-pagination'>
                                        <Pagination
                                            size='small'
                                            current={page}
                                            pageSize={PAGE_SIZE}
                                            total={rows.length}
                                            onChange={setPage}
                                            showSizeChanger={false}
                                            showLessItems
                                        />
                                    </div>
                                )}
                            </>
                        )}
                    </MotionCard>
                </>
            )}
        </div>
    )
}

export default GAPAnalysisTable
