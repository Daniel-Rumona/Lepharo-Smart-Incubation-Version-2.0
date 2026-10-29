"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syntheticMetadata = exports.suppressRecordNotifications = exports.isSyntheticData = exports.SYNTHETIC_ID_PREFIX = void 0;
/** Synthetic fixtures must never produce external or staff notifications. */
exports.SYNTHETIC_ID_PREFIX = "dtseed_";
function isSyntheticData(data, documentId) {
    if (!data)
        return false;
    if (data.dataOrigin === "synthetic" || data.synthetic === true)
        return true;
    return [
        documentId,
        data.id,
        data.programId,
        data.participantId,
        data.smeId,
        data.assignedInterventionId,
        data.followUpId,
        data.target?.id,
        data.actionTarget?.docId,
        data.context?.participantId,
    ].some((value) => typeof value === "string" && value.startsWith(exports.SYNTHETIC_ID_PREFIX));
}
exports.isSyntheticData = isSyntheticData;
function suppressRecordNotifications(data, documentId) {
    return (data?.suppressNotifications === true || isSyntheticData(data, documentId));
}
exports.suppressRecordNotifications = suppressRecordNotifications;
/** Preserve the isolation marker on server-generated follow-ups/assessments. */
function syntheticMetadata(data) {
    if (!isSyntheticData(data))
        return {};
    return {
        dataOrigin: "synthetic",
        suppressNotifications: true,
        ...(data.seedRunId ? { seedRunId: data.seedRunId } : {}),
        ...(data.scenarioKey ? { scenarioKey: data.scenarioKey } : {}),
        ...(data.generatorVersion
            ? { generatorVersion: data.generatorVersion }
            : {}),
    };
}
exports.syntheticMetadata = syntheticMetadata;
//# sourceMappingURL=syntheticData.js.map