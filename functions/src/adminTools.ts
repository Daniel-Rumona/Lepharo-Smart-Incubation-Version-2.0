// functions/src/adminTools.ts
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onCall, type CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { getTransporter, APP_BASE_URL } from './emailShared';

if (!admin.apps.length) {
  admin.initializeApp();
}

const DEFAULT_PASSWORD = 'Password@1';

// TODO: lock this down to your programmer/admin email(s)
const ALLOWLIST_EMAILS = new Set<string>([
  'daniel@quantilytix.co.za',
]);

function assertAllowed(req: CallableRequest<any>) {
  const email = req.auth?.token?.email as string | undefined;
  if (!email || !ALLOWLIST_EMAILS.has(email)) {
    throw new HttpsError(
      'permission-denied',
      'You are not authorized to use this function.',
    );
  }
}

// Helper: load /users docs for a set of uids in batches of 10
async function loadUserDocsByUid(uids: string[]) {
  const db = admin.firestore();
  const map = new Map<string, admin.firestore.DocumentData>();

  if (!uids.length) return map;

  const chunkSize = 10; // Firestore "in" limit
  for (let i = 0; i < uids.length; i += chunkSize) {
    const chunk = uids.slice(i, i + chunkSize);
    const snap = await db
      .collection('users')
      .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
      .get();

    snap.docs.forEach((docSnap) => {
      map.set(docSnap.id, docSnap.data());
    });
  }

  return map;
}

/**
 * listAuthUsers: returns auth users + merged Firestore `/users/{uid}` info
 */
export const listAuthUsers = onCall(async (req) => {
  assertAllowed(req);
  const pageSize = Math.min(Number(req.data?.pageSize) || 1000, 1000);
  const pageToken = req.data?.pageToken as string | undefined;

  const result = await admin.auth().listUsers(pageSize, pageToken);

  const uids = result.users.map((u) => u.uid);
  const userDocsMap = await loadUserDocsByUid(uids);

  const users = result.users.map((u) => {
    const fsData = userDocsMap.get(u.uid) || {};

    const fsCreatedAt =
      (fsData.createdAt as any)?.toDate?.()?.toISOString?.() ?? null;

    const fsName =
      (fsData.name as string | undefined) ||
      (fsData.displayName as string | undefined) ||
      null;

    const fsRole = (fsData.role as string | undefined) || null;
    const claimsRole =
      (u.customClaims?.role as string | undefined) ||
      (u.customClaims?.userRole as string | undefined) ||
      null;

    const role = fsRole || claimsRole || null;

    const firstLoginComplete =
      (fsData.firstLoginComplete as boolean | undefined) ?? null;

    return {
      uid: u.uid,
      email: u.email || null,
      displayName: u.displayName || null,
      disabled: u.disabled,
      creationTime: u.metadata.creationTime,
      lastSignInTime: u.metadata.lastSignInTime,
      customClaims: u.customClaims || {},
      providerData:
        u.providerData?.map((p) => ({
          providerId: p.providerId,
          uid: p.uid,
        })) || [],

      // Firestore-enriched fields
      fsName,
      role,
      firstLoginComplete,
      fsCreatedAt,
    };
  });

  return { users, pageToken: result.pageToken || null };
});

type EmailDocumentChange = {
  ref: FirebaseFirestore.DocumentReference;
  before: FirebaseFirestore.DocumentData;
  after: FirebaseFirestore.DocumentData;
  replacements: number;
};

function replaceEmailValue(value: any, oldEmail: string, newEmail: string): { value: any; replacements: number } {
  if (typeof value === 'string') {
    return value.trim().toLowerCase() === oldEmail
      ? { value: newEmail, replacements: 1 }
      : { value, replacements: 0 };
  }

  if (Array.isArray(value)) {
    let replacements = 0;
    const next = value.map((item) => {
      const result = replaceEmailValue(item, oldEmail, newEmail);
      replacements += result.replacements;
      return result.value;
    });
    return { value: replacements ? next : value, replacements };
  }

  // Only descend into ordinary Firestore maps. Timestamps, GeoPoints and
  // DocumentReferences are class instances and must be preserved as-is.
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    let replacements = 0;
    const next: Record<string, any> = {};
    Object.entries(value).forEach(([key, item]) => {
      const result = replaceEmailValue(item, oldEmail, newEmail);
      next[key] = result.value;
      replacements += result.replacements;
    });
    return { value: replacements ? next : value, replacements };
  }

  return { value, replacements: 0 };
}

