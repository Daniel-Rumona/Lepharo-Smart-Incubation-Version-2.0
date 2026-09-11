import * as admin from 'firebase-admin'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { sendEmail } from './mail/mailer'
import { logBrevoSend, sendViaBrevo } from './brevoClient'

if (!admin.apps.length) admin.initializeApp()
const db = admin.firestore()

type EmailType =
  | 'WELCOME'
  | 'ACCOUNT_CREATION'
  | 'APPLICATION_RECEIVED'
  | 'APPLICATION_ACCEPTED'
  | 'APPLICATION_REJECTED'
  | 'SYSTEM_OUTAGE'
  | 'SYSTEM_UPGRADE'
  | 'SYSTEM_RESOLVED'
  | 'CUSTOM'

type CampaignStatus = 'draft' | 'queued' | 'sending' | 'completed' | 'cancelled' | 'failed'
type RecipientType = 'users' | 'applications' | 'participants' | 'manual'

type MailCampaignDoc = {
  programId?: string | null
  name: string
  emailType: EmailType
  recipientType: RecipientType
  subjectOverride?: string | null
  payload: Record<string, any>
  custom?: { subject?: string | null; html?: string | null; text?: string | null } | null
  status: CampaignStatus
  createdBy: { uid: string; email?: string | null; name?: string | null }
  createdAt: any
  updatedAt: any
  totalRecipients?: number
  sentCount?: number
  failCount?: number
  throttleMs?: number
  systemNotice?: {
    kind: SystemNoticeKind
    message: string
    startsAt?: string | null
    endsAt?: string | null
  } | null
  copyRecipients?: string[]
}

type SystemNoticeKind = 'outage' | 'upgrade' | 'resolved'

type RecipientRow = {
  email: string
  name?: string | null
  status?: 'pending' | 'sent' | 'failed' | 'skipped'
  lastError?: string | null
  sentAt?: FirebaseFirestore.Timestamp | null
}

type AccountCreationTarget = {
  id: string
  ref?: FirebaseFirestore.DocumentReference
  data: any
  email: string
}

type MailLogRow = {
  campaignId: string
  emailType: EmailType
  to: string
  subject: string
  status: 'sent' | 'failed' | 'skipped'
  error?: string | null
  createdAt: any
}

// -------------------- Templates --------------------
function basicShell(title: string, bodyHtml: string) {
  return `
  <div style="font-family:Arial,sans-serif;background:#f6f7fb;padding:24px">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #eee">
      <div style="padding:18px 22px;background:#111827;color:#fff">
        <div style="font-size:16px;font-weight:700">${title}</div>
      </div>
      <div style="padding:22px;color:#111827;line-height:1.6">
        ${bodyHtml}
      </div>
      <div style="padding:14px 22px;color:#6b7280;font-size:12px;border-top:1px solid #eee">
        This email was sent by Smart Incubator.
      </div>
    </div>
  </div>`
}

function escapeHtml(value: any) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatNoticeDate(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Johannesburg'
  }).format(date)
}

const SYSTEM_NOTICE_CONFIG: Record<SystemNoticeKind, { title: string; subject: string; accent: string; label: string }> = {
  outage: {
    title: 'System service interruption',
    subject: 'Important: Smart Incubation is currently unavailable',
    accent: '#b91c1c',
    label: 'Service interruption'
  },
  upgrade: {
    title: 'Planned system upgrade',
    subject: 'Scheduled Smart Incubation upgrade notice',
    accent: '#b45309',
    label: 'Planned upgrade'
  },
  resolved: {
    title: 'System service restored',
    subject: 'Smart Incubation is fully operational',
    accent: '#15803d',
    label: 'Resolved'
  }
}

