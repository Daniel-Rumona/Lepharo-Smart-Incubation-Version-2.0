import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import nodemailer from "nodemailer";
import * as crypto from "crypto";
import { admin as adminApp, db } from "./firebase";
import { withEmailDeliveryLogging } from "./emailDelivery";

const DEFAULT_PASSWORD = "Password@1";
const ALLOW_ORIGINS = new Set([
  "http://localhost:5173",
  "https://lepharosmartinc.co.za",
  "https://www.lepharosmartinc.co.za",
  "https://oauth.lepharosmartinc.co.za",
]);

function setCors(req: any, res: any) {
  const origin = req.headers.origin;
  if (origin && ALLOW_ORIGINS.has(origin)) res.set("Access-Control-Allow-Origin", origin);
  else res.set("Access-Control-Allow-Origin", "https://lepharosmartinc.co.za");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getTransporter() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE == null
    ? port === 465
    : process.env.SMTP_SECURE.trim().toLowerCase() === "true";
  return withEmailDeliveryLogging(nodemailer.createTransport({
    host: requireEnv("SMTP_HOST"),
    port,
    secure,
    auth: {
      user: requireEnv("SMTP_USER"),
      pass: requireEnv("SMTP_PASS"),
    },
  }));
}

export const createPlatformUser = onRequest(
  { region: "us-central1", invoker: "public" },
  async (req, res) => {
    setCors(req, res)

    if (req.method === "OPTIONS") {
      res.status(204).send("")
      return
    }

    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "method_not_allowed" })
      return
    }

    const authHeader = req.headers.authorization || ""
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""

    if (!idToken) {
      res.status(401).json({ ok: false, error: "missing_id_token" })
      return
    }

    let caller: admin.auth.DecodedIdToken

    try {
      caller = await adminApp.auth().verifyIdToken(idToken)
    } catch {
      res.status(401).json({ ok: false, error: "invalid_id_token" })
      return
    }

    type CreatePayload = {
      email: string
      password?: string
      name?: string
      role: string
      mustRegister?: boolean
      company?: string

      branchId?: string | null
      branchName?: string | null
      assignedPrograms?: string[]

      engagementCategory?: "Full-time" | "Contract" | "Intern" | null
      nationalCoordinator?: boolean

      departmentId?: string | null
      departmentName?: string | null
      position?: string | null
      jobTitle?: string | null
      workerType?: "intern" | "permanent"
      employmentType?: "intern" | "permanent"
      startDate?: string | null
      endDate?: string | null
      internEndDate?: string | null

      expertise?: string[]
      rate?: number
      type?: "Internal" | "External"

      sendEmail?: boolean
      sendResetLink?: boolean
      allowExisting?: boolean

      status?: "Active" | "Inactive"
      phone?: string
      extra?: Record<string, any>
    }

    const body = (req.body || {}) as CreatePayload

    const email = String(body.email || "").trim().toLowerCase()
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (!email || !emailRx.test(email)) {
      res.status(400).json({ ok: false, error: "invalid_email" })
      return
    }

    if (!body.role) {
      res.status(400).json({ ok: false, error: "invalid_role" })
      return
    }

    const callerUserDoc = await db.collection("users").doc(caller.uid).get()
    const callerData = callerUserDoc.data() || {}
    const callerRole = String(callerData.role || "").trim().toLowerCase()
    const callerDepartmentName = String(
      callerData.departmentName || callerData.department?.name || ""
    ).trim().toLowerCase()
    const callerIsHrManager =
      callerRole === "hr" ||
      (
        callerRole === "operations" &&
        (
          callerDepartmentName.startsWith("hrm") ||
          callerDepartmentName.includes("human resources")
        )
      )

    const ALLOWED_CREATOR_ROLES = new Set([
      "director",
      "system_admin",
      "admin",
      "hr",
      "operations",
      "projectadmin",
      "center coordinator",
      "center_coordinator",
    ])

    let coordinatorCanOnboard = false
    if (callerRole === "coordinator") {
      const departmentId = String(callerData.departmentId || callerData.department?.id || "").trim()
      const departmentName = String(callerData.departmentName || callerData.department?.name || "").trim().toLowerCase()

      if (departmentId) {
        const departmentSnap = await db.collection("departments").doc(departmentId).get()
        coordinatorCanOnboard = departmentSnap.exists && departmentSnap.data()?.isOnboarding === true
      }

      if (!coordinatorCanOnboard && departmentName) {
        const departmentsSnap = await db.collection("departments").get()
        coordinatorCanOnboard = departmentsSnap.docs.some(department => {
          const data = department.data()
          const name = String(data.name || data.departmentName || "").trim().toLowerCase()
          return name === departmentName && data.isOnboarding === true
        })
      }
    }

    const allowed = ALLOWED_CREATOR_ROLES.has(callerRole) || coordinatorCanOnboard
    const isSystemAdmin = callerRole === "system_admin" || callerRole === "admin"

    if (!allowed) {
      res.status(403).json({ ok: false, error: "permission_denied" })
      return
    }

    const toBackendRole = (input: string) => {
      const clean = String(input || "").trim().toLowerCase()

      if (clean === "center coordinator") return "projectadmin"
      if (clean === "center_coordinator") return "projectadmin"
      if (clean === "head of department") return "operations"
      if (clean === "hod") return "operations"

      return clean
    }

    const role = toBackendRole(body.role)
    const HR_ALLOWED_TARGET_ROLES = new Set([
      "operations",
      "projectmanager",
      "coordinator",
      "projectadmin",
      "receptionist",
      "employee",
    ])

    if (callerIsHrManager && !HR_ALLOWED_TARGET_ROLES.has(role)) {
      res.status(403).json({ ok: false, error: "invalid_role_for_creator" })
      return
    }

    if (
      callerRole === "operations" &&
      !callerIsHrManager &&
      !new Set(["coordinator", "projectmanager"]).has(role)
    ) {
      res.status(403).json({ ok: false, error: "invalid_role_for_creator" })
      return
    }

    const loginUrl =
      process.env.APP_LOGIN_URL || "https://lepharosmartinc.co.za/login"

    const mkSig = (seed: string) => {
      const nonce = crypto.randomBytes(8).toString("hex")
      return crypto
        .createHash("sha256")
        .update(`${seed}|${Date.now()}|${nonce}`)
        .digest("hex")
    }

    const assignedPrograms = Array.isArray(body.assignedPrograms)
      ? Array.from(
          new Set(
            body.assignedPrograms
              .map(item => String(item || "").trim())
              .filter(Boolean)
          )
        )
      : []

    const branchId = body.branchId ? String(body.branchId).trim() : null
    const branchName = body.branchName ? String(body.branchName).trim() : null

    const existingUserQuery = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get()
    const existingUserDoc = existingUserQuery.empty
      ? null
      : existingUserQuery.docs[0]

    let authUser: admin.auth.UserRecord | null = null
    let created = false
    let existingAuthUser = false

    try {
      authUser = await adminApp.auth().getUserByEmail(email)
      existingAuthUser = true
    } catch (error: any) {
      if (error?.code !== "auth/user-not-found") throw error
    }

    const existingIdentity = existingAuthUser || existingUserDoc !== null

    if (existingIdentity && !body.allowExisting) {
      res.status(409).json({ ok: false, error: "email_already_exists" })
      return
    }

    if (existingIdentity && !isSystemAdmin) {
      res.status(403).json({
        ok: false,
        error: "existing_user_conversion_requires_system_admin",
      })
      return
    }

    if (!authUser) {
      authUser = await adminApp.auth().createUser({
        ...(existingUserDoc ? { uid: existingUserDoc.id } : {}),
        email,
        password: DEFAULT_PASSWORD,
        displayName: body.name || email.split("@")[0],
        emailVerified: false,
        disabled: false,
      })

      created = true
    }

    const existingUserData = existingUserDoc?.data() || {}
    const mustRegister = created
      ? body.mustRegister !== undefined
        ? Boolean(body.mustRegister)
        : true
      : Boolean(existingUserData.mustRegister ?? authUser.customClaims?.mustRegister ?? false)
    const mustChangePassword = created
      ? true
      : Boolean(existingUserData.mustChangePassword ?? authUser.customClaims?.mustChangePassword ?? false)

    await adminApp.auth().setCustomUserClaims(authUser.uid, {
      role,
      mustChangePassword,
      mustRegister,
    })

    const digitalSignature = mkSig(`${authUser.uid}:${email}`)
    const now = adminApp.firestore.FieldValue.serverTimestamp()

    const userDoc: Record<string, any> = {
      uid: authUser.uid,
      email,
      name: body.name || authUser.displayName || "",
      role,

      mustRegister,

      status: body.status || existingUserData.status || "Active",
      phone: body.phone !== undefined ? body.phone : existingUserData.phone ?? null,

      mustChangePassword,
      passwordChangedAt: created
        ? null
        : existingUserData.passwordChangedAt ?? null,

      branchId,
      branchName,
      assignedBranch: branchId,
      assignedBranchName: branchName,
      assignedPrograms,

      departmentId: body.departmentId ?? null,
      departmentName: body.departmentName ?? null,
      department: body.departmentName ?? null,

      position: body.position ?? body.jobTitle ?? null,
      jobTitle: body.jobTitle ?? body.position ?? null,
      workerType: body.workerType ?? body.employmentType ?? "permanent",
      employmentType: body.employmentType ?? body.workerType ?? "permanent",
      startDate: body.startDate ?? null,
      endDate: body.workerType === "intern" ? body.endDate ?? null : null,
      internEndDate:
        body.workerType === "intern"
          ? body.internEndDate ?? body.endDate ?? null
          : null,

      nationalCoordinator: Boolean(body.nationalCoordinator),
      engagementCategory: body.engagementCategory ?? null,

      digitalSignature,
      updatedAt: now,

      ...(body.company ? { company: body.company } : {}),
      ...(body.extra || {}),
    }

    if (!existingUserDoc) {
      userDoc.createdAt = now
      userDoc.createdBy = caller.uid
    }

    await db.collection("users").doc(authUser.uid).set(userDoc, { merge: true })

    if (role === "operations") {
      const operationsPayload: Record<string, any> = {
        uid: authUser.uid,
        email,
        name: userDoc.name,
        departmentId: body.departmentId ?? null,
        departmentName: body.departmentName ?? null,
        digitalSignature,
        updatedAt: now,
      }

      if (created) {
        operationsPayload.createdAt = now
      }

      await db
        .collection("operationsStaff")
        .doc(authUser.uid)
        .set(operationsPayload, { merge: true })
    }

    if (role === "coordinator") {
      const coordinatorPayload: Record<string, any> = {
        uid: authUser.uid,
        authUid: authUser.uid,

        email,
        name: userDoc.name,

        role: "coordinator",

        departmentId: body.departmentId ?? null,
        departmentName: body.departmentName ?? null,

        branchId,
        branchName,
        assignedBranch: branchId,
        assignedBranchName: branchName,
        assignedPrograms,

        engagementCategory: body.engagementCategory ?? null,
        nationalCoordinator: Boolean(body.nationalCoordinator),

        digitalSignature,
        updatedAt: now,

        ...(Array.isArray(body.expertise) ? { expertise: body.expertise } : {}),
        ...(typeof body.rate === "number" ? { rate: body.rate } : {}),
        ...(body.type ? { type: body.type } : {}),
      }

      const coordinatorRef = db.collection("coordinators").doc(authUser.uid)
      const coordinatorExists = (await coordinatorRef.get()).exists

      if (!coordinatorExists) {
        coordinatorPayload.assignmentsCount = 0
        coordinatorPayload.rating = 0
        coordinatorPayload.active = true
        coordinatorPayload.createdAt = now
        coordinatorPayload.createdBy = caller.uid
      }

      // The Auth UID is the canonical coordinator document ID. Keeping this
      // write in the function prevents the UI and backend creating two records.
      await coordinatorRef.set(coordinatorPayload, { merge: true })
    }

    // Existing Auth users keep their password, so never send them an email
    // claiming that the default password was assigned during role conversion.
    const shouldSendEmail = created && body.sendEmail !== false
    let emailSent = false

    if (shouldSendEmail) {
      try {
        const transporter = getTransporter()
        const from = process.env.SMTP_FROM || process.env.SMTP_USER!
        const subject = "Welcome to Lepharo Smart Incubation"

        const html = `
          <p>Hi ${userDoc.name || "there"},</p>
          <p>Your account has been successfully created for the <b>Lepharo Smart Incubation System</b>.</p>
          <p>A temporary password has been generated for your account: <b>Password@1</b></p>
          <p>To access your account, please sign in <a href="${loginUrl}">here</a> using your email address and this temporary password.</p>
          <p><strong>Important:</strong> Please use the "Sign In" option, not "Create Account", as your account has already been set up.</p>
          <p>You will be required to change your password immediately after your first login for security purposes.</p>
          <p>If you did not request this account, please disregard this email.</p>
        `

        const text =
          `Hi ${userDoc.name || "there"},\n\n` +
          `Your account has been successfully created for the Lepharo Smart Incubation System.\n\n` +
          `A temporary password has been generated for your account: Password@1\n\n` +
          `To access your account, please sign in here: ${loginUrl}\n` +
          `Use your email address and the temporary password to sign in.\n\n` +
          `Important: Please use the "Sign In" option, not "Create Account", as your account has already been set up.\n\n` +
          `You will be required to change your password immediately after your first login for security purposes.\n\n` +
          `If you did not request this account, please disregard this email.\n`

        await transporter.sendMail({
          from,
          to: email,
          subject,
          html,
          text,
        })

        emailSent = true
      } catch (error) {
        logger.error("createPlatformUser: email_send_failed", {
          email,
          err: String(error),
        })
      }
    }

    res.status(200).json({
      ok: true,
      created,
      uid: authUser.uid,
      email,
      role,
      mustRegister: userDoc.mustRegister,
      branchId,
      branchName,
      assignedPrograms,
      emailSent,
    })
  }
)

