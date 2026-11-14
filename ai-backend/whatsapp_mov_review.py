from typing import Any, Optional

from lph_gateway import GatewayError, LphGateway
from whatsapp_menu import buttons_ui, list_ui
from whatsapp_staff import TurnResult, _strip

# Heads of department approving or querying their department's MOVs on WhatsApp. The gateway
# (functions/src/whatsappMovReview.ts) decides which MOVs are theirs and makes the same writes as the
# web MOV workspace; this only shows them and asks. Nothing is written without a final yes:
# list -> one MOV -> Approve -> confirm | Query -> what kind -> the message -> confirm.

_OPEN = "lph:movr:"
_APPROVE = "lph:mova:"
_APPROVE_OK = "lph:movok:"
_QUERY = "lph:movq:"
_QUERY_TYPE = "lph:movqt:"
_QUERY_SEND = "lph:movqs:"
_NEXT = "lph:movnext"
_CANCEL = "lph:movx"
_AWAITING = "movr:"

QUERY_TYPES = [
    ("poe-request", "Evidence (POE)", "What's wrong with the evidence?"),
    ("mov-issue", "Session details", "Which details are wrong?"),
    ("general-query", "Something else", "What's the issue?"),
]
_YES = {"yes", "y", "yep", "ok", "okay", "approve", "send", "confirm", "go ahead"}
_NO = {"no", "n", "nope", "cancel", "stop", "don't", "dont", "discard"}

ERRORS = {
    "mov_not_found": "I couldn't find that MOV among your department's MOVs.",
    "mov_already_approved": "That MOV has already been approved.",
    "mov_already_queried": "That MOV has already been queried; it comes back to you once the facilitator answers.",
    "mov_not_ready": "That MOV isn't waiting for your review (the SME hasn't confirmed it yet).",
    "mov_no_facilitator": "This MOV has no facilitator on record, so a query can't be sent. Ask the ROM team to repair it first.",
    "mov_no_programme": "This MOV has no programme on record, so a query can't be sent. Please query it on the Lepharo platform.",
    "no_query_draft": "That query has expired. Choose *Query* on the MOV again to write it.",
    "not_permitted": "Approving MOVs on WhatsApp is for heads of department.",
}


def _error_turn(error: GatewayError) -> TurnResult:
    text = str(error)
    for code, reply in ERRORS.items():
        if code in text:
            return TurnResult(reply, intent="mov_review")
    print("WhatsApp MOV review step failed:", text, flush=True)
    return TurnResult("I couldn't do that just now. Please try again in a moment.", intent="unavailable")


def _label(mov: dict[str, Any]) -> str:
    return f"*{mov.get('sme')}* - {mov.get('intervention')}"


def pending_reply(gateway: LphGateway, phone: str) -> TurnResult:
    """The menu's "MOVs to approve": the department's MOVs the SME has confirmed, longest waiting first."""
    try:
        result = _strip(gateway.call("mov_review_pending", phone))
    except GatewayError as error:
        return _error_turn(error)
    movs = result.get("movs") or []
    where = f" on *{result['programme']}*" if result.get("programme") else ""
    if not movs:
        return TurnResult(f"Nothing is waiting for your approval{where}. \U0001f389", intent="mov_review")
    rows, lines = [], []
    for index, mov in enumerate(movs, start=1):
        flag = " ⚠️" if mov.get("evidenceWarning") or not mov.get("evidence") else ""
        rows.append({"id": f"{_OPEN}{mov['movId']}", "title": str(mov.get("sme"))[:24],
                     "description": f"{mov.get('intervention')}{' - check the evidence' if flag else ''}"[:72]})
        lines.append(f"{index}. {_label(mov)}{flag}")
    total = int(result.get("total") or len(movs))
    more = f"\n(The {len(movs)} that have waited longest, of {total}.)" if total > len(movs) else ""
    intro = f"\U0001f4c4 MOVs waiting for your approval{where}:"
    return TurnResult(
        f"{intro}\n\n" + "\n".join(lines) + more + "\n\nReply with a number to open one.",
        f"{_AWAITING}pick",
        intent="mov_review",
        interactive=list_ui(f"{intro}{more}\n\nOpen one to approve or query it.", rows, button="MOVs", section="To review"),
    )