function buildSystemNoticeEmail(args: {
  kind: SystemNoticeKind
  name?: string | null
  message: string
  startsAt?: string | null
  endsAt?: string | null
  subjectOverride?: string | null
}) {
  const config = SYSTEM_NOTICE_CONFIG[args.kind]
  const greetingName = escapeHtml(args.name || 'there')
  const messageHtml = escapeHtml(args.message).replace(/\r?\n/g, '<br/>')
  const startsAt = formatNoticeDate(args.startsAt)
  const endsAt = formatNoticeDate(args.endsAt)
  const windowRows = [
    startsAt ? `<div><strong>Starts:</strong> ${escapeHtml(startsAt)} (SAST)</div>` : '',
    endsAt ? `<div><strong>Expected completion:</strong> ${escapeHtml(endsAt)} (SAST)</div>` : ''
  ].filter(Boolean).join('')
  const actionUrl = `${(process.env.APP_BASE_URL || 'https://lepharosmartinc.co.za').replace(/\/$/, '')}/login`
  const subject = args.subjectOverride || config.subject
  const html = basicShell(
    config.title,
    `
      <p>Hi ${greetingName},</p>
      <div style="border-left:4px solid ${config.accent};background:#f8fafc;padding:14px 16px;margin:16px 0">
        <div style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${config.accent};margin-bottom:8px">${config.label}</div>
        <div>${messageHtml}</div>
        ${windowRows ? `<div style="margin-top:12px">${windowRows}</div>` : ''}
      </div>
      ${args.kind === 'resolved' ? `<p><a href="${actionUrl}" style="display:inline-block;padding:10px 14px;background:${config.accent};color:#fff;border-radius:8px;text-decoration:none">Open Smart Incubation</a></p>` : ''}
      <p>${args.kind === 'resolved' ? 'Thank you for your patience while we completed this work.' : 'We apologise for any inconvenience and appreciate your patience.'}</p>
      <p>Regards,<br/>Lepharo Smart Incubation System</p>
    `
  )
  const timing = [
    startsAt ? `Starts: ${startsAt} (SAST)` : '',
    endsAt ? `Expected completion: ${endsAt} (SAST)` : ''
  ].filter(Boolean).join('\n')
  const text = `Hi ${args.name || 'there'},\n\n${args.message}${timing ? `\n\n${timing}` : ''}${args.kind === 'resolved' ? `\n\nOpen Smart Incubation: ${actionUrl}` : ''}\n\nRegards,\nLepharo Smart Incubation System`
  return { subject, html, text }
}

function buildWelcomeEmail(args: { name?: string | null; loginUrl: string }) {
  const subject = 'Welcome to Smart Incubator'
  const html = basicShell(
    'Welcome',
    `
    <p>Hi ${args.name || 'there'},</p>
    <p>Your account has been created. You can log in using the link below:</p>
    <p><a href="${args.loginUrl}" style="display:inline-block;padding:10px 14px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none">Log in</a></p>
    <p>If you did not request this, please ignore this email.</p>
  `
  )
  const text = `Hi ${args.name || 'there'},\n\nYour account has been created.\nLogin: ${args.loginUrl}\n`
  return { subject, html, text }
}

function buildAccountCreationEmail(args: { name?: string | null; loginUrl: string }) {
  const subject = 'Welcome to Lepharo Smart Incubation'
  const html = basicShell(
    'Account created',
    `
    <p>Hi ${args.name || 'there'},</p>
    <p>Your account has been successfully created for the <b>Lepharo Smart Incubation System</b>.</p>
    <p>A temporary password has been generated for your account: <b>Password@1</b></p>
    <p>To access your account, please sign in <a href="${args.loginUrl}">here</a> using your email address and this temporary password.</p>
    <p><strong>Important:</strong> Please use the "Sign In" option, not "Create Account", as your account has already been set up.</p>
    <p>You will be required to change your password immediately after your first login for security purposes.</p>
  `
  )
  const text =
    `Hi ${args.name || 'there'},\n\n` +
    `Your account has been successfully created for the Lepharo Smart Incubation System.\n\n` +
    `A temporary password has been generated for your account: Password@1\n\n` +
    `To access your account, please sign in here: ${args.loginUrl}\n` +
    `Use your email address and the temporary password to sign in.\n\n` +
    `Important: Please use the "Sign In" option, not "Create Account", as your account has already been set up.\n\n` +
    `You will be required to change your password immediately after your first login for security purposes.\n`
  return { subject, html, text }
}

function buildApplicationReceivedEmail(args: { name?: string | null; programName?: string | null }) {
  const subject = 'We received your application'
  const html = basicShell(
    'Application received',
    `
    <p>Hi ${args.name || 'there'},</p>
    <p>We’ve received your application${args.programName ? ` for <b>${args.programName}</b>` : ''}.</p>
    <p>You’ll be notified when the review is completed.</p>
  `
  )
  const text = `Hi ${args.name || 'there'},\n\nWe’ve received your application${args.programName ? ` for ${args.programName}` : ''}.\n`
  return { subject, html, text }
}

function buildApplicationAcceptedEmail(args: { name?: string | null; programName?: string | null; loginUrl?: string | null }) {
  const subject = 'Application accepted'
  const html = basicShell(
    'Accepted 🎉',
    `
    <p>Hi ${args.name || 'there'},</p>
    <p>Congratulations — your application${args.programName ? ` for <b>${args.programName}</b>` : ''} has been accepted.</p>
    ${
      args.loginUrl
        ? `<p><a href="${args.loginUrl}" style="display:inline-block;padding:10px 14px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none">Continue</a></p>`
        : ''
    }
  `
  )
  const text = `Hi ${args.name || 'there'},\n\nYour application has been accepted.${args.programName ? ` Program: ${args.programName}` : ''}\n${args.loginUrl ? `Continue: ${args.loginUrl}` : ''}`
  return { subject, html, text }
}

