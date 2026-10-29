import React from 'react'
import { Button, Checkbox, Col, Form, Input, Radio, Row, Segmented, Tooltip } from 'antd'
import { DeleteOutlined, PlusOutlined, StarFilled, WhatsAppOutlined } from '@ant-design/icons'
import { genderFromSouthAfricanID, isValidSouthAfricanID } from './smeRecords'

/**
 * Directors as a list: name is the only required detail, except for the main
 * contact, whose email and phone are used for the SME's platform invite.
 * A valid SA ID fills in the gender it encodes when none is chosen yet.
 */
export const DirectorsSection: React.FC = () => {
    const form = Form.useFormInstance()
    const primary = Form.useWatch('primaryDirector', form) ?? 0

    return (
        <Form.List name='directors'>
            {(fields, { add, remove }) => (
                <div className='sf-directors'>
                    {fields.map((field, index) => {
                        const isPrimary = primary === index
                        return (
                            <div key={field.key} className={`sf-director${isPrimary ? ' is-primary' : ''}`}>
                                <div className='sf-director-head'>
                                    <span className='sf-director-title'>
                                        Director {index + 1}
                                        {isPrimary && <span className='sf-director-badge'><StarFilled aria-hidden='true' /> Main contact</span>}
                                    </span>
                                    <span className='sf-director-actions'>
                                        {!isPrimary && (
                                            <Button size='small' type='text' onClick={() => form.setFieldValue('primaryDirector', index)}>
                                                Make main contact
                                            </Button>
                                        )}
                                        {fields.length > 1 && (
                                            <Tooltip title='Remove director'>
                                                <Button
                                                    size='small'
                                                    type='text'
                                                    danger
                                                    icon={<DeleteOutlined />}
                                                    aria-label={`Remove director ${index + 1}`}
                                                    onClick={() => {
                                                        remove(field.name)
                                                        // Keep the main contact on the same person, or the first one if they were removed.
                                                        if (primary === index) form.setFieldValue('primaryDirector', 0)
                                                        else if (primary > index) form.setFieldValue('primaryDirector', primary - 1)
                                                    }}
                                                />
                                            </Tooltip>
                                        )}
                                    </span>
                                </div>
                                <Row gutter={[12, 0]}>
                                    <Col xs={24} md={12}>
                                        <Form.Item name={[field.name, 'name']} label='Full name' rules={[{ required: true, whitespace: true, message: 'Enter the director’s name' }]}>
                                            <Input autoComplete='off' />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={12}>
                                        <Form.Item
                                            name={[field.name, 'idNumber']}
                                            label='SA ID number'
                                            rules={[{ validator: (_, v) => (!v || isValidSouthAfricanID(v) ? Promise.resolve() : Promise.reject(new Error('Not a valid SA ID number'))) }]}
                                            normalize={v => String(v || '').replace(/\D/g, '').slice(0, 13)}
                                        >
                                            <Input
                                                inputMode='numeric'

                                                onChange={e => {
                                                    const gender = genderFromSouthAfricanID(e.target.value)
                                                    if (gender && !form.getFieldValue(['directors', field.name, 'gender'])) {
                                                        form.setFieldValue(['directors', field.name, 'gender'], gender)
                                                    }
                                                }}
                                            />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={12}>
                                        <Form.Item
                                            name={[field.name, 'email']}
                                            label='Email'
                                            rules={[
                                                { type: 'email', message: 'Enter a valid email' },
                                                { required: isPrimary, message: 'The main contact needs an email' }
                                            ]}
                                        >
                                            <Input type='email' />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={12}>
                                        <Form.Item
                                            name={[field.name, 'phone']}
                                            label='Phone'
                                            rules={[{ required: isPrimary, whitespace: true, message: 'The main contact needs a phone number' }]}
                                            extra={
                                                // A contact detail only: permission to message them on WhatsApp
                                                // is still asked of the person when they sign in.
                                                <Form.Item noStyle name={[field.name, 'onWhatsApp']} valuePropName='checked'>
                                                    <Checkbox className='sf-whatsapp'>
                                                        <WhatsAppOutlined aria-hidden='true' /> On WhatsApp
                                                    </Checkbox>
                                                </Form.Item>
                                            }
                                        >
                                            <Input inputMode='tel' />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24}>
                                        <Form.Item name={[field.name, 'gender']} label='Gender' className='sf-item-tight'>
                                            <Segmented
                                                block
                                                options={[
                                                    { label: 'Female', value: 'Female' },
                                                    { label: 'Male', value: 'Male' },
                                                    { label: 'Not given', value: '' }
                                                ]}
                                            />
                                        </Form.Item>
                                    </Col>
                                </Row>
                            </div>
                        )
                    })}
                    <Button block icon={<PlusOutlined />} onClick={() => add({ gender: '' })} className='sf-add-director'>
                        Add another director
                    </Button>
                    {/* The main contact as a field, so it validates and saves with the form. */}
                    <Form.Item name='primaryDirector' hidden initialValue={0}>
                        <Radio.Group />
                    </Form.Item>
                </div>
            )}
        </Form.List>
    )
}
