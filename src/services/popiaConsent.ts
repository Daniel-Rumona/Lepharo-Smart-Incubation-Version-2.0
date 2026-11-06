import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { resolveSmeParticipantId } from '@/services/smeIdentity'

// Every user signs the POPIA notice. It is recorded on users/{uid}.popiaConsent;
// an SME's signing is also kept on their application (signedAgreements['popia-act']),
// where SMEs who signed before the profile record existed have it only.

export const POPIA_SLUG = 'popia-act'

/** Signed on the profile record. */
export const popiaSignedOnProfile = (profile: any) => Boolean(profile?.popiaConsent?.acceptedAt)

/** Signed on an application, including the older contract lists. */
export const popiaSignedOnApplication = (application: any) => {
    if (!application) return false
    if (application.signedAgreements?.[POPIA_SLUG]) return true
    const legacy = Array.isArray(application.signContracts)
        ? application.signContracts
        : Array.isArray(application.signedContracts)
            ? application.signedContracts
            : []
    return legacy.includes(POPIA_SLUG)
}

/**
 * Whether this person has signed POPIA, wherever it was recorded. Only an SME
 * has an application to look at; a failed lookup counts as not signed, which
 * at worst shows the POPIA step again.
 */
export async function hasSignedPopia(profile: any, role: string, email?: string | null): Promise<boolean> {
    if (popiaSignedOnProfile(profile)) return true
    if (role !== 'incubatee') return false
    try {
        // The profile's linked participant; the email only for SMEs not linked yet.
        const participantId = await resolveSmeParticipantId({ participantId: profile?.participantId, email })
        if (!participantId) return false
        const applications = await getDocs(
            query(collection(db, 'applications'), where('participantId', '==', participantId))
        )
        return applications.docs.some(snapshot => popiaSignedOnApplication(snapshot.data()))
    } catch (error) {
        console.warn('Could not check POPIA on the application.', error)
        return false
    }
}
