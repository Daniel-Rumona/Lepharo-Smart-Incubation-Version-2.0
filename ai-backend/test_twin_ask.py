import json
import unittest
from types import SimpleNamespace

from twin_ask import TwinAskRequest, TwinAskUnavailable, apply_ask, ask_twin, build_ask_prompt


class FakeClient:
    def __init__(self, reply):
        self.reply = reply
        self.models = self
        self.prompts = []

    def generate_content(self, model, contents, config=None):
        self.prompts.append(contents)
        if isinstance(self.reply, Exception):
            raise self.reply
        return SimpleNamespace(text=self.reply)


def request(question="Why is HOD review backed up?"):
    return TwinAskRequest(question=question, facts={
        "scope": "SRMCDT / All centres",
        "stages": [
            {"key": "hod", "label": "HOD approval", "count": 17, "oldestWaitDays": 23, "overTwoWeeks": 6, "whoActs": ["Head of department"]},
            {"key": "delivery", "label": "Deliver support", "count": 42, "oldestWaitDays": 9, "overTwoWeeks": 0},
        ],
        "projection": {"weeks": 12, "backlogToday": 96, "backlogEnd": 81, "scenarioBacklogEnd": 81},
    })


class TwinAskTests(unittest.TestCase):
    def test_answer_with_stages_and_records_action(self):
        result = apply_ask({
            "answer": "**HOD approval** has 17 waiting, and 6 have waited over two weeks; the oldest is 23 days.",
            "stages": ["hod", "made-up", "hod"],
            "action": {"kind": "records", "stage": "hod", "label": "See them"},
        }, request())
        self.assertNotIn("**", result.answer)
        self.assertEqual(result.stages, ["hod"])
        self.assertEqual((result.action.kind, result.action.stage), ("records", "hod"))

    def test_invented_numbers_are_refused(self):
        with self.assertRaises(TwinAskUnavailable):
            apply_ask({"answer": "HOD approval will clear in 5 weeks.", "stages": ["hod"]}, request())

    def test_numbers_from_the_question_are_allowed(self):
        result = apply_ask({
            "answer": "I'll run adding 2 centre coordinators through the model.",
            "action": {"kind": "scenario", "change": "add 2 centre coordinators"},
        }, request("What if we add 2 centre coordinators?"))
        self.assertEqual(result.action.kind, "scenario")
        self.assertEqual(result.action.change, "add 2 centre coordinators")
        self.assertEqual(result.action.label, "Try this change")

    def test_actions_on_unknown_stages_are_dropped(self):
        result = apply_ask({"answer": "Nothing is waiting there.", "action": {"kind": "records", "stage": "billing"}}, request())
        self.assertIsNone(result.action)
        result = apply_ask({"answer": "Nothing to change.", "action": {"kind": "scenario", "change": "  "}}, request())
        self.assertIsNone(result.action)

    def test_empty_or_bad_replies_fail(self):
        for bad in ({"answer": ""}, ["not", "a", "dict"]):
            with self.assertRaises(TwinAskUnavailable):
                apply_ask(bad, request())
        with self.assertRaises(TwinAskUnavailable):
            ask_twin(FakeClient(RuntimeError("down")), "m", request())

    def test_end_to_end_and_prompt(self):
        client = FakeClient(json.dumps({"answer": "17 records wait at HOD approval.", "stages": ["hod"], "action": None}))
        result = ask_twin(client, "m", request())
        self.assertEqual(result.answer, "17 records wait at HOD approval.")
        prompt = client.prompts[0]
        self.assertIn('"overTwoWeeks": 6', prompt)
        self.assertIn("do not predict the result", prompt)


if __name__ == "__main__":
    unittest.main()
