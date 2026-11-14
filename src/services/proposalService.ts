import {
    collection,
    doc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    where,
    writeBatch
} from 'firebase/firestore'
import {
    deleteObject,
    getDownloadURL,
    ref,
    uploadBytes
} from 'firebase/storage'
import { withOwner } from '@/lib/storageOwner'
import { db, storage } from '@/firebase'
import { isStaffRole } from '@/lib/roleLabels'
import type {
    Proposal,
    ProposalActor,
    ProposalContributor,
    ProposalDocument,
    ProposalHistoryEntry,
    ProposalInput,
    ProposalStatus
} from '@/types/proposal'

const COLLECTION = 'projectProposals'

const safeFileName = (name: string) =>
    name.replace(/[^a-zA-Z0-9.\-_]/g, '_')

const actorContributor = (actor: ProposalActor): ProposalContributor => ({
    id: actor.id,
    name: actor.name,
    email: actor.email || null,
    role: actor.role || 'User'
})

const normalizeLegacyStatus = (value: unknown): ProposalStatus => {
    const status = String(value || 'Draft').trim().toLowerCase()
    const aliases: Record<string, ProposalStatus> = {
        draft: 'Draft',
        'in preparation': 'In preparation',
        submitted: 'Submitted',
        'under review': 'Under review',
        approved: 'Accepted',
        accepted: 'Accepted',
        'sla signed': 'SLA signed',
        'awaiting order number': 'Awaiting order number',
        'in progress': 'Implementation planning',
        'implementation planning': 'Implementation planning',
        'ready for activation': 'Ready for activation',
        completed: 'Active',
        active: 'Active',
        rejected: 'Rejected',
        archived: 'Archived'
    }
    return aliases[status] || 'Draft'
}

const normalizeProposal = (id: string, data: Record<string, any>): Proposal => {
    const assignedBranch = data.assignedBranch
    const centres = Array.isArray(data.centres)
        ? data.centres
        : assignedBranch?.id
            ? [{ id: assignedBranch.id, name: assignedBranch.name || 'Assigned centre' }]
            : data.branchId
                ? [{ id: data.branchId, name: assignedBranch?.name || 'Assigned centre' }]
                : []

    const fallbackPerson = (name: unknown, role: string): ProposalContributor => ({
        name: String(name || 'Not assigned'),
        role
    })

    return {
        id,
        proposalNumber: String(data.proposalNumber || `LEGACY-${id.slice(0, 6).toUpperCase()}`),
        title: String(data.title || 'Untitled proposal'),
        clientName: String(data.clientName || data.funder || 'Not specified'),
        clientContact: data.clientContact || null,
        clientEmail: data.clientEmail || null,
        category: data.category || 'Strategic',
        scope: data.scope || (centres.length > 1 ? 'Provincial' : 'Centre-specific'),
        province: data.province || null,
        allCentres: data.allCentres === true,
        allDepartments: data.allDepartments === true,
        estimatedValue: Number(data.estimatedValue || data.value || 0),
        currency: 'ZAR',
        status: normalizeLegacyStatus(data.status),
        description: data.description || data.about || null,
        originator: data.originator || fallbackPerson(data.createdBy?.name, 'Originator'),
        owner: {
            type: 'Individual',
            ...(data.owner || fallbackPerson(data.createdBy?.name, 'Proposal owner'))
        },
        contributors: Array.isArray(data.contributors) ? data.contributors : [],
        centres,
        departments: Array.isArray(data.departments) ? data.departments : [],
        proposedDate: data.proposedDate || null,
        submissionDeadline: data.submissionDeadline || null,
        acceptedAt: data.acceptedAt || null,
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null,
        createdBy: data.createdBy || null,
        updatedBy: data.updatedBy || null,
        isArchived: data.isArchived === true || data.status === 'Archived',
        legacy: {
            branchId: data.branchId || null,
            funder: data.funder || null,
            proposalDocUrl: data.proposalDocUrl || null,
            proposalDocPath: data.proposalDocPath || null
        }
    }
}

const sortByUpdated = (items: Proposal[]) =>
    [...items].sort((a, b) => {
        const value = (date: any) =>
            date?.toMillis?.() ||
            date?.toDate?.()?.getTime?.() ||
            (date ? new Date(date).getTime() : 0)
        return value(b.updatedAt || b.createdAt) - value(a.updatedAt || a.createdAt)
    })

