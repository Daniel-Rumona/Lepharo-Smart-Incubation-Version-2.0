// import React, { useState } from 'react'
// import {
//   Card,
//   Statistic,
//   Table,
//   Typography,
//   Upload,
//   Button,
//   Modal,
//   Form,
//   Select,
//   Input,
//   message,
//   Row,
//   Col,
//   DatePicker,
//   Space,
//   Tag,
//   Descriptions,
//   Alert
// } from 'antd'
// import {
//   UploadOutlined,
//   PlusOutlined,
//   EyeOutlined,
//   SmileOutlined,
//   FilterOutlined,
//   TeamOutlined,
//   CheckCircleOutlined,
//   ClockCircleOutlined,
//   FileDoneOutlined,
//   LaptopOutlined,
//   UserOutlined
// } from '@ant-design/icons'
// import { motion } from 'framer-motion'
// import dayjs from 'dayjs'

// const { Text } = Typography
// const { Option } = Select
// const { RangePicker } = DatePicker

// const PDSWellnessInterventionPage = () => {
//   const [participants] = useState([
//     { id: '1', name: 'Jane Doe', branch: 'Rusternberg', company: 'ABC Corp' },
//     { id: '2', name: 'John Smith', branch: 'Springs', company: 'XYZ Ltd' },
//     {
//       id: '3',
//       name: 'Alice Johnson',
//       branch: 'Khutsong',
//       company: '123 Industries'
//     },
//     {
//       id: '4',
//       name: 'Bob Williams',
//       branch: 'Rusternberg',
//       company: 'ABC Corp'
//     }
//   ])

//   const [form] = Form.useForm()
//   const [visible, setVisible] = useState(false)
//   const [file, setFile] = useState(null)
//   const [viewModal, setViewModal] = useState(null)
//   const [filters, setFilters] = useState({
//     participant: null,
//     dateRange: null,
//     branch: null,
//     deliveryMethod: null
//   })

//   const [interventions, setInterventions] = useState([
//     {
//       id: 'int1',
//       participant: 'Jane Doe',
//       branch: 'Rusternberg',
//       company: 'ABC Corp',
//       completedAt: '2025-08-01',
//       status: 'confirmed',
//       summary: 'Submitted notes after one-on-one check-in.',
//       type: 'One-on-One',
//       deliveryMethod: 'in-person',
//       location: 'Office Meeting Room 3'
//     },
//     {
//       id: 'int2',
//       participant: 'John Smith',
//       branch: 'Springs',
//       company: 'XYZ Ltd',
//       completedAt: '2025-08-02',
//       status: 'confirmed',
//       summary: 'Group session focused on emotional resilience.',
//       type: 'Group Session',
//       deliveryMethod: 'online',
//       meetingLink: 'https://zoom.us/j/123456789'
//     },
//     {
//       id: 'int3',
//       participant: 'Alice Johnson',
//       branch: 'Khutsong',
//       company: '123 Industries',
//       completedAt: '2025-08-05',
//       status: 'pending',
//       summary: 'Initial assessment completed, awaiting confirmation.',
//       type: 'Assessment',
//       deliveryMethod: 'online',
//       meetingLink: 'https://teams.microsoft.com/l/meetup-join/12345'
//     }
//   ])

//   const handleSubmit = values => {
//     const newItem = {
//       id: `int${interventions.length + 1}`,
//       ...values,
//       branch: participants.find(p => p.name === values.participant)?.branch,
//       company: participants.find(p => p.name === values.participant)?.company,
//       completedAt: values.completedAt.format('YYYY-MM-DD'),
//       status: 'pending', // New interventions start as pending
//       summary: values.summary || '',
//       location: values.deliveryMethod === 'in-person' ? values.location : null,
//       meetingLink:
//         values.deliveryMethod === 'online' ? values.meetingLink : null
//     }
//     setInterventions([...interventions, newItem])
//     message.success('✅ Intervention recorded successfully')
//     setVisible(false)
//     form.resetFields()
//     setFile(null)
//   }

//   const handleFilter = () => {
//     form.submit()
//   }

//   const handleResetFilters = () => {
//     setFilters({
//       participant: null,
//       dateRange: null,
//       branch: null,
//       deliveryMethod: null
//     })
//   }

//   const filteredInterventions = interventions.filter(intervention => {
//     return (
//       (!filters.participant ||
//         intervention.participant === filters.participant) &&
//       (!filters.branch || intervention.branch === filters.branch) &&
//       (!filters.deliveryMethod ||
//         intervention.deliveryMethod === filters.deliveryMethod) &&
//       (!filters.dateRange ||
//         (dayjs(intervention.completedAt).isAfter(filters.dateRange[0]) &&
//           dayjs(intervention.completedAt).isBefore(filters.dateRange[1])))
//     )
//   })

//   const branches = [...new Set(participants.map(p => p.branch))]
//   const confirmedCount = interventions.filter(
//     i => i.status === 'confirmed'
//   ).length
//   const pendingCount = interventions.filter(i => i.status === 'pending').length
//   const uniqueParticipants = [...new Set(interventions.map(i => i.participant))]
//     .length
//   const onlineCount = interventions.filter(
//     i => i.deliveryMethod === 'online'
//   ).length
//   const inPersonCount = interventions.filter(
//     i => i.deliveryMethod === 'in-person'
//   ).length

