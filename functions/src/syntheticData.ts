/** Synthetic fixtures must never produce external or staff notifications. */
export const SYNTHETIC_ID_PREFIX = "dtseed_";

export function isSyntheticData(data: any, documentId?: string): boolean {
  if (!data) return false;
  if (data.dataOrigin === "synthetic" || data.synthetic === true) return true;
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
  ].some(
    (value) =>
      typeof value === "string" && value.startsWith(SYNTHETIC_ID_PREFIX)
  );
}

export function suppressRecordNotifications(
  data: any,
  documentId?: string
): boolean {
  return (
    data?.suppressNotifications === true || isSyntheticData(data, documentId)
  );
}

/** Preserve the isolation marker on server-generated follow-ups/assessments. */
export function syntheticMetadata(data: any): Record<string, any> {
  if (!isSyntheticData(data)) return {};
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
