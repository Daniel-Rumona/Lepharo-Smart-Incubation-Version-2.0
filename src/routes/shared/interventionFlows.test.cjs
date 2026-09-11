const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
const helperPath = resolve(__dirname, '../..', 'lib/appointmentAssignments.ts')
const helperModule = new Module(helperPath, module)
helperModule.paths = module.paths
helperModule._compile(ts.transpileModule(readFileSync(helperPath, 'utf8'), { compilerOptions: options }).outputText, helperPath)
const { assignmentCanOwnAppointment, assignmentDate, assignmentDateLabel, distinctAppointmentAssignments, assignmentOptionLabel, unambiguousAppointmentAssignment } = helperModule.exports

const assignment = (patch = {}) => ({
    id: 'december', participantId: 'sme', interventionId: 'template',
    programId: 'program', departmentId: 'department', assigneeId: 'facilitator',
    interventionTitle: 'Business planning', cycleKey: '2026',
    createdAt: '2025-12-10T12:00:00Z', ...patch
})

test('all three open allocation IDs remain selectable, even with the same template and cycle', () => {
    const december = assignment()
    const june = assignment({ id: 'june', createdAt: '2026-06-10T12:00:00Z' })
    const juneAgain = assignment({ id: 'june-again', createdAt: '2026-06-20T12:00:00Z' })
    const rows = distinctAppointmentAssignments([juneAgain, december, june, december])
    assert.deepEqual(rows.map(row => row.id), ['december', 'june', 'june-again'])
    assert.match(assignmentOptionLabel(june), /Assigned 10 Jun 2026.*Cycle 2026.*Ref june/)
})

test('assignment dates use semantic timestamps and never updatedAt or scheduled startDate', () => {
    assert.equal(assignmentDateLabel({ createdAt: '2026-06-10T12:00:00Z', updatedAt: '2026-12-01' }), '10 Jun 2026')
    assert.equal(assignmentDateLabel({ assignedAt: { toDate: () => new Date('2026-05-01T12:00:00Z') }, createdAt: '2026-06-01' }), '01 May 2026')
    assert.equal(assignmentDateLabel({ createdAt: { seconds: Date.parse('2026-06-10T12:00:00Z') / 1000 } }), '10 Jun 2026')
    assert.equal(assignmentDate({ startDate: '2026-01-01', updatedAt: '2026-01-02' }), null)
    assert.equal(assignmentDateLabel({ createdAt: 'invalid' }), 'Date not recorded')
})

test('missing links are not guessed using status, date or a first candidate', () => {
    const appointment = assignment({ id: 'appointment' })
    assert.equal(unambiguousAppointmentAssignment(appointment, [
        assignment({ assignmentStatus: 'completed' }),
        assignment({ id: 'june', assignmentStatus: 'assigned' })
    ]), null)
    assert.equal(unambiguousAppointmentAssignment(appointment, [assignment()]).id, 'december')
})

test('repair requires exact programme, department, cycle, SME, sub-intervention and assignee', () => {
    const appointment = assignment()
    for (const field of ['participantId', 'interventionId', 'programId', 'departmentId', 'cycleKey', 'subInterventionId', 'assigneeId']) {
        assert.equal(unambiguousAppointmentAssignment(appointment, [assignment({ [field]: 'other' })]), null, field)
    }
    assert.equal(unambiguousAppointmentAssignment(appointment, [assignment({ cycleKey: null })]), null)
})

test('an appointment cannot link to an assignment created after its appointment day', () => {
    const appointment = assignment({
        id: 'appointment',
        date: '2026-06-10T08:00:00Z',
        createdAt: '2026-06-10T08:52:00Z'
    })
    const june = assignment({ createdAt: '2026-06-10T09:00:00Z' })
    const august = assignment({ createdAt: '2026-08-06T09:00:00Z' })

    assert.equal(assignmentCanOwnAppointment(appointment, june), true)
    assert.equal(assignmentCanOwnAppointment(appointment, august), false)
    assert.equal(assignmentCanOwnAppointment(appointment, assignment({ participantId: 'other' })), false)
})