//   return (
//     <div style={{ minHeight: '100vh', padding: 24 }}>
//       <Alert
//         message='Track Interventions'
//         description='Record and track completed wellness interventions with participants.'
//         type='info'
//         showIcon
//         style={{ marginBottom: 24 }}
//       />

//       {/* Metrics Section */}
//       <motion.div
//         initial='hidden'
//         animate='visible'
//         variants={{
//           hidden: { opacity: 0 },
//           visible: {
//             opacity: 1,
//             transition: { staggerChildren: 0.1 }
//           }
//         }}
//         style={{ marginBottom: 24 }}
//       >
//         <Row gutter={16}>
//           <Col xs={24} sm={6}>
//             <motion.div
//               variants={{
//                 hidden: { opacity: 0, y: 10 },
//                 visible: { opacity: 1, y: 0, transition: { duration: 0.4 } }
//               }}
//             >
//               <Card
//                 hoverable
//                 style={{
//                   boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
//                   borderRadius: 8,
//                   border: '1px solid #d6e4ff',
//                   height: '100%'
//                 }}
//               >
//                 <Statistic
//                   title={
//                     <>
//                       <TeamOutlined /> Total Participants
//                     </>
//                   }
//                   value={uniqueParticipants}
//                   valueStyle={{ color: '#1890ff' }}
//                 />
//               </Card>
//             </motion.div>
//           </Col>

//           <Col xs={24} sm={6}>
//             <motion.div
//               variants={{
//                 hidden: { opacity: 0, y: 10 },
//                 visible: {
//                   opacity: 1,
//                   y: 0,
//                   transition: { duration: 0.4, delay: 0.1 }
//                 }
//               }}
//             >
//               <Card
//                 hoverable
//                 style={{
//                   boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
//                   borderRadius: 8,
//                   border: '1px solid #d6e4ff',
//                   height: '100%'
//                 }}
//               >
//                 <Statistic
//                   title={
//                     <>
//                       <CheckCircleOutlined /> Confirmed
//                     </>
//                   }
//                   value={confirmedCount}
//                   valueStyle={{ color: '#52c41a' }}
//                 />
//               </Card>
//             </motion.div>
//           </Col>

//           <Col xs={24} sm={6}>
//             <motion.div
//               variants={{
//                 hidden: { opacity: 0, y: 10 },
//                 visible: {
//                   opacity: 1,
//                   y: 0,
//                   transition: { duration: 0.4, delay: 0.2 }
//                 }
//               }}
//             >
//               <Card
//                 hoverable
//                 style={{
//                   boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
//                   borderRadius: 8,
//                   border: '1px solid #d6e4ff',
//                   height: '100%'
//                 }}
//               >
//                 <Statistic
//                   title={
//                     <>
//                       <ClockCircleOutlined /> Pending
//                     </>
//                   }
//                   value={pendingCount}
//                   valueStyle={{ color: '#faad14' }}
//                 />
//               </Card>
//             </motion.div>
//           </Col>

//           <Col xs={24} sm={6}>
//             <motion.div
//               variants={{
//                 hidden: { opacity: 0, y: 10 },
//                 visible: {
//                   opacity: 1,
//                   y: 0,
//                   transition: { duration: 0.4, delay: 0.3 }
//                 }
//               }}
//             >
//               <Card
//                 hoverable
//                 style={{
//                   boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
//                   borderRadius: 8,
//                   border: '1px solid #d6e4ff',
//                   height: '100%'
//                 }}
//               >
//                 <Statistic
//                   title={
//                     <>
//                       <FileDoneOutlined /> Total
//                     </>
//                   }
//                   value={interventions.length}
//                   valueStyle={{ color: '#722ed1' }}
//                 />
//               </Card>
//             </motion.div>
//           </Col>
//         </Row>
//       </motion.div>
//       {/* Filters Section */}
//       <motion.div
//         initial={{ opacity: 0, y: -20 }}
//         animate={{ opacity: 1, y: 0 }}
//         transition={{ duration: 0.5 }}
//       >
//         <Card
//           style={{
//             marginBottom: 24,
//             borderRadius: 8,
//             boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
//           }}
//         >
//           <Form layout='vertical' onFinish={handleFilter}>
//             <Row gutter={[16, 16]} responsive>
//               <Col xs={24} sm={12} md={6}>
//                 <Form.Item label='Participant'>
//                   <Select
//                     placeholder='Select participant'
//                     allowClear
//                     value={filters.participant}
//                     onChange={val =>
//                       setFilters({ ...filters, participant: val })
//                     }
//                     style={{ width: '100%' }}
//                   >
//                     {participants.map(p => (
//                       <Option key={p.id} value={p.name}>
//                         {p.name} ({p.company})
//                       </Option>
//                     ))}
//                   </Select>
//                 </Form.Item>
//               </Col>

//               <Col xs={24} sm={12} md={6}>
//                 <Form.Item label='Branch'>
//                   <Select
//                     placeholder='Select branch'
//                     allowClear
//                     value={filters.branch}
//                     onChange={val => setFilters({ ...filters, branch: val })}
//                     style={{ width: '100%' }}
//                   >
//                     {branches.map(branch => (
//                       <Option key={branch} value={branch}>
//                         {branch}
//                       </Option>
//                     ))}
//                   </Select>
//                 </Form.Item>
//               </Col>

