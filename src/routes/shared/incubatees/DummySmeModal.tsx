import React, { useState } from 'react'
import { Typography, Space, Button, Modal, Form, Input, InputNumber, Select, Row, Col, message } from 'antd'
import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { isQuantilytixDomain } from '@/utils/quantilytixAccess'
import { SA_PROVINCES, SA_SECTORS } from './participantsData'
import { createDummySmeRecord, generateRandomSaSme, resolveActiveProgramMeta } from './dummySme'

const { Text } = Typography

type DummySmeModalProps = {
    open: boolean
    onClose: () => void
    activeProgramId?: string | null
    isAllPrograms: boolean
    /** Called after the dummy SMEs are created, so the list can reload. */
    onCreated: () => Promise<void> | void
}

/** Internal-only form for adding one dummy SME, or several random ones, to the active programme. */
export const DummySmeModal: React.FC<DummySmeModalProps> = ({ open, onClose, activeProgramId, isAllPrograms, onCreated }) => {
    const [creatingDummySme, setCreatingDummySme] = useState(false)
    const [dummySmeQuantity, setDummySmeQuantity] = useState(1)
    const [dummySmeForm] = Form.useForm()

    const handleGenerateRandomFill = () => {
        dummySmeForm.setFieldsValue(generateRandomSaSme())
    }

    const handleCreateDummySme = async () => {
        if (!activeProgramId || isAllPrograms) {
            message.error('Select a specific program before adding a dummy SME.')
            return
        }

        setCreatingDummySme(true)

        try {
            const programMeta = await resolveActiveProgramMeta(activeProgramId)

            if (dummySmeQuantity > 1) {
                let loginFailures = 0
                for (let i = 0; i < dummySmeQuantity; i++) {
                    const result = await createDummySmeRecord(generateRandomSaSme(), programMeta)
                    if (!result.authUid) loginFailures += 1
                }
                message.success(`Created ${dummySmeQuantity} random dummy SMEs.`)
                if (loginFailures) {
                    message.warning(`${loginFailures} of them could not get a login account — check manually.`)
                }
            } else {
                const values = await dummySmeForm.validateFields()
                const result = await createDummySmeRecord(values, programMeta)
                message.success('Dummy SME created successfully.')
                if (!result.authUid) {
                    message.warning('The SME record was created, but its login account could not be set up — check manually.')
                }
            }

            dummySmeForm.resetFields()
            onClose()
            setDummySmeQuantity(1)
            await onCreated()
        } catch (error: any) {
            if (error?.errorFields) return
            console.error(error)
            message.error(error?.message || 'Failed to create dummy SME.')
        } finally {
            setCreatingDummySme(false)
        }
    }

    return (
        <Modal
            title='Add Dummy SME (Internal Only)'
            open={open}
            onCancel={() => {
                onClose()
                dummySmeForm.resetFields()
                setDummySmeQuantity(1)
            }}
            onOk={handleCreateDummySme}
            okText={dummySmeQuantity > 1 ? `Create ${dummySmeQuantity} Random SMEs` : 'Create Dummy SME'}
            okButtonProps={{ icon: <PlusOutlined />, loading: creatingDummySme }}
            centered
            destroyOnClose
            styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        >
            <Text type='secondary' style={{ display: 'block', marginBottom: 16 }}>
                Dummy SMEs are only visible to @quantilytix.co.za users and are added directly under
                the currently selected program, skipping the full application form. Each one also gets
                a real login (a welcome/password email is sent to its address) so you can sign in as
                that SME to confirm its Diagnostic Plan and add evidence, just like a real applicant.
            </Text>

            <Form.Item label='Quantity' style={{ marginBottom: 12 }}>
                <Space align='center'>
                    <InputNumber
                        min={1}
                        max={20}
                        value={dummySmeQuantity}
                        onChange={value => setDummySmeQuantity(Number(value) || 1)}
                        style={{ width: 100 }}
                    />
                    <Text type='secondary'>
                        More than 1 generates fully random SMEs and skips the fields below.
                    </Text>
                </Space>
            </Form.Item>

            {dummySmeQuantity === 1 && (
                <Form form={dummySmeForm} layout='vertical'>
                    <Space style={{ marginBottom: 12 }}>
                        <Button icon={<ThunderboltOutlined />} onClick={handleGenerateRandomFill}>
                            Generate random SA details
                        </Button>
                    </Space>

                    <Form.Item
                        name='businessName'
                        label='Business Name'
                        rules={[{ required: true, message: 'Enter a business name' }]}
                    >
                        <Input placeholder='e.g. Thabo Trading (Pty) Ltd' />
                    </Form.Item>

                    <Form.Item
                        name='contactPerson'
                        label='Contact Person'
                        rules={[{ required: true, message: 'Enter a contact person' }]}
                    >
                        <Input placeholder='Full name' />
                    </Form.Item>

                    <Form.Item
                        name='email'
                        label='Contact Email'
                        rules={[
                            { required: true, message: 'Enter an email address' },
                            { type: 'email', message: 'Enter a valid email address' },
                            {
                                validator: (_: unknown, value: string) =>
                                    isQuantilytixDomain(value)
                                        ? Promise.resolve()
                                        : Promise.reject(
                                            new Error('Dummy SMEs must use a @quantilytix.co.za email address')
                                        )
                            }
                        ]}
                    >
                        <Input placeholder='name@quantilytix.co.za' />
                    </Form.Item>

                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name='phone' label='Phone'>
                                <Input placeholder='e.g. 0821234567' />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name='gender' label='Gender'>
                                <Select
                                    allowClear
                                    options={[
                                        { label: 'Male', value: 'Male' },
                                        { label: 'Female', value: 'Female' }
                                    ]}
                                />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name='province' label='Province'>
                                <Select
                                    allowClear
                                    showSearch
                                    options={SA_PROVINCES.map(p => ({ label: p, value: p }))}
                                />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name='town' label='Town/City'>
                                <Input placeholder='e.g. Polokwane' />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item name='sector' label='Sector'>
                        <Select allowClear showSearch options={SA_SECTORS.map(s => ({ label: s, value: s }))} />
                    </Form.Item>
                </Form>
            )}
        </Modal>
    )
}
