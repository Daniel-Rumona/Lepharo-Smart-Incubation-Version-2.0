import React from 'react'
import { Form, Input, Typography } from 'antd'
import QuestionGroup from '../components/QuestionGroup'
import { trainingNeedsYN } from '../questionBanks'
import type { GroupId } from '../types'

const { Title } = Typography
const { TextArea } = Input

const TRAINING_CATEGORIES: Array<{ key: string; label: string }> = [
    { key: 'management', label: '9.1 Middle & Senior Management' },
    { key: 'supervisors', label: '9.2 Supervisors' },
    { key: 'workforce', label: '9.3 Workforce' },
    { key: 'support', label: '9.4 Support Staff' }
]

const Step4TrainingNeeds: React.FC<{
    disabled?: boolean
    registerGroupRef?: (id: GroupId, el: HTMLDivElement | null) => void
}> = ({ disabled, registerGroupRef }) => (
    <>
        <QuestionGroup
            ref={el => registerGroupRef?.('trainingNeeds', el)}
            title="SMME Training Needs"
            baseKey="trainingNeeds.yn"
            questions={trainingNeedsYN}
            disabled={disabled}
            firstInStep
        />

        <div style={{ marginTop: 28 }}>
            <Title level={5} style={{ marginBottom: 12 }}>
                Training needs by role
            </Title>

            <Form.Item
                label="If yes to SDL, which SETA?"
                name={['trainingNeeds', 'setaName']}
                style={{ maxWidth: 360 }}
            >
                <Input placeholder="SETA name (optional)" disabled={disabled} />
            </Form.Item>

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: 16
                }}
            >
                {TRAINING_CATEGORIES.map(category => (
                    <Form.Item
                        key={category.key}
                        label={category.label}
                        name={['trainingNeeds', 'categories', category.key]}
                        style={{ marginBottom: 0 }}
                    >
                        <TextArea
                            rows={3}
                            placeholder={`Training needs for ${category.label
                                .replace(/^\d\.\d\s/, '')
                                .toLowerCase()}`}
                            disabled={disabled}
                        />
                    </Form.Item>
                ))}
            </div>
        </div>
    </>
)

export default Step4TrainingNeeds