//               <Col xs={24} sm={12} md={6}>
//                 <Form.Item label='Delivery Method'>
//                   <Select
//                     placeholder='Select method'
//                     allowClear
//                     value={filters.deliveryMethod}
//                     onChange={val =>
//                       setFilters({ ...filters, deliveryMethod: val })
//                     }
//                     style={{ width: '100%' }}
//                   >
//                     <Option value='online'>Online</Option>
//                     <Option value='in-person'>In-Person</Option>
//                   </Select>
//                 </Form.Item>
//               </Col>

//               <Col xs={24} sm={12} md={6}>
//                 <Form.Item label='Date Range'>
//                   <RangePicker
//                     style={{ width: '100%' }}
//                     onChange={dates =>
//                       setFilters({ ...filters, dateRange: dates })
//                     }
//                   />
//                 </Form.Item>
//               </Col>

//               <Col span={24} style={{ textAlign: 'right' }}>
//                 <Button
//                   type='primary'
//                   htmlType='submit'
//                   style={{ marginRight: 8 }}
//                 >
//                   Apply Filters
//                 </Button>

//                 <Button onClick={handleResetFilters}>Reset</Button>
//               </Col>
//             </Row>
//           </Form>
//         </Card>
//       </motion.div>
//       {/* Intervention Log Table */}
//       <motion.div
//         initial={{ opacity: 0, y: 10 }}
//         animate={{ opacity: 1, y: 0 }}
//         transition={{ duration: 0.4 }}
//       >
//         <Card
//           title={
//             <>
//               <FileDoneOutlined /> Intervention Log
//             </>
//           }
//           extra={
//             <>
//               <Text type='secondary'>
//                 Showing {filteredInterventions.length} of {interventions.length}{' '}
//                 records
//               </Text>
//               <Button
//                 type='primary'
//                 icon={<PlusOutlined />}
//                 onClick={() => setVisible(true)}
//                 style={{ marginLeft: 15 }}
//               >
//                 Record Intervention
//               </Button>
//             </>
//           }
//         >
//           <Table
//             rowKey='id'
//             dataSource={filteredInterventions}
//             columns={[
//               {
//                 title: 'Participant',
//                 dataIndex: 'participant',
//                 render: (text, record) => (
//                   <div>
//                     <div>{text}</div>
//                     <Text type='secondary' style={{ fontSize: 12 }}>
//                       {record.company} ({record.branch})
//                     </Text>
//                   </div>
//                 )
//               },
//               {
//                 title: 'Type',
//                 dataIndex: 'type',
//                 render: type => <Tag color='#2db7f5'>{type}</Tag>
//               },
//               {
//                 title: 'Delivery',
//                 dataIndex: 'deliveryMethod',
//                 render: method => (
//                   <Tag
//                     color={method === 'online' ? 'cyan' : 'orange'}
//                     icon={
//                       method === 'online' ? (
//                         <LaptopOutlined />
//                       ) : (
//                         <UserOutlined />
//                       )
//                     }
//                   >
//                     {method === 'online' ? 'Online' : 'In-Person'}
//                   </Tag>
//                 )
//               },
//               {
//                 title: 'Completed Date',
//                 dataIndex: 'completedAt',
//                 render: date => dayjs(date).format('MMM D, YYYY')
//               },
//               {
//                 title: 'Status',
//                 dataIndex: 'status',
//                 render: status => (
//                   <Tag
//                     color={status === 'confirmed' ? 'green' : 'orange'}
//                     icon={
//                       status === 'confirmed' ? (
//                         <CheckCircleOutlined />
//                       ) : (
//                         <ClockCircleOutlined />
//                       )
//                     }
//                   >
//                     {status === 'confirmed' ? 'Confirmed' : 'Pending'}
//                   </Tag>
//                 )
//               },
//               {
//                 title: 'Actions',
//                 render: (_, record) => (
//                   <Button
//                     icon={<EyeOutlined />}
//                     onClick={() => setViewModal(record)}
//                     size='small'
//                   >
//                     Details
//                   </Button>
//                 )
//               }
//             ]}
//             pagination={{ pageSize: 5 }}
//           />
//         </Card>
//       </motion.div>

//       {/* Add Intervention Modal */}
//       <Modal
//         title={
//           <>
//             <PlusOutlined /> Record Intervention
//           </>
//         }
//         open={visible}
//         onCancel={() => setVisible(false)}
//         onOk={() => form.submit()}
//         width={700}
//         destroyOnClose
//       >
//         <Form layout='vertical' form={form} onFinish={handleSubmit}>
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item
//                 name='participant'
//                 label='Participant'
//                 rules={[
//                   { required: true, message: 'Please select participant' }
//                 ]}
//               >
//                 <Select placeholder='Select participant'>
//                   {participants.map(p => (
//                     <Option key={p.id} value={p.name}>
//                       {p.name} ({p.company}, {p.branch})
//                     </Option>
//                   ))}
//                 </Select>
//               </Form.Item>
//             </Col>
//             <Col span={12}>
//               <Form.Item name='type' label='Type' initialValue='One-on-One'>
//                 <Select>
//                   <Option value='One-on-One'>One-on-One</Option>
//                   <Option value='Group Session'>Group Session</Option>
//                   <Option value='Assessment'>Assessment</Option>
//                   <Option value='Workshop'>Workshop</Option>
//                 </Select>
//               </Form.Item>
//             </Col>
//           </Row>

