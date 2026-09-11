import { Col, Form, Input, Row, Switch, Typography } from 'antd'
import { OPERATING_DAYS, clockMinutes } from '@/utils/branchOperatingHours'

export const OperatingHoursFields = () => (
  <>
    <Typography.Title level={5}>Operating hours</Typography.Title>
    <Typography.Paragraph type='secondary'>
      Set same-day opening and closing times. Timesheets use these for planned hours,
      lateness and overtime. Mark non-working days as closed.
    </Typography.Paragraph>
    {OPERATING_DAYS.map(({ key, label }) => (
      <Form.Item key={key} noStyle shouldUpdate={(previous, current) =>
        previous.operatingHours?.[key]?.closed !== current.operatingHours?.[key]?.closed
      }>
        {({ getFieldValue }) => {
          const closed = getFieldValue(['operatingHours', key, 'closed'])
          return (
            <Row gutter={12} align='middle'>
              <Col xs={8} sm={6}><Typography.Text>{label}</Typography.Text></Col>
              <Col xs={16} sm={6}>
                <Form.Item name={['operatingHours', key, 'closed']} valuePropName='checked'>
                  <Switch checkedChildren='Closed' unCheckedChildren='Open' aria-label={`${label} closed`} />
                </Form.Item>
              </Col>
              <Col xs={12} sm={6}>
                <Form.Item name={['operatingHours', key, 'opens']} label='Opens'
                  rules={[{ required: !closed, message: 'Set opening time' }]}>
                  <Input type='time' disabled={closed} aria-label={`${label} opening time`} />
                </Form.Item>
              </Col>
              <Col xs={12} sm={6}>
                <Form.Item name={['operatingHours', key, 'closes']} label='Closes'
                  dependencies={[[ 'operatingHours', key, 'opens' ], [ 'operatingHours', key, 'closed' ]]}
                  rules={[{ validator: async (_, value) => {
                    if (getFieldValue(['operatingHours', key, 'closed'])) return
                    const opens = clockMinutes(getFieldValue(['operatingHours', key, 'opens']) || '')
                    const closes = clockMinutes(value || '')
                    if (!Number.isFinite(opens) || !Number.isFinite(closes) || closes <= opens) {
                      throw new Error('Must be after opening (same day)')
                    }
                  } }]}>
                  <Input type='time' disabled={closed} aria-label={`${label} closing time`} />
                </Form.Item>
              </Col>
            </Row>
          )
        }}
      </Form.Item>
    ))}
  </>
)
