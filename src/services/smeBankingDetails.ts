import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useDepartmentRoles } from '@/services/departmentRoles'

/**
 * An SME's banking details live in their own collection, keyed by participant
 * id, so Firestore rules can keep them away from staff outside finance (see
 * smeBankingDetails in firestore.rules). Never store online-banking logins:
 * the details are checked against the Bank Confirmation Letter instead.
 */

export type SmeBankingDetails = {
    bankName?: string
    accountHolder?: string
    accountType?: string
    branchCode?: string
    accountNumber?: string
    verified?: boolean
    verifiedAt?: any
    verifiedByUid?: string
    verifiedByName?: string
}

export const SA_BANKS = [
    'Absa', 'African Bank', 'Bank Zero', 'Capitec', 'Capitec Business', 'Discovery Bank', 'FNB',
    'Investec', 'Nedbank', 'Old Mutual', 'Standard Bank', 'TymeBank'
]

export const ACCOUNT_TYPES = ['Current (cheque)', 'Savings', 'Transmission']

const ADMIN_ROLES = ['system_admin', 'system admin', 'superadmin', 'admin']

/** Admins, plus staff in the finance, financial compliance or ROM departments. Mirrors the rules. */
export const useCanSeeBanking = () => {
    const { user } = useFullIdentity()
    const { hasRole, loading } = useDepartmentRoles()
    const role = String((user as any)?.role || '').trim().toLowerCase()
    if (ADMIN_ROLES.includes(role)) return true
    if (loading) return false
    const departmentId = String((user as any)?.departmentId || '').trim()
    return !!departmentId && (
        hasRole(departmentId, 'inhouseFinance') ||
        hasRole(departmentId, 'financialCompliance') ||
        hasRole(departmentId, 'rom')
    )
}

const bankingDoc = (participantId: string) => doc(db, 'smeBankingDetails', participantId)

export const loadSmeBankingDetails = async (participantId: string): Promise<SmeBankingDetails> => {
    const snap = await getDoc(bankingDoc(participantId))
    return snap.exists() ? (snap.data() as SmeBankingDetails) : {}
}

const BANKING_FIELDS = ['bankName', 'accountHolder', 'accountType', 'branchCode', 'accountNumber'] as const

const clean = (value: unknown) => String(value ?? '').trim()

/**
 * Saves the details. Ticking "verified" stamps who checked them and when; a
 * change to any detail clears an earlier verification unless it is re-ticked.
 */
export const saveSmeBankingDetails = async ({
    participantId,
    values,
    previous,
    verifier
}: {
    participantId: string
    values: SmeBankingDetails
    previous: SmeBankingDetails
    verifier: { uid: string; name: string }
}) => {
    const details: Record<string, string> = {}
    BANKING_FIELDS.forEach(field => { details[field] = clean(values[field]) })
    details.accountNumber = details.accountNumber.replace(/\s/g, '')

    const changed = BANKING_FIELDS.some(field => clean(previous[field]) !== details[field])
    const stillVerified = !!values.verified && !!previous.verified && !changed
    const verification = stillVerified
        ? {}
        : values.verified
            ? { verified: true, verifiedAt: serverTimestamp(), verifiedByUid: verifier.uid, verifiedByName: verifier.name }
            : { verified: false, verifiedAt: null, verifiedByUid: null, verifiedByName: null }

    await setDoc(
        bankingDoc(participantId),
        { ...details, ...verification, participantId, updatedAt: serverTimestamp(), updatedByUid: verifier.uid },
        { merge: true }
    )
}
