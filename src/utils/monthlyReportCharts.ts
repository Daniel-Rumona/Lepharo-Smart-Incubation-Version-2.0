// src/utils/monthlyReportCharts.ts
import type { InterventionRow, ReportChartImage } from "@/utils/monthlyReportDocx"

type ChartBuildParams = {
  interventions: InterventionRow[]
  periodLabel: string
  departmentName: string
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function safeNum(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D context unavailable")
  return { canvas, ctx }
}

function bg(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#FFFFFF"
  ctx.fillRect(0, 0, w, h)
}

function titleBlock(ctx: CanvasRenderingContext2D, title: string, subtitle: string, w: number) {
  ctx.fillStyle = "#111827"
  ctx.font = "700 18px system-ui, -apple-system, Segoe UI, Roboto, Arial"
  ctx.fillText(title, 20, 30)

  ctx.fillStyle = "#374151"
  ctx.font = "600 12px system-ui, -apple-system, Segoe UI, Roboto, Arial"
  const sub = subtitle.length > 110 ? subtitle.slice(0, 107) + "..." : subtitle
  ctx.fillText(sub, 20, 50)

  ctx.strokeStyle = "#E5E7EB"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(20, 64)
  ctx.lineTo(w - 20, 64)
  ctx.stroke()
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = clamp(r, 0, Math.min(w, h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function legendDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  label: string,
  value: string
) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y - 4, 6, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = "#111827"
  ctx.font = "800 13px system-ui, -apple-system, Segoe UI, Roboto, Arial"
  ctx.fillText(label, x + 14, y)

  ctx.fillStyle = "#111827"
  ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, Arial"
  ctx.fillText(value, x + 14, y + 18)
}

function donutChartPng(opts: {
  width: number
  height: number
  title: string
  subtitle: string
  aLabel: string
  aValue: number
  bLabel: string
  bValue: number
}) {
  const { width, height } = opts
  const { canvas, ctx } = makeCanvas(width, height)
  bg(ctx, width, height)
  titleBlock(ctx, opts.title, opts.subtitle, width)

  const total = safeNum(opts.aValue) + safeNum(opts.bValue)
  const aPct = total > 0 ? safeNum(opts.aValue) / total : 0

  ctx.fillStyle = "#F9FAFB"
  roundedRect(ctx, 20, 80, width - 40, height - 110, 14)
  ctx.fill()
  ctx.strokeStyle = "#E5E7EB"
  ctx.stroke()

  const cx = 170
  const cy = 220
  const rOuter = 80
  const rInner = 48

  ctx.strokeStyle = "#E5E7EB"
  ctx.lineWidth = rOuter - rInner
  ctx.beginPath()
  ctx.arc(cx, cy, (rOuter + rInner) / 2, 0, Math.PI * 2)
  ctx.stroke()

  const start = -Math.PI / 2
  const endA = start + Math.PI * 2 * aPct

  ctx.strokeStyle = "#16A34A" // confirmed
  ctx.lineCap = "round"
  ctx.lineWidth = rOuter - rInner
  ctx.beginPath()
  ctx.arc(cx, cy, (rOuter + rInner) / 2, start, endA)
  ctx.stroke()

  ctx.strokeStyle = "#DC2626" // pending
  ctx.beginPath()
  ctx.arc(cx, cy, (rOuter + rInner) / 2, endA, start + Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = "#111827"
  ctx.font = "900 22px system-ui, -apple-system, Segoe UI, Roboto, Arial"
  const pctTxt = `${Math.round(aPct * 100)}%`
  const tw = ctx.measureText(pctTxt).width
  ctx.fillText(pctTxt, cx - tw / 2, cy + 6)

  ctx.fillStyle = "#111827"
  ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, Arial"
  const sub = "confirmed/closed"
  const sw = ctx.measureText(sub).width
  ctx.fillText(sub, cx - sw / 2, cy + 26)

  const lx = 300
  const ly = 170
  legendDot(ctx, lx, ly, "#16A34A", opts.aLabel, `${opts.aValue} of ${total}`)
  legendDot(ctx, lx, ly + 70, "#DC2626", opts.bLabel, `${opts.bValue} of ${total}`)

  return canvas.toDataURL("image/png")
}

function stackedTypeStatusChartPng(opts: {
  width: number
  height: number
  title: string
  subtitle: string
  items: Array<{ label: string; confirmed: number; pending: number }>
}) {
  const { width, height } = opts
  const { canvas, ctx } = makeCanvas(width, height)
  bg(ctx, width, height)
  titleBlock(ctx, opts.title, opts.subtitle, width)

  ctx.fillStyle = "#F9FAFB"
  roundedRect(ctx, 20, 80, width - 40, height - 110, 14)
  ctx.fill()
  ctx.strokeStyle = "#E5E7EB"
  ctx.stroke()

  const left = 60
  const top = 130
  const chartW = width - 120
  const chartH = height - 190

  const items = opts.items.slice(0, 8)
  const maxTotal = Math.max(
    1,
    ...items.map(i => safeNum(i.confirmed) + safeNum(i.pending))
  )

  // axes
  ctx.strokeStyle = "#D1D5DB"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(left, top)
  ctx.lineTo(left, top + chartH)
  ctx.lineTo(left + chartW, top + chartH)
  ctx.stroke()

  // legend
  legendDot(ctx, width - 320, 118, "#16A34A", "Confirmed/Closed", "")
  legendDot(ctx, width - 160, 118, "#DC2626", "Pending", "")

  const gap = 12
  const barH = Math.floor((chartH - gap * (items.length + 1)) / Math.max(1, items.length))
  const barStartY = top + gap

  items.forEach((it, idx) => {
    const c = safeNum(it.confirmed)
    const p = safeNum(it.pending)
    const total = c + p
    const y = barStartY + idx * (barH + gap)

    const wTotal = Math.round((total / maxTotal) * (chartW - 30))
    const wC = total > 0 ? Math.round((c / total) * wTotal) : 0
    const wP = Math.max(0, wTotal - wC)

    // confirmed segment
    ctx.fillStyle = "#16A34A"
    roundedRect(ctx, left + 1, y, Math.max(2, wC), barH, 8)
    ctx.fill()

    // pending segment (flat right)
    ctx.fillStyle = "#DC2626"
    ctx.fillRect(left + 1 + wC, y, Math.max(0, wP), barH)

    // label (white, inside first segment if big enough else above)
    const label = it.label.length > 44 ? it.label.slice(0, 41) + "..." : it.label
    ctx.font = "800 12px system-ui, -apple-system, Segoe UI, Roboto, Arial"

    if (wTotal >= 160) {
      ctx.fillStyle = "#FFFFFF"
      ctx.fillText(label, left + 10, y + Math.floor(barH * 0.7))
    } else {
      ctx.fillStyle = "#111827"
      ctx.fillText(label, left + 4, y - 4)
    }

    // numbers (always visible, dark)
    ctx.fillStyle = "#111827"
    ctx.font = "900 12px system-ui, -apple-system, Segoe UI, Roboto, Arial"
    ctx.fillText(`C:${c}  P:${p}  T:${total}`, left + Math.min(wTotal + 12, chartW - 10), y + Math.floor(barH * 0.7))
  })

  return canvas.toDataURL("image/png")
}

function gapVarianceChartPng(opts: {
  width: number
  height: number
  title: string
  subtitle: string
  required: number
  completed: number
  variance: number
}) {
  const { width, height } = opts
  const { canvas, ctx } = makeCanvas(width, height)
  bg(ctx, width, height)
  titleBlock(ctx, opts.title, opts.subtitle, width)

  ctx.fillStyle = "#F9FAFB"
  roundedRect(ctx, 20, 80, width - 40, height - 110, 14)
  ctx.fill()
  ctx.strokeStyle = "#E5E7EB"
  ctx.stroke()

  // big numbers
  const cards = [
    { label: "Required (Assigned)", value: opts.required, color: "#2563EB" },
    { label: "Completed (Confirmed/Closed)", value: opts.completed, color: "#16A34A" },
    { label: "Variance (Pending)", value: opts.variance, color: "#DC2626" }
  ]

  const startX = 40
  const startY = 110
  const cardW = Math.floor((width - 80 - 20) / 3)
  const cardH = 120

  cards.forEach((c, i) => {
    const x = startX + i * (cardW + 10)
    ctx.fillStyle = "#FFFFFF"
    roundedRect(ctx, x, startY, cardW, cardH, 14)
    ctx.fill()
    ctx.strokeStyle = "#E5E7EB"
    ctx.stroke()

    ctx.fillStyle = c.color
    ctx.font = "900 32px system-ui, -apple-system, Segoe UI, Roboto, Arial"
    ctx.fillText(String(c.value), x + 16, startY + 56)

    ctx.fillStyle = "#111827"
    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, Arial"
    ctx.fillText(c.label, x + 16, startY + 86)
  })

  // mini bar comparison
  const left = 60
  const top = 280
  const w = width - 120
  const h = 26
  const maxV = Math.max(1, opts.required)

  const reqW = Math.round((opts.required / maxV) * w)
  const compW = Math.round((opts.completed / maxV) * w)

  ctx.fillStyle = "#E5E7EB"
  roundedRect(ctx, left, top, w, h, 10)
  ctx.fill()

  ctx.fillStyle = "#2563EB"
  roundedRect(ctx, left, top, reqW, h, 10)
  ctx.fill()

  ctx.fillStyle = "#16A34A"
  roundedRect(ctx, left, top + 44, compW, h, 10)
  ctx.fill()

  ctx.fillStyle = "#111827"
  ctx.font = "800 12px system-ui, -apple-system, Segoe UI, Roboto, Arial"
  ctx.fillText("Required", left, top - 8)
  ctx.fillText("Completed", left, top + 36)

  // values right
  ctx.font = "900 12px system-ui, -apple-system, Segoe UI, Roboto, Arial"
  ctx.fillText(String(opts.required), left + w + 10, top + 18)
  ctx.fillText(String(opts.completed), left + w + 10, top + 62)

  return canvas.toDataURL("image/png")
}

export function buildMonthlyReportCharts(params: ChartBuildParams): ReportChartImage[] {
  const { interventions, periodLabel, departmentName } = params
  const total = interventions.length
  if (!total) return []

  // Current proxy (as implemented in your pipeline):
  // movAttached means: closed/confirmed OR has proof/docs/consultant complete.
  const confirmed = interventions.filter(i => !!i.movAttached).length
  const pending = total - confirmed

  // by type + status
  const map = new Map<string, { confirmed: number; pending: number }>()
  interventions.forEach(i => {
    const key = String(i.intervention || "Unknown").trim() || "Unknown"
    const prev = map.get(key) || { confirmed: 0, pending: 0 }
    if (i.movAttached) prev.confirmed += 1
    else prev.pending += 1
    map.set(key, prev)
  })

  const items = Array.from(map.entries())
    .map(([label, v]) => ({ label, confirmed: v.confirmed, pending: v.pending }))
    .sort((a, b) => (b.confirmed + b.pending) - (a.confirmed + a.pending))
    .slice(0, 8)

  const subtitle = `${departmentName} • ${periodLabel}`

  const donut = donutChartPng({
    width: 900,
    height: 420,
    title: "SME Confirmation Status",
    subtitle,
    aLabel: "Confirmed/Closed",
    aValue: confirmed,
    bLabel: "Pending SME Confirmation",
    bValue: pending
  })

  const stacked = stackedTypeStatusChartPng({
    width: 900,
    height: 560,
    title: "Interventions by Type (Status Split)",
    subtitle,
    items
  })

  const gap = gapVarianceChartPng({
    width: 900,
    height: 420,
    title: "Required vs Completed (Gap Variance)",
    subtitle,
    required: total,
    completed: confirmed,
    variance: pending
  })

  return [
    {
      key: "confirmation",
      title: "3.3.1 Confirmation Status",
      pngDataUrl: donut,
      caption: "Closed/confirmed interventions vs those still pending SME confirmation for the reporting period.",
      width: 620,
      height: 290
    },
    {
      key: "typeStatus",
      title: "3.3.2 Interventions by Type (Status Split)",
      pngDataUrl: stacked,
      caption: "Top intervention types with a split between confirmed/closed and pending SME confirmation.",
      width: 620,
      height: 380
    },
    {
      key: "gapVariance",
      title: "3.3.3 Required vs Completed (Gap Variance)",
      pngDataUrl: gap,
      caption: "Required = interventions assigned in the period. Completed = confirmed/closed. Variance = pending.",
      width: 620,
      height: 290
    }
  ]
}
