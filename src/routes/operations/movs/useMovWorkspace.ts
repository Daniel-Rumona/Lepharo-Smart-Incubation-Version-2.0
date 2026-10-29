import { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { addDoc, arrayUnion, collection, deleteField, doc, getDoc, getDocs, query, updateDoc, where, writeBatch } from 'firebase/firestore'
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage'
import { db } from '@/firebase'
import { chunk } from '@/types/mov'
import { workflowQueryService } from '@/services/workflowQueryService'
import { decideDispute, isDisputeQuery } from '@/services/deliveryDisputeService'
import { findMovForAssignment } from '@/services/movService'
import { filterMovRecords } from '@/utils/reportVisibility'
import { PACK_STATUS } from '@/utils/packStatus'
import { queryStage, type MovRole } from './roles'
import { useDepartmentRoles } from '@/services/departmentRoles'
import {
    buildPoeList,
    enrichMov,
    hasMovEvidence,
    packStage as packStageOf,
    isPackLocked,
    isReviewableMov,
    movStatus,
    type MovStatus,
    packItems,
    packSnapshotOf,
    resolveMovDueMonth,
    stripUndefinedDeep,
    withAssignmentBasics,
    type Mov,
    type Pack
} from './movData'

export type QueryCounts = { open: number; total: number }

/** What a month holds before it's submitted. */
export type MonthSummary = { month: string; ready: number; noEvidence: number; late: number }

type Actor = { uid?: string; name?: string; displayName?: string; email?: string; role?: string; departmentName?: string; departmentId?: string; signatureURL?: string } | null

const isOpenQuery = (q: any) => String(q?.status || 'open').toLowerCase() !== 'resolved'
/** The MOV a query is about: set directly, or the pack row it was raised on. */
const movIdOfQuery = (q: any) =>
    String(q?.context?.movId || q?.movId || q?.context?.movRowId || (['mov', 'poe'].includes(String(q?.target?.type)) ? q?.target?.id : '') || '')

const actorOf = (user: Actor) => ({
    name: user?.name || user?.displayName || null,
    email: user?.email || null,
    role: user?.role || null,
    departmentId: user?.departmentId || null,
    departmentName: user?.departmentName || null
})

const upload = async (file: File, folder: string) => {
    const path = `${folder}/${Date.now()}_${String(file.name || 'file').replace(/\s+/g, '_')}`
    const fileRef = ref(getStorage(), path)
    await uploadBytes(fileRef, file)
    return { url: await getDownloadURL(fileRef), name: file.name, path }
}

/**
 * The MOV workspace, shared by every role (see roles.ts): the MOVs and
 * monthly packs this person works on in the active programme, which pack
 * each MOV belongs to, and every action on them.
 */
export const useMovWorkspace = (user: Actor, activeProgramId: string | null | undefined, role: MovRole = 'hod') => {
    const departmentId = user?.departmentId || ''
    const department = user?.departmentName || ''
    const { hasRole } = useDepartmentRoles()
    const isMonitoringDepartment = (id?: string | null) => hasRole(id, 'monitoring')
    const [movs, setMovs] = useState<Mov[]>([])
    const [packs, setPacks] = useState<Pack[]>([])
    const [queryIndex, setQueryIndex] = useState<Record<string, QueryCounts>>({})
    const [packQueryIndex, setPackQueryIndex] = useState<Record<string, QueryCounts>>({})
    const [loading, setLoading] = useState(false)
    const [loadedOnce, setLoadedOnce] = useState(false)
    const [hodDigitalSignature, setHodDigitalSignature] = useState('')

    // ---- which pack each MOV is in; which months are packed / locked ----
    const packIndex = useMemo(() => {
        const movToPack: Record<string, string> = {}
        const packedMonths = new Set<string>()
        const lockedMonths = new Set<string>()
        packs.forEach(pack => {
            const month = String(pack.month || '').trim()
            if (month) {
                packedMonths.add(month)
                if (isPackLocked(pack)) lockedMonths.add(month)
            }
            packItems(pack).forEach(m => {
                if (m?.id) movToPack[m.id] = String(pack.id || '')
            })
        })
        return { movToPack, packedMonths, lockedMonths }
    }, [packs])

    /**
     * The pack an approved MOV goes into: its due month, unless that month's
     * pack is locked (CC-confirmed or validated) - then the next month whose
     * pack is still open. Null when it's already in a pack.
     */
    const packMonthFor = useCallback((mov: any): string | null => {
        if (mov?.id && packIndex.movToPack[mov.id]) return null
        let month = resolveMovDueMonth(mov)
        if (!month) return null
        for (let guard = 0; guard < 36 && packIndex.lockedMonths.has(month); guard++) {
            month = dayjs(month, 'YYYY-MM').add(1, 'month').format('YYYY-MM')
        }
        return month
    }, [packIndex])

    const isLate = useCallback((mov: any) => {
        const due = resolveMovDueMonth(mov)
        const target = packMonthFor(mov)
        return !!due && !!target && target !== due
    }, [packMonthFor])

    // ---- loading ----
    const buildIndex = async (ids: string[], key: 'movIds' | 'consolidatedMovIds', field: 'movId' | 'consolidatedMovId') => {
        const index: Record<string, QueryCounts> = {}
        for (const batch of chunk(ids.filter(Boolean), 10)) {
            const rows = await workflowQueryService.list({ [key]: batch } as any)
            rows.forEach((q: any) => {
                const id = String(q[field] || '')
                if (!id || (field === 'movId' && q.consolidatedMovId)) return
                const entry = index[id] || { open: 0, total: 0 }
                entry.total += 1
                if (String(q.status || 'open').toLowerCase() !== 'resolved') entry.open += 1
                index[id] = entry
            })
        }
        return index
    }

    const scoped = (name: string, extra: any[] = []) => {
        const parts: any[] = [collection(db, name)]
        if (departmentId) parts.push(where('departmentId', '==', departmentId))
        parts.push(...extra)
        if (activeProgramId) parts.push(where('programId', '==', activeProgramId))
        return (query as any)(...parts)
    }

    const loadPacks = useCallback(async () => {
        if (role === 'facilitator') {
            setPacks([])
            return
        }
        if (role === 'cc' || role === 'me') {
            if (!activeProgramId) {
                setPacks([])
                return
            }
            const all = await getDocs(query(collection(db, 'consolidatedMOVs'), where('programId', '==', activeProgramId)))
            const submitted = (filterMovRecords(all.docs.map(d => ({ id: d.id, ...(d.data() as any) })), user?.email) as Pack[])
                .filter(p => (p.approvals || []).some((a: any) => a?.step === 'hod_submission'))
                .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(a.department || '').localeCompare(String(b.department || '')))
            setPacks(submitted)
            setPackQueryIndex(await buildIndex(submitted.map(p => p.id), 'consolidatedMovIds', 'consolidatedMovId'))
            return
        }
        const snap = await getDocs(scoped('consolidatedMOVs'))
        const list = (filterMovRecords(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })), user?.email) as Pack[])
            .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')))
        setPacks(list)
        setPackQueryIndex(await buildIndex(list.map(p => p.id), 'consolidatedMovIds', 'consolidatedMovId'))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [departmentId, activeProgramId, user?.email, role])

    /** A facilitator's own MOVs: by login, profile ids and email. Queries are counted by "waiting for my answer". */
    const loadFacilitatorMovs = async () => {
        if (!activeProgramId || !user?.uid) return setMovs([])
        const email = String(user.email || '').toLowerCase()
        const ids = new Set<string>([user.uid])
        if (email) {
            for (const name of ['coordinators', 'consultants']) {
                const snap = await getDocs(query(collection(db, name), where('email', '==', email))).catch(() => null)
                snap?.docs.forEach(d => ids.add(d.id))
            }
        }
        const reads = [
            ...chunk(Array.from(ids), 10).map(group => getDocs(query(collection(db, 'movDocuments'), where('programId', '==', activeProgramId), where('facilitatorId', 'in', group)))),
            ...(email ? [getDocs(query(collection(db, 'movDocuments'), where('programId', '==', activeProgramId), where('facilitatorEmail', '==', email)))] : [])
        ]
        const byId = new Map<string, Mov>()
        for (const snap of await Promise.all(reads.map(r => r.catch(() => null)))) {
            snap?.docs.forEach(d => byId.set(d.id, { id: d.id, ...(d.data() as any) }))
        }
        const light = await withAssignmentBasics((filterMovRecords(Array.from(byId.values()), user?.email) as Mov[]).filter(isReviewableMov))
        setMovs(light)

        // Every query sent to me, whoever raised it (HOD, CC or M&E): "open" means it needs my answer.
        const mine = await workflowQueryService.list({ resolverId: user.uid } as any)
        const index: Record<string, QueryCounts> = {}
        mine.forEach((q: any) => {
            const id = movIdOfQuery(q)
            if (!id) return
            const entry = index[id] || { open: 0, total: 0 }
            entry.total += 1
            if (String(q.status || 'open').toLowerCase() === 'open') entry.open += 1
            index[id] = entry
        })
        setQueryIndex(index)
    }

    const loadEscalatedDisputes = async (): Promise<Mov[]> => {
        try {
            const rows = await workflowQueryService.list({
                status: 'answered',
                targetType: 'assigned-intervention',
                ...(activeProgramId ? { programId: activeProgramId } : {})
            })
            const escalated = rows.filter((q: any) => isDisputeQuery(q) && q.escalation?.to === 'hod' && !q.escalation?.decision)
            const out = await Promise.all(escalated.map(async (q: any) => {
                const assignmentId = String(q.target?.id || '')
                const assignment = (await getDoc(doc(db, 'assignedInterventions', assignmentId))).data() as any
                if (!assignment) return null
                const sameDepartment = !departmentId || assignment.departmentId === departmentId
                if (!sameDepartment) return null
                const { movDocumentId, movData } = await findMovForAssignment(db, assignmentId) as any
                if (!movDocumentId) return null
                return { id: movDocumentId, ...(movData || {}), dueDate: (movData || {}).dueDate || assignment.dueDate || null, _dispute: q } as Mov
            }))
            return out.filter(Boolean) as Mov[]
        } catch (error) {
            console.warn('[MOVs] Could not load delivery disputes', error)
            return []
        }
    }

    const loadMovs = useCallback(async () => {
        if (role === 'cc' || role === 'me') return setMovs([])
        if (role === 'facilitator') return loadFacilitatorMovs()
        let snap
        try {
            snap = await getDocs(scoped('movDocuments'))
        } catch (error) {
            // A missing composite index shouldn't stop the page: read the department and filter here.
            console.error('[MOVs] Scoped query failed; filtering locally', error)
            const all = await getDocs((query as any)(collection(db, 'movDocuments'), ...(departmentId ? [where('departmentId', '==', departmentId)] : [])))
            snap = { docs: all.docs.filter(d => !activeProgramId || (d.data() as any).programId === activeProgramId) } as any
        }
        const raw = filterMovRecords(
            snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter(isReviewableMov),
            user?.email
        ) as Mov[]
        const light = await withAssignmentBasics(raw)
        // SME delivery disputes the facilitator escalated: the MOV hasn't been
        // confirmed by the SME, so it only appears here, for the HOD to decide.
        const disputed = await loadEscalatedDisputes()
        const ids = new Set(light.map(m => m.id))
        setMovs([...light, ...disputed.filter(m => !ids.has(m.id))])
        setQueryIndex(await buildIndex(light.map(m => m.id), 'movIds', 'movId'))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [departmentId, activeProgramId, user?.email, role])

    const reload = useCallback(async () => {
        setLoading(true)
        try {
            await Promise.all([loadPacks(), loadMovs()])
        } catch (error: any) {
            console.error('[MOVs] Failed to load', error)
            throw error
        } finally {
            setLoading(false)
            setLoadedOnce(true)
        }
    }, [loadPacks, loadMovs])

    useEffect(() => {
        if (!user) return
        reload().catch(() => undefined)
    }, [user?.uid, departmentId, activeProgramId, role]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!user?.email) return
        getDocs(query(collection(db, 'operationsStaff'), where('email', '==', user.email)))
            .then(snap => setHodDigitalSignature(snap.docs[0]?.data()?.digitalSignature || ''))
            .catch(() => undefined)
    }, [user?.email])

    // ---- months ready to submit (from the light list; confirmed in full when submitting) ----
    const monthSummaries = useMemo<MonthSummary[]>(() => {
        const byMonth = new Map<string, MonthSummary>()
        movs.forEach(m => {
            if (m.approvedByHod !== true) return
            const month = packMonthFor(m)
            if (!month) return
            const row = byMonth.get(month) || { month, ready: 0, noEvidence: 0, late: 0 }
            if (hasMovEvidence(m)) row.ready += 1
            else row.noEvidence += 1
            if (isLate(m)) row.late += 1
            byMonth.set(month, row)
        })
        return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month))
    }, [movs, packMonthFor, isLate])

    // ---- MOV actions ----
    // The HOD sees the MOV's own queries; pack queries (CC / M&E) live on the pack.
    // The facilitator sees every query on their MOV, whoever raised it.
    const listMovQueries = (movId: string) =>
        role === 'facilitator'
            ? workflowQueryService.list({ resolverId: user?.uid || '' } as any).then(rows => rows.filter((q: any) => movIdOfQuery(q) === movId))
            : workflowQueryService.list({ movId }).then(rows => rows.filter((q: any) => !q.consolidatedMovId))

    const listPackQueries = (packId: string) => workflowQueryService.list({ consolidatedMovId: packId })

    /** Approve; resolves the open queries this HOD raised on it. */
    const approve = async (mov: Mov, resolveQueryIds: string[]) => {
        await Promise.all(resolveQueryIds.map(id => workflowQueryService.resolve(id, {
            notes: 'Resolved when the MOV was approved.',
            attachmentUrl: null,
            actorId: user?.uid || '',
            actor: actorOf(user)
        })))
        await updateDoc(doc(db, 'movDocuments', mov.id), {
            approvedByHod: true,
            hodApprovedAt: new Date(),
            hodApprovedByUid: user?.uid || null,
            hodApprovedByName: user?.name || user?.displayName || null,
            hodApprovedByEmail: user?.email || null,
            updatedAt: new Date(),
            status: 'approved',
            approvalHistory: arrayUnion({ action: 'approved', at: new Date(), byUid: user?.uid || null, byName: user?.name || user?.displayName || null })
        })
    }

    /**
     * Takes back an approval made by mistake. Allowed until the CC confirms
     * the pack it's in: an MOV in a pack still awaiting the CC is taken out
     * of it in the same write (the CC is notified by the pack update). The
     * MOV returns to the HOD's "To review"; nothing goes to the facilitator.
     */
    const undoApproval = async (mov: Mov, reason: string) => {
        const packId = packIndex.movToPack[mov.id]
        const pack = packId ? packs.find(p => p.id === packId) : null
        if (pack && isPackLocked(pack)) throw new Error('locked')
        const batch = writeBatch(db)
        batch.update(doc(db, 'movDocuments', mov.id), {
            approvedByHod: false,
            status: 'awaiting_hod',
            updatedAt: new Date(),
            approvalHistory: arrayUnion({ action: 'undone', at: new Date(), byUid: user?.uid || null, byName: user?.name || user?.displayName || null, reason })
        })
        if (pack) {
            const items = packItems(pack).filter(m => m.id !== mov.id)
            batch.update(doc(db, 'consolidatedMOVs', pack.id), {
                interventions: items,
                movIds: items.map(m => m.id),
                totalItems: items.length,
                updatedAt: new Date(),
                updatedByName: user?.name || '',
                updatedByUid: user?.uid || '',
                lastHodUpdate: { at: new Date(), byUid: user?.uid || '', byName: user?.name || '', added: 0, removed: 1, invoiceReplaced: false }
            })
        }
        await batch.commit()
        return pack ? { removedFromPack: pack.month } : { removedFromPack: null }
    }

    /** Sends a query to the facilitator; the MOV only turns "queried" once the query exists. */
    const raiseQuery = async (mov: Mov, values: { queryType: string; message: string }) => {
        // An approved MOV is final: it may already be in a pack the CC or M&E are working on.
        if (mov.approvedByHod === true) throw new Error('approved')
        if (!mov.facilitatorId) throw new Error('no-facilitator')
        await workflowQueryService.create({
            programId: String(activeProgramId || mov.programId || ''),
            type: values.queryType || 'general-query',
            message: String(values.message || '').trim(),
            raisedById: user?.uid || 'system',
            raisedBy: { ...actorOf(user), role: (user?.role || '').toLowerCase() },
            resolverId: mov.facilitatorId,
            resolver: { name: mov.facilitatorName || null, email: mov.facilitatorEmail || null, role: mov.facilitatorRole || 'coordinator' },
            target: { type: 'mov', id: mov.id },
            context: {
                interventionId: mov.interventionId || null,
                interventionTitle: mov.interventionTitle || null,
                movId: mov.id,
                participantId: mov.beneficiaryId || mov.smmeId || null,
                departmentName: mov.departmentName || department || null,
                lockedInPackAtCreation: !!packIndex.movToPack[mov.id]
            }
        } as any)
        await updateDoc(doc(db, 'movDocuments', mov.id), { status: 'queried', approvedByHod: false, updatedAt: new Date() })
    }

    const resolveQuery = async (queryId: string, notes: string, file: File | null) => {
        const evidence = file ? await upload(file, `movQueries/${department}`) : null
        await workflowQueryService.resolve(queryId, {
            notes,
            attachmentUrl: evidence?.url || null,
            actorId: user?.uid || '',
            actor: actorOf(user)
        })
    }

    /** Accept the facilitator's answer. With no other open query left, the MOV returns to "To review". */
    const acceptAnswer = async (queryId: string, mov: Mov, notes = '') => {
        await workflowQueryService.accept(queryId, { notes, actorId: user?.uid || '', actor: actorOf(user) })
        const others = (await listMovQueries(mov.id)).filter(q => q.id !== queryId && String(q.status) !== 'resolved')
        if (!others.length && String(mov.status || '').toLowerCase() === 'queried') {
            await updateDoc(doc(db, 'movDocuments', mov.id), { status: 'awaiting_hod', updatedAt: new Date() })
        }
    }

    /** Accept an answer to a pack query (CC / M&E). The MOV's own status isn't the pack's business. */
    const acceptPackAnswer = (queryId: string) =>
        workflowQueryService.accept(queryId, { notes: '', actorId: user?.uid || '', actor: actorOf(user) })

    /** The HOD's decision on an escalated SME delivery dispute. */
    const decideDeliveryDispute = (mov: Mov, decision: 'sme' | 'facilitator', notes: string) =>
        decideDispute({
            query: mov._dispute,
            decision,
            notes,
            actor: { id: user?.uid || '', ...actorOf(user) }
        })

    /** Not good enough yet: back to the facilitator with what's still needed. */
    const sendBackAnswer = (queryId: string, notes: string) =>
        workflowQueryService.sendBack(queryId, { notes, actorId: user?.uid || '', actor: actorOf(user) })

    // ---- packs ----
    const approvedMovsInScope = async () => {
        const snap = await getDocs(scoped('movDocuments', [where('status', '==', 'approved')]))
        return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }) as Mov).filter(m => m.approvedByHod === true)
    }

    /** The MOVs a new pack for this month would hold, fully loaded, split by whether they have evidence. */
    const monthCandidates = async (month: string) => {
        const enriched = await Promise.all((await approvedMovsInScope()).map(m => enrichMov(m, activeProgramId)))
        const inMonth = enriched.filter(m => packMonthFor(m) === month)
        return { eligible: inMonth.filter(hasMovEvidence), missingEvidence: inMonth.filter(m => !hasMovEvidence(m)) }
    }

    const packExists = async (month: string) => {
        const snap = await getDocs(scoped('consolidatedMOVs', [where('month', '==', month)]))
        return !snap.empty
    }

    /** Creates the month's pack. Returns 'invoice-failed' without saving when the invoice didn't upload. */
    const createPack = async (month: string, items: Mov[], invoiceFile: File | null, skipInvoice: boolean) => {
        if (!departmentId) throw new Error('no-department')
        if (await packExists(month)) return 'exists' as const
        let invoiceAttachment = null
        if (invoiceFile && !skipInvoice) {
            try {
                invoiceAttachment = await upload(invoiceFile, `consolidatedMOVs/${department}/${month}`)
            } catch (error) {
                console.error('Invoice upload failed', error)
                return 'invoice-failed' as const
            }
        }
        const snapshot = items.map(packSnapshotOf)
        await addDoc(collection(db, 'consolidatedMOVs'), stripUndefinedDeep({
            department,
            departmentId,
            month,
            range: { from: dayjs(month, 'YYYY-MM').startOf('month').toDate(), to: dayjs(month, 'YYYY-MM').endOf('month').toDate() },
            totalItems: snapshot.length,
            interventions: snapshot,
            // Lets the Center Coordinator and M&E pages re-read the live MOVs.
            movIds: items.map(m => m.id),
            approvals: [{ step: 'hod_submission', role: user?.role || 'operations', name: user?.name || 'Unknown User', date: new Date() }],
            createdAt: new Date(),
            status: PACK_STATUS.AWAITING_CC,
            programId: activeProgramId || null,
            hodName: user?.name || '',
            hodUid: user?.uid || '',
            hodSignatureUrl: user?.signatureURL || '',
            hodDigitalSignature,
            invoiceAttachment,
            invoiceSkipped: !!invoiceFile && skipInvoice
        }))
        return 'saved' as const
    }

    /** What refreshing a pack would hold: MOVs already in it that are still approved, plus newly eligible ones. */
    const refreshPreview = async (pack: Pack) => {
        const enriched = await Promise.all((await approvedMovsInScope()).map(m => enrichMov(m, activeProgramId)))
        const items = enriched.filter(m => hasMovEvidence(m) && (packIndex.movToPack[m.id] === pack.id || packMonthFor(m) === pack.month))
        return { items, difference: items.length - packItems(pack).length }
    }

    const applyRefresh = async (pack: Pack, items: Mov[], invoiceFile: File | null) => {
        if (isPackLocked(pack)) throw new Error('locked')
        let invoiceAttachment = pack.invoiceAttachment || null
        if (invoiceFile) invoiceAttachment = await upload(invoiceFile, `consolidatedMOVs/${department}/${pack.month}`)
        const before = new Set(packItems(pack).map(m => m.id))
        const after = new Set(items.map(m => m.id))
        await updateDoc(doc(db, 'consolidatedMOVs', pack.id), stripUndefinedDeep({
            interventions: items.map(packSnapshotOf),
            movIds: items.map(m => m.id),
            totalItems: items.length,
            invoiceAttachment,
            updatedAt: new Date(),
            updatedByName: user?.name || '',
            updatedByUid: user?.uid || '',
            // Read by the pack notification function: the CC is told what changed.
            lastHodUpdate: {
                at: new Date(),
                byUid: user?.uid || '',
                byName: user?.name || '',
                added: items.filter(m => !before.has(m.id)).length,
                removed: Array.from(before).filter(id => !after.has(id)).length,
                invoiceReplaced: !!invoiceFile
            }
        }))
    }

    /** Adds what's newly eligible to an open pack in one step (used after approving a late MOV). */
    const addToPack = async (pack: Pack) => {
        const { items, difference } = await refreshPreview(pack)
        await applyRefresh(pack, items, null)
        return difference
    }

    /** Swaps the invoice only, while the pack still awaits the CC. */
    const replaceInvoice = async (pack: Pack, file: File) => {
        if (isPackLocked(pack)) throw new Error('locked')
        const invoiceAttachment = await upload(file, `consolidatedMOVs/${department}/${pack.month}`)
        await updateDoc(doc(db, 'consolidatedMOVs', pack.id), {
            invoiceAttachment,
            updatedAt: new Date(),
            updatedByName: user?.name || '',
            updatedByUid: user?.uid || '',
            lastHodUpdate: { at: new Date(), byUid: user?.uid || '', byName: user?.name || '', added: 0, removed: 0, invoiceReplaced: true }
        })
    }

    /** The still-open pack an approved MOV could join right now, if any. */
    const openPackFor = (mov: Mov): Pack | null => {
        if (!mov || mov.approvedByHod !== true || packIndex.movToPack[mov.id]) return null
        const month = packMonthFor(mov)
        return packs.find(p => p.month === month && !isPackLocked(p)) || null
    }

    /** What an open pack is missing or holds that it shouldn't: new approved MOVs, and MOVs since queried. */
    const pendingChanges = (pack: Pack) => {
        const add = movs.filter(m => m.approvedByHod === true && hasMovEvidence(m) && openPackFor(m)?.id === pack.id).length
        const live = new Map(movs.map(m => [m.id, m]))
        const remove = packItems(pack).filter(item => {
            const now = live.get(item.id)
            return !!now && now.approvedByHod !== true
        }).length
        return { add, remove }
    }

    // ---- CC and M&E: monthly packs ----
    const me = () => ({ name: user?.name || user?.displayName || 'Unknown', role: user?.role || '', userId: user?.uid || null, email: user?.email || null })

    /** The live MOV behind a pack row, fully loaded for its confirmation sheet. */
    const loadPackMov = async (item: Mov) => {
        const snap = await getDoc(doc(db, 'movDocuments', item.id)).catch(() => null)
        return enrichMov(snap?.exists() ? ({ id: snap.id, ...(snap.data() as any) } as Mov) : item, activeProgramId)
    }

    /** Open queries on a pack raised at a stage: the CC's block the CC, M&E's block M&E. */
    const openPackQueries = async (pack: Pack, stage: 'cc' | 'me') =>
        (await listPackQueries(pack.id)).filter((q: any) => isOpenQuery(q) && queryStage(q, isMonitoringDepartment) === stage)

    /** MOVs in the pack confirmed by the HOD's dispute decision instead of the SME's signature. */
    const decidedItems = (pack: Pack) => packItems(pack).filter((m: any) => !!m?.confirmationOverride)

    /** What still stops the CC (or M&E on the CC's behalf) confirming this pack. */
    const confirmBlockers = async (pack: Pack) => {
        const reviews = (pack as any).decisionReviews || {}
        return {
            openQueries: (await openPackQueries(pack, 'cc')).length,
            unreviewedDecisions: decidedItems(pack).filter(m => !reviews[m.id]).length
        }
    }

    /** The CC has looked at an MOV the HOD confirmed by dispute decision. */
    const reviewDecision = async (pack: Pack, movId: string, reviewed: boolean) => {
        await updateDoc(doc(db, 'consolidatedMOVs', pack.id), {
            [`decisionReviews.${movId}`]: reviewed ? { at: new Date(), byUid: user?.uid || null, byName: user?.name || null } : deleteField(),
            updatedAt: new Date()
        })
    }

    /** The CC confirms the pack (M&E can, on the CC's behalf, with a reason). Locks it for M&E. */
    const confirmPack = async (pack: Pack, onBehalfReason?: string) => {
        if (packStageOf(pack) !== 'cc') throw new Error('already-confirmed')
        const blockers = await confirmBlockers(pack)
        if (blockers.openQueries) throw new Error('open-queries')
        if (blockers.unreviewedDecisions) throw new Error('unreviewed-decisions')
        const reason = String(onBehalfReason || '').trim()
        const at = new Date()
        await updateDoc(doc(db, 'consolidatedMOVs', pack.id), {
            approvals: [
                ...(pack.approvals || []),
                {
                    step: 'final_confirmation',
                    ...me(),
                    date: at,
                    ...(reason ? { onBehalfOfCC: true, confirmationMode: 'me_on_behalf_of_cc', reason } : {})
                }
            ],
            status: PACK_STATUS.AWAITING_ME,
            ...(reason
                ? { ccConfirmationOnBehalf: { confirmedByUserId: user?.uid || null, confirmedByName: me().name, confirmedByEmail: user?.email || null, confirmedByRole: user?.role || '', confirmedAt: at, reason } }
                : { ccName: me().name, ccSignatureUrl: (await signatureOf()).signatureURL || null }),
            updatedAt: at
        })
    }

    /** M&E's check of one MOV in the pack, before validating it. */
    const setChecked = async (pack: Pack, item: Mov, checked: boolean) => {
        const poeUrls = buildPoeLinks(item)
        await updateDoc(doc(db, 'consolidatedMOVs', pack.id), {
            [`poeValidations.${item.id}`]: checked
                ? { status: 'validated', validatedAt: new Date(), validatorUserId: user?.uid || null, validatorEmail: user?.email || null, validatorName: user?.name || null, validatorRole: user?.role || null, poeUrl: poeUrls[0] || null, poeUrls }
                : deleteField(),
            updatedAt: new Date()
        })
    }

    /** The signer's saved signature (users/{uid}). */
    const signatureOf = async () => {
        const data = user?.uid ? ((await getDoc(doc(db, 'users', user.uid)).catch(() => null))?.data() as any) : null
        return {
            name: data?.name || user?.name || '',
            signatureURL: data?.signatureURL || data?.signatureUrl || user?.signatureURL || '',
            digitalSignature: data?.digitalSignature || ''
        }
    }

    /**
     * M&E validates the pack: every MOV checked, no open M&E query, a saved
     * signature. Signs the pack and each MOV's office-use block in one write;
     * the invoice becomes redeemable.
     */
    const validatePack = async (pack: Pack) => {
        if (packStageOf(pack) !== 'me') throw new Error(packStageOf(pack) === 'cc' ? 'not-confirmed' : 'already-validated')
        if ((await openPackQueries(pack, 'me')).length) throw new Error('open-queries')
        const checks = (pack as any).poeValidations || {}
        if (packItems(pack).some(m => checks[m.id]?.status !== 'validated')) throw new Error('unchecked')
        const sig = await signatureOf()
        if (!sig.signatureURL) throw new Error('no-signature')
        const at = new Date()
        const signer = {
            finalCheckerName: sig.name || null,
            finalCheckerSignature: sig.signatureURL,
            finalCheckerDate: at,
            officeUseDate: at,
            monitoringName: sig.name || null,
            monitoringSignatureUrl: sig.signatureURL,
            monitoringDigitalSignature: sig.digitalSignature || null
        }
        const batch = writeBatch(db)
        packItems(pack).forEach(m => {
            if (!m.id) return
            batch.update(doc(db, 'movDocuments', m.id), {
                ...signer,
                monitoringApproved: true,
                monitoringApprovedAt: at,
                monitoringUserId: user?.uid || null,
                monitoringEmail: user?.email || null,
                monitoringRole: user?.role || null,
                monitoringValidation: { status: 'validated', validatedAt: at, validatorUserId: user?.uid || null, validatorName: sig.name || null, signatureUrl: sig.signatureURL },
                updatedAt: at
            })
        })
        batch.update(doc(db, 'consolidatedMOVs', pack.id), {
            ...signer,
            interventions: packItems(pack).map(m => ({ ...m, ...signer, monitoringApproved: true, monitoringApprovedAt: at })),
            approvals: [...(pack.approvals || []), { step: 'validation', ...me(), date: at }],
            status: PACK_STATUS.INVOICE_REDEEMABLE,
            invoiceRedeemable: true,
            invoiceRedeemableAt: at,
            updatedAt: at
        })
        await batch.commit()
    }

    /** A CC or M&E query on one MOV in the pack (to its facilitator), or on the whole pack (to the HOD). */
    const raisePackQuery = async (pack: Pack, item: Mov | null, values: { queryType: string; message: string }) => {
        const stage = role === 'me' ? 'me' : 'cc'
        const to = item
            ? { id: item.facilitatorId || null, name: item.facilitatorName || null, email: item.facilitatorEmail || null, role: 'coordinator' }
            : { id: pack.hodUid || ((pack.approvals || []) as any[]).find((a: any) => a?.step === 'hod_submission')?.userId || null, name: pack.hodName || null, email: null, role: 'operations' }
        if (!to.id) throw new Error('no-recipient')
        await workflowQueryService.create({
            programId: String(pack.programId || activeProgramId || ''),
            type: values.queryType || 'general-query',
            message: String(values.message || '').trim(),
            raisedById: user?.uid || 'system',
            raisedBy: { ...actorOf(user), role: (user?.role || '').toLowerCase() },
            resolverId: to.id,
            resolver: { name: to.name, email: to.email, role: to.role },
            target: item ? { type: 'poe', id: item.id, parentType: 'mov-pack', parentId: pack.id } : { type: 'mov-pack', id: pack.id },
            context: {
                consolidatedMovId: pack.id,
                ...(item
                    ? {
                        movRowId: item.id,
                        movId: item.id,
                        participantId: item.beneficiaryId || item.smmeId || item.participantId || null,
                        interventionId: item.interventionId || null,
                        interventionTitle: item.interventionTitle || null
                    }
                    : { interventionTitle: `${pack.department || 'Department'} pack` }),
                departmentName: item?.departmentName || pack.department || null,
                packStage: stage
            }
        } as any)
    }

    /** An MOV's status as this role sees it: for a facilitator, "queried" means a query is waiting for their answer. */
    const statusOf = useCallback((m: Mov): MovStatus =>
        role === 'facilitator'
            ? queryIndex[m.id]?.open ? 'queried' : m.approvedByHod === true ? 'approved' : 'review'
            : movStatus(m), [role, queryIndex])

    return {
        role,
        /** Who is acting, for query answers and records. */
        actor: { id: user?.uid || '', ...actorOf(user) },
        statusOf,
        isMonitoringDepartment,
        movs,
        packs,
        queryIndex,
        packQueryIndex,
        loading,
        loadedOnce,
        packIndex,
        packMonthFor,
        isLate,
        monthSummaries,
        hodDigitalSignature,
        reload,
        listMovQueries,
        listPackQueries,
        approve,
        undoApproval,
        raiseQuery,
        resolveQuery,
        acceptAnswer,
        sendBackAnswer,
        acceptPackAnswer,
        decideDeliveryDispute,
        monthCandidates,
        createPack,
        refreshPreview,
        applyRefresh,
        addToPack,
        replaceInvoice,
        openPackFor,
        pendingChanges,
        loadPackMov,
        confirmBlockers,
        decidedItems,
        reviewDecision,
        confirmPack,
        setChecked,
        validatePack,
        raisePackQuery
    }
}

export type MovWorkspace = ReturnType<typeof useMovWorkspace>

const buildPoeLinks = (mov: Mov) => buildPoeList(mov).map(r => r.link)