//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item
//                 name='deliveryMethod'
//                 label='Delivery Method'
//                 initialValue='online'
//                 rules={[{ required: true }]}
//               >
//                 <Select>
//                   <Option value='online'>Online</Option>
//                   <Option value='in-person'>In-Person</Option>
//                 </Select>
//               </Form.Item>
//             </Col>
//             <Col span={12}>
//               <Form.Item
//                 name='completedAt'
//                 label='Completion Date'
//                 rules={[{ required: true }]}
//               >
//                 <DatePicker style={{ width: '100%' }} />
//               </Form.Item>
//             </Col>
//           </Row>

//           <Form.Item
//             noStyle
//             shouldUpdate={(prevValues, currentValues) =>
//               prevValues.deliveryMethod !== currentValues.deliveryMethod
//             }
//           >
//             {({ getFieldValue }) =>
//               getFieldValue('deliveryMethod') === 'online' ? (
//                 <Form.Item
//                   name='meetingLink'
//                   label='Meeting Link'
//                   rules={[
//                     { required: true, message: 'Please enter meeting link' }
//                   ]}
//                 >
//                   <Input placeholder='https://zoom.us/j/...' />
//                 </Form.Item>
//               ) : (
//                 <Form.Item
//                   name='location'
//                   label='Location'
//                   rules={[{ required: true, message: 'Please enter location' }]}
//                 >
//                   <Input placeholder='Meeting Room 3, Building A' />
//                 </Form.Item>
//               )
//             }
//           </Form.Item>

//           <Form.Item name='summary' label='Meeting Notes / Summary'>
//             <Input.TextArea
//               rows={4}
//               placeholder='Enter detailed notes from the session...'
//             />
//           </Form.Item>

//           <Form.Item label='Supporting Documents (optional)'>
//             <Upload
//               beforeUpload={() => false}
//               onChange={({ file }) => setFile(file)}
//               maxCount={3}
//               listType='picture'
//             >
//               <Button icon={<UploadOutlined />}>Upload Files</Button>
//             </Upload>
//           </Form.Item>
//         </Form>
//       </Modal>

//       {/* View Details Modal */}
//       <Modal
//         title={
//           <>
//             <FileDoneOutlined /> Intervention Details
//           </>
//         }
//         open={!!viewModal}
//         onCancel={() => setViewModal(null)}
//         footer={null}
//         width={600}
//       >
//         {viewModal && (
//           <Descriptions bordered column={1}>
//             <Descriptions.Item label='Participant'>
//               {viewModal.participant}{' '}
//               <Tag color='blue'>{viewModal.company}</Tag>
//               <div>
//                 <Text type='secondary'>{viewModal.branch}</Text>
//               </div>
//             </Descriptions.Item>
//             <Descriptions.Item label='Type'>
//               <Tag color='#2db7f5'>{viewModal.type}</Tag>
//             </Descriptions.Item>
//             <Descriptions.Item label='Delivery Method'>
//               <Tag
//                 color={
//                   viewModal.deliveryMethod === 'online' ? 'cyan' : 'orange'
//                 }
//               >
//                 {viewModal.deliveryMethod === 'online' ? 'Online' : 'In-Person'}
//               </Tag>
//             </Descriptions.Item>
//             <Descriptions.Item label='Completed Date'>
//               {dayjs(viewModal.completedAt).format('MMMM D, YYYY')}
//             </Descriptions.Item>
//             <Descriptions.Item label='Status'>
//               <Tag
//                 color={viewModal.status === 'confirmed' ? 'green' : 'orange'}
//                 icon={
//                   viewModal.status === 'confirmed' ? (
//                     <CheckCircleOutlined />
//                   ) : (
//                     <ClockCircleOutlined />
//                   )
//                 }
//               >
//                 {viewModal.status === 'confirmed' ? 'Confirmed' : 'Pending'}
//               </Tag>
//             </Descriptions.Item>
//             {viewModal.deliveryMethod === 'online' ? (
//               <Descriptions.Item label='Meeting Link'>
//                 <a
//                   href={viewModal.meetingLink}
//                   target='_blank'
//                   rel='noopener noreferrer'
//                 >
//                   {viewModal.meetingLink}
//                 </a>
//               </Descriptions.Item>
//             ) : (
//               <Descriptions.Item label='Location'>
//                 {viewModal.location}
//               </Descriptions.Item>
//             )}
//             <Descriptions.Item label='Notes'>
//               <div
//                 style={{
//                   background: '#fafafa',
//                   padding: 12,
//                   borderRadius: 4,
//                   marginTop: 8
//                 }}
//               >
//                 {viewModal.summary || 'No notes provided'}
//               </div>
//             </Descriptions.Item>
//           </Descriptions>
//         )}
//       </Modal>
//     </div>
//   )
// }

// export default PDSWellnessInterventionPage

