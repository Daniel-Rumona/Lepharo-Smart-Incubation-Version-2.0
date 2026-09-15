import React, { useState } from 'react'
import { Alert, Button, Card, Col, Row, Space, Tag, Typography, theme } from 'antd'
import { ArrowLeftOutlined, EditOutlined, RightOutlined } from '@ant-design/icons'
import {
    financialManagement,
    labourHSE,
    legal,
    marketLinkage,
    marketingCommunication,
    psychometric,
    qualityManagement,
    trainingNeedsYN,
    wellness
} from '../questionBanks'
import { GROUP_META } from '../gapHelpers'
import type { GroupId } from '../types'

const { Text } = Typography

const GROUP_QUESTIONS: Record<GroupId, { baseKey: string; questions: string[] }> = {
    marketingCommunication: { baseKey: 'marketingCommunication', questions: marketingCommunication },
    psychometric: { baseKey: 'psychometric', questions: psychometric },
    financialManagement: { baseKey: 'financialManagement.q', questions: financialManagement },
    labourHSE: { baseKey: 'labourHSE', questions: labourHSE },
    wellness: { baseKey: 'wellness.q', questions: wellness },
    legal: { baseKey: 'legal.q', questions: legal },
    marketLinkage: { baseKey: 'marketLinkage', questions: marketLinkage },
    qualityManagement: { baseKey: 'qualityManagement', questions: qualityManagement },
    trainingNeeds: { baseKey: 'trainingNeeds.yn', questions: trainingNeedsYN }
}

const getAt = (values: any, path: (string | number)[]) =>
    path.reduce((acc: any, key) => (acc == null ? undefined : acc[key]), values)

const answeredCountFor = (groupId: GroupId, values: any) => {
    const { baseKey, questions } = GROUP_QUESTIONS[groupId]
    const base = baseKey.split('.')
    return questions.reduce(
        (count, _q, index) =>
            getAt(values, [...base, index, 'answer']) ? count + 1 : count,
        0
    )
}

// Compact, clickable row shown in the overview list — the full question
// list only renders for whichever one group is currently opened, so the
// review screen isn't one long scroll of every answer at once.
const GroupOverviewRow: React.FC<{
    groupId: GroupId
    values: any
    onOpen: (groupId: GroupId) => void
}> = ({ groupId, values, onOpen }) => {
    const { token } = theme.useToken()
    const meta = GROUP_META.find(group => group.id === groupId)!
    const total = GROUP_QUESTIONS[groupId].questions.length
    const answered = answeredCountFor(groupId, values)
    const complete = answered === total

    return (
        <button
            type="button"
            onClick={() => onOpen(groupId)}
            style={{
                appearance: 'none',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '13px 16px',
                borderRadius: 12,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                color: 'inherit',
                font: 'inherit',
                textAlign: 'left',
                cursor: 'pointer'
            }}
        >
            <Text strong style={{ fontSize: 13.5 }}>
                {meta.title}
            </Text>
            <Space size={8} style={{ flex: '0 0 auto' }}>
                <Text
                    style={{
                        fontSize: 12,
                        color: complete ? token.colorSuccess : token.colorWarning
                    }}
                >
                    {answered}/{total} answered
                </Text>
                <RightOutlined style={{ fontSize: 11, color: token.colorTextTertiary }} />
            </Space>
        </button>
    )
}

// Full question list for one group — only shown once its overview row has
// been tapped.
const GroupDetail: React.FC<{
    groupId: GroupId
    values: any
    onBack: () => void
    onEdit: (groupId: GroupId) => void
}> = ({ groupId, values, onBack, onEdit }) => {
    const { token } = theme.useToken()
    const meta = GROUP_META.find(group => group.id === groupId)!
    const { baseKey, questions } = GROUP_QUESTIONS[groupId]
    const base = baseKey.split('.')
    const answered = answeredCountFor(groupId, values)

    return (
        <Card
            size="small"
            style={{ borderRadius: 14 }}
            styles={{ body: { paddingTop: 12 } }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 4
                }}
            >
                <Button
                    type="text"
                    size="small"
                    icon={<ArrowLeftOutlined />}
                    onClick={onBack}
                    style={{ paddingInline: 4 }}
                >
                    Back to sections
                </Button>

                <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => onEdit(groupId)}
                >
                    Edit
                </Button>
            </div>

            <Text strong style={{ fontSize: 15, display: 'block', marginTop: 4 }}>
                {meta.title}
            </Text>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                {answered} of {questions.length} answered
            </Text>

            {questions.map((question, index) => {
                const answer = getAt(values, [...base, index, 'answer'])
                const comment = getAt(values, [...base, index, 'comment'])

                return (
                    <div
                        key={`${baseKey}-${index}`}
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: 10,
                            padding: '9px 0',
                            borderTop: `1px solid ${token.colorBorderSecondary}`
                        }}
                    >
                        <div style={{ minWidth: 0 }}>
                            <Text style={{ fontSize: 12.5 }}>{question}</Text>
                            {comment && (
                                <Text
                                    type="secondary"
                                    italic
                                    style={{ display: 'block', fontSize: 11.5, marginTop: 2 }}
                                >
                                    {comment}
                                </Text>
                            )}
                        </div>
                        <Tag
                            color={answer === 'Yes' ? 'green' : answer === 'No' ? 'default' : 'red'}
                            style={{ flex: '0 0 auto', marginInlineEnd: 0 }}
                        >
                            {answer || 'Not answered'}
                        </Tag>
                    </div>
                )
            })}
        </Card>
    )
}

