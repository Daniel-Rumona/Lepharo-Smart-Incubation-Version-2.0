import React from 'react'
import { Form, InputNumber } from 'antd'
import dayjs from 'dayjs'

/** The periods asked about: the last three months, then the last two years. */
export const historyPeriods = () => {
    const months = [3, 2, 1].map(n => dayjs().subtract(n, 'month')).map(d => ({ key: d.format('YYYY-MM'), label: d.format('MMM YYYY'), kind: 'monthly' as const }))
    const years = [1, 2].map(n => dayjs().year() - n).map(y => ({ key: String(y), label: `${y} (year)`, kind: 'annual' as const }))
    return [...months, ...years]
}

const rand = {
    formatter: (v: any) => (v === undefined || v === null || v === '' ? '' : `R ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')),
    parser: (v: any) => Number(String(v || '').replace(/[^\d.]/g, '')) as any
}

/**
 * Revenue and staff for recent periods, as one compact grid. All optional:
 * leave a row blank when the SME doesn't have the figure.
 */
export const HistorySection: React.FC = () => (
    <div className='sf-history' role='table' aria-label='Revenue and staff'>
        <div className='sf-history-row is-head' role='row'>
            <span role='columnheader'>Period</span>
            <span role='columnheader'>Revenue</span>
            <span role='columnheader'>Permanent staff</span>
            <span role='columnheader'>Temporary staff</span>
        </div>
        {historyPeriods().map(p => (
            <div key={p.key} className='sf-history-row' role='row'>
                <span className='sf-history-period' role='rowheader'>{p.label}</span>
                <Form.Item name={['history', p.key, 'revenue']} noStyle>
                    <InputNumber min={0} placeholder='R 0' aria-label={`Revenue ${p.label}`} {...rand} />
                </Form.Item>
                <Form.Item name={['history', p.key, 'permanent']} noStyle>
                    <InputNumber min={0} precision={0} placeholder='0' aria-label={`Permanent staff ${p.label}`} />
                </Form.Item>
                <Form.Item name={['history', p.key, 'temporary']} noStyle>
                    <InputNumber min={0} precision={0} placeholder='0' aria-label={`Temporary staff ${p.label}`} />
                </Form.Item>
            </div>
        ))}
    </div>
)
