import Highcharts from "highcharts"
import type { ReportChartImage } from "@/utils/monthlyReportDocx"
import { renderHighchartsToPngDataUrl } from "@/utils/reportChartRenderer"

type DeptPoint = {
  dept: string

  // Plan-side totals (from applications.interventions.required)
  required: number

  // Completion proxy (MOV / proof / confirmed / completed)
  completed: number

  // Workload in selected period (from assignedInterventions statuses in-range)
  assigned: number
  inProgress: number
  completedPeriod: number
}

type BuildParams = {
  periodLabel: string
  programName: string
  points: DeptPoint[]

  overall: {
    required: number
    completed: number
    pending: number
  }
}

const capLabel = (s: string, max = 32) =>
  s.length > max ? s.slice(0, max - 3) + "..." : s

const sortByRequiredDesc = (a: DeptPoint, b: DeptPoint) =>
  (b.required || 0) - (a.required || 0)

export async function buildMeProgramDeptCharts(
  params: BuildParams
): Promise<ReportChartImage[]> {
  const { periodLabel, programName, points, overall } = params
  const subtitle = `${programName || "Program"} • ${periodLabel} • All Departments`

  const sorted = points.slice().sort(sortByRequiredDesc)
  const categories = sorted.map(p => capLabel(p.dept || "Unmapped", 32))

  // 0) Overall donut (Completed vs Pending)
  const overallDonutOptions: Highcharts.Options = {
    chart: { type: "pie" },
    title: { text: "Program Completion Status (Overall)" },
    subtitle: { text: subtitle },
    credits: { enabled: false },
    tooltip: { pointFormat: "<b>{point.y}</b> ({point.percentage:.1f}%)" },
    plotOptions: {
      pie: {
        innerSize: "62%",
        dataLabels: {
          enabled: true,
          format: "<b>{point.name}</b>: {point.y} ({point.percentage:.1f}%)",
          style: { textOutline: "none" }
        }
      }
    },
    series: [
      {
        type: "pie",
        name: "Status",
        data: [
          { name: "Completed", y: overall.completed || 0 },
          { name: "Remaining", y: overall.pending || 0 }
        ]
      }
    ]
  }

  // 1) Required vs Completed (per dept) — two bars
  const requiredVsCompletedOptions: Highcharts.Options = {
    chart: { type: "bar" },
    title: { text: "Required vs Completed (by Department)" },
    subtitle: { text: subtitle },
    credits: { enabled: false },
    xAxis: { categories, title: { text: "Department" } },
    yAxis: { min: 0, title: { text: "Count" }, allowDecimals: false },
    legend: { align: "center", verticalAlign: "bottom" },
    tooltip: { shared: true },
    plotOptions: {
      series: {
        dataLabels: {
          enabled: true,
          style: { textOutline: "none", fontWeight: "700" }
        }
      }
    },
    series: [
      {
        type: "bar",
        name: "Required",
        data: sorted.map(p => p.required || 0)
      },
      {
        type: "bar",
        name: "Completed",
        data: sorted.map(p => p.completed || 0)
      }
    ]
  }

  // 2) Workload for period — stacked: Assigned / In Progress / Completed
  const workloadOptions: Highcharts.Options = {
    chart: { type: "bar" },
    title: { text: "Department Workload (Selected Period)" },
    subtitle: { text: subtitle },
    credits: { enabled: false },
    xAxis: { categories, title: { text: "Department" } },
    yAxis: {
      min: 0,
      title: { text: "Count" },
      allowDecimals: false,
      stackLabels: {
        enabled: true,
        style: { fontWeight: "700", textOutline: "none" }
      }
    },
    legend: { align: "center", verticalAlign: "bottom" },
    tooltip: { shared: true },
    plotOptions: {
      series: {
        stacking: "normal",
        dataLabels: { enabled: true, style: { textOutline: "none" } }
      }
    },
    series: [
      {
        type: "bar",
        name: "Assigned",
        data: sorted.map(p => p.assigned || 0)
      },
      {
        type: "bar",
        name: "In Progress",
        data: sorted.map(p => p.inProgress || 0)
      },
      {
        type: "bar",
        name: "Completed",
        data: sorted.map(p => p.completedPeriod || 0)
      }
    ]
  }

  const [donutPng, reqVsDonePng, workloadPng] = await Promise.all([
    renderHighchartsToPngDataUrl(overallDonutOptions, { width: 860, height: 420 }),
    renderHighchartsToPngDataUrl(requiredVsCompletedOptions, { width: 860, height: 520 }),
    renderHighchartsToPngDataUrl(workloadOptions, { width: 860, height: 520 })
  ])

  return [
    {
      key: "confirmation",
      title: "3.3.1 Completion Status (Overall)",
      pngDataUrl: donutPng,
      caption: "Overall completed vs remaining for the program and period.",
      width: 620,
      height: 290
    },
    {
      key: "reqVsCompleted",
      title: "3.3.2 Required vs Completed (By Department)",
      pngDataUrl: reqVsDonePng,
      caption: "",
      width: 620,
      height: 380
    },
    {
      key: "workload",
      title: "3.3.3 Department Workload (Selected Period)",
      pngDataUrl: workloadPng,
      caption: "",
      width: 620,
      height: 380
    }
  ]
}
