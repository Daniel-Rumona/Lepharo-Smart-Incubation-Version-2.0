import React, { useEffect, useMemo, useState } from 'react'
import {
    App,
    Form,
    Input,
    Button,
    Select,
    Switch,
    Typography,
    Space,
    Divider,
    Tooltip,
    Modal,
    List,
    Tag,
    Drawer,
    Grid,
    Empty,
    DatePicker,
    Upload,
    Rate,
    FloatButton,
    Spin,
    theme
} from 'antd'
import {
    PlusOutlined,
    DeleteOutlined,
    CopyOutlined,
    EyeOutlined,
    SaveOutlined,
    ArrowLeftOutlined,
    SendOutlined,
    FileSearchOutlined,
    InboxOutlined,
    LockOutlined,
    CheckOutlined,
    CloseOutlined
} from '@ant-design/icons'
import {
    doc,
    collection,
    addDoc,
    updateDoc,
    getDoc,
    getDocs,
    where,
    query
} from 'firebase/firestore'
import { db } from '@/firebase'
import {
    DragDropContext,
    Droppable,
    Draggable,
    DropResult
} from '@hello-pangea/dnd'
import { useNavigate, useParams } from 'react-router-dom'
import { type ExtractedSurveyField } from '@/services/surveyQuestionExtractionService'
import {
    PREFILL_LABELS,
    type PrefillKey,
    type PrefillSection
} from '@/lib/surveyPrefill'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import AddFieldModal from '../modals/surveys/AddFieldModal'
import ImportQuestionsModal, {
    type ImportQuestionsMeta,
    type ImportQuestionsOptions
} from '../modals/surveys/ImportQuestionsModal'
import PreviewSurveyModal from '../modals/surveys/PreviewSurveyModal'

const { Title, Text } = Typography

// ---------- Models ----------
interface SurveyField {
    id: string
    type: string
    label: string
    name?: string
    placeholder?: string
    required: boolean
    options?: string[]
    description?: string
    defaultValue?: any
    /**
     * Set when the answer comes from the SME's profile. The builder shows the
     * field but doesn't let you edit it; the response page seeds it. See
     * src/lib/surveyPrefill.ts.
     */
    prefill?: PrefillKey
}

interface SurveyTemplate {
    id?: string
    title: string
    description: string
    fields: SurveyField[]
    status: 'draft' | 'published'
    category: string
    createdAt: string
    updatedAt: string
    createdBy?: string
    programId?: string
    department?: string
}

type ProgramRow = { id: string; name?: string; title?: string }

const getProgramIdValue = (value: unknown): string | undefined => {
    if (!value) return undefined

    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed && trimmed !== 'all' ? trimmed : undefined
    }

    if (typeof value === 'object') {
        const candidate =
            (value as any).activeProgramId ??
            (value as any).value ??
            ((value as any).programId !== 'all' ? (value as any).programId : undefined) ??
            (value as any).id

        return getProgramIdValue(candidate)
    }

    return undefined
}

// ---------- Constants ----------
const FIELD_TYPES = [
    { value: 'text', label: 'Text Field' },
    { value: 'textarea', label: 'Text Area' },
    { value: 'number', label: 'Number' },
    { value: 'email', label: 'Email' },
    { value: 'select', label: 'Dropdown' },
    { value: 'checkbox', label: 'Checkbox Group' },
    { value: 'radio', label: 'Radio Group' },
    { value: 'date', label: 'Date Picker' },
    { value: 'file', label: 'File Upload' },
    { value: 'rating', label: 'Rating (Stars)' },
    { value: 'heading', label: 'Section Heading' }
]

const SURVEY_CATEGORIES = ['Evaluation Form', 'Feedback Form'] as const

const normalizeForDirty = (tpl: SurveyTemplate | null) => {
    if (!tpl) return null
    const {
        id,
        title,
        description,
        fields,
        status,
        category,
        programId,
        department
    } = tpl
    return {
        id: id ?? undefined,
        title: title?.trim() || '',
        description: description?.trim() || '',
        status,
        category,
        programId: getProgramIdValue(programId),
        department: department ?? undefined,
        fields: (fields || []).map(f => ({
            id: f.id,
            type: f.type,
            label: f.label?.trim() || '',
            name: f.name ?? undefined,
            placeholder: f.placeholder ?? undefined,
            required: !!f.required,
            options: Array.isArray(f.options) ? f.options : undefined,
            description: f.description ?? undefined,
            defaultValue: f.defaultValue ?? undefined,
            prefill: f.prefill ?? undefined
        }))
    }
}

/** Caption above a control in the "Selected question" panel. */
const SettingLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Text
        type='secondary'
        style={{ display: 'block', marginBottom: 4, fontSize: 12 }}
    >
        {children}
    </Text>
)

const generateId = () => Math.random().toString(36).substring(2, 9)

const toSurveyField = (field: ExtractedSurveyField): SurveyField => ({
    // Regenerate the id locally so an imported field can never collide with a
    // field already on the canvas.
    id: generateId(),
    type: field.type,
    label: field.label,
    name: field.name || undefined,
    placeholder: field.placeholder ?? undefined,
    required: !!field.required,
    options: field.options ?? undefined,
    description: field.description ?? undefined
})
const sanitizeName = (s: string) =>
    (s || 'field')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')

const isChoiceField = (
    type: string
) =>
    [
        'select',
        'radio',
        'checkbox'
    ].includes(type)

const getChoiceGrid = (
    count: number
) => {
    if (count > 8) {
        return {
            columns: 1,
            getSpan: () => 1
        }
    }

    if (count === 1) {
        return {
            columns: 1,
            getSpan: () => 1
        }
    }

    if (count === 2) {
        return {
            columns: 2,
            getSpan: () => 1
        }
    }

    if (count === 3) {
        return {
            columns: 3,
            getSpan: () => 1
        }
    }

    if (count === 5) {
        return {
            columns: 6,
            getSpan: (
                index: number
            ) =>
                index < 3
                    ? 2
                    : 3
        }
    }

    if (
        count === 4 ||
        count === 6 ||
        count === 8
    ) {
        return {
            columns: 2,
            getSpan: () => 1
        }
    }

    return {
        columns: 3,
        getSpan: () => 1
    }
}

