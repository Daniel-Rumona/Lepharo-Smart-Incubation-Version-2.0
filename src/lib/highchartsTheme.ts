import Highcharts from "highcharts";
import type { ResolvedColorMode } from "@/contexts/ThemeContext";

/**
 * Highcharts theming.
 *
 * Highcharts writes its colours as inline SVG attributes, so CSS alone can only
 * ever half-fix it. This registers a real Highcharts theme instead:
 *   - Highcharts.setOptions() for every chart created from here on
 *   - chart.update() across Highcharts.charts for the ones already on screen
 *
 * Imported statically because ~60 modules already import Highcharts directly, so
 * it is in the main chunk regardless — and the theme has to be registered before
 * a chart is constructed for that chart to pick it up.
 */

const DARK = {
    text: "rgba(255, 255, 255, 0.88)",
    textMuted: "rgba(255, 255, 255, 0.62)",
    grid: "rgba(255, 255, 255, 0.10)",
    line: "rgba(255, 255, 255, 0.18)",
    tooltipBg: "rgba(31, 36, 45, 0.96)",
    tooltipBorder: "rgba(255, 255, 255, 0.14)",
};

const LIGHT = {
    text: "#333333",
    textMuted: "#666666",
    grid: "#e6e6e6",
    line: "#ccd6eb",
    tooltipBg: "rgba(247, 247, 247, 0.96)",
    tooltipBorder: "#cccccc",
};

const buildTheme = (mode: ResolvedColorMode) => {
    const c = mode === "dark" ? DARK : LIGHT;

    return {
        chart: {
            // Transparent rather than a dark colour: the themed panel behind the
            // chart already supplies the surface, which keeps a chart correct
            // whether it sits on a card, in a modal or inside a table cell.
            backgroundColor: "transparent",
            style: { color: c.text },
        },
        title: { style: { color: c.text } },
        subtitle: { style: { color: c.textMuted } },
        xAxis: {
            gridLineColor: c.grid,
            lineColor: c.line,
            tickColor: c.line,
            labels: { style: { color: c.textMuted } },
            title: { style: { color: c.textMuted } },
        },
        yAxis: {
            gridLineColor: c.grid,
            lineColor: c.line,
            tickColor: c.line,
            labels: { style: { color: c.textMuted } },
            title: { style: { color: c.textMuted } },
        },
        legend: {
            itemStyle: { color: c.text },
            itemHoverStyle: { color: mode === "dark" ? "#ffffff" : "#000000" },
            itemHiddenStyle: { color: mode === "dark" ? "rgba(255,255,255,0.28)" : "#cccccc" },
        },
        tooltip: {
            backgroundColor: c.tooltipBg,
            borderColor: c.tooltipBorder,
            style: { color: c.text },
        },
        plotOptions: {
            series: {
                dataLabels: { color: c.text },
                // Slice/column separators are drawn in the page colour; on dark
                // a white hairline round every wedge is exactly the "weird" look.
                borderColor: mode === "dark" ? "transparent" : "#ffffff",
            },
        },
        labels: { style: { color: c.textMuted } },
        credits: { style: { color: c.textMuted } },
        drilldown: {
            activeAxisLabelStyle: { color: c.text },
            activeDataLabelStyle: { color: c.text },
        },
        noData: { style: { color: c.textMuted } },
    };
};

let lastApplied: ResolvedColorMode | null = null;

export const applyHighchartsTheme = (mode: ResolvedColorMode): void => {
    if (lastApplied === mode) return;

    const theme = buildTheme(mode);
    Highcharts.setOptions(theme as Highcharts.Options);
    lastApplied = mode;

    // setOptions only affects charts created afterwards, so repaint the mounted
    // ones too — otherwise nothing on the current page changes until you navigate.
    (Highcharts.charts || []).forEach((chart) => {
        if (!chart) return;
        try {
            chart.update(theme as Highcharts.Options, true, true);
        } catch {
            // A chart mid-teardown can throw here; it gets themed on remount.
        }
    });
};