def _detail(gateway: LphGateway, phone: str, mov_id: str) -> TurnResult:
    result = _strip(gateway.call("mov_review_detail", phone, movId=mov_id))
    mov = result.get("mov") or {}
    lines = [f"\U0001f4c4 {_label(mov)}"]
    if mov.get("facilitator"):
        lines.append(f"Facilitator: {mov['facilitator']}")
    lines.append("Evidence: attached" if mov.get("evidence") else "⚠️ No evidence attached")
    if mov.get("evidenceWarning"):
        summary = f" - {mov['evidenceSummary']}" if mov.get("evidenceSummary") else ""
        lines.append(f"⚠️ The evidence check found it {mov['evidenceWarning']}{summary}")
    open_queries = int(result.get("ownOpenQueries") or 0) + int(result.get("otherOpenQueries") or 0)
    if open_queries:
        lines.append(f"Open queries: {open_queries}")
    body = "\n".join(lines)
    buttons = [(f"{_APPROVE}{mov_id}", "Approve")]
    if result.get("canQuery"):
        buttons.append((f"{_QUERY}{mov_id}", "Query"))
    buttons.append((_NEXT, "Back to the list"))
    ask = "Reply *APPROVE*" + (" or *QUERY*" if result.get("canQuery") else "") + ", or *LIST* for the others."
    return TurnResult(f"{body}\n\n{ask}", f"{_AWAITING}{mov_id}:detail", intent="mov_review", interactive=buttons_ui(body, buttons))


def _confirm_approve(gateway: LphGateway, phone: str, mov_id: str) -> TurnResult:
    result = _strip(gateway.call("mov_review_detail", phone, movId=mov_id))
    mov = result.get("mov") or {}
    notes = []
    own, others = int(result.get("ownOpenQueries") or 0), int(result.get("otherOpenQueries") or 0)
    if own:
        notes.append(f"Your {'open query' if own == 1 else f'{own} open queries'} on it will be marked resolved.")
    if others:
        notes.append(f"{'One query' if others == 1 else f'{others} queries'} raised by someone else will stay open.")
    if not mov.get("evidence"):
        notes.append("It has no evidence, so it can't go into a monthly pack until evidence is added.")
    body = f"Approve the {mov.get('intervention')} MOV for *{mov.get('sme')}*?" + ("\n\n" + "\n".join(f"- {n}" for n in notes) if notes else "")
    return TurnResult(f"{body}\n\nReply *YES* to approve or *NO* to go back.", f"{_AWAITING}{mov_id}:approve", intent="mov_review",
                      interactive=buttons_ui(body, [(f"{_APPROVE_OK}{mov_id}", "Yes, approve"), (_CANCEL, "Cancel")]))


def _approved(result: dict[str, Any]) -> TurnResult:
    text = f"✅ Approved: the {result.get('intervention')} MOV for *{result.get('sme')}*."
    if result.get("resolvedQueries"):
        text += f" Your open {'query was' if result['resolvedQueries'] == 1 else 'queries were'} marked resolved."
    text += (" It's ready for the monthly pack, which you submit on the Lepharo platform."
             if result.get("evidence") else " Add its evidence before it can go into a monthly pack.")
    text += " If this was a mistake, you can undo it from the MOV on the platform until the pack is confirmed."
    return TurnResult(text, intent="mov_approved", interactive=buttons_ui(text, [(_NEXT, "Next MOV")]))


def _ask_type(mov_id: str) -> TurnResult:
    body = "What's the issue with this MOV?"
    lines = "\n".join(f"{i}. {label}" for i, (_, label, _) in enumerate(QUERY_TYPES, start=1))
    return TurnResult(f"{body}\n\n{lines}\n\nReply with a number.", f"{_AWAITING}{mov_id}:type", intent="mov_review",
                      interactive=buttons_ui(body, [(f"{_QUERY_TYPE}{mov_id}:{code}", label) for code, label, _ in QUERY_TYPES]))


def _ask_message(mov_id: str, code: str) -> TurnResult:
    prompt = next((p for c, _, p in QUERY_TYPES if c == code), "What's the issue?")
    return TurnResult(f"{prompt} Say exactly what the facilitator needs to correct.", f"{_AWAITING}{mov_id}:msg:{code}", intent="mov_review")


def _draft(gateway: LphGateway, phone: str, mov_id: str, code: str, message: str) -> TurnResult:
    try:
        draft = _strip(gateway.call("mov_review_query_draft", phone, movId=mov_id, type=code, message=message)).get("draft") or {}
    except GatewayError as error:
        if "query_too_short" in str(error):
            return TurnResult("Please say a little more, so the facilitator knows exactly what to fix.",
                              f"{_AWAITING}{mov_id}:msg:{code}", intent="mov_review")
        return _error_turn(error)
    to = draft.get("facilitator") or "the facilitator"
    body = (f"Send this query to {to} about the {draft.get('intervention')} MOV for *{draft.get('sme')}*?\n\n"
            f"*{draft.get('typeLabel')}*: {draft.get('message')}")
    return TurnResult(f"{body}\n\nReply *YES* to send or *NO* to discard.", f"{_AWAITING}{mov_id}:send", intent="mov_review",
                      interactive=buttons_ui(body, [(f"{_QUERY_SEND}{mov_id}", "Send query"), (_CANCEL, "Discard")]))


