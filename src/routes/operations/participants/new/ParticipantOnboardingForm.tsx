import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Col, DatePicker, Form, Grid, Input, InputNumber, Row, Segmented, Select, message } from 'antd'
import {
    ArrowLeftOutlined,
    CheckCircleFilled,
    DownOutlined,
    InfoCircleOutlined,
    SaveOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs, { Dayjs } from 'dayjs'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { motion, useReducedMotion } from 'framer-motion'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { DashboardLoader } from '@/components/layout/DashboardLoader'
import { SA_PROVINCES } from '@/routes/shared/incubatees/participantsData'
import { DirectorsSection } from './DirectorsSection'
import { DocumentsSection, docProblem, type DocRow } from './DocumentsSection'
import { HistorySection, historyPeriods } from './HistorySection'
import {
    STAGES,
    createSme,
    findExistingSme,
    inviteSme,
    isValidZARegistration,
    normaliseRegistration,
    yearsSince,
    type Director,
    type SmeInput,
    type Stage
} from './smeRecords'
import './sme-form.css'

// Re-exported for screens that imported the validator from here.
export { isValidSouthAfricanID } from './smeRecords'

const SECTORS = [
    'Agriculture', 'Automotive', 'Arts and Culture', 'Chemical', 'Community, Social and Personal Services', 'Construction',
    'Education', 'Electricity, Gas and Water', 'Engineering', 'Finance, Real Estate and Business Services', 'Fishing',
    'Forestry and Logging', 'Green Economic', 'Health and Social Work', 'Information Technology', 'Manufacturing',
    'Mining', 'Mining Supply', 'Supply Chain Industries', 'Textile', 'Tourism and Hospitality',
    'Transport, Storage and Communication', 'Wholesale and Retail Trade', 'Other'
]
const BEE_LEVELS = ['1', '2', '3', '4', '5', '6', '7', '8', 'Non-compliant']

type Branch = { id: string; name: string }

const isMoa = (title: string) => /\bmoa\b|memorandum of agreement/i.test(title)

const { useBreakpoint } = Grid

/** A numbered page section. */
const Section: React.FC<{ n: number; title: string; hint?: string; done?: boolean; children: React.ReactNode }> = ({ n, title, hint, done, children }) => (
    <section className='sf-section' aria-labelledby={`sf-s${n}`}>
        <header className='sf-section-head'>
            <span className={`sf-step${done ? ' is-done' : ''}`} aria-hidden='true'>{done ? <CheckCircleFilled /> : n}</span>
            <div>
                <h2 id={`sf-s${n}`} className='sf-section-title'>{title}</h2>
                {hint && <p className='sf-section-hint'>{hint}</p>}
            </div>
        </header>
        {children}
    </section>
)

/** An optional section that stays folded until it's wanted. */
const Optional: React.FC<{ id: string; title: string; status: string; open: boolean; onToggle: () => void; children: React.ReactNode }> = ({ id, title, status, open, onToggle, children }) => (
    <section className={`sf-section sf-optional${open ? ' is-open' : ''}`}>
        <button type='button' className='sf-optional-head' aria-expanded={open} aria-controls={id} onClick={onToggle}>
            <span className='sf-optional-title'>
                {title}
                <span className='sf-optional-tag'>Optional</span>
            </span>
            <span className='sf-optional-status'>{status}</span>
            <DownOutlined className='sf-optional-chevron' aria-hidden='true' />
        </button>
        {open && <div id={id} className='sf-optional-body'>{children}</div>}
    </section>
)

const ParticipantOnboardingForm: React.FC = () => {
    const { user } = useFullIdentity()
    const [form] = Form.useForm()
    const navigate = useNavigate()
    const { id: programId } = useParams<{ id: string }>()
    const isPhone = !useBreakpoint().md
    const reduceMotion = useReducedMotion()

    const [programName, setProgramName] = useState<string | null>(null)
    const [programBranch, setProgramBranch] = useState<Branch | null>(null)
    const [branches, setBranches] = useState<Branch[]>([])
    const [docs, setDocs] = useState<DocRow[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [sendInvite, setSendInvite] = useState(true)
    const [openDocs, setOpenDocs] = useState(false)
    const [openHistory, setOpenHistory] = useState(false)
    const [showDocProblems, setShowDocProblems] = useState(false)
    const [duplicate, setDuplicate] = useState<{ name: string; programName: string | null } | null>(null)

    // ---- the programme: name, default branch and required documents ----
    useEffect(() => {
        if (!programId) return
        ;(async () => {
            setLoading(true)
            try {
                const [programSnap, branchSnap] = await Promise.all([getDoc(doc(db, 'programs', programId)), getDocs(collection(db, 'branches'))])
                setBranches(branchSnap.docs.map(d => ({ id: d.id, name: String((d.data() as any).name || (d.data() as any).branchName || d.id) })))
                const program = programSnap.data() as any
                if (!program) return
                setProgramName(program.programName || program.name || program.title || null)
                const assigned = program.assignedBranch || program.assignedBranches?.[0] || null
                const branchId = assigned?.id || program.assignedBranchId || null
                if (branchId) setProgramBranch({ id: branchId, name: assigned?.name || program.assignedBranchName || branchId })
                setDocs((program.programRequirements || []).map((r: any): DocRow => {
                    const title = String(r.title || r.preset || r.key || 'Document')
                    return {
                        key: String(r.key || r.preset || r.id || `title:${title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`),
                        title,
                        requiresExpiry: !!r.hasExpiry,
                        expiryMonths: r.expiryMonths ?? null,
                        group: r.requiredAtPreIncubation ? 'preinc' : r.requiredAtGap ? 'gap' : 'application',
                        required: !isMoa(title) && !r.requiredAtGap && !r.requiredAtPreIncubation,
                        file: null,
                        issueDate: null,
                        expiryDate: null
                    }
                }))
            } catch (err) {
                console.error(err)
                message.error('Couldn’t load this programme’s details.')
            } finally {
                setLoading(false)
            }
        })()
    }, [programId])

    // ---- live summary ----
    const values = Form.useWatch([], form) || {}
    const directors: Partial<Director>[] = values.directors || []
    const primaryIndex = values.primaryDirector ?? 0
    const primary = directors[primaryIndex]
    const checklist = [
        { key: 'company', label: 'Company', done: !!values.companyName?.trim() && isValidZARegistration(values.registrationNumber || '') && !!values.sector },
        { key: 'directors', label: 'Directors', done: directors.length > 0 && directors.every(d => d?.name?.trim()) && !!primary?.email && !!primary?.phone },
        { key: 'location', label: 'Ownership & location', done: !!values.province },
        { key: 'placement', label: 'Placement', done: !!values.stage }
    ]
    const requiredDocs = docs.filter(d => d.required)
    const attachedRequired = requiredDocs.filter(d => d.file && !docProblem(d)).length
    const trading = yearsSince(values.dateOfRegistration ? (values.dateOfRegistration as Dayjs).format('YYYY-MM-DD') : null)
    const filledHistory = useMemo(
        () => Object.values(values.history || {}).filter((r: any) => r && Object.values(r).some(v => v !== undefined && v !== null)).length,
        [values.history]
    )

    const patchDoc = (key: string, patch: Partial<DocRow>) => setDocs(current => current.map(d => (d.key === key ? { ...d, ...patch } : d)))

    const checkDuplicate = async (raw: string) => {
        setDuplicate(null)
        if (!isValidZARegistration(raw)) return
        try {
            const existing = await findExistingSme(raw)
            if (existing) setDuplicate(existing)
        } catch {
            // A failed lookup shouldn't stop anyone adding the SME.
        }
    }

    const save = async () => {
        let v: any
        try {
            await form.validateFields()
            // Every value, including the folded sections' fields that aren't mounted.
            v = form.getFieldsValue(true)
        } catch {
            message.error('Some details still need attention.')
            return
        }
        // Documents are optional, but an attached one needs its dates.
        const problems = docs.filter(docProblem)
        if (problems.length) {
            setShowDocProblems(true)
            setOpenDocs(true)
            message.error(`${problems[0].title}: ${docProblem(problems[0])!.toLowerCase()}.`)
            return
        }
        if (!programId) return

        const periods = historyPeriods()
        const history = v.history || {}
        const pick = (kind: 'monthly' | 'annual', field: string) =>
            Object.fromEntries(periods.filter(p => p.kind === kind && history[p.key]?.[field] != null).map(p => [p.key, Number(history[p.key][field])]))
        const staff = (kind: 'monthly' | 'annual') =>
            Object.fromEntries(periods
                .filter(p => p.kind === kind && (history[p.key]?.permanent != null || history[p.key]?.temporary != null))
                .map(p => [p.key, { permanent: Number(history[p.key].permanent || 0), temporary: Number(history[p.key].temporary || 0) }]))

        const branchId = v.branchId || programBranch?.id || null
        const input: SmeInput = {
            companyName: v.companyName,
            registrationNumber: v.registrationNumber,
            dateOfRegistration: v.dateOfRegistration ? (v.dateOfRegistration as Dayjs).format('YYYY-MM-DD') : null,
            sector: v.sector,
            natureOfBusiness: v.natureOfBusiness,
            beeLevel: v.beeLevel,
            directors: (v.directors || []).map((d: any, i: number) => ({ ...d, gender: d.gender || null, isPrimary: i === (v.primaryDirector ?? 0) })),
            blackOwnedPercent: v.blackOwnedPercent,
            femaleOwnedPercent: v.femaleOwnedPercent,
            youthOwnedPercent: v.youthOwnedPercent,
            businessAddress: v.businessAddress,
            city: v.city,
            postalCode: v.postalCode,
            province: v.province,
            hub: v.hub,
            location: v.location,
            stage: v.stage as Stage,
            branchId,
            branchName: branches.find(b => b.id === branchId)?.name || programBranch?.name || null,
            revenue: { monthly: pick('monthly', 'revenue'), annual: pick('annual', 'revenue') },
            headcount: { monthly: staff('monthly'), annual: staff('annual') },
            documents: docs.map(d => ({
                key: d.key,
                title: d.title,
                file: d.file,
                issueDate: d.issueDate?.format('YYYY-MM-DD') || null,
                expiryDate: d.requiresExpiry ? d.expiryDate?.format('YYYY-MM-DD') || null : null,
                group: d.group
            }))
        }

        setSaving(true)
        try {
            const result = await createSme(
                input,
                { programId, programName, requiredDocKeys: requiredDocs.map(d => d.key) },
                { email: user?.email || null, name: (user as any)?.name || null }
            )
            const invited = sendInvite ? await inviteSme(input) : false
            if (result.failedUploads.length) {
                message.warning(`${input.companyName} was added, but ${result.failedUploads.join(', ')} didn’t upload. Add them from the SME’s compliance documents.`)
            } else {
                message.success(
                    sendInvite
                        ? invited
                            ? `${input.companyName} was added and its main contact invited.`
                            : `${input.companyName} was added, but the invite couldn’t be sent. Try again from the participants page.`
                        : `${input.companyName} was added.`
                )
            }
            navigate('/participants')
        } catch (err) {
            console.error(err)
            message.error('The SME couldn’t be saved. Nothing was created; try again.')
        } finally {
            setSaving(false)
        }
    }

    const enter = (i: number) =>
        reduceMotion ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.28, ease: 'easeOut' as const, delay: i * 0.04 } }

    if (loading) return <DashboardLoader label='Loading the programme' />

    const summary = (
        <aside className='sf-summary' aria-label='Summary'>
            <div className='sf-summary-name'>{values.companyName?.trim() || 'New SME'}</div>
            <div className='sf-summary-sub'>{[programName, values.stage ? `Group ${values.stage === 'Graduated' ? 'Graduated' : values.stage}` : null].filter(Boolean).join(' · ')}</div>
            <ul className='sf-checklist'>
                {checklist.map(c => (
                    <li key={c.key} className={c.done ? 'is-done' : ''}>
                        <CheckCircleFilled aria-hidden='true' />
                        <span>{c.label}</span>
                        <span className='sf-sr'>{c.done ? 'complete' : 'incomplete'}</span>
                    </li>
                ))}
                <li className={`is-optional${attachedRequired ? ' is-done' : ''}`}>
                    <CheckCircleFilled aria-hidden='true' />
                    <span>Documents</span>
                    <span className='sf-checklist-count'>{attachedRequired}/{requiredDocs.length}</span>
                </li>
            </ul>
            <Checkbox checked={sendInvite} onChange={e => setSendInvite(e.target.checked)} className='sf-invite'>
                Invite {primary?.name?.trim() ? primary.name.trim().split(/\s+/)[0] : 'the main contact'} to the platform
            </Checkbox>
            <Button type='primary' block size='large' icon={<SaveOutlined />} loading={saving} onClick={save}>
                Save SME
            </Button>
            <Button block type='text' onClick={() => navigate(-1)} disabled={saving}>
                Cancel
            </Button>
        </aside>
    )

    return (
        <div className='sf-page'>
            <Helmet>
                <title>Add SME | Smart Incubation</title>
            </Helmet>
            {saving && <DashboardLoader overlay backdrop='translucent' label='Saving the SME' />}

            <header className='sf-header'>
                <Button type='text' icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} aria-label='Back to participants' />
                <div>
                    <h1 className='sf-title'>Add SME</h1>
                    {programName && <div className='sf-subtitle'>{programName}</div>}
                </div>
            </header>

            <Form
                form={form}
                layout='vertical'
                requiredMark='optional'
                scrollToFirstError={{ block: 'center', behavior: 'smooth' }}
                initialValues={{ directors: [{ gender: '' }], primaryDirector: 0, stage: 'A' }}
                className='sf-layout'
            >
                <div className='sf-main'>
                    <motion.div {...enter(0)}>
                        <Section n={1} title='Company' done={checklist[0].done}>
                            <Row gutter={[12, 0]}>
                                <Col xs={24}>
                                    <Form.Item name='companyName' label='Company name' rules={[{ required: true, whitespace: true, message: 'Enter the company name' }]}>
                                        <Input autoComplete='organization' />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item
                                        name='registrationNumber'
                                        label='Registration (CK) number'
                                        normalize={v => normaliseRegistration(v || '')}
                                        validateStatus={duplicate ? 'warning' : undefined}
                                        help={duplicate ? `Already on the platform as ${duplicate.name}${duplicate.programName ? ` (${duplicate.programName})` : ''}.` : undefined}
                                        rules={[
                                            { required: true, message: 'Enter the registration number' },
                                            { validator: (_, v) => (!v || isValidZARegistration(v) ? Promise.resolve() : Promise.reject(new Error('Use the CIPC format, e.g. 2017/216465/07'))) }
                                        ]}
                                    >
                                        <Input placeholder='2017/216465/07' onBlur={e => checkDuplicate(e.target.value)} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name='dateOfRegistration' label='Date registered' extra={trading != null ? `${trading} year${trading === 1 ? '' : 's'} trading` : undefined}>
                                        <DatePicker style={{ width: '100%' }} format='D MMM YYYY' disabledDate={c => c.isAfter(dayjs())} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name='sector' label='Sector' rules={[{ required: true, message: 'Choose a sector' }]}>
                                        <Select showSearch placeholder='Choose a sector' options={SECTORS.map(s => ({ value: s, label: s }))} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name='beeLevel' label='B-BBEE level'>
                                        <Select allowClear placeholder='Choose a level' options={BEE_LEVELS.map(l => ({ value: l, label: /^\d$/.test(l) ? `Level ${l}` : l }))} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24}>
                                    <Form.Item name='natureOfBusiness' label='What the business does'>
                                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} placeholder='e.g. Steel fabrication and construction services' />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </Section>
                    </motion.div>

                    <motion.div {...enter(1)}>
                        <Section n={2} title='Directors' hint='Add everyone listed as a director. The main contact receives the platform invite.' done={checklist[1].done}>
                            <DirectorsSection />
                        </Section>
                    </motion.div>

                    <motion.div {...enter(2)}>
                        <Section n={3} title='Ownership & location' done={checklist[2].done}>
                            <Row gutter={[12, 0]}>
                                {[
                                    { name: 'blackOwnedPercent', label: 'Black owned' },
                                    { name: 'femaleOwnedPercent', label: 'Women owned' },
                                    { name: 'youthOwnedPercent', label: 'Youth owned' }
                                ].map(o => (
                                    <Col xs={8} key={o.name}>
                                        <Form.Item name={o.name} label={o.label}>
                                            <InputNumber min={0} max={100} precision={0} suffix='%' placeholder='0' style={{ width: '100%' }} />
                                        </Form.Item>
                                    </Col>
                                ))}
                                <Col xs={24} md={12}>
                                    <Form.Item name='province' label='Province' rules={[{ required: true, message: 'Choose a province' }]}>
                                        <Select showSearch placeholder='Choose a province' options={SA_PROVINCES.map(p => ({ value: p, label: p }))} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name='city' label='City or town'>
                                        <Input />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={16}>
                                    <Form.Item name='businessAddress' label='Business address'>
                                        <Input autoComplete='street-address' />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={8}>
                                    <Form.Item name='postalCode' label='Postal code' normalize={v => String(v || '').replace(/\D/g, '').slice(0, 4)}>
                                        <Input inputMode='numeric' />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name='hub' label='Host community'>
                                        <Input />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name='location' label='Area type'>
                                        <Segmented block options={['Urban', 'Township', 'Rural']} />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </Section>
                    </motion.div>

                    <motion.div {...enter(3)}>
                        <Section n={4} title='Placement' done={checklist[3].done}>
                            <Row gutter={[12, 0]}>
                                <Col xs={24} md={12}>
                                    <Form.Item name='stage' label='Starting group' rules={[{ required: true, message: 'Choose a group' }]}>
                                        <Segmented block options={STAGES.map(s => ({ value: s, label: s === 'Graduated' ? 'Graduated' : `Group ${s}` }))} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name='branchId' label='Branch'>
                                        <Select
                                            allowClear
                                            showSearch
                                            optionFilterProp='label'
                                            placeholder={programBranch ? `${programBranch.name} (programme default)` : 'Choose a branch'}
                                            options={branches.map(b => ({ value: b.id, label: b.name }))}
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </Section>
                    </motion.div>

                    <motion.div {...enter(4)}>
                        <Optional
                            id='sf-docs'
                            title='Documents'
                            status={requiredDocs.length ? `${attachedRequired} of ${requiredDocs.length} attached` : 'None required'}
                            open={openDocs}
                            onToggle={() => setOpenDocs(o => !o)}
                        >
                            <Alert
                                type='info'
                                showIcon
                                icon={<InfoCircleOutlined />}
                                className='sf-note'
                                message='Documents can be added now or later from the SME’s compliance page. Missing ones lower the compliance score.'
                            />
                            <DocumentsSection docs={docs} onChange={patchDoc} showProblems={showDocProblems} />
                        </Optional>
                    </motion.div>

                    <motion.div {...enter(5)}>
                        <Optional
                            id='sf-history'
                            title='Revenue & staff'
                            status={filledHistory ? `${filledHistory} period${filledHistory === 1 ? '' : 's'} filled` : 'Last 3 months and 2 years'}
                            open={openHistory}
                            onToggle={() => setOpenHistory(o => !o)}
                        >
                            <HistorySection />
                        </Optional>
                    </motion.div>

                    {isPhone && summary}
                </div>

                {!isPhone && <div className='sf-side'>{summary}</div>}
            </Form>
        </div>
    )
}

export default ParticipantOnboardingForm
