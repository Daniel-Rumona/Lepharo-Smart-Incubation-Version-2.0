import { buildNotificationContent, clean, participant, resolverEmail, status } from "./workflowEmailFunctions";

export type NotificationDoc = Record<string, any>;
export type NotificationRecipient = { email: string; name: string };
export type NotificationEmailTemplate = { subject: string; html: string; text: string };

export type NotificationTypeEmailConfig = {
  /** Brevo tag for this email, for filtering in the Brevo dashboard. */
  tag: string;
  resolveRecipient: (after: NotificationDoc) => Promise<NotificationRecipient | null>;
  /** actionLinks maps each notification action's actionId to its one-click confirm-page URL. */
  template: (after: NotificationDoc, recipient: NotificationRecipient, actionLinks: Record<string, string>) => NotificationEmailTemplate;
};

export type NotificationTypeConfig = {
  email?: NotificationTypeEmailConfig;
};

const ACTION_BUTTON_COLORS: Record<string, string> = {
  primary: "#16a34a",
  danger: "#dc2626",
  default: "#0ea5e9",
};

/** Renders one styled button per notification action that has a minted link. */
export function actionButtonsHtml(
  actions: Array<{ actionId: string; label: string; style?: string }> | undefined,
  actionLinks: Record<string, string>
): string {
  if (!actions?.length) return "";
  const buttons = actions
    .map((action) => {
      const url = actionLinks[action.actionId];
      if (!url) return "";
      const bg = ACTION_BUTTON_COLORS[action.style || "default"] || ACTION_BUTTON_COLORS.default;
      return `<a href="${url}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;background:${bg};color:#fff;text-decoration:none;border-radius:6px">${action.label}</a>`;
    })
    .filter(Boolean)
    .join("");
  return buttons ? `<p>${buttons}</p>` : "";
}

/**
 * Maps a `notifications.type` to how (and whether) it becomes an email.
 * A type with no entry here, or no `.email` block, simply never sends an
 * email -- this is what lets every notification type opt in without a new
 * Cloud Function trigger. See notificationEmailFanout.ts for the trigger
 * that reads this registry.
 */
export const NOTIFICATION_REGISTRY: Record<string, NotificationTypeConfig> = {
  intervention_reminder: {
    email: {
      tag: "intervention-reminder",
      resolveRecipient: async (after) => {
        const recipient = await participant(after);
        return recipient.email ? { email: recipient.email, name: recipient.name } : null;
      },
      template: (after, recipient, actionLinks) => {
        const title = clean(after.interventionTitle) || "your intervention";
        const subject = `Reminder: action required for ${title}`;
        const bodyLine = typeof after.message === "string" && after.message
          ? after.message
          : status(after.reminderReason) === "completion"
            ? "Please confirm completion of your intervention."
            : "Please accept the intervention assigned to you.";
        const { html, text } = buildNotificationContent(
          "Intervention reminder",
          [`Hello ${recipient.name},`, bodyLine],
          "/incubatee/interventions",
          actionButtonsHtml(after.actions, actionLinks)
        );
        return { subject, html, text };
      },
    },
  },
  "workflow-query-reminder": {
    email: {
      tag: "workflow-query-reminder",
      resolveRecipient: async (after) => {
        const recipient = await resolverEmail(after);
        return recipient.email ? { email: recipient.email, name: recipient.name } : null;
      },
      template: (after, recipient) => {
        const subject = "Reminder: an open query needs your response";
        const role = clean(after.recipientRoles?.[0]);
        const bodyLine = (role && after.message && typeof after.message === "object" && after.message[role])
          || (typeof after.message === "string" && after.message)
          || "You have an open query awaiting your response.";
        const { html, text } = buildNotificationContent(
          "Open query reminder",
          [`Hello ${recipient.name},`, bodyLine],
          "/operations"
        );
        return { subject, html, text };
      },
    },
  },
};