const StepReview: React.FC<{
    values: any
    smmeName: string
    smmeSignatureUrl: string
    onEditGroup: (groupId: GroupId) => void
}> = ({ values, smmeName, smmeSignatureUrl, onEditGroup }) => {
    const { token } = theme.useToken()
    const [openGroupId, setOpenGroupId] = useState<GroupId | null>(null)

    return (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card
                title="Company & Signatory"
                style={{ borderRadius: 14, background: token.colorFillQuaternary }}
                styles={{ body: { paddingTop: 12 } }}
            >
                <Row gutter={[16, 8]}>
                    <Col xs={24} md={12}>
                        <Text type="secondary">Company Name</Text>
                        <div>
                            <Text strong>{values?.company?.name || '—'}</Text>
                        </div>
                    </Col>
                    <Col xs={24} md={12}>
                        <Text type="secondary">Region</Text>
                        <div>
                            <Text strong>{values?.company?.region || '—'}</Text>
                        </div>
                    </Col>
                    <Col xs={24} md={12}>
                        <Text type="secondary">Contact</Text>
                        <div>
                            <Text strong>{values?.company?.contact || '—'}</Text>
                        </div>
                    </Col>
                    <Col xs={24} md={12}>
                        <Text type="secondary">Email</Text>
                        <div>
                            <Text strong>{values?.company?.email || '—'}</Text>
                        </div>
                    </Col>
                </Row>

                <Row gutter={[16, 8]} style={{ marginTop: 12 }}>
                    <Col xs={24} md={12}>
                        <Text type="secondary">SMME (Name)</Text>
                        <div>
                            <Text strong>{smmeName || <em>Not on profile</em>}</Text>
                        </div>
                    </Col>
                    <Col xs={24} md={12}>
                        <Text type="secondary">SMME Signature</Text>
                        <div style={{ marginTop: 8 }}>
                            {smmeSignatureUrl ? (
                                <img
                                    src={smmeSignatureUrl}
                                    alt="SMME Signature"
                                    style={{
                                        maxWidth: 220,
                                        maxHeight: 100,
                                        objectFit: 'contain',
                                        border: `1px solid ${token.colorBorderSecondary}`,
                                        padding: 8,
                                        borderRadius: 8,
                                        background: token.colorBgContainer
                                    }}
                                />
                            ) : (
                                <em>No signature image on profile</em>
                            )}
                        </div>
                    </Col>
                </Row>
            </Card>

            {openGroupId ? (
                <GroupDetail
                    groupId={openGroupId}
                    values={values}
                    onBack={() => setOpenGroupId(null)}
                    onEdit={onEditGroup}
                />
            ) : (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    {GROUP_META.map(group => (
                        <GroupOverviewRow
                            key={group.id}
                            groupId={group.id}
                            values={values}
                            onOpen={setOpenGroupId}
                        />
                    ))}
                </Space>
            )}

            <Alert
                message="Confirm & Submit"
                description="By submitting this assessment, you confirm that all the information provided is true and accurate to the best of your knowledge."
                type="info"
                showIcon
                style={{ borderRadius: 14 }}
            />
            <Alert
                message="Digital Signature Notice"
                description="Your name and a digital signature will be automatically attached to this document. The onboarding team will review your responses and contact you if further information is required."
                type="success"
                showIcon
                style={{ borderRadius: 14 }}
            />
            <Alert
                message="Important"
                description="Once submitted, you will not be able to edit your responses until the team reviews them."
                type="warning"
                showIcon
                style={{ borderRadius: 14 }}
            />
        </Space>
    )
}

export default StepReview
