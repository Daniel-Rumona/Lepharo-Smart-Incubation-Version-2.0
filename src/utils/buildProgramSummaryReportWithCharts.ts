// src/utils/buildConsolidatedMeProgramReport.ts
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
  DocumentData
} from "firebase/firestore"
import { db } from "@/firebase"
import type { MonthlyReportData, InterventionRow } from "@/utils/monthlyReportDocx"
import { buildMeProgramDeptCharts } from "@/utils/consolidatedReportCharts"
import { buildMonthlyInterventionTrackerRows } from "./buildMonthlyInterventionTrackerRows"

type BuildParams = {
  programId?: string | null
  reportTitleDepartmentName?: string

  period: {
    month: number
    year: number
    spanMonths?: number
  }

  scopeLabel?: string
  meta?: Partial<MonthlyReportData["meta"]>
}

type AssignedInterventionDoc = {
  id?: string

  programId?: string
  departmentId?: string
  areaOfSupport?: string

  beneficiaryName?: string
  participantId?: string
  participantEmail?: string
  interventionTitle?: string
  interventionId?: string

  status?: string
  assigneeAcceptanceStatus?: string
  participantAcceptanceStatus?: string
  assigneeCompletionStatus?: string
  participantCompletionStatus?: string

  movDocumentId?: string
  tracking?: { documentsUploaded?: Array<{ id?: string; label?: string; link?: string }> }
  progressUpdates?: Array<{ resources?: Array<{ id?: string; label?: string; link?: string; type?: string }> }>

  createdAt?: any
  updatedAt?: any
  completedAt?: any
}

type ApplicationDoc = {
  interventions?: { required?: Array<{ area?: string }> }
}

const norm = (s: any) => String(s ?? "").trim()
const low = (s: any) => norm(s).toLowerCase()

function periodRange(period: {
  month: number
  year: number
  spanMonths?: number
}) {
  const requestedSpan = Number(
    period.spanMonths ?? 1
  )

  const span =
    Number.isFinite(requestedSpan) &&
    requestedSpan > 0
      ? Math.floor(requestedSpan)
      : 1

  const start = dayjs(
    `${period.year}-${String(period.month).padStart(2, "0")}-01`
  ).startOf("month")

  const end = start
    .add(span - 1, "month")
    .endOf("month")

  return {
    start,
    end,
    span
  }
}

function monthLabel(d: dayjs.Dayjs) {
  return d.format("MMMM YYYY")
}
function formatPeriodLabel(start: dayjs.Dayjs, end: dayjs.Dayjs, span: number) {
  if (span <= 1) return monthLabel(start)
  return `${monthLabel(start)} – ${monthLabel(end)}`
}

const tsToDate = (v: any): Date | undefined => v?.toDate?.() ?? (v instanceof Date ? v : undefined)

function eventDate(ai: AssignedInterventionDoc): Date | undefined {
  // IMPORTANT: never assume updatedAt exists
  return tsToDate(ai.updatedAt) || tsToDate(ai.createdAt) || tsToDate(ai.completedAt)
}

function inPeriod(d: Date | undefined, start: dayjs.Dayjs, end: dayjs.Dayjs) {
  if (!d) return false
  const x = dayjs(d)
  // Plain isAfter/isBefore are exclusive, so isSame covers the boundary instants
  // instead of depending on the isSameOrAfter/isSameOrBefore dayjs plugin.
  return (x.isAfter(start) || x.isSame(start)) && (x.isBefore(end) || x.isSame(end))
}

function pickDateForRow(d: AssignedInterventionDoc) {
  const ts = tsToDate(d.completedAt) || tsToDate(d.updatedAt) || tsToDate(d.createdAt)
  return ts ? dayjs(ts).format("YYYY-MM-DD") : ""
}

