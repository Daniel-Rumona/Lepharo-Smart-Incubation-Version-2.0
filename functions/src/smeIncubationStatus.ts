import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { admin, db } from './firebase';
import { scheduledJob } from './cronHeartbeat';
import { departmentIdsForRole } from './departmentRoles';
import { suppressRecordNotifications } from './syntheticData';
import { SME_STATUSES, incubationState, latestSmeActivity, normalizeSmeStatus } from './smeIncubationLogic';

const clean = (v: unknown) => String(v ?? '').trim();
const programIdOf = (row: any) => clean(row.programId || row.programID || row.program?.id || row.program);
const accepted = (row: any) => clean(row.applicationStatus || row.status || row.decision?.status || (row.acceptedAt ? 'accepted' : '')).toLowerCase() === 'accepted';

async function refreshApplication(applicationId: string, requested?: { status: string; reason: string; uid: string }) {
  const appRef = db.collection('applications').doc(applicationId);
  // Read activity inside the transaction: a concurrent attendance correction retries the calculation.
  return db.runTransaction(async tx => {
    const snap = await tx.get(appRef);
    if (!snap.exists || !accepted(snap.data())) {
      if (requested) throw new HttpsError('failed-precondition', 'Only accepted SMEs can change incubation status.');
      return null;
    }
    const app = snap.data()!;
    if (suppressRecordNotifications(app, applicationId)) {
      if (requested) throw new HttpsError('failed-precondition', 'Status tracking is disabled for synthetic records.');
      return null;
    }
    const participantId = clean(app.participantId);
    const participant = participantId ? (await tx.get(db.collection('participants').doc(participantId))).data() || {} : {};
    const assignmentQuery = db.collection('assignedInterventions').where(participantId ? 'participantId' : 'applicationId', '==', participantId || applicationId);
    const assignmentSnap = await tx.get(assignmentQuery);
    const legacyAssignmentSnap = participantId ? await tx.get(db.collection('assignedInterventions').where('applicationId', '==', applicationId)) : null;
    const appointmentSnap = participantId ? await tx.get(db.collection('appointments').where('smeId', '==', participantId)) : null;
    const legacyAppointmentSnap = participantId ? await tx.get(db.collection('appointments').where('participantId', '==', participantId)) : null;
    const programId = programIdOf(app);
    const scoped = (row: any) => !programIdOf(row) || programIdOf(row) === programId;
    const assignments = [...assignmentSnap.docs, ...(legacyAssignmentSnap?.docs || [])].map(d => d.data()).filter(scoped);
    const appointments = [...(appointmentSnap?.docs || []), ...(legacyAppointmentSnap?.docs || [])].map(d => d.data()).filter(scoped);
    const now = new Date();
    const lastActivity = latestSmeActivity(assignments, appointments, now.getTime());
    const state = incubationState({ ...app, lastParticipationAt: null }, participant, lastActivity, now.getTime());
    const previous = normalizeSmeStatus(app.incubationStatus ?? participant.incubationStatus);
    if (requested) {
      if (previous === 'Exited') throw new HttpsError('failed-precondition', 'An exited SME must be re-enrolled before its status can change.');
      if (state.inactiveDays !== null && state.inactiveDays >= 80 && requested.status !== 'Potential Exit') {
        throw new HttpsError('failed-precondition', 'This SME has reached 80 days without participation. Record its recent participation before moving it out of Potential Exit.');
      }
      state.status = requested.status as typeof state.status;
    }
    const statusChanged = state.status !== previous;
    const patch: Record<string, any> = {
      incubationStatus: state.status,
      lastParticipationAt: state.lastParticipationAt,
      inactivityBaselineAt: state.inactivityBaselineAt,
      inactivityBaselineSource: state.inactivityBaselineSource,
      exitQualified: state.exitQualified,
      incubationStatusCheckedAt: now,
    };
    if (statusChanged || requested) {
      const reason = requested?.reason || (state.status === 'Active' ? 'New participation recorded' : '80 days without recorded participation');
      patch.incubationStatusChangedAt = now;
      patch.incubationStatusActivityAt = state.lastParticipationAt || state.inactivityBaselineAt;
      patch.incubationStatusReason = reason;
      patch.incubationStatusHistory = admin.firestore.FieldValue.arrayUnion({
        from: previous, to: state.status, reason, at: now.toISOString(), by: requested?.uid || 'system',
      });
    }
    tx.update(appRef, patch);
    return { ...state, incubationStatus: state.status, incubationStatusChangedAt: patch.incubationStatusChangedAt?.toISOString() || app.incubationStatusChangedAt || null,
      incubationStatusReason: patch.incubationStatusReason || app.incubationStatusReason || null };
  });
}

