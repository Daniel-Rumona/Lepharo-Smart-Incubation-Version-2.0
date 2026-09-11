"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireMoaAfter3Months = void 0;
// functions/src/moaFlag.ts
const scheduler_1 = require("firebase-functions/v2/scheduler");
const emailShared_1 = require("./emailShared");
function addMonths(ts, months) {
    const d = ts.toDate();
    const copy = new Date(d.getTime());
    copy.setMonth(copy.getMonth() + months);
    return emailShared_1.admin.firestore.Timestamp.fromDate(copy);
}
function threeMonthsAgo() {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return emailShared_1.admin.firestore.Timestamp.fromDate(d);
}
function validEmail(value) {
    const result = String(value || '').trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) ? result : null;
}
async function resolveRecipient(data) {
    const direct = validEmail(data?.applicantEmail || data?.participantEmail || data?.email);
    if (direct)
        return direct;
    if (!data?.participantId)
        return null;
    const participant = await emailShared_1.db.collection('participants').doc(String(data.participantId)).get();
    return validEmail(participant.data()?.email);
}
/**
 * Runs daily. Marks applications as "needsMOA" once they've been in
 * the programme for 3+ months (and haven't signed MOA yet).
 * Also clears the flag if MOA is found later.
 */
exports.requireMoaAfter3Months = (0, scheduler_1.onSchedule)({ schedule: 'every 24 hours', timeZone: 'Africa/Johannesburg' }, async () => {
    const threshold = threeMonthsAgo();
    // You may need a composite index (applicationStatus + acceptedAt).
    const snap = await emailShared_1.db
        .collection('applications')
        .where('applicationStatus', '==', 'accepted')
        .where('acceptedAt', '<=', threshold)
        .get();
    if (snap.empty)
        return;
    // Light concurrency guard
    const tasks = [];
    snap.forEach(docSnap => {
        tasks.push((async () => {
            const appRef = docSnap.ref;
            const data = docSnap.data();
            const acceptedAt = data?.acceptedAt ?? null;
            if (!acceptedAt)
                return;
            const moaRef = appRef.collection('agreements').doc('moa');
            const moa = await moaRef.get();
            const signed = moa.exists && (moa.data()?.signed === true);
            if (signed) {
                await appRef.set({ needsMOA: false, moaStatus: 'Completed' }, { merge: true });
                return;
            }
            const dueAt = data?.moaDueAt ?? addMonths(acceptedAt, 3);
            await appRef.set({ needsMOA: true, moaStatus: 'Required', moaDueAt: dueAt }, { merge: true });
            const lastSent = data?.emailNotifications?.moaRequired?.lastSentAt?.toDate?.();
            const reminderDue = !lastSent || Date.now() - lastSent.getTime() >= 7 * 24 * 60 * 60 * 1000;
            if (!reminderDue)
                return;
            const to = await resolveRecipient(data);
            if (!to)
                return;
            const firstNotice = !lastSent;
            const dueText = dueAt.toDate().toLocaleDateString('en-ZA');
            const actionUrl = `${emailShared_1.APP_BASE_URL.replace(/\/$/, '')}/incubatee`;
            await (0, emailShared_1.getTransporter)().sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to,
                subject: firstNotice ? 'MOA signature required' : 'Reminder: MOA signature required',
                html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
            <h2>${firstNotice ? 'MOA required' : 'MOA reminder'}</h2>
            <p>Your Memorandum of Agreement is now required. Please sign in and complete it.</p>
            <p><strong>Due date:</strong> ${dueText}</p>
            <p><a href="${actionUrl}" style="display:inline-block;padding:10px 16px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:6px">Open Smart Incubation</a></p>
          </div>`,
                text: `Your Memorandum of Agreement is required.\nDue date: ${dueText}\nOpen Smart Incubation: ${actionUrl}`,
            });
            await appRef.update({
                'emailNotifications.moaRequired.lastSentAt': emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
                'emailNotifications.moaRequired.lastSentTo': to,
                'emailNotifications.moaRequired.reminderCount': emailShared_1.admin.firestore.FieldValue.increment(1),
            });
        })());
    });
    // Run with a simple pool of 20 to avoid hammering Firestore
    const pool = 20;
    for (let i = 0; i < tasks.length; i += pool) {
        await Promise.all(tasks.slice(i, i + pool));
    }
});
//# sourceMappingURL=moaFlag.js.map