def _sent(result: dict[str, Any]) -> TurnResult:
    to = result.get("facilitator") or "the facilitator"
    text = (f"✉️ Query sent to {to}. The {result.get('intervention')} MOV for *{result.get('sme')}* is now queried, "
            "and comes back to you once they answer.")
    return TurnResult(text, intent="mov_queried", interactive=buttons_ui(text, [(_NEXT, "Next MOV")]))


def _cancelled(gateway: LphGateway, phone: str) -> TurnResult:
    gateway.call("mov_review_cancel", phone)
    return TurnResult("No problem - nothing was changed.", intent="mov_review", interactive=buttons_ui("No problem - nothing was changed.", [(_NEXT, "Back to the list")]))


def _pick_by_number(gateway: LphGateway, phone: str, answer: str) -> Optional[TurnResult]:
    if not answer.isdigit():
        return None
    movs = _strip(gateway.call("mov_review_pending", phone)).get("movs") or []
    index = int(answer) - 1
    if not 0 <= index < len(movs):
        return TurnResult(f"Please reply with a number from 1 to {len(movs)}.", f"{_AWAITING}pick", intent="mov_review")
    return _detail(gateway, phone, str(movs[index]["movId"]))


def handle_mov_review_turn(message: str, phone: str, awaiting: Optional[str], gateway: LphGateway) -> Optional[TurnResult]:
    """The MOV review conversation for a head of department, or None when the message isn't part of it."""
    text = (message or "").strip()
    answer = text.lower().strip(" .!")
    try:
        if text == _NEXT:
            return pending_reply(gateway, phone)
        if text == _CANCEL:
            return _cancelled(gateway, phone)
        if text.startswith(_OPEN):
            return _detail(gateway, phone, text[len(_OPEN):])
        if text.startswith(_APPROVE_OK):
            return _approved(_strip(gateway.call("mov_review_approve", phone, movId=text[len(_APPROVE_OK):])))
        if text.startswith(_APPROVE):
            return _confirm_approve(gateway, phone, text[len(_APPROVE):])
        if text.startswith(_QUERY_TYPE):
            mov_id, _, code = text[len(_QUERY_TYPE):].rpartition(":")
            return _ask_message(mov_id, code)
        if text.startswith(_QUERY_SEND):
            return _sent(_strip(gateway.call("mov_review_query_send", phone, movId=text[len(_QUERY_SEND):])))
        if text.startswith(_QUERY):
            return _ask_type(text[len(_QUERY):])

        if not awaiting or not awaiting.startswith(_AWAITING):
            return None
        state = awaiting[len(_AWAITING):]
        if state == "pick":
            return _pick_by_number(gateway, phone, answer)
        mov_id, _, step = state.partition(":")
        if step == "detail":
            if answer in {"approve", "a"}:
                return _confirm_approve(gateway, phone, mov_id)
            if answer in {"query", "q"}:
                return _ask_type(mov_id)
            if answer in {"list", "back", "next"}:
                return pending_reply(gateway, phone)
            return None  # anything else goes to the assistant
        if step == "approve":
            if answer in _YES:
                return _approved(_strip(gateway.call("mov_review_approve", phone, movId=mov_id)))
            if answer in _NO:
                return _detail(gateway, phone, mov_id)
            return TurnResult("Please reply *YES* to approve, or *NO* to go back.", awaiting, intent="mov_review")
        if step == "type":
            codes = {str(i): code for i, (code, _, _) in enumerate(QUERY_TYPES, start=1)}
            code = codes.get(answer) or next((c for c, label, _ in QUERY_TYPES if answer and answer in label.lower()), None)
            if code:
                return _ask_message(mov_id, code)
            return TurnResult("Please reply 1, 2 or 3.", awaiting, intent="mov_review")
        if step.startswith("msg:"):
            if answer in _NO:
                return _cancelled(gateway, phone)
            return _draft(gateway, phone, mov_id, step[len("msg:"):], text)
        if step == "send":
            if answer in _YES:
                return _sent(_strip(gateway.call("mov_review_query_send", phone, movId=mov_id)))
            if answer in _NO:
                return _cancelled(gateway, phone)
            return TurnResult("Please reply *YES* to send the query, or *NO* to discard it.", awaiting, intent="mov_review")
    except GatewayError as error:
        return _error_turn(error)
    return None
