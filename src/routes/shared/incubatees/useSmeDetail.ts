import { useEffect, useMemo, useState } from 'react'
import { message } from 'antd'
import { collection, getDocs, query, where, doc, getDoc, orderBy } from 'firebase/firestore'
import { db } from '@/firebase'
import { useDepartmentRoles } from '@/services/departmentRoles'
import dayjs, { Dayjs } from 'dayjs'
import { ComplianceDoc, ComplianceStats, DeptGap, FINANCE_API_BASE_URL, Intervention, JobContract, MonthlyFinancePoint, Participant, SmePerformanceDetail, SmeRow, buildUploadedByMonth, canonicalComplianceId, directDocumentUrl, documentStoragePath, mergePrefUploaded, normalizeHeadcountMap, normalizeRevenueMap, standardComplianceName } from './participantsData'

export type SmeSection = 'demographics' | 'performance' | 'interventions' | 'compliance'

/**
 * Everything shown in the detail workspace for the selected SME: performance history,
 * finance revenue and job contracts for the reporting range, interventions with their
 * department gaps, and compliance documents with their stats.
 */
export const useSmeDetail = (selectedRow: SmeRow | null, reportingRange: [Dayjs, Dayjs]) => {
    const { nameOf } = useDepartmentRoles()
    const [perfDetail, setPerfDetail] = useState<SmePerformanceDetail | null>(null)
    const [financeRevenue, setFinanceRevenue] = useState<MonthlyFinancePoint[]>([])
    const [jobContracts, setJobContracts] = useState<JobContract[]>([])
    const [performanceTrendLoading, setPerformanceTrendLoading] = useState(false)
    const [interventions, setInterventions] = useState<Intervention[]>([])
    const [interventionsLoading, setInterventionsLoading] = useState(false)
    const [diagnosticConfirmed, setDiagnosticConfirmed] = useState<boolean | null>(null)
    const [complianceStats, setComplianceStats] = useState<ComplianceStats | null>(null)
    const [complianceDocuments, setComplianceDocuments] = useState<ComplianceDoc[]>([])
    const [complianceLoading, setComplianceLoading] = useState(false)
    const [selectedApplicationData, setSelectedApplicationData] = useState<any>(null)
    const [selectedParticipantData, setSelectedParticipantData] = useState<any>(null)

    useEffect(() => {
        const run = async () => {
            if (!selectedRow?.participantId) {
                setPerfDetail(null)
                return
            }
            try {
                const pDoc = await getDoc(doc(db, 'participants', selectedRow.participantId))
                if (!pDoc.exists()) {
                    setPerfDetail(null)
                    return
                }
                const participant = pDoc.data() as Participant

                const histSnap = await getDocs(
                    query(collection(db, `monthlyPerformance/${selectedRow.participantId}/history`), orderBy('createdAt', 'desc'))
                )
                const perfHistory = histSnap.docs.map(h => h.data() as any)

                const uploaded = buildUploadedByMonth(perfHistory)
                const pRevArr = normalizeRevenueMap(participant.revenueHistory?.monthly)
                const pHC = normalizeHeadcountMap(participant.headcountHistory?.monthly)

                setPerfDetail({
                    mergedRevenue: mergePrefUploaded(uploaded.revenue, pRevArr),
                    mergedPerm: mergePrefUploaded(uploaded.perm, pHC.perm),
                    mergedTemp: mergePrefUploaded(uploaded.temp, pHC.temp),
                    mergedTraffic: uploaded.traffic,
                    mergedNetworking: uploaded.networking
                })
            } catch (err) {
                console.error(err)
            }
        }
        run()
    }, [selectedRow?.participantId])

    useEffect(() => {
        let cancelled = false

        const run = async () => {
            if (!selectedRow) {
                setFinanceRevenue([])
                setJobContracts([])
                return
            }

            setPerformanceTrendLoading(true)
            const financeMonths = Math.max(1, dayjs().endOf('month').diff(reportingRange[0], 'month') + 1)
            const revenueRequest = selectedRow.email
                ? fetch(`${FINANCE_API_BASE_URL}/api/stats/public/revenue-monthly?${new URLSearchParams({
                    email: selectedRow.email,
                    months: String(financeMonths)
                })}`).then(async response => {
                    if (!response.ok) throw new Error(`Finance API returned ${response.status}`)
                    const payload = await response.json()
                    const rows = Array.isArray(payload?.months) ? payload.months : Array.isArray(payload) ? payload : []
                    return rows.map((row: any) => ({
                        month: String(row.month || ''),
                        monthLabel: row.monthLabel || row.month_label || row.month || '',
                        revenue: Number(row.revenue || 0)
                    })) as MonthlyFinancePoint[]
                })
                : Promise.resolve([] as MonthlyFinancePoint[])

            const jobsRequest = getDocs(
                query(collection(db, 'hseJobContracts'), where('applicationId', '==', selectedRow.appId))
            ).then(snapshot => snapshot.docs.map(item => ({ id: item.id, ...(item.data() as any) })) as JobContract[])

            const [revenueResult, jobsResult] = await Promise.allSettled([revenueRequest, jobsRequest])
            if (cancelled) return

            setFinanceRevenue(revenueResult.status === 'fulfilled' ? revenueResult.value : [])
            setJobContracts(jobsResult.status === 'fulfilled' ? jobsResult.value : [])

            setPerformanceTrendLoading(false)
        }

        run()
        return () => { cancelled = true }
    }, [reportingRange, selectedRow?.appId, selectedRow?.email])

    useEffect(() => {
        const run = async () => {
            if (!selectedRow?.participantId) {
                setInterventions([])
                setDiagnosticConfirmed(null)
                setInterventionsLoading(false)
                return
            }
            setInterventionsLoading(true)
            try {
                const [dpSnap, snap] = await Promise.all([
                    getDoc(doc(db, 'diagnosticPlans', selectedRow.participantId)).catch(error => {
                        console.warn('Diagnostic plan status was unavailable; assignments will still be shown.', error)
                        return null
                    }),
                    getDocs(query(
                        collection(db, 'assignedInterventions'),
                        where('participantId', '==', selectedRow.participantId)
                    ))
                ])

                setDiagnosticConfirmed(!!dpSnap?.exists() && dpSnap.data()?.finalConfirmation === true)
                const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Intervention[]
                setInterventions(list)
            } catch (err) {
                console.error(err)
                message.error('Failed to load interventions.')
            } finally {
                setInterventionsLoading(false)
            }
        }
        run()
    }, [selectedRow?.participantId])

    useEffect(() => {
        const run = async () => {
            if (!selectedRow?.appId) {
                setComplianceStats(null)
                setComplianceDocuments([])
                setSelectedApplicationData(null)
                setSelectedParticipantData(null)
                return
            }
            setComplianceLoading(true)
            setSelectedApplicationData(null)
            setSelectedParticipantData(null)
            try {
                const [appSnap, participantSnap, upSnap, agSnap] = await Promise.all([
                    getDoc(doc(db, 'applications', selectedRow.appId)),
                    getDoc(doc(db, 'participants', selectedRow.participantId || '__missing__')),
                    getDocs(collection(db, 'applications', selectedRow.appId, 'complianceDocuments')),
                    getDocs(collection(db, 'applications', selectedRow.appId, 'agreements'))
                ])

                const byKey = new Map<string, ComplianceDoc>()
                const addDocument = (document: ComplianceDoc) => {
                    const key = canonicalComplianceId(document.title || document.id)
                    const existing = byKey.get(key)
                    if (!existing) {
                        byKey.set(key, document)
                        return
                    }
                    byKey.set(key, {
                        ...existing,
                        ...document,
                        kind: existing.kind === 'agreement' || document.kind === 'agreement'
                            ? 'agreement'
                            : 'upload',
                        status: existing.status === 'valid' || document.status === 'valid'
                            ? 'valid'
                            : document.status || existing.status,
                        url: document.url || existing.url,
                        storagePath: document.storagePath || existing.storagePath,
                        title: document.title || existing.title,
                        signed: document.signed || existing.signed,
                        acceptedAt: document.acceptedAt || existing.acceptedAt,
                        meta: document.meta || existing.meta
                    })
                }

                upSnap.forEach(s => {
                    const v = s.data() as any
                    addDocument({
                        id: s.id,
                        status: String(v.status || 'pending').toLowerCase(),
                        kind: 'upload',
                        title: v.title || v.documentName || v.name || v.type || s.id,
                        url: directDocumentUrl(v),
                        storagePath: documentStoragePath(v),
                        expiryDate: v.expiryDate,
                        meta: v
                    })
                })

                agSnap.forEach(s => {
                    const v = s.data() as any
                    const signed = v.signed === true || v.smmeSigned === true ||
                        v.participantSigned === true || !!v.participantSignatureURL || !!v.acceptedAt
                    addDocument({
                        id: s.id,
                        status: signed ? 'valid' : 'pending',
                        kind: 'agreement',
                        title: v.title || v.type || s.id,
                        url: directDocumentUrl(v),
                        storagePath: documentStoragePath(v),
                        signed,
                        acceptedAt: v.acceptedAt || v.signedAt,
                        meta: v
                    })
                })

                const application = appSnap.exists() ? appSnap.data() as any : {}
                const participant = participantSnap.exists() ? participantSnap.data() as any : {}
                setSelectedApplicationData(application)
                setSelectedParticipantData(participant)
                    ;[
                        ...(Array.isArray(application.complianceDocuments) ? application.complianceDocuments : []),
                        ...(Array.isArray(participant.complianceDocuments) ? participant.complianceDocuments : [])
                    ]
                        .forEach((v: any, index: number) => addDocument({
                            id: v.key || v.id || v.type || `upload-${index}`,
                            status: String(v.status || 'pending').toLowerCase(),
                            kind: 'upload',
                            title: v.title || v.documentName || v.name || v.type || `Document ${index + 1}`,
                            url: directDocumentUrl(v),
                            storagePath: documentStoragePath(v),
                            expiryDate: v.expiryDate,
                            meta: v
                        }))
                const signedAgreements = {
                    ...(participant.signedAgreements || {}),
                    ...(application.signedAgreements || {})
                }
                Object.entries(signedAgreements).forEach(([id, raw]: [string, any]) => {
                    const signed = raw === true || raw?.signed === true ||
                        raw?.participantSigned === true || !!raw?.participantSignatureURL ||
                        !!raw?.userSignatureURL || !!raw?.signer || !!raw?.acceptedAt
                    addDocument({
                        id,
                        status: signed ? 'valid' : 'pending',
                        kind: 'agreement',
                        title: raw?.title || raw?.type || id,
                        url: directDocumentUrl(raw),
                        storagePath: documentStoragePath(raw),
                        signed,
                        acceptedAt: raw?.acceptedAt || raw?.signedAt,
                        meta: raw
                    })
                })
                    ;[
                        ...(Array.isArray(application.unsignedAgreements) ? application.unsignedAgreements : []),
                        ...(Array.isArray(participant.unsignedAgreements) ? participant.unsignedAgreements : [])
                    ].forEach((raw: any, index: number) => addDocument({
                        id: raw.key || raw.id || raw.type || `agreement-${index}`,
                        status: 'pending',
                        kind: 'agreement',
                        title: raw.title || raw.type || raw.key || `Agreement ${index + 1}`,
                        url: directDocumentUrl(raw),
                        storagePath: documentStoragePath(raw),
                        signed: false,
                        meta: raw
                    }))

                const docs = Array.from(byKey.values()).sort((a, b) =>
                    a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title)
                ).map(document => ({
                    ...document,
                    status: document.signed ? 'valid' : document.status,
                    title: standardComplianceName(document.id, document.title)
                }))
                setComplianceDocuments(docs)

                let valid = 0
                let expired = 0
                let pending = 0
                let invalid = 0
                let queried = 0

                docs.forEach(d => {
                    const s = d.status
                    if (s === 'valid') valid++
                    else if (s === 'expired') expired++
                    else if (s === 'pending') pending++
                    else if (s === 'invalid') invalid++
                    else if (s === 'queried') queried++
                })

                setComplianceStats({
                    total: docs.length,
                    valid,
                    expired,
                    pending,
                    invalid,
                    queried
                })
            } catch (err) {
                console.error(err)
                setComplianceDocuments([])
                message.error('Failed to load compliance data.')
            } finally {
                setComplianceLoading(false)
            }
        }
        run()
    }, [selectedRow?.appId])

    const deptGaps: DeptGap[] = useMemo(() => {
        const map = new Map<string, DeptGap>()

        interventions.forEach(i => {
            const key = i.departmentId || 'other'
            const label = nameOf(i.departmentId, i.departmentName || 'Other')

            if (!map.has(key)) {
                map.set(key, { key, label, needed: 0, completed: 0, inProgress: 0, missing: 0 })
            }

            const entry = map.get(key)!
            entry.needed += 1

            const s = String(i.status || '').toLowerCase()
            if (s === 'completed') entry.completed += 1
            else if (s === 'in-progress' || s === 'ongoing') entry.inProgress += 1
            else entry.missing += 1
        })

        return Array.from(map.values())
    }, [interventions, nameOf])

    /** Shows the open section's skeleton straight away while it reloads for a newly selected SME. */
    const markSectionLoading = (section: SmeSection) => {
        if (section === 'performance') setPerformanceTrendLoading(true)
        if (section === 'interventions') setInterventionsLoading(true)
        if (section === 'compliance') setComplianceLoading(true)
    }

    return {
        perfDetail,
        financeRevenue,
        jobContracts,
        performanceTrendLoading,
        interventions,
        interventionsLoading,
        diagnosticConfirmed,
        deptGaps,
        complianceStats,
        complianceDocuments,
        complianceLoading,
        selectedApplicationData,
        selectedParticipantData,
        markSectionLoading
    }
}
