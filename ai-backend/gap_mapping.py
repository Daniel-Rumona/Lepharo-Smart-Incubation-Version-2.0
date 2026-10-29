"""Map diagnosed GAP Analysis answers to the interventions a department offers.

Section access is decided from the caller's stored department profile, never
from the request body, and the answers themselves are read from the GAP
document. The request supplies question wording only, so a client cannot widen
its own scope or fabricate gaps against someone else's record.
"""

import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field

from firestore_tools import db, get_department_role, get_department_roles

# Mirrors DEPT_SECTION_MAP in src/routes/gap/sections.ts, keyed by department role.
GAP_DEPT_SECTIONS: dict[str, Any] = {
    "rom": "ALL",
    "monitoring": "ALL",
    "hse": ["hr"],
    "inhouseFinance": ["finance"],
    "financialCompliance": ["finance"],
    "pds": ["psychometric"],
    "legal": ["legal"],
    "wellness": ["wellness"],
    "training": ["training", "quality"],
    "nvc": ["training"],
    "marketing": ["marketing"],
    "marketLinkages": ["market"],
    "qms": ["quality"],
}

# Which department role delivers each GAP section. An ALL-access viewer (ROM,
# M&E) maps every section against its owning department's catalogue.
GAP_SECTION_OWNER = {
    "marketing": "marketing",
    "psychometric": "pds",
    "finance": "inhouseFinance",
    "hr": "hse",
    "wellness": "wellness",
    "legal": "legal",
    "market": "marketLinkages",
    "quality": "qms",
    "training": "training",
}

# Where each section's answers sit inside the gapAnalysis document.
GAP_SECTION_PATHS = {
    "marketing": ("sections", "marketingCommunication"),
    "psychometric": ("sections", "psychometric"),
    "finance": ("sections", "financialManagement", "q"),
    "hr": ("sections", "labourHSE"),
    "wellness": ("sections", "wellness", "q"),
    "legal": ("sections", "legal", "q"),
    "market": ("sections", "marketLinkage"),
    "quality": ("sections", "qualityManagement"),
    "training": ("sections", "trainingNeeds", "yn"),
}

MAX_MAPPING_QUESTIONS = 40
MAX_MAPPING_INTERVENTIONS = 60


class GapMappingSectionInput(BaseModel):
    section: str
    questions: list[str] = Field(default_factory=list)
    # Need-phrased questions ("Do you need ...?"), where "Yes" is the gap.
    yesIsGap: list[int] = Field(default_factory=list)
    # Informational prompts that are never a gap.
    notScored: list[int] = Field(default_factory=list)


class GapMappingRequest(BaseModel):
    gapId: str
    sections: list[GapMappingSectionInput] = Field(default_factory=list)
    regenerate: bool = False


class GapMappingEdge(BaseModel):
    questionIndex: int
    interventionId: str
    confidence: int = 0
    rationale: str = ""


class GapMappingGap(BaseModel):
    questionIndex: int
    question: str
    answer: str
    comment: str = ""


class GapMappingIntervention(BaseModel):
    id: str
    title: str
    departmentId: str = ""


class GapMappingSection(BaseModel):
    section: str
    departmentId: str = ""
    departmentName: str
    gaps: list[GapMappingGap] = Field(default_factory=list)
    interventions: list[GapMappingIntervention] = Field(default_factory=list)
    edges: list[GapMappingEdge] = Field(default_factory=list)
    note: str = ""


class GapMappingResponse(BaseModel):
    gapId: str
    generatedAt: str
    cached: bool = False
    sections: list[GapMappingSection] = Field(default_factory=list)


