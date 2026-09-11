// OrganogramModal.tsx

import React, { useMemo, useRef, useState } from 'react'
import { Modal, Button, Space, Empty, Dropdown, message } from 'antd'
import {
    DownloadOutlined,
    FilePdfOutlined,
    FileWordOutlined,
    FileImageOutlined,
    StarFilled
} from '@ant-design/icons'

type OrgPerson = {
    id: string
    name: string
    email?: string
    role?: string
    isNational?: boolean
}

type OrgTier = {
    label: string
    people: OrgPerson[]
    accent?: string
    shared?: boolean
}

type OrganogramModalProps = {
    open: boolean
    onClose: () => void
    me: any
    users: Array<{
        id: string
        name: string
        email?: string
        role?: string
        departmentId?: string
        nationalCoordinator?: boolean
        assignedBranch?: string
        branchId?: string
    }>
    branches: any[]
    departments: any[]
    displayRoleOf: (user: any) => string
    assignedBranchIdOf: (user: any) => string
}

/**
 * Compact card sizing.
 *
 * Card width is capped to avoid an excessively wide chart.
 * Card height grows automatically when names or roles wrap.
 */
const MIN_CARD_W = 160
const MAX_CARD_W = 220
const MIN_CARD_H = 56

const AVATAR_SIZE = 24
const CARD_CONTENT_GAP = 7
const CARD_HORIZONTAL_PADDING = 9
const CARD_VERTICAL_PADDING = 8

const NAME_FONT_SIZE = 11
const NAME_LINE_HEIGHT = 13
const ROLE_FONT_SIZE = 9.5
const ROLE_LINE_HEIGHT = 11

const H_GAP = 12
const ROW_GAP = 34
const CHART_PADDING = 12
const CONNECTOR_GAP = 10

