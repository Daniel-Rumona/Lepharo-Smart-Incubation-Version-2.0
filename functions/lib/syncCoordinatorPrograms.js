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
exports.syncProgramToBranchCoordinators = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_1 = require("./firebase");
const branchIdOf = (data) => String(data?.assignedBranch?.id || data?.branchId || "").trim();
exports.syncProgramToBranchCoordinators = (0, firestore_1.onDocumentWritten)("programs/{programId}", async (event) => {
    const after = event.data?.after;
    if (!after?.exists)
        return;
    const programId = String(event.params.programId);
    const data = after.data();
    const branchId = branchIdOf(data);
    if (!branchId)
        return;
    const beforeBranchId = event.data?.before?.exists
        ? branchIdOf(event.data.before.data())
        : "";
    if (beforeBranchId === branchId)
        return;
    const coordinators = new Map();
    const queries = [
        firebase_1.db.collection("coordinators").where("branchId", "==", branchId),
        firebase_1.db.collection("coordinators").where("assignedBranch", "==", branchId),
        firebase_1.db.collection("coordinators").where("branchIds", "array-contains", branchId),
    ];
    for (const query of queries) {
        const snapshot = await query.get();
        snapshot.docs.forEach((doc) => {
            coordinators.set(doc.ref.path, doc);
        });
    }
    const writes = [];
    for (const coordinatorDoc of coordinators.values()) {
        const coordinator = coordinatorDoc.data();
        writes.push(coordinatorDoc.ref.update({
            assignedPrograms: firebase_1.admin.firestore.FieldValue.arrayUnion(programId),
            updatedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
        }));
        const uid = String(coordinator.authUid || coordinator.uid || "").trim();
        if (uid) {
            writes.push(firebase_1.db
                .collection("users")
                .doc(uid)
                .set({
                assignedPrograms: firebase_1.admin.firestore.FieldValue.arrayUnion(programId),
                updatedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true }));
        }
        else if (coordinator.email) {
            const users = await firebase_1.db
                .collection("users")
                .where("email", "==", coordinator.email)
                .get();
            users.docs.forEach((userDoc) => {
                writes.push(userDoc.ref.set({
                    assignedPrograms: firebase_1.admin.firestore.FieldValue.arrayUnion(programId),
                    updatedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true }));
            });
        }
    }
    await Promise.all(writes);
    logger.info("Extended coordinator program assignments", {
        programId,
        branchId,
        coordinators: coordinators.size,
    });
});
//# sourceMappingURL=syncCoordinatorPrograms.js.map