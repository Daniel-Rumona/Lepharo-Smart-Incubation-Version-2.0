import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Modal,
    Form,
    Input,
    Select,
    Button,
    message,
    Row,
    Col,
    Divider,
    Typography,
    List,
    Space,
    Steps,
    Empty,
    Tag,
    type FormInstance
} from 'antd'
import {
    Timestamp,
    setDoc,
    doc,
    getDocs,
    query,
    collection,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import dayjs, { type Dayjs } from 'dayjs'
import {
    DeleteOutlined,
    LeftOutlined,
    RightOutlined,
    CalendarOutlined,
    TeamOutlined,
    ClearOutlined,
    UsergroupAddOutlined
} from '@ant-design/icons'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import AppointmentDateTimeFields from '../appointments/AppointmentDateTimeFields'

const { Option } = Select
const { Text } = Typography

type ParticipantType =
    | 'incubatee'
    | 'coordinator'
    | 'operations'

type ParticipantFilter =
    | ''
    | 'incubatee'
    | 'coordinator'
    | 'hod'

type Participant = {
    id: string
    type: ParticipantType

    name: string
    email: string

    beneficiaryName?: string

    visibleType?: 'hod'

    programId?: string

    department?: string
    departmentId?: string
    departmentName?: string
}

type SelectedParticipant = {
    id: string
    type: ParticipantType

    name: string
    beneficiaryName?: string
    email: string

    confirmationStatus: 'pending' | 'confirmed' | 'declined'
}

type EventFormValues = {
    title?: string
    eventType?: string
    format?: string
    location?: string
    link?: string
    description?: string
    startsAt?: Dayjs | null
    endsAt?: Dayjs | null
}

type CreatedEvent = {
    id: string
    title: string
    date: string
    startTime: string
    endTime: string

    type: string
    format: string

    location: string
    link: string
    description: string

    participants: SelectedParticipant[]

    programId: string
    departmentId: string

    createdAt: Timestamp
    createdBy: string
    createdById: string
}

type GlobalEventModalProps = {
    open: boolean
    onCancel: () => void
    onSuccess?: (event: CreatedEvent) => void
    form: FormInstance
}

const getParticipantDisplayName = (
    participant: Participant | SelectedParticipant
) => {
    if (participant.type === 'incubatee') {
        return (
            participant.beneficiaryName ||
            participant.name ||
            'Unnamed Company'
        )
    }

    return (
        participant.name ||
        participant.email ||
        'Unnamed Participant'
    )
}

const toSelectedParticipant = (
    participant: Participant
): SelectedParticipant => ({
    id: participant.id,
    email: participant.email,
    name: participant.name || '',
    beneficiaryName:
        participant.type === 'incubatee'
            ? participant.beneficiaryName ||
            participant.name ||
            ''
            : undefined,
    type: participant.type,
    confirmationStatus: 'pending'
})

export const GlobalEventModal = ({
    open,
    onCancel,
    onSuccess,
    form
}: GlobalEventModalProps) => {
    const [format, setFormat] = useState('')
    const [
        selectedParticipants,
        setSelectedParticipants
    ] = useState<SelectedParticipant[]>([])

    const [typeFilter, setTypeFilter] =
        useState<ParticipantFilter>('')

    const [searchText, setSearchText] = useState('')
    const [participants, setParticipants] =
        useState<Participant[]>([])

    const [currentStep, setCurrentStep] = useState(0)
    const [loading, setLoading] = useState(false)

    const [currentDepartmentIsMain, setCurrentDepartmentIsMain] =
        useState(false)

    const { user } = useFullIdentity()

    const {
        activeProgramId,
        isAllPrograms
    } = useActiveProgramId()

    const watchedEventType = Form.useWatch(
        'eventType',
        form
    )

    const isWebinar = watchedEventType === 'webinar'

    const resetState = useCallback(() => {
        setFormat('')
        setSelectedParticipants([])
        setTypeFilter('')
        setSearchText('')
        setCurrentStep(0)
        setCurrentDepartmentIsMain(false)

        form.resetFields()
    }, [form])

    useEffect(() => {
        if (!open) return

        resetState()
    }, [open, resetState])

    useEffect(() => {
        if (!open) return

        const fetchParticipants = async () => {
            try {
                setLoading(true)

                /*
                 * Beneficiaries now come from participants,
                 * not applications.
                 *
                 * There is intentionally NO applicationStatus
                 * filtering anywhere in this modal.
                 */
                const participantsQuery =
                    activeProgramId && !isAllPrograms
                        ? query(
                            collection(db, 'participants'),
                            where(
                                'programId',
                                '==',
                                activeProgramId
                            )
                        )
                        : query(
                            collection(db, 'participants')
                        )

                const [
                    participantsSnap,
                    coordinatorsSnap,
                    usersSnap,
                    departmentsSnap
                ] = await Promise.all([
                    getDocs(participantsQuery),

                    getDocs(
                        query(
                            collection(db, 'coordinators')
                        )
                    ),

                    getDocs(
                        query(
                            collection(db, 'users'),
                            where(
                                'role',
                                '==',
                                'operations'
                            )
                        )
                    ),

                    getDocs(
                        query(
                            collection(db, 'departments')
                        )
                    )
                ])

                const departmentMap: Record<string, string> =
                    Object.fromEntries(
                        departmentsSnap.docs.map(
                            departmentDoc => [
                                departmentDoc.id,
                                String(
                                    departmentDoc.data()?.name ||
                                    ''
                                )
                            ]
                        )
                    )

                const currentDeptDoc =
                    departmentsSnap.docs.find(
                        departmentDoc =>
                            departmentDoc.id ===
                            user?.departmentId
                    )

                const userDeptData =
                    currentDeptDoc?.data()

                const userIsMainDept =
                    Boolean(userDeptData?.isMain)

                setCurrentDepartmentIsMain(
                    userIsMainDept
                )

                /*
                 * Actual beneficiaries / incubatees.
                 */
                const incubatees: Participant[] =
                    participantsSnap.docs.map(
                        participantDoc => {
                            const data =
                                participantDoc.data()

                            const beneficiaryName =
                                data.beneficiaryName ||
                                data.companyName ||
                                data.businessName ||
                                data.participantName ||
                                data.name ||
                                'Unnamed Company'

                            return {
                                id: participantDoc.id,
                                type: 'incubatee',
                                name: beneficiaryName,
                                beneficiaryName,
                                email:
                                    data.email ||
                                    data.participantEmail ||
                                    data.contactEmail ||
                                    '',
                                programId:
                                    data.programId || ''
                            }
                        }
                    )

                /*
                 * Coordinators belonging to the current
                 * user's department.
                 */
                const coordinators: Participant[] =
                    coordinatorsSnap.docs
                        .map(coordinatorDoc => {
                            const data =
                                coordinatorDoc.data()

                            return {
                                id: coordinatorDoc.id,
                                type: 'coordinator',
                                name:
                                    data.name ||
                                    data.fullName ||
                                    '',
                                email:
                                    data.email || '',
                                department:
                                    data.department || '',
                                departmentId:
                                    data.departmentId || '',
                                departmentName:
                                    departmentMap[
                                    data.departmentId
                                    ] || ''
                            }
                        })
                        .filter(coordinator => {
                            if (!user?.departmentId) {
                                return false
                            }

                            return (
                                coordinator.departmentId ===
                                user.departmentId
                            )
                        })

                /*
                 * HODs are operations users.
                 * Only a main department may invite them.
                 */
                const hods: Participant[] =
                    userIsMainDept
                        ? usersSnap.docs
                            .filter(userDoc => {
                                const data =
                                    userDoc.data()

                                return Boolean(
                                    data.department ||
                                    data.departmentId
                                )
                            })
                            .map(userDoc => {
                                const data =
                                    userDoc.data()

                                return {
                                    id: userDoc.id,
                                    type: 'operations',
                                    visibleType: 'hod',
                                    name:
                                        data.name ||
                                        data.fullName ||
                                        '',
                                    email:
                                        data.email || '',
                                    department:
                                        data.department ||
                                        '',
                                    departmentId:
                                        data.departmentId ||
                                        '',
                                    departmentName:
                                        departmentMap[
                                        data.departmentId
                                        ] || ''
                                }
                            })
                        : []

                setParticipants([
                    ...incubatees,
                    ...coordinators,
                    ...hods
                ])
            } catch (error) {
                console.error(
                    'Error loading participants:',
                    error
                )

                setParticipants([])

                message.error(
                    'Failed to load participant list'
                )
            } finally {
                setLoading(false)
            }
        }

        fetchParticipants()
    }, [
        open,
        activeProgramId,
        isAllPrograms,
        user?.departmentId
    ])

    /*
     * Webinar attendees can only be incubatees.
     */
    useEffect(() => {
        if (!isWebinar) return

        setTypeFilter('incubatee')

        setSelectedParticipants(previous =>
            previous.filter(
                participant =>
                    participant.type === 'incubatee'
            )
        )
    }, [isWebinar])

    const filteredParticipants =
        useMemo(() => {
            const queryText =
                searchText.trim().toLowerCase()

            return participants.filter(
                participant => {
                    const displayName =
                        getParticipantDisplayName(
                            participant
                        ).toLowerCase()

                    const matchesSearch =
                        !queryText ||
                        displayName.includes(queryText) ||
                        participant.email
                            ?.toLowerCase()
                            .includes(queryText) ||
                        participant.departmentName
                            ?.toLowerCase()
                            .includes(queryText)

                    const isIncubatee =
                        typeFilter === 'incubatee' &&
                        participant.type ===
                        'incubatee'

                    const isCoordinator =
                        !isWebinar &&
                        typeFilter ===
                        'coordinator' &&
                        participant.type ===
                        'coordinator' &&
                        participant.departmentId ===
                        user?.departmentId

                    const isHOD =
                        !isWebinar &&
                        currentDepartmentIsMain &&
                        typeFilter === 'hod' &&
                        participant.visibleType ===
                        'hod'

                    const noTypeFilter =
                        !typeFilter

                    return (
                        matchesSearch &&
                        (
                            isIncubatee ||
                            isCoordinator ||
                            isHOD ||
                            noTypeFilter
                        )
                    )
                }
            )
        }, [
            participants,
            typeFilter,
            searchText,
            isWebinar,
            currentDepartmentIsMain,
            user?.departmentId
        ])

    const addParticipant = (
        participant: Participant
    ) => {
        setSelectedParticipants(previous =>
            previous.some(
                selected =>
                    selected.id === participant.id
            )
                ? previous
                : [
                    ...previous,
                    toSelectedParticipant(
                        participant
                    )
                ]
        )
    }

    const addAllFiltered = () => {
        const toAdd =
            filteredParticipants.filter(
                participant =>
                    !selectedParticipants.some(
                        selected =>
                            selected.id ===
                            participant.id
                    )
            )

        if (toAdd.length === 0) {
            message.info(
                'All matching participants are already selected'
            )
            return
        }

        setSelectedParticipants(previous => [
            ...previous,
            ...toAdd.map(
                toSelectedParticipant
            )
        ])
    }

    const addAllIncubatees = () => {
        const incubatees =
            participants.filter(
                participant =>
                    participant.type ===
                    'incubatee'
            )

        const toAdd =
            incubatees.filter(
                participant =>
                    !selectedParticipants.some(
                        selected =>
                            selected.id ===
                            participant.id
                    )
            )

        if (toAdd.length === 0) {
            message.info(
                'All incubatees are already selected'
            )
            return
        }

        setSelectedParticipants(previous => [
            ...previous,
            ...toAdd.map(
                toSelectedParticipant
            )
        ])
    }

    const clearSelected = () => {
        setSelectedParticipants([])
    }

    const stepFields: string[][] = [
        [
            'title',
            'eventType',
            'format',
            ...(format === 'in-person'
                ? ['location']
                : []),
            ...(format === 'virtual'
                ? ['link']
                : [])
        ],

        ['startsAt', 'endsAt'],

        []
    ]

    const next = async () => {
        try {
            await form.validateFields(
                stepFields[currentStep]
            )

            setCurrentStep(step => step + 1)
        } catch {
            // Ant Design displays field validation.
        }
    }

    const prev = () => {
        setCurrentStep(step =>
            Math.max(0, step - 1)
        )
    }

    const handleSubmit = async () => {
        try {
            const values =
                (await form.validateFields([
                    'title',
                    'eventType',
                    'format',
                    ...(format === 'in-person'
                        ? ['location']
                        : []),
                    ...(format === 'virtual'
                        ? ['link']
                        : []),
                    'description',
                    'startsAt',
                    'endsAt'
                ])) as EventFormValues

            const startsAt =
                dayjs(values.startsAt)

            const endsAt =
                dayjs(values.endsAt)

            if (
                !startsAt.isValid() ||
                !endsAt.isValid()
            ) {
                message.error(
                    'Please select a valid date and time'
                )
                return
            }

            if (!endsAt.isAfter(startsAt)) {
                message.error(
                    'The event end time must be after the start time'
                )
                return
            }

            if (
                !endsAt.isSame(startsAt, 'day')
            ) {
                message.error(
                    'The event must start and end on the same day'
                )
                return
            }

            const eventDate =
                startsAt.format('YYYY-MM-DD')

            const startTime =
                startsAt.format('HH:mm')

            const endTime =
                endsAt.format('HH:mm')

            const newId =
                `event-${Date.now()}`

            const newEvent: CreatedEvent = {
                id: newId,

                title:
                    values.title?.trim() || '',

                date: eventDate,
                startTime,
                endTime,

                type:
                    values.eventType || 'event',

                format:
                    values.format || '',

                location:
                    values.location?.trim() || '',

                link:
                    values.link?.trim() || '',

                description:
                    values.description?.trim() ||
                    '',

                participants:
                    selectedParticipants,

                programId:
                    activeProgramId || '',

                departmentId:
                    user?.departmentId || '',

                createdAt:
                    Timestamp.now(),

                createdBy:
                    user?.email || '',

                createdById:
                    user?.id || ''
            }

            await setDoc(
                doc(
                    db,
                    'events',
                    newId
                ),
                newEvent
            )

            message.success(
                'Event added successfully'
            )

            resetState()
            onCancel()

            onSuccess?.(newEvent)
        } catch (error: any) {
            /*
             * validateFields rejection contains
             * errorFields. Those are already displayed
             * by the Ant Design form.
             */
            if (
                Array.isArray(
                    error?.errorFields
                )
            ) {
                return
            }

            console.error(
                'Error adding event:',
                error
            )

            message.error(
                'Failed to add event'
            )
        }
    }

    const incubateeCount =
        useMemo(
            () =>
                participants.filter(
                    participant =>
                        participant.type ===
                        'incubatee'
                ).length,
            [participants]
        )

    return (
        <Modal
            centered
            open={open}
            title='Create New Event'
            onCancel={() => {
                resetState()
                onCancel()
            }}
            footer={null}
            width={720}
            destroyOnClose
            maskClosable={false}
        >
            <Steps
                current={currentStep}
                size='small'
                responsive
                style={{
                    marginBottom: 16
                }}
                items={[
                    {
                        title: 'Details'
                    },
                    {
                        title: 'Schedule'
                    },
                    {
                        title: 'Participants'
                    }
                ]}
            />

            <Form
                layout='vertical'
                form={form}
                preserve
                onKeyDown={event => {
                    /*
                     * Prevent accidental form
                     * submission while navigating
                     * the wizard.
                     */
                    if (
                        event.key === 'Enter'
                    ) {
                        event.preventDefault()
                    }
                }}
            >
                {/* STEP 0: DETAILS */}
                <div
                    style={{
                        display:
                            currentStep === 0
                                ? 'block'
                                : 'none'
                    }}
                >
                    <Row gutter={[12, 12]}>
                        <Col span={24}>
                            <Form.Item
                                name='title'
                                label='Event Title'
                                rules={[
                                    {
                                        required: true,
                                        message:
                                            'Please enter a title'
                                    }
                                ]}
                            >
                                <Input
                                    placeholder='e.g. Business Workshop'
                                    maxLength={150}
                                />
                            </Form.Item>
                        </Col>

                        <Col
                            xs={24}
                            sm={12}
                        >
                            <Form.Item
                                name='eventType'
                                label='Event Type'
                                rules={[
                                    {
                                        required: true,
                                        message:
                                            'Please select a type'
                                    }
                                ]}
                            >
                                <Select
                                    placeholder='Select type'
                                >
                                    <Option value='event'>
                                        Event
                                    </Option>

                                    <Option value='webinar'>
                                        Webinar
                                    </Option>

                                    <Option value='meeting'>
                                        Meeting
                                    </Option>

                                    <Option value='workshop'>
                                        Workshop
                                    </Option>
                                </Select>
                            </Form.Item>
                        </Col>

                        <Col
                            xs={24}
                            sm={12}
                        >
                            <Form.Item
                                name='format'
                                label='Format'
                                preserve
                                rules={[
                                    {
                                        required: true,
                                        message:
                                            'Please select format'
                                    }
                                ]}
                            >
                                <Select
                                    placeholder='In-person or Virtual'
                                    onChange={(
                                        value: string
                                    ) => {
                                        setFormat(
                                            value
                                        )

                                        if (
                                            value ===
                                            'in-person'
                                        ) {
                                            form.setFieldsValue(
                                                {
                                                    link: undefined
                                                }
                                            )
                                        }

                                        if (
                                            value ===
                                            'virtual'
                                        ) {
                                            form.setFieldsValue(
                                                {
                                                    location:
                                                        undefined
                                                }
                                            )
                                        }
                                    }}
                                >
                                    <Option value='in-person'>
                                        In-Person
                                    </Option>

                                    <Option value='virtual'>
                                        Virtual
                                    </Option>
                                </Select>
                            </Form.Item>
                        </Col>

                        {format ===
                            'in-person' && (
                                <Col span={24}>
                                    <Form.Item
                                        name='location'
                                        label='Location'
                                        rules={[
                                            {
                                                required:
                                                    true,
                                                message:
                                                    'Please enter a location'
                                            }
                                        ]}
                                    >
                                        <Input
                                            placeholder='Venue address'
                                            maxLength={
                                                250
                                            }
                                        />
                                    </Form.Item>
                                </Col>
                            )}

                        {format ===
                            'virtual' && (
                                <Col span={24}>
                                    <Form.Item
                                        name='link'
                                        label='Meeting Link'
                                        preserve
                                        rules={[
                                            {
                                                required:
                                                    true,
                                                message:
                                                    'Please provide a meeting link'
                                            },
                                            {
                                                type: 'url',
                                                message:
                                                    'Please enter a valid meeting link'
                                            }
                                        ]}
                                    >
                                        <Input placeholder='Zoom/Teams link' />
                                    </Form.Item>
                                </Col>
                            )}

                        <Col span={24}>
                            <Form.Item
                                name='description'
                                label='Description (optional)'
                            >
                                <Input.TextArea
                                    rows={3}
                                    maxLength={
                                        1500
                                    }
                                    showCount
                                    placeholder='Event overview or agenda'
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                </div>

                {/* STEP 1: SCHEDULE */}
                <div
                    style={{
                        display:
                            currentStep === 1
                                ? 'block'
                                : 'none'
                    }}
                >
                    <AppointmentDateTimeFields
                        form={form}
                    />
                </div>

                {/* STEP 2: PARTICIPANTS */}
                <div
                    style={{
                        display:
                            currentStep === 2
                                ? 'block'
                                : 'none'
                    }}
                >
                    <Row gutter={[12, 12]}>
                        <Col span={24}>
                            <Text strong>
                                Filter Participants
                            </Text>
                        </Col>

                        <Col
                            xs={24}
                            sm={10}
                        >
                            <Select
                                placeholder='Select participant type'
                                onChange={(
                                    value:
                                        | ParticipantFilter
                                        | undefined
                                ) =>
                                    setTypeFilter(
                                        value || ''
                                    )
                                }
                                allowClear={
                                    !isWebinar
                                }
                                disabled={
                                    isWebinar
                                }
                                style={{
                                    width: '100%'
                                }}
                                value={
                                    isWebinar
                                        ? 'incubatee'
                                        : typeFilter ||
                                        undefined
                                }
                            >
                                <Option value='incubatee'>
                                    Incubatees
                                </Option>

                                {!isWebinar && (
                                    <Option value='coordinator'>
                                        Coordinators
                                    </Option>
                                )}

                                {!isWebinar &&
                                    currentDepartmentIsMain && (
                                        <Option value='hod'>
                                            Heads of
                                            Departments
                                        </Option>
                                    )}
                            </Select>
                        </Col>

                        <Col
                            xs={24}
                            sm={14}
                        >
                            <Select
                                showSearch
                                placeholder='Search & add participant...'
                                style={{
                                    width: '100%'
                                }}
                                filterOption={
                                    false
                                }
                                searchValue={
                                    searchText
                                }
                                onSearch={
                                    setSearchText
                                }
                                onChange={value => {
                                    const participant =
                                        participants.find(
                                            item =>
                                                item.id ===
                                                value
                                        )

                                    if (
                                        participant
                                    ) {
                                        addParticipant(
                                            participant
                                        )
                                    }

                                    setSearchText(
                                        ''
                                    )
                                }}
                                options={filteredParticipants.map(
                                    participant => ({
                                        value:
                                            participant.id,
                                        label:
                                            getParticipantDisplayName(
                                                participant
                                            )
                                    })
                                )}
                                loading={
                                    loading
                                }
                                allowClear
                                notFoundContent={
                                    loading
                                        ? 'Loading participants...'
                                        : 'No participants found'
                                }
                            />
                        </Col>

                        <Col span={24}>
                            <Space wrap>
                                {typeFilter ===
                                    'incubatee' ? (
                                    <Button
                                        icon={
                                            <TeamOutlined />
                                        }
                                        type='primary'
                                        onClick={
                                            addAllIncubatees
                                        }
                                        disabled={
                                            incubateeCount ===
                                            0
                                        }
                                    >
                                        Select All
                                        Incubatees (
                                        {
                                            incubateeCount
                                        }
                                        )
                                    </Button>
                                ) : (
                                    <Button
                                        icon={
                                            <UsergroupAddOutlined />
                                        }
                                        onClick={
                                            addAllFiltered
                                        }
                                        disabled={
                                            !typeFilter ||
                                            filteredParticipants.length ===
                                            0
                                        }
                                    >
                                        Select All{' '}
                                        {typeFilter ===
                                            'coordinator'
                                            ? 'Coordinators'
                                            : typeFilter ===
                                                'hod'
                                                ? 'Heads of Departments'
                                                : 'Filtered'}

                                        {typeFilter
                                            ? ` (${filteredParticipants.length})`
                                            : ''}
                                    </Button>
                                )}

                                <Button
                                    icon={
                                        <ClearOutlined />
                                    }
                                    onClick={
                                        clearSelected
                                    }
                                    disabled={
                                        selectedParticipants.length ===
                                        0
                                    }
                                >
                                    Clear Selected
                                </Button>
                            </Space>
                        </Col>
                    </Row>

                    <Divider
                        style={{
                            margin:
                                '12px 0'
                        }}
                    />

                    <div
                        style={{
                            display: 'flex',
                            alignItems:
                                'center',
                            justifyContent:
                                'space-between',
                            gap: 12,
                            marginBottom: 8
                        }}
                    >
                        <Text type='secondary'>
                            Selected
                            Participants
                        </Text>

                        {selectedParticipants.length >
                            0 && (
                                <Tag
                                    color='blue'
                                    style={{
                                        marginInlineEnd:
                                            0,
                                        borderRadius:
                                            999
                                    }}
                                >
                                    {
                                        selectedParticipants.length
                                    }{' '}
                                    selected
                                </Tag>
                            )}
                    </div>

                    {selectedParticipants.length ===
                        0 ? (
                        <Empty
                            image={
                                Empty.PRESENTED_IMAGE_SIMPLE
                            }
                            description='No participants selected'
                        />
                    ) : (
                        <List<SelectedParticipant>
                            size='small'
                            bordered
                            dataSource={
                                selectedParticipants
                            }
                            rowKey='id'
                            renderItem={item => {
                                const displayName =
                                    getParticipantDisplayName(
                                        item
                                    )

                                return (
                                    <List.Item
                                        actions={[
                                            <Button
                                                key='remove'
                                                type='text'
                                                size='small'
                                                danger
                                                icon={
                                                    <DeleteOutlined />
                                                }
                                                onClick={() =>
                                                    setSelectedParticipants(
                                                        previous =>
                                                            previous.filter(
                                                                participant =>
                                                                    participant.id !==
                                                                    item.id
                                                            )
                                                    )
                                                }
                                            />
                                        ]}
                                    >
                                        <div
                                            style={{
                                                display:
                                                    'flex',
                                                flexDirection:
                                                    'column',
                                                gap: 5,
                                                minWidth:
                                                    0
                                            }}
                                        >
                                            <Text
                                                strong
                                                ellipsis={{
                                                    tooltip:
                                                        displayName
                                                }}
                                            >
                                                {
                                                    displayName
                                                }
                                            </Text>

                                            <Space
                                                size={[
                                                    6,
                                                    6
                                                ]}
                                                wrap
                                            >
                                                {item.email ? (
                                                    <Tag
                                                        style={{
                                                            marginInlineEnd:
                                                                0,
                                                            borderRadius:
                                                                999
                                                        }}
                                                    >
                                                        {
                                                            item.email
                                                        }
                                                    </Tag>
                                                ) : (
                                                    <Tag>
                                                        No
                                                        email
                                                    </Tag>
                                                )}

                                                <Tag
                                                    color={
                                                        item.type ===
                                                            'incubatee'
                                                            ? 'geekblue'
                                                            : item.type ===
                                                                'coordinator'
                                                                ? 'blue'
                                                                : 'purple'
                                                    }
                                                    style={{
                                                        marginInlineEnd:
                                                            0,
                                                        borderRadius:
                                                            999
                                                    }}
                                                >
                                                    {item.type ===
                                                        'incubatee'
                                                        ? 'Incubatee'
                                                        : item.type ===
                                                            'coordinator'
                                                            ? 'Coordinator'
                                                            : 'Head of Department'}
                                                </Tag>
                                            </Space>
                                        </div>
                                    </List.Item>
                                )
                            }}
                            style={{
                                maxHeight: 260,
                                overflowY:
                                    'auto'
                            }}
                        />
                    )}
                </div>

                {/* FOOTER */}
                <Divider />

                <Row gutter={[8, 8]}>
                    {currentStep >
                        0 && (
                            <Col
                                xs={24}
                                sm={12}
                            >
                                <Button
                                    block
                                    size='large'
                                    icon={
                                        <LeftOutlined />
                                    }
                                    onClick={
                                        prev
                                    }
                                >
                                    Previous
                                </Button>
                            </Col>
                        )}

                    <Col
                        xs={24}
                        sm={
                            currentStep >
                                0
                                ? 12
                                : 24
                        }
                    >
                        {currentStep <
                            2 ? (
                            <Button
                                type='primary'
                                block
                                size='large'
                                htmlType='button'
                                icon={
                                    <RightOutlined />
                                }
                                onClick={
                                    next
                                }
                            >
                                Next
                            </Button>
                        ) : (
                            <Button
                                type='primary'
                                block
                                size='large'
                                htmlType='button'
                                icon={
                                    <CalendarOutlined />
                                }
                                loading={
                                    loading
                                }
                                onClick={
                                    handleSubmit
                                }
                            >
                                Create Event
                            </Button>
                        )}
                    </Col>
                </Row>
            </Form>
        </Modal>
    )
}
