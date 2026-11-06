import unittest
from datetime import datetime, timezone

from attention_list import asks_for_attention, rank_attention, visibility_for

NOW = int(datetime(2026, 11, 3, 6, 0, tzinfo=timezone.utc).timestamp() * 1000)
DAY = 86_400_000
ALL = {"kind": "all"}


def snap(pid, level, **extra):
    return {"participantId": pid, "participantName": f"SME {pid}", "programId": "p1", "level": level, "trend": "same",
            "ownerIds": ["coord"], "reasons": [{"label": "7 missing document(s)", "points": 12}, {"label": "1 open query", "points": 3}],
            "suggestion": {"text": "Chase the missing documents."}, **extra}


def assignment(pid, due, status="in-progress", **extra):
    return {"participantId": pid, "participantName": f"SME {pid}", "programId": "p1", "assignmentStatus": status,
            "interventionTitle": "Cash Flow Planning", "dueDate": due, "assigneeId": "fac", **extra}


class AttentionTests(unittest.TestCase):
    def test_the_question_is_recognised(self):
        for question in ("Which SMEs need me this week?", "what needs my attention", "Who should I focus on today?",
                         "which smes should I prioritise", "Where should I start this week?", "Prioritise my SMEs for this week"):
            self.assertTrue(asks_for_attention(question), question)
        for question in ("How many interventions are active?", "Tell me about Zungu Trading", "Do we need more facilitators?"):
            self.assertFalse(asks_for_attention(question), question)

    def test_ranked_most_pressing_first_with_one_next_step_each(self):
        result = rank_attention(
            [snap("a", "Critical"), snap("b", "High", trend="up")],
            [assignment("c", NOW - 3 * DAY)],
            [],
            {"a": NOW + 2 * DAY},
            ALL, NOW,
        )
        self.assertEqual([item["participantId"] for item in result["items"]], ["a", "b", "c"])
        top = result["items"][0]
        self.assertEqual(top["nextStep"], "Chase the missing documents.")
        self.assertEqual(top["why"][:2], ["Critical risk", "7 missing document(s)"])
        self.assertIn("Session booked", top["why"][-1])
        self.assertIn("No session booked in the next 14 days", result["items"][1]["why"])
        self.assertTrue(result["items"][2]["nextStep"].startswith("Deliver or reschedule Cash Flow Planning"))

    def test_weak_evidence_comes_first_as_the_next_step_and_approved_movs_are_ignored(self):
        movs = [
            {"participantId": "a", "status": "awaiting_hod", "interventionTitle": "IP Advisory", "evidenceCheck": {"verdict": "weak"}, "programId": "p1"},
            {"participantId": "d", "status": "approved", "interventionTitle": "IP Advisory", "evidenceCheck": {"verdict": "weak"}, "programId": "p1"},
        ]
        result = rank_attention([snap("a", "Medium")], [], movs, {}, ALL, NOW)
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["items"][0]["nextStep"], "Fix the evidence on the IP Advisory MOV before the HOD reviews it.")
        self.assertIn("Evidence on the IP Advisory MOV is weak", result["items"][0]["why"])

    def test_closed_and_far_off_interventions_do_not_count(self):
        result = rank_attention([], [assignment("c", NOW - DAY, status="completed"), assignment("e", NOW + 30 * DAY)], [], {}, ALL, NOW)
        self.assertEqual(result, {"items": [], "total": 0})

    def test_scope_follows_the_person(self):
        data = ([snap("a", "High"), snap("b", "High", programId="p2", ownerIds=["other"])], [assignment("c", NOW - DAY, assigneeId="coord")], [], {})
        own = rank_attention(*data, {"kind": "own", "uid": "coord", "programmeIds": []}, NOW)
        self.assertEqual({item["participantId"] for item in own["items"]}, {"a", "c"})
        programmes = rank_attention(*data, {"kind": "programmes", "programmeIds": ["p2"]}, NOW)
        self.assertEqual([item["participantId"] for item in programmes["items"]], ["b"])

    def test_visibility_by_role(self):
        self.assertEqual(visibility_for("system_admin", "u", None), {"kind": "all"})
        self.assertEqual(visibility_for("director", "u", ["p1"]), {"kind": "programmes", "programmeIds": ["p1"]})
        self.assertIsNone(visibility_for("projectadmin", "u", None))
        self.assertEqual(visibility_for("coordinator", "u", None)["kind"], "own")
        self.assertIsNone(visibility_for("incubatee", "u", None))


if __name__ == "__main__":
    unittest.main()
