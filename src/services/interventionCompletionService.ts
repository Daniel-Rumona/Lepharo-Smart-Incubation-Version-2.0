import {
    arrayUnion,
    doc,
    getDoc,
    runTransaction,
    Timestamp,
    type Firestore
} from 'firebase/firestore'
import {
    getDownloadURL,
    ref,
    uploadBytes,
    type FirebaseStorage
} from 'firebase/storage'
import { USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE } from '@/config/evidencePolicy'
import { resolveAssignmentLifecycle } from './assignmentLifecycleService'
import { groupDeliveryRef } from './groupInterventionDeliveryService'
import { createMovDraftFromAssignment, type MovUserContext } from './movService'
import {
    recurrencePatch,
    supportedRecurrenceFrom,
    SUPPORTED_RECURRENCE_OPTIONS
} from './interventionRecurrenceService'

type Row = Record<string, any> & { id: string }
export type CompletionEvidence = {
    link: string
    label?: string
    originalName?: string
    type?: string
}
export type InterventionCompletionContext = {
    assignments: Row[]
    groups: Map<string, Record<string, any>>
    definitions: Map<string, Record<string, any>>
    summaryAssignmentIds: string[]
    needsRecurrence: boolean
    requiresFiles: boolean
    requiresSummary: boolean
    missingEvidenceCount: number
    savedEvidence: CompletionEvidence[]
}

export const COMPLETION_MAX_FILES = 10
export const COMPLETION_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
export const COMPLETION_SUCCESS_MESSAGE =
    'Intervention completed. The MOV is ready for SME confirmation.'
export class CompletionValidationError extends Error {}

export type CompletionFailureStage =
    | 'loading'
    | 'uploading-evidence'
    | 'saving-evidence'
    | 'creating-mov'
    | 'finalizing-completion'

export class CompletionOperationError extends Error {
    readonly stage: CompletionFailureStage
    readonly savedEvidence: CompletionEvidence[]
    readonly originalError: unknown

    constructor(
        stage: CompletionFailureStage,
        originalError: unknown,
        savedEvidence: CompletionEvidence[] = []
    ) {
        super(
            originalError instanceof Error
                ? originalError.message
                : 'Intervention completion failed.'
        )
        this.name = 'CompletionOperationError'
        this.stage = stage
        this.savedEvidence = savedEvidence
        this.originalError = originalError
    }
}

const completionFailureTechnicalCode = (error: unknown) => {
    const source =
        error instanceof CompletionOperationError ? error.originalError : error
    const code = String((source as any)?.code || '')
        .trim()
        .toLowerCase()
        .split('/')
        .pop()
    return code && /^[a-z0-9_-]+$/.test(code) ? code : ''
}

export function interventionCompletionSupportCode(error: unknown): string {
    const stage =
        error instanceof CompletionOperationError
            ? {
                  loading: 'DETAILS-LOAD',
                  'uploading-evidence': 'POE-UPLOAD',
                  'saving-evidence': 'POE-ATTACH',
                  'creating-mov': 'MOV-CREATE',
                  'finalizing-completion': 'COMPLETION-STATUS'
              }[error.stage]
            : 'DETAILS-LOAD'
    const technicalCode = completionFailureTechnicalCode(error)
    const category = [
        'permission-denied',
        'unauthenticated',
        'unauthorized'
    ].includes(technicalCode)
        ? 'PERMISSION'
        : [
              'unavailable',
              'deadline-exceeded',
              'network-request-failed',
              'retry-limit-exceeded',
              'cancelled'
          ].includes(technicalCode)
        ? 'CONNECTION'
        : ['aborted', 'already-exists'].includes(technicalCode)
        ? 'CONFLICT'
        : technicalCode === 'not-found'
        ? 'RECORD-MISSING'
        : technicalCode === 'object-not-found'
        ? 'FILE-MISSING'
        : ['resource-exhausted', 'quota-exceeded'].includes(technicalCode)
        ? 'LIMIT'
        : ['failed-precondition', 'invalid-argument'].includes(technicalCode)
        ? 'DATA'
        : 'UNEXPECTED'
    return `${stage}-${category}${technicalCode ? ` (${technicalCode})` : ''}`
}

const withCompletionSupportCode = (message: string, error: unknown) =>
    `${message} Tell support: ${interventionCompletionSupportCode(error)}.`

