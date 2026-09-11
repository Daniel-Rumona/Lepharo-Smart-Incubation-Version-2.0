import { collection, doc, getDoc, getDocs, query, where, Firestore } from 'firebase/firestore'

export type CenterLocation = {
    id?: string
    branchId: string
    branchName: string
    centerName: string
    locationLabel: string
    radiusMeters: number
    latitude: number
    longitude: number
}

export type CenterMatchInput = {
    latitude?: number | null
    longitude?: number | null
    locationAccuracy?: number | null
}

export const DEFAULT_CENTER_RADIUS_METERS = 150
export const MAX_ACCURACY_ALLOWANCE_METERS = 250

export const distanceInMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const toRadians = (value: number) => value * Math.PI / 180
    const earthRadius = 6371000
    const latDelta = toRadians(lat2 - lat1)
    const lonDelta = toRadians(lon2 - lon1)
    const a = Math.sin(latDelta / 2) ** 2 +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(lonDelta / 2) ** 2
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export const buildCenterDocId = (input: { branchId: string }) =>
    String(input.branchId || '')
        .trim()
        .replace(/[^\w-]/g, '_')
        .replace(/_+/g, '_')

// A center only counts as configured once it has a captured coordinate.
// Typed addresses alone are not enough: reverse-geocoded and postal addresses
// for a building can legitimately differ (e.g. a corner property numbered on
// one street can report the other), so text can never be the source of truth.
export const isCenterConfigured = (centerLocation?: CenterLocation | null) =>
    Boolean(
        centerLocation?.branchId &&
        centerLocation?.centerName &&
        centerLocation?.locationLabel &&
        typeof centerLocation?.latitude === 'number' &&
        typeof centerLocation?.longitude === 'number'
    )

export const isCenterClockIn = (input: CenterMatchInput, centerLocation?: CenterLocation | null) => {
    if (!isCenterConfigured(centerLocation)) return false
    if (typeof input.latitude !== 'number' || typeof input.longitude !== 'number') return false

    const configuredRadius = centerLocation!.radiusMeters || DEFAULT_CENTER_RADIUS_METERS
    const accuracyAllowance = Math.min(
        Math.max(input.locationAccuracy || 0, 0),
        MAX_ACCURACY_ALLOWANCE_METERS
    )

    return distanceInMeters(
        centerLocation!.latitude,
        centerLocation!.longitude,
        input.latitude,
        input.longitude
    ) <= configuredRadius + accuracyAllowance
}

export const getUserBranchId = (user?: any) =>
    typeof user?.assignedBranch === 'string'
        ? user.assignedBranch.trim()
        : ''

export const fetchCenterLocation = async (
    db: Firestore,
    params: { branchId: string }
): Promise<CenterLocation | null> => {
    const branchId = String(params.branchId || '').trim()
    if (!branchId) return null

    // Canonical center document: attendanceCenters/{assignedBranch}
    const centerDocId = buildCenterDocId({ branchId })
    const canonicalSnap = await getDoc(doc(db, 'attendanceCenters', centerDocId))

    if (canonicalSnap.exists()) {
        return { id: canonicalSnap.id, ...(canonicalSnap.data() as CenterLocation) }
    }

    // Temporary compatibility for old program-keyed documents.
    // This lookup is branch-only: programId is never read or used.
    const legacySnap = await getDocs(
        query(
            collection(db, 'attendanceCenters'),
            where('branchId', '==', branchId)
        )
    )

    if (legacySnap.empty) return null

    const timestampMs = (value: any) => {
        if (typeof value?.toMillis === 'function') return value.toMillis()
        if (typeof value?.seconds === 'number') return value.seconds * 1000
        return 0
    }

    const latest = [...legacySnap.docs].sort(
        (a, b) =>
            timestampMs((b.data() as any)?.updatedAt) -
            timestampMs((a.data() as any)?.updatedAt)
    )[0]

    return latest
        ? { id: latest.id, ...(latest.data() as CenterLocation) }
        : null
}

export const resolveCenterLocationForUser = async (
    db: Firestore,
    user: any
): Promise<CenterLocation | null> => {
    const branchId = getUserBranchId(user)
    if (!branchId) return null

    return fetchCenterLocation(db, { branchId })
}
