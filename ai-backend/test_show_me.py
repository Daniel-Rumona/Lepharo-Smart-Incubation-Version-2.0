import json
import unittest
from types import SimpleNamespace

from show_me import (
    ComposeTourRequest,
    GuideTarget,
    PageGuide,
    ShowMeUnavailable,
    apply_tour,
    compose_tour,
    sanitize_show_me,
)

ROUTES = [
    {"route": "/operations/compliance", "label": "Compliance", "section": "SMEs"},
    {"route": "/operations/assignments", "label": "Assignments", "section": None},
]


def request(**overrides):
    base = dict(
        goal="send a compliance reminder",
        route="/operations/compliance",
        targets=[
            GuideTarget(name="compliance-filter", text="Filter"),
            GuideTarget(name="compliance-remind", text="Send reminder"),
        ],
        guides=[PageGuide(id="compliance-overview", title="Compliance overview")],
    )
    base.update(overrides)
    return ComposeTourRequest(**base)


class StubClient:
    def __init__(self, text):
        self.text = text
        self.models = SimpleNamespace(generate_content=self._generate)

    def _generate(self, **kwargs):
        if isinstance(self.text, Exception):
            raise self.text
        return SimpleNamespace(text=self.text)


class SanitizeShowMeTests(unittest.TestCase):
    def test_keeps_offered_route_and_label(self):
        result = sanitize_show_me({"route": "/operations/compliance", "goal": " remind SMEs "}, ROUTES)
        self.assertEqual(result, {"route": "/operations/compliance", "label": "Compliance", "goal": "remind SMEs"})

    def test_drops_route_not_offered(self):
        self.assertIsNone(sanitize_show_me({"route": "/admin/users"}, ROUTES))

    def test_drops_when_no_routes_sent(self):
        self.assertIsNone(sanitize_show_me({"route": "/operations/compliance"}, None))


class ApplyTourTests(unittest.TestCase):
    def test_uses_curated_guide_when_id_matches(self):
        result = apply_tour({"guideId": "compliance-overview", "steps": [], "intro": "Here"}, request())
        self.assertEqual(result.guideId, "compliance-overview")
        self.assertEqual(result.steps, [])

    def test_ignores_invented_guide_id(self):
        result = apply_tour({"guideId": "made-up", "steps": []}, request())
        self.assertIsNone(result.guideId)

    def test_invented_target_loses_its_pointer(self):
        result = apply_tour(
            {
                "steps": [
                    {"target": "compliance-filter", "title": "Filter", "description": "Pick expired."},
                    {"target": "delete-everything", "title": "Oops", "description": "Not real."},
                ]
            },
            request(),
        )
        self.assertEqual([s.target for s in result.steps], ["compliance-filter", None])

    def test_tour_without_any_real_target_is_dropped(self):
        result = apply_tour(
            {"steps": [{"target": None, "title": "Read", "description": "Just text."}], "intro": "Page info"},
            request(),
        )
        self.assertEqual(result.steps, [])
        self.assertEqual(result.intro, "Page info")

    def test_caps_steps(self):
        steps = [{"target": "compliance-filter", "title": f"S{i}", "description": "d"} for i in range(20)]
        self.assertEqual(len(apply_tour({"steps": steps}, request()).steps), 8)


class ComposeTourTests(unittest.TestCase):
    def test_parses_model_reply(self):
        reply = json.dumps({"guideId": None, "intro": "Let's go", "steps": [
            {"target": "compliance-remind", "title": "Send it", "description": "Click Send reminder."}
        ]})
        result = compose_tour(StubClient(reply), "m", request())
        self.assertEqual(result.steps[0].target, "compliance-remind")

    def test_model_failure_raises_unavailable(self):
        with self.assertRaises(ShowMeUnavailable):
            compose_tour(StubClient(RuntimeError("down")), "m", request())

    def test_bad_json_raises_unavailable(self):
        with self.assertRaises(ShowMeUnavailable):
            compose_tour(StubClient("not json"), "m", request())


if __name__ == "__main__":
    unittest.main()
