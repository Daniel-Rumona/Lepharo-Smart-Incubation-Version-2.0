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
    """admin | director | hod | coordinator | receptionist | employee | external | sme | unknown"""
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
    "admin": [
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
        MenuItem("Interventions", "Status across your SMEs", "tool:staff_overview:interventions"),
        MenuItem("Appointments", "What's coming up, or set one up", f"submenu:{_APPOINTMENTS_SUBMENU}"),
        MenuItem("Find an SME", "Look up an SME and their interventions", "guide:find_sme"),
    ],
    "coordinator": [
        MenuItem("Appointments", "What's coming up, or set one up", f"submenu:{_APPOINTMENTS_SUBMENU}"),
        MenuItem("Find an SME", "Look up an SME and their interventions", "guide:find_sme"),
    ],
    "employee": [
        MenuItem("Appointments", "What's coming up, or set one up", f"submenu:{_APPOINTMENTS_SUBMENU}"),
        MenuItem("Find an SME", "Look up an SME and their interventions", "guide:find_sme"),
    ],
    "receptionist": [
        MenuItem("Today's appointments", "Who is coming in today", "tool:my_appointments"),
    ],
    "external": [],
    "sme": [
        MenuItem("My appointments", "What's coming up and where", "tool:sme_appointments"),
        MenuItem("Respond to an invitation", "Confirm, decline or ask to reschedule", "tool:sme_rsvp"),
    ],
    "unknown": [],
}

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
            MenuItem("Upcoming appointments", "What's on your calendar", "tool:my_appointments"),
            MenuItem("Set up an appointment", "Book a session for one of your SMEs", "guide:schedule"),
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


def greeting_reply(identity: Optional[dict[str, Any]]) -> tuple[str, Optional[str], Optional[dict[str, Any]]]:
    """Friendly greeting plus the role's menu. Returns (text fallback, awaiting, interactive list)."""
    group = role_group(identity)
    name = first_name(identity)
    hello = f"Hey there, {name}! \U0001f44b What can I help you with today?" if name else "Hey there! \U0001f44b What can I help you with today?"
    items = MENUS.get(group, [])
    if not items:
        return f"{hello}\n\n{NO_MENU_REPLY.get(group, NO_MENU_REPLY['unknown'])}", None, None
    ui = list_ui(
        f"{hello}\n\nPick an option, or just tell me what you need in your own words.",
        [_row(item, f"lph:menu:top:{index}") for index, item in enumerate(items, start=1)],
        section="What I can do",
    )
    return f"{hello}\n\n{_lines(items)}\n\nReply with a number, or just tell me what you need in your own words.", "menu", ui


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
        items = MENUS.get(role_group(identity), [])
    else:
        key = awaiting.split(":", 1)[1]
        items = SUBMENUS.get(key, ("", []))[1]
    return items[index] if 0 <= index < len(items) else None


def resolve_choice_id(text: str, identity: Optional[dict[str, Any]]) -> Optional[MenuItem]:
    """Map a tapped list row (lph:menu:<scope>:<n>) to its option. Independent of conversation state."""
    parts = (text or "").strip().split(":")
    if len(parts) != 4 or parts[0] != "lph" or parts[1] != "menu" or not parts[3].isdigit():
        return None
    items = MENUS.get(role_group(identity), []) if parts[2] == "top" else SUBMENUS.get(parts[2], ("", []))[1]
    index = int(parts[3]) - 1
    return items[index] if 0 <= index < len(items) else None
