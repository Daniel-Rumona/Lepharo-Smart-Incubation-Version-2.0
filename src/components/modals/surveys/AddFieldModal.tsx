import React, { useMemo, useState } from 'react'
import {
    Drawer,
    Empty,
    Input,
    Modal,
    Space,
    Typography,
    theme
} from 'antd'
import {
    AlignLeftOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    CheckSquareOutlined,
    DownOutlined,
    FontSizeOutlined,
    MailOutlined,
    NumberOutlined,
    SearchOutlined,
    StarOutlined,
    UploadOutlined,
    LockOutlined
} from '@ant-design/icons'
import {
    PREFILL_SECTIONS,
    type PrefillSection
} from '@/lib/surveyPrefill'
import { useIsMobile } from '@/hooks/useIsMobile'
// Loads workspace.css for the bottom-sheet style (.ws-sheet).
import '@/components/workspace'

const { Title, Text } = Typography

type AddFieldModalProps = {
    open: boolean
    onClose: () => void
    onAdd: (type: string, label?: string) => void
    /** Adds a whole preset section (heading + its profile-prefilled fields). */
    onAddSection?: (section: PrefillSection) => void
}

type FieldTypeItem = {
    value: string
    label: string
    icon: React.ReactNode
    tone: string
}

type FieldTypeSection = {
    title: string
    items: FieldTypeItem[]
}

const FIELD_TYPE_SECTIONS: FieldTypeSection[] = [
    {
        title: 'Text',
        items: [
            {
                value: 'text',
                label: 'Text Field',
                icon: <FontSizeOutlined />,
                tone: '#d6e9ff'
            },
            {
                value: 'textarea',
                label: 'Text Area',
                icon: <AlignLeftOutlined />,
                tone: '#d6e9ff'
            },
            {
                value: 'heading',
                label: 'Section Heading',
                icon: <FontSizeOutlined />,
                tone: '#d6e9ff'
            }
        ]
    },
    {
        title: 'Choice',
        items: [
            {
                value: 'select',
                label: 'Dropdown',
                icon: <DownOutlined />,
                tone: '#e3ddff'
            },
            {
                value: 'checkbox',
                label: 'Checkbox Group',
                icon: <CheckSquareOutlined />,
                tone: '#e3ddff'
            },
            {
                value: 'radio',
                label: 'Radio Group',
                icon: <CheckCircleOutlined />,
                tone: '#e3ddff'
            }
        ]
    },
    {
        title: 'Input',
        items: [
            {
                value: 'number',
                label: 'Number',
                icon: <NumberOutlined />,
                tone: '#ffe3a8'
            },
            {
                value: 'date',
                label: 'Date Picker',
                icon: <CalendarOutlined />,
                tone: '#ffe3a8'
            },
            {
                value: 'file',
                label: 'File Upload',
                icon: <UploadOutlined />,
                tone: '#ffe3a8'
            }
        ]
    },
    {
        title: 'Contact & rating',
        items: [
            {
                value: 'email',
                label: 'Email',
                icon: <MailOutlined />,
                tone: '#f7d4df'
            },
            {
                value: 'rating',
                label: 'Rating (Stars)',
                icon: <StarOutlined />,
                tone: '#d9edcf'
            }
        ]
    }
]

