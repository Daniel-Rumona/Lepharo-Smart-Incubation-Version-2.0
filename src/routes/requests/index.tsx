import React, { useState } from 'react'
import {
  Table,
  Tag,
  Button,
  Modal,
  Form,
  Input,
  Radio,
  Checkbox,
  Rate,
  DatePicker,
  Select,
  Space,
  Typography,
  Card,
  Divider,
  message,
  Row,
  Col,
  Statistic,
  Progress,
  Tabs
} from 'antd'
import {
  EyeOutlined,
  FileTextOutlined,
  FormOutlined,
  PlusOutlined,
  SaveOutlined,
  SendOutlined,
  DashboardOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input
const { Option } = Select
const { TabPane } = Tabs

// Define document types
export interface DocumentRequest {
  id: string
  title: string
  type: 'psychometric' | 'customer_satisfaction' | 'marketing'
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  dueDate: string
  requestedBy: string
  questions: Question[]
  draftData?: any // Store draft form data
}

export interface Question {
  id: string
  type: 'text' | 'textarea' | 'radio' | 'checkbox' | 'rate' | 'select' | 'date'
  question: string
  required: boolean
  options?: string[]
  placeholder?: string
}

export interface NewDocumentRequest {
  title: string
  type: 'psychometric' | 'customer_satisfaction' | 'marketing'
  description: string
  dueDate: string
  priority: 'low' | 'medium' | 'high'
  justification: string
}

// Dummy data
const dummyDocuments: DocumentRequest[] = [
  {
    id: '1',
    title: 'Personality Assessment Questionnaire',
    type: 'psychometric',
    description: 'Complete personality assessment for team development program',
    status: 'pending',
    dueDate: '2024-01-15',
    requestedBy: 'HR Department',
    questions: [
      {
        id: 'q1',
        type: 'radio',
        question: 'How would you describe your work style?',
        required: true,
        options: [
          'Analytical and methodical',
          'Creative and flexible',
          'Collaborative and team-focused',
          'Independent and self-directed'
        ]
      },
      {
        id: 'q2',
        type: 'rate',
        question: 'Rate your comfort level with public speaking (1-5)',
        required: true
      },
      {
        id: 'q3',
        type: 'textarea',
        question:
          'Describe a challenging situation you faced and how you handled it',
        required: true,
        placeholder: 'Please provide a detailed response...'
      },
      {
        id: 'q4',
        type: 'checkbox',
        question:
          'Which of the following motivates you most? (Select all that apply)',
        required: false,
        options: [
          'Recognition and praise',
          'Financial rewards',
          'Learning opportunities',
          'Work-life balance',
          'Career advancement'
        ]
      }
    ]
  },
  {
    id: '2',
    title: 'Customer Satisfaction Survey - Project Alpha',
    type: 'customer_satisfaction',
    description:
      'Feedback on recently delivered training intervention for Project Alpha',
    status: 'in_progress',
    dueDate: '2024-01-20',
    requestedBy: 'Project Manager',
    draftData: {
      q1: 4,
      q2: 'Met expectations'
    },
    questions: [
      {
        id: 'q1',
        type: 'rate',
        question:
          'How would you rate the overall quality of the training intervention?',
        required: true
      },
      {
        id: 'q2',
        type: 'radio',
        question: 'Did the intervention meet your expectations?',
        required: true,
        options: [
          'Exceeded expectations',
          'Met expectations',
          'Partially met expectations',
          'Did not meet expectations'
        ]
      },
      {
        id: 'q3',
        type: 'textarea',
        question: 'What aspects of the intervention were most valuable?',
        required: true,
        placeholder: 'Please describe the most valuable aspects...'
      },
      {
        id: 'q4',
        type: 'textarea',
        question: 'What could be improved for future interventions?',
        required: false,
        placeholder: 'Please provide suggestions for improvement...'
      },
      {
        id: 'q5',
        type: 'radio',
        question: 'Would you recommend this type of intervention to others?',
        required: true,
        options: [
          'Definitely yes',
          'Probably yes',
          'Probably no',
          'Definitely no'
        ]
      }
    ]
  },
  {
    id: '3',
    title: 'Marketing Service Questionnaire - Branding Package',
    type: 'marketing',
    description:
      'Information gathering for corporate branding and identity design',
    status: 'pending',
    dueDate: '2024-01-25',
    requestedBy: 'Marketing Team',
    questions: [
      {
        id: 'q1',
        type: 'text',
        question: 'Company/Organization Name',
        required: true,
        placeholder: 'Enter your company name'
      },
      {
        id: 'q2',
        type: 'select',
        question: 'What industry are you in?',
        required: true,
        options: [
          'Technology',
          'Healthcare',
          'Education',
          'Finance',
          'Retail',
          'Manufacturing',
          'Other'
        ]
      },
      {
        id: 'q3',
        type: 'textarea',
        question: 'Describe your target audience',
        required: true,
        placeholder: 'Who are your primary customers/clients?'
      },
      {
        id: 'q4',
        type: 'checkbox',
        question:
          'What branding materials do you need? (Select all that apply)',
        required: true,
        options: [
          'Logo design',
          'Business cards',
          'Letterhead',
          'Website design',
          'Social media graphics',
          'Packaging design'
        ]
      },
      {
        id: 'q5',
        type: 'radio',
        question: 'What is your preferred brand tone?',
        required: true,
        options: [
          'Professional and corporate',
          'Modern and innovative',
          'Friendly and approachable',
          'Bold and edgy',
          'Classic and timeless'
        ]
      },
      {
        id: 'q6',
        type: 'date',
        question: 'When do you need the branding package completed?',
        required: true
      }
    ]
  },
  {
    id: '4',
    title: 'T-Shirt Printing Service Questionnaire',
    type: 'marketing',
    description: 'Custom t-shirt printing requirements for corporate event',
    status: 'completed',
    dueDate: '2024-01-10',
    requestedBy: 'Events Team',
    questions: [
      {
        id: 'q1',
        type: 'text',
        question: 'Event/Organization Name',
        required: true,
        placeholder: 'Enter event or organization name'
      },
      {
        id: 'q2',
        type: 'text',
        question: 'Number of t-shirts needed',
        required: true,
        placeholder: 'Enter quantity'
      },
      {
        id: 'q3',
        type: 'checkbox',
        question: 'What sizes do you need? (Select all that apply)',
        required: true,
        options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']
      },
      {
        id: 'q4',
        type: 'select',
        question: 'Preferred t-shirt color',
        required: true,
        options: [
          'White',
          'Black',
          'Navy Blue',
          'Red',
          'Green',
          'Yellow',
          'Gray',
          'Custom color (specify in comments)'
        ]
      },
      {
        id: 'q5',
        type: 'textarea',
        question: 'Design requirements or text to be printed',
        required: true,
        placeholder:
          'Describe your design requirements, text, or attach design files...'
      },
      {
        id: 'q6',
        type: 'radio',
        question: 'Printing method preference',
        required: true,
        options: [
          'Screen printing',
          'Digital printing',
          'Embroidery',
          'No preference'
        ]
      },
      {
        id: 'q7',
        type: 'date',
        question: 'When do you need the t-shirts?',
        required: true
      }
    ]
  },
  {
    id: '5',
    title: 'Employee Wellbeing Assessment',
    type: 'psychometric',
    description: 'Mental health and wellbeing assessment for workplace support',
    status: 'in_progress',
    dueDate: '2024-01-18',
    requestedBy: 'Wellness Committee',
    draftData: {
      q1: 'Moderate stress levels',
      q3: 3
    },
    questions: [
      {
        id: 'q1',
        type: 'radio',
        question: 'How would you describe your current stress levels?',
        required: true,
        options: [
          'Very low',
          'Low',
          'Moderate stress levels',
          'High',
          'Very high'
        ]
      },
      {
        id: 'q2',
        type: 'checkbox',
        question:
          'What workplace factors contribute to your stress? (Select all that apply)',
        required: false,
        options: [
          'Workload',
          'Deadlines',
          'Interpersonal relationships',
          'Work-life balance',
          'Job security',
          'Management style'
        ]
      },
      {
        id: 'q3',
        type: 'rate',
        question: 'Rate your overall job satisfaction (1-5)',
        required: true
      }
    ]
  }
]

const DocumentsHub: React.FC = () => {
  const [documents, setDocuments] = useState<DocumentRequest[]>(dummyDocuments)
  const [selectedDocument, setSelectedDocument] =
    useState<DocumentRequest | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [requestModalVisible, setRequestModalVisible] = useState(false)
  const [form] = Form.useForm()
  const [requestForm] = Form.useForm()

  // Calculate metrics
  const totalDocuments = documents.length
  const pendingDocuments = documents.filter(
    doc => doc.status === 'pending'
  ).length
  const inProgressDocuments = documents.filter(
    doc => doc.status === 'in_progress'
  ).length
  const completedDocuments = documents.filter(
    doc => doc.status === 'completed'
  ).length
  const completionRate =
    totalDocuments > 0
      ? Math.round((completedDocuments / totalDocuments) * 100)
      : 0

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'orange'
      case 'in_progress':
        return 'blue'
      case 'completed':
        return 'green'
      default:
        return 'default'
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'psychometric':
        return <FormOutlined />
      case 'customer_satisfaction':
        return <EyeOutlined />
      case 'marketing':
        return <FileTextOutlined />
      default:
        return <FileTextOutlined />
    }
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'psychometric':
        return 'Psychometric'
      case 'customer_satisfaction':
        return 'Customer Satisfaction'
      case 'marketing':
        return 'Marketing'
      default:
        return type
    }
  }

  const handleViewDocument = (document: DocumentRequest) => {
    setSelectedDocument(document)
    setModalVisible(true)

    // Load draft data if available
    if (document.draftData) {
      form.setFieldsValue(document.draftData)
    }
  }

  const handleSaveDraft = async () => {
    try {
      const values = form.getFieldsValue()
      console.log('Draft saved:', values)
      console.log('Document:', selectedDocument?.title)

      // Update document status to in_progress and save draft data
      if (selectedDocument) {
        const updatedDocuments = documents.map(doc =>
          doc.id === selectedDocument.id
            ? { ...doc, status: 'in_progress' as const, draftData: values }
            : doc
        )
        setDocuments(updatedDocuments)
      }

      message.success('Draft saved successfully!')
    } catch (error) {
      message.error('Failed to save draft. Please try again.')
    }
  }

  const handleSubmitForm = async (values: any) => {
    try {
      console.log('Form submitted:', values)
      console.log('Document:', selectedDocument?.title)

      // Update document status to completed
      if (selectedDocument) {
        const updatedDocuments = documents.map(doc =>
          doc.id === selectedDocument.id
            ? { ...doc, status: 'completed' as const, draftData: undefined }
            : doc
        )
        setDocuments(updatedDocuments)
      }

      message.success('Document submitted successfully!')
      setModalVisible(false)
      form.resetFields()
      setSelectedDocument(null)
    } catch (error) {
      message.error('Failed to submit document. Please try again.')
    }
  }

  const handleRequestDocument = async (values: NewDocumentRequest) => {
    try {
      console.log('Document request submitted:', values)

      const newDocument: DocumentRequest = {
        id: (documents.length + 1).toString(),
        title: values.title,
        type: values.type,
        description: values.description,
        status: 'pending',
        dueDate: values.dueDate,
        requestedBy: 'Current User',
        questions: [] // Would be populated by admin
      }

      setDocuments([...documents, newDocument])
      message.success(
        'Document request submitted successfully! The admin will review and add questions.'
      )
      setRequestModalVisible(false)
      requestForm.resetFields()
    } catch (error) {
      message.error('Failed to submit document request. Please try again.')
    }
  }

  const renderQuestionInput = (question: Question) => {
    const commonProps = {
      placeholder: question.placeholder
    }

    switch (question.type) {
      case 'text':
        return <Input {...commonProps} />

      case 'textarea':
        return <TextArea rows={4} {...commonProps} />

      case 'radio':
        return (
          <Radio.Group>
            <Space direction='vertical'>
              {question.options?.map((option, index) => (
                <Radio key={index} value={option}>
                  {option}
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        )

      case 'checkbox':
        return (
          <Checkbox.Group>
            <Space direction='vertical'>
              {question.options?.map((option, index) => (
                <Checkbox key={index} value={option}>
                  {option}
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
        )

      case 'rate':
        return <Rate />

      case 'select':
        return (
          <Select {...commonProps} style={{ width: '100%' }}>
            {question.options?.map((option, index) => (
              <Option key={index} value={option}>
                {option}
              </Option>
            ))}
          </Select>
        )

      case 'date':
        return <DatePicker style={{ width: '100%' }} />

      default:
        return <Input {...commonProps} />
    }
  }

  const columns: ColumnsType<DocumentRequest> = [
    {
      title: 'Document',
      dataIndex: 'title',
      key: 'title',
      render: (title: string, record: DocumentRequest) => (
        <Space>
          {getTypeIcon(record.type)}
          <div>
            <div style={{ fontWeight: 'bold' }}>{title}</div>
            <Text type='secondary' style={{ fontSize: '12px' }}>
              {record.description}
            </Text>
            {record.draftData && (
              <div>
                <Tag color='blue'>Draft Saved</Tag>
              </div>
            )}
          </div>
        </Space>
      )
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => <Tag color='blue'>{getTypeLabel(type)}</Tag>
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={getStatusColor(status)}>
          {status.replace('_', ' ').toUpperCase()}
        </Tag>
      )
    },
    {
      title: 'Requested By',
      dataIndex: 'requestedBy',
      key: 'requestedBy'
    },
    {
      title: 'Due Date',
      dataIndex: 'dueDate',
      key: 'dueDate'
    },
    {
      title: 'Action',
      key: 'action',
      render: (_, record: DocumentRequest) => (
        <Button
          type='primary'
          icon={<EyeOutlined />}
          onClick={() => handleViewDocument(record)}
          disabled={record.status === 'completed'}
        >
          {record.status === 'completed' ? 'Completed' : 'View & Fill'}
        </Button>
      )
    }
  ]

  const MetricsSection = () => (
    <Row gutter={16} style={{ marginBottom: 24 }}>
      <Col span={6}>
        <Card>
          <Statistic
            title='Total Documents'
            value={totalDocuments}
            prefix={<FileTextOutlined />}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title='Pending'
            value={pendingDocuments}
            prefix={<ExclamationCircleOutlined />}
            valueStyle={{ color: '#faad14' }}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title='In Progress'
            value={inProgressDocuments}
            prefix={<ClockCircleOutlined />}
            valueStyle={{ color: '#1890ff' }}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title='Completed'
            value={completedDocuments}
            prefix={<CheckCircleOutlined />}
            valueStyle={{ color: '#52c41a' }}
          />
        </Card>
      </Col>
    </Row>
  )

  const CompletionProgress = () => (
    <Card style={{ marginBottom: 24 }}>
      <Row align='middle'>
        <Col span={20}>
          <div>
            <Text strong>Overall Completion Rate</Text>
            <Progress percent={completionRate} status='active' />
          </div>
        </Col>
        <Col span={4} style={{ textAlign: 'right' }}>
          <Statistic value={completionRate} suffix='%' />
        </Col>
      </Row>
    </Card>
  )

  return (
    <div style={{ padding: '24px' }}>
      <Tabs defaultActiveKey='1' type='card'>
        <TabPane
          tab={
            <span>
              <DashboardOutlined />
              Dashboard
            </span>
          }
          key='1'
        >
          <Title level={2}>Document Requests Dashboard</Title>
          <MetricsSection />
          <CompletionProgress />

          <Card>
            <div
              style={{
                marginBottom: 16,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <Title level={3} style={{ margin: 0 }}>
                Your Documents
              </Title>
              <Button
                type='primary'
                icon={<PlusOutlined />}
                onClick={() => setRequestModalVisible(true)}
              >
                Request Document
              </Button>
            </div>

            <Table
              columns={columns}
              dataSource={documents}
              rowKey='id'
              pagination={{ pageSize: 10 }}
            />
          </Card>
        </TabPane>

        <TabPane
          tab={
            <span>
              <FormOutlined />
              Documents
            </span>
          }
          key='2'
        >
          <Card>
            <div
              style={{
                marginBottom: 16,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <Title level={2}>Document Requests</Title>
                <Paragraph>
                  Review and complete the documents requested by system
                  administrators. Click "View & Fill" to open each document and
                  submit your responses.
                </Paragraph>
              </div>
              <Button
                type='primary'
                icon={<PlusOutlined />}
                onClick={() => setRequestModalVisible(true)}
              >
                Request Document
              </Button>
            </div>

            <Table
              columns={columns}
              dataSource={documents}
              rowKey='id'
              pagination={{ pageSize: 10 }}
            />
          </Card>
        </TabPane>
      </Tabs>

      {/* Document Fill Modal */}
      <Modal
        title={
          <Space>
            {selectedDocument && getTypeIcon(selectedDocument.type)}
            <span>{selectedDocument?.title}</span>
            {selectedDocument?.draftData && (
              <Tag color='blue'>Draft Available</Tag>
            )}
          </Space>
        }
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false)
          form.resetFields()
          setSelectedDocument(null)
        }}
        width={800}
        footer={null}
      >
        {selectedDocument && (
          <div>
            <Card
              size='small'
              style={{ marginBottom: 16, backgroundColor: '#f9f9f9' }}
            >
              <Text strong>Description: </Text>
              <Text>{selectedDocument.description}</Text>
              <br />
              <Text strong>Requested by: </Text>
              <Text>{selectedDocument.requestedBy}</Text>
              <br />
              <Text strong>Due Date: </Text>
              <Text>{selectedDocument.dueDate}</Text>
              {selectedDocument.draftData && (
                <>
                  <br />
                  <Text strong>Status: </Text>
                  <Tag color='blue'>
                    Draft saved - you can continue where you left off
                  </Tag>
                </>
              )}
            </Card>

            <Form form={form} layout='vertical' onFinish={handleSubmitForm}>
              {selectedDocument.questions.map((question, index) => (
                <div key={question.id}>
                  <Form.Item
                    label={
                      <span>
                        {question.question}
                        {question.required && (
                          <span style={{ color: 'red' }}> *</span>
                        )}
                      </span>
                    }
                    name={question.id}
                    rules={[
                      {
                        required: question.required,
                        message: `Please answer: ${question.question}`
                      }
                    ]}
                  >
                    {renderQuestionInput(question)}
                  </Form.Item>
                  {index < selectedDocument.questions.length - 1 && <Divider />}
                </div>
              ))}

              <div style={{ textAlign: 'right', marginTop: 24 }}>
                <Space>
                  <Button onClick={() => setModalVisible(false)}>Cancel</Button>
                  <Button icon={<SaveOutlined />} onClick={handleSaveDraft}>
                    Save Draft
                  </Button>
                  <Button
                    type='primary'
                    htmlType='submit'
                    icon={<SendOutlined />}
                  >
                    Submit Document
                  </Button>
                </Space>
              </div>
            </Form>
          </div>
        )}
      </Modal>

      {/* Request Document Modal */}
      <Modal
        title={
          <Space>
            <PlusOutlined />
            <span>Request New Document</span>
          </Space>
        }
        open={requestModalVisible}
        onCancel={() => {
          setRequestModalVisible(false)
          requestForm.resetFields()
        }}
        width={600}
        footer={null}
      >
        <Form
          form={requestForm}
          layout='vertical'
          onFinish={handleRequestDocument}
        >
          <Form.Item
            label='Document Title'
            name='title'
            rules={[{ required: true, message: 'Please enter document title' }]}
          >
            <Input placeholder='Enter the title of the document you need' />
          </Form.Item>

          <Form.Item
            label='Document Type'
            name='type'
            rules={[{ required: true, message: 'Please select document type' }]}
          >
            <Select placeholder='Select document type'>
              <Option value='psychometric'>Psychometric Assessment</Option>
              <Option value='customer_satisfaction'>
                Customer Satisfaction Survey
              </Option>
              <Option value='marketing'>Marketing Questionnaire</Option>
            </Select>
          </Form.Item>

          <Form.Item
            label='Description'
            name='description'
            rules={[{ required: true, message: 'Please provide description' }]}
          >
            <TextArea
              rows={3}
              placeholder='Describe what this document is for and any specific requirements'
            />
          </Form.Item>

          <Form.Item
            label='Required By Date'
            name='dueDate'
            rules={[{ required: true, message: 'Please select due date' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            label='Priority'
            name='priority'
            rules={[{ required: true, message: 'Please select priority' }]}
          >
            <Radio.Group>
              <Radio value='low'>Low</Radio>
              <Radio value='medium'>Medium</Radio>
              <Radio value='high'>High</Radio>
            </Radio.Group>
          </Form.Item>

          <Form.Item
            label='Justification'
            name='justification'
            rules={[
              { required: true, message: 'Please provide justification' }
            ]}
          >
            <TextArea
              rows={3}
              placeholder='Explain why this document is needed and how it will be used'
            />
          </Form.Item>

          <div style={{ textAlign: 'right', marginTop: 24 }}>
            <Space>
              <Button onClick={() => setRequestModalVisible(false)}>
                Cancel
              </Button>
              <Button type='primary' htmlType='submit'>
                Submit Request
              </Button>
            </Space>
          </div>
        </Form>
      </Modal>
    </div>
  )
}

export default DocumentsHub