const HR_EMPLOYEE_ROLES = new Set([
  'operations',
  'projectmanager',
  'project manager',
  'coordinator',
  'projectadmin',
  'center coordinator',
  'center_coordinator',
  'receptionist',
  'employee',
]);

function isHrManager(profile: FirebaseFirestore.DocumentData) {
  const role = String(profile.role || '').trim().toLowerCase();
  const departmentName = String(
    profile.departmentName || profile.department || '',
  ).trim().toLowerCase();
  return role === 'hr' || (
    role === 'operations' &&
    (departmentName.startsWith('hrm') || departmentName.includes('human resources'))
  );
}

function isHrEmployeeTarget(target: FirebaseFirestore.DocumentData) {
  return HR_EMPLOYEE_ROLES.has(String(target.role || '').trim().toLowerCase());
}

async function assertUserDeletionAllowed(
  req: CallableRequest<any>,
  targetUid?: string,
  targetEmail?: string,
) {
  const callerUid = req.auth?.uid;
  const callerEmail = String(req.auth?.token?.email || '').toLowerCase();
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Must be signed in.');
  }
  if (ALLOWLIST_EMAILS.has(callerEmail) || req.auth?.token?.admin === true) return;

  const db = admin.firestore();
  const callerSnap = await db.collection('users').doc(callerUid).get();
  const caller = callerSnap.data() || {};
  const callerRole = String(caller.role || '').trim().toLowerCase();
  const allowedRoles = new Set([
    'director',
    'admin',
    'superadmin',
    'hr',
    'operations',
    'projectadmin',
    'coordinator',
    'center coordinator',
  ]);
  if (!allowedRoles.has(callerRole)) {
    throw new HttpsError('permission-denied', 'You are not authorized to delete users.');
  }

  let targetSnap: FirebaseFirestore.DocumentSnapshot | undefined;
  if (targetUid) {
    const direct = await db.collection('users').doc(targetUid).get();
    if (direct.exists) targetSnap = direct;
  }
  if (!targetSnap && targetEmail) {
    const byEmail = await db
      .collection('users')
      .where('email', '==', targetEmail.trim().toLowerCase())
      .limit(1)
      .get();
    targetSnap = byEmail.docs[0];
  }
  if (!targetSnap?.exists) {
    throw new HttpsError('not-found', 'User profile not found.');
  }
  if (targetSnap.id === callerUid) {
    throw new HttpsError('permission-denied', 'You cannot delete your own account.');
  }

  if (!['director', 'admin', 'superadmin'].includes(callerRole)) {
    const target = targetSnap.data() || {};
    const targetRole = String(target.role || '').trim().toLowerCase();
    const sameDepartment =
      Boolean(caller.departmentId) && caller.departmentId === target.departmentId;
    const canManageAsHr =
      isHrManager(caller) && isHrEmployeeTarget(target);
    const canManageCoordinator =
      targetRole === 'coordinator' &&
      ['operations', 'projectadmin', 'coordinator', 'center coordinator'].includes(callerRole) &&
      (callerRole !== 'operations' || sameDepartment);

    if (!canManageAsHr && !canManageCoordinator) {
      throw new HttpsError(
        'permission-denied',
        'You are not authorized to permanently remove this employee.',
      );
    }
  }
}

