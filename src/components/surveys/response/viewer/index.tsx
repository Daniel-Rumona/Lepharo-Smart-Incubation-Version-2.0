import React, { useMemo } from 'react'
import {
    Button,
    Card,
    Divider,
    Empty,
    Progress,
    Rate,
    Space,
    Tag,
    Tooltip,
    Typography,
    theme
} from 'antd'
import {
    CalendarOutlined,
    CheckCircleFilled,
    FileOutlined,
    FileTextOutlined,
    NumberOutlined,
    StarOutlined,
    UnorderedListOutlined
} from '@ant-design/icons'

const {
    Title,
    Text,
    Paragraph
} = Typography

type ResponseType =
    | 'short'
    | 'textarea'
    | 'email'
    | 'number'
    | 'select'
    | 'radio'
    | 'checkbox'
    | 'multiple'
    | 'date'
    | 'file'
    | 'rating'
    | 'scale'
    | 'heading'

type Question = {
    id?: string
    name?: string
    type?: ResponseType
    label?: string
    questionText?: string
    question?: string
    options?: string[] | Record<string, string>
    required?: boolean
    multipleMode?: 'single' | 'multi'
    min?: number
    max?: number
    step?: number
    placeholder?: string
    description?: string
}

type Answers =
    | Record<string, any>
    | any[]

type ViewerProps = {
    title?: string
    description?: string
    questions: Question[]
    answers: Answers
    showTOC?: boolean
}

const isHeading = (
    question: Question
) =>
    question.type === 'heading'

const qId = (
    question: Question,
    index: number
) =>
    question.id ??
    question.name ??
    `q_${index}`

const qType = (
    question: Question
) =>
    (
        question.type ??
        'short'
    ) as ResponseType

const qText = (
    question: Question,
    index?: number
) =>
    question.questionText ||
    question.label ||
    question.question ||
    (
        typeof index === 'number'
            ? `Question ${index + 1}`
            : 'Question'
    )

const normalizeOptions = (
    question: Question
): string[] | undefined => {
    const type =
        qType(question)

    if (
        ![
            'select',
            'radio',
            'checkbox',
            'multiple'
        ].includes(type)
    ) {
        return undefined
    }

    const options =
        question.options

    if (!options) {
        return undefined
    }

    if (
        Array.isArray(options)
    ) {
        return options.filter(Boolean)
    }

    return Object.values(options)
        .filter(
            value =>
                typeof value ===
                'string'
        ) as string[]
}

const answerOf = (
    answers: Answers,
    question: Question,
    index: number
) => {
    if (
        Array.isArray(answers)
    ) {
        return answers[index]
    }

    const answerMap =
        answers as Record<
            string,
            any
        >

    const id =
        question.id

    const name =
        question.name

    if (
        id &&
        Object.prototype.hasOwnProperty.call(
            answerMap,
            id
        )
    ) {
        return answerMap[id]
    }

    if (
        name &&
        Object.prototype.hasOwnProperty.call(
            answerMap,
            name
        )
    ) {
        return answerMap[name]
    }

    return answerMap[
        qId(
            question,
            index
        )
    ]
}

const isAnswered = (
    value: any
) => {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return false
    }

    if (
        Array.isArray(value)
    ) {
        return value.length > 0
    }

    return true
}

const formatDateMaybe = (
    value: any
): string => {
    if (!value) {
        return '—'
    }

    const date =
        new Date(value)

    if (
        !Number.isNaN(
            date.getTime()
        )
    ) {
        return date.toLocaleDateString(
            undefined,
            {
                year: 'numeric',
                month: 'short',
                day: '2-digit'
            }
        )
    }

    return String(value)
}

const getQuestionIcon = (
    type: ResponseType
) => {
    if (
        type === 'date'
    ) {
        return (
            <CalendarOutlined />
        )
    }

    if (
        type === 'file'
    ) {
        return (
            <FileOutlined />
        )
    }

    if (
        type === 'rating' ||
        type === 'scale'
    ) {
        return (
            <StarOutlined />
        )
    }

    if (
        type === 'number'
    ) {
        return (
            <NumberOutlined />
        )
    }

    if (
        [
            'select',
            'radio',
            'checkbox',
            'multiple'
        ].includes(type)
    ) {
        return (
            <UnorderedListOutlined />
        )
    }

    return (
        <FileTextOutlined />
    )
}

