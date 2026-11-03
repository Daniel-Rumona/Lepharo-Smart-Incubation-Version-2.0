import { db } from "../firebase";
import {
  addAgenda, addClosing, addCover, AREA, BLUE, BLUE_LIGHT, chunk, coverImage, deckBuffer, FONT, headerCell, imageData, MAROON, newDeck, TEXT,
} from "./deck";
import {
  BranchOperatingHours, clean, dateLabel, daysOfMonth, dayStatus, DayStatus, defaultOperatingHours, effectiveLeaseStatus, FacilityWorkshop,
  formatRole, getDayHours, leaseDuration, monthBounds, monthLabel, resolveInquiryChannel, sastDateKey, sortWorkshops, WORKSHOPS,
} from "./lib";

/**
 * The centre's Monthly Executive & Operations Report: a server port of the web app's
 * src/routes/projectadmin/facilities/centreReport.ts (which this replaces), same sections and layout.
 * Budget/expenditure and printer usage are deliberately left out; infrastructure fund submissions are not
 * in the system yet.
 */

const RISK_FILL: Record<string, string> = { High: "FF0000", Medium: "FFC000", Low: "92D050" };
const ATTENDANCE_FILL: Partial<Record<DayStatus, string>> = {
  onsite: "1677FF",
  remote: "13C2C2",
  leave: "FAAD14",
  absent: "FF4D4F",
  closed: "EDEDED",
  upcoming: "FFFFFF",
};
const STAFF_ROLES = ["projectadmin", "coordinator", "receptionist", "employee"];

type Person = {
  id: string;
  name: string;
  role: string;
  title: string;
  photoURL?: string;
  status: "Active" | "Active (Intern)" | "On hold" | "Inactive";
};

export type Requester = { id: string; data: FirebaseFirestore.DocumentData };

export const personOf = (id: string, user: any): Person => {
  const workerType = clean(user.workerType || user.employmentType).toLowerCase();
  const status = clean(user.status).toLowerCase();
  return {
    id,
    name: clean(user.name || user.fullName || user.email) || "Unnamed",
    role: clean(user.role).toLowerCase(),
    title: clean(user.jobTitle || user.position) || formatRole(user.role) || "Staff member",
    photoURL: user.photoURL || undefined,
    status: ["inactive", "terminated", "resigned", "disabled"].includes(status)
      ? "Inactive"
      : ["on hold", "on_hold", "suspended", "onhold"].includes(status)
        ? "On hold"
        : workerType.includes("intern") ? "Active (Intern)" : "Active",
  };
};

const countBy = (values: string[], limit: number): Array<[string, number]> => {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
};

const instant = (value: any): Date | null => {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const rows = (snapshot: FirebaseFirestore.QuerySnapshot) => snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));

