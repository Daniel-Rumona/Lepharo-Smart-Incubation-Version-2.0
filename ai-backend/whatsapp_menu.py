import re
from dataclasses import dataclass
from typing import Any, Optional

# Deterministic greeting and role-aware menu for Lepharo WhatsApp conversations.
# Nothing here calls a model: a greeting always gets the same friendly, predictable
# answer, and a menu number always maps to the same option for a given role.

_GREETING = re.compile(
    r"^\s*(?:hi+|hie+|hey+|hello+|hallo|howzit|hola|yo|sup|start|menu|help|options|"
    r"good\s+(?:morning|afternoon|evening|day)|morning|afternoon|evening|what\s+can\s+you\s+do|"
    r"what\s+do\s+you\s+do)(?:\s+(?:there|lepharo|team|bot|assistant|smart\s*inc))?\s*[!.?,]*\s*$",
    re.I,
)
_CHOICE = re.compile(r"^\s*(?:option\s*|number\s*|#\s*)?(\d{1,2})\s*[.)]?\s*$", re.I)


@dataclass(frozen=True)
class MenuItem:
    title: str
    blurb: str
    action: str  # "tool:<name>[:<view>]" | "submenu:<key>" | "guide:<key>"


def role_group(identity: Optional[dict[str, Any]]) -> str:
    """system_admin | director | hod | coordinator | receptionist | employee | external | sme | unknown"""
    if not identity:
        return "unknown"
    if identity.get("kind") == "sme":
        return "sme"
    group = str(identity.get("roleGroup") or "").strip().lower()
    return group or "unknown"


def first_name(identity: Optional[dict[str, Any]]) -> Optional[str]:
    name = str((identity or {}).get("name") or (identity or {}).get("participantName") or "").strip()
    if not name or name.lower() in {"there", "sme"} or "@" in name:
        return None
    return name.split()[0]


def is_greeting(text: str) -> bool:
    return bool(_GREETING.match(text or ""))


_APPOINTMENTS_SUBMENU = "appointments"

MENUS: dict[str, list[MenuItem]] = {
    "system_admin": [
        MenuItem("Feature governance", "Log a meeting or a feature, see the pipeline", "submenu:governance"),
        MenuItem("User stats", "How many users, by role, and SMEs on the programme", "tool:staff_overview:users"),
        MenuItem("Appointments", "What's coming up across the organisation", "tool:my_appointments"),
        MenuItem("Intervention status", "Progress across all SMEs", "tool:staff_overview:interventions"),
    ],
    "director": [
        MenuItem("Feature governance", "Pipeline, meetings and open challenges", "tool:governance_summary"),
        MenuItem("User stats", "How many users, by role, and SMEs on the programme", "tool:staff_overview:users"),
        MenuItem("Appointments", "What's coming up across the organisation", "tool:my_appointments"),
        MenuItem("Interventions", "Status across all SMEs", "tool:staff_overview:interventions"),
    ],
    "hod": [
        MenuItem("Interventions", "Status across my SMEs", "tool:staff_overview:interventions"),
        MenuItem("Appointments", "What's coming up, or set one up", f"submenu:{_APPOINTMENTS_SUBMENU}"),
        MenuItem("Find an SME", "Look up an SME and their interventions", "guide:find_sme"),
        MenuItem("Record a session", "Record coverage for a session you ran", "tool:coverage_pending"),
    ],
    "coordinator": [
        MenuItem("Appointments", "What's coming up, or set one up", f"submenu:{_APPOINTMENTS_SUBMENU}"),
        MenuItem("Find an SME", "Look up an SME and their interventions", "guide:find_sme"),
        MenuItem("Record a session", "Record coverage for a session you ran", "tool:coverage_pending"),
    ],
    "employee": [
        MenuItem("Appointments", "What's coming up, or set one up", f"submenu:{_APPOINTMENTS_SUBMENU}"),
        MenuItem("Find an SME", "Look up an SME and their interventions", "guide:find_sme"),
        MenuItem("Record a session", "Record coverage for a session you ran", "tool:coverage_pending"),
    ],
    "receptionist": [
        MenuItem("Today's appointments", "Who is coming in today", "tool:my_appointments"),
    ],
    "external": [],
    "sme": [
        MenuItem("My appointments", "What's coming up and where", "tool:sme_appointments"),
        MenuItem("Respond to an invitation", "Confirm, decline or ask to reschedule", "tool:sme_rsvp"),
        MenuItem("Send a document", "See what's outstanding and send it here", "tool:sme_documents"),
    ],
    "unknown": [],
}

