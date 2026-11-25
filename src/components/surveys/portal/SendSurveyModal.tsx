import React, { useEffect, useMemo, useState } from 'react'
import { App, Button, Checkbox, DatePicker, Empty, Form, Input, Modal, Select, Spin, Tag } from 'antd'
import { CheckCircleFilled, SearchOutlined } from '@ant-design/icons'
import {
    Timestamp,
    arrayUnion,
    collection,
    doc,
    documentId,
    getDoc,
    getDocs,
    query,
    where,
    writeBatch
} from 'firebase/firestore'
import dayjs, { type Dayjs } from 'dayjs'
import { db } from '@/firebase'
import { EntityAvatar } from '@/components/workspace'
import {
    currentQuestions,
    questionCount,
    toResponseQuestions,
    trainingCompanyName,
    type SentSurvey,
    type SurveyTemplate
} from './surveyData'

// One firestore batch holds 500 writes: the sent form plus one per SME.
const MAX_RECIPIENTS = 499

type Recipient = {
    key: string
    participantName: string
    companyName: string
    email: string
    group: string
    branchId: string
    branch: string
    /** Training SMEs only: the person's categories (a subset of the training's). */
    categories?: string[]
    /** Training SMEs only. */
    training?: {
        enrollmentId: string
        kind: 'director' | 'employee'
        /** Their training_sme login, if one exists yet; needed to answer. */
        userId: string | null
    }
}

/** The training picked in the header, when it is a training rather than a programme. */
type TrainingScope = { id: string; name: string; categories: string[] }

type Props = {
    open: boolean
    onClose: () => void
    /** Published templates the department can send. */
    templates: SurveyTemplate[]
    /** Opened from a template: start on the recipients. */
    initialTemplateId?: string | null
    /** The programme picked in the header; a template's own is the fallback. */
    activeProgramId?: string | null
    departmentId?: string | null
    myUid?: string | null
    /** Already sent, to flag SMEs who have the template. */
    sentSurveys: SentSurvey[]
    /**
     * Add SMEs to this sent survey instead of sending a new one: same
     * questions and due date, and its current recipients can't be picked.
     */
    addTo?: SentSurvey | null
    onSent: (sentFormId: string) => void
}

/** Where an SME stands with the template or survey, for the tag on their row. */
type PriorState = { label: string; color: string; onThisSurvey: boolean }

const chunk = <T,>(items: T[], size: number) =>
    Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size))

/** The programme's accepted SMEs, read by id rather than the whole collection. */
const loadRecipients = async (programId: string) => {
    const appSnap = await getDocs(
        query(
            collection(db, 'applications'),
            where('programId', '==', programId),
            where('applicationStatus', 'in', ['accepted', 'Accepted'])
        )
    )
    const applications = appSnap.docs.map(d => d.data() as any)
    const ids = Array.from(new Set(applications.map(a => String(a.participantId || '').trim()).filter(Boolean)))
    const snaps = await Promise.all(
        chunk(ids, 30).map(part => getDocs(query(collection(db, 'participants'), where(documentId(), 'in', part))))
    )
    const participants = new Map(snaps.flatMap(snap => snap.docs.map(d => [d.id, d.data() as any] as const)))

    return applications
        .map(application => {
            const id = String(application.participantId || '').trim()
            const participant = participants.get(id)
            if (!participant) return null
            return {
                key: id,
                participantName:
                    String(
                        // The owner's name: participantName often repeats the company.
                        participant.ownerName ||
                        application.ownerName ||
                        participant.participantName ||
                        participant.fullName ||
                        participant.name ||
                        application.participantName ||
                        ''
                    ).trim() || 'Unnamed Participant',
                companyName: String(
                    participant.companyName ||
                    participant.beneficiaryName ||
                    participant.businessName ||
                    application.companyName ||
                    application.beneficiaryName ||
                    'Unnamed Company'
                ).trim(),
                email: String(participant.email || application.email || '').trim(),
                group: String(application.gapGroup || participant.gapGroup || participant.group || '').trim(),
                branchId: String(application.branchId || participant.branchId || '').trim(),
                branch: ''
            }
        })
        .filter((row): row is Recipient => !!row)
        .filter((row, index, rows) => rows.findIndex(r => r.key === row.key) === index)
        .sort((a, b) => a.companyName.localeCompare(b.companyName))
}