class GapMappingError(Exception):
    """Carries an HTTP status so the route can translate it verbatim."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _load_departments() -> list[dict[str, Any]]:
    try:
        return [{"id": snapshot.id, **(snapshot.to_dict() or {})} for snapshot in db.collection("departments").stream()]
    except Exception as error:
        print("Department lookup failed:", type(error).__name__, str(error), flush=True)
        return []


def allowed_sections_for_department(
    department_id: Optional[str],
    roles: Optional[dict] = None,
    departments: Optional[list] = None,
) -> Any:
    if not department_id:
        return []
    roles = get_department_roles() if roles is None else roles
    departments = _load_departments() if departments is None else departments
    role = get_department_role(department_id, roles, departments)
    return GAP_DEPT_SECTIONS.get(role or "", [])


def _department_name(department_id: str, departments: list[dict[str, Any]]) -> str:
    for department in departments:
        if department.get("id") == department_id:
            return str(department.get("name") or "").strip()
    return ""


def _section_answers(gap: dict[str, Any], section: str) -> list[Any]:
    path = GAP_SECTION_PATHS.get(section)
    if not path:
        return []
    node: Any = gap
    for key in path:
        if not isinstance(node, dict):
            return []
        node = node.get(key)
    if isinstance(node, dict):
        node = node.get("q")
    return node if isinstance(node, list) else []


def _department_interventions(department_id: str) -> list[dict[str, Any]]:
    """Catalogue for a department, matched on the intervention's departmentId."""
    if not department_id:
        return []
    results: list[dict[str, Any]] = []
    try:
        for snapshot in db.collection("interventions").where("departmentId", "==", department_id).stream():
            data = snapshot.to_dict() or {}
            title = str(
                data.get("title") or data.get("interventionTitle") or data.get("name") or ""
            ).strip()
            if not title:
                continue

            results.append(
                {
                    "id": snapshot.id,
                    "title": title[:200],
                    "departmentId": department_id,
                }
            )
    except Exception as error:
        print("Intervention lookup failed:", type(error).__name__, str(error), flush=True)

    return results[:MAX_MAPPING_INTERVENTIONS]


def _edges_from_ai(
    genai_client_factory,
    company: str,
    department: str,
    gaps: list[dict],
    interventions: list[dict],
) -> list[dict]:
    prompt = f"""You map diagnosed business gaps to interventions a department already offers.
Company: {company}. Department: {department}.
Gaps (each has questionIndex and the unmet requirement): {json.dumps(gaps, ensure_ascii=False)}
Interventions available (id and title): {json.dumps(interventions, ensure_ascii=False)}

Rules:
- Only use interventionId values from the list above. Never invent one.
- A gap may map to more than one intervention, and an intervention may serve several gaps.
- Leave a gap unmapped rather than forcing a weak match.
- rationale: one short sentence, grounded only in the gap text and the intervention title.
- confidence: integer 0-100.
Return JSON only: {{"edges":[{{"questionIndex":0,"interventionId":"...","confidence":0,"rationale":"..."}}]}}"""

    client = genai_client_factory()
    response = client.models.generate_content(
        model=os.getenv("GEMINI_MODEL", "gemini-3.6-flash"), contents=prompt
    )
    raw = (response.text or "{}").strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE)
    parsed = json.loads(raw)

    valid_ids = {str(item["id"]) for item in interventions}
    valid_indexes = {int(item["questionIndex"]) for item in gaps}

    edges: list[dict] = []
    for edge in parsed.get("edges", []):
        if not isinstance(edge, dict):
            continue
        try:
            index = int(edge.get("questionIndex"))
        except (TypeError, ValueError):
            continue
        intervention_id = str(edge.get("interventionId") or "").strip()
        if index not in valid_indexes or intervention_id not in valid_ids:
            continue

        confidence = edge.get("confidence")
        if isinstance(confidence, (int, float)):
            confidence = round(confidence * 100) if 0 < confidence <= 1 else round(confidence)
        else:
            confidence = 0

        edges.append(
            {
                "questionIndex": index,
                "interventionId": intervention_id,
                "confidence": max(0, min(100, int(confidence))),
                "rationale": str(edge.get("rationale") or "").strip()[:300],
            }
        )
    return edges