export function interventionCompletionError(error: unknown): string {
    if (error instanceof CompletionValidationError) return error.message
    if (error instanceof CompletionOperationError) {
        switch (error.stage) {
            case 'uploading-evidence':
                return withCompletionSupportCode(
                    'The POE files could not be uploaded. The intervention was not completed. Your selected files are still in this window; check your connection and retry.',
                    error
                )
            case 'saving-evidence':
                if (completionFailureTechnicalCode(error) === 'not-found')
                    return withCompletionSupportCode(
                        'The POE uploaded, but a required intervention record could not be found while attaching it. The intervention was not completed. Refresh the page and review the assignment before retrying.',
                        error
                    )
                return withCompletionSupportCode(
                    'The POE upload could not be attached to the intervention, so completion did not continue. Retry from this window.',
                    error
                )
            case 'creating-mov':
                return withCompletionSupportCode(
                    'Your evidence was saved, but the MOV could not be created. The saved files are shown below and will be reused when you retry.',
                    error
                )
            case 'finalizing-completion':
                return withCompletionSupportCode(
                    'Your evidence and MOV were saved, but the completion status could not be updated. Retry to finish; the saved work will be reused.',
                    error
                )
            default:
                return withCompletionSupportCode(
                    'The latest intervention details could not be loaded. Nothing was changed. Refresh and try again.',
                    error
                )
        }
    }
    return withCompletionSupportCode(
        'The latest intervention details could not be loaded. Nothing was changed. Refresh and try again.',
        error
    )
}

export function completionFailureEvidence(error: unknown): CompletionEvidence[] {
    return error instanceof CompletionOperationError ? error.savedEvidence : []
}

export function mergeCompletionFailureContext(
    context: InterventionCompletionContext | null,
    error: unknown
): InterventionCompletionContext | null {
    const retained = completionFailureEvidence(error)
    if (!context || !retained.length) return context
    return {
        ...context,
        savedEvidence: evidence([...context.savedEvidence, ...retained]),
        missingEvidenceCount: 0
    }
}

export function completionFiles(value: unknown): File[] {
    if (!Array.isArray(value)) return []
    return value.map((item) => item?.originFileObj || item).filter(Boolean)
}

const evidence = (items: any): CompletionEvidence[] => [
    ...new Map<string, CompletionEvidence>(
        (Array.isArray(items) ? items : [])
            .filter(
                (item) =>
                    typeof item?.link === 'string' &&
                    /^https?:\/\//i.test(item.link)
            )
            .map(
                (item) =>
                    [item.link.trim(), item] as [string, CompletionEvidence]
            )
    ).values()
]
const groupKey = (row: Row) => String(row.groupKey || '').trim()
const rowEvidence = (
    row: Row,
    groups: InterventionCompletionContext['groups']
) =>
    evidence([
        ...evidence(row.resources),
        ...evidence(groups.get(groupKey(row))?.evidence)
    ])

async function loadByIds(
    db: Firestore,
    collection: string,
    ids: string[],
    required = false
) {
    const rows = await Promise.all(
        [...new Set(ids.filter(Boolean))].map(async (id) => {
            const snapshot = await getDoc(doc(db, collection, id))
            if (required && !snapshot.exists())
                throw new CompletionValidationError(
                    `This assignment is linked to an intervention definition that no longer exists. No POE was uploaded. Ask Operations to repair the assignment reference (${id}).`
                )
            return [id, snapshot.exists() ? snapshot.data() : {}] as const
        })
    )
    return new Map(rows)
}

