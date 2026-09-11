const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

function compile(name, overrides = {}) {
    const path = join(__dirname, name + '.ts')
    const compiled = new Module(path, module)
    compiled.paths = module.paths
    const original = compiled.require.bind(compiled)
    compiled.require = id => Object.hasOwn(overrides, id) ? overrides[id] : original(id)
    compiled._compile(ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText, path)
    return compiled.exports
}
const lifecycle = compile('assignmentLifecycleService')
const recurrence = compile('interventionRecurrenceService')
const base = (id = 'one', patch = {}) => ({
    id, participantId: `sme-${id}`, interventionId: 'definition', programId: 'program',
    departmentId: 'department', assigneeId: 'coordinator', assigneeRole: 'coordinator',
    assignmentStatus: 'in-progress', assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending',
    participantAcceptanceStatus: 'pending', recurrenceFrequency: 'monthly', resources: [], progressUpdates: [],
    ...patch
})
const resource = name => ({ type: 'poe', link: `https://saved.invalid/${name}.pdf`, label: name })

function fixture(rows = [base()], options = {}) {
    const db = {}, storage = {}, documents = new Map(), uploads = [], movCalls = [], commits = []
    rows.forEach(row => documents.set(`assignedInterventions/${row.id}`, { ...row }))
    if (!options.missingDefinition) {
        documents.set('interventions/definition', options.definition || {})
    }
    documents.set('departments/department', { isSensitive: options.sensitive === true })
    for (const [key, value] of Object.entries(options.documents || {})) documents.set(key, value)
    const doc = (_, collection, id) => ({ path: `${collection}/${id}`, id })
    const snapshot = reference => ({
        id: reference.id, ref: reference,
        exists: () => documents.has(reference.path), data: () => documents.get(reference.path)
    })
    let transactionCount = 0, failMov = options.failMov || 0
    const firebase = {
        doc, getDoc: async reference => snapshot(reference),
        Timestamp: { now: () => new Date('2026-08-28T12:00:00Z') },
        arrayUnion: (...values) => ({ _arrayUnion: values }),
        runTransaction: async (_, operation) => {
            transactionCount++
            if (transactionCount === 1 && options.beforeSave) options.beforeSave(documents)
            const writes = []
            const result = await operation({
                get: async reference => { assert.equal(writes.length, 0, 'all transaction reads precede writes'); return snapshot(reference) },
                update: (reference, patch) => writes.push({ reference, patch, update: true }),
                set: (reference, patch) => writes.push({ reference, patch })
            })
            for (const { reference, patch, update } of writes) {
                if (update) assert.ok(documents.has(reference.path), `update target exists: ${reference.path}`)
                const previous = documents.get(reference.path) || {}, next = { ...previous }
                for (const [key, value] of Object.entries(patch)) {
                    if (value?._arrayUnion) {
                        next[key] = [...new Map([...(previous[key] || []), ...value._arrayUnion].map(item => [JSON.stringify(item), item])).values()]
                    } else next[key] = value
                }
                documents.set(reference.path, next)
            }
            commits.push(writes)
            return result
        }
    }
    const service = compile('interventionCompletionService', {
        'firebase/firestore': firebase,
        'firebase/storage': {
            ref: (_, path) => ({ path }),
            uploadBytes: async (reference, file) => { uploads.push(file); if (options.failUpload) throw Error('storage unavailable') },
            getDownloadURL: async reference => `https://upload.invalid/${reference.path}`
        },
        '@/config/evidencePolicy': { USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE: !!options.summaryPolicy },
        './assignmentLifecycleService': lifecycle,
        './interventionRecurrenceService': recurrence,
        './groupInterventionDeliveryService': { groupDeliveryRef: (_, key) => doc(db, 'groupInterventionDeliveries', encodeURIComponent(key)) },
        './movService': {
            createMovDraftFromAssignment: async input => {
                movCalls.push(input)
                if (failMov && movCalls.length === failMov) { failMov = 0; throw Error('MOV failed') }
                const existing = [...documents.entries()].find(([key, value]) => key.startsWith('movDocuments/') && value.assignedInterventionId === input.assignment.id)
                if (existing) return { created: false, movDocumentId: existing[0].split('/')[1] }
                const id = `mov-${input.assignment.id}`
                documents.set(`movDocuments/${id}`, { assignedInterventionId: input.assignment.id, status: 'awaiting_smme', resources: input.assignment.resources })
                return { created: true, movDocumentId: id }
            }
        }
    })
    return {
        ...service, documents, uploads, movCalls, commits,
        context: () => service.loadInterventionCompletionContext(db, rows.map(row => row.id)),
        complete: (patch = {}) => service.completeIntervention({ db, storage, user: { uid: 'actor' }, assignmentIds: rows.map(row => row.id), ...patch })
    }
}

