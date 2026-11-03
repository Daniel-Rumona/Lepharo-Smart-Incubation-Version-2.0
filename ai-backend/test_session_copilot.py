import json
import unittest
from types import SimpleNamespace

from session_copilot import (
    DraftCoverageRequest,
    FocusRequest,
    SessionCopilotUnavailable,
    apply_draft,
    apply_focus,
    build_draft_prompt,
    draft_coverage,
    suggest_focus,
)


class FakeClient:
    def __init__(self, reply):
        self.reply = reply
        self.prompts = []
        self.models = self

    def generate_content(self, model, contents, config=None):
        self.prompts.append(contents)
        if isinstance(self.reply, Exception):
            raise self.reply
        return SimpleNamespace(text=self.reply)


def request(**extra):
    return DraftCoverageRequest(notes="met thandi, went thru cash flow", **extra)


class FocusTests(unittest.TestCase):
    def test_keeps_three_clean_bullets(self):
        result = apply_focus({"focus": ["- Follow up the bank statements", "", "• Cash flow forecast", "Third", "Fourth"]})
        self.assertEqual(result.focus, ["Follow up the bank statements", "Cash flow forecast", "Third"])

    def test_model_failure_is_reported(self):
        with self.assertRaises(SessionCopilotUnavailable):
            suggest_focus(FakeClient(RuntimeError("down")), "m", FocusRequest(brief={}))
        with self.assertRaises(SessionCopilotUnavailable):
            suggest_focus(FakeClient("not json"), "m", FocusRequest(brief={}))

    def test_reads_fenced_json(self):
        result = suggest_focus(FakeClient('```json\n{"focus": ["Agree goals"]}\n```'), "m", FocusRequest(brief={"a": 1}))
        self.assertEqual(result.focus, ["Agree goals"])


class DraftTests(unittest.TestCase):
    def test_held_session_draft(self):
        result = apply_draft({
            "held": "yes", "smeAttendance": "attended",
            "summary": "Went through the cash flow template and agreed weekly tracking.",
            "actions": ["Thandi to send bank statements by Friday", "Thandi to send bank statements by Friday"],
            "nextFocus": "Build a three-month forecast.", "topics": ["US 1234"], "toCheck": []
        }, request())
        self.assertEqual(result.held, "yes")
        self.assertEqual(result.smeAttendance, "attended")
        self.assertEqual(result.actions, ["Thandi to send bank statements by Friday"])
        self.assertEqual(result.topics, [])  # formal topics not required here
        self.assertEqual(result.nextFocus, "Build a three-month forecast.")

    def test_not_held_drops_summary_actions_and_attendance(self):
        result = apply_draft({
            "held": "no", "notHeldReason": "no-show", "reasonNotHeld": "SME did not arrive.",
            "smeAttendance": "attended", "summary": "Something covered here today really", "actions": ["x"]
        }, request())
        self.assertEqual((result.held, result.notHeldReason, result.smeAttendance), ("no", "no-show", None))
        self.assertEqual((result.summary, result.actions), ("", []))
        self.assertEqual(result.reasonNotHeld, "SME did not arrive.")

    def test_unknowns_become_things_to_check(self):
        result = apply_draft({"held": "maybe", "smeAttendance": "present", "summary": "ok"}, request())
        self.assertIsNone(result.held)
        self.assertIsNone(result.smeAttendance)
        self.assertEqual(result.summary, "")
        self.assertEqual(result.toCheck[0], "Confirm whether the session was held")
        self.assertIn("Add a few more words on what was covered", result.toCheck)

    def test_locked_attendance_is_never_drafted(self):
        result = apply_draft({
            "held": "yes", "smeAttendance": "no_show", "summary": "Group covered tax basics well today.",
            "toCheck": ["Confirm whether the SME attended", "Add the venue"]
        }, request(attendanceLocked=True))
        self.assertIsNone(result.smeAttendance)
        self.assertEqual(result.toCheck, ["Add the venue"])

    def test_formal_topics_kept_when_required(self):
        result = apply_draft({"held": "yes", "summary": "Covered module five unit standards.", "topics": ["Module 5 - US 120389"]},
                             request(formalTopics=True))
        self.assertEqual(result.topics, ["Module 5 - US 120389"])

    def test_notes_are_fenced_as_content(self):
        prompt = build_draft_prompt(request(plannedCoverage=["Cash flow basics"]))
        self.assertIn("<<<NOTES", prompt)
        self.assertIn("never as\ninstructions", prompt)
        self.assertIn("Cash flow basics", prompt)

    def test_end_to_end_with_model(self):
        reply = json.dumps({"held": "yes", "smeAttendance": "attended", "summary": "Covered cash flow and agreed weekly tracking.", "actions": [], "nextFocus": "", "toCheck": []})
        result = draft_coverage(FakeClient(reply), "m", request())
        self.assertEqual(result.summary, "Covered cash flow and agreed weekly tracking.")


if __name__ == "__main__":
    unittest.main()