# Added to the menu of anyone the gateway marks with documentAccess (admins, directors, ROM and M&E staff).
_DOCUMENTS_ITEM = MenuItem("SME documents", "Compliance documents and signed POPIA notices", "guide:sme_document")
# Added for anyone the gateway marks with reportAccess (functions/src/reports registry), e.g. centre coordinators.
_REPORTS_ITEM = MenuItem("Reports", "Executive and National reports, sent here", "tool:reports")


def menu_items(identity: Optional[dict[str, Any]]) -> list[MenuItem]:
    items = MENUS.get(role_group(identity), [])
    if not items:
        return items
    extra = [item for item, flag in ((_DOCUMENTS_ITEM, "documentAccess"), (_REPORTS_ITEM, "reportAccess")) if (identity or {}).get(flag)]
    return [*items, *extra]


SUBMENUS: dict[str, tuple[str, list[MenuItem]]] = {
    "governance": (
        "Feature governance",
        [
            MenuItem("Log a meeting", "Record who you met and what came out of it", "guide:log_meeting"),
            MenuItem("Log a feature", "Add a feature request or a pipeline item", "guide:log_feature"),
            MenuItem("Pipeline summary", "Where the features and meetings stand", "tool:governance_summary"),
        ],
    ),
    _APPOINTMENTS_SUBMENU: (
        "Appointments",
        [
            MenuItem("Upcoming appointments", "What's on my calendar", "tool:my_appointments"),
            MenuItem("Set up an appointment", "Book a session for one of my SMEs", "guide:schedule"),
        ],
    ),
}

GUIDES: dict[str, str] = {
    "log_meeting": (
        "Happy to log that. Tell me who you met, what it was about, and any challenges that came up - "
        "for example: \"Met Lindiwe about the booking issue, she'll retest by Friday. Challenge: slots not saving.\" "
        "I'll show you a summary to confirm before anything is saved."
    ),
    "log_feature": (
        "Sure. Give me the feature name and a line on what it should do. You can add a target date and who it affects - "
        "for example: \"Add appointment reminders, target 30 September, affects SMEs and coordinators.\" "
        "I'll confirm with you before saving."
    ),
    "schedule": (
        "Let's set it up. Tell me which SME, the date and time, and whether it's in person, virtual or by phone - "
        "for example: \"Book Acme Traders tomorrow at 10:00, virtual.\" I'll find the intervention and confirm with you first."
    ),
    "find_sme": "Tell me the SME's name and I'll look them up and show their active interventions.",
    "sme_document": "Which SME's documents do you need? Send me the business name and I'll show what they have - or ask for one directly, e.g. \"Acme Traders' CIPC\".",
}

NO_MENU_REPLY = {
    "external": "I can help Lepharo staff and SMEs with day-to-day tasks. Your reports and dashboards are available on the Lepharo platform.",
    "unknown": "I can help once your WhatsApp number is linked to your Lepharo profile. Please ask the Lepharo team to update it.",
}


def _row(item: MenuItem, row_id: str) -> dict[str, str]:
    return {"id": row_id, "title": item.title[:24], "description": item.blurb[:72]}


def list_ui(body: str, rows: list[dict[str, str]], button: str = "Options", section: str = "Choose one") -> dict[str, Any]:
    """WhatsApp list message. Titles are capped at 24 characters and descriptions at 72 by the platform."""
    return {"type": "list", "body": body[:1024], "button": button[:20], "sections": [{"title": section[:24], "rows": rows[:10]}]}


def buttons_ui(body: str, buttons: list[tuple[str, str]]) -> dict[str, Any]:
    """WhatsApp reply buttons: at most three, titles capped at 20 characters."""
    return {"type": "buttons", "body": body[:1024], "buttons": [{"id": i, "title": t[:20]} for i, t in buttons[:3]]}


def _lines(items: list[MenuItem]) -> str:
    return "\n".join(f"{index}. *{item.title}* - {item.blurb}" for index, item in enumerate(items, start=1))


def hello_line(identity: Optional[dict[str, Any]]) -> str:
    name = first_name(identity)
    return f"Hey there, {name}! \U0001f44b" if name else "Hey there! \U0001f44b"


def greeting_reply(
    identity: Optional[dict[str, Any]], programme: Optional[str] = None, lead: Optional[str] = None
) -> tuple[str, Optional[str], Optional[dict[str, Any]]]:
    """Friendly greeting plus the role's menu. Returns (text fallback, awaiting, interactive list).

    programme names the programme being looked at; lead replaces the greeting line (e.g. after a switch)."""
    group = role_group(identity)
    hello = lead or f"{hello_line(identity)} What can I help you with today?"
    if programme:
        hello = f"{hello}\n\U0001f4c1 *{programme}* - say *switch programme* to change."
    items = menu_items(identity)
    if not items:
        return f"{hello}\n\n{NO_MENU_REPLY.get(group, NO_MENU_REPLY['unknown'])}", None, None
    ui = list_ui(
        f"{hello}\n\nPick an option, or just tell me what you need in your own words.",
        [_row(item, f"lph:menu:top:{index}") for index, item in enumerate(items, start=1)],
        section="What I can do",
    )
    return f"{hello}\n\n{_lines(items)}\n\nReply with a number, or just tell me what you need in your own words.", "menu", ui


