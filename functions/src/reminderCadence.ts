/**
 * Moderate cadence shared by workflowQueryReminders.ts and
 * movValidationReminders.ts: first reminder at 2 days, again at 5 days, then
 * every 7 days while still open/unresolved. Returns the phase string for
 * daysSince, or null if nothing is due yet.
 *
 * complianceExpiry.ts keeps its own distinct, denser reminderPhase() (30/14/7/1
 * day pre-expiry buckets) -- a different purpose (approaching-deadline urgency
 * vs. "you have an unresolved backlog item"), intentionally not shared here.
 */
export function moderateCadencePhase(daysSince: number): string | null {
  if (daysSince < 2) return null;
  if (daysSince < 5) return "day-2";
  if (daysSince < 12) return "day-5";
  const weeksAfterDay5 = Math.floor((daysSince - 5) / 7);
  return `day-${5 + weeksAfterDay5 * 7}`;
}
