"""'Show me how' for the web assistant.

Two halves, both narrow on purpose:
- sanitize_show_me keeps a chat reply's destination only if the route was one the
  user's own navigation offered in that request.
- compose_tour turns a goal plus the guide targets actually on the page into tour
  steps. The model may only point at targets the page reported, or pick one of the
  page's own curated guides; anything else is dropped.
"""

import json
import re
from typing import Any, Optional

from pydantic import BaseModel, Field

MAX_TARGETS = 120
MAX_STEPS = 8
TARGET_NAME = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")


class ShowMeUnavailable(Exception):
    pass


class GuideTarget(BaseModel):
    name: str = Field(..., max_length=80)
    text: str = Field("", max_length=120)
    kind: str = Field("", max_length=20)


class PageGuide(BaseModel):
    id: str = Field(..., max_length=80)
    title: str = Field(..., max_length=160)
    description: str = Field("", max_length=300)


class ComposeTourRequest(BaseModel):
    goal: str = Field(..., min_length=1, max_length=400)
    route: str = Field(..., max_length=200)
    pageTitle: str = Field("", max_length=120)
    targets: list[GuideTarget] = Field(default_factory=list, max_length=MAX_TARGETS)
    guides: list[PageGuide] = Field(default_factory=list, max_length=30)


class TourStep(BaseModel):
    target: Optional[str] = None
    title: str
    description: str


class ComposeTourResponse(BaseModel):
    guideId: Optional[str] = None
    steps: list[TourStep] = Field(default_factory=list)
    intro: str = ""


def sanitize_show_me(raw: Any, available_routes: Any) -> Optional[dict[str, Any]]:
    """Only ever return a route the frontend offered in this request."""
    if not isinstance(raw, dict) or not isinstance(available_routes, list):
        return None
    route = raw.get("route")
    if not isinstance(route, str):
        return None
    for entry in available_routes:
        if isinstance(entry, dict) and entry.get("route") == route:
            goal = raw.get("goal")
            return {
                "route": route,
                "label": str(entry.get("label") or "")[:120],
                "goal": goal.strip()[:400] if isinstance(goal, str) and goal.strip() else "",
            }
    return None


def build_prompt(payload: ComposeTourRequest) -> str:
    targets = [t.model_dump() for t in payload.targets if TARGET_NAME.match(t.name)]
    guides = [g.model_dump() for g in payload.guides]
    return f"""
You write short in-app guided tours for the Smart Incubation platform.
The user wants to: {json.dumps(payload.goal)}
They are now on the page {json.dumps(payload.pageTitle or payload.route)} ({payload.route}).

The page already has these curated guides (id, title, description):
{json.dumps(guides, ensure_ascii=False)}

These elements are on screen right now. "name" is the only way to point at one;
"text" is what the user sees on it:
{json.dumps(targets, ensure_ascii=False)}

Reply with ONE JSON object and nothing else:
{{"guideId": string | null, "intro": string, "steps": [{{"target": string | null, "title": string, "description": string}}]}}

Rules:
- If one curated guide clearly covers the goal, set "guideId" to its id copied exactly and leave "steps" empty.
- Otherwise set "guideId" to null and write 2 to {MAX_STEPS} steps in the order the user would act.
  Each "target" must be a "name" copied exactly from the element list, or null for a step that
  explains something without pointing at anything. Never invent a name.
- "title" is at most 6 words; "description" is one or two plain sentences telling the user what
  to do with that element. Use the words they see on screen.
- If nothing on the page helps with the goal, return "guideId": null, "steps": [] and use "intro"
  to say in one sentence what the page is for instead.
- "intro" is one short sentence shown before the tour starts.
"""


def apply_tour(parsed: Any, payload: ComposeTourRequest) -> ComposeTourResponse:
    if not isinstance(parsed, dict):
        raise ShowMeUnavailable("unexpected response")
    intro = str(parsed.get("intro") or "").strip()[:240]

    guide_ids = {g.id for g in payload.guides}
    guide_id = parsed.get("guideId")
    if isinstance(guide_id, str) and guide_id in guide_ids:
        return ComposeTourResponse(guideId=guide_id, intro=intro)

    names = {t.name for t in payload.targets}
    steps: list[TourStep] = []
    for raw in parsed.get("steps") or []:
        if not isinstance(raw, dict):
            continue
        target = raw.get("target")
        if target is not None and (not isinstance(target, str) or target not in names):
            # A made-up target would highlight nothing; keep the advice, drop the pointer.
            target = None
        title = str(raw.get("title") or "").strip()[:80]
        description = str(raw.get("description") or "").strip()[:400]
        if not title or not description:
            continue
        steps.append(TourStep(target=target, title=title, description=description))
        if len(steps) >= MAX_STEPS:
            break

    # A tour that points at nothing is just text; the intro says it better.
    if not any(step.target for step in steps):
        steps = []
    return ComposeTourResponse(steps=steps, intro=intro)


def compose_tour(client: Any, model: str, payload: ComposeTourRequest) -> ComposeTourResponse:
    """Raises ShowMeUnavailable on any model or parsing failure."""
    try:
        response = client.models.generate_content(
            model=model,
            contents=build_prompt(payload),
            config={"response_mime_type": "application/json", "temperature": 0.2},
        )
        text = (getattr(response, "text", "") or "").strip()
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
        parsed = json.loads(text)
    except Exception as error:  # noqa: BLE001 - any failure means "no tour"
        raise ShowMeUnavailable(type(error).__name__) from error
    return apply_tour(parsed, payload)