test('uploads all selected files and supplies the saved evidence to MOV creation', async () => {
    const f = fixture()
    const files = [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')]
    const result = await f.complete({ files: [files[0], { originFileObj: files[1] }] })
    assert.equal(f.uploads.length, 2)
    assert.equal(f.movCalls[0].assignment.resources.length, 2)
    assert.equal(f.movCalls[0].markAssignmentCompleted, false)
    assert.equal(f.movCalls[0].assigneeRole, 'coordinator')
    const saved = f.documents.get('assignedInterventions/one')
    assert.match(saved.resources[0].link, /\/intervention-evidence\/program\/sme-one\/one\//)
    assert.equal(saved.assigneeCompletionStatus, 'completed')
    assert.equal(saved.participantAcceptanceStatus, 'pending')
    assert.equal(saved.participantCompletionStatus, 'pending')
    assert.equal(saved.assignmentStatus, 'in-progress')
    assert.equal(saved.movDocumentId, result.movs[0].movDocumentId)
})

test('saved POE can be reused without uploading a new file', async () => {
    const f = fixture([base('one', { resources: [resource('existing')] })])
    assert.equal((await f.context()).missingEvidenceCount, 0)
    await f.complete({ files: [] })
    assert.equal(f.uploads.length, 0)
    assert.equal(f.movCalls[0].assignment.resources[0].label, 'existing')
})

test('evidence from another individual assignment cannot satisfy a missing POE', async () => {
    const f = fixture([base('one', { resources: [resource('private')] }), base('two')])
    assert.equal((await f.context()).missingEvidenceCount, 1)
    await assert.rejects(f.complete(), /Attach at least one POE/)
    assert.equal(f.commits.length, 0)
})

test('a deleted intervention definition is reported before any POE upload', async () => {
    const f = fixture([base('one')], { missingDefinition: true })
    await assert.rejects(
        f.complete({ files: [new File(['proof'], 'poe.pdf')] }),
        /definition that no longer exists.*No POE was uploaded.*definition/s
    )
    assert.equal(f.uploads.length, 0)
    assert.equal(f.commits.length, 0)
    assert.equal(f.movCalls.length, 0)
})

test('group upload runs once, preserves individual evidence and writes one shared delivery', async () => {
    const f = fixture([base('one', { groupKey: 'group', resources: [resource('private')] }), base('two', { groupKey: 'group' })])
    await f.complete({ files: [new File(['shared'], 'shared.pdf')] })
    assert.equal(f.uploads.length, 1)
    assert.equal(f.movCalls.length, 2)
    const group = f.documents.get('groupInterventionDeliveries/group')
    assert.equal(group.evidence.length, 1)
    assert.equal(group.progressUpdates.length, 1)
    assert.deepEqual(group.sourceAssignmentIds, ['one', 'two'])
    assert.equal(group.deliveryStatus, 'completed')
    assert.equal(f.documents.get('assignedInterventions/one').resources.length, 2)
    assert.equal(f.documents.get('assignedInterventions/two').resources.length, 1)
})

test('existing shared evidence satisfies group members without new uploads', async () => {
    const f = fixture([base('one', { groupKey: 'group' }), base('two', { groupKey: 'group' })], {
        documents: { 'groupInterventionDeliveries/group': { evidence: [resource('shared')], createdAt: 'original', progressUpdates: [] } }
    })
    assert.equal((await f.context()).missingEvidenceCount, 0)
    await f.complete()
    assert.equal(f.uploads.length, 0)
    assert.equal(f.documents.get('groupInterventionDeliveries/group').createdAt, 'original')
})

test('concurrently added evidence is retained by the save transaction', async () => {
    const f = fixture([base('one', { resources: [resource('first')] })], {
        beforeSave: documents => documents.get('assignedInterventions/one').resources.push(resource('concurrent'))
    })
    await f.complete()
    assert.equal(f.movCalls[0].assignment.resources.length, 2)
})

test('removed evidence is revalidated before any completion write', async () => {
    const f = fixture([base('one', { resources: [resource('first')] })], {
        beforeSave: documents => { documents.get('assignedInterventions/one').resources = [] }
    })
    await assert.rejects(f.complete(), /Saved evidence was removed/)
    assert.equal(f.commits.length, 0)
    assert.equal(f.movCalls.length, 0)
})

test('MOV failure retains evidence and does not claim completion; retry reuses existing MOV', async () => {
    const f = fixture([base('one'), base('two')], { failMov: 2 })
    const failure = await f.complete({ files: [new File(['proof'], 'poe.pdf')] })
        .then(() => null, error => error)
    assert.ok(failure instanceof f.CompletionOperationError)
    assert.equal(failure.stage, 'creating-mov')
    assert.equal(f.completionFailureEvidence(failure).length, 1)
    assert.match(f.interventionCompletionError(failure), /evidence was saved/i)
    assert.match(f.interventionCompletionError(failure), /shown below/i)
    const merged = f.mergeCompletionFailureContext(await f.context(), failure)
    assert.equal(merged.savedEvidence.length, 1)
    assert.equal(merged.missingEvidenceCount, 0)
    assert.equal(f.documents.get('assignedInterventions/one').assigneeCompletionStatus, 'pending')
    assert.equal(f.documents.get('assignedInterventions/two').resources.length, 1)
    await f.complete({ files: [] })
    assert.equal(f.uploads.length, 1)
    assert.equal([...f.documents.keys()].filter(key => key.startsWith('movDocuments/')).length, 2)
    assert.equal(f.documents.get('assignedInterventions/two').assigneeCompletionStatus, 'completed')
})

test('upload failure says completion did not happen and does not claim saved evidence', async () => {
    const f = fixture([base('one')], { failUpload: true })
    const failure = await f.complete({ files: [new File(['proof'], 'poe.pdf')] })
        .then(() => null, error => error)
    assert.ok(failure instanceof f.CompletionOperationError)
    assert.equal(failure.stage, 'uploading-evidence')
    assert.equal(f.completionFailureEvidence(failure).length, 0)
    assert.match(f.interventionCompletionError(failure), /could not be uploaded/i)
    assert.match(f.interventionCompletionError(failure), /not completed/i)
    assert.doesNotMatch(f.interventionCompletionError(failure), /was saved/i)
})

test('support codes expose the failed stage and safe Firebase error category in the dialog', () => {
    const f = fixture()
    const permissionError = Object.assign(new Error('internal SDK detail'), {
        code: 'firestore/permission-denied'
    })
    const attachFailure = new f.CompletionOperationError(
        'saving-evidence',
        permissionError
    )
    assert.equal(
        f.interventionCompletionSupportCode(attachFailure),
        'POE-ATTACH-PERMISSION (permission-denied)'
    )
    assert.match(
        f.interventionCompletionError(attachFailure),
        /Tell support: POE-ATTACH-PERMISSION \(permission-denied\)/
    )

    const networkError = Object.assign(new Error('request failed'), {
        code: 'storage/network-request-failed'
    })
    assert.equal(
        f.interventionCompletionSupportCode(
            new f.CompletionOperationError('uploading-evidence', networkError)
        ),
        'POE-UPLOAD-CONNECTION (network-request-failed)'
    )

    const missingRecord = Object.assign(new Error('document missing'), {
        code: 'firestore/not-found'
    })
    const missingRecordFailure = new f.CompletionOperationError(
        'saving-evidence',
        missingRecord
    )
    assert.equal(
        f.interventionCompletionSupportCode(missingRecordFailure),
        'POE-ATTACH-RECORD-MISSING (not-found)'
    )
    assert.match(
        f.interventionCompletionError(missingRecordFailure),
        /required intervention record could not be found/i
    )
    assert.doesNotMatch(
        f.interventionCompletionError(missingRecordFailure),
        /attach at least one POE/i
    )
})

test('frequency is resolved for every member and an explicit choice updates the definition once', async () => {
    const f = fixture([base('one'), base('two', { recurrenceFrequency: null })])
    assert.equal((await f.context()).needsRecurrence, true)
    await assert.rejects(f.complete({ files: [new File(['proof'], 'poe.pdf')] }), /frequency/)
    assert.equal(f.uploads.length, 0)
    await f.complete({ files: [new File(['proof'], 'poe.pdf')], recurrencePreset: 'weekly' })
    assert.equal(f.commits[0].filter(write => write.reference.path === 'interventions/definition').length, 1)
    assert.equal(f.documents.get('assignedInterventions/two').recurrenceFrequency, 'weekly')
})

test('invalid files, too many files and unauthenticated completion fail before writes', async () => {
    for (const [patch, expected] of [
        [{ files: [{ name: 'metadata-only.pdf' }] }, /unavailable/],
        [{ files: Array.from({ length: 11 }, () => new File(['proof'], 'poe.pdf')) }, /up to 10/],
        [{ files: [{ name: 'oversized.pdf', size: 25 * 1024 * 1024 + 1, arrayBuffer: async () => new ArrayBuffer(0) }] }, /25 MB/],
        [{ user: {} }, /Sign in/]
    ]) {
        const f = fixture()
        await assert.rejects(f.complete(patch), expected)
        assert.equal(f.uploads.length, 0)
        assert.equal(f.commits.length, 0)
    }
})

test('a changed assignee cannot inherit a stale completion request', async () => {
    const f = fixture([base('one', { resources: [resource('existing')] })], {
        beforeSave: documents => { documents.get('assignedInterventions/one').assigneeId = 'someone-else' }
    })
    await assert.rejects(f.complete(), /assignment changed/i)
    assert.equal(f.commits.length, 0)
})

test('cancelled assignments are rejected and confirmed group members are not reopened', async () => {
    const cancelled = fixture([base('one', { assignmentStatus: 'cancelled' })])
    await assert.rejects(cancelled.complete(), /cancelled/)
    const f = fixture([base('one', { participantCompletionStatus: 'confirmed' }), base('two', { resources: [resource('proof')] })])
    await f.complete()
    assert.equal(f.movCalls.length, 1)
    assert.equal(f.movCalls[0].assignment.id, 'two')
    assert.equal(f.documents.get('assignedInterventions/one').participantCompletionStatus, 'confirmed')
})

test('sensitive summary policy is identical for both entry points; document targets still need files', async () => {
    const f = fixture([base()], { summaryPolicy: true, sensitive: true })
    assert.equal((await f.context()).requiresSummary, true)
    assert.equal((await f.context()).requiresFiles, false)
    await assert.rejects(f.complete(), /summary/)
    await f.complete({ notes: 'Delivered sensitive support and discussed the outcome.' })
    assert.equal(f.uploads.length, 0)
    const document = fixture([base('one', { target: { mode: 'documents' } })], { summaryPolicy: true, sensitive: true })
    assert.equal((await document.context()).requiresFiles, true)
    await assert.rejects(document.complete({ notes: 'Summary alone' }), /POE/)
})

test('overlapping submissions cannot complete the same assignment twice', async () => {
    const f = fixture([base('one', { resources: [resource('proof')] })])
    const first = f.complete()
    await assert.rejects(f.complete(), /already being saved/)
    await first
    assert.equal(f.movCalls.length, 1)
})

test('retrying with the same selected file reuses the upload and does not duplicate POE', async () => {
    const f = fixture([base()], { failMov: 1 })
    const files = [new File(['proof'], 'poe.pdf')]
    await assert.rejects(f.complete({ files }), /MOV failed/)
    await f.complete({ files })
    assert.equal(f.uploads.length, 1)
    assert.equal(f.documents.get('assignedInterventions/one').resources.length, 1)
})

test('document targets preserve document evidence and operations actor role', async () => {
    const f = fixture([base('one', { target: { mode: 'documents' }, assigneeRole: 'operations' })])
    await f.complete({ files: [new File(['document'], 'output.docx')] })
    assert.equal(f.movCalls[0].assigneeRole, 'operations')
    assert.equal(f.movCalls[0].assignment.resources[0].type, 'document')
})
