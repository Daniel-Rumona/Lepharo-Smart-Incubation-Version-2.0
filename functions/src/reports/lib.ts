/**
 * Pure helpers the reports share with the web app, copied here because functions can't import from src/.
 * Each mirrors a web module (named on it); change both together.
 *
 * Dates: Cloud Functions run in UTC, the web in South Africa. A South African calendar day is represented
 * here as that day at 10:00 UTC (12:00 SAST), so getDay()/getDate() give the local weekday and date.
 */

export const clean = (value: unknown) => String(value ?? "").trim();

export type SaDay = { key: string; date: Date };

const SAST_MS = 2 * 60 * 60 * 1000;

/** The SA calendar date of an instant, as YYYY-MM-DD. */
export const sastDateKey = (instant: Date) => new Date(instant.getTime() + SAST_MS).toISOString().slice(0, 10);

/** The day for a YYYY-MM-DD key. */
export const saDay = (key: string): SaDay => ({ key, date: new Date(`${key}T10:00:00Z`) });

/** Every day of a YYYY-MM month. */
export const daysOfMonth = (month: string): SaDay[] => {
  const [year, monthIndex] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => saDay(`${month}-${String(i + 1).padStart(2, "0")}`));
};

/** The instants a YYYY-MM month starts and ends at in South Africa. */
export const monthBounds = (month: string) => {
  const [year, monthIndex] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, monthIndex - 1, 1) - SAST_MS),
    end: new Date(Date.UTC(year, monthIndex, 1) - SAST_MS - 1),
  };
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
export const dateLabel = (instant: Date) => {
  const key = sastDateKey(instant);
  return `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
};
const SHORT_MONTHS = MONTHS.map((name) => name.slice(0, 3));
export const shortDateLabel = (key: string) => `${Number(key.slice(8, 10))} ${SHORT_MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/* ---------------------------------------- src/utils/southAfricanPublicHolidays.ts */

const proclaimedDates = new Set(["2021-11-01", "2022-12-27", "2023-12-15", "2024-05-29", "2026-11-04"]);
const holidayCalendars = new Map<number, Set<string>>();

const keyOf = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

export const isSouthAfricanPublicHoliday = (day: SaDay): boolean => {
  const year = day.date.getUTCFullYear();
  if (!holidayCalendars.has(year)) {
    const dates = [[1, 1], [3, 21], [4, 27], [5, 1], [6, 16], [8, 9], [9, 24], [12, 16], [12, 25], [12, 26]]
      .map(([month, dayOfMonth]) => new Date(Date.UTC(year, month - 1, dayOfMonth, 10)));
    // Gregorian Easter (Meeus/Jones/Butcher); Good Friday and Family Day move yearly.
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const easter = ((h + l - 7 * m + 114) % 31) + 1;
    dates.push(new Date(Date.UTC(year, month - 1, easter - 2, 10)), new Date(Date.UTC(year, month - 1, easter + 1, 10)));
    const calendar = new Set(dates.map(keyOf));
    for (const holiday of dates) {
      if (holiday.getUTCDay() === 0) calendar.add(keyOf(new Date(holiday.getTime() + 24 * 60 * 60 * 1000)));
    }
    holidayCalendars.set(year, calendar);
  }
  return proclaimedDates.has(day.key) || holidayCalendars.get(year)!.has(day.key);
};

/* ------------------------------------------------ src/utils/branchOperatingHours.ts */

const OPERATING_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type DayHours = { closed: boolean; opens: string; closes: string };
export type BranchOperatingHours = Record<string, DayHours> & { rules?: { publicHolidays?: DayHours | null } };

const LEGACY_SHIFT: DayHours = { closed: false, opens: "07:00", closes: "15:00" };

export const defaultOperatingHours = (): BranchOperatingHours =>
  Object.fromEntries(OPERATING_DAYS.map((key, index) => [key, { ...LEGACY_SHIFT, closed: index >= 5 }])) as BranchOperatingHours;

export const getDayHours = (hours: BranchOperatingHours, day: SaDay): DayHours => {
  if (hours.rules?.publicHolidays && isSouthAfricanPublicHoliday(day)) return hours.rules.publicHolidays;
  return hours[OPERATING_DAYS[(day.date.getUTCDay() + 6) % 7]] || LEGACY_SHIFT;
};

/* ------------------- src/routes/shared/timesheet (computeDayInfo status, leave cover) */

export type DayStatus = "onsite" | "remote" | "leave" | "absent" | "closed" | "upcoming";

/** computeDayInfo's status for one staff member's day. */
export const dayStatus = (
  day: SaDay,
  ctx: { entries: any[]; leaveRequests: any[]; hours: BranchOperatingHours; todayKey: string },
): DayStatus => {
  const leave = ctx.leaveRequests.find((item) => item.status === "approved" && day.key >= item.from && day.key <= item.to);
  const entry = ctx.entries.find((item) => item.date === day.key);
  const shift = entry?.scheduledHours || getDayHours(ctx.hours, day);
  if (leave) return "leave";
  if (entry?.checkIn) return entry.centerMatched ? "onsite" : "remote";
  if (shift.closed) return "closed";
  if (day.key > ctx.todayKey) return "upcoming";
  return "absent";
};

/* ----------------------------------------------------------- src/lib/roleLabels.ts */

const ROLE_LABELS: Record<string, string> = {
  operations: "Heads Of Departments",
  coordinator: "Project Coordinator",
  projectadmin: "Center Coordinator",
  incubatee: "SME",
  director: "Director",
  funder: "Funder",
  receptionist: "Receptionist",
  receiptionist: "Receptionist",
  system_admin: "System Admin",
  employee: "Employee",
  government: "Government",
  headsofdepartment: "Heads Of Departments",
  hod: "Heads Of Departments",
  center_coordinator: "Center Coordinator",
};

export const formatRole = (role?: string): string => {
  if (!role) return "User";
  const normalized = role.trim().toLowerCase().replace(/\s+/g, "").replace(/-/g, "_");
  return ROLE_LABELS[normalized] || role.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
};

/* ------------------------------------------------------- src/utils/inquirySource.ts */

const CHANNELS = ["Walk-in", "Phone", "Email", "Website", "Social Media", "Event", "Referral", "System", "Other"];
const PORTAL_VALUES = new Set(["sme", "beneficiary", "system", "incubatee"]);

export const resolveInquiryChannel = (raw?: string | null): string => {
  const text = clean(raw);
  if (!text) return "Other";
  if (PORTAL_VALUES.has(text.toLowerCase())) return "System";
  return CHANNELS.find((channel) => channel.toLowerCase() === text.toLowerCase()) || "Other";
};

/* ------------------------------------ src/routes/projectadmin/facilities/workshops.ts */

export const WORKSHOPS = "facilityWorkshops";

export type FacilityWorkshop = {
  workshopNo: string;
  smeName?: string;
  trade?: string;
  leaseStatus: string;
  leaseStart?: string | null;
  leaseEnd?: string | null;
  comments?: string;
};

/** A lease past its end date reads as expired whatever was last recorded. */
export const effectiveLeaseStatus = (workshop: Pick<FacilityWorkshop, "leaseStatus" | "leaseEnd">, todayKey: string) =>
  workshop.leaseStatus !== "Vacant" && workshop.leaseEnd && clean(workshop.leaseEnd).slice(0, 10) < todayKey
    ? "Lease expired"
    : workshop.leaseStatus;

const monthYear = (value: string) => `${SHORT_MONTHS[Number(value.slice(5, 7)) - 1] || "?"} ${value.slice(0, 4)}`;
export const leaseDuration = (workshop: Pick<FacilityWorkshop, "leaseStart" | "leaseEnd">) =>
  workshop.leaseStart || workshop.leaseEnd
    ? `${workshop.leaseStart ? monthYear(clean(workshop.leaseStart)) : "?"} - ${workshop.leaseEnd ? monthYear(clean(workshop.leaseEnd)) : "?"}`
    : "N/A";

export const sortWorkshops = <T extends { workshopNo: string }>(rows: T[]) =>
  [...rows].sort((a, b) => clean(a.workshopNo).localeCompare(clean(b.workshopNo), undefined, { numeric: true }));