/** Everything the deck shows, for the requester's centre and a YYYY-MM month. */
export async function loadExecutiveData(requester: Requester, month: string) {
  const me = requester.data;
  const branchId = clean(me.assignedBranch);
  if (!branchId) throw new Error("no_assigned_centre");
  const { start, end } = monthBounds(month);
  const startKey = `${month}-01`;
  const days = daysOfMonth(month);
  const endKey = days[days.length - 1].key;
  const byBranch = (name: string) => db.collection(name).where("branchId", "==", branchId).get();

  const [branchSnap, usersSnap, issuesSnap, gapsSnap, needsSnap, workshopsSnap, inquiriesSnap, appsSnap, challengesSnap] = await Promise.all([
    db.collection("branches").doc(branchId).get(),
    db.collection("users").where("assignedBranch", "==", branchId).get(),
    byBranch("facilityIssues"),
    byBranch("facilityGaps"),
    byBranch("facilityNeeds"),
    byBranch(WORKSHOPS),
    byBranch("inquiries"),
    db.collection("applications").where("applicationStatus", "in", ["Accepted", "accepted"]).get(),
    db.collection("operationalChallenges").get().catch(() => null),
  ]);

  const branch = branchSnap.data() || {};
  const branchName = clean(branch.name || branch.branchName) || "Centre";
  const hours: BranchOperatingHours = branch.operatingHours || defaultOperatingHours();

  const presenter = personOf(requester.id, me);
  const team = rows(usersSnap)
    .filter((user) => user.id !== presenter.id && STAFF_ROLES.includes(clean(user.role).toLowerCase()))
    .map((user) => personOf(user.id, user))
    .sort((a, b) => a.name.localeCompare(b.name));
  const staff = [presenter, ...team];

  // Accepted SMMEs of this centre.
  const apps = rows(appsSnap).filter((app) =>
    [app.branchId, app.assignedBranch, app.branch?.id].includes(branchId) ||
    (!!app.branchName && clean(app.branchName).toLowerCase() === branchName.toLowerCase()));

  const inquiries = rows(inquiriesSnap).filter((item) => {
    const at = instant(item.submittedAt || item.createdAt);
    return at && at >= start && at <= end;
  });

  // Attendance: the month's timesheets for every staff member, ids in batches of 30.
  const ids = staff.map((person) => person.id);
  const timesheets = (await Promise.all(chunk(ids, 30).map((batch) =>
    db.collection("timesheets").where("userId", "in", batch).where("date", ">=", startKey).where("date", "<=", endKey).get(),
  ))).flatMap(rows);
  const leaveRequests = await db.collection("leaveRequests").where("status", "==", "approved").get().then(rows).catch(() => [] as any[]);

  const todayKey = sastDateKey(new Date());
  const workingDays = days.filter((day) => !getDayHours(hours, day).closed);
  const attendance = staff.map((person) => ({
    person,
    days: workingDays.map((day) => ({
      day,
      status: dayStatus(day, {
        entries: timesheets.filter((entry) => entry.userId === person.id),
        leaveRequests: leaveRequests.filter((leave) => leave.employeeId === person.id),
        hours,
        todayKey,
      }),
    })),
  }));

  const challenges = challengesSnap
    ? rows(challengesSnap)
      .filter((row) => ids.includes(row.createdById) && !["Closed", "Resolved"].includes(row.status))
      .map((row) => ({
        challenge: [clean(row.title), clean(row.details)].filter(Boolean).join(": "),
        solution: (row.mitigationSteps || []).join("; ") || "—",
        action: [clean(row.status) || "Open", instant(row.dueDate) ? `due ${dateLabel(instant(row.dueDate)!)}` : ""].filter(Boolean).join(", "),
      }))
    : [];

  return {
    branchId,
    branchName,
    month,
    presenter,
    presenterEmail: clean(me.email),
    team,
    issues: rows(issuesSnap)
      .filter((issue) => issue.status !== "Resolved")
      .sort((a, b) => ["High", "Medium", "Low"].indexOf(a.risk) - ["High", "Medium", "Low"].indexOf(b.risk))
      .map((issue) => ({ ...issue, images: issue.images || [] })),
    gaps: rows(gapsSnap).filter((gap) => gap.status !== "Closed"),
    needs: rows(needsSnap).sort((a, b) => clean(a.need).localeCompare(clean(b.need))),
    workshops: sortWorkshops(rows(workshopsSnap) as FacilityWorkshop[]),
    smmeTotal: apps.length,
    smmeGroups: countBy(apps.map((app) => clean(app.group || app.gapGroup || app.sector)), 5),
    localities: countBy(apps.map((app) => clean(app.town || app.location || app.hub)), 10),
    inquiryTotal: inquiries.length,
    inquiryChannels: countBy(inquiries.map((item) => resolveInquiryChannel(item.source)), 5),
    attendance,
    challenges,
    todayKey,
  };
}

