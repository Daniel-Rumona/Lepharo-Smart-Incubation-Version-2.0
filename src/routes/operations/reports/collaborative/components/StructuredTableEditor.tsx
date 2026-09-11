import React, { useMemo } from 'react'
import { Button, Input, Space, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'

type RowData = Record<string, any> & { __key?: string }

type Props = {
  columns: string[]
  value: { rows?: RowData[] } | null | undefined
  onChange: (value: { rows: RowData[] }) => void
  readOnly?: boolean
  kpiMode?: boolean
}

const StructuredTableEditor: React.FC<Props> = ({ columns, value, onChange, readOnly, kpiMode }) => {
  const rows = Array.isArray(value?.rows) ? value!.rows! : []

  const updateCell = (rowIndex: number, column: string, nextValue: string) => {
    const next = rows.map((row, index) => index === rowIndex ? { ...row, [column]: nextValue } : row)

    if (kpiMode) {
      const achievedKey = columns.find(item => item.toLowerCase() === 'achieved')
      const targetKey = columns.find(item => item.toLowerCase() === 'target')
      const varianceKey = columns.find(item => item.toLowerCase() === 'variance')
      if (achievedKey && targetKey && varianceKey && (column === achievedKey || column === targetKey)) {
        const target = Number(next[rowIndex]?.[targetKey])
        const achieved = Number(next[rowIndex]?.[achievedKey])
        if (Number.isFinite(target) && Number.isFinite(achieved)) {
          next[rowIndex] = { ...next[rowIndex], [varianceKey]: String(achieved - target) }
        }
      }
    }

    onChange({ rows: next })
  }

  const removeRow = (rowIndex: number) => onChange({ rows: rows.filter((_, index) => index !== rowIndex) })
  const addRow = () => onChange({ rows: [...rows, Object.fromEntries(columns.map(column => [column, '']))] })

  const tableColumns = useMemo<ColumnsType<RowData>>(() => [
    {
      title: 'Source',
      key: 'source',
      width: 110,
      render: (_: any, row: RowData) => row.__origin === 'carried'
        ? <Tag color="gold">{row.__sourcePeriod || 'Last report'}</Tag>
        : <Tag color="blue">Current</Tag>
    },
    ...columns.map(column => ({
      title: column,
      dataIndex: column,
      key: column,
      width: column.toLowerCase().includes('comment') ? 280 : column.toLowerCase().includes('indicator') ? 260 : 150,
      render: (_: any, __: RowData, rowIndex: number) => (
        <Input.TextArea
          value={String(rows[rowIndex]?.[column] ?? '')}
          onChange={e => updateCell(rowIndex, column, e.target.value)}
          autoSize={{ minRows: 1, maxRows: 5 }}
          readOnly={readOnly || column.toLowerCase() === 'variance'}
          variant={readOnly ? 'borderless' : 'outlined'}
        />
      )
    })),
    ...(!readOnly ? [{
      title: '',
      key: 'actions',
      width: 52,
      fixed: 'right' as const,
      render: (_: any, __: RowData, rowIndex: number) => <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeRow(rowIndex)} />
    }] : [])
  ], [columns, rows, readOnly, kpiMode])

  return (
    <div className="block-editor-body">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Table<RowData>
          size="small"
          rowKey={(_, index) => String(index)}
          pagination={false}
          columns={tableColumns}
          dataSource={rows}
          scroll={{ x: Math.max(800, columns.length * 150) }}
        />
        {!readOnly ? <Button icon={<PlusOutlined />} onClick={addRow}>Add Row</Button> : null}
      </Space>
    </div>
  )
}

export default StructuredTableEditor
