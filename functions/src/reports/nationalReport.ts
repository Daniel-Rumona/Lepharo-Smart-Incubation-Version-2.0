import { db } from "../firebase";
import { addAgenda, addClosing, addCover, AREA, BLUE, chunk, deckBuffer, FONT, headerCell, imageData, MAROON, newDeck, TEXT } from "./deck";
import { personOf, Requester } from "./executiveReport";
import { clean, dateLabel, monthBounds, monthLabel, sastDateKey, shortDateLabel } from "./lib";

/**
 * The centre's National Report: interventions progress for the centre coordinator's own centre, presented at
 * the national meeting (Lepharo has centres across the country). The centre's programmes are those whose
 * branch is the coordinator's (as the programme picker scopes them); everything else follows from their
 * assigned interventions and sessions.
 */

const STALLED_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const lower = (value: unknown) => clean(value).toLowerCase();

const programBranchId = (data: any) =>
  clean(data.normalizedAssignedBranchId) || clean(data.branchId) ||
  clean(typeof data.assignedBranch === "object" && data.assignedBranch ? data.assignedBranch.id : data.assignedBranch);

type Stage = "completed" | "in-progress" | "assigned" | "reassign" | "closed";

/** Where an intervention stands, from its assignmentStatus (spelled several ways over time). */
export const stageOf = (assignment: any): Stage => {
  const status = lower(assignment.assignmentStatus).replace(/[\s_]+/g, "-");
  if (["cancelled", "declined", "rejected"].includes(status)) return "closed";
  if (status === "completed" || lower(assignment.participantCompletionStatus) === "confirmed") return "completed";
  if (status.includes("reassign")) return "reassign";
  if (["in-progress", "active", "ongoing", "started"].includes(status)) return "in-progress";
  return "assigned";
};

const progressOf = (assignment: any) => {
  if (stageOf(assignment) === "completed") return 100;
  return Math.max(0, Math.min(100, Number(assignment.computedProgress ?? assignment.progress ?? 0) || 0));
};

const millis = (value: any) => value?.toMillis?.() ?? (value ? new Date(value).getTime() || 0 : 0);

/** The last time anything happened on an intervention. */
const lastActivity = (assignment: any) => Math.max(
  millis(assignment.updatedAt),
  millis(assignment.lastAppointmentAt),
  ...((assignment.progressUpdates || []) as any[]).map((update) => millis(update?.createdAt)),
  millis(assignment.createdAt),
);

type Tally = { smes: Set<string>; total: number; assigned: number; inProgress: number; completed: number; reassign: number; progressSum: number };
const newTally = (): Tally => ({ smes: new Set(), total: 0, assigned: 0, inProgress: 0, completed: 0, reassign: 0, progressSum: 0 });
const add = (tally: Tally, assignment: any) => {
  const stage = stageOf(assignment);
  if (stage === "closed") return;
  tally.total += 1;
  tally.smes.add(clean(assignment.participantId));
  if (stage === "completed") tally.completed += 1;
  else if (stage === "in-progress") tally.inProgress += 1;
  else if (stage === "reassign") tally.reassign += 1;
  else tally.assigned += 1;
  tally.progressSum += progressOf(assignment);
};
const average = (tally: Tally) => (tally.total ? Math.round(tally.progressSum / tally.total) : 0);

