"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.performanceSummary = void 0;
const firebase_1 = require("./firebase");
const whatsappCommon_1 = require("./whatsappCommon");
const lineManagerLogic_1 = require("./lineManagerLogic");
const performanceSummaryLogic_1 = require("./performanceSummaryLogic");
/**
 * "Performance" on WhatsApp for the director (the CEO in the IPM toolkit): each running performance cycle,
 * how far compacts and reviews have got, and what is waiting on them (validations, and the people they
 * line-manage). Read-only; the work itself is done on the Performance page. The same people as that page
 * and the reminder job (ipmReminders.ts): active staff, not the director, not test (control) logins.
 */
const ok = (body) => ({ status: 200, body: { ok: true, matched: true, ...body } });
const fail = (status, error) => ({ status, body: { ok: false, error } });
const isControlEmail = (email) => (0, whatsappCommon_1.clean)(email).toLowerCase().endsWith("@quantilytix.co.za");
const todayInJohannesburg = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
async function performanceSummary(identity) {
    if (identity.roleGroup !== "director")
        return fail(403, "not_permitted");
    const today = todayInJohannesburg();
    const cycles = (await firebase_1.db.collection("performanceCycles").get()).docs
        .map((doc) => ({ ...doc.data(), id: doc.id }))
        .filter((cycle) => cycle.windows?.compacting && cycle.windows?.midYear && cycle.windows?.yearEnd && (0, performanceSummaryLogic_1.isRunning)(cycle, today))
        .sort((a, b) => (0, whatsappCommon_1.clean)(b.startDate).localeCompare((0, whatsappCommon_1.clean)(a.startDate)));
    if (!cycles.length)
        return ok({ cycles: [] });
    const [usersSnap, checkInSnap] = await Promise.all([
        firebase_1.db.collection("users").get(),
        firebase_1.db.collection("performanceCheckIns").select("employeeAuthUid", "date").get(),
    ]);
    const checkInDates = new Map();
    checkInSnap.docs.forEach((doc) => {
        const uid = (0, whatsappCommon_1.clean)(doc.get("employeeAuthUid"));
        checkInDates.set(uid, [...(checkInDates.get(uid) || []), (0, whatsappCommon_1.clean)(doc.get("date"))]);
    });
    const staff = usersSnap.docs
        .map((doc) => ({ id: doc.id, data: doc.data(), role: (0, lineManagerLogic_1.normalizeStaffRole)(doc.data().role) }))
        .filter((p) => p.role && p.role !== "director" && (0, lineManagerLogic_1.isActiveProfile)({ id: p.id, ...p.data }) && !isControlEmail(p.data.email));
    const summaries = [];
    for (const cycle of cycles.slice(0, 2)) {
        const [compactSnap, reviewSnap] = await Promise.all([
            firebase_1.db.collection("employeePerformanceCompacts").where("cycleId", "==", cycle.id).get(),
            firebase_1.db.collection("performanceReviews").where("cycleId", "==", cycle.id).get(),
        ]);
        const compacts = new Map(compactSnap.docs.map((doc) => [(0, whatsappCommon_1.clean)(doc.get("employeeAuthUid") || doc.get("employeeId")), doc.data()]));
        const reviews = new Map();
        reviewSnap.docs.forEach((doc) => {
            const uid = (0, whatsappCommon_1.clean)(doc.get("employeeAuthUid"));
            reviews.set(uid, { ...(reviews.get(uid) || {}), [doc.get("phase")]: doc.data() });
        });
        const states = staff.map((p) => {
            const uid = (0, whatsappCommon_1.clean)(p.data.uid || p.data.authUid || p.id);
            return {
                uid,
                name: (0, whatsappCommon_1.clean)(p.data.name || p.data.fullName) || (0, whatsappCommon_1.clean)(p.data.email).split("@")[0] || "A colleague",
                lineManagerId: (0, whatsappCommon_1.clean)(p.data.lineManagerId) || null,
                compact: compacts.get(uid) || null,
                checkInDates: checkInDates.get(uid) || [],
                reviews: reviews.get(uid) || {},
            };
        });
        summaries.push((0, performanceSummaryLogic_1.summarise)(cycle, today, states, identity.id));
    }
    return ok({ cycles: summaries });
}
exports.performanceSummary = performanceSummary;
//# sourceMappingURL=whatsappPerformance.js.map