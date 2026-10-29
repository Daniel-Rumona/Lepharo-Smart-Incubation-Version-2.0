"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTIFICATION_REGISTRY = exports.actionButtonsHtml = void 0;
const workflowEmailFunctions_1 = require("./workflowEmailFunctions");
const ACTION_BUTTON_COLORS = {
    primary: "#16a34a",
    danger: "#dc2626",
    default: "#0ea5e9",
};
/** Renders one styled button per notification action that has a minted link. */
function actionButtonsHtml(actions, actionLinks) {
    if (!actions?.length)
        return "";
    const buttons = actions
        .map((action) => {
        const url = actionLinks[action.actionId];
        if (!url)
            return "";
        const bg = ACTION_BUTTON_COLORS[action.style || "default"] || ACTION_BUTTON_COLORS.default;
        return `<a href="${url}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;background:${bg};color:#fff;text-decoration:none;border-radius:6px">${action.label}</a>`;
    })
        .filter(Boolean)
        .join("");
    return buttons ? `<p>${buttons}</p>` : "";
}
exports.actionButtonsHtml = actionButtonsHtml;
/**
 * Maps a `notifications.type` to how (and whether) it becomes an email.
 * A type with no entry here, or no `.email` block, simply never sends an
 * email -- this is what lets every notification type opt in without a new
 * Cloud Function trigger. See notificationEmailFanout.ts for the trigger
 * that reads this registry.
 */
exports.NOTIFICATION_REGISTRY = {
    intervention_reminder: {
        email: {
            tag: "intervention-reminder",
            resolveRecipient: async (after) => {
                const recipient = await (0, workflowEmailFunctions_1.participant)(after);
                return recipient.email ? { email: recipient.email, name: recipient.name } : null;
            },
            template: (after, recipient, actionLinks) => {
                const title = (0, workflowEmailFunctions_1.clean)(after.interventionTitle) || "your intervention";
                const subject = `Reminder: action required for ${title}`;
                const bodyLine = typeof after.message === "string" && after.message
                    ? after.message
                    : (0, workflowEmailFunctions_1.status)(after.reminderReason) === "completion"
                        ? "Please confirm completion of your intervention."
                        : "Please accept the intervention assigned to you.";
                const { html, text } = (0, workflowEmailFunctions_1.buildNotificationContent)("Intervention reminder", [`Hello ${recipient.name},`, bodyLine], "/incubatee/interventions", actionButtonsHtml(after.actions, actionLinks));
                return { subject, html, text };
            },
        },
    },
    "workflow-query-reminder": {
        email: {
            tag: "workflow-query-reminder",
            resolveRecipient: async (after) => {
                const recipient = await (0, workflowEmailFunctions_1.resolverEmail)(after);
                return recipient.email ? { email: recipient.email, name: recipient.name } : null;
            },
            template: (after, recipient) => {
                const subject = "Reminder: an open query needs your response";
                const role = (0, workflowEmailFunctions_1.clean)(after.recipientRoles?.[0]);
                const bodyLine = (role && after.message && typeof after.message === "object" && after.message[role])
                    || (typeof after.message === "string" && after.message)
                    || (after.message && typeof after.message === "object" && Object.values(after.message).find(Boolean))
                    || "You have an open query awaiting your response.";
                const { html, text } = (0, workflowEmailFunctions_1.buildNotificationContent)("Open query reminder", [`Hello ${recipient.name},`, bodyLine], "/operations");
                return { subject, html, text };
            },
        },
    },
    // Outcome check-backs (outcomeFollowUps.ts): the facilitator, then optionally the SME.
    outcome_follow_up: {
        email: {
            tag: "outcome-follow-up",
            resolveRecipient: async (after) => {
                const email = (0, workflowEmailFunctions_1.clean)(after.recipientEmail).toLowerCase();
                return email.includes("@") ? { email, name: (0, workflowEmailFunctions_1.clean)(after.recipientName) || "there" } : null;
            },
            template: (after, recipient, actionLinks) => {
                const title = (0, workflowEmailFunctions_1.clean)(after.interventionTitle) || "an intervention";
                const sme = (0, workflowEmailFunctions_1.clean)(after.participantName) || "the business";
                const { html, text } = (0, workflowEmailFunctions_1.buildNotificationContent)("Check-back due", [
                    `Hello ${recipient.name},`,
                    `It is time to check whether ${sme} has kept up the change from "${title}".`,
                    (0, workflowEmailFunctions_1.clean)(after.intendedOutcome) ? `What we wanted to see: ${(0, workflowEmailFunctions_1.clean)(after.intendedOutcome)}` : "",
                    "How is it going? Tap one:",
                ], "/coordinator/check-backs", actionButtonsHtml(after.actions, actionLinks));
                return { subject: `Check-back due: ${title} (${sme})`, html, text };
            },
        },
    },
    outcome_follow_up_sme: {
        email: {
            tag: "outcome-follow-up-sme",
            resolveRecipient: async (after) => {
                const recipient = await (0, workflowEmailFunctions_1.participant)(after);
                return recipient.email ? { email: recipient.email, name: recipient.name } : null;
            },
            template: (after, recipient, actionLinks) => {
                const title = (0, workflowEmailFunctions_1.clean)(after.interventionTitle) || "your support";
                const { html, text } = (0, workflowEmailFunctions_1.buildNotificationContent)("A quick question", [
                    `Hello ${recipient.name},`,
                    `Some time ago you completed "${title}". Are you still using what you put in place?`,
                ], "/incubatee/interventions", actionButtonsHtml(after.actions, actionLinks));
                return { subject: `Quick question about ${title}`, html, text };
            },
        },
    },
    // Finance asks the head of department who submitted a MOV pack to attach its
    // invoice (src/lib/financeActions.ts → requestPackInvoice).
    mov_invoice_requested: {
        email: {
            tag: "mov-invoice-requested",
            resolveRecipient: async (after) => {
                const recipient = await (0, workflowEmailFunctions_1.resolverEmail)(after);
                return recipient.email ? { email: recipient.email, name: recipient.name } : null;
            },
            template: (after, recipient) => {
                const bodyLine = (typeof after.message === "string" && after.message)
                    || "Finance needs the invoice for your MOV pack before it can be paid.";
                const { html, text } = (0, workflowEmailFunctions_1.buildNotificationContent)("Invoice needed for your MOV pack", [`Hello ${recipient.name},`, bodyLine], "/operations/movs");
                return { subject: "Invoice needed for your MOV pack", html, text };
            },
        },
    },
    // The HOD attached it (src/components/shared/InvoiceRequestPrompt.tsx), so
    // the finance person who asked hears back.
    mov_invoice_attached: {
        email: {
            tag: "mov-invoice-attached",
            resolveRecipient: async (after) => {
                const recipient = await (0, workflowEmailFunctions_1.resolverEmail)(after);
                return recipient.email ? { email: recipient.email, name: recipient.name } : null;
            },
            template: (after, recipient) => {
                const bodyLine = (typeof after.message === "string" && after.message)
                    || "A MOV pack invoice you requested has been attached and is ready for your decision.";
                const { html, text } = (0, workflowEmailFunctions_1.buildNotificationContent)("MOV pack invoice attached", [`Hello ${recipient.name},`, bodyLine], "/operations/inhouse/invoices");
                return { subject: "MOV pack invoice attached", html, text };
            },
        },
    },
};
//# sourceMappingURL=notificationEmailRegistry.js.map