/** Both completion dialogs use this same fresh read model; no first-assignment policy guesses. */
export async function loadInterventionCompletionContext(
    db: Firestore,
    assignmentIds: string[]
): Promise<InterventionCompletionContext> {
    const ids = [
        ...new Set(assignmentIds.map((id) => String(id).trim()).filter(Boolean))
    ]
    if (!ids.length)
        throw new CompletionValidationError(
            'Select an intervention assignment to complete.'
        )
    if (ids.length > 150)
        throw new CompletionValidationError(
            'Complete this group in smaller batches of up to 150 assignments.'
        )
    const snapshots = await Promise.all(
        ids.map((id) => getDoc(doc(db, 'assignedInterventions', id)))
    )
    if (snapshots.some((snapshot) => !snapshot.exists()))
        throw new CompletionValidationError(
            'A linked assignment no longer exists. Refresh the page before completing it.'
        )
    const assignments: Row[] = snapshots
        .map((snapshot) => ({ ...snapshot.data(), id: snapshot.id }))
        .filter((row) => !resolveAssignmentLifecycle(row).isCompleted)
    if (!assignments.length)
        throw new CompletionValidationError(
            'These assignments are already completed.'
        )
    if (assignments.some((row) => !resolveAssignmentLifecycle(row).isOpen)) {
        throw new CompletionValidationError(
            'A selected assignment is cancelled or needs reassignment. Refresh the page before completing it.'
        )
    }
    const [definitions, departments, groupEntries] = await Promise.all([
        loadByIds(
            db,
            'interventions',
            assignments.map((row) => row.interventionId),
            true
        ),
        USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE
            ? loadByIds(
                  db,
                  'departments',
                  assignments.map((row) => row.departmentId)
              )
            : Promise.resolve(new Map<string, Record<string, any>>()),
        Promise.all(
            [...new Set(assignments.map(groupKey).filter(Boolean))].map(
                async (key) => {
                    const snapshot = await getDoc(groupDeliveryRef(db, key))
                    return [
                        key,
                        snapshot.exists() ? snapshot.data() : {}
                    ] as const
                }
            )
        )
    ])
    const groups = new Map(groupEntries)
    const summaryAssignmentIds = assignments
        .filter(
            (row) =>
                USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE &&
                row.target?.mode !== 'documents' &&
                (row.isSensitive === true ||
                    departments.get(row.departmentId)?.isSensitive === true)
        )
        .map((row) => row.id)
    const fileAssignments = assignments.filter(
        (row) => !summaryAssignmentIds.includes(row.id)
    )
    return {
        assignments,
        groups,
        definitions,
        summaryAssignmentIds,
        needsRecurrence: assignments.some(
            (row) =>
                !supportedRecurrenceFrom(
                    row,
                    definitions.get(row.interventionId)
                )
        ),
        requiresFiles: fileAssignments.length > 0,
        requiresSummary: summaryAssignmentIds.length > 0,
        missingEvidenceCount: fileAssignments.filter(
            (row) => !rowEvidence(row, groups).length
        ).length,
        savedEvidence: evidence(
            assignments.flatMap((row) => rowEvidence(row, groups))
        )
    }
}

const activeCompletions = new WeakMap<Firestore, Set<string>>()
// Keep successful uploads available for a retry with the same selected Files.
// Weak keys release them when the dialog discards its selection.
const uploadedFiles = new WeakMap<
    Firestore,
    WeakMap<File, Map<string, Promise<CompletionEvidence>>>
>()

/** The only completion write path for Allocated and Appointments. */
export type ManualMovUpload = {
    assignmentId: string
    uploadedMovUrl: string
    uploadedMovFileName: string
    uploadedMovContentType?: string | null
    uploadedMovSize?: number
}

