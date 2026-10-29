import {
    collection,
    doc,
    getDoc,
    getDocs
} from 'firebase/firestore'
import { db } from '@/firebase'

export type ComplianceRequirementKind = 'upload' | 'agreement'

export type ComplianceRequirement = {
    id: string
    key: string
    title: string
    kind: ComplianceRequirementKind
    type: ComplianceRequirementKind
    agreementId?: string
    presetId?: string
    hasExpiry: boolean
    expiryMonths: number | null
    requiredAtApplication: boolean
    departmentId?: string

    /**
     * When true, the requirement is only visible to departments whose
     * department document has `isOnboarding === true` or
     * `isMonitoring === true`.
     *
     * Agreements are always treated as onboarding-only even when older data
     * does not contain this field.
     */
    isOnboarding?: boolean
}

export type AgreementTemplate = {
    id: string
    agreementId: string
    title: string
    active: boolean
    renderer?: 'pre-incubation' | 'moa' | 'gap-analysis' | 'mov' | 'generic'
    signingRoute?: string
    availabilityDelayMonths?: number | null
    formNo?: string
    revisionNo?: string
    effectiveDate?: string
    version?: string
}

type ResolveOptions = {
    departmentId?: string
    /**
     * SME-facing views. Department setups are subsets of the programme list,
     * so this resolves to the full programme list.
     */
    includeAllDepartments?: boolean
}

type DepartmentComplianceScope = {
    id: string
    isOnboarding: boolean
    isMonitoring: boolean
    canSeeOnboardingRequirements: boolean
}

export const normalizeComplianceId = (value?: unknown) =>
    String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, '-')
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')

export const canonicalAgreementId = (value?: unknown) =>
    normalizeComplianceId(value)

export const COMPLIANCE_EXPIRING_SOON_DAYS = 30

export type ResolvedComplianceStatus =
    | 'signed'
    | 'valid'
    | 'expiring-soon'
    | 'expired'
    | 'missing'
    | 'pending'
    | 'invalid'
    | 'queried'
    | string

const complianceDate = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    if (typeof value?.seconds === 'number') {
        return new Date(value.seconds * 1000)
    }
    if (value instanceof Date) return value

    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * When an uploaded document expires. The requirement's validity period applied
 * to the document's issue date wins; otherwise the stored expiryDate. This is
 * the rule the staff Compliance page uses (computeExpiryDate), and the expiry
 * reminder function in functions/src/complianceExpiry.ts mirrors it.
 */
export const complianceEffectiveExpiry = (
    document: any,
    requirement?: { hasExpiry?: boolean; expiryMonths?: number | null } | null
): Date | null => {
    const months = requirement?.hasExpiry
        ? Number(requirement.expiryMonths) || 0
        : 0
    const issued = complianceDate(document?.issueDate)

    if (months > 0 && issued) {
        // Clamp to the month's last day (31 Jan + 1 month = 28/29 Feb), as dayjs does.
        const expiry = new Date(issued)
        expiry.setDate(1)
        expiry.setMonth(expiry.getMonth() + months)
        const lastDay = new Date(expiry.getFullYear(), expiry.getMonth() + 1, 0).getDate()
        expiry.setDate(Math.min(issued.getDate(), lastDay))
        return expiry
    }

    return complianceDate(document?.expiryDate)
}

export const resolveComplianceDocumentStatus = (
    document: any,
    effectiveExpiry?: unknown,
    now = new Date(),
    expiringSoonDays = COMPLIANCE_EXPIRING_SOON_DAYS
): ResolvedComplianceStatus => {
    const storedStatus = String(document?.status || 'pending')
        .trim()
        .toLowerCase()

    if (storedStatus === 'missing') return 'missing'

    const expiry = complianceDate(
        effectiveExpiry ?? document?.expiryDate
    )

    if (expiry && expiry.getTime() < now.getTime()) {
        return 'expired'
    }

    if (['invalid', 'rejected', 'queried'].includes(storedStatus)) {
        return storedStatus
    }

    if (
        ['valid', 'approved', 'verified', 'accepted'].includes(
            storedStatus
        )
    ) {
        if (
            expiry &&
            expiry.getTime() <=
                now.getTime() +
                    expiringSoonDays * 24 * 60 * 60 * 1000
        ) {
            return 'expiring-soon'
        }

        return 'valid'
    }

    return storedStatus
}