function hasEvidenceOrCompletion(d: AssignedInterventionDoc) {
  const statusCompleted = low(d.status) === "completed"

  const movOk = !!norm(d.movDocumentId)

  const docsUploadedOk =
    Array.isArray(d.tracking?.documentsUploaded) && d.tracking!.documentsUploaded!.length > 0

  const progressResourcesOk =
    Array.isArray(d.progressUpdates) &&
    d.progressUpdates.some(p => Array.isArray(p.resources) && p.resources.length > 0)

  const consultantCompleted = low(d.assigneeCompletionStatus) === "completed"
  const userConfirmed = low(d.participantCompletionStatus) === "confirmed"

  return (
    statusCompleted ||
    movOk ||
    docsUploadedOk ||
    progressResourcesOk ||
    consultantCompleted ||
    userConfirmed
  )
}

function assignedStuckReason(ai: AssignedInterventionDoc) {
  const c = low(ai.assigneeAcceptanceStatus) || "pending"
  const u = low(ai.participantAcceptanceStatus) || "pending"

  if (c === "declined" || c === "rejected") return "Consultant declined the assignment"
  if (u === "declined" || u === "rejected") return "SME declined the assignment"

  const smeAccepted = u === "accepted"

  if (!smeAccepted) return "Awaiting SME acceptance"

  return "Assigned, but status not moved to In Progress"
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

/** Used when building a report across every program, to label each one. */
async function fetchProgramNames(programIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  await Promise.all(
    programIds.map(async programId => {
      const name = await fetchProgramName(programId)
      if (name) out.set(programId, name)
    })
  )
  return out
}

const sumMap = (m: Map<string, number>) => Array.from(m.values()).reduce((a, b) => a + b, 0)

export async function buildConsolidatedMeProgramReport(
  params: BuildParams
): Promise<MonthlyReportData> {
  const {
    programId,
    reportTitleDepartmentName = "Consolidated Report",
    period,
    scopeLabel,
    meta
  } = params

  const { start, end, span } = periodRange(period)
  const periodLabel = formatPeriodLabel(start, end, span)

  // -----------------------------
  // Departments (canonical name mapping)
  // -----------------------------
  const depSnap = await getDocs(
    query(
      collection(db, "departments"),
      where("interventionsDepartment", "==", true)
    )
  )
  const departments = depSnap.docs.map(d => {
    const x = d.data() as DocumentData
    return { id: d.id, name: String(x.name ?? x.title ?? "") }
  })


  const depNameByLower = new Map<string, string>()
  for (const d of departments) {
    const n = (d.name || "").trim()
    if (n) depNameByLower.set(n.toLowerCase(), n)
  }
  const deptKeyFromArea = (area?: string) => {
    const k = (area || "").trim().toLowerCase()
    return depNameByLower.get(k) || "Unmapped"
  }

  // -----------------------------
  // Required (from applications)
  // -----------------------------
  const appFilters: any[] = []
  if (programId) appFilters.push(where("programId", "==", programId))
  const appSnap = await getDocs(query(collection(db, "applications"), ...appFilters))

  const requiredByDept = new Map<string, number>()
  appSnap.docs.forEach(d => {
    const x = d.data() as ApplicationDoc
    const req = Array.isArray(x?.interventions?.required) ? x.interventions!.required! : []
    for (const r of req) {
      const dept = deptKeyFromArea(r.area)
      requiredByDept.set(dept, (requiredByDept.get(dept) || 0) + 1)
    }
  })


  // -----------------------------
  // Assigned interventions
  // -----------------------------
  const base: QueryConstraint[] = programId ? [where("programId", "==", programId)] : []

  const aiSnap = await getDocs(query(collection(db, "assignedInterventions"), ...base))
  const allAssigned: AssignedInterventionDoc[] = aiSnap.docs.map(d => ({
    id: d.id,
    ...(d.data() as any)
  }))


  const assignedInPeriod = allAssigned.filter(ai => inPeriod(eventDate(ai), start, end))

  // -----------------------------
  // Delivery by department (totals, not a row-by-row listing)
  // -----------------------------
  const deptCounts = new Map<string, number>()
  assignedInPeriod.forEach(ai => {
    const dept = deptKeyFromArea(ai.areaOfSupport)
    deptCounts.set(dept, (deptCounts.get(dept) || 0) + 1)
  })
  const interventionsByDepartment = Array.from(deptCounts.entries())
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count)

  // -----------------------------
  // Consolidated MOV packs touching this period.
  // Every pack that exists was, by construction, submitted (its approvals array
  // starts with an hod_submission entry when the HOD first creates it) -- "validated"
  // is the subset M&E has since signed off, mirroring hasApprovalStep() in the MOV
  // pages (src/components/dashboards/rom/romDashboard.tsx, src/routes/operations/movs).
  // -----------------------------
  const movBase: QueryConstraint[] = programId ? [where("programId", "==", programId)] : []
  const movSnap = await getDocs(query(collection(db, "consolidatedMOVs"), ...movBase))

  const periodMonthKeys = new Set<string>()
  for (let cursor = start.startOf("month"); cursor.valueOf() <= end.valueOf(); cursor = cursor.add(1, "month")) {
    periodMonthKeys.add(cursor.format("YYYY-MM"))
  }

  const movPacksInPeriod = movSnap.docs
    .map(d => d.data() as any)
    .filter(pack => {
      const monthKey = norm(pack.month)
      if (monthKey) return periodMonthKeys.has(monthKey)
      // Older packs may not carry a month string; fall back to their own date range.
      const from = pack.range?.from?.toDate?.() || pack.range?.from
      return from ? inPeriod(from, start, end) : false
    })

  const hasMovApprovalStep = (pack: any, step: string) =>
    Array.isArray(pack.approvals) &&
    pack.approvals.some((a: any) => low(a?.step) === step)

  const isMovPackValidated = (pack: any) =>
    hasMovApprovalStep(pack, "validation") ||
    hasMovApprovalStep(pack, "me_validation") ||
    hasMovApprovalStep(pack, "me_signature")

  // A pack bundles several individual MOVs (one per intervention); validation
  // applies to the whole pack, so an item counts as validated when its pack does.
  const movItemCount = (pack: any) => {
    const total = Number(pack.totalItems)
    if (Number.isFinite(total) && total > 0) return total
    return Array.isArray(pack.interventions) ? pack.interventions.length : 0
  }

  const validatedMovPacks = movPacksInPeriod.filter(isMovPackValidated)

  const movStats = {
    submitted: movPacksInPeriod.length,
    validated: validatedMovPacks.length,
    items: movPacksInPeriod.reduce((sum, pack) => sum + movItemCount(pack), 0),
    itemsValidated: validatedMovPacks.reduce((sum, pack) => sum + movItemCount(pack), 0)
  }

  const rejectedExamples = allAssigned
    .filter(ai => !inPeriod(eventDate(ai), start, end))
    .slice(0, 10)
    .map(ai => ({
      id: ai.id,
      status: ai.assignmentStatus,
      eventDate: eventDate(ai)?.toISOString?.() ?? null,
      createdAt: tsToDate(ai.createdAt)?.toISOString?.() ?? null,
      updatedAt: tsToDate(ai.updatedAt)?.toISOString?.() ?? null,
      completedAt: tsToDate(ai.completedAt)?.toISOString?.() ?? null
    }))

  // -----------------------------
  // Aggregations
  // -----------------------------
  const completedByDept = new Map<string, number>()
  const workloadAssignedByDept = new Map<string, number>()
  const workloadInProgressByDept = new Map<string, number>()
  const workloadCompletedByDept = new Map<string, number>()
  const assignedReasonsAgg = new Map<string, number>()

  const statusDist: Record<string, number> = {}

  assignedInPeriod.forEach(ai => {
    const dept = deptKeyFromArea(ai.areaOfSupport)

    const stRaw = String(ai.assignmentStatus || "unknown").toLowerCase().trim()
    statusDist[stRaw] = (statusDist[stRaw] || 0) + 1

    if (hasEvidenceOrCompletion(ai)) {
      completedByDept.set(dept, (completedByDept.get(dept) || 0) + 1)
    }

    if (stRaw === "assigned") {
      workloadAssignedByDept.set(dept, (workloadAssignedByDept.get(dept) || 0) + 1)
      const r = assignedStuckReason(ai)
      assignedReasonsAgg.set(r, (assignedReasonsAgg.get(r) || 0) + 1)
    } else if (stRaw === "in-progress" || stRaw === "in progress") {
      workloadInProgressByDept.set(dept, (workloadInProgressByDept.get(dept) || 0) + 1)
    } else if (stRaw === "completed") {
      workloadCompletedByDept.set(dept, (workloadCompletedByDept.get(dept) || 0) + 1)
    }
  })

  // Departments list for charts/tables
  const deptNames = Array.from(
    new Set([
      ...requiredByDept.keys(),
      ...workloadAssignedByDept.keys(),
      ...workloadInProgressByDept.keys(),
      ...workloadCompletedByDept.keys(),
      ...departments.map(d => d.name).filter(Boolean)
    ])
  )

  // Points passed to charts util (required/completed/pending)
const points = deptNames.map(dept => {
    const required = requiredByDept.get(dept) || 0
    const completed = completedByDept.get(dept) || 0
    const pending = Math.max(0, required - completed)

    return {
      dept,
      required,
      completed,
      pending,

      // workload for selected period
      assigned: workloadAssignedByDept.get(dept) || 0,
      inProgress: workloadInProgressByDept.get(dept) || 0,
      completedPeriod: workloadCompletedByDept.get(dept) || 0
    }
  })

  const overallRequired = points.reduce((s, p) => s + p.required, 0)
  const overallCompleted = points.reduce((s, p) => s + p.completed, 0)
  const overallPending = Math.max(0, overallRequired - overallCompleted)


  // -----------------------------
  // Programmes represented in this period, when the report spans all of them
  // (programId is unset). Report-player-only for now: the DOCX export still
  // requires a specific program, so a single-program report never needs this.
  // -----------------------------
  let programsBreakdown: Array<{ programId: string; programName: string; count: number }> | undefined
  let programName: string | undefined

  if (programId) {
    programName = await fetchProgramName(programId)
  } else {
    const programIdCounts = new Map<string, number>()
    assignedInPeriod.forEach(ai => {
      const pid = norm(ai.programId)
      if (!pid) return
      programIdCounts.set(pid, (programIdCounts.get(pid) || 0) + 1)
    })
    const programNamesById = await fetchProgramNames(Array.from(programIdCounts.keys()))
    programsBreakdown = Array.from(programIdCounts.entries())
      .map(([pid, count]) => ({
        programId: pid,
        programName: programNamesById.get(pid) || "Unnamed Program",
        count
      }))
      .sort((a, b) => b.count - a.count)
    programName = programsBreakdown.length === 1 ? programsBreakdown[0].programName : "All Programmes"
  }

  // Tables
// 1) Build applicationsByParticipantId
const applicationsByParticipantId = new Map<string, any>()
appSnap.docs.forEach(d => {
  const x = d.data() as any
  const pid = String(x.participantId || "").trim()
  if (!pid) return
  applicationsByParticipantId.set(pid, {
    participantId: pid,
    stage: x.stage || x.applicationStage || x.status || "—",
    beneficiaryName: x.businessName || x.beneficiaryName || ""
  })
})

// 2) Fetch participants for the participantIds we actually need
const participantIds = Array.from(
  new Set(assignedInPeriod.map(ai => String(ai.participantId || "").trim()).filter(Boolean))
)

const participantsByParticipantId = new Map<string, any>()

if (participantIds.length) {
  const participantDocs = await Promise.all(
    participantIds.map(async participantId => {
      try {
        const snap = await getDoc(
          doc(db, "participants", participantId)
        )

        if (!snap.exists()) return null

        return {
          id: snap.id,
          ...(snap.data() as any)
        }
      } catch (error) {
        console.warn(
          `Could not load participant ${participantId}`,
          error
        )

        return null
      }
    })
  )

  participantDocs
    .filter((participant): participant is Record<string, any> =>
      Boolean(participant)
    )
    .forEach(participant => {
      const pid = String(
        participant.participantId ||
        participant.id ||
        ""
      ).trim()

      if (!pid) return

      participantsByParticipantId.set(pid, {
        participantId: pid,
        email: participant.email,
        phone:
          participant.phone ||
          participant.phoneNumber,
        sector: participant.sector
      })
    })
}

// 3) Build SME-grouped rows
const interventionsThisMonth = await buildMonthlyInterventionTrackerRows({
    assigned: assignedInPeriod.map(ai => ({
      participantId: ai.participantId,
      beneficiaryName: ai.beneficiaryName,
      participantEmail: ai.participantEmail,
      areaOfSupport: ai.areaOfSupport,
      interventionTitle: ai.interventionTitle,
      createdAt: ai.createdAt,
      updatedAt: ai.updatedAt,
      completedAt: ai.completedAt,
      movAttached: hasEvidenceOrCompletion(ai)
    })),
    deptKeyFromArea,
    applicationsByParticipantId
  })



  const reasonRows = Array.from(assignedReasonsAgg.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }))

  const engagementsWithoutMOV: InterventionRow[] = assignedInPeriod
    .filter(ai => !hasEvidenceOrCompletion(ai))
    .map(ai => {
      const dept = deptKeyFromArea(ai.areaOfSupport)
      const title = norm(ai.interventionTitle) || "Unknown Intervention"
      const st = low(ai.assignmentStatus)
      const reason =
        st === "assigned" ? assignedStuckReason(ai) : "Work not yet closed"
      return {
        smmeName: norm(ai.beneficiaryName) || "Unknown SMME",
        contact: norm(ai.participantEmail) || "—",
        stage: reason,
        sector: "—",
        intervention: `${dept} — ${title}`,
        movAttached: false,
        date: pickDateForRow(ai) || undefined
      }
    })

  const charts = await buildMeProgramDeptCharts({
    periodLabel,
    programName: programName || "Program",
    points,
    overall: { required: overallRequired, completed: overallCompleted, pending: overallPending },
    workload: {
      byDept: deptNames.map(dept => ({
        dept,
        assigned: workloadAssignedByDept.get(dept) || 0,
        inProgress: workloadInProgressByDept.get(dept) || 0,
        completed: workloadCompletedByDept.get(dept) || 0
      }))
    }
  } as any)

  return {
    meta: {
      departmentName: reportTitleDepartmentName,
      periodLabel,
      scopeLabel,
      programId: programId || undefined,
      name: programName,
      ...(meta || {})
    },

    executiveSummary:
      `This consolidated report summarises activity for ${programName || "the selected program"} ` +
      `for ${periodLabel}. It reflects planned vs completed work and period workload, ` +
      `broken down by department.`,

    charts,

    beneficiaryStats: {
      totalAssigned: interventionsThisMonth.length,
      servicedThisMonth: interventionsThisMonth.filter(x => x.movAttached).length,
      notServiced: engagementsWithoutMOV.length,
      notServicedReasons: reasonRows.length ? reasonRows : undefined
    },

    movStats,
    interventionsByDepartment,
    programsBreakdown,

    interventionsThisMonth,
    engagementsWithoutMOV,

    conclusion:
      "Focus on moving Assigned items forward and ensure evidence is uploaded or completion is confirmed once work is done."
  }
}
