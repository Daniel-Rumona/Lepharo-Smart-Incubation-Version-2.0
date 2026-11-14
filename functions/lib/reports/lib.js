"use strict";
/**
 * Pure helpers the reports share with the web app, copied here because functions can't import from src/.
 * Each mirrors a web module (named on it); change both together.
 *
 * Dates: Cloud Functions run in UTC, the web in South Africa. A South African calendar day is represented
 * here as that day at 10:00 UTC (12:00 SAST), so getDay()/getDate() give the local weekday and date.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortWorkshops = exports.leaseDuration = exports.effectiveLeaseStatus = exports.WORKSHOPS = exports.resolveInquiryChannel = exports.formatRole = exports.dayStatus = exports.getDayHours = exports.defaultOperatingHours = exports.isSouthAfricanPublicHoliday = exports.shortDateLabel = exports.dateLabel = exports.monthLabel = exports.monthBounds = exports.daysOfMonth = exports.saDay = exports.sastDateKey = exports.clean = void 0;
const clean = (value) => String(value ?? "").trim();
exports.clean = clean;
const SAST_MS = 2 * 60 * 60 * 1000;
/** The SA calendar date of an instant, as YYYY-MM-DD. */
const sastDateKey = (instant) => new Date(instant.getTime() + SAST_MS).toISOString().slice(0, 10);
exports.sastDateKey = sastDateKey;
/** The day for a YYYY-MM-DD key. */
const saDay = (key) => ({ key, date: new Date(`${key}T10:00:00Z`) });
exports.saDay = saDay;
/** Every day of a YYYY-MM month. */
const daysOfMonth = (month) => {
    const [year, monthIndex] = month.split("-").map(Number);
    const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
    return Array.from({ length: last }, (_, i) => (0, exports.saDay)(`${month}-${String(i + 1).padStart(2, "0")}`));
};
exports.daysOfMonth = daysOfMonth;
/** The instants a YYYY-MM month starts and ends at in South Africa. */
const monthBounds = (month) => {
    const [year, monthIndex] = month.split("-").map(Number);
    return {
        start: new Date(Date.UTC(year, monthIndex - 1, 1) - SAST_MS),
        end: new Date(Date.UTC(year, monthIndex, 1) - SAST_MS - 1),
    };
};
exports.monthBounds = monthBounds;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (month) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
exports.monthLabel = monthLabel;
const dateLabel = (instant) => {
    const key = (0, exports.sastDateKey)(instant);
    return `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
};
exports.dateLabel = dateLabel;
const SHORT_MONTHS = MONTHS.map((name) => name.slice(0, 3));
const shortDateLabel = (key) => `${Number(key.slice(8, 10))} ${SHORT_MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
exports.shortDateLabel = shortDateLabel;
/* ---------------------------------------- src/utils/southAfricanPublicHolidays.ts */
const proclaimedDates = new Set(["2021-11-01", "2022-12-27", "2023-12-15", "2024-05-29", "2026-11-04"]);
const holidayCalendars = new Map();
const keyOf = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
const isSouthAfricanPublicHoliday = (day) => {
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
            if (holiday.getUTCDay() === 0)
                calendar.add(keyOf(new Date(holiday.getTime() + 24 * 60 * 60 * 1000)));
        }
        holidayCalendars.set(year, calendar);
    }
    return proclaimedDates.has(day.key) || holidayCalendars.get(year).has(day.key);
};
exports.isSouthAfricanPublicHoliday = isSouthAfricanPublicHoliday;
/* ------------------------------------------------ src/utils/branchOperatingHours.ts */
const OPERATING_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const LEGACY_SHIFT = { closed: false, opens: "07:00", closes: "15:00" };
const defaultOperatingHours = () => Object.fromEntries(OPERATING_DAYS.map((key, index) => [key, { ...LEGACY_SHIFT, closed: index >= 5 }]));
exports.defaultOperatingHours = defaultOperatingHours;
const getDayHours = (hours, day) => {
    if (hours.rules?.publicHolidays && (0, exports.isSouthAfricanPublicHoliday)(day))
        return hours.rules.publicHolidays;
    return hours[OPERATING_DAYS[(day.date.getUTCDay() + 6) % 7]] || LEGACY_SHIFT;
};
exports.getDayHours = getDayHours;
/** computeDayInfo's status for one staff member's day. */
const dayStatus = (day, ctx) => {
    const leave = ctx.leaveRequests.find((item) => item.status === "approved" && day.key >= item.from && day.key <= item.to);
    const entry = ctx.entries.find((item) => item.date === day.key);
    const shift = entry?.scheduledHours || (0, exports.getDayHours)(ctx.hours, day);
    if (leave)
        return "leave";
    if (entry?.checkIn)
        return entry.centerMatched ? "onsite" : "remote";
    if (shift.closed)
        return "closed";
    if (day.key > ctx.todayKey)
        return "upcoming";
    return "absent";
};
exports.dayStatus = dayStatus;
/* ----------------------------------------------------------- src/lib/roleLabels.ts */
const ROLE_LABELS = {
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
const formatRole = (role) => {
    if (!role)
        return "User";
    const normalized = role.trim().toLowerCase().replace(/\s+/g, "").replace(/-/g, "_");
    return ROLE_LABELS[normalized] || role.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
};
exports.formatRole = formatRole;
/* ------------------------------------------------------- src/utils/inquirySource.ts */
const CHANNELS = ["Walk-in", "Phone", "Email", "Website", "Social Media", "Event", "Referral", "System", "Other"];
const PORTAL_VALUES = new Set(["sme", "beneficiary", "system", "incubatee"]);
const resolveInquiryChannel = (raw) => {
    const text = (0, exports.clean)(raw);
    if (!text)
        return "Other";
    if (PORTAL_VALUES.has(text.toLowerCase()))
        return "System";
    return CHANNELS.find((channel) => channel.toLowerCase() === text.toLowerCase()) || "Other";
};
exports.resolveInquiryChannel = resolveInquiryChannel;
/* ------------------------------------ src/routes/projectadmin/facilities/workshops.ts */
exports.WORKSHOPS = "facilityWorkshops";
/** A lease past its end date reads as expired whatever was last recorded. */
const effectiveLeaseStatus = (workshop, todayKey) => workshop.leaseStatus !== "Vacant" && workshop.leaseEnd && (0, exports.clean)(workshop.leaseEnd).slice(0, 10) < todayKey
    ? "Lease expired"
    : workshop.leaseStatus;
exports.effectiveLeaseStatus = effectiveLeaseStatus;
const monthYear = (value) => `${SHORT_MONTHS[Number(value.slice(5, 7)) - 1] || "?"} ${value.slice(0, 4)}`;
const leaseDuration = (workshop) => workshop.leaseStart || workshop.leaseEnd
    ? `${workshop.leaseStart ? monthYear((0, exports.clean)(workshop.leaseStart)) : "?"} - ${workshop.leaseEnd ? monthYear((0, exports.clean)(workshop.leaseEnd)) : "?"}`
    : "N/A";
exports.leaseDuration = leaseDuration;
const sortWorkshops = (rows) => [...rows].sort((a, b) => (0, exports.clean)(a.workshopNo).localeCompare((0, exports.clean)(b.workshopNo), undefined, { numeric: true }));
exports.sortWorkshops = sortWorkshops;
//# sourceMappingURL=lib.js.map