import dayjs from 'dayjs'

export type LeaseStatus = 'Lease signed' | 'Lease updated' | 'Lease expired' | 'Vacant'

export type FacilityWorkshop = {
    id: string
    workshopNo: string
    smeName?: string
    trade?: string
    leaseStatus: LeaseStatus
    leaseStart?: string | null
    leaseEnd?: string | null
    comments?: string
    createdAt?: any
}

export const WORKSHOPS = 'facilityWorkshops'
export const LEASE_STATUSES: LeaseStatus[] = ['Lease signed', 'Lease updated', 'Lease expired', 'Vacant']

/** A lease past its end date reads as expired whatever was last recorded. */
export const effectiveLeaseStatus = (workshop: Pick<FacilityWorkshop, 'leaseStatus' | 'leaseEnd'>): LeaseStatus =>
    workshop.leaseStatus !== 'Vacant' && workshop.leaseEnd && dayjs(workshop.leaseEnd).isBefore(dayjs(), 'day')
        ? 'Lease expired'
        : workshop.leaseStatus

export const leaseDuration = (workshop: Pick<FacilityWorkshop, 'leaseStart' | 'leaseEnd'>) =>
    workshop.leaseStart || workshop.leaseEnd
        ? `${workshop.leaseStart ? dayjs(workshop.leaseStart).format('MMM YYYY') : '?'} - ${workshop.leaseEnd ? dayjs(workshop.leaseEnd).format('MMM YYYY') : '?'}`
        : 'N/A'

export const sortWorkshops = <T extends { workshopNo: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.workshopNo.localeCompare(b.workshopNo, undefined, { numeric: true }))
