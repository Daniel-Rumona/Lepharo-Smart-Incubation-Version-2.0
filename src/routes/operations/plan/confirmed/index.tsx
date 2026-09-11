import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Empty,
    message,
    Modal,
    Progress,
    Segmented,
    Table,
    Tag,
    Typography,
    Divider,
    Select,
    Input,
    Space
} from 'antd'
import {
    collection,
    doc,
    getDocs,
    onSnapshot,
    query,
    updateDoc,
    where,
    setDoc,
    getDoc
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { applyKpiDeltas } from '@/lib/kpis'
import { toAssignedInterventionView } from '@/services/assignedInterventionService'
import { resolveAssignmentLifecycle } from '@/services/assignmentLifecycleService'
import { DocumentHeader } from '@/components/documents/DocumentHeader'
import { roundBtn } from '@/components/shared/StyledButton'
import {
    EditOutlined,
    LockOutlined,
    ProfileOutlined,
    RiseOutlined
} from '@ant-design/icons'

const { Text, Title } = Typography

type DeptDoc = {
    id: string
    name: string

    interventionsDepartment?: boolean
    parentDepartmentId?: string | null
    parentDeptId?: string | null
    parentId?: string | null
    parentDepartmentName?: string | null
    parentDeptName?: string | null
    parentName?: string | null
}

type SignatureResolved = {
    label: string
    signer?: string
    confirmedAt?: Date | null
    signatureUrl?: string | null
}

type SignRow = {
    deptId: string
    deptName: string
    hod: SignatureResolved
    sme: SignatureResolved
}

export interface ConfirmedInterventionsModalProps {
    open: boolean
    participantId: string
    department: string
    onClose: () => void
}

const normalize = (s: string) =>
    String(s || '')
        .normalize('NFKC')
        .replace(/[’‘]/g, "'")
        .replace(/&/g, 'and')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()

const SAME = (a?: string, b?: string) => normalize(a || '') === normalize(b || '')

const toDateSafe = (v: any) => {
    if (!v) return null
    if (typeof v?.toDate === 'function') return v.toDate()
    if (v?.seconds) return new Date(v.seconds * 1000)
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
}

const resolveParentId = (d: DeptDoc) =>
    (d.parentDepartmentId ?? d.parentDeptId ?? d.parentId ?? null) as string | null
const resolveParentName = (d: DeptDoc) =>
    (d.parentDepartmentName ?? d.parentDeptName ?? d.parentName ?? null) as string | null

const pickSignatureUrl = (obj: any): string | null => {
    if (!obj || typeof obj !== 'object') return null
    const candidates = [
        obj.signatureUrl,
        obj.signatureURL,
        obj.signature,
        obj.signatureImageUrl,
        obj.signatureImageURL,
        obj.signatureDataUrl,
        obj.signatureDataURL,
        obj.eSignatureUrl,
        obj.eSignatureURL,
        obj.digitalSignatureUrl,
        obj.digitalSignatureURL,
        obj.signedUrl,
        obj.signedURL
    ]
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim()
    }
    return null
}

const pickSigner = (obj: any): string | undefined => {
    if (!obj || typeof obj !== 'object') return undefined
    const candidates = [
        obj.confirmedBy,
        obj.confirmedByEmail,
        obj.email,
        obj.signedBy,
        obj.signedByEmail,
        obj.userEmail,
        obj.uid
    ]
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim()
    }
    return undefined
}

async function safeFindUserSignatureByUid(uid?: string | null): Promise<string | null> {
    const id = String(uid || '').trim()
    if (!id) return null

    try {
        const uRef = doc(db, 'users', id)
        const uSnap = await getDoc(uRef)
        if (uSnap.exists()) {
            const u = uSnap.data() as any
            return (
                pickSignatureUrl(u) ||
                pickSignatureUrl(u?.digitalSignature) ||
                pickSignatureUrl(u?.eSignature) ||
                null
            )
        }
    } catch {
        // ignore
    }

    return null
}


const isConfirmed = (v: any) => v === true || (v && typeof v === 'object' && v.confirmed === true)

const getDeptConfirmMaps = (plan: any) => {
    const byId = (plan?.confirmedByDeptId || null) as Record<string, any> | null
    const byName = ((plan?.confirmed || {}) as Record<string, any>) || {}
    return { byId, byName }
}

const getSmmeConfirmMaps = (plan: any) => {
    // The roadmap writes the SME's actual confirmation to the incubatee
    // map. Department saves may also create an empty/partial smme map.
    // Combine department entries so that map cannot hide the SME's signer,
    // confirmation date or signature (including the profile fallback).
    const byId: Record<string, any> = {
        ...(plan?.smmeConfirmedByDeptId || {}),
        ...(plan?.incubateeDepartmentConfirmationsByDeptId || {})
    }

    const byName: Record<string, any> = {
        ...(plan?.smmeConfirmedMap || {}),
        ...(plan?.incubateeDepartmentConfirmations || {}),
        ...(plan?.incubateeConfirmedByDept || {}),
        ...(plan?.smmeConfirmedByDept || {})
    }

    return { byId, byName }
}

const getSubmittedDeptIdStrict = (intv: any) => {
    const did = String(intv.departmentId || '').trim()
    if (did) return did
    const abd = String(intv.addedByDeptId || '').trim()
    if (abd) return abd
    return ''
}

async function safeFindUserSignatureByEmail(email?: string | null): Promise<string | null> {
    if (!email) return null

    try {
        const uSnap = await getDocs(query(collection(db, 'users'), where('email', '==', email)))
        if (!uSnap.empty) {
            const u = uSnap.docs[0].data() as any
            const sig = pickSignatureUrl(u) || pickSignatureUrl(u?.digitalSignature) || pickSignatureUrl(u?.eSignature)
            if (sig) return sig
        }
    } catch { }

    try {
        const oSnap = await getDocs(query(collection(db, 'operations'), where('email', '==', email)))
        if (!oSnap.empty) {
            const o = oSnap.docs[0].data() as any
            const sig = pickSignatureUrl(o) || pickSignatureUrl(o?.digitalSignature) || pickSignatureUrl(o?.eSignature)
            if (sig) return sig
        }
    } catch { }

    return null
}