export const adminResetUserPassword = onRequest({ region: "us-central1", invoker: "public" }, async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "method_not_allowed" }); return; }

  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) { res.status(401).json({ ok: false, error: "missing_id_token" }); return; }
    const caller = await adminApp.auth().verifyIdToken(idToken);

    const callerUserDoc = await db.collection("users").doc(caller.uid).get();
    const callerRole = String(callerUserDoc.data()?.role || "").toLowerCase();
    const hasAdminClaim = !!(caller as any).admin;
    const ALLOWED = new Set(["director", "admin", "superadmin", "operations", "projectadmin", "center coordinator"]);
    if (!hasAdminClaim && !ALLOWED.has(callerRole)) {
      res.status(403).json({ ok: false, error: "permission_denied" }); return; }

    type Payload = {
      uid?: string;
      email?: string;
      mode?: "set" | "link";
      newPassword?: string;
      sendEmail?: boolean;
      reason?: string;
    };
    const body = (req.body || {}) as Payload;
    if (!body.uid && !body.email) { res.status(400).json({ ok: false, error: "uid_or_email_required" }); return; }

    let targetUid = body.uid || "";
    let targetEmail = (body.email || "").trim().toLowerCase();
    let userDocSnap: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData> | null = null;

    if (targetUid) {
      userDocSnap = await db.collection("users").doc(targetUid).get();
      if (!userDocSnap.exists) { res.status(404).json({ ok: false, error: "user_not_found" }); return; }
      targetEmail = String(userDocSnap.data()?.email || "").toLowerCase();
    } else {
      const qs = await db.collection("users").where("email", "==", targetEmail).limit(1).get();
      if (qs.empty) { res.status(404).json({ ok: false, error: "user_not_found" }); return; }
      userDocSnap = qs.docs[0];
      targetUid = userDocSnap.id;
    }

    const targetUserDoc = userDocSnap!.data() as any;
    const targetName = String(targetUserDoc?.name || targetEmail);
    // Legacy/imported user documents may not use the Firebase Auth UID as their
    // Firestore document ID. Resolve the Auth record while retaining targetUid
    // for updates to the original Firestore document.
    let authUser: admin.auth.UserRecord;
    const storedAuthUid = String(targetUserDoc?.authUid || targetUserDoc?.uid || targetUid);
    try {
      authUser = await adminApp.auth().getUser(storedAuthUid);
    } catch {
      if (!targetEmail) {
        res.status(404).json({ ok: false, error: "auth_user_not_found" }); return;
      }
      try {
        authUser = await adminApp.auth().getUserByEmail(targetEmail);
      } catch {
        res.status(404).json({ ok: false, error: "auth_user_not_found" }); return;
      }
    }
    const authUid = authUser.uid;

    const loginUrl = process.env.APP_LOGIN_URL || "https://lepharosmartinc.co.za/login";

    if (body.mode === "link") {
      try {
        const link = await adminApp.auth().generatePasswordResetLink(targetEmail);
        const transporter = getTransporter();
        const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
        await transporter.sendMail({
          from,
          to: targetEmail,
          subject: "Reset your Lepharo Smart Incubation password",
          html: `
              <p>Hi ${targetName},</p>
              <p>A password reset was requested for your account. Click the link below to set a new password:</p>
              <p><a href="${link}">Reset Password</a></p>
              <p>If you didn't request this, please ignore this email.</p>
            `,
          text: `Hi ${targetName},\n\nReset your password using this link:\n${link}\n\nIf you didn't request this, please ignore this email.\n`,
        });

        await adminApp.auth().setCustomUserClaims(authUid, {
          ...(authUser.customClaims || {}),
          mustChangePassword: true,
        });
        await db.collection("users").doc(targetUid).set({
          mustChangePassword: true,
          updatedAt: adminApp.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        await db.collection("auditLogs").add({
          type: "password_reset_link",
          when: adminApp.firestore.FieldValue.serverTimestamp(),
          actor: { uid: caller.uid, email: caller.email || callerUserDoc.data()?.email || null, role: callerRole, hasAdminClaim: !!hasAdminClaim },
          target: { uid: targetUid, email: targetEmail },
          reason: typeof body.reason === "string" ? body.reason : null,
        });

        res.status(200).json({ ok: true, mode: "link", emailed: true });
        return;
      } catch (e: any) {
        logger.error("adminResetUserPassword: generate_link_failed", { err: String(e), email: targetEmail });
        res.status(500).json({ ok: false, error: "generate_link_failed" }); return;
      }
    }

    const newPassword = body.newPassword && String(body.newPassword).length >= 6
      ? String(body.newPassword)
      : DEFAULT_PASSWORD;

    await adminApp.auth().updateUser(authUid, { password: newPassword });
    await adminApp.auth().revokeRefreshTokens(authUid);

    const current = await adminApp.auth().getUser(authUid);
    await adminApp.auth().setCustomUserClaims(authUid, {
      ...(current.customClaims || {}),
      mustChangePassword: true,
    });

    await db.collection("users").doc(targetUid).set({
      mustChangePassword: true,
      passwordChangedAt: null,
      updatedAt: adminApp.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    let emailSent = false;
    const shouldSendEmail = body.sendEmail !== false;
    if (shouldSendEmail) {
      try {
        const transporter = getTransporter();
        const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
        await transporter.sendMail({
          from,
          to: targetEmail,
          subject: "Your password has been reset",
          html: `
              <p>Hi ${targetName},</p>
              <p>Your password has been reset by an administrator.</p>
              <p><b>Temporary password:</b> ${newPassword}</p>
              <p>Please sign in here: <a href="${loginUrl}">${loginUrl}</a> and you will be prompted to change your password.</p>
            `,
          text:
            `Hi ${targetName},\n\n` +
            `Your password has been reset by an administrator.\n\n` +
            `Temporary password: ${newPassword}\n\n` +
            `Please sign in here: ${loginUrl} and you will be prompted to change your password.\n`,
        });
        emailSent = true;
      } catch (e) {
        logger.error("adminResetUserPassword: email_send_failed", { email: targetEmail, err: String(e) });
      }
    }

    await db.collection("auditLogs").add({
      type: "password_reset_set",
      when: adminApp.firestore.FieldValue.serverTimestamp(),
      actor: { uid: caller.uid, email: caller.email || callerUserDoc.data()?.email || null, role: callerRole, hasAdminClaim: !!hasAdminClaim },
      target: { uid: targetUid, email: targetEmail },
      context: { emailSent, mode: "set" },
      reason: typeof body.reason === "string" ? body.reason : null,
    });

    res.status(200).json({ ok: true, mode: "set", emailSent });
  } catch (e: any) {
    logger.error("adminResetUserPassword: failed", { err: String(e) });
    res.status(500).json({ ok: false, error: "internal_error", detail: String(e?.message || e) });
  }
});