async function findEmailChanges(
  db: FirebaseFirestore.Firestore,
  uid: string,
  oldEmail: string,
  newEmail: string,
) : Promise<{ changes: EmailDocumentChange[]; scannedDocuments: number }> {
  const documents = new Map<string, FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot>();
  const userSnapshot = await db.collection('users').doc(uid).get();
  if (userSnapshot.exists) documents.set(userSnapshot.ref.path, userSnapshot);

  // Query indexed identity fields instead of recursively downloading every
  // document and subcollection in Firestore. The old implementation could run
  // for several minutes on a production database and outlive the client call.
  const roots = await db.listCollections();
  const snapshots = await Promise.all(
    roots.flatMap((root) =>
      ['email', 'contactEmail'].map((field) => root.where(field, '==', oldEmail).get()),
    ),
  );

  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((document) => documents.set(document.ref.path, document));
  });

  const changes: EmailDocumentChange[] = [];
  for (const document of documents.values()) {
    const before = document.data();
    if (!before) continue;
    const result = replaceEmailValue(before, oldEmail, newEmail);
    if (result.replacements) {
      changes.push({
        ref: document.ref,
        before,
        after: result.value,
        replacements: result.replacements,
      });
    }
  }

  return { changes, scannedDocuments: documents.size };
}

async function assertCanUpdateUserEmail(req: CallableRequest<any>, targetUid: string) {
  const callerEmail = String(req.auth?.token?.email || '').toLowerCase();
  if (ALLOWLIST_EMAILS.has(callerEmail)) return;

  const callerUid = req.auth?.uid;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }

  const db = admin.firestore();
  const [callerSnap, targetSnap] = await Promise.all([
    db.collection('users').doc(callerUid).get(),
    db.collection('users').doc(targetUid).get(),
  ]);

  if (!callerSnap.exists || !targetSnap.exists) {
    throw new HttpsError('not-found', 'Caller or target user profile not found.');
  }

  const caller = callerSnap.data() || {};
  const target = targetSnap.data() || {};
  const callerRole = String(caller.role || '').trim().toLowerCase();
  const targetRole = String(target.role || '').trim().toLowerCase();

  if (['system_admin', 'admin', 'superadmin'].includes(callerRole)) return;

  const coordinatorManagerRoles = new Set([
    'director',
    'operations',
    'projectadmin',
    'center coordinator',
    'center_coordinator',
  ]);
  const sameDepartment =
    Boolean(caller.departmentId) && caller.departmentId === target.departmentId;
  const departmentAllowed = callerRole !== 'operations' || sameDepartment;
  const hrEmployeeAllowed =
    isHrManager(caller) &&
    isHrEmployeeTarget(target);

  if (
    hrEmployeeAllowed ||
    (
    targetRole === 'coordinator' &&
    coordinatorManagerRoles.has(callerRole) &&
    departmentAllowed
    )
  ) {
    return;
  }

  throw new HttpsError(
    'permission-denied',
    'You are not authorized to change this user email.',
  );
}

async function writeEmailChanges(changes: EmailDocumentChange[], useOriginal: boolean) {
  const db = admin.firestore();
  for (let offset = 0; offset < changes.length; offset += 400) {
    const batch = db.batch();
    changes.slice(offset, offset + 400).forEach((change) => {
      batch.set(change.ref, useOriginal ? change.before : change.after, { merge: false });
    });
    await batch.commit();
  }
}