/**
 * A training's people: each director and employee an enrolled SME sends is
 * their own recipient (their own training_sme login and categories), keyed by
 * their trainingAttendees id. An SME enrolled before people were recorded has
 * no attendee docs; its director stands in under the same deterministic id
 * ({enrollmentId}_director) the backfill would give it.
 */
const loadTrainingRecipients = async (trainingId: string): Promise<Recipient[]> => {
    const [enrollmentSnap, attendeeSnap] = await Promise.all([
        getDocs(query(collection(db, 'trainingEnrollments'), where('trainingId', '==', trainingId))),
        getDocs(query(collection(db, 'trainingAttendees'), where('trainingId', '==', trainingId)))
    ])
    const enrollments = new Map(
        enrollmentSnap.docs
            .map(d => [d.id, d.data() as any] as const)
            .filter(([, e]) => e.status === 'enrolled')
    )
    const rows: Recipient[] = []
    const withPeople = new Set<string>()

    attendeeSnap.docs.forEach(d => {
        const person = d.data() as any
        const enrollment = enrollments.get(String(person.enrollmentId || ''))
        if (!enrollment) return
        withPeople.add(String(person.enrollmentId))
        // Withdrawn people, and an owner who doesn't attend, aren't surveyed.
        if (person.status === 'withdrawn' || person.attends === false) return
        rows.push({
            key: d.id,
            participantName: String(person.name || '').trim() || 'Unnamed person',
            companyName: trainingCompanyName(enrollment),
            email: String(person.email || '').trim(),
            group: '',
            branchId: '',
            branch: '',
            categories: Array.isArray(person.categories) ? person.categories.map(String) : [],
            training: {
                enrollmentId: String(person.enrollmentId),
                kind: person.kind === 'employee' ? 'employee' : 'director',
                userId: person.userId ? String(person.userId) : null
            }
        })
    })

    enrollments.forEach((enrollment, enrollmentId) => {
        if (withPeople.has(enrollmentId)) return
        rows.push({
            key: enrollmentId + '_director',
            participantName: String(enrollment.name || '').trim() || 'Unnamed person',
            companyName: trainingCompanyName(enrollment),
            email: String(enrollment.email || '').trim(),
            group: '',
            branchId: '',
            branch: '',
            categories: Array.isArray(enrollment.categories) ? enrollment.categories.map(String) : [],
            training: {
                enrollmentId,
                kind: 'director',
                userId: enrollment.userId ? String(enrollment.userId) : null
            }
        })
    })

    return rows.sort(
        (a, b) => a.companyName.localeCompare(b.companyName) || a.participantName.localeCompare(b.participantName)
    )
}

/**
 * Send a survey in two short steps: the survey and its due date, then who
 * gets it. Closing is the modal's X; the footer only moves through the steps.
 */
