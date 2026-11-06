"""Turn a pasted or uploaded RFQ, tender notice or corporate request into a
DRAFT market opportunity.

Nothing here persists. The endpoint returns the draft for a Market Linkages
officer to review and edit; only then does the client save it to
`marketOpportunities`, and matching runs on what they saved
(functions/src/marketLinkage.ts). Sectors and provinces are mapped onto the
lists the SME records use, so matching compares like with like.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any, Optional

from pydantic import BaseModel, Field

# The SME sector list (src/routes/shared/incubatees/participantsData.ts SA_SECTORS).
SECTORS = [
    "Agriculture", "Manufacturing", "Retail", "Construction", "ICT", "Tourism",
    "Professional Services", "Transport & Logistics",
]
PROVINCES = [
    "Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo", "Mpumalanga",
    "North West", "Northern Cape", "Western Cape",
]
MAX_TEXT_CHARS = 60_000


class OpportunityExtractionRequest(BaseModel):
    text: str = ""
    fileBase64: str = ""
    fileName: str = ""
    mimeType: str = ""


class OpportunityOwnership(BaseModel):
    black: Optional[float] = None
    women: Optional[float] = None
    youth: Optional[float] = None


class OpportunityDraft(BaseModel):
    title: str = ""
    buyer: str = ""
    reference: str = ""
    summary: str = ""
    sectors: list[str] = Field(default_factory=list)
    provinces: list[str] = Field(default_factory=list)
    location: str = ""
    documents: list[str] = Field(default_factory=list)
    maxBeeLevel: Optional[int] = None
    ownership: OpportunityOwnership = Field(default_factory=OpportunityOwnership)
    requireCsd: bool = False
    closingDate: Optional[str] = None  # ISO yyyy-mm-dd
    value: str = ""
    warnings: list[str] = Field(default_factory=list)


def opportunity_extraction_prompt(today: date) -> str:
    return f"""
You read a South African procurement opportunity (an RFQ, tender notice, or a
corporate's request for suppliers) for an SMME incubator's Market Linkages office.
Today is {today.isoformat()}.

Extract only what the document says. Never invent requirements, values or dates.

- "title": a short name for the opportunity (what is being bought).
- "buyer": the organisation buying. "reference": its tender/RFQ number, else "".
- "summary": two or three plain sentences on the scope of work.
- "sectors": any of {SECTORS} that the work belongs to (use these exact names).
- "provinces": any of {PROVINCES} the supplier must be in or deliver to (exact names).
  Leave empty if the location is national or not stated. "location": the place as written.
- "documents": each document or registration a bidder must supply, as written
  (e.g. "Tax compliance status PIN", "B-BBEE certificate", "CIDB grading 3CE",
  "COID letter of good standing", "Company registration documents").
- "maxBeeLevel": the lowest acceptable B-BBEE level as a number 1-8 if the document
  sets one (e.g. "Level 1 to 2 only" -> 2), else null.
- "ownership": minimum ownership percentages it requires or prefers, e.g.
  {{"black": 51}} for "51% black-owned"; null for anything not stated.
- "requireCsd": true if CSD registration or a CSD number is required.
- "closingDate": the closing/submission date as yyyy-mm-dd, else null.
- "value": the stated contract value or budget as written, else "".

Return strict JSON only, no markdown fences:
{{"title":"","buyer":"","reference":"","summary":"","sectors":[],"provinces":[],"location":"",
"documents":[],"maxBeeLevel":null,"ownership":{{"black":null,"women":null,"youth":null}},
"requireCsd":false,"closingDate":null,"value":""}}
"""


def _clean(value: Any, limit: int = 400) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _pick(values: Any, allowed: list[str]) -> list[str]:
    """Keep only names from the allowed list, matched case-insensitively, in list order."""
    wanted = {_clean(v).lower() for v in (values if isinstance(values, list) else [])}
    return [name for name in allowed if name.lower() in wanted]


def _percent(value: Any) -> Optional[float]:
    try:
        number = float(str(value).replace("%", "").strip())
    except (TypeError, ValueError):
        return None
    return number if 0 < number <= 100 else None


def build_opportunity_draft(parsed: dict[str, Any], today: Optional[date] = None) -> OpportunityDraft:
    """Normalise model output; drop anything that doesn't fit rather than failing."""
    today = today or date.today()
    warnings: list[str] = []

    closing = None
    raw_closing = _clean(parsed.get("closingDate"))
    if raw_closing:
        try:
            closing = date.fromisoformat(raw_closing[:10])
        except ValueError:
            warnings.append(f'The closing date "{raw_closing}" could not be read; please enter it.')
    if closing and closing < today:
        warnings.append("The closing date has already passed.")
    if not closing and not raw_closing:
        warnings.append("No closing date was found; please enter it.")

    level = parsed.get("maxBeeLevel")
    try:
        max_level = int(level) if level is not None and str(level).strip() != "" else None
    except (TypeError, ValueError):
        max_level = None
    if max_level is not None and not 1 <= max_level <= 8:
        max_level = None

    ownership = parsed.get("ownership") if isinstance(parsed.get("ownership"), dict) else {}
    documents: list[str] = []
    for item in parsed.get("documents") if isinstance(parsed.get("documents"), list) else []:
        text = _clean(item, 160)
        if text and text.lower() not in {d.lower() for d in documents}:
            documents.append(text)

    title = _clean(parsed.get("title"), 160)
    if not title:
        warnings.append("No title was found; please add one.")

    return OpportunityDraft(
        title=title,
        buyer=_clean(parsed.get("buyer"), 160),
        reference=_clean(parsed.get("reference"), 80),
        summary=_clean(parsed.get("summary"), 1200),
        sectors=_pick(parsed.get("sectors"), SECTORS),
        provinces=_pick(parsed.get("provinces"), PROVINCES),
        location=_clean(parsed.get("location"), 160),
        documents=documents[:20],
        maxBeeLevel=max_level,
        ownership=OpportunityOwnership(
            black=_percent(ownership.get("black")),
            women=_percent(ownership.get("women")),
            youth=_percent(ownership.get("youth")),
        ),
        requireCsd=parsed.get("requireCsd") is True,
        closingDate=closing.isoformat() if closing else None,
        value=_clean(parsed.get("value"), 80),
        warnings=warnings,
    )