export const complianceStatusCountsAsCovered = (
    status: unknown
) =>
    ['valid', 'expiring-soon', 'signed'].includes(
        String(status || '').trim().toLowerCase()
    )

export const complianceStatusLabel = (status: unknown) => {
    const normalized = String(status || 'missing')
        .trim()
        .toLowerCase()

    const labels: Record<string, string> = {
        signed: 'Signed',
        valid: 'Valid',
        'expiring-soon': 'Expiring soon',
        expired: 'Expired',
        missing: 'Not uploaded',
        pending: 'Awaiting verification',
        invalid: 'Invalid',
        rejected: 'Rejected',
        queried: 'Needs correction',
        'not-configured': 'Not configured'
    }

    return (
        labels[normalized] ||
        normalized.replace(
            /(^|-)(\w)/g,
            (_, separator, letter) =>
                `${separator ? ' ' : ''}${letter.toUpperCase()}`
        )
    )
}

const mapAgreementTemplate = (
    id: string,
    data: any
): AgreementTemplate => {
    const agreementId = normalizeComplianceId(
        data.agreementId || id
    )

    return {
        id,
        agreementId,
        title: String(data.title || agreementId),
        active: data.active !== false,
        renderer: data.renderer,
        signingRoute: data.signingRoute,
        availabilityDelayMonths:
            data.availabilityDelayMonths ?? null,
        formNo: data.formNo,
        revisionNo: data.revisionNo,
        effectiveDate: data.effectiveDate,
        version: data.version
    }
}

const rawOnboardingFlag = (
    raw: any,
    kind: ComplianceRequirementKind
): boolean | undefined => {
    // Agreements are always onboarding/monitoring requirements.
    if (kind === 'agreement') return true

    if (raw?.isOnboarding === true) return true
    if (raw?.isOnboarding === false) return false

    return undefined
}

export const normalizeComplianceRequirement = (
    raw: any,
    templates: AgreementTemplate[] = []
): ComplianceRequirement => {
    const rawKind = String(
        raw?.kind || raw?.type || ''
    ).toLowerCase()

    const looksLikeAgreement =
        rawKind === 'agreement' ||
        Boolean(raw?.agreementId)

    const kind: ComplianceRequirementKind =
        looksLikeAgreement ? 'agreement' : 'upload'

    const agreementId =
        kind === 'agreement'
            ? canonicalAgreementId(
                raw?.agreementId || raw?.id
            )
            : undefined

    const uploadId = normalizeComplianceId(
        raw?.presetId ||
            raw?.key ||
            raw?.preset ||
            raw?.id ||
            raw?.title
    )

    const id = agreementId || uploadId

    const agreement = agreementId
        ? templates.find(
            item =>
                item.agreementId === agreementId ||
                item.id === agreementId
        )
        : undefined

    const isOnboarding = rawOnboardingFlag(raw, kind)

    return {
        id,
        key: id,
        title:
            agreement?.title ||
            String(
                raw?.title ||
                    raw?.name ||
                    id ||
                    'Untitled'
            ),
        kind,
        type: kind,
        agreementId,
        presetId:
            kind === 'upload'
                ? uploadId
                : undefined,
        hasExpiry: Boolean(
            raw?.hasExpiry || raw?.expiryRule
        ),
        expiryMonths:
            raw?.hasExpiry || raw?.expiryRule
                ? raw?.expiryMonths ??
                  raw?.expiryRule?.months ??
                  null
                : null,
        requiredAtApplication: Boolean(
            raw?.requiredAtApplication
        ),
        departmentId: raw?.departmentId,
        ...(isOnboarding !== undefined
            ? { isOnboarding }
            : {})
    }
}

