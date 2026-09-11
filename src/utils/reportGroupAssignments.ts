export type GroupableAssignment = Record<string, unknown>;

export type ReportAssignmentRollup<T extends GroupableAssignment> = {
  key: string;
  record: T;
  members: T[];
  status: "assigned" | "in-progress" | "completed" | "declined" | "unknown";
  isGroup: boolean;
};

export const getReportGroupKey = (record: GroupableAssignment): string | null => {
  const value = record.groupAssignmentId || record.groupId || record.groupKey;
  const key = String(value || "").trim();
  return key || null;
};

/**
 * Mirrors Shared Allocated's group lifecycle: a group is completed only when
 * every member is completed. A partially completed group remains In Progress.
 */
export const rollupReportAssignments = <T extends GroupableAssignment>(
  rows: T[],
  getStatus: (record: T) => ReportAssignmentRollup<T>["status"]
): ReportAssignmentRollup<T>[] => {
  const groups = new Map<string, T[]>();
  const singles: ReportAssignmentRollup<T>[] = [];

  rows.forEach((record, index) => {
    const groupKey = getReportGroupKey(record);
    if (!groupKey) {
      singles.push({
        key: String(record.id || `assignment:${index}`),
        record,
        members: [record],
        status: getStatus(record),
        isGroup: false,
      });
      return;
    }
    const members = groups.get(groupKey) || [];
    members.push(record);
    groups.set(groupKey, members);
  });

  const grouped = Array.from(groups.entries()).map(([key, members]) => {
    const statuses = members.map(getStatus);
    const status: ReportAssignmentRollup<T>["status"] = statuses.every((value) => value === "completed")
      ? "completed"
      : statuses.every((value) => value === "declined")
        ? "declined"
        : statuses.some((value) => value === "in-progress" || value === "completed")
          ? "in-progress"
          : statuses.some((value) => value === "assigned")
            ? "assigned"
            : "unknown";

    return { key: `group:${key}`, record: members[0], members, status, isGroup: true };
  });

  return [...grouped, ...singles];
};
