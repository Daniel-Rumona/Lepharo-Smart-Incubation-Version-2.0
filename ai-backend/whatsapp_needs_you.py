from typing import Any, Callable, Optional

from lph_gateway import GatewayError, LphGateway
from whatsapp_staff import TurnResult

# "Which SMEs need me this week?" on WhatsApp: the ranked list the web assistant shows
# (attention_list.py), as one message with a next step per SME.
#
# Centre coordinators (role projectadmin) and coordinators (role coordinator) are different people,
# even though WhatsApp puts both in the "coordinator" menu group: a centre coordinator gets the SMEs
# on their programmes, a coordinator the SMEs they own or deliver to. The scope comes from the real
# role, never the menu group. The gateway's programme listing says which programmes are theirs and
# which one they are looking at.

SHOWN = 5

# Set by app.py, which holds the Firestore client: (visibility) -> {"items": [...], "total": n}.
LOAD_ATTENTION: Optional[Callable[[dict[str, Any]], dict[str, Any]]] = None


def _programmes(listing: dict[str, Any]) -> tuple[list[str], Optional[str]]:
    """(the programmes this person has, the one they're looking at, or None for all of them)."""
    owned = [str(p.get("id")) for p in listing.get("programmes") or [] if p.get("id")]
    current = str((listing.get("current") or {}).get("id") or "")
    return owned, (current if current in owned else None)


def needs_you_scope(identity: dict[str, Any], listing: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Who this person's list covers, or None when they have no SMEs to rank."""
    from attention_list import visibility_for  # imported here: keeps the WhatsApp modules light to test

    role = str(identity.get("role") or "").strip().lower().replace(" ", "")
    owned, current = _programmes(listing)
    if role == "projectadmin":
        # Their programmes, or the one they picked; never everyone's.
        return visibility_for(role, "", [current] if current else owned)
    if role == "coordinator":
        uid = str(identity.get("uid") or "")
        return visibility_for(role, uid, [current] if current else None) if uid else None
    return None


def _entry(index: int, item: dict[str, Any]) -> str:
    level = f" - {item['level']} risk" if item.get("level") else ""
    # The risk level is already on the name line, so it isn't repeated as a reason.
    reasons = [str(reason) for reason in item.get("why") or [] if str(reason) != f"{item.get('level')} risk"]
    why = "; ".join(reasons[:2])
    lines = [f"{index}. *{item.get('name') or 'An SME'}*{level}"]
    if why:
        lines.append(why)
    if item.get("nextStep"):
        lines.append(f"\U0001f449 {item['nextStep']}")
    return "\n".join(lines)


def format_needs_you(result: dict[str, Any], programme: Optional[str] = None) -> str:
    items = result.get("items") or []
    where = f" on *{programme}*" if programme else ""
    if not items:
        return f"Nothing needs you this week{where}: no SMEs at risk, nothing overdue and no weak evidence. \U0001f44d"
    total = int(result.get("total") or len(items))
    shown = items[:SHOWN]
    head = f"\U0001f4cb *SMEs that need you this week*{where}"
    if total > len(shown):
        head += f" - the top {len(shown)} of {total}"
    body = "\n\n".join(_entry(index, item) for index, item in enumerate(shown, start=1))
    return f"{head}\n\n{body}\n\nAsk me about any of them by name, or open the assistant in the web app for the full list."


def needs_you_reply(identity: dict[str, Any], phone: str, gateway: LphGateway) -> TurnResult:
    try:
        listing = gateway.call("list_programmes", phone)
    except GatewayError as error:
        print("WhatsApp needs-you programmes failed:", str(error), flush=True)
        listing = {}
    scope = needs_you_scope(identity, listing)
    if scope is None:
        if str(identity.get("role") or "").strip().lower() == "projectadmin":
            return TurnResult("There are no programmes linked to your profile yet, so I have no SMEs to rank.", intent="needs_you")
        return TurnResult("That option isn't available for your role.", intent="not_permitted")
    if LOAD_ATTENTION is None:
        return TurnResult("I couldn't get that right now. Please try again in a moment.", intent="unavailable")
    try:
        result = LOAD_ATTENTION(scope)
    except Exception as error:  # noqa: BLE001 - one failed read shouldn't break the chat
        print("WhatsApp needs-you list failed:", type(error).__name__, str(error), flush=True)
        return TurnResult("I couldn't get that right now. Please try again in a moment.", intent="unavailable")
    _, current = _programmes(listing)
    programme = (listing.get("current") or {}).get("name") if current else None
    return TurnResult(format_needs_you(result, programme), intent="needs_you")
