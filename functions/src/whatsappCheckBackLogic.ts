// WhatsApp side of outcome check-backs. Pure decisions only (no Firestore, no
// network), so the rules for who may answer what can be tested on their own.

export const FACILITATOR_TEMPLATE = "lph_checkback_facilitator";
export const SME_TEMPLATE = "lph_checkback_sme";
export const TEMPLATE_LANGUAGE = "en";

// Button order must match the order of the quick-reply buttons on the approved templates.
export const FACILITATOR_BUTTONS = [
  { code: "ACHIEVED", value: "achieved", label: "Achieved" },
  { code: "PARTIAL", value: "partial", label: "Partially" },
  { code: "NOT_YET", value: "not_yet", label: "Not yet" },
] as const;

export const SME_BUTTONS = [
  { code: "YES", value: "yes", label: "Yes, still using it" },
  { code: "PARTLY", value: "partly", label: "Partly" },
  { code: "NO", value: "no", label: "No" },
] as const;

const clean = (value: unknown) => String(value ?? "").trim();

/** Template variables may not contain line breaks, tabs or runs of spaces. */
export const cleanVariable = (value: unknown, fallback: string, max = 80) => {
  const text = clean(value).replace(/\s+/g, " ").slice(0, max).trim();
  return text || fallback;
};

export const firstName = (value: unknown, fallback = "there") => {
  const first = clean(value).split(/\s+/)[0];
  return first ? first.slice(0, 40) : fallback;
};

export const buttonPayload = (followUpId: string, code: string) => `LPH|FU|${followUpId}|${code}`;

export type CheckBackDispatch = {
  engine: "LPH";
  to: string;
  type: "outcome_follow_up";
  template: string;
  language: string;
  variables: string[];
  buttons: Array<{ payload: string }>;
  followUpId: string;
};

export function facilitatorDispatch(input: {
  followUpId: string;
  to: string;
  facilitatorName?: string;
  interventionTitle?: string;
  smeName?: string;
}): CheckBackDispatch {
  return {
    engine: "LPH",
    to: input.to,
    type: "outcome_follow_up",
    template: FACILITATOR_TEMPLATE,
    language: TEMPLATE_LANGUAGE,
    variables: [
      firstName(input.facilitatorName),
      cleanVariable(input.interventionTitle, "your intervention"),
      cleanVariable(input.smeName, "the business"),
    ],
    buttons: FACILITATOR_BUTTONS.map((button) => ({ payload: buttonPayload(input.followUpId, button.code) })),
    followUpId: input.followUpId,
  };
}

export function smeDispatch(input: {
  followUpId: string;
  to: string;
  smeName?: string;
  interventionTitle?: string;
}): CheckBackDispatch {
  return {
    engine: "LPH",
    to: input.to,
    type: "outcome_follow_up",
    template: SME_TEMPLATE,
    language: TEMPLATE_LANGUAGE,
    variables: [firstName(input.smeName), cleanVariable(input.interventionTitle, "your support")],
    buttons: SME_BUTTONS.map((button) => ({ payload: buttonPayload(input.followUpId, button.code) })),
    followUpId: input.followUpId,
  };
}

export type TapContext = {
  followUp: Record<string, any>;
  /** Ids (document id and uid) of the Lepharo staff member who tapped, if the number matched one. */
  staffOwnerIds: string[];
  /** Participant ids of the SME who tapped, if the number matched one. */
  participantIds: string[];
  /** True when the tapping number is the WhatsApp number this SME gave their consent on. */
  smeConsentNumberMatches: boolean;
  code: string;
};

export type TapDecision =
  | { ok: true; patch: Record<string, string>; reply: string }
  | { ok: false; reply: string };

const labelFor = (code: string) =>
  [...FACILITATOR_BUTTONS, ...SME_BUTTONS].find((button) => button.code === code)?.label || "your answer";

/**
 * Decides what a button tap may do. A facilitator can only answer a check-back
 * assigned to them; an SME can only answer their own, and only when the HOD
 * asked for the SME's view. Anything already answered stays as it was.
 */
export function decideFollowUpTap(context: TapContext): TapDecision {
  const { followUp, code } = context;
  if (!followUp || !Object.keys(followUp).length) {
    return { ok: false, reply: "I could not find that check-back. It may have been removed." };
  }

  const facilitator = FACILITATOR_BUTTONS.find((button) => button.code === code);
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

  const sme = SME_BUTTONS.find((button) => button.code === code);
  if (sme) {
    if (followUp.smeCheckIn !== true) {
      return { ok: false, reply: "This check-back does not need an answer from you." };
    }
    const isThisSme =
      context.participantIds.includes(clean(followUp.participantId)) || context.smeConsentNumberMatches;
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
