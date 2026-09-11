import PptxGenJS from "pptxgenjs";
import { saveAs } from "file-saver";
import dayjs from "dayjs";
import {
  FeatureGovernanceRecord,
  GovernanceChallenge,
  GovernanceMeeting,
} from "@/types/featureGovernance";

const statusLabel: Record<string, string> = {
  submitted: "Under review",
  planned: "Planned",
  "in-progress": "In progress",
  blocked: "At risk",
  released: "Completed",
};
const roleLabel: Record<string, string> = {
  admin: "System Administrators",
  director: "CEO",
  operations: "Heads Of Departments",
  projectmanager: "Employee",
  projectadmin: "Center Coordinators",
  receptionist: "Receptionists",
  consultant: "Employee",
  auxiliary: "Employee",
  employee: "Employee",
  incubatee: "SMEs",
  funder: "Funders",
  government: "Government Stakeholders",
  headofdepartment: "Heads Of Departments",
};

const colors = {
  ink: "171321",
  muted: "5F6472",
  line: "D9DCE7",
  soft: "F6F7FB",
  primary: "243FFF",
  purple: "814DFF",
  orange: "D94B5A",
  redBg: "C94B5E",
  redDark: "A93D52",
  pink: "FF1F85",
  white: "FFFFFF",
};

export type FeatureGovernanceReportRange = {
  label: string;
  startDate?: string;
  endDate?: string;
};

type TableCell = string | { text: string; options?: Record<string, unknown> };

const inRange = (
  value: string | undefined | null,
  range?: FeatureGovernanceReportRange
) => {
  if (!range?.startDate && !range?.endDate) return true;
  if (!value) return false;
  const date = dayjs(value);
  if (!date.isValid()) return false;
  const start = range.startDate ? dayjs(range.startDate).startOf("day") : null;
  const end = range.endDate ? dayjs(range.endDate).endOf("day") : null;
  return (!start || !date.isBefore(start)) && (!end || !date.isAfter(end));
};

const firstAvailableDate = (record: FeatureGovernanceRecord) => {
  if (record.dueDate) return record.dueDate;
  const updated = record.updatedAt?.toDate?.();
  const created = record.createdAt?.toDate?.();
  return updated
    ? dayjs(updated).format("YYYY-MM-DD")
    : created
    ? dayjs(created).format("YYYY-MM-DD")
    : undefined;
};

const clean = (value: unknown, fallback = "Not recorded") =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim() || fallback;

const trim = (value: unknown, max = 95, fallback = "Not recorded") => {
  const text = clean(value, fallback);
  if (text.length <= max) return text;
  const shortened = text.slice(0, max);
  const lastSpace = shortened.lastIndexOf(" ");
  return lastSpace > max * 0.72 ? shortened.slice(0, lastSpace) : shortened;
};

const normalizeRole = (role: string) =>
  roleLabel[
    String(role || "")
      .toLowerCase()
      .replace(/[\s_-]/g, "")
  ] || role;

const normalizeChallenges = (
  value: GovernanceMeeting["challenges"]
): GovernanceChallenge[] => {
  if (Array.isArray(value))
    return value
      .filter((item) => item?.text?.trim())
      .map((item, index) => ({
        id: item.id || `legacy-${index}`,
        text: item.text.trim(),
        status: item.status === "resolved" ? "resolved" : "open",
      }));
  return String(value || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((text, index) => ({
      id: `legacy-${index}`,
      text,
      status: "open" as const,
    }));
};

const roleList = (roles: string[] = []) => {
  const labels = Array.from(new Set(roles.map(normalizeRole).filter(Boolean)));
  return labels.length ? labels.join(", ") : "Not specified";
};

const programScope = (record: FeatureGovernanceRecord) => {
  if (!record.programSpecific) return "System-wide";
  if (record.appliesToAllPrograms) return "Program-specific | All programs";
  return "Program-specific | Selected program";
};

const imageToDataUri = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) return undefined;
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const chunk = <T>(items: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result.length ? result : [[]];
};

const cell = (
  text: string,
  options: Record<string, unknown> = {}
): TableCell => ({ text, options });

