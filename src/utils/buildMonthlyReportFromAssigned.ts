// src/utils/buildMonthlyReportFromAssigned.ts
import dayjs from "dayjs"
import {
  collection,
  getDocs,
  getDoc,
  query,
  where,
  Timestamp,
  QueryConstraint,
  doc,
  documentId
} from "firebase/firestore"
import { db } from "@/firebase"
import type { MonthlyReportData, InterventionRow } from "@/utils/monthlyReportDocx"
import { buildMonthlyReportCharts } from "@/utils/monthlyReportCharts"

type BuildParams = {
  programId?: string | null
  departmentId?: string | null
  departmentName: string

  /**
   * Anchor month/year for the report.
   * spanMonths=1 => that month only.
   * spanMonths=3 => that month + next 2 months (quarterly-style range).
   */
  period: { month: number; year: number; spanMonths?: 1 | 2 | 3 } // month: 1-12
  scopeLabel?: string
  meta?: Partial<MonthlyReportData["meta"]>
}

type AssignedInterventionDoc = {

  programId?: string
  departmentId?: string
  areaOfSupport?: string

  beneficiaryName?: string
  participantId?: string
  participantEmail?: string
  interventionTitle?: string

  status?: string
  assigneeCompletionStatus?: string
  participantCompletionStatus?: string

  movDocumentId?: string

  tracking?: {
    documentsUploaded?: Array<{ id?: string; label?: string; link?: string }>
  }

  progressUpdates?: Array<{
    createdAt?: any
    resources?: Array<{ id?: string; label?: string; link?: string; type?: string }>
  }>

  createdAt?: any
  updatedAt?: any
  completedAt?: any
}

type ParticipantDoc = {
  email?: string
  phone?: string
  contact?: string
  stage?: string
  currentStage?: string
  businessStage?: string
  sector?: string
  primarySector?: string
  industry?: string
}