def build_gap_mapping(
    payload: GapMappingRequest,
    *,
    department_id: Optional[str],
    actor: str,
    genai_client_factory,
) -> GapMappingResponse:
    roles = get_department_roles()
    departments = _load_departments()
    allowed = allowed_sections_for_department(department_id, roles, departments)
    if allowed != "ALL" and not allowed:
        raise GapMappingError(
            403, "Your department does not own a GAP section, so there is nothing to map."
        )

    gap_id = (payload.gapId or "").strip()
    if not gap_id:
        raise GapMappingError(400, "No GAP was supplied.")

    snapshot = db.collection("gapAnalysis").document(gap_id).get()
    if not snapshot.exists:
        raise GapMappingError(404, "GAP Analysis document not found.")
    gap = snapshot.to_dict() or {}

    company = str((gap.get("company") or {}).get("name") or "").strip() or "the SMME"
    requested = {item.section: item.questions for item in payload.sections}
    polarity = {item.section: (set(item.yesIsGap), set(item.notScored)) for item in payload.sections}
    wanted = [
        key
        for key in requested
        if key in GAP_SECTION_PATHS and (allowed == "ALL" or key in allowed)
    ]
    if not wanted:
        raise GapMappingError(403, "None of the requested sections are available to you.")

    stored = gap.get("interventionMapping")
    existing = stored if isinstance(stored, dict) else {}

    results: list[GapMappingSection] = []
    to_persist: dict[str, Any] = {}
    generated_at = datetime.now(timezone.utc).isoformat()
    all_cached = True

    for section in wanted:
        question_text = [str(q) for q in (requested.get(section) or [])][:MAX_MAPPING_QUESTIONS]
        answers = _section_answers(gap, section)
        owner_role = GAP_SECTION_OWNER.get(section)
        owner_id = roles.get(owner_role, "") if owner_role else (department_id or "")
        owner = _department_name(owner_id, departments) or "the owning department"

        yes_is_gap, not_scored = polarity.get(section, (set(), set()))
        gaps: list[dict[str, Any]] = []
        for index, text in enumerate(question_text):
            if index in not_scored:
                continue
            entry = answers[index] if index < len(answers) and isinstance(answers[index], dict) else {}
            answer = str(entry.get("answer") or "").strip()
            said_yes = answer.lower() == "yes"
            # Unanswered is always a gap; otherwise the question's polarity decides.
            if answer and (said_yes if index not in yes_is_gap else not said_yes):
                continue
            gaps.append(
                {
                    "questionIndex": index,
                    "question": text[:400],
                    "answer": answer or "Unanswered",
                    "comment": str(entry.get("comment") or "").strip()[:300],
                }
            )

        if not gaps:
            results.append(
                GapMappingSection(
                    section=section,
                    departmentId=owner_id,
                    departmentName=owner,
                    note="No gaps in this section.",
                )
            )
            continue

        interventions = _department_interventions(owner_id)
        if not interventions:
            results.append(
                GapMappingSection(
                    section=section,
                    departmentId=owner_id,
                    departmentName=owner,
                    gaps=[GapMappingGap(**item) for item in gaps],
                    note=f"No interventions are catalogued for {owner} yet.",
                )
            )
            continue

        cached = existing.get(section) if isinstance(existing.get(section), dict) else None
        if cached and not payload.regenerate and isinstance(cached.get("edges"), list):
            edges = [
                edge
                for edge in cached["edges"]
                if isinstance(edge, dict) and edge.get("interventionId")
            ]
        else:
            all_cached = False
            edges = _edges_from_ai(
                genai_client_factory,
                company,
                owner,
                [
                    {
                        "questionIndex": item["questionIndex"],
                        "question": item["question"],
                        "comment": item["comment"],
                    }
                    for item in gaps
                ],
                interventions,
            )
            to_persist[section] = {
                "edges": edges,
                "generatedAt": generated_at,
                "generatedBy": actor,
                "model": os.getenv("GEMINI_MODEL", "gemini-3.6-flash"),
                "departmentId": owner_id,
                "departmentName": owner,
            }

        results.append(
            GapMappingSection(
                section=section,
                departmentId=owner_id,
                departmentName=owner,
                gaps=[GapMappingGap(**item) for item in gaps],
                interventions=[GapMappingIntervention(**item) for item in interventions],
                edges=[GapMappingEdge(**edge) for edge in edges],
            )
        )

    if to_persist:
        try:
            db.collection("gapAnalysis").document(gap_id).set(
                {"interventionMapping": to_persist}, merge=True
            )
        except Exception as error:
            # A failed write must not lose the mapping the caller is waiting on.
            print("GAP mapping persist failed:", type(error).__name__, str(error), flush=True)

    return GapMappingResponse(
        gapId=gap_id, generatedAt=generated_at, cached=all_cached, sections=results
    )
