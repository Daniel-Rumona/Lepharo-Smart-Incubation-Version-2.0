import dayjs from "dayjs";
import Highcharts from "highcharts";
import DrilldownModule from "highcharts/modules/drilldown";
import { REPORT_CHART_COLORS } from "./reportChartTheme";

if (typeof DrilldownModule === "function") DrilldownModule(Highcharts);

export type ReachDrilldownActivity = {
  date: Date;
  interventionTitle: string;
  participantId?: string | null;
};

type BuildOptions = {
  monthKeys?: string[];
  height?: number;
  backgroundColor?: string;
  exporting?: boolean;
};

export const buildReachMonthlyDrilldownOptions = (
  activities: ReachDrilldownActivity[],
  options: BuildOptions = {}
): Highcharts.Options => {
  const touches = new Map<string, number>();
  const smes = new Map<string, Set<string>>();
  const interventions = new Map<string, Map<string, number>>();

  activities.forEach((activity) => {
    const monthKey = dayjs(activity.date).format("YYYY-MM");
    touches.set(monthKey, (touches.get(monthKey) || 0) + 1);

    if (activity.participantId) {
      const monthSmes = smes.get(monthKey) || new Set<string>();
      monthSmes.add(activity.participantId);
      smes.set(monthKey, monthSmes);
    }

    const monthInterventions =
      interventions.get(monthKey) || new Map<string, number>();
    const title = activity.interventionTitle.trim() || "Untitled";
    monthInterventions.set(title, (monthInterventions.get(title) || 0) + 1);
    interventions.set(monthKey, monthInterventions);
  });

  const monthKeys = options.monthKeys?.length
    ? options.monthKeys
    : Array.from(
        new Set([...touches.keys(), ...smes.keys(), ...interventions.keys()])
      ).sort();

  const monthPoints = (metric: "smes" | "touches") =>
    monthKeys.map((monthKey) => {
      const value =
        metric === "smes"
          ? smes.get(monthKey)?.size || 0
          : touches.get(monthKey) || 0;
      return {
        name: dayjs(`${monthKey}-01`).format("MMM YYYY"),
        y: value,
        drilldown: touches.get(monthKey)
          ? `reach-month::${monthKey}`
          : undefined,
      };
    });

  const drilldownSeries = monthKeys
    .filter((monthKey) => (touches.get(monthKey) || 0) > 0)
    .map((monthKey) => ({
      id: `reach-month::${monthKey}`,
      type: "bar" as const,
      name: `Interventions Delivered — ${dayjs(`${monthKey}-01`).format(
        "MMMM YYYY"
      )}`,
      color: REPORT_CHART_COLORS.success,
      data: Array.from(interventions.get(monthKey)?.entries() || [])
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => [name, count] as [string, number]),
    }));

  return {
    chart: {
      type: "column",
      height: options.height || 340,
      backgroundColor: options.backgroundColor,
    },
    title: { text: "" },
    credits: { enabled: false },
    exporting: { enabled: options.exporting ?? false },
    xAxis: { type: "category", title: { text: null } },
    yAxis: {
      min: 0,
      allowDecimals: false,
      title: { text: "Count" },
    },
    tooltip: { shared: false },
    plotOptions: {
      column: {
        borderRadius: 4,
        dataLabels: { enabled: true },
      },
      bar: {
        borderRadius: 4,
        dataLabels: { enabled: true },
      },
    },
    series: [
      {
        type: "column",
        name: "SMEs Reached",
        color: REPORT_CHART_COLORS.primary,
        data: monthPoints("smes"),
      },
      {
        type: "column",
        name: "Interventions Delivered",
        color: REPORT_CHART_COLORS.success,
        data: monthPoints("touches"),
      },
    ],
    drilldown: {
      allowPointDrilldown: true,
      breadcrumbs: {
        showFullPath: false,
        position: { align: "right" },
      },
      series: drilldownSeries,
    },
  };
};
