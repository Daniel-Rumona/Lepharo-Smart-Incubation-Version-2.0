"""Write actions the web assistant may *propose*.

The model never changes data. It can only return a proposal: a kind this user's
role is offered plus loosely-typed parameters. The browser hands that proposal to
the agentProposeAction Cloud Function, which is the authority: it re-checks the
caller's role and scope, resolves every id, and stores a pending proposal the user
must confirm before anything is written.
"""

import json
from typing import Any, Optional

PROPOSAL_MARKER = "<<<PROPOSAL_JSON>>>"

MAX_LIST = 50

# kind -> {param: type}. "ids" is a list of short id strings.
PROPOSAL_PARAMS: dict[str, dict[str, str]] = {
    "schedule_appointment": {
        "assignedInterventionId": "id",
        "date": "text",
        "time": "text",
        "durationMinutes": "number",
        "deliveryMethod": "text",
        "location": "text",
        "meetingLink": "text",
        "title": "text",
    },
    "create_task": {
        "title": "text",
        "description": "text",
        "dueDate": "text",
        "priority": "text",
        "assigneeIds": "ids",
        "participantId": "id",
        "programId": "id",
    },
    "send_nudge": {
        "participantIds": "ids",
        "message": "text",
    },
    "send_compliance_reminder": {
        "participantIds": "ids",
    },
    "assign_intervention": {
        "participantId": "id",
        "interventionId": "id",
        "assigneeId": "id",
        "dueDate": "text",
    },
}

PROPOSAL_DESCRIPTIONS: dict[str, str] = {
    "schedule_appointment": (
        "book one session for an existing individual intervention assignment. Needs the assignment id "
        "(assignedInterventions record id), date YYYY-MM-DD and time HH:MM (24h, SAST); optional "
        "durationMinutes, deliveryMethod (in_person | virtual | telephonically), location, meetingLink, title."
    ),
    "create_task": (
        "create a staff task. title is required; optional description, dueDate YYYY-MM-DD, priority "
        "(low | medium | high), assigneeIds (user ids; empty means the user themself), participantId, and "
        "programId (copy the live page context's activeProgramId)."
    ),
    "send_nudge": (
        "send an in-app nudge to one or more SMEs. participantIds (participants record ids, max 50) and "
        "a short, polite message written for the SME are required."
    ),
    "send_compliance_reminder": (
        "email and notify SMEs about their outstanding or expired compliance documents. participantIds "
        "(participants record ids, max 50). The system works out each SME's outstanding items itself."
    ),
    "assign_intervention": (
        "prepare an intervention assignment for one SME. participantId and interventionId (catalogue "
        "interventions record id) are required; optional assigneeId and dueDate YYYY-MM-DD. The user "
        "finishes it in the Assignments form."
    ),
}

ROLE_ALLOWED_PROPOSALS: dict[str, set[str]] = {
    "operations": {"schedule_appointment", "create_task", "send_nudge", "send_compliance_reminder", "assign_intervention"},
    "coordinator": {"schedule_appointment", "send_nudge", "send_compliance_reminder", "assign_intervention"},
    "projectadmin": {"schedule_appointment", "create_task", "send_nudge", "send_compliance_reminder"},
    "system_admin": {"create_task", "send_nudge", "send_compliance_reminder"},
    "director": {"create_task", "send_nudge"},
}


def allowed_proposals_for(role: str) -> set[str]:
    return set(ROLE_ALLOWED_PROPOSALS.get(role, set()))


def _clean_id(value: Any) -> Optional[str]:
    if not isinstance(value, (str, int)):
        return None
    text = str(value).strip()
    return text[:200] if text and "/" not in text else None


def sanitize_proposal(raw: Any, allowed: set[str]) -> Optional[dict[str, Any]]:
    """Keep only a kind this role is offered and only the parameters that kind takes."""
    if not isinstance(raw, dict) or not allowed:
        return None
    kind = raw.get("kind")
    if not isinstance(kind, str) or kind not in allowed or kind not in PROPOSAL_PARAMS:
        return None
    source = raw.get("params") if isinstance(raw.get("params"), dict) else {}

    params: dict[str, Any] = {}
    for name, kind_of in PROPOSAL_PARAMS[kind].items():
        value = source.get(name)
        if value is None:
            continue
        if kind_of == "id":
            cleaned = _clean_id(value)
            if cleaned:
                params[name] = cleaned
        elif kind_of == "ids":
            if isinstance(value, (str, int)):
                value = [value]
            if isinstance(value, list):
                ids = [i for i in (_clean_id(v) for v in value) if i]
                if ids:
                    params[name] = list(dict.fromkeys(ids))[:MAX_LIST]
        elif kind_of == "number":
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                params[name] = value
        elif isinstance(value, str) and value.strip():
            params[name] = value.strip()[:1000]
    return {"kind": kind, "params": params}


def proposal_directive(allowed: set[str]) -> str:
    if not allowed:
        return ""
    kinds = {kind: PROPOSAL_DESCRIPTIONS[kind] for kind in sorted(allowed)}
    return f"""
    - You can PROPOSE changes for this user to confirm. You never make changes yourself and must never
      say a change has been made. Proposals this user may make: {json.dumps(kinds)}
      If — and only if — the user clearly asks you to do one of these, and the record ids you need are
      in the fetched data above, keep "answer" to one or two sentences saying what you have prepared
      (e.g. "I've prepared reminders for the 4 SMEs with expired tax clearance — check and confirm
      below.") and append one final marker after everything else: on its own new line, write exactly
      {PROPOSAL_MARKER} and then, immediately after it on the same line, ONLY a single-line compact JSON
      object: {{"kind": string, "params": object}}. Use ids copied exactly from the fetched data, never
      names in place of ids. If an id you need is not in the data, do not output the marker; ask the user
      which record they mean instead. For several SMEs, put all of their ids in one proposal.
    """
