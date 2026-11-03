from typing import Any, Optional

from lph_gateway import GatewayError, LphGateway
from whatsapp_menu import buttons_ui
from whatsapp_staff import TurnResult, _strip

# Reports on WhatsApp. The gateway says which reports this person may request (functions/src/reports
# registry) and queues a request; the file is built in the background and sent into the chat about a
# minute later. This only asks which report and which month.

_REPORT = "lph:rpt:"
_MONTH = "lph:rptm:"
_AWAITING = "report:"


def _unavailable(error: GatewayError) -> TurnResult:
    if "report_not_permitted" in str(error):
        return TurnResult("That report isn't available for your role.", intent="not_permitted")
    print("WhatsApp report step failed:", str(error), flush=True)
    return TurnResult("I couldn't do that just now. Please try again in a moment.", intent="unavailable")


def _month_question(report: dict[str, Any], months: list[dict[str, str]]) -> TurnResult:
    body = f"\U0001f4ca *{report['title']}* - which month?"
    labels = ["This month", "Last month"]
    buttons = [(f"{_MONTH}{report['id']}:{m['month']}", f"{labels[i]}") for i, m in enumerate(months[:2])]
    lines = "\n".join(f"{i}. {labels[i - 1]} ({m['label']})" for i, m in enumerate(months[:2], start=1))
    return TurnResult(f"{body}\n\n{lines}\n\nReply with a number.", f"{_AWAITING}{report['id']}", intent="reports",
                      interactive=buttons_ui(f"{body}\n\n" + "\n".join(f"{labels[i]}: {m['label']}" for i, m in enumerate(months[:2])), buttons))


def reports_reply(gateway: LphGateway, phone: str) -> TurnResult:
    """The menu's "Reports": which report to prepare."""
    try:
        options = _strip(gateway.call("report_options", phone))
    except GatewayError as error:
        return _unavailable(error)
    reports = options.get("reports") or []
    months = options.get("months") or []
    if not reports:
        return TurnResult("There are no reports available for your role yet.", intent="reports")
    if len(reports) == 1:
        return _month_question(reports[0], months)
    body = "\U0001f4ca Which report would you like?"
    lines = "\n".join(f"{i}. *{r['title']}* - {r['description']}" for i, r in enumerate(reports, start=1))
    return TurnResult(f"{body}\n\n{lines}\n\nReply with a number.", f"{_AWAITING}pick", intent="reports",
                      interactive=buttons_ui(f"{body}\n\n{lines}", [(f"{_REPORT}{r['id']}", str(r["title"])[:20]) for r in reports[:3]]))


def _request(gateway: LphGateway, phone: str, report_id: str, month: str) -> TurnResult:
    try:
        result = _strip(gateway.call("request_report", phone, reportId=report_id, month=month))
    except GatewayError as error:
        return _unavailable(error)
    if result.get("duplicate"):
        return TurnResult(f"I'm already preparing your *{result.get('title')}* for {result.get('monthLabel')} - it's on its way.", intent="reports")
    return TurnResult(
        f"\U0001f4ca Preparing your *{result.get('title')}* for {result.get('monthLabel')}. I'll send it here in about a minute.",
        intent="report_requested",
    )


def handle_report_turn(message: str, phone: str, awaiting: Optional[str], gateway: LphGateway) -> Optional[TurnResult]:
    """Picking a report and its month, or None when the message isn't part of it."""
    text = (message or "").strip()
    try:
        if text.startswith(_REPORT) or (awaiting == f"{_AWAITING}pick" and text.isdigit()):
            options = _strip(gateway.call("report_options", phone))
            reports = options.get("reports") or []
            wanted = text[len(_REPORT):] if text.startswith(_REPORT) else None
            index = int(text) - 1 if wanted is None else -1
            report = next((r for r in reports if r["id"] == wanted), None) if wanted else (reports[index] if 0 <= index < len(reports) else None)
            if report is None:
                return TurnResult("Please pick one of the reports listed.", awaiting, intent="reports")
            return _month_question(report, options.get("months") or [])
        if text.startswith(_MONTH):
            report_id, _, month = text[len(_MONTH):].partition(":")
            return _request(gateway, phone, report_id, month)
        if awaiting and awaiting.startswith(_AWAITING) and awaiting != f"{_AWAITING}pick":
            report_id = awaiting[len(_AWAITING):]
            months = _strip(gateway.call("report_options", phone)).get("months") or []
            answer = text.lower()
            choice = 0 if answer in {"1", "this month", "this"} else 1 if answer in {"2", "last month", "last", "previous"} else None
            if choice is None or choice >= len(months):
                return TurnResult("Please reply 1 for this month or 2 for last month.", awaiting, intent="reports")
            return _request(gateway, phone, report_id, months[choice]["month"])
    except GatewayError as error:
        return _unavailable(error)
    return None
