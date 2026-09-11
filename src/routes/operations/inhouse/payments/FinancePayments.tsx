import React, { useState } from "react";
import {
  Table,
  Typography,
  Row,
  Col,
  Select,
  Tag
} from "antd";

const { Title } = Typography;
const { Option } = Select;

const dummyPayments = [
  {
    id: "REQ020",
    invoiceNo: "INV001",
    department: "Legal",
    branch: "Lephalale",
    amount: 4200,
    date: "2025-07-10"
  },
  {
    id: "REQ021",
    invoiceNo: "INV002",
    department: "ROM",
    branch: "Kriel",
    amount: 9800,
    date: "2025-07-15"
  }
];

const FinancePayments: React.FC = () => {
  const [filterDept, setFilterDept] = useState("all");
  const filtered = filterDept === "all"
    ? dummyPayments
    : dummyPayments.filter((p) => p.department === filterDept);

  const columns = [
    { title: "Request ID", dataIndex: "id", key: "id" },
    { title: "Invoice No.", dataIndex: "invoiceNo", key: "invoiceNo" },
    { title: "Department", dataIndex: "department", key: "department" },
    { title: "Branch", dataIndex: "branch", key: "branch" },
    {
      title: "Amount",
      dataIndex: "amount",
      key: "amount",
      render: (val: number) => <Tag color="green">R {val.toLocaleString()}</Tag>
    },
    { title: "Date Paid", dataIndex: "date", key: "date" }
  ];

  return (
    <div style={{ padding: 24, background: "#fff", minHeight: "100vh" }}>
      <Row justify="space-between" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={4}>Payments Tracker</Title>
        </Col>
        <Col>
          <Select
            value={filterDept}
            onChange={(val) => setFilterDept(val)}
            style={{ width: 200 }}
          >
            <Option value="all">All Departments</Option>
            <Option value="Legal">Legal</Option>
            <Option value="ROM">ROM</Option>
          </Select>
        </Col>
      </Row>
      <Table columns={columns} dataSource={filtered} rowKey="invoiceNo" />
    </div>
  );
};

export default FinancePayments;