const allocatedPath = resolve(__dirname, 'allocated/index.tsx')
const source = readFileSync(allocatedPath, 'utf8')
const ast = ts.createSourceFile(allocatedPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function findNodes(predicate) {
    const result = []
    function visit(node) { if (predicate(node)) result.push(node); ts.forEachChild(node, visit) }
    visit(ast)
    return result
}

test('progress, completion and evidence manager have independent mounted form stores', () => {
    const forms = findNodes(node => ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'Form')
    const forStore = name => forms.filter(node => node.attributes.properties.some(prop =>
        ts.isJsxAttribute(prop) && prop.name.text === 'form' && prop.initializer?.getText(ast) === `{${name}}`
    ))
    for (const [store, key] of [['progressUpdateForm', 'progress-update'], ['completionEvidenceForm', 'completion-evidence']]) {
        const matches = forStore(store)
        assert.equal(matches.length, 1)
        const text = matches[0].getText(ast)
        assert.match(text, new RegExp(`key="${key}"`))
        assert.match(text, /onFinishFailed=/)
    }
    assert.equal(forStore('manageEvidenceForm').length, 1)
    assert.match(source, /: completionEvidenceForm.submit\(\)/)
})

test('single-SME group picker retains every file in a multiple selection and has a save action', () => {
    const callback = findNodes(node => ts.isArrowFunction(node) &&
        node.parameters[1]?.name.getText(ast) === 'selectedFiles')[0]
    const code = ts.transpileModule(`return (${callback.getText(ast)})`, { compilerOptions: options }).outputText
    let values = {}, pending = []
    const context = {
        groupEvidenceMemberId: 'sme-assignment', member: { id: 'sme-assignment' },
        setGroupEvidenceMemberId() {},
        setPendingEvidenceFiles: files => { pending = files },
        manageEvidenceForm: {
            getFieldValue: name => values[name],
            setFieldsValue: patch => { values = { ...values, ...patch } }
        }
    }
    const beforeUpload = new Function(...Object.keys(context), code)(...Object.values(context))
    const files = [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf'), new File(['c'], 'c.pdf')]
    files.forEach(file => assert.equal(beforeUpload(file, files), false))
    assert.deepEqual(pending.map(file => file.name), ['a.pdf', 'b.pdf', 'c.pdf'])
    assert.equal(values.files.length, 3)
    assert.match(source, /Upload selected files/)
    assert.match(source, /submitManageEvidence\(manageEvidenceForm.getFieldsValue\(true\)\)/)
})

test('appointment picker filters ownership and open lifecycle before retaining distinct single IDs', () => {
    const appointments = readFileSync(resolve(__dirname, 'appointments/index.tsx'), 'utf8')
    assert.match(appointments, /const ownedRows = Object.values\(byId\)[\s\S]*?belongsToCurrentUser[\s\S]*?resolveAssignmentLifecycle\(row as any\).isOpen/)
    assert.match(appointments, /\.\.\.ownedRows.filter\(row => !isGroupedIntervention\(row\)\)/)
    assert.match(appointments, /<Option key=\{interv.id\} value=\{interv.id\}>[\s\S]*?assignmentOptionLabel\(interv\)/)
    assert.match(appointments, /selectedScopeInterventions.find\(i => i.id === values.assignedIntervention\)/)
})

test('appointment workflow rejects future assignment links instead of trusting an existing id', () => {
    const appointments = readFileSync(resolve(__dirname, 'appointments/index.tsx'), 'utf8')
    assert.match(appointments, /directAssignment && assignmentCanOwnAppointment\(appointment, directAssignment\)/)
    assert.match(appointments, /The appointment date cannot be earlier than the selected assignment date\./)
    assert.match(appointments, /assignmentCanOwnAppointment\(\{/)
})

// Execute the actual submission function from the route, with only external
// services and React setters replaced. No Firebase credentials or writes.
const handlerNode = findNodes(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === 'submitManageEvidence')[0]
const handlerCode = ts.transpileModule(`return (${handlerNode.initializer.getText(ast)})`, { compilerOptions: options }).outputText
function harness(overrides = {}) {
    const warnings = [], errors = [], successes = [], uploads = [], movs = [], loading = []
    const record = assignment({ resources: [] })
    let savedResources = []
    const context = {
        manageEvidenceRecord: record, completionPendingRecord: null,
        evidenceSubmissionRef: { current: false }, evidenceMode: 'file',
        USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE: false,
        pendingEvidenceFiles: [], completionNeedsRecurrence: false, completionResolvedRecurrence: null,
        SUPPORTED_RECURRENCE_OPTIONS: [], recurrencePatch: value => ({ recurrencePreset: value }),
        isDocumentTarget: () => true, getDocumentEvidence: row => row.resources || [],
        getPoeResourcesFromRecord: row => row.resources || [],
        groupEvidenceMode: 'bulk', groupEvidenceMemberId: undefined,
        message: { warning: value => warnings.push(value), error: value => errors.push(value), success: value => successes.push(value) },
        getGroupMemberIdsForEvidence: async () => [record.id],
        setSavingEvidence: value => loading.push(value),
        uploadEvidenceFiles: async files => { uploads.push(...files); return files.map(file => ({ link: `https://test.invalid/${file.name}`, type: 'document' })) },
        updateDoc: async (_, patch) => { if (patch.resources) savedResources = patch.resources },
        getDoc: async () => ({ exists: () => true, data: () => ({ ...record, resources: savedResources }) }),
        doc: (...args) => args, db: {}, Timestamp: { now: () => new Date() },
        effectiveUser: { uid: 'test-facilitator' }, completionDeliveryValue: 'online',
        createMovDraftFromAssignment: async value => movs.push(value),
        manageEvidenceForm: { resetFields() {} }, completionEvidenceForm: { resetFields() {} },
        auth: { currentUser: { uid: 'test-facilitator' } },
        arrayUnion: value => value, normalizePoeResources: value => value,
        applyPoeStateLocally() {}, console: { error() {} },
        ...overrides
    }
    for (const name of ['setCompletedInterventions', 'setCompletionPendingRecord', 'setProgressModalOpen', 'setProgressModalStep', 'setProgressRecord', 'setCompletionDeliveryMethod', 'setCompletionNeedsRecurrence', 'setCompletionResolvedRecurrence', 'setManageEvidenceOpen', 'setManageEvidenceRecord', 'setPendingEvidenceFiles', 'setReloadKey']) context[name] = () => {}
    return { submit: new Function(...Object.keys(context), handlerCode)(...Object.values(context)), warnings, errors, successes, uploads, movs, loading, context }
}

test('Ant Upload wrappers and raw File entries both submit the selected documents', async () => {
    const file = new File(['proof'], 'poe.pdf', { type: 'application/pdf' })
    for (const item of [file, { uid: 'file', originFileObj: file }]) {
        const h = harness()
        await h.submit({ files: [item] })
        assert.equal(h.uploads[0], file)
        assert.deepEqual(h.warnings, [])
        assert.deepEqual(h.errors, [])
        assert.equal(h.successes.length, 1)
    }
})

test('an explicitly removed file is not resurrected from native-picker pending state', async () => {
    const h = harness({ pendingEvidenceFiles: [new File(['proof'], 'removed.pdf')] })
    await h.submit({ files: [] })
    assert.equal(h.uploads.length, 0)
    assert.match(h.warnings[0], /select at least one document/)
})

test('assignment lookup failures are caught, shown and stop the loading state', async () => {
    const h = harness({ getGroupMemberIdsForEvidence: async () => { throw Error('permission denied') } })
    await h.submit({ files: [new File(['proof'], 'poe.pdf')] })
    assert.equal(h.errors.length, 1)
    assert.deepEqual(h.loading, [true, false])
    assert.equal(h.context.evidenceSubmissionRef.current, false)
})

test('replacing all saved evidence with no files is rejected', async () => {
    const h = harness({
        manageEvidenceRecord: assignment({ resources: [{ link: 'https://test.invalid/existing.pdf' }] }),
        completionPendingRecord: assignment()
    })
    await h.submit({ files: [], replaceTarget: 'all' })
    assert.equal(h.movs.length, 0)
    assert.equal(h.warnings.length, 1)
})

test('double submission is ignored while a save is in progress', async () => {
    const h = harness({ evidenceSubmissionRef: { current: true } })
    await h.submit({ files: [new File(['proof'], 'poe.pdf')] })
    assert.equal(h.uploads.length, 0)
    assert.deepEqual(h.loading, [])
})

test('both pages use the shared service and the same completion fields', () => {
    const appointments = readFileSync(resolve(__dirname, 'appointments/index.tsx'), 'utf8')
    for (const route of [source, appointments]) {
        assert.match(route, /await completeIntervention\(/)
        assert.match(route, /<InterventionCompletionFields[\s\S]*?context=\{/)
        assert.match(route, /failureMessage=\{/)
        assert.match(route, /mergeCompletionFailureContext/)
        assert.match(route, /completionFailureEvidence/)
        assert.doesNotMatch(route, /createMovDraftFromAssignment/)
        assert.match(route, /interventionCompletionError\(error\)/)
    }
    const completion = findNodes(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === 'submitAllocatedCompletion')[0]
    assert.match(completion.getText(ast), /completeIntervention/)
    assert.match(source, /onFinish=\{submitAllocatedCompletion\}/)
})

test('SME intervention rows distinguish repeated assignments by date, cycle and reference', () => {
    const source = readFileSync(resolve(__dirname, '../incubatee/interventions/index.tsx'), 'utf8')
    assert.match(source, /assignmentDateLabel\(record\)/)
    assert.match(source, /record\.cycleKey \? `Cycle \$\{record\.cycleKey\}`/)
    assert.match(source, /Ref \$\{String\(record\.id\)\.slice\(0, 8\)\}/)
    assert.match(source, /assignmentDateLabel\(item\)/)
})

test('POE uploads use the neutral Storage-rule path and optional MOV profile lookup cannot block completion', () => {
    const completionService = readFileSync(
        resolve(__dirname, '../..', 'services/interventionCompletionService.ts'),
        'utf8'
    )
    const movService = readFileSync(
        resolve(__dirname, '../..', 'services/movService.ts'),
        'utf8'
    )
    const storageRules = readFileSync(
        resolve(__dirname, '../../..', 'storage.rules'),
        'utf8'
    )
    assert.match(storageRules, /match \/intervention-evidence\//)
    assert.match(completionService, /`intervention-evidence\//)
    assert.match(source, /`intervention-evidence\//)
    assert.doesNotMatch(completionService, /mov-poe\/rom/)
    assert.doesNotMatch(source, /mov-poe\/rom/)
    assert.doesNotMatch(completionService, /`interventions\//)
    assert.match(completionService, /25 \* 1024 \* 1024/)
    assert.match(movService, /Could not resolve optional facilitator profile for MOV/)
})

test('coordinator MOVs require lifecycle confirmation and label missing SME signatures clearly', () => {
    const coordinatorMovs = readFileSync(resolve(__dirname, '../coordinator/movs/index.tsx'), 'utf8')
    const movView = readFileSync(resolve(__dirname, '../../components/movs/MovDocumentView.tsx'), 'utf8')
    const movService = readFileSync(resolve(__dirname, '../../services/movService.ts'), 'utf8')
    const confirmationPredicate = coordinatorMovs.slice(
        coordinatorMovs.indexOf('const isSmeConfirmedMov'),
        coordinatorMovs.indexOf('const isDateWithinRange')
    )

    assert.doesNotMatch(confirmationPredicate, /smmeSignatureUrl/)
    assert.match(coordinatorMovs, /'Awaiting SME confirmation'/)
    assert.match(movView, /Signature not provided/)
    assert.match(movView, /Not provided — awaiting SME confirmation/)
    assert.match(movView, /Not confirmed/)
    assert.match(movService, /facilitatorSignedAt: now/)
    assert.match(movService, /signedAgreements/)
    assert.match(movService, /participantSignatureURL/)
    assert.match(movService, /getSavedSmmeSignatureUrl\(application, participant\)/)
})

test('facilitator signatures are resolved by id or verified email, never by display name', () => {
    const movService = readFileSync(resolve(__dirname, '../../services/movService.ts'), 'utf8')
    const resolver = movService.slice(
        movService.indexOf('export const resolveMovFacilitatorById'),
        movService.indexOf('export const findMovForAssignment')
    )

    assert.match(resolver, /doc\(db, collectionName, id\)/)
    assert.match(resolver, /resolveUserSignatureByEmail/)
    assert.doesNotMatch(resolver, /where\('name'/)
    assert.doesNotMatch(resolver, /where\("name"/)

    const movView = readFileSync(resolve(__dirname, '../../components/movs/MovDocumentView.tsx'), 'utf8')
    assert.match(movView, /resolveMovFacilitatorById/)
    assert.match(movView, /facilitatorId: String\(assignment\.assigneeId\)/)
    assert.match(movView, /facilitatorSignatureUrl: mov\?\.assignedInterventionId[\s\S]*?linkedFacilitatorData\?\.signatureUrl/)
})
