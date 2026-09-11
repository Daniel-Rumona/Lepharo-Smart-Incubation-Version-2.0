type Delivery = "in_person" | "telephonically" | "virtual";
type ApptDoc = {
    consultantId: string;
    consultantName: string;
    participantId: string;
    participantName: string;
    departmentId?: string;
    interventionId: string;
    interventionTitle: string;
    deliveryMethod: Delivery;
    date: string; // "YYYY-MM-DD"
    startTime: FirebaseFirestore.Timestamp | Date;
    endTime: FirebaseFirestore.Timestamp | Date;
    meetingLink?: string;
    location?: string;
    status: "scheduled" | "completed" | "cancelled" | "pending";
    userConfirmation: "pending" | "confirmed" | "declined";
    createdAt: FirebaseFirestore.Timestamp;
    programId?: string;
};

// ── Email helpers ─────────────────────────────────────────────────────────────
function titleCase(s: string) {
    return s
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

function toDate(v: any): Date | null {
    try {
        // Firestore Timestamp?
        if (v?.toDate && typeof v.toDate === "function") return v.toDate();
        // JS Date?
        if (v instanceof Date) return v;
        return null;
    } catch {
        return null;
    }
}

function formatWhere(a: ApptDoc, participantPhone?: string) {
    if (a.deliveryMethod === "virtual" && a.meetingLink)
        return `Virtual • Link: ${a.meetingLink}`;
    if (a.deliveryMethod === "in_person" && a.location)
        return `In person • Location: ${a.location}`;
    if (a.deliveryMethod === "telephonically")
        return `Telephonic • ${participantPhone ? `We’ll call: ${participantPhone}` : "We’ll call you"}`;
    return "—";
}

export function roleDisplayName(backendRole: string) {
    const map: Record<string, string> = {
        projectadmin: "Center Coordinator",
    };
    return map[backendRole] ?? titleCase(backendRole);
}

function buildPreheader(text: string) {
    return `
    <div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">
      ${text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}
    </div>`;
}

function buildButton(href: string, label: string) {
    return `
    <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" style="height:44px;v-text-anchor:middle;width:260px;" arcsize="10%" stroke="f" fillcolor="#0ea5e9">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;">
          ${label}
        </center>
      </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <a href="${href}" target="_blank"
       style="display:inline-block;background:#0ea5e9;color:#fff;font-weight:700;text-decoration:none;
              padding:12px 22px;border-radius:8px;line-height:20px;">
       ${label}
    </a>
    <!--<![endif]-->`;
}

/** UPDATED: now accepts departmentName, and renders Role · Department when available.
 *  Also includes a signature image via CID: letterSig
 */
export function buildWelcomeEmail(opts: {
    name: string;
    loginUrl: string;
    roleDisplay: string;        // already computed including dept suffix if any
    departmentName?: string | null;
}) {
    const { name, loginUrl, roleDisplay } = opts;

    const ctaUrl = loginUrl;
    const preheader = `Your ${roleDisplay} account for Lepharo Smart Incubation System is ready. Sign in to get started.`;

    const html = `
    ${buildPreheader(preheader)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0"
                 style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:24px 24px 0 24px;background:#0ea5e9;">
                <h1 style="margin:0;color:#ffffff;font-family:Inter,Arial,Helvetica,sans-serif;font-size:20px;line-height:28px;">
                  Lepharo Smart Incubation System
                </h1>
                <p style="margin:8px 0 0 0;color:#eaf6fe;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;">
                  Welcome aboard — your access is set up.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 12px 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:16px;color:#111827;">
                  Hi ${name || "there"},
                </p>
                <p style="margin:0 0 6px 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;color:#374151;line-height:22px;">
                  Your <strong>${roleDisplay}</strong> account for <strong>Lepharo Smart Incubation System</strong> has been created.
                </p>
                <p style="margin:0 0 16px 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;color:#374151;line-height:22px;">
                  <strong>Default password:</strong> Password@1
                </p>
                <p style="margin:0 0 16px 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;color:#374151;line-height:22px;">
                  Please sign in below. You’ll be required to reset your password on first login.
                </p>

                <div style="margin:16px 0 24px 0;">
                  ${buildButton(ctaUrl, "Sign In")}
                </div>

                <p style="margin:16px 0 0 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;">
                  If the button above doesn’t work, copy and paste this link in your browser:<br>
                  <a href="${ctaUrl}" style="color:#0ea5e9;text-decoration:underline;word-break:break-all;">${ctaUrl}</a>
                </p>

                <!-- Signature -->
                <div style="margin:24px 0 0 0;">
                  <p style="margin:0 0 8px 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;color:#111827;">
                    Regards,<br/>Lepharo Team
                  </p>
                  <img src="cid:letterSig" alt="Lepharo Signature"
                       style="display:block;max-width:240px;height:auto;border:none;outline:none;text-decoration:none;">
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#fafafa;">
                <p style="margin:0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;line-height:18px;">
                  Need help? Reply to this email or contact your program administrator.<br>
                  © ${new Date().getFullYear()} Lepharo. All rights reserved.
                </p>
              </td>
            </tr>
          </table>

          <p style="margin:12px 0 0 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:11px;color:#9ca3af;">
            You received this because an account was created for you on the Lepharo Smart Incubation System.
          </p>
        </td>
      </tr>
    </table>`;

    const text = [
        `Lepharo Smart Incubation System`,
        ``,
        `Hi ${name || "there"},`,
        `Your ${roleDisplay} account for Lepharo Smart Incubation System has been created.`,
        `Default password: Password@1`,
        ``,
        `Please sign in. You’ll be prompted to reset your password on first login.`,
        ``,
        `Sign in: ${ctaUrl}`,
    ].join("\n");

    return { html, text, subject: `Welcome — ${roleDisplay} access for Lepharo Smart Incubation System` };
}

// ── Application decision email templates ─────────────────────────────────────
export function buildAcceptanceEmail(opts: {
    name: string;
    programName?: string | null;
    loginUrl?: string;
}) {
    const toName = opts.name || "Applicant";
    const ctaUrl = opts.loginUrl || (process.env.APP_LOGIN_URL || "https://lepharosmartinc.co.za/login");
    const subject = "Congratulations – Acceptance into the Incubation Programme";

    const html = `
      ${buildPreheader("Your application was successful. Welcome to the programme.")}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;padding:24px 0;">
        <tr><td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr><td style="padding:24px;background:#0ea5e9;color:#fff;font-family:Inter,Arial">
              <h2 style="margin:0">Incubation Programme — Acceptance</h2>
            </td></tr>
            <tr><td style="padding:24px;font-family:Inter,Arial;color:#111">
              <p>Dear ${toName},</p>
              <p>Congratulations! We are pleased to inform you that your application to the Incubation Programme${opts.programName ? ` (<b>${opts.programName}</b>)` : ""} has been successful.</p>
              <p>Your business has been selected based on its potential for growth, innovation, and impact. We’re excited to welcome you into our network of entrepreneurs.</p>
              <p>Our team will be in touch shortly with the next steps, including onboarding details, key dates, and programme requirements.</p>
              <div style="margin:20px 0;">${buildButton(ctaUrl, "Start Onboarding")}</div>
              <p>Warm regards,<br/><b>ROM Team</b><br/>Lepharo<br/>Mel Mosime · +27 828243309</p>
            </td></tr>
          </table>
          <p style="margin:12px 0 0 0;font-family:Inter,Arial;color:#9ca3af;font-size:11px">You’re receiving this because your application was accepted.</p>
        </td></tr>
      </table>`;

    const text =
        `Dear ${toName},\n\n` +
        `Congratulations! Your application to the Incubation Programme${opts.programName ? ` (${opts.programName})` : ""} has been successful.\n\n` +
        `Our team will contact you with onboarding details and key dates.\n\n` +
        `Start Onboarding: ${ctaUrl}\n\n` +
        `Warm regards,\nROM Team\nLepharo\nMel Mosime · +27 828243309\n`;

    return { subject, html, text };
}

export function buildRejectionEmail(opts: { name: string; programName?: string | null }) {
    const toName = opts.name || "Applicant";
    const subject = "Application Outcome – Incubation Programme";

    const html = `
      ${buildPreheader("Thank you for applying. Unfortunately, this intake could not include your business.")}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;padding:24px 0;">
        <tr><td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr><td style="padding:24px;background:#111827;color:#fff;font-family:Inter,Arial">
              <h2 style="margin:0">Incubation Programme — Application Outcome</h2>
            </td></tr>
            <tr><td style="padding:24px;font-family:Inter,Arial;color:#111">
              <p>Dear ${toName},</p>
              <p>Thank you for your interest in our Incubation Programme${opts.programName ? ` (<b>${opts.programName}</b>)` : ""} and for taking the time to submit your application.</p>
              <p>After careful consideration, we regret to inform you that your application was not successful at this time. The selection process was highly competitive.</p>
              <p>We encourage you to continue developing your business and to consider reapplying in future rounds.</p>
              <p>Warm regards,<br/><b>ROM Team</b><br/>Lepharo<br/>Mel Mosime · +27 828243309</p>
            </td></tr>
          </table>
          <p style="margin:12px 0 0 0;font-family:Inter,Arial;color:#9ca3af;font-size:11px">You’re receiving this because you submitted an application to Lepharo.</p>
        </td></tr>
      </table>`;

    const text =
        `Dear ${toName},\n\n` +
        `Thank you for applying to our Incubation Programme${opts.programName ? ` (${opts.programName})` : ""}.\n` +
        `After careful consideration, your application was not successful for this intake.\n` +
        `We encourage you to keep building and reapply in future rounds.\n\n` +
        `Warm regards,\nROM Team\nLepharo\nMel Mosime · +27 828243309\n`;

    return { subject, html, text };
}

export function buildAppointmentEmailHTML(opts: {
    appt: ApptDoc;
    start: Date;
    end: Date;
    participantName: string;
    participantPhone?: string;
    type: "created" | "updated" | "cancelled";
}) {
    const { appt, start, end, participantName, participantPhone, type } = opts;
    const badge =
        type === "created" ? { text: "New Appointment", bg: "#1677ff" } :
            type === "updated" ? { text: "Updated Appointment", bg: "#faad14" } :
                { text: "Cancelled", bg: "#ff4d4f" };

    const when = `${appt.date} • ${start.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })} – ${end.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}`;
    const where = formatWhere(appt, participantPhone);

    return `
    <div style="font-family:Inter,Helvetica,Arial; line-height:1.55; color:#111">
      <div style="display:inline-block;padding:6px 10px;border-radius:8px;color:#fff;background:${badge.bg};font-weight:600">
        ${badge.text}
      </div>
      <p style="margin:16px 0 8px">Hi ${participantName || "there"},</p>
      <p style="margin:0 0 12px">
        ${type === "cancelled"
            ? `Your appointment below has been <b>cancelled</b>.`
            : `An appointment has been ${type === "created" ? "<b>scheduled</b>" : "<b>updated</b>"} for you.`}
      </p>
      <table style="font-size:14px">
        <tr><td style="padding:3px 8px 3px 0"><b>Intervention</b></td><td>${appt.interventionTitle}</td></tr>
        <tr><td style="padding:3px 8px 3px 0"><b>Consultant</b></td><td>${appt.consultantName}</td></tr>
        <tr><td style="padding:3px 8px 3px 0"><b>When</b></td><td>${when}</td></tr>
        <tr><td style="padding:3px 8px 3px 0"><b>Where</b></td><td>${where}</td></tr>
      </table>
      ${type !== "cancelled" ? `
      <p style="margin-top:12px">A calendar invite is attached. Please be ready a few minutes before your time.</p>` : ``}
      <p style="margin-top:12px;color:#555;font-size:12px">Time zone: Africa/Johannesburg</p>
    </div>`;
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function fmtICSDate(d: Date) {
    // YYYYMMDDTHHMMSS (local converted to Z)
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); // to UTC
    return `${z.getUTCFullYear()}${pad2(z.getUTCMonth() + 1)}${pad2(z.getUTCDate())}T${pad2(z.getUTCHours())}${pad2(z.getUTCMinutes())}${pad2(z.getUTCSeconds())}Z`;
}

export function buildICS(opts: {
    uid: string;
    appt: ApptDoc;
    start: Date;
    end: Date;
    organizerEmail?: string;
}) {
    const { uid, appt, start, end, organizerEmail } = opts;
    const summary = `Appointment: ${appt.interventionTitle} with ${appt.consultantName}`;
    const description = `Intervention: ${appt.interventionTitle}\\nConsultant: ${appt.consultantName}\\nDelivery: ${appt.deliveryMethod}${appt.meetingLink ? `\\nLink: ${appt.meetingLink}` : ""}${appt.location ? `\\nLocation: ${appt.location}` : ""}`;
    // Location for ICS
    const loc = appt.deliveryMethod === "virtual"
        ? (appt.meetingLink || "Online")
        : appt.deliveryMethod === "in_person"
            ? (appt.location || "On site")
            : "Phone call";

    return [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Lepharo Smart Inc//Appointments//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${fmtICSDate(new Date())}`,
        `DTSTART:${fmtICSDate(start)}`,
        `DTEND:${fmtICSDate(end)}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        `LOCATION:${loc}`,
        organizerEmail ? `ORGANIZER:mailto:${organizerEmail}` : "",
        "END:VEVENT",
        "END:VCALENDAR",
    ].filter(Boolean).join("\r\n");
}

export function coreChanged(before?: ApptDoc, after?: ApptDoc) {
    if (!before || !after) return false;
    const bS = toDate(before.startTime)?.getTime();
    const aS = toDate(after.startTime)?.getTime();
    const bE = toDate(before.endTime)?.getTime();
    const aE = toDate(after.endTime)?.getTime();
    return (
        before.date !== after.date ||
        bS !== aS ||
        bE !== aE ||
        (before.deliveryMethod || "") !== (after.deliveryMethod || "") ||
        (before.meetingLink || "") !== (after.meetingLink || "") ||
        (before.location || "") !== (after.location || "")
    );
}

// ── SME Development Plan Emails ────────────────────────────────────────────────
// Add these to emailHelpers.ts (same style as your existing templates)

function safe(s: any) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .trim()
}

function progressLine(done?: number, total?: number) {
    if (typeof done === 'number' && typeof total === 'number' && total > 0) {
        return `${done} / ${total} departments submitted`
    }
    return null
}

/**
 * Email A: triggered immediately after a department submits their DP section.
 * Truthful wording: "X department has submitted their part" (NOT "DP is ready")
 */
export function buildSmmeDpSectionSubmittedEmail(opts: {
    name: string
    programName?: string | null
    departmentName: string
    confirmUrl: string

    // Optional: show overall progress
    deptConfirmed?: number
    deptTotal?: number

    // Optional: more context in the email
    interventionCount?: number
}) {
    const toName = safe(opts.name || 'there')
    const deptName = safe(opts.departmentName)
    const programName = safe(opts.programName || '')
    const url = opts.confirmUrl

    const prog = progressLine(opts.deptConfirmed, opts.deptTotal)
    const intvLine =
        typeof opts.interventionCount === 'number'
            ? `${opts.interventionCount} item(s) submitted in this section`
            : null

    const subject = `DP update: ${deptName} submitted their section${programName ? ` (${programName})` : ''}`

    const preheader = `${deptName} has submitted part of your Development Plan. Review it on your Roadmap.`

    const html = `
    ${buildPreheader(preheader)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0"
                 style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:24px 24px 0 24px;background:#0ea5e9;">
                <h1 style="margin:0;color:#ffffff;font-family:Inter,Arial,Helvetica,sans-serif;font-size:20px;line-height:28px;">
                  Development Plan Update
                </h1>
                <p style="margin:8px 0 0 0;color:#eaf6fe;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;">
                  A department has submitted their section for your review.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 10px 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:16px;color:#111827;">
                  Hi ${toName},
                </p>

                <p style="margin:0 0 12px 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;color:#374151;line-height:22px;">
                  <b>${deptName}</b> has submitted their part of your Development Plan.
                </p>

                <div style="margin:12px 0 14px 0;padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;">
                  <p style="margin:0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:13px;color:#111827;line-height:20px;">
                    <b>Department:</b> ${deptName}<br/>
                    <b>Company:</b> Lepharo <br/>
                    ${programName ? `<b>Programme:</b> ${programName}<br/>` : ``}
                    ${intvLine ? `<b>This submission:</b> ${safe(intvLine)}<br/>` : ``}
                    ${prog ? `<b>Overall progress:</b> ${safe(prog)}` : `<b>Overall progress:</b> In progress`}
                  </p>
                </div>

                <p style="margin:0 0 14px 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;color:#374151;line-height:22px;">
                  Please review this department’s section on your Roadmap.
                </p>

                <div style="margin:16px 0 18px 0;">
                  ${buildButton(url, `Review ${deptName} section`)}
                </div>

                <p style="margin:0 0 8px 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;">
                  If the button doesn’t work, copy and paste this link:
                </p>
                <p style="margin:0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;">
                  <a href="${url}" style="color:#0ea5e9;text-decoration:underline;word-break:break-all;">${url}</a>
                </p>

                <p style="margin:18px 0 0 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;line-height:18px;">
                  Time zone: Africa/Johannesburg
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#fafafa;">
                <p style="margin:0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;line-height:18px;">
                  You received this because a department submitted a section of your Development Plan.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    `

    const text = [
        `Development Plan Update`,
        ``,
        `Hi ${opts.name || 'there'},`,
        `${opts.departmentName} has submitted their part of your Development Plan.`,
        `Company: Lepharo`,
        programName ? `Programme: ${opts.programName}` : '',
        prog ? `Overall progress: ${prog}` : '',
        intvLine ? `This submission: ${intvLine}` : '',
        ``,
        `Review here: ${url}`
    ]
        .filter(Boolean)
        .join('\n')

    return { subject, html, text }
}

/**
 * Email B: manual reminder ("Remind SME" button).
 * Truthful wording: "Reminder from X department" + progress.
 */
export function buildSmmeDpReminderEmail(opts: {
    name: string
    programName?: string | null

    // who is sending the reminder
    reminderFromDeptName: string

    confirmUrl: string

    // Optional progress
    deptConfirmed?: number
    deptTotal?: number

    // Optional: specify what they should do
    reminderType?: 'section_pending' | 'final_confirmation_pending' | 'review_pending'
}) {
    const toName = safe(opts.name || 'there')
    const fromDept = safe(opts.reminderFromDeptName)
    const programName = safe(opts.programName || '')
    const url = opts.confirmUrl

    const prog = progressLine(opts.deptConfirmed, opts.deptTotal)

    const actionLine =
        opts.reminderType === 'final_confirmation_pending'
            ? 'All departments have submitted. Please complete your final confirmation.'
            : 'Please review the submitted section(s) and confirm where required.'

    const subject = `Reminder from ${fromDept}: Please review your Development Plan${programName ? ` (${programName})` : ''}`

    const preheader = `${fromDept} is reminding you to review your Development Plan submissions.`

    const html = `
    ${buildPreheader(preheader)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0"
                 style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:24px 24px 0 24px;background:#111827;">
                <h1 style="margin:0;color:#ffffff;font-family:Inter,Arial,Helvetica,sans-serif;font-size:20px;line-height:28px;">
                  Reminder: Development Plan Review
                </h1>
                <p style="margin:8px 0 0 0;color:#e5e7eb;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;">
                  A department is waiting for your action.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 10px 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:16px;color:#111827;">
                  Hi ${toName},
                </p>

                <p style="margin:0 0 12px 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;color:#374151;line-height:22px;">
                  <b>${fromDept}</b> is reminding you to take action on your Development Plan.
                </p>

                <div style="margin:12px 0 14px 0;padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;">
                  <p style="margin:0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:13px;color:#111827;line-height:20px;">
                    <b>Reminder from:</b> ${fromDept}<br/>
                    <b>Company:</b> Lepharo Smart Incubation System <br/>
                    ${programName ? `<b>Programme:</b> ${programName}<br/>` : ``}
                    ${prog ? `<b>Overall progress:</b> ${safe(prog)}<br/>` : ``}
                    <b>Next step:</b> ${safe(actionLine)}
                  </p>
                </div>

                <p style="margin:0 0 14px 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;color:#374151;line-height:22px;">
                  Click below to open your Roadmap and review what’s pending.
                </p>

                <div style="margin:16px 0 18px 0;">
                  ${buildButton(url, 'Open Roadmap')}
                </div>

                <p style="margin:0 0 8px 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;">
                  If the button doesn’t work, copy and paste this link:
                </p>
                <p style="margin:0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;">
                  <a href="${url}" style="color:#0ea5e9;text-decoration:underline;word-break:break-all;">${url}</a>
                </p>

                <p style="margin:18px 0 0 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;line-height:18px;">
                  Time zone: Africa/Johannesburg
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#fafafa;">
                <p style="margin:0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;line-height:18px;">
                  You received this reminder because your Development Plan has pending review/confirmation.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    `

    const text = [
        `Reminder: Development Plan Review`,
        ``,
        `Hi ${opts.name || 'there'},`,
        `${opts.reminderFromDeptName} is reminding you to take action on your Development Plan.`,
        `Company: Lepharo`,
        programName ? `Programme: ${opts.programName}` : '',
        prog ? `Overall progress: ${prog}` : '',
        `Next step: ${actionLine}`,
        ``,
        `Open Roadmap: ${url}`
    ]
        .filter(Boolean)
        .join('\n')

    return { subject, html, text }
}
