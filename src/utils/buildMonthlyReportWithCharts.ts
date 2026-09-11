import dayjs from "dayjs"
import { collection, getDocs, query, where } from "firebase/firestore"
import { db } from "@/firebase"
import type { MonthlyReportData, ReportChartImage } from "@/utils/monthlyReportDocx"
import { buildMonthlyReportDataFromAssignedInterventions } from "@/utils/buildMonthlyReportFromAssigned"
import { renderHighchartsToPngDataUrl } from "@/utils/reportChartRenderer"

type BuildParams = {
  programId: string
  departmentId?: string | null
  departmentName: string
  period: { month: number; year: number; spanMonths?: 1 | 2 | 3 } // align with the rest
  scopeLabel?: string
  meta?: Partial<MonthlyReportData["meta"]>
}

type AppInterventionItem = {
  id?: string
  interventionId?: string
  title?: string
  area?: string
  areaOfSupport?: string
  status?: string
  completedAt?: any
  acceptedAt?: any
}

type ApplicationDoc = {

  programId?: string
  interventions?: {
    required?: AppInterventionItem[]
    assigned?: AppInterventionItem[]
    completed?: AppInterventionItem[]
  }
}

const norm = (s: any) => String(s ?? "").trim()
const normLower = (s: any) => norm(s).toLowerCase()

const anyTsToDayjs = (t: any) => {
  if (!t) return null
  if (typeof t === "string") {
    const d = dayjs(t)
    return d.isValid() ? d : null
  }
  if (t?.toDate) {
    const d = dayjs(t.toDate())
    return d.isValid() ? d : null
  }
  return null
}

const inRangeInclusive = (d: dayjs.Dayjs, start: dayjs.Dayjs, end: dayjs.Dayjs) =>
  (d.isAfter(start, "day") || d.isSame(start, "day")) &&
  (d.isBefore(end, "day") || d.isSame(end, "day"))

function periodRange(period: { month: number; year: number; spanMonths?: 1 | 2 | 3 }) {
  const span = Math.max(1, Math.min(3, Number(period.spanMonths ?? 1))) as 1 | 2 | 3
  const start = dayjs(`${period.year}-${String(period.month).padStart(2, "0")}-01`).startOf("month")
  const end = start.add(span - 1, "month").endOf("month")
  return { start, end, span }
}

type ByTypeRow = { title: string; required: number; assigned: number; completed: number }

function buildGapVarianceOptions(requiredTotal: number, completedTotal: number, outstandingTotal: number) {
  return {
    chart: { type: "column", backgroundColor: "#ffffff", spacing: [12, 12, 12, 12] },
    title: { text: "Required vs Completed (Gap Variance)", style: { color: "#111", fontWeight: "700" } },
    credits: { enabled: false },
    xAxis: { categories: ["Required", "Completed", "Outstanding"], labels: { style: { color: "#111", fontWeight: "600" } } },
    yAxis: { min: 0, allowDecimals: false, title: { text: "Count" }, gridLineColor: "#EFEFEF" },
    plotOptions: { column: { borderWidth: 0, dataLabels: { enabled: true, style: { color: "#111", fontWeight: "700", textOutline: "none" } } } },
    tooltip: { pointFormat: "<b>{point.y}</b>" },
    series: [{ type: "column", name: "Interventions", data: [requiredTotal, completedTotal, outstandingTotal] }]
  } as any
}

function buildInterventionsByTypeStackedBarOptions(rows: ByTypeRow[]) {
  const sorted = [...rows]
    .sort((a, b) => b.required + b.assigned + b.completed - (a.required + a.assigned + a.completed))
    .slice(0, 18)

  const categories = sorted.map(r => r.title)
  return {
    chart: { type: "bar", backgroundColor: "#ffffff", spacing: [12, 12, 12, 12] },
    title: { text: "Interventions by Type (Required / Assigned / Completed)", style: { color: "#111", fontWeight: "700" } },
    credits: { enabled: false },
    legend: { reversed: true, itemStyle: { color: "#111", fontWeight: "600" } },
    xAxis: { categories, labels: { style: { color: "#111", fontWeight: "600" } } },
    yAxis: {
      min: 0,
      allowDecimals: false,
      title: { text: "Count", style: { color: "#111", fontWeight: "600" } },
      gridLineColor: "#EFEFEF",
      stackLabels: { enabled: true, style: { color: "#111", fontWeight: "800", textOutline: "none" } }
    },
    plotOptions: {
      series: {
        stacking: "normal",
        dataLabels: { enabled: true, style: { color: "#111", fontWeight: "700", textOutline: "none" } }
      }
    },
    tooltip: { shared: true },
    series: [
      { type: "bar", name: "Completed", data: sorted.map(r => r.completed) },
      { type: "bar", name: "Assigned", data: sorted.map(r => r.assigned) },
      { type: "bar", name: "Required", data: sorted.map(r => r.required) }
    ]
  } as any
}

