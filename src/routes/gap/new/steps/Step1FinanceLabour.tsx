import React from 'react'
import { Card, Col, Form, Input, Row, Typography, theme } from 'antd'
import QuestionGroup from '../components/QuestionGroup'
import { financialManagement, labourHSE } from '../questionBanks'
import type { GroupId } from '../types'

const { Text } = Typography

const BankAccessExtra: React.FC<{ disabled?: boolean }> = ({ disabled }) => {
    const { token } = theme.useToken()

    return (
        <Card
            size="small"
            style={{ borderRadius: 14, border: `1px solid ${token.colorBorderSecondary}` }}
            styles={{ body: { padding: 14 } }}
        >
            <Row gutter={[12, 4]}>
                <Col xs={24} md={12}>
                    <Form.Item
                        name={['financialManagement', 'bankAccess', 'username']}
                        label="Bank Username"
                    >
                        <Input
                            placeholder="(Optional) Username for read-only access"
                            disabled={disabled}
                        />
                    </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                    <Form.Item
                        name={['financialManagement', 'bankAccess', 'password']}
                        label="Bank Password"
                    >
                        <Input.Password
                            placeholder="(Optional) Password for read-only access"
                            disabled={disabled}
                        />
                    </Form.Item>
                </Col>
                <Col span={24}>
                    <Text type="secondary" style={{ fontSize: 12.5 }}>
                        Note: storing credentials in plaintext is discouraged. Share
                        securely with finance only.
                    </Text>
                </Col>
            </Row>
        </Card>
    )
}

const Step1FinanceLabour: React.FC<{
    disabled?: boolean
    registerGroupRef?: (id: GroupId, el: HTMLDivElement | null) => void
}> = ({ disabled, registerGroupRef }) => (
    <>
        <QuestionGroup
            ref={el => registerGroupRef?.('financialManagement', el)}
            title="SMME Financial Management"
            baseKey="financialManagement.q"
            questions={financialManagement}
            disabled={disabled}
            firstInStep
            extras={index =>
                index === 15 ? <BankAccessExtra disabled={disabled} /> : null
            }
        />
        <QuestionGroup
            ref={el => registerGroupRef?.('labourHSE', el)}
            title="Labour / HSE Compliance"
            baseKey="labourHSE"
            questions={labourHSE}
            disabled={disabled}
        />
    </>
)

export default Step1FinanceLabour
