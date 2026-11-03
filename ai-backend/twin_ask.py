"""Ask the twin: plain questions about the Intervention Twin, answered from its own facts.

The page sends what the twin already computed (every stage's count, oldest wait, who
must act, and the projection behind its summary line) with the question. The answer
is short and may point at stages (the scene highlights them) and offer one action:
open a stage's records, or try a change in the model. What-if questions are never
answered with a guess; they become a change the simulation runs. As with the
projection summary, an answer is accepted only if every number in it was given.
"""

import json
import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

MAX_ANSWER_CHARS = 600
_NUMBER = re.compile(r"\d+(?:\.\d+)?")


class TwinAskUnavailable(Exception):
    pass


class StageFact(BaseModel):
    key: str = Field(..., max_length=40)
    label: str = Field(..., max_length=80)
    count: int = 0
    oldestWaitDays: Optional[int] = None
    overTwoWeeks: int = 0
    whoActs: list[str] = Field(default_factory=list, max_length=3)


class TwinFacts(BaseModel):
    scope: str = Field("", max_length=200)
    stages: list[StageFact] = Field(default_factory=list, max_length=40)
    projection: dict[str, Any] = Field(default_factory=dict)
    smesWaiting: int = 0


class PreviousTurn(BaseModel):
    question: str = Field(..., max_length=400)
    answer: str = Field(..., max_length=MAX_ANSWER_CHARS)


class TwinAskRequest(BaseModel):
    question: str = Field(..., min_length=2, max_length=400)
    facts: TwinFacts
    previous: list[PreviousTurn] = Field(default_factory=list, max_length=2)


class TwinAction(BaseModel):
    kind: Literal["records", "scenario"]
    stage: Optional[str] = None  # records: which stage's list to open
    change: Optional[str] = None  # scenario: the change, in words the scenario reader understands
    label: str = ""


class TwinAskResponse(BaseModel):
    answer: str
    stages: list[str] = Field(default_factory=list)
    action: Optional[TwinAction] = None


def build_ask_prompt(payload: TwinAskRequest) -> str:
    return f"""You are the voice of an "Intervention Twin": a live model of how SME support moves through a
programme (delivery, SME confirmation, head-of-department review of evidence, centre coordinator, M&E check).
A programme manager is asking about it. Answer ONLY from the facts below.

Facts (JSON): {json.dumps(payload.facts.model_dump(), ensure_ascii=False)}
"overTwoWeeks" is how many records at a stage have waited more than 14 days. "projection" is what the model
expects after "weeks" weeks: "backlogEnd" if nothing changes, "scenarioBacklogEnd" with the dials as they are now.

Earlier in this conversation: {json.dumps([turn.model_dump() for turn in payload.previous], ensure_ascii=False)}

The question: {json.dumps(payload.question)}

Reply with ONE JSON object and nothing else:
{{"answer": string, "stages": [string], "action": null | {{"kind": "records", "stage": string, "label": string}} | {{"kind": "scenario", "change": string, "label": string}}}}

Rules:
- "answer": at most three short plain sentences, no markdown, no lists. Lead with the direct answer.
- Use only numbers that appear in the facts or the question. Never estimate, project or invent a figure,
  a name or a reason that is not in the facts. If the facts can't answer it, say so in one sentence.
- "stages": the keys (from facts.stages) the answer is about, most relevant first, at most 3.
- If the question is a what-if about more staff time, more review days or more SMEs joining (for example
  "what if we add 2 coordinators"), do not predict the result. Say you will run it through the model, and
  return {{"kind": "scenario", "change": <the change in a short phrase, e.g. "add 2 centre coordinators">,
  "label": "Try this change"}}.
- Otherwise, if the answer is about records someone could look at, return {{"kind": "records", "stage": <key>,
  "label": "See them"}}. Else "action": null.
"""


def apply_ask(parsed: Any, payload: TwinAskRequest) -> TwinAskResponse:
    if not isinstance(parsed, dict):
        raise TwinAskUnavailable("unexpected response")
    answer = re.sub(r"[*_`#>]+", "", str(parsed.get("answer") or ""))
    answer = re.sub(r"\s+", " ", answer).strip()
    if not 3 <= len(answer) <= MAX_ANSWER_CHARS:
        raise TwinAskUnavailable("answer length")
    # Every number must be one the twin gave or the question asked about.
    allowed = set(_NUMBER.findall(json.dumps(payload.facts.model_dump()))) | set(_NUMBER.findall(payload.question))
    if any(number not in allowed for number in _NUMBER.findall(answer)):
        raise TwinAskUnavailable("answer used a number it was not given")

    keys = {stage.key for stage in payload.facts.stages}
    stages: list[str] = []
    for raw in parsed.get("stages") or []:
        key = str(raw or "").strip()
        if key in keys and key not in stages:
            stages.append(key)
    stages = stages[:3]

    action = None
    raw_action = parsed.get("action")
    if isinstance(raw_action, dict):
        kind = raw_action.get("kind")
        label = re.sub(r"\s+", " ", str(raw_action.get("label") or "")).strip()[:40]
        if kind == "records" and raw_action.get("stage") in keys:
            action = TwinAction(kind="records", stage=raw_action["stage"], label=label or "See them")
        elif kind == "scenario":
            change = re.sub(r"\s+", " ", str(raw_action.get("change") or "")).strip()[:200]
            if change:
                action = TwinAction(kind="scenario", change=change, label=label or "Try this change")
    return TwinAskResponse(answer=answer, stages=stages, action=action)


def ask_twin(client: Any, model: str, payload: TwinAskRequest) -> TwinAskResponse:
    """Raises TwinAskUnavailable on any model, parsing or checking failure."""
    try:
        response = client.models.generate_content(
            model=model,
            contents=build_ask_prompt(payload),
            config={"response_mime_type": "application/json", "temperature": 0.2},
        )
        raw = (getattr(response, "text", "") or "").strip()
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE)
        parsed = json.loads(raw)
    except Exception as error:  # noqa: BLE001 - any failure means "no answer"
        raise TwinAskUnavailable(type(error).__name__) from error
    return apply_ask(parsed, payload)