export const complianceRequirementKey = (
    raw: any,
    templates: AgreementTemplate[] = []
) => {
    const requirement =
        normalizeComplianceRequirement(raw, templates)

    return `${requirement.kind}:${requirement.id}`
}

export const complianceDocumentKey = (
    raw: any,
    templates: AgreementTemplate[] = []
) => {
    const isAgreement =
        raw?.kind === 'agreement' ||
        raw?.type === 'agreement' ||
        Boolean(raw?.agreementId)

    const value = isAgreement
        ? raw?.agreementId || raw?.id
        : raw?.presetId ||
          raw?.templateId ||
          raw?.type ||
          raw?.title ||
          raw?.documentName ||
          raw?.name

    const id = isAgreement
        ? canonicalAgreementId(value)
        : normalizeComplianceId(value)

    return `${
        isAgreement ? 'agreement' : 'upload'
    }:${id}`
}

export const normalizeComplianceRequirements = (
    rows: any[] = [],
    templates: AgreementTemplate[] = []
) => {
    const unique = new Map<
        string,
        ComplianceRequirement
    >()

    rows.forEach(row => {
        const requirement =
            normalizeComplianceRequirement(
                row,
                templates
            )

        if (!requirement.id) return

        const key = complianceRequirementKey(
            requirement,
            templates
        )

        const existing = unique.get(key)

        if (!existing) {
            unique.set(key, requirement)
            return
        }

        unique.set(key, {
            ...existing,
            ...requirement,

            // Never let an old copied requirement that omitted
            // `isOnboarding` erase the canonical metadata.
            isOnboarding:
                requirement.kind === 'agreement'
                    ? true
                    : requirement.isOnboarding ??
                      existing.isOnboarding,

            departmentId:
                requirement.departmentId ??
                existing.departmentId
        })
    })

    return [...unique.values()]
}

/**
 * The programme's list is the master list. A department's setup only selects
 * which programme requirements that department tracks, and may set its own
 * expiry for them. Everything else (title, kind, onboarding scope, required at
 * application) comes from the programme, and a department row whose programme
 * requirement was deleted is dropped rather than kept alive.
 */
export const selectDepartmentRequirements = (
    programRequirements: ComplianceRequirement[],
    departmentRequirements: ComplianceRequirement[],
    templates: AgreementTemplate[] = []
) => {
    const programByKey = new Map(
        programRequirements.map(requirement => [
            complianceRequirementKey(requirement, templates),
            requirement
        ])
    )

    const selected = new Map<string, ComplianceRequirement>()
    departmentRequirements.forEach(requirement => {
        const key = complianceRequirementKey(requirement, templates)
        const canonical = programByKey.get(key)
        if (!canonical) return

        selected.set(key, {
            ...canonical,
            hasExpiry: requirement.hasExpiry,
            expiryMonths: requirement.hasExpiry
                ? requirement.expiryMonths
                : null,
            departmentId: requirement.departmentId
        })
    })

    return [...selected.values()]
}

/**
 * Programme requirements live on programs/{id}.programRequirements. Older
 * programmes only have the requiredDocs subcollection, which /programs still
 * mirrors, so fall back to it when the array is empty.
 */
const loadProgramRequirementRows = async (
    programId: string,
    program: any
): Promise<any[]> => {
    if (
        Array.isArray(program?.programRequirements) &&
        program.programRequirements.length
    ) {
        return program.programRequirements
    }

    const legacy = await getDocs(
        collection(db, 'programs', programId, 'requiredDocs')
    )

    return legacy.docs.map(item => {
        const row = item.data() as any
        const isAgreement = row.type === 'agreement'
        return {
            key: item.id,
            title: row.title || item.id,
            kind: isAgreement ? 'agreement' : 'upload',
            ...(isAgreement
                ? { agreementId: row.agreementId || item.id }
                : {}),
            hasExpiry: Boolean(row.expiryRule),
            expiryMonths: row.expiryRule?.months ?? null,
            requiredAtApplication: Boolean(row.mandatory),
            ...(typeof row.isOnboarding === 'boolean'
                ? { isOnboarding: row.isOnboarding }
                : {})
        }
    })
}