export const listenToProposals = (
    actor: ProposalActor,
    onData: (proposals: Proposal[]) => void,
    onError: (error: Error) => void
) => {
    const branchId = actor.role === 'projectadmin' ? actor.branchId : null
    // Centre coordinators see their centre's proposals. Older records carry only
    // branchId or assignedBranch, not centreIds, so each shape gets its own query.
    const queries = branchId
        ? [
            query(collection(db, COLLECTION), where('centreIds', 'array-contains', branchId)),
            query(collection(db, COLLECTION), where('branchId', '==', branchId)),
            query(collection(db, COLLECTION), where('assignedBranch.id', '==', branchId))
        ]
        : [query(collection(db, COLLECTION))]

    // Archived proposals are included; the page decides where to show them.
    const results: Array<Map<string, Proposal> | null> = queries.map(() => null)
    const emit = () => {
        if (results.some(result => result === null)) return
        const merged = new Map<string, Proposal>()
        results.forEach(result => result?.forEach((proposal, id) => merged.set(id, proposal)))
        const records = Array.from(merged.values()).filter(item =>
            !branchId || item.centres.some(centre => centre.id === branchId)
        )
        onData(sortByUpdated(records))
    }

    const unsubscribers = queries.map((proposalsQuery, index) => onSnapshot(
        proposalsQuery,
        snapshot => {
            results[index] = new Map(snapshot.docs.map(item =>
                [item.id, normalizeProposal(item.id, item.data())] as const
            ))
            emit()
        },
        error => onError(error)
    ))
    return () => unsubscribers.forEach(unsubscribe => unsubscribe())
}

export const listProposalContributors = async (): Promise<ProposalContributor[]> => {
    const snapshot = await getDocs(collection(db, 'users'))
    return snapshot.docs
        .map(userDoc => {
            const data = userDoc.data()
            return {
                id: userDoc.id,
                name: String(data.name || data.fullName || data.email || 'Unnamed user'),
                email: data.email ? String(data.email) : null,
                role: String(data.role || data.jobTitle || 'User')
            }
        })
        // Lepharo staff only: SMEs, training SMEs, funders and system admins are not contributors.
        .filter(user => {
            const email = String(user.email || '').trim().toLowerCase()
            return Boolean(user.name && email) &&
                isStaffRole(user.role) &&
                !email.endsWith('@quantilytix.co.za')
        })
        .sort((a, b) => a.name.localeCompare(b.name))
}

export const createProposal = async (
    input: ProposalInput,
    actor: ProposalActor
) => {
    const proposalRef = doc(collection(db, COLLECTION))
    const year = new Date().getFullYear()
    const counterId = String(year)
    const counterRef = doc(db, 'proposalCounters', counterId)
    const historyRef = doc(collection(proposalRef, 'history'))
    const by = actorContributor(actor)

    await runTransaction(db, async transaction => {
        const counterSnapshot = await transaction.get(counterRef)
        const nextSequence = Number(counterSnapshot.data()?.sequence || 0) + 1
        const proposalNumber = `PR-${year}-${String(nextSequence).padStart(3, '0')}`

        transaction.set(counterRef, {
            year,
            sequence: nextSequence,
            updatedAt: serverTimestamp()
        }, { merge: true })

        transaction.set(proposalRef, {
            ...input,
            id: proposalRef.id,
            proposalNumber,
            currency: 'ZAR',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: by,
            updatedBy: by,
            isArchived: false,
            // Retain the legacy fields while the older Programs screen still exists.
            funder: input.clientName,
            about: input.description || '',
            branchId: input.centres[0]?.id || actor.branchId || null,
            assignedBranch: input.centres[0] || null,
            centreIds: input.centres.map(centre => centre.id),
            departmentIds: input.departments.map(department => department.id)
        })

        transaction.set(historyRef, {
            action: 'created',
            note: 'Proposal created',
            fromStatus: null,
            toStatus: input.status,
            createdAt: serverTimestamp(),
            createdBy: by
        })
    })

    return proposalRef.id
}

export const updateProposal = async (
    proposal: Proposal,
    input: ProposalInput,
    actor: ProposalActor
) => {
    const proposalRef = doc(db, COLLECTION, proposal.id)
    const historyRef = doc(collection(proposalRef, 'history'))
    const by = actorContributor(actor)
    const batch = writeBatch(db)

    const becameAccepted = input.status === 'Accepted' && proposal.status !== 'Accepted'
    batch.update(proposalRef, {
        ...input,
        acceptedAt: becameAccepted ? serverTimestamp() : input.acceptedAt || null,
        isArchived: input.status === 'Archived',
        updatedAt: serverTimestamp(),
        updatedBy: by,
        funder: input.clientName,
        about: input.description || '',
        branchId: input.centres[0]?.id || actor.branchId || null,
        assignedBranch: input.centres[0] || null,
        centreIds: input.centres.map(centre => centre.id),
        departmentIds: input.departments.map(department => department.id)
    })
    batch.set(historyRef, {
        action: proposal.status === input.status ? 'updated' : 'status_changed',
        note: proposal.status === input.status
            ? 'Proposal details updated'
            : `Status changed from ${proposal.status} to ${input.status}`,
        fromStatus: proposal.status,
        toStatus: input.status,
        createdAt: serverTimestamp(),
        createdBy: by
    })
    await batch.commit()
}

