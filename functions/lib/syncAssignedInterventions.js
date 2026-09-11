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
exports.syncAssignedInterventionsDenorm = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_1 = require("./firebase");
async function getApplicationForParticipant(participantId) {
    const snap = await firebase_1.db.collection("applications").where("participantId", "==", participantId).get();
    if (snap.empty)
        return null;
    const accepted = snap.docs.find((d) => String(d.data().applicationStatus || "").toLowerCase() ===
        "accepted") || snap.docs[0];
    return accepted;
}
const clean = (value) => String(value || "").trim();
const assignmentCycleKey = (data) => clean(data?.cycleKey);
const sameAssignmentIdentity = (appointment, assignment) => {
    if (clean(appointment?.participantId) !== clean(assignment?.participantId))
        return false;
    if (clean(appointment?.interventionId) !== clean(assignment?.interventionId))
        return false;
    const appointmentProgramId = clean(appointment?.programId);
    const assignmentProgramId = clean(assignment?.programId);
    if (appointmentProgramId && assignmentProgramId && appointmentProgramId !== assignmentProgramId) {
        return false;
    }
    const appointmentCycleKey = clean(appointment?.cycleKey) || assignmentCycleKey(appointment);
    const currentCycleKey = assignmentCycleKey(assignment);
    return !appointmentCycleKey || !currentCycleKey || appointmentCycleKey === currentCycleKey;
};
const isCurrentAssignment = (data) => ["assigned", "in-progress"].includes(clean(data?.assignmentStatus).toLowerCase());
async function writeAppointmentRepairs(appointments, replacementAssignmentId, reason) {
    for (let offset = 0; offset < appointments.length; offset += 400) {
        const batch = firebase_1.db.batch();
        appointments.slice(offset, offset + 400).forEach((appointment) => {
            batch.update(appointment.ref, {
                assignedInterventionId: replacementAssignmentId,
                assignmentLinkRepairedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
                assignmentLinkRepairReason: reason,
            });
        });
        await batch.commit();
    }
}
async function repairLinksAfterAssignmentDeletion(deletedAssignmentId, deleted) {
    const participantId = clean(deleted?.participantId);
    if (!participantId || !clean(deleted?.interventionId))
        return;
    const [appointmentsSnap, assignmentsSnap] = await Promise.all([
        firebase_1.db.collection("appointments")
            .where("assignedInterventionId", "==", deletedAssignmentId)
            .get(),
        firebase_1.db.collection("assignedInterventions")
            .where("participantId", "==", participantId)
            .get(),
    ]);
    if (appointmentsSnap.empty)
        return;
    const replacements = assignmentsSnap.docs.filter((candidate) => {
        if (candidate.id === deletedAssignmentId)
            return false;
        const data = candidate.data();
        return isCurrentAssignment(data) && sameAssignmentIdentity(deleted, data);
    });
    if (replacements.length !== 1) {
        logger.warn("Appointment links were not repaired after assignment deletion", {
            deletedAssignmentId,
            participantId,
            replacementCount: replacements.length,
            appointmentCount: appointmentsSnap.size,
        });
        return;
    }
    await writeAppointmentRepairs(appointmentsSnap.docs, replacements[0].id, "assignment_deleted");
}
async function repairLinksAfterAssignmentCreation(newAssignmentId, created) {
    const participantId = clean(created?.participantId);
    if (!participantId || !clean(created?.interventionId) || !isCurrentAssignment(created))
        return;
    const appointmentsSnap = await firebase_1.db.collection("appointments")
        .where("participantId", "==", participantId)
        .get();
    const matchingAppointments = appointmentsSnap.docs.filter((appointment) => sameAssignmentIdentity(appointment.data(), created));
    if (!matchingAppointments.length)
        return;
    const linkedIds = Array.from(new Set(matchingAppointments
        .map((appointment) => clean(appointment.data()?.assignedInterventionId))
        .filter((id) => id && id !== newAssignmentId)));
    const linkedSnapshots = linkedIds.length
        ? await firebase_1.db.getAll(...linkedIds.map((id) => firebase_1.db.collection("assignedInterventions").doc(id)))
        : [];
    const existingLinkedIds = new Set(linkedSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.id));
    const staleAppointments = matchingAppointments.filter((appointment) => {
        const linkedId = clean(appointment.data()?.assignedInterventionId);
        return !linkedId || (!existingLinkedIds.has(linkedId) && linkedId !== newAssignmentId);
    });
    if (staleAppointments.length) {
        await writeAppointmentRepairs(staleAppointments, newAssignmentId, "assignment_recreated");
    }
}
exports.syncAssignedInterventionsDenorm = (0, firestore_1.onDocumentWritten)("assignedInterventions/{assignedId}", async (event) => {
    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;
    const assignedInterventionId = String(event.params.assignedId);
    if (!afterSnap || !afterSnap.exists) {
        if (beforeSnap?.exists) {
            await repairLinksAfterAssignmentDeletion(assignedInterventionId, beforeSnap.data());
        }
        return;
    }
    const a = afterSnap.data();
    if (!beforeSnap?.exists) {
        await repairLinksAfterAssignmentCreation(assignedInterventionId, a);
    }
    if (!a.participantId) {
        logger.warn(`assignedInterventions/${assignedInterventionId} has no participantId – skipping`);
        return;
    }
    const appDoc = await getApplicationForParticipant(a.participantId);
    if (!appDoc) {
        logger.warn(`No application found for participant ${a.participantId} (assignedInterventions/${assignedInterventionId})`);
        return;
    }
    const appRef = appDoc.ref;
    const appData = appDoc.data() || {};
    const interventions = appData.interventions || {};
    const assigned = Array.isArray(interventions.assigned)
        ? [...interventions.assigned]
        : [];
    const completed = Array.isArray(interventions.completed)
        ? [...interventions.completed]
        : [];
    const assigneeAccepted = String(a.assigneeAcceptanceStatus || "").toLowerCase() === "accepted";
    const userAccepted = String(a.participantAcceptanceStatus || "").toLowerCase() === "accepted";
    const assigneeCompleted = String(a.assigneeCompletionStatus || "").toLowerCase() === "completed";
    const userConfirmed = String(a.participantCompletionStatus || "").toLowerCase() === "confirmed";
    const shouldBeAssigned = assigneeAccepted && userAccepted;
    const shouldBeCompleted = assigneeCompleted && userConfirmed;
    const base = {
        assignedInterventionId,
        interventionId: a.interventionId || "",
        databaseInterventionId: a.databaseInterventionId || "",
        title: a.interventionTitle || "",
        areaOfSupport: a.areaOfSupport || "",
        dueDate: a.dueDate ?? null,
    };
    const assignedWithout = assigned.filter((x) => x.assignedInterventionId !== assignedInterventionId);
    const completedWithout = completed.filter((x) => x.assignedInterventionId !== assignedInterventionId);
    const updates = {};
    if (shouldBeAssigned) {
        assignedWithout.push({
            ...base,
            status: "assigned",
            acceptedAt: a.updatedAt || a.acceptedAt || new Date(),
        });
        updates["interventions.assigned"] = assignedWithout;
    }
    else if (assigned.length !== assignedWithout.length) {
        updates["interventions.assigned"] = assignedWithout;
    }
    if (shouldBeCompleted) {
        completedWithout.push({
            ...base,
            status: "completed",
            completedAt: a.assigneeCompletedAt || a.updatedAt || new Date(),
            feedback: a.feedback || {},
        });
        updates["interventions.completed"] = completedWithout;
    }
    else if (completed.length !== completedWithout.length) {
        updates["interventions.completed"] = completedWithout;
    }
    if (!Object.keys(updates).length) {
        return;
    }
    logger.info(`syncAssignedInterventionsDenorm → app ${appDoc.id} for assignedInterventions/${assignedInterventionId}`, updates);
    await appRef.update(updates);
});
//# sourceMappingURL=syncAssignedInterventions.js.map