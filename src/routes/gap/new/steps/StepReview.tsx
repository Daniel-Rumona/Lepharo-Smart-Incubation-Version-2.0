import React, { useState } from 'react'
import { Alert, Button, Card, Col, Row, Space, Tag, Typography, theme } from 'antd'
import { ArrowLeftOutlined, EditOutlined, RightOutlined } from '@ant-design/icons'
import {
    financialManagement,
    labourHSE,
    LEGAL_AREAS_QUESTION_INDEX,
    legal,
    marketLinkage,
    marketingCommunication,
    psychometric,
    qualityManagement,
    SETA_QUESTION_INDEX,
    TRAINING_NEED_FOLLOW_UPS,
    trainingNeedsYN,
    wellness,
    WELLNESS_PROGRAMMES_QUESTION_INDEX
} from '../questionBanks'
import { GROUP_META, missingFollowUps } from '../gapHelpers'
import type { GroupId } from '../types'

const { Text } = Typography

/** Questions that keep a slot in the answers but are not asked as Yes/No. */
const HIDDEN_QUESTIONS: Partial<Record<GroupId, number[]>> = {
    trainingNeeds: [SETA_QUESTION_INDEX]
}

const isAsked = (groupId: GroupId, index: number) =>
    !HIDDEN_QUESTIONS[groupId]?.includes(index)

/** What the SME gave under a question once they answered Yes (programmes, legal areas, SETA, training needed). */
const followUpText = (groupId: GroupId, index: number, values: any): string | null => {
    const list = (items: unknown) => (Array.isArray(items) && items.length ? items.join(', ') : null)
    if (groupId === 'wellness' && index === WELLNESS_PROGRAMMES_QUESTION_INDEX) return list(values?.wellness?.programmes)
    if (groupId === 'legal' && index === LEGAL_AREAS_QUESTION_INDEX) return list(values?.legal?.areas)
    if (groupId !== 'trainingNeeds') return null
    if (index === 0) return values?.trainingNeeds?.setaName ? `SETA: ${values.trainingNeeds.setaName}` : null
    const need = TRAINING_NEED_FOLLOW_UPS[index]
    return need ? values?.trainingNeeds?.categories?.[need.key] || null : null
}

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
            isAsked(groupId, index) && getAt(values, [...base, index, 'answer']) ? count + 1 : count,
        0
    )
}

const askedCountFor = (groupId: GroupId) =>
    GROUP_QUESTIONS[groupId].questions.filter((_q, index) => isAsked(groupId, index)).length

/** Follow-ups this group's Yes answers still need (see missingFollowUps). */
const missingForGroup = (groupId: GroupId, values: any) =>
    missingFollowUps(values)
        .filter(item => item.groupId === groupId)
        .map(item => item.message)

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
    const total = askedCountFor(groupId)
    const answered = answeredCountFor(groupId, values)
    const needsDetail = missingForGroup(groupId, values).length > 0
    const complete = answered === total && !needsDetail

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
                    {answered < total ? `${answered}/${total} answered` : needsDetail ? 'Needs detail' : `${answered}/${total} answered`}
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
                {answered} of {askedCountFor(groupId)} answered
            </Text>

            {missingForGroup(groupId, values).map(message => (
                <Text key={message} type="warning" style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
                    {message}. Tap Edit to add it.
                </Text>
            ))}

            {questions.map((question, index) => {
                if (!isAsked(groupId, index)) return null
                const answer = getAt(values, [...base, index, 'answer'])
                const comment = getAt(values, [...base, index, 'comment'])
                const followUp = answer === 'Yes' ? followUpText(groupId, index, values) : null

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
                            {followUp && (
                                <Text style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                                    {followUp}
                                </Text>
                            )}
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