const AddFieldModal: React.FC<AddFieldModalProps> = ({
    open,
    onClose,
    onAdd,
    onAddSection
}) => {
    const { token } = theme.useToken()
    const isMobile = useIsMobile()
    const [search, setSearch] = useState('')

    const normalizedSearch = search.trim().toLowerCase()

    const visibleSections = useMemo(
        () =>
            FIELD_TYPE_SECTIONS.map(section => ({
                ...section,
                items: section.items.filter(item =>
                    item.label.toLowerCase().includes(normalizedSearch)
                )
            })).filter(section => section.items.length > 0),
        [normalizedSearch]
    )

    const handleClose = () => {
        setSearch('')
        onClose()
    }

    const handleAdd = (type: string) => {
        setSearch('')
        onAdd(type)
    }

    const visiblePrefillSections = useMemo(
        () =>
            onAddSection
                ? PREFILL_SECTIONS.filter(
                    section =>
                        section.title
                            .toLowerCase()
                            .includes(normalizedSearch) ||
                        section.fields.some(field =>
                            field.label
                                .toLowerCase()
                                .includes(normalizedSearch)
                        )
                )
                : [],
        [normalizedSearch, onAddSection]
    )

    const handleAddSection = (section: PrefillSection) => {
        setSearch('')
        onAddSection?.(section)
    }

    const searchBox = (
        <Input
            size='large'
            allowClear
            prefix={
                <SearchOutlined
                    style={{
                        color: token.colorTextTertiary
                    }}
                />
            }
            placeholder='Search question types'
            value={search}
            onChange={event => setSearch(event.target.value)}
            style={{
                width: '100%',
                maxWidth: isMobile ? undefined : 360,
                borderRadius: 12
            }}
        />
    )

    const list = (
        visibleSections.length === 0 &&
                    visiblePrefillSections.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description='No matching field types'
                    />
                ) : (
                    <div
                        style={{
                            display: 'grid',
                            // One column on phones so each type gets the width.
                            gridTemplateColumns: isMobile
                                ? '1fr'
                                : 'repeat(auto-fit, minmax(180px, 1fr))',
                            columnGap: 38,
                            rowGap: isMobile ? 18 : 30
                        }}
                    >
                        {visiblePrefillSections.length ? (
                            <div>
                                <Text
                                    strong
                                    style={{
                                        display: 'block',
                                        fontSize: 15,
                                        marginBottom: 10
                                    }}
                                >
                                    Prefilled sections
                                </Text>

                                <Space
                                    direction='vertical'
                                    size={4}
                                    style={{ width: '100%' }}
                                >
                                    {visiblePrefillSections.map(section => (
                                        <button
                                            key={section.key}
                                            type='button'
                                            onClick={() =>
                                                handleAddSection(section)
                                            }
                                            style={{
                                                width: '100%',
                                                minHeight: 52,
                                                padding: '6px 8px',
                                                border: 0,
                                                borderRadius: 10,
                                                background: 'transparent',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 12,
                                                textAlign: 'left',
                                                color: token.colorText,
                                                transition:
                                                    'background 0.18s ease'
                                            }}
                                            onMouseEnter={event => {
                                                event.currentTarget.style.background =
                                                    token.colorFillTertiary
                                            }}
                                            onMouseLeave={event => {
                                                event.currentTarget.style.background =
                                                    'transparent'
                                            }}
                                        >
                                            <span
                                                style={{
                                                    width: 38,
                                                    height: 38,
                                                    flex: '0 0 38px',
                                                    borderRadius: 10,
                                                    display: 'grid',
                                                    placeItems: 'center',
                                                    background: '#d6e9ff',
                                                    color: '#3f3a46',
                                                    fontSize: 18
                                                }}
                                            >
                                                <LockOutlined />
                                            </span>

                                            <span style={{ minWidth: 0 }}>
                                                <Text
                                                    style={{
                                                        fontSize: 15,
                                                        display: 'block'
                                                    }}
                                                >
                                                    {section.title}
                                                </Text>
                                                <Text
                                                    type='secondary'
                                                    style={{ fontSize: 12 }}
                                                >
                                                    {section.fields
                                                        .map(f => f.label)
                                                        .join(', ')}
                                                </Text>
                                            </span>
                                        </button>
                                    ))}
                                </Space>
                            </div>
                        ) : null}

                        {visibleSections.map(section => (
                            <div key={section.title}>
                                <Text
                                    strong
                                    style={{
                                        display: 'block',
                                        fontSize: 15,
                                        marginBottom: 10
                                    }}
                                >
                                    {section.title}
                                </Text>

                                <Space
                                    direction='vertical'
                                    size={4}
                                    style={{ width: '100%' }}
                                >
                                    {section.items.map(item => (
                                        <button
                                            key={item.value}
                                            type='button'
                                            onClick={() =>
                                                handleAdd(item.value)
                                            }
                                            style={{
                                                width: '100%',
                                                minHeight: 52,
                                                padding: '6px 8px',
                                                border: 0,
                                                borderRadius: 10,
                                                background: 'transparent',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 12,
                                                textAlign: 'left',
                                                color: token.colorText,
                                                transition:
                                                    'background 0.18s ease'
                                            }}
                                            onMouseEnter={event => {
                                                event.currentTarget.style.background =
                                                    token.colorFillTertiary
                                            }}
                                            onMouseLeave={event => {
                                                event.currentTarget.style.background =
                                                    'transparent'
                                            }}
                                        >
                                            <span
                                                style={{
                                                    width: 38,
                                                    height: 38,
                                                    flex: '0 0 38px',
                                                    borderRadius: 10,
                                                    display: 'grid',
                                                    placeItems: 'center',
                                                    background: item.tone,
                                                    color: '#3f3a46',
                                                    fontSize: 18
                                                }}
                                            >
                                                {item.icon}
                                            </span>

                                            <Text style={{ fontSize: 15 }}>
                                                {item.label}
                                            </Text>
                                        </button>
                                    ))}
                                </Space>
                            </div>
                        ))}
                    </div>
                )
    )

    // Phones: a bottom sheet. The title, close and search stay put; only the
    // list of types scrolls under them.
    if (isMobile) {
        return (
            <Drawer
                className='ws-sheet'
                open={open}
                onClose={handleClose}
                placement='bottom'
                height='85vh'
                title='Add question'
                destroyOnClose={false}
                styles={{
                    body: {
                        padding: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden'
                    }
                }}
            >
                <div
                    style={{
                        flex: '0 0 auto',
                        padding: '12px 16px',
                        borderBottom: `1px solid ${token.colorBorderSecondary}`
                    }}
                >
                    {searchBox}
                </div>
                <div
                    style={{
                        flex: '1 1 auto',
                        minHeight: 0,
                        overflowY: 'auto',
                        overscrollBehavior: 'contain',
                        padding: 16
                    }}
                >
                    {list}
                </div>
            </Drawer>
        )
    }

    return (
        <Modal
            open={open}
            onCancel={handleClose}
            footer={null}
            width={920}
            centered
            title={null}
            destroyOnClose={false}
            styles={{
                body: {
                    padding: 0
                }
            }}
        >
            {/* Title and search stay in view; the list scrolls beneath them. */}
            <div style={{ padding: '24px 24px 20px' }}>
                <div style={{ marginBottom: 18 }}>
                    <Title
                        level={4}
                        style={{
                            margin: 0,
                            marginBottom: 4
                        }}
                    >
                        Add question
                    </Title>

                    <Text type='secondary'>
                        Choose the type of question or element you want to add.
                    </Text>
                </div>

                {searchBox}
            </div>

            <div
                style={{
                    maxHeight: 'min(60vh, 560px)',
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                    padding: '4px 24px 24px'
                }}
            >
                {list}
            </div>
        </Modal>
    )
}

export default AddFieldModal