const toPeople = (
    list: any[],
    displayRoleOf: (user: any) => string
): OrgPerson[] =>
    list
        .map(user => ({
            id: user.id,
            name: user.name || user.email || 'Unnamed',
            email: user.email,
            role: displayRoleOf(user) || user.role || 'Staff Member',
            isNational: Boolean(user.nationalCoordinator)
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

const buildOrganogram = (
    me: any,
    users: OrganogramModalProps['users'],
    assignedBranchIdOf: (user: any) => string,
    displayRoleOf: (user: any) => string,
    branches: any[],
    departments: any[]
): {
    rootName: string
    rootRole: string
    scopeLabel: string
    tiers: OrgTier[]
} | null => {
    const myRole = String(me?.role || '').toLowerCase()

    if (myRole === 'projectadmin') {
        const myBranchId = assignedBranchIdOf(me)

        if (!myBranchId) {
            return null
        }

        const branchName =
            branches.find(branch => branch.id === myBranchId)?.name ||
            'Your branch'

        const branchUsers = users.filter(
            user =>
                user.id !== me?.id &&
                assignedBranchIdOf(user) === myBranchId
        )

        const coordinators = branchUsers.filter(
            user =>
                String(user.role || '').toLowerCase() === 'coordinator'
        )

        const nationalCoordinators = coordinators.filter(
            user => user.nationalCoordinator
        )

        const regularCoordinators = coordinators.filter(
            user => !user.nationalCoordinator
        )

        const branchStaff = branchUsers.filter(user =>
            ['receptionist', 'employee'].includes(
                String(user.role || '').toLowerCase()
            )
        )

        const tiers: OrgTier[] = []

        if (nationalCoordinators.length > 0) {
            tiers.push({
                label: 'National Coordinator',
                people: toPeople(
                    nationalCoordinators,
                    displayRoleOf
                ),
                accent: '#b8860b'
            })
        }

        if (regularCoordinators.length > 0) {
            tiers.push({
                label: 'Coordinator',
                people: toPeople(
                    regularCoordinators,
                    displayRoleOf
                ),
                accent: '#2f6fed'
            })
        }

        if (branchStaff.length > 0) {
            tiers.push({
                label: 'Branch Staff',
                people: toPeople(branchStaff, displayRoleOf),
                accent: '#64748b',
                shared: true
            })
        }

        return {
            rootName:
                me?.name ||
                me?.fullName ||
                me?.email ||
                'You',
            rootRole:
                displayRoleOf(me) ||
                'Center Coordinator',
            scopeLabel: branchName,
            tiers
        }
    }

    if (myRole === 'operations') {
        const myDepartmentId = me?.departmentId

        if (!myDepartmentId) {
            return null
        }

        const departmentName =
            departments.find(
                department => department.id === myDepartmentId
            )?.name || 'Your department'

        const coordinators = users.filter(
            user =>
                user.id !== me?.id &&
                user.departmentId === myDepartmentId &&
                String(user.role || '').toLowerCase() ===
                'coordinator'
        )

        const nationalCoordinators = coordinators.filter(
            user => user.nationalCoordinator
        )

        const regularCoordinators = coordinators.filter(
            user => !user.nationalCoordinator
        )

        const tiers: OrgTier[] = []

        if (nationalCoordinators.length > 0) {
            tiers.push({
                label: 'National Coordinator',
                people: toPeople(
                    nationalCoordinators,
                    displayRoleOf
                ),
                accent: '#b8860b'
            })
        }

        if (regularCoordinators.length > 0) {
            tiers.push({
                label: 'Coordinator',
                people: toPeople(
                    regularCoordinators,
                    displayRoleOf
                ),
                accent: '#2f6fed'
            })
        }

        return {
            rootName:
                me?.name ||
                me?.fullName ||
                me?.email ||
                'You',
            rootRole:
                displayRoleOf(me) ||
                'Head Of Department',
            scopeLabel: departmentName,
            tiers
        }
    }

    return null
}

const initials = (name?: string) => {
    if (!name) {
        return '?'
    }

    const parts = name.trim().split(/\s+/)

    return (
        parts
            .slice(0, 2)
            .map(part => part[0]?.toUpperCase() || '')
            .join('') || '?'
    )
}

const sanitizeFileName = (value?: string) =>
    String(value || 'organogram')
        .trim()
        .replace(/[<>:"/\\|?*]+/g, '')
        .replace(/\s+/g, '_')

export const OrganogramModal: React.FC<
    OrganogramModalProps
> = ({
    open,
    onClose,
    me,
    users,
    branches,
    departments,
    displayRoleOf,
    assignedBranchIdOf
}) => {
        const chartRef = useRef<HTMLDivElement>(null)

        const [exporting, setExporting] = useState<
            'png' | 'pdf' | 'docx' | null
        >(null)

        const data = useMemo(
            () =>
                buildOrganogram(
                    me,
                    users,
                    assignedBranchIdOf,
                    displayRoleOf,
                    branches,
                    departments
                ),
            [
                me,
                users,
                assignedBranchIdOf,
                displayRoleOf,
                branches,
                departments
            ]
        )

        const rows: OrgPerson[][] = useMemo(() => {
            if (!data) {
                return []
            }

            return [
                [
                    {
                        id: 'root',
                        name: data.rootName,
                        role: data.rootRole,
                        isNational: false
                    }
                ],
                ...data.tiers.map(tier => tier.people)
            ]
        }, [data])

        /**
         * Measures the longest name and role.
         *
         * The width expands until MAX_CARD_W.
         * After that, text wraps and the height increases automatically.
         */
        const cardMetrics = useMemo(() => {
            if (!data || rows.length === 0) {
                return {
                    width: MIN_CARD_W,
                    height: MIN_CARD_H
                }
            }

            const entries = rows.flatMap((row, rowIndex) =>
                row.map(person => ({
                    name: person.name || 'Unnamed',
                    role:
                        rowIndex === 0
                            ? data.rootRole
                            : person.role ||
                            data.tiers[rowIndex - 1]?.label ||
                            'Staff Member'
                }))
            )

            let measureText = (
                value: string,
                font: string
            ): number => {
                const approximateCharacterWidth =
                    font.includes('600') ? 6.5 : 5.5

                return value.length * approximateCharacterWidth
            }

            if (typeof document !== 'undefined') {
                const canvas = document.createElement('canvas')
                const context = canvas.getContext('2d')

                if (context) {
                    measureText = (value, font) => {
                        context.font = font
                        return context.measureText(value).width
                    }
                }
            }

            const fixedHorizontalSpace =
                AVATAR_SIZE +
                CARD_CONTENT_GAP +
                CARD_HORIZONTAL_PADDING * 2

            const preferredWidth = Math.max(
                ...entries.map(entry => {
                    const nameWidth = measureText(
                        entry.name,
                        `600 ${NAME_FONT_SIZE}px Arial`
                    )

                    const roleWidth = measureText(
                        entry.role,
                        `400 ${ROLE_FONT_SIZE}px Arial`
                    )

                    return (
                        Math.max(nameWidth, roleWidth) +
                        fixedHorizontalSpace
                    )
                }),
                MIN_CARD_W
            )

            const width = Math.min(
                MAX_CARD_W,
                Math.max(MIN_CARD_W, Math.ceil(preferredWidth))
            )

            const availableTextWidth = Math.max(
                70,
                width - fixedHorizontalSpace
            )

            const requiredContentHeight = Math.max(
                ...entries.map(entry => {
                    const nameWidth = measureText(
                        entry.name,
                        `600 ${NAME_FONT_SIZE}px Arial`
                    )

                    const roleWidth = measureText(
                        entry.role,
                        `400 ${ROLE_FONT_SIZE}px Arial`
                    )

                    const nameLines = Math.max(
                        1,
                        Math.ceil(nameWidth / availableTextWidth)
                    )

                    const roleLines = Math.max(
                        1,
                        Math.ceil(roleWidth / availableTextWidth)
                    )

                    return (
                        nameLines * NAME_LINE_HEIGHT +
                        3 +
                        roleLines * ROLE_LINE_HEIGHT
                    )
                })
            )

            const height = Math.max(
                MIN_CARD_H,
                Math.ceil(
                    requiredContentHeight +
                    CARD_VERTICAL_PADDING * 2
                )
            )

            return {
                width,
                height
            }
        }, [data, rows])

        const cardWidth = cardMetrics.width
        const cardHeight = cardMetrics.height

        const layout = useMemo(() => {
            const rowWidths = rows.map(
                row =>
                    row.length * cardWidth +
                    Math.max(0, row.length - 1) * H_GAP
            )

            const contentWidth = Math.max(
                ...rowWidths,
                cardWidth
            )

            const contentHeight =
                rows.length * cardHeight +
                Math.max(0, rows.length - 1) * ROW_GAP

            const width =
                contentWidth + CHART_PADDING * 2

            const height =
                contentHeight + CHART_PADDING * 2

            const positions = rows.map((row, rowIndex) => {
                const rowWidth =
                    rowWidths[rowIndex] || cardWidth

                const startX =
                    CHART_PADDING +
                    (contentWidth - rowWidth) / 2

                const y =
                    CHART_PADDING +
                    rowIndex * (cardHeight + ROW_GAP)

                return row.map((person, columnIndex) => ({
                    person,
                    x:
                        startX +
                        columnIndex * (cardWidth + H_GAP),
                    y
                }))
            })

            return {
                width,
                height,
                positions
            }
        }, [rows, cardWidth, cardHeight])

        const downloadCanvas = async () => {
            if (!chartRef.current) {
                return null
            }

            // Install with: npm install html2canvas
            const html2canvas = (
                await import('html2canvas')
            ).default

            return html2canvas(chartRef.current, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                logging: false
            })
        }

        const handleExportPng = async () => {
            setExporting('png')

            try {
                const canvas = await downloadCanvas()

                if (!canvas) {
                    return
                }

                const link = document.createElement('a')

                link.download = `${sanitizeFileName(
                    data?.scopeLabel
                )}.png`

                link.href = canvas.toDataURL('image/png')
                link.click()
            } catch (error) {
                console.error(error)

                message.error(
                    'Could not export the organogram as an image.'
                )
            } finally {
                setExporting(null)
            }
        }

        const handleExportPdf = async () => {
            setExporting('pdf')

            try {
                const canvas = await downloadCanvas()

                if (!canvas) {
                    return
                }

                // Install with: npm install jspdf
                const { jsPDF } = await import('jspdf')

                const imageData = canvas.toDataURL('image/png')

                const exportWidth = canvas.width / 2
                const exportHeight = canvas.height / 2

                const pdf = new jsPDF({
                    orientation:
                        exportWidth > exportHeight
                            ? 'landscape'
                            : 'portrait',
                    unit: 'pt',
                    format: [exportWidth, exportHeight]
                })

                pdf.addImage(
                    imageData,
                    'PNG',
                    0,
                    0,
                    exportWidth,
                    exportHeight
                )

                pdf.save(
                    `${sanitizeFileName(
                        data?.scopeLabel
                    )}.pdf`
                )
            } catch (error) {
                console.error(error)

                message.error(
                    'Could not export the organogram as a PDF.'
                )
            } finally {
                setExporting(null)
            }
        }

        const handleExportWord = async () => {
            setExporting('docx')

            try {
                const canvas = await downloadCanvas()

                if (!canvas) {
                    return
                }

                const blob = await new Promise<Blob>(
                    (resolve, reject) => {
                        canvas.toBlob(result => {
                            if (!result) {
                                reject(
                                    new Error(
                                        'Could not create the organogram image.'
                                    )
                                )

                                return
                            }

                            resolve(result)
                        }, 'image/png')
                    }
                )

                const arrayBuffer = await blob.arrayBuffer()

                // Install with: npm install docx
                const {
                    Document,
                    Packer,
                    Paragraph,
                    ImageRun,
                    HeadingLevel,
                    AlignmentType
                } = await import('docx')

                const maximumWordWidth = 620

                const imageWidth = Math.min(
                    maximumWordWidth,
                    canvas.width / 2
                )

                const imageHeight =
                    imageWidth *
                    (canvas.height / canvas.width)

                const document = new Document({
                    sections: [
                        {
                            children: [
                                new Paragraph({
                                    text: `Organogram — ${data?.scopeLabel || ''
                                        }`,
                                    heading:
                                        HeadingLevel.HEADING_1,
                                    alignment:
                                        AlignmentType.CENTER
                                }),
                                new Paragraph({
                                    alignment:
                                        AlignmentType.CENTER,
                                    children: [
                                        new ImageRun({
                                            data: arrayBuffer,
                                            transformation: {
                                                width: imageWidth,
                                                height: imageHeight
                                            }
                                        } as any)
                                    ]
                                })
                            ]
                        }
                    ]
                })

                const outputBlob =
                    await Packer.toBlob(document)

                const url =
                    URL.createObjectURL(outputBlob)

                const link =
                    document.createElement('a')

                link.href = url

                link.download = `${sanitizeFileName(
                    data?.scopeLabel
                )}.docx`

                link.click()

                window.setTimeout(() => {
                    URL.revokeObjectURL(url)
                }, 1000)
            } catch (error) {
                console.error(error)

                message.error(
                    'Could not export the organogram as a Word document.'
                )
            } finally {
                setExporting(null)
            }
        }

        const exportMenuItems = [
            {
                key: 'png',
                icon: <FileImageOutlined />,
                label: 'Download as image (PNG)',
                onClick: handleExportPng
            },
            {
                key: 'pdf',
                icon: <FilePdfOutlined />,
                label: 'Download as PDF',
                onClick: handleExportPdf
            },
            {
                key: 'docx',
                icon: <FileWordOutlined />,
                label: 'Download as Word (.docx)',
                onClick: handleExportWord
            }
        ]

        return (
            <Modal
                title={
                    data
                        ? `Organogram — ${data.scopeLabel}`
                        : 'Organogram'
                }
                open={open}
                onCancel={onClose}
                footer={null}
                width={Math.min(
                    1100,
                    (typeof window !== 'undefined'
                        ? window.innerWidth
                        : 1100) - 32
                )}
                styles={{
                    body: {
                        paddingTop: 12
                    }
                }}
                centered
            >
                {!data ? (
                    <Empty description="We couldn't determine your branch or department, so an organogram can't be built." />
                ) : (
                    <>
                        <Space style={{ marginBottom: 12 }}>
                            <Dropdown
                                menu={{
                                    items: exportMenuItems
                                }}
                                disabled={Boolean(exporting)}
                            >
                                <Button
                                    icon={<DownloadOutlined />}
                                    loading={Boolean(exporting)}
                                >
                                    Download
                                </Button>
                            </Dropdown>
                        </Space>

                        <div
                            style={{
                                width: '100%',
                                overflowX: 'auto',
                                paddingBottom: 8
                            }}
                        >
                            <div
                                ref={chartRef}
                                style={{
                                    position: 'relative',
                                    width: layout.width,
                                    height: layout.height,
                                    margin: '0 auto',
                                    background: '#ffffff'
                                }}
                            >
                                <svg
                                    width={layout.width}
                                    height={layout.height}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        pointerEvents: 'none'
                                    }}
                                >
                                    {layout.positions
                                        .slice(1)
                                        .map((row, rowIndex) => {
                                            const parentRow =
                                                layout.positions[
                                                rowIndex
                                                ]

                                            if (
                                                !parentRow?.length ||
                                                !row?.length
                                            ) {
                                                return null
                                            }

                                            const parentCenterX =
                                                parentRow.length === 1
                                                    ? parentRow[0].x +
                                                    cardWidth / 2
                                                    : layout.width / 2

                                            const parentBottomY =
                                                parentRow[0].y +
                                                cardHeight

                                            const childTopY =
                                                row[0].y

                                            const availableConnectorHeight =
                                                childTopY -
                                                parentBottomY

                                            const busY =
                                                parentBottomY +
                                                Math.min(
                                                    Math.max(
                                                        CONNECTOR_GAP,
                                                        availableConnectorHeight /
                                                        2
                                                    ),
                                                    availableConnectorHeight -
                                                    8
                                                )

                                            const rowStartCenterX =
                                                row[0].x +
                                                cardWidth / 2

                                            const rowEndCenterX =
                                                row[row.length - 1]
                                                    .x +
                                                cardWidth / 2

                                            return (
                                                <g
                                                    key={`connector-${rowIndex}`}
                                                >
                                                    <line
                                                        x1={
                                                            parentCenterX
                                                        }
                                                        y1={
                                                            parentBottomY
                                                        }
                                                        x2={
                                                            parentCenterX
                                                        }
                                                        y2={busY}
                                                        stroke="#c9ccd3"
                                                        strokeWidth={
                                                            1.25
                                                        }
                                                    />

                                                    <line
                                                        x1={Math.min(
                                                            rowStartCenterX,
                                                            parentCenterX
                                                        )}
                                                        y1={busY}
                                                        x2={Math.max(
                                                            rowEndCenterX,
                                                            parentCenterX
                                                        )}
                                                        y2={busY}
                                                        stroke="#c9ccd3"
                                                        strokeWidth={
                                                            1.25
                                                        }
                                                    />

                                                    {row.map(
                                                        node => (
                                                            <line
                                                                key={`drop-${node.person.id}`}
                                                                x1={
                                                                    node.x +
                                                                    cardWidth /
                                                                    2
                                                                }
                                                                y1={
                                                                    busY
                                                                }
                                                                x2={
                                                                    node.x +
                                                                    cardWidth /
                                                                    2
                                                                }
                                                                y2={
                                                                    childTopY
                                                                }
                                                                stroke="#c9ccd3"
                                                                strokeWidth={
                                                                    1.25
                                                                }
                                                            />
                                                        )
                                                    )}
                                                </g>
                                            )
                                        })}
                                </svg>

                                {layout.positions.map(
                                    (row, rowIndex) => {
                                        const isRoot =
                                            rowIndex === 0

                                        const tier = !isRoot
                                            ? data.tiers[
                                            rowIndex - 1
                                            ]
                                            : null

                                        return row.map(
                                            ({
                                                person,
                                                x,
                                                y
                                            }) => {
                                                const roleLabel =
                                                    isRoot
                                                        ? data.rootRole
                                                        : person.role ||
                                                        tier?.label ||
                                                        'Staff Member'

                                                return (
                                                    <div
                                                        key={
                                                            person.id
                                                        }
                                                        style={{
                                                            position:
                                                                'absolute',
                                                            left: x,
                                                            top: y,
                                                            width: cardWidth,
                                                            height: cardHeight,
                                                            borderRadius: 7,
                                                            border: `1px solid ${isRoot
                                                                ? '#2f6fed'
                                                                : tier?.accent ||
                                                                '#d9d9d9'
                                                                }`,
                                                            background:
                                                                isRoot
                                                                    ? '#eef4ff'
                                                                    : '#ffffff',
                                                            boxShadow:
                                                                '0 1px 2px rgba(15,23,42,0.07)',
                                                            display: 'flex',
                                                            alignItems:
                                                                'center',
                                                            gap: CARD_CONTENT_GAP,
                                                            padding: `${CARD_VERTICAL_PADDING}px ${CARD_HORIZONTAL_PADDING}px`,
                                                            boxSizing:
                                                                'border-box'
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                width: AVATAR_SIZE,
                                                                height: AVATAR_SIZE,
                                                                minWidth:
                                                                    AVATAR_SIZE,
                                                                borderRadius:
                                                                    '50%',
                                                                background:
                                                                    isRoot
                                                                        ? '#2f6fed'
                                                                        : tier?.accent ||
                                                                        '#94a3b8',
                                                                color:
                                                                    '#ffffff',
                                                                fontSize: 9,
                                                                fontWeight: 600,
                                                                display:
                                                                    'flex',
                                                                alignItems:
                                                                    'center',
                                                                justifyContent:
                                                                    'center',
                                                                flexShrink: 0
                                                            }}
                                                        >
                                                            {initials(
                                                                person.name
                                                            )}
                                                        </div>

                                                        <div
                                                            style={{
                                                                flex: 1,
                                                                minWidth: 0
                                                            }}
                                                        >
                                                            <div
                                                                style={{
                                                                    fontSize:
                                                                        NAME_FONT_SIZE,
                                                                    fontWeight: 600,
                                                                    lineHeight: `${NAME_LINE_HEIGHT}px`,
                                                                    whiteSpace:
                                                                        'normal',
                                                                    overflowWrap:
                                                                        'anywhere',
                                                                    wordBreak:
                                                                        'break-word'
                                                                }}
                                                            >
                                                                {
                                                                    person.name
                                                                }

                                                                {person.isNational && (
                                                                    <StarFilled
                                                                        style={{
                                                                            color:
                                                                                '#b8860b',
                                                                            fontSize: 9,
                                                                            marginLeft: 3
                                                                        }}
                                                                    />
                                                                )}
                                                            </div>

                                                            <div
                                                                style={{
                                                                    marginTop: 3,
                                                                    fontSize:
                                                                        ROLE_FONT_SIZE,
                                                                    lineHeight: `${ROLE_LINE_HEIGHT}px`,
                                                                    color:
                                                                        'rgba(0,0,0,0.5)',
                                                                    whiteSpace:
                                                                        'normal',
                                                                    overflowWrap:
                                                                        'anywhere',
                                                                    wordBreak:
                                                                        'break-word'
                                                                }}
                                                            >
                                                                {
                                                                    roleLabel
                                                                }
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            }
                                        )
                                    }
                                )}
                            </div>
                        </div>
                    </>
                )}
            </Modal>
        )
    }

export default OrganogramModal