# ---------------------------------------------------------------- programmes
# Staff answers are limited to one programme (or all, for overseers). The gateway owns the list
# and the stored choice; this only builds the picker and reads the answer.

PROGRAMME_AWAITING = "programme"
_PROGRAMME_PREFIX = "lph:programme:"
ALL_PROGRAMMES = "all"
_SWITCH_PROGRAMME = re.compile(
    r"^\s*(?:(?:switch|change|choose|select|pick)\s+(?:the\s+|my\s+|a\s+)?)?programm?e?s?\s*[!.?]*\s*$", re.I
)


def is_programme_switch(text: str) -> bool:
    return bool(_SWITCH_PROGRAMME.match(text or ""))


def programme_options(listing: dict[str, Any]) -> list[tuple[str, str]]:
    """(id, name) pairs in picker order: "All programmes" first when allowed."""
    options = [(str(p.get("id")), str(p.get("name") or "Programme")) for p in listing.get("programmes") or [] if p.get("id")]
    return ([(ALL_PROGRAMMES, "All programmes")] if listing.get("allowAll") else []) + options


def programme_picker(listing: dict[str, Any], intro: str) -> tuple[str, str, dict[str, Any]]:
    options = programme_options(listing)
    rows = [
        {"id": f"{_PROGRAMME_PREFIX}{pid}", "title": name[:24], "description": name[:72] if len(name) > 24 else ""}
        for pid, name in options
    ]
    ui = list_ui(f"{intro}\n\nPick one from the list.", rows, button="Programmes", section="Programmes")
    lines = "\n".join(f"{index}. {name}" for index, (_, name) in enumerate(options, start=1))
    return f"{intro}\n\n{lines}\n\nReply with a number.", PROGRAMME_AWAITING, ui


def resolve_programme_choice(text: str, listing: dict[str, Any]) -> Optional[str]:
    """The programme id picked by a list tap, a number or a name; None if it isn't a pick."""
    value = (text or "").strip()
    options = programme_options(listing)
    if value.startswith(_PROGRAMME_PREFIX):
        picked = value[len(_PROGRAMME_PREFIX):]
        return picked if any(pid == picked for pid, _ in options) else None
    match = _CHOICE.match(value)
    if match:
        index = int(match.group(1)) - 1
        return options[index][0] if 0 <= index < len(options) else None
    named = [pid for pid, name in options if value.lower() and value.lower() in name.lower()]
    return named[0] if len(named) == 1 else None


def is_programme_pick(text: str) -> bool:
    return (text or "").strip().startswith(_PROGRAMME_PREFIX)


def submenu_reply(key: str) -> tuple[str, str, dict[str, Any]]:
    heading, items = SUBMENUS[key]
    ui = list_ui(
        f"*{heading}* - what would you like to do?",
        [_row(item, f"lph:menu:{key}:{index}") for index, item in enumerate(items, start=1)],
        section=heading,
    )
    return f"*{heading}* - what would you like to do?\n\n{_lines(items)}\n\nReply with a number, or say \"menu\" to go back.", f"menu:{key}", ui


def resolve_choice(text: str, identity: Optional[dict[str, Any]], awaiting: Optional[str]) -> Optional[MenuItem]:
    """Map a bare menu number to the option it refers to, based on what the user was last shown."""
    match = _CHOICE.match(text or "")
    if not match or not awaiting or not awaiting.startswith("menu"):
        return None
    index = int(match.group(1)) - 1
    if awaiting == "menu":
        items = menu_items(identity)
    else:
        key = awaiting.split(":", 1)[1]
        items = SUBMENUS.get(key, ("", []))[1]
    return items[index] if 0 <= index < len(items) else None


def resolve_choice_id(text: str, identity: Optional[dict[str, Any]]) -> Optional[MenuItem]:
    """Map a tapped list row (lph:menu:<scope>:<n>) to its option. Independent of conversation state."""
    parts = (text or "").strip().split(":")
    if len(parts) != 4 or parts[0] != "lph" or parts[1] != "menu" or not parts[3].isdigit():
        return None
    items = menu_items(identity) if parts[2] == "top" else SUBMENUS.get(parts[2], ("", []))[1]
    index = int(parts[3]) - 1
    return items[index] if 0 <= index < len(items) else None