function AnswerValue({
    q,
    value
}: {
    q: Question
    value: any
}) {
    const { token } =
        theme.useToken()

    const type =
        qType(q)

    if (
        !isAnswered(value)
    ) {
        return (
            <div
                style={{
                    padding:
                        '12px 14px',
                    borderRadius: 12,
                    border: `1px dashed ${token.colorBorder}`,
                    background:
                        token.colorFillAlter
                }}
            >
                <Text
                    type='secondary'
                >
                    No response provided
                </Text>
            </div>
        )
    }

    if (
        type === 'multiple' ||
        type === 'checkbox'
    ) {
        const values =
            Array.isArray(value)
                ? value
                : [value]

        return (
            <Space
                wrap
                size={[
                    6,
                    6
                ]}
            >
                {values.map(
                    (
                        item,
                        index
                    ) => (
                        <Tag
                            key={`${String(
                                item
                            )}-${index}`}
                            color='blue'
                            style={{
                                margin: 0,
                                borderRadius:
                                    999,
                                padding:
                                    '4px 10px'
                            }}
                        >
                            {String(
                                item
                            )}
                        </Tag>
                    )
                )}
            </Space>
        )
    }

    if (
        type === 'radio' ||
        type === 'select'
    ) {
        return (
            <Tag
                color='blue'
                style={{
                    margin: 0,
                    borderRadius: 999,
                    padding:
                        '5px 12px',
                    fontSize: 13
                }}
            >
                {String(value)}
            </Tag>
        )
    }

    if (
        type === 'rating'
    ) {
        const max =
            typeof q.max ===
                'number' &&
                q.max > 0
                ? q.max
                : 5

        const numericValue =
            Number(value)

        return (
            <Space
                direction='vertical'
                size={4}
            >
                {Number.isFinite(
                    numericValue
                ) ? (
                    <>
                        <Rate
                            disabled
                            count={max}
                            value={
                                numericValue
                            }
                        />

                        <Text
                            type='secondary'
                            style={{
                                fontSize: 12
                            }}
                        >
                            {
                                numericValue
                            }{' '}
                            of {max}
                        </Text>
                    </>
                ) : (
                    <Text strong>
                        {String(
                            value
                        )}
                    </Text>
                )}
            </Space>
        )
    }

    if (
        type === 'scale'
    ) {
        const max =
            typeof q.max ===
                'number' &&
                q.max > 0
                ? q.max
                : 10

        const numericValue =
            Number(value)

        const percentage =
            Number.isFinite(
                numericValue
            )
                ? Math.min(
                    100,
                    Math.max(
                        0,
                        (
                            numericValue /
                            max
                        ) * 100
                    )
                )
                : 0

        return (
            <div
                style={{
                    maxWidth: 360
                }}
            >
                <div
                    style={{
                        display:
                            'flex',
                        alignItems:
                            'center',
                        justifyContent:
                            'space-between',
                        gap: 12,
                        marginBottom: 6
                    }}
                >
                    <Text strong>
                        {Number.isFinite(
                            numericValue
                        )
                            ? numericValue
                            : String(
                                value
                            )}
                    </Text>

                    <Text
                        type='secondary'
                        style={{
                            fontSize: 12
                        }}
                    >
                        / {max}
                    </Text>
                </div>

                <Progress
                    percent={
                        percentage
                    }
                    showInfo={false}
                    size='small'
                />
            </div>
        )
    }

    if (
        type === 'file'
    ) {
        const files =
            Array.isArray(value)
                ? value
                : [value]

        return (
            <Space
                direction='vertical'
                size={8}
                style={{
                    width: '100%'
                }}
            >
                {files.map(
                    (
                        url,
                        index
                    ) => {
                        const fileUrl =
                            String(
                                url
                            )

                        const label =
                            fileUrl
                                .split('/')
                                .pop()
                                ?.split('?')[0] ||
                            `File ${index + 1
                            }`

                        return (
                            <Button
                                key={
                                    index
                                }
                                icon={
                                    <FileOutlined />
                                }
                                href={
                                    fileUrl
                                }
                                target='_blank'
                                shape='round'
                                style={{
                                    width:
                                        'fit-content',
                                    maxWidth:
                                        '100%'
                                }}
                            >
                                <Tooltip
                                    title={
                                        label
                                    }
                                >
                                    <span
                                        style={{
                                            display:
                                                'inline-block',
                                            maxWidth:
                                                360,
                                            overflow:
                                                'hidden',
                                            textOverflow:
                                                'ellipsis',
                                            whiteSpace:
                                                'nowrap'
                                        }}
                                    >
                                        {
                                            label
                                        }
                                    </span>
                                </Tooltip>
                            </Button>
                        )
                    }
                )}
            </Space>
        )
    }

    if (
        type === 'date'
    ) {
        return (
            <Space size={8}>
                <CalendarOutlined
                    style={{
                        color:
                            token.colorPrimary
                    }}
                />

                <Text strong>
                    {formatDateMaybe(
                        value
                    )}
                </Text>
            </Space>
        )
    }

    if (
        type === 'textarea'
    ) {
        return (
            <Paragraph
                style={{
                    margin: 0,
                    whiteSpace:
                        'pre-wrap',
                    lineHeight: 1.7
                }}
            >
                {String(value)}
            </Paragraph>
        )
    }

    return (
        <Text
            style={{
                fontSize: 14,
                lineHeight: 1.6
            }}
        >
            {String(value)}
        </Text>
    )
}

