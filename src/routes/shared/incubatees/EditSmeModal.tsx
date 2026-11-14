import React, { useEffect, useState } from 'react'
import { Row, Col, Typography, message, Input, Select, Button, Modal, Form, InputNumber, Checkbox, AutoComplete, Spin, theme } from 'antd'
import { ArrowLeftOutlined, RightOutlined, IdcardOutlined, EnvironmentOutlined, PieChartOutlined, ManOutlined, WomanOutlined, SaveOutlined, FileProtectOutlined, BankOutlined } from '@ant-design/icons'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    ACCOUNT_TYPES,
    SA_BANKS,
    SmeBankingDetails,
    loadSmeBankingDetails,
    saveSmeBankingDetails,
    useCanSeeBanking
} from '@/services/smeBankingDetails'
import { SA_PROVINCES, SA_SECTORS, SmeRow, cleanText, editInitialValues } from './participantsData'

const { Text } = Typography

export type EditSectionKey = 'identity' | 'contact' | 'ownership' | 'tax' | 'banking'

export const EDIT_SECTIONS: { key: EditSectionKey; title: string; description: string; icon: React.ReactNode; accent: string }[] = [
    { key: 'identity', title: 'Identity', description: 'Registration number, ID number, sector and gender', icon: <IdcardOutlined />, accent: '#1677ff' },
    { key: 'contact', title: 'Contact and location', description: 'Contact number, business address, town and province', icon: <EnvironmentOutlined />, accent: '#13c2c2' },
    { key: 'ownership', title: 'Ownership and B-BBEE', description: 'B-BBEE level and ownership percentages', icon: <PieChartOutlined />, accent: '#fa8c16' },
    { key: 'tax', title: 'Tax and registrations', description: 'Income tax, VAT and PAYE numbers, CSD number and tax compliance PIN', icon: <FileProtectOutlined />, accent: '#722ed1' },
    { key: 'banking', title: 'Banking details', description: 'Bank account, checked against the Bank Confirmation Letter. Finance only', icon: <BankOutlined />, accent: '#52c41a' }
]

// SARS and National Treasury formats. Kept loose enough to accept spaces.
const digitsOnly = (value: string) => String(value || '').replace(/\s/g, '')
const formatRule = (test: RegExp, label: string) => ({
    validator: (_: unknown, value?: string) =>
        !value || test.test(digitsOnly(value)) ? Promise.resolve() : Promise.reject(new Error(label))
})

// Matches the onboarding form: levels 1-4, and "5+" for level 5 and above.

// Form control: two side-by-side cards instead of a dropdown. Clicking the chosen card again clears it.
export const GenderCards: React.FC<{ value?: string; onChange?: (value?: string) => void }> = ({ value, onChange }) => {
    const { token } = theme.useToken()
    const options = [
        { value: 'Male', icon: <ManOutlined />, color: '#1677ff' },
        { value: 'Female', icon: <WomanOutlined />, color: '#eb2f96' }
    ]
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {options.map(option => {
                const active = value === option.value
                return (
                    <button
                        key={option.value}
                        type='button'
                        aria-pressed={active}
                        onClick={() => onChange?.(active ? undefined : option.value)}
                        style={{
                            font: 'inherit',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '12px 14px',
                            borderRadius: 10,
                            cursor: 'pointer',
                            textAlign: 'left',
                            color: token.colorText,
                            border: `1px solid ${active ? option.color : token.colorBorderSecondary}`,
                            background: active ? `${option.color}1f` : token.colorBgContainer,
                            boxShadow: active ? `0 0 0 2px ${option.color}33` : 'none'
                        }}
                    >
                        {/* Radio-style selector: filled when chosen, an empty ring when not. */}
                        <span
                            aria-hidden='true'
                            style={{
                                flex: '0 0 auto',
                                width: 18,
                                height: 18,
                                borderRadius: '50%',
                                boxSizing: 'border-box',
                                display: 'grid',
                                placeItems: 'center',
                                border: `2px solid ${active ? option.color : token.colorBorder}`
                            }}
                        >
                            {active && <span style={{ width: 8, height: 8, borderRadius: '50%', background: option.color }} />}
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <span style={{ fontSize: 20, lineHeight: 1, color: option.color }}>{option.icon}</span>
                            <span style={{ fontWeight: active ? 600 : 500 }}>{option.value}</span>
                        </span>
                    </button>
                )
            })}
        </div>
    )
}

