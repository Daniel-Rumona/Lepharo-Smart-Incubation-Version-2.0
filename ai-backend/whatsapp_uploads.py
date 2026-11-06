import re
from datetime import date
from typing import Any, Callable, Optional

from lph_gateway import GatewayError, LphGateway
from whatsapp_menu import buttons_ui, list_ui
from whatsapp_staff import TurnResult, _strip

# SMEs sending compliance documents on WhatsApp. The router stages each file with the gateway and
# sends "lph:upload:<id>:<page>"; files sent together are pages of one upload, so only page 1 asks
# which required document it is (and its issue date when the document has a validity period), then
# the gateway files it, combined into one PDF, the way the compliance page does. A file sent just
# after one was filed may be a missed page, so the SME is asked whether to add it to that document.
# The gateway is the authority on what the SME needs and on filing; this only runs the conversation.

UPLOAD_PREFIX = "lph:upload:"
ATTACH_PREFIX = "lph:attach:"
ADD_PAGE_PREFIX = "lph:addpage:"
NEW_DOCUMENT_PREFIX = "lph:newdoc:"
_PICK_AWAITING = "upload:"
_DATE_AWAITING = "upload_date:"
_FOLLOW_AWAITING = "upload_follow:"

# Set by app.py: runs the AI compliance check for a filed upload (applicationId, documentId).
VERIFY_UPLOAD: Optional[Callable[[str, str], None]] = None

STATUS_LABELS = {
    "missing": "Not uploaded yet",
    "expired": "Expired",
    "invalid": "Needs a new upload",
    "rejected": "Needs a new upload",
    "queried": "Queried - please resend",
    "expiring-soon": "Expiring soon",
    "pending": "Awaiting review",
    "valid": "Approved",
}
# Requirements the SME still has to act on.
OUTSTANDING = {"missing", "expired", "invalid", "rejected", "queried", "expiring-soon"}

# Words SMEs use for a document, mapped to text found in its title.
_ALIASES = {
    "id": "id", "identity": "id", "bee": "b-bbee", "bbbee": "b-bbee", "b-bbee": "b-bbee", "bbee": "b-bbee",
    "tax": "tax", "sars": "sars", "tcs": "tax", "pin": "tax", "vat": "vat", "address": "address",
    "residence": "address", "utility": "address", "cipc": "cipc", "registration": "registration",
    "moa": "memorandum", "memorandum": "memorandum", "contract": "contract", "gap": "gap",
    "bank": "bank", "confirmation": "confirmation",
}
_MONTHS = {name: index for index, name in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}


def _requirement_detail(requirement: dict[str, Any]) -> str:
    label = STATUS_LABELS.get(str(requirement.get("status")), "")
    if requirement.get("expires") and requirement.get("status") in {"expired", "expiring-soon", "valid", "pending"}:
        label = f"{label} ({'expired' if requirement['status'] == 'expired' else 'expires'} {requirement['expires']})"
    return label


def _title_words(title: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)*", title.lower()))


def match_requirement(text: str, requirements: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """The one requirement a caption or reply names: by number, full title, or a word for it."""
    value = (text or "").strip()
    if not value:
        return None
    if value.isdigit():
        index = int(value) - 1
        return requirements[index] if 0 <= index < len(requirements) else None
    lowered = value.lower()
    exact = [r for r in requirements if str(r.get("title", "")).lower() in lowered or lowered == str(r.get("key"))]
    if len(exact) == 1:
        return exact[0]
    targets = {_ALIASES[word] for word in re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)*", lowered) if word in _ALIASES}
    if not targets:
        return None
    named = [r for r in requirements if targets & _title_words(str(r.get("title", ""))) or
             any(target in str(r.get("title", "")).lower() for target in targets if len(target) > 2)]
    return named[0] if len(named) == 1 else None


def parse_issue_date(text: str, today: Optional[date] = None) -> Optional[str]:
    """YYYY-MM-DD from 2026-03-15, 15/03/2026, 15-03-2026 or 15 March 2026; None if unreadable or in the future."""
    value = (text or "").strip().lower()
    today = today or date.today()
    parsed: Optional[date] = None
    try:
        if m := re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", value):
            parsed = date(int(m[1]), int(m[2]), int(m[3]))
        elif m := re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})", value):
            parsed = date(int(m[3]), int(m[2]), int(m[1]))
        elif m := re.fullmatch(r"(\d{1,2})\s+([a-z]+)\s+(\d{4})", value):
            month = _MONTHS.get(m[2][:3])
            parsed = date(int(m[3]), month, int(m[1])) if month else None
    except ValueError:
        return None
    return parsed.isoformat() if parsed and parsed <= today else None


def _options(gateway: LphGateway, phone: str, upload_id: Optional[str] = None) -> dict[str, Any]:
    fields = {"uploadId": upload_id} if upload_id else {}
    return _strip(gateway.call("upload_options", phone, **fields))


