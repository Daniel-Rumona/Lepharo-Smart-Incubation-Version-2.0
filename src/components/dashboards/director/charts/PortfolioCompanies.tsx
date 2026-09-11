// src/components/dashboards/director/charts/PortfolioCompanies.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
    Card,
    Col,
    Row,
    Select,
    Typography,
    Space,
    Divider,
    message,
    Empty,
    Spin
} from 'antd'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import more from 'highcharts/highcharts-more'
import accessibility from 'highcharts/modules/accessibility'
import treemap from 'highcharts/modules/treemap'
import treegraph from 'highcharts/modules/treegraph'
import {
    collection,
    getDocs,
    query,
    where,
    documentId
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from '@/firebase'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'

if (typeof more === 'function') more(Highcharts)
if (typeof accessibility === 'function') accessibility(Highcharts)
if (typeof treemap === 'function') treemap(Highcharts)
if (typeof treegraph === 'function') treegraph(Highcharts)

const { Text } = Typography

type AppDoc = {
    id: string
    beneficiaryName?: string
    businessName?: string
    applicantName?: string
    participantName?: string
    programId?: string
    gapGroup?: 'A' | 'B' | 'C'
    applicationStatus?: string
    ageGroup?: string
    participantId?: string
}

type ProgramDoc = {
    id: string
    assignedBranch?: { id?: string; name?: string } | null
    name?: string
}

type ParticipantDoc = {
    id: string
    sector?: string
    gender?: string
    beeLevel?: string
    beneficiaryName?: string
    businessName?: string
    participantName?: string
    applicantName?: string
}

const nameOfApp = (a: Partial<AppDoc>) =>
    a.beneficiaryName ||
    a.businessName ||
    a.participantName ||
    a.applicantName ||
    'Incubatee'

// utils
const countBy = (arr: string[]) => {
    const m = new Map<string, number>()
    for (const v of arr) {
        const key = (v || 'Unspecified').toString().trim() || 'Unspecified'
        m.set(key, (m.get(key) || 0) + 1)
    }
    return m
}

const batchIds = <T extends string>(ids: T[], size = 10): T[][] => {
    const out: T[][] = []
    for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
    return out
}

const topNWithOther = (m: Map<string, number>, topN = 8) => {
    const entries = Array.from(m.entries()).sort((a, b) => b[1] - a[1])
    if (entries.length <= topN) return entries
    const top = entries.slice(0, topN)
    const restSum = entries.slice(topN).reduce((s, [, v]) => s + v, 0)
    return [...top, ['Other', restSum] as const]
}

const buildDonut = (
    title: string,
    entries: Array<[string, number]>
): Highcharts.Options => ({
    chart: { type: 'pie', height: 360 },
    title: { text: title },
    plotOptions: {
        pie: {
            innerSize: '60%',
            dataLabels: {
                enabled: true,
                formatter: function () {
                    // @ts-ignore
                    const name = this.point.name
                    // @ts-ignore
                    const y = this.y || 0
                    return `${name}: ${Highcharts.numberFormat(y, 0)}`
                }
            }
        }
    },
    tooltip: {
        pointFormatter: function () {
            // @ts-ignore
            return `<span style="color:${this.color}">\u25CF</span> ${this.name
                }: <b>${Highcharts.numberFormat(this.y || 0, 0)}</b><br/>`
        }
    },
    credits: { enabled: false },
    series: [
        {
            name: 'Count',
            type: 'pie',
            colorByPoint: true,
            data: entries.map(([name, y]) => ({ name, y }))
        } as Highcharts.SeriesPieOptions
    ]
})

const PortfolioCompanies: React.FC = () => {
    // loading gate
    const [isLoading, setIsLoading] = useState(true)

    // datasets
    const [apps, setApps] = useState<AppDoc[]>([])
    const [programs, setPrograms] = useState<ProgramDoc[]>([])
    const [participants, setParticipants] = useState<ParticipantDoc[]>([])

    // ui
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('')

    // resolve + fetch all in a single chain to avoid partial renders
    useEffect(() => {
        ; (async () => {
            try {
                setIsLoading(true)

                const email = getAuth().currentUser?.email
                if (!email) {
                    setIsLoading(false)
                    return
                }



                // apps + programs
                const [appsSnap, progSnap] = await Promise.all([
                    getDocs(
                        query(
                            collection(db, 'applications'),
                            where('applicationStatus', 'in', ['accepted', 'Accepted'])
                        )
                    ),
                    getDocs(
                        query(collection(db, 'programs'))
                    )
                ])

                const appsList: AppDoc[] = appsSnap.docs.map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                }))
                const programsList: ProgramDoc[] = progSnap.docs.map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                }))

                setApps(appsList)
                setPrograms(programsList)

                if (appsList.length && !selectedCompanyId)
                    setSelectedCompanyId(appsList[0].id)

                // participants (from accepted apps)
                const pids = Array.from(
                    new Set(
                        appsList.map(a => a.participantId).filter(Boolean) as string[]
                    )
                )
                if (pids.length) {
                    const chunks = batchIds(pids, 10)
                    const results: ParticipantDoc[] = []
                    for (const c of chunks) {
                        const snap = await getDocs(
                            query(
                                collection(db, 'participants'),
                                where(documentId(), 'in', c)
                            )
                        )
                        results.push(
                            ...snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
                        )
                    }
                    setParticipants(results)
                } else {
                    setParticipants([])
                }
            } catch (e) {
                console.error(e)
                message.error('Failed to load data.')
            } finally {
                setIsLoading(false)
            }
        })()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const selectedApp = useMemo(
        () => apps.find(a => a.id === selectedCompanyId),
        [apps, selectedCompanyId]
    )

    // programId -> branchName map
    const programBranchName = useMemo(() => {
        const m = new Map<string, string>()
        for (const p of programs) {
            const name = p.assignedBranch?.name?.trim()
            if (name) m.set(p.id, name)
        }
        return m
    }, [programs])

    // hierarchy data
    type Node = {
        id: string
        parent?: string
        name?: string
        custom?: {
            type?: 'root' | 'branch' | 'group' | 'count'
            count?: number
        }
    }

    const treeNodes = useMemo(() => {
        const nodes: Node[] = [
            {
                id: 'incubator',
                name: 'Incubator',
                custom: {
                    type: 'root'
                }
            }
        ]

        const byBranch = new Map<string, AppDoc[]>()

        apps.forEach(app => {
            const programId = String(
                app.programId || ''
            )

            const branchName =
                programBranchName.get(programId) ||
                'Unspecified Branch'

            const current =
                byBranch.get(branchName) ||
                []

            current.push(app)

            byBranch.set(
                branchName,
                current
            )
        })

        byBranch.forEach(
            (
                branchApps,
                branchName
            ) => {
                const branchId =
                    `branch:${branchName}`

                nodes.push({
                    id: branchId,
                    parent: 'incubator',
                    name: branchName,
                    custom: {
                        type: 'branch',
                        count: branchApps.length
                    }
                })

                const byGroup =
                    new Map<
                        string,
                        AppDoc[]
                    >()

                branchApps.forEach(
                    app => {
                        const rawGroup =
                            String(
                                app.gapGroup ||
                                'B'
                            )
                                .trim()
                                .toUpperCase()

                        const group =
                            [
                                'A',
                                'B',
                                'C'
                            ].includes(
                                rawGroup
                            )
                                ? rawGroup
                                : 'B'

                        const current =
                            byGroup.get(
                                group
                            ) ||
                            []

                        current.push(
                            app
                        )

                        byGroup.set(
                            group,
                            current
                        )
                    }
                )

                    ;[
                        'A',
                        'B',
                        'C'
                    ].forEach(
                        group => {
                            const companies =
                                byGroup.get(
                                    group
                                ) ||
                                []

                            const groupId =
                                `${branchId}:group:${group}`

                            nodes.push({
                                id: groupId,
                                parent: branchId,
                                name: `Group ${group}`,
                                custom: {
                                    type: 'group',
                                    count: companies.length
                                }
                            })

                            const countId =
                                `${groupId}:count`

                            nodes.push({
                                id: countId,
                                parent: groupId,
                                name: `${companies.length} ${companies.length === 1
                                    ? 'SME'
                                    : 'SMEs'
                                    }`,
                                custom: {
                                    type: 'count',
                                    count: companies.length
                                }
                            })
                        }
                    )
            }
        )

        return nodes
    }, [
        apps,
        programBranchName
    ])

    const branchCount =
        useMemo(
            () =>
                new Set(
                    apps.map(app => {
                        const programId =
                            String(
                                app.programId ||
                                ''
                            )

                        return (
                            programBranchName.get(
                                programId
                            ) ||
                            'Unspecified Branch'
                        )
                    })
                ).size,
            [
                apps,
                programBranchName
            ]
        )

    /*
     * Height is now based on the number of branches,
     * rather than the number of individual SMEs.
     */
    const dynamicHeight =
        Math.max(
            380,
            branchCount * 170
        )

    const treeOptions:
        Highcharts.Options = {
        chart: {
            height:
                dynamicHeight,

            spacingBottom:
                30,

            marginRight:
                150,

            spacing: [
                10,
                20,
                10,
                10
            ],

            zooming: {
                type: 'xy'
            }
        },

        title: {
            text:
                'Participants Breakdown'
        },

        subtitle: {
            text:
                'Incubator → Branches → Groups → SME Count'
        },

        legend: {
            enabled:
                false
        },

        plotOptions: {
            series: {
                animation: {
                    duration:
                        250
                }
            }
        },

        series: [
            {
                type:
                    'treegraph',

                data:
                    treeNodes as any,

                clip:
                    false,

                nodeWidth:
                    10,

                nodePadding:
                    18,

                hangingIndent:
                    18,

                levels: [
                    {
                        level:
                            1,

                        levelIsConstant:
                            false,

                        dataLabels: {
                            style: {
                                fontSize:
                                    '14px',

                                fontWeight:
                                    '600'
                            },

                            align:
                                'left',

                            x:
                                22
                        },

                        marker: {
                            radius:
                                8,

                            lineWidth:
                                3
                        }
                    },

                    {
                        level:
                            2,

                        colorByPoint:
                            true,

                        dataLabels: {
                            style: {
                                fontSize:
                                    '13px',

                                fontWeight:
                                    '500'
                            },

                            align:
                                'left',

                            x:
                                22
                        },

                        marker: {
                            radius:
                                7,

                            lineWidth:
                                3
                        }
                    },

                    {
                        level:
                            3,

                        colorVariation: {
                            key:
                                'brightness',

                            to:
                                -0.4
                        },

                        dataLabels: {
                            style: {
                                fontSize:
                                    '12px',

                                fontWeight:
                                    '500'
                            },

                            align:
                                'left',

                            x:
                                20
                        },

                        marker: {
                            radius:
                                6,

                            lineWidth:
                                3
                        }
                    },

                    {
                        level:
                            4,

                        colorVariation: {
                            key:
                                'brightness',

                            to:
                                0.4
                        },

                        dataLabels: {
                            align:
                                'left',

                            x:
                                14,

                            style: {
                                fontSize:
                                    '12px',

                                fontWeight:
                                    '600'
                            }
                        },

                        marker: {
                            radius:
                                5,

                            lineWidth:
                                2
                        }
                    }
                ],

                marker: {
                    symbol:
                        'circle',

                    radius:
                        6,

                    fillColor:
                        '#ffffff',

                    lineColor:
                        '#1890ff',

                    lineWidth:
                        2
                },

                dataLabels: {
                    enabled:
                        true,

                    align:
                        'left',

                    pointFormat:
                        '{point.name}',

                    style: {
                        color:
                            'var(--highcharts-neutral-color-100,#000)',

                        textOutline:
                            '3px contrast',

                        whiteSpace:
                            'nowrap'
                    },

                    x:
                        22,

                    crop:
                        false,

                    overflow:
                        'none',

                    padding:
                        0
                },

                link: {
                    color:
                        'rgba(0,0,0,0.18)',

                    lineWidth:
                        1.2
                },

                states: {
                    hover: {
                        enabled:
                            true
                    }
                }
            } as Highcharts.SeriesTreegraphOptions
        ],

        tooltip: {
            useHTML:
                true,

            formatter:
                function () {
                    const point =
                        this.point as Highcharts.Point & {
                            name?: string
                            custom?: {
                                type?: string
                                count?: number
                            }
                        }

                    if (
                        point.custom?.type ===
                        'branch'
                    ) {
                        return `
                        <div style="min-width:160px">
                            <b>${point.name}</b>
                            <br/>
                            ${point.custom.count || 0} SMEs
                        </div>
                    `
                    }

                    if (
                        point.custom?.type ===
                        'group'
                    ) {
                        const count =
                            point.custom.count ||
                            0

                        return `
                        <div style="min-width:160px">
                            <b>${point.name}</b>
                            <br/>
                            ${count} ${count === 1
                                ? 'SME'
                                : 'SMEs'
                            }
                        </div>
                    `
                    }

                    return `
                    <div style="min-width:140px">
                        <b>${point.name || point.id}</b>
                    </div>
                `
                }
        },

        credits: {
            enabled:
                false
        },

        exporting: {
            enabled:
                false
        }
    }

    // distributions
    const sectorCounts = useMemo(
        () => countBy(participants.map(p => p.sector || 'Unspecified')),
        [participants]
    )
    const genderCounts = useMemo(
        () => countBy(participants.map(p => p.gender || 'Unspecified')),
        [participants]
    )
    const beeCounts = useMemo(
        () => countBy(participants.map(p => p.beeLevel || 'Unspecified')),
        [participants]
    )
    const ageCounts = useMemo(
        () => countBy(apps.map(a => a.ageGroup || 'Unspecified')),
        [apps]
    )

    const sectorEntries = useMemo(
        () => topNWithOther(sectorCounts, 8),
        [sectorCounts]
    )
    const genderEntries = useMemo(
        () => Array.from(genderCounts.entries()),
        [genderCounts]
    )
    const beeEntries = useMemo(() => Array.from(beeCounts.entries()), [beeCounts])
    const ageEntries = useMemo(() => Array.from(ageCounts.entries()), [ageCounts])

    const sectorOptions = useMemo(
        () => buildDonut('Sector Distribution (Beneficiaries)', sectorEntries),
        [sectorEntries]
    )
    const genderOptions = useMemo(
        () => buildDonut('Gender Distribution', genderEntries),
        [genderEntries]
    )
    const beeOptions = useMemo(
        () => buildDonut('B-BBEE Level Distribution', beeEntries),
        [beeEntries]
    )
    const ageOptions = useMemo(
        () => buildDonut('Age Group Distribution', ageEntries),
        [ageEntries]
    )

    // render gates
    if (isLoading) {
        return (
            <div style={{ display: 'grid', placeItems: 'center', minHeight: 320 }}>
                <LoadingOverlay tip='Loading beneficiaries & distributions...' />
            </div>
        )
    }

    const noDistData =
        (!participants.length && !apps.length) ||
        (sectorCounts.size === 0 &&
            genderCounts.size === 0 &&
            beeCounts.size === 0 &&
            ageCounts.size === 0)

    return (
        <div>
            <Card
                title={'Beneficiaries Breakdown'}
                style={{
                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                    transition: 'all 0.3s ease',
                    borderRadius: 12,
                    border: '1px solid #d6e4ff'
                }}
            >
                {noDistData ? (
                    <Empty description='No beneficiary distribution data yet.' />
                ) : (
                    <>
                        {/* Row 1: Sector full width */}
                        <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
                            <Col xs={24}>
                                <HighchartsReact
                                    highcharts={Highcharts}
                                    options={sectorOptions}
                                />
                            </Col>
                        </Row>

                        {/* Row 2: Gender, B-BBEE, Age */}
                        <Row gutter={[16, 16]}>
                            <Col xs={24} md={8}>
                                <HighchartsReact
                                    highcharts={Highcharts}
                                    options={genderOptions}
                                />
                            </Col>
                            <Col xs={24} md={8}>
                                <HighchartsReact highcharts={Highcharts} options={beeOptions} />
                            </Col>
                            <Col xs={24} md={8}>
                                <HighchartsReact highcharts={Highcharts} options={ageOptions} />
                            </Col>
                        </Row>
                    </>
                )}
            </Card>

            <Card
                style={{
                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                    transition: 'all 0.3s ease',
                    borderRadius: 8,
                    marginTop: 15,
                    border: '1px solid #d6e4ff'
                }}
            >
                <Col xs={24}>
                    <Space direction='vertical' style={{ width: '100%' }}>
                        <Divider style={{ margin: '0 0 8px 0' }}>Hierarchy</Divider>
                        <div style={{ width: '100%', overflowX: 'auto' }}>
                            <HighchartsReact highcharts={Highcharts} options={treeOptions} />
                        </div>
                    </Space>
                </Col>
            </Card>
        </div>
    )
}

export default PortfolioCompanies
