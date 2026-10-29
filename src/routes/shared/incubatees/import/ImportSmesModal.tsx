import React, { useEffect, useMemo, useState } from 'react'
import { Alert, AutoComplete, Button, Checkbox, Input, Modal, Progress, Segmented, Select, Steps, Upload, message } from 'antd'
import { CheckCircleFilled, FileExcelOutlined, InboxOutlined, WarningFilled } from '@ant-design/icons'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { createSme, genderFromSouthAfricanID, inviteSme, type SmeInput } from '@/routes/operations/participants/new/smeRecords'
import { StatusPill } from '@/routes/operations/movs/movParts'
import '@/routes/operations/movs/movs.css'
import {
    FIELD_LABELS,
    ISSUE_LABELS,
    SME_STATUSES,
    collectSmes,
    matchBranch,
    parseWorkbook,
    setColumnField,
    type FieldKey,
    type ImportedSme,
    type IncubationGroup,
    type ParsedSheet,
    type SheetRole
} from './workbook'
import './importSmes.css'

type Step = 'file' | 'sheets' | 'columns' | 'review' | 'importing' | 'done'

type Props = {
    open: boolean
    onClose: () => void
    /** Called after anything was imported, so the list can reload. */
    onImported: () => void
    programId: string | null
    actor: { email: string | null; name: string | null }
}

type Branch = { id: string; name: string }
type Existing = { id: string; name: string; programName: string | null }

const INTAKE_TEXT: Record<string, string> = {
    applications: 'SMEs normally apply to this programme',
    direct: 'SMEs are added directly to this programme',
    migrated: 'This programme is being moved in from before the system'
}

const GROUPS: IncubationGroup[] = ['A', 'B', 'C', 'Graduated']

const chunk = <T,>(items: T[], size: number) =>
    Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size))

/**
 * Import SMEs from a branch's Excel list into the programme in view.
 *
 * The lists differ from branch to branch, so the importer reads what it can
 * and asks about the rest: what each sheet is (the full list, a group, a
 * status or category, or skip), what each column holds, and which branch each
 * office means. SMEs on several sheets are imported once; SMEs already on the
 * platform are left alone. Nothing is written until the last step.
 */