function buildApplicationRejectedEmail(args: { name?: string | null; programName?: string | null; reason?: string | null }) {
  const subject = 'Application update'
  const html = basicShell(
    'Application update',
    `
    <p>Hi ${args.name || 'there'},</p>
    <p>Thank you for applying${args.programName ? ` to <b>${args.programName}</b>` : ''}. Unfortunately, your application was not successful this time.</p>
    ${args.reason ? `<p><b>Reason:</b> ${args.reason}</p>` : ''}
  `
  )
  const text = `Hi ${args.name || 'there'},\n\nThank you for applying.${args.programName ? ` Program: ${args.programName}` : ''}\nUnfortunately, not successful this time.\n${args.reason ? `Reason: ${args.reason}\n` : ''}`
  return { subject, html, text }
}

function resolveTemplate(campaign: MailCampaignDoc, recipient: RecipientRow) {
  const p = campaign.payload || {}
  const name = recipient.name || null

  switch (campaign.emailType) {
    case 'WELCOME': {
      const tpl = buildWelcomeEmail({ name, loginUrl: p.loginUrl || '' })
      return { subject: campaign.subjectOverride || tpl.subject, html: tpl.html, text: tpl.text }
    }
    case 'ACCOUNT_CREATION': {
      const tpl = buildAccountCreationEmail({ name, loginUrl: p.loginUrl || process.env.APP_LOGIN_URL || 'https://lepharosmartinc.co.za/login' })
      return { subject: campaign.subjectOverride || tpl.subject, html: tpl.html, text: tpl.text }
    }
    case 'APPLICATION_RECEIVED': {
      const tpl = buildApplicationReceivedEmail({ name, programName: p.programName || null })
      return { subject: campaign.subjectOverride || tpl.subject, html: tpl.html, text: tpl.text }
    }
    case 'APPLICATION_ACCEPTED': {
      const tpl = buildApplicationAcceptedEmail({ name, programName: p.programName || null, loginUrl: p.loginUrl || null })
      return { subject: campaign.subjectOverride || tpl.subject, html: tpl.html, text: tpl.text }
    }
    case 'APPLICATION_REJECTED': {
      const tpl = buildApplicationRejectedEmail({ name, programName: p.programName || null, reason: p.reason || null })
      return { subject: campaign.subjectOverride || tpl.subject, html: tpl.html, text: tpl.text }
    }
    case 'SYSTEM_OUTAGE':
    case 'SYSTEM_UPGRADE':
    case 'SYSTEM_RESOLVED': {
      const kind: SystemNoticeKind = campaign.emailType === 'SYSTEM_OUTAGE'
        ? 'outage'
        : campaign.emailType === 'SYSTEM_UPGRADE'
          ? 'upgrade'
          : 'resolved'
      const notice = campaign.systemNotice
      return buildSystemNoticeEmail({
        kind,
        name,
        message: notice?.message || '',
        startsAt: notice?.startsAt || null,
        endsAt: notice?.endsAt || null,
        subjectOverride: campaign.subjectOverride || null
      })
    }
    case 'CUSTOM':
    default: {
      const subj = campaign.custom?.subject || campaign.subjectOverride || 'Message'
      return { subject: subj, html: campaign.custom?.html || '', text: campaign.custom?.text || '' }
    }
  }
}

function assertCampaignValid(c: MailCampaignDoc) {
  if (!c.name) throw new Error('name missing')
  if (!c.emailType) throw new Error('emailType missing')
  if (!c.recipientType) throw new Error('recipientType missing')
  if (!c.status) throw new Error('status missing')

  const p = c.payload || {}
  if (c.emailType === 'WELCOME' && !p.loginUrl) throw new Error('WELCOME requires payload.loginUrl')

  if (c.emailType === 'CUSTOM') {
    const ok = (c.custom?.html && c.custom?.subject) || c.subjectOverride
    if (!ok) throw new Error('CUSTOM requires custom.subject + custom.html (or subjectOverride at least)')
  }
}

const ACCOUNT_CREATION_LOGIN_URL = process.env.APP_LOGIN_URL || 'https://lepharosmartinc.co.za/login'
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ADMIN_EMAIL_ROLES = new Set(['admin', 'system_admin', 'system admin', 'superadmin', 'director'])
const SYSTEM_BROADCAST_EXCLUDED_DOMAIN = '@quantilytix.co.za'
const SYSTEM_BROADCAST_COPY_RECIPIENTS = ['helperzhou@gmail.com', 'admin@quantilytix.com']
const CALLABLE_CORS = [
  'http://localhost:5173',
  'https://lepharosmartinc.co.za',
  'https://www.lepharosmartinc.co.za'
]

function safeLower(value: any) {
  return String(value || '').trim().toLowerCase()
}

function parseEmailInputs(...values: any[]) {
  const emails = values.flatMap((value) => {
    if (Array.isArray(value)) return value
    return String(value || '').split(/[\s,;]+/)
  })
  return [...new Set(emails.map(safeLower).filter(Boolean))]
}

function maskSecret(value?: string | null) {
  if (!value) return null
  if (value.length <= 4) return '****'
  return `${value.slice(0, 2)}****${value.slice(-2)}`
}

