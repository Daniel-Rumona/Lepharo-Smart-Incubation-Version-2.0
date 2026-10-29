import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where
} from 'firebase/firestore'
import { db } from '@/firebase'

// Bookings live in the `resourceAllocations` collection. Availability is
// always derived from the bookings that overlap a period, never from a stored
// counter, so a booking next week doesn't make a resource look taken today.

// What staff can set on an existing booking. New bookings are always
// 'scheduled'; whether one is upcoming or under way follows from its dates
// (see getBookingPhase), so 'active' isn't offered. Older bookings may still
// carry it and are treated the same as 'scheduled'.
export const EDITABLE_BOOKING_STATUSES = [
  { value: 'scheduled', label: 'Booked' },
  // Handed back early: frees the resource before the booked end time
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' }
]

export interface BookingPhase {
  label: string
  color: string
  badge: 'processing' | 'success' | 'default' | 'error'
}

export const getBookingPhase = (
  booking: Pick<ResourceBooking, 'status' | 'startTime' | 'endTime'>,
  now = new Date()
): BookingPhase => {
  if (booking.status === 'cancelled') {
    return { label: 'Cancelled', color: 'red', badge: 'error' }
  }
  if (booking.status === 'completed') {
    return { label: 'Completed', color: 'default', badge: 'default' }
  }
  if (now < toDate(booking.startTime)) {
    return { label: 'Upcoming', color: 'blue', badge: 'processing' }
  }
  if (now < toDate(booking.endTime)) {
    return { label: 'In use', color: 'green', badge: 'success' }
  }
  return { label: 'Ended', color: 'default', badge: 'default' }
}

// Completed and cancelled bookings no longer hold the resource
const HOLDING_STATUSES = new Set(['scheduled', 'active'])

export interface ResourceBooking {
  id: string
  resourceId: string
  allocatedToApplicationId?: string
  allocatedToName: string
  // Free-text recipient on bookings made before SMEs were linked
  allocatedTo?: string
  allocatedToEmail?: string
  participantId?: string
  purpose: string
  startTime: unknown
  endTime: unknown
  quantity: number
  status: string
}

export type BookingInput = Omit<ResourceBooking, 'id' | 'startTime' | 'endTime'> & {
  startTime: Date
  endTime: Date
}

// What the availability maths needs to know about a resource
export interface BookableUnit {
  id: string
  name: string
  capacity: number
  // Booked as a whole: effective capacity is one
  single: boolean
}

export const toDate = (value: unknown): Date => {
  if (value instanceof Date) return value
  if (value instanceof Timestamp) return value.toDate()
  if (value && typeof value === 'object' && 'seconds' in value) {
    return new Date(Number((value as { seconds: number }).seconds) * 1000)
  }
  return new Date(value as string)
}

export const holdsResource = (booking: Pick<ResourceBooking, 'status'>) =>
  HOLDING_STATUSES.has(booking.status)

const unitCapacity = (unit: BookableUnit) =>
  unit.single ? 1 : Math.max(0, Number(unit.capacity) || 0)

const holdingBookingsFor = (
  bookings: ResourceBooking[],
  resourceId: string,
  excludeId?: string
) =>
  bookings.filter(
    b => b.resourceId === resourceId && b.id !== excludeId && holdsResource(b)
  )

// Bookings that overlap [start, end); touching end-to-start doesn't count
export const overlappingBookings = (
  bookings: ResourceBooking[],
  resourceId: string,
  start: Date,
  end: Date,
  excludeId?: string
) =>
  holdingBookingsFor(bookings, resourceId, excludeId).filter(
    b => toDate(b.startTime) < end && start < toDate(b.endTime)
  )

// Highest number of units in use at any moment within [start, end). Summing
// every overlapping booking would over-count ones that never coincide.
export const peakBookedQuantity = (
  bookings: ResourceBooking[],
  resourceId: string,
  start: Date,
  end: Date,
  excludeId?: string
) => {
  const events: Array<[number, number]> = []
  overlappingBookings(bookings, resourceId, start, end, excludeId).forEach(b => {
    const qty = Number(b.quantity) || 0
    events.push([Math.max(toDate(b.startTime).getTime(), start.getTime()), qty])
    events.push([Math.min(toDate(b.endTime).getTime(), end.getTime()), -qty])
  })
  // Releases before claims at the same instant, so back-to-back bookings fit
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let current = 0
  let peak = 0
  events.forEach(([, delta]) => {
    current += delta
    peak = Math.max(peak, current)
  })
  return peak
}

