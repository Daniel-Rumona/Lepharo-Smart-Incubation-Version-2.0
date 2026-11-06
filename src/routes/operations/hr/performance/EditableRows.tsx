import React from 'react'
import { Empty, Table, Typography, theme } from 'antd'
import type { ColumnsType } from 'antd/es/table'

const { Text } = Typography

/**
 * An editing table on desktop; on phones, one stacked block per row with each
 * column's title above its control. Both use the same column definitions.
 */
export function EditableRows<T extends { id: string }>({
    rows,
    columns,
    isMobile,
    emptyText,
    scrollX
}: {
    rows: T[]
    columns: ColumnsType<T>
    isMobile: boolean
    emptyText: string
    scrollX?: number
}) {
    const { token } = theme.useToken()

    if (!isMobile) {
        return (
            <Table<T>
                rowKey='id'
                size='small'
                pagination={false}
                dataSource={rows}
                scroll={scrollX ? { x: scrollX } : undefined}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} /> }}
                columns={columns}
            />
        )
    }

    if (!rows.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((row, index) => (
                <div
                    key={row.id}
                    style={{
                        border: `1px solid ${token.colorBorderSecondary}`,
                        borderRadius: 12,
                        padding: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10
                    }}
                >
                    {columns.map((column, columnIndex) => {
                        const render = (column as any).render as ((value: unknown, row: T, index: number) => React.ReactNode) | undefined
                        if (!render) return null
                        const content = render(undefined, row, index)
                        if (content === null || content === undefined) return null
                        // Untitled columns hold row actions (e.g. remove); keep them to the right.
                        if (!column.title) {
                            return (
                                <div key={String(column.key ?? columnIndex)} style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -4 }}>
                                    {content}
                                </div>
                            )
                        }
                        return (
                            <div key={String(column.key ?? columnIndex)} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <Text type='secondary' style={{ fontSize: 12 }}>
                                    {column.title as React.ReactNode}
                                </Text>
                                <div style={{ minWidth: 0 }}>{content}</div>
                            </div>
                        )
                    })}
                </div>
            ))}
        </div>
    )
}