const getYesNoType = (
    option: string
): 'yes' | 'no' | null => {
    const normalized =
        option
            .trim()
            .toLowerCase()

    if (normalized === 'yes') {
        return 'yes'
    }

    if (normalized === 'no') {
        return 'no'
    }

    return null
}



const ChoiceOptionsEditor: React.FC<{
    field: SurveyField
    onPatch: (
        id: string,
        updates: Partial<SurveyField>
    ) => void
}> = ({
    field,
    onPatch
}) => {
        const { token } =
            theme.useToken()

        const options =
            field.options || []

        const isScrollable =
            options.length > 8

        const choiceGrid =
            getChoiceGrid(
                options.length
            )

        const updateOption = (
            index: number,
            value: string
        ) => {
            const next = [
                ...options
            ]

            next[index] = value

            onPatch(
                field.id,
                {
                    options: next
                }
            )
        }

        const deleteOption = (
            index: number
        ) => {
            const next = [
                ...options
            ]

            next.splice(
                index,
                1
            )

            onPatch(
                field.id,
                {
                    options: next
                }
            )
        }

        const addOption = () => {
            onPatch(
                field.id,
                {
                    options: [
                        ...options,
                        `Option ${options.length +
                        1
                        }`
                    ]
                }
            )
        }

        return (
            <div>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent:
                            'space-between',
                        gap: 12,
                        marginBottom: 10
                    }}
                >
                    <div>
                        <Text strong>
                            Answer options
                        </Text>

                        <Text
                            type='secondary'
                            style={{
                                display:
                                    'block',
                                marginTop: 2,
                                fontSize: 12
                            }}
                        >
                            {field.type ===
                                'checkbox'
                                ? 'Participants can select more than one option'
                                : 'Participants can select one option'}
                        </Text>
                    </div>

                    <Tag
                        style={{
                            margin: 0,
                            borderRadius: 999
                        }}
                    >
                        {options.length}{' '}
                        option
                        {options.length === 1
                            ? ''
                            : 's'}
                    </Tag>
                </div>

                {options.length > 0 ? (
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns:
                                `repeat(${choiceGrid.columns}, minmax(0, 1fr))`,
                            gap: 10,
                            maxHeight:
                                isScrollable
                                    ? 330
                                    : undefined,
                            overflowY:
                                isScrollable
                                    ? 'auto'
                                    : undefined,
                            overflowX:
                                'hidden',
                            paddingRight:
                                isScrollable
                                    ? 5
                                    : 0
                        }}
                    >
                        {options.map(
                            (
                                option,
                                index
                            ) => {
                                const yesNo =
                                    getYesNoType(
                                        option
                                    )

                                return (
                                    <div
                                        key={
                                            index
                                        }
                                        style={{
                                            gridColumn:
                                                options.length === 5
                                                    ? `span ${choiceGrid.getSpan(index)}`
                                                    : undefined,
                                            minHeight:
                                                64,
                                            display:
                                                'flex',
                                            alignItems:
                                                'center',
                                            gap: 10,
                                            padding:
                                                '10px 10px 10px 12px',
                                            borderRadius:
                                                14,
                                            border: `1px solid ${token.colorBorderSecondary}`,
                                            background:
                                                token.colorBgContainer,
                                            boxShadow:
                                                '0 4px 14px rgba(15,23,42,.035)',
                                            transition:
                                                'all .2s ease'
                                        }}
                                    >
                                        {yesNo ? (
                                            <div
                                                style={{
                                                    width:
                                                        36,
                                                    height:
                                                        36,
                                                    borderRadius:
                                                        11,
                                                    display:
                                                        'grid',
                                                    placeItems:
                                                        'center',
                                                    background:
                                                        yesNo ===
                                                            'yes'
                                                            ? token.colorSuccessBg
                                                            : token.colorErrorBg,
                                                    color:
                                                        yesNo ===
                                                            'yes'
                                                            ? token.colorSuccess
                                                            : token.colorError,
                                                    flex:
                                                        '0 0 auto',
                                                    fontSize:
                                                        15
                                                }}
                                            >
                                                {yesNo ===
                                                    'yes' ? (
                                                    <CheckOutlined />
                                                ) : (
                                                    <CloseOutlined />
                                                )}
                                            </div>
                                        ) : (
                                            <div
                                                style={{
                                                    width:
                                                        28,
                                                    height:
                                                        28,
                                                    borderRadius:
                                                        field.type ===
                                                            'checkbox'
                                                            ? 8
                                                            : '50%',
                                                    border: `1px solid ${token.colorBorder}`,
                                                    display:
                                                        'grid',
                                                    placeItems:
                                                        'center',
                                                    color:
                                                        token.colorTextSecondary,
                                                    flex:
                                                        '0 0 auto',
                                                    fontSize:
                                                        11,
                                                    fontWeight:
                                                        600
                                                }}
                                            >
                                                {
                                                    index +
                                                    1
                                                }
                                            </div>
                                        )}

                                        <Input
                                            variant='borderless'
                                            value={
                                                option
                                            }
                                            onChange={event =>
                                                updateOption(
                                                    index,
                                                    event
                                                        .target
                                                        .value
                                                )
                                            }
                                            placeholder={`Option ${index +
                                                1
                                                }`}
                                            style={{
                                                flex: 1,
                                                minWidth:
                                                    0,
                                                padding:
                                                    '4px 2px',
                                                fontWeight:
                                                    500
                                            }}
                                        />

                                        <Tooltip title='Delete option'>
                                            <Button
                                                type='text'
                                                shape='circle'
                                                danger
                                                size='small'
                                                icon={
                                                    <DeleteOutlined />
                                                }
                                                onClick={() =>
                                                    deleteOption(
                                                        index
                                                    )
                                                }
                                            />
                                        </Tooltip>
                                    </div>
                                )
                            }
                        )}
                    </div>
                ) : (
                    <div
                        style={{
                            padding: 20,
                            borderRadius: 14,
                            border: `1px dashed ${token.colorBorder}`,
                            background:
                                token.colorFillAlter,
                            textAlign:
                                'center'
                        }}
                    >
                        <Text type='secondary'>
                            No answer options yet
                        </Text>
                    </div>
                )}

                <Button
                    block
                    shape='round'
                    type='dashed'
                    icon={
                        <PlusOutlined />
                    }
                    onClick={addOption}
                    style={{
                        marginTop: 10
                    }}
                >
                    Add option
                </Button>
            </div>
        )
    }
