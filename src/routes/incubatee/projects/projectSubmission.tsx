import React, { useState } from 'react'
import {
  Card,
  Typography,
  Form,
  InputNumber,
  Button,
  message,
  Row,
  Col
} from 'antd'
import { Helmet } from 'react-helmet'

const { Title } = Typography

export const MonthlyPerformanceForm: React.FC = () => {
  const [form] = Form.useForm()

  const handleSubmit = (values: any) => {
    console.log('Form Submitted:', values)
    message.success('Monthly performance data submitted successfully!')
    form.resetFields()
  }

  return (
    <Card
      title='📈 Monthly Key Metrics Tracker'
      style={{ maxWidth: 800, margin: '0 auto' }}
      bodyStyle={{ padding: 24 }}
    >
      <Helmet>
        <title>Metrics Tracking</title>
      </Helmet>

      <Title level={5}>Enter your SME’s monthly performance data</Title>

      <Form
        layout='vertical'
        form={form}
        onFinish={handleSubmit}
        style={{ marginTop: 24 }}
      >
        <Form.Item
          name='revenue'
          label='Revenue for the Month (R)'
          rules={[{ required: true, message: 'Please enter monthly revenue' }]}
        >
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>

        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12}>
            <Form.Item
              name='headPermanent'
              label='Permanent Employees'
              rules={[{ required: true, message: 'Please enter a value' }]}
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              name='headTemporary'
              label='Temporary Employees'
              rules={[{ required: true, message: 'Please enter a value' }]}
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name='orders'
          label='New Orders / Tenders Submitted'
          rules={[{ required: true, message: 'Please enter a value' }]}
        >
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name='customers'
          label='New Customers Acquired'
          rules={[{ required: true, message: 'Please enter a value' }]}
        >
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name='traffic'
          label='Website Traffic (Visits)'
          rules={[{ required: true, message: 'Please enter traffic data' }]}
        >
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name='networking'
          label='Networking Events Attended'
          rules={[{ required: true, message: 'Please enter a number' }]}
        >
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item>
          <Button type='primary' htmlType='submit' block>
            Submit Monthly Update
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}