export const ImportSmesModal: React.FC<Props> = ({ open, onClose, onImported, programId, actor }) => {
    const [step, setStep] = useState<Step>('file')
    const [fileName, setFileName] = useState('')
    const [sheets, setSheets] = useState<ParsedSheet[]>([])
    const [reading, setReading] = useState(false)

    const [program, setProgram] = useState<{ name: string | null; intakeMode: string | null; branch: Branch | null } | null>(null)
    const [branches, setBranches] = useState<Branch[]>([])
    const [officeBranch, setOfficeBranch] = useState<Record<string, string>>({})
    const [defaultBranch, setDefaultBranch] = useState<string>('')

    const [existing, setExisting] = useState<Map<string, Existing>>(new Map())
    const [checking, setChecking] = useState(false)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [reviewFilter, setReviewFilter] = useState<'import' | 'existing' | 'issues' | 'all'>('import')
    const [sendInvites, setSendInvites] = useState(false)

    const [progress, setProgress] = useState({ done: 0, total: 0 })
    const [failures, setFailures] = useState<{ name: string; reason: string }[]>([])

    // ---- the programme and branches ----
    useEffect(() => {
        if (!open || !programId) return
        let cancelled = false
        ;(async () => {
            const [programSnap, branchSnap] = await Promise.all([getDoc(doc(db, 'programs', programId)), getDocs(collection(db, 'branches'))])
            if (cancelled) return
            const p = programSnap.data() as any
            const assigned = p?.assignedBranch || null
            const branchList = branchSnap.docs.map(d => ({ id: d.id, name: String((d.data() as any).name || (d.data() as any).branchName || d.id) }))
            setBranches(branchList)
            setProgram({
                name: p?.name || p?.programName || null,
                intakeMode: p?.intakeMode || null,
                branch: assigned?.id ? { id: assigned.id, name: assigned.name || assigned.id } : null
            })
            setDefaultBranch(assigned?.id || '')
        })().catch(err => {
            console.error(err)
            message.error('Couldn’t load the programme.')
        })
        return () => {
            cancelled = true
        }
    }, [open, programId])

    const reset = () => {
        setStep('file')
        setFileName('')
        setSheets([])
        setOfficeBranch({})
        setExisting(new Map())
        setSelected(new Set())
        setReviewFilter('import')
        setSendInvites(false)
        setProgress({ done: 0, total: 0 })
        setFailures([])
    }

    const close = () => {
        if (step === 'importing') return
        reset()
        onClose()
    }

    // ---- reading the file ----
    const readFile = async (file: File) => {
        setReading(true)
        try {
            const parsed = parseWorkbook(new Uint8Array(await file.arrayBuffer()))
            if (!parsed.some(s => s.rows.length)) {
                message.error('No sheet in this file has a “Company name” column with SMEs under it.')
                return
            }
            setFileName(file.name)
            setSheets(parsed)
            setStep('sheets')
        } catch (err) {
            console.error(err)
            message.error('This file couldn’t be read. Save it as .xlsx and try again.')
        } finally {
            setReading(false)
        }
    }

    const usedSheets = sheets.filter(s => s.rows.length && s.role.kind !== 'skip')
    const smes = useMemo(() => collectSmes(sheets), [sheets])

    // Offices named in the file, matched to branches where it's clear.
    const offices = useMemo(() => {
        const counts = new Map<string, number>()
        smes.forEach(s => s.office && counts.set(s.office, (counts.get(s.office) || 0) + 1))
        return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
    }, [smes])
    useEffect(() => {
        setOfficeBranch(current => {
            const next = { ...current }
            offices.forEach(([office]) => {
                if (next[office] === undefined) next[office] = matchBranch(office, branches) || ''
            })
            return next
        })
    }, [offices, branches])

    const branchFor = (sme: ImportedSme): Branch | null => {
        const id = (sme.office && officeBranch[sme.office]) || defaultBranch
        return branches.find(b => b.id === id) || null
    }

    // ---- columns: one row per distinct heading across the sheets in use ----
    const columnRows = useMemo(() => {
        const byHeader = new Map<string, { header: string; field: FieldKey; sample: string; sheets: string[]; detectedFrom?: string }>()
        usedSheets.forEach(s =>
            s.columns.forEach(c => {
                const row = byHeader.get(c.header)
                if (row) row.sheets.push(s.name)
                else byHeader.set(c.header, { header: c.header, field: c.field, sample: c.sample, sheets: [s.name], detectedFrom: c.detectedFrom })
            })
        )
        return Array.from(byHeader.values())
    }, [usedSheets])

    // ---- which SMEs are already on the platform ----
    const checkExisting = async () => {
        setChecking(true)
        try {
            const found = new Map<string, Existing>()
            const regs = smes.filter(s => s.registrationNumber).map(s => s.registrationNumber)
            for (const batch of chunk(Array.from(new Set(regs)), 10)) {
                const snap = await getDocs(query(collection(db, 'participants'), where('registrationNumber', 'in', batch)))
                snap.docs.forEach(d => {
                    const data = d.data() as any
                    const sme = smes.find(s => s.registrationNumber === data.registrationNumber)
                    if (sme) found.set(sme.key, { id: d.id, name: data.beneficiaryName || data.companyName || 'An SME', programName: data.programName || null })
                })
            }
            const names = smes.filter(s => !found.has(s.key)).map(s => s.companyName)
            for (const batch of chunk(Array.from(new Set(names)), 10)) {
                const snap = await getDocs(query(collection(db, 'participants'), where('beneficiaryName', 'in', batch)))
                snap.docs.forEach(d => {
                    const data = d.data() as any
                    smes
                        .filter(s => s.companyName === data.beneficiaryName && !found.has(s.key))
                        .forEach(s => found.set(s.key, { id: d.id, name: data.beneficiaryName, programName: data.programName || null }))
                })
            }
            setExisting(found)
            setSelected(new Set(smes.filter(s => !found.has(s.key)).map(s => s.key)))
            setStep('review')
        } catch (err) {
            console.error(err)
            message.error('Couldn’t check which SMEs are already on the platform.')
        } finally {
            setChecking(false)
        }
    }

    // ---- importing ----
    const toInput = (sme: ImportedSme): SmeInput => {
        const branch = branchFor(sme)
        return {
            companyName: sme.companyName,
            registrationNumber: sme.registrationNumber,
            sector: sme.sector,
            natureOfBusiness: sme.natureOfBusiness || sme.productsServices,
            beeLevel: sme.beeLevel,
            directors: sme.directors.map((name, i) => ({
                name,
                email: i === 0 ? sme.email : null,
                phone: i === 0 ? sme.phone : null,
                idNumber: i === 0 ? sme.idNumber : null,
                gender: i === 0 && sme.idNumber ? genderFromSouthAfricanID(sme.idNumber) : null,
                isPrimary: i === 0
            })),
            blackOwnedPercent: sme.blackOwnedPercent,
            femaleOwnedPercent: sme.femaleOwnedPercent,
            youthOwnedPercent: sme.youthOwnedPercent,
            businessAddress: sme.businessAddress || sme.workshopAddress,
            location: sme.ward,
            stage: sme.group || 'A',
            incubationStatus: sme.status || 'Active',
            branchId: branch?.id || null,
            branchName: branch?.name || null,
            documents: [],
            importInfo: {
                fileName,
                sheets: Array.from(new Set(sme.sources.map(s => s.sheet))),
                labels: sme.labels,
                office: sme.office,
                ward: sme.ward,
                productsServices: sme.productsServices,
                workshopAddress: sme.workshopAddress,
                disabilityOwnedPercent: sme.disabilityOwnedPercent,
                preAssessmentForm: sme.preAssessment,
                preIncubationContract: sme.preIncubationContract,
                notes: sme.notes,
                issues: sme.issues,
                importedAt: new Date().toISOString(),
                importedBy: actor.email
            }
        }
    }

    const runImport = async () => {
        if (!programId) return
        const chosen = smes.filter(s => selected.has(s.key))
        setStep('importing')
        setProgress({ done: 0, total: chosen.length })
        const failed: { name: string; reason: string }[] = []
        for (const sme of chosen) {
            try {
                const input = toInput(sme)
                await createSme(input, { programId, programName: program?.name || null, requiredDocKeys: [] }, actor)
                if (sendInvites && sme.email) await inviteSme(input)
            } catch (err: any) {
                console.error('Import failed for', sme.companyName, err)
                failed.push({ name: sme.companyName, reason: err?.message || 'Could not be saved' })
            }
            setProgress(p => ({ ...p, done: p.done + 1 }))
        }
        setFailures(failed)
        setStep('done')
        if (chosen.length > failed.length) onImported()
    }

    // ---- what the review shows ----
    const reviewRows = smes.filter(s => {
        if (reviewFilter === 'existing') return existing.has(s.key)
        if (reviewFilter === 'issues') return !existing.has(s.key) && s.issues.length > 0
        if (reviewFilter === 'import') return selected.has(s.key)
        return true
    })
    const counts = {
        new: smes.filter(s => !existing.has(s.key)).length,
        existing: existing.size,
        issues: smes.filter(s => !existing.has(s.key) && s.issues.length).length,
        selected: selected.size,
        withEmail: smes.filter(s => selected.has(s.key) && s.email).length
    }

    const stepIndex = { file: 0, sheets: 1, columns: 2, review: 3, importing: 3, done: 3 }[step]
    const unclearSheets = usedSheets.filter(s => s.roleIsGuess).length

    const footer =
        step === 'sheets' ? (
            <div className='imp-footer'>
                <Button onClick={() => setStep('file')}>Back</Button>
                <Button type='primary' disabled={!usedSheets.length} onClick={() => setStep('columns')}>
                    Next: columns
                </Button>
            </div>
        ) : step === 'columns' ? (
            <div className='imp-footer'>
                <Button onClick={() => setStep('sheets')}>Back</Button>
                <Button
                    type='primary'
                    loading={checking}
                    disabled={!columnRows.some(c => c.field === 'companyName')}
                    onClick={() => void checkExisting()}
                >
                    Next: review {smes.length} SMEs
                </Button>
            </div>
        ) : step === 'review' ? (
            <div className='imp-footer'>
                <Button onClick={() => setStep('columns')}>Back</Button>
                <Button type='primary' disabled={!counts.selected} onClick={() => void runImport()}>
                    Import {counts.selected} SME{counts.selected === 1 ? '' : 's'}
                </Button>
            </div>
        ) : step === 'done' ? (
            <div className='imp-footer'>
                <Button type='primary' onClick={close}>
                    Done
                </Button>
            </div>
        ) : null

    return (
        <Modal
            open={open}
            onCancel={close}
            closable={step !== 'importing'}
            maskClosable={false}
            title='Import SMEs from Excel'
            width={980}
            footer={footer}
            destroyOnClose
        >
            <Steps
                size='small'
                current={stepIndex}
                className='imp-steps'
                items={[{ title: 'File' }, { title: 'Sheets' }, { title: 'Columns' }, { title: 'Review' }]}
            />

            {step === 'file' && (
                <div className='imp-body'>
                    <div className='imp-program'>
                        Importing into <strong>{program?.name || 'this programme'}</strong>
                        {program?.intakeMode && <span className='imp-muted'> · {INTAKE_TEXT[program.intakeMode] || ''}</span>}
                    </div>
                    {program?.intakeMode === 'applications' && (
                        <Alert
                            type='info'
                            showIcon
                            message='This programme takes applications.'
                            description='Imported SMEs are added straight in as participants, without applying.'
                        />
                    )}
                    <Upload.Dragger
                        accept='.xlsx,.xls,.csv'
                        multiple={false}
                        showUploadList={false}
                        disabled={reading}
                        beforeUpload={file => {
                            void readFile(file)
                            return false
                        }}
                    >
                        <p className='ant-upload-drag-icon'>
                            <InboxOutlined />
                        </p>
                        <p className='ant-upload-text'>{reading ? 'Reading the file…' : 'Click or drop the branch’s SME list here'}</p>
                        <p className='ant-upload-hint'>Excel (.xlsx). Every sheet with a “Company name” column is read; nothing is saved until the last step.</p>
                    </Upload.Dragger>
                </div>
            )}

            {step === 'sheets' && (
                <div className='imp-body'>
                    <div className='imp-intro'>
                        <FileExcelOutlined /> <strong>{fileName}</strong>
                        <span className='imp-muted'>
                            {' '}
                            · Tell us what each sheet is. An SME on several sheets is imported once.
                            {unclearSheets > 0 && ` ${unclearSheets} sheet${unclearSheets === 1 ? '' : 's'} need${unclearSheets === 1 ? 's' : ''} a check.`}
                        </span>
                    </div>
                    <div className='imp-list'>
                        {sheets
                            .filter(s => s.rows.length)
                            .map(s => (
                                <div key={s.name} className={`imp-sheet${s.role.kind === 'skip' ? ' is-skipped' : ''}`}>
                                    <div className='imp-sheet-main'>
                                        <div className='imp-sheet-name'>
                                            {s.name}
                                            <span className='imp-count'>{s.rows.length} SME{s.rows.length === 1 ? '' : 's'}</span>
                                            {s.roleIsGuess && <StatusPill tone='warning'>Check this</StatusPill>}
                                        </div>
                                        {s.title && <div className='imp-muted imp-sheet-title'>{s.title}</div>}
                                    </div>
                                    <div className='imp-sheet-role'>
                                        <Segmented
                                            size='small'
                                            value={s.role.kind}
                                            onChange={kind => {
                                                const role: SheetRole =
                                                    kind === 'group'
                                                        ? { kind: 'group', group: 'B' }
                                                        : kind === 'status'
                                                            ? { kind: 'status', status: 'Dormant' }
                                                        : kind === 'label'
                                                            ? { kind: 'label', label: s.name.trim() }
                                                            : { kind: kind as 'main' | 'skip' }
                                                setSheets(all => all.map(x => (x.name === s.name ? { ...x, role, roleIsGuess: false } : x)))
                                            }}
                                            options={[
                                                { value: 'main', label: 'All SMEs' },
                                                { value: 'group', label: 'A group' },
                                                { value: 'status', label: 'A status' },
                                                { value: 'label', label: 'A label' },
                                                { value: 'skip', label: 'Skip' }
                                            ]}
                                        />
                                        {s.role.kind === 'group' && (
                                            <Segmented
                                                size='small'
                                                value={s.role.group}
                                                onChange={group =>
                                                    setSheets(all =>
                                                        all.map(x => (x.name === s.name ? { ...x, role: { kind: 'group', group: group as IncubationGroup }, roleIsGuess: false } : x))
                                                    )
                                                }
                                                options={GROUPS.map(g => ({ value: g, label: g === 'Graduated' ? 'Graduated' : `Group ${g}` }))}
                                            />
                                        )}
                                        {s.role.kind === 'status' && (
                                            <AutoComplete
                                                size='small'
                                                className='imp-status-input'
                                                value={s.role.status}
                                                aria-label={`Status for SMEs on ${s.name}`}
                                                placeholder='e.g. Dormant'
                                                options={SME_STATUSES.map(v => ({ value: v }))}
                                                filterOption={false}
                                                onChange={value =>
                                                    setSheets(all =>
                                                        all.map(x => (x.name === s.name ? { ...x, role: { kind: 'status', status: String(value) }, roleIsGuess: false } : x))
                                                    )
                                                }
                                            />
                                        )}
                                        {s.role.kind === 'label' && (
                                            <Input
                                                size='small'
                                                value={s.role.label}
                                                placeholder='e.g. Dormant, Mining'
                                                aria-label={`Label for SMEs on ${s.name}`}
                                                onChange={e =>
                                                    setSheets(all =>
                                                        all.map(x => (x.name === s.name ? { ...x, role: { kind: 'label', label: e.target.value }, roleIsGuess: false } : x))
                                                    )
                                                }
                                            />
                                        )}
                                    </div>
                                </div>
                            ))}
                    </div>
                    <div className='imp-muted imp-help'>
                        <strong>All SMEs</strong>: the sheet lists SMEs to import. <strong>A group</strong>: these SMEs are in Group B, C, …
                        <strong> A status</strong>: where they are (Soft incubation, Dormant, Potential exit, Exited).
                        <strong> A label</strong>: any other category (Mining, a funder) saved on each SME. <strong>Skip</strong>: not imported.
                    </div>
                </div>
            )}

            {step === 'columns' && (
                <div className='imp-body'>
                    <div className='imp-intro imp-muted'>Check what each column holds. Columns you don’t need can stay as notes or be left out.</div>
                    <div className='imp-columns'>
                        {columnRows.map(c => (
                            <div key={c.header} className='imp-column'>
                                <div className='imp-column-main'>
                                    <div className='imp-column-name'>{c.header}</div>
                                    <div className='imp-muted imp-column-sample' title={c.sample}>
                                        e.g. {c.sample}
                                        {c.sheets.length > 1 && ` · on ${c.sheets.length} sheets`}
                                    </div>
                                    {c.detectedFrom && (
                                        <div className='imp-warn'>
                                            <WarningFilled /> {c.detectedFrom}, not what its heading says.
                                        </div>
                                    )}
                                </div>
                                <Select
                                    className='imp-column-select'
                                    value={c.field}
                                    onChange={(field: FieldKey) => setSheets(all => setColumnField(all, c.header, field))}
                                    options={(Object.keys(FIELD_LABELS) as FieldKey[]).map(k => ({ value: k, label: FIELD_LABELS[k] }))}
                                    aria-label={`What ${c.header} holds`}
                                />
                            </div>
                        ))}
                    </div>

                    <h4 className='imp-subtitle'>Branches</h4>
                    {offices.length > 0 && (
                        <div className='imp-columns'>
                            {offices.map(([office, n]) => (
                                <div key={office} className='imp-column'>
                                    <div className='imp-column-main'>
                                        <div className='imp-column-name'>“{office}”</div>
                                        <div className='imp-muted'>{n} SME{n === 1 ? '' : 's'}</div>
                                    </div>
                                    <Select
                                        className='imp-column-select'
                                        value={officeBranch[office] || undefined}
                                        placeholder='Choose a branch'
                                        allowClear
                                        onChange={id => setOfficeBranch(m => ({ ...m, [office]: id || '' }))}
                                        options={branches.map(b => ({ value: b.id, label: b.name }))}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                    <div className='imp-column'>
                        <div className='imp-column-main'>
                            <div className='imp-column-name'>{offices.length ? 'SMEs with no office, or one not chosen above' : 'Branch for these SMEs'}</div>
                            <div className='imp-muted'>Defaults to the programme’s branch</div>
                        </div>
                        <Select
                            className='imp-column-select'
                            value={defaultBranch || undefined}
                            placeholder='No branch'
                            allowClear
                            onChange={id => setDefaultBranch(id || '')}
                            options={branches.map(b => ({ value: b.id, label: b.name }))}
                        />
                    </div>
                </div>
            )}

            {step === 'review' && (
                <div className='imp-body'>
                    <Segmented
                        block
                        className='mv-status-strip'
                        value={reviewFilter}
                        onChange={v => setReviewFilter(v as typeof reviewFilter)}
                        options={[
                            { value: 'import', label: <span className='mv-seg'>To import<span className='mv-seg-count qtx-tone-success'>{counts.selected}</span></span> },
                            { value: 'issues', label: <span className='mv-seg'>Need a look<span className='mv-seg-count qtx-tone-warning'>{counts.issues}</span></span> },
                            { value: 'existing', label: <span className='mv-seg'>Already here<span className='mv-seg-count qtx-tone-neutral'>{counts.existing}</span></span> },
                            { value: 'all', label: <span className='mv-seg'>All<span className='mv-seg-count qtx-tone-neutral'>{smes.length}</span></span> }
                        ]}
                    />
                    <div className='imp-review'>
                        {reviewRows.length === 0 ? (
                            <div className='imp-muted imp-empty'>Nothing here.</div>
                        ) : (
                            reviewRows.map(s => {
                                const already = existing.get(s.key)
                                const branch = branchFor(s)
                                const meta = [
                                    s.group ? (s.group === 'Graduated' ? 'Graduated' : `Group ${s.group}`) : 'Group A',
                                    s.status || 'Active',
                                    ...s.labels,
                                    branch?.name,
                                    s.registrationNumber || null
                                ].filter(Boolean)
                                return (
                                    <label key={s.key} className={`imp-sme${already ? ' is-existing' : ''}`}>
                                        <Checkbox
                                            disabled={!!already}
                                            checked={selected.has(s.key)}
                                            onChange={e =>
                                                setSelected(current => {
                                                    const next = new Set(current)
                                                    if (e.target.checked) next.add(s.key)
                                                    else next.delete(s.key)
                                                    return next
                                                })
                                            }
                                        />
                                        <div className='imp-sme-main'>
                                            <div className='imp-sme-name'>{s.companyName}</div>
                                            <div className='imp-muted imp-sme-meta'>
                                                {s.directors[0] || 'No director'} · {meta.join(' · ')}
                                            </div>
                                            {(already || s.issues.length > 0) && (
                                                <div className='mv-row-flags'>
                                                    {already ? (
                                                        <span className='mv-flag is-neutral'>
                                                            Already on the platform{already.programName ? ` (${already.programName})` : ''}
                                                        </span>
                                                    ) : (
                                                        s.issues.map(i => (
                                                            <span key={i} className='mv-flag is-warning'>
                                                                {ISSUE_LABELS[i]}
                                                            </span>
                                                        ))
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <span className='imp-muted imp-sme-source'>
                                            {s.sources.length > 1 ? `${s.sources.length} sheets` : s.sources[0]?.sheet}
                                        </span>
                                    </label>
                                )
                            })
                        )}
                    </div>
                    <Checkbox checked={sendInvites} onChange={e => setSendInvites(e.target.checked)}>
                        Email each imported SME an invite to the platform ({counts.withEmail} have an email address)
                    </Checkbox>
                </div>
            )}

            {step === 'importing' && (
                <div className='imp-body imp-center'>
                    <Progress type='circle' percent={progress.total ? Math.round((progress.done / progress.total) * 100) : 0} />
                    <div>
                        Importing {progress.done} of {progress.total}… Keep this window open.
                    </div>
                </div>
            )}

            {step === 'done' && (
                <div className='imp-body imp-center'>
                    <CheckCircleFilled className='imp-done-icon' />
                    <div className='imp-done-title'>
                        {progress.total - failures.length} SME{progress.total - failures.length === 1 ? '' : 's'} imported into {program?.name || 'the programme'}
                    </div>
                    {failures.length > 0 && (
                        <Alert
                            type='warning'
                            showIcon
                            message={`${failures.length} couldn’t be saved`}
                            description={
                                <ul className='imp-failures'>
                                    {failures.map(f => (
                                        <li key={f.name}>
                                            {f.name}: {f.reason}
                                        </li>
                                    ))}
                                </ul>
                            }
                        />
                    )}
                </div>
            )}
        </Modal>
    )
}