// Form control for the B-BBEE level: L1-L4 in one row, "Level 5 and above" full width beneath.
// Same filled/empty selector as the gender cards; clicking the chosen card again clears it.
export const BeeLevelCards: React.FC<{ value?: number | '5+'; onChange?: (value?: number | '5+') => void }> = ({ value, onChange }) => {
    const { token } = theme.useToken()
    const accent = '#fa8c16'

    const renderCard = (optionValue: number | '5+', label: string, fullWidth = false) => {
        const active = value === optionValue
        return (
            <button
                key={String(optionValue)}
                type='button'
                aria-pressed={active}
                onClick={() => onChange?.(active ? undefined : optionValue)}
                style={{
                    font: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: fullWidth ? 'flex-start' : 'center',
                    gap: 8,
                    minWidth: 0,
                    padding: '10px 8px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    color: token.colorText,
                    border: `1px solid ${active ? accent : token.colorBorderSecondary}`,
                    background: active ? `${accent}1f` : token.colorBgContainer,
                    boxShadow: active ? `0 0 0 2px ${accent}33` : 'none'
                }}
            >
                <span
                    aria-hidden='true'
                    style={{
                        flex: '0 0 auto',
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        boxSizing: 'border-box',
                        display: 'grid',
                        placeItems: 'center',
                        border: `2px solid ${active ? accent : token.colorBorder}`
                    }}
                >
                    {active && <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent }} />}
                </span>
                <span style={{ fontWeight: active ? 600 : 500 }}>{label}</span>
            </button>
        )
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {[1, 2, 3, 4].map(level => renderCard(level, `L${level}`))}
            </div>
            {renderCard('5+', 'Level 5 and above', true)}
        </div>
    )
}

export type EditSmeModalProps = {
    row: SmeRow | null
    sectors: string[]
    onClose: () => void
    onSaved: (appId: string, patch: Partial<SmeRow>) => void
}