export async function completeIntervention(input: {
    db: Firestore
    storage: FirebaseStorage
    user: MovUserContext
    assignmentIds: string[]
    files?: unknown
    notes?: string
    recurrencePreset?: string
    deliveryMethod?: string
    /**
     * Which assignments get an MOV. Omit to give every assignment one.
     *
     * A grouped delivery completes for all its members, but an SME who
     * attended nothing did not receive the intervention, so no MOV should be
     * raised in their name.
     */
    movAssignmentIds?: string[]
    /**
     * Manually completed MOV files, already uploaded to Storage.
     *
     * These are attached inside the same transaction that marks the assignment
     * completed, so an intervention can never end up completed with an MOV
     * that is missing its file.
     */
    manualMovs?: ManualMovUpload[]
    /** POE list mirrored onto each MOV, alongside the legacy resources field. */
    poeEvidence?: Array<Record<string, any>>
}) {
    const { db, storage, user } = input
    if (!user.uid)
        throw new CompletionValidationError(
            'Your session is not ready. Sign in before completing the intervention.'
        )
    const ids = [
        ...new Set(
            input.assignmentIds.map((id) => String(id).trim()).filter(Boolean)
        )
    ]
    const active = activeCompletions.get(db) || new Set<string>()
    if (ids.some((id) => active.has(id)))
        throw new CompletionValidationError(
            'Completion is already being saved. Please wait.'
        )
    activeCompletions.set(db, active)
    ids.forEach((id) => active.add(id))
    let stage: CompletionFailureStage = 'loading'
    let retainedEvidence: CompletionEvidence[] = []
    try {
        const context = await loadInterventionCompletionContext(db, ids)
        const files = completionFiles(input.files)
        const notes = String(input.notes || '').trim()
        if (files.length > COMPLETION_MAX_FILES)
            throw new CompletionValidationError(
                `Select up to ${COMPLETION_MAX_FILES} files.`
            )
        if (
            files.some(
                (file) =>
                    typeof file.name !== 'string' ||
                    typeof file.arrayBuffer !== 'function'
            )
        ) {
            throw new CompletionValidationError(
                'A selected file is unavailable. Remove it and select it again.'
            )
        }
        if (files.some((file) => file.size > COMPLETION_MAX_FILE_SIZE_BYTES))
            throw new CompletionValidationError(
                'Each POE file must be 25 MB or smaller.'
            )
        if (context.missingEvidenceCount && !files.length)
            throw new CompletionValidationError(
                'Attach at least one POE file. Some selected assignments have no saved evidence.'
            )
        if (context.requiresSummary && !notes)
            throw new CompletionValidationError('Add the completion summary.')
        const selected = SUPPORTED_RECURRENCE_OPTIONS.find(
            (option) => option.value === input.recurrencePreset
        )?.value
        if (
            (input.recurrencePreset && !selected) ||
            (context.needsRecurrence && !selected)
        ) {
            throw new CompletionValidationError(
                'Select the intervention frequency.'
            )
        }

        const now = Timestamp.now()
        const uploadId = crypto.randomUUID()
        const cache =
            uploadedFiles.get(db) ||
            new WeakMap<File, Map<string, Promise<CompletionEvidence>>>()
        uploadedFiles.set(db, cache)
        const uploadScope = `${user.uid}:${[...ids].sort().join('|')}`
        stage = 'uploading-evidence'
        const uploaded = await Promise.all(
            files.map(async (file, index) => {
                const scopes =
                    cache.get(file) ||
                    new Map<string, Promise<CompletionEvidence>>()
                cache.set(file, scopes)
                if (!scopes.has(uploadScope)) {
                    const upload = (async () => {
                        const safePathPart = (value: unknown, fallback: string) =>
                            String(value || fallback)
                                .trim()
                                .replace(/[\\/#?%]+/g, '_') || fallback
                        const safeFileName = safePathPart(file.name, 'evidence-file')
                        const fileRef = ref(
                            storage,
                            `intervention-evidence/${safePathPart(
                                context.assignments[0].programId,
                                'no-program'
                            )}/${safePathPart(
                                context.assignments[0].participantId,
                                'group'
                            )}/${safePathPart(
                                context.assignments[0].id,
                                'no-assignment'
                            )}/${uploadId}_${index}_${safeFileName}`
                        )
                        await uploadBytes(fileRef, file)
                        return {
                            link: await getDownloadURL(fileRef),
                            label: file.name,
                            originalName: file.name,
                            type: 'poe'
                        }
                    })().catch((error) => {
                        scopes.delete(uploadScope)
                        throw error
                    })
                    scopes.set(uploadScope, upload)
                }
                return scopes.get(uploadScope)!
            })
        )
        const assignmentRefs = context.assignments.map((row) =>
            doc(db, 'assignedInterventions', row.id)
        )
        const groupKeys = [...context.groups.keys()]
        const groupRefs = groupKeys.map((key) => groupDeliveryRef(db, key))
        const update = {
            type: uploaded.length
                ? 'evidence-uploaded'
                : context.requiresSummary
                ? 'assignee-summary'
                : 'evidence-reused',
            source: 'completion',
            note: notes || 'Saved evidence used for completion',
            by: user.uid,
            createdAt: now,
            resources: uploaded,
            computedProgress: 100
        }

        // Read before writing inside the transaction: concurrent POE uploads
        // must not be replaced by an older modal's resource array.
        stage = 'saving-evidence'
        const saved = await runTransaction(db, async (transaction) => {
            const rowSnapshots = await Promise.all(
                assignmentRefs.map((reference) => transaction.get(reference))
            )
            const groupSnapshots = await Promise.all(
                groupRefs.map((reference) => transaction.get(reference))
            )
            const currentGroups = new Map(
                groupSnapshots.map((snapshot, index) => [
                    groupKeys[index],
                    snapshot.data() || {}
                ])
            )
            const rows: Row[] = rowSnapshots.map((snapshot) => {
                if (!snapshot.exists())
                    throw new CompletionValidationError(
                        'A linked assignment no longer exists.'
                    )
                const row = { ...snapshot.data(), id: snapshot.id }
                if (!resolveAssignmentLifecycle(row).isOpen)
                    throw new CompletionValidationError(
                        'An assignment changed while saving. Refresh and review its status.'
                    )
                return row
            })
            const nextRows: Row[] = rows.map((row) => {
                const original = context.assignments.find(
                    (item) => item.id === row.id
                )!
                if (
                    [
                        'groupKey',
                        'programId',
                        'departmentId',
                        'assigneeId',
                        'interventionId'
                    ].some(
                        (field) =>
                            String(row[field] || '') !==
                            String(original[field] || '')
                    )
                )
                    throw new CompletionValidationError(
                        'An assignment changed while saving. Refresh and review it before completing.'
                    )
                const resources = evidence([
                    ...rowEvidence(row, currentGroups),
                    ...uploaded
                ]).map((resource) => ({
                    ...resource,
                    type:
                        row.target?.mode === 'documents'
                            ? 'document'
                            : resource.type || 'poe'
                }))
                if (
                    !context.summaryAssignmentIds.includes(row.id) &&
                    !resources.length
                ) {
                    throw new CompletionValidationError(
                        'Saved evidence was removed. Attach a POE file before completing.'
                    )
                }
                const preset =
                    selected ||
                    supportedRecurrenceFrom(
                        row,
                        context.definitions.get(row.interventionId)
                    )
                return {
                    ...row,
                    resources,
                    computedProgress: 100,
                    ...(preset ? recurrencePatch(preset) : {}),
                    assigneeCompletedAt: row.assigneeCompletedAt || now,
                    progressUpdates: [...(row.progressUpdates || []), update]
                }
            })
            nextRows.forEach((row, index) => {
                const preset =
                    selected ||
                    supportedRecurrenceFrom(
                        row,
                        context.definitions.get(row.interventionId)
                    )
                transaction.update(assignmentRefs[index], {
                    resources: row.resources,
                    computedProgress: 100,
                    ...(preset ? recurrencePatch(preset) : {}),
                    progressUpdates: arrayUnion(update),
                    updatedAt: now
                })
            })
            // Only explicitly selected frequency updates the main definition.
            // Existing per-assignment frequencies are never propagated to siblings.
            if (selected)
                [
                    ...new Set(
                        rows.map((row) => row.interventionId).filter(Boolean)
                    )
                ].forEach((id) => {
                    transaction.update(doc(db, 'interventions', id), {
                        ...recurrencePatch(selected),
                        updatedAt: now
                    })
                })
            groupKeys.forEach((key, index) => {
                const previous = currentGroups.get(key) || {}
                const members = rows.filter((row) => groupKey(row) === key)
                const base = members[0]
                transaction.set(
                    groupRefs[index],
                    {
                        groupKey: key,
                        schemaVersion: 1,
                        programId: base.programId || null,
                        departmentId: base.departmentId || null,
                        interventionId: base.interventionId || null,
                        interventionTitle: base.interventionTitle || '',
                        subInterventionId: base.subInterventionId || null,
                        subInterventionTitle: base.subInterventionTitle || null,
                        assigneeId: base.assigneeId || user.uid,
                        assigneeName: base.assigneeName || '',
                        assigneeEmail: base.assigneeEmail || null,
                        progress: previous.progress || 0,
                        deliveryStatus:
                            previous.deliveryStatus || 'in_progress',
                        // Individual member evidence stays on the member. Only this
                        // shared upload and previously shared evidence belong here.
                        evidence: evidence([
                            ...evidence(previous.evidence),
                            ...uploaded
                        ]),
                        progressUpdates: arrayUnion(update),
                        sourceAssignmentIds: [
                            ...new Set([
                                ...(previous.sourceAssignmentIds || []),
                                ...members.map((row) => row.id)
                            ])
                        ],
                        createdAt: previous.createdAt || now,
                        updatedAt: now
                    },
                    { merge: true }
                )
            })
            return nextRows
        })

        retainedEvidence = evidence(
            saved.flatMap((row) => row.resources || [])
        )

        const movs: Array<{
            assignmentId: string
            movDocumentId: string
            created: boolean
        }> = []
        // An MOV is raised only for the assignments that should have one. The
        // rest still complete; they simply never get a document in their name.
        const movEligible = input.movAssignmentIds
            ? new Set(input.movAssignmentIds.map((id) => String(id).trim()).filter(Boolean))
            : null
        const manualMovByAssignment = new Map(
            (input.manualMovs || []).map((entry) => [String(entry.assignmentId), entry])
        )

        stage = 'creating-mov'
        for (const row of saved) {
            if (movEligible && !movEligible.has(row.id)) continue
            const result = await createMovDraftFromAssignment({
                db,
                user,
                assigneeRole:
                    row.assigneeRole === 'operations'
                        ? 'operations'
                        : 'coordinator',
                assignment: {
                    ...row,
                    deliveryMethod: input.deliveryMethod || ''
                },
                status: 'awaiting_smme',
                markAssignmentCompleted: false
            })
            movs.push({ assignmentId: row.id, ...result })
        }
        const movByAssignment = new Map(movs.map((mov) => [mov.assignmentId, mov]))
        // Claim facilitator completion only once every selected assignment has
        // a MOV. Never alter SME acceptance, attendance or confirmation here.
        stage = 'finalizing-completion'
        await runTransaction(db, async (transaction) => {
            const snapshots = await Promise.all(
                assignmentRefs.map((reference) => transaction.get(reference))
            )
            const movSnapshots = new Map(
                await Promise.all(
                    movs.map(async (mov) =>
                        [
                            mov.assignmentId,
                            await transaction.get(doc(db, 'movDocuments', mov.movDocumentId))
                        ] as const
                    )
                )
            )
            const groupSnapshots = await Promise.all(
                groupRefs.map((reference) => transaction.get(reference))
            )
            snapshots.forEach((snapshot, index) => {
                if (!snapshot.exists())
                    throw new CompletionValidationError(
                        'A linked assignment no longer exists.'
                    )
                if (resolveAssignmentLifecycle(snapshot.data()).isCompleted)
                    return
                if (!resolveAssignmentLifecycle(snapshot.data()).isOpen)
                    throw new CompletionValidationError(
                        'An assignment is no longer open. Review its status.'
                    )
                if (
                    [
                        'groupKey',
                        'programId',
                        'departmentId',
                        'assigneeId',
                        'interventionId'
                    ].some(
                        (field) =>
                            String(snapshot.data()[field] || '') !==
                            String(saved[index][field] || '')
                    )
                )
                    throw new CompletionValidationError(
                        'An assignment changed while creating the MOV. Refresh and review it before completing.'
                    )
                const assignmentId = saved[index].id
                const mov = movByAssignment.get(assignmentId)
                const movSnapshot = mov ? movSnapshots.get(assignmentId) : undefined
                if (mov && !movSnapshot?.exists())
                    throw new Error('The MOV was not saved.')

                if (mov && movSnapshot) {
                    const movData = movSnapshot.data()
                    const manualMov = manualMovByAssignment.get(assignmentId)
                    if (
                        ['awaiting_smme', 'draft'].includes(movData.status) &&
                        !movData.smmeSignedAt &&
                        !movData.smmeAccepted
                    ) {
                        transaction.update(movSnapshot.ref, {
                            resources: snapshot.data().resources || [],
                            progressUpdates: snapshot.data().progressUpdates || [],
                            ...(input.poeEvidence ? { poeEvidence: input.poeEvidence } : {}),
                            // The uploaded MOV lands here rather than in a
                            // follow-up batch, so completion and its evidence
                            // either both hold or neither does.
                            ...(manualMov
                                ? {
                                    uploadedMovUrl: manualMov.uploadedMovUrl,
                                    uploadedMovFileName: manualMov.uploadedMovFileName,
                                    uploadedMovContentType: manualMov.uploadedMovContentType ?? null,
                                    uploadedMovSize: manualMov.uploadedMovSize ?? null,
                                    uploadedMovUploadedAt: now
                                }
                                : {}),
                            updatedAt: now
                        })
                    }
                }

                transaction.update(assignmentRefs[index], {
                    ...(mov ? { movDocumentId: mov.movDocumentId } : {}),
                    computedProgress: 100,
                    assigneeCompletionStatus: 'completed',
                    assignmentStatus: 'in-progress',
                    assigneeCompletedAt:
                        snapshot.data().assigneeCompletedAt ||
                        saved[index].assigneeCompletedAt,
                    completedAt:
                        snapshot.data().completedAt ||
                        saved[index].assigneeCompletedAt,
                    updatedAt: now
                })
            })
            groupRefs.forEach((reference, index) =>
                transaction.update(reference, {
                    progress: 100,
                    deliveryStatus: 'completed',
                    completedAt:
                        groupSnapshots[index].data()?.completedAt || now,
                    updatedAt: now
                })
            )
        })
        return { assignmentIds: saved.map((row) => row.id), movs }
    } catch (error) {
        if (error instanceof CompletionOperationError) throw error
        if (error instanceof CompletionValidationError && !retainedEvidence.length)
            throw error
        throw new CompletionOperationError(stage, error, retainedEvidence)
    } finally {
        ids.forEach((id) => active.delete(id))
    }
}