// ---------- Field Preview ----------
const FieldPreview: React.FC<{
    field: SurveyField
}> = ({
    field
}) => {
        if (field.prefill) {
            return (
                <Input
                    disabled
                    placeholder={`${PREFILL_LABELS[field.prefill]} from the SME’s profile`}
                />
            )
        }

        switch (field.type) {
            case 'text':
                return (
                    <Input
                        placeholder={
                            field.placeholder
                        }
                    />
                )

            case 'textarea':
                return (
                    <Input.TextArea
                        rows={4}
                        placeholder={
                            field.placeholder
                        }
                    />
                )

            case 'number':
                return (
                    <Input
                        type='number'
                        placeholder={
                            field.placeholder
                        }
                    />
                )

            case 'email':
                return (
                    <Input
                        type='email'
                        placeholder={
                            field.placeholder
                        }
                    />
                )

            case 'date':
                return (
                    <DatePicker
                        style={{
                            width: '100%'
                        }}
                    />
                )

            case 'file':
                return (
                    <Upload.Dragger
                        multiple={false}
                        maxCount={1}
                        beforeUpload={() =>
                            false
                        }
                        style={{
                            padding:
                                '10px 0'
                        }}
                    >
                        <p className='ant-upload-drag-icon'>
                            <InboxOutlined />
                        </p>

                        <p className='ant-upload-text'>
                            Drag and drop a file here
                        </p>

                        <p className='ant-upload-hint'>
                            or click to browse
                        </p>
                    </Upload.Dragger>
                )

            case 'rating':
                return <Rate />

            case 'heading':
                return (
                    <Title
                        level={4}
                        style={{
                            margin: 0
                        }}
                    >
                        {field.label ||
                            'Section'}
                    </Title>
                )

            default:
                return null
        }
    }

// ---------- Field Card (center) ----------
const FieldCard: React.FC<{
    field: SurveyField
    number: number
    onPatch: (
        id: string,
        updates: Partial<SurveyField>
    ) => void
    onDuplicate: (id: string) => void
    onDelete: (id: string) => void
}> = React.memo(
    ({
        field,
        number,
        onPatch,
        onDuplicate,
        onDelete
    }) => {
        const { token } = theme.useToken()

        return (
            <MotionCard
                size='small'
                bodyStyle={{
                    padding: 28
                }}
            >
                {/* TOP */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 16,
                        marginBottom: 22
                    }}
                >
                    <Text
                        style={{
                            fontSize: 30,
                            lineHeight: 1,
                            fontWeight: 700,
                            color: token.colorTextTertiary,
                            letterSpacing: '-0.04em'
                        }}
                    >
                        {String(number).padStart(2, '0')}
                    </Text>

                    <Space size={8}>
                        <Tooltip title='Duplicate question'>
                            <Button
                                shape='circle'
                                icon={<CopyOutlined />}
                                onClick={() =>
                                    onDuplicate(field.id)
                                }
                            />
                        </Tooltip>

                        <Tooltip title='Delete question'>
                            <Button
                                shape='circle'
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() =>
                                    onDelete(field.id)
                                }
                            />
                        </Tooltip>
                    </Space>
                </div>

                {/* QUESTION */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                        gap: 7,
                        marginBottom: 22
                    }}
                >
                    <Tooltip
                        title={
                            field.prefill
                                ? 'Answered from the SME’s profile — the wording is fixed'
                                : 'Click to edit question'
                        }
                    >
                        <Input.TextArea
                            variant='borderless'
                            // A prefilled field's label is what pairs it with the
                            // profile value, so it is shown, not edited.
                            readOnly={!!field.prefill}
                            autoSize={{
                                minRows: 1,
                                maxRows: 2
                            }}
                            value={field.label}
                            onChange={e =>
                                onPatch(field.id, {
                                    label: e.target.value
                                })
                            }
                            placeholder='New Field'
                            style={{
                                flex: 1,
                                minWidth: 0,
                                padding: '4px 0 7px',
                                borderRadius: 0,
                                borderBottom: `1px dashed ${token.colorBorder}`,
                                fontSize:
                                    field.type === 'heading'
                                        ? 24
                                        : 20,
                                lineHeight: 1.4,
                                fontWeight: 600,
                                resize: 'none'
                            }}
                        />
                    </Tooltip>

                    {field.type !== 'heading' &&
                        field.required ? (
                        <Text
                            type='danger'
                            style={{
                                paddingBottom: 7,
                                fontSize: 20,
                                fontWeight: 600
                            }}
                        >
                            *
                        </Text>
                    ) : null}

                    {field.description ? (
                        <Tooltip
                            title={field.description}
                            placement='top'
                        >
                            <Text
                                type='secondary'
                                style={{
                                    paddingBottom: 8,
                                    cursor: 'help',
                                    fontSize: 15
                                }}
                            >
                                ?
                            </Text>
                        </Tooltip>
                    ) : null}
                </div>

                {/* LIVE FIELD / OPTION EDITOR */}
                {field.type !== 'heading' ? (
                    isChoiceField(
                        field.type
                    ) ? (
                        <ChoiceOptionsEditor
                            field={field}
                            onPatch={onPatch}
                        />
                    ) : (
                        <FieldPreview
                            field={field}
                        />
                    )
                ) : null}

                {field.prefill ? (
                    <div style={{ marginTop: 10 }}>
                        <Tag
                            icon={<LockOutlined />}
                            color='blue'
                            style={{ borderRadius: 999 }}
                        >
                            Prefilled · {PREFILL_LABELS[field.prefill]}
                        </Tag>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            Filled in from the SME’s profile when they open the
                            survey. They can correct it for this response.
                        </Text>
                    </div>
                ) : null}
            </MotionCard>
        )
    }
)

