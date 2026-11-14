import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { message } from 'antd'
import { collection, doc, getDoc, onSnapshot, query, where, type QueryConstraint } from 'firebase/firestore'
import { db } from '@/firebase'
import {
    buildGroupRequirements,
    evaluateGroupEligibility,
    notifyRomSmeReady,
    resolveApplicationGroup,
    type GroupEligibility,
    type GroupProgressionRules,
    type GroupRequirement
} from '@/services/groupLifecycleService'
import { resolveComplianceRequirements, type RequirementsSource } from '@/services/complianceResolver'
import { resolveSmePhoto } from '@/routes/shared/incubatees/participantsData'
import {
    getEmail,
    getName,
    loadEvidence,
    loadInterventions,
    resolveParticipant,
    toDate,
    type SmeGroupRow
} from './groupData'

/** One programme's group requirements and progression rules. */
type ProgramConfig = {
    name?: string
    requirements: GroupRequirement[]
    rules: GroupProgressionRules
    /** Whether the requirements are the programme's own or the shared default. */
    source: RequirementsSource
}

const EMPTY_CONFIG: ProgramConfig = { requirements: [], rules: {}, source: 'none' }

type Scope = {
    /** The selected programme; undefined under All Programs. */
    activeProgramId?: string
    isAllPrograms: boolean
}

/**
 * Live rows for the accepted SMEs of the active programme (or of every
 * programme under All Programs), each judged against its own programme's
 * group requirements and progression rules. ROM is told (once per readiness,
 * see notifyRomSmeReady) when an SME becomes eligible.
 */
export const useGroupRows = ({ activeProgramId, isAllPrograms }: Scope) => {
    const [rows, setRows] = useState<SmeGroupRow[]>([])
    const [rowsLoading, setRowsLoading] = useState(false)
    const [configs, setConfigs] = useState<Record<string, ProgramConfig>>({})
    const requested = useRef(new Set<string>())
    const enabled = isAllPrograms || !!activeProgramId

    // Requirements come from the shared resolver (the programme's master list,
    // including older programmes that only have the requiredDocs mirror), the
    // same source the incubatee's group page uses. Loaded once per programme.
    const loadConfigs = useCallback((programIds: string[]) => {
        programIds
            .filter(id => id && !requested.current.has(id))
            .forEach(id => {
                requested.current.add(id)
                Promise.all([getDoc(doc(db, 'programs', id)), resolveComplianceRequirements(id)])
                    .then(([snapshot, resolved]): ProgramConfig => {
                        if (!snapshot.exists()) return EMPTY_CONFIG
                        const program = snapshot.data() as any
                        return {
                            name: program.name || program.programName || program.title,
                            requirements: buildGroupRequirements(resolved.requirements),
                            rules: program.groupProgressionRules || {},
                            source: resolved.source
                        }
                    })
                    .catch(error => {
                        console.error('Unable to load group progression rules', error)
                        return EMPTY_CONFIG
                    })
                    .then(config => setConfigs(prev => ({ ...prev, [id]: config })))
            })
    }, [])

    useEffect(() => {
        setRows([])
        if (!enabled) {
            setRowsLoading(false)
            return
        }
        setRowsLoading(true)
        if (activeProgramId) loadConfigs([activeProgramId])

        let disposed = false
        const constraints: QueryConstraint[] = [where('applicationStatus', 'in', ['accepted', 'Accepted'])]
        if (activeProgramId) constraints.unshift(where('programId', '==', activeProgramId))

        const unsubscribe = onSnapshot(query(collection(db, 'applications'), ...constraints), async snapshot => {
            try {
                const loaded = await Promise.all(snapshot.docs.map(async applicationSnapshot => {
                    const application = { id: applicationSnapshot.id, ...(applicationSnapshot.data() as any) }
                    const programId = String(application.programId || '').trim()
                    const participant = await resolveParticipant(application)
                    const participantData = participant?.data || {}
                    const [evidence, interventions, photoUrl] = await Promise.all([
                        loadEvidence(application, participantData),
                        loadInterventions(participant?.id, application.id, programId),
                        resolveSmePhoto(participantData, application)
                    ])
                    return {
                        key: application.id,
                        applicationId: application.id,
                        participantId: participant?.id,
                        name: getName(application, participantData),
                        email: getEmail(application, participantData),
                        photoUrl,
                        stage: participantData.stage || participantData.phase || application.stage || application.phase,
                        programId,
                        programName: application.programName || application.program || application.incubationProgram,
                        group: resolveApplicationGroup(application, participantData),
                        history: (Array.isArray(application.groupHistory) ? application.groupHistory : participantData.groupHistory) || [],
                        evidence,
                        interventions,
                        graduationApproved: application.graduationApproved === true,
                        lastReminderAt: toDate(application.groupReminder?.lastSentAt),
                        pendingMovement: application.pendingGroupMovement || null
                    } as SmeGroupRow
                }))
                if (disposed) return
                loadConfigs(Array.from(new Set(loaded.map(row => row.programId))))
                setRows(loaded)
            } catch (error) {
                console.error(error)
                message.error('Failed to load group progression data.')
                if (!disposed) setRows([])
            } finally {
                if (!disposed) setRowsLoading(false)
            }
        }, error => {
            console.error(error)
            message.error('Failed to load accepted SMEs.')
            setRowsLoading(false)
        })
        return () => {
            disposed = true
            unsubscribe()
        }
    }, [activeProgramId, enabled, loadConfigs])

    /** Programmes in view: the selected one, or every programme with a row. */
    const programIds = useMemo(
        () => activeProgramId ? [activeProgramId] : Array.from(new Set(rows.map(row => row.programId).filter(Boolean))),
        [activeProgramId, rows]
    )
    // Rows aren't judged until their programme's requirements are in, so an
    // SME is never shown (or announced to ROM) as ready against an empty list.
    const configsReady = programIds.every(id => !!configs[id])
    const loading = rowsLoading || !configsReady

    const configFor = useCallback(
        (row: SmeGroupRow) => configs[row.programId] || EMPTY_CONFIG,
        [configs]
    )

    const eligibilityFor = useCallback((row: SmeGroupRow): GroupEligibility => {
        const { requirements, rules } = configFor(row)
        return evaluateGroupEligibility({
            current: row.group,
            requirements,
            evidence: row.evidence,
            interventions: row.interventions,
            rules,
            graduationApproved: row.graduationApproved
        })
    }, [configFor])

    /** Names of the in-view programmes with no requirements / using the shared default. */
    const { withoutRequirements, usingDefault } = useMemo(() => {
        const nameOf = (id: string) =>
            configs[id]?.name || rows.find(row => row.programId === id)?.programName || 'Unnamed programme'
        const loadedIds = programIds.filter(id => configs[id])
        return {
            withoutRequirements: loadedIds.filter(id => !configs[id].requirements.length).map(nameOf),
            usingDefault: loadedIds.filter(id => configs[id].source === 'default').map(nameOf)
        }
    }, [configs, programIds, rows])

    useEffect(() => {
        if (loading) return
        rows.forEach(row => {
            const eligibility = eligibilityFor(row)
            if (!eligibility.eligible || !eligibility.target || row.pendingMovement) return
            void notifyRomSmeReady({
                applicationId: row.applicationId,
                smeName: row.name,
                programName: row.programName,
                current: row.group,
                target: eligibility.target,
                requirementsMet: eligibility.met
            })
        })
    }, [eligibilityFor, loading, rows])

    return { rows, loading, configFor, eligibilityFor, withoutRequirements, usingDefault }
}
