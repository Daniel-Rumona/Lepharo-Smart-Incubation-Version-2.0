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
    CloseOutlined,
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

const getChoiceGrid = (
    count: number
) => {
    if (count > 8) {
        return {
            columns: 1,
            getSpan: () => 1
        }
    }

    if (count === 1) {
        return {
            columns: 1,
            getSpan: () => 1
        }
    }

    if (count === 2) {
        return {
            columns: 2,
            getSpan: () => 1
        }
    }

    if (count === 3) {
        return {
            columns: 3,
            getSpan: () => 1
        }
    }

    if (count === 5) {
        return {
            columns: 6,
            getSpan: (
                index: number
            ) =>
                index < 3
                    ? 2
                    : 3
        }
    }

    if (
        count === 4 ||
        count === 6 ||
        count === 8
    ) {
        return {
            columns: 2,
            getSpan: () => 1
        }
    }

    return {
        columns: 3,
        getSpan: () => 1
    }
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

        const renderChoiceCards = (
            field: PreviewSurveyField,
            options: string[],
            mode: 'single' | 'multi'
        ) => {
            const value = answers[field.id]

            const optionCount = options.length
            const isScrollable = optionCount > 8

            const choiceGrid =
                getChoiceGrid(
                    optionCount
                )

            const selectedValues =
                mode === 'multi'
                    ? Array.isArray(value)
                        ? value
                        : []
                    : []

            const isSelected = (
                option: string
            ) =>
                mode === 'multi'
                    ? selectedValues.includes(option)
                    : value === option

            const handleSelect = (
                option: string
            ) => {
                if (mode === 'single') {
                    setAnswer(option)
                    return
                }

                const currentlySelected =
                    selectedValues.includes(option)

                setAnswer(
                    currentlySelected
                        ? selectedValues.filter(
                            item =>
                                item !== option
                        )
                        : [
                            ...selectedValues,
                            option
                        ]
                )
            }

            const getYesNoIcon = (
                option: string
            ) => {
                const normalized =
                    option
                        .trim()
                        .toLowerCase()

                if (
                    normalized === 'yes'
                ) {
                    return (
                        <CheckOutlined />
                    )
                }

                if (
                    normalized === 'no'
                ) {
                    return (
                        <CloseOutlined />
                    )
                }

                return null
            }

            const isYesNoSet =
                optionCount === 2 &&
                options.every(option =>
                    [
                        'yes',
                        'no'
                    ].includes(
                        option
                            .trim()
                            .toLowerCase()
                    )
                )

            return (
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns:
                            `repeat(${choiceGrid.columns}, minmax(0, 1fr))`,
                        gap: 10,
                        width: '100%',
                        maxHeight:
                            isScrollable
                                ? 320
                                : undefined,
                        overflowY:
                            isScrollable
                                ? 'auto'
                                : undefined,
                        paddingRight:
                            isScrollable
                                ? 4
                                : 0
                    }}
                >
                    {options.map(
                        (option, index) => {
                            const selected =
                                isSelected(option)

                            const icon =
                                getYesNoIcon(
                                    option
                                )

                            return (
                                <button
                                    key={
                                        option
                                    }
                                    type='button'
                                    onClick={() =>
                                        handleSelect(
                                            option
                                        )
                                    }
                                    style={{
                                        gridColumn:
                                            optionCount === 5
                                                ? `span ${choiceGrid.getSpan(index)}`
                                                : undefined,
                                        appearance:
                                            'none',
                                        width:
                                            '100%',
                                        minHeight:
                                            isYesNoSet
                                                ? 82
                                                : 64,
                                        borderRadius:
                                            14,
                                        border: `1px solid ${selected
                                            ? token.colorPrimary
                                            : token.colorBorderSecondary
                                            }`,
                                        background:
                                            selected
                                                ? token.colorPrimaryBg
                                                : token.colorBgContainer,
                                        color:
                                            selected
                                                ? token.colorPrimary
                                                : token.colorText,
                                        padding:
                                            isYesNoSet
                                                ? '14px 16px'
                                                : '12px 14px',
                                        cursor:
                                            'pointer',
                                        textAlign:
                                            'left',
                                        transition:
                                            'all .2s ease',
                                        boxShadow:
                                            selected
                                                ? '0 6px 18px rgba(22,119,255,.10)'
                                                : '0 3px 10px rgba(15,23,42,.035)'
                                    }}
                                >
                                    <div
                                        style={{
                                            display:
                                                'flex',
                                            alignItems:
                                                'center',
                                            gap:
                                                10
                                        }}
                                    >
                                        {icon ? (
                                            <div
                                                style={{
                                                    width:
                                                        36,
                                                    height:
                                                        36,
                                                    borderRadius:
                                                        11,
                                                    display:
                                                        'grid',
                                                    placeItems:
                                                        'center',
                                                    background:
                                                        selected
                                                            ? token.colorPrimary
                                                            : token.colorFillAlter,
                                                    color:
                                                        selected
                                                            ? token.colorWhite
                                                            : option
                                                                .trim()
                                                                .toLowerCase() ===
                                                                'yes'
                                                                ? token.colorSuccess
                                                                : token.colorError,
                                                    flex:
                                                        '0 0 auto',
                                                    fontSize:
                                                        16
                                                }}
                                            >
                                                {
                                                    icon
                                                }
                                            </div>
                                        ) : null}

                                        <div
                                            style={{
                                                flex:
                                                    1,
                                                minWidth:
                                                    0
                                            }}
                                        >
                                            <Text
                                                strong={
                                                    selected
                                                }
                                                style={{
                                                    color:
                                                        selected
                                                            ? token.colorPrimary
                                                            : token.colorText,
                                                    fontSize:
                                                        14
                                                }}
                                            >
                                                {
                                                    option
                                                }
                                            </Text>
                                        </div>

                                        <div
                                            style={{
                                                width:
                                                    18,
                                                height:
                                                    18,
                                                borderRadius:
                                                    mode ===
                                                        'single'
                                                        ? '50%'
                                                        : 5,
                                                border: `2px solid ${selected
                                                    ? token.colorPrimary
                                                    : token.colorBorder
                                                    }`,
                                                background:
                                                    selected
                                                        ? token.colorPrimary
                                                        : 'transparent',
                                                display:
                                                    'grid',
                                                placeItems:
                                                    'center',
                                                flex:
                                                    '0 0 auto'
                                            }}
                                        >
                                            {selected ? (
                                                <CheckOutlined
                                                    style={{
                                                        color:
                                                            token.colorWhite,
                                                        fontSize:
                                                            10
                                                    }}
                                                />
                                            ) : null}
                                        </div>
                                    </div>
                                </button>
                            )
                        }
                    )}
                </div>
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
                case 'radio':
                    return renderChoiceCards(
                        field,
                        field.options || [],
                        'single'
                    )

                case 'checkbox':
                    return renderChoiceCards(
                        field,
                        field.options || [],
                        'multi'
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
