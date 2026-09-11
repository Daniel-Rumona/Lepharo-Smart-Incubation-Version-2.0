import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { buildSmmeDpReminderEmail } from "./emailHelpers";
import { admin, db, getTransporter, getProgramName, getParticipantName, APP_BASE_URL, safeStr, getMERecipients, DevPlanEditRequestDoc } from "./emailShared";
import { logBrevoSend, sendViaBrevo } from "./brevoClient";

const normalizeEmail = (v: any) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

export const remindSmmeDpConfirmation = onRequest(
  { region: "us-central1", cors: true },
  (req, res) => {
    (async () => {
      let programId: string | undefined;
      let participantId: string | undefined;
      let email = "";
      try {
        const authHeader = (req.headers.authorization || "").toString();
        const match = authHeader.match(/^Bearer (.+)$/);
        if (!match) return res.status(401).json({ ok: false, error: "Missing or invalid auth." });
        await admin.auth().verifyIdToken(match[1]);
        const {
          programId: bodyProgramId,
          participantId: bodyParticipantId,
          reminderFromDeptId,
          reminderFromDeptName,
          submittedCount,
          totalCount,
        } = req.body || {};
        programId = bodyProgramId;
        participantId = bodyParticipantId;
        if (!programId || !participantId || !reminderFromDeptName) {
          return res.status(400).json({ ok: false, error: "Missing required fields." });
        }

        const appsRef = admin.firestore().collection("applications");
        const q1 = await appsRef
          .where("programId", "==", programId)
          .where("participantId", "==", participantId)
          .limit(1)
          .get();
        const appDoc = !q1.empty ? q1.docs[0].data() as any : null;
        const rawEmail = appDoc?.email || appDoc?.applicantEmail || appDoc?.participantEmail || "";
        email = normalizeEmail(rawEmail);

        if (!email || !isValidEmail(email)) {
          logger.warn("remindSmmeDpConfirmation.invalid_email", {
            participantId,
            programId: programId || null,
            rawEmail,
          });
          return res.status(422).json({ ok: false, error: "Invalid participant email." });
        }

        const name = appDoc?.beneficiaryName || appDoc?.participantName || "there";
        const confirmUrl =
          `${APP_BASE_URL}/incubatee/roadmap` +
          `?programId=${encodeURIComponent(programId)}` +
          `&participantId=${encodeURIComponent(participantId)}` +
          (reminderFromDeptId ? `&deptId=${encodeURIComponent(reminderFromDeptId)}` : "");

        const { subject, html, text } = buildSmmeDpReminderEmail({
          name,
          programName: null,
          confirmUrl,
          deptConfirmed: submittedCount,
          deptTotal: totalCount,
          reminderFromDeptName,
        });

        const { messageId } = await sendViaBrevo({ to: email, subject, html, text, tags: ["dev-plan-sme-reminder"] });
        await logBrevoSend({
          type: "DEV_PLAN_SME_REMINDER",
          to: email,
          subject,
          status: "sent",
          messageId,
          participantId,
          programId,
        });
        return res.status(200).json({ ok: true, sent: 1 });
      } catch (err: any) {
        const msg = String(err?.message || "");
        const looksLikeInvalidRecipient =
          /invalid recipient|user unknown|no such user|recipient rejected|550|invalid email/i.test(msg);

        await logBrevoSend({
          type: "DEV_PLAN_SME_REMINDER",
          to: email,
          subject: "Developmental Plan confirmation reminder",
          status: "failed",
          error: msg,
          participantId,
          programId,
        });

        if (looksLikeInvalidRecipient && email) {
          const suppressRef = admin.firestore().collection("emailSuppressions").doc(email);
          await suppressRef.set(
            {
              to: email,
              reason: "invalid_recipient",
              source: "remindSmmeDpConfirmation",
              type: "DEV_PLAN_SME_REMINDER",
              programId: programId || null,
              participantId,
              lastError: msg,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }

        logger.error("remindSmmeDpConfirmation.failed", { message: msg, stack: err?.stack });
        return res.status(500).json({ ok: false, error: msg || "Failed." });
      }
    })();
  }
);

const SKIP_DEPTS = [
  'M&E (Monitoring and Evaluation)',
  'IHF (InHouse Finance)',
  'ROM (Recruitment, Onboarding and Maintenance)',
  'HRM (Human Resources Management)',
  'HRM (Human Resources Management',
  'Stakeholder Engagement',
];

interface DepartmentDoc {
  name?: string;
  departmentName?: string;
  email?: string;
  primaryEmail?: string;
  secondaryEmail?: string;
  [key: string]: unknown;
}

interface DepartmentInfo {
  name: string;
  emails: string[];
}

interface ParticipantMeta {
  participantId: string;
  beneficiaryName: string;
  programName: string;
}

interface PlanDocData {
  participantId?: string;
  programId?: string | null;
  finalConfirmation?: boolean;
  confirmed?: Record<string, boolean>;
  [key: string]: unknown;
}

function normalizeDeptName(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function isSkippedDepartment(name: string): boolean {
  const norm = normalizeDeptName(name);
  return SKIP_DEPTS.some((d) => normalizeDeptName(d) === norm);
}

async function loadAllDepartments(): Promise<DepartmentInfo[]> {
  let q: FirebaseFirestore.Query = db.collection('departments');
  const snap = await q.get();
  const out: DepartmentInfo[] = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data() as DepartmentDoc;
    const rawName = (data.departmentName || data.name || '').toString().trim();
    if (!rawName) return;
    if (isSkippedDepartment(rawName)) return;
    const emailsSet = new Set<string>();
    const candidates = [data.email, data.primaryEmail, data.secondaryEmail].filter((v) => typeof v === 'string') as string[];
    candidates.forEach((e) => {
      const trimmed = e.trim();
      if (trimmed.includes('@')) emailsSet.add(trimmed);
    });
    out.push({ name: rawName, emails: Array.from(emailsSet) });
  });
  return out;
}

async function getParticipantMetaCached(participantId: string, cache: Map<string, ParticipantMeta>): Promise<ParticipantMeta> {
  const cached = cache.get(participantId);
  if (cached) return cached;
  const appsSnap = await db.collection('applications').where('participantId', '==', participantId).limit(1).get();
  const app = appsSnap.empty ? undefined : appsSnap.docs[0].data();
  const meta: ParticipantMeta = {
    participantId,
    beneficiaryName: (app?.beneficiaryName as string) || (app?.participantName as string) || 'Unknown SME',
    programName: (app?.programName as string) || 'Program',
  };
  cache.set(participantId, meta);
  return meta;
}

function getPendingDepartmentsForPlan(plan: PlanDocData, departments: DepartmentInfo[]): string[] {
  const confirmedMap = plan.confirmed || {};
  const confirmedKeys = Object.keys(confirmedMap);
  const pending: string[] = [];
  for (const dept of departments) {
    const deptNorm = normalizeDeptName(dept.name);
    const isConfirmed = confirmedKeys.some(k => normalizeDeptName(k) === deptNorm);
    if (!isConfirmed) pending.push(dept.name);
  }
  return pending;
}

function getDeptInfoLookup(departments: DepartmentInfo[]): Map<string, DepartmentInfo> {
  const map = new Map<string, DepartmentInfo>();
  departments.forEach(d => map.set(normalizeDeptName(d.name), d));
  return map;
}

function buildDeptRecipients(deptName: string, info: DepartmentInfo | undefined): { email: string; name?: string }[] {
  const recipientsSet = new Set<string>();
  (info?.emails || []).forEach(e => recipientsSet.add(e));
  const norm = normalizeDeptName(deptName);
  if (norm.includes('monitoring') || norm.includes('m e')) recipientsSet.add('egar@lepharo.co.za');
  if (norm.includes('rom') || norm.includes('recruitment')) recipientsSet.add('mel@lepharo.co.za');
  return Array.from(recipientsSet).map(email => ({ email }));
}

async function runDevPlanReminderOnce(triggerLabel: string, opts: { programId?: string | null }) {
  const transporter = getTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@lepharo.co.za';
  const { programId } = opts;

  const departments = await loadAllDepartments();
  if (!departments.length) return { departmentsWithPending: 0, totalDeptEmails: 0, totalPendingAssignments: 0 };

  const deptLookup = getDeptInfoLookup(departments);
  let plansQuery: FirebaseFirestore.Query = db.collection('diagnosticPlans');
  if (programId) plansQuery = plansQuery.where('programId', '==', programId);
  const plansSnap = await plansQuery.get();
  if (plansSnap.empty) return { departmentsWithPending: 0, totalDeptEmails: 0, totalPendingAssignments: 0 };

  const participantCache = new Map<string, ParticipantMeta>();
  const pendingByDept = new Map<string, { participantId: string; beneficiaryName: string; programName: string }[]>();

  for (const planDoc of plansSnap.docs) {
    const data = planDoc.data() as PlanDocData;
    const participantId = String(data.participantId || planDoc.id);
    const meta = await getParticipantMetaCached(participantId, participantCache);
    const pendingDepartments = getPendingDepartmentsForPlan(data, departments);
    if (!pendingDepartments.length) continue;
    for (const deptName of pendingDepartments) {
      if (!pendingByDept.has(deptName)) pendingByDept.set(deptName, []);
      pendingByDept.get(deptName)!.push({ participantId, beneficiaryName: meta.beneficiaryName, programName: meta.programName });
    }
  }

  if (!pendingByDept.size) return { departmentsWithPending: 0, totalDeptEmails: 0, totalPendingAssignments: 0 };

  const planUrl = `${APP_BASE_URL.replace(/\/$/, '')}/operations/plan`;
  let totalDeptEmails = 0;
  let totalPendingAssignments = 0;

  for (const [deptName, items] of pendingByDept.entries()) {
    totalPendingAssignments += items.length;
    const info = deptLookup.get(normalizeDeptName(deptName));
    const recipients = buildDeptRecipients(deptName, info);
    if (!recipients.length) continue;

    const subject = `Pending Developmental Plan confirmations – ${deptName}`;
    const rowsHtml = items.map(it => `
<tr>
<td style="padding:4px 8px;border-bottom:1px solid #eee">${it.beneficiaryName}</td>
<td style="padding:4px 8px;border-bottom:1px solid #eee">${it.programName}</td>
</tr>`).join('');

    const html = `
<div style="font-family:Inter,Arial,sans-serif;line-height:1.55;font-size:14px">
<p>Hi ${deptName} team,</p>
<p>The following SMEs still require <b>departmental confirmation</b> for their Developmental Plans:</p>
<table style="border-collapse:collapse;font-size:14px;margin:8px 0;min-width:320px">
<thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc">SME</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc">Program</th></tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
<p>Please log in and confirm here:<br/><a href="${planUrl}" target="_blank">${planUrl}</a></p>
<p style="margin-top:16px">Regards,<br/><b>Lepharo Smart Inc AI</b></p>
</div>
`;

    const text = `Pending Developmental Plan confirmations for department ${deptName}:
` +
      items.map(it => `- ${it.beneficiaryName} (${it.programName || 'Program'})`).join('\n') +
      `\nLink: ${planUrl}\nRegards,\nLepharo Smart Inc AI`;

    for (const r of recipients) {
      await transporter.sendMail({ from, to: r.email, subject, html, text });
      totalDeptEmails++;
    }
  }

  const summaryRowsHtml = [...pendingByDept.entries()].map(([deptName, items]) => `
<tr>
<td style="padding:4px 8px;border-bottom:1px solid #eee">${deptName}</td>
<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${items.length}</td>
</tr>`).join('');

  const now = new Date();
  const summarySubject = `Summary: Pending Developmental Plan confirmations (${now.toLocaleDateString('en-ZA')} ${now.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })})`;
  const summaryHtml = `
<div style="font-family:Inter,Arial,sans-serif;line-height:1.55;font-size:14px">
<p>Hi ROM,</p>
<p>Here is the current summary of <b>pending Developmental Plan confirmations</b> by department:</p>
<table style="border-collapse:collapse;font-size:14px;margin:8px 0;min-width:260px">
<thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc">Department</th><th style="text-align:right;padding:4px 8px;border-bottom:1px solid #ccc">SMEs Pending</th></tr></thead>
<tbody>${summaryRowsHtml}</tbody>
</table>
<p>Total departments with outstanding confirmations: <b>${pendingByDept.size}</b></p>
<p>Total SME–department assignments pending: <b>${totalPendingAssignments}</b></p>
<p style="margin-top:16px">Regards,<br/><b>Lepharo Smart Inc AI</b></p>
</div>
`;
  const summaryText = 'Pending Developmental Plan confirmations by department:\n' +
    [...pendingByDept.entries()].map(([deptName, items]) => `- ${deptName}: ${items.length}`).join('\n') +
    `\nTotal SME–department assignments pending: ${totalPendingAssignments}\nRegards,\nLepharo Smart Inc AI`;

  const summaryRecipients = ['mel@lepharo.co.za', 'daniel@quantilytix.co.za', 'egar@lepharo.co.za'];
  await transporter.sendMail({
    from,
    to: summaryRecipients.join(','),
    subject: summarySubject,
    html: summaryHtml,
    text: summaryText,
  });

  logger.info('devPlanReminder.done', { trigger: triggerLabel, departmentsWithPending: pendingByDept.size, totalDeptEmails, totalPendingAssignments });
  return { departmentsWithPending: pendingByDept.size, totalDeptEmails, totalPendingAssignments };
}

export const onDevPlanEditRequestEmail = onDocumentWritten(
  { region: "us-central1", document: "devPlanEditRequests/{reqId}" },
  async (event) => {
    try {
      const before = event.data?.before?.data() as DevPlanEditRequestDoc | undefined;
      const after = event.data?.after?.data() as DevPlanEditRequestDoc | undefined;
      if (!after) return;
      const reqId = String(event.params.reqId);
      const transporter = getTransporter();
      const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
      const prevStatus = String(before?.status || "").toLowerCase();
      const nextStatus = String(after?.status || "").toLowerCase();

      const isCreate = !before;
      const becamePending = prevStatus !== "pending" && nextStatus === "pending";
      if (isCreate || becamePending) {
        const alreadySent = after?.notifications?.editRequestEmail?.created?.sentAt ?? null;
        if (!alreadySent) {
          const meRecipients = await getMERecipients();
          if (meRecipients.length) {
            const [programName, participantName] = await Promise.all([
              getProgramName(after.programId || null),
              getParticipantName(after.participantId || null),
            ]);
            const email = buildDevPlanEditRequestCreatedEmail({
              requesterName: safeStr(after.requesterName, "Requester"),
              requesterDeptName: safeStr(after.requesterDeptName, "Department"),
              participantName: safeStr(participantName, "SME"),
              programName,
              reason: safeStr(after.reason, ""),
              requestId: reqId,
            });
            await transporter.sendMail({
              from,
              to: from,
              bcc: meRecipients,
              subject: email.subject,
              html: email.html,
              text: email.text,
            });
            await event.data!.after!.ref.set(
              {
                notifications: {
                  editRequestEmail: {
                    created: {
                      sentAt: admin.firestore.FieldValue.serverTimestamp(),
                      to: meRecipients,
                    },
                  },
                },
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            logger.info("onDevPlanEditRequestEmail.created_sent", { reqId, sentTo: meRecipients.length });
          }
        }
      }

      const becameApproved = prevStatus !== "approved" && nextStatus === "approved";
      const becameRejected = prevStatus !== "rejected" && nextStatus === "rejected";
      if (becameApproved || becameRejected) {
        const decision = becameApproved ? "approved" : "rejected";
        const alreadySent = after?.notifications?.editRequestEmail?.[decision]?.sentAt ?? null;
        if (alreadySent) return;
        const to = String(after.requesterEmail || "").trim();
        if (!to || !to.includes("@")) {
          logger.warn("onDevPlanEditRequestEmail.skip_no_requester_email", { reqId, decision });
          return;
        }
        const [programName, participantName] = await Promise.all([
          getProgramName(after.programId || null),
          getParticipantName(after.participantId || null),
        ]);
        const email = buildDevPlanEditRequestDecisionEmail({
          requesterName: safeStr(after.requesterName, "there"),
          participantName: safeStr(participantName, "SME"),
          programName,
          decision: decision as "approved" | "rejected",
          meByName: after.meRespondedByName ? String(after.meRespondedByName) : null,
          meReason: after.meResponseReason ? String(after.meResponseReason) : null,
          requestReason: safeStr(after.reason, ""),
          requestId: reqId,
        });
        await transporter.sendMail({ from, to, subject: email.subject, html: email.html, text: email.text });
        await event.data!.after!.ref.set(
          {
            notifications: {
              editRequestEmail: {
                [decision]: {
                  sentAt: admin.firestore.FieldValue.serverTimestamp(),
                  to,
                },
              },
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        logger.info("onDevPlanEditRequestEmail.decision_sent", { reqId, decision, to });
      }
    } catch (e) {
      logger.error("onDevPlanEditRequestEmail.failed", { err: String(e) });
    }
  }
);

function buildDevPlanEditRequestCreatedEmail(opts: {
  requesterName: string;
  requesterDeptName: string;
  participantName: string;
  programName: string | null;
  reason: string;
  requestId: string;
}) {
  const url = `${APP_BASE_URL.replace(/\/$/, "")}/operations/inquiries`;
  const subject = `Developmental Plan Edit Request: ${opts.participantName}`;
  const html = `
<div style="font-family:Inter,Arial,sans-serif;line-height:1.55;font-size:14px">
<p>Hi M&E,</p>
<p>A department has submitted a <b>Request To Edit</b> for a confirmed Developmental Plan.</p>
<table style="border-collapse:collapse;font-size:14px;margin:10px 0;min-width:340px">
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>SME</b></td><td style="padding:6px 10px;border:1px solid #eee">${opts.participantName}</td></tr>
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Program</b></td><td style="padding:6px 10px;border:1px solid #eee">${safeStr(opts.programName, "—")}</td></tr>
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Requester</b></td><td style="padding:6px 10px;border:1px solid #eee">${opts.requesterName} (${opts.requesterDeptName})</td></tr>
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Reason</b></td><td style="padding:6px 10px;border:1px solid #eee">${(opts.reason || "").replace(/\n/g, "<br/>")}</td></tr>
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Request ID</b></td><td style="padding:6px 10px;border:1px solid #eee">${opts.requestId}</td></tr>
</table>
<p>
Review and respond here:<br/>
<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>
</p>
<p style="margin-top:16px">
Regards,<br/>
<b>Lepharo Smart Inc AI</b>
</p>
</div>
`;
  const text = `M&E: A department submitted a Developmental Plan edit request.
SME: ${opts.participantName}
Program: ${safeStr(opts.programName, "—")}
Requester: ${opts.requesterName} (${opts.requesterDeptName})
Reason: ${opts.reason}
Request ID: ${opts.requestId}
Review: ${url}
`;
  return { subject, html, text };
}

function buildDevPlanEditRequestDecisionEmail(opts: {
  requesterName: string;
  participantName: string;
  programName: string | null;
  decision: "approved" | "rejected";
  meByName: string | null;
  meReason: string | null;
  requestReason: string;
  requestId: string;
}) {
  const url = `${APP_BASE_URL.replace(/\/$/, "")}/operations/plan`;
  const ok = opts.decision === "approved";
  const subject = ok
    ? `Edit Request Approved: ${opts.participantName}`
    : `Edit Request Rejected: ${opts.participantName}`;
  const decisionLine = ok
    ? `M&E approved your request to edit the Developmental Plan.`
    : `M&E rejected your request to edit the Developmental Plan.`;
  const html = `
<div style="font-family:Inter,Arial,sans-serif;line-height:1.55;font-size:14px">
<p>Hi ${opts.requesterName},</p>
<p>${decisionLine}</p>
<table style="border-collapse:collapse;font-size:14px;margin:10px 0;min-width:340px">
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>SME</b></td><td style="padding:6px 10px;border:1px solid #eee">${opts.participantName}</td></tr>
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Program</b></td><td style="padding:6px 10px;border:1px solid #eee">${safeStr(opts.programName, "—")}</td></tr>
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Your request</b></td><td style="padding:6px 10px;border:1px solid #eee">${(opts.requestReason || "").replace(/\n/g, "<br/>")}</td></tr>
${ok ? "" : `<tr><td style="padding:6px 10px;border:1px solid #eee"><b>M&E response</b></td><td style="padding:6px 10px;border:1px solid #eee">${safeStr(opts.meReason, "No reason provided.")}</td></tr>`}
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Responded by</b></td><td style="padding:6px 10px;border:1px solid #eee">${safeStr(opts.meByName, "M&E")}</td></tr>
<tr><td style="padding:6px 10px;border:1px solid #eee"><b>Request ID</b></td><td style="padding:6px 10px;border:1px solid #eee">${opts.requestId}</td></tr>
</table>
<p>
Open the plan here:<br/>
<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>
</p>
<p style="margin-top:16px">
Regards,<br/>
<b>Lepharo Smart Inc AI</b>
</p>
</div>
`;
  const text = `${decisionLine}
SME: ${opts.participantName}
Program: ${safeStr(opts.programName, "—")}
Your request: ${opts.requestReason}
${ok ? "" : `M&E response: ${safeStr(opts.meReason, "No reason provided.")}
`}Responded by: ${safeStr(opts.meByName, "M&E")}
Request ID: ${opts.requestId}
Link: ${url}
`;
  return { subject, html, text };
}

export const sendDevPlanReminders = onRequest({ region: 'us-central1', cors: true }, async (req, res) => {
  try {
    const authHeader = (req.headers.authorization || '').toString();
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) { res.status(401).json({ ok: false, error: 'Missing or invalid auth.' }); return; }
    await admin.auth().verifyIdToken(match[1]);
    const body = (req.body || {}) as { programId?: string | null };
    const result = await runDevPlanReminderOnce('http', { programId: body.programId || null});
    res.status(200).json({
      ok: true,
      sent: result.totalDeptEmails,
      departmentsWithPending: result.departmentsWithPending,
      totalPendingAssignments: result.totalPendingAssignments,
    });
  } catch (err: any) {
    logger.error('sendDevPlanReminders.failed', { message: err?.message, stack: err?.stack });
    res.status(500).json({ ok: false, error: err?.message || 'Failed to send dev plan reminders.' });
  }
});

export const devPlanReminderCron = onSchedule(
  {
    region: 'us-central1',
    schedule: '0 9 * * *',
    timeZone: 'Africa/Johannesburg',
  },
  async () => {
    try {
      await runDevPlanReminderOnce('cron', {});
    } catch (err) {
      logger.error('devPlanReminderCron.failed', { error: String(err) });
    }
  }
);
