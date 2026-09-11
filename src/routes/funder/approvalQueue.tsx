// ApprovalQueue.tsx
import React from "react";
import { Form, Input, Button, Select } from "antd";

export const ApprovalQueue = () => {
  const [form] = Form.useForm();

  const onFinish = (values: any) => {
    console.log("Approval Decision:", values);
  };

  return (
    <Form layout="vertical" form={form} onFinish={onFinish}>
      <Form.Item name="proposal" label="Proposal ID" rules={[{ required: true }]}> <Input /> </Form.Item>
      <Form.Item name="decision" label="Decision" rules={[{ required: true }]}> <Select options={[{ value: 'approve', label: 'Approve' }, { value: 'reject', label: 'Reject' }]} /> </Form.Item>
      <Form.Item name="comments" label="Comments"> <Input.TextArea rows={3} /> </Form.Item>
      <Form.Item> <Button type="primary" htmlType="submit">Submit Decision</Button> </Form.Item>
    </Form>
  );
};