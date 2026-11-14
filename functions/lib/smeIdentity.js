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
exports.linkMySmeAccount = exports.linkSmeIdentity = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("./firebase");
const smeIdentityLogic_1 = require("./smeIdentityLogic");
// Links an SME login to its participant record, both ways
// (docs/sme-identity-migration-plan.md, Phase 2). users.participantId is a
// privileged field, so only this server code writes it.
const clean = (value) => String(value ?? "").trim();
/** Links login `uid` to `participantId` in one transaction. Never overwrites an existing link. */
async function linkSmeIdentity(uid, participantId) {
    const userRef = firebase_1.db.collection("users").doc(uid);
    const participantRef = firebase_1.db.collection("participants").doc(participantId);
    return firebase_1.db.runTransaction(async (transaction) => {
        const [userSnap, participantSnap, claimants] = await Promise.all([
            transaction.get(userRef),
            transaction.get(participantRef),
            transaction.get(firebase_1.db.collection("users").where("participantId", "==", participantId).limit(5)),
        ]);
        const decision = (0, smeIdentityLogic_1.decideSmeLink)({
            uid,
            user: userSnap.exists ? userSnap.data() || {} : null,
            participantId,
            participant: participantSnap.exists ? participantSnap.data() || {} : null,
            otherClaimantUids: claimants.docs.map((doc) => doc.id),
        });
        if (decision.ok) {
            if (decision.userPatch)
                transaction.update(userRef, decision.userPatch);
            if (decision.participantPatch)
                transaction.update(participantRef, decision.participantPatch);
        }
        return decision;
    });
}
exports.linkSmeIdentity = linkSmeIdentity;
/** Participants that could belong to a login: carrying its uid, created by it, or with its email as stored or lower-cased. */
async function candidateParticipants(uid, email) {
    const queries = [
        firebase_1.db.collection("participants").where("uid", "==", uid).limit(5).get(),
        firebase_1.db.collection("participants").where("createdByUid", "==", uid).limit(5).get(),
    ];
    const emails = Array.from(new Set([email, (0, smeIdentityLogic_1.normEmail)(email)].filter(Boolean)));
    emails.forEach((value) => queries.push(firebase_1.db.collection("participants").where("email", "==", value).limit(5).get()));
    const snaps = await Promise.all(queries);
    return snaps.flatMap((snap) => snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })));
}
/**
 * The signed-in SME links its own login. With a participantId (just after saving its
 * profile) that participant must already be the caller's: carrying its uid, created by it
 * and not linked yet, or with its email.
 * Without one, the caller's participant is found the same way and linked only if exactly
 * one matches. Answers { participantId } when linked, else { participantId: null, reason }.
 */
exports.linkMySmeAccount = (0, https_1.onCall)({ timeoutSeconds: 30 }, async (request) => {
    const uid = clean(request.auth?.uid);
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Sign in first.");
    const email = clean(request.auth?.token.email);
    const user = (await firebase_1.db.collection("users").doc(uid).get()).data();
    const linkedId = clean(user?.participantId);
    const askedId = clean(request.data?.participantId);
    if (linkedId && (!askedId || askedId === linkedId)) {
        // Fills participants.uid if the other side is still missing.
        const decision = await linkSmeIdentity(uid, linkedId);
        return decision.ok ? { participantId: linkedId } : { participantId: null, reason: decision.reason };
    }
    const candidates = await candidateParticipants(uid, email);
    let participantId;
    if (askedId) {
        const asked = candidates.find((c) => c.id === askedId) ||
            await firebase_1.db.collection("participants").doc(askedId).get().then((snap) => snap.exists ? { id: snap.id, data: snap.data() || {} } : null);
        const owns = !!asked && ((0, smeIdentityLogic_1.participantIsLogins)(uid, asked.data) ||
            (!clean(asked.data.uid) && !!email && (0, smeIdentityLogic_1.normEmail)(asked.data.email) === (0, smeIdentityLogic_1.normEmail)(email)));
        if (!owns)
            throw new https_1.HttpsError("permission-denied", "That SME record is not yours.");
        participantId = askedId;
    }
    else {
        participantId = (0, smeIdentityLogic_1.pickOwnParticipant)({ uid, email, candidates });
        if (!participantId)
            return { participantId: null, reason: "no_unique_participant" };
    }
    const decision = await linkSmeIdentity(uid, participantId);
    if (!decision.ok) {
        logger.warn("linkMySmeAccount.refused", { uid, participantId, reason: decision.reason });
        return { participantId: null, reason: decision.reason };
    }
    return { participantId };
});
//# sourceMappingURL=smeIdentity.js.map