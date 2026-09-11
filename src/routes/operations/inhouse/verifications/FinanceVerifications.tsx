import React, { useState } from "react";
import {
  Table,
  Tag,
  Button,
  Modal,
  Space,
  Typography,
  Row,
  Col,
  message,
  Upload,
} from "antd";
import {
  CheckCircleOutlined,
  BellOutlined,
  EyeOutlined,
  UploadOutlined,
} from "@ant-design/icons";

const { Title } = Typography;

// ✅ Dummy verification requests
const dummyVerifications = [
  {
    id: "REQ010",
    department: "Legal",
    branch: "Lephalale",
    requestType: "Goods",
    description: "Purchase of compliance legal documents",
    amount: 4200,
    status: "verification",
    verificationNote: "Upload the signed quote from supplier.",
    movFiles: [
      {
        name: "quote_legal.pdf",
        url: "#",
      },
    ],
  },
  {
    id: "REQ011",
    department: "ROM",
    branch: "Kriel",
    requestType: "Finance",
    description: "Logistics for workshop",
    amount: 9800,
    status: "verification",
    verificationNote: "Provide updated MOV for catering supplier.",
    movFiles: [],
  },
];

const FinanceVerifications: React.FC = () => {
  const [verifications, setVerifications] = useState(dummyVerifications);
  const [viewModalVisible, setViewModalVisible] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);

  const handleMarkVerified = (record: any) => {
    const updated = verifications.map((v) =>
      v.id === record.id ? { ...v, status: "approved" } : v
    );
    setVerifications(updated);
    message.success("Marked as Verified & Approved!");
  };

  const handleSendReminder = (record: any) => {
    message.info(`Reminder sent to requester for ${record.id}`);
  };

  const handleViewFiles = (record: any) => {
    setSelectedRequest(record);
    setViewModalVisible(true);
  };

  const columns = [
    {
      title: "Request ID",
      dataIndex: "id",
      key: "id",
    },
    {
      title: "Department",
      dataIndex: "department",
      key: "department",
    },
    {
      title: "Branch",
      dataIndex: "branch",
      key: "branch",
    },
    {
      title: "Description",
      dataIndex: "description",
      key: "description",
    },
    {
      title: "Verification Note",
      dataIndex: "verificationNote",
      key: "verificationNote",
    },
    {
      title: "MOV / Quotes",
      key: "mov",
      render: (_: any, record: any) =>
        record.movFiles.length > 0 ? (
          <Button
            size="small"
            type="link"
            icon={<EyeOutlined />}
            onClick={() => handleViewFiles(record)}
          >
            View
          </Button>
        ) : (
          <Tag color="red">Not Uploaded</Tag>
        ),
    },
    {
      title: "Actions",
      key: "actions",
      render: (_: any, record: any) => (
        <Space>
          <Button
            size="small"
            type="primary"
            icon={<CheckCircleOutlined />}
            onClick={() => handleMarkVerified(record)}
            disabled={record.movFiles.length === 0}
          >
            Mark Verified
          </Button>
          <Button
            size="small"
            icon={<BellOutlined />}
            onClick={() => handleSendReminder(record)}
          >
            Send Reminder
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, background: "#fff", minHeight: "100vh" }}>
      <Row justify="space-between" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={4}>Verifications & Supporting Documents</Title>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={verifications.filter((v) => v.status === "verification")}
        rowKey="id"
        pagination={{ pageSize: 6 }}
      />

      {/* View MOV / Quotes Modal */}
      <Modal
        title={`Uploaded MOV/Quotes - ${selectedRequest?.id}`}
        open={viewModalVisible}
        onCancel={() => setViewModalVisible(false)}
        footer={null}
      >
        {selectedRequest?.movFiles?.length ? (
          selectedRequest.movFiles.map((file: any, index: number) => (
            <p key={index}>
              <a href={file.url} target="_blank" rel="noopener noreferrer">
                {file.name}
              </a>
            </p>
          ))
        ) : (
          <p>No files uploaded yet.</p>
        )}
      </Modal>
    </div>
  );
};

export default FinanceVerifications;
