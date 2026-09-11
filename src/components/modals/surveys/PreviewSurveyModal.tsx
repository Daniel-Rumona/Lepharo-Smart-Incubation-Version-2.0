import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Checkbox,
    DatePicker,
    Empty,
    Input,
    Modal,
    Progress,
    Radio,
    Rate,
    Select,
    Space,
    Tag,
    Typography,
    Upload,
    theme
} from 'antd'
import {
    ArrowLeftOutlined,
    ArrowRightOutlined,
    CheckOutlined,
    InboxOutlined,
    UploadOutlined
} from '@ant-design/icons'
import SurveyQuestionFrame from '@/components/surveys/shared/SurveyQuestionFrame'

const { Title, Text } = Typography

export interface PreviewSurveyField {
    id: string
    type: string
    label: string
    placeholder?: string
    required: boolean
    options?: string[]
    description?: string
}

type PreviewSurveyModalProps = {
    open: boolean
    title: string
    description?: string
    fields: PreviewSurveyField[]
    onClose: () => void
}

const hasAnswer = (
    field: PreviewSurveyField,
    value: unknown
): boolean => {
    if (value === undefined || value === null) return false

    if (Array.isArray(value)) {
        return value.length > 0
    }

    if (typeof value === 'string') {
        return value.trim().length > 0
    }

    if (field.type === 'rating') {
        return typeof value === 'number' && value > 0
    }

    return true
}

const PreviewSurveyModal: React.FC<
    PreviewSurveyModalProps