const getDepartmentComplianceScope = async (
    departmentId: string
): Promise<DepartmentComplianceScope> => {
    const departmentSnapshot = await getDoc(
        doc(db, 'departments', departmentId)
    )

    if (!departmentSnapshot.exists()) {
        return {
            id: departmentId,
            isOnboarding: false,
            isMonitoring: false,
            canSeeOnboardingRequirements: false
        }
    }

    const department = departmentSnapshot.data() as any

    const isOnboarding =
        department?.isOnboarding === true

    const isMonitoring =
        department?.isMonitoring === true

    return {
        id: departmentId,
        isOnboarding,
        isMonitoring,
        canSeeOnboardingRequirements:
            isOnboarding || isMonitoring
    }
}

export const isOnboardingComplianceRequirement = (
    requirement: ComplianceRequirement
) =>
    requirement.kind === 'agreement' ||
    requirement.type === 'agreement' ||
    requirement.isOnboarding === true

export const filterComplianceRequirementsForDepartment = (
    requirements: ComplianceRequirement[],
    scope: Pick<
        DepartmentComplianceScope,
        'canSeeOnboardingRequirements'
    >
) =>
    requirements.filter(requirement => {
        if (
            !isOnboardingComplianceRequirement(
                requirement
            )
        ) {
            return true
        }

        return scope.canSeeOnboardingRequirements
    })

export async function listAgreementTemplates() {
    const snapshot = await getDocs(
        collection(db, 'agreementTemplates')
    )

    return snapshot.docs
        .map(item =>
            mapAgreementTemplate(
                item.id,
                item.data()
            )
        )
        .filter(item => item.active)
}

export async function getAgreementTemplate(
    agreementIdValue: string
) {
    const agreementId =
        canonicalAgreementId(agreementIdValue)

    if (!agreementId) return null

    const snapshot = await getDoc(
        doc(
            db,
            'agreementTemplates',
            agreementId
        )
    )

    if (!snapshot.exists()) return null

    const template = mapAgreementTemplate(
        snapshot.id,
        snapshot.data()
    )

    return template.active ? template : null
}

export async function resolveComplianceRequirements(
    programId: string,
    options: ResolveOptions = {}
) {
    if (!programId) {
        return {
            requirements: [],
            agreements: [],
            departmentScope: null
        }
    }

    const programSnapshot = await getDoc(
        doc(db, 'programs', programId)
    )

    if (!programSnapshot.exists()) {
        return {
            requirements: [],
            agreements: [],
            departmentScope: null
        }
    }

    const program =
        programSnapshot.data() as any

    const agreements =
        await listAgreementTemplates()

    const programRequirements =
        normalizeComplianceRequirements(
            await loadProgramRequirementRows(
                programId,
                program
            ),
            agreements
        )

    if (options.departmentId) {
        const [
            departmentRequirementsSnapshot,
            departmentScope
        ] = await Promise.all([
            getDoc(
                doc(
                    db,
                    'programs',
                    programId,
                    'deptRequirements',
                    options.departmentId
                )
            ),
            getDepartmentComplianceScope(
                options.departmentId
            )
        ])

        const departmentRequirements =
            departmentRequirementsSnapshot.exists()
                ? normalizeComplianceRequirements(
                    (
                        departmentRequirementsSnapshot.data() as any
                    ).requiredDocuments || [],
                    agreements
                ).map(item => ({
                    ...item,
                    departmentId:
                        options.departmentId
                }))
                : []

        const selectedRequirements =
            selectDepartmentRequirements(
                programRequirements,
                departmentRequirements,
                agreements
            )

        const visibleRequirements =
            filterComplianceRequirementsForDepartment(
                selectedRequirements,
                departmentScope
            )

        return {
            requirements: visibleRequirements,

            // Do not expose agreement templates to ordinary departments.
            agreements:
                departmentScope.canSeeOnboardingRequirements
                    ? agreements
                    : [],

            departmentScope
        }
    }

    return {
        requirements: programRequirements,
        agreements,
        departmentScope: null
    }
}
