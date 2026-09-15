import React, { useEffect, useMemo, useState } from 'react'
import {
    Form,
    Input,
    Select,
    InputNumber,
    Row,
    Col,
    Button,
    DatePicker,
    Typography,
    message,
    Grid,
    Space,
    Card,
    Progress,
    Segmented,
    Avatar,
    Upload,
    Divider,
    Tooltip,
    Skeleton,
    Modal,
    theme
} from 'antd'
import {
    RocketOutlined,
    SaveOutlined,
    CheckCircleOutlined,
    IdcardOutlined,
    BankOutlined,
    EnvironmentOutlined,
    LineChartOutlined,
    CameraOutlined,
    DeleteOutlined,
    UserOutlined,
    MailOutlined,
    PhoneOutlined,
    RightOutlined,
    ArrowLeftOutlined
} from '@ant-design/icons'
import { db, auth, storage } from '@/firebase'
import {
    collection,
    getDocs,
    query,
    where,
    setDoc,
    doc,
    getDoc,
    FieldValue,
    Timestamp,
    serverTimestamp
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { onAuthStateChanged, updateProfile } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'
import { useColorMode } from '@/contexts/ThemeContext'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { Helmet } from 'react-helmet'
dayjs.extend(customParseFormat)

const { Title, Text } = Typography
const { useBreakpoint } = Grid

// SA ID checksum + date validation
export const isValidSouthAfricanID = (raw: string): boolean => {
    const id = (raw || '').replace(/\D/g, '')
    if (!/^\d{13}$/.test(id)) return false

    // --- DOB (YYMMDD) with century disambiguation ---
    const yyMMdd = id.slice(0, 6)
    const today = dayjs().startOf('day')

    // Try 2000s first (most recent births), else fall back to 1900s.
    const dob2000 = dayjs(`20${yyMMdd}`, 'YYYYMMDD', true)
    const dob1900 = dayjs(`19${yyMMdd}`, 'YYYYMMDD', true)

    let dob: dayjs.Dayjs | null = null
    if (dob2000.isValid() && !dob2000.isAfter(today)) {
        dob = dob2000
    } else if (dob1900.isValid() && !dob1900.isAfter(today)) {
        dob = dob1900
    } else {
        return false
    }

    // Age sanity: 0–120
    const age = today.diff(dob, 'year')
    if (age < 0 || age > 120) return false

    // --- SA checksum (Luhn variant over first 12 digits) ---
    const digits = id.split('').map(n => parseInt(n, 10))

    const oddSum =
        digits[0] + digits[2] + digits[4] + digits[6] + digits[8] + digits[10]

    const evenConcat = `${digits[1]}${digits[3]}${digits[5]}${digits[7]}${digits[9]}${digits[11]}`
    const evenTimesTwo = String(Number(evenConcat) * 2)
    const evenSum = evenTimesTwo
        .split('')
        .reduce((s, d) => s + parseInt(d, 10), 0)

    const total = oddSum + evenSum
    const checkDigit = (10 - (total % 10)) % 10

    return checkDigit === digits[12]
}

// SA CIPC/CK/IT registration number formats (most common)
const isValidZARegistration = (raw: string): boolean => {
    if (!raw) return false
    const v = raw.toUpperCase().replace(/\s+/g, '')
    const patterns = [
        /^K\d{4}\/\d{6}\/\d{2}$/, // K2023/123456/07
        /^\d{4}\/\d{6}\/\d{2}$/, // 2015/123456/07
        /^CK\d{4}\/\d{6}\/\d{2}$/, // CK2009/123456/23
        /^IT\d{4}\/\d{6}$/ // IT2015/123456
    ]
    return patterns.some(re => re.test(v))
}

type SectionKey = 'personal' | 'company' | 'location' | 'performance'

type ProfileSection = {
    key: SectionKey
    label: string
    shortLabel: string
    icon: React.ReactNode
    title: string
    subtitle: string
}

const PROFILE_SECTIONS: ProfileSection[] = [
    {
        key: 'personal',
        label: 'Personal',
        shortLabel: 'Personal',
        icon: <IdcardOutlined />,
        title: 'Personal Details',
        subtitle: 'Who we should contact regarding your business'
    },
    {
        key: 'company',
        label: 'Company Info',
        shortLabel: 'Company',
        icon: <BankOutlined />,
        title: 'Company Info',
        subtitle: 'Details about your registered business'
    },
    {
        key: 'location',
        label: 'Location',
        shortLabel: 'Location',
        icon: <EnvironmentOutlined />,
        title: 'Location',
        subtitle: 'Where your business is based'
    },
    {
        key: 'performance',
        label: 'Headcount & Revenue',
        shortLabel: 'Metrics',
        icon: <LineChartOutlined />,
        title: 'Headcount & Revenue',
        subtitle: 'Recent monthly and annual business performance'
    }
]

// Required fields per section. Drives both the completion progress bar and the
// unfinished-section dots on the segmented control.
const SECTION_REQUIRED_FIELDS: Record<SectionKey, string[]> = {
    personal: ['participantName', 'gender', 'idNumber', 'email', 'phone'],
    company: [
        'beneficiaryName',
        'sector',
        'dateOfRegistration',
        'yearsOfTrading',
        'registrationNumber'
    ],
    location: ['businessAddress', 'city', 'province'],
    performance: []
}

// Fields used to estimate profile completeness for the first-time setup progress bar
const CORE_REQUIRED_FIELDS = Object.values(SECTION_REQUIRED_FIELDS).flat()

// Maps a form field back to the section that renders it, so a failed validation
// can open the right segment before scrolling to the offending input.
const FIELD_SECTION: Record<string, SectionKey> = {
    participantName: 'personal',
    gender: 'personal',
    idNumber: 'personal',
    email: 'personal',
    phone: 'personal',
    beneficiaryName: 'company',
    sector: 'company',
    natureOfBusiness: 'company',
    beeLevel: 'company',
    youthOwnedPercent: 'company',
    femaleOwnedPercent: 'company',
    blackOwnedPercent: 'company',
    dateOfRegistration: 'company',
    yearsOfTrading: 'company',
    registrationNumber: 'company',
    businessAddress: 'location',
    city: 'location',
    postalCode: 'location',
    province: 'location',
    hub: 'location',
    location: 'location'
}

const sectionForField = (name: unknown): SectionKey => {
    const field = Array.isArray(name) ? String(name[0]) : String(name ?? '')
    return FIELD_SECTION[field] || 'performance'
}

// --- Presentational helpers (defined outside the form component so they keep a stable identity across renders) ---

const SetupHeroHeader: React.FC<{ isMobile: boolean; progress: number }> = ({
    isMobile,
    progress
}) => (
    <div
        style={{
            position: 'relative',
            overflow: 'hidden',
            background: 'linear-gradient(135deg,#1677ff 0%,#3f93ff 45%,#69b1ff 100%)',
            borderRadius: isMobile ? 16 : 20,
            padding: isMobile ? '22px 18px' : '32px 40px',
            marginBottom: isMobile ? 16 : 20,
            boxShadow: '0 10px 30px rgba(22,119,255,0.25)'
        }}
    >
        <div
            style={{
                position: 'absolute',
                top: -50,
                right: -40,
                width: 170,
                height: 170,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.08)'
            }}
        />
        <div
            style={{
                position: 'absolute',
                bottom: -60,
                right: 70,
                width: 120,
                height: 120,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.06)'
            }}
        />

        <Space align='center' size={10} style={{ position: 'relative' }}>
            <div
                style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: 'rgba(255,255,255,0.18)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                }}
            >
                <RocketOutlined style={{ fontSize: 20, color: '#fff' }} />
            </div>
            <Text
                style={{
                    color: 'rgba(255,255,255,0.85)',
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: 0.6
                }}
            >
                WELCOME TO YOUR INCUBATION JOURNEY
            </Text>
        </Space>

        <Title
            level={isMobile ? 4 : 3}
            style={{ color: '#fff', margin: '12px 0 4px', position: 'relative' }}
        >
            Let's set up your business profile
        </Title>
        <Text
            style={{
                color: 'rgba(255,255,255,0.85)',
                position: 'relative',
                display: 'block',
                maxWidth: 560
            }}
        >
            This helps your incubation team tailor support to your business. It only
            takes a few minutes, and you can always update it later.
        </Text>

        <div style={{ marginTop: 20, position: 'relative' }}>
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 6
                }}
            >
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>
                    Profile completion
                </Text>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>
                    {progress}%
                </Text>
            </div>
            <Progress
                percent={progress}
                showInfo={false}
                strokeColor='#fff'
                trailColor='rgba(255,255,255,0.25)'
                size='small'
            />
        </div>
    </div>
)

