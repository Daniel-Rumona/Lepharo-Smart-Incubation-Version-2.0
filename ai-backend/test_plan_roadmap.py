import unittest
from datetime import date

from plan_roadmap import build_roadmap_draft, next_occurrence, roadmap_extraction_prompt


class RoadmapDraftTests(unittest.TestCase):
    today = date(2026, 10, 9)

    def test_normalises_dates_and_confidence(self):
        draft = build_roadmap_draft({"milestones": [
            {"title": "COID compliance", "dueDate": "2026-12-31", "dateConfidence": "inferred",
             "timeframeText": "Quarter 4", "responsible": "HSE Center Resource"},
            {"title": "No timing", "dueDate": "soon", "dateConfidence": "exact"},
            {"title": "Weekly report", "dueDate": "2026-10-16", "recurrence": "weekly"},
        ]}, self.today)
        self.assertEqual(draft.milestones[0].dateConfidence, "inferred")
        self.assertIsNone(draft.milestones[1].dueDate)
        self.assertEqual(draft.milestones[1].dateConfidence, "unknown")
        self.assertEqual(draft.milestones[2].recurrence, "weekly")
        self.assertTrue(any("no date" in w for w in draft.warnings))

    def test_drops_blank_and_duplicate_rows(self):
        draft = build_roadmap_draft({"milestones": [
            {"title": ""}, "junk",
            {"title": "A", "dueDate": "2026-11-01"}, {"title": "a", "dueDate": "2026-11-01"},
        ]}, self.today)
        self.assertEqual(len(draft.milestones), 1)

    def test_start_after_due_is_dropped_and_past_due_warned(self):
        draft = build_roadmap_draft({"milestones": [
            {"title": "Old", "startDate": "2026-05-01", "dueDate": "2026-03-01"},
        ]}, self.today)
        self.assertIsNone(draft.milestones[0].startDate)
        self.assertTrue(any("past due" in w for w in draft.warnings))

    def test_next_occurrence(self):
        self.assertEqual(next_occurrence(date(2026, 1, 31), "monthly"), date(2026, 2, 28))
        self.assertEqual(next_occurrence(date(2026, 11, 30), "quarterly"), date(2027, 2, 28))
        self.assertIsNone(next_occurrence(date(2026, 1, 1), "none"))

    def test_prompt_mentions_today(self):
        self.assertIn("2026-10-09", roadmap_extraction_prompt(self.today, "HSE"))


if __name__ == "__main__":
    unittest.main()