async function fetchApplications(programId: string) {
  const qA = query(
    collection(db, "applications"),
    where("programId", "==", programId)
  )
  const snap = await getDocs(qA)
  return snap.docs.map(d => d.data() as any) as ApplicationDoc[]
}

function computeByType(apps: ApplicationDoc[], deptName: string, start: dayjs.Dayjs, end: dayjs.Dayjs) {
  const map: Record<string, ByTypeRow> = {}
  const bump = (title: string, k: keyof ByTypeRow) => {
    if (!map[title]) map[title] = { title, required: 0, assigned: 0, completed: 0 }
    map[title][k] += 1
  }

  const matchesDept = (area: any) => normLower(area) === normLower(deptName)

  for (const app of apps) {
    const ints = app?.interventions || {}
    const required = Array.isArray(ints.required) ? ints.required : []
    const assigned = Array.isArray(ints.assigned) ? ints.assigned : []
    const completed = Array.isArray(ints.completed) ? ints.completed : []

    required.forEach(it => {
      const area = norm(it.areaOfSupport) || norm(it.area)
      if (!matchesDept(area)) return
      bump(norm(it.title) || "Untitled", "required")
    })

    assigned.forEach(it => {
      const area = norm(it.areaOfSupport) || norm(it.area)
      if (!matchesDept(area)) return
      const d = anyTsToDayjs((it as any).acceptedAt)
      if (!d) return
      if (inRangeInclusive(d, start, end)) bump(norm(it.title) || "Untitled", "assigned")
    })

    completed.forEach(it => {
      const area = norm(it.areaOfSupport) || norm(it.area)
      if (!matchesDept(area)) return
      const d = anyTsToDayjs((it as any).completedAt)
      if (!d) return
      if (inRangeInclusive(d, start, end)) bump(norm(it.title) || "Untitled", "completed")
    })
  }

  return Object.values(map)
}

export async function buildMonthlyReportWithCharts(params: BuildParams): Promise<MonthlyReportData> {
  // 1) base report (tables etc.)
  const base = await buildMonthlyReportDataFromAssignedInterventions(params as any)

  // 2) charts
  const { start, end } = periodRange(params.period)
  const apps = await fetchApplications(params.programId)
  const byType = computeByType(apps, params.departmentName, start, end)

  const requiredTotal = byType.reduce((s, r) => s + r.required, 0)
  const completedTotal = byType.reduce((s, r) => s + r.completed, 0)
  const outstandingTotal = Math.max(requiredTotal - completedTotal, 0)

  const gapPng = await renderHighchartsToPngDataUrl(
    buildGapVarianceOptions(requiredTotal, completedTotal, outstandingTotal),
    { width: 860, height: 380 }
  )

  const byTypePng = await renderHighchartsToPngDataUrl(
    buildInterventionsByTypeStackedBarOptions(byType),
    { width: 860, height: 520 }
  )

  // ✅ keys now always valid (string type anyway, but keep semantic)
  const charts: ReportChartImage[] = [
    {
      key: "gapVariance",
      title: "Required vs Completed (Gap Variance)",
      pngDataUrl: gapPng,
      caption: `Period: ${start.format("MMMM YYYY")} – ${end.format("MMMM YYYY")} • Department: ${params.departmentName}`,
      width: 620,
      height: 320
    },
    {
      key: "typeStatus",
      title: "Interventions by Type (Required / Assigned / Completed)",
      pngDataUrl: byTypePng,
      width: 620,
      height: 380
    }
  ]

  return { ...base, charts }
}