// Left-hand identity panel: the photo, who the profile belongs to, and how far
// through it they are.
const IdentityPanel: React.FC<{
    isMobile: boolean
    isInitialSetup: boolean
    avatarUrl: string | null
    uploading: boolean
    onUpload: (file: File) => Promise<boolean> | boolean
    onRemove: () => void
    ownerName?: string
    businessName?: string
    email?: string
    phone?: string
    progress: number
}> = ({
    isMobile,
    isInitialSetup,
    avatarUrl,
    uploading,
    onUpload,
    onRemove,
    ownerName,
    businessName,
    email,
    phone,
    progress
}) => {
        const { token } = theme.useToken()
        const avatarSize = isMobile ? 96 : 132

        return (
            <Card
                bordered
                style={{
                    borderRadius: 16,
                    borderColor: token.colorBorderSecondary,
                    boxShadow: '0 2px 10px rgba(15,23,42,0.04)',
                    position: isMobile ? 'static' : 'sticky',
                    top: isMobile ? undefined : 16
                }}
                styles={{
                    body: {
                        padding: isMobile ? 18 : 24,
                        textAlign: isMobile ? 'left' : 'center'
                    }
                }}
            >
                <div
                    style={{
                        display: isMobile ? 'flex' : 'block',
                        alignItems: isMobile ? 'center' : undefined,
                        gap: isMobile ? 14 : 0
                    }}
                >
                    <div
                        style={{
                            position: 'relative',
                            width: avatarSize,
                            height: avatarSize,
                            margin: isMobile ? 0 : '0 auto',
                            flexShrink: 0
                        }}
                    >
                        <Avatar
                            size={avatarSize}
                            src={avatarUrl || undefined}
                            icon={!avatarUrl ? <UserOutlined /> : undefined}
                            style={{
                                background: avatarUrl
                                    ? undefined
                                    : 'linear-gradient(135deg,#1677ff,#69b1ff)',
                                border: `3px solid ${token.colorBgContainer}`,
                                boxShadow: '0 8px 24px rgba(22,119,255,0.20)',
                                fontSize: avatarSize / 3
                            }}
                        />
                        <Upload
                            showUploadList={false}
                            accept='image/*'
                            beforeUpload={onUpload}
                            disabled={uploading}
                        >
                            <Tooltip title={avatarUrl ? 'Change photo' : 'Upload a photo'}>
                                <Button
                                    shape='circle'
                                    type='primary'
                                    icon={<CameraOutlined />}
                                    loading={uploading}
                                    aria-label={avatarUrl ? 'Change photo' : 'Upload a photo'}
                                    style={{
                                        position: 'absolute',
                                        right: 0,
                                        bottom: 4,
                                        boxShadow: '0 4px 12px rgba(15,23,42,0.20)'
                                    }}
                                />
                            </Tooltip>
                        </Upload>

                        {avatarUrl && (
                            <Tooltip title='Remove photo'>
                                <Button
                                    shape='circle'
                                    size='small'
                                    danger
                                    type='default'
                                    icon={<DeleteOutlined />}
                                    disabled={uploading}
                                    onClick={onRemove}
                                    aria-label='Remove photo'
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        right: 0,
                                        background: token.colorBgContainer,
                                        boxShadow: '0 4px 12px rgba(15,23,42,0.20)'
                                    }}
                                />
                            </Tooltip>
                        )}
                    </div>

                    <div
                        style={{
                            flex: isMobile ? '1 1 auto' : undefined,
                            minWidth: 0,
                            // Centre this as a tight group against the taller
                            // avatar instead of stretching name/company/badge
                            // apart to fill the row.
                            display: isMobile ? 'flex' : undefined,
                            flexDirection: isMobile ? 'column' : undefined,
                            justifyContent: isMobile ? 'center' : undefined,
                            gap: isMobile ? 6 : undefined
                        }}
                    >
                        <Title
                            level={isMobile ? 5 : 4}
                            ellipsis
                            style={{
                                margin: isMobile ? 0 : '16px 0 2px',
                                lineHeight: 1.3,
                                textAlign: isMobile ? 'center' : undefined
                            }}
                        >
                            {ownerName || 'Your name'}
                        </Title>
                        <Text
                            type='secondary'
                            ellipsis
                            style={{
                                display: 'block',
                                fontSize: 13.5,
                                fontWeight: 500,
                                textAlign: isMobile ? 'center' : undefined
                            }}
                        >
                            {businessName || 'Your company'}
                        </Text>
                        {!isInitialSetup && (
                            <div
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    // In the mobile column layout this is a
                                    // flex item too — without an explicit
                                    // alignSelf it stretches to the column's
                                    // full width by default, turning the pill
                                    // into a long bar. Centred to match the
                                    // (also centred) name/company text above.
                                    alignSelf: isMobile ? 'center' : undefined,
                                    gap: 6,
                                    marginTop: isMobile ? 0 : 12,
                                    padding: '4px 12px',
                                    borderRadius: 20,
                                    background: '#f6ffed',
                                    border: '1px solid #b7eb8f'
                                }}
                            >
                                <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 12 }} />
                                <Text style={{ fontSize: 12, color: '#389e0d', fontWeight: 500 }}>
                                    Active
                                </Text>
                            </div>
                        )}
                    </div>
                </div>

                {(email || phone) && (
                    <>
                        <Divider style={{ margin: '18px 0 14px' }} />
                        <Space
                            direction='vertical'
                            size={8}
                            style={{ width: '100%', textAlign: 'left' }}
                        >
                            {email && (
                                <Space size={8} align='start' style={{ width: '100%' }}>
                                    <MailOutlined style={{ color: '#1677ff', marginTop: 3 }} />
                                    <Text
                                        style={{ fontSize: 12.5, wordBreak: 'break-all' }}
                                        type='secondary'
                                    >
                                        {email}
                                    </Text>
                                </Space>
                            )}
                            {phone && (
                                <Space size={8} align='start' style={{ width: '100%' }}>
                                    <PhoneOutlined style={{ color: '#1677ff', marginTop: 3 }} />
                                    <Text style={{ fontSize: 12.5 }} type='secondary'>
                                        {phone}
                                    </Text>
                                </Space>
                            )}
                        </Space>
                    </>
                )}

                <Divider style={{ margin: '14px 0 12px' }} />

                <div style={{ textAlign: 'left' }}>
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginBottom: 4
                        }}
                    >
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            Profile completion
                        </Text>
                        <Text style={{ fontSize: 12, fontWeight: 700 }}>{progress}%</Text>
                    </div>
                    <Progress
                        percent={progress}
                        showInfo={false}
                        size='small'
                        strokeColor={{ from: '#1677ff', to: '#69b1ff' }}
                    />
                </div>
            </Card>
        )
    }