const headerCell = (text: string): TableCell =>
  cell(text, {
    bold: true,
    color: colors.white,
    fill: { color: colors.ink },
    margin: 0.07,
    valign: "mid",
  });

const bodyCell = (
  text: string,
  options: Record<string, unknown> = {}
): TableCell =>
  cell(text, {
    color: colors.ink,
    margin: 0.07,
    valign: "top",
    breakLine: false,
    ...options,
  });

const sectionIcon: Record<string, "check" | "arrow" | "calendar" | "warning"> =
  {
    "EXECUTIVE SUMMARY": "calendar",
    "MEETING REGISTER": "calendar",
    "COMPLETED DELIVERY": "check",
    "PIPELINE REGISTER": "arrow",
    "CHALLENGE REGISTER": "warning",
    "REPORT AT A GLANCE": "check",
  };

export async function generateFeatureGovernancePptx(
  records: FeatureGovernanceRecord[],
  names: {
    departments: Record<string, string>;
    branches: Record<string, string>;
  },
  savedMeetings: GovernanceMeeting[] = [],
  range?: FeatureGovernanceReportRange
) {
  const allMeetings = [
    ...savedMeetings,
    ...records.flatMap((record) =>
      (record.meetings || []).map(
        (meeting) =>
          ({
            ...meeting,
            relatedFeatureIds: [record.id],
            createdFeatureIds: [],
            createdBy: record.createdBy,
            createdByName: record.createdByName,
          } as GovernanceMeeting)
      )
    ),
  ];

  const rangeLabel = range?.label || "All time";
  const reportRecords = records.filter((record) =>
    inRange(firstAvailableDate(record), range)
  );
  const reportMeetings = allMeetings.filter((meeting) =>
    inRange(meeting.meetingDate || meeting.dueDate, range)
  );
  const held = reportMeetings
    .filter((meeting) => meeting.status === "held")
    .sort((a, b) => (a.meetingDate || "").localeCompare(b.meetingDate || ""));
  const completed = reportRecords.filter(
    (record) => record.status === "released"
  );
  const pipeline = records.filter((record) => record.status !== "released");
  const challengeRows = reportMeetings.flatMap((meeting) =>
    normalizeChallenges(meeting.challenges).map((challenge) => ({
      challenge: challenge.text,
      meeting: meeting.title,
      owner: meeting.withName,
      due: meeting.dueDate,
    }))
  );

  const scope = (record: FeatureGovernanceRecord) => {
    const departments = record.audience.allDepartments
      ? "All departments"
      : record.audience.departmentIds
          .map((id) => names.departments[id] || id)
          .join(", ");
    const centres = record.audience.allBranches
      ? "All centres"
      : record.audience.branchIds
          .map((id) => names.branches[id] || id)
          .join(", ");
    return (
      [departments, centres].filter(Boolean).join(" | ") || "Organisation-wide"
    );
  };

  const galaxyImage = await imageToDataUri("/templates/galaxy-mountain.png");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "LPH Smart Inc";
  pptx.company = "LPH Smart Inc";
  pptx.subject = "Feature Delivery Report";
  pptx.title = "Feature Delivery Report";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang: "en-US",
  };

  const addChrome = (
    slide: PptxGenJS.Slide,
    title: string,
    subtitle?: string
  ) => {
    slide.background = { color: colors.redBg };
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.55,
      y: 0.52,
      w: 12.23,
      h: 6.62,
      rectRadius: 0.08,
      line: { color: colors.white, transparency: 100 },
      fill: { color: colors.white },
      shadow: {
        type: "outer",
        color: "6B1F31",
        opacity: 0.26,
        blur: 2,
        angle: 45,
        distance: 3,
      },
    } as any);
    const icon = sectionIcon[title];
    if (icon) addMetricIcon(slide, 0.9, 0.82, colors.orange, icon);
    slide.addText("+", {
      x: 11.38,
      y: 0.78,
      w: 0.2,
      h: 0.18,
      fontSize: 12,
      bold: true,
      color: colors.primary,
      margin: 0,
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 12.0,
      y: 0.88,
      w: 0.06,
      h: 0.06,
      line: { color: colors.primary, transparency: 100 },
      fill: { color: colors.primary },
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 12.28,
      y: 1.3,
      w: 0.11,
      h: 0.11,
      line: { color: colors.primary, width: 1 },
      fill: { color: colors.white, transparency: 100 },
    });
    slide.addText(title, {
      x: icon ? 1.48 : 0.9,
      y: 0.76,
      w: 8.15,
      h: 0.42,
      fontFace: "Georgia",
      fontSize: 22,
      bold: true,
      color: colors.ink,
      margin: 0,
    });
    if (subtitle)
      slide.addText(subtitle, {
        x: icon ? 1.5 : 0.92,
        y: 1.18,
        w: 8.1,
        h: 0.26,
        fontSize: 8.8,
        color: colors.muted,
        margin: 0,
      });
    slide.addText("FEATURE DELIVERY REPORT", {
      x: 10.0,
      y: 0.96,
      w: 2.3,
      h: 0.2,
      fontSize: 6.8,
      bold: true,
      color: colors.primary,
      align: "right",
      margin: 0,
    });
    slide.addShape(pptx.ShapeType.line, {
      x: 0.9,
      y: 1.52,
      w: 11.45,
      h: 0,
      line: { color: colors.line, width: 0.6 },
    });
  };

  const addGradientBlock = (
    slide: PptxGenJS.Slide,
    x: number,
    y: number,
    w: number,
    h: number
  ) => {
    slide.addShape(pptx.ShapeType.rect, {
      x,
      y,
      w: w * 0.52,
      h,
      line: { color: colors.primary, transparency: 100 },
      fill: { color: colors.primary },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: x + w * 0.48,
      y,
      w: w * 0.52,
      h,
      line: { color: colors.orange, transparency: 100 },
      fill: { color: colors.orange },
    });
  };

  const addSectionDivider = (title: string, subtitle: string) => {
    const slide = pptx.addSlide();
    addGradientBlock(slide, 0, 0, 13.33, 7.5);
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.45,
      y: 1.1,
      w: 0.03,
      h: 4.75,
      line: { color: colors.white, transparency: 100 },
      fill: { color: colors.white, transparency: 15 },
    });
    if (galaxyImage)
      slide.addImage({
        data: galaxyImage,
        x: 9.25,
        y: 1.35,
        w: 2.55,
        h: 2.55,
      } as any);
    slide.addText("+", {
      x: 9.05,
      y: 0.82,
      w: 0.2,
      h: 0.18,
      fontSize: 12,
      bold: true,
      color: colors.white,
      margin: 0,
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 9.38,
      y: 1.02,
      w: 0.05,
      h: 0.05,
      line: { color: colors.white, transparency: 100 },
      fill: { color: colors.white },
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 9.62,
      y: 1.26,
      w: 0.1,
      h: 0.1,
      line: { color: colors.white, width: 1 },
      fill: { color: colors.white, transparency: 100 },
    });
    slide.addText(title, {
      x: 0.85,
      y: 3.0,
      w: 6.8,
      h: 0.7,
      fontFace: "Aptos Display",
      fontSize: 25,
      bold: true,
      color: colors.white,
      margin: 0,
      breakLine: false,
    });
    slide.addText(subtitle, {
      x: 0.88,
      y: 3.78,
      w: 6.4,
      h: 0.28,
      fontSize: 10.5,
      color: colors.white,
      margin: 0,
      breakLine: false,
      transparency: 15,
    } as any);
    addFooter(slide, slideNumber++, true);
  };

  const addFooter = (slide: PptxGenJS.Slide, index: number, light = false) => {
    slide.addText(rangeLabel, {
      x: 0.8,
      y: 7.05,
      w: 8.8,
      h: 0.18,
      fontSize: 7.5,
      color: colors.white,
      margin: 0,
      transparency: light ? 18 : 8,
    } as any);
    slide.addText(String(index).padStart(2, "0"), {
      x: 11.9,
      y: 7.02,
      w: 0.6,
      h: 0.18,
      fontSize: 7.5,
      color: colors.white,
      bold: true,
      align: "right",
      margin: 0,
    });
  };

  const addTable = (
    slide: PptxGenJS.Slide,
    rows: TableCell[][],
    y: number,
    colW: number[],
    rowH: number[]
  ) => {
    slide.addTable(
      rows as any,
      {
        x: 0.9,
        y,
        w: 11.45,
        colW,
        rowH,
        fontFace: "Aptos",
        fontSize: 10.2,
        color: colors.ink,
        border: { type: "solid", color: colors.line, pt: 0.65 },
        autoFit: false,
        valign: "top",
        margin: 0.06,
      } as any
    );
  };

  const addEmpty = (slide: PptxGenJS.Slide, message: string) => {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.82,
      y: 1.65,
      w: 11.65,
      h: 1.1,
      line: { color: colors.line, width: 0.8 },
      fill: { color: colors.soft },
    });
    slide.addText(message, {
      x: 1.05,
      y: 2.02,
      w: 11.1,
      h: 0.22,
      fontSize: 12,
      bold: true,
      color: colors.muted,
      align: "center",
      margin: 0,
    });
  };

  const addMetricIcon = (
    slide: PptxGenJS.Slide,
    x: number,
    y: number,
    accent: string,
    icon: "check" | "arrow" | "calendar" | "warning"
  ) => {
    slide.addShape(pptx.ShapeType.ellipse, {
      x,
      y,
      w: 0.42,
      h: 0.42,
      line: { color: accent, transparency: 100 },
      fill: { color: accent },
    });
    if (icon === "check") {
      slide.addShape(pptx.ShapeType.line, {
        x: x + 0.11,
        y: y + 0.23,
        w: 0.08,
        h: 0.08,
        line: { color: colors.white, width: 1.4 },
      });
      slide.addShape(pptx.ShapeType.line, {
        x: x + 0.19,
        y: y + 0.31,
        w: 0.14,
        h: -0.18,
        line: { color: colors.white, width: 1.4 },
      });
    } else if (icon === "arrow") {
      slide.addShape(pptx.ShapeType.rightArrow, {
        x: x + 0.1,
        y: y + 0.15,
        w: 0.22,
        h: 0.13,
        line: { color: colors.white, transparency: 100 },
        fill: { color: colors.white },
      });
    } else if (icon === "calendar") {
      slide.addShape(pptx.ShapeType.rect, {
        x: x + 0.1,
        y: y + 0.12,
        w: 0.22,
        h: 0.22,
        line: { color: colors.white, width: 1 },
        fill: { color: accent, transparency: 100 },
      });
      slide.addShape(pptx.ShapeType.rect, {
        x: x + 0.1,
        y: y + 0.12,
        w: 0.22,
        h: 0.06,
        line: { color: colors.white, transparency: 100 },
        fill: { color: colors.white },
      });
      slide.addShape(pptx.ShapeType.line, {
        x: x + 0.15,
        y: y + 0.09,
        w: 0,
        h: 0.07,
        line: { color: colors.white, width: 1 },
      });
      slide.addShape(pptx.ShapeType.line, {
        x: x + 0.27,
        y: y + 0.09,
        w: 0,
        h: 0.07,
        line: { color: colors.white, width: 1 },
      });
    } else {
      slide.addShape(pptx.ShapeType.triangle, {
        x: x + 0.1,
        y: y + 0.11,
        w: 0.23,
        h: 0.23,
        rotate: 0,
        line: { color: colors.white, transparency: 100 },
        fill: { color: colors.white },
      });
      slide.addShape(pptx.ShapeType.line, {
        x: x + 0.215,
        y: y + 0.17,
        w: 0,
        h: 0.08,
        line: { color: accent, width: 1 },
      });
      slide.addShape(pptx.ShapeType.ellipse, {
        x: x + 0.2,
        y: y + 0.27,
        w: 0.03,
        h: 0.03,
        line: { color: accent, transparency: 100 },
        fill: { color: accent },
      });
    }
  };

  const addMetric = (
    slide: PptxGenJS.Slide,
    x: number,
    label: string,
    value: string,
    accent: string,
    icon?: "check" | "arrow" | "calendar" | "warning"
  ) => {
    slide.addShape(pptx.ShapeType.rect, {
      x,
      y: 2.55,
      w: 2.55,
      h: 1.08,
      rectRadius: 0.06,
      line: { color: colors.line, width: 0.8 },
      fill: { color: colors.white },
    } as any);
    slide.addShape(pptx.ShapeType.rect, {
      x,
      y: 2.55,
      w: 0.08,
      h: 1.08,
      line: { color: accent, transparency: 100 },
      fill: { color: accent },
    });
    if (icon) {
      addMetricIcon(slide, x + 0.22, 2.78, accent, icon);
    }
    slide.addText(value, {
      x: x + (icon ? 0.78 : 0.22),
      y: 2.76,
      w: icon ? 1.3 : 1.9,
      h: 0.34,
      fontSize: 23,
      bold: true,
      color: colors.ink,
      margin: 0,
    });
    slide.addText(label, {
      x: x + 0.22,
      y: 3.16,
      w: 2.05,
      h: 0.22,
      fontSize: 8.8,
      color: colors.muted,
      margin: 0,
    });
  };

  let slideNumber = 1;
  const cover = pptx.addSlide();
  cover.background = { color: colors.white };
  addGradientBlock(cover, 0, 0, 13.33, 7.5);
  cover.addShape(pptx.ShapeType.rect, {
    x: 0.45,
    y: 1.3,
    w: 0.03,
    h: 4.55,
    line: { color: colors.white, transparency: 100 },
    fill: { color: colors.white, transparency: 15 },
  });
  if (galaxyImage)
    cover.addImage({
      data: galaxyImage,
      x: 1.35,
      y: 1.45,
      w: 2.85,
      h: 2.85,
    } as any);
  cover.addText("+", {
    x: 4.45,
    y: 1.15,
    w: 0.28,
    h: 0.24,
    fontSize: 16,
    bold: true,
    color: colors.white,
    margin: 0,
  });
  cover.addShape(pptx.ShapeType.ellipse, {
    x: 4.82,
    y: 1.42,
    w: 0.06,
    h: 0.06,
    line: { color: colors.white, transparency: 100 },
    fill: { color: colors.white },
  });
  cover.addShape(pptx.ShapeType.ellipse, {
    x: 5.08,
    y: 1.7,
    w: 0.11,
    h: 0.11,
    line: { color: colors.white, width: 1 },
    fill: { color: colors.white, transparency: 100 },
  });
  cover.addText("FEATURE DELIVERY REPORT", {
    x: 6.35,
    y: 2.25,
    w: 5.75,
    h: 0.55,
    fontFace: "Aptos Display",
    fontSize: 24,
    bold: true,
    color: colors.white,
    margin: 0,
    align: "right",
  });
  cover.addText(rangeLabel, {
    x: 6.35,
    y: 2.9,
    w: 5.75,
    h: 0.28,
    fontSize: 11,
    color: colors.white,
    margin: 0,
    align: "right",
    transparency: 10,
  } as any);
  cover.addText(`Generated ${dayjs().format("DD MMM YYYY")}`, {
    x: 6.35,
    y: 3.26,
    w: 5.75,
    h: 0.22,
    fontSize: 9,
    color: colors.white,
    bold: true,
    margin: 0,
    align: "right",
  });
  addFooter(cover, slideNumber++, true);

  const summary = pptx.addSlide();
  addChrome(
    summary,
    "EXECUTIVE SUMMARY",
    "Management view of the selected reporting period"
  );
  addTable(
    summary,
    [
      [
        headerCell("Measure"),
        headerCell("Current"),
        headerCell("Management read"),
      ],
      [
        bodyCell("Report period"),
        bodyCell(rangeLabel, { bold: true }),
        bodyCell("All report registers use this date range."),
      ],
      [
        bodyCell("Meetings held"),
        bodyCell(String(held.length), { bold: true, color: colors.primary }),
        bodyCell(
          held.length
            ? "Governance engagements recorded and available in the meeting register."
            : "No completed meetings were recorded for the period."
        ),
      ],
      [
        bodyCell("Completed delivery"),
        bodyCell(String(completed.length), {
          bold: true,
          color: colors.purple,
        }),
        bodyCell(
          completed.length
            ? "Delivered features are listed with audience and scope."
            : "No completed delivery was recorded for the period."
        ),
      ],
      [
        bodyCell("Pipeline"),
        bodyCell(String(pipeline.length), { bold: true, color: colors.orange }),
        bodyCell(
          pipeline.length
            ? "Active incomplete items are shown regardless of when they were added."
            : "No active pipeline items were recorded."
        ),
      ],
      [
        bodyCell("Challenges"),
        bodyCell(String(challengeRows.length), {
          bold: true,
          color: colors.pink,
        }),
        bodyCell(
          challengeRows.length
            ? "Open delivery risks are listed in the challenge register."
            : "No challenges were recorded for the period."
        ),
      ],
    ],
    1.55,
    [3.0, 1.35, 7.3],
    [0.48, 0.72, 0.72, 0.72, 0.72, 0.72]
  );
  addFooter(summary, slideNumber++);

  addSectionDivider(
    "MEETING REGISTER",
    "Completed governance engagements and recorded outcomes"
  );
  chunk(held, 4).forEach((items, pageIndex) => {
    const slide = pptx.addSlide();
    addChrome(
      slide,
      "MEETING REGISTER",
      `${held.length} completed meeting${held.length === 1 ? "" : "s"}${
        held.length > 4 ? ` | Page ${pageIndex + 1}` : ""
      }`
    );
    if (!items.length)
      addEmpty(slide, "No meetings held during this reporting period.");
    else
      addTable(
        slide,
        [
          [
            headerCell("Date"),
            headerCell("Meeting"),
            headerCell("With"),
            headerCell("Outcome"),
            headerCell("Follow-up"),
          ],
          ...items.map((meeting) => [
            bodyCell(
              meeting.meetingDate
                ? dayjs(meeting.meetingDate).format("DD MMM YYYY")
                : "No date",
              { bold: true }
            ),
            bodyCell(trim(meeting.title, 68)),
            bodyCell(trim(meeting.withName, 40)),
            bodyCell(trim(meeting.discussion, 145, "No outcome recorded")),
            bodyCell(
              meeting.dueDate
                ? dayjs(meeting.dueDate).format("DD MMM YYYY")
                : "Not set"
            ),
          ]),
        ],
        1.48,
        [1.25, 2.55, 1.65, 4.6, 1.6],
        [0.48, ...items.map(() => 1.08)]
      );
    addFooter(slide, slideNumber++);
  });

  addSectionDivider(
    "COMPLETED DELIVERY",
    "Delivered system and program-specific improvements"
  );
  chunk(completed, 3).forEach((items, pageIndex) => {
    const slide = pptx.addSlide();
    addChrome(
      slide,
      "COMPLETED DELIVERY",
      `${completed.length} completed feature${
        completed.length === 1 ? "" : "s"
      }${completed.length > 3 ? ` | Page ${pageIndex + 1}` : ""}`
    );
    if (!items.length)
      addEmpty(
        slide,
        "No completed features recorded during this reporting period."
      );
    else
      addTable(
        slide,
        [
          [
            headerCell("Feature"),
            headerCell("Purpose"),
            headerCell("Audience"),
            headerCell("Scope"),
          ],
          ...items.map((record) => [
            bodyCell(trim(record.title, 64), { bold: true }),
            bodyCell(trim(record.description, 170)),
            bodyCell(trim(roleList(record.audience.roles), 74)),
            bodyCell(`${trim(scope(record), 86)}\n${programScope(record)}`),
          ]),
        ],
        1.48,
        [2.35, 4.55, 2.25, 2.5],
        [0.48, ...items.map(() => 1.38)]
      );
    addFooter(slide, slideNumber++);
  });

  addSectionDivider(
    "PIPELINE REGISTER",
    "Active items tracked through to completion"
  );
  chunk(pipeline, 3).forEach((items, pageIndex) => {
    const slide = pptx.addSlide();
    addChrome(
      slide,
      "PIPELINE REGISTER",
      `${pipeline.length} active feature${pipeline.length === 1 ? "" : "s"}${
        pipeline.length > 3 ? ` | Page ${pageIndex + 1}` : ""
      }`
    );
    if (!items.length)
      addEmpty(slide, "No features currently in the delivery pipeline.");
    else
      addTable(
        slide,
        [
          [
            headerCell("Feature"),
            headerCell("Status"),
            headerCell("Progress"),
            headerCell("Projected finish"),
            headerCell("Audience / Scope"),
          ],
          ...items.map((record) => [
            bodyCell(
              `${trim(record.title, 70)}\n${trim(record.description, 130)}`,
              { bold: false }
            ),
            bodyCell(statusLabel[record.status] || record.status, {
              bold: true,
              color: record.status === "blocked" ? colors.pink : colors.primary,
            }),
            bodyCell(`${record.progress || 0}%`, {
              bold: true,
              align: "center",
            }),
            bodyCell(
              record.dueDate
                ? dayjs(record.dueDate).format("DD MMM YYYY")
                : "Not scheduled"
            ),
            bodyCell(
              `${trim(roleList(record.audience.roles), 64)}\n${trim(
                scope(record),
                64
              )}\n${programScope(record)}`
            ),
          ]),
        ],
        1.48,
        [3.55, 1.35, 1.0, 1.35, 4.4],
        [0.48, ...items.map(() => 1.38)]
      );
    addFooter(slide, slideNumber++);
  });

  addSectionDivider(
    "CHALLENGE REGISTER",
    "Delivery risks and follow-up accountability"
  );
  chunk(challengeRows, 4).forEach((items, pageIndex) => {
    const slide = pptx.addSlide();
    addChrome(
      slide,
      "CHALLENGE REGISTER",
      `${challengeRows.length} recorded challenge${
        challengeRows.length === 1 ? "" : "s"
      }${challengeRows.length > 4 ? ` | Page ${pageIndex + 1}` : ""}`
    );
    if (!items.length)
      addEmpty(
        slide,
        "No delivery challenges recorded during this reporting period."
      );
    else
      addTable(
        slide,
        [
          [
            headerCell("Challenge"),
            headerCell("Raised in"),
            headerCell("Owner"),
            headerCell("Due"),
          ],
          ...items.map((item) => [
            bodyCell(trim(item.challenge, 165), { bold: true }),
            bodyCell(trim(item.meeting, 78)),
            bodyCell(trim(item.owner, 42)),
            bodyCell(
              item.due ? dayjs(item.due).format("DD MMM YYYY") : "Not set"
            ),
          ]),
        ],
        1.48,
        [5.2, 3.0, 1.9, 1.55],
        [0.48, ...items.map(() => 1.08)]
      );
    addFooter(slide, slideNumber++);
  });

  const closing = pptx.addSlide();
  addChrome(closing, "REPORT AT A GLANCE", "Summary for executive review");
  addMetric(
    closing,
    0.9,
    "Completed",
    String(completed.length),
    colors.purple,
    "check"
  );
  addMetric(
    closing,
    3.72,
    "In pipeline",
    String(pipeline.length),
    colors.orange,
    "arrow"
  );
  addMetric(
    closing,
    6.54,
    "Meetings held",
    String(held.length),
    colors.primary,
    "calendar"
  );
  addMetric(
    closing,
    9.36,
    "Challenges",
    String(challengeRows.length),
    colors.pink,
    "warning"
  );
  addTable(
    closing,
    [
      [headerCell("Area"), headerCell("Next management focus")],
      [
        bodyCell("Delivery"),
        bodyCell(
          pipeline.length
            ? "Review active pipeline items and update progress until completion."
            : "Maintain completed delivery record and capture new pipeline items as they arise."
        ),
      ],
      [
        bodyCell("Governance"),
        bodyCell(
          held.length
            ? "Use meeting register outcomes to drive follow-up accountability."
            : "Schedule governance meetings and capture outcomes for the next report."
        ),
      ],
      [
        bodyCell("Risks"),
        bodyCell(
          challengeRows.length
            ? "Assign owners and dates to all recorded challenges."
            : "Continue monitoring for delivery blockers."
        ),
      ],
    ],
    4.18,
    [2.1, 9.55],
    [0.48, 0.76, 0.76, 0.76]
  );
  addFooter(closing, slideNumber++);

  const blob = (await pptx.write({ outputType: "blob" })) as Blob;
  saveAs(blob, `feature-delivery-report-${dayjs().format("YYYY-MM-DD")}.pptx`);
}