/** Update an Auth email and indexed identity/profile email values in Firestore. */
export const updateUserEmailCascade = onCall(
  { timeoutSeconds: 60, memory: '1GiB' },
  async (req) => {
    const uid = String(req.data?.uid || '').trim();
    const newEmail = String(req.data?.newEmail || '').trim().toLowerCase();
    if (!uid || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      throw new HttpsError('invalid-argument', 'Provide a uid and a valid new email address.');
    }

    await assertCanUpdateUserEmail(req, uid);

    const authUser = await admin.auth().getUser(uid).catch(() => undefined);
    if (!authUser?.email) throw new HttpsError('not-found', 'Auth user or current email not found.');

    const oldEmail = authUser.email.trim().toLowerCase();
    if (oldEmail === newEmail) {
      return { ok: true, uid, oldEmail, newEmail, scannedDocuments: 0, updatedDocuments: 0, replacements: 0, byCollection: [] };
    }

    const existing = await admin.auth().getUserByEmail(newEmail).catch(() => undefined);
    if (existing && existing.uid !== uid) {
      throw new HttpsError('already-exists', 'That email address is already used by another account.');
    }

    const db = admin.firestore();
    const { changes, scannedDocuments } = await findEmailChanges(
      db,
      uid,
      oldEmail,
      newEmail,
    );

    await admin.auth().updateUser(uid, { email: newEmail });
    try {
      await writeEmailChanges(changes, false);
    } catch (error) {
      // Best-effort compensation keeps Auth and any completed Firestore batches aligned.
      await Promise.allSettled([
        admin.auth().updateUser(uid, { email: oldEmail }),
        writeEmailChanges(changes, true),
      ]);
      console.error('Cascade email update failed and was rolled back', { uid, oldEmail, newEmail, error });
      throw new HttpsError('internal', 'The email update failed and was rolled back. Please try again.');
    }

    const counts = new Map<string, number>();
    changes.forEach((change) => {
      const rootCollection = change.ref.path.split('/')[0];
      counts.set(rootCollection, (counts.get(rootCollection) || 0) + 1);
    });

    return {
      ok: true,
      uid,
      oldEmail,
      newEmail,
      scannedDocuments,
      updatedDocuments: changes.length,
      replacements: changes.reduce((sum, change) => sum + change.replacements, 0),
      byCollection: Array.from(counts, ([collection, count]) => ({ collection, count })),
    };
  },
);

