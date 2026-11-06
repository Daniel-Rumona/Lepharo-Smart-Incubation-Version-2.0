"use strict";
// WhatsApp side of outcome check-backs. Pure decisions only (no Firestore, no
// network), so the rules for who may answer what can be tested on their own.
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideFollowUpTap = exports.smeDispatch = exports.facilitatorDispatch = exports.buttonPayload = exports.firstName = exports.cleanVariable = exports.SME_BUTTONS = exports.FACILITATOR_BUTTONS = exports.TEMPLATE_LANGUAGE = exports.SME_TEMPLATE = exports.FACILITATOR_TEMPLATE = void 0;
exports.FACILITATOR_TEMPLATE = "lph_checkback_facilitator";
exports.SME_TEMPLATE = "lph_checkback_sme";
exports.TEMPLATE_LANGUAGE = "en";
// Button order must match the order of the quick-reply buttons on the approved templates.
exports.FACILITATOR_BUTTONS = [
    { code: "ACHIEVED", value: "achieved", label: "Achieved" },
    { code: "PARTIAL", value: "partial", label: "Partially" },
    { code: "NOT_YET", value: "not_yet", label: "Not yet" },
];
exports.SME_BUTTONS = [
    { code: "YES", value: "yes", label: "Yes, still using it" },
    { code: "PARTLY", value: "partly", label: "Partly" },
    { code: "NO", value: "no", label: "No" },
];
const clean = (value) => String(value ?? "").trim();
/** Template variables may not contain line breaks, tabs or runs of spaces. */
const cleanVariable = (value, fallback, max = 80) => {
    const text = clean(value).replace(/\s+/g, " ").slice(0, max).trim();
    return text || fallback;
};
exports.cleanVariable = cleanVariable;
const firstName = (value, fallback = "there") => {
    const first = clean(value).split(/\s+/)[0];
    return first ? first.slice(0, 40) : fallback;
};
exports.firstName = firstName;
const buttonPayload = (followUpId, code) => `LPH|FU|${followUpId}|${code}`;
exports.buttonPayload = buttonPayload;
function facilitatorDispatch(input) {
    return {
        engine: "LPH",
        to: input.to,
        type: "outcome_follow_up",
        template: exports.FACILITATOR_TEMPLATE,
        language: exports.TEMPLATE_LANGUAGE,
        variables: [
            (0, exports.firstName)(input.facilitatorName),
            (0, exports.cleanVariable)(input.interventionTitle, "your intervention"),
            (0, exports.cleanVariable)(input.smeName, "the business"),
        ],
        buttons: exports.FACILITATOR_BUTTONS.map((button) => ({ payload: (0, exports.buttonPayload)(input.followUpId, button.code) })),
        followUpId: input.followUpId,
    };
}
exports.facilitatorDispatch = facilitatorDispatch;
function smeDispatch(input) {
    return {
        engine: "LPH",
        to: input.to,
        type: "outcome_follow_up",
        template: exports.SME_TEMPLATE,
        language: exports.TEMPLATE_LANGUAGE,
        variables: [(0, exports.firstName)(input.smeName), (0, exports.cleanVariable)(input.interventionTitle, "your support")],
        buttons: exports.SME_BUTTONS.map((button) => ({ payload: (0, exports.buttonPayload)(input.followUpId, button.code) })),
        followUpId: input.followUpId,
    };
}
exports.smeDispatch = smeDispatch;
const labelFor = (code) => [...exports.FACILITATOR_BUTTONS, ...exports.SME_BUTTONS].find((button) => button.code === code)?.label || "your answer";
/**
 * Decides what a button tap may do. A facilitator can only answer a check-back
 * assigned to them; an SME can only answer their own, and only when the HOD
 * asked for the SME's view. Anything already answered stays as it was.
 */
function decideFollowUpTap(context) {
    const { followUp, code } = context;
    if (!followUp || !Object.keys(followUp).length) {
        return { ok: false, reply: "I could not find that check-back. It may have been removed." };
    }
    const facilitator = exports.FACILITATOR_BUTTONS.find((button) => button.code === code);
    if (facilitator) {
        if (!context.staffOwnerIds.includes(clean(followUp.assigneeId))) {
            return { ok: false, reply: "That check-back is not assigned to you." };
        }
        if (followUp.answer) {
            return { ok: false, reply: "That check-back already has an answer recorded." };
        }
        return {
            ok: true,
            patch: { answer: facilitator.value, answeredVia: "whatsapp", answeredBy: clean(followUp.assigneeId) },
            reply: `Thank you. Recorded as "${facilitator.label}".`,
        };
    }
    const sme = exports.SME_BUTTONS.find((button) => button.code === code);
    if (sme) {
        if (followUp.smeCheckIn !== true) {
            return { ok: false, reply: "This check-back does not need an answer from you." };
        }
        const isThisSme = context.participantIds.includes(clean(followUp.participantId)) || context.smeConsentNumberMatches;
        if (!isThisSme) {
            return { ok: false, reply: "That check-back is not linked to your business." };
        }
        if (followUp.smeAnswer) {
            return { ok: false, reply: "You have already answered this. Thank you." };
        }
        return { ok: true, patch: { smeAnswer: sme.value }, reply: `Thank you. Recorded as "${sme.label}".` };
    }
    return { ok: false, reply: `I did not recognise ${labelFor(code)}.` };
}
exports.decideFollowUpTap = decideFollowUpTap;
//# sourceMappingURL=whatsappCheckBackLogic.js.map