export const SendSurveyModal: React.FC<Props> = ({
    open,
    onClose,
    templates,
    initialTemplateId,
    activeProgramId,
    departmentId,
    myUid,
    sentSurveys,
    addTo,
    onSent
}) => {
    const { message, modal } = App.useApp()
    const [step, setStep] = useState(0)
    const [templateId, setTemplateId] = useState<string | null>(null)
    const [dueDate, setDueDate] = useState<Dayjs | null>(null)
    const [recipients, setRecipients] = useState<Recipient[]>([])
    const [loadingRecipients, setLoadingRecipients] = useState(false)
    const [isMultiBranch, setIsMultiBranch] = useState(false)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [search, setSearch] = useState('')
    const [group, setGroup] = useState<string>()
    const [branch, setBranch] = useState<string>()
    const [sending, setSending] = useState(false)
    const [training, setTraining] = useState<TrainingScope | null>(null)
    /** Training categories to send to; empty means every category. */
    const [categories, setCategories] = useState<string[]>([])

    useEffect(() => {
        if (!open) return
        setTemplateId(addTo ? addTo.templateId || null : initialTemplateId || null)
        setStep(addTo || initialTemplateId ? 1 : 0)
        setDueDate(null)
        setSelected(new Set())
        setSearch('')
        setGroup(undefined)
        setBranch(undefined)
        setCategories([])
    }, [open, initialTemplateId, addTo])

    const template = templates.find(t => t.id === templateId) || null
    // Adding to a survey keeps its own programme, whatever the header shows.
    const programId = addTo ? addTo.programId || null : activeProgramId || template?.programId || null

    useEffect(() => {
        if (!open || !programId) {
            setRecipients([])
            return
        }
        let active = true
        setLoadingRecipients(true)
        setTraining(null)
        // The header can hold a training instead of a programme; its people
        // are the recipients then.
        getDoc(doc(db, 'trainings', programId))
            .then(async trainingSnap => {
                if (!trainingSnap.exists()) return false
                const data = trainingSnap.data() as any
                const rows = await loadTrainingRecipients(programId)
                if (!active) return true
                setTraining({
                    id: trainingSnap.id,
                    name: String(data.name || 'Training'),
                    categories: Array.isArray(data.categories) ? data.categories.map(String).filter(Boolean) : []
                })
                setIsMultiBranch(false)
                setRecipients(rows)
                return true
            })
            .then(isTraining =>
                isTraining
                    ? null
                    : Promise.all([loadRecipients(programId), getDoc(doc(db, 'programs', programId))])
            )
            .then(async result => {
                if (!result) return
                const [rows, programSnap] = result
                const multi = !!programSnap.data()?.isMultiBranch
                let names: Record<string, string> = {}
                if (multi) {
                    const branchSnap = await getDocs(collection(db, 'branches'))
                    names = Object.fromEntries(branchSnap.docs.map(d => [d.id, String(d.data().name || 'Unnamed branch')]))
                }
                if (!active) return
                setIsMultiBranch(multi)
                setRecipients(rows.map(row => ({ ...row, branch: names[row.branchId] || '' })))
            })
            .catch(error => {
                console.error('Failed to load survey recipients', error)
                if (active) {
                    setRecipients([])
                    message.error('Could not load SMEs for this programme or training.')
                }
            })
            .finally(() => {
                if (active) setLoadingRecipients(false)
            })
        return () => {
            active = false
        }
    }, [open, programId, message])

    /**
     * Adding to a survey: its recipients, who can't be picked again. Sending a
     * template: when each SME last answered it (or that they were sent it and
     * haven't), so a repeat round is a choice made knowingly.
     */
    const priorState = useMemo(() => {
        const states = new Map<string, PriorState>()
        if (addTo) {
            addTo.recipients.forEach(r =>
                states.set(r.participantId, {
                    label: r.completed ? 'Answered' : 'Awaiting',
                    color: r.completed ? 'success' : 'default',
                    onThisSurvey: true
                })
            )
            return states
        }
        const latest = new Map<string, { answeredAt: number; sentAt: number }>()
        sentSurveys
            .filter(survey => survey.templateId && survey.templateId === templateId)
            .forEach(survey =>
                survey.recipients.forEach(r => {
                    const previous = latest.get(r.participantId) || { answeredAt: 0, sentAt: 0 }
                    latest.set(r.participantId, {
                        answeredAt: Math.max(previous.answeredAt, r.completed ? r.submittedAt?.toMillis() || 1 : 0),
                        sentAt: Math.max(previous.sentAt, survey.sentAt?.toMillis() || 1)
                    })
                })
            )
        latest.forEach((value, id) =>
            states.set(id, {
                label: value.answeredAt > 1
                    ? `Answered ${dayjs(value.answeredAt).format('D MMM')}`
                    : value.answeredAt
                        ? 'Answered before'
                        : 'Sent, not answered',
                color: 'warning',
                onThisSurvey: false
            })
        )
        return states
    }, [addTo, sentSurveys, templateId])

    const selectable = (r: Recipient) => !priorState.get(r.key)?.onThisSurvey

    const groupOptions = useMemo(
        () => Array.from(new Set(recipients.map(r => r.group).filter(Boolean))).sort(),
        [recipients]
    )
    const branchOptions = useMemo(
        () =>
            Array.from(new Map(recipients.filter(r => r.branchId).map(r => [r.branchId, r.branch || 'Unnamed branch']))).map(
                ([value, label]) => ({ value, label })
            ),
        [recipients]
    )

    // The training's categories, plus any a person still carries after the
    // training's list changed, so nobody is unreachable.
    const categoryOptions = useMemo(() => {
        if (!training) return []
        const all = new Set(training.categories)
        recipients.forEach(r => r.categories?.forEach(c => all.add(c)))
        return Array.from(all)
    }, [training, recipients])

    const inCategories = (r: Recipient, chosen: string[]) =>
        !chosen.length || !!r.categories?.some(c => chosen.includes(c))

    /** Picking categories selects everyone in them (who isn't on the survey already). */
    const changeCategories = (next: string[]) => {
        setCategories(next)
        setSelected(
            next.length
                ? new Set(recipients.filter(r => selectable(r) && inCategories(r, next)).map(r => r.key))
                : new Set()
        )
    }

    const shown = useMemo(() => {
        const term = search.trim().toLowerCase()
        const onSurvey = (r: Recipient) => (priorState.get(r.key)?.onThisSurvey ? 1 : 0)
        return (
            recipients
                .filter(
                    r =>
                        (!term || [r.participantName, r.companyName, r.email].some(v => v.toLowerCase().includes(term))) &&
                        (!group || r.group === group) &&
                        (!isMultiBranch || !branch || r.branchId === branch) &&
                        inCategories(r, categories)
                )
                // SMEs who can still be added first; those already on the survey
                // follow for context. The sort is stable, so A–Z holds in each part.
                .sort((a, b) => onSurvey(a) - onSurvey(b))
        )
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recipients, search, group, branch, isMultiBranch, priorState, categories])

    const shownSelectable = shown.filter(selectable)
    const allShownSelected = shownSelectable.length > 0 && shownSelectable.every(r => selected.has(r.key))

    const toggle = (key: string) =>
        setSelected(previous => {
            const next = new Set(previous)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })

    const toggleShown = () =>
        setSelected(previous => {
            const next = new Set(previous)
            shownSelectable.forEach(r => (allShownSelected ? next.delete(r.key) : next.add(r.key)))
            return next
        })

    const send = async (chosen: Recipient[]) => {
        if ((!template && !addTo) || !programId) return
        setSending(true)
        try {
            // New SMEs on an existing survey get the questions its SMEs are answering now.
            const sourceFields = addTo ? currentQuestions(addTo.recipients) : template!.fields
            // Undefined is not a firestore value; the JSON round trip drops it.
            const fields = JSON.parse(JSON.stringify(sourceFields))
            const questions = JSON.parse(JSON.stringify(toResponseQuestions(sourceFields)))

            // One batch: either the survey and every invite land, or nothing.
            const batch = writeBatch(db)
            const sentRef = addTo ? doc(db, 'sentForms', addTo.id) : doc(collection(db, 'sentForms'))
            if (addTo) {
                batch.update(sentRef, { participantIds: arrayUnion(...chosen.map(r => r.key)) })
            } else batch.set(sentRef, {
                title: template!.title,
                description: template!.description || '',
                templateId: template!.id,
                department: departmentId ?? template!.department ?? null,
                programId,
                participantIds: chosen.map(r => r.key),
                // A training survey goes to its SMEs' people, not programme SMEs.
                ...(training ? { audience: 'training', trainingId: training.id, categories } : {}),
                sentBy: myUid || null,
                sentAt: Timestamp.now(),
                // Open until the end of the chosen day, local time.
                dueDate: dueDate ? Timestamp.fromDate(dueDate.endOf('day').toDate()) : null
            })
            chosen.forEach(r =>
                batch.set(doc(db, 'sentForms', sentRef.id, 'responses', r.key), {
                    participantId: r.key,
                    participantName: r.participantName,
                    companyName: r.companyName,
                    email: r.email,
                    group: r.group || null,
                    branchId: r.branchId || null,
                    branchName: r.branch || null,
                    // Legacy display fallback.
                    name: r.participantName,
                    completed: false,
                    fields,
                    questions,
                    answers: {},
                    ...(r.training
                        ? {
                            audience: 'training',
                            trainingId: training?.id || programId,
                            enrollmentId: r.training.enrollmentId,
                            attendeeId: r.key,
                            attendeeKind: r.training.kind,
                            categories: r.categories || [],
                            respondentUid: r.training.userId
                        }
                        : {})
                })
            )
            await batch.commit()
            message.success(
                `${addTo ? 'Added' : 'Survey sent to'} ${chosen.length} SME${chosen.length === 1 ? '' : 's'}`
            )
            onSent(sentRef.id)
        } catch (error) {
            console.error(error)
            message.error('Could not send the survey. Nothing was sent.')
        } finally {
            setSending(false)
        }
    }

    const submit = () => {
        if (sending) return
        // Everyone selected, including SMEs the current filters hide.
        const chosen = recipients.filter(r => selected.has(r.key) && selectable(r))
        if (!chosen.length) return message.error('Select at least one SME')
        if (chosen.length > MAX_RECIPIENTS) return message.error(`Send to at most ${MAX_RECIPIENTS} SMEs at a time.`)
        if (!programId) return message.error('Pick a programme in the header first.')

        const repeats = addTo ? 0 : chosen.filter(r => priorState.has(r.key)).length
        if (repeats) {
            modal.confirm({
                title: 'Send this survey again to some SMEs?',
                content: `${repeats} of the selected SME${repeats === 1 ? ' has' : 's have'} had this survey before. They get a new, separate copy.`,
                okText: 'Send anyway',
                onOk: () => send(chosen)
            })
            return
        }
        send(chosen)
    }

    const footer = [
        step === 1 && !addTo && (
            <Button key='back' onClick={() => setStep(0)} disabled={sending}>
                Back
            </Button>
        ),
        step === 0 && (
            <Button key='next' type='primary' disabled={!template} onClick={() => setStep(1)}>
                Next: recipients
            </Button>
        ),
        step === 1 && (
            <Button key='send' type='primary' loading={sending} disabled={!selected.size} onClick={submit}>
                {addTo ? 'Add' : 'Send to'} {selected.size} SME{selected.size === 1 ? '' : 's'}
            </Button>
        )
    ].filter(Boolean)

    return (
        <Modal
            title={addTo ? `Add SMEs · ${addTo.title}` : template && step === 1 ? template.title : 'Send survey'}
            open={open}
            onCancel={() => !sending && onClose()}
            footer={footer}
            width={640}
            destroyOnClose
            maskClosable={!sending}
        >
            <div hidden={step !== 0}>
                <Form layout='vertical' requiredMark='optional'>
                    <Form.Item label='Survey' required>
                        {templates.length ? (
                            <div className='svp-template-list' role='radiogroup' aria-label='Survey'>
                                {templates.map(t => {
                                    const isChosen = t.id === templateId
                                    const count = questionCount(t.fields)
                                    return (
                                        <button
                                            key={t.id}
                                            type='button'
                                            role='radio'
                                            aria-checked={isChosen}
                                            className={`ws-row${isChosen ? ' is-selected' : ''}`}
                                            onClick={() => setTemplateId(t.id)}
                                            onDoubleClick={() => {
                                                setTemplateId(t.id)
                                                setStep(1)
                                            }}
                                        >
                                            <EntityAvatar name={t.title} size={32} />
                                            <div className='ws-row-main'>
                                                <div className='ws-row-name'>{t.title}</div>
                                                <div className='ws-row-meta'>
                                                    {`${count} question${count === 1 ? '' : 's'}`}
                                                </div>
                                            </div>
                                            {isChosen && (
                                                <div className='ws-row-side'>
                                                    <CheckCircleFilled />
                                                </div>
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                        ) : (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description='No surveys are ready to send. Open a template and click Send, or Make ready to send in the builder.'
                            />
                        )}
                    </Form.Item>
                    <Form.Item label='Due date' extra='Answers close at the end of this day.'>
                        <DatePicker
                            className='svp-due'
                            value={dueDate}
                            onChange={setDueDate}
                            format='D MMM YYYY'
                            disabledDate={current => current.isBefore(dayjs(), 'day')}
                        />
                    </Form.Item>
                </Form>
            </div>

            <div hidden={step !== 1}>
                <div className='svp-picker-toolbar'>
                    <Input
                        allowClear
                        prefix={<SearchOutlined />}
                        placeholder='Search SMEs'
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        aria-label='Search SMEs by name, company or email'
                    />
                    {categoryOptions.length > 0 && (
                        <Select
                            mode='multiple'
                            allowClear
                            maxTagCount='responsive'
                            placeholder='All categories'
                            value={categories}
                            onChange={changeCategories}
                            options={categoryOptions.map(c => ({ value: c, label: c }))}
                            style={{ minWidth: 200 }}
                            aria-label='Send to these categories'
                        />
                    )}
                    {groupOptions.length > 0 && (
                        <Select
                            allowClear
                            placeholder='Group'
                            value={group}
                            onChange={setGroup}
                            options={groupOptions.map(g => ({ value: g, label: `Group ${g}` }))}
                        />
                    )}
                    {isMultiBranch && branchOptions.length > 0 && (
                        <Select allowClear placeholder='Branch' value={branch} onChange={setBranch} options={branchOptions} />
                    )}
                </div>

                <div className='svp-picker-summary'>
                    <Checkbox
                        checked={allShownSelected}
                        indeterminate={!allShownSelected && shownSelectable.some(r => selected.has(r.key))}
                        disabled={!shownSelectable.length}
                        onChange={toggleShown}
                    >
                        {/* Counts only who can be picked; SMEs already on the survey are listed below them. */}
                        Select all {shownSelectable.length} {addTo ? 'not yet on this survey' : 'shown'}
                    </Checkbox>
                    <span>
                        {selected.size} selected
                        {addTo && shown.length > shownSelectable.length
                            ? ` · ${shown.length - shownSelectable.length} already on it`
                            : ''}
                    </span>
                </div>

                <Spin spinning={loadingRecipients}>
                    {shown.length ? (
                        <div className='svp-picker-list' role='group' aria-label='SMEs'>
                            {shown.map(r => {
                                const prior = priorState.get(r.key)
                                const isChosen = selected.has(r.key) && selectable(r)
                                return (
                                    <button
                                        key={r.key}
                                        type='button'
                                        role='checkbox'
                                        aria-checked={isChosen}
                                        // Already on this survey: shown for context, not pickable.
                                        disabled={prior?.onThisSurvey}
                                        className={`ws-row${isChosen ? ' is-selected' : ''}`}
                                        onClick={() => toggle(r.key)}
                                    >
                                        <EntityAvatar name={r.companyName} size={32} />
                                        <div className='ws-row-main'>
                                            <div className='ws-row-name'>{r.companyName}</div>
                                            <div className='ws-row-meta'>
                                                {[
                                                    // Some records store the company as the participant name.
                                                    r.participantName !== r.companyName && r.participantName,
                                                    r.training && (r.training.kind === 'director' ? 'Director' : 'Employee'),
                                                    r.categories?.length && r.categories.join(', '),
                                                    r.group && `Group ${r.group}`,
                                                    isMultiBranch && r.branch
                                                ]
                                                    .filter(Boolean)
                                                    .join(' · ')}
                                            </div>
                                        </div>
                                        <div className='ws-row-side'>
                                            {prior && (
                                                <Tag color={prior.color} bordered={false}>
                                                    {prior.label}
                                                </Tag>
                                            )}
                                            {r.training && !r.training.userId && (
                                                <Tag
                                                    bordered={false}
                                                    title='They can answer once their portal login is created'
                                                >
                                                    No login yet
                                                </Tag>
                                            )}
                                            {isChosen && <CheckCircleFilled />}
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    ) : (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={
                                loadingRecipients
                                    ? 'Loading SMEs…'
                                    : recipients.length
                                        ? 'No SMEs match these filters'
                                        : training
                                            ? 'No enrolled SMEs in this training'
                                            : 'No accepted SMEs in this programme'
                            }
                        />
                    )}
                </Spin>
            </div>
        </Modal>
    )
}