export async function loadNationalData(requester: Requester, month: string) {
  const me = requester.data;
  const branchId = clean(me.assignedBranch);
  if (!branchId) throw new Error("no_assigned_centre");
  const { start, end } = monthBounds(month);
  const now = Date.now();
  const todayKey = sastDateKey(new Date());

  const [branchSnap, programsSnap, departmentsSnap] = await Promise.all([
    db.collection("branches").doc(branchId).get(),
    db.collection("programs").get(),
    db.collection("departments").get(),
  ]);
  const branch = branchSnap.data() || {};
  const branchName = clean(branch.name || branch.branchName) || "Centre";
  const programs = programsSnap.docs
    .filter((doc) => programBranchId(doc.data()) === branchId && doc.data().isActive !== false && clean(doc.data().kind) !== "training")
    .map((doc) => ({ id: doc.id, name: clean(doc.data().name || doc.data().title) || "Programme" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const programIds = programs.map((program) => program.id);
  const departmentNames = new Map(departmentsSnap.docs.map((doc) => [doc.id, clean(doc.data().name) || "Department"]));

  const assignments = (await Promise.all(chunk(programIds, 30).map((ids) =>
    db.collection("assignedInterventions").where("programId", "in", ids).get(),
  ))).flatMap((snapshot) => snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any)));

  // Programme summary and departments.
  const overall = newTally();
  const byProgramme = new Map(programs.map((program) => [program.id, newTally()]));
  const byDepartment = new Map<string, Tally>();
  for (const assignment of assignments) {
    add(overall, assignment);
    add(byProgramme.get(clean(assignment.programId))!, assignment);
    const departmentId = clean(assignment.departmentId) || "unassigned";
    if (!byDepartment.has(departmentId)) byDepartment.set(departmentId, newTally());
    add(byDepartment.get(departmentId)!, assignment);
  }

  // Sessions this month for the centre's programmes.
  const programSet = new Set(programIds);
  const sessions = (await db.collection("appointmentSessions").where("startAt", ">=", start).where("startAt", "<=", end).get()).docs
    .map((doc) => doc.data())
    .filter((session) => programSet.has(clean(session.programId)) && lower(session.status) !== "cancelled");
  const sessionTotals = { total: sessions.length, held: 0, notHeld: 0, awaiting: 0, upcoming: 0, invited: 0, attended: 0 };
  const sessionsByDepartment = new Map<string, { held: number; notHeld: number; attended: number; invited: number }>();
  for (const session of sessions) {
    const departmentId = clean(session.departmentId) || "unassigned";
    if (!sessionsByDepartment.has(departmentId)) sessionsByDepartment.set(departmentId, { held: 0, notHeld: 0, attended: 0, invited: 0 });
    const row = sessionsByDepartment.get(departmentId)!;
    const coverage = session.coverage;
    if (!coverage) {
      if (millis(session.endAt) < now) sessionTotals.awaiting += 1;
      else sessionTotals.upcoming += 1;
      continue;
    }
    if (!coverage.held) {
      sessionTotals.notHeld += 1;
      row.notHeld += 1;
      continue;
    }
    sessionTotals.held += 1;
    row.held += 1;
    const group = Array.isArray(coverage.attendanceByParticipant) && coverage.attendanceByParticipant.length
      ? coverage.attendanceByParticipant.map((item: any) => item?.outcome)
      : [coverage.smeAttendance];
    const invited = group.length;
    const attended = group.filter((outcome: string) => outcome === "attended").length +
      (group.length === 1 && group[0] === "partially_attended" ? 1 : 0);
    sessionTotals.invited += invited;
    sessionTotals.attended += attended;
    row.invited += invited;
    row.attended += attended;
  }

  // What needs attention: overdue, waiting for reassignment, or stalled.
  const attention = assignments
    .map((assignment) => {
      const stage = stageOf(assignment);
      if (stage === "closed" || stage === "completed") return null;
      const due = clean(assignment.dueDate).slice(0, 10) || (assignment.dueDate?.toDate ? sastDateKey(assignment.dueDate.toDate()) : "");
      const quietDays = Math.floor((now - lastActivity(assignment)) / DAY_MS);
      const issue = stage === "reassign"
        ? "Needs reassignment"
        : due && due < todayKey
          ? `Overdue (due ${shortDateLabel(due)})`
          : stage === "in-progress" && quietDays >= STALLED_DAYS
            ? `No activity for ${quietDays} days`
            : "";
      if (!issue) return null;
      return {
        sme: clean(assignment.beneficiaryName || assignment.participantName) || "SME",
        intervention: clean(assignment.interventionTitle) || "Intervention",
        department: departmentNames.get(clean(assignment.departmentId)) || clean(assignment.departmentName) || "—",
        facilitator: clean(assignment.assigneeName) || "Unassigned",
        issue,
        order: stage === "reassign" ? 0 : issue.startsWith("Overdue") ? 1 : 2,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a!.order - b!.order || a!.sme.localeCompare(b!.sme)) as Array<{ sme: string; intervention: string; department: string; facilitator: string; issue: string }>;

  return {
    branchName,
    month,
    presenter: personOf(requester.id, me),
    presenterEmail: clean(me.email),
    programs: programs.map((program) => ({ ...program, tally: byProgramme.get(program.id)! })),
    overall,
    departments: Array.from(byDepartment.entries())
      .map(([id, tally]) => ({ name: departmentNames.get(id) || (id === "unassigned" ? "No department" : "Department"), tally }))
      .sort((a, b) => b.tally.total - a.tally.total),
    sessionTotals,
    sessionDepartments: Array.from(sessionsByDepartment.entries())
      .map(([id, row]) => ({ name: departmentNames.get(id) || (id === "unassigned" ? "No department" : "Department"), ...row }))
      .sort((a, b) => b.held + b.notHeld - (a.held + a.notHeld)),
    attention,
  };
}

export type NationalData = Awaited<ReturnType<typeof loadNationalData>>;

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

export async function renderNationalReport(data: NationalData) {
  const deck = newDeck({ title: `${data.branchName} National Report`, author: data.presenter.name, footer: data.branchName });
  const { pptx, contentSlide, emptyNote } = deck;
  const zebra = (i: number) => ({ color: i % 2 ? "FFFFFF" : "F2F2F2" });
  const tableOptions = (x: number, y: number, w: number, colW: number[]) =>
    ({ x, y, w, colW, fontFace: FONT, fontSize: 10, color: TEXT, border: { type: "solid" as const, color: "FFFFFF", pt: 1 }, valign: "middle" as const, rowH: 0.36 });

  addCover(deck, {
    centre: data.branchName,
    title: "National Report: Interventions Progress",
    dateLabel: dateLabel(new Date()),
    period: monthLabel(data.month),
    presenter: data.presenter,
    photo: await imageData(data.presenter.photoURL),
  });
  addAgenda(deck, [["Programme summary"], ["Progress by department"], [`Sessions in ${monthLabel(data.month)}`], ["Attention list"]]);

  // Headline tiles.
  {
    const slide = contentSlide("PROGRAMME SUMMARY");
    const cells: Array<[string, string]> = [
      ["SMEs supported", String(data.overall.smes.size)],
      ["Interventions", String(data.overall.total)],
      ["Completed", String(data.overall.completed)],
      ["In progress", String(data.overall.inProgress)],
      ["Average progress", `${average(data.overall)}%`],
    ];
    const w = AREA.w / cells.length;
    slide.addTable(
      [cells.map(([label]) => headerCell(label, MAROON)), cells.map(([, value]) => ({ text: value, options: { fill: { color: "F2F2F2" }, fontSize: 20, bold: true } }))],
      { x: AREA.x, y: 1.45, w: AREA.w, colW: Array(cells.length).fill(w), fontFace: FONT, fontSize: 11, color: TEXT, border: { type: "solid", color: "FFFFFF", pt: 1.5 }, align: "center", valign: "middle", rowH: [0.5, 0.7] },
    );
    if (!data.programs.length) {
      emptyNote(slide, "No programmes are linked to this centre.");
    } else {
      const header = ["Programme", "SMEs", "Interventions", "Assigned", "In progress", "Completed", "Reassign", "Avg progress"].map((label) => headerCell(label));
      const rows = data.programs.slice(0, 9).map((program, i) => [
        { text: program.name, options: { fill: zebra(i), bold: true } },
        ...[program.tally.smes.size, program.tally.total, program.tally.assigned, program.tally.inProgress, program.tally.completed, program.tally.reassign]
          .map((value) => ({ text: String(value), options: { fill: zebra(i), align: "center" as const } })),
        { text: `${average(program.tally)}%`, options: { fill: zebra(i), align: "center" as const, bold: true } },
      ]);
      slide.addTable([header, ...rows], tableOptions(AREA.x, 2.9, AREA.w, [3.3, 1.0, 1.35, 1.2, 1.3, 1.3, 1.15, 1.5]));
    }
  }

  // By department.
  {
    const pages = chunk(data.departments, 10);
    if (!pages.length) emptyNote(contentSlide("PROGRESS BY DEPARTMENT"), "No interventions are assigned in this centre's programmes.");
    pages.forEach((page, p) => {
      const slide = contentSlide("PROGRESS BY DEPARTMENT");
      const header = ["Department", "Interventions", "In progress", "Completed", "Reassign", "Avg progress"].map((label) => headerCell(label));
      const rows = page.map((department, i) => [
        { text: department.name, options: { fill: zebra(i), bold: true } },
        ...[department.tally.total, department.tally.inProgress, department.tally.completed, department.tally.reassign]
          .map((value) => ({ text: String(value), options: { fill: zebra(i), align: "center" as const } })),
        { text: `${average(department.tally)}%`, options: { fill: zebra(i), align: "center" as const, bold: true } },
      ]);
      slide.addTable([header, ...rows], tableOptions(AREA.x, 1.45, 6.9, [2.4, 1.0, 0.95, 0.95, 0.8, 0.8]));
      if (p === 0) {
        const top = data.departments.slice(0, 8);
        slide.addChart(pptx.ChartType.bar, [{ name: "Completed", labels: top.map((d) => d.name), values: top.map((d) => (d.tally.total ? Math.round((d.tally.completed / d.tally.total) * 100) : 0)) }], {
          x: 7.7, y: 1.45, w: 5.0, h: 4.9, barDir: "bar", chartColors: [BLUE],
          showTitle: true, title: "Completed (% of interventions)", titleFontSize: 12, titleFontFace: FONT,
          showValue: true, dataLabelFontSize: 9, dataLabelFormatCode: '0"%"', catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, valAxisMaxVal: 100,
          valGridLine: { color: "E7E6E6", size: 0.5 },
        });
      }
    });
  }

  // Sessions this month.
  {
    const slide = contentSlide(`SESSIONS IN ${monthLabel(data.month).toUpperCase()}`);
    const s = data.sessionTotals;
    const cells: Array<[string, string]> = [
      ["Sessions", String(s.total)],
      ["Held", String(s.held)],
      ["Not held", String(s.notHeld)],
      ["Awaiting coverage", String(s.awaiting)],
      ["SME attendance", pct(s.attended, s.invited)],
    ];
    const w = AREA.w / cells.length;
    slide.addTable(
      [cells.map(([label]) => headerCell(label, MAROON)), cells.map(([, value]) => ({ text: value, options: { fill: { color: "F2F2F2" }, fontSize: 20, bold: true } }))],
      { x: AREA.x, y: 1.45, w: AREA.w, colW: Array(cells.length).fill(w), fontFace: FONT, fontSize: 11, color: TEXT, border: { type: "solid", color: "FFFFFF", pt: 1.5 }, align: "center", valign: "middle", rowH: [0.5, 0.7] },
    );
    if (!data.sessionDepartments.length) {
      emptyNote(slide, `No sessions were scheduled in ${monthLabel(data.month)}.`);
    } else {
      const header = ["Department", "Held", "Not held", "SMEs attended", "Attendance rate"].map((label) => headerCell(label));
      const rows = data.sessionDepartments.slice(0, 9).map((row, i) => [
        { text: row.name, options: { fill: zebra(i), bold: true } },
        ...[row.held, row.notHeld, row.attended].map((value) => ({ text: String(value), options: { fill: zebra(i), align: "center" as const } })),
        { text: pct(row.attended, row.invited), options: { fill: zebra(i), align: "center" as const, bold: true } },
      ]);
      slide.addTable([header, ...rows], tableOptions(AREA.x + 1.0, 2.9, AREA.w - 2.0, [3.6, 1.4, 1.4, 1.8, 1.9]));
    }
    if (s.upcoming) {
      slide.addText(`${s.upcoming} more session${s.upcoming === 1 ? " is" : "s are"} still to come this month.`, { x: AREA.x, y: 6.25, w: AREA.w, h: 0.3, fontFace: FONT, fontSize: 10, italic: true, color: "7F7F7F", align: "center" });
    }
  }

  // Attention list.
  {
    const pages = chunk(data.attention, 11).slice(0, 4);
    if (!pages.length) emptyNote(contentSlide("ATTENTION LIST"), "Nothing is overdue, waiting for reassignment or stalled.");
    pages.forEach((page) => {
      const slide = contentSlide("ATTENTION LIST");
      const header = ["SME", "Intervention", "Department", "Facilitator", "Attention"].map((label) => headerCell(label, MAROON));
      const rows = page.map((item, i) => [
        { text: item.sme, options: { fill: zebra(i), bold: true } },
        { text: item.intervention, options: { fill: zebra(i) } },
        { text: item.department, options: { fill: zebra(i) } },
        { text: item.facilitator, options: { fill: zebra(i) } },
        { text: item.issue, options: { fill: zebra(i), color: item.issue === "Needs reassignment" || item.issue.startsWith("Overdue") ? "C00000" : TEXT } },
      ]);
      slide.addTable([header, ...rows], tableOptions(AREA.x, 1.45, AREA.w, [2.6, 3.0, 2.2, 2.0, 2.3]));
    });
    if (data.attention.length > 44) {
      contentSlide("ATTENTION LIST").addText(`${data.attention.length - 44} more items are on the Lepharo platform.`, { x: AREA.x, y: 3.4, w: AREA.w, h: 0.5, align: "center", fontFace: FONT, fontSize: 14, italic: true, color: "7F7F7F" });
    }
  }

  addClosing(deck, { centre: data.branchName, presenter: data.presenter, email: data.presenterEmail });

  return {
    buffer: await deckBuffer(deck),
    fileName: `${data.branchName.replace(/[^\w]+/g, "_")}_National_Report_${data.month}.pptx`,
    title: `${data.branchName} National Report, ${monthLabel(data.month)}`,
  };
}

