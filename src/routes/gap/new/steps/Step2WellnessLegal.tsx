import React from 'react'
import { Card, Checkbox, Form, Select, theme } from 'antd'
import QuestionGroup from '../components/QuestionGroup'
import { legal, legalAreas, wellness, wellnessProgrammes } from '../questionBanks'
import type { GroupId } from '../types'

const ExtraCard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { token } = theme.useToken()

    return (
        <Card
            size="small"
            style={{ borderRadius: 14, border: `1px solid ${token.colorBorderSecondary}` }}
            styles={{ body: { padding: 14 } }}
        >
            {children}
        </Card>
    )
}

const Step2WellnessLegal: React.FC<{
    disabled?: boolean
    registerGroupRef?: (id: GroupId, el: HTMLDivElement | null) => void
}> = ({ disabled, registerGroupRef }) => (
    <>
        <QuestionGroup
            ref={el => registerGroupRef?.('wellness', el)}
            title="SMME Wellness"
            baseKey="wellness.q"
            questions={wellness}
            disabled={disabled}
            firstInStep
            extras={index =>
                index === 2 ? (
                    <ExtraCard>
                        <Form.Item
                            label="If Yes, select programmes"
                            name={['wellness', 'programmes']}
                            style={{ marginBottom: 0 }}
                        >
                            <Checkbox.Group options={wellnessProgrammes} disabled={disabled} />
                        </Form.Item>
                    </ExtraCard>
                ) : null
            }
        />
        <QuestionGroup
            ref={el => registerGroupRef?.('legal', el)}
            title="SMME Legal"
            baseKey="legal.q"
            questions={legal}
            disabled={disabled}
            extras={index =>
                index === 5 ? (
                    <ExtraCard>
                        <Form.Item
                            label="Select Legal Areas (if applicable)"
                            name={['legal', 'areas']}
                            style={{ marginBottom: 0 }}
                        >
                            <Select
                                mode="multiple"
                                allowClear
                                placeholder="Select legal assistance areas"
                                options={legalAreas.map(area => ({ value: area, label: area }))}
                                disabled={disabled}
                            />
                        </Form.Item>
                    </ExtraCard>
                ) : null
            }
        />
    </>
)

export default Step2WellnessLegal