function timestampToDate(value: any): Date | null {
  if (!value) return null
  if (value instanceof admin.firestore.Timestamp) return value.toDate()
  if (typeof value?.toDate === 'function') return value.toDate()
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function toAccountCreationTargets(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  manualTargets: Map<string, AccountCreationTarget>,
  max: number
) {
  return [
    ...docs.map((docSnap) => ({
      id: docSnap.id,
      ref: docSnap.ref,
      data: docSnap.data(),
      email: safeLower(docSnap.data()?.email)
    })),
    ...manualTargets.values()
  ].slice(0, max)
}

async function requireEmailAdmin(req: any) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login required.')
  const userSnap = await db.collection('users').doc(req.auth.uid).get()
  const role = safeLower(userSnap.data()?.role || req.auth.token?.role)
  const hasAdminClaim = !!req.auth.token?.admin
  if (!hasAdminClaim && !ADMIN_EMAIL_ROLES.has(role)) {
    throw new HttpsError('permission-denied', 'Only system administrators can manage email delivery.')
  }
  return {
    uid: req.auth.uid,
    email: req.auth.token?.email || userSnap.data()?.email || null,
    role,
    hasAdminClaim
  }
}

async function writeEmailLog(input: {
  type: string
  to: string
  subject: string
  status: 'sent' | 'failed' | 'skipped'
  error?: string | null
  userId?: string | null
  createdBy?: any
  campaignId?: string | null
}) {
  await db.collection('emailLogs').add({
    ...input,
    to: safeLower(input.to),
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  })
}

async function markUserEmailStatus(
  userRef: FirebaseFirestore.DocumentReference,
  status: 'ok' | 'bounced' | 'skipped',
  error?: string | null
) {
  const patch: Record<string, any> = {
    emailDeliveryStatus: status,
    emailDeliveryUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
  }
  if (status === 'bounced') {
    patch.emailBounced = true
    patch.emailBounceReason = error || 'Email send failed'
    patch.emailBouncedAt = admin.firestore.FieldValue.serverTimestamp()
  }
  if (status === 'ok') {
    patch.emailBounced = false
    patch.emailBounceReason = null
    patch.emailLastDeliveredAt = admin.firestore.FieldValue.serverTimestamp()
    patch.lastAccountCreationEmailAt = admin.firestore.FieldValue.serverTimestamp()
  }
  if (status === 'skipped') {
    patch.emailBounceReason = error || null
  }
  await userRef.set(patch, { merge: true })
}

