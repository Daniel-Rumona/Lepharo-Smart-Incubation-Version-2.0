import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'

/**
 * Demo finance accounts written by scripts/digital-twin/seed-finance.cjs for
 * the digital-twin SMEs, which the external Qx finance system knows nothing
 * about. Only the test project has any; elsewhere this returns [].
 *
 * Every account is synthetic (`dataOrigin: 'synthetic'`), so callers label it
 * as demo data and do not offer Qx actions (downloads, Open in Qx) for it.
 */

export type SyntheticFinanceMonth = {
    month: string
    monthLabel: string
    revenue: number
    expenses: number
    profit: number
}

export type SyntheticFinanceDocument = {
    id: string
    original_name: string
    type?: string
    created_at?: string
    demo: true
}

export type SyntheticFinanceAccount = {
    id: string
    participantId: string
    programId: string
    name: string
    email: string
    months: SyntheticFinanceMonth[]
    totalRevenue: number
    totalExpenses: number
    documents: SyntheticFinanceDocument[]
}

export const SYNTHETIC_FINANCE_COLLECTION = 'syntheticFinanceAccounts'

export async function loadSyntheticFinanceAccounts(programId?: string | null): Promise<SyntheticFinanceAccount[]> {
    try {
        const ref = collection(db, SYNTHETIC_FINANCE_COLLECTION)
        const snap = await getDocs(programId ? query(ref, where('programId', '==', programId)) : ref)
        return snap.docs
            .map(d => ({ id: d.id, ...(d.data() as any) }))
            .filter(account => account.dataOrigin === 'synthetic')
            .map(account => ({
                id: String(account.id),
                participantId: String(account.participantId || ''),
                programId: String(account.programId || ''),
                name: String(account.name || 'Demo SME'),
                email: String(account.email || ''),
                months: Array.isArray(account.months)
                    ? account.months.map((m: any) => ({
                        month: String(m.month || ''),
                        monthLabel: String(m.monthLabel || m.month || ''),
                        revenue: Number(m.revenue || 0),
                        expenses: Number(m.expenses || 0),
                        profit: Number(m.profit || 0)
                    }))
                    : [],
                totalRevenue: Number(account.totalRevenue || 0),
                totalExpenses: Number(account.totalExpenses || 0),
                documents: Array.isArray(account.documents) ? account.documents : []
            }))
    } catch (error) {
        // No access or no collection: there is simply no demo data here.
        console.warn('[syntheticFinance] demo finance accounts unavailable', error)
        return []
    }
}
