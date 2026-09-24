import { db } from '@/firebase'
import { addDoc, collection } from 'firebase/firestore'

export type NotificationAction = {
  actionId: string
  label: string
  style?: 'primary' | 'default' | 'danger'
  patch: Record<string, unknown>
}

export type NotificationPayload = {
  type: string
  message: string | Record<string, string>
  recipientRoles: string[]
  recipientIds?: string[]
  participantId?: string
  participantName?: string
  interventionId?: string
  interventionTitle?: string
  link?: string
  actionTarget?: { collection: string; docId: string }
  actions?: NotificationAction[]
  [key: string]: unknown
}

function stripUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as Partial<T>
}

export const sendNotification = async (payload: NotificationPayload) => {
  try {
    await addDoc(collection(db, 'notifications'), stripUndefined({
      ...payload,
      readBy: {},
      createdAt: new Date()
    }))
  } catch (error) {
    console.error('Error sending notification:', error)
  }
}
