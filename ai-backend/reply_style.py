"""How long and how shaped an assistant reply should be, by where it is read.

The full Data Assistant page has room for detail. The help window (the "?" button
in the applicant portal) is a small chat bubble, mostly read on phones, so its
replies lead with the answer and keep details to a few short bullets.
"""

from typing import Any, Mapping

HELP_SURFACE = "help"

HELP_REPLY_DIRECTIVE = """- This question comes from the small help window, usually read on a phone. Keep the reply short:
      - Start with the direct answer in one sentence, with the key fact in **bold** (for example a status, a date or a page name).
      - Then, only if it adds something, at most three short bullets (about 15 words each) for details such as dates, what happens next or where to look.
      - Keep the whole reply under about 60 words unless the user asks for more detail.
      - No preamble ("Great question"), no repeating the question, no closing offers ("Let me know if...").
      - Refer to pages by their menu names (for example Tracker or Inquiries). If a guided walkthrough is offered, do not also describe the clicks in prose."""


def reply_style_directive(page_context: Mapping[str, Any] | None) -> str:
    """The extra reply rules for this request, or "" for the full assistant page."""
    if not isinstance(page_context, Mapping):
        return ""
    surface = str(page_context.get("surface") or "").strip().lower()
    return HELP_REPLY_DIRECTIVE if surface == HELP_SURFACE else ""