// Edits the demographics fields only. Opens on a list of sections; picking one slides to
// its form, with Back (to the list) and Update in the footer. There is no step indicator.
export const EditSmeModal: React.FC<EditSmeModalProps> = ({ row, sectors, onClose, onSaved }) => {
    const [form] = Form.useForm()
    const { token } = theme.useToken()
    const reduceMotion = !!useReducedMotion()
    const shift = reduceMotion ? 0 : 24
    const [section, setSection] = useState<EditSectionKey | null>(null)
    const [saving, setSaving] = useState(false)
    const { user } = useFullIdentity()
    const canSeeBanking = useCanSeeBanking()
    const [banking, setBanking] = useState<SmeBankingDetails | null>(null)

    // Keep the last SME so the content doesn't empty out while the modal fades away.
    const lastRow = React.useRef<SmeRow | null>(row)
    if (row) lastRow.current = row
    const shown = row || lastRow.current
    const open = !!row

    useEffect(() => {
        if (!open) setSection(null)
    }, [open, row?.appId])

    if (!shown) return null

    // Banking needs a participant record to key on, and only finance may see it.
    const participantId = String(shown.participantId || '').trim()
    const sections = EDIT_SECTIONS.filter(item => item.key !== 'banking' || (canSeeBanking && !!participantId))

    const openSection = (key: EditSectionKey) => {
        form.setFieldsValue(editInitialValues(shown))
        setSection(key)
        if (key === 'banking') {
            setBanking(null)
            loadSmeBankingDetails(participantId)
                .then(details => {
                    setBanking(details)
                    form.setFieldsValue({ ...details, verified: !!details.verified })
                })
                .catch(error => {
                    console.error('Failed to load banking details.', error)
                    message.error('Could not load the banking details.')
                    setSection(null)
                })
        }
    }

    // Changing any detail means it has to be checked against the letter again.
    const handleValuesChange = (changed: Record<string, unknown>) => {
        if (section !== 'banking') return
        if (Object.keys(changed).some(key => key !== 'verified')) form.setFieldValue('verified', false)
    }

    const handleUpdate = async () => {
        if (!section) return
        let values: any
        try {
            values = await form.validateFields()
        } catch {
            return
        }

        if (section === 'banking') {
            if (!banking) return
            setSaving(true)
            try {
                await saveSmeBankingDetails({
                    participantId,
                    values,
                    previous: banking,
                    verifier: {
                        uid: String((user as any)?.uid || (user as any)?.id || ''),
                        name: String((user as any)?.name || (user as any)?.email || '')
                    }
                })
                message.success('Banking details saved.')
                setSection(null)
            } catch (error) {
                console.error('Failed to save banking details.', error)
                message.error('Could not save the banking details. Please try again.')
            } finally {
                setSaving(false)
            }
            return
        }

        let payload: Record<string, any> = {}
        let patch: Partial<SmeRow> = {}

        if (section === 'tax') {
            const incomeTaxNumber = digitsOnly(values.incomeTaxNumber)
            const vatNumber = digitsOnly(values.vatNumber)
            const payeReference = digitsOnly(values.payeReference)
            const csdNumber = digitsOnly(values.csdNumber).toUpperCase()
            const taxCompliancePin = digitsOnly(values.taxCompliancePin).toUpperCase()
            payload = { incomeTaxNumber, vatNumber, payeReference, csdNumber, taxCompliancePin }
            patch = {
                incomeTaxNumber: incomeTaxNumber || undefined,
                vatNumber: vatNumber || undefined,
                payeReference: payeReference || undefined,
                csdNumber: csdNumber || undefined,
                taxCompliancePin: taxCompliancePin || undefined
            }
        } else if (section === 'identity') {
            const registrationNumber = cleanText(values.registrationNumber)
            const idNumber = cleanText(values.idNumber)
            const sector = cleanText(values.sector)
            const gender = cleanText(values.gender)
            payload = { registrationNumber, idNumber, sector, gender: gender || null }
            patch = {
                registrationNumber: registrationNumber || undefined,
                idNumber: idNumber || undefined,
                sector: sector || undefined,
                gender: gender || undefined
            }
        } else if (section === 'contact') {
            const phone = cleanText(values.phone)
            const businessAddress = cleanText(values.businessAddress)
            const town = cleanText(values.town)
            const province = cleanText(values.province)
            // Onboarding stores the town as "city"; the rest of the app reads "town", so both are kept in step.
            payload = { phone, businessAddress, town, city: town, province: province || null }
            patch = {
                phone: phone || '—',
                businessAddress: businessAddress || undefined,
                town: town || undefined,
                province: province || undefined
            }
        } else {
            const beeLevel = values.beeLevel ?? null
            const black = values.blackOwnedPercent ?? null
            const female = values.femaleOwnedPercent ?? null
            const youth = values.youthOwnedPercent ?? null
            payload = { beeLevel, blackOwnedPercent: black, femaleOwnedPercent: female, youthOwnedPercent: youth }
            patch = {
                beeLevel: beeLevel == null ? undefined : String(beeLevel),
                ownership: {
                    blackOwnedPercent: black ?? undefined,
                    femaleOwnedPercent: female ?? undefined,
                    youthOwnedPercent: youth ?? undefined
                }
            }
        }

        setSaving(true)
        try {
            const target = shown.participantId
                ? doc(db, 'participants', shown.participantId)
                : doc(db, 'applications', shown.appId)
            await updateDoc(target, { ...payload, updatedAt: serverTimestamp() })
            onSaved(shown.appId, patch)
            message.success('Details updated.')
            setSection(null)
        } catch (error) {
            console.error('Failed to update SME details.', error)
            message.error('Could not update the details. Please try again.')
        } finally {
            setSaving(false)
        }
    }

    const sectionMeta = EDIT_SECTIONS.find(item => item.key === section)

    // A fixed list: the standard sectors plus any already in use, so an SME's current sector is always selectable.
    const sectorOptions = Array.from(new Set([...SA_SECTORS, ...sectors, ...(shown.sector ? [shown.sector] : [])]))
        .sort((a, b) => a.localeCompare(b))
        .map(value => ({ value, label: value }))
    const provinceOptions = Array.from(new Set([...SA_PROVINCES, ...(shown.province ? [shown.province] : [])]))
        .map(value => ({ value, label: value }))

    const slide = (direction: 1 | -1) => ({
        initial: { opacity: 0, x: direction * shift },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -direction * shift },
        transition: { duration: reduceMotion ? 0 : 0.22, ease: 'easeOut' as const }
    })

    return (
        <Modal
            open={open}
            onCancel={onClose}
            centered
            destroyOnClose
            width='min(560px, 96vw)'
            title={sectionMeta ? sectionMeta.title : 'Edit SME details'}
            footer={section ? [
                <Button key='back' shape='round' icon={<ArrowLeftOutlined />} onClick={() => setSection(null)} disabled={saving}>Back</Button>,
                <Button key='update' type='primary' shape='round' icon={<SaveOutlined />} loading={saving} onClick={handleUpdate}>Update</Button>
            ] : null}
        >
            <Text type='secondary' style={{ display: 'block', textAlign: 'center', marginBottom: 14 }}>
                {shown.companyName}
            </Text>
            <Form form={form} layout='vertical' requiredMark={false} onValuesChange={handleValuesChange}>
                <div style={{ overflow: 'hidden' }}>
                    <AnimatePresence mode='wait' initial={false}>
                        {!section ? (
                            <motion.div
                                key='sections'
                                {...slide(-1)}
                                style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                            >
                                {sections.map((item, index) => (
                                    <motion.div
                                        key={item.key}
                                        role='button'
                                        tabIndex={0}
                                        aria-label={`Edit ${item.title}`}
                                        onClick={() => openSection(item.key)}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault()
                                                openSection(item.key)
                                            }
                                        }}
                                        initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.25, delay: reduceMotion ? 0 : index * 0.05 }}
                                        whileHover={reduceMotion ? undefined : { x: 3 }}
                                        whileTap={reduceMotion ? undefined : { scale: 0.99 }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 14,
                                            padding: '14px 16px',
                                            borderRadius: 10,
                                            cursor: 'pointer',
                                            border: `1px solid ${token.colorBorderSecondary}`,
                                            background: token.colorBgContainer
                                        }}
                                    >
                                        <span
                                            style={{
                                                flex: '0 0 auto',
                                                width: 36,
                                                height: 36,
                                                borderRadius: 10,
                                                display: 'grid',
                                                placeItems: 'center',
                                                fontSize: 17,
                                                color: item.accent,
                                                background: `${item.accent}1f`
                                            }}
                                        >
                                            {item.icon}
                                        </span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <Text strong style={{ display: 'block' }}>{item.title}</Text>
                                            <Text type='secondary' style={{ fontSize: 12 }}>{item.description}</Text>
                                        </div>
                                        <RightOutlined style={{ fontSize: 11, color: token.colorTextTertiary }} />
                                    </motion.div>
                                ))}
                            </motion.div>
                        ) : (
                            <motion.div key={section} {...slide(1)}>
                                {section === 'identity' && (
                                    <Row gutter={12}>
                                        <Col xs={24} sm={12}>
                                            <Form.Item name='registrationNumber' label='Registration Number'>
                                                <Input placeholder='e.g. 2015/123456/07' />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} sm={12}>
                                            <Form.Item name='idNumber' label='ID Number'>
                                                <Input />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24}>
                                            <Form.Item name='sector' label='Sector'>
                                                <Select
                                                    allowClear
                                                    showSearch
                                                    placeholder='Select a sector'
                                                    options={sectorOptions}
                                                    optionFilterProp='label'
                                                />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24}>
                                            <Form.Item name='gender' label='Gender'>
                                                <GenderCards />
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                )}
                                {section === 'contact' && (
                                    <Row gutter={12}>
                                        <Col xs={24}>
                                            <Form.Item
                                                name='phone'
                                                label='Contact Number'
                                                rules={[{ pattern: /^[+\d][\d\s()-]{6,19}$/, message: 'Enter a valid phone number' }]}
                                            >
                                                <Input inputMode='tel' placeholder='e.g. 0712345678' />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24}>
                                            <Form.Item name='businessAddress' label='Business Address'>
                                                <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} sm={12}>
                                            <Form.Item name='town' label='Town / City'>
                                                <Input />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} sm={12}>
                                            <Form.Item name='province' label='Province'>
                                                <Select allowClear showSearch placeholder='Select province' options={provinceOptions} />
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                )}
                                {section === 'ownership' && (
                                    <Row gutter={12}>
                                        <Col xs={24}>
                                            <Form.Item name='beeLevel' label='B-BBEE Level'>
                                                <BeeLevelCards />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} sm={8}>
                                            <Form.Item name='blackOwnedPercent' label='Black-owned'>
                                                <InputNumber min={0} max={100} addonAfter='%' style={{ width: '100%' }} />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} sm={8}>
                                            <Form.Item name='femaleOwnedPercent' label='Women-owned'>
                                                <InputNumber min={0} max={100} addonAfter='%' style={{ width: '100%' }} />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} sm={8}>
                                            <Form.Item name='youthOwnedPercent' label='Youth-owned'>
                                                <InputNumber min={0} max={100} addonAfter='%' style={{ width: '100%' }} />
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                )}
                                {section === 'tax' && (
                                    <Row gutter={12}>
                                        <Col xs={24} sm={12}>
                                            <Form.Item
                                                name='incomeTaxNumber'
                                                label='Income Tax Number'
                                                rules={[formatRule(/^[01239]\d{9}$/, 'A SARS income tax number is 10 digits')]}
                                            >
                                                <Input inputMode='numeric' placeholder='10 digits' />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} sm={12}>
                                            <Form.Item
                                                name='vatNumber'
                                                label='VAT Number'
                                                rules={[formatRule(/^4\d{9}$/, 'A VAT number is 10 digits starting with 4')]}
                                            >
                                                <Input inputMode='numeric' placeholder='Starts with 4' />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} sm={12}>
                                            <Form.Item
                                                name='payeReference'
                                                label='PAYE Reference'
                                                rules={[formatRule(/^7\d{9}$/, 'A PAYE reference is 10 digits starting with 7')]}
                                            >
                                                <Input inputMode='numeric' placeholder='Starts with 7' />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} sm={12}>
                                            <Form.Item
                                                name='csdNumber'
                                                label='CSD Supplier Number'
                                                rules={[formatRule(/^MAAA\d{7}$/i, 'A CSD number looks like MAAA0123456')]}
                                            >
                                                <Input placeholder='MAAA0123456' />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24}>
                                            <Form.Item
                                                name='taxCompliancePin'
                                                label='Tax Compliance Status PIN'
                                                extra='Staff can check this PIN on SARS eFiling.'
                                                rules={[formatRule(/^[A-Z0-9]{10}$/i, 'The PIN is 10 letters and numbers')]}
                                            >
                                                <Input placeholder='From the SME’s SARS eFiling' />
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                )}
                                {section === 'banking' && (
                                    !banking ? (
                                        <div style={{ display: 'grid', placeItems: 'center', padding: 32 }}><Spin /></div>
                                    ) : (
                                        <Row gutter={12}>
                                            <Col xs={24} sm={12}>
                                                <Form.Item name='bankName' label='Bank'>
                                                    <AutoComplete
                                                        allowClear
                                                        placeholder='Select or type a bank'
                                                        options={SA_BANKS.map(value => ({ value }))}
                                                        filterOption={(input, option) =>
                                                            String(option?.value || '').toLowerCase().includes(input.toLowerCase())
                                                        }
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} sm={12}>
                                                <Form.Item name='accountType' label='Account Type'>
                                                    <Select allowClear placeholder='Select type' options={ACCOUNT_TYPES.map(value => ({ value, label: value }))} />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24}>
                                                <Form.Item name='accountHolder' label='Account Holder'>
                                                    <Input placeholder='As it appears on the bank letter' />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} sm={12}>
                                                <Form.Item
                                                    name='accountNumber'
                                                    label='Account Number'
                                                    rules={[formatRule(/^\d{6,16}$/, 'Enter 6 to 16 digits')]}
                                                >
                                                    <Input inputMode='numeric' autoComplete='off' />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} sm={12}>
                                                <Form.Item
                                                    name='branchCode'
                                                    label='Branch Code'
                                                    rules={[formatRule(/^\d{6}$/, 'A branch code is 6 digits')]}
                                                >
                                                    <Input inputMode='numeric' placeholder='6 digits' />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24}>
                                                <Form.Item name='verified' valuePropName='checked' style={{ marginBottom: 4 }}>
                                                    <Checkbox>Checked against the SME’s Bank Confirmation Letter</Checkbox>
                                                </Form.Item>
                                                {banking.verified && banking.verifiedByName && (
                                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                                        Last verified by {banking.verifiedByName}
                                                        {banking.verifiedAt?.toDate ? ` on ${banking.verifiedAt.toDate().toLocaleDateString()}` : ''}
                                                    </Text>
                                                )}
                                            </Col>
                                        </Row>
                                    )
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </Form>
        </Modal>
    )
}
