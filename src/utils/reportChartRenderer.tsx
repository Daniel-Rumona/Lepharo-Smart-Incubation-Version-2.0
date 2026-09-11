// src/utils/reportChartRenderer.ts
import Highcharts from "highcharts"

type RenderOpts = { width?: number; height?: number }

/**
 * Reliable browser-side renderer:
 * Highcharts.chart() -> SVG -> canvas -> PNG data URL
 */
export async function renderHighchartsToPngDataUrl(
    options: Highcharts.Options,
    renderOpts: RenderOpts = {}
): Promise<string> {
    const width = renderOpts.width ?? 860
    const height = renderOpts.height ?? 420

    // Offscreen container with a real size (critical)
    const el = document.createElement("div")
    el.style.position = "fixed"
    el.style.left = "-10000px"
    el.style.top = "0"
    el.style.width = `${width}px`
    el.style.height = `${height}px`
    el.style.background = "#ffffff"
    el.style.overflow = "hidden"
    document.body.appendChild(el)

    try {
        const chart = Highcharts.chart(el, {
            ...options,
            chart: {
                ...(options.chart as any),
                width,
                height,
                backgroundColor: "#ffffff",
                animation: false
            },
            credits: { enabled: false }
        })

        // Small tick to ensure layout/paint
        await new Promise(r => setTimeout(r, 40))

        const svg = chart.getSVG({
            exporting: { sourceWidth: width, sourceHeight: height } as any
        })

        chart.destroy()

        const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
        const url = URL.createObjectURL(svgBlob)

        const pngDataUrl = await new Promise<string>((resolve, reject) => {
            const img = new Image()
            img.onload = () => {
                const canvas = document.createElement("canvas")
                canvas.width = width
                canvas.height = height
                const ctx = canvas.getContext("2d")
                if (!ctx) {
                    URL.revokeObjectURL(url)
                    return reject(new Error("Canvas context not available"))
                }

                // Force white background (prevents transparent/blank look in docx)
                ctx.fillStyle = "#ffffff"
                ctx.fillRect(0, 0, width, height)
                ctx.drawImage(img, 0, 0, width, height)

                URL.revokeObjectURL(url)
                resolve(canvas.toDataURL("image/png"))
            }
            img.onerror = () => {
                URL.revokeObjectURL(url)
                reject(new Error("Failed to load SVG into Image"))
            }
            img.src = url
        })

        return pngDataUrl
    } finally {
        el.remove()
    }
}
