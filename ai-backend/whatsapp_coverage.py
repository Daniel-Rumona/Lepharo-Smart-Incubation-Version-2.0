from typing import Any, Optional

from lph_gateway import GatewayError, LphGateway
from whatsapp_menu import buttons_ui, list_ui
from whatsapp_staff import TurnResult, _strip

# Facilitators recording a finished session's coverage on WhatsApp (the gateway's whatsappCoverage.ts
# mirrors "Record coverage" on the appointments page). The gateway keeps the draft and says which step
# comes next; this only asks each question, mostly with buttons, and reads the answer:
# held? -> (not held) reason and note | (held) each SME's attendance -> summary -> confirm.

PICK_PREFIX = "lph:cov:"
_HELD = "lph:covheld:"
_REASON = "lph:covwhy:"
_ATTEND = "lph:covatt:"
_ALL = "lph:covall:"
_EACH = "lph:coveach:"
_SAVE = "lph:covok:"
_DISCARD = "lph:covno:"
_AWAITING = "cov:"

REASONS = [("no-show", "SME didn't come"), ("cancelled", "It was cancelled"), ("other", "Another reason")]
_YES = {"yes", "y", "yep", "it was", "held", "1"}
_NO = {"no", "n", "nope", "not held", "2"}
_SKIP = {"skip", "no", "none", "-", "n/a", "na"}

ERRORS = {
    "session_not_found": "I couldn't find that session among yours.",
    "coverage_not_due": "That session already has its coverage, or hasn't finished yet.",
    "training_coverage_on_web": "Training Academy sessions need the formal topics covered, so please record this one on the Lepharo platform.",
    "assignment_not_linked": (
        "I couldn't tell which intervention this session belongs to, so I haven't guessed. "
        "Please record it on the Lepharo platform, where an administrator can link it."
    ),
    "no_coverage_in_progress": "That recording has expired. Choose *Record a session* in the menu to start again.",
    "reschedule_on_web": "To move a session to a new date, please use Reschedule on the Lepharo platform.",
    "coverage_too_large": "This group is too large to record on WhatsApp - please use the Lepharo platform.",
}


def _error_turn(error: GatewayError) -> TurnResult:
    text = str(error)
    for code, reply in ERRORS.items():
        if code in text:
            return TurnResult(reply, intent="coverage")
    print("WhatsApp coverage step failed:", text, flush=True)
    return TurnResult("I couldn't do that just now. Please try again in a moment.", intent="unavailable")


def pending_reply(gateway: LphGateway, phone: str) -> TurnResult:
    """The menu's "Record a session": the facilitator's finished sessions that still need coverage."""
    try:
        result = _strip(gateway.call("coverage_pending", phone))
    except GatewayError as error:
        return _error_turn(error)
    sessions = result.get("sessions") or []
    if not sessions:
        return TurnResult("You have no sessions waiting for coverage. \U0001f389", intent="coverage")
    rows, lines = [], []
    for index, session in enumerate(sessions, start=1):
        smes = ", ".join(session.get("smes") or []) or "SMEs"
        detail = "Training - record on the web" if session.get("webOnly") else f"{session.get('when', '')} - {smes}"
        rows.append({"id": f"{PICK_PREFIX}{session['sessionId']}", "title": str(session.get("title") or "Session")[:24], "description": detail[:72]})
        lines.append(f"{index}. {session.get('title')} - {detail}")
    more = f"\n(Showing 10 of {result['total']}.)" if int(result.get("total") or 0) > len(sessions) else ""
    intro = "\U0001f4dd Which session would you like to record?"
    return TurnResult(
        f"{intro}\n\n" + "\n".join(lines) + more,
        f"{_AWAITING}pick",
        intent="coverage",
        interactive=list_ui(f"{intro}{more}", rows, button="Sessions", section="Waiting for coverage"),
    )


def _who(draft: dict[str, Any]) -> str:
    names = [row["participantName"] for row in draft.get("attendance") or []]
    return names[0] if len(names) == 1 else f"{len(names)} SMEs"


