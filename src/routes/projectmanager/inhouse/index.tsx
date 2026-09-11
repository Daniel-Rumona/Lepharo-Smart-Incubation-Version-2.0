import React, { useEffect, useState } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  DatePicker,
  Table,
  Button,
  Space,
  Typography,
  Tag,
  Modal,
  Select,
  Descriptions,
  Divider,
  Timeline,
  Empty
} from 'antd';
import { db } from '@/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import dayjs from 'dayjs';
import { completedAssignedInterventionsQuery, mapAssignedInterventionSnapshot } from '@/services/assignedInterventionService';
import { EyeOutlined } from '@ant-design/icons';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;
const { Option } = Select;

// --- helpers ---
const toDay = (val: any) => {
  if (!val) return null;
  // Firestore Timestamp
  if (val instanceof Timestamp || typeof val?.toDate === 'function') {
    const d = (val as Timestamp).toDate?.() ?? val.toDate();
    return dayjs(d);
  }
  // {seconds, nanoseconds}
  if (typeof val?.seconds === 'number') {
    return dayjs(new Date(val.seconds * 1000));
  }
  // string or Date
  return dayjs(val);
};
const fmt = (val: any, f = 'YYYY-MM-DD') => {
  const d = toDay(val);
  return d && d.isValid() ? d.format(f) : '—';
};
const statusColor = (s?: string) => {
  switch ((s || '').toLowerCase()) {
    case 'pending': return 'gold';
    case 'awaiting_purchase_approval': return 'gold';
    case 'quotation_submitted': return 'blue';
    case 'invoice_requested': return 'cyan';
    case 'invoice_uploaded': return 'purple';
    case 'invoice_approved': return 'geekblue';
    case 'ceo_approval': return 'orange';
    case 'completed': return 'green';
    case 'rejected': return 'red';
    default: return 'default';
  }
};