async function collectUsersForAccountCreation(input: {
  userIds?: string[]
  emails?: any
  emailList?: any
  emailsText?: any
  roles?: string[]
  createdFrom?: string | null
  createdTo?: string | null
  limit?: number
}) {
  const max = Math.min(Math.max(Number(input.limit || 250), 1), 500)
  const seen = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>()
  const manualTargets = new Map<string, AccountCreationTarget>()
  const inputEmails = parseEmailInputs(input.emails, input.emailList, input.emailsText).slice(0, max)

  if (inputEmails.length) {
    for (let i = 0; i < inputEmails.length; i += 10) {
      const batch = inputEmails.slice(i, i + 10)
      const snap = await db.collection('users').where('email', 'in', batch).get()
      snap.docs.forEach((docSnap) => seen.set(docSnap.id, docSnap))
    }

    const matchedEmails = new Set([...seen.values()].map((docSnap) => safeLower(docSnap.data()?.email)))
    inputEmails
      .filter((email) => !matchedEmails.has(email))
      .forEach((email) =>
        manualTargets.set(`manual:${email}`, {
          id: `manual:${email}`,
          data: { email },
          email
        })
      )
  }

  if (Array.isArray(input.userIds) && input.userIds.length) {
    for (let i = 0; i < input.userIds.length; i += 10) {
      const ids = input.userIds.slice(i, i + 10).filter(Boolean)
      if (!ids.length) continue
      const snap = await db.collection('users').where(admin.firestore.FieldPath.documentId(), 'in', ids).get()
      snap.docs.forEach((docSnap) => seen.set(docSnap.id, docSnap))
    }
    return toAccountCreationTargets([...seen.values()], manualTargets, max)
  }

  if (Array.isArray(input.roles) && input.roles.length) {
    const roles = new Set(input.roles.map(safeLower).filter(Boolean))
    let q: FirebaseFirestore.Query = db.collection('users')
    const snap = await q.limit(1000).get()
    snap.docs
      .filter((docSnap) => roles.has(safeLower(docSnap.data()?.role)))
      .forEach((docSnap) => seen.set(docSnap.id, docSnap))

    return toAccountCreationTargets([...seen.values()], manualTargets, max)
  }

  if (!input.createdFrom || !input.createdTo) {
    if (manualTargets.size || seen.size) return toAccountCreationTargets([...seen.values()], manualTargets, max)
    throw new HttpsError('invalid-argument', 'Select users, choose roles, paste emails, or provide a creation date range.')
  }

  const from = new Date(`${input.createdFrom}T00:00:00.000Z`)
  const to = new Date(`${input.createdTo}T23:59:59.999Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new HttpsError('invalid-argument', 'Invalid creation date range.')
  }

  let q: FirebaseFirestore.Query = db.collection('users')
  const snap = await q.limit(1000).get()
  const dateTargets = snap.docs
    .filter((docSnap) => {
      const createdAt = timestampToDate(docSnap.data()?.createdAt)
      return !!createdAt && createdAt >= from && createdAt <= to
    })
    .map((docSnap) => ({
      id: docSnap.id,
      ref: docSnap.ref,
      data: docSnap.data(),
      email: safeLower(docSnap.data()?.email)
    }))

  return [...dateTargets, ...manualTargets.values()].slice(0, max)
}

// ✅ V2 Firestore trigger (fixes your red typing errors)
export const onMailCampaignQueued = onDocumentWritten(
  {
    region: 'us-central1',
    document: 'mailCampaigns/{campaignId}',
    timeoutSeconds: 540,
    memory: '512MiB'
  },
  async (event) => {
    const after = event.data?.after?.exists ? (event.data.after.data() as MailCampaignDoc) : null
    const before = event.data?.before?.exists ? (event.data.before.data() as MailCampaignDoc) : null
    const campaignId = event.params.campaignId as string

    if (!after) return
    if (after.status !== 'queued') return
    if (before?.status === 'queued') return

    const campaignRef = db.collection('mailCampaigns').doc(campaignId)

    try {
      assertCampaignValid(after)

      await campaignRef.set(
        { status: 'sending', updatedAt: admin.firestore.FieldValue.serverTimestamp(), sentCount: 0, failCount: 0 },
        { merge: true }
      )

      const recipientsSnap = await campaignRef.collection('recipients').get()
      await campaignRef.set(
        { totalRecipients: recipientsSnap.size, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      )

      let sent = 0
      let failed = 0
      const throttle = Number(after.throttleMs || 0)

      for (const docSnap of recipientsSnap.docs) {
        const r = docSnap.data() as RecipientRow
        const to = (r.email || '').trim().toLowerCase()

        if (!to) {
          failed++
          await docSnap.ref.set({ status: 'failed', lastError: 'Missing email' }, { merge: true })
          await campaignRef.collection('mailLogs').add({
            campaignId,
            emailType: after.emailType,
            to: '(missing)',
            subject: '(skipped)',
            status: 'failed',
            error: 'Missing email',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          } satisfies MailLogRow)
          await writeEmailLog({
            type: `CAMPAIGN_${after.emailType}`,
            campaignId,
            to: '(missing)',
            subject: '(skipped)',
            status: 'failed',
            error: 'Missing email',
            createdBy: after.createdBy
          })
          continue
        }

        try {
          const tpl = resolveTemplate(after, r)
          await sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text })

          sent++
          await docSnap.ref.set({ status: 'sent', lastError: null, sentAt: admin.firestore.Timestamp.now() }, { merge: true })
          await campaignRef.collection('mailLogs').add({
            campaignId,
            emailType: after.emailType,
            to,
            subject: tpl.subject,
            status: 'sent',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          } satisfies MailLogRow)
          await writeEmailLog({
            type: `CAMPAIGN_${after.emailType}`,
            campaignId,
            to,
            subject: tpl.subject,
            status: 'sent',
            createdBy: after.createdBy
          })
        } catch (err: any) {
          failed++
          const msg = String(err?.message || err)
          await docSnap.ref.set({ status: 'failed', lastError: msg }, { merge: true })
          await campaignRef.collection('mailLogs').add({
            campaignId,
            emailType: after.emailType,
            to,
            subject: after.subjectOverride || after.custom?.subject || '(template)',
            status: 'failed',
            error: msg,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          } satisfies MailLogRow)
          await writeEmailLog({
            type: `CAMPAIGN_${after.emailType}`,
            campaignId,
            to,
            subject: after.subjectOverride || after.custom?.subject || '(template)',
            status: 'failed',
            error: msg,
            createdBy: after.createdBy
          })
        }

        if (throttle > 0) await new Promise((res) => setTimeout(res, throttle))

        await campaignRef.set(
          { sentCount: sent, failCount: failed, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        )
      }

      const copyRecipients = [...new Set((after.copyRecipients || []).map(safeLower).filter((email) => EMAIL_RX.test(email)))]
      if (after.systemNotice && copyRecipients.length) {
        const copySubject = after.subjectOverride || SYSTEM_NOTICE_CONFIG[after.systemNotice.kind].subject
        try {
          const tpl = resolveTemplate(after, { email: copyRecipients[0], name: 'Smart Incubation team' })
          const copyTo = process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER
          if (!copyTo) throw new Error('Missing MAIL_FROM_EMAIL or SMTP_USER for broadcast copy.')
          await sendEmail({ to: copyTo, cc: copyRecipients, subject: tpl.subject, html: tpl.html, text: tpl.text })
          await campaignRef.collection('mailLogs').add({
            campaignId,
            emailType: after.emailType,
            to: copyRecipients.join(', '),
            subject: copySubject,
            status: 'sent',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          } satisfies MailLogRow)
          await writeEmailLog({
            type: `CAMPAIGN_${after.emailType}_COPY`,
            campaignId,
            to: copyRecipients.join(', '),
            subject: copySubject,
            status: 'sent',
            createdBy: after.createdBy
          })
          await campaignRef.set({ copyStatus: 'sent', copySentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
        } catch (err: any) {
          const error = String(err?.message || err)
          await writeEmailLog({
            type: `CAMPAIGN_${after.emailType}_COPY`,
            campaignId,
            to: copyRecipients.join(', '),
            subject: copySubject,
            status: 'failed',
            error,
            createdBy: after.createdBy
          })
          await campaignRef.set({ copyStatus: 'failed', copyError: error }, { merge: true })
          logger.error('systemStatusBroadcast.copyFailed', { campaignId, error })
        }
      }

      await campaignRef.set(
        { status: 'completed', updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      )
    } catch (err: any) {
      const msg = String(err?.message || err)
      logger.error('mailCampaign.failed', { campaignId, error: msg })
      await campaignRef.set(
        { status: 'failed', updatedAt: admin.firestore.FieldValue.serverTimestamp(), lastError: msg },
        { merge: true }
      )
    }
  }
)

export const queueSystemStatusBroadcast = onCall(
  { region: 'us-central1', cors: CALLABLE_CORS, timeoutSeconds: 120, memory: '512MiB' },
  async (req) => {
    const actor = await requireEmailAdmin(req)
    if (req.data?.confirmation !== 'SEND TO ALL USERS') {
      throw new HttpsError('failed-precondition', 'Confirm that this notice must be sent to all users.')
    }

    const kind = safeLower(req.data?.kind) as SystemNoticeKind
    if (!Object.prototype.hasOwnProperty.call(SYSTEM_NOTICE_CONFIG, kind)) {
      throw new HttpsError('invalid-argument', 'Choose outage, upgrade, or resolved.')
    }

    const message = String(req.data?.message || '').trim()
    const requestedSubject = String(req.data?.subject || '').replace(/[\r\n]+/g, ' ').trim()
    const subject = requestedSubject || SYSTEM_NOTICE_CONFIG[kind].subject
    if (message.length < 10 || message.length > 2000) {
      throw new HttpsError('invalid-argument', 'The notice message must be between 10 and 2,000 characters.')
    }
    if (subject.length < 5 || subject.length > 160) {
      throw new HttpsError('invalid-argument', 'The subject must be between 5 and 160 characters.')
    }

    const parseOptionalDate = (value: any, field: string) => {
      if (!value) return null
      const date = new Date(String(value))
      if (Number.isNaN(date.getTime())) throw new HttpsError('invalid-argument', `${field} is not a valid date.`)
      return date.toISOString()
    }
    const startsAt = parseOptionalDate(req.data?.startsAt, 'Start time')
    const endsAt = parseOptionalDate(req.data?.endsAt, 'Expected completion time')
    if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      throw new HttpsError('invalid-argument', 'Expected completion must be after the start time.')
    }

    const [usersSnap, suppressionsSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('emailSuppressions').get()
    ])
    const suppressedEmails = new Set(
      suppressionsSnap.docs.map((docSnap) => safeLower(docSnap.data()?.to || docSnap.data()?.email)).filter(Boolean)
    )
    const recipients = new Map<string, { email: string; name: string | null; userId: string }>()
    let skippedInvalid = 0
    let skippedDuplicate = 0
    let skippedSuppressed = 0
    let skippedExcludedDomain = 0

    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data() as any
      const email = safeLower(data.email)
      if (!EMAIL_RX.test(email)) {
        skippedInvalid++
        continue
      }
      if (email.endsWith(SYSTEM_BROADCAST_EXCLUDED_DOMAIN)) {
        skippedExcludedDomain++
        continue
      }
      if (suppressedEmails.has(email)) {
        skippedSuppressed++
        continue
      }
      if (recipients.has(email)) {
        skippedDuplicate++
        continue
      }
      recipients.set(email, {
        email,
        name: String(data.name || data.displayName || '').trim() || null,
        userId: userDoc.id
      })
    }

    if (recipients.size === 0) {
      throw new HttpsError('failed-precondition', 'No deliverable user email addresses were found.')
    }

    const emailType: EmailType = kind === 'outage'
      ? 'SYSTEM_OUTAGE'
      : kind === 'upgrade'
        ? 'SYSTEM_UPGRADE'
        : 'SYSTEM_RESOLVED'
    const campaignRef = db.collection('mailCampaigns').doc()
    const now = admin.firestore.FieldValue.serverTimestamp()
    const campaign: MailCampaignDoc = {
      name: `${SYSTEM_NOTICE_CONFIG[kind].label} - ${new Date().toISOString()}`,
      emailType,
      recipientType: 'users',
      subjectOverride: subject,
      payload: {},
      status: 'draft',
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
      totalRecipients: recipients.size,
      sentCount: 0,
      failCount: 0,
      throttleMs: Math.min(Math.max(Number(req.data?.throttleMs || 100), 0), 2000),
      systemNotice: { kind, message, startsAt, endsAt },
      copyRecipients: SYSTEM_BROADCAST_COPY_RECIPIENTS
    }

    try {
      await campaignRef.create({
        ...campaign,
        sourceUserCount: usersSnap.size,
        skippedInvalid,
        skippedDuplicate,
        skippedSuppressed,
        skippedExcludedDomain
      })

      const rows = [...recipients.values()]
      for (let index = 0; index < rows.length; index += 400) {
        const batch = db.batch()
        rows.slice(index, index + 400).forEach((recipient) => {
          batch.set(campaignRef.collection('recipients').doc(recipient.userId), {
            email: recipient.email,
            name: recipient.name,
            userId: recipient.userId,
            status: 'pending',
            lastError: null,
            sentAt: null
          } satisfies RecipientRow & { userId: string })
        })
        await batch.commit()
      }

      await campaignRef.set({ status: 'queued', queuedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    } catch (err: any) {
      const error = String(err?.message || err)
      await campaignRef.set({ status: 'failed', lastError: error, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(() => undefined)
      logger.error('systemStatusBroadcast.queueFailed', { campaignId: campaignRef.id, error })
      throw new HttpsError('internal', 'The system notice could not be queued.')
    }

    return {
      ok: true,
      campaignId: campaignRef.id,
      status: 'queued',
      totalUsers: usersSnap.size,
      recipients: recipients.size,
      skippedInvalid,
      skippedDuplicate,
      skippedSuppressed,
      skippedExcludedDomain,
      copyRecipients: SYSTEM_BROADCAST_COPY_RECIPIENTS
    }
  }
)

export const sendAdminTestEmail = onCall(
  { region: 'us-central1', cors: CALLABLE_CORS },
  async (req) => {
    const actor = await requireEmailAdmin(req)
    const to = safeLower(req.data?.to || actor.email)
    if (!to || !EMAIL_RX.test(to)) throw new HttpsError('invalid-argument', 'Enter a valid test recipient email.')

    const subject = 'Smart Incubation email test'
    const html = basicShell(
      'Email test',
      `
      <p>This is a test email from the Smart Incubation admin email monitor.</p>
      <p>If this message arrived, the connected SMTP mailbox is accepting outgoing mail.</p>
    `
    )
    const text = 'This is a test email from the Smart Incubation admin email monitor.'

    try {
      const info: any = await sendEmail({ to, subject, html, text })
      await writeEmailLog({
        type: 'TEST',
        to,
        subject,
        status: 'sent',
        createdBy: actor,
      })
      return {
        ok: true,
        to,
        messageId: info?.messageId || null,
        smtp: {
          host: maskSecret(process.env.SMTP_HOST),
          user: maskSecret(process.env.SMTP_USER),
          from: process.env.SMTP_FROM || process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER || null
        }
      }
    } catch (err: any) {
      const error = String(err?.message || err)
      await writeEmailLog({
        type: 'TEST',
        to,
        subject,
        status: 'failed',
        error,
        createdBy: actor,
      })
      throw new HttpsError('internal', error)
    }
  }
)

export const resendAccountCreationEmails = onCall(
  { region: 'us-central1', cors: CALLABLE_CORS },
  async (req) => {
    const actor = await requireEmailAdmin(req)
    const targets = await collectUsersForAccountCreation({
      userIds: req.data?.userIds,
      emails: req.data?.emails,
      emailList: req.data?.emailList,
      emailsText: req.data?.emailsText,
      roles: req.data?.roles,
      createdFrom: req.data?.createdFrom || null,
      createdTo: req.data?.createdTo || null,
      limit: req.data?.limit
    })

    const dryRun = !!req.data?.dryRun
    const results: Array<{ id: string; email: string; status: string; error?: string | null }> = []
    const throttleMs = Math.min(Math.max(Number(req.data?.throttleMs || 0), 0), 5000)

    for (const target of targets) {
      const data = target.data as any
      const to = safeLower(target.email || data.email)
      const name = data.name || data.displayName || null

      if (!to || !EMAIL_RX.test(to)) {
        const error = 'Invalid or missing email'
        results.push({ id: target.id, email: to || '(missing)', status: 'skipped', error })
        if (target.ref) await markUserEmailStatus(target.ref, 'skipped', error)
        await writeEmailLog({
          type: 'ACCOUNT_CREATION',
          to: to || '(missing)',
          subject: 'Welcome to Lepharo Smart Incubation',
          status: 'skipped',
          error,
          userId: target.ref ? target.id : null,
          createdBy: actor
        })
        continue
      }

      const tpl = buildAccountCreationEmail({ name, loginUrl: ACCOUNT_CREATION_LOGIN_URL })
      if (dryRun) {
        results.push({ id: target.id, email: to, status: 'preview' })
        continue
      }

      try {
        await sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text })
        results.push({ id: target.id, email: to, status: 'sent' })
        if (target.ref) await markUserEmailStatus(target.ref, 'ok')
        await writeEmailLog({
          type: 'ACCOUNT_CREATION',
          to,
          subject: tpl.subject,
          status: 'sent',
          userId: target.ref ? target.id : null,
          createdBy: actor
        })
      } catch (err: any) {
        const error = String(err?.message || err)
        results.push({ id: target.id, email: to, status: 'failed', error })
        if (target.ref) await markUserEmailStatus(target.ref, 'bounced', error)
        await writeEmailLog({
          type: 'ACCOUNT_CREATION',
          to,
          subject: tpl.subject,
          status: 'failed',
          error,
          userId: target.ref ? target.id : null,
          createdBy: actor
        })
      }

      if (throttleMs > 0) await new Promise((resolve) => setTimeout(resolve, throttleMs))
    }

    const sent = results.filter((r) => r.status === 'sent').length
    const failed = results.filter((r) => r.status === 'failed').length
    const skipped = results.filter((r) => r.status === 'skipped').length
    return { ok: true, dryRun, total: results.length, sent, failed, skipped, results }
  }
)

export const sendApplicationReceivedEmail = onCall(
  { region: 'us-central1', cors: CALLABLE_CORS },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Login required.')

    const to = safeLower(req.data?.email)
    const name = String(req.data?.name || 'there').trim()
    const programName = String(req.data?.programName || '').trim() || null
    if (!to || !EMAIL_RX.test(to)) {
      throw new HttpsError('invalid-argument', 'A valid applicant email is required.')
    }

    const tpl = buildApplicationReceivedEmail({ name, programName })
    try {
      const info: any = await sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text })
      await writeEmailLog({
        type: 'APPLICATION_RECEIVED',
        to,
        subject: tpl.subject,
        status: 'sent',
        createdBy: { uid: req.auth.uid, email: req.auth.token?.email || null },
      })
      return { ok: true, messageId: info?.messageId || null }
    } catch (err: any) {
      const error = String(err?.message || err)
      await writeEmailLog({
        type: 'APPLICATION_RECEIVED',
        to,
        subject: tpl.subject,
        status: 'failed',
        error,
        createdBy: { uid: req.auth.uid, email: req.auth.token?.email || null },
      })
      throw new HttpsError('internal', 'Application confirmation email failed.')
    }
  }
)

export const sendComplianceReminderEmail = onCall(
  { region: 'us-central1', cors: CALLABLE_CORS },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Login required.')

    const to = safeLower(req.data?.email)
    const name = String(req.data?.name || 'there').trim()
    const programName = String(req.data?.programName || 'your incubation programme').trim()
    const participantId = req.data?.participantId ? String(req.data.participantId).trim() : null
    const programId = req.data?.programId ? String(req.data.programId).trim() : null
    const issues = Array.isArray(req.data?.issues)
      ? req.data.issues.map((value: any) => String(value || '').trim()).filter(Boolean).slice(0, 50)
      : []
    if (!to || !EMAIL_RX.test(to)) {
      throw new HttpsError('invalid-argument', 'A valid recipient email is required.')
    }
    if (!issues.length) {
      throw new HttpsError('invalid-argument', 'At least one outstanding compliance item is required.')
    }

    const subject = `Action required: outstanding details for ${programName}`
    const issueList = issues.map((issue: string) => `<li>${issue.replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char] || char))}</li>`).join('')
    const html = basicShell(
      'Outstanding information required',
      `<p>Hi ${name},</p>
       <p>Please complete the following items so that we can continue processing your participation in <b>${programName}</b>:</p>
       <ul>${issueList}</ul>
       <p>Sign in to Smart Incubation to update the outstanding information.</p>`
    )
    const text = `Hi ${name},\n\nPlease complete the following items for ${programName}:\n- ${issues.join('\n- ')}\n\nSign in to Smart Incubation to update the outstanding information.`

    try {
      const { messageId } = await sendViaBrevo({ to, subject, html, text, tags: ['compliance-reminder'] })
      await logBrevoSend({
        type: 'COMPLIANCE_REMINDER',
        to,
        subject,
        status: 'sent',
        messageId,
        participantId,
        programId,
      })
      return { ok: true, messageId }
    } catch (err: any) {
      const error = String(err?.message || err)
      await logBrevoSend({
        type: 'COMPLIANCE_REMINDER',
        to,
        subject,
        status: 'failed',
        error,
        participantId,
        programId,
      })
      throw new HttpsError('internal', 'Compliance reminder email failed.')
    }
  }
)
