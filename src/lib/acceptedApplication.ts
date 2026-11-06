import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { resolveSmeParticipantId, type SmeRef } from '@/services/smeIdentity'

/**
 * Whether an SME has been accepted into a programme. An applicant is an
 * "incubatee" user whose applications are not accepted yet, so this is what
 * separates the applicant portal from the incubatee workspace: login routes
 * on it, and the workspace layout gates on it.
 */

const norm = (v?: string) => (v ?? '').toLowerCase().trim()
const normEmail = (v?: string) => (v ?? '').trim().toLowerCase()

export const getEffectiveAppStatus = (app: any) => {
    // primary
    const s1 = norm(app?.applicationStatus)

    // fallback: decision.status (common patterns)
    const s2 = norm(app?.decision?.status)

    return s1 || s2
}

export async function getAppsByEmailAnyField(email?: string) {
    const e = normEmail(email)
    if (!e) return []

    // 1) Try exact matches on both fields (fast path)
    const [byEmail, byApplicantEmail] = await Promise.all([
        getDocs(query(collection(db, 'applications'), where('email', '==', e))),
        getDocs(query(collection(db, 'applications'), where('applicantEmail', '==', e)))
    ])

    const mapDocs = (snap: any) => snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as any))
    let apps = [...mapDocs(byEmail), ...mapDocs(byApplicantEmail)]

    // 2) If still none, fallback: scan and match normalized (handles hidden spaces/casing in stored data)
    // Only staff may scan applications; a new applicant's scan is denied and
    // simply finds nothing.
    if (apps.length === 0) {
        const allSnap = await getDocs(collection(db, 'applications')).catch(() => null)
        const all = (allSnap?.docs || []).map(d => ({ id: d.id, ...d.data() } as any))
        apps = all.filter(a => {
            const aEmail = normEmail(a.email)
            const aApplicantEmail = normEmail(a.applicantEmail)
            return aEmail === e || aApplicantEmail === e
        })
    }

    // de-dupe by id
    const seen = new Set<string>()
    return apps.filter(a => (seen.has(a.id) ? false : (seen.add(a.id), true)))
}

export async function getAcceptedAppByEmail(email?: string) {
    const apps = await getAppsByEmailAnyField(email)
    return apps.find(a => getEffectiveAppStatus(a) === 'accepted') || null
}

/**
 * An SME's applications, found by its participant id
 * (docs/sme-identity-migration-plan.md). Until Phase 4 the email lookup is
 * added too, for applications saved before the participant existed and for
 * logins not linked yet.
 */
export async function getSmeApplications(sme?: SmeRef | null) {
    const participantId = await resolveSmeParticipantId(sme)
    const [byParticipant, byEmail] = await Promise.all([
        participantId
            ? getDocs(query(collection(db, 'applications'), where('participantId', '==', participantId)))
                .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() } as any)))
                .catch(() => [] as any[])
            : Promise.resolve([] as any[]),
        sme?.email ? getAppsByEmailAnyField(sme.email).catch(() => [] as any[]) : Promise.resolve([] as any[])
    ])
    const seen = new Set<string>()
    return [...byParticipant, ...byEmail].filter(a => (seen.has(a.id) ? false : (seen.add(a.id), true)))
}

export async function getSmeAcceptedApplication(sme?: SmeRef | null) {
    const apps = await getSmeApplications(sme)
    return apps.find(a => getEffectiveAppStatus(a) === 'accepted') || null
}
