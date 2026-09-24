"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createComplianceExpiryInAppNotifications = void 0;
const emailShared_1 = require("./emailShared");
/**
 * Additive in-app companion to complianceExpiryReminderCron's existing email
 * sends (complianceExpiry.ts) -- called from inside that cron's loop, after
 * the same `unsent` due-documents gate, so it inherits that cron's proven
 * per-document-per-phase dedup for free. Does not send any email itself and
 * has no NOTIFICATION_REGISTRY entry (type 'compliance_expiry' is absent
 * from the registry on purpose, so onNotificationCreatedEmail no-ops for
 * it) -- complianceExpiryReminderCron's own sendStatusChangeNotification/
 * sendViaBrevo calls remain the only email path for this type.
 */
async function createComplianceExpiryInAppNotifications(params) {
    const { applicationId, participantId, programId, staffUids, smeEmail, due, recipientDirectory } = params;
    const expired = due.filter((item) => item.status === "expired").length;
    const expiring = due.length - expired;
    const summary = [
        expired ? `${expired} expired` : "",
        expiring ? `${expiring} expiring soon` : "",
    ].filter(Boolean).join(", ");
    const writes = [];
    if (staffUids.length) {
        writes.push(emailShared_1.db.collection("notifications").add({
            type: "compliance_expiry",
            message: `Compliance documents need attention: ${summary}.`,
            recipientIds: staffUids,
            recipientRoles: ["operations", "coordinator"],
            applicationId,
            participantId,
            programId,
            link: "/compliance",
            createdAt: new Date(),
            readBy: {},
        }));
    }
    const smeUid = smeEmail ? resolveSmeUid(smeEmail, recipientDirectory) : null;
    if (smeUid) {
        writes.push(emailShared_1.db.collection("notifications").add({
            type: "compliance_expiry",
            message: `Your compliance documents need attention: ${summary}.`,
            recipientIds: [smeUid],
            recipientRoles: ["incubatee"],
            applicationId,
            participantId,
            programId,
            link: "/incubatee/documents/compliance",
            createdAt: new Date(),
            readBy: {},
        }));
    }
    await Promise.all(writes);
}
exports.createComplianceExpiryInAppNotifications = createComplianceExpiryInAppNotifications;
/**
 * Many SMEs are tracked purely via applications/participants with no linked
 * login (no uid/userId field on those docs) -- the only way to connect one to
 * a system account is by matching their email against users where role ==
 * 'incubatee' (the role set at account creation, src/routes/registration/index.tsx).
 * No match -> they simply don't get a personal in-app notification (they
 * still get the existing email, unchanged).
 */
function resolveSmeUid(smeEmail, directory) {
    const lowerEmail = smeEmail.trim().toLowerCase();
    const match = directory.users.find((snapshot) => {
        const data = snapshot.data();
        return String(data.role || "").toLowerCase() === "incubatee" &&
            String(data.email || "").trim().toLowerCase() === lowerEmail;
    });
    return match ? match.id : null;
}
//# sourceMappingURL=complianceExpiryInApp.js.map