import { db } from '@/firebase'
import { addDoc, collection } from 'firebase/firestore'

const sendNotification = async (payload: {
  message: string,
  participantId?: string,
  participantName?: string,
  interventionId?: string,
  interventionTitle?: string,
  type: string,
  recipientRoles: string[]
}) => {
  try {
    await addDoc(collection(db, 'notifications'), {
      ...payload,
      status: 'unread',
      createdAt: new Date()
    })
  } catch (error) {
    console.error('Error sending notification:', error)
  }
}