const ConfirmedInterventionsModal: React.FC<ConfirmedInterventionsModalProps> = ({
    open,
    participantId,
    department,
    onClose
}) => {
    const { user } = useFullIdentity()
    const roleRaw = String((user as any)?.role || (user as any)?.userRole || (user as any)?.position || '')
        .toLowerCase()
        .trim()

    const isHOD = roleRaw === 'operations'
    const isCoordinator = roleRaw === 'coordinator'
    const coordinatorId = String(
        (user as any)?.coordinatorId || (user as any)?.uid || (user as any)?.id || ''
    ).trim()

    const isROM = String(user?.departmentName || '').toLowerCase().includes('rom')


    type SectionKey = 'plan' | 'delivery' | 'signatures'
    const [section, setSection] = useState<SectionKey>('plan')

    const [programId, setProgramId] = useState<string>('')

    const [loading, setLoading] = useState(true)
    const [confirmedInterventions, setConfirmedInterventions] = useState<any[]>([])

    const [submittedDeptIds, setSubmittedDeptIds] = useState<string[]>([])
    const [submittedDeptNames, setSubmittedDeptNames] = useState<string[]>([])
    const [totalDepartments, setTotalDepartments] = useState<number>(0)

    const [isFinalised, setIsFinalised] = useState(false)
    const [participantInfo, setParticipantInfo] = useState<any>(null)

    const [latestPlanRef, setLatestPlanRef] = useState<any>(null)
    const [latestPlanData, setLatestPlanData] = useState<any>(null)

    /** Live delivery records for this participant */
    const [assignments, setAssignments] = useState<any[]>([])

    const [deptDocs, setDeptDocs] = useState<DeptDoc[]>([])
    const [deptIdToName, setDeptIdToName] = useState<Record<string, string>>({})

    const [myDeptId, setMyDeptId] = useState<string>('')
    const [myParentDeptName, setMyParentDeptName] = useState<string>('')
    const [myChildDeptIds, setMyChildDeptIds] = useState<string[]>([])

    // Parent Dept Adding Interventions
    const [addOpen, setAddOpen] = useState(false)
    const [savingAdd, setSavingAdd] = useState(false)
    const [interventionsCatalog, setInterventionsCatalog] = useState<any[]>([])
    const [selectedInterventionId, setSelectedInterventionId] = useState<string>('')

    // Signatures
    const [signRows, setSignRows] = useState<SignRow[]>([])
    const [sigLoading, setSigLoading] = useState(false)

    const isParentDeptUser = useMemo(() => {
        if (!isHOD) return false
        if (!myDeptId) return false

        return myChildDeptIds.length > 0
    }, [isHOD, myDeptId, myChildDeptIds])

    const [unlockOpen, setUnlockOpen] = useState(false)
    const [unlockReason, setUnlockReason] = useState('')

    const [reqOpen, setReqOpen] = useState(false)
    const [reqReason, setReqReason] = useState('')
    const [reqSaving, setReqSaving] = useState(false)
    const [unlockSaving, setUnlockSaving] = useState(false)


    // One effect loads everything (apps -> depts -> catalog -> plan -> UI)
    useEffect(() => {
        if (!open) return
        let cancelled = false

        const run = async () => {
            setLoading(true)
            setSigLoading(false)
            setSignRows([])
            // Reopening should land on Plan, not wherever the last visit ended.
            setSection('plan')

            try {
                // Current logged-in dept (authoritative)
                const myDeptIdFromUser = String((user as any)?.departmentId || '').trim()
                const myDeptNameFromUser = String((user as any)?.departmentName || department || '').trim()

                if (!myDeptIdFromUser || !myDeptNameFromUser) {
                    message.error('Missing your department details.')
                    return
                }

                setMyDeptId(myDeptIdFromUser)


                // 1) application / participant info
                let appData: any = null
                const appsSnap = await getDocs(
                    query(collection(db, 'applications'), where('participantId', '==', participantId))
                )
                if (!appsSnap.empty) {
                    appData = appsSnap.docs[0].data()
                    if (!cancelled) {
                        setParticipantInfo(appData)
                        setProgramId(String(appData?.programId || appData?.program?.id || ''))
                    }
                } else {
                    if (!cancelled) setParticipantInfo(null)
                }

                // 2) departments — still needed to derive parent/children + names
                const depSnap = await getDocs(
                    query(
                        collection(db, 'departments'),
                        where('interventionsDepartment', '==', true)
                    )
                )
                const depts: DeptDoc[] = depSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as any
                const idToName = depts.reduce((acc: Record<string, string>, d) => {
                    acc[d.id] = String(d.name || '')
                    return acc
                }, {})

                if (cancelled) return
                setDeptDocs(depts)
                setDeptIdToName(idToName)
                setTotalDepartments(depts.length)

                // Derive parent + children (NO deriving myDeptId from departments anymore)
                const myDoc =
                    depts.find(d => String(d.id) === myDeptIdFromUser) ||
                    depts.find(d => SAME(d.name, myDeptNameFromUser)) ||
                    null

                // parent name
                // Your department itself is the potential parent.
                // We only consider you a parent if another department explicitly points to you.
                const ownDeptName = String(myDoc?.name || myDeptNameFromUser).trim()

                setMyParentDeptName(ownDeptName)

                const childIds = depts
                    .filter(d => {
                        // Never treat the current department as its own child
                        if (d.id === myDeptIdFromUser) return false

                        const childParentId = String(resolveParentId(d) || '').trim()
                        const childParentName = String(resolveParentName(d) || '').trim()

                        // Authoritative relationship: child's parent ID points to my department
                        if (childParentId) {
                            return childParentId === myDeptIdFromUser
                        }

                        // Legacy fallback only where no parent ID exists
                        if (childParentName) {
                            return SAME(childParentName, ownDeptName)
                        }

                        return false
                    })
                    .map(d => d.id)

                setMyChildDeptIds(childIds)

                // 3) catalog (company scoped) — build local id->title map
                const catSnap = await getDocs(
                    query(collection(db, 'interventions'))
                )
                const catalog = catSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
                const catalogIdToTitle: Record<string, string> = {}
                for (const i of catalog) {
                    const id = String(i.id || '').trim()
                    const title = normalize(i.interventionTitle || i.title || '')
                    if (id && title) catalogIdToTitle[id] = title
                }
                if (!cancelled) setInterventionsCatalog(catalog)

                // 4) latest plan
                const plansSnap = await getDocs(
                    query(collection(db, 'diagnosticPlans'), where('participantId', '==', participantId))
                )
                if (plansSnap.empty) {
                    if (!cancelled) {
                        setIsFinalised(false)
                        setSubmittedDeptIds([])
                        setSubmittedDeptNames([])
                        setConfirmedInterventions([])
                        setLatestPlanRef(null)
                        setLatestPlanData(null)
                    }
                    return
                }

                let latest = plansSnap.docs[0]
                let latestMs = toDateSafe(plansSnap.docs[0].data()?.createdAt)?.getTime?.() || 0
                for (const d of plansSnap.docs) {
                    const ms = toDateSafe(d.data()?.createdAt)?.getTime?.() || 0
                    if (ms >= latestMs) {
                        latest = d
                        latestMs = ms
                    }
                }

                const plan: any = latest.data()
                if (!cancelled) {
                    setLatestPlanRef(latest.ref)
                    setLatestPlanData(plan)
                    setIsFinalised(plan.finalConfirmation === true)
                }

                // 5) submitted dept ids
                const deptIds = depts.map(d => d.id)
                const deptNames = depts.map(d => String(d.name || ''))
                const { byId } = getDeptConfirmMaps(plan)

                let submitted: string[] = []
                if (byId && typeof byId === 'object') {
                    submitted = Object.entries(byId)
                        .filter(([deptId, v]: any) => isConfirmed(v) && deptIds.includes(deptId))
                        .map(([deptId]) => deptId)
                } else {
                    const legacy = plan.confirmed || {}
                    const submittedNames = Object.entries(legacy)
                        .filter(([name, v]: any) => isConfirmed(v) && deptNames.some(n => SAME(n, name)))
                        .map(([name]) => name)

                    submitted = submittedNames
                        .map(nm => depts.find(d => SAME(d.name, nm))?.id)
                        .filter(Boolean) as string[]
                }

                if (!cancelled) {
                    setSubmittedDeptIds(submitted)
                    setSubmittedDeptNames(submitted.map(id => idToName[id]).filter(Boolean))
                }

                // strict id+title match
                const strictMatchesCatalog = (intv: any): boolean => {
                    const intvId = String(intv.id || '').trim()
                    const intvTitle = normalize(intv.title || '')
                    if (!intvId || !intvTitle) return false
                    const catalogTitle = catalogIdToTitle[intvId]
                    if (!catalogTitle) return false
                    return catalogTitle === intvTitle
                }

                // 6) interventions visible
                const allInterventions = (plan.interventions || []).map((intv: any) => {
                    const submittedDeptId = getSubmittedDeptIdStrict(intv)
                    const submittedDeptName =
                        idToName[submittedDeptId] || String(intv.addedByDeptName || '') || '-'

                    const ddoc = depts.find(d => d.id === submittedDeptId) || null
                    const pid = ddoc ? resolveParentId(ddoc) : null
                    const pname = ddoc ? resolveParentName(ddoc) : null
                    const parentDeptName = pid && idToName[pid]
                        ? idToName[pid]
                        : (pname || ddoc?.name || String(intv.area || '-') || '-')

                    const confirmedAtObj = plan?.confirmedByDeptId?.[submittedDeptId]
                    const confirmedAt =
                        toDateSafe(confirmedAtObj?.confirmedAt) || toDateSafe(plan?.createdAt) || new Date()

                    return { ...intv, submittedDeptId, submittedDeptName, parentDeptName, confirmedAt }
                })

                const visible = allInterventions.filter((intv: any) => {
                    const deptId = String(intv.submittedDeptId || '').trim()
                    if (!deptId) return false
                    if (!deptIds.includes(deptId)) return false
                    if (!strictMatchesCatalog(intv)) return false

                    if (isROM) return submitted.includes(deptId)

                    const parentView =
                        isHOD &&
                        !!myDeptIdFromUser &&
                        childIds.length > 0

                    if (parentView) {
                        const isUnderMe = childIds.includes(deptId) && deptId !== myDeptIdFromUser
                        return isUnderMe && submitted.includes(deptId)
                    }

                    return deptId === myDeptIdFromUser
                })

                /**
                 * Collapse exact duplicates.
                 *
                 * A plan can hold the same entry twice: a re-save only strips
                 * prior interventions carrying departmentId or addedByDeptId, so
                 * older records missing both survive alongside the new ones.
                 * Those duplicates share the table's rowKey, and colliding keys
                 * make the table render doubled rows after a page change.
                 *
                 * Keyed on the same tuple as rowKey, so the same intervention
                 * submitted by two different departments is still two rows.
                 */
                const seenRowKeys = new Set<string>()
                const deduped = visible.filter((intv: any) => {
                    const rowKey = `${String(intv.id || '')}::${String(
                        intv.submittedDeptId || ''
                    )}::${String(intv.title || '')}`
                    if (seenRowKeys.has(rowKey)) return false
                    seenRowKeys.add(rowKey)
                    return true
                })

                if (!cancelled) setConfirmedInterventions(deduped)

                // 7) signatures (unchanged)
                if (!cancelled) setSigLoading(true)

                const rows: SignRow[] = []
                const { byId: deptById, byName: deptByName } = getDeptConfirmMaps(plan)
                const { byId: smeById, byName: smeByName } = getSmmeConfirmMaps(plan)

                const resolveDeptConfirmObj = (deptId: string) => {
                    if (deptById && deptById[deptId]) return deptById[deptId]
                    const deptName = idToName[deptId]
                    if (deptName && deptByName && deptByName[deptName]) return deptByName[deptName]
                    return null
                }

                const resolveSmmeConfirmObj = (deptId: string) => {
                    if (smeById && smeById[deptId]) return smeById[deptId]
                    const deptName = idToName[deptId]
                    if (deptName && smeByName && smeByName[deptName]) return smeByName[deptName]
                    return null
                }

                const parentView =
                    isHOD &&
                    !!myDeptIdFromUser &&
                    childIds.length > 0

                const targetDeptIds = parentView
                    ? submitted.filter(did => did && did !== myDeptIdFromUser && childIds.includes(did))
                    : [myDeptIdFromUser]

                for (const deptId of targetDeptIds) {
                    const deptName = idToName[deptId] || '—'
                    const hodObj = resolveDeptConfirmObj(deptId)
                    const smeObj = resolveSmmeConfirmObj(deptId)

                    let hodSig = pickSignatureUrl(hodObj)
                    let smeSig = pickSignatureUrl(smeObj)

                    const hodSignerUid = String(hodObj?.confirmedBy || hodObj?.uid || '').trim()
                    const smeSignerEmail = pickSigner(smeObj)

                    const hodAt = toDateSafe(hodObj?.confirmedAt) || toDateSafe(plan?.createdAt)
                    const smeAt = toDateSafe(smeObj?.confirmedAt)

                    if (!hodSig && hodSignerUid) {
                        hodSig = await safeFindUserSignatureByUid(hodSignerUid)
                    }
                    if (!smeSig && smeSignerEmail) {
                        smeSig = await safeFindUserSignatureByEmail(smeSignerEmail)
                    }

                    rows.push({
                        deptId,
                        deptName,
                        hod: { label: 'HOD Signature', signer: hodSignerUid, confirmedAt: hodAt, signatureUrl: hodSig },
                        sme: { label: 'SME Signature', signer: smeSignerEmail, confirmedAt: smeAt, signatureUrl: smeSig }
                    })
                }

                if (!cancelled) setSignRows(rows)
            } catch (err) {
                console.error(err)
                message.error('Failed to load confirmed interventions')
            } finally {
                if (!cancelled) {
                    setLoading(false)
                    setSigLoading(false)
                }
            }
        }

        run()

        return () => {
            cancelled = true
        }
    }, [
        open,
        participantId,
        department,
        isROM,
        isHOD,
        user?.departmentId,
        user?.departmentName
    ])

    /**
     * Keep the plan itself live while the modal is open.
     *
     * Only this document changes as other departments confirm — the department
     * list, catalogue and application are static for the session, so they stay
     * on the one-shot load above and we hold a single listener rather than
     * re-running the whole chain.
     */
    useEffect(() => {
        if (!open || !latestPlanRef) return

        const unsubscribe = onSnapshot(
            latestPlanRef,
            (snapshot: any) => {
                if (!snapshot.exists()) return
                const plan = snapshot.data() as any

                setLatestPlanData(plan)
                setIsFinalised(plan?.finalConfirmation === true)

                const deptIds = deptDocs.map(d => d.id)
                const { byId } = getDeptConfirmMaps(plan)

                let submitted: string[] = []
                if (byId && typeof byId === 'object') {
                    submitted = Object.entries(byId)
                        .filter(([deptId, value]: any) => isConfirmed(value) && deptIds.includes(deptId))
                        .map(([deptId]) => deptId)
                } else {
                    const legacy = plan?.confirmed || {}
                    submitted = Object.entries(legacy)
                        .filter(([, value]: any) => isConfirmed(value))
                        .map(([name]) => deptDocs.find(d => SAME(d.name, name))?.id)
                        .filter(Boolean) as string[]
                }

                setSubmittedDeptIds(submitted)
                setSubmittedDeptNames(
                    submitted.map(id => deptIdToName[id]).filter(Boolean)
                )
            },
            error => console.error('Live plan updates unavailable', error)
        )

        return () => unsubscribe()
    }, [open, latestPlanRef, deptDocs, deptIdToName])

    /**
     * Live delivery records. This is what actually moves day to day — sessions
     * logged, completions confirmed — so the coverage figures update while the
     * modal is open rather than freezing at whatever was true when it loaded.
     */
    useEffect(() => {
        if (!open || !participantId) {
            setAssignments([])
            return
        }

        const unsubscribe = onSnapshot(
            query(
                collection(db, 'assignedInterventions'),
                where('participantId', '==', participantId)
            ),
            snapshot => {
                setAssignments(
                    snapshot.docs.map(d => toAssignedInterventionView(d.id, d.data() as any))
                )
            },
            error => console.error('Live delivery updates unavailable', error)
        )

        return () => unsubscribe()
    }, [open, participantId])

    /**
     * Delivery coverage: how much of the confirmed plan has actually been
     * carried out, joined from live assignments.
     *
     * One row per planned intervention, because that is the unit the plan was
     * confirmed in. Repeat deliveries and sub-interventions roll up into it as
     * counts rather than extra rows.
     */
    const coverageRows = useMemo(() => {
        const byIntervention = new Map<string, any[]>()

        for (const assignment of assignments) {
            const key = String(assignment?.interventionId || '').trim()
            if (!key) continue
            if (!byIntervention.has(key)) byIntervention.set(key, [])
            byIntervention.get(key)!.push(assignment)
        }

        /**
         * The plan can carry the same intervention more than once — a re-save
         * only strips prior entries that carry departmentId or addedByDeptId, so
         * older records missing both survive alongside the new ones. Counting
         * those twice would inflate the coverage figures, so collapse them here
         * on id + title.
         */
        const seen = new Set<string>()
        const uniquePlanned = confirmedInterventions.filter((intervention: any) => {
            const dedupeKey = `${String(intervention?.id || '').trim()}::${String(
                intervention?.title || ''
            ).trim().toLowerCase()}`
            if (seen.has(dedupeKey)) return false
            seen.add(dedupeKey)
            return true
        })

        return uniquePlanned.map((intervention: any) => {
            const key = String(intervention?.id || '').trim()
            const matches = byIntervention.get(key) || []

            let completed = 0
            let active = 0
            let sessions = 0
            let lastActivity: Date | null = null
            const subInterventions = new Set<string>()

            for (const match of matches) {
                const lifecycle = resolveAssignmentLifecycle(match)

                if (lifecycle.key === 'completed') completed += 1
                else if (lifecycle.key !== 'cancelled') active += 1

                sessions += Number(match?.tracking?.sessionsLogged || 0)

                const subTitle = String(
                    match?.subInterventionTitle || match?.subInterventionId || ''
                ).trim()
                if (subTitle) subInterventions.add(subTitle)

                const at =
                    toDateSafe(match?.updatedAt) ||
                    toDateSafe(match?.assigneeCompletedAt) ||
                    toDateSafe(match?.createdAt)
                if (at && (!lastActivity || at > lastActivity)) lastActivity = at
            }

            const state: 'delivered' | 'in-progress' | 'not-started' =
                completed > 0 ? 'delivered' : matches.length > 0 ? 'in-progress' : 'not-started'

            return {
                key: key || intervention?.title,
                title: String(intervention?.title || 'Untitled'),
                deptName: String(intervention?.submittedDeptName || '—'),
                assignments: matches.length,
                completed,
                active,
                sessions,
                subInterventions: Array.from(subInterventions),
                lastActivity,
                state
            }
        })
    }, [confirmedInterventions, assignments])

    const coverage = useMemo(() => {
        const total = coverageRows.length
        const delivered = coverageRows.filter(row => row.state === 'delivered').length
        const inProgress = coverageRows.filter(row => row.state === 'in-progress').length
        const sessions = coverageRows.reduce((sum, row) => sum + row.sessions, 0)

        return {
            total,
            delivered,
            inProgress,
            notStarted: total - delivered - inProgress,
            sessions,
            percent: total ? Math.round((delivered / total) * 100) : 0
        }
    }, [coverageRows])

    /**
     * Read from the live plan document rather than signRows, which is built by
     * the one-shot load and would otherwise leave this stage stale.
     *
     * The SME signs per department, so this counts as signed only once every
     * confirmed department has a matching SME confirmation — a partial set is
     * still in progress.
     */
    const smeSignedAt = useMemo(() => {
        if (!submittedDeptIds.length) return null

        const { byId } = getSmmeConfirmMaps(latestPlanData)
        if (!byId || typeof byId !== 'object') return null

        const dates: Date[] = []
        for (const deptId of submittedDeptIds) {
            const entry = byId[deptId]
            if (!isConfirmed(entry)) return null
            const at = toDateSafe(entry?.confirmedAt)
            if (at) dates.push(at)
        }

        if (!dates.length) return null
        return dates.reduce((latest, current) => (current > latest ? current : latest))
    }, [latestPlanData, submittedDeptIds])

    const handleUnlockPlan = async () => {
        if (!latestPlanRef) return
        if (!myDeptId) return message.error('Could not resolve your department ID.')
        setUnlockSaving(true)
        try {
            await updateDoc(latestPlanRef, {
                'devPlanEdit.unlocked': true,
                'devPlanEdit.unlockedAt': new Date(),
                'devPlanEdit.unlockedBy': user?.email || user?.uid || '',
                'devPlanEdit.unlockedReason': unlockReason.trim() || null,

                // unlock FOR THIS dept (subdept/hod edits their own)
                'devPlanEdit.unlockedForDeptId': myDeptId,
                'devPlanEdit.unlockedForDeptName': department,

                // clear request flags if any
                'devPlanEdit.changeRequested': false,
                'devPlanEdit.changeRequestStatus': 'approved',
                'devPlanEdit.changeRequestReason': null,
                'devPlanEdit.changeRequestedByDeptId': null,
                'devPlanEdit.changeRequestedByDeptName': null,
            })

            message.success('Plan unlocked for your department.')
            setUnlockOpen(false)
            setUnlockReason('')
        } catch (e) {
            console.error(e)
            message.error('Failed to unlock plan.')
        } finally {
            setUnlockSaving(false)
        }
    }

    const handleRequestUnlock = async () => {
        if (!isCoordinator) return message.error('Only coordinators can request a plan edit.')
        if (!latestPlanRef) return
        if (!latestPlanData) return
        if (!myDeptId) return message.error('Could not resolve your department ID.')
        if (!reqReason.trim()) return message.error('Please provide a reason.')
        if (latestPlanData?.devPlanEdit?.changeRequested === true) {
            return message.info('An edit request is already awaiting HOD confirmation.')
        }

        // request goes to the parent dept of THIS dept
        const myDoc = deptDocs.find(d => d.id === myDeptId) || null
        const hodDeptId = resolveParentId(myDoc as any) || myDeptId
        const hodDeptName = (hodDeptId && deptIdToName[hodDeptId]) ? deptIdToName[hodDeptId] : (myDoc?.name || department)

        setReqSaving(true)
        try {
            const reqRef = doc(collection(db, 'dpChangeRequests')) // auto-id

            await setDoc(reqRef, {
                programId: programId || null,
                participantId,
                diagnosticPlanDocId: (latestPlanRef as any).id || null,

                // who is requesting
                requestedByUserEmail: user?.email || null,
                requestedByUserId: user?.uid || null,
                requestedByRole: 'coordinator',
                coordinatorId: coordinatorId || null,

                // which dept wants edit
                requestedByDeptId: myDeptId,
                requestedByDeptName: department,

                // who must decide
                hodDeptId,
                hodDeptName,

                reason: reqReason.trim(),
                requestType: 'coordinator_edit',
                status: 'pending',
                createdAt: new Date(),
            })

            // optional: reflect request in the DP doc for quick UI
            await updateDoc(latestPlanRef, {
                'devPlanEdit.changeRequested': true,
                'devPlanEdit.changeRequestStatus': 'pending',
                'devPlanEdit.changeRequestReason': reqReason.trim(),
                'devPlanEdit.changeRequestedByDeptId': myDeptId,
                'devPlanEdit.changeRequestedByDeptName': department,
                'devPlanEdit.coordinatorId': coordinatorId || null,
                'devPlanEdit.targetRole': 'operations',
            })

            setLatestPlanData((current: any) => ({
                ...current,
                devPlanEdit: {
                    ...(current?.devPlanEdit || {}),
                    changeRequested: true,
                    changeRequestStatus: 'pending',
                    changeRequestReason: reqReason.trim(),
                    changeRequestedByDeptId: myDeptId,
                    changeRequestedByDeptName: department,
                    coordinatorId: coordinatorId || null,
                    targetRole: 'operations'
                }
            }))

            message.success('Unlock request sent to HOD.')
            setReqOpen(false)
            setReqReason('')
        } catch (e) {
            console.error(e)
            message.error('Failed to submit request.')
        } finally {
            setReqSaving(false)
        }
    }

    const subDeptStatusRows = useMemo(() => {
        if (!latestPlanData) return []
        if (!isParentDeptUser) return []
        if (!myDeptId || myChildDeptIds.length === 0) return []

        const plan = latestPlanData
        const { byId: deptById, byName: deptByName } = getDeptConfirmMaps(plan)
        const { byId: smeById, byName: smeByName } = getSmmeConfirmMaps(plan)

        // child depts only (exclude the parent dept itself)
        const childIds = myChildDeptIds.filter(id => id && id !== myDeptId)

        const resolveConfirmObj = (deptId: string) => {
            if (deptById && deptById[deptId]) return deptById[deptId]
            const name = deptIdToName[deptId]
            if (name && deptByName && deptByName[name]) return deptByName[name]
            return null
        }

        const resolveSmmeObj = (deptId: string) => {
            if (smeById && smeById[deptId]) return smeById[deptId]
            const name = deptIdToName[deptId]
            if (name && smeByName && smeByName[name]) return smeByName[name]
            return null
        }

        // interventions per dept (what you already built into confirmedInterventions)
        const perDeptIntvCount: Record<string, number> = {}
        for (const it of confirmedInterventions || []) {
            const did = String(it?.submittedDeptId || it?.departmentId || '').trim()
            if (!did) continue
            perDeptIntvCount[did] = (perDeptIntvCount[did] || 0) + 1
        }

        const rows = childIds.map(deptId => {
            const deptName = deptIdToName[deptId] || '—'

            const deptObj = resolveConfirmObj(deptId)
            const smeObj = resolveSmmeObj(deptId)

            const deptConfirmed = isConfirmed(deptObj)
            const smeConfirmed = isConfirmed(smeObj)

            const deptConfirmedAt =
                toDateSafe(deptObj?.confirmedAt) ||
                toDateSafe(deptObj?.confirmedOn) ||
                null

            const smeConfirmedAt =
                toDateSafe(smeObj?.confirmedAt) ||
                toDateSafe(smeObj?.confirmedOn) ||
                null

            const lastConfirmedAt =
                [deptConfirmedAt, smeConfirmedAt].filter(Boolean).sort((a: any, b: any) => (b as any) - (a as any))[0] ||
                null

            return {
                key: deptId,
                deptId,
                deptName,
                deptConfirmed,
                smeConfirmed,
                intvCount: perDeptIntvCount[deptId] || 0,
                lastConfirmedAt
            }
        })

        // show hold-ups first: dept not confirmed, then SME not confirmed
        rows.sort((a, b) => {
            const aHold = (a.deptConfirmed ? 0 : 2) + (a.smeConfirmed ? 0 : 1)
            const bHold = (b.deptConfirmed ? 0 : 2) + (b.smeConfirmed ? 0 : 1)
            if (aHold !== bHold) return bHold - aHold
            return String(a.deptName).localeCompare(String(b.deptName))
        })

        return rows
    }, [latestPlanData, isParentDeptUser, myDeptId, myChildDeptIds, deptIdToName, confirmedInterventions])

    const columns = useMemo(() => {
        const cols: any[] = [{ title: 'Title', dataIndex: 'title', key: 'title' }]

        // Parent view: show actual subdepartment that submitted it
        if (isParentDeptUser) {
            cols.push({
                title: 'Department',
                key: 'department',
                render: (_: any, r: any) => <Tag>{r.submittedDeptName || '—'}</Tag>
            })
        } else {
            cols.push({
                title: 'Submitted By',
                key: 'submittedBy',
                render: (_: any, r: any) => r.submittedDeptName || '-'
            })
        }

        cols.push({
            title: 'Confirmed At',
            dataIndex: 'confirmedAt',
            key: 'confirmedAt',
            render: (d: Date) => d?.toLocaleString?.() || '-'
        })

        return cols
    }, [isParentDeptUser])

    const canShowFinalise =
        isROM && !isFinalised && totalDepartments > 0 && submittedDeptNames.length >= totalDepartments

    const parentAddOptions = useMemo(() => {
        if (!isParentDeptUser) return []
        const parentDeptName = myParentDeptName || department
        const parentDeptId = myDeptId

        return interventionsCatalog
            .filter(i => {
                const deptId = String(i.departmentId || '').trim()
                if (deptId && parentDeptId) return deptId === parentDeptId
                const area = String(i.areaOfSupport || i.area || '').trim()
                return area ? SAME(area, parentDeptName) : false
            })
            .map(i => ({
                value: String(i.id),
                label: `${i.interventionTitle || i.title || 'Untitled'} — ${i.areaOfSupport || i.area || ''}`
            }))
    }, [interventionsCatalog, isParentDeptUser, myDeptId, myParentDeptName, department])

    const handleFinalisePlan = async () => {
        try {
            if (!latestPlanRef) return
            if (!isROM) return message.error('Only ROM can finalise the Developmental Plan.')

            let programId = ''
            const appsSnap = await getDocs(query(collection(db, 'applications'), where('participantId', '==', participantId)))
            if (!appsSnap.empty) {
                const app = appsSnap.docs[0].data() as any
                programId = app.programId || app.program?.id || ''
            }

            await updateDoc(latestPlanRef, { finalConfirmation: true })
            setIsFinalised(true)
            message.success('Developmental Plan finalised')

            const fileRef = doc(db, 'diagnosticPlanReports', participantId)
            const finalisedAt = new Date()
            const interventions = confirmedInterventions.map(({ title, area, addedByDeptName }) => ({
                title,
                area,
                addedByDeptName
            }))

            await setDoc(fileRef, {
                participantId,
                beneficiaryName: participantInfo?.beneficiaryName,
                programName: participantInfo?.programName,
                interventions,
                finalisedAt,
                finalisedBy: user?.email
            })

            // KPI updates
            let kpiIndex: Record<string, string[]> = {}
            const intvSnap = await getDocs(query(collection(db, 'interventions')))
            kpiIndex = intvSnap.docs.reduce((acc: Record<string, string[]>, d) => {
                const data = d.data() as any
                const title = data.interventionTitle || data.title || ''
                const ids = Array.isArray(data.kpiIds) ? data.kpiIds.map(String) : []
                if (title && ids.length) acc[normalize(title)] = ids
                return acc
            }, {})

            const now = new Date()
            const q = Math.floor(now.getMonth() / 3) + 1
            const quarterKey = `${now.getFullYear()}-Q${q}`

            for (const it of interventions) {
                const titleKey = normalize(it.title)
                const ids = kpiIndex[titleKey] || []
                if (!ids.length) continue

                const deltas = ids.reduce<Record<string, { mode: 'increment'; value: number }>>((m, id) => {
                    m[id] = { mode: 'increment', value: 1 }
                    return m
                }, {})

                await applyKpiDeltas(
                    {
                        participantId,
                        programId: programId || 'unknown',
                        areaOfSupport: (it as any).area || '',
                        quarter: quarterKey
                    },
                    deltas
                )
            }
        } catch (err) {
            console.error(err)
            message.error('Failed to finalise the plan')
        }
    }

    return (
        <Modal
            centered
            title={'Confirmed Interventions'}
            open={open}
            onCancel={onClose}
            footer={null}
            width={1100}
            style={{ top: 24 }}
            destroyOnClose
        >
            <div style={{ minHeight: 520 }}>
                <Card loading={loading} bordered={false}>
                    <DocumentHeader
                        title={participantInfo?.beneficiaryName || '—'}
                        subtitle="Developmental Plan"
                        programName={participantInfo?.programName || '_'}
                    />

                    {/*
                      * Section switcher and the plan action share one row: the
                      * switcher takes the remaining width, the action sits at the
                      * end so it stays in a predictable place across sections.
                      */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            width: '100%',
                            margin: '16px 0'
                        }}
                    >
                        <Segmented
                            block
                            value={section}
                            onChange={value => setSection(value as SectionKey)}
                            style={{ flex: 1, minWidth: 0 }}
                            options={[
                                {
                                    value: 'plan',
                                    label: (
                                        <Space size={6}>
                                            <ProfileOutlined />
                                            <span>Plan</span>
                                            <Tag style={{ marginInlineEnd: 0 }}>
                                                {confirmedInterventions.length}
                                            </Tag>
                                        </Space>
                                    )
                                },
                                {
                                    value: 'delivery',
                                    label: (
                                        <Space size={6}>
                                            <RiseOutlined />
                                            <span>Delivery</span>
                                            <Tag
                                                color={
                                                    coverage.total > 0 &&
                                                        coverage.delivered === coverage.total
                                                        ? 'green'
                                                        : 'blue'
                                                }
                                                style={{ marginInlineEnd: 0 }}
                                            >
                                                {coverage.delivered}/{coverage.total}
                                            </Tag>
                                        </Space>
                                    )
                                },
                                {
                                    value: 'signatures',
                                    label: (
                                        <Space size={6}>
                                            <EditOutlined />
                                            <span>Signatures</span>
                                        </Space>
                                    )
                                }
                            ]}
                        />

                        {!isParentDeptUser && isHOD && (
                            <Button
                                color="primary"
                                variant="filled"
                                icon={<LockOutlined />}
                                style={roundBtn}
                                onClick={() => setUnlockOpen(true)}
                            >
                                Unlock Plan
                            </Button>
                        )}

                        {!isParentDeptUser && !isHOD && isCoordinator && (
                            <Button
                                color="cyan"
                                icon={<EditOutlined />}
                                variant="filled"
                                style={roundBtn}
                                onClick={() => setReqOpen(true)}
                                disabled={latestPlanData?.devPlanEdit?.changeRequested === true}
                            >
                                {latestPlanData?.devPlanEdit?.changeRequested === true
                                    ? 'Edit Request Pending'
                                    : 'Request DP Edit'}
                            </Button>
                        )}
                    </div>


                    {section === 'plan' && (
                        <>











                            {isParentDeptUser && (
                                <Card type="inner" title="Subdepartment Status" style={{ marginBottom: 16 }}>
                                    <Table
                                        dataSource={subDeptStatusRows}
                                        rowKey="deptId"
                                        size="small"
                                        pagination={false}
                                        columns={[
                                            {
                                                title: 'Department',
                                                dataIndex: 'deptName',
                                                key: 'deptName',
                                                render: (v: any) => <Text strong>{v || '—'}</Text>
                                            },
                                            {
                                                title: 'Dept Confirmation',
                                                dataIndex: 'deptConfirmed',
                                                key: 'deptConfirmed',
                                                render: (ok: boolean) =>
                                                    ok ? <Tag color="blue">Confirmed</Tag> : <Tag color="orange">Pending</Tag>
                                            },
                                            {
                                                title: 'SME Confirmation',
                                                dataIndex: 'smeConfirmed',
                                                key: 'smeConfirmed',
                                                render: (ok: boolean) =>
                                                    ok ? <Tag color="green">Confirmed</Tag> : <Tag color="gold">Pending</Tag>
                                            },
                                            {
                                                title: 'Confirmed Intv.',
                                                dataIndex: 'intvCount',
                                                key: 'intvCount',
                                                render: (n: number) => (
                                                    <Tag color={n > 0 ? 'purple' : 'default'}>{Number(n || 0)}</Tag>
                                                )
                                            },
                                            {
                                                title: 'Last Update',
                                                dataIndex: 'lastConfirmedAt',
                                                key: 'lastConfirmedAt',
                                                render: (d: Date | null) => (d ? d.toLocaleString() : '—')
                                            }
                                        ]}
                                    />
                                </Card>
                            )}
                            {confirmedInterventions.length > 0 ? (
                                <Table
                                    dataSource={confirmedInterventions}
                                    columns={columns}
                                    // Index keeps the key unique even if a duplicate slips
                                    // through — colliding keys duplicate rows on paging.
                                    rowKey={(r, index) =>
                                        `${String(r.id || '')}::${String(r.submittedDeptId || '')}::${String(r.title || '')}::${index}`
                                    }
                                    pagination={{ pageSize: 5, showSizeChanger: false, position: ['bottomCenter'] }}
                                />
                            ) : (
                                <Empty description="No confirmed interventions found for this participant" style={{ margin: '24px 0' }} />
                            )}
                        </>
                    )}

                    {section === 'delivery' && (
                        <>










                            {/*
                          * Delivery coverage. This modal is only reachable once the
                          * viewer's department has confirmed, so confirmation state is
                          * settled and the open question is what has actually been
                          * delivered against the plan.
                          */}
                            <Card
                                type="inner"
                                title="Plan coverage"
                                extra={
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                        {isFinalised ? 'Finalised' : 'Awaiting ROM finalisation'}
                                        {smeSignedAt ? ' · SME signed' : ''}
                                    </Text>
                                }
                                style={{ marginBottom: 16 }}
                            >
                                {coverage.total === 0 ? (
                                    <Empty
                                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                                        description="No interventions on this plan yet."
                                    />
                                ) : (
                                    <>
                                        <Space wrap size={24} style={{ marginBottom: 12 }}>
                                            <span>
                                                <Text strong style={{ fontSize: 20 }}>
                                                    {coverage.delivered}
                                                </Text>
                                                <Text type="secondary"> / {coverage.total} delivered</Text>
                                            </span>
                                            <span>
                                                <Text strong style={{ fontSize: 20 }}>
                                                    {coverage.inProgress}
                                                </Text>
                                                <Text type="secondary"> in progress</Text>
                                            </span>
                                            <span>
                                                <Text strong style={{ fontSize: 20 }}>
                                                    {coverage.notStarted}
                                                </Text>
                                                <Text type="secondary"> not started</Text>
                                            </span>
                                            <span>
                                                <Text strong style={{ fontSize: 20 }}>
                                                    {coverage.sessions}
                                                </Text>
                                                <Text type="secondary">
                                                    {' '}
                                                    session{coverage.sessions === 1 ? '' : 's'} logged
                                                </Text>
                                            </span>
                                        </Space>

                                        <Progress
                                            percent={coverage.percent}
                                            size="small"
                                            status={coverage.percent === 100 ? 'success' : 'active'}
                                            style={{ marginBottom: 12 }}
                                        />

                                        <Table
                                            dataSource={coverageRows}
                                            rowKey={(row, index) => `${row.key}::${index}`}
                                            size="small"
                                            pagination={false}
                                            columns={[
                                                {
                                                    title: 'Intervention',
                                                    dataIndex: 'title',
                                                    render: (value: string, row: any) => (
                                                        <div>
                                                            <Text>{value}</Text>
                                                            {row.subInterventions.length > 0 && (
                                                                <div
                                                                    style={{
                                                                        fontSize: 11,
                                                                        color: 'rgba(0,0,0,.45)'
                                                                    }}
                                                                >
                                                                    <Text type="secondary">
                                                                        {row.subInterventions.join(' · ')}
                                                                    </Text>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )
                                                },
                                                {
                                                    title: 'Status',
                                                    dataIndex: 'state',
                                                    width: 130,
                                                    render: (state: string) =>
                                                        state === 'delivered' ? (
                                                            <Tag color="green">Delivered</Tag>
                                                        ) : state === 'in-progress' ? (
                                                            <Tag color="blue">In progress</Tag>
                                                        ) : (
                                                            <Tag>Not started</Tag>
                                                        )
                                                },
                                                {
                                                    title: 'Deliveries',
                                                    dataIndex: 'assignments',
                                                    width: 110,
                                                    align: 'center' as const,
                                                    render: (_: number, row: any) =>
                                                        row.assignments === 0 ? (
                                                            <Text type="secondary">—</Text>
                                                        ) : (
                                                            <Text>
                                                                {row.completed}
                                                                {row.active > 0 ? ` (+${row.active} open)` : ''}
                                                            </Text>
                                                        )
                                                },
                                                {
                                                    title: 'Sessions',
                                                    dataIndex: 'sessions',
                                                    width: 90,
                                                    align: 'center' as const,
                                                    render: (value: number) => (
                                                        <Text type={value ? undefined : 'secondary'}>
                                                            {value || '—'}
                                                        </Text>
                                                    )
                                                },
                                                {
                                                    title: 'Last activity',
                                                    dataIndex: 'lastActivity',
                                                    width: 130,
                                                    align: 'right' as const,
                                                    render: (value: Date | null) => (
                                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                                            {value ? value.toLocaleDateString() : '—'}
                                                        </Text>
                                                    )
                                                }
                                            ]}
                                        />
                                    </>
                                )}

                                {isROM && (
                                    <div style={{ marginTop: 12 }}>
                                        <Button
                                            type="primary"
                                            style={roundBtn}
                                            disabled={!canShowFinalise}
                                            onClick={handleFinalisePlan}
                                        >
                                            Finalise Developmental Plan
                                        </Button>
                                        {!canShowFinalise && !isFinalised && (
                                            <Text type="secondary" style={{ marginLeft: 10 }}>
                                                Available once all departments have confirmed.
                                            </Text>
                                        )}
                                    </div>
                                )}
                            </Card>
                        </>
                    )}

                    {section === 'signatures' && (
                        <>




                            <div style={{ marginTop: 14 }}>
                                {sigLoading ? (
                                    <Alert type="info" showIcon message="Loading signatures..." />
                                ) : signRows.length === 0 ? (
                                    <Alert
                                        type="warning"
                                        showIcon
                                        message="No signatures found"
                                        description="Signatures are missing or have not been captured in the confirmation records."
                                    />
                                ) : (
                                    <div style={{ display: 'grid', gap: 12 }}>
                                        {signRows.map(r => {
                                            const signatures = (
                                                <div
                                                    style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: '1fr 1fr',
                                                        gap: 16
                                                    }}
                                                >
                                                    <div>
                                                        <Text strong>{r.hod.label}</Text>
                                                        <div style={{ marginTop: 10 }}>
                                                            {r.hod.signatureUrl ? (
                                                                <img
                                                                    src={r.hod.signatureUrl}
                                                                    alt="HOD signature"
                                                                    style={{ width: '100%', maxWidth: 380, height: 120, objectFit: 'contain', border: '1px solid #f0f0f0', borderRadius: 8, padding: 8, background: '#fff' }}
                                                                />
                                                            ) : (
                                                                <Tag color="orange">No HOD signature</Tag>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <Text strong>{r.sme.label}</Text>
                                                        <div style={{ marginTop: 10 }}>
                                                            {r.sme.signatureUrl ? (
                                                                <img
                                                                    src={r.sme.signatureUrl}
                                                                    alt="SME signature"
                                                                    style={{ width: '100%', maxWidth: 380, height: 120, objectFit: 'contain', border: '1px solid #f0f0f0', borderRadius: 8, padding: 8, background: '#fff' }}
                                                                />
                                                            ) : (
                                                                <Tag color="gold">No SME signature</Tag>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            )

                                            // Your own department needs no label — the card
                                            // title would only repeat who you are.
                                            return r.deptId === myDeptId ? (
                                                <div key={r.deptId}>{signatures}</div>
                                            ) : (
                                                <Card key={r.deptId} type="inner" title={r.deptName || '—'}>
                                                    {signatures}
                                                </Card>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        </>
                    )}



                </Card>

                <Modal
                    centered
                    title="Add Intervention"
                    open={addOpen}
                    onCancel={() => setAddOpen(false)}
                    onOk={async () => {
                        if (!latestPlanRef || !latestPlanData) return
                        if (!myDeptId) return message.error('Could not resolve your department ID')
                        if (!selectedInterventionId) return message.error('Select an intervention')

                        const picked = interventionsCatalog.find(x => String(x.id) === String(selectedInterventionId))
                        if (!picked) return message.error('Intervention not found')

                        setSavingAdd(true)
                        try {
                            const newItem = {
                                id: picked.id,
                                title: picked.interventionTitle || picked.title || 'Untitled',
                                area: picked.areaOfSupport || picked.area || myParentDeptName || department,
                                source: 'ParentAdded',
                                departmentId: myDeptId,
                                addedAt: new Date(),
                                addedBy: user?.uid || user?.email || ''
                            }

                            const next = [...(latestPlanData.interventions || []), newItem]
                            await updateDoc(latestPlanRef, { interventions: next })

                            setLatestPlanData((p: any) => ({ ...p, interventions: next }))
                            message.success('Intervention added')
                            setAddOpen(false)
                            setSelectedInterventionId('')
                        } catch (e) {
                            console.error(e)
                            message.error('Failed to add intervention')
                        } finally {
                            setSavingAdd(false)
                        }
                    }}
                    confirmLoading={savingAdd}
                    okText="Add"
                    destroyOnClose
                >
                    <div style={{ marginBottom: 8 }}>Select from the intervention library:</div>

                    <Select
                        showSearch
                        value={selectedInterventionId || undefined}
                        onChange={v => setSelectedInterventionId(String(v))}
                        placeholder="Select an intervention"
                        style={{ width: '100%' }}
                        options={parentAddOptions}
                        optionFilterProp="label"
                        filterOption={(input, option) =>
                            String(option?.label || '').toLowerCase().includes(String(input || '').toLowerCase())
                        }
                    />
                </Modal>

                {!isParentDeptUser && (
                    <>
                        <Modal
                            title="Unlock Development Plan"
                            open={unlockOpen}
                            onCancel={() => { setUnlockOpen(false); setUnlockReason('') }}
                            onOk={handleUnlockPlan}
                            confirmLoading={unlockSaving}
                            okText="Unlock"
                            destroyOnClose
                        >
                            <Alert
                                type="info"
                                showIcon
                                message="This unlocks editing for your department."
                                style={{ marginBottom: 12 }}
                            />
                            <Typography.Text>Optional reason (audit):</Typography.Text>
                            <Input.TextArea
                                rows={4}
                                value={unlockReason}
                                onChange={e => setUnlockReason(e.target.value)}
                                maxLength={800}
                                showCount
                            />
                        </Modal>

                        <Modal
                            title="Request Developmental Plan Edit"
                            open={reqOpen}
                            onCancel={() => { setReqOpen(false); setReqReason('') }}
                            onOk={handleRequestUnlock}
                            confirmLoading={reqSaving}
                            okText="Send Request"
                            destroyOnClose
                        >
                            <Alert
                                type="warning"
                                showIcon
                                message="This sends an unlock request to the HOD."
                                style={{ marginBottom: 12 }}
                            />
                            <Typography.Text strong>Reason *</Typography.Text>
                            <Input.TextArea
                                rows={4}
                                value={reqReason}
                                onChange={e => setReqReason(e.target.value)}
                                maxLength={800}
                                showCount
                                placeholder="Why do you need the plan unlocked?"
                            />
                        </Modal>
                    </>
                )}
            </div>
        </Modal>
    )
}

export default ConfirmedInterventionsModal
