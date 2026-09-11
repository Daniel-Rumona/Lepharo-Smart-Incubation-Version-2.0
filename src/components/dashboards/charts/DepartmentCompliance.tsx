// components/charts/DepartmentComplianceDonut.tsx
import React, { useEffect, useMemo, useState } from 'react'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { Card, Empty, Spin } from 'antd'
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

type Props = {
    programId: string
    departmentId: string
    title?: string
    height?: number
    debug?: boolean
}

type RequiredDoc = {
    id?: string
    title: string
    type?: 'upload' | 'agreement'
    agreementId?: string
    hasExpiry?: boolean
    expiryMonths?: number | null
    presetId?: string
}

type UploadDoc = {
    kind: 'upload'
    slug?: string
    presetId?: string
    documentName?: string
    status?: string
    issueDate?: any
    expiryDate?: any
    departmentId?: string
}

type AgreementDoc = {
    kind: 'agreement'
    slug?: string
    status?: string
    acceptedAt?: any
}

const normalize = (s?: string) => (s || '').toString().trim().toLowerCase()

const reqKey = (r: RequiredDoc) =>
    `${r.type ?? 'upload'}:${normalize(
        r.agreementId || r.presetId || r.id || r.title
    )}`

const candidateKeysForDoc = (d: UploadDoc | AgreementDoc) => {
    const kind = d.kind ?? 'upload'
    const names = new Set<string>()
    // most specific → least specific
    if ((d as any).slug) names.add(`${kind}:${normalize((d as any).slug)}`)
    if ((d as any).presetId)
        names.add(`${kind}:${normalize((d as any).presetId)}`)
    if ((d as any).documentName)
        names.add(`${kind}:${normalize((d as any).documentName)}`)
    return Array.from(names)
}

const asDay = (v: any) => {
    if (!v) return null
    if (v?.seconds) return dayjs(new Date(v.seconds * 1000))
    if (typeof v === 'string' || v instanceof Date) return dayjs(v as any)
    if (v?.toDate) return dayjs(v.toDate())
    return null
}

