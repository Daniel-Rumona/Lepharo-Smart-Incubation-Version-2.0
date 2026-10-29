import React, { useEffect, useState } from 'react'
import { Checkbox, Empty, Pagination, Skeleton, Typography } from 'antd'
import './mobile-card-list.css'

const { Text } = Typography

export type MobileCardContent = {
    title: React.ReactNode
    subtitle?: React.ReactNode
    /** Top-right status, usually a Tag. */
    badge?: React.ReactNode
    /** Short label/value pairs, shown two to a row. Keep to the most important few. */
    fields?: Array<{ label: string; value: React.ReactNode }>
    /** Full-width line under the fields, e.g. an error message. */
    note?: React.ReactNode
    /** Buttons for the row. They share the full width side by side (one button fills it). */
    actions?: React.ReactNode[]
}

type Props<T> = {
    data: T[]
    getKey: (row: T) => string
    renderCard: (row: T) => MobileCardContent
    loading?: boolean
    pageSize?: number
    emptyText?: string
    /** When given, each card gets a checkbox. */
    selectedKeys?: React.Key[]
    onSelectionChange?: (keys: React.Key[]) => void
}

/**
 * Phone replacement for a data table: one compact card per row showing only the
 * most important details, with simple paging.
 */
export function MobileCardList<T>({
    data,
    getKey,
    renderCard,
    loading,
    pageSize = 8,
    emptyText = 'Nothing to show',
    selectedKeys,
    onSelectionChange
}: Props<T>) {
    const [page, setPage] = useState(1)
    const selectable = Boolean(selectedKeys && onSelectionChange)

    // A new search/filter shrinks the list, so never stay on a page that is gone.
    useEffect(() => {
        const lastPage = Math.max(1, Math.ceil(data.length / pageSize))
        if (page > lastPage) setPage(lastPage)
    }, [data.length, page, pageSize])

    if (loading) return <Skeleton active paragraph={{ rows: 6 }} title={false} />
    if (!data.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />

    const visible = data.slice((page - 1) * pageSize, page * pageSize)

    const toggle = (key: string, checked: boolean) => {
        const current = selectedKeys || []
        onSelectionChange?.(checked ? [...current, key] : current.filter(item => item !== key))
    }

    return (
        <div className='mobile-card-list'>
            {visible.map(row => {
                const key = getKey(row)
                const card = renderCard(row)
                return (
                    <div key={key} className='mobile-card'>
                        <div className='mobile-card-head'>
                            {selectable ? (
                                <Checkbox
                                    checked={(selectedKeys || []).includes(key)}
                                    onChange={event => toggle(key, event.target.checked)}
                                />
                            ) : null}
                            <div className='mobile-card-title'>
                                <Text strong ellipsis>
                                    {card.title}
                                </Text>
                                {card.subtitle ? (
                                    <Text type='secondary' ellipsis style={{ fontSize: 12 }}>
                                        {card.subtitle}
                                    </Text>
                                ) : null}
                            </div>
                            {card.badge ? <div className='mobile-card-badge'>{card.badge}</div> : null}
                        </div>

                        {card.fields?.length ? (
                            <div className='mobile-card-fields'>
                                {card.fields.map(field => (
                                    <div key={field.label}>
                                        <Text type='secondary' className='mobile-card-label'>
                                            {field.label}
                                        </Text>
                                        <div className='mobile-card-value'>{field.value}</div>
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        {card.note ? <div className='mobile-card-note'>{card.note}</div> : null}

                        {card.actions?.length ? (
                            <div className='mobile-card-actions'>
                                {card.actions.map((action, index) => (
                                    <React.Fragment key={index}>{action}</React.Fragment>
                                ))}
                            </div>
                        ) : null}
                    </div>
                )
            })}

            {data.length > pageSize ? (
                <Pagination
                    current={page}
                    pageSize={pageSize}
                    total={data.length}
                    showSizeChanger={false}
                    onChange={setPage}
                    style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}
                />
            ) : null}
        </div>
    )
}

export default MobileCardList
