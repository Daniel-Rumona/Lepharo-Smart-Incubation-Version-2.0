import React, { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Modal, Segmented, Table } from 'antd'
import { BarChartOutlined, DownloadOutlined, TableOutlined } from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import * as XLSX from 'xlsx'
import './chartDetails.css'

type Row = Record<string, string | number>

/** Chart and figures share one height, so switching views doesn't resize the modal. */
const VIEW_HEIGHT = 420

/**
 * The figures behind a chart, read from its Highcharts options: one row per
 * category (or pie slice), one column per series. Negative values (the age
 * pyramid draws one side below zero) are shown as counts.
 */
export const chartTable = (options: Highcharts.Options): { columns: string[]; rows: Row[] } => {
    const series = (options.series || []) as any[]
    if (!series.length) return { columns: [], rows: [] }

    const pointValue = (point: any) => {
        const y = typeof point === 'number' ? point : Array.isArray(point) ? point[1] : point?.y
        return Math.abs(Number(y) || 0)
    }

    if (series[0]?.type === 'pie') {
        const points = (series[0].data || []) as any[]
        const total = points.reduce((sum, p) => sum + pointValue(p), 0)
        return {
            columns: ['Group', 'Count', 'Share'],
            rows: points.map(p => ({
                Group: String(p?.name ?? '—'),
                Count: pointValue(p),
                Share: total ? `${Math.round((pointValue(p) / total) * 100)}%` : '—'
            }))
        }
    }

    const axis = Array.isArray(options.xAxis) ? options.xAxis[0] : options.xAxis
    const categories = ((axis as any)?.categories || []) as string[]
    const length = Math.max(categories.length, ...series.map(s => (s.data || []).length))
    const names = series.map((s, i) => String(s.name || `Series ${i + 1}`))
    return {
        columns: ['Category', ...names],
        rows: Array.from({ length }, (_, i) => {
            const row: Row = { Category: categories[i] ?? (series[0]?.data?.[i]?.name || `#${i + 1}`) }
            series.forEach((s, j) => {
                row[names[j]] = pointValue((s.data || [])[i])
            })
            return row
        })
    }
}

/** Saves the figures as an Excel file: the title and filters on top, then the table. */
const downloadExcel = (title: string, context: string | undefined, columns: string[], rows: Row[]) => {
    const sheet = XLSX.utils.aoa_to_sheet([
        [title],
        ...(context ? [[context]] : []),
        [],
        columns,
        ...rows.map(row => columns.map(column => row[column] ?? ''))
    ])
    sheet['!cols'] = columns.map((column, index) => ({
        wch: Math.min(40, Math.max(column.length, index === 0 ? 14 : 8, ...rows.map(row => String(row[column] ?? '').length)) + 2)
    }))
    const workbook = XLSX.utils.book_new()
    // Sheet names allow at most 31 characters and none of : \ / ? * [ ]
    XLSX.utils.book_append_sheet(workbook, sheet, title.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31).trim() || 'Figures')
    const fileName = title.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'chart'
    XLSX.writeFile(workbook, `${fileName}.xlsx`)
}

/** A chart shown large, or the figures behind it (one at a time), with an Excel download. */
const ChartDetailsModal: React.FC<{
    open: boolean
    title: string
    /** What the chart is filtered to, e.g. "Period: This month · Department: All". */
    context?: string
    options?: Highcharts.Options
    hasData?: boolean
    onClose: () => void
}> = ({ open, title, context, options, hasData, onClose }) => {
    const [view, setView] = useState<'chart' | 'figures'>('chart')
    useEffect(() => {
        if (open) setView('chart')
    }, [open, title])
    const table = useMemo(() => (options ? chartTable(options) : { columns: [], rows: [] }), [options])
    const largeOptions = useMemo<Highcharts.Options | undefined>(
        () => (options ? { ...options, chart: { ...options.chart, height: VIEW_HEIGHT } } : undefined),
        [options]
    )

    return (
        <Modal
            open={open}
            onCancel={onClose}
            width={1040}
            destroyOnClose
            footer={null}
            title={
                <div className='cd-head'>
                    <span className='cd-title'>{title}</span>
                    {context ? <span className='cd-context'>{context}</span> : null}
                </div>
            }
        >
            {hasData && largeOptions ? (
                <div className='cd-body'>
                    <div className='cd-toolbar'>
                        <Segmented
                            value={view}
                            onChange={v => setView(v as 'chart' | 'figures')}
                            options={[
                                { value: 'chart', label: 'Chart', icon: <BarChartOutlined /> },
                                { value: 'figures', label: `Figures (${table.rows.length})`, icon: <TableOutlined /> }
                            ]}
                        />
                        <Button
                            icon={<DownloadOutlined />}
                            disabled={!table.rows.length}
                            onClick={() => downloadExcel(title, context, table.columns, table.rows)}
                        >
                            Download Excel
                        </Button>
                    </div>
                    {view === 'chart' ? (
                        <HighchartsReact highcharts={Highcharts} options={largeOptions} />
                    ) : (
                        <section className='cd-figures' style={{ height: VIEW_HEIGHT }}>
                            <Table<Row>
                                size='small'
                                sticky
                                rowKey={row => String(row[table.columns[0]])}
                                dataSource={table.rows}
                                pagination={false}
                                // Header (~40px) stays put; the rows scroll within the chart's height.
                                scroll={{ x: 'max-content', y: VIEW_HEIGHT - 40 }}
                                columns={table.columns.map((column, index) => ({
                                    title: column,
                                    dataIndex: column,
                                    key: column,
                                    align: index === 0 ? 'left' : 'right',
                                    ...(index === 0
                                        ? {}
                                        : { sorter: (a: Row, b: Row) => (Number(a[column]) || 0) - (Number(b[column]) || 0) })
                                }))}
                            />
                        </section>
                    )}
                </div>
            ) : (
                <Empty description='No data for this period' />
            )}
        </Modal>
    )
}

export default ChartDetailsModal
