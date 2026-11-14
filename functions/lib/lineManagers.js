"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recalculateLineManagers = exports.onUserLineManagerInputs = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("./firebase");
const departmentRoles_1 = require("./departmentRoles");
const firestore_2 = require("./utils/firestore");
const lineManagerLogic_1 = require("./lineManagerLogic");
const BATCH_SIZE = 400;
const clean = (value) => String(value ?? "").trim();
/** Fields that can change who someone's default line manager is. */
const WATCHED_FIELDS = ["role", "departmentId", "assignedBranch", "branchId", "status", "lineManagerSource"];
/** IPM records that carry the employee's lineManagerId for access rules. */
const PERFORMANCE_COLLECTIONS = ["employeePerformanceCompacts", "employeePerformanceReviews"];
async function loadStaff() {
    const snapshot = await firebase_1.db
        .collection("users")
        .select("role", "departmentId", "assignedBranch", "branchId", "status", "lineManagerId", "lineManagerSource")
        .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
/** Bring every non-manual employee's lineManagerId to its default. */
async function applyDefaultLineManagers(staff) {
    const patches = (0, lineManagerLogic_1.lineManagerPatches)(staff);
    for (const chunk of (0, firestore_2.chunkArray)(patches, BATCH_SIZE)) {
        const batch = firebase_1.db.batch();
        for (const patch of chunk) {
            batch.update(firebase_1.db.collection("users").doc(patch.id), {
                lineManagerId: patch.lineManagerId ?? firebase_1.admin.firestore.FieldValue.delete(),
            });
        }
        await batch.commit();
    }
    return patches.length;
}
/**
 * Any change to a role, department, branch or status can move someone's
 * default manager, including everyone who reported to the person who changed.
 * The org is small, so recompute everyone; only real differences are written,
 * and lineManagerId is not watched, so the writes do not retrigger this.
 */
exports.onUserLineManagerInputs = (0, firestore_1.onDocumentWritten)("users/{uid}", async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const changed = WATCHED_FIELDS.some((field) => clean(before[field]) !== clean(after[field]));
    if (!changed)
        return;
    const updated = await applyDefaultLineManagers(await loadStaff());
    if (updated)
        logger.info("[lineManagers] defaults refreshed", { trigger: event.params.uid, updated });
});
/**
 * HR or the CEO: recompute every default line manager and stamp the current
 * manager onto older IPM records that predate lineManagerId.
 */
exports.recalculateLineManagers = (0, https_1.onCall)(async (req) => {
    const callerUid = req.auth?.uid;
    if (!callerUid)
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    const callerSnap = await firebase_1.db.collection("users").doc(callerUid).get();
    const caller = callerSnap.data() || {};
    const callerRole = clean(caller.role).toLowerCase();
    const allowed = ["system_admin", "superadmin", "director"].includes(callerRole) ||
        (await (0, departmentRoles_1.isHrManagerProfile)(caller)) ||
        (await (0, departmentRoles_1.isDepartmentInRole)(clean(caller.departmentId), "hr"));
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "Only HR or the CEO can recalculate line managers.");
    const staff = await loadStaff();
    const usersUpdated = await applyDefaultLineManagers(staff);
    // Re-read so the stamp uses the managers just written.
    const managerById = new Map((await loadStaff()).map((person) => [person.id, clean(person.lineManagerId)]));
    let recordsUpdated = 0;
    for (const collection of PERFORMANCE_COLLECTIONS) {
        const snapshot = await firebase_1.db.collection(collection).get();
        const missing = snapshot.docs.filter((doc) => !clean(doc.get("lineManagerId")));
        for (const chunk of (0, firestore_2.chunkArray)(missing, BATCH_SIZE)) {
            const batch = firebase_1.db.batch();
            let writes = 0;
            for (const doc of chunk) {
                const employeeUid = clean(doc.get("employeeAuthUid") || doc.get("employeeId"));
                const managerId = managerById.get(employeeUid);
                if (!managerId)
                    continue;
                batch.update(doc.ref, { lineManagerId: managerId });
                writes += 1;
            }
            if (writes)
                await batch.commit();
            recordsUpdated += writes;
        }
    }
    logger.info("[lineManagers] recalculated", { callerUid, usersUpdated, recordsUpdated });
    return { usersUpdated, recordsUpdated };
});
//# sourceMappingURL=lineManagers.js.map