type ApplicationDoc = {
  participantId?: string
  email?: string
  stage?: string
  businessStage?: string
  sector?: string
  primarySector?: string
  industry?: string
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Range = start of anchor month -> end of (anchor month + spanMonths - 1)
 * spanMonths is capped to 1..3 for now.
 */
function periodRange(period: { month: number; year: number; spanMonths?: 1 | 2 | 3 }) {
  const span = Math.max(1, Math.min(3, Number(period.spanMonths ?? 1))) as 1 | 2 | 3
  const start = dayjs(`${period.year}-${String(period.month).padStart(2, "0")}-01`).startOf("month")
  const end = start.add(span - 1, "month").endOf("month")
  return { start, end, span }
}

function toTs(d: dayjs.Dayjs) {
  return Timestamp.fromDate(d.toDate())
}

const norm = (s: any) => String(s ?? "").trim()

function monthLabel(d: dayjs.Dayjs) {
  return d.format("MMMM YYYY")
}

function formatPeriodLabel(start: dayjs.Dayjs, end: dayjs.Dayjs, span: number) {
  if (span <= 1) return monthLabel(start)
  // e.g. "January 2026 – March 2026"
  return `${monthLabel(start)} – ${monthLabel(end)}`
}

function pickTitle(d: AssignedInterventionDoc) {
  return norm(d.interventionTitle) || "Unknown Intervention"
}

function pickBeneficiary(d: AssignedInterventionDoc) {
  return norm(d.beneficiaryName) || "Unknown SMME"
}

function pickDateForRow(d: AssignedInterventionDoc) {
  const ts = d.completedAt?.toDate?.() || d.updatedAt?.toDate?.() || d.createdAt?.toDate?.()
  if (ts) return dayjs(ts).format("YYYY-MM-DD")
  return ""
}

// NOTE: this is your current proxy for "closed/confirmed vs pending"
function hasEvidenceOrCompletion(d: AssignedInterventionDoc) {
  const movOk = !!norm(d.movDocumentId)

  const docsUploadedOk =
    Array.isArray(d.tracking?.documentsUploaded) && d.tracking!.documentsUploaded!.length > 0

  const progressResourcesOk =
    Array.isArray(d.progressUpdates) &&
    d.progressUpdates.some(p => Array.isArray(p.resources) && p.resources.length > 0)

  const consultantCompleted = norm(d.assigneeCompletionStatus).toLowerCase() === "completed"
  const userConfirmed = norm(d.participantCompletionStatus).toLowerCase() === "confirmed"

  return movOk || docsUploadedOk || progressResourcesOk || consultantCompleted || userConfirmed
}

function matchesDepartment(
  d: AssignedInterventionDoc,
  departmentId?: string | null,
  departmentName?: string
) {
  if (departmentId && norm(d.departmentId) === norm(departmentId)) return true
  const a = norm(d.areaOfSupport).toLowerCase()
  const n = norm(departmentName).toLowerCase()
  if (!a || !n) return false
  return a === n
}

async function fetchProgramName(programId?: string | null) {
  if (!programId) return undefined
  try {
    const snap = await getDoc(doc(db, "programs", programId))
    if (!snap.exists()) return undefined
    const data = snap.data() as any
    return norm(data?.name) || norm(data?.programName) || norm(data?.title) || undefined
  } catch {
    return undefined
  }
}

async function fetchParticipantsByIds(ids: string[]) {
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  const map = new Map<string, ParticipantDoc>()
  if (!uniq.length) return map

  // Firestore "in" supports up to 10 ids per query
  for (const group of chunk(uniq, 10)) {
    const q = query(collection(db, "participants"), where(documentId(), "in", group))
    const snap = await getDocs(q)
    snap.docs.forEach(d => map.set(d.id, d.data() as any))
  }
  return map
}

async function fetchApplicationsByParticipantIds(
  programId: string | null | undefined,
  ids: string[]
) {
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  const map = new Map<string, ApplicationDoc>()
  if (!uniq.length) return map

  // If programId exists, scope applications to that program to avoid wrong matches
  for (const group of chunk(uniq, 10)) {
    const constraints: QueryConstraint[] = [
      where("participantId", "in", group)
    ]
    if (programId) constraints.push(where("programId", "==", programId))
    const q = query(collection(db, "applications"), ...constraints)
    const snap = await getDocs(q)
    snap.docs.forEach(d => {
      const data = d.data() as any
      const pid = norm(data?.participantId)
      if (pid) map.set(pid, data)
    })
  }
  return map
}

function pickStage(p?: ParticipantDoc, a?: ApplicationDoc) {
  return (
    norm(p?.stage) ||
    norm(p?.currentStage) ||
    norm(p?.businessStage) ||
    norm(a?.stage) ||
    norm(a?.businessStage) ||
    "—"
  )
}

function pickSector(p?: ParticipantDoc, a?: ApplicationDoc) {
  return (
    norm(p?.sector) ||
    norm(p?.primarySector) ||
    norm(p?.industry) ||
    norm(a?.sector) ||
    norm(a?.primarySector) ||
    norm(a?.industry) ||
    "—"
  )
}

function pickContact(p?: ParticipantDoc, d?: AssignedInterventionDoc) {
  return norm(p?.email) || norm(d?.participantEmail) || norm(p?.phone) || norm(p?.contact) || "—"
}

/**
 * We do 2 queries and merge:
 * - completedAt in range (primary)
 * - updatedAt in range (fallback)
 *
 * Range can be 1..3 months for now (monthly/quarterly).
 */
export async function buildMonthlyReportDataFromAssignedInterventions(
  params: BuildParams
): Promise<MonthlyReportData> {
  const { programId, departmentId, departmentName, period, scopeLabel, meta } = params

  const { start, end, span } = periodRange(period)
  const periodLabel = formatPeriodLabel(start, end, span)

  const base: QueryConstraint[] = programId ? [where("programId", "==", programId)] : []

  const completedQ = query(
    collection(db, "assignedInterventions"),
    ...base,
    where("assigneeCompletedAt", ">=", toTs(start)),
    where("assigneeCompletedAt", "<=", toTs(end))
  )

  const updatedQ = query(
    collection(db, "assignedInterventions"),
    ...base,
    where("updatedAt", ">=", toTs(start)),
    where("updatedAt", "<=", toTs(end))
  )

  const [completedSnap, updatedSnap] = await Promise.all([getDocs(completedQ), getDocs(updatedQ)])

  const map = new Map<string, AssignedInterventionDoc>()
  completedSnap.docs.forEach(docSnap => map.set(docSnap.id, docSnap.data() as any))
  updatedSnap.docs.forEach(docSnap => map.set(docSnap.id, docSnap.data() as any))

  const all = Array.from(map.values())
  const deptDocs = all.filter(d => matchesDepartment(d, departmentId, departmentName))

  // --- Enrichment: program name + participant/app stage/sector/contact
  const participantIds = deptDocs.map(d => norm(d.participantId)).filter(Boolean)
  const [programName, participantsMap, applicationsMap] = await Promise.all([
    fetchProgramName(programId),
    fetchParticipantsByIds(participantIds),
    fetchApplicationsByParticipantIds(programId ?? undefined, participantIds)
  ])

  const interventionsInRange: InterventionRow[] = deptDocs.map(d => {
    const pid = norm(d.participantId)
    const p = pid ? participantsMap.get(pid) : undefined
    const a = pid ? applicationsMap.get(pid) : undefined

    return {
      smmeName: pickBeneficiary(d),
      contact: pickContact(p, d),
      stage: pickStage(p, a),
      sector: pickSector(p, a),
      intervention: pickTitle(d),
      movAttached: hasEvidenceOrCompletion(d),
      date: pickDateForRow(d) || undefined
    }
  })

  const engagementsWithoutMOV = interventionsInRange.filter(r => !r.movAttached)
  const total = interventionsInRange.length
  const withMov = total - engagementsWithoutMOV.length

  // ✅ Beneficiary / SMME statistics (now actually populated)
  const stageCounts = new Map<string, number>()
  const sectorCounts = new Map<string, number>()

  for (const r of interventionsInRange) {
    const st = norm(r.stage) || "—"
    const se = norm(r.sector) || "—"
    stageCounts.set(st, (stageCounts.get(st) || 0) + 1)
    sectorCounts.set(se, (sectorCounts.get(se) || 0) + 1)
  }

  const beneficiaryStats =
    total > 0
      ? {
          totalAssigned: total,
          servicedThisMonth: withMov,
          notServiced: engagementsWithoutMOV.length,
          notServicedReasons: engagementsWithoutMOV.length
            ? [
                {
                  reason: "Pending SME confirmation / MOV not attached",
                  count: engagementsWithoutMOV.length
                }
              ]
            : undefined,
          distributions: [
            {
              label: "By Stage",
              rows: Array.from(stageCounts.entries())
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value)
            },
            {
              label: "By Sector",
              rows: Array.from(sectorCounts.entries())
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value)
            }
          ].filter(d => d.rows.length > 0)
        }
      : undefined

  const charts =
    total > 0
      ? buildMonthlyReportCharts({
          interventions: interventionsInRange,
          periodLabel,
          departmentName
        })
      : undefined

  const executiveSummary =
    total === 0
      ? `No assigned interventions were recorded for ${departmentName} during ${periodLabel}.`
      : [
          `${departmentName} recorded ${total} intervention(s) during ${periodLabel}.`,
          `${withMov} are closed/confirmed; ${engagementsWithoutMOV.length} are pending SME confirmation.`
        ].join(" ")

  return {
    meta: {
      departmentName,
      periodLabel,
      // ✅ stop forcing "Program: <id>" into meta unless caller explicitly wants it
      // (header/cover should use meta.name for title)
      ...(scopeLabel ? { scopeLabel } : {}),
      programId: programId || undefined,
      name: programName || meta?.name || undefined,
      ...(meta || {})
    },
    executiveSummary,
    introduction: `This report reflects ${departmentName} departmental interventions recorded in the system for the reporting period.`,
    charts,
    beneficiaryStats,
    interventionsThisMonth: interventionsInRange, // keep field name for compatibility
    engagementsWithoutMOV: engagementsWithoutMOV.length ? engagementsWithoutMOV : undefined,
    challengesAndRisks: engagementsWithoutMOV.length
      ? [
          {
            issue: "Some interventions are still pending SME confirmation",
            impact: "Verification delays and incomplete period closure",
            rootCause: "SME confirmation not completed in the system within the reporting period",
            mitigation: "Follow-up with SMEs; enforce confirmation before period close"
          }
        ]
      : undefined,
    correctiveActionsNextMonth: total
      ? [
          {
            action: "Close pending SME confirmations for interventions recorded in this period",
            responsible: `${departmentName} Team`,
            deadline: dayjs(end).add(7, "day").format("DD MMM YYYY")
          }
        ]
      : []
  }
}