// Header strip for the section currently selected in the segmented control.
const SectionHeader: React.FC<{
    icon: React.ReactNode
    title: string
    subtitle?: string
    isMobile: boolean
}> = ({ icon, title, subtitle, isMobile }) => (
    <div
        style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: isMobile ? 14 : 18
        }}
    >
        <div
            style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: '#eef4ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#1677ff',
                flexShrink: 0,
                fontSize: 17
            }}
        >
            {icon}
        </div>
        <div>
            <Title level={5} style={{ margin: 0 }}>
                {title}
            </Title>
            {subtitle && (
                <Text type='secondary' style={{ fontSize: 12.5 }}>
                    {subtitle}
                </Text>
            )}
        </div>
    </div>
)

// Mobile section picker. Four segments don't fit legibly across a phone, so on
// mobile the sections become a list of cards that drill into one at a time.
const SectionMenu: React.FC<{
    missingBySection: Record<SectionKey, number>
    onOpen: (key: SectionKey) => void
}> = ({ missingBySection, onOpen }) => {
    const { token } = theme.useToken()

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {PROFILE_SECTIONS.map(section => {
                const missing = missingBySection[section.key]

                return (
                    <button
                        key={section.key}
                        type='button'
                        onClick={() => onOpen(section.key)}
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '38px minmax(0, 1fr) auto auto',
                            alignItems: 'center',
                            gap: 12,
                            width: '100%',
                            padding: '12px 14px',
                            border: `1px solid ${token.colorBorderSecondary}`,
                            borderRadius: 14,
                            background: token.colorBgContainer,
                            color: 'inherit',
                            font: 'inherit',
                            textAlign: 'left',
                            cursor: 'pointer'
                        }}
                    >
                        <span
                            style={{
                                width: 38,
                                height: 38,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 11,
                                background: '#eef4ff',
                                color: '#1677ff',
                                fontSize: 17
                            }}
                        >
                            {section.icon}
                        </span>

                        <span
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                                minWidth: 0
                            }}
                        >
                            <Text strong style={{ fontSize: 14 }}>
                                {section.title}
                            </Text>
                            <Text
                                type='secondary'
                                style={{ fontSize: 12, lineHeight: 1.35 }}
                            >
                                {section.subtitle}
                            </Text>
                        </span>

                        {missing > 0 ? (
                            <span
                                style={{
                                    padding: '2px 9px',
                                    borderRadius: 999,
                                    background: '#fff1f0',
                                    border: '1px solid #ffccc7',
                                    color: '#cf1322',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                {missing} left
                            </span>
                        ) : (
                            <CheckCircleOutlined
                                style={{ color: '#52c41a', fontSize: 15 }}
                            />
                        )}

                        <RightOutlined style={{ color: '#a3aab5', fontSize: 11 }} />
                    </button>
                )
            })}
        </div>
    )
}

// Mirrors the real two-panel layout while the participant record loads, so an
// existing profile never flashes the first-time setup screen.
const ProfileSkeleton: React.FC<{ isMobile: boolean }> = ({ isMobile }) => {
    const { token } = theme.useToken()

    const cardStyle: React.CSSProperties = {
        borderRadius: 16,
        borderColor: token.colorBorderSecondary,
        boxShadow: '0 2px 10px rgba(15,23,42,0.04)'
    }

    return (
        <Row gutter={[isMobile ? 12 : 20, isMobile ? 12 : 20]}>
            <Col xs={24} lg={7} xl={6}>
                <Card
                    bordered
                    style={cardStyle}
                    styles={{
                        body: { padding: isMobile ? 18 : 24, textAlign: 'center' }
                    }}
                >
                    <Skeleton.Avatar
                        active
                        size={isMobile ? 96 : 132}
                        shape='circle'
                        style={{ marginBottom: 16 }}
                    />
                    <Skeleton active paragraph={{ rows: 2, width: ['80%', '60%'] }} title={false} />
                    <Divider style={{ margin: '16px 0 12px' }} />
                    <Skeleton active paragraph={{ rows: 3, width: ['100%', '90%', '70%'] }} title={false} />
                </Card>
            </Col>

            <Col xs={24} lg={17} xl={18}>
                <Card
                    bordered
                    style={cardStyle}
                    styles={{ body: { padding: isMobile ? 16 : 24 } }}
                >
                    <Skeleton.Button
                        active
                        block
                        size='large'
                        style={{ marginBottom: isMobile ? 16 : 20, borderRadius: 8 }}
                    />

                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            marginBottom: isMobile ? 14 : 18
                        }}
                    >
                        <Skeleton.Avatar active size={36} shape='square' />
                        <Skeleton
                            active
                            title={{ width: 160 }}
                            paragraph={{ rows: 1, width: 240 }}
                        />
                    </div>

                    <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]}>
                        {Array.from({ length: 6 }, (_, i) => (
                            <Col xs={24} md={12} key={i}>
                                <Skeleton
                                    active
                                    title={{ width: 90 }}
                                    paragraph={false}
                                    style={{ marginBottom: 8 }}
                                />
                                <Skeleton.Input active block size='default' />
                            </Col>
                        ))}
                    </Row>

                    <div
                        style={{
                            marginTop: isMobile ? 16 : 22,
                            paddingTop: isMobile ? 14 : 18,
                            borderTop: `1px solid ${token.colorBorderSecondary}`
                        }}
                    >
                        <Skeleton.Button
                            active
                            block
                            size='large'
                            style={{ height: 46, borderRadius: 10 }}
                        />
                    </div>
                </Card>
            </Col>
        </Row>
    )
}

const ActionBar: React.FC<{
    isMobile: boolean
    isInitialSetup: boolean
    onSave: () => void
}> = ({ isMobile, isInitialSetup, onSave }) => {
    const { token } = theme.useToken()

    return (
        <div
            style={{
                marginTop: isMobile ? 16 : 22,
                paddingTop: isMobile ? 14 : 18,
                borderTop: `1px solid ${token.colorBorderSecondary}`
            }}
        >
            <Button
                type='primary'
                shape='round'
                size='large'
                block
                icon={isInitialSetup ? <RocketOutlined /> : <SaveOutlined />}
                onClick={onSave}
                style={{
                    height: 46,
                    fontWeight: 600,
                    background: isInitialSetup
                        ? 'linear-gradient(90deg,#1677ff,#3f93ff)'
                        : undefined,
                    border: isInitialSetup ? 'none' : undefined,
                    boxShadow: isInitialSetup
                        ? '0 8px 20px rgba(22,119,255,0.28)'
                        : undefined
                }}
            >
                {isInitialSetup ? 'Save & Get Started' : 'Save Changes'}
            </Button>

            {isInitialSetup && (
                <div style={{ textAlign: 'center', marginTop: 8 }}>
                    <Text type='secondary' style={{ fontSize: 12.5 }}>
                        You can edit this information anytime after saving.
                    </Text>
                </div>
            )}
        </div>
    )
}

