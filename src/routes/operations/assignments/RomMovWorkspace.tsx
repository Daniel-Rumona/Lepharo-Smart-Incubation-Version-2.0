import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Checkbox,
    DatePicker,
    Descriptions,
    Empty,
    Form,
    Input,
    Modal,
    Select,
    Space,
    Table,
    Tag,
    Typography,
    Upload,
    message
} from 'antd'
import { FileAddOutlined, UploadOutlined } from '@ant-design/icons'
import {
    collection,
    doc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    Timestamp,
    where
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import dayjs from 'dayjs'
import { db, storage } from '@/firebase'
import { PreIncubationContractModal } from '@/components/modals/Contracts/PreIncubationContract'

const { Text, Title } = Typography

type Props = {
    user: any
    department: any
    activeProgramId?: string | null
}

type WorkspaceRow = {
    id: string
    applicationId: string
    participantId: string
    beneficiaryName: string
    participantName: string
    programId: string
    programName: string
    branchId?: string
    branchName?: string
    application: any
    participant: any
    movs: any[]
}

const normalize = (value: any) => String(value ?? '').trim().toLowerCase()
const cleanIdPart = (value: any) => String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180)
const interventionTitle = (intervention: any) =>
    String(intervention?.interventionTitle || intervention?.title || intervention?.name || '').trim()
const isOnboardingIntervention = (intervention: any) =>
    intervention?.isOnboarding === true ||
    intervention?.onboarding === true ||
    intervention?.department?.isOnboarding === true ||
    normalize(interventionTitle(intervention)).includes('onboarding')

const dateValue = (value: any) => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000)
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

const agreementMeta = (application: any, participant?: any) => ({
    ...(participant?.signedAgreements?.['pre-incubation-contract'] || {}),
    ...(application?.signedAgreements?.['pre-incubation-contract'] || {}),
    ...(application?.__preIncAgreement || {})
})

const preIncIsSigned = (application: any, participant?: any) => {
    const meta = agreementMeta(application, participant)
    return application?.__manualPreIncSigned === true || meta === true || meta.signed === true || meta.participantSigned === true ||
        !!meta.participantSignatureURL || !!meta.userSignatureURL || !!meta.signer || !!meta.acceptedAt
}

const existingPreIncPoe = (application: any, participant?: any) => {
    const meta = agreementMeta(application, participant)
    return String(
        meta.signedFileURL || meta.signedFileUrl || meta.downloadURL ||
        meta.fileURL || meta.fileUrl || meta.pdfUrl || meta.pdfURL || meta.url || ''
    ).trim()
}

const isMovFor = (mov: any, participantId: string, interventionId: string) => {
    const movParticipantId = String(mov?.smmeId || mov?.beneficiaryId || mov?.participantId || '')
    return movParticipantId === String(participantId) && String(mov?.interventionId || '') === String(interventionId)
}

