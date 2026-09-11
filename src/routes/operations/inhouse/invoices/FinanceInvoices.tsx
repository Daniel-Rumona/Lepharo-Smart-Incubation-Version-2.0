import React, { useState } from "react";
import {
  Table,
  Tag,
  Button,
  Space,
  Typography,
  Row,
  Col,
  Modal,
  Upload,
  message
} from "antd";
import {
  UploadOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  DollarOutlined
} from "@ant-design/icons";

const { Title } = Typography;

const statusColors: Record<string, string> = {
  ready: "blue",
  processing: "orange",
  paid: "green"
};

// ✅ Dummy invoices
const dummyInvoices = [
  {
    id: "REQ020",
    department: "Legal",
    branch: "Lephalale",
    amount: 4200,
    status: "ready",
    invoiceFiles: [
      { name: "invoice_legal.pdf", url: "#" }
    ]
  },
  {
    id: "REQ021",
    department: "ROM",
    branch: "Kriel",
    amount: 9800,
    status: "processing",
    invoiceFiles: []
  }
];

const FinanceInvoices: React.FC = () => {
  const [invoices, setInvoices] = useState(dummyInvoices);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [viewModalVisible, setViewModalVisible] = useState(false);

  const handleMarkStatus = (record: any, newStatus: string) => {
    const updated = invoices.map((inv) =>
      inv.id === record.id ? { ...inv, status: newStatus } : inv
    );
    setInvoices(updated);
    message.success(
      newStatus === "processing"
        ? "Marked as Processing"
        : "Marked as Paid & Completed"
    );
  };

  const handleViewFiles = (record: any) => {
    setSelectedInvoice(record);
    setViewModalVisible(true);
  };

  const columns = [
    { title: "Request ID", dataIndex: "id", key: "id" },
    { title: "Department", dataIndex: "department", key: "department" },
    { title: "Branch", dataIndex: "branch", key: "branch" },
    {
      title: "Amount",
      dataIndex: "amount",
      key: "amount",
      render: (val: number) => `R ${val.toLocaleString()}`
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (status: string) => (
        <Tag color={statusColors[status]}>{status.toUpperCase()}</Tag>
      )
    },
    {
      title: "Invoices",
      key: "invoiceFiles",
      render: (_: any, record: any) =>
        record.invoiceFiles.length > 0 ? (
          <Button
            size="small"
            type="link"
            icon={<EyeOutlined />}
            onClick={() => handleViewFiles(record)}
          >
            View
          </Button>
        ) : (
          <Upload
            beforeUpload={(file) => {
              message.success(`${file.name} uploaded (dummy)!`);
              const updated = invoices.map((inv) =>
                inv.id === record.id
                  ? {
                      ...inv,
                      invoiceFiles: [
                        ...inv.invoiceFiles,
                        { name: file.name, url: "#" }
                      ]
                    }
                  : inv
              );
              setInvoices(updated);
              return false;
            }}
          >
            <Button size="small" icon={<UploadOutlined />}>
              Upload
            </Button>
          </Upload>
        )
    },
    {
      title: "Actions",
      key: "actions",
      render: (_: any, record: any) => (
        <Space>
          {record.status === "ready" && (
            <Button
              size="small"
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={() => handleMarkStatus(record, "processing")}
            >
              Start Processing
            </Button>
          )}
          {record.status === "processing" && (
            <Button
              size="small"
              type="primary"
              icon={<DollarOutlined />}
              onClick={() => handleMarkStatus(record, "paid")}
            >
              Mark Paid
            </Button>
          )}
        </Space>
      )
    }
  ];

  return (
    <div style={{ padding: 24, background: "#fff", minHeight: "100vh" }}>
      <Row justify="space-between" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={4}>Invoices & Processing</Title>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={invoices}
        rowKey="id"
        pagination={{ pageSize: 6 }}
      />

      <Modal
        title={`Invoice Files - ${selectedInvoice?.id}`}
        open={viewModalVisible}
        onCancel={() => setViewModalVisible(false)}
        footer={null}
      >
        {selectedInvoice?.invoiceFiles?.length ? (
          selectedInvoice.invoiceFiles.map((file: any, i: number) => (
            <p key={i}>
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

export default FinanceInvoices;
