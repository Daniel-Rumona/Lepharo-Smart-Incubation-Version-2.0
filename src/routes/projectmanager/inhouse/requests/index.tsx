import React, { useEffect, useState } from 'react';
import {
  Card, Row, Col, Typography, Alert, Statistic, Table, Button, Modal,
  Form, Input, Upload, Select, Tag, Space, DatePicker, message, Descriptions, Dropdown
} from 'antd';
import {
  UploadOutlined, FileDoneOutlined, ClockCircleOutlined,
  FileTextOutlined, CheckCircleOutlined, ArrowUpOutlined, EyeOutlined, DownOutlined
} from '@ant-design/icons';
import { db, storage } from '@/firebase';
import {
  collection, query, where, onSnapshot, updateDoc, doc, Timestamp
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useFullIdentity } from '@/hooks/src/useFullIdentity';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;
const { Option } = Select;
const { Text } = Typography;

// helpers
const norm = (s?: string) => (s || '').toLowerCase().replace(/\s+/g, '_');
const normUpload = (e: any) => (Array.isArray(e) ? e : e?.fileList || []);
const fmt = (val: any, f = 'YYYY-MM-DD') => {
  if (!val) return '-';
  if (val?.seconds) return dayjs(new Date(val.seconds * 1000)).format(f);
  try {
    return dayjs(val).format(f);
  } catch {
    return String(val ?? '-');
  }
};

// statuses
export const STATUS = {
  PENDING_PURCHASE_APPROVAL: 'pending_purchase_approval',
  PENDING_QUOTATION: 'pending_quotation',
  QUOTATION_SUBMITTED: 'quotation_submitted',
  PENDING_FINANCE_REVIEW: 'pending_finance_review',
  INVOICE_REQUESTED: 'invoice_requested',
  INVOICE_UPLOADED: 'invoice_uploaded',
  PENDING_CEO_APPROVAL: 'pending_ceo_approval',
  INVOICE_APPROVED: 'invoice_approved',
  PENDING_HR_PAYMENT: 'pending_hr_payment',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  SUPPORT: 'support'
} as const;

// button labels
const actionLabels: Record<string, string> = {
  [STATUS.PENDING_PURCHASE_APPROVAL]: 'Review | Approve',
  [STATUS.PENDING_QUOTATION]: 'Upload Quotation',
  [STATUS.QUOTATION_SUBMITTED]: 'Escalate to Finance',
  [STATUS.INVOICE_REQUESTED]: 'Upload Invoice'
};

// helper text in modal
const alertMessages: Record<string, string> = {
  [STATUS.PENDING_PURCHASE_APPROVAL]: 'Review the request and either approve or reject it.',
  [STATUS.PENDING_QUOTATION]: 'Upload a quotation file for the requested items.',
  [STATUS.QUOTATION_SUBMITTED]: 'Escalate this request to Finance for review.',
  [STATUS.INVOICE_REQUESTED]: 'Upload the invoice file for this request.'
};

// upload labels
const fileLabels: Record<string, string> = {
  [STATUS.PENDING_QUOTATION]: 'Quotation File',
  [STATUS.INVOICE_REQUESTED]: 'Invoice File'
};

