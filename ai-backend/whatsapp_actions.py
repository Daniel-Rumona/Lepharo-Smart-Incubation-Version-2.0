from typing import Any


# Capability boundary presented to the model. Firebase remains the executor.
AVAILABLE_ACTIONS: dict[str, dict[str, Any]] = {
    "get_upcoming_appointments": {
        "kind": "read",
        "description": "Retrieve upcoming appointments belonging to the authenticated SME.",
        "requiresTrustedAppointmentId": False,
        "arguments": {},
    },
    "get_appointment": {
        "kind": "read",
        "description": "Retrieve details for one appointment identified by trusted router context.",
        "requiresTrustedAppointmentId": True,
        "arguments": {},
    },
    "get_meeting_link": {
        "kind": "read",
        "description": "Retrieve the joining link for one appointment identified by trusted router context.",
        "requiresTrustedAppointmentId": True,
        "arguments": {},
    },
    "appointment_accept": {
        "kind": "mutation",
        "description": "Record a clear RSVP acceptance for the trusted appointment.",
        "requiresTrustedAppointmentId": True,
        "arguments": {},
    },
    "appointment_decline": {
        "kind": "mutation",
        "description": "Record a clear RSVP decline for the trusted appointment, including a reason.",
        "requiresTrustedAppointmentId": True,
        "arguments": {"reason": "The SME's stated reason for declining."},
    },
    "appointment_reschedule_request": {
        "kind": "mutation",
        "description": "Request rescheduling of the trusted appointment without claiming it was changed.",
        "requiresTrustedAppointmentId": True,
        "arguments": {
            "requestedDateText": "The user's date wording, without inventing an ISO date.",
            "requestedTimeText": "The user's time wording.",
            "reason": "The user's stated reason, when present.",
        },
    },
    "get_food_menu": {
        "kind": "read",
        "description": "Retrieve the food menu for the trusted appointment's session.",
        "requiresTrustedAppointmentId": True,
        "arguments": {},
    },
    "select_food_items": {
        "kind": "mutation",
        "description": "Record the SME's food selections for the trusted appointment from the retrieved food menu.",
        "requiresTrustedAppointmentId": True,
        "arguments": {
            "items": "The names of the chosen menu items, exactly as shown in the retrieved food menu.",
        },
    },
}


READ_ACTIONS = {
    name for name, definition in AVAILABLE_ACTIONS.items() if definition["kind"] == "read"
}
MUTATING_ACTIONS = {
    name for name, definition in AVAILABLE_ACTIONS.items() if definition["kind"] == "mutation"
}