export const changeProposalStatus = async (
    proposal: Proposal,
    status: ProposalStatus,
    note: string,
    actor: ProposalActor
) => {
    const proposalRef = doc(db, COLLECTION, proposal.id)
    const historyRef = doc(collection(proposalRef, 'history'))
    const by = actorContributor(actor)
    const batch = writeBatch(db)

    batch.update(proposalRef, {
        status,
        acceptedAt: status === 'Accepted' && proposal.status !== 'Accepted'
            ? serverTimestamp()
            : proposal.acceptedAt || null,
        updatedAt: serverTimestamp(),
        updatedBy: by,
        isArchived: status === 'Archived'
    })
    batch.set(historyRef, {
        action: 'status_changed',
        note: note || `Status changed to ${status}`,
        fromStatus: proposal.status,
        toStatus: status,
        createdAt: serverTimestamp(),
        createdBy: by
    })
    await batch.commit()
}

export const listProposalHistory = async (proposalId: string) => {
    const snapshot = await getDocs(
        query(
            collection(db, COLLECTION, proposalId, 'history'),
            orderBy('createdAt', 'desc')
        )
    )
    return snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
    } as ProposalHistoryEntry))
}

export const listProposalDocuments = async (proposal: Proposal) => {
    const snapshot = await getDocs(
        collection(db, COLLECTION, proposal.id, 'documents')
    )
    const documents = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
    } as ProposalDocument))

    if (proposal.legacy?.proposalDocUrl) {
        documents.unshift({
            id: 'legacy-proposal-document',
            name: 'Original proposal document',
            category: 'Proposal',
            url: proposal.legacy.proposalDocUrl,
            storagePath: proposal.legacy.proposalDocPath || '',
            status: 'Current',
            version: 1
        })
    }
    return documents
}

export const uploadProposalDocument = async (
    proposal: Pick<Proposal, 'id'>,
    file: File,
    category: string,
    actor: ProposalActor
) => {
    const storagePath =
        `projectProposals/shared/${proposal.id}/documents/` +
        `${Date.now()}_${safeFileName(file.name)}`
    const storageRef = ref(storage, storagePath)
    await uploadBytes(storageRef, file, withOwner({
        contentType: file.type || 'application/octet-stream'
    }))
    const url = await getDownloadURL(storageRef)
    const by = actorContributor(actor)
    // The record, its history entry and the proposal's timestamp land together.
    const documentRef = doc(collection(db, COLLECTION, proposal.id, 'documents'))
    const batch = writeBatch(db)
    batch.set(documentRef,
        {
            name: file.name,
            category,
            url,
            storagePath,
            size: file.size,
            contentType: file.type || null,
            version: 1,
            status: 'Current',
            uploadedAt: serverTimestamp(),
            uploadedBy: by
        }
    )

    batch.set(doc(collection(db, COLLECTION, proposal.id, 'history')), {
        action: 'document_uploaded',
        note: `${category} document uploaded: ${file.name}`,
        createdAt: serverTimestamp(),
        createdBy: by
    })
    batch.update(doc(db, COLLECTION, proposal.id), {
        updatedAt: serverTimestamp(),
        updatedBy: by
    })
    try {
        await batch.commit()
    } catch (error) {
        // No record was written, so the uploaded file would be orphaned.
        await deleteObject(storageRef).catch(() => undefined)
        throw error
    }

    return documentRef.id
}

export const deleteProposalDocument = async (
    proposal: Proposal,
    document: ProposalDocument,
    actor: ProposalActor
) => {
    if (document.id === 'legacy-proposal-document') {
        throw new Error('Replace legacy documents from the existing Programs module.')
    }
    const batch = writeBatch(db)
    batch.delete(doc(db, COLLECTION, proposal.id, 'documents', document.id))
    batch.set(doc(collection(db, COLLECTION, proposal.id, 'history')), {
        action: 'document_deleted',
        note: `Document removed: ${document.name}`,
        createdAt: serverTimestamp(),
        createdBy: actorContributor(actor)
    })
    batch.update(doc(db, COLLECTION, proposal.id), {
        updatedAt: serverTimestamp(),
        updatedBy: actorContributor(actor)
    })
    await batch.commit()
    // The file goes only after its record, so a failed write never leaves a
    // record pointing at a deleted file.
    if (document.storagePath) {
        await deleteObject(ref(storage, document.storagePath)).catch(() => undefined)
    }
}