const PurchaseDashboard: React.FC = () => {
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().startOf('month'),
    dayjs().endOf('month')
  ]);
  const [requests, setRequests] = useState<any[]>([]);
  const [interventions, setInterventions] = useState<any[]>([]);
  const [viewModalVisible, setViewModalVisible] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(null);

  useEffect(() => {
    const [start, end] = dateRange;

    const qReq = query(
      collection(db, 'resourceRequests'),
      where('createdAt', '>=', Timestamp.fromDate(start.toDate())),
      where('createdAt', '<=', Timestamp.fromDate(end.toDate()))
    );
    const unsubReq = onSnapshot(qReq, snap => {
      setRequests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const qInt = completedAssignedInterventionsQuery();
    const unsubInt = onSnapshot(qInt, snap => {
      const startMs = start.startOf('day').valueOf();
      const endMs = end.endOf('day').valueOf();
      const completed = mapAssignedInterventionSnapshot(snap) as any[];
      setInterventions(completed.filter(row => {
        const value = row.completedAt || row.participantConfirmedAt || row.createdAt;
        const date = toDay(value);
        if (!date || !date.isValid()) return false;
        const time = date.valueOf();
        return time >= startMs && time <= endMs;
      }));
    });

    return () => {
      unsubReq();
      unsubInt();
    };
  }, [dateRange]);

  const requestCols = [
    { title: 'Resource', dataIndex: 'resourceName', key: 'resourceName' },
    { title: 'Requested By', dataIndex: 'requestedBy', key: 'requestedBy' },
    { title: 'Branch', dataIndex: 'branch', key: 'branch' },
    { title: 'Department', dataIndex: 'department', key: 'department' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (val: string) => <Tag color={statusColor(val)}>{val || '—'}</Tag>
    },
    {
      title: 'Needed By',
      dataIndex: 'neededBy',
      key: 'neededBy',
      render: (val: any) => fmt(val, 'YYYY-MM-DD')
    },
    {
      title: 'Action',
      key: 'action',
      render: (_: any, record: any) => (
        <Button
          icon={<EyeOutlined />}
          onClick={() => {
            setSelectedRequest(record);
            setViewModalVisible(true);
          }}
        />
      )
    }
  ];

  const filteredRequests = requests
    .filter(r => (branchFilter ? r.branch === branchFilter : true))
    .filter(r => (departmentFilter ? r.department === departmentFilter : true))
    .sort((a, b) => (b?.createdAt?.seconds || 0) - (a?.createdAt?.seconds || 0));

  // --- Charts (simple types only) ---
  const requestsByStatus = requests.reduce((acc, r) => {
    const key = r.status || 'Unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const statusChartOptions: Highcharts.Options = {
    chart: { type: 'column' },
    title: { text: 'Requests by Status' },
    xAxis: { categories: Object.keys(requestsByStatus) },
    yAxis: { title: { text: 'Count' }, allowDecimals: false },
    series: [{ type: 'column', name: 'Requests', data: Object.values(requestsByStatus) }],
    credits: { enabled: false }
  };

  const requestsByBranch = requests.reduce((acc, r) => {
    const key = r.branch || 'Unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const branchChartOptions: Highcharts.Options = {
    chart: { type: 'pie' },
    title: { text: 'Requests by Branch' },
    series: [{
      type: 'pie',
      name: 'Requests',
      data: Object.entries(requestsByBranch).map(([name, y]) => ({ name, y }))
    }],
    credits: { enabled: false }
  };

  // --- Pretty modal content ---
  const renderRequestDetails = (r: any) => {
    if (!r) return <Empty description="No request selected" />;
    return (
      <>
        <Descriptions
          bordered
          size="middle"
          column={1}
          labelStyle={{ width: 220, fontWeight: 500 }}
          contentStyle={{ background: '#fff' }}
        >
          <Descriptions.Item label="Resource">{r.resourceName || '—'}</Descriptions.Item>
          <Descriptions.Item label="Reason / Purpose">{r.reason || r.description || '—'}</Descriptions.Item>
          <Descriptions.Item label="Quantity">{r.quantity ?? '—'}</Descriptions.Item>

          <Descriptions.Item label="Requested By">{r.requestedBy || r.requesterEmail || '—'}</Descriptions.Item>
          <Descriptions.Item label="Request Type">{r.requestType || '—'}</Descriptions.Item>
          <Descriptions.Item label="Paid By">{r.paidBy || '—'}</Descriptions.Item>

          <Descriptions.Item label="Branch">{r.branch || r.branchCode || '—'}</Descriptions.Item>
          <Descriptions.Item label="Department">{r.department || '—'}</Descriptions.Item>

          <Descriptions.Item label="Status">
            <Tag color={statusColor(r.status)}>{r.status || '—'}</Tag>
          </Descriptions.Item>

          <Descriptions.Item label="Needed By">{fmt(r.neededBy, 'YYYY-MM-DD')}</Descriptions.Item>
          <Descriptions.Item label="Created At">{fmt(r.createdAt, 'YYYY-MM-DD HH:mm')}</Descriptions.Item>
          <Descriptions.Item label="Updated At">{fmt(r.updatedAt, 'YYYY-MM-DD HH:mm')}</Descriptions.Item>
          <Descriptions.Item label="Paid At">{fmt(r.paidAt, 'YYYY-MM-DD HH:mm')}</Descriptions.Item>

          {(r.requestDocUrl || r.quotationUrl || r.invoiceUrl || r.popUrl) && (
            <Descriptions.Item label="Attachments">
              <Space wrap>
                {r.requestDocUrl && <a href={r.requestDocUrl} target="_blank" rel="noreferrer">Request Doc</a>}
                {r.quotationUrl && <a href={r.quotationUrl} target="_blank" rel="noreferrer">Quotation</a>}
                {r.invoiceUrl && <a href={r.invoiceUrl} target="_blank" rel="noreferrer">Invoice</a>}
                {r.popUrl && <a href={r.popUrl} target="_blank" rel="noreferrer">Proof of Payment</a>}
              </Space>
            </Descriptions.Item>
          )}
        </Descriptions>

        <Divider />

        <Text strong>Progress</Text>
        <div style={{ marginTop: 8 }}>
          {Array.isArray(r.progress) && r.progress.length > 0 ? (
            <Timeline
              style={{ marginTop: 8 }}
              items={r.progress.map((p: any) => ({
                color: statusColor(p?.stage),
                children: (
                  <div>
                    <div style={{ fontWeight: 500 }}>{p?.stage || 'Stage'}</div>
                    <div style={{ fontSize: 12, color: '#666' }}>
                      {fmt(p?.timestamp, 'YYYY-MM-DD HH:mm')}
                      {p?.actor ? ` • by ${p.actor}` : ''}
                    </div>
                    {p?.note && (
                      <div style={{ marginTop: 4 }}>{p.note}</div>
                    )}
                  </div>
                )
              }))}
            />
          ) : (
            <Empty description="No progress history" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </div>
      </>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <Row justify='space-between' align='middle' style={{ marginBottom: 24 }}>
        <Col>
          <Title level={3}>📦 Purchase Person Dashboard</Title>
        </Col>
        <Col>
          <Space>
            <Select
              placeholder='Filter by Branch'
              allowClear
              onChange={val => setBranchFilter(val)}
              style={{ width: 180 }}
              value={branchFilter || undefined}
            >
              {[...new Set(requests.map(r => r.branch).filter(Boolean))].map(branch => (
                <Option key={branch} value={branch}>
                  {branch}
                </Option>
              ))}
            </Select>
            <Select
              placeholder='Filter by Department'
              allowClear
              onChange={val => setDepartmentFilter(val)}
              style={{ width: 180 }}
              value={departmentFilter || undefined}
            >
              {[...new Set(requests.map(r => r.department).filter(Boolean))].map(dep => (
                <Option key={dep} value={dep}>
                  {dep}
                </Option>
              ))}
            </Select>
            <RangePicker
              value={dateRange}
              onChange={val => setDateRange(val as [dayjs.Dayjs, dayjs.Dayjs])}
              allowClear={false}
            />
          </Space>
        </Col>
      </Row>

      {/* KPIs */}
      <Row gutter={16} style={{ marginBottom: 32 }}>
        <Col xs={24} md={8}>
          <Card><Statistic title='Total Requests' value={requests.length} /></Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic
              title='Completed Requests'
              value={requests.filter(r => (r.status || '').toLowerCase() === 'completed').length}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic
              title='Interventions Completed'
              value={interventions.length}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Charts */}
      <Row gutter={24} style={{ marginBottom: 24 }}>
        <Col xs={24} md={12}>
          <Card title="Requests by Status">
            <HighchartsReact highcharts={Highcharts} options={statusChartOptions} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Requests by Branch">
            <HighchartsReact highcharts={Highcharts} options={branchChartOptions} />
          </Card>
        </Col>
      </Row>

      {/* Requests Table */}
      <Card title='📋 All Requests'>
        <Table
          dataSource={filteredRequests}
          columns={requestCols}
          rowKey='id'
          pagination={{ pageSize: 10, showSizeChanger: true }}
        />
      </Card>

      {/* View Modal (pretty) */}
      <Modal
        open={viewModalVisible}
        onCancel={() => setViewModalVisible(false)}
        title='Request Details'
        width={720}
        footer={
          <Button type="primary" onClick={() => setViewModalVisible(false)}>
            Close
          </Button>
        }
      >
        {renderRequestDetails(selectedRequest)}
      </Modal>
    </div>
  );
};

export default PurchaseDashboard;
