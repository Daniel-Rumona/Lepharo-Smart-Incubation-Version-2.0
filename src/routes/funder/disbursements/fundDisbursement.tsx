// FundDisbursement.tsx
import React from "react";
import { Form, Input, Button, InputNumber, Select } from "antd";

export const FundDisbursement = () => {
  const [form] = Form.useForm();

  const onFinish = (values: any) => {
    console.log("Disbursement:", values);
  };

  return (
    <Form layout="vertical" form={form} onFinish={onFinish}>
      <Form.Item name="sme" label="Select SME" rules={[{ required: true }]}> <Select options={[{ value: 'sme1', label: 'BrightTech' }, { value: 'sme2', label: 'Green Farms' }]} /> </Form.Item>
      <Form.Item name="amount" label="Amount (ZAR)" rules={[{ required: true }]}> <InputNumber min={0} style={{ width: '100%' }} /> </Form.Item>
      <Form.Item name="purpose" label="Purpose" rules={[{ required: true }]}> <Input.TextArea rows={3} /> </Form.Item>
      <Form.Item> <Button type="primary" htmlType="submit">Disburse Funds</Button> </Form.Item>
    </Form>
  );
};