// ---------- Main ----------
export default function SurveyBuilder() {
    const { message } = App.useApp()
    const { token } = theme.useToken()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const params = useParams() as { id?: string } | null
    const routeTemplateId = (params?.id as string) || null
    const { activeProgramId } = useActiveProgramId()

    // NEW: programs list
    const [programs, setPrograms] = useState<ProgramRow[]>([])

    // state
    const [editingTemplateId, setEditingTemplateId] = useState<string | null>(
        routeTemplateId
    )
    const [addModalOpen, setAddModalOpen] = useState(false)
    const [importModalOpen, setImportModalOpen] = useState(false)
    const [isPreviewVisible, setIsPreviewVisible] = useState(false)
    const [savingTemplate, setSavingTemplate] = useState(false)
    // Only ever true on the /builder/:id edit route; creating a new survey has
    // nothing to fetch.
    const [loadingTemplate, setLoadingTemplate] = useState(!!routeTemplateId)
    const [outlineOpen, setOutlineOpen] = useState(false)
    const [surveySettingsOpen, setSurveySettingsOpen] = useState(false)

    const screens = Grid.useBreakpoint()
    const isMobile = !screens.md
    const showDesktopSidePanel = !!screens.xl

    const [surveyData, setSurveyData] = useState<SurveyTemplate>({
        title: '',
        description: '',
        fields: [],
        status: 'draft',
        category: 'Evaluation Form',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        programId: undefined
    })

    useEffect(() => {
        if (!surveyData.department && user?.departmentId) {
            setSurveyData(prev => ({ ...prev, department: user.departmentId }))
        }
    }, [user?.departmentId]) // runs once when user loads

    // keep a baseline to detect unsaved changes
    const [baseline, setBaseline] = useState<SurveyTemplate | null>(null)
    const isDirty = useMemo(() => {
        if (!baseline) return true
        return (
            JSON.stringify(normalizeForDirty(surveyData)) !==
            JSON.stringify(normalizeForDirty(baseline))
        )
    }, [surveyData, baseline])

    const hasMinimumContent =
        surveyData.title.trim().length > 0 && surveyData.fields.length > 0
    const hasQuestions = surveyData.fields.some(
        field => field.type !== 'heading'
    )
    const shouldPromptDraft = isDirty && hasMinimumContent

    // selection
    const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)

    const selectedField =
        surveyData.fields.find(f => f.id === selectedFieldId) || undefined

    const selectedFieldIndex = surveyData.fields.findIndex(
        field => field.id === selectedFieldId
    )

    useEffect(() => {
        if (surveyData.fields.length === 0) {
            if (selectedFieldId) {
                setSelectedFieldId(null)
            }
            return
        }

        const stillExists = surveyData.fields.some(
            field => field.id === selectedFieldId
        )

        if (!selectedFieldId || !stillExists) {
            setSelectedFieldId(surveyData.fields[0].id)
        }
    }, [surveyData.fields, selectedFieldId])

    // Default program from the universal active program
    useEffect(() => {
        if (!getProgramIdValue(surveyData.programId) && activeProgramId) {
            setSurveyData(prev => ({ ...prev, programId: activeProgramId }))
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeProgramId])

    // ---------- Load programs for the selector ----------
    useEffect(() => {
        const loadPrograms = async () => {
            try {
                // Assumes a 'programs' collection with at least { name/title }
                // Adjust field names if your schema differs.
                const qy = query(collection(db, 'programs'))
                const snap = await getDocs(qy)
                const list = snap.docs.map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                })) as ProgramRow[]
                setPrograms(list)
            } catch (e) {
                console.error(e)
            }
        }
        loadPrograms()
    }, [])

    // ---------- Field ops ----------
    const addField = (type: string, presetLabel?: string) => {
        const id = generateId()
        const baseLabel =
            presetLabel || (type === 'heading' ? 'Section' : 'New Field')
        const newField: SurveyField = {
            id,
            type,
            label: baseLabel,
            required: false,
            placeholder: [
                'text',
                'textarea',
                'number',
                'email',
                'select',
                'radio'
            ].includes(type)
                ? 'Enter value...'
                : undefined,
            options:
                type === 'select' || type === 'checkbox' || type === 'radio'
                    ? ['Option 1', 'Option 2']
                    : undefined
        }
        setSurveyData(prev => ({ ...prev, fields: [...prev.fields, newField] }))
        setSelectedFieldId(id)
    }

    /**
     * Appends a preset section: a heading followed by its prefilled fields.
     * The flat field list stays flat — a heading is what marks a section, the
     * same as one added by hand.
     */
    const addPrefillSection = (section: PrefillSection) => {
        const alreadyAdded = surveyData.fields.some(f =>
            section.fields.some(sf => sf.prefill === f.prefill)
        )
        if (alreadyAdded) {
            message.warning(`${section.title} is already on this survey.`)
            return
        }

        const heading: SurveyField = {
            id: generateId(),
            type: 'heading',
            label: section.title,
            required: false
        }
        const fields: SurveyField[] = section.fields.map(sf => ({
            id: generateId(),
            type: sf.type,
            label: sf.label,
            name: sanitizeName(sf.label),
            required: false,
            prefill: sf.prefill
        }))

        setSurveyData(prev => ({
            ...prev,
            fields: [...prev.fields, heading, ...fields],
            updatedAt: new Date().toISOString()
        }))
        setSelectedFieldId(heading.id)
        message.success(`${section.title} added — answers come from the SME's profile.`)
    }

    const importFields = (
        extracted: ExtractedSurveyField[],
        meta: ImportQuestionsMeta,
        options: ImportQuestionsOptions
    ) => {
        if (extracted.length === 0) return
        const fields = extracted.map(toSurveyField)

        setSurveyData(prev => {
            const next: SurveyTemplate = {
                ...prev,
                fields: options.replace ? fields : [...prev.fields, ...fields],
                updatedAt: new Date().toISOString()
            }

            if (options.applyMeta) {
                // Never clobber something the user already typed: the document
                // only fills gaps unless it is replacing the whole form.
                if (meta.title && (options.replace || !prev.title.trim())) {
                    next.title = meta.title
                }
                if (meta.description && (options.replace || !prev.description.trim())) {
                    next.description = meta.description
                }
                if (
                    meta.category &&
                    SURVEY_CATEGORIES.includes(meta.category as (typeof SURVEY_CATEGORIES)[number])
                ) {
                    next.category = meta.category
                }
            }

            return next
        })

        const firstImported = fields[0]
        setSelectedFieldId(firstImported.id)
    }

    const changeFieldType = (id: string, type: string) => {
        setSurveyData(prev => ({
            ...prev,
            fields: prev.fields.map(f => {
                if (f.id !== id) return f
                const updates: Partial<SurveyField> = { type }
                if (type === 'select' || type === 'checkbox' || type === 'radio') {
                    updates.options =
                        f.options && f.options.length ? f.options : ['Option 1', 'Option 2']
                } else if (type === 'heading' || type === 'rating') {
                    updates.placeholder = undefined
                    updates.options = undefined
                } else {
                    updates.options = undefined
                }
                return { ...f, ...updates }
            })
        }))
    }

    const patchField = (
        id: string,
        updates: Partial<SurveyField>
    ) => {
        setSurveyData(prev => ({
            ...prev,
            fields: prev.fields.map(field =>
                field.id === id
                    ? { ...field, ...updates }
                    : field
            )
        }))
    }

    const duplicateField = (id: string) => {
        const f = surveyData.fields.find(x => x.id === id)
        if (!f) return
        const copy: SurveyField = {
            ...f,
            id: generateId(),
            label: `${f.label} (Copy)`
        }
        setSurveyData(prev => ({ ...prev, fields: [...prev.fields, copy] }))
    }

    const removeField = (id: string) => {
        setSurveyData(prev => ({
            ...prev,
            fields: prev.fields.filter(f => f.id !== id)
        }))
        if (selectedFieldId === id) setSelectedFieldId(null)
    }

    const handleDragEnd = (result: DropResult) => {
        if (!result.destination) return
        const src = result.source.index
        const dst = result.destination.index
        if (src === dst) return
        const next = [...surveyData.fields]
        const [moved] = next.splice(src, 1)
        next.splice(dst, 0, moved)
        setSurveyData(prev => ({ ...prev, fields: next }))
    }

    // ---------- Persistence ----------
    const pruneUndefinedDeep = (val: any): any => {
        if (Array.isArray(val)) return val.map(pruneUndefinedDeep)
        if (val && typeof val === 'object') {
            return Object.fromEntries(
                Object.entries(val)
                    .filter(([, v]) => v !== undefined)
                    .map(([k, v]) => [k, pruneUndefinedDeep(v)])
            )
        }
        return val
    }

    const withGeneratedNames = (tpl: SurveyTemplate): SurveyTemplate => {
        const fields = tpl.fields.map((f, idx) => ({
            ...f,
            name:
                f.name && f.name.length > 0
                    ? f.name
                    : sanitizeName(f.label || `field_${idx + 1}`)
        }))
        return { ...tpl, fields }
    }

    const saveTemplate = async (status?: 'draft' | 'published') => {
        if (!surveyData.title.trim()) return message.error('Give your survey a title.')
        if (surveyData.fields.length === 0)
            return message.error('Add at least one field.')

        const selectedProgramId =
            getProgramIdValue(surveyData.programId) || getProgramIdValue(activeProgramId)

        if (!selectedProgramId)
            return message.error('Select a Program for this survey.')

        const normalizedFields = toFieldsArray(surveyData.fields)

        const payloadRaw: SurveyTemplate = withGeneratedNames({
            ...surveyData,
            fields: normalizedFields,
            programId: selectedProgramId,
            status: status ?? surveyData.status,
            updatedAt: new Date().toISOString(),
            department: user?.departmentId
        })

        const payload = pruneUndefinedDeep(payloadRaw) as SurveyTemplate

        try {
            setSavingTemplate(true)
            let savedId = editingTemplateId

            if (editingTemplateId) {
                await updateDoc(
                    doc(db, 'formTemplates', editingTemplateId),
                    payload as any
                )
                message.success('Form template updated')
            } else {
                const created = await addDoc(
                    collection(db, 'formTemplates'),
                    payload as any
                )
                savedId = created.id
                setEditingTemplateId(savedId)
                message.success('Form template saved')
            }

            // Build the new canonical state that matches Firestore
            const nextState: SurveyTemplate = {
                ...surveyData,
                ...payload, // includes new updatedAt/status/programId/etc.
                programId: selectedProgramId,
                id: savedId || surveyData.id // ensure id is on the state
            }

            setSurveyData(nextState)
            setBaseline(nextState) // baseline matches state → isDirty becomes false
        } catch (e) {
            console.error(e)
            message.error('Failed to save template')
        } finally {
            setSavingTemplate(false)
        }
    }

    const publishSurvey = async () => saveTemplate('published')

    const toFieldsArray = (v: any): SurveyField[] => {
        if (!v) return []
        if (Array.isArray(v)) return v as SurveyField[]
        // If somehow stored as an object/map, convert its values to an array
        if (typeof v === 'object') return Object.values(v) as SurveyField[]
        return []
    }

    const loadTemplate = async (templateId: string) => {
        try {
            setLoadingTemplate(true)
            const ref = doc(db, 'formTemplates', templateId)
            const ds = await getDoc(ref)
            if (!ds.exists()) {
                // Don't strand the user on an empty builder that would silently
                // save as a brand new template.
                message.error('Template not found')
                navigate('/operations/surveys')
                return
            }
            const tpl = ds.data() as any

            const hydrated: SurveyTemplate = {
                ...tpl,
                id: templateId,
                // make sure fields is always an array
                fields: toFieldsArray(tpl.fields),
                // fallbacks
                programId: getProgramIdValue(tpl.programId) ?? activeProgramId ?? undefined,
                department: tpl.department ?? user?.departmentId ?? undefined
            }

            setSurveyData(hydrated)
            setEditingTemplateId(templateId)
            setSelectedFieldId(null)
            setBaseline(hydrated)
        } catch (e) {
            console.error(e)
            message.error('Failed to load template')
        } finally {
            setLoadingTemplate(false)
        }
    }

    // on mount, if /builder/[id], load it
    useEffect(() => {
        if (routeTemplateId) loadTemplate(routeTemplateId)
        else setBaseline(surveyData)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [routeTemplateId])

    const surveyTitle = surveyData.title.trim() || 'Untitled survey'
    const selectedProgramId = getProgramIdValue(surveyData.programId)
    const selectedProgram = programs.find(p => p.id === selectedProgramId)
    const selectedProgramLabel = selectedProgram?.name || selectedProgram?.title || selectedProgramId

    const handleBack = () => {
        if (shouldPromptDraft) {
            Modal.confirm({
                title: 'Save as draft before leaving?',
                content:
                    'Do you want to save this survey as a draft before going back to Templates?',
                okText: 'Save draft',
                cancelText: 'Discard & leave',
                onOk: async () => {
                    await saveTemplate('draft')
                    navigate('/operations/surveys')
                },
                onCancel: () => {
                    navigate('/operations/surveys')
                }
            })
            return
        }

        navigate('/operations/surveys')
    }

    const surveySettingsContent = (
        <Form layout='vertical'>
            <Form.Item label='Title' required>
                <Input
                    value={surveyData.title}
                    onChange={e =>
                        setSurveyData(prev => ({ ...prev, title: e.target.value }))
                    }
                    placeholder='Enter survey title'
                />
            </Form.Item>

            <Form.Item label='Description'>
                <Input.TextArea
                    rows={4}
                    value={surveyData.description}
                    onChange={e =>
                        setSurveyData(prev => ({ ...prev, description: e.target.value }))
                    }
                    placeholder='Explain what this survey is for'
                />
            </Form.Item>

            <Form.Item
                label='Category'
                required
            >
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: 10,
                        width: '100%'
                    }}
                >
                    {SURVEY_CATEGORIES.map(category => {
                        const selected =
                            surveyData.category === category

                        return (
                            <button
                                key={category}
                                type='button'
                                onClick={() =>
                                    setSurveyData(prev => ({
                                        ...prev,
                                        category
                                    }))
                                }
                                style={{
                                    width: '100%',
                                    minHeight: 64,
                                    padding: '12px 14px',
                                    borderRadius: 14,
                                    border: `1px solid ${selected
                                        ? token.colorPrimary
                                        : token.colorBorderSecondary
                                        }`,
                                    background: selected
                                        ? token.colorPrimaryBg
                                        : token.colorBgContainer,
                                    color: selected
                                        ? token.colorPrimary
                                        : token.colorText,
                                    fontWeight: selected
                                        ? 600
                                        : 500,
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    transition:
                                        'all 0.2s ease',
                                    boxShadow: selected
                                        ? `0 4px 14px ${token.colorPrimaryBg}`
                                        : 'none'
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: 10
                                    }}
                                >
                                    <span>
                                        {category}
                                    </span>

                                    <div
                                        style={{
                                            width: 18,
                                            height: 18,
                                            borderRadius: '50%',
                                            border: `2px solid ${selected
                                                ? token.colorPrimary
                                                : token.colorBorder
                                                }`,
                                            background: selected
                                                ? token.colorPrimary
                                                : 'transparent',
                                            boxShadow: selected
                                                ? `inset 0 0 0 4px ${token.colorBgContainer}`
                                                : 'none',
                                            flex: '0 0 auto'
                                        }}
                                    />
                                </div>
                            </button>
                        )
                    })}
                </div>
            </Form.Item>
        </Form>
    )

    const outlineContent = (
        <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId='survey-outline'>
                {provided => (
                    <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                    >
                        {surveyData.fields.length === 0 ? (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description='No questions yet'
                            />
                        ) : (
                            surveyData.fields.map((field, index) => (
                                <Draggable
                                    key={field.id}
                                    draggableId={field.id}
                                    index={index}
                                >
                                    {draggable => (
                                        <div
                                            ref={draggable.innerRef}
                                            {...draggable.draggableProps}
                                            {...draggable.dragHandleProps}
                                            onClick={() =>
                                                setSelectedFieldId(field.id)
                                            }
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                // Tight enough to fit a few more
                                                // questions in view without the
                                                // rows reading as cramped.
                                                padding: '7px 8px',
                                                marginBottom: 3,
                                                borderRadius: 10,
                                                cursor: 'grab',
                                                userSelect: 'none',

                                                background:
                                                    selectedFieldId === field.id
                                                        ? token.colorPrimaryBg
                                                        : 'transparent',

                                                ...draggable.draggableProps.style
                                            }}
                                        >
                                            <Tag
                                                style={{
                                                    flex: '0 0 auto',
                                                    marginInlineEnd: 0,
                                                    borderRadius: 999
                                                }}
                                            >
                                                {index + 1}
                                            </Tag>

                                            <div
                                                style={{
                                                    flex: 1,
                                                    minWidth: 0
                                                }}
                                            >
                                                <Typography.Paragraph
                                                    ellipsis={{
                                                        rows: 2,
                                                        tooltip:
                                                            field.label ||
                                                            'Untitled question'
                                                    }}
                                                    style={{
                                                        margin: 0,
                                                        fontWeight: 500,
                                                        lineHeight: 1.4
                                                    }}
                                                >
                                                    {field.label ||
                                                        'Untitled question'}
                                                </Typography.Paragraph>

                                                <Text
                                                    type='secondary'
                                                    style={{
                                                        display: 'block',
                                                        marginTop: 3,
                                                        fontSize: 12
                                                    }}
                                                >
                                                    {FIELD_TYPES.find(
                                                        type =>
                                                            type.value === field.type
                                                    )?.label || field.type}
                                                </Text>
                                            </div>
                                        </div>
                                    )}
                                </Draggable>
                            ))
                        )}

                        {provided.placeholder}
                    </div>
                )}
            </Droppable>
        </DragDropContext>
    )

    const SurveySettingsModal = (
        <Modal
            title='Survey settings'
            open={surveySettingsOpen}
            onCancel={() => setSurveySettingsOpen(false)}
            centered
            width={520}
            destroyOnClose={false}
            footer={[
                <Button
                    key='done'
                    type='primary'
                    shape='round'
                    onClick={() => setSurveySettingsOpen(false)}
                >
                    Done
                </Button>
            ]}
        >
            {surveySettingsContent}
        </Modal>
    )

    const DesktopOutlinePanel = showDesktopSidePanel ? (
        <div
            style={{
                minWidth: 0,
                alignSelf: 'start'
            }}
        >
            <MotionCard
                size='small'
                title='Outline'
                style={{
                    // Reclaims the page's bottom padding so the list runs as
                    // close to the fold as the layout allows.
                    height: 'calc(100dvh - 196px)',
                    overflow: 'hidden'
                }}
                bodyStyle={{
                    padding: 8,
                    height: 'calc(100dvh - 250px)',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    overscrollBehavior: 'contain'
                }}
                extra={
                    <Button
                        type='text'
                        size='small'
                        shape='circle'
                        style={{ border: `1px solid ${token.colorBorderSecondary}` }}
                        icon={<PlusOutlined />}
                        onClick={() => setAddModalOpen(true)}
                    />
                }
            >
                {outlineContent}
            </MotionCard>
        </div>
    ) : null

    const DesktopRightPanel = showDesktopSidePanel ? (
        <div
            style={{
                minWidth: 0,
                alignSelf: 'start',
                display: 'flex',
                flexDirection: 'column',
                gap: 12
            }}
        >
            {/* SELECTED QUESTION */}
            <MotionCard
                size='small'
                title='Selected question'
                bodyStyle={{
                    padding: 12
                }}
            >
                {selectedField?.prefill ? (
                    <Space
                        direction='vertical'
                        size={10}
                        style={{ width: '100%' }}
                    >
                        <Tag
                            icon={<LockOutlined />}
                            color='blue'
                            style={{ borderRadius: 999 }}
                        >
                            Prefilled question
                        </Tag>

                        <div>
                            <SettingLabel>Answer comes from</SettingLabel>
                            <Text>{PREFILL_LABELS[selectedField.prefill]}</Text>
                        </div>

                        <div>
                            <SettingLabel>Question</SettingLabel>
                            <Text>{selectedField.label}</Text>
                        </div>

                        <Text type='secondary' style={{ fontSize: 12 }}>
                            This question is filled in automatically from the
                            SME’s profile, so there is nothing to configure. They
                            can correct the value for this response; their profile
                            is not changed. Delete the question to remove it.
                        </Text>
                    </Space>
                ) : selectedField ? (
                    <Space
                        direction='vertical'
                        size={10}
                        style={{ width: '100%' }}
                    >
                        <div>
                            <SettingLabel>Question type</SettingLabel>
                            <Select
                                value={selectedField.type}
                                onChange={type =>
                                    changeFieldType(
                                        selectedField.id,
                                        type
                                    )
                                }
                                options={FIELD_TYPES}
                                style={{ width: '100%' }}
                            />
                        </div>

                        {selectedField.type !== 'heading' ? (
                            <div
                                style={{
                                    minHeight: 32,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 10
                                }}
                            >
                                <Text type='secondary'>
                                    Required
                                </Text>

                                <Switch
                                    size='small'
                                    checked={selectedField.required}
                                    onChange={required =>
                                        patchField(
                                            selectedField.id,
                                            { required }
                                        )
                                    }
                                />
                            </div>
                        ) : null}

                        {[
                            'text',
                            'textarea',
                            'number',
                            'email',
                            'select'
                        ].includes(selectedField.type) ? (
                            <div>
                                <SettingLabel>Placeholder</SettingLabel>
                                <Input
                                    size='small'
                                    value={selectedField.placeholder}
                                    onChange={e =>
                                        patchField(
                                            selectedField.id,
                                            {
                                                placeholder:
                                                    e.target.value
                                            }
                                        )
                                    }
                                    placeholder='Hint inside the empty box'
                                />
                            </div>
                        ) : null}

                        <div>
                            <SettingLabel>Helper text</SettingLabel>
                            <Input.TextArea
                                size='small'
                                autoSize={{
                                    minRows: 1,
                                    maxRows: 2
                                }}
                                value={selectedField.description}
                                onChange={e =>
                                    patchField(
                                        selectedField.id,
                                        {
                                            description:
                                                e.target.value
                                        }
                                    )
                                }
                                placeholder='Guidance shown under the question'
                            />
                        </div>
                    </Space>
                ) : (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description='No question selected'
                    />
                )}
            </MotionCard>

            {/* FORM SNAPSHOT */}
            <MotionCard
                size='small'
                title='Form snapshot'
                bodyStyle={{ padding: 12 }}
            >
                <Space
                    direction='vertical'
                    size={8}
                    style={{ width: '100%' }}
                >
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 10
                        }}
                    >
                        <Text type='secondary'>
                            Questions
                        </Text>

                        <Text strong>
                            {surveyData.fields.length}
                        </Text>
                    </div>

                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 10
                        }}
                    >
                        <Text type='secondary'>
                            Required
                        </Text>

                        <Text strong>
                            {
                                surveyData.fields.filter(
                                    field => field.required
                                ).length
                            }
                        </Text>
                    </div>

                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 10
                        }}
                    >
                        <Text type='secondary'>
                            Status
                        </Text>

                        <Tag
                            color={
                                surveyData.status === 'published'
                                    ? 'green'
                                    : 'default'
                            }
                            style={{
                                marginInlineEnd: 0
                            }}
                        >
                            {surveyData.status === 'published'
                                ? 'Published'
                                : 'Draft'}
                        </Tag>
                    </div>

                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 10
                        }}
                    >
                        <Text type='secondary'>
                            Changes
                        </Text>

                        <Tag
                            color={
                                isDirty
                                    ? 'orange'
                                    : 'green'
                            }
                            style={{
                                marginInlineEnd: 0
                            }}
                        >
                            {isDirty
                                ? 'Unsaved'
                                : 'Saved'}
                        </Tag>
                    </div>
                </Space>
            </MotionCard>
        </div>
    ) : null

    // ---------- Layout ----------
    if (loadingTemplate) {
        return (
            <div style={{ display: 'grid', placeItems: 'center', minHeight: 320 }}>
                <Spin />
            </div>
        )
    }

    return (
        <div
            style={{
                flex: '1 1 auto',
                minHeight: 0,
                width: '100%',
                padding: isMobile
                    ? '0 12px 16px'
                    : '0 24px 20px'
            }}
        >
            {/* Header Section */}
            <MotionCard
                size='small'
                style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                    marginBottom: 14,
                    background: token.colorBgContainer
                }}
                styles={{
                    body: {
                        padding: isMobile ? '8px 10px' : '10px 14px'
                    }
                }}
            >
                <div
                    style={{
                        position: 'relative',
                        minHeight: isMobile ? 44 : 46,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12
                    }}
                >
                    {/* LEFT */}
                    <Space
                        size={8}
                        wrap={false}
                        style={{
                            position: 'relative',
                            zIndex: 2,
                            flex: '0 0 auto'
                        }}
                    >
                        <Button
                            shape='round'
                            icon={<ArrowLeftOutlined />}
                            onClick={handleBack}
                        >
                            Back
                        </Button>

                        <Button
                            shape='round'
                            icon={<FileSearchOutlined />}
                            onClick={() =>
                                setImportModalOpen(true)
                            }
                        >
                            Import
                        </Button>

                        <Button
                            type='primary'
                            shape='round'
                            icon={<PlusOutlined />}
                            onClick={() =>
                                setAddModalOpen(true)
                            }
                        >
                            Add Question
                        </Button>
                    </Space>

                    {/* CENTER */}
                    <div
                        style={{
                            position: 'absolute',
                            left: '50%',
                            top: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: isMobile
                                ? 'calc(100% - 310px)'
                                : 'min(520px, 38vw)',
                            minWidth: 0,
                            textAlign: 'center',
                            zIndex: 1
                        }}
                    >
                        <Tooltip title='Edit survey settings'>
                            <button
                                type='button'
                                onClick={() => setSurveySettingsOpen(true)}
                                style={{
                                    width: '100%',
                                    padding: 0,
                                    margin: 0,
                                    border: 0,
                                    background: 'transparent',
                                    color: 'inherit',
                                    cursor: 'pointer',
                                    textAlign: 'center'
                                }}
                            >
                                <Title
                                    level={4}
                                    ellipsis={{
                                        tooltip: surveyTitle
                                    }}
                                    style={{
                                        margin: 0,
                                        fontSize: isMobile ? 17 : 20,
                                        lineHeight: 1.2
                                    }}
                                >
                                    {surveyTitle}
                                </Title>

                                {surveyData.description ? (
                                    <Text
                                        type='secondary'
                                        ellipsis={{
                                            tooltip: surveyData.description
                                        }}
                                        style={{
                                            display: 'block',
                                            marginTop: 2,
                                            fontSize: 12,
                                            lineHeight: 1.25
                                        }}
                                    >
                                        {surveyData.description}
                                    </Text>
                                ) : (
                                    <Text
                                        type='secondary'
                                        style={{
                                            display: 'block',
                                            marginTop: 2,
                                            fontSize: 12,
                                            lineHeight: 1.25
                                        }}
                                    >
                                        Click to add a description
                                    </Text>
                                )}
                            </button>
                        </Tooltip>
                    </div>

                    {/* RIGHT */}
                    <Space
                        size={8}
                        wrap={false}
                        style={{
                            position: 'relative',
                            zIndex: 2,
                            flex: '0 0 auto',
                            marginLeft: 'auto'
                        }}
                    >
                        {hasQuestions ? (
                            <Button
                                shape='round'
                                icon={<EyeOutlined />}
                                onClick={() =>
                                    setIsPreviewVisible(true)
                                }
                            >
                                Preview
                            </Button>
                        ) : null}

                        <Button
                            shape='round'
                            icon={<SaveOutlined />}
                            loading={savingTemplate}
                            onClick={() =>
                                saveTemplate('draft')
                            }
                        >
                            Save Draft
                        </Button>

                        <Button
                            type='primary'
                            shape='round'
                            icon={<SendOutlined />}
                            loading={savingTemplate}
                            onClick={publishSurvey}
                        >
                            Publish
                        </Button>
                    </Space>
                </div>
            </MotionCard>

            <div
                style={{
                    width: '100%',
                    maxWidth: showDesktopSidePanel ? 1500 : 980,
                    margin: '0 auto',
                    display: 'grid',
                    gridTemplateColumns: showDesktopSidePanel
                        ? '220px minmax(0, 1fr) 270px'
                        : '1fr',
                    gap: 14,
                    alignItems: 'start'
                }}
            >
                {DesktopOutlinePanel}

                <div
                    style={{
                        minWidth: 0,
                        alignSelf: 'start'
                    }}
                >
                    {selectedField ? (
                        <FieldCard
                            field={selectedField}
                            number={selectedFieldIndex + 1}
                            onPatch={patchField}
                            onDuplicate={duplicateField}
                            onDelete={removeField}
                        />
                    ) : (
                        <MotionCard
                            size='small'
                            bodyStyle={{
                                padding: 36,
                                textAlign: 'center'
                            }}
                        >
                            {surveyData.fields.length === 0 ? (
                                <>
                                    <Title level={4}>
                                        Start building your survey
                                    </Title>

                                    <Text type='secondary'>
                                        Add your first question or import an
                                        existing questionnaire.
                                    </Text>

                                    <div style={{ marginTop: 18 }}>
                                        <Space wrap>
                                            <Button
                                                type='primary'
                                                shape='round'
                                                icon={<PlusOutlined />}
                                                onClick={() =>
                                                    setAddModalOpen(true)
                                                }
                                            >
                                                Add question
                                            </Button>

                                            <Button
                                                shape='round'
                                                icon={<FileSearchOutlined />}
                                                onClick={() =>
                                                    setImportModalOpen(true)
                                                }
                                            >
                                                Import
                                            </Button>
                                        </Space>
                                    </div>
                                </>
                            ) : (
                                <Empty
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    description='Select a question from the outline'
                                />
                            )}
                        </MotionCard>
                    )}
                </div>

                {DesktopRightPanel}
            </div>

            {isMobile ? (
                <Drawer
                    title='Form outline'
                    open={outlineOpen}
                    onClose={() => setOutlineOpen(false)}
                    placement='bottom'
                    height='75vh'
                    destroyOnClose={false}
                    extra={
                        <Button
                            size='small'
                            icon={<PlusOutlined />}
                            onClick={() => setAddModalOpen(true)}
                        >
                            Add
                        </Button>
                    }
                >
                    {outlineContent}
                </Drawer>
            ) : null}

            <AddFieldModal
                open={addModalOpen}
                onClose={() => setAddModalOpen(false)}
                onAdd={(type, label) => {
                    addField(type, label)
                    setAddModalOpen(false)
                }}
                onAddSection={section => {
                    addPrefillSection(section)
                    setAddModalOpen(false)
                }}
            />
            <ImportQuestionsModal
                open={importModalOpen}
                onClose={() => setImportModalOpen(false)}
                category={surveyData.category}
                hasExistingFields={surveyData.fields.length > 0}
                onImport={importFields}
            />

            <PreviewSurveyModal
                open={isPreviewVisible}
                title={surveyTitle}
                description={surveyData.description}
                fields={surveyData.fields}
                onClose={() => setIsPreviewVisible(false)}
            />

            {SurveySettingsModal}

            <FloatButton.BackTop
                visibilityHeight={320}
                tooltip='Back to top'
                style={{ right: 24, bottom: 24 }}
            />
        </div>
    )
}