const PurchaseRequestProcessor = () => {
  const [requests, setRequests] = useState<any[]>([]);
  const [filtered, setFiltered] = useState<any[]>([]);
  const [dateRange, setDateRange] = useState<[any, any]>([
    dayjs().startOf('month'), dayjs().endOf('month')
  ]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [actionModal, setActionModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [form] = Form.useForm();
  const { user } = useFullIdentity();

  useEffect(() => {
    const q = query(
      collection(db, 'resourceRequests'),
      where('createdAt', '>=', Timestamp.fromDate(dateRange[0].toDate())),
      where('createdAt', '<=', Timestamp.fromDate(dateRange[1].toDate())),
      where('requestType', '==', 'internal')
    );
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRequests(data);
    });
    return () => unsub();
  }, [dateRange]);

  useEffect(() => {
    setFiltered(
      requests.filter(r => {
        const matchStatus = !statusFilter || norm(r.status) === norm(statusFilter);
        const matchSearch = !search || r.resourceName?.toLowerCase().includes(search.toLowerCase());
        return matchStatus && matchSearch;
      })
      .sort((a, b) => (b?.createdAt?.seconds || 0) - (a?.createdAt?.seconds || 0))
    );
  }, [requests, statusFilter, search]);

  const handleAction = (record: any) => {
    setSelectedRequest(record);
    setActionModal(true);
    form.resetFields();
  };

  // upload to single folder, return URL only
  const uploadFile = async (file: File) => {
    const storageRef = ref(storage, `invoicesandquotations/${Date.now()}_${file.name}`);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  const handleSubmit = async (values: any) => {
    if (!selectedRequest) return;
    try {
      setUploading(true);

      const current = norm(selectedRequest.status);

      // next states from Purchases perspective
      const nextStatusMap: Record<string, string> = {
        [STATUS.PENDING_PURCHASE_APPROVAL]: STATUS.PENDING_QUOTATION,
        [STATUS.PENDING_QUOTATION]: STATUS.QUOTATION_SUBMITTED,
        [STATUS.QUOTATION_SUBMITTED]: STATUS.PENDING_FINANCE_REVIEW, // escalate
        [STATUS.INVOICE_REQUESTED]: STATUS.INVOICE_UPLOADED            // upload invoice
      };

      // what file field to write (if any)
      const fileFieldMap: Record<string, string> = {
        [STATUS.PENDING_QUOTATION]: 'quotationFile',
        [STATUS.INVOICE_REQUESTED]: 'invoiceFile'
      };

      const newStatus = nextStatusMap[current];
      const fileField = fileFieldMap[current];

      const patch: any = {
        status: newStatus,
        progress: [
          ...(selectedRequest.progress || []),
          { stage: newStatus, timestamp: Timestamp.now(), actor: user?.fullName || 'Purchases' }
        ],
        lastModifiedAt: Timestamp.now()
      };

      if (fileField) {
        const fileList = (values?.file || []) as any[];
        const fileObj = fileList?.[0]?.originFileObj as File | undefined;
        if (!fileObj) {
          message.error('Please upload a file before submitting.');
          setUploading(false);
          return;
        }
        const url = await uploadFile(fileObj);
        patch[fileField] = url; // URL only
      }

      await updateDoc(doc(db, 'resourceRequests', selectedRequest.id), patch);
      message.success('Request updated successfully');
      setActionModal(false);
    } catch (err) {
      console.error(err);
      message.error('Failed to update request');
    } finally {
      setUploading(false);
    }
  };

  const statusLabels: Record<string, { label: string; color: string }> = {
    [STATUS.PENDING_PURCHASE_APPROVAL]: { label: 'Awaiting Approval', color: 'orange' },
    [STATUS.PENDING_QUOTATION]: { label: 'Pending Quotation', color: 'gold' },
    [STATUS.QUOTATION_SUBMITTED]: { label: 'Quotation Submitted', color: 'blue' },
    [STATUS.PENDING_FINANCE_REVIEW]: { label: 'Pending Finance Review', color: 'cyan' },
    [STATUS.INVOICE_REQUESTED]: { label: 'Invoice Requested', color: 'geekblue' },
    [STATUS.INVOICE_UPLOADED]: { label: 'Invoice Uploaded', color: 'purple' },
    [STATUS.PENDING_CEO_APPROVAL]: { label: 'Awaiting CEO Approval', color: 'volcano' },
    [STATUS.INVOICE_APPROVED]: { label: 'Invoice Approved', color: 'lime' },
    [STATUS.PENDING_HR_PAYMENT]: { label: 'Awaiting HR Payment', color: 'magenta' },
    [STATUS.COMPLETED]: { label: 'Completed', color: 'green' },
    [STATUS.REJECTED]: { label: 'Rejected', color: 'red' },
    [STATUS.SUPPORT]: { label: 'Support Docs Requested', color: 'processing' }
  };

  // ---------- helper: a single dropdown for Quotation / Invoice / POP ----------
  const renderFilesDropdown = (r: any) => {
    const anyFile = r?.quotationFile || r?.invoiceFile || r?.popFile;
    if (!anyFile) return <Tag>—</Tag>;

    const items = [
      { key: 'quotation', label: 'Quotation', disabled: !r?.quotationFile },
      { key: 'invoice',   label: 'Invoice',   disabled: !r?.invoiceFile },
      { key: 'pop',       label: 'Proof of Payment', disabled: !r?.popFile },
    ];

    const onClick = ({ key }: { key: string }) => {
      const map: Record<string, string | undefined> = {
        quotation: r?.quotationFile,
        invoice: r?.invoiceFile,
        pop: r?.popFile,
      };
      const href = map[key];
      if (href) window.open(href, '_blank', 'noopener,noreferrer');
    };

    return (
      <Dropdown menu={{ items, onClick }} trigger={['click']}>
        <Button size="small" icon={<EyeOutlined />}>
          View <DownOutlined />
        </Button>
      </Dropdown>
    );
  };
  // ---------------------------------------------------------------------------

  return (
    <div style={{ padding: 24, minHeight: '100vh' }}>
      <Alert
        type='info'
        message='Purchases Workflow'
        description='Approve, upload quotation, escalate to Finance, and (when requested) upload the invoice. Files are stored together in invoicesandquotations/. You can also see Invoice & POP when paid.'
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card><Statistic title='Total Requests' value={requests.length} prefix={<FileDoneOutlined />} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title='Awaiting Approval' value={requests.filter(r => norm(r.status) === STATUS.PENDING_PURCHASE_APPROVAL).length} prefix={<ClockCircleOutlined />} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title='Quotations Submitted' value={requests.filter(r => norm(r.status) === STATUS.QUOTATION_SUBMITTED).length} prefix={<FileTextOutlined />} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title='Completed (Paid)' value={requests.filter(r => norm(r.status) === STATUS.COMPLETED || !!r.popFile).length} prefix={<CheckCircleOutlined />} /></Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16 }} wrap>
        <RangePicker value={dateRange} onChange={val => setDateRange(val as [any, any])} />
        <Select placeholder='Filter by Status' allowClear onChange={val => setStatusFilter(val || '')} style={{ width: 220 }}>
          {Object.keys(statusLabels).map(key => (
            <Option key={key} value={key}>{statusLabels[key].label}</Option>
          ))}
        </Select>
        <Input.Search placeholder='Search resource...' allowClear onChange={e => setSearch(e.target.value)} style={{ width: 300 }} />
      </Space>

      <Table
        dataSource={filtered}
        rowKey='id'
        columns={[
          // 👇 ID column removed (kept as rowKey only)
          { title: 'Resource', dataIndex: 'resourceName' },
          { title: 'Requested By', dataIndex: 'requestedBy' },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (_: any, record: any) => {
              const canon = norm(record.status);
              const status = statusLabels[canon];
              return (
                <Space size="small" wrap>
                  {status ? <Tag color={status.color}>{status.label}</Tag> : <Tag>{record.status}</Tag>}
                  {record.popFile && <Tag color="green">PAID</Tag>}
                </Space>
              );
            }
          },
          {
            title: 'Files',
            key: 'files',
            render: (_: any, r: any) => renderFilesDropdown(r)
          },
          {
            title: 'Needed By',
            dataIndex: 'neededBy',
            render: (val: any) => fmt(val, 'YYYY-MM-DD')
          },
          {
            title: 'Action',
            render: (_: any, record: any) => {
              const s = norm(record.status);
              if (s === STATUS.COMPLETED || record.popFile) {
                return <Tag color="green">No Actions</Tag>;
              }
              if (s === STATUS.QUOTATION_SUBMITTED) {
                return (
                  <Button type='dashed' icon={<ArrowUpOutlined />} onClick={() => handleAction(record)}>
                    Escalate to Finance
                  </Button>
                );
              }
              const label = actionLabels[s] || actionLabels[record.status as string];
              return label ? (
                <Button type='primary' onClick={() => handleAction(record)}>{label}</Button>
              ) : (
                <Button onClick={() => handleAction(record)}>Actions</Button>
              );
            }
          }
        ]}
        pagination={{ pageSize: 10, showSizeChanger: true }}
      />

      <Modal open={actionModal} onCancel={() => setActionModal(false)} footer={null} title='Process Request'>
        {selectedRequest && (
          <>
            <Alert
              type='info'
              message={alertMessages[norm(selectedRequest.status)] || 'Process this request'}
              showIcon
              style={{ marginBottom: 12 }}
            />

            <Descriptions column={1} size='small' bordered>
              <Descriptions.Item label='Resource'>{selectedRequest.resourceName || '-'}</Descriptions.Item>
              <Descriptions.Item label='Purpose'>{selectedRequest.purpose || 'N/A'}</Descriptions.Item>
              <Descriptions.Item label='Requested By'>{selectedRequest.requestedBy || selectedRequest.requesterEmail || '-'}</Descriptions.Item>
              <Descriptions.Item label='Request Type'>{selectedRequest.requestType || '-'}</Descriptions.Item>
              <Descriptions.Item label='Branch'>{selectedRequest.branch || selectedRequest.branchCode || '-'}</Descriptions.Item>
              <Descriptions.Item label='Department'>{selectedRequest.department || '-'}</Descriptions.Item>
              <Descriptions.Item label='Status'>
                <Tag color={statusLabels[norm(selectedRequest.status)]?.color || 'default'}>
                  {statusLabels[norm(selectedRequest.status)]?.label || selectedRequest.status || '-'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label='Needed By'>{fmt(selectedRequest.neededBy, 'YYYY-MM-DD')}</Descriptions.Item>
              <Descriptions.Item label='Created At'>{fmt(selectedRequest.createdAt, 'YYYY-MM-DD HH:mm')}</Descriptions.Item>
              <Descriptions.Item label='Updated At'>{fmt(selectedRequest.updatedAt, 'YYYY-MM-DD HH:mm')}</Descriptions.Item>
              <Descriptions.Item label='Paid At'>{fmt(selectedRequest.paidAt, 'YYYY-MM-DD HH:mm')}</Descriptions.Item>

              {(selectedRequest.quotationFile || selectedRequest.invoiceFile || selectedRequest.popFile) && (
                <Descriptions.Item label="Files">
                  {renderFilesDropdown(selectedRequest)}
                </Descriptions.Item>
              )}
            </Descriptions>

            <Form layout='vertical' form={form} onFinish={handleSubmit} style={{ marginTop: 16 }}>
              {norm(selectedRequest.status) === STATUS.PENDING_PURCHASE_APPROVAL ? (
                <Space>
                  <Button type='primary' htmlType='submit'>Approve Request</Button>
                  <Button
                    danger
                    onClick={async () => {
                      try {
                        await updateDoc(doc(db, 'resourceRequests', selectedRequest.id), {
                          status: STATUS.REJECTED,
                          progress: [
                            ...(selectedRequest.progress || []),
                            { stage: STATUS.REJECTED, timestamp: Timestamp.now(), actor: user?.fullName || 'Purchases' }
                          ],
                          lastModifiedAt: Timestamp.now()
                        });
                        message.success('Request rejected successfully');
                        setActionModal(false);
                      } catch (err) {
                        console.error(err);
                        message.error('Failed to reject request');
                      }
                    }}
                  >
                    Reject Request
                  </Button>
                </Space>
              ) : norm(selectedRequest.status) === STATUS.QUOTATION_SUBMITTED ? (
                <Button type='primary' htmlType='submit'>Escalate to Finance</Button>
              ) : (
                (norm(selectedRequest.status) === STATUS.PENDING_QUOTATION ||
                 norm(selectedRequest.status) === STATUS.INVOICE_REQUESTED) && (
                  <>
                    <Form.Item
                      name='file'
                      label={fileLabels[norm(selectedRequest.status)] || 'Upload File'}
                      valuePropName='fileList'
                      getValueFromEvent={normUpload}
                      rules={[{ required: true, message: 'Please upload a file.' }]}
                    >
                      <Upload beforeUpload={() => false} maxCount={1}>
                        <Button icon={<UploadOutlined />}>Upload File</Button>
                      </Upload>
                    </Form.Item>
                    <Form.Item>
                      <Button type='primary' htmlType='submit' loading={uploading}>Submit</Button>
                    </Form.Item>
                  </>
                )
              )}
            </Form>
          </>
        )}
      </Modal>
    </div>
  );
};

export default PurchaseRequestProcessor;
