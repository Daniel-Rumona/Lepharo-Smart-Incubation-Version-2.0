import { useCallback, useEffect, useRef, useState } from 'react'
import { message } from 'antd'
import { collection, getDocs, query, where, doc, getDoc, orderBy, documentId } from 'firebase/firestore'
import { db } from '@/firebase'
import { isQuantilytixDomain } from '@/utils/quantilytixAccess'
import { hasSmeGapSubmission } from '@/utils/agreementStatus'
import { Application, MonthlyPerfRow, OwnershipSummary, Participant, ProgramDoc, SmeRow, buildUploadedByMonth, chunkArray, extractNearestHubFromProfile, getOnboardedAt, mergePrefUploaded, normalize, normalizeHeadcountMap, normalizeRevenueMap, resolveSmePhoto } from './participantsData'

type UseSmeRowsArgs = {
    user: any
    activeProgramId?: string | null
    isAllPrograms: boolean
    isQuantilytixViewer: boolean
    /** Called when the hub filter is hidden for this programme, so the page can clear it. */
    onHubFilterHidden: () => void
}

/**
 * Loads the accepted SMEs for the active programme (with their reported revenue/headcount),
 * the active-intervention count per SME, and the viewer's onboarding and hub-filter permissions.
 */
export const useSmeRows = ({ user, activeProgramId, isAllPrograms, isQuantilytixViewer, onHubFilterHidden }: UseSmeRowsArgs) => {
    const [loading, setLoading] = useState(false)
    const [rows, setRows] = useState<SmeRow[]>([])
    const [activeInterventionsBySme, setActiveInterventionsBySme] = useState<Map<string, number>>(new Map())
    const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
    const [showHubFilter, setShowHubFilter] = useState(false)
    const [hasOnboardingAccess, setHasOnboardingAccess] = useState(false)

    const onHubFilterHiddenRef = useRef(onHubFilterHidden)
    onHubFilterHiddenRef.current = onHubFilterHidden

    useEffect(() => {
        let cancelled = false

        const resolveOnboardingPermission = async () => {
            const departmentId = String(user?.departmentId || '').trim()

            try {
                let departmentData: any = null

                if (departmentId) {
                    const departmentSnap = await getDoc(doc(db, 'departments', departmentId))
                    if (departmentSnap.exists()) departmentData = departmentSnap.data()
                }

                if (!cancelled) setHasOnboardingAccess(departmentData?.isOnboarding === true)
            } catch (error) {
                console.error('Unable to resolve onboarding department permission.', error)
                if (!cancelled) setHasOnboardingAccess(false)
            }
        }

        resolveOnboardingPermission()
        return () => { cancelled = true }
    }, [user?.departmentId])

    useEffect(() => {
        const run = async () => {
            const uBranch = String((user as any)?.assignedBranch || '').trim()

            if (!activeProgramId) {
                setShowHubFilter(false)
                return
            }

            try {
                const snap = await getDoc(doc(db, 'programs', activeProgramId))
                if (!snap.exists()) {
                    setShowHubFilter(false)
                    return
                }

                const prog = snap.data() as any
                const isMulti = !!prog.isMultiBranch
                const programAssignedBranchId = String(prog?.assignedBranch?.id || '').trim()
                const programAssignedToMyBranch =
                    !!uBranch && !!programAssignedBranchId && uBranch === programAssignedBranchId

                const shouldShow = isMulti && programAssignedToMyBranch

                setShowHubFilter(shouldShow)

                if (!shouldShow) {
                    onHubFilterHiddenRef.current()
                }
            } catch (err) {
                console.error(err)
                setShowHubFilter(false)
            }
        }

        run()
    }, [activeProgramId, user?.uid])

    const loadSMEs = useCallback(async () => {
        if (!activeProgramId && !isAllPrograms) return
        setLoading(true)

        try {
            const [appsResult, assignedResult] = await Promise.allSettled([
                getDocs(collection(db, 'applications')),
                getDocs(query(
                    collection(db, 'assignedInterventions'),
                    ...(activeProgramId ? [where('programId', '==', activeProgramId)] : [])
                ))
            ])

            if (appsResult.status === 'rejected') throw appsResult.reason
            const appsSnap = appsResult.value

            const activeBySme = new Map<string, number>()
            if (assignedResult.status === 'fulfilled') {
                assignedResult.value.forEach(snapshot => {
                    const intervention = snapshot.data() as any
                    const status = String(intervention.assignmentStatus || '').toLowerCase().trim()
                    if (['completed', 'cancelled', 'canceled'].includes(status)) return
                    const key = String(intervention.participantId || intervention.applicationId || '').trim()
                    if (key) activeBySme.set(key, (activeBySme.get(key) || 0) + 1)
                })
            } else {
                console.warn('Unable to load active SME interventions.', assignedResult.reason)
            }
            setActiveInterventionsBySme(activeBySme)

            const applications = appsSnap.docs
                .map(d => {
                    const data = d.data() as any
                    const normalizedProgramId = String(
                        data.programId || data.programID || data.program?.id || data.program || ''
                    ).trim()

                    return {
                        id: d.id,
                        ...data,
                        programId: normalizedProgramId || undefined
                    } as Application
                })
                .filter(app => {
                    const statuses = [
                        app.applicationStatus,
                        (app as any).status,
                        (app as any).decision?.status
                    ].map(normalize)

                    return statuses.includes('accepted') || !!app.acceptedAt
                })
                .filter(app => !activeProgramId || app.programId === activeProgramId)
                .filter(app => (isQuantilytixDomain(app.email) ? isQuantilytixViewer : true))

            const programIds = Array.from(
                new Set(
                    applications
                        .map(app => String(app.programId || '').trim())
                        .filter(Boolean)
                )
            )

            const programMap = new Map<string, ProgramDoc>()
            const branchMap = new Map<string, string>()

            for (const idsChunk of chunkArray(programIds, 10)) {
                const programSnap = await getDocs(
                    query(collection(db, 'programs'), where(documentId(), 'in', idsChunk))
                )

                programSnap.forEach(d => {
                    programMap.set(d.id, {
                        id: d.id,
                        ...(d.data() as any)
                    })
                })
            }

            const branchesSnap = await getDocs(
                query(collection(db, 'branches'))
            )

            branchesSnap.forEach(d => {
                const data = d.data() as any
                const name = String(data.name || data.branchName || data.title || '').trim()
                if (name) branchMap.set(d.id, name)
            })

            const smeRows: SmeRow[] = await Promise.all(
                applications.map(async app => {
                    const participantId = app.participantId || null
                    let participant: Participant | null = null
                    let perfHistory: MonthlyPerfRow[] = []

                    if (participantId) {
                        const pDoc = await getDoc(doc(db, 'participants', participantId))
                        if (pDoc.exists()) {
                            participant = { id: pDoc.id, ...(pDoc.data() as any) }
                        }

                        const histSnap = await getDocs(
                            query(collection(db, `monthlyPerformance/${participantId}/history`), orderBy('createdAt', 'desc'))
                        )
                        perfHistory = histSnap.docs.map(h => h.data() as any)
                    }

                    const uploaded = buildUploadedByMonth(perfHistory)
                    const pRevArr = normalizeRevenueMap(participant?.revenueHistory?.monthly)
                    const pHC = normalizeHeadcountMap(participant?.headcountHistory?.monthly)

                    const mergedRev = mergePrefUploaded(uploaded.revenue, pRevArr)
                    const mergedPerm = mergePrefUploaded(uploaded.perm, pHC.perm)
                    const mergedTemp = mergePrefUploaded(uploaded.temp, pHC.temp)

                    const totalRevenue = mergedRev.reduce((acc, v) => acc + (v || 0), 0)

                    let currentEmployees = 0
                    for (let i = mergedPerm.length - 1; i >= 0; i--) {
                        if (mergedPerm[i] != null || mergedTemp[i] != null) {
                            currentEmployees = (mergedPerm[i] || 0) + (mergedTemp[i] || 0)
                            break
                        }
                    }

                    const ownership: OwnershipSummary = {
                        blackOwnedPercent: participant?.blackOwnedPercent ?? (app as any).blackOwnedPercent ?? undefined,
                        femaleOwnedPercent: participant?.femaleOwnedPercent ?? (app as any).femaleOwnedPercent ?? undefined,
                        youthOwnedPercent: participant?.youthOwnedPercent ?? (app as any).youthOwnedPercent ?? undefined
                    }

                    const companyName =
                        app.companyName ||
                        (app as any).registeredName ||
                        app.businessName ||
                        app.beneficiaryName ||
                        'Unknown SME'

                    const businessAddress =
                        participant?.businessAddress ||
                        app.businessAddress ||
                        (app as any).tradingAddress ||
                        (app as any).physicalAddress ||
                        (app as any).addressLine1

                    const beeLevel =
                        participant?.beeLevel ||
                        app.beeLevel ||
                        (app as any).beeLevel ||
                        (app as any).bbbEeLevel

                    const photoUrl = await resolveSmePhoto(participant, app)

                    const derivedHub = String(app.hub || '').trim() || extractNearestHubFromProfile(app) || ''
                    const program = app.programId ? programMap.get(app.programId) : undefined
                    const programIsMultiBranch = !!program?.isMultiBranch
                    const resolvedBranchName = programIsMultiBranch
                        ? derivedHub || '—'
                        : String(program?.assignedBranch?.name || '').trim() || '—'
                    const resolvedBranchId = programIsMultiBranch
                        ? String(app.branchId || participant?.branchId || '').trim()
                        : String(program?.assignedBranch?.id || program?.branchId || app.branchId || participant?.branchId || '').trim()
                    const branchNameFromBranch = resolvedBranchId ? branchMap.get(resolvedBranchId) : ''
                    const displayBranchName =
                        branchNameFromBranch ||
                        String(app.branchName || participant?.branchName || '').trim() ||
                        resolvedBranchName

                    return {
                        appId: app.id,
                        participantId,
                        programId: app.programId,
                        smmeNo: String(app.smmeNo || '').trim() || undefined,
                        registrationNumber: String(participant?.registrationNumber || '').trim() || undefined,
                        idNumber: String(participant?.idNumber || participant?.nationalId || app.idNumber || '').trim() || undefined,
                        companyName,
                        photoUrl,
                        sector: participant?.sector || (app as any).sector,
                        gender: participant?.gender || (app as any).gender,
                        town: participant?.town || (app as any).town || (app as any).city,
                        province: participant?.province || (app as any).province || (app as any).region,
                        location:
                            participant?.location ||
                            app.location ||
                            (app as any).location ||
                            (app as any).addressLine1,
                        email: app.email || participant?.email,
                        phone: participant?.phone || (app as any).phone || '—',
                        businessAddress,
                        beeLevel,
                        branchId: resolvedBranchId || undefined,
                        branchName: displayBranchName,
                        hub: derivedHub || undefined,
                        group: String(app.gapGroup || '').trim() || undefined,
                        recruitedAt: app.acceptedAt || app.updatedAt || null,
                        onboardedAt: getOnboardedAt(app),
                        manuallyCreated: (app as any).manuallyCreated === true,
                        gapCompleted: hasSmeGapSubmission({
                            application: app,
                            participant,
                            agreement: (app as any).signedAgreements?.['gap-analysis']
                        }),
                        ownership,
                        metrics: {
                            totalRevenue,
                            currentEmployees
                        }
                    }
                })
            )

            setRows(smeRows)
            if (smeRows.length) {
                setSelectedAppId(current => current && smeRows.some(row => row.appId === current)
                    ? current
                    : smeRows[0].appId)
            } else {
                setSelectedAppId(null)
            }
        } catch (err) {
            console.error(err)
            message.error('Failed to load SME overview.')
        } finally {
            setLoading(false)
        }
    }, [activeProgramId, isAllPrograms, isQuantilytixViewer])

    useEffect(() => {
        loadSMEs()
    }, [loadSMEs])

    return {
        loading,
        rows,
        setRows,
        activeInterventionsBySme,
        selectedAppId,
        setSelectedAppId,
        showHubFilter,
        hasOnboardingAccess,
        reload: loadSMEs
    }
}