/** Enable or disable an employee login while retaining their HR history. */
export const setEmployeeAccountStatus = onCall(async (req) => {
  const uid = String(req.data?.uid || '').trim();
  const active = req.data?.active;
  if (!uid || typeof active !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Provide a uid and an active status.');
  }

  const callerUid = req.auth?.uid;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  if (callerUid === uid) {
    throw new HttpsError('permission-denied', 'You cannot change your own account status.');
  }

  const db = admin.firestore();
  const [callerSnap, targetSnap] = await Promise.all([
    db.collection('users').doc(callerUid).get(),
    db.collection('users').doc(uid).get(),
  ]);
  if (!callerSnap.exists || !targetSnap.exists) {
    throw new HttpsError('not-found', 'Caller or employee profile not found.');
  }

  const caller = callerSnap.data() || {};
  const target = targetSnap.data() || {};
  const callerRole = String(caller.role || '').trim().toLowerCase();
  const isAdministrator = ['system_admin', 'admin', 'superadmin', 'director'].includes(callerRole);
  const canManageAsHr =
    isHrManager(caller) && isHrEmployeeTarget(target);

  if (!isAdministrator && !canManageAsHr) {
    throw new HttpsError(
      'permission-denied',
      'You are not authorized to change this employee account.',
    );
  }

  await admin.auth().updateUser(uid, { disabled: !active });
  await targetSnap.ref.set({
    status: active ? 'Active' : 'Inactive',
    accountDisabledAt: active
      ? admin.firestore.FieldValue.delete()
      : admin.firestore.FieldValue.serverTimestamp(),
    accountDisabledBy: active
      ? admin.firestore.FieldValue.delete()
      : callerUid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, uid, active };
});

/** Resend the account-setup email, resetting the account to the default temporary password. */
export const resendWelcomeEmail = onCall(async (req) => {
  const uid = String(req.data?.uid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'Provide a uid.');
  }

  const callerUid = req.auth?.uid;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }

  const db = admin.firestore();
  const [callerSnap, targetSnap] = await Promise.all([
    db.collection('users').doc(callerUid).get(),
    db.collection('users').doc(uid).get(),
  ]);
  if (!callerSnap.exists || !targetSnap.exists) {
    throw new HttpsError('not-found', 'Caller or employee profile not found.');
  }

  const caller = callerSnap.data() || {};
  const target = targetSnap.data() || {};
  const callerRole = String(caller.role || '').trim().toLowerCase();
  const isAdministrator = ['system_admin', 'admin', 'superadmin', 'director'].includes(callerRole);
  const canManageAsHr = isHrManager(caller) && isHrEmployeeTarget(target);

  if (!isAdministrator && !canManageAsHr) {
    throw new HttpsError(
      'permission-denied',
      'You are not authorized to resend this account setup email.',
    );
  }

  const authUser = await admin.auth().getUser(uid).catch(() => undefined);
  if (!authUser?.email) {
    throw new HttpsError('not-found', 'Auth user not found.');
  }

  await admin.auth().updateUser(uid, { password: DEFAULT_PASSWORD });
  await admin.auth().setCustomUserClaims(uid, {
    ...(authUser.customClaims || {}),
    mustChangePassword: true,
    mustRegister: true,
  });
  await targetSnap.ref.set(
    {
      mustChangePassword: true,
      mustRegister: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const loginUrl = process.env.APP_LOGIN_URL || `${APP_BASE_URL.replace(/\/$/, '')}/login`;
  const name = String(target.name || authUser.displayName || 'there');
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;

  const html = `
    <p>Hi ${name},</p>
    <p>Here are your access details for the <b>Lepharo Smart Incubation System</b> again.</p>
    <p>A temporary password has been generated for your account: <b>${DEFAULT_PASSWORD}</b></p>
    <p>To access your account, please sign in <a href="${loginUrl}">here</a> using your email address and this temporary password.</p>
    <p><strong>Important:</strong> Please use the "Sign In" option, not "Create Account", as your account has already been set up.</p>
    <p>You will be required to change your password immediately after signing in for security purposes.</p>
    <p>If you did not expect this email, please contact your administrator.</p>
  `;

  const text =
    `Hi ${name},\n\n` +
    `Here are your access details for the Lepharo Smart Incubation System again.\n\n` +
    `A temporary password has been generated for your account: ${DEFAULT_PASSWORD}\n\n` +
    `To access your account, please sign in here: ${loginUrl}\n` +
    `Use your email address and the temporary password to sign in.\n\n` +
    `Important: Please use the "Sign In" option, not "Create Account", as your account has already been set up.\n\n` +
    `You will be required to change your password immediately after signing in for security purposes.\n\n` +
    `If you did not expect this email, please contact your administrator.\n`;

  try {
    await getTransporter().sendMail({
      from,
      to: authUser.email,
      subject: 'Your Smart Incubation account access',
      html,
      text,
    });
  } catch (error: any) {
    logger.error('resendWelcomeEmail.sendMail failed', {
      uid,
      email: authUser.email,
      err: String(error?.response || error?.message || error),
    });
    throw new HttpsError(
      'internal',
      'The account was reset, but the email could not be sent. Please try again shortly.',
    );
  }

  return { ok: true, uid, email: authUser.email };
});

const hasInterventionActivity = (assignment: FirebaseFirestore.DocumentData) => {
  const progress = Number(assignment.computedProgress ?? assignment.progress ?? 0);
  const updates = Array.isArray(assignment.progressUpdates) ? assignment.progressUpdates.length : 0;
  return Boolean(
    progress > 0 || updates > 0 || assignment.movDocumentId || assignment.completedAt ||
    ['completed', 'submitted', 'done'].includes(String(assignment.completionStatus || '').toLowerCase()) ||
    ['completed', 'done'].includes(String(
      assignment.assigneeCompletionStatus || assignment.assigneeCompletionStatus || ''
    ).toLowerCase())
  );
};

/** Preview or repair assignments that have activity but no operational intervention record. */
export const repairMissingInterventionRecords = onCall(async (req) => {
  assertAllowed(req);
  const commit = req.data?.commit === true;
  const requestedLimit = Number(req.data?.limit || 500);
  const repairLimit = Math.max(1, Math.min(requestedLimit, 2000));
  const db = admin.firestore();

  const [assignmentsSnap, interventionRecordsSnap] = await Promise.all([
    db.collection('assignedInterventions').get(),
    db.collection('interventionsDatabase').get(),
  ]);

  const linkedAssignmentIds = new Set<string>();
  const assignmentIds = new Set(assignmentsSnap.docs.map((item) => item.id));
  interventionRecordsSnap.docs.forEach((item) => {
    const data = item.data();
    const linkedId = String(data.assignedInterventionId || data.interventionKey || '').trim();
    if (linkedId) linkedAssignmentIds.add(linkedId);
    else if (assignmentIds.has(item.id)) linkedAssignmentIds.add(item.id);
  });

  const missing = assignmentsSnap.docs
    .filter((item) => hasInterventionActivity(item.data()))
    .filter((item) => !linkedAssignmentIds.has(item.id))
    .slice(0, repairLimit);

  const preview = missing.map((item) => {
    const data = item.data();
    return {
      assignedInterventionId: item.id,
      participantId: data.participantId || null,
      beneficiaryName: data.beneficiaryName || data.participantName || '',
      interventionId: data.interventionId || null,
      interventionTitle: data.interventionTitle || data.title || 'Intervention',
      progress: Number(data.computedProgress ?? data.progress ?? 0),
      movDocumentId: data.movDocumentId || null,
    };
  });

  if (commit && missing.length) {
    for (let offset = 0; offset < missing.length; offset += 400) {
      const batch = db.batch();
      missing.slice(offset, offset + 400).forEach((item) => {
        const data = item.data();
        const ref = db.collection('interventionsDatabase').doc(item.id);
        batch.create(ref, {
          assignedInterventionId: item.id,
          interventionId: data.interventionId || null,
          interventionTitle: data.interventionTitle || data.title || 'Intervention',
          areaOfSupport: data.areaOfSupport || data.departmentName || '',
          programId: data.programId || null,
          programName: data.programName || '',
          departmentId: data.departmentId || null,
          departmentName: data.departmentName || '',
          participantId: data.participantId || null,
          beneficiaryName: data.beneficiaryName || data.participantName || '',
          interventionType: data.type || 'singular',
          assigneeRole: data.assigneeRole || null,
          coordinatorIds: [data.assigneeId].filter(Boolean),
          tracking: data.tracking || {},
          progress: Number(data.computedProgress ?? data.progress ?? 0),
          resources: Array.isArray(data.resources) ? data.resources : [],
          createdAt: data.createdAt || admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          confirmedAt: null,
          feedback: null,
        });
      });
      await batch.commit();
    }
  }

  return {
    ok: true,
    mode: commit ? 'commit' : 'preview',
    scannedAssignments: assignmentsSnap.size,
    existingInterventionRecords: interventionRecordsSnap.size,
    missingCount: missing.length,
    limited: missing.length === repairLimit,
    repairedCount: commit ? missing.length : 0,
    preview,
  };
});

/**
 * deleteUserCascade: delete auth user + related Firestore docs by email/uid
 * Supports dryRun preview.
 */
export const deleteUserCascade = onCall(async (req) => {
    const inUid = req.data?.uid as string | undefined;
    const inEmail = req.data?.email as string | undefined;

    const dryRun = !!req.data?.dryRun;
    const confirm = !!req.data?.confirm; // require true for real delete (recommended)

    if (!inUid && !inEmail) {
      throw new HttpsError("invalid-argument", "Provide uid or email");
    }
    await assertUserDeletionAllowed(req, inUid, inEmail);

    // Resolve uid/email from Auth
    let uid = inUid;
    let email = inEmail;

    let authUser: admin.auth.UserRecord | undefined;

    if (!uid && email) {
      authUser = await admin.auth().getUserByEmail(email).catch(() => undefined);
      if (!authUser) throw new HttpsError("not-found", "Auth user not found");
      uid = authUser.uid;
    }
    if (!email && uid) {
      authUser = await admin.auth().getUser(uid).catch(() => undefined);
      if (!authUser) throw new HttpsError("not-found", "Auth user not found");
      email = authUser.email || undefined;
    }
    if (!uid || !email) {
      throw new HttpsError("failed-precondition", "Could not resolve uid & email");
    }

    // ensure authUser loaded for response
    if (!authUser) {
      authUser = await admin.auth().getUser(uid).catch(() => undefined);
    }

    const db = admin.firestore();

    const TARGET_COLLECTIONS = [
      "applications",
      "participants",
      // ⚠️ consider removing these if they are master/global data
      // "interventions",
      // "interventionsDatabase",
      "coordinators",
      "users",
      "tasks",
      "events",
      "resources",
      "assignedInterventions",
      "timesheets",
      "leaveRequests",
      "employeePerformanceReviews",
      "employeePerformanceCompacts",
    ];

    const FIELDS_TO_CHECK = [
      "email",
      "userEmail",
      "ownerEmail",
      "createdBy",
      "updatedBy",
      "participantEmail",
      "operationsEmail",
      "coordinatorEmail",
      "employeeEmail",
    ];

    const UID_FIELDS = [
      "uid",
      "userId",
      "employeeId",
      "employeeUid",
      "createdByUid",
    ];

    // Helper: delete (or count) documents safely in chunks (<= 500 per batch)
    async function deleteDocsInChunks(
      refs: FirebaseFirestore.DocumentReference[],
      dry: boolean
    ) {
      if (dry) return refs.length;

      let deleted = 0;
      for (let i = 0; i < refs.length; i += 450) {
        const chunk = refs.slice(i, i + 450);
        const batch = db.batch();
        chunk.forEach((r) => batch.delete(r));
        await batch.commit();
        deleted += chunk.length;
      }
      return deleted;
    }

    // Gather matches (dedup by path)
    const toDelete = new Map<string, FirebaseFirestore.DocumentReference>(); // path -> ref
    const byCollectionCount: Record<string, number> = {};

    async function collectWhere(col: string, field: string, value: string) {
      const snap = await db.collection(col).where(field, "==", value).get();
      if (snap.empty) return;

      snap.docs.forEach((d) => {
        const key = d.ref.path;
        if (!toDelete.has(key)) {
          toDelete.set(key, d.ref);
          byCollectionCount[col] = (byCollectionCount[col] || 0) + 1;
        }
      });
    }

    // Include explicit /users/{uid} if exists (dedup-safe)
    const usersDocRef = db.collection("users").doc(uid);
    const usersDoc = await usersDocRef.get();
    let profile: any | null = null;

    if (usersDoc.exists) {
      profile = { id: usersDoc.id, ...usersDoc.data() };
      if (!toDelete.has(usersDocRef.path)) {
        toDelete.set(usersDocRef.path, usersDocRef);
        byCollectionCount["users"] = (byCollectionCount["users"] || 0) + 1;
      }
    }

    // Sweep collections
    for (const col of TARGET_COLLECTIONS) {
      for (const f of FIELDS_TO_CHECK) await collectWhere(col, f, email);
      for (const f of UID_FIELDS) await collectWhere(col, f, uid);
    }

    // Build impact summary (backend returns real collection names; UI can mask them)
    const impact = {
      totalDocs: Array.from(toDelete.keys()).length,
      byCollection: Object.entries(byCollectionCount)
        .map(([collection, count]) => ({ collection, count }))
        .sort((a, b) => b.count - a.count),
    };

    // Dry run: return preview only
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        uid,
        email,
        user: authUser
          ? {
              uid: authUser.uid,
              email: authUser.email,
              displayName: authUser.displayName,
              disabled: authUser.disabled,
              creationTime: authUser.metadata.creationTime,
              lastSignInTime: authUser.metadata.lastSignInTime,
              providerData: authUser.providerData?.map((p) => ({
                providerId: p.providerId,
                uid: p.uid,
                email: p.email,
              })),
              customClaims: authUser.customClaims || {},
            }
          : null,
        profile,
        impact,
      };
    }

    // Real delete: force explicit confirmation flag
    if (!confirm) {
      throw new HttpsError(
        "failed-precondition",
        "Confirmation required. Pass { confirm: true } to proceed."
      );
    }

    // Delete Firestore docs
    const refs = Array.from(toDelete.values());
    const deletedCount = await deleteDocsInChunks(refs, false);

    // Finally delete Auth user
    await admin.auth().deleteUser(uid);

    return {
      ok: true,
      dryRun: false,
      uid,
      email,
      deleted: {
        firestoreDocs: deletedCount,
        authUser: true,
      },
      impact,
    };
  });