export default function DepartmentComplianceDonut({
    programId,
    departmentId,
    debug = false
}: Props) {
    const [required, setRequired] = useState<RequiredDoc[]>([])
    const [appsDocs, setAppsDocs] = useState<Array<(UploadDoc | AgreementDoc)[]>>(
        []
    )
    const [loading, setLoading] = useState(true)

    // Load requirements (dept override → program defaults)
    useEffect(() => {
        const run = async () => {
            if (!programId || !departmentId) return
            setLoading(true)
            try {
                const reqSnap = await getDocs(
                    query(
                        collection(db, 'programRequirements'),
                        where('programId', '==', programId),
                        where('departmentId', '==', departmentId),
                        limit(1)
                    )
                )

                if (!reqSnap.empty) {
                    const row = reqSnap.docs[0].data() as any
                    const list = (row.requiredDocuments || []).map((r: any) => ({
                        id: r.id,
                        title: r.title,
                        type: r.type ?? 'upload',
                        agreementId: r.agreementId,
                        hasExpiry: !!r.hasExpiry,
                        expiryMonths: r.hasExpiry
                            ? typeof r.expiryMonths === 'number'
                                ? r.expiryMonths
                                : null
                            : null,
                        presetId: r.presetId || r.id
                    })) as RequiredDoc[]
                    setRequired(list)
                } else {
                    const progDoc = await getDoc(doc(db, 'programs', programId))
                    const defaults =
                        (progDoc.exists()
                            ? (progDoc.data() as any).requiredDocuments
                            : []) || []
                    const list = defaults.map((r: any) => ({
                        id: r.id,
                        title: r.title,
                        type: 'upload',
                        hasExpiry: !!r.hasExpiry,
                        expiryMonths: r.hasExpiry
                            ? typeof r.expiryMonths === 'number'
                                ? r.expiryMonths
                                : null
                            : null,
                        presetId: r.id
                    })) as RequiredDoc[]
                    setRequired(list)
                    if (debug) console.log('[Donut] Program defaults:', list)
                }
            } finally {
                setLoading(false)
            }
        }
        run()
    }, [programId, departmentId, debug])

    // Load ALL apps for this program, and hydrate subcollections
    useEffect(() => {
        const run = async () => {
            if (!programId) return
            setLoading(true)
            try {
                const appsSnap = await getDocs(
                    query(
                        collection(db, 'applications'),
                        where('programId', '==', programId)
                    )
                )

                const all: Array<(UploadDoc | AgreementDoc)[]> = []
                for (const a of appsSnap.docs) {
                    const appId = a.id

                    const upSnap = await getDocs(
                        collection(db, 'applications', appId, 'complianceDocuments')
                    )
                    const uploads: UploadDoc[] = upSnap.docs.map(s => {
                        const v = s.data() as any
                        return {
                            kind: 'upload',
                            slug: normalize(
                                v.presetId || v.preset || v.type || v.documentName
                            ),
                            presetId: v.presetId || v.preset,
                            documentName: v.type || v.documentName,
                            status: (v.status || 'pending').toLowerCase(),
                            issueDate: v.issueDate || v.createdAt,
                            expiryDate: v.expiryDate,
                            departmentId: v.departmentId // may be undefined in older data
                        }
                    })

                    const agSnap = await getDocs(
                        collection(db, 'applications', appId, 'agreements')
                    )
                    const agreements: AgreementDoc[] = agSnap.docs.map(s => ({
                        kind: 'agreement',
                        slug: normalize(s.id),
                        status: 'valid',
                        acceptedAt: (s.data() as any).acceptedAt
                    }))

                    all.push([...uploads, ...agreements])
                }

                setAppsDocs(all)
                if (debug) console.log('[Donut] Apps loaded:', all.length)
            } finally {
                setLoading(false)
            }
        }
        run()
    }, [programId, debug])

    const reqKeys = useMemo(() => new Set(required.map(reqKey)), [required])

    const reqByKey = useMemo(() => {
        const m = new Map<string, RequiredDoc>()
        required.forEach(r => m.set(reqKey(r), r))
        return m
    }, [required])

    const computePolicyExpiry = (doc: UploadDoc, req?: RequiredDoc) => {
        if (!req?.hasExpiry || !req.expiryMonths) return null
        const issue = asDay(doc.issueDate)
        return issue ? issue.add(req.expiryMonths, 'month') : null
    }

    const counts = useMemo(() => {
        const c = {
            Missing: 0,
            Pending: 0,
            Valid: 0,
            Approved: 0,
            Expired: 0,
            Rejected: 0
        }
        if (reqKeys.size === 0 || appsDocs.length === 0) return c

        const now = dayjs()

        appsDocs.forEach(docs => {
            // map required key -> matched doc (first match wins)
            const present = new Map<string, UploadDoc | AgreementDoc>()

            docs.forEach(d => {
                // include uploads for this dept; tolerate legacy docs without departmentId
                if (d.kind === 'upload') {
                    const ud = d as UploadDoc
                    if (ud.departmentId && ud.departmentId !== departmentId) return
                }
                // try all candidate keys against requirement keys
                for (const k of candidateKeysForDoc(d)) {
                    if (reqKeys.has(k) && !present.has(k)) {
                        present.set(k, d)
                        break
                    }
                }
            })

            // walk every requirement and bucket
            reqKeys.forEach(k => {
                const d = present.get(k)
                if (!d) {
                    c.Missing++
                    return
                }

                const req = reqByKey.get(k)
                const base = String((d as any).status || 'pending').toLowerCase()

                // expiry: explicit or policy
                let expired = false
                const explicit = asDay((d as UploadDoc).expiryDate)
                if (explicit) expired = explicit.isBefore(now, 'day')
                else {
                    const calc = computePolicyExpiry(d as UploadDoc, req)
                    if (calc) expired = calc.isBefore(now, 'day')
                }

                if (expired || base === 'expired') c.Expired++
                else if (base === 'approved') c.Approved++
                else if (base === 'valid') c.Valid++
                else if (base === 'rejected' || base === 'invalid') c.Rejected++
                else c.Pending++
            })
        })

        return c
    }, [appsDocs, reqKeys, reqByKey, departmentId])

    if (debug) {
        console.log('[Donut] reqKeys:', Array.from(reqKeys))
        console.log('[Donut] counts:', counts)
    }

    const total =
        counts.Missing +
        counts.Pending +
        counts.Valid +
        counts.Approved +
        counts.Expired +
        counts.Rejected

    const options: Highcharts.Options = {
        chart: { type: 'pie', height: '400px' },
        title: { text: 'Compliance Breakdown' },
        credits: { enabled: false },
        exporting: { enabled: false },
        tooltip: { pointFormat: '<b>{point.y}</b>' },
        plotOptions: {
            pie: {
                innerSize: '65%',
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        // @ts-ignore
                        return this.y && this.y > 0 ? `${this.point.name}: ${this.y}` : null
                    },
                    style: { color: '#000', textOutline: 'none' },
                    distance: 12
                }
            }
        },
        colors: ['#ff4d4f', '#faad14', '#52c41a', '#1677ff', '#fa8c16', '#d4380d'],
        series: [
            {
                type: 'pie',
                name: 'Documents',
                data: [
                    { name: 'Missing', y: counts.Missing },
                    { name: 'Pending', y: counts.Pending },
                    { name: 'Valid', y: counts.Valid },
                    { name: 'Approved', y: counts.Approved },
                    { name: 'Expired', y: counts.Expired },
                    { name: 'Rejected', y: counts.Rejected }
                ]
            }
        ]
    }

    const noData =
        !required.length || // no required docs configured
        !appsDocs.length || // no applications/compliance docs
        total === 0

    return (
        <Spin spinning={loading} tip='Loading Data…'>
            <div
                style={{
                    minHeight: 260,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
            >
                {noData ? (
                    <Empty description='No compliance data yet.' />
                ) : (
                    <HighchartsReact highcharts={Highcharts} options={options} />
                )}
            </div>
        </Spin>
    )
}
