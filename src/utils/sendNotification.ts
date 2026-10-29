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
  /** Role-wide broadcast; ignored when recipientIds names anyone. */
  recipientRoles?: string[]
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

/**
 * A doc goes either to named people (recipientIds) or to a whole role
 * (audience 'role' + recipientRoles), never both: the rules only let a role
 * read docs marked audience 'role', and refuse that marker next to
 * recipientIds.
 */
function addressing(payload: NotificationPayload) {
  const { recipientIds, recipientRoles, ...rest } = payload
  const ids = (recipientIds || []).filter(Boolean)
  if (ids.length) return { ...rest, recipientIds: ids }
  const roles = (recipientRoles || []).filter(Boolean)
  return roles.length ? { ...rest, audience: 'role', recipientRoles: roles } : rest
}

export const sendNotification = async (payload: NotificationPayload) => {
  try {
    await addDoc(collection(db, 'notifications'), stripUndefined({
      ...addressing(payload),
      readBy: {},
      createdAt: new Date()
    }))
  } catch (error) {
    console.error('Error sending notification:', error)
  }
}