export const setSmeIncubationStatus = onCall({ region: 'us-central1' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const profile = (await db.collection('users').doc(request.auth.uid).get()).data() || {};
  const role = clean(profile.role).toLowerCase();
  const departmentId = clean(profile.departmentId);
  const department = departmentId ? (await db.collection('departments').doc(departmentId).get()).data() : null;
  const romIds = await departmentIdsForRole('rom');
  const staff = ['operations', 'coordinator', 'projectadmin', 'director', 'system_admin', 'superadmin', 'admin'].includes(role);
  if (['inactive', 'disabled', 'deleted'].includes(clean(profile.status).toLowerCase()) || !staff ||
    !(['system_admin', 'superadmin', 'admin'].includes(role) || department?.isOnboarding === true || romIds.includes(departmentId))) {
    throw new HttpsError('permission-denied', 'Only ROM, onboarding staff or system administrators can change SME status.');
  }
  const { applicationId, status, reason } = request.data || {};
  if (typeof applicationId !== 'string' || !applicationId || applicationId.includes('/') ||
    !SME_STATUSES.includes(status) || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000) {
    throw new HttpsError('invalid-argument', 'Choose a status and provide a reason of up to 1,000 characters.');
  }
  return refreshApplication(applicationId, { status, reason: reason.trim(), uid: request.auth.uid });
});

async function refreshParticipant(participantId: string) {
  if (!participantId) return;
  const apps = await db.collection('applications').where('participantId', '==', participantId).get();
  for (const app of apps.docs) if (accepted(app.data())) await refreshApplication(app.id);
}

export const onSmeAssignmentActivity = onDocumentWritten(
  { region: 'us-central1', document: 'assignedInterventions/{assignmentId}' },
  async event => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const ids = new Set([clean(before?.participantId), clean(after?.participantId)].filter(Boolean));
    for (const id of ids) await refreshParticipant(id);
    if (!ids.size) {
      const appId = clean(after?.applicationId || before?.applicationId);
      if (appId) await refreshApplication(appId);
    }
  }
);
export const onSmeAppointmentActivity = onDocumentWritten(
  { region: 'us-central1', document: 'appointments/{appointmentId}' },
  async event => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const ids = new Set([clean(before?.smeId || before?.participantId), clean(after?.smeId || after?.participantId)].filter(Boolean));
    for (const id of ids) await refreshParticipant(id);
  }
);

export const smeIncubationStatusCron = scheduledJob('smeIncubationStatusCron', {
  region: 'us-central1', schedule: 'every day 06:00', timeZone: 'Africa/Johannesburg', timeoutSeconds: 540,
}, async () => {
  // Pagination covers legacy accepted-status spellings without a migration or a compound index.
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let checked = 0;
  while (true) {
    let query = db.collection('applications').orderBy(admin.firestore.FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    const eligible = page.docs.filter(app => accepted(app.data()));
    for (let i = 0; i < eligible.length; i += 10) {
      await Promise.all(eligible.slice(i, i + 10).map(app => refreshApplication(app.id)));
      checked += eligible.slice(i, i + 10).length;
    }
    cursor = page.docs[page.docs.length - 1];
  }
  return { checked };
});