def _render(draft: dict[str, Any], asked_note: bool = False) -> TurnResult:
    """The question for the draft's next step."""
    sid, step = draft["sessionId"], draft.get("step")
    title = f"*{draft.get('title')}* ({draft.get('when')})"
    if step == "held":
        body = f"\U0001f4dd {title} with {_who(draft)}. Was the session held?"
        return TurnResult(f"{body}\n\nReply *YES* or *NO*.", f"{_AWAITING}{sid}:held", intent="coverage",
                          interactive=buttons_ui(body, [(f"{_HELD}{sid}:yes", "Yes, it was held"), (f"{_HELD}{sid}:no", "No")]))
    if step == "not_held_reason":
        body = "Why wasn't it held?"
        lines = "\n".join(f"{i}. {label}" for i, (_, label) in enumerate(REASONS, start=1))
        return TurnResult(f"{body}\n\n{lines}\n\nReply with a number.", f"{_AWAITING}{sid}:reason", intent="coverage",
                          interactive=buttons_ui(body, [(f"{_REASON}{sid}:{code}", label) for code, label in REASONS]))
    if step == "attendance":
        rows = draft.get("attendance") or []
        if draft.get("group") and not any(row.get("outcome") for row in rows):
            names = ", ".join(row["participantName"] for row in rows[:6]) + (", ..." if len(rows) > 6 else "")
            body = f"Did everyone attend? ({names})"
            return TurnResult(f"{body}\n\nReply *ALL* if everyone came, or *EACH* to mark them one by one.",
                              f"{_AWAITING}{sid}:all", intent="coverage",
                              interactive=buttons_ui(body, [(f"{_ALL}{sid}", "Everyone attended"), (f"{_EACH}{sid}", "Mark each one")]))
        appointment_id = draft["appointmentId"]
        body = f"Did *{draft.get('participantName')}* attend?"
        return TurnResult(f"{body}\n\nReply *YES* or *NO*.", f"{_AWAITING}{sid}:att:{appointment_id}", intent="coverage",
                          interactive=buttons_ui(body, [(f"{_ATTEND}{sid}:{appointment_id}:attended", "Attended"),
                                                        (f"{_ATTEND}{sid}:{appointment_id}:no_show", "Didn't attend")]))
    if step == "summary":
        return TurnResult("In a few sentences, what did you cover in the session? (At least 5 words.)",
                          f"{_AWAITING}{sid}:summary", intent="coverage")
    if step == "confirm" and draft.get("held") is False and not asked_note and draft.get("reasonNotHeld") is None:
        return TurnResult("Add a short note on what happened, or say *skip*.", f"{_AWAITING}{sid}:note", intent="coverage")
    # confirm
    if draft.get("held"):
        attended = [row["participantName"] for row in draft.get("attendance") or [] if row.get("outcome") == "attended"]
        absent = [row["participantName"] for row in draft.get("attendance") or [] if row.get("outcome") == "no_show"]
        details = (f"Held. Attended: {', '.join(attended) or 'nobody'}"
                   + (f". Didn't attend: {', '.join(absent)}" if absent else "")
                   + f".\nSummary: {draft.get('summary')}")
    else:
        label = dict(REASONS).get(str(draft.get("notHeldReason")), "Not held")
        details = f"Not held - {label.lower()}" + (f": {draft['reasonNotHeld']}" if draft.get("reasonNotHeld") else "") + "."
    body = f"\U0001f4dd {title}\n{details}\n\nShall I save this coverage?"
    return TurnResult(f"{body}\n\nReply *YES* to save or *NO* to discard.", f"{_AWAITING}{sid}:confirm", intent="coverage",
                      interactive=buttons_ui(body[:1024], [(f"{_SAVE}{sid}", "Save"), (f"{_DISCARD}{sid}", "Discard")]))


def _update(gateway: LphGateway, phone: str, sid: str, asked_note: bool = False, **fields: Any) -> TurnResult:
    try:
        draft = _strip(gateway.call("coverage_update", phone, sessionId=sid, **fields)).get("draft") or {}
    except GatewayError as error:
        if "summary_too_short" in str(error):
            return TurnResult("That's a bit short - please describe what you covered in at least 5 words.",
                              f"{_AWAITING}{sid}:summary", intent="coverage")
        return _error_turn(error)
    return _render(draft, asked_note=asked_note)


def _saved(result: dict[str, Any]) -> TurnResult:
    if result.get("held"):
        text = (f"✅ Coverage saved for *{result.get('title')}*: {result.get('attended', 0)} of {result.get('invited', 0)} "
                f"SME{'s' if result.get('invited') != 1 else ''} attended.")
        if result.get("progress") is not None:
            text += f" Progress is now {result['progress']}%."
        if result.get("completionRequired"):
            text += ("\n\n\U0001f3c1 That was the last planned session. Please complete the intervention with the signed MOV "
                     "on the Lepharo platform (Appointments - Ready for completion).")
    else:
        text = f"✅ Saved: *{result.get('title')}* was not held. It stays on your calendar to reschedule or close."
    return TurnResult(text, intent="coverage_saved")


