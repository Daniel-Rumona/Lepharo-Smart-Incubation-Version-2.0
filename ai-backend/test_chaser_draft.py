import unittest

from chaser_draft import CHASER_MARKER, sanitize_chaser, chaser_directive


class SanitizeChaserTests(unittest.TestCase):
    def test_a_chaser_keeps_its_stage_names_and_deadline(self):
        draft = sanitize_chaser({"deadline": "2026-11-07", "stage": "awaiting_hod", "departmentName": "  Legal ", "maxNudges": "2", "send": True})
        self.assertEqual(draft, {"deadline": "2026-11-07", "stage": "awaiting_hod", "departmentName": "Legal", "maxNudges": 2})

    def test_no_date_or_nothing_to_chase_is_dropped(self):
        self.assertIsNone(sanitize_chaser({"stage": "awaiting_hod"}))
        self.assertIsNone(sanitize_chaser({"stage": "awaiting_hod", "deadline": "Friday"}))
        self.assertIsNone(sanitize_chaser({"deadline": "2026-11-07"}))
        self.assertIsNone(sanitize_chaser(["awaiting_hod"]))

    def test_unknown_stages_and_allowances_are_dropped(self):
        draft = sanitize_chaser({"deadline": "2026-11-07", "stage": "approve_all", "programName": "SRMCDT", "maxNudges": 10})
        self.assertEqual(draft, {"deadline": "2026-11-07", "programName": "SRMCDT"})

    def test_names_are_bounded_and_deduplicated(self):
        draft = sanitize_chaser({"deadline": "2026-11-07", "participantNames": ["Zungu Trading", "Zungu Trading", {"$ne": 1}, "x" * 500] + ["SME"] * 40})
        self.assertEqual(draft["participantNames"][0], "Zungu Trading")
        self.assertEqual(len(draft["participantNames"][1]), 120)
        self.assertEqual(len(draft["participantNames"]), 3)

    def test_the_directive_names_the_marker(self):
        self.assertIn(CHASER_MARKER, chaser_directive())


if __name__ == "__main__":
    unittest.main()