export default function RomMovWorkspace({ user, department, activeProgramId }: Props) {
    const [loading, setLoading] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [rows, setRows] = useState<WorkspaceRow[]>([])
    const [interventions, setInterventions] = useState<any[]>([])
    const [facilitators, setFacilitators] = useState<any[]>([])
    const [allMovs, setAllMovs] = useState<any[]>([])
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<'missing' | 'complete' | 'all'>('missing')
    const [interventionFilter, setInterventionFilter] = useState('all')
    const [selected, setSelected] = useState<WorkspaceRow | null>(null)
    const [preIncViewer, setPreIncViewer] = useState<{ row: WorkspaceRow; meta: any } | null>(null)
    const [files, setFiles] = useState<any[]>([])
    const [form] = Form.useForm()

    const departmentId = String(department?.id || user?.departmentId || '')
    const departmentName = String(department?.name || user?.departmentName || 'ROM')

    const load = async () => {
        setLoading(true)
        try {
            const applicationsQuery = activeProgramId
                ? query(collection(db, 'applications'), where('programId', '==', activeProgramId))
                : query(collection(db, 'applications'))

            const [appsSnap, participantsSnap, interventionsSnap, movsSnap, operationsSnap, usersSnap] = await Promise.all([
                getDocs(applicationsQuery),
                getDocs(collection(db, 'participants')),
                getDocs(collection(db, 'interventions')),
                getDocs(collection(db, 'movDocuments')),
                getDocs(query(collection(db, 'operationsStaff'))),
                getDocs(query(collection(db, 'users')))
            ])

            const participantMap = new Map(
                participantsSnap.docs.map(item => [item.id, { id: item.id, ...(item.data() as any) }])
            )
            const movs = movsSnap.docs.map(item => ({ id: item.id, ...(item.data() as any) }))
            const manualPreIncByApplication = new Map<string, any>()
            await Promise.all(
                appsSnap.docs
                    .filter(item => (item.data() as any).manuallyCreated === true || (item.data() as any).manualApplication === true)
                    .map(async item => {
                        try {
                            const docsSnap = await getDocs(collection(db, 'applications', item.id, 'complianceDocuments'))
                            const signedDoc = docsSnap.docs
                                .map(docSnap => ({ id: docSnap.id, ...(docSnap.data() as any) }))
                                .find(docItem => {
                                    const slug = normalize(docItem.slug || docItem.docType || docItem.type || docItem.title || docItem.id)
                                    const status = normalize(docItem.status || docItem.verificationStatus || docItem.reviewStatus)
                                    return slug.includes('pre') && slug.includes('incubation') &&
                                        (!status || ['valid', 'approved', 'verified', 'active', 'pending', 'signed'].includes(status))
                                })
                            if (signedDoc) manualPreIncByApplication.set(item.id, signedDoc)
                        } catch (error) {
                            console.error('Failed to load manual pre-incubation agreement', item.id, error)
                        }
                    })
            )
            const deptInterventions = interventionsSnap.docs
                .map(item => ({ id: item.id, ...(item.data() as any) }))
                .filter((item: any) => {
                    const sameDepartment = departmentId && String(item.departmentId || '') === departmentId
                    const area = normalize(item.areaOfSupport || item.area || item.departmentName)
                    return sameDepartment || (!!area && area === normalize(departmentName))
                })
                .sort((a: any, b: any) => interventionTitle(a).localeCompare(interventionTitle(b)))

            const peopleByKey = new Map<string, any>()
            const addPerson = (id: string, data: any) => {
                const personDept = normalize(data.departmentName || data.department)
                const belongsToRom =
                    String(data.departmentId || '') === departmentId ||
                    (!!personDept && personDept === normalize(departmentName))
                if (!belongsToRom && id !== String(user?.uid || user?.id || '')) return
                const key = String(data.uid || data.userId || id || data.email || '')
                if (!key) return
                peopleByKey.set(key, {
                    id: key,
                    documentId: id,
                    name: data.name || data.fullName || data.email || 'ROM officer',
                    email: data.email || '',
                    signatureURL: data.signatureURL || data.signatureUrl || '',
                    digitalSignature: data.digitalSignature || ''
                })
            }
            operationsSnap.docs.forEach(item => addPerson(item.id, item.data()))
            usersSnap.docs.forEach(item => addPerson(item.id, item.data()))
            addPerson(String(user?.uid || user?.id || user?.email || 'current-user'), user)

            const workspaceRows = appsSnap.docs
                .map(item => ({ id: item.id, ...(item.data() as any) }))
                .filter((application: any) => !activeProgramId || application.programId === activeProgramId)
                .filter((application: any) => !!application.participantId)
                .map((application: any) => {
                    const enrichedApplication = {
                        ...application,
                        ...(manualPreIncByApplication.has(application.id)
                            ? {
                                __manualPreIncSigned: true,
                                __preIncAgreement: manualPreIncByApplication.get(application.id)
                            }
                            : {})
                    }
                    const participant = participantMap.get(String(application.participantId)) || {}
                    const participantMovs = movs.filter((mov: any) =>
                        String(mov.smmeId || mov.beneficiaryId || mov.participantId || '') === String(application.participantId) &&
                        (!application.programId || !mov.programId || mov.programId === application.programId)
                    )
                    return {
                        id: application.id,
                        applicationId: application.id,
                        participantId: String(application.participantId),
                        beneficiaryName: application.beneficiaryName || participant.beneficiaryName || participant.businessName || 'Unknown SME',
                        participantName: participant.participantName || application.participantName || participant.name || '',
                        programId: application.programId || participant.programId || '',
                        programName: application.programName || participant.programName || '',
                        branchId: application.branchId || participant.branchId || '',
                        branchName: application.branchName || participant.branchName || '',
                        application: enrichedApplication,
                        participant,
                        movs: participantMovs
                    } as WorkspaceRow
                })
                .sort((a, b) => a.beneficiaryName.localeCompare(b.beneficiaryName))

            setRows(workspaceRows)
            setInterventions(deptInterventions)
            setFacilitators(Array.from(peopleByKey.values()).sort((a, b) => a.name.localeCompare(b.name)))
            setAllMovs(movs)
        } catch (error) {
            console.error('Failed to load ROM MOV workspace', error)
            message.error('Could not load the ROM MOV workspace.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load().catch(() => undefined)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeProgramId, departmentId])

    const rowHasCoverage = (row: WorkspaceRow, intervention: any) => {
        if (row.movs.some(mov => isMovFor(mov, row.participantId, intervention.id))) return true
        return isOnboardingIntervention(intervention) && preIncIsSigned(row.application, row.participant)
    }

    const rowStats = (row: WorkspaceRow) => {
        const visibleInterventions = interventionFilter === 'all'
            ? interventions
            : interventions.filter(intervention => intervention.id === interventionFilter)
        const completed = visibleInterventions.filter(intervention => rowHasCoverage(row, intervention)).length
        return { completed, missing: Math.max(0, visibleInterventions.length - completed), total: visibleInterventions.length }
    }

    const filtered = useMemo(() => rows.filter(row => {
        const term = normalize(search)
        const matchesSearch = !term || [row.beneficiaryName, row.participantName, row.programName, row.branchName]
            .some(value => normalize(value).includes(term))
        if (!matchesSearch) return false
        const stats = rowStats(row)
        if (statusFilter === 'missing') return stats.missing > 0
        if (statusFilter === 'complete') return stats.missing === 0
        return true
    }), [rows, search, statusFilter, interventions, interventionFilter])

    const openGenerate = (row: WorkspaceRow) => {
        const currentPerson = facilitators.find(person =>
            person.id === String(user?.uid || user?.id || '') || normalize(person.email) === normalize(user?.email)
        )
        setSelected(row)
        setFiles([])
        form.resetFields()
        form.setFieldsValue({
            facilitatorId: currentPerson?.id,
            deliveryDate: dayjs(),
            deliveryMethod: 'in_person',
            attributionBasis: 'explicit',
            confirmed: false
        })
    }

    const selectedInterventionId = Form.useWatch('interventionId', form)
    const selectedIntervention = interventions.find(item => item.id === selectedInterventionId)
    const selectedInterventionIsOnboarding = isOnboardingIntervention(selectedIntervention)
    const selectedHasExistingMov = !!selected && !!selectedInterventionId && allMovs.some(mov =>
        isMovFor(mov, selected.participantId, selectedInterventionId) &&
        (!selected.programId || !mov.programId || mov.programId === selected.programId)
    )

    const handleGenerate = async () => {
        if (!selected) return
        const values = await form.validateFields()
        if (selectedHasExistingMov) {
            message.warning('This SME already has an MOV for the selected intervention.')
            return
        }

        const intervention = interventions.find(item => item.id === values.interventionId)
        const facilitator = facilitators.find(item => item.id === values.facilitatorId)
        if (!intervention || !facilitator) return

        const onboardingIntervention = isOnboardingIntervention(intervention)
        const selectedIsManual = selected.application?.manuallyCreated === true || selected.application?.manualApplication === true
        const preIncMeta = agreementMeta(selected.application, selected.participant)
        const preIncUrl = onboardingIntervention ? existingPreIncPoe(selected.application, selected.participant) : ''
        const systemGeneratedPreInc = onboardingIntervention && !selectedIsManual && preIncIsSigned(selected.application, selected.participant)
        if (!files.length && !preIncUrl && !systemGeneratedPreInc) {
            message.error(
                onboardingIntervention
                    ? 'Upload POE or use the existing signed Pre-Incubation Agreement.'
                    : 'POE upload is required for this intervention.'
            )
            return
        }

        setSubmitting(true)
        try {
            const uploadedUrls: string[] = []
            for (const uploadFile of files) {
                const raw = uploadFile.originFileObj || uploadFile
                if (!raw) continue
                const safeName = String(raw.name || 'poe').replace(/[^a-zA-Z0-9._-]/g, '_')
                const storageRef = ref(
                    storage,
                    `intervention-evidence/${cleanIdPart(selected.programId || 'no-program')}/${cleanIdPart(selected.participantId)}/${cleanIdPart(selected.id)}/${Date.now()}_${safeName}`
                )
                await uploadBytes(storageRef, raw)
                uploadedUrls.push(await getDownloadURL(storageRef))
            }

            const includePreInc = onboardingIntervention && values.includePreInc !== false && !!preIncUrl
            const poeUrls = Array.from(new Set([
                ...uploadedUrls,
                ...(includePreInc ? [preIncUrl] : [])
            ]))
            const deliveryDate = values.deliveryDate.toDate()
            const movId = [
                'rom',
                cleanIdPart(selected.programId || 'no-program'),
                cleanIdPart(selected.participantId),
                cleanIdPart(intervention.id)
            ].join('_')
            const preInc = agreementMeta(selected.application, selected.participant)
            const hasRecordedSmmeConfirmation = preIncIsSigned(selected.application, selected.participant)
            const verificationMethod = includePreInc && hasRecordedSmmeConfirmation
                ? 'signed_preinc_agreement'
                : 'rom_attestation_and_poe'

            const payload = {
                sourceType: 'romServiceDelivery',
                sourceId: selected.applicationId,
                generationMode: 'rom_workspace',
                assignedInterventionId: null,
                programId: selected.programId || null,
                programName: selected.programName || '',
                departmentId: departmentId || null,
                departmentName,
                areaOfSupport: departmentName,
                interventionId: intervention.id,
                interventionTitle: interventionTitle(intervention) || 'ROM intervention',
                deliveryMethod: values.deliveryMethod,
                deliveryDetails: values.deliveryDetails.trim(),
                evidenceNotes: values.evidenceNotes?.trim() || '',
                status: 'approved',
                completionVerified: true,
                verificationMethod,
                preIncubationAgreement: onboardingIntervention && (includePreInc || systemGeneratedPreInc),
                preIncubationAgreementMeta: onboardingIntervention && (includePreInc || systemGeneratedPreInc) ? preIncMeta : null,
                smmeAccepted: hasRecordedSmmeConfirmation,
                smmeAcceptedAt: hasRecordedSmmeConfirmation
                    ? preInc.participantSignedAt || preInc.acceptedAt || deliveryDate
                    : null,
                smmeConfirmationRequired: false,
                feedbackRequired: false,
                feedbackNotApplicableReason: hasRecordedSmmeConfirmation
                    ? 'The signed Pre-Incubation Agreement is the SME confirmation for this onboarding milestone.'
                    : 'This record is verified through ROM attestation, attached POE and M&E review rather than an SME service rating.',
                smmeId: selected.participantId,
                beneficiaryId: selected.participantId,
                smmeName: selected.participantName,
                smmeCompanyName: selected.beneficiaryName,
                smmeNo: selected.participant.smmeNo || '',
                smmeSignatureUrl: preInc.participantSignatureURL || selected.participant.signatureURL || '',
                smmeDigitalSignature: selected.participant.digitalSignature || '',
                facilitatorId: facilitator.id,
                facilitatorName: facilitator.name,
                facilitatorEmail: facilitator.email,
                facilitatorSignatureUrl: facilitator.signatureURL || '',
                facilitatorDigitalSignature: facilitator.digitalSignature || '',
                attributionBasis: values.attributionBasis,
                interventionDate: Timestamp.fromDate(deliveryDate),
                activityCompletedAt: Timestamp.fromDate(deliveryDate),
                assignmentCreatedAt: Timestamp.fromDate(deliveryDate),
                periodStart: Timestamp.fromDate(deliveryDate),
                periodEnd: Timestamp.fromDate(deliveryDate),
                poeUrls,
                resources: poeUrls.map((link, index) => ({
                    type: index >= uploadedUrls.length ? 'signed_agreement' : 'poe',
                    label: index >= uploadedUrls.length ? 'Signed Pre-Incubation Agreement' : `ROM POE ${index + 1}`,
                    link
                })),
                applicationId: selected.applicationId,
                branchId: selected.branchId || null,
                branchName: selected.branchName || '',
                historicalRecovery: values.historicalRecovery === true,
                romAttestation: {
                    confirmed: true,
                    confirmedByUid: user.uid || user.id || '',
                    confirmedByName: user.name || user.email || '',
                    confirmedByEmail: user.email || '',
                    confirmedAt: new Date(),
                    statement: 'ROM confirms that the selected intervention was delivered to this SME and that the attached POE supports the delivery.'
                },
                createdByUid: user.uid || user.id || '',
                createdByName: user.name || '',
                createdByEmail: user.email || '',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            }

            await setDoc(doc(db, 'movDocuments', movId), payload, { merge: false })
            message.success('MOV generated and made available to M&E.')
            setSelected(null)
            form.resetFields()
            setFiles([])
            await load()
        } catch (error) {
            console.error('Failed to generate ROM MOV', error)
            message.error('The MOV could not be generated.')
        } finally {
            setSubmitting(false)
        }
    }

    const columns = [
        {
            title: 'SME',
            key: 'sme',
            render: (_: any, row: WorkspaceRow) => (
                <Space direction="vertical" size={0}>
                    <Text strong>{row.beneficiaryName}</Text>
                    <Text type="secondary">{row.participantName || row.participantId}</Text>
                </Space>
            )
        },
        { title: 'Programme', dataIndex: 'programName', key: 'programName', render: (value: string) => value || '—' },
        { title: 'Branch', dataIndex: 'branchName', key: 'branchName', render: (value: string) => value || '—' },
        {
            title: 'MOV coverage',
            key: 'coverage',
            render: (_: any, row: WorkspaceRow) => {
                const stats = rowStats(row)
                return (
                    <Space>
                        <Tag color="green">{stats.completed} available</Tag>
                        <Tag color={stats.missing ? 'orange' : 'default'}>{stats.missing} missing</Tag>
                    </Space>
                )
            }
        },
        {
            title: 'Pre-Inc POE',
            key: 'preinc',
            render: (_: any, row: WorkspaceRow) => preIncIsSigned(row.application, row.participant) ? (
                <Button
                    type="link"
                    style={{ padding: 0 }}
                    onClick={() => setPreIncViewer({ row, meta: agreementMeta(row.application, row.participant) })}
                >
                    View signed agreement
                </Button>
            ) : <Tag>Not found</Tag>
        },
        {
            title: 'Action',
            key: 'action',
            render: (_: any, row: WorkspaceRow) => (
                <Button type="primary" icon={<FileAddOutlined />} onClick={() => openGenerate(row)}>
                    Generate MOV
                </Button>
            )
        }
    ]

    return (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card>
                <Space direction="vertical" size={4}>
                    <Title level={4} style={{ margin: 0 }}>ROM MOV Management</Title>
                    <Text type="secondary">
                        Manage and submit MOVs for ROM onboarding and service-delivery interventions.
                    </Text>
                </Space>
            </Card>

            {!interventions.length && !loading && (
                <Alert
                    type="warning"
                    showIcon
                    message="No ROM interventions are configured"
                    description="Create or allocate interventions to the ROM department before generating MOVs."
                />
            )}

            <Card>
                <Space wrap style={{ marginBottom: 16 }}>
                    <Input.Search
                        allowClear
                        placeholder="Search SME, programme or branch"
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        style={{ width: 320 }}
                    />
                    <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 180 }} options={[
                        { value: 'missing', label: 'Missing MOVs' },
                        { value: 'complete', label: 'Complete' },
                        { value: 'all', label: 'All SMEs' }
                    ]} />
                    <Select
                        showSearch
                        optionFilterProp="label"
                        value={interventionFilter}
                        onChange={setInterventionFilter}
                        style={{ width: 240 }}
                        options={[
                            { value: 'all', label: 'All ROM interventions' },
                            ...interventions.map(intervention => ({
                                value: intervention.id,
                                label: interventionTitle(intervention) || 'Untitled intervention'
                            }))
                        ]}
                    />
                    <Button onClick={() => load()} loading={loading}>Refresh</Button>
                </Space>
                <Table
                    rowKey="id"
                    loading={loading}
                    columns={columns as any}
                    dataSource={filtered}
                    pagination={{ pageSize: 10 }}
                    locale={{ emptyText: <Empty description="No SMEs match this view" /> }}
                    scroll={{ x: 900 }}
                />
            </Card>

            <Modal
                open={!!selected}
                title={`Generate ROM MOV — ${selected?.beneficiaryName || ''}`}
                width={780}
                okText="Generate and submit to M&E"
                confirmLoading={submitting}
                onOk={handleGenerate}
                onCancel={() => !submitting && setSelected(null)}
                destroyOnClose
            >
                {selected && (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Descriptions size="small" bordered column={2}>
                            <Descriptions.Item label="Programme">{selected.programName || '—'}</Descriptions.Item>
                            <Descriptions.Item label="Branch">{selected.branchName || '—'}</Descriptions.Item>
                        </Descriptions>
                        <Form form={form} layout="vertical">
                            <Form.Item name="interventionId" label="ROM intervention" rules={[{ required: true }]}>
                                <Select
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder="Select the intervention delivered"
                                    options={interventions.map(item => ({
                                        value: item.id,
                                        label: interventionTitle(item) || item.id,
                                        disabled: selected.movs.some(mov => isMovFor(mov, selected.participantId, item.id))
                                    }))}
                                />
                            </Form.Item>
                            {selectedHasExistingMov && <Alert type="warning" showIcon message="An MOV already exists for this SME and intervention." style={{ marginBottom: 16 }} />}
                            {selectedInterventionId && (
                                <Alert
                                    type={selectedInterventionIsOnboarding ? 'info' : 'warning'}
                                    showIcon
                                    style={{ marginBottom: 16 }}
                                    message={
                                        selectedInterventionIsOnboarding
                                            ? 'A signed Pre-Incubation Agreement may be used as POE for this onboarding intervention.'
                                            : 'Upload intervention-specific POE. The Pre-Incubation Agreement cannot be used for this intervention.'
                                    }
                                />
                            )}
                            <Form.Item name="facilitatorId" label="Actual facilitator" rules={[{ required: true }]}>
                                <Select
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder="Select the ROM officer who delivered the intervention"
                                    options={facilitators.map(person => ({
                                        value: person.id,
                                        label: `${person.name}${person.email ? ` — ${person.email}` : ''}`
                                    }))}
                                />
                            </Form.Item>
                            <Form.Item name="attributionBasis" label="Why this facilitator is being credited" rules={[{ required: true }]}>
                                <Select options={[
                                    { value: 'explicit', label: 'Confirmed by ROM' },
                                    { value: 'rom_signer', label: 'Recorded ROM signatory' },
                                    { value: 'legacy_manual', label: 'Historical record/manual resolution' }
                                ]} />
                            </Form.Item>
                            <Space size={12} style={{ width: '100%' }} align="start">
                                <Form.Item name="deliveryDate" label="Delivery date" rules={[{ required: true }]}>
                                    <DatePicker />
                                </Form.Item>
                                <Form.Item name="deliveryMethod" label="Delivery method" rules={[{ required: true }]}>
                                    <Select style={{ width: 190 }} options={[
                                        { value: 'in_person', label: 'In-person' },
                                        { value: 'online', label: 'Online' },
                                        { value: 'telephonic', label: 'Telephonic' },
                                        { value: 'other', label: 'Other' }
                                    ]} />
                                </Form.Item>
                            </Space>
                            <Form.Item name="deliveryDetails" label="Delivery details" rules={[
                                { required: true, message: 'Describe what was delivered.' },
                                { min: 20, message: 'Provide enough detail for M&E to review the delivery.' }
                            ]}>
                                <Input.TextArea rows={4} placeholder="Describe the induction/onboarding activity, outcome and attendees." />
                            </Form.Item>
                            <Form.Item name="evidenceNotes" label="POE notes">
                                <Input.TextArea rows={2} placeholder="Explain what the attached evidence demonstrates." />
                            </Form.Item>
                            <Form.Item label="Upload POE">
                                <Upload
                                    multiple
                                    beforeUpload={() => false}
                                    fileList={files}
                                    onChange={({ fileList }) => setFiles(fileList)}
                                >
                                    <Button icon={<UploadOutlined />}>Select files</Button>
                                </Upload>
                            </Form.Item>
                            {selectedInterventionIsOnboarding && existingPreIncPoe(selected.application, selected.participant) && (
                                <Form.Item name="includePreInc" valuePropName="checked" initialValue>
                                    <Checkbox>Include the existing signed Pre-Incubation Agreement as POE</Checkbox>
                                </Form.Item>
                            )}
                            <Form.Item name="historicalRecovery" valuePropName="checked">
                                <Checkbox>This is a historical delivery being recovered</Checkbox>
                            </Form.Item>
                            <Form.Item
                                name="confirmed"
                                valuePropName="checked"
                                rules={[{
                                    validator: (_, checked) => checked
                                        ? Promise.resolve()
                                        : Promise.reject(new Error('ROM must confirm the delivery and POE.'))
                                }]}
                            >
                                <Checkbox>
                                    I confirm that this intervention was delivered to the SME, the facilitator attribution is correct, and the POE supports the delivery.
                                </Checkbox>
                            </Form.Item>
                        </Form>
                    </Space>
                )}
            </Modal>

            <PreIncubationContractModal
                open={!!preIncViewer}
                participantId={preIncViewer?.row.participantId || ''}
                applicationId={preIncViewer?.row.applicationId || ''}
                onClose={() => setPreIncViewer(null)}
                onSigned={async () => undefined}
                readOnly
                signedMeta={preIncViewer?.meta}
                viewerRole="operations"
            />
        </Space>
    )
}
