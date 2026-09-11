// src/pages/director/BeneficiariesOverview.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { Card, Row, Col, Statistic, Segmented, message } from 'antd'
import { Helmet } from 'react-helmet'
import {
    TeamOutlined,
    PieChartOutlined,
    RiseOutlined,
    FundOutlined,
    BuildOutlined
} from '@ant-design/icons'
import {
    collection,
    getDocs,
    query,
    where,
    DocumentData
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from '@/firebase'
import { DashboardHeaderCard } from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import PortfolioCompanies from '@/components/dashboards/director/charts/PortfolioCompanies'
import SectorAnalysis from '@/components/dashboards/director/charts/SectorAnalysis'
import DepartmentalView from '@/components/dashboards/director/charts/DepartmentalView'

type SegKey = 'departments' | 'companies' | 'sectors'

export default function BeneficiariesOverview() {
    const [seg, setSeg] = useState<SegKey>('departments')
    const [loading, setLoading] = useState(false)

    const [participants, setParticipants] = useState<DocumentData[]>([])



    // Load accepted participants (beneficiaries)
    useEffect(() => {

        let cancelled = false
            ; (async () => {
                setLoading(true)
                try {
                    const appsSnap = await getDocs(
                        query(
                            collection(db, 'applications'),

                            where('applicationStatus', 'in', ['accepted', 'Accepted'])
                        )
                    )
                    if (!cancelled) {
                        setParticipants(appsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
                    }
                } catch (e) {
                    console.error(e)
                    message.error('Failed to load beneficiaries.')
                } finally {
                    if (!cancelled) setLoading(false)
                }
            })()
        return () => {
            cancelled = true
        }
    }, [])

    // ---- Derive sector metrics from accepted participants ----
    const sectorCounts = useMemo(() => {
        const map = new Map<string, number>()
        participants.forEach(p => {
            const raw =
                (p as any).sector ||
                (p as any).industry ||
                (p as any).businessSector ||
                'Unknown'
            const sector = String(raw).trim() || 'Unknown'
            map.set(sector, (map.get(sector) || 0) + 1)
        })
        return map
    }, [participants])

    const totalSectors = useMemo(
        () => Array.from(sectorCounts.keys()).filter(s => s !== 'Unknown').length,
        [sectorCounts]
    )

    const bestSector = useMemo(() => {
        let top = '—'
        let max = 0
        sectorCounts.forEach((count, name) => {
            if (name === 'Unknown') return
            if (count > max) {
                max = count
                top = name
            }
        })
        return top
    }, [sectorCounts])

    const strategicFocus = useMemo(() => {
        const arr = Array.from(sectorCounts.entries())
            .filter(([n]) => n !== 'Unknown')
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([n]) => n)
        return arr.length ? arr.join(' & ') : '—'
    }, [sectorCounts])

    return (
        <div style={{ minHeight: '100vh', padding: 24 }}>
            <Helmet>
                <title>Analytics & Overview</title>
            </Helmet>

            <DashboardHeaderCard
                title='Analytics & Overview'
                subtitle="Get a bird's eye view on your company's operations"
                extraRight={
                    <Segmented<SegKey>
                        value={seg}
                        onChange={v => setSeg(v as SegKey)}
                        options={[
                            {
                                label: 'Departments',
                                value: 'departments',
                                icon: <BuildOutlined />
                            },
                            {
                                label: 'Beneficiaries',
                                value: 'companies',
                                icon: <TeamOutlined />
                            },
                            {
                                label: 'Sector Analysis',
                                value: 'sectors',
                                icon: <PieChartOutlined />
                            }
                        ]}
                    />
                }
            />

            {loading && <LoadingOverlay />}

            {!loading && (
                <>
                    {seg === 'departments' && <DepartmentalView />}

                    {seg === 'companies' && <PortfolioCompanies />}

                    {seg === 'sectors' && (
                        <>
                            <SectorAnalysis />
                        </>
                    )}
                </>
            )}
        </div>
    )
}
