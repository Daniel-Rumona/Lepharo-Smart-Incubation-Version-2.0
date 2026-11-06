import type Highcharts from 'highcharts'

/**
 * Data label options that are valid on every cartesian chart type the app
 * uses. Shared label helpers feed column, bar, spline and generic series
 * charts, and each has its own (slightly different) label type in Highcharts
 * 13 — an intersection type satisfies all of them.
 */
export type ChartDataLabels = Highcharts.PlotColumnDataLabelsOptions &
    Highcharts.PlotBarDataLabelsOptions &
    Highcharts.PlotSplineDataLabelsOptions &
    Highcharts.PlotSeriesDataLabelsOptions

/**
 * The point a label or tooltip formatter is describing. Highcharts 12+ passes
 * the point itself as `this`; older versions passed a wrapper with `.point`.
 * Accepts either, so formatters work on both.
 *
 *     formatter() { const p = formatterPoint(this); return `${p.name}: ${p.y}` }
 */
export const formatterPoint = <T extends object = Record<string, unknown>>(
    context: unknown
): Highcharts.Point & T =>
    (((context as { point?: Highcharts.Point }).point ?? context) as Highcharts.Point & T)
