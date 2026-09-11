import React, { useEffect, useMemo, useState } from 'react'
import { Card, Col, Row, Statistic, Spin } from 'antd'
import {
    FileTextOutlined,
    CheckCircleOutlined,
    ExclamationCircleOutlined,
    CloseCircleOutlined
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs from 'dayjs'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import {
    complianceDocumentKey as keyForDoc,
    complianceRequirementKey as keyForReq,
    normalizeComplianceId
} from '@/services/complianceResolver'

/* ---------------- utils shared with the donut ---------------- */
type Counts = {
    total: number
    valid: number
    pending: number
    invalid: number
    queried: number
    expired: number
    missing: number
}

/* ---------------- hook: fetch + compute counts ---------------- */
async function fetchRequiredDocs(
    departmentId: string,
    programId?: string,
) {
    // Prefer a specific department override in programRequirements
    const q = programId
        ? query(
            collection(db, 'programRequirements'),
            where('programId', '==', programId),
            where('departmentId', '==', departmentId),
            limit(1)
        )
        : query(
            collection(db, 'programRequirements'),
            where('departmentId', '==', departmentId),
            limit(1)
        )

    const snap = await getDocs(q)
    if (!snap.empty) {
        const row = snap.docs[0].data() as any
        return (row.requiredDocuments || []) as any[]
    }

    // Fallback: pull defaults off the program doc if we have programId
    if (programId) {
        const pDoc = await getDoc(doc(db, 'programs', programId))
        if (pDoc.exists())
            return ((pDoc.data() as any).requiredDocuments || []) as any[]
    }

    return [] as any[]
}

async function fetchDocsForProgram(programId?: string) {
    // app list (we only need ids to read subcollections)
    const appQ = programId
        ? query(collection(db, 'applications'), where('programId', '==', programId))
        : collection(db, 'applications')
    const appsSnap = await getDocs(appQ)

    // pull all uploads + agreements for each app
    const all: any[] = []
    for (const a of appsSnap.docs) {
        const appId = a.id

        const uploadsSnap = await getDocs(
            collection(db, 'applications', appId, 'complianceDocuments')
        )
        uploadsSnap.forEach(s => {
            const v = s.data() as any
            all.push({
                kind: 'upload',
                slug: normalizeComplianceId(v.presetId || v.type || v.documentName),
                status: (v.status || 'pending').toLowerCase(),
                issueDate: v.issueDate || '',
                expiryDate: v.expiryDate || '',
                programId: a.data().programId
            })
        })

        const agSnap = await getDocs(
            collection(db, 'applications', appId, 'agreements')
        )
        agSnap.forEach(s => {
            const v = s.data() as any
            all.push({
                kind: 'agreement',
                slug: normalizeComplianceId(s.id),
                status: 'valid',
                issueDate: v.acceptedAt?.seconds
                    ? new Date(v.acceptedAt.seconds * 1000).toISOString().slice(0, 10)
                    : '',
                expiryDate: '',
                programId: a.data().programId
            })
        })
    }
    return all
}

function deriveStatus(doc: any, req?: any) {
    const base = (doc.status || 'pending').toLowerCase()
    if (!req?.hasExpiry) return base
    const months = req.expiryMonths ?? 0
    if (!months) return base
    const issue = doc.issueDate ? dayjs(doc.issueDate) : null
    const exp = issue ? issue.add(months, 'month') : null
    if (exp && exp.isBefore(dayjs(), 'day')) return 'expired'
    return base
}

export function useDeptDocStatusCounts(
    departmentId: string,
    opts?: { programId?: string }
) {
    const { programId } = opts || {}
    const [loading, setLoading] = useState(true)
    const [counts, setCounts] = useState<Counts>({
        total: 0,
        valid: 0,
        pending: 0,
        invalid: 0,
        queried: 0,
        expired: 0,
        missing: 0
    })

    useEffect(() => {
        let cancelled = false
        const run = async () => {
            setLoading(true)
            try {
                const req = await fetchRequiredDocs(
                    departmentId,
                    programId
                )
                const docs = await fetchDocsForProgram(programId)

                // build requirement keys (department scope)
                const reqKeys = new Set(req.map(item => keyForReq(item)))

                // only count docs that satisfy a department requirement
                const relevant = docs.filter(d => reqKeys.has(keyForDoc(d)))

                // bucket
                let valid = 0,
                    pending = 0,
                    invalid = 0,
                    queried = 0,
                    expired = 0
                relevant.forEach(d => {
                    const r = req.find((x: any) => keyForReq(x) === keyForDoc(d))
                    const s = deriveStatus(d, r)
                    if (s === 'valid') valid++
                    else if (s === 'pending') pending++
                    else if (s === 'invalid') invalid++
                    else if (s === 'queried') queried++
                    else if (s === 'expired') expired++
                })

                // "total" = present docs that match requirements (not counting missing)
                const total = relevant.length

                // missing across participants = (required-per-app * #apps) - present
                // NOTE: we can approximate #apps as unique application ids we walked
                // For simplicity here we don’t recompute missing; leave it 0 for this row.
                const missing = 0

                if (!cancelled) {
                    setCounts({
                        total,
                        valid,
                        pending,
                        invalid,
                        queried,
                        expired,
                        missing
                    })
                }
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        run()
        return () => {
            cancelled = true
        }
    }, [departmentId, programId])

    return { loading, counts }
}

/* ---------------- UI: the metrics row ---------------- */
type RowProps = {
    departmentId: string
    programId?: string
    /** If true, add expired into Invalidated; default false */
    includeExpiredInInvalidated?: boolean
}

export const ComplianceMetricsRow: React.FC<RowProps> = ({
    departmentId,
    programId,
    includeExpiredInInvalidated = false
}) => {
    const { loading, counts } = useDeptDocStatusCounts(departmentId, {
        programId
    })

    const invalidated = useMemo(
        () =>
            counts.invalid +
            counts.queried +
            (includeExpiredInInvalidated ? counts.expired : 0),
        [counts, includeExpiredInInvalidated]
    )

    const metrics = [
        {
            title: 'Total Documents',
            value: counts.total,
            icon: <FileTextOutlined />
        },
        { title: 'Validated', value: counts.valid, icon: <CheckCircleOutlined /> },
        {
            title: 'Pending',
            value: counts.pending,
            icon: <ExclamationCircleOutlined />
        },
        { title: 'Invalidated', value: invalidated, icon: <CloseCircleOutlined /> }
    ]

    return (
        <Spin spinning={loading}>
            <Row gutter={16}>
                {metrics.map((m, i) => (
                    <Col span={6} key={m.title}>
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4, delay: i * 0.03 }}
                        >
                            <Card
                                style={{
                                    border: '1px solid #bae7ff',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                                    borderRadius: 12
                                }}
                            >
                                <Statistic
                                    title={m.title}
                                    value={m.value}
                                    prefix={
                                        <span
                                            style={{
                                                background: '#bae7ff',
                                                padding: 8,
                                                borderRadius: '50%',
                                                marginRight: 8,
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                justifyContent: 'center'
                                            }}
                                        >
                                            {m.icon}
                                        </span>
                                    }
                                />
                            </Card>
                        </motion.div>
                    </Col>
                ))}
            </Row>
        </Spin>
    )
}