const ApplicantProfileForm: React.FC = () => {
    const [form] = Form.useForm()
    const [participantDocId, setParticipantDocId] = useState<string | null>(null)
    const [progress, setProgress] = useState(0)
    const [missingBySection, setMissingBySection] = useState<
        Record<SectionKey, number>
    >({ personal: 0, company: 0, location: 0, performance: 0 })
    const [activeSection, setActiveSection] = useState<SectionKey>('personal')
    // Mobile shows a card menu first; picking a card drills into that section.
    // Ignored on desktop, where the segmented control switches sections directly.
    const [showSectionList, setShowSectionList] = useState(true)
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
    const [uploadingAvatar, setUploadingAvatar] = useState(false)
    const [loading, setLoading] = useState(true)
    const navigate = useNavigate()
    const screens = useBreakpoint()
    const isMobile = !screens.md
    // Only meaningful once the participant lookup has resolved — otherwise an
    // existing profile would briefly render the first-time setup screen.
    const isInitialSetup = !loading && !participantDocId

    const { token } = theme.useToken()
    const { isDark } = useColorMode()
    const pageBg = isDark
        ? token.colorBgLayout
        : isInitialSetup
            ? '#f5f8ff'
            : '#fafbfc'

    const businessName = Form.useWatch('beneficiaryName', form)
    const ownerName = Form.useWatch('participantName', form)
    const emailValue = Form.useWatch('email', form)
    const phoneValue = Form.useWatch('phone', form)

    const last3Months = useMemo(
        () =>
            Array.from({ length: 3 }, (_, i) => {
                const d = dayjs().subtract(i + 1, 'month')

                return {
                    key: d.format('YYYY-MM'),
                    label: d.format('MMMM YYYY')
                }
            }).reverse(),
        []
    )

    const currentYear = dayjs().year()
    const last2Years = useMemo(
        () => [currentYear - 1, currentYear - 2],
        [currentYear]
    )

    const isDateLike = (v: any) =>
        dayjs.isDayjs(v) || v instanceof Date || v instanceof Timestamp

    // Firestore sentinels (serverTimestamp, arrayUnion, increment, ...) have to
    // reach the SDK untouched. Rebuilding one as a plain object strips its
    // prototype, and Firestore then stores the literal map it was built from --
    // `{ _methodName: 'serverTimestamp' }` -- instead of applying the sentinel.
    const isFirestoreSentinel = (v: any) => v instanceof FieldValue

    // Trim all strings; turn "" -> undefined
    const trimStringsDeep = (obj: any): any => {
        if (obj === null || obj === undefined) return obj
        if (isDateLike(obj) || isFirestoreSentinel(obj)) return obj // ⬅️ do not dive
        if (Array.isArray(obj)) return obj.map(trimStringsDeep)
        if (typeof obj === 'object')
            return Object.fromEntries(
                Object.entries(obj).map(([k, v]) => [k, trimStringsDeep(v)])
            )
        if (typeof obj === 'string') {
            const t = obj.trim()
            return t === '' ? undefined : t
        }
        return obj
    }

    const pruneUndefinedDeep = (obj: any): any => {
        if (obj === null || obj === undefined) return obj
        if (isDateLike(obj) || isFirestoreSentinel(obj)) return obj // ⬅️ do not dive
        if (Array.isArray(obj))
            return obj.map(pruneUndefinedDeep).filter(v => v !== undefined)
        if (typeof obj === 'object')
            return Object.fromEntries(
                Object.entries(obj)
                    .filter(([, v]) => v !== undefined)
                    .map(([k, v]) => [k, pruneUndefinedDeep(v)])
            )
        return obj
    }

    const toFirestoreTimestamp = (v: any): Timestamp | undefined => {
        if (!v) return undefined
        if (v instanceof Timestamp) return v
        if (dayjs.isDayjs(v)) return Timestamp.fromDate(v.toDate())
        if (v instanceof Date) return Timestamp.fromDate(v)
        if (typeof v?.toDate === 'function') return Timestamp.fromDate(v.toDate()) // moment/Timestamp-like
        const d = dayjs(v)
        return d.isValid() ? Timestamp.fromDate(d.toDate()) : undefined
    }

    const coerceDateForForm = (v: any) => {
        if (!v) return null
        if (typeof v?.toDate === 'function') return dayjs(v.toDate()) // proper Timestamp
        if (typeof v?.seconds === 'number' && typeof v?.nanoseconds === 'number')
            return dayjs(new Timestamp(v.seconds, v.nanoseconds).toDate()) // raw TS object
        if (
            typeof v?.$y === 'number' &&
            typeof v?.$M === 'number' &&
            typeof v?.$D === 'number'
        )
            return dayjs(new Date(v.$y, v.$M, v.$D)) // previously-saved Dayjs map
        return dayjs(v).isValid() ? dayjs(v) : null
    }

    const computeProgress = () => {
        const vals = form.getFieldsValue(CORE_REQUIRED_FIELDS) as Record<string, any>
        const isFilled = (f: string) => {
            const v = vals[f]
            return v !== undefined && v !== null && v !== ''
        }

        const filled = CORE_REQUIRED_FIELDS.filter(isFilled).length
        setProgress(Math.round((filled / CORE_REQUIRED_FIELDS.length) * 100))

        setMissingBySection(
            Object.fromEntries(
                Object.entries(SECTION_REQUIRED_FIELDS).map(([key, fields]) => [
                    key,
                    fields.filter(f => !isFilled(f)).length
                ])
            ) as Record<SectionKey, number>
        )
    }

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async user => {
            if (!user) {
                setLoading(false)
                return
            }

            try {
                const userRef = doc(db, 'users', user.uid)
                const userSnap = await getDoc(userRef)

                const fallbackEmail = user.email || ''
                const fallbackName = userSnap.exists() ? userSnap.data()?.name || '' : ''

                // Fetch participant doc
                const q = query(
                    collection(db, 'participants'),
                    where('email', '==', fallbackEmail)
                )
                const snapshot = await getDocs(q)

                let initialValues: any = {
                    email: fallbackEmail,
                    participantName: fallbackName
                }

                if (!snapshot.empty) {
                    const docRef = snapshot.docs[0]
                    const data: any = docRef.data()
                    setParticipantDocId(docRef.id)
                    setAvatarUrl(data.logoUrl || user.photoURL || null)

                    const flatFields: Record<string, any> = {}

                    Object.entries(data.headcountHistory?.monthly || {}).forEach(
                        ([month, v]: any) => {
                            flatFields[`permHeadcount_${month}`] = v?.permanent ?? 0
                            flatFields[`tempHeadcount_${month}`] = v?.temporary ?? 0
                        }
                    )
                    Object.entries(data.headcountHistory?.annual || {}).forEach(
                        ([year, v]: any) => {
                            flatFields[`permHeadcount_${year}`] = v?.permanent ?? 0
                            flatFields[`tempHeadcount_${year}`] = v?.temporary ?? 0
                        }
                    )
                    Object.entries(data.revenueHistory?.monthly || {}).forEach(
                        ([month, v]: any) => {
                            flatFields[`revenue_${month}`] = v ?? 0
                        }
                    )
                    Object.entries(data.revenueHistory?.annual || {}).forEach(
                        ([year, v]: any) => {
                            flatFields[`revenue_${year}`] = v ?? 0
                        }
                    )

                    const {
                        participantName,
                        email,
                        beneficiaryName,
                        gender,
                        idNumber,
                        phone,
                        sector,
                        natureOfBusiness,
                        beeLevel,
                        youthOwnedPercent,
                        femaleOwnedPercent,
                        blackOwnedPercent,
                        yearsOfTrading,
                        registrationNumber,
                        businessAddress,
                        city,
                        postalCode,
                        province,
                        hub,
                        location
                    } = data

                    initialValues = {
                        email: email ?? fallbackEmail,
                        participantName: participantName ?? fallbackName,
                        beneficiaryName,
                        gender,
                        idNumber,
                        phone,
                        sector,
                        natureOfBusiness,
                        beeLevel,
                        youthOwnedPercent,
                        femaleOwnedPercent,
                        blackOwnedPercent,
                        dateOfRegistration: coerceDateForForm(data.dateOfRegistration),
                        yearsOfTrading,
                        registrationNumber,
                        businessAddress,
                        city,
                        postalCode,
                        province,
                        hub,
                        location,
                        ...flatFields
                    }

                    form.resetFields()
                    form.setFieldsValue(initialValues)
                } else {
                    setAvatarUrl(user.photoURL || null)
                    form.resetFields()
                    form.setFieldsValue({
                        email: fallbackEmail,
                        participantName: fallbackName
                    })
                }

                computeProgress()
            } catch (err) {
                console.error(err)
                message.error('Failed to load your profile.')
            } finally {
                setLoading(false)
            }
        })

        return () => unsubscribe()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form])

    // Uploads to the same storage path the applicant shell reads from, so the
    // photo shows up in the header and anywhere else `logoUrl` is used.
    const handleAvatarUpload = async (file: File) => {
        if (!file) return false

        if (!file.type?.startsWith('image/')) {
            message.error('Please choose an image file.')
            return false
        }
        if (file.size > 5 * 1024 * 1024) {
            message.error('Image must be smaller than 5MB.')
            return false
        }

        const user = auth.currentUser
        if (!user) {
            message.error('You need to be signed in to upload a photo.')
            return false
        }

        try {
            setUploadingAvatar(true)
            const fileRef = ref(
                storage,
                `logos/${user.uid}/${Date.now()}_${file.name}`
            )
            await uploadBytes(fileRef, file)
            const url = await getDownloadURL(fileRef)
            setAvatarUrl(url)

            // Persist right away when the participant record already exists; on
            // first-time setup it rides along with the initial save instead.
            if (participantDocId) {
                await setDoc(
                    doc(db, 'participants', participantDocId),
                    { logoUrl: url, updatedAt: serverTimestamp() },
                    { merge: true }
                )
            }
            await updateProfile(user, { photoURL: url })

            message.success(
                participantDocId
                    ? 'Profile photo updated.'
                    : 'Photo ready — save your profile to keep it.'
            )
        } catch (e) {
            console.error(e)
            message.error('Failed to upload photo.')
        } finally {
            setUploadingAvatar(false)
        }

        return false
    }

    const handleAvatarRemove = () => {
        if (!avatarUrl) return

        Modal.confirm({
            title: 'Remove profile photo?',
            content: 'This removes your current photo. You can upload a new one anytime.',
            centered: true,
            okText: 'Remove',
            okButtonProps: { danger: true },
            cancelText: 'Cancel',
            onOk: async () => {
                const user = auth.currentUser
                if (!user) {
                    message.error('You need to be signed in to update your photo.')
                    return
                }

                try {
                    setUploadingAvatar(true)
                    setAvatarUrl(null)

                    if (participantDocId) {
                        await setDoc(
                            doc(db, 'participants', participantDocId),
                            { logoUrl: null, updatedAt: serverTimestamp() },
                            { merge: true }
                        )
                    }
                    await updateProfile(user, { photoURL: null })

                    message.success('Profile photo removed.')
                } catch (e) {
                    console.error(e)
                    message.error('Failed to remove photo.')
                } finally {
                    setUploadingAvatar(false)
                }
            }
        })
    }

    const onSave = async () => {
        try {
            // Validates only fields with rules; "optional" fields without rules won't block save
            await form.validateFields()

            // Get raw values, trim strings, and normalize blanks -> undefined
            const raw = form.getFieldsValue(true)
            const values = trimStringsDeep(raw)

            // Convert date if present
            const regTs = toFirestoreTimestamp(values.dateOfRegistration)
            if (regTs) values.dateOfRegistration = regTs
            else delete values.dateOfRegistration

            const user = auth.currentUser
            if (!user) throw new Error('User not authenticated')

            // Build headcount/revenue maps – default to 0 only for these metrics
            const monthly: Record<string, any> = {}
            const annual: Record<string, any> = {}

            Object.entries(values).forEach(([key, value]) => {
                if (key.startsWith('revenue_')) {
                    const suffix = key.replace('revenue_', '')
                    if (/^\d{4}-\d{2}$/.test(suffix)) {
                        monthly[suffix] = {
                            ...(monthly[suffix] || {}),
                            revenue: value ?? 0
                        }
                    } else {
                        annual[suffix] = { ...(annual[suffix] || {}), revenue: value ?? 0 }
                    }
                }
                if (key.startsWith('permHeadcount_')) {
                    const suffix = key.replace('permHeadcount_', '')
                    if (/^\d{4}-\d{2}$/.test(suffix)) {
                        monthly[suffix] = {
                            ...(monthly[suffix] || {}),
                            permanent: value ?? 0
                        }
                    } else {
                        annual[suffix] = {
                            ...(annual[suffix] || {}),
                            permanent: value ?? 0
                        }
                    }
                }
                if (key.startsWith('tempHeadcount_')) {
                    const suffix = key.replace('tempHeadcount_', '')
                    if (/^\d{4}-\d{2}$/.test(suffix)) {
                        monthly[suffix] = {
                            ...(monthly[suffix] || {}),
                            temporary: value ?? 0
                        }
                    } else {
                        annual[suffix] = {
                            ...(annual[suffix] || {}),
                            temporary: value ?? 0
                        }
                    }
                }
            })

            const {
                participantName,
                email,
                beneficiaryName,
                gender,
                idNumber,
                phone,
                sector,
                natureOfBusiness,
                beeLevel,
                youthOwnedPercent,
                femaleOwnedPercent,
                blackOwnedPercent,
                dateOfRegistration,
                yearsOfTrading,
                registrationNumber,
                businessAddress,
                city,
                postalCode,
                province,
                hub,
                location
            } = values

            const base = {
                participantName,
                email,
                beneficiaryName,
                gender,
                idNumber,
                phone,
                sector,
                natureOfBusiness,
                beeLevel,
                youthOwnedPercent,
                femaleOwnedPercent,
                blackOwnedPercent,
                dateOfRegistration,
                yearsOfTrading,
                registrationNumber,
                businessAddress,
                city,
                postalCode,
                province,
                hub,
                location,
                logoUrl: avatarUrl || undefined,
                headcountHistory: {
                    monthly: Object.fromEntries(
                        Object.entries(monthly).map(([k, v]: any) => [
                            k,
                            {
                                permanent: v.permanent ?? 0,
                                temporary: v.temporary ?? 0,
                                total: (v.permanent ?? 0) + (v.temporary ?? 0)
                            }
                        ])
                    ),
                    annual: Object.fromEntries(
                        Object.entries(annual).map(([k, v]: any) => [
                            k,
                            {
                                permanent: v.permanent ?? 0,
                                temporary: v.temporary ?? 0,
                                total: (v.permanent ?? 0) + (v.temporary ?? 0)
                            }
                        ])
                    )
                },
                revenueHistory: {
                    monthly: Object.fromEntries(
                        Object.entries(monthly).map(([k, v]: any) => [k, v.revenue ?? 0])
                    ),
                    annual: Object.fromEntries(
                        Object.entries(annual).map(([k, v]: any) => [k, v.revenue ?? 0])
                    )
                },
                updatedAt: serverTimestamp()
            }

            // Strip every undefined key deeply so Firestore never sees undefined
            const dataToSave = pruneUndefinedDeep(base)

            if (participantDocId) {
                const participantRef = doc(db, 'participants', participantDocId)
                const participantSnap = await getDoc(participantRef)
                const existing = participantSnap.exists() ? participantSnap.data() : {}

                await setDoc(
                    participantRef,
                    {
                        ...dataToSave,
                        updatedAt: serverTimestamp(),
                        createdAt: existing.createdAt || serverTimestamp(),
                        createdAtISO: existing.createdAtISO || new Date().toISOString(),
                        createdMonth: existing.createdMonth || dayjs().format('YYYY-MM'),
                        createdYear: existing.createdYear || dayjs().format('YYYY')
                    },
                    { merge: true }
                )
                message.success('Profile updated successfully')
            } else {
                const newDocRef = doc(collection(db, 'participants'))
                await setDoc(newDocRef, {
                    ...dataToSave,
                    setup: true,
                    createdAt: serverTimestamp(),
                    createdAtISO: new Date().toISOString(),
                    createdMonth: dayjs().format('YYYY-MM'),
                    createdYear: dayjs().format('YYYY'),
                    updatedAt: serverTimestamp()
                })
                setParticipantDocId(newDocRef.id)
                message.success('Profile saved successfully')
                navigate('/applicant')
            }
        } catch (err: any) {
            // AntD validation error shape
            if (Array.isArray(err?.errorFields)) {
                const first = err.errorFields[0]

                // Open the section holding the first error, then scroll to it.
                // On mobile that also means leaving the card menu.
                if (first?.name) {
                    setActiveSection(sectionForField(first.name))
                    setShowSectionList(false)
                    requestAnimationFrame(() =>
                        form.scrollToField(first.name, {
                            behavior: 'smooth',
                            block: 'center'
                        })
                    )
                }

                // Collect messages (usually already "X is required" from validateMessages)
                const allMsgs = err.errorFields
                    .flatMap((f: any) => f.errors || [])
                    .filter(Boolean)

                // Show a concise summary
                message.error(allMsgs[0] || 'Please fill all required fields.')
                return
            }

            // Non-validation failure
            console.error(err)
            message.error('Failed to save profile')
        }
    }

    const sectors = [
        'Agriculture',
        'Mining',
        'Manufacturing',
        'Electricity, Gas and Water',
        'Construction',
        'Wholesale and Retail Trade',
        'Transport, Storage and Communication',
        'Finance, Real Estate and Business Services',
        'Community, Social and Personal Services',
        'Tourism and Hospitality',
        'Information Technology',
        'Education',
        'Health and Social Work',
        'Arts and Culture',
        'Automotive',
        'Chemical',
        'Textile',
        'Forestry and Logging',
        'Fishing',
        'Other'
    ]

    const provinces = [
        'Eastern Cape',
        'Free State',
        'Gauteng',
        'KwaZulu-Natal',
        'Limpopo',
        'Mpumalanga',
        'Northern Cape',
        'North West',
        'Western Cape'
    ]

    const segmentOptions = PROFILE_SECTIONS.map(section => {
        const missing = missingBySection[section.key]

        return {
            value: section.key,
            label: (
                <span
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        padding: '3px 2px',
                        lineHeight: 1.2,
                        fontSize: isMobile ? 12 : 13,
                        fontWeight: 600,
                        minWidth: 0
                    }}
                >
                    <span style={{ fontSize: isMobile ? 14 : 15, display: 'inline-flex' }}>
                        {section.icon}
                    </span>
                    <span
                        style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        {isMobile ? section.shortLabel : section.label}
                    </span>
                    {missing > 0 && (
                        <Tooltip
                            title={`${missing} required field${missing === 1 ? '' : 's'} left`}
                        >
                            <span
                                style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius: '50%',
                                    background: '#ff4d4f',
                                    flexShrink: 0
                                }}
                            />
                        </Tooltip>
                    )}
                </span>
            )
        }
    })

    // On mobile the card menu stands in for the whole form until a section is
    // picked.
    const showingMenu = isMobile && showSectionList

    // Every section stays mounted (just hidden) so validation still sees the
    // fields of sections the applicant has not opened.
    const sectionStyle = (key: SectionKey): React.CSSProperties => ({
        display: !showingMenu && activeSection === key ? 'block' : 'none'
    })

    const openSection = (key: SectionKey) => {
        setActiveSection(key)
        setShowSectionList(false)
    }

    return (
        <>
            <Helmet>
                <title>Profile | Smart Incubation Platform</title>
            </Helmet>

            <div
                style={{
                    padding: isMobile ? '5px 12px' : '5px 24px',
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    background: pageBg
                }}
            >
                <div style={{ width: '100%', maxWidth: 1240, margin: '0 auto' }}>
                    {isInitialSetup && (
                        <SetupHeroHeader isMobile={isMobile} progress={progress} />
                    )}

                    <Form
                        layout='vertical'
                        form={form}
                        style={{ width: '100%' }}
                        requiredMark={true}
                        onValuesChange={computeProgress}
                        validateMessages={{
                            required: '${label} is required',
                            types: { email: 'Enter a valid email' }
                        }}
                    >
                        {/* The Form stays mounted while loading so values written
                            by the participant lookup land in the store. */}
                        <div style={{ display: loading ? 'block' : 'none' }}>
                            <ProfileSkeleton isMobile={isMobile} />
                        </div>

                        <Row
                            gutter={[isMobile ? 12 : 20, isMobile ? 12 : 20]}
                            style={{ display: loading ? 'none' : undefined }}
                        >
                            {/* On mobile, editing a section takes over the whole
                                card — the identity header would just eat space
                                that the form fields need. */}
                            {(!isMobile || showingMenu) && (
                                <Col xs={24} lg={7} xl={6}>
                                    <IdentityPanel
                                        isMobile={isMobile}
                                        isInitialSetup={isInitialSetup}
                                        avatarUrl={avatarUrl}
                                        uploading={uploadingAvatar}
                                        onUpload={handleAvatarUpload}
                                        onRemove={handleAvatarRemove}
                                        ownerName={ownerName}
                                        businessName={businessName}
                                        email={emailValue}
                                        phone={phoneValue}
                                        progress={progress}
                                    />
                                </Col>
                            )}

                            <Col xs={24} lg={17} xl={18}>
                                <Card
                                    bordered
                                    style={{
                                        borderRadius: 16,
                                        borderColor: token.colorBorderSecondary,
                                        boxShadow: '0 2px 10px rgba(15,23,42,0.04)'
                                    }}
                                    styles={{ body: { padding: isMobile ? 16 : 24 } }}
                                >
                                    {isMobile ? (
                                        showSectionList ? (
                                            <SectionMenu
                                                missingBySection={missingBySection}
                                                onOpen={openSection}
                                            />
                                        ) : (
                                            <div
                                                style={{
                                                    position: 'relative',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    minHeight: 32,
                                                    marginBottom: 16
                                                }}
                                            >
                                                <Button
                                                    type='default'
                                                    shape='circle'
                                                    icon={<ArrowLeftOutlined />}
                                                    onClick={() => setShowSectionList(true)}
                                                    aria-label='Back to all sections'
                                                    style={{
                                                        position: 'absolute',
                                                        left: 0,
                                                        borderColor: token.colorBorderSecondary
                                                    }}
                                                />

                                                <Text
                                                    strong
                                                    style={{ fontSize: 15, textAlign: 'center' }}
                                                >
                                                    {PROFILE_SECTIONS.find(
                                                        section => section.key === activeSection
                                                    )?.title || 'Section'}
                                                </Text>
                                            </div>
                                        )
                                    ) : (
                                        <Segmented
                                            block
                                            size='middle'
                                            value={activeSection}
                                            onChange={value =>
                                                setActiveSection(value as SectionKey)
                                            }
                                            options={segmentOptions}
                                            style={{ width: '100%', marginBottom: 20 }}
                                        />
                                    )}

                                    {/* ---- Personal Details ---- */}
                                    <div style={sectionStyle('personal')}>
                                        <SectionHeader
                                            icon={PROFILE_SECTIONS[0].icon}
                                            title={PROFILE_SECTIONS[0].title}
                                            subtitle={PROFILE_SECTIONS[0].subtitle}
                                            isMobile={isMobile}
                                        />

                                        <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]}>
                                            <Col xs={24} md={8}>
                                                <Form.Item
                                                    name='participantName'
                                                    label='Owner Name'
                                                    rules={[{ required: true }]}
                                                >
                                                    <Input disabled />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={8}>
                                                <Form.Item
                                                    name='gender'
                                                    label='Gender'
                                                    rules={[{ required: true }]}
                                                >
                                                    <Select placeholder='Select gender' allowClear>
                                                        <Select.Option value='Male'>Male</Select.Option>
                                                        <Select.Option value='Female'>Female</Select.Option>
                                                        <Select.Option value='Other'>Other</Select.Option>
                                                    </Select>
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={8}>
                                                <Form.Item
                                                    name='idNumber'
                                                    label='ID Number'
                                                    rules={[
                                                        { required: true, message: 'ID number is required' },
                                                        {
                                                            validator: (_, value) =>
                                                                !value || isValidSouthAfricanID(value)
                                                                    ? Promise.resolve()
                                                                    : Promise.reject(
                                                                        new Error('Enter a valid South African ID')
                                                                    )
                                                        }
                                                    ]}
                                                    getValueFromEvent={e =>
                                                        e.target.value.replace(/\D/g, '').slice(0, 13)
                                                    }
                                                >
                                                    <Input
                                                        inputMode='numeric'
                                                        maxLength={13}
                                                        placeholder='e.g. 9001015009087'
                                                    />
                                                </Form.Item>
                                            </Col>
                                        </Row>

                                        <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]}>
                                            <Col xs={24} md={12}>
                                                <Form.Item
                                                    name='email'
                                                    label='Email'
                                                    rules={[
                                                        { type: 'email', message: 'Enter a valid email' },
                                                        { required: true, message: 'Email is required' }
                                                    ]}
                                                >
                                                    <Input disabled />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={12}>
                                                <Form.Item
                                                    name='phone'
                                                    label='Phone'
                                                    rules={[
                                                        { required: true, message: 'Phone number is required' }
                                                    ]}
                                                >
                                                    <Input inputMode='tel' placeholder='e.g. 082 123 4567' />
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                    </div>

                                    {/* ---- Company Info ---- */}
                                    <div style={sectionStyle('company')}>
                                        <SectionHeader
                                            icon={PROFILE_SECTIONS[1].icon}
                                            title={PROFILE_SECTIONS[1].title}
                                            subtitle={PROFILE_SECTIONS[1].subtitle}
                                            isMobile={isMobile}
                                        />

                                        <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]}>
                                            <Col xs={24} md={12}>
                                                <Form.Item
                                                    name='beneficiaryName'
                                                    label='Company Name'
                                                    rules={[{ required: true }]}
                                                >
                                                    <Input />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={12}>
                                                <Form.Item
                                                    name='sector'
                                                    label='Sector'
                                                    rules={[{ required: true }]}
                                                >
                                                    <Select
                                                        showSearch
                                                        placeholder='Select sector'
                                                        optionFilterProp='children'
                                                        filterOption={(input, option) =>
                                                            String(option?.children ?? '')
                                                                .toLowerCase()
                                                                .includes(input.toLowerCase())
                                                        }
                                                        allowClear
                                                    >
                                                        {sectors.map(sector => (
                                                            <Select.Option key={sector} value={sector}>
                                                                {sector}
                                                            </Select.Option>
                                                        ))}
                                                    </Select>
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24}>
                                                <Form.Item
                                                    name='natureOfBusiness'
                                                    label='Nature of Business (What your business offers)'
                                                >
                                                    <Input.TextArea autoSize={{ minRows: 3 }} />
                                                </Form.Item>
                                            </Col>
                                        </Row>

                                        <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]}>
                                            <Col xs={24} sm={12}>
                                                <Form.Item name='beeLevel' label='B-BBEE Level'>
                                                    <Select placeholder='Select level' allowClear>
                                                        {[1, 2, 3, 4].map(level => (
                                                            <Select.Option key={level} value={level}>
                                                                Level {level}
                                                            </Select.Option>
                                                        ))}
                                                        <Select.Option key='5plus' value='5+'>
                                                            Level 5 and above
                                                        </Select.Option>
                                                    </Select>
                                                </Form.Item>
                                            </Col>

                                            <Col xs={24} sm={4}>
                                                <Form.Item name='youthOwnedPercent' label='Youth-Owned %'>
                                                    <InputNumber
                                                        addonAfter='%'
                                                        min={0}
                                                        max={100}
                                                        style={{ width: '100%' }}
                                                    />
                                                </Form.Item>
                                            </Col>

                                            <Col xs={24} sm={4}>
                                                <Form.Item name='femaleOwnedPercent' label='Female-Owned %'>
                                                    <InputNumber
                                                        addonAfter='%'
                                                        min={0}
                                                        max={100}
                                                        style={{ width: '100%' }}
                                                    />
                                                </Form.Item>
                                            </Col>

                                            <Col xs={24} sm={4}>
                                                <Form.Item name='blackOwnedPercent' label='Black-Owned %'>
                                                    <InputNumber
                                                        addonAfter='%'
                                                        min={0}
                                                        max={100}
                                                        style={{ width: '100%' }}
                                                    />
                                                </Form.Item>
                                            </Col>
                                        </Row>

                                        <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]}>
                                            <Col xs={24} md={8}>
                                                <Form.Item
                                                    name='dateOfRegistration'
                                                    label='Date of Registration'
                                                    rules={[
                                                        {
                                                            required: true,
                                                            message: 'Registration date is required'
                                                        },
                                                        {
                                                            validator: (_, value) =>
                                                                !value || value.isAfter(dayjs(), 'day')
                                                                    ? Promise.reject(
                                                                        new Error(
                                                                            'Registration date cannot be in the future'
                                                                        )
                                                                    )
                                                                    : Promise.resolve()
                                                        }
                                                    ]}
                                                >
                                                    <DatePicker
                                                        style={{ width: '100%' }}
                                                        inputReadOnly={isMobile}
                                                        disabledDate={current =>
                                                            current && current > dayjs().endOf('day')
                                                        }
                                                    />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={8}>
                                                <Form.Item
                                                    name='yearsOfTrading'
                                                    label='Years of Trading'
                                                    rules={[
                                                        { required: true, message: 'Years of trading is required' },
                                                        {
                                                            validator: (_, v) =>
                                                                v === null || v === undefined || v === ''
                                                                    ? Promise.reject(
                                                                        new Error('Years of trading is required')
                                                                    )
                                                                    : v < 0
                                                                        ? Promise.reject(new Error('Must be 0 or greater'))
                                                                        : Promise.resolve()
                                                        }
                                                    ]}
                                                >
                                                    <InputNumber min={0} style={{ width: '100%' }} />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={8}>
                                                <Form.Item
                                                    name='registrationNumber'
                                                    label='Registration Number'
                                                    rules={[
                                                        {
                                                            required: true,
                                                            message: 'Registration number is required'
                                                        },
                                                        {
                                                            validator: (_, value) =>
                                                                !value || isValidZARegistration(value)
                                                                    ? Promise.resolve()
                                                                    : Promise.reject(
                                                                        new Error('Use a valid SA registration')
                                                                    )
                                                        }
                                                    ]}
                                                    getValueFromEvent={e => e.target.value.toUpperCase()}
                                                >
                                                    <Input placeholder='e.g. 2015/123456/07' />
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                    </div>

                                    {/* ---- Location ---- */}
                                    <div style={sectionStyle('location')}>
                                        <SectionHeader
                                            icon={PROFILE_SECTIONS[2].icon}
                                            title={PROFILE_SECTIONS[2].title}
                                            subtitle={PROFILE_SECTIONS[2].subtitle}
                                            isMobile={isMobile}
                                        />

                                        <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]}>
                                            <Col xs={24}>
                                                <Form.Item
                                                    name='businessAddress'
                                                    label='Business Address'
                                                    rules={[
                                                        { required: true, message: 'Business address is required' }
                                                    ]}
                                                >
                                                    <Input />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={8}>
                                                <Form.Item
                                                    name='city'
                                                    label='City'
                                                    rules={[{ required: true, message: 'City is required' }]}
                                                >
                                                    <Input />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={8}>
                                                <Form.Item name='postalCode' label='Postal Code'>
                                                    <Input inputMode='numeric' />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={8}>
                                                <Form.Item
                                                    name='province'
                                                    label='Province'
                                                    rules={[{ required: true, message: 'Province is required' }]}
                                                >
                                                    <Select showSearch placeholder='Select province' allowClear>
                                                        {provinces.map(p => (
                                                            <Select.Option key={p} value={p}>
                                                                {p}
                                                            </Select.Option>
                                                        ))}
                                                    </Select>
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={8}>
                                                <Form.Item name='hub' label='Host Community'>
                                                    <Input />
                                                </Form.Item>
                                            </Col>
                                            <Col xs={24} md={8}>
                                                <Form.Item name='location' label='Location Type'>
                                                    <Select placeholder='Select type' allowClear>
                                                        <Select.Option value='Urban'>Urban</Select.Option>
                                                        <Select.Option value='Rural'>Rural</Select.Option>
                                                        <Select.Option value='Township'>Township</Select.Option>
                                                    </Select>
                                                </Form.Item>
                                            </Col>
                                        </Row>
                                    </div>

                                    {/* ---- Headcount & Revenue ---- */}
                                    <div style={sectionStyle('performance')}>
                                        <SectionHeader
                                            icon={PROFILE_SECTIONS[3].icon}
                                            title={PROFILE_SECTIONS[3].title}
                                            subtitle={PROFILE_SECTIONS[3].subtitle}
                                            isMobile={isMobile}
                                        />

                                        <Title level={5} style={{ marginTop: 0 }}>
                                            Monthly Data
                                        </Title>
                                        {last3Months.map(month => (
                                            <Row
                                                gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]}
                                                key={month.key}
                                            >
                                                <Col xs={24} md={8}>
                                                    <Form.Item
                                                        name={`revenue_${month.key}`}
                                                        label={`Revenue (${month.label})`}
                                                    >
                                                        <InputNumber
                                                            style={{ width: '100%' }}
                                                            inputMode='decimal'
                                                            formatter={v =>
                                                                `R ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
                                                            }
                                                            parser={v => Number((v || '').replace(/R\s?|(,*)/g, ''))}
                                                        />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={12} md={8}>
                                                    <Form.Item
                                                        name={`permHeadcount_${month.key}`}
                                                        label='Permanent Staff'
                                                    >
                                                        <InputNumber min={0} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={12} md={8}>
                                                    <Form.Item
                                                        name={`tempHeadcount_${month.key}`}
                                                        label='Temporary Staff'
                                                    >
                                                        <InputNumber min={0} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                            </Row>
                                        ))}

                                        <Title level={5} style={{ marginTop: 8 }}>
                                            Annual Data
                                        </Title>
                                        {last2Years.map(year => (
                                            <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]} key={year}>
                                                <Col xs={24} md={8}>
                                                    <Form.Item
                                                        name={`revenue_${year}`}
                                                        label={`Revenue (${year})`}
                                                    >
                                                        <InputNumber
                                                            style={{ width: '100%' }}
                                                            inputMode='decimal'
                                                            formatter={v =>
                                                                `R ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
                                                            }
                                                            parser={v => Number((v || '').replace(/R\s?|(,*)/g, ''))}
                                                        />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={12} md={8}>
                                                    <Form.Item
                                                        name={`permHeadcount_${year}`}
                                                        label='Permanent Staff'
                                                    >
                                                        <InputNumber min={0} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={12} md={8}>
                                                    <Form.Item
                                                        name={`tempHeadcount_${year}`}
                                                        label='Temporary Staff'
                                                    >
                                                        <InputNumber min={0} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                            </Row>
                                        ))}
                                    </div>

                                    {/* On mobile the card list stands in for the
                                        form until a section is opened — saving
                                        the whole form from there reads as
                                        premature, so the bar waits until then. */}
                                    {!showingMenu && (
                                        <ActionBar
                                            isMobile={isMobile}
                                            isInitialSetup={isInitialSetup}
                                            onSave={onSave}
                                        />
                                    )}
                                </Card>
                            </Col>
                        </Row>
                    </Form>
                </div>
            </div>
        </>
    )
}

export default ApplicantProfileForm