export type ExecutiveData = Awaited<ReturnType<typeof loadExecutiveData>>;

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "?";
const rand = (value: number) => `R ${value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

export async function renderExecutiveReport(data: ExecutiveData) {
  const deck = newDeck({ title: `${data.branchName} Monthly Executive & Operations Report`, author: data.presenter.name, footer: data.branchName });
  const { pptx, contentSlide, emptyNote } = deck;

  // 1. Cover
  addCover(deck, {
    centre: data.branchName,
    title: "Monthly Executive & Operations Report",
    dateLabel: dateLabel(new Date()),
    period: monthLabel(data.month),
    presenter: data.presenter,
    photo: await imageData(data.presenter.photoURL),
  });

  // 2. Agenda
  addAgenda(deck, [
    ["Meet the team"],
    ["Centre reporting section", ["Centre management", "Facilities management", "Facilities gaps"]],
    ["Update on existing SMMEs"],
    ["SMME locality"],
    ["Workshop occupancy"],
    ["Staff attendance"],
    ["Needs assessment list"],
    ["Challenges"],
  ]);

  // 3. Meet the team: the presenter, then everyone else in columns.
  {
    const slide = contentSlide("MEET THE TEAM");
    const people = [data.presenter, ...data.team];
    const photos = await Promise.all(people.map((person) => imageData(person.photoURL)));
    const card = (person: Person, photo: string | null, x: number, y: number, w: number) => {
      const size = 0.5;
      if (photo) {
        slide.addImage(coverImage(photo, x, y, size, size, true));
      } else {
        slide.addShape(pptx.ShapeType.ellipse, { x, y, w: size, h: size, fill: { color: MAROON }, line: { color: MAROON } });
        slide.addText(initials(person.name), { x, y, w: size, h: size, align: "center", valign: "middle", fontFace: FONT, fontSize: 11, bold: true, color: "FFFFFF", margin: 0 });
      }
      slide.addText(
        [
          { text: person.name, options: { bold: true, fontSize: 10, color: TEXT, breakLine: true } },
          { text: person.title.toUpperCase(), options: { fontSize: 7.5, bold: true, color: MAROON } },
        ],
        { x: x + size + 0.08, y: y - 0.02, w: w - size - 0.1, h: size + 0.04, fontFace: FONT, valign: "middle", margin: 0 },
      );
    };
    card(data.presenter, photos[0], 0.7, 3.65, 2.4);
    const others = data.team;
    if (!others.length) {
      emptyNote(slide, "No other staff are assigned to this centre.");
    } else {
      const perColumn = Math.min(7, Math.max(4, Math.ceil(others.length / 4)));
      const columns = chunk(others, perColumn).slice(0, 4);
      const colW = (AREA.x + AREA.w - 3.4) / columns.length;
      const rowH = 0.68;
      slide.addShape(pptx.ShapeType.line, { x: 2.9, y: 3.9, w: 0.35, h: 0, line: { color: "A6A6A6", width: 1 } });
      columns.forEach((column, c) => {
        const x = 3.4 + c * colW;
        const top = 3.9 - ((column.length - 1) * rowH) / 2;
        slide.addShape(pptx.ShapeType.line, { x: x - 0.15, y: top + 0.25, w: 0, h: Math.max(0.01, (column.length - 1) * rowH), line: { color: "A6A6A6", width: 1 } });
        if (c > 0) slide.addShape(pptx.ShapeType.line, { x: 3.25, y: 3.9, w: x - 3.4, h: 0, line: { color: "D9D9D9", width: 0.75 } });
        column.forEach((person, r) => {
          const y = top + r * rowH;
          slide.addShape(pptx.ShapeType.line, { x: x - 0.15, y: y + 0.25, w: 0.15, h: 0, line: { color: "A6A6A6", width: 1 } });
          card(person, photos[1 + others.indexOf(person)], x, y, colW - 0.1);
        });
      });
      if (others.length > perColumn * 4) {
        slide.addText(`+${others.length - perColumn * 4} more`, { x: 11, y: 6.2, w: 1.6, h: 0.3, fontFace: FONT, fontSize: 10, italic: true, color: "7F7F7F", align: "right" });
      }
    }
  }

  // 4. Section divider
  contentSlide("").addText("CENTRE REPORTING SECTION", { x: 1.5, y: 3.4, w: 10.4, h: 0.9, fontFace: FONT, fontSize: 36, bold: true, color: MAROON, align: "center" });

  // 5. Centre management / operation
  {
    const slide = contentSlide("CENTRE MANAGEMENT/OPERATION");
    const statusFill: Record<Person["status"], string> = { Active: "00B050", "Active (Intern)": "A9D08E", "On hold": "FFC000", Inactive: "FF0000" };
    const perRow = 6;
    const tableRows: any[] = [[{ text: "CENTRE MANAGEMENT/OPERATION", options: { colspan: perRow, bold: true, color: "FFFFFF", fill: { color: "375623" }, align: "center" } }]];
    chunk([data.presenter, ...data.team], perRow).forEach((row) => {
      tableRows.push([
        ...row.map((person) => ({
          text: [{ text: person.title, options: { bold: true, breakLine: true } }, { text: person.name, options: { fontSize: 9 } }],
          options: { fill: { color: statusFill[person.status] }, color: person.status === "Inactive" ? "FFFFFF" : TEXT },
        })),
        ...Array.from({ length: perRow - row.length }, () => ({ text: "", options: {} })),
      ]);
    });
    slide.addTable(tableRows, { x: AREA.x, y: 1.5, w: AREA.w, colW: Array(perRow).fill(AREA.w / perRow), fontFace: FONT, fontSize: 11, border: { type: "solid", color: "FFFFFF", pt: 1 }, valign: "middle", rowH: 0.6 });
    const legendY = Math.min(5.7, 1.5 + 0.6 * tableRows.length + 0.35);
    (Object.keys(statusFill) as Person["status"][]).forEach((status, i) => {
      slide.addShape(pptx.ShapeType.rect, { x: AREA.x, y: legendY + i * 0.24, w: 0.35, h: 0.18, fill: { color: statusFill[status] }, line: { color: statusFill[status] } });
      slide.addText(status === "Inactive" ? "Inactive/vacant" : status, { x: AREA.x + 0.45, y: legendY + i * 0.24 - 0.03, w: 2, h: 0.24, fontFace: FONT, fontSize: 9, color: TEXT, margin: 0 });
    });
  }

  // 6. Facilities management: six issues per slide, photo between header and risk.
  {
    const pages = chunk(data.issues, 6);
    if (!pages.length) emptyNote(contentSlide("FACILITIES MANAGEMENT"), "No open facility issues.");
    for (const page of pages) {
      const slide = contentSlide("FACILITIES MANAGEMENT");
      const colW = 2.0;
      const gap = 0.02;
      const startX = AREA.x + (AREA.w - page.length * (colW + gap)) / 2;
      const photos = await Promise.all(page.map((issue) => imageData(issue.images[0]?.url)));
      page.forEach((issue, i) => {
        const x = startX + i * (colW + gap);
        slide.addText(
          [{ text: clean(issue.area), options: { fontSize: 9, breakLine: true } }, { text: clean(issue.title), options: { fontSize: 12 } }],
          { shape: pptx.ShapeType.rect, x, y: 1.4, w: colW, h: 0.8, fill: { color: BLUE }, fontFace: FONT, bold: true, color: "FFFFFF", valign: "top", margin: 4 },
        );
        if (photos[i]) {
          slide.addImage(coverImage(photos[i]!, x, 2.2, colW, 2.25));
        } else {
          slide.addText("No photo", { shape: pptx.ShapeType.rect, x, y: 2.2, w: colW, h: 2.25, fill: { color: "F2F2F2" }, align: "center", fontFace: FONT, fontSize: 10, italic: true, color: "A6A6A6" });
        }
        const handling = issue.actionType === "Escalated" ? `Escalated${issue.escalatedTo ? ` to ${issue.escalatedTo}` : ""}` : "Maintenance issue";
        slide.addText(
          [{ text: `${issue.risk} Risk`, options: { bold: true, breakLine: true } }, { text: `(${handling}${issue.action ? ` - ${issue.action}` : ""})`, options: { fontSize: 10 } }],
          { shape: pptx.ShapeType.rect, x, y: 4.45, w: colW, h: 1.55, fill: { color: RISK_FILL[issue.risk] || "FFC000" }, fontFace: FONT, fontSize: 12, color: TEXT, valign: "top", margin: 4 },
        );
      });
    }
  }

  // 7. Facilities gaps: two tables side by side.
  {
    const perSide = 10;
    const pages = chunk(data.gaps, perSide * 2);
    if (!pages.length) emptyNote(contentSlide("FACILITIES GAPS"), "No open facilities gaps.");
    pages.forEach((page) => {
      const slide = contentSlide("FACILITIES GAPS");
      chunk(page, perSide).forEach((side, s) => {
        const tableRows: any[] = [[headerCell("GAPS"), headerCell("CORRECTIVE ACTION")]];
        side.forEach((gap, i) => {
          const fill = { color: i % 2 ? "FFFFFF" : BLUE_LIGHT };
          tableRows.push([
            { text: `${gap.quantity ? `${gap.quantity} ` : ""}${clean(gap.gap)}`, options: { fill } },
            { text: clean(gap.correctiveAction), options: { fill } },
          ]);
        });
        slide.addTable(tableRows, { x: AREA.x + 0.2 + s * 6.05, y: 1.5, w: 5.7, colW: [3.2, 2.5], fontFace: FONT, fontSize: 11, color: TEXT, border: { type: "solid", color: "FFFFFF", pt: 1 }, valign: "middle" });
      });
    });
  }

  // 8. Update on existing SMMEs
  {
    const slide = contentSlide("UPDATE ON EXISTING SMMES");
    const tiles = (cells: Array<[string, number]>, y: number) => {
      if (!cells.length) return;
      const w = Math.min(1.9, AREA.w / cells.length);
      slide.addTable(
        [
          cells.map(([label]) => headerCell(label, MAROON)),
          cells.map(([, value]) => ({ text: String(value), options: { fill: { color: "F2F2F2" }, fontSize: 16, bold: true } })),
        ],
        { x: AREA.x + (AREA.w - w * cells.length) / 2, y, w: w * cells.length, colW: Array(cells.length).fill(w), fontFace: FONT, fontSize: 11, color: TEXT, border: { type: "solid", color: "FFFFFF", pt: 1.5 }, align: "center", valign: "middle", rowH: [0.6, 0.55] },
      );
    };
    slide.addText("Incubated SMMEs", { x: AREA.x, y: 1.45, w: AREA.w, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: MAROON, align: "center" });
    tiles([["Total SMMEs", data.smmeTotal], ...data.smmeGroups], 1.85);
    slide.addText(`Enquiries in ${monthLabel(data.month)}`, { x: AREA.x, y: 3.6, w: AREA.w, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: MAROON, align: "center" });
    tiles([["Total enquiries", data.inquiryTotal], ...data.inquiryChannels], 4.0);
  }

  // 9. SMME locality
  {
    const slide = contentSlide("SMME LOCALITY");
    if (!data.localities.length) {
      emptyNote(slide, "No SMME locations are recorded.");
    } else {
      slide.addChart(
        pptx.ChartType.bar,
        [{ name: "SMMEs", labels: data.localities.map(([label]) => label), values: data.localities.map(([, value]) => value) }],
        {
          x: 1.6, y: 1.45, w: 10.1, h: 4.95, barDir: "col", chartColors: [BLUE],
          showTitle: true, title: "Locality", titleFontSize: 14, titleFontFace: FONT,
          showValue: true, dataLabelFontSize: 10, dataLabelPosition: "outEnd",
          catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
          showCatAxisTitle: true, catAxisTitle: "LOCATION / AREA", catAxisTitleFontSize: 10,
          showValAxisTitle: true, valAxisTitle: "NO. OF SMMES", valAxisTitleFontSize: 10,
          valGridLine: { color: "E7E6E6", size: 0.5 },
        },
      );
    }
  }

  // 10. Workshop occupancy
  {
    const pages = chunk(data.workshops, 9);
    if (!pages.length) emptyNote(contentSlide("WORKSHOP OCCUPANCY"), "No workshops have been captured.");
    pages.forEach((page) => {
      const slide = contentSlide("WORKSHOP OCCUPANCY");
      const tableRows: any[] = [[
        headerCell("Workshop No.", MAROON), headerCell("SMME", MAROON), headerCell("Trade", MAROON),
        headerCell("Status", MAROON), headerCell("Lease Duration", MAROON), headerCell("Comments", MAROON),
      ]];
      page.forEach((workshop, i) => {
        const fill = { color: i % 2 ? "FFFFFF" : "F2F2F2" };
        const status = effectiveLeaseStatus(workshop, data.todayKey);
        tableRows.push([
          { text: clean(workshop.workshopNo), options: { fill, bold: true, align: "center" } },
          { text: clean(workshop.smeName) || (status === "Vacant" ? "Vacant" : "—"), options: { fill } },
          { text: clean(workshop.trade), options: { fill } },
          { text: status, options: { fill, color: status === "Lease expired" ? "C00000" : TEXT } },
          { text: status === "Vacant" ? "N/A" : leaseDuration(workshop), options: { fill } },
          { text: clean(workshop.comments), options: { fill } },
        ]);
      });
      slide.addTable(tableRows, { x: AREA.x + 0.2, y: 1.45, w: AREA.w - 0.4, colW: [1.1, 2.4, 2.6, 1.6, 1.9, 2.1], fontFace: FONT, fontSize: 10, color: TEXT, border: { type: "solid", color: "FFFFFF", pt: 1 }, valign: "middle", rowH: 0.42 });
    });
  }

  // 11. Staff attendance heatmap: one row per person, one column per working day.
  chunk(data.attendance, 12).forEach((page) => {
    const slide = contentSlide(`STAFF ATTENDANCE - ${monthLabel(data.month).toUpperCase()}`);
    const days = page[0]?.days || [];
    const nameW = 2.2;
    const pctW = 0.75;
    const dayW = Math.min(0.42, (AREA.w - nameW - pctW) / Math.max(1, days.length));
    const tableRows: any[] = [[
      headerCell("Staff", MAROON),
      ...days.map(({ day }) => ({
        text: [{ text: WEEKDAY[day.date.getUTCDay()], options: { fontSize: 7, breakLine: true } }, { text: String(day.date.getUTCDate()) }],
        options: { bold: true, color: "FFFFFF", fill: { color: MAROON }, align: "center" },
      })),
      headerCell("Present", MAROON),
    ]];
    page.forEach(({ person, days: personDays }) => {
      const counted = personDays.filter((day) => !["closed", "upcoming"].includes(day.status));
      const present = counted.filter((day) => day.status === "onsite" || day.status === "remote").length;
      tableRows.push([
        { text: [{ text: person.name, options: { bold: true, breakLine: true } }, { text: person.title, options: { fontSize: 7, color: "595959" } }], options: {} },
        ...personDays.map((day) => ({ text: "", options: { fill: { color: ATTENDANCE_FILL[day.status] || "FFFFFF" } } })),
        { text: counted.length ? `${Math.round((present / counted.length) * 100)}%` : "—", options: { bold: true, align: "center" } },
      ]);
    });
    const tableW = nameW + dayW * days.length + pctW;
    slide.addTable(tableRows, { x: AREA.x + (AREA.w - tableW) / 2, y: 1.4, w: tableW, colW: [nameW, ...days.map(() => dayW), pctW], fontFace: FONT, fontSize: 9, color: TEXT, border: { type: "solid", color: "FFFFFF", pt: 1 }, valign: "middle", rowH: 0.34, margin: 0.03 });
    const legend: Array<[DayStatus, string]> = [["onsite", "Onsite"], ["remote", "Remote"], ["leave", "On leave"], ["absent", "No record"], ["closed", "Closed"]];
    legend.forEach(([status, label], i) => {
      const x = AREA.x + 0.2 + i * 1.5;
      slide.addShape(pptx.ShapeType.rect, { x, y: 6.2, w: 0.25, h: 0.18, fill: { color: ATTENDANCE_FILL[status]! }, line: { color: "BFBFBF", width: 0.5 } });
      slide.addText(label, { x: x + 0.32, y: 6.17, w: 1.1, h: 0.24, fontFace: FONT, fontSize: 9, color: TEXT, margin: 0 });
    });
  });

  // 12. Needs assessment list
  {
    const total = data.needs.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
    const pages = chunk(data.needs, 13);
    if (!pages.length) emptyNote(contentSlide("NEEDS ASSESSMENT LIST: PRICING"), "No needs have been captured.");
    pages.forEach((page, p) => {
      const slide = contentSlide("NEEDS ASSESSMENT LIST: PRICING");
      const tableRows: any[] = [[headerCell("QUANTITY"), headerCell("NEEDS IDENTIFIED"), headerCell("PRODUCT"), headerCell("PRICE")]];
      page.forEach((item, i) => {
        const fill = { color: i % 2 ? "FFFFFF" : BLUE_LIGHT };
        tableRows.push([
          { text: String(item.quantity || 1), options: { fill, align: "center" } },
          { text: clean(item.need), options: { fill } },
          { text: clean(item.product), options: { fill } },
          { text: item.price === null || item.price === undefined ? "—" : rand(Number(item.price)), options: { fill, align: "right" } },
        ]);
      });
      if (p === pages.length - 1) {
        tableRows.push([
          { text: "TOTAL", options: { colspan: 3, bold: true, fill: { color: "D9D9D9" } } },
          { text: rand(total), options: { bold: true, align: "right", fill: { color: "D9D9D9" } } },
        ]);
      }
      slide.addTable(tableRows, { x: AREA.x + 0.4, y: 1.4, w: AREA.w - 0.8, colW: [1.2, 3.8, 4.1, 2.2], fontFace: FONT, fontSize: 10, color: TEXT, border: { type: "solid", color: "FFFFFF", pt: 1 }, valign: "middle", rowH: 0.33 });
    });
  }

  // 13. Challenges
  {
    const pages = chunk(data.challenges, 8);
    if (!pages.length) emptyNote(contentSlide("CHALLENGES"), "No open challenges recorded by centre staff.");
    pages.forEach((page) => {
      const slide = contentSlide("CHALLENGES");
      const tableRows: any[] = [[headerCell("Challenge", MAROON), headerCell("Solution", MAROON), headerCell("Action", MAROON)]];
      page.forEach((item, i) => {
        const fill = { color: i % 2 ? "FFFFFF" : "F2F2F2" };
        tableRows.push([{ text: item.challenge, options: { fill } }, { text: item.solution, options: { fill } }, { text: item.action, options: { fill } }]);
      });
      slide.addTable(tableRows, { x: AREA.x + 0.2, y: 1.45, w: AREA.w - 0.4, colW: [5.2, 3.8, 2.7], fontFace: FONT, fontSize: 10, color: TEXT, border: { type: "solid", color: "FFFFFF", pt: 1 }, valign: "middle" });
    });
  }

  // 14. Thank you
  addClosing(deck, { centre: data.branchName, presenter: data.presenter, email: data.presenterEmail });

  return {
    buffer: await deckBuffer(deck),
    fileName: `${data.branchName.replace(/[^\w]+/g, "_")}_Executive_Operations_Report_${data.month}.pptx`,
    title: `${data.branchName} Executive & Operations Report, ${monthLabel(data.month)}`,
  };
}
