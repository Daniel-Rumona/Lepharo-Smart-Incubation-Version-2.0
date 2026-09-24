import React from 'react'
import { Button, Col, Dropdown, Form, Input, Row, Select, Space, Switch, Typography, theme } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import {
  OPERATING_DAYS, BranchDayHours, BranchOperatingHours, OperatingHoursRules,
  defaultOperatingHours, operatingHoursFromRules, operatingHoursToRules, validateOperatingHours
} from '@/utils/branchOperatingHours'

const { Text, Paragraph } = Typography

const TimeFields = ({ value, onChange, label, disabled }: {
  value: BranchDayHours
  onChange: (value: BranchDayHours) => void
  label: string
  disabled?: boolean
}) => (
  <Row gutter={12} style={{ marginTop: 12 }}>
    <Col span={12}>
      <label style={{ display: 'block', marginBottom: 6 }} htmlFor={`${label}-opens`}>Opens</label>
      <Input id={`${label}-opens`} type='time' aria-label={`${label} opening time`}
        value={value.opens} disabled={value.closed ? true : disabled}
        onChange={event => onChange({ ...value, opens: event.target.value })} />
    </Col>
    <Col span={12}>
      <label style={{ display: 'block', marginBottom: 6 }} htmlFor={`${label}-closes`}>Closes</label>
      <Input id={`${label}-closes`} type='time' aria-label={`${label} closing time`}
        value={value.closes} disabled={value.closed ? true : disabled}
        onChange={event => onChange({ ...value, closes: event.target.value })} />
    </Col>
  </Row>
)

export const OperatingHoursEditor = ({ value, onChange, id, disabled }: {
  value?: BranchOperatingHours
  onChange?: (hours: BranchOperatingHours) => void
  id?: string
  disabled?: boolean
}) => {
  const { token } = theme.useToken()
  const rules = operatingHoursToRules(value || defaultOperatingHours())
  const update = (changes: Partial<OperatingHoursRules>) => onChange?.(operatingHoursFromRules({ ...rules, ...changes }))
  const exceptions = OPERATING_DAYS.filter(({ key }) => rules.dayOverrides[key])
  const panelStyle: React.CSSProperties = {
    padding: 16, borderRadius: 12, border: `1px solid ${token.colorBorderSecondary}`,
    background: token.colorFillAlter
  }
  const holidayMode = !rules.publicHolidays ? 'regular' : rules.publicHolidays.closed ? 'closed' : 'custom'

  return (
    <Space id={id} direction='vertical' size={16} style={{ width: '100%' }}>
      <div style={panelStyle}>
        <Text strong>What are the operating hours for this center?</Text>
        <Paragraph type='secondary' style={{ margin: '4px 0 0' }}>Set the hours used on a normal working day.</Paragraph>
        <TimeFields label='Default hours' value={rules.defaultHours} disabled={disabled}
          onChange={defaultHours => update({ defaultHours })} />
        <label htmlFor='branch-working-days' style={{ display: 'block', margin: '16px 0 6px' }}>Regular working days</label>
        <Select id='branch-working-days' mode='multiple' aria-label='Regular working days'
          style={{ width: '100%' }} value={rules.workingDays} disabled={disabled}
          placeholder='Select working days'
          options={OPERATING_DAYS.map(({ key, label }) => ({ value: key, label: label.slice(0, 3) }))}
          onChange={workingDays => update({ workingDays })} />
        <Text type='secondary' style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
          Other days are closed unless you add an exception.
        </Text>
      </div>

      <div style={panelStyle}>
        <Text strong>Public holidays</Text>
        <Paragraph type='secondary' style={{ margin: '4px 0 12px' }}>
          Automatically applies to South African public holidays, including observed holidays.
        </Paragraph>
        <Select aria-label='Public holiday hours' value={holidayMode} disabled={disabled} style={{ width: '100%' }}
          options={[
            { value: 'regular', label: 'Use the regular schedule' },
            { value: 'closed', label: 'Closed on public holidays' },
            { value: 'custom', label: 'Use different hours' }
          ]}
          onChange={mode => update({ publicHolidays: mode === 'regular' ? null : {
            ...(rules.publicHolidays || rules.defaultHours), closed: mode === 'closed'
          } })} />
        {holidayMode === 'custom' && rules.publicHolidays && (
          <TimeFields label='Public holidays' value={rules.publicHolidays} disabled={disabled}
            onChange={publicHolidays => update({ publicHolidays })} />
        )}
        {holidayMode !== 'regular' && <Text type='secondary' style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          Holiday hours take priority over working days and day exceptions.
        </Text>}
      </div>

      <div>
        <Text strong>Day exceptions</Text>
        <Paragraph type='secondary' style={{ margin: '4px 0 12px' }}>
          Different hours on a particular weekday? Add only the days that need them.
        </Paragraph>
        <Space direction='vertical' size={12} style={{ width: '100%' }}>
          {exceptions.map(({ key, label }) => {
            const day = rules.dayOverrides[key]!
            const setDay = (next: BranchDayHours) => update({ dayOverrides: { ...rules.dayOverrides, [key]: next } })
            return (
              <div key={key} style={panelStyle}>
                <Row align='middle' justify='space-between' gutter={[8, 8]}>
                  <Col><Text strong>{label}s</Text></Col>
                  <Col>
                    <Space>
                      <Switch checked={!day.closed} checkedChildren='Open' unCheckedChildren='Closed'
                        aria-label={`${label} open`} disabled={disabled} onChange={open => setDay({ ...day, closed: !open })} />
                      <Button type='text' danger icon={<DeleteOutlined />} disabled={disabled}
                        aria-label={`Remove ${label} exception`} onClick={() => {
                          const dayOverrides = { ...rules.dayOverrides }
                          delete dayOverrides[key]
                          update({ dayOverrides })
                        }} />
                    </Space>
                  </Col>
                </Row>
                {!day.closed && <TimeFields label={label} value={day} onChange={setDay} disabled={disabled} />}
              </div>
            )
          })}
          <Dropdown trigger={['click']} disabled={disabled || exceptions.length === 7} menu={{
            items: OPERATING_DAYS.map(({ key, label }) => ({ key, label, disabled: !!rules.dayOverrides[key] })),
            onClick: ({ key }) => update({ dayOverrides: {
              ...rules.dayOverrides, [key]: { ...rules.defaultHours, closed: false }
            } })
          }}>
            <Button block type='dashed' icon={<PlusOutlined />} disabled={disabled || exceptions.length === 7}>
              Add day exception
            </Button>
          </Dropdown>
        </Space>
      </div>
    </Space>
  )
}

export const OperatingHoursFields = () => (
  <Form.Item name='operatingHours' rules={[{
    validator: async (_, value) => validateOperatingHours(value)
  }]}>
    <OperatingHoursEditor />
  </Form.Item>
)