> = ({
    open,
    title,
    description,
    fields,
    onClose
}) => {
        const { token } = theme.useToken()

        const [currentIndex, setCurrentIndex] = useState(0)

        const [answers, setAnswers] = useState<
            Record<string, any>
        >({})

        /*
         * Section headings are not treated as questions.
         * They are used as context above the next question.
         */
        const questions = useMemo(
            () =>
                fields.filter(
                    field => field.type !== 'heading'
                ),
            [fields]
        )

        const currentField =
            questions[currentIndex]

        const currentOriginalIndex = currentField
            ? fields.findIndex(
                field => field.id === currentField.id
            )
            : -1

        const currentSection = useMemo(() => {
            if (currentOriginalIndex <= 0) return undefined

            return [...fields]
                .slice(0, currentOriginalIndex)
                .reverse()
                .find(field => field.type === 'heading')
        }, [fields, currentOriginalIndex])

        const answeredCount = useMemo(
            () =>
                questions.filter(field =>
                    hasAnswer(field, answers[field.id])
                ).length,
            [questions, answers]
        )

        const progress =
            questions.length > 0
                ? Math.round(
                    (answeredCount / questions.length) * 100
                )
                : 0

        const isFirst = currentIndex === 0
        const isLast =
            currentIndex === questions.length - 1

        useEffect(() => {
            if (!open) return

            setCurrentIndex(0)
            setAnswers({})
        }, [open])

        useEffect(() => {
            if (
                questions.length > 0 &&
                currentIndex >= questions.length
            ) {
                setCurrentIndex(questions.length - 1)
            }
        }, [questions.length, currentIndex])

        const setAnswer = (value: any) => {
            if (!currentField) return

            setAnswers(previous => ({
                ...previous,
                [currentField.id]: value
            }))
        }

        const goPrevious = () => {
            setCurrentIndex(previous =>
                Math.max(0, previous - 1)
            )
        }

        const goNext = () => {
            setCurrentIndex(previous =>
                Math.min(
                    questions.length - 1,
                    previous + 1
                )
            )
        }

        const renderField = (
            field: PreviewSurveyField
        ) => {
            const value = answers[field.id]

            switch (field.type) {
                case 'text':
                    return (
                        <Input
                            size='large'
                            value={value || ''}
                            placeholder={field.placeholder}
                            onChange={event =>
                                setAnswer(event.target.value)
                            }
                        />
                    )

                case 'textarea':
                    return (
                        <Input.TextArea
                            value={value || ''}
                            rows={5}
                            placeholder={field.placeholder}
                            onChange={event =>
                                setAnswer(event.target.value)
                            }
                        />
                    )

                case 'number':
                    return (
                        <Input
                            size='large'
                            type='number'
                            value={value ?? ''}
                            placeholder={field.placeholder}
                            onChange={event =>
                                setAnswer(event.target.value)
                            }
                        />
                    )

                case 'email':
                    return (
                        <Input
                            size='large'
                            type='email'
                            value={value || ''}
                            placeholder={field.placeholder}
                            onChange={event =>
                                setAnswer(event.target.value)
                            }
                        />
                    )

                case 'select':
                    return (
                        <Select
                            size='large'
                            value={value}
                            placeholder={
                                field.placeholder ||
                                'Select an option'
                            }
                            style={{ width: '100%' }}
                            options={(field.options || []).map(
                                option => ({
                                    label: option,
                                    value: option
                                })
                            )}
                            onChange={setAnswer}
                        />
                    )

                case 'radio':
                    return (
                        <Radio.Group
                            value={value}
                            onChange={event =>
                                setAnswer(event.target.value)
                            }
                            style={{ width: '100%' }}
                        >
                            <Space
                                direction='vertical'
                                size={10}
                                style={{ width: '100%' }}
                            >
                                {(field.options || []).map(
                                    option => (
                                        <Radio
                                            key={option}
                                            value={option}
                                        >
                                            {option}
                                        </Radio>
                                    )
                                )}
                            </Space>
                        </Radio.Group>
                    )

                case 'checkbox':
                    return (
                        <Checkbox.Group
                            value={value || []}
                            onChange={setAnswer}
                            style={{ width: '100%' }}
                        >
                            <Space
                                direction='vertical'
                                size={10}
                                style={{ width: '100%' }}
                            >
                                {(field.options || []).map(
                                    option => (
                                        <Checkbox
                                            key={option}
                                            value={option}
                                        >
                                            {option}
                                        </Checkbox>
                                    )
                                )}
                            </Space>
                        </Checkbox.Group>
                    )

                case 'date':
                    return (
                        <DatePicker
                            size='large'
                            value={value}
                            onChange={setAnswer}
                            style={{ width: '100%' }}
                        />
                    )

                case 'rating':
                    return (
                        <Rate
                            value={value || 0}
                            onChange={setAnswer}
                            style={{ fontSize: 30 }}
                        />
                    )

                case 'file':
                    return (
                        <Upload.Dragger
                            multiple={false}
                            maxCount={1}
                            beforeUpload={() => false}
                            fileList={value || []}
                            onChange={({ fileList }) =>
                                setAnswer(fileList)
                            }
                            style={{
                                padding: '12px 0'
                            }}
                        >
                            <p className='ant-upload-drag-icon'>
                                <InboxOutlined />
                            </p>

                            <p className='ant-upload-text'>
                                Drag and drop a file here
                            </p>

                            <p className='ant-upload-hint'>
                                or click to browse
                            </p>
                        </Upload.Dragger>
                    )

                default:
                    return null
            }
        }

        return (
            <Modal
                open={open}
                onCancel={onClose}
                footer={null}
                centered
                width={760}
                destroyOnClose
                styles={{
                    body: {
                        padding: 0
                    }
                }}
            >
                {/* HEADER */}
                <div
                    style={{
                        padding: '22px 24px 18px',
                        borderBottom: `1px solid ${token.colorBorderSecondary}`
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            gap: 20
                        }}
                    >
                        <div style={{ minWidth: 0 }}>
                            <Title
                                level={4}
                                style={{
                                    margin: 0,
                                    marginBottom: 4
                                }}
                            >
                                {title || 'Untitled survey'}
                            </Title>

                            {description ? (
                                <Text type='secondary'>
                                    {description}
                                </Text>
                            ) : null}
                        </div>

                        <Space size={6} wrap>
                            <Tag
                                style={{
                                    marginInlineEnd: 0,
                                    borderRadius: 999
                                }}
                            >
                                {questions.length}{' '}
                                {questions.length === 1
                                    ? 'Question'
                                    : 'Questions'}
                            </Tag>

                            <Tag
                                color='blue'
                                style={{
                                    marginInlineEnd: 0,
                                    borderRadius: 999
                                }}
                            >
                                {answeredCount} Answered
                            </Tag>
                        </Space>
                    </div>

                    <Progress
                        percent={progress}
                        showInfo={false}
                        size='small'
                        style={{ marginTop: 16 }}
                    />
                </div>

                {questions.length === 0 ? (
                    <div
                        style={{
                            padding: 48,
                            textAlign: 'center'
                        }}
                    >
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description='This survey has no questions yet'
                        />

                        <Button
                            shape='round'
                            onClick={onClose}
                        >
                            Close
                        </Button>
                    </div>
                ) : (
                    <SurveyQuestionFrame
                        index={currentIndex}
                        total={questions.length}
                        field={currentField}
                        sectionLabel={currentSection?.label}
                        footer={
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns:
                                        isFirst || questions.length === 1
                                            ? '1fr'
                                            : '1fr 1fr',
                                    gap: 12
                                }}
                            >
                                {!isFirst ? (
                                    <Button
                                        block
                                        size='large'
                                        shape='round'
                                        icon={<ArrowLeftOutlined />}
                                        onClick={goPrevious}
                                    >
                                        Previous
                                    </Button>
                                ) : null}

                                {isLast ? (
                                    <Button
                                        block
                                        size='large'
                                        type='primary'
                                        shape='round'
                                        icon={<CheckOutlined />}
                                        onClick={onClose}
                                    >
                                        Submit
                                    </Button>
                                ) : (
                                    <Button
                                        block
                                        size='large'
                                        type='primary'
                                        shape='round'
                                        onClick={goNext}
                                    >
                                        Next
                                        <ArrowRightOutlined />
                                    </Button>
                                )}
                            </div>
                        }
                    >
                        {renderField(currentField)}
                    </SurveyQuestionFrame>
                )}
            </Modal>
        )
    }

export default PreviewSurveyModal