export const availableForRange = (
  unit: BookableUnit,
  bookings: ResourceBooking[],
  start: Date,
  end: Date,
  excludeId?: string
) =>
  Math.max(
    0,
    unitCapacity(unit) - peakBookedQuantity(bookings, unit.id, start, end, excludeId)
  )

export const availableNow = (unit: BookableUnit, bookings: ResourceBooking[]) => {
  const now = new Date()
  return availableForRange(unit, bookings, now, new Date(now.getTime() + 1))
}

// The booking holding a single unit right now, if any
export const currentBooking = (resourceId: string, bookings: ResourceBooking[]) => {
  const now = new Date()
  return overlappingBookings(
    bookings,
    resourceId,
    now,
    new Date(now.getTime() + 1)
  )[0]
}

export const upcomingBookings = (resourceId: string, bookings: ResourceBooking[]) => {
  const now = new Date()
  return holdingBookingsFor(bookings, resourceId)
    .filter(b => toDate(b.endTime) > now)
    .sort((a, b) => toDate(a.startTime).getTime() - toDate(b.startTime).getTime())
}

export const fetchBookings = async (): Promise<ResourceBooking[]> => {
  const snapshot = await getDocs(collection(db, 'resourceAllocations'))
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }) as ResourceBooking)
}

const formatRange = (start: Date, end: Date) =>
  `${start.toLocaleString()} – ${end.toLocaleString()}`

/**
 * Creates or updates a booking after checking it fits alongside every other
 * booking for that resource in the same period.
 *
 * Firestore transactions can't run queries, so the overlap query runs outside
 * the transaction. To stop two people booking the last unit at once, every
 * save also writes the resource document it read: if another save commits in
 * between, this transaction is retried and re-runs the query with that
 * booking included.
 */
export const saveBooking = async (
  unit: BookableUnit,
  input: BookingInput,
  existingId?: string
) => {
  if (input.endTime <= input.startTime) {
    throw new Error('The booking must end after it starts.')
  }
  const quantity = unit.single ? 1 : Number(input.quantity)
  if (!(quantity > 0)) throw new Error('Quantity must be at least 1.')

  const resourceRef = doc(db, 'resources', unit.id)

  // Resolves to the booking's id (new or existing)
  return runTransaction(db, async tx => {
    const resourceSnap = await tx.get(resourceRef)
    if (!resourceSnap.exists()) throw new Error('Resource not found.')

    const resource = resourceSnap.data()
    if (resource.visibility === 'internal') {
      throw new Error(`${unit.name} is internal inventory and can't be booked.`)
    }
    if (resource.status === 'maintenance' || resource.status === 'unavailable') {
      throw new Error(`${unit.name} can't be booked while it's ${resource.status}.`)
    }

    const snapshot = await getDocs(
      query(collection(db, 'resourceAllocations'), where('resourceId', '==', unit.id))
    )
    const bookings = snapshot.docs.map(
      d => ({ id: d.id, ...d.data() }) as ResourceBooking
    )

    if (holdsResource({ status: input.status })) {
      if (unit.single) {
        const clash = overlappingBookings(
          bookings,
          unit.id,
          input.startTime,
          input.endTime,
          existingId
        )[0]
        if (clash) {
          throw new Error(
            `${unit.name} is already booked by ${bookedByName(clash)} for ${formatRange(
              toDate(clash.startTime),
              toDate(clash.endTime)
            )}.`
          )
        }
      } else {
        const free = availableForRange(
          { ...unit, capacity: Number(resource.capacity) || 0 },
          bookings,
          input.startTime,
          input.endTime,
          existingId
        )
        if (quantity > free) {
          throw new Error(
            `Only ${free} of ${resource.capacity} ${unit.name} available for those dates.`
          )
        }
      }
    }

    // Firestore rejects undefined, so optional SME fields are dropped when unset
    const data = Object.fromEntries(
      Object.entries({
        ...input,
        quantity,
        startTime: Timestamp.fromDate(input.startTime),
        endTime: Timestamp.fromDate(input.endTime)
      }).filter(([, value]) => value !== undefined)
    )
    const bookingRef = existingId
      ? doc(db, 'resourceAllocations', existingId)
      : doc(collection(db, 'resourceAllocations'))
    if (existingId) tx.update(bookingRef, data)
    else tx.set(bookingRef, data)

    // Concurrency guard, see above
    tx.update(resourceRef, { bookingsUpdatedAt: serverTimestamp() })
    return bookingRef.id
  })
}

export const bookedByName = (booking: ResourceBooking) =>
  booking.allocatedToName || booking.allocatedTo || 'Unknown'
