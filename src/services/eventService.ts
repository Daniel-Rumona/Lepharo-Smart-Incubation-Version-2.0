import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDocs,
    query,
    serverTimestamp,
    updateDoc,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'

export type EventType = 'meeting' | 'deadline' | 'event' | string
export type EventFormat = 'virtual' | 'in-person' | string

export type EventRecord = {
    id: string
    title: string
    description?: string
    date?: string
    start?: string | Date
    end?: string | Date
    startTime?: string
    endTime?: string
    type?: EventType
    format?: EventFormat
    link?: string
    location?: string
    departmentId?: string
    department?: string
    departmentName?: string
    participants?: Array<{ email?: string; name?: string }>
    participantsEmails?: string[]
    invitedEmails?: string[]
    organizerEmail?: string
    createdBy?: string
    ownerEmail?: string
    createdAt?: any
    updatedAt?: any
    [key: string]: any
}

export type EventPayload = Omit<EventRecord, 'id' | 'createdAt' | 'updatedAt'>

export type DepartmentOption = {
    id: string
    name: string
}

export async function listDepartments(): Promise<DepartmentOption[]> {
    const snap = await getDocs(
        query(
            collection(db, 'departments')
        )
    )

    return snap.docs
        .map(d => {
            const data = d.data() as any
            return {
                id: d.id,
                name: data.name || data.departmentName || 'Unspecified'
            }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listEvents(params: {
    departmentId?: string | null
}): Promise<EventRecord[]> {
    const {departmentId } = params


    const constraints: any[] = []
    if (departmentId) constraints.push(where('departmentId', '==', departmentId))

    const snap = await getDocs(query(collection(db, 'events'), ...constraints))

    return snap.docs.map(d => ({
        id: d.id,
        ...(d.data() as any)
    })) as EventRecord[]
}

export async function createEvent(payload: EventPayload) {
    return addDoc(collection(db, 'events'), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    })
}

export async function updateEvent(eventId: string, payload: Partial<EventPayload>) {
    await updateDoc(doc(db, 'events', eventId), {
        ...payload,
        updatedAt: serverTimestamp()
    })
}

export async function removeEvent(eventId: string) {
    await deleteDoc(doc(db, 'events', eventId))
}
