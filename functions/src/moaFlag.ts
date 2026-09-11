// functions/src/moaFlag.ts
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { admin, APP_BASE_URL, db, getTransporter } from './emailShared'

function addMonths(ts: admin.firestore.Timestamp, months: number) {
  const d = ts.toDate()
  const copy = new Date(d.getTime())
  copy.setMonth(copy.getMonth() + months)
  return admin.firestore.Timestamp.fromDate(copy)
}

function threeMonthsAgo(): admin.firestore.Timestamp {
  const d = new Date()
  d.setMonth(d.getMonth() - 3)
  return admin.firestore.Timestamp.fromDate(d)
}

function validEmail(value: any): string | null {
  const result = String(value || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) ? result : null
}

async function resolveRecipient(data: any) {
  const direct = validEmail(data?.applicantEmail || data?.participantEmail || data?.email)
  if (direct) return direct
  if (!data?.participantId) return null
  const participant = await db.collection('participants').doc(String(data.participantId)).get()
  return validEmail(participant.data()?.email)
}

/**
 * Runs daily. Marks applications as "needsMOA" once they've been in
 * the programme for 3+ months (and haven't signed MOA yet).
 * Also clears the flag if MOA is found later.
 */
export const requireMoaAfter3Months = onSchedule(
  { schedule: 'every 24 hours', timeZone: 'Africa/Johannesburg' },
  async () => {
    const threshold = threeMonthsAgo()

    // You may need a composite index (applicationStatus + acceptedAt).
    const snap = await db
      .collection('applications')
      .where('applicationStatus', '==', 'accepted')
      .where('acceptedAt', '<=', threshold)
      .get()

    if (snap.empty) return

    // Light concurrency guard
    const tasks: Array<Promise<void>> = []

    snap.forEach(docSnap => {
      tasks.push((async () => {
        const appRef = docSnap.ref
        const data = docSnap.data() as any
        const acceptedAt: admin.firestore.Timestamp | null = data?.acceptedAt ?? null
        if (!acceptedAt) return

        const moaRef = appRef.collection('agreements').doc('moa')
        const moa = await moaRef.get()
        const signed = moa.exists && (moa.data()?.signed === true)

        if (signed) {
          await appRef.set(
            { needsMOA: false, moaStatus: 'Completed' },
            { merge: true }
          )
          return
        }

        const dueAt =
          data?.moaDueAt ?? addMonths(acceptedAt as admin.firestore.Timestamp, 3)

        await appRef.set(
          { needsMOA: true, moaStatus: 'Required', moaDueAt: dueAt },
          { merge: true }
        )

        const lastSent = data?.emailNotifications?.moaRequired?.lastSentAt?.toDate?.() as Date | undefined
        const reminderDue = !lastSent || Date.now() - lastSent.getTime() >= 7 * 24 * 60 * 60 * 1000
        if (!reminderDue) return

        const to = await resolveRecipient(data)
        if (!to) return
        const firstNotice = !lastSent
        const dueText = dueAt.toDate().toLocaleDateString('en-ZA')
        const actionUrl = `${APP_BASE_URL.replace(/\/$/, '')}/incubatee`
        await getTransporter().sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER!,
          to,
          subject: firstNotice ? 'MOA signature required' : 'Reminder: MOA signature required',
          html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
            <h2>${firstNotice ? 'MOA required' : 'MOA reminder'}</h2>
            <p>Your Memorandum of Agreement is now required. Please sign in and complete it.</p>
            <p><strong>Due date:</strong> ${dueText}</p>
            <p><a href="${actionUrl}" style="display:inline-block;padding:10px 16px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:6px">Open Smart Incubation</a></p>
          </div>`,
          text: `Your Memorandum of Agreement is required.\nDue date: ${dueText}\nOpen Smart Incubation: ${actionUrl}`,
        })
        await appRef.update({
          'emailNotifications.moaRequired.lastSentAt': admin.firestore.FieldValue.serverTimestamp(),
          'emailNotifications.moaRequired.lastSentTo': to,
          'emailNotifications.moaRequired.reminderCount': admin.firestore.FieldValue.increment(1),
        })
      })())
    })

    // Run with a simple pool of 20 to avoid hammering Firestore
    const pool = 20
    for (let i = 0; i < tasks.length; i += pool) {
      await Promise.all(tasks.slice(i, i + pool))
    }
  }
)
