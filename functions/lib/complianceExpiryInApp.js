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
            applicationId,
            participantId,
            programId,
            link: "/compliance",
            createdAt: new Date(),
            readBy: {},
        }));
    }
    const smeUid = resolveSmeUid(participantId, smeEmail, recipientDirectory);
    if (smeUid) {
        writes.push(emailShared_1.db.collection("notifications").add({
            type: "compliance_expiry",
            message: `Your compliance documents need attention: ${summary}.`,
            recipientIds: [smeUid],
            applicationId,
            participantId,
            programId,
            link: "/incubatee/compliance",
            createdAt: new Date(),
            readBy: {},
        }));
    }
    await Promise.all(writes);
}
exports.createComplianceExpiryInAppNotifications = createComplianceExpiryInAppNotifications;
/**
 * The SME's login: the incubatee user whose users.participantId is this
 * participant (docs/sme-identity-migration-plan.md). Unlinked SMEs are matched
 * by email against users where role == 'incubatee' instead.
 * No match -> they simply don't get a personal in-app notification (they
 * still get the existing email, unchanged).
 */
function resolveSmeUid(participantId, smeEmail, directory) {
    const id = String(participantId || "").trim();
    if (id) {
        const linked = directory.users.find((snapshot) => {
            const data = snapshot.data();
            return String(data.role || "").toLowerCase() === "incubatee" &&
                String(data.participantId || "").trim() === id;
        });
        if (linked)
            return linked.id;
    }
    // email fallback until Phase 4 (docs/sme-identity-migration-plan.md)
    if (!smeEmail)
        return null;
    const lowerEmail = smeEmail.trim().toLowerCase();
    const match = directory.users.find((snapshot) => {
        const data = snapshot.data();
        return String(data.role || "").toLowerCase() === "incubatee" &&
            String(data.email || "").trim().toLowerCase() === lowerEmail;
    });
    return match ? match.id : null;
}
//# sourceMappingURL=complianceExpiryInApp.js.map