def _picker(upload_id: str, requirements: list[dict[str, Any]], intro: str) -> TurnResult:
    rows = [
        {"id": f"{ATTACH_PREFIX}{upload_id}:{r['key']}", "title": str(r["title"])[:24],
         "description": " - ".join(p for p in [str(r["title"]) if len(str(r["title"])) > 24 else "", _requirement_detail(r)] if p)[:72]}
        for r in requirements
    ]
    lines = "\n".join(f"{i}. {r['title']} - {_requirement_detail(r)}" for i, r in enumerate(requirements, start=1))
    return TurnResult(
        f"{intro}\n\n{lines}\n\nReply with a number or the document's name.",
        f"{_PICK_AWAITING}{upload_id}",
        intent="sme_upload",
        interactive=list_ui(f"{intro}\n\nPick one from the list.", rows, button="Documents", section="Required documents"),
    )


def _chosen(upload_id: str, requirement: dict[str, Any], phone: str, gateway: LphGateway) -> TurnResult:
    if requirement.get("needsIssueDate"):
        return TurnResult(
            f"Got it - your *{requirement['title']}*. What is the issue date on it? "
            "Reply like 15/03/2026, or say *skip* if it has none.",
            f"{_DATE_AWAITING}{upload_id}:{requirement['key']}",
            intent="sme_upload",
        )
    return _attach(upload_id, requirement["key"], None, phone, gateway)


def _attach(upload_id: str, requirement_key: str, issue_date: Optional[str], phone: str, gateway: LphGateway) -> TurnResult:
    fields = {"uploadId": upload_id, "requirementKey": requirement_key, **({"issueDate": issue_date} if issue_date else {})}
    try:
        result = _strip(gateway.call("attach_upload", phone, **fields))
    except GatewayError as error:
        if "upload_not_found" in str(error):
            return TurnResult("That file has expired or was already saved. Please send it again.", intent="sme_upload")
        if "cannot_combine_files" in str(error):
            return TurnResult(_CANNOT_COMBINE, intent="sme_upload")
        print("WhatsApp upload filing failed:", str(error), flush=True)
        return TurnResult("I couldn't save that just now. Please try sending it again in a moment.", intent="unavailable")
    _verify(result)
    pages = int(result.get("pages") or 1)
    expiry = f" It's valid until {result['expiryDate']}." if result.get("expiryDate") else ""
    return TurnResult(
        f"✅ Thanks! I've saved your *{result.get('title') or 'document'}*"
        f"{f' ({pages} pages, as one PDF)' if pages > 1 else ''}.{expiry} "
        "It's being checked now, and the Lepharo team will review it.",
        intent="sme_upload_saved",
    )


_CANNOT_COMBINE = (
    "I can only put PDFs and JPG/PNG photos together into one document. "
    "Please send it again as a single PDF, or as JPG photos."
)


def _verify(result: dict[str, Any]) -> None:
    if VERIFY_UPLOAD and result.get("applicationId") and result.get("documentId"):
        VERIFY_UPLOAD(str(result["applicationId"]), str(result["documentId"]))


def _first_page(upload_id: str, options: dict[str, Any], phone: str, gateway: LphGateway, ask_to_add: bool = True) -> TurnResult:
    """The first file of an upload: maybe a missed page of the document just filed, else which document it is."""
    follows = options.get("follows") or {}
    if ask_to_add and follows.get("title"):
        title = follows["title"]
        body = f"\U0001f4ce Got your file. Is it another page of the *{title}* you just sent, or a different document?"
        return TurnResult(
            f"{body}\n\nReply *ADD* to add it as a page, or *NEW* for a different document.",
            f"{_FOLLOW_AWAITING}{upload_id}",
            intent="sme_upload",
            interactive=buttons_ui(body, [(f"{ADD_PAGE_PREFIX}{upload_id}", "Add as a page"), (f"{NEW_DOCUMENT_PREFIX}{upload_id}", "Different document")]),
        )
    requirements = options.get("requirements") or []
    if not requirements:
        return TurnResult(
            "Thanks! I couldn't find an approved application with documents to file this against. "
            "Please contact the Lepharo team, or upload it on the Lepharo platform.",
            intent="sme_upload",
        )
    named = match_requirement(str(options.get("caption") or ""), requirements)
    if named:
        return _chosen(upload_id, named, phone, gateway)
    return _picker(
        upload_id, requirements,
        "\U0001f4ce Thanks, I've got your file. Which document is it? "
        "(If you have more pages, send them now - I'll keep them together.)",
    )


def _add_page(upload_id: str, phone: str, gateway: LphGateway) -> TurnResult:
    try:
        result = _strip(gateway.call("append_upload", phone, uploadId=upload_id))
    except GatewayError as error:
        if "cannot_combine_files" in str(error):
            return TurnResult(_CANNOT_COMBINE, intent="sme_upload")
        if "document_changed" in str(error) or "nothing_to_add_to" in str(error):
            # The earlier document was replaced in the meantime: file this one on its own.
            return _first_page(upload_id, _options(gateway, phone, upload_id), phone, gateway, ask_to_add=False)
        raise
    _verify(result)
    return TurnResult(
        f"✅ Added - your *{result.get('title') or 'document'}* now has {int(result.get('pages') or 2)} pages. "
        "It's being checked again, and the Lepharo team will review it.",
        intent="sme_upload_saved",
    )


def outstanding_reply(gateway: LphGateway, phone: str) -> TurnResult:
    """The SME menu's "Send a document": what they still owe, and how to send it."""
    how = "Send the document here as a PDF or a clear photo, and I'll ask which one it is."
    try:
        options = _options(gateway, phone)
    except GatewayError as error:
        print("WhatsApp compliance lookup failed:", str(error), flush=True)
        return TurnResult(how, intent="sme_documents")
    owed = [r for r in options.get("requirements") or [] if r.get("status") in OUTSTANDING]
    if not owed:
        return TurnResult(f"You're up to date - no documents are outstanding. \U0001f389\n\n{how}", intent="sme_documents")
    lines = "\n".join(f"- {r['title']}: {_requirement_detail(r)}" for r in owed)
    return TurnResult(f"\U0001f4c2 *Documents still needed*\n{lines}\n\n{how}", intent="sme_documents")


def handle_sme_upload_turn(message: str, phone: str, awaiting: Optional[str], gateway: LphGateway) -> Optional[TurnResult]:
    """The upload conversation, or None when the message isn't part of one."""
    text = (message or "").strip()
    try:
        if text.startswith(UPLOAD_PREFIX):
            upload_id, _, page = text[len(UPLOAD_PREFIX):].partition(":")
            if page.isdigit() and int(page) > 1:
                # Another page of a file already being asked about: keep whatever question is open.
                keep = awaiting if awaiting and upload_id in awaiting else f"{_PICK_AWAITING}{upload_id}"
                return TurnResult(f"\U0001f4ce Got page {page}.", keep, intent="sme_upload_page")
            return _first_page(upload_id, _options(gateway, phone, upload_id), phone, gateway)

        if text.startswith(ADD_PAGE_PREFIX):
            return _add_page(text[len(ADD_PAGE_PREFIX):], phone, gateway)

        if text.startswith(NEW_DOCUMENT_PREFIX):
            upload_id = text[len(NEW_DOCUMENT_PREFIX):]
            return _first_page(upload_id, _options(gateway, phone, upload_id), phone, gateway, ask_to_add=False)

        if awaiting and awaiting.startswith(_FOLLOW_AWAITING):
            upload_id = awaiting[len(_FOLLOW_AWAITING):]
            answer = text.lower()
            if answer in {"add", "yes", "page", "add it", "add as a page", "same", "same document"}:
                return _add_page(upload_id, phone, gateway)
            if answer in {"new", "no", "different", "different document", "another", "another document"}:
                return _first_page(upload_id, _options(gateway, phone, upload_id), phone, gateway, ask_to_add=False)
            return TurnResult("Please reply *ADD* to add it as a page, or *NEW* for a different document.", awaiting, intent="sme_upload")

        if text.startswith(ATTACH_PREFIX):
            upload_id, _, key = text[len(ATTACH_PREFIX):].partition(":")
            requirement = next((r for r in _options(gateway, phone, upload_id).get("requirements") or [] if r.get("key") == key), None)
            return _chosen(upload_id, requirement, phone, gateway) if requirement else None

        if awaiting and awaiting.startswith(_PICK_AWAITING):
            upload_id = awaiting[len(_PICK_AWAITING):]
            requirements = _options(gateway, phone, upload_id).get("requirements") or []
            requirement = match_requirement(text, requirements)
            if requirement:
                return _chosen(upload_id, requirement, phone, gateway)
            return _picker(upload_id, requirements, "I didn't catch which document that is. Please pick one:")

        if awaiting and awaiting.startswith(_DATE_AWAITING):
            upload_id, _, key = awaiting[len(_DATE_AWAITING):].partition(":")
            if text.lower() in {"skip", "none", "no date", "n/a", "na"}:
                return _attach(upload_id, key, None, phone, gateway)
            issue_date = parse_issue_date(text)
            if issue_date:
                return _attach(upload_id, key, issue_date, phone, gateway)
            return TurnResult(
                "I couldn't read that date. Please reply like 15/03/2026 (not a future date), or say *skip*.",
                awaiting,
                intent="sme_upload",
            )
    except GatewayError as error:
        if "upload_not_found" in str(error):
            return TurnResult("That file has expired or was already saved. Please send it again.", intent="sme_upload")
        print("WhatsApp upload step failed:", str(error), flush=True)
        return TurnResult("I couldn't do that just now. Please try again in a moment.", intent="unavailable")
    return None