import React, { useEffect, useMemo, useState } from 'react'
import {
    Card,
    Statistic,
    Table,
    Typography,
    Upload,
    Button,
    Modal,
    Form,
    Select,
    Input,
    message,
    Row,
    Col,
    DatePicker,
    Space,
    Tag,
    Alert
} from 'antd'
import {
    UploadOutlined,
    EyeOutlined,
    TeamOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    FileDoneOutlined,
    ReloadOutlined,
    EditOutlined
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs, { Dayjs } from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import { db, storage } from '@/firebase'
import {
    Timestamp,
    collection,
    doc,
    onSnapshot,
    orderBy,
    query,
    updateDoc,
    where,
    getDoc,
    arrayUnion
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import { canonicalizeAssignedInterventionPatch, toAssignedInterventionView } from '@/services/assignedInterventionService'

// Enable dayjs.isBetween
if (!(dayjs as any).prototype.isBetween) dayjs.extend(isBetween)

const { Text } = Typography
const { Option } = Select
const { RangePicker } = DatePicker

// ---------------- Types ----------------
interface ProgressUpdate {
    at: Timestamp
    byUserId: string
    byUserName: string
    notes?: string
    progress?: number // 0-100
    hoursSpent?: number
    sessions?: number
    files?: { name: string; url: string }[]
    // Optional contextual fields; other UIs can ignore safely
    deliveryMethod?: 'online' | 'in-person'
    meetingLink?: string
    location?: string
}

interface Assignment {
    id: string


    // Primary linkage
    participantId: string
    participantName: string
    interventionId: string
    interventionTitle: string

    assigneeId: string
    assigneeName: string

    // Tracking
    assignmentStatus: 'assigned' | 'in-progress' | 'completed' | 'cancelled' | 'needs-reassignment'
    assigneeAcceptanceStatus: 'pending' | 'accepted' | 'declined'
    participantAcceptanceStatus: 'pending' | 'accepted' | 'declined'
    assigneeCompletionStatus: 'pending' | 'completed'
    participantCompletionStatus: 'pending' | 'confirmed' | 'rejected'

    // Targets
    type: 'singular' | 'grouped'
    targetType?: 'percentage' | 'number'
    targetValue?: number
    targetMetric?: string

    // Timestamps
    createdAt: Timestamp
    updatedAt?: Timestamp
    dueDate?: Timestamp | null

    // Optional legacy fields used elsewhere
    resources?: any
    invoiceId?: string
    flaggedForReview?: boolean
    computedProgress?: number
    tracking?: { timeSpentHours?: number }
    progressUpdates?: ProgressUpdate[]
    declineReason?: string
    feedback?: any
    rejectionReason?: string
}

// ---------------- Component ----------------
const PDSWellnessInterventionPage: React.FC = () => {
    const { user } = useFullIdentity()

    // Local state
    const [loading, setLoading] = useState(true)
    const [rows, setRows] = useState<Assignment[]>([])
    const [view, setView] = useState<Assignment | null>(null)
    const [edit, setEdit] = useState<Assignment | null>(null)
    const [fileList, setFileList] = useState<any[]>([])
    const [form] = Form.useForm()

    // Filters
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<string | undefined>()
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null)
    const [scope, setScope] = useState<'my' | 'department'>('my') // UI exposed only for operations

    // Identity basics
    const myId = useMemo(() => {
        const u: any = user || {}
        return u.uid || u.id || u.userId || u.email || ''
    }, [user])
    const myName = useMemo(() => {
        const u: any = user || {}
        return u.name || u.displayName || u.fullName || u.email || 'Me'
    }, [user])
    const myRole = (user as any)?.role || 'consultant'

    // Subscribe to canonical assignments owned by this assignee
    useEffect(() => {
        setLoading(true)

        const baseQ = query(
            collection(db, 'assignedInterventions'),
            where('assigneeId', '==', myId),
            orderBy('createdAt', 'desc')
        )

        const unsub = onSnapshot(
            baseQ,
            snap => {
                let list = snap.docs.map(d => toAssignedInterventionView(d.id, d.data())) as unknown as Assignment[]

                // Scope rules:
                // - Consultants: always MY
                // - Operations: toggle between MY and COMPANY
                if (myRole !== 'operations' || scope === 'my') {
                    list = list.filter(a => a.assigneeId === myId)
                }

                setRows(list)
                setLoading(false)
            },
            err => {
                console.error(err)
                message.error('Failed to load interventions')
                setLoading(false)
            }
        )

        return () => unsub()
    }, [myId, myRole, scope])

    // Derived data
    const filtered = useMemo(() => {
        let data = [...rows]

        if (search) {
            const q = search.toLowerCase()
            data = data.filter(
                r =>
                    (r.participantName || '').toLowerCase().includes(q) ||
                    (r.interventionTitle || '').toLowerCase().includes(q) ||
                    (r.assigneeName || '').toLowerCase().includes(q)
            )
        }

        if (statusFilter) {
            data = data.filter(
                r => (r.assignmentStatus || '').toLowerCase() === statusFilter.toLowerCase()
            )
        }

        if (dateRange && dateRange[0] && dateRange[1]) {
            const [start, end] = dateRange
            data = data.filter(r => {
                const t = r.updatedAt || r.createdAt
                const d = t?.toDate?.() ? dayjs(t.toDate()) : null
                return d ? d.isBetween(start, end, 'day', '[]') : false
            })
        }

        return data
    }, [rows, search, statusFilter, dateRange])

    const metrics = useMemo(() => {
        const total = filtered.length
        const completed = filtered.filter(
            r =>
                r.assigneeCompletionStatus === 'completed' &&
                r.participantCompletionStatus === 'confirmed'
        ).length
        const inProgress = filtered.filter(
            r =>
                r.assigneeCompletionStatus !== 'completed' ||
                r.participantCompletionStatus !== 'confirmed'
        ).length
        const uniqueBeneficiaries = new Set(filtered.map(r => r.participantName))
            .size
        return { total, completed, inProgress, uniqueBeneficiaries }
    }, [filtered])

    // Helpers
    const resetFilters = () => {
        setSearch('')
        setStatusFilter(undefined)
        setDateRange(null)
    }

    const getCompositeStatus = (r: Assignment) => {
        if (r.assignmentStatus === 'cancelled') return { label: 'Cancelled', color: 'red' }
        if (
            r.assigneeCompletionStatus === 'completed' &&
            r.participantCompletionStatus === 'confirmed'
        )
            return { label: 'Completed', color: 'green' }
        if (
            r.assigneeCompletionStatus === 'completed' &&
            r.participantCompletionStatus !== 'confirmed'
        )
            return { label: 'Awaiting Confirmation', color: 'purple' }
        if (r.assigneeAcceptanceStatus === 'declined' || r.participantAcceptanceStatus === 'declined')
            return { label: 'Declined', color: 'volcano' }
        if (r.participantAcceptanceStatus === 'pending')
            return { label: 'Awaiting Acceptance', color: 'orange' }
        return { label: 'In Progress', color: 'blue' }
    }

    const openUpdate = (rec: Assignment) => {
        setEdit(rec)
        setFileList([])
        form.resetFields()

        const last = (rec.progressUpdates || []).slice(-1)[0]
        form.setFieldsValue({
            notes: '',
            hoursSpent: 1,
            sessions: 1,
            progress: typeof rec.computedProgress === 'number' ? rec.computedProgress : last?.progress
        })
    }

    const saveUpdate = async (
        values: any,
        markDone = false,
        forceComplete = false
    ) => {
        if (!edit) return

        try {
            const docRef = doc(db, 'assignedInterventions', edit.id)

            // Upload files (optional)
            const uploaded: { name: string; url: string }[] = []
            for (const f of fileList || []) {
                const raw = (f as any).originFileObj as File
                if (!raw) continue
                const path = `assignedInterventions/${edit.id}/proof/${Date.now()}_${raw.name
                    }`
                const sref = ref(storage, path)
                await uploadBytes(sref, raw)
                const url = await getDownloadURL(sref)
                uploaded.push({ name: raw.name, url })
            }

            // Build progress update (matches existing field name: progressUpdates)
            const updateEntry: ProgressUpdate = {
                at: Timestamp.now(),
                byUserId: myId,
                byUserName: myName,
                notes: values.notes,
                progress:
                    typeof values.progress === 'number'
                        ? Number(values.progress)
                        : undefined,
                hoursSpent: values.hoursSpent ? Number(values.hoursSpent) : undefined,
                sessions: values.sessions ? Number(values.sessions) : undefined,
                files: uploaded.length ? uploaded : undefined
            }

            const patch: any = {
                updatedAt: Timestamp.now(),
                assignmentStatus: 'in-progress',
                computedProgress:
                    typeof values.progress === 'number'
                        ? Number(values.progress)
                        : edit.computedProgress,
                tracking: {
                    ...(edit.tracking || {}),
                    timeSpentHours:
                        Number(edit.tracking?.timeSpentHours || 0) +
                        (values.hoursSpent ? Number(values.hoursSpent) : 0)
                },
                progressUpdates: arrayUnion(updateEntry)
            }

            if (markDone) {
                patch.assigneeCompletionStatus = 'completed'
            }

            if (forceComplete) {
                patch.assigneeCompletionStatus = 'completed'
                patch.participantCompletionStatus = 'confirmed'
                patch.assignmentStatus = 'completed'
            }

            await updateDoc(docRef, canonicalizeAssignedInterventionPatch(patch))

            message.success(
                forceComplete
                    ? 'Intervention completed and confirmed.'
                    : markDone
                        ? 'Marked work done, awaiting confirmation.'
                        : 'Update saved.'
            )
            setEdit(null)
            form.resetFields()
            setFileList([])
        } catch (err) {
            console.error(err)
            message.error('Failed to save update')
        }
    }

    // ---------------- Columns ----------------
    const columns = [
        {
            title: 'Beneficiary',
            dataIndex: 'participantName',
            key: 'participantName'
        },
        {
            title: 'Intervention',
            dataIndex: 'interventionTitle',
            key: 'interventionTitle',
            ellipsis: true
        },
        {
            title: 'Consultant',
            dataIndex: 'assigneeName',
            key: 'assigneeName'
        },
        {
            title: 'Due',
            dataIndex: 'dueDate',
            render: (t?: Timestamp | null) =>
                t?.toDate ? dayjs(t.toDate()).format('DD MMM YYYY') : '—'
        },
        {
            title: 'Status',
            key: 'status',
            render: (_: any, r: Assignment) => {
                const s = getCompositeStatus(r)
                return <Tag color={s.color}>{s.label}</Tag>
            }
        },
        {
            title: 'Last Update',
            key: 'last',
            render: (_: any, r: Assignment) => {
                const last = (r.progressUpdates || []).slice(-1)[0]
                if (!last) return '—'
                const when = last.at?.toDate
                    ? dayjs(last.at.toDate()).format('DD MMM, HH:mm')
                    : '—'
                return <Text type='secondary'>{when}</Text>
            }
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: any, r: Assignment) => (
                <Space>
                    <Button
                        size='small'
                        icon={<EyeOutlined />}
                        onClick={() => setView(r)}
                    >
                        Details
                    </Button>
                    <Button
                        size='small'
                        type='primary'
                        icon={<EditOutlined />}
                        onClick={() => openUpdate(r)}
                    >
                        Update
                    </Button>
                </Space>
            )
        }
    ]

    // ---------------- UI ----------------
    return (
        <div style={{ minHeight: '100vh', padding: 24 }}>
            <Alert
                message='Intervention Tracker'
                description='Consultants and Operations can log progress, upload proof (MOV/POE), and complete interventions.'
                type='info'
                showIcon
                style={{ marginBottom: 16 }}
            />

            {/* Metrics */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
            >
                <Row gutter={16} style={{ marginBottom: 16 }}>
                    <Col xs={24} sm={6}>
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4 }}
                        >
                            <Card
                                style={{
                                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                    transition: 'all 0.3s ease',
                                    borderRadius: 8,
                                    border: '1px solid #d6e4ff'
                                }}
                                hoverable
                            >
                                <Statistic
                                    title={
                                        <>
                                            <TeamOutlined /> Beneficiaries
                                        </>
                                    }
                                    value={metrics.uniqueBeneficiaries}
                                />
                            </Card>
                        </motion.div>{' '}
                    </Col>
                    <Col xs={24} sm={6}>
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4 }}
                        >
                            <Card
                                style={{
                                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                    transition: 'all 0.3s ease',
                                    borderRadius: 8,
                                    border: '1px solid #d6e4ff'
                                }}
                                hoverable
                            >
                                <Statistic
                                    title={
                                        <>
                                            <CheckCircleOutlined /> Completed
                                        </>
                                    }
                                    value={metrics.completed}
                                    valueStyle={{ color: '#52c41a' }}
                                />
                            </Card>
                        </motion.div>{' '}
                    </Col>
                    <Col xs={24} sm={6}>
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4 }}
                        >
                            <Card
                                style={{
                                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                    transition: 'all 0.3s ease',
                                    borderRadius: 8,
                                    border: '1px solid #d6e4ff'
                                }}
                                hoverable
                            >
                                <Statistic
                                    title={
                                        <>
                                            <ClockCircleOutlined /> In Progress
                                        </>
                                    }
                                    value={metrics.inProgress}
                                    valueStyle={{ color: '#faad14' }}
                                />
                            </Card>
                        </motion.div>{' '}
                    </Col>
                    <Col xs={24} sm={6}>
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4 }}
                        >
                            <Card
                                style={{
                                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                    transition: 'all 0.3s ease',
                                    borderRadius: 8,
                                    border: '1px solid #d6e4ff'
                                }}
                                hoverable
                            >
                                <Statistic
                                    title={
                                        <>
                                            <FileDoneOutlined /> Total
                                        </>
                                    }
                                    value={metrics.total}
                                    valueStyle={{ color: '#722ed1' }}
                                />
                            </Card>
                        </motion.div>{' '}
                    </Col>
                </Row>
            </motion.div>

            {/* Filters */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
            >
                <Card
                    style={{
                        boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                        transition: 'all 0.3s ease',
                        borderRadius: 8,
                        marginBottom: 16,
                        border: '1px solid #d6e4ff'
                    }}
                >
                    <Row gutter={[12, 12]} align='middle'>
                        <Col xs={24} md={8}>
                            <Input
                                placeholder='Search beneficiary / intervention / consultant'
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </Col>
                        <Col xs={24} md={6}>
                            <Select
                                allowClear
                                placeholder='Status'
                                value={statusFilter}
                                onChange={setStatusFilter}
                                style={{ width: '100%' }}
                            >
                                <Option value='assigned'>Assigned</Option>
                                <Option value='in-progress'>In Progress</Option>
                                <Option value='completed'>Completed</Option>
                                <Option value='cancelled'>Cancelled</Option>
                            </Select>
                        </Col>
                        <Col xs={24} md={8}>
                            <RangePicker
                                style={{ width: '100%' }}
                                value={dateRange as any}
                                onChange={v => setDateRange(v as any)}
                            />
                        </Col>
                        <Col xs={24} md={2}>
                            <Button icon={<ReloadOutlined />} onClick={resetFilters} />
                        </Col>
                        {myRole === 'operations' && (
                            <Col span={24}>
                                <Space>
                                    <Text type='secondary'>Scope:</Text>
                                    <Tag
                                        color={scope === 'my' ? 'blue' : 'default'}
                                        onClick={() => setScope('my')}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        My Assignments
                                    </Tag>
                                    <Tag
                                        color={scope === 'department' ? 'blue' : 'default'}
                                        onClick={() => setScope('department')}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        Department
                                    </Tag>
                                </Space>
                            </Col>
                        )}
                    </Row>
                </Card>
            </motion.div>

            {/* Table */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
            >
                <Card
                    style={{
                        boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                        transition: 'all 0.3s ease',
                        borderRadius: 8,
                        border: '1px solid #d6e4ff'
                    }}
                >
                    <Table
                        rowKey='id'
                        dataSource={filtered}
                        columns={columns as any}
                        loading={loading}
                        pagination={{ pageSize: 10 }}
                    />
                </Card>
            </motion.div>

            {/* Details Modal */}
            <Modal
                title='Intervention Details'
                open={!!view}
                onCancel={() => setView(null)}
                footer={null}
                width={720}
            >
                {view && (
                    <>
                        <Row gutter={16} style={{ marginBottom: 12 }}>
                            <Col xs={24} md={12}>
                                <Text strong>Beneficiary:</Text> {view.participantName}
                            </Col>
                            <Col xs={24} md={12}>
                                <Text strong>Intervention:</Text> {view.interventionTitle}
                            </Col>
                            <Col xs={24} md={12}>
                                <Text strong>Assignee:</Text> {view.assigneeName}
                            </Col>
                            <Col xs={24} md={12}>
                                <Text strong>Due:</Text>{' '}
                                {view.dueDate?.toDate
                                    ? dayjs(view.dueDate.toDate()).format('DD MMM YYYY')
                                    : '—'}
                            </Col>
                            <Col xs={24} md={12}>
                                <Text strong>Status:</Text> {getCompositeStatus(view).label}
                            </Col>
                            <Col xs={24} md={12}>
                                <Text strong>Progress:</Text>{' '}
                                {typeof view.computedProgress === 'number' ? `${view.computedProgress}%` : '—'}
                            </Col>
                        </Row>
                        <Alert
                            type='info'
                            message='Progress Updates'
                            showIcon
                            style={{ marginBottom: 12 }}
                        />
                        <div style={{ maxHeight: 320, overflow: 'auto', paddingRight: 8 }}>
                            {(view.progressUpdates || []).length ? (
                                (view.progressUpdates || [])
                                    .sort(
                                        (a, b) =>
                                            (a.at?.toMillis?.() || 0) - (b.at?.toMillis?.() || 0)
                                    )
                                    .map((u, idx) => (
                                        <Card key={idx} size='small' style={{ marginBottom: 8 }}>
                                            <Space direction='vertical' style={{ width: '100%' }}>
                                                <Space>
                                                    <Tag>{u.byUserName}</Tag>
                                                    <Text type='secondary'>
                                                        {u.at?.toDate
                                                            ? dayjs(u.at.toDate()).format(
                                                                'DD MMM YYYY, HH:mm'
                                                            )
                                                            : ''}
                                                    </Text>
                                                    {typeof u.progress === 'number' && (
                                                        <Tag color='green'>{u.progress}%</Tag>
                                                    )}
                                                </Space>
                                                {u.notes && <Text>{u.notes}</Text>}
                                                <Space>
                                                    {u.hoursSpent ? (
                                                        <Tag>Hours: {u.hoursSpent}</Tag>
                                                    ) : null}
                                                    {u.sessions ? (
                                                        <Tag>Sessions: {u.sessions}</Tag>
                                                    ) : null}
                                                </Space>
                                                {u.files?.length ? (
                                                    <Space wrap>
                                                        {u.files.map((f, i) => (
                                                            <a
                                                                key={i}
                                                                href={f.url}
                                                                target='_blank'
                                                                rel='noreferrer'
                                                            >
                                                                <Tag icon={<FileDoneOutlined />}>{f.name}</Tag>
                                                            </a>
                                                        ))}
                                                    </Space>
                                                ) : null}
                                            </Space>
                                        </Card>
                                    ))
                            ) : (
                                <Text type='secondary'>No progress yet.</Text>
                            )}
                        </div>
                    </>
                )}
            </Modal>

            {/* Update Modal */}
            <Modal
                title='Update Intervention'
                open={!!edit}
                onCancel={() => {
                    setEdit(null)
                    setFileList([])
                    form.resetFields()
                }}
                onOk={() => form.submit()}
                okText='Save Update'
                width={760}
                footer={null}
                destroyOnClose
            >
                <Form
                    layout='vertical'
                    form={form}
                    onFinish={vals => saveUpdate(vals, false, false)}
                >
                    <Row gutter={12}>
                        <Col xs={24} md={8}>
                            <Form.Item name='hoursSpent' label='Hours Spent'>
                                <Input type='number' min={0} placeholder='e.g. 2' />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name='sessions' label='Sessions in this update'>
                                <Input type='number' min={0} placeholder='e.g. 1' />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name='progress' label='Progress (%)'>
                                <Input type='number' min={0} max={100} placeholder='0 - 100' />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item name='notes' label='Notes'>
                        <Input.TextArea
                            rows={4}
                            placeholder='What did you cover / outcomes / next steps?'
                        />
                    </Form.Item>

                    <Form.Item label='Supporting Files (MOV/POE)'>
                        <Upload
                            beforeUpload={() => false}
                            fileList={fileList}
                            onChange={({ fileList }) => setFileList(fileList)}
                            multiple
                            maxCount={5}
                            listType='picture'
                        >
                            <Button icon={<UploadOutlined />}>Add Files</Button>
                        </Upload>
                    </Form.Item>

                    <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        {/* Save */}
                        <Button type='primary' onClick={() => form.submit()}>
                            Save Update
                        </Button>

                        {/* Mark Done (assignee completes their work) */}
                        <Button
                            onClick={() =>
                                form.validateFields().then(v => saveUpdate(v, true, false))
                            }
                        >
                            Mark Work Done
                        </Button>

                        {/* Complete & Confirm — operations only */}
                        {myRole === 'operations' && (
                            <Button
                                danger
                                onClick={() =>
                                    form.validateFields().then(v => saveUpdate(v, true, true))
                                }
                            >
                                Complete & Confirm
                            </Button>
                        )}
                    </Space>
                </Form>
            </Modal>
        </div>
    )
}

export default PDSWellnessInterventionPage