def handle_coverage_turn(message: str, phone: str, awaiting: Optional[str], gateway: LphGateway) -> Optional[TurnResult]:
    """The coverage conversation for a facilitator, or None when the message isn't part of it."""
    text = (message or "").strip()
    answer = text.lower()
    try:
        if text.startswith(PICK_PREFIX):
            return _render(_strip(gateway.call("coverage_start", phone, sessionId=text[len(PICK_PREFIX):])).get("draft") or {})
        if text.startswith(_HELD):
            sid, _, value = text[len(_HELD):].rpartition(":")
            return _update(gateway, phone, sid, held=value == "yes")
        if text.startswith(_REASON):
            sid, _, code = text[len(_REASON):].rpartition(":")
            return _update(gateway, phone, sid, notHeldReason=code)
        if text.startswith(_ALL):
            return _update(gateway, phone, text[len(_ALL):], allAttended=True)
        if text.startswith(_EACH):
            sid = text[len(_EACH):]
            draft = _strip(gateway.call("coverage_update", phone, sessionId=sid)).get("draft") or {}
            return _render({**draft, "group": False})
        if text.startswith(_ATTEND):
            sid, appointment_id, outcome = (text[len(_ATTEND):].split(":") + ["", "", ""])[:3]
            return _update(gateway, phone, sid, attendance={appointment_id: outcome})
        if text.startswith(_SAVE):
            return _saved(_strip(gateway.call("coverage_submit", phone, sessionId=text[len(_SAVE):])))
        if text.startswith(_DISCARD):
            gateway.call("coverage_cancel", phone)
            return TurnResult("No problem - nothing was saved.", intent="coverage")

        if not awaiting or not awaiting.startswith(_AWAITING):
            return None
        state = awaiting[len(_AWAITING):]
        if state == "pick":
            return None  # a typed answer to the session list goes to the assistant
        sid, _, step = state.partition(":")
        if step == "held":
            if answer in _YES or answer in _NO:
                return _update(gateway, phone, sid, held=answer in _YES)
            return TurnResult("Please reply *YES* if the session was held, or *NO*.", awaiting, intent="coverage")
        if step == "reason":
            codes = {str(i): code for i, (code, _) in enumerate(REASONS, start=1)}
            code = codes.get(answer) or next((c for c, label in REASONS if answer and answer in label.lower()), None)
            if code:
                return _update(gateway, phone, sid, notHeldReason=code)
            return TurnResult("Please reply 1, 2 or 3.", awaiting, intent="coverage")
        if step == "note":
            return _update(gateway, phone, sid, asked_note=True, **({} if answer in _SKIP else {"reasonNotHeld": text}))
        if step == "all":
            if answer in {"all", "everyone", "yes", "all attended"}:
                return _update(gateway, phone, sid, allAttended=True)
            if answer in {"each", "no", "mark each", "mark each one"}:
                draft = _strip(gateway.call("coverage_update", phone, sessionId=sid)).get("draft") or {}
                return _render({**draft, "group": False})
            return TurnResult("Please reply *ALL* or *EACH*.", awaiting, intent="coverage")
        if step.startswith("att:"):
            appointment_id = step[len("att:"):]
            if answer in _YES or answer in {"attended", "present"}:
                return _update(gateway, phone, sid, attendance={appointment_id: "attended"})
            if answer in _NO or answer in {"absent", "didn't attend", "did not attend"}:
                return _update(gateway, phone, sid, attendance={appointment_id: "no_show"})
            return TurnResult("Please reply *YES* if they attended, or *NO*.", awaiting, intent="coverage")
        if step == "summary":
            return _update(gateway, phone, sid, summary=text)
        if step == "confirm":
            if answer in _YES or answer in {"save", "confirm"}:
                return _saved(_strip(gateway.call("coverage_submit", phone, sessionId=sid)))
            if answer in _NO or answer in {"discard", "cancel"}:
                gateway.call("coverage_cancel", phone)
                return TurnResult("No problem - nothing was saved.", intent="coverage")
            return TurnResult("Please reply *YES* to save, or *NO* to discard.", awaiting, intent="coverage")
    except GatewayError as error:
        return _error_turn(error)
    return None