const SurveyResponseViewer: React.FC<
    ViewerProps
> = ({
    title,
    description,
    questions,
    answers,
    showTOC = false
}) => {
        const { token } =
            theme.useToken()

        const qList =
            useMemo(
                () =>
                    (
                        questions ||
                        []
                    ).map(
                        question => ({
                            ...question,
                            type: qType(
                                question
                            ),
                            options:
                                normalizeOptions(
                                    question
                                )
                        })
                    ),
                [questions]
            )

        const sections =
            useMemo(
                () =>
                    qList
                        .map(
                            (
                                question,
                                index
                            ) => ({
                                anchorId:
                                    qId(
                                        question,
                                        index
                                    ),
                                text: qText(
                                    question,
                                    index
                                ),
                                isHeading:
                                    isHeading(
                                        question
                                    )
                            })
                        )
                        .filter(
                            section =>
                                section.isHeading
                        ),
                [qList]
            )

        const answerableQuestions =
            useMemo(
                () =>
                    qList
                        .map(
                            (
                                question,
                                index
                            ) => ({
                                question,
                                index,
                                value: answerOf(
                                    answers,
                                    question,
                                    index
                                )
                            })
                        )
                        .filter(
                            item =>
                                !isHeading(
                                    item.question
                                )
                        ),
                [
                    qList,
                    answers
                ]
            )

        const answeredCount =
            useMemo(
                () =>
                    answerableQuestions.filter(
                        item =>
                            isAnswered(
                                item.value
                            )
                    ).length,
                [
                    answerableQuestions
                ]
            )

        const completionRate =
            answerableQuestions.length >
                0
                ? Math.round(
                    (
                        answeredCount /
                        answerableQuestions.length
                    ) * 100
                )
                : 0

        const showSections =
            showTOC &&
            sections.length > 0

        return (
            <div
                style={{
                    display:
                        'grid',
                    gridTemplateColumns:
                        showSections
                            ? '200px minmax(0, 1fr)'
                            : 'minmax(0, 1fr)',
                    gap: 14,
                    alignItems:
                        'start'
                }}
                className='survey-response-viewer-layout'
            >
                {showSections ? (
                    <Card
                        size='small'
                        style={{
                            position:
                                'sticky',
                            top: 8,
                            borderRadius:
                                16,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            boxShadow:
                                '0 6px 18px rgba(15,23,42,.04)'
                        }}
                        styles={{
                            body: {
                                padding: 12
                            }
                        }}
                    >
                        <Text
                            strong
                            style={{
                                display:
                                    'block',
                                marginBottom:
                                    10,
                                fontSize: 12,
                                textTransform:
                                    'uppercase',
                                letterSpacing:
                                    '.05em'
                            }}
                        >
                            Sections
                        </Text>

                        <Space
                            direction='vertical'
                            size={4}
                            style={{
                                width: '100%'
                            }}
                        >
                            {sections.map(
                                (
                                    section,
                                    index
                                ) => (
                                    <Button
                                        key={
                                            section.anchorId
                                        }
                                        type='text'
                                        block
                                        onClick={() =>
                                            document
                                                .getElementById(
                                                    section.anchorId
                                                )
                                                ?.scrollIntoView(
                                                    {
                                                        behavior:
                                                            'smooth',
                                                        block:
                                                            'start'
                                                    }
                                                )
                                        }
                                        style={{
                                            height:
                                                'auto',
                                            padding:
                                                '8px 9px',
                                            borderRadius:
                                                10,
                                            textAlign:
                                                'left',
                                            justifyContent:
                                                'flex-start'
                                        }}
                                    >
                                        <Text
                                            ellipsis
                                            style={{
                                                fontSize:
                                                    12
                                            }}
                                        >
                                            {
                                                index +
                                                1
                                            }
                                            .{' '}
                                            {
                                                section.text
                                            }
                                        </Text>
                                    </Button>
                                )
                            )}
                        </Space>
                    </Card>
                ) : null}

                <div
                    style={{
                        minWidth: 0
                    }}
                >
                    {(title ||
                        description) && (
                            <div
                                style={{
                                    marginBottom:
                                        14
                                }}
                            >
                                {title ? (
                                    <Title
                                        level={4}
                                        style={{
                                            margin:
                                                0
                                        }}
                                    >
                                        {
                                            title
                                        }
                                    </Title>
                                ) : null}

                                {description ? (
                                    <Paragraph
                                        type='secondary'
                                        style={{
                                            margin:
                                                '4px 0 0'
                                        }}
                                    >
                                        {
                                            description
                                        }
                                    </Paragraph>
                                ) : null}
                            </div>
                        )}

                    <div
                        style={{
                            display:
                                'grid',
                            gridTemplateColumns:
                                'repeat(3, minmax(0, 1fr))',
                            gap: 10,
                            marginBottom:
                                14
                        }}
                        className='survey-response-viewer-summary'
                    >
                        <div
                            style={{
                                padding:
                                    '11px 12px',
                                borderRadius:
                                    14,
                                border: `1px solid ${token.colorBorderSecondary}`,
                                background:
                                    token.colorFillAlter
                            }}
                        >
                            <Text
                                type='secondary'
                                style={{
                                    display:
                                        'block',
                                    fontSize:
                                        11
                                }}
                            >
                                Questions
                            </Text>

                            <Text
                                strong
                                style={{
                                    display:
                                        'block',
                                    marginTop:
                                        2,
                                    fontSize:
                                        18
                                }}
                            >
                                {
                                    answerableQuestions.length
                                }
                            </Text>
                        </div>

                        <div
                            style={{
                                padding:
                                    '11px 12px',
                                borderRadius:
                                    14,
                                border: `1px solid ${token.colorBorderSecondary}`,
                                background:
                                    token.colorFillAlter
                            }}
                        >
                            <Text
                                type='secondary'
                                style={{
                                    display:
                                        'block',
                                    fontSize:
                                        11
                                }}
                            >
                                Answered
                            </Text>

                            <Text
                                strong
                                style={{
                                    display:
                                        'block',
                                    marginTop:
                                        2,
                                    fontSize:
                                        18,
                                    color:
                                        token.colorSuccess
                                }}
                            >
                                {
                                    answeredCount
                                }
                            </Text>
                        </div>

                        <div
                            style={{
                                padding:
                                    '11px 12px',
                                borderRadius:
                                    14,
                                border: `1px solid ${token.colorBorderSecondary}`,
                                background:
                                    token.colorFillAlter
                            }}
                        >
                            <Text
                                type='secondary'
                                style={{
                                    display:
                                        'block',
                                    fontSize:
                                        11
                                }}
                            >
                                Completion
                            </Text>

                            <Space
                                size={6}
                                style={{
                                    marginTop:
                                        2
                                }}
                            >
                                <Text
                                    strong
                                    style={{
                                        fontSize:
                                            18
                                    }}
                                >
                                    {
                                        completionRate
                                    }
                                    %
                                </Text>

                                {completionRate ===
                                    100 ? (
                                    <CheckCircleFilled
                                        style={{
                                            color:
                                                token.colorSuccess
                                        }}
                                    />
                                ) : null}
                            </Space>
                        </div>
                    </div>

                    {qList.length ===
                        0 ? (
                        <Card
                            style={{
                                borderRadius:
                                    16
                            }}
                        >
                            <Empty
                                image={
                                    Empty.PRESENTED_IMAGE_SIMPLE
                                }
                                description='No questions found.'
                            />
                        </Card>
                    ) : (
                        <div
                            style={{
                                display:
                                    'flex',
                                flexDirection:
                                    'column',
                                gap: 10
                            }}
                        >
                            {qList.map(
                                (
                                    question,
                                    index
                                ) => {
                                    const id =
                                        qId(
                                            question,
                                            index
                                        )

                                    const type =
                                        qType(
                                            question
                                        )

                                    if (
                                        type ===
                                        'heading'
                                    ) {
                                        return (
                                            <div
                                                key={
                                                    id
                                                }
                                                id={
                                                    id
                                                }
                                                style={{
                                                    scrollMarginTop:
                                                        18,
                                                    marginTop:
                                                        index >
                                                            0
                                                            ? 8
                                                            : 0,
                                                    padding:
                                                        '12px 2px 4px'
                                                }}
                                            >
                                                <Space
                                                    align='center'
                                                    size={
                                                        8
                                                    }
                                                >
                                                    <div
                                                        style={{
                                                            width:
                                                                32,
                                                            height:
                                                                32,
                                                            borderRadius:
                                                                10,
                                                            display:
                                                                'grid',
                                                            placeItems:
                                                                'center',
                                                            background:
                                                                token.colorPrimaryBg,
                                                            color:
                                                                token.colorPrimary,
                                                            fontWeight:
                                                                700
                                                        }}
                                                    >
                                                        {
                                                            sections.findIndex(
                                                                section =>
                                                                    section.anchorId ===
                                                                    id
                                                            ) +
                                                            1
                                                        }
                                                    </div>

                                                    <Title
                                                        level={
                                                            5
                                                        }
                                                        style={{
                                                            margin:
                                                                0
                                                        }}
                                                    >
                                                        {qText(
                                                            question,
                                                            index
                                                        )}
                                                    </Title>
                                                </Space>

                                                {question.description ? (
                                                    <Paragraph
                                                        type='secondary'
                                                        style={{
                                                            margin:
                                                                '5px 0 0 40px'
                                                        }}
                                                    >
                                                        {
                                                            question.description
                                                        }
                                                    </Paragraph>
                                                ) : null}

                                                <Divider
                                                    style={{
                                                        margin:
                                                            '10px 0 0'
                                                    }}
                                                />
                                            </div>
                                        )
                                    }

                                    const value =
                                        answerOf(
                                            answers,
                                            question,
                                            index
                                        )

                                    const questionNumber =
                                        qList
                                            .slice(
                                                0,
                                                index +
                                                1
                                            )
                                            .filter(
                                                item =>
                                                    !isHeading(
                                                        item
                                                    )
                                            )
                                            .length

                                    return (
                                        <Card
                                            key={
                                                id
                                            }
                                            id={
                                                id
                                            }
                                            style={{
                                                borderRadius:
                                                    16,
                                                border: `1px solid ${token.colorBorderSecondary}`,
                                                boxShadow:
                                                    '0 5px 18px rgba(15,23,42,.035)',
                                                scrollMarginTop:
                                                    18
                                            }}
                                            styles={{
                                                body: {
                                                    padding:
                                                        15
                                                }
                                            }}
                                        >
                                            <div
                                                style={{
                                                    display:
                                                        'flex',
                                                    alignItems:
                                                        'flex-start',
                                                    gap: 12
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        width:
                                                            34,
                                                        height:
                                                            34,
                                                        borderRadius:
                                                            11,
                                                        display:
                                                            'grid',
                                                        placeItems:
                                                            'center',
                                                        background:
                                                            token.colorPrimaryBg,
                                                        color:
                                                            token.colorPrimary,
                                                        flex:
                                                            '0 0 auto',
                                                        fontSize:
                                                            14
                                                    }}
                                                >
                                                    {getQuestionIcon(
                                                        type
                                                    )}
                                                </div>

                                                <div
                                                    style={{
                                                        flex:
                                                            1,
                                                        minWidth:
                                                            0
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display:
                                                                'flex',
                                                            alignItems:
                                                                'flex-start',
                                                            justifyContent:
                                                                'space-between',
                                                            gap:
                                                                10
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                minWidth:
                                                                    0
                                                            }}
                                                        >
                                                            <Text
                                                                type='secondary'
                                                                style={{
                                                                    display:
                                                                        'block',
                                                                    fontSize:
                                                                        10,
                                                                    textTransform:
                                                                        'uppercase',
                                                                    letterSpacing:
                                                                        '.05em',
                                                                    fontWeight:
                                                                        600
                                                                }}
                                                            >
                                                                Question{' '}
                                                                {
                                                                    questionNumber
                                                                }
                                                            </Text>

                                                            <Text
                                                                strong
                                                                style={{
                                                                    display:
                                                                        'block',
                                                                    marginTop:
                                                                        2,
                                                                    fontSize:
                                                                        14,
                                                                    lineHeight:
                                                                        1.5
                                                                }}
                                                            >
                                                                {qText(
                                                                    question,
                                                                    index
                                                                )}

                                                                {question.required ? (
                                                                    <Text
                                                                        type='danger'
                                                                        style={{
                                                                            marginLeft:
                                                                                4
                                                                        }}
                                                                    >
                                                                        *
                                                                    </Text>
                                                                ) : null}
                                                            </Text>
                                                        </div>

                                                        <Tag
                                                            style={{
                                                                margin:
                                                                    0,
                                                                borderRadius:
                                                                    999,
                                                                flex:
                                                                    '0 0 auto'
                                                            }}
                                                        >
                                                            {
                                                                type
                                                            }
                                                        </Tag>
                                                    </div>

                                                    {question.description ? (
                                                        <Text
                                                            type='secondary'
                                                            style={{
                                                                display:
                                                                    'block',
                                                                marginTop:
                                                                    4,
                                                                fontSize:
                                                                    12
                                                            }}
                                                        >
                                                            {
                                                                question.description
                                                            }
                                                        </Text>
                                                    ) : null}

                                                    <div
                                                        style={{
                                                            marginTop:
                                                                12,
                                                            padding:
                                                                '12px 13px',
                                                            borderRadius:
                                                                12,
                                                            background:
                                                                token.colorFillAlter,
                                                            border: `1px solid ${token.colorBorderSecondary}`
                                                        }}
                                                    >
                                                        <AnswerValue
                                                            q={
                                                                question
                                                            }
                                                            value={
                                                                value
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </Card>
                                    )
                                }
                            )}
                        </div>
                    )}
                </div>

                <style>{`
                @media (max-width: 900px) {
                    .survey-response-viewer-layout {
                        grid-template-columns: 1fr !important;
                    }

                    .survey-response-viewer-layout > .ant-card:first-child {
                        position: static !important;
                    }
                }

                @media (max-width: 640px) {
                    .survey-response-viewer-summary {
                        grid-template-columns: 1fr !important;
                    }
                }
            `}</style>
            </div>
        )
    }

export default SurveyResponseViewer
