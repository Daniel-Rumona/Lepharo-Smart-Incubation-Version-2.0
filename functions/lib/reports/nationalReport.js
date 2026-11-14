"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderNationalReport = exports.loadNationalData = exports.stageOf = void 0;
const firebase_1 = require("../firebase");
const deck_1 = require("./deck");
const executiveReport_1 = require("./executiveReport");
const lib_1 = require("./lib");
/**
 * The centre's National Report: interventions progress for the centre coordinator's own centre, presented at
 * the national meeting (Lepharo has centres across the country). The centre's programmes are those whose
 * branch is the coordinator's (as the programme picker scopes them); everything else follows from their
 * assigned interventions and sessions.
 */
const STALLED_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const lower = (value) => (0, lib_1.clean)(value).toLowerCase();
const programBranchId = (data) => (0, lib_1.clean)(data.normalizedAssignedBranchId) || (0, lib_1.clean)(data.branchId) ||
    (0, lib_1.clean)(typeof data.assignedBranch === "object" && data.assignedBranch ? data.assignedBranch.id : data.assignedBranch);
/** Where an intervention stands, from its assignmentStatus (spelled several ways over time). */
const stageOf = (assignment) => {
    const status = lower(assignment.assignmentStatus).replace(/[\s_]+/g, "-");
    if (["cancelled", "declined", "rejected"].includes(status))
        return "closed";
    if (status === "completed" || lower(assignment.participantCompletionStatus) === "confirmed")
        return "completed";
    if (status.includes("reassign"))
        return "reassign";
    if (["in-progress", "active", "ongoing", "started"].includes(status))
        return "in-progress";
    return "assigned";
};
exports.stageOf = stageOf;
const progressOf = (assignment) => {
    if ((0, exports.stageOf)(assignment) === "completed")
        return 100;
    return Math.max(0, Math.min(100, Number(assignment.computedProgress ?? assignment.progress ?? 0) || 0));
};
const millis = (value) => value?.toMillis?.() ?? (value ? new Date(value).getTime() || 0 : 0);
/** The last time anything happened on an intervention. */
const lastActivity = (assignment) => Math.max(millis(assignment.updatedAt), millis(assignment.lastAppointmentAt), ...(assignment.progressUpdates || []).map((update) => millis(update?.createdAt)), millis(assignment.createdAt));
const newTally = () => ({ smes: new Set(), total: 0, assigned: 0, inProgress: 0, completed: 0, reassign: 0, progressSum: 0 });
const add = (tally, assignment) => {
    const stage = (0, exports.stageOf)(assignment);
    if (stage === "closed")
        return;
    tally.total += 1;
    tally.smes.add((0, lib_1.clean)(assignment.participantId));
    if (stage === "completed")
        tally.completed += 1;
    else if (stage === "in-progress")
        tally.inProgress += 1;
    else if (stage === "reassign")
        tally.reassign += 1;
    else
        tally.assigned += 1;
    tally.progressSum += progressOf(assignment);
};
const average = (tally) => (tally.total ? Math.round(tally.progressSum / tally.total) : 0);
async function loadNationalData(requester, month) {
    const me = requester.data;
    const branchId = (0, lib_1.clean)(me.assignedBranch);
    if (!branchId)
        throw new Error("no_assigned_centre");
    const { start, end } = (0, lib_1.monthBounds)(month);
    const now = Date.now();
    const todayKey = (0, lib_1.sastDateKey)(new Date());
    const [branchSnap, programsSnap, departmentsSnap] = await Promise.all([
        firebase_1.db.collection("branches").doc(branchId).get(),
        firebase_1.db.collection("programs").get(),
        firebase_1.db.collection("departments").get(),
    ]);
    const branch = branchSnap.data() || {};
    const branchName = (0, lib_1.clean)(branch.name || branch.branchName) || "Centre";
    const programs = programsSnap.docs
        .filter((doc) => programBranchId(doc.data()) === branchId && doc.data().isActive !== false && (0, lib_1.clean)(doc.data().kind) !== "training")
        .map((doc) => ({ id: doc.id, name: (0, lib_1.clean)(doc.data().name || doc.data().title) || "Programme" }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const programIds = programs.map((program) => program.id);
    const departmentNames = new Map(departmentsSnap.docs.map((doc) => [doc.id, (0, lib_1.clean)(doc.data().name) || "Department"]));
    const assignments = (await Promise.all((0, deck_1.chunk)(programIds, 30).map((ids) => firebase_1.db.collection("assignedInterventions").where("programId", "in", ids).get()))).flatMap((snapshot) => snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    // Programme summary and departments.
    const overall = newTally();
    const byProgramme = new Map(programs.map((program) => [program.id, newTally()]));
    const byDepartment = new Map();
    for (const assignment of assignments) {
        add(overall, assignment);
        add(byProgramme.get((0, lib_1.clean)(assignment.programId)), assignment);
        const departmentId = (0, lib_1.clean)(assignment.departmentId) || "unassigned";
        if (!byDepartment.has(departmentId))
            byDepartment.set(departmentId, newTally());
        add(byDepartment.get(departmentId), assignment);
    }
    // Sessions this month for the centre's programmes.
    const programSet = new Set(programIds);
    const sessions = (await firebase_1.db.collection("appointmentSessions").where("startAt", ">=", start).where("startAt", "<=", end).get()).docs
        .map((doc) => doc.data())
        .filter((session) => programSet.has((0, lib_1.clean)(session.programId)) && lower(session.status) !== "cancelled");
    const sessionTotals = { total: sessions.length, held: 0, notHeld: 0, awaiting: 0, upcoming: 0, invited: 0, attended: 0 };
    const sessionsByDepartment = new Map();
    for (const session of sessions) {
        const departmentId = (0, lib_1.clean)(session.departmentId) || "unassigned";
        if (!sessionsByDepartment.has(departmentId))
            sessionsByDepartment.set(departmentId, { held: 0, notHeld: 0, attended: 0, invited: 0 });
        const row = sessionsByDepartment.get(departmentId);
        const coverage = session.coverage;
        if (!coverage) {
            if (millis(session.endAt) < now)
                sessionTotals.awaiting += 1;
            else
                sessionTotals.upcoming += 1;
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
            ? coverage.attendanceByParticipant.map((item) => item?.outcome)
            : [coverage.smeAttendance];
        const invited = group.length;
        const attended = group.filter((outcome) => outcome === "attended").length +
            (group.length === 1 && group[0] === "partially_attended" ? 1 : 0);
        sessionTotals.invited += invited;
        sessionTotals.attended += attended;
        row.invited += invited;
        row.attended += attended;
    }
    // What needs attention: overdue, waiting for reassignment, or stalled.
    const attention = assignments
        .map((assignment) => {
        const stage = (0, exports.stageOf)(assignment);
        if (stage === "closed" || stage === "completed")
            return null;
        const due = (0, lib_1.clean)(assignment.dueDate).slice(0, 10) || (assignment.dueDate?.toDate ? (0, lib_1.sastDateKey)(assignment.dueDate.toDate()) : "");
        const quietDays = Math.floor((now - lastActivity(assignment)) / DAY_MS);
        const issue = stage === "reassign"
            ? "Needs reassignment"
            : due && due < todayKey
                ? `Overdue (due ${(0, lib_1.shortDateLabel)(due)})`
                : stage === "in-progress" && quietDays >= STALLED_DAYS
                    ? `No activity for ${quietDays} days`
                    : "";
        if (!issue)
            return null;
        return {
            sme: (0, lib_1.clean)(assignment.beneficiaryName || assignment.participantName) || "SME",
            intervention: (0, lib_1.clean)(assignment.interventionTitle) || "Intervention",
            department: departmentNames.get((0, lib_1.clean)(assignment.departmentId)) || (0, lib_1.clean)(assignment.departmentName) || "—",
            facilitator: (0, lib_1.clean)(assignment.assigneeName) || "Unassigned",
            issue,
            order: stage === "reassign" ? 0 : issue.startsWith("Overdue") ? 1 : 2,
        };
    })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order || a.sme.localeCompare(b.sme));
    return {
        branchName,
        month,
        presenter: (0, executiveReport_1.personOf)(requester.id, me),
        presenterEmail: (0, lib_1.clean)(me.email),
        programs: programs.map((program) => ({ ...program, tally: byProgramme.get(program.id) })),
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
exports.loadNationalData = loadNationalData;
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");
async function renderNationalReport(data) {
    const deck = (0, deck_1.newDeck)({ title: `${data.branchName} National Report`, author: data.presenter.name, footer: data.branchName });
    const { pptx, contentSlide, emptyNote } = deck;
    const zebra = (i) => ({ color: i % 2 ? "FFFFFF" : "F2F2F2" });
    const tableOptions = (x, y, w, colW) => ({ x, y, w, colW, fontFace: deck_1.FONT, fontSize: 10, color: deck_1.TEXT, border: { type: "solid", color: "FFFFFF", pt: 1 }, valign: "middle", rowH: 0.36 });
    (0, deck_1.addCover)(deck, {
        centre: data.branchName,
        title: "National Report: Interventions Progress",
        dateLabel: (0, lib_1.dateLabel)(new Date()),
        period: (0, lib_1.monthLabel)(data.month),
        presenter: data.presenter,
        photo: await (0, deck_1.imageData)(data.presenter.photoURL),
    });
    (0, deck_1.addAgenda)(deck, [["Programme summary"], ["Progress by department"], [`Sessions in ${(0, lib_1.monthLabel)(data.month)}`], ["Attention list"]]);
    // Headline tiles.
    {
        const slide = contentSlide("PROGRAMME SUMMARY");
        const cells = [
            ["SMEs supported", String(data.overall.smes.size)],
            ["Interventions", String(data.overall.total)],
            ["Completed", String(data.overall.completed)],
            ["In progress", String(data.overall.inProgress)],
            ["Average progress", `${average(data.overall)}%`],
        ];
        const w = deck_1.AREA.w / cells.length;
        slide.addTable([cells.map(([label]) => (0, deck_1.headerCell)(label, deck_1.MAROON)), cells.map(([, value]) => ({ text: value, options: { fill: { color: "F2F2F2" }, fontSize: 20, bold: true } }))], { x: deck_1.AREA.x, y: 1.45, w: deck_1.AREA.w, colW: Array(cells.length).fill(w), fontFace: deck_1.FONT, fontSize: 11, color: deck_1.TEXT, border: { type: "solid", color: "FFFFFF", pt: 1.5 }, align: "center", valign: "middle", rowH: [0.5, 0.7] });
        if (!data.programs.length) {
            emptyNote(slide, "No programmes are linked to this centre.");
        }
        else {
            const header = ["Programme", "SMEs", "Interventions", "Assigned", "In progress", "Completed", "Reassign", "Avg progress"].map((label) => (0, deck_1.headerCell)(label));
            const rows = data.programs.slice(0, 9).map((program, i) => [
                { text: program.name, options: { fill: zebra(i), bold: true } },
                ...[program.tally.smes.size, program.tally.total, program.tally.assigned, program.tally.inProgress, program.tally.completed, program.tally.reassign]
                    .map((value) => ({ text: String(value), options: { fill: zebra(i), align: "center" } })),
                { text: `${average(program.tally)}%`, options: { fill: zebra(i), align: "center", bold: true } },
            ]);
            slide.addTable([header, ...rows], tableOptions(deck_1.AREA.x, 2.9, deck_1.AREA.w, [3.3, 1.0, 1.35, 1.2, 1.3, 1.3, 1.15, 1.5]));
        }
    }
    // By department.
    {
        const pages = (0, deck_1.chunk)(data.departments, 10);
        if (!pages.length)
            emptyNote(contentSlide("PROGRESS BY DEPARTMENT"), "No interventions are assigned in this centre's programmes.");
        pages.forEach((page, p) => {
            const slide = contentSlide("PROGRESS BY DEPARTMENT");
            const header = ["Department", "Interventions", "In progress", "Completed", "Reassign", "Avg progress"].map((label) => (0, deck_1.headerCell)(label));
            const rows = page.map((department, i) => [
                { text: department.name, options: { fill: zebra(i), bold: true } },
                ...[department.tally.total, department.tally.inProgress, department.tally.completed, department.tally.reassign]
                    .map((value) => ({ text: String(value), options: { fill: zebra(i), align: "center" } })),
                { text: `${average(department.tally)}%`, options: { fill: zebra(i), align: "center", bold: true } },
            ]);
            slide.addTable([header, ...rows], tableOptions(deck_1.AREA.x, 1.45, 6.9, [2.4, 1.0, 0.95, 0.95, 0.8, 0.8]));
            if (p === 0) {
                const top = data.departments.slice(0, 8);
                slide.addChart(pptx.ChartType.bar, [{ name: "Completed", labels: top.map((d) => d.name), values: top.map((d) => (d.tally.total ? Math.round((d.tally.completed / d.tally.total) * 100) : 0)) }], {
                    x: 7.7, y: 1.45, w: 5.0, h: 4.9, barDir: "bar", chartColors: [deck_1.BLUE],
                    showTitle: true, title: "Completed (% of interventions)", titleFontSize: 12, titleFontFace: deck_1.FONT,
                    showValue: true, dataLabelFontSize: 9, dataLabelFormatCode: '0"%"', catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, valAxisMaxVal: 100,
                    valGridLine: { color: "E7E6E6", size: 0.5 },
                });
            }
        });
    }
    // Sessions this month.
    {
        const slide = contentSlide(`SESSIONS IN ${(0, lib_1.monthLabel)(data.month).toUpperCase()}`);
        const s = data.sessionTotals;
        const cells = [
            ["Sessions", String(s.total)],
            ["Held", String(s.held)],
            ["Not held", String(s.notHeld)],
            ["Awaiting coverage", String(s.awaiting)],
            ["SME attendance", pct(s.attended, s.invited)],
        ];
        const w = deck_1.AREA.w / cells.length;
        slide.addTable([cells.map(([label]) => (0, deck_1.headerCell)(label, deck_1.MAROON)), cells.map(([, value]) => ({ text: value, options: { fill: { color: "F2F2F2" }, fontSize: 20, bold: true } }))], { x: deck_1.AREA.x, y: 1.45, w: deck_1.AREA.w, colW: Array(cells.length).fill(w), fontFace: deck_1.FONT, fontSize: 11, color: deck_1.TEXT, border: { type: "solid", color: "FFFFFF", pt: 1.5 }, align: "center", valign: "middle", rowH: [0.5, 0.7] });
        if (!data.sessionDepartments.length) {
            emptyNote(slide, `No sessions were scheduled in ${(0, lib_1.monthLabel)(data.month)}.`);
        }
        else {
            const header = ["Department", "Held", "Not held", "SMEs attended", "Attendance rate"].map((label) => (0, deck_1.headerCell)(label));
            const rows = data.sessionDepartments.slice(0, 9).map((row, i) => [
                { text: row.name, options: { fill: zebra(i), bold: true } },
                ...[row.held, row.notHeld, row.attended].map((value) => ({ text: String(value), options: { fill: zebra(i), align: "center" } })),
                { text: pct(row.attended, row.invited), options: { fill: zebra(i), align: "center", bold: true } },
            ]);
            slide.addTable([header, ...rows], tableOptions(deck_1.AREA.x + 1.0, 2.9, deck_1.AREA.w - 2.0, [3.6, 1.4, 1.4, 1.8, 1.9]));
        }
        if (s.upcoming) {
            slide.addText(`${s.upcoming} more session${s.upcoming === 1 ? " is" : "s are"} still to come this month.`, { x: deck_1.AREA.x, y: 6.25, w: deck_1.AREA.w, h: 0.3, fontFace: deck_1.FONT, fontSize: 10, italic: true, color: "7F7F7F", align: "center" });
        }
    }
    // Attention list.
    {
        const pages = (0, deck_1.chunk)(data.attention, 11).slice(0, 4);
        if (!pages.length)
            emptyNote(contentSlide("ATTENTION LIST"), "Nothing is overdue, waiting for reassignment or stalled.");
        pages.forEach((page) => {
            const slide = contentSlide("ATTENTION LIST");
            const header = ["SME", "Intervention", "Department", "Facilitator", "Attention"].map((label) => (0, deck_1.headerCell)(label, deck_1.MAROON));
            const rows = page.map((item, i) => [
                { text: item.sme, options: { fill: zebra(i), bold: true } },
                { text: item.intervention, options: { fill: zebra(i) } },
                { text: item.department, options: { fill: zebra(i) } },
                { text: item.facilitator, options: { fill: zebra(i) } },
                { text: item.issue, options: { fill: zebra(i), color: item.issue === "Needs reassignment" || item.issue.startsWith("Overdue") ? "C00000" : deck_1.TEXT } },
            ]);
            slide.addTable([header, ...rows], tableOptions(deck_1.AREA.x, 1.45, deck_1.AREA.w, [2.6, 3.0, 2.2, 2.0, 2.3]));
        });
        if (data.attention.length > 44) {
            contentSlide("ATTENTION LIST").addText(`${data.attention.length - 44} more items are on the Lepharo platform.`, { x: deck_1.AREA.x, y: 3.4, w: deck_1.AREA.w, h: 0.5, align: "center", fontFace: deck_1.FONT, fontSize: 14, italic: true, color: "7F7F7F" });
        }
    }
    (0, deck_1.addClosing)(deck, { centre: data.branchName, presenter: data.presenter, email: data.presenterEmail });
    return {
        buffer: await (0, deck_1.deckBuffer)(deck),
        fileName: `${data.branchName.replace(/[^\w]+/g, "_")}_National_Report_${data.month}.pptx`,
        title: `${data.branchName} National Report, ${(0, lib_1.monthLabel)(data.month)}`,
    };
}
exports.renderNationalReport = renderNationalReport;
//# sourceMappingURL=nationalReport.js.map