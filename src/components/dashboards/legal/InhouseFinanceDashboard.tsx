// src/components/dashboards/finance/InhouseFinanceDashboard.tsx
import React, { useEffect, useState } from 'react';
import { Card, Col, Row, Typography, Button, Table, Modal, Form, Input, Select, Upload, message, Tag, Space, DatePicker, Divider, Layout } from 'antd';
import { PlusOutlined, UploadOutlined, EyeOutlined, CheckCircleOutlined, CloseCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import { Helmet } from 'react-helmet';
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs for dummy data
import dayjs from 'dayjs'; // For date handling
import { useFullIdentity } from '@/hooks/src/useFullIdentity'; // Assuming this hook exists for user info

const { Title, Text } = Typography;
const { Option } = Select;

interface FinanceRequest {
  id: string;
  title: string;
  description: string;
  requestingDepartment: string;
  requestedAmount: number;
  justification: string;
  dateNeeded: Date; // Use Date object for dummy data
  status: 'pending' | 'approved' | 'declined' | 'processing' | 'completed';
  submittedByUserId: string;
  submittedByUserDepartment: string;
  submittedAt: Date; // Use Date object for dummy data
  approvedByUserId?: string;
  approvedAt?: Date;
  declineReason?: string;
  attachments: Array<{ fileName: string; fileUrl: string; fileType: string }>;
  comments: Array<{ userId: string; comment: string; timestamp: Date }>;
}

const DUMMY_REQUESTS: FinanceRequest[] = [
  {
    id: uuidv4(),
    title: 'New Laptops for IT Department',
    description: 'Request for 10 new high-performance laptops for the IT development team.',
    requestingDepartment: 'IT Department',
    requestedAmount: 150000,
    justification: 'Existing laptops are outdated and affecting productivity.',
    dateNeeded: dayjs().add(2, 'weeks').toDate(),
    status: 'pending',
    submittedByUserId: 'user123',
    submittedByUserDepartment: 'IT Department',
    submittedAt: dayjs().subtract(5, 'days').toDate(),
    attachments: [{ fileName: 'Laptop_Quote_XYZ.pdf', fileUrl: 'http://example.com/quote1.pdf', fileType: 'application/pdf' }],
    comments: [],
  },
  {
    id: uuidv4(),
    title: 'Office Supplies Restock',
    description: 'General restock of pens, paper, and toners for admin.',
    requestingDepartment: 'Administration',
    requestedAmount: 5000,
    justification: 'Low on essential office supplies.',
    dateNeeded: dayjs().add(1, 'week').toDate(),
    status: 'approved',
    submittedByUserId: 'user124',
    submittedByUserDepartment: 'Administration',
    submittedAt: dayjs().subtract(10, 'days').toDate(),
    approvedByUserId: 'financeUser001',
    approvedAt: dayjs().subtract(8, 'days').toDate(),
    attachments: [],
    comments: [],
  },
  {
    id: uuidv4(),
    title: 'Marketing Campaign Budget',
    description: 'Request for funds to launch the Q3 marketing campaign.',
    requestingDepartment: 'Marketing',
    requestedAmount: 250000,
    justification: 'Crucial for product launch and market penetration.',
    dateNeeded: dayjs().add(4, 'weeks').toDate(),
    status: 'declined',
    submittedByUserId: 'user125',
    submittedByUserDepartment: 'Marketing',
    submittedAt: dayjs().subtract(15, 'days').toDate(),
    approvedByUserId: 'financeUser001',
    approvedAt: dayjs().subtract(12, 'days').toDate(),
    declineReason: 'Budget re-allocation due to higher priority projects.',
    attachments: [{ fileName: 'Marketing_Plan_V3.pptx', fileUrl: 'http://example.com/plan.pptx', fileType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }],
    comments: [{ userId: 'financeUser001', comment: 'Please resubmit with a revised budget after Q3 review.', timestamp: dayjs().subtract(12, 'days').toDate() }],
  },
  {
    id: uuidv4(),
    title: 'Travel Expenses for Conference',
    description: 'Travel and accommodation for team attending the Annual Tech Conference.',
    requestingDepartment: 'IT Department',
    requestedAmount: 30000,
    justification: 'Essential for professional development and networking.',
    dateNeeded: dayjs().add(3, 'weeks').toDate(),
    status: 'pending',
    submittedByUserId: 'user123',
    submittedByUserDepartment: 'IT Department',
    submittedAt: dayjs().subtract(2, 'days').toDate(),
    attachments: [],
    comments: [],
  },
];

export const InhouseFinanceDashboard: React.FC = () => {
  const { user, loading: userLoading } = useFullIdentity();
  const [requests, setRequests] = useState<FinanceRequest[]>(DUMMY_REQUESTS);
  const [loading, setLoading] = useState(false); // No async fetching, so loading can be false by default
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [selectedFile, setSelectedFile] = useState<File | null>(null); // For UI only, not actually uploading
  const [isApprovalModalVisible, setIsApprovalModalVisible] = useState(false);
  const [currentRequest, setCurrentRequest] = useState<FinanceRequest | null>(null);
  const [approvalForm] = Form.useForm();

  // Example role check: Adjust based on your actual user roles
  const isFinanceUser = user?.role === 'admin' || user?.role === 'operations'; // Using 'admin' or 'operations' as placeholder for finance roles from index.tsx / OperationsDashboard.tsx

  // Simulate fetching requests (initial load and after actions)
  useEffect(() => {
    if (!userLoading) {
      // Filter requests based on user's department if not a finance user
      if (!isFinanceUser && user?.departmentName) {
        setRequests(DUMMY_REQUESTS.filter(req => req.requestingDepartment === user.departmentName));
      } else {
        setRequests(DUMMY_REQUESTS);
      }
    }
  }, [user, userLoading, isFinanceUser]);

  const showModal = () => {
    setIsModalVisible(true);
  };

  const handleCancel = () => {
    setIsModalVisible(false);
    form.resetFields();
    setSelectedFile(null);
  };

  const handleFileChange = (info: any) => {
    if (info.fileList.length > 0) {
      setSelectedFile(info.fileList[0].originFileObj);
      message.info(`File selected: ${info.fileList[0].name}`);
    } else {
      setSelectedFile(null);
    }
  };

  const handleSubmitRequest = (values: any) => {
    if (!user) {
      message.error('User not authenticated (dummy user needed).');
      return;
    }

    setLoading(true);
    setTimeout(() => { // Simulate API call delay
      const newRequest: FinanceRequest = {
        id: uuidv4(),
        title: values.title,
        description: values.description,
        requestingDepartment: values.requestingDepartment,
        requestedAmount: parseFloat(values.requestedAmount),
        justification: values.justification,
        dateNeeded: values.dateNeeded.toDate(),
        status: 'pending',
        submittedByUserId: user.uid || 'dummy-user-id',
        submittedByUserDepartment: user.departmentName || 'Unknown Department',
        submittedAt: new Date(),
        attachments: selectedFile ? [{ fileName: selectedFile.name, fileUrl: 'dummy-url-for-quote', fileType: selectedFile.type }] : [],
        comments: [],
      };

      setRequests(prev => [...prev, newRequest]);
      message.success('Request submitted successfully!');
      handleCancel();
      setLoading(false);
    }, 500); // Simulate network latency
  };

  const handleApproveRequest = () => {
    if (!currentRequest || !user) return;

    setLoading(true);
    setTimeout(() => { // Simulate API call delay
      setRequests(prev =>
        prev.map(req =>
          req.id === currentRequest.id
            ? { ...req, status: 'approved', approvedByUserId: user.uid, approvedAt: new Date() }
            : req
        )
      );
      message.success('Request approved!');
      setIsApprovalModalVisible(false);
      setCurrentRequest(null);
      setLoading(false);
    }, 500);
  };

  const handleDeclineRequest = (values: any) => {
    if (!currentRequest || !user) return;

    setLoading(true);
    setTimeout(() => { // Simulate API call delay
      setRequests(prev =>
        prev.map(req =>
          req.id === currentRequest.id
            ? { ...req, status: 'declined', declineReason: values.declineReason, approvedByUserId: user.uid, approvedAt: new Date() }
            : req
        )
      );
      message.success('Request declined!');
      setIsApprovalModalVisible(false);
      setCurrentRequest(null);
      setLoading(false);
    }, 500);
  };

  const showApprovalModal = (record: FinanceRequest) => {
    setCurrentRequest(record);
    setIsApprovalModalVisible(true);
    approvalForm.resetFields(); // Clear any previous decline reasons
  };

  const columns = [
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
    },
    {
      title: 'Department',
      dataIndex: 'requestingDepartment',
      key: 'requestingDepartment',
    },
    {
      title: 'Amount',
      dataIndex: 'requestedAmount',
      key: 'requestedAmount',
      render: (amount: number) => `R${amount.toLocaleString()}`,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        let color = 'gold';
        if (status === 'approved') color = 'green';
        if (status === 'declined') color = 'red';
        return <Tag color={color}>{status.toUpperCase()}</Tag>;
      },
    },
    {
      title: 'Date Needed',
      dataIndex: 'dateNeeded',
      key: 'dateNeeded',
      render: (date: Date) => dayjs(date).format('YYYY-MM-DD'),
    },
    {
      title: 'Submitted At',
      dataIndex: 'submittedAt',
      key: 'submittedAt',
      render: (date: Date) => dayjs(date).toLocaleString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (text: string, record: FinanceRequest) => (
        <Space size="middle">
          <Button icon={<EyeOutlined />} onClick={() => { /* Implement view details logic here */ alert(JSON.stringify(record, null, 2)); }}>View</Button>
          {isFinanceUser && record.status === 'pending' && (
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => showApprovalModal(record)}>Approve/Decline</Button>
          )}
          {record.attachments && record.attachments.length > 0 && (
            <Button type="link" icon={<DownloadOutlined />} href={record.attachments[0].fileUrl} target="_blank">Quote</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Layout style={{ padding: 24 }}>
      <Helmet>
        <title>In-House Finance | Your Company Name</title>
      </Helmet>
      <Row gutter={[16, 16]} justify="space-between" align="middle" style={{ marginBottom: 20 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>In-House Finance</Title>
        </Col>
        <Col>
          <Button type="primary" icon={<PlusOutlined />} onClick={showModal}>
            Submit New Request
          </Button>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Card title="All Requests" loading={loading}>
            <Table
              dataSource={requests}
              columns={columns}
              rowKey="id"
              pagination={{ pageSize: 10 }}
            />
          </Card>
        </Col>
      </Row>

      {/* Request Submission Modal */}
      <Modal
        title="Submit New Finance Request"
        open={isModalVisible}
        onCancel={handleCancel}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmitRequest}
        >
          <Form.Item
            name="title"
            label="Request Title"
            rules={[{ required: true, message: 'Please enter a title' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="description"
            label="Description"
            rules={[{ required: true, message: 'Please provide a description' }]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item
            name="requestingDepartment"
            label="Your Department"
            initialValue={user?.departmentName || ''} // Pre-fill if user department is known
            rules={[{ required: true, message: 'Please select your department' }]}
          >
            <Input disabled={!!user?.departmentName} /> {/* Disable if pre-filled */}
          </Form.Item>
          <Form.Item
            name="requestedAmount"
            label="Requested Amount (R)"
            rules={[{ required: true, message: 'Please enter the requested amount' }]}
          >
            <Input type="number" min={0} step="0.01" />
          </Form.Item>
          <Form.Item
            name="justification"
            label="Justification"
            rules={[{ required: true, message: 'Please provide a justification' }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="dateNeeded"
            label="Date Needed By"
            rules={[{ required: true, message: 'Please select a date' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Upload Quote (Optional)">
            <Upload
              beforeUpload={() => false} // Prevent automatic upload
              onChange={handleFileChange}
              maxCount={1}
            >
              <Button icon={<UploadOutlined />}>Select File</Button>
            </Upload>
            {selectedFile && <Text type="secondary">{selectedFile.name}</Text>}
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading}>
              Submit Request
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* Approval Modal */}
      <Modal
        title="Approve / Decline Request"
        open={isApprovalModalVisible}
        onCancel={() => setIsApprovalModalVisible(false)}
        footer={null}
      >
        {currentRequest && (
          <div>
            <p><strong>Title:</strong> {currentRequest.title}</p>
            <p><strong>Department:</strong> {currentRequest.requestingDepartment}</p>
            <p><strong>Amount:</strong> R{currentRequest.requestedAmount?.toLocaleString()}</p>
            <p><strong>Description:</strong> {currentRequest.description}</p>
            <p><strong>Justification:</strong> {currentRequest.justification}</p>
            <p><strong>Date Needed:</strong> {dayjs(currentRequest.dateNeeded).format('YYYY-MM-DD')}</p>
            {currentRequest.attachments && currentRequest.attachments.length > 0 && (
              <p><strong>Quote:</strong> <a href={currentRequest.attachments[0].fileUrl} target="_blank" rel="noopener noreferrer">View Quote (Dummy URL)</a></p>
            )}
            <Divider />
            <Form form={approvalForm} layout="vertical">
              <Form.Item>
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  onClick={handleApproveRequest}
                  style={{ marginRight: 8 }}
                  loading={loading}
                >
                  Approve
                </Button>
                <Button
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={() => approvalForm.validateFields().then(handleDeclineRequest)}
                  loading={loading}
                >
                  Decline
                </Button>
              </Form.Item>
              <Form.Item
                name="declineReason"
                label="Decline Reason (if declining)"
                // Rule only applies if attempting to decline (could use a state to track intention, or rely on button press for validation)
                rules={[{ required: false, message: 'Please provide a reason for declining' }]}
              >
                <Input.TextArea rows={3} />
              </Form.Item>
            </Form>
          </div>
        )}
      </Modal>
    </Layout>
  );
};

export default InhouseFinanceDashboard;