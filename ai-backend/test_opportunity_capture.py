import unittest
from datetime import date

from opportunity_capture import build_opportunity_draft, opportunity_extraction_prompt


class OpportunityDraftTests(unittest.TestCase):
    today = date(2026, 10, 30)

    def test_full_draft_is_normalised(self):
        draft = build_opportunity_draft({
            "title": "  Supply of   PPE  ",
            "buyer": "Impala Platinum",
            "sectors": ["manufacturing", "Mining", "retail"],
            "provinces": ["north west", "Atlantis"],
            "documents": ["Tax compliance status PIN", "B-BBEE certificate", "tax compliance status pin", ""],
            "maxBeeLevel": "2",
            "ownership": {"black": "51%", "women": None, "youth": 0},
            "requireCsd": True,
            "closingDate": "2026-11-20",
            "value": "R250 000",
        }, self.today)
        self.assertEqual(draft.title, "Supply of PPE")
        self.assertEqual(draft.sectors, ["Manufacturing", "Retail"])
        self.assertEqual(draft.provinces, ["North West"])
        self.assertEqual(draft.documents, ["Tax compliance status PIN", "B-BBEE certificate"])
        self.assertEqual(draft.maxBeeLevel, 2)
        self.assertEqual(draft.ownership.black, 51)
        self.assertIsNone(draft.ownership.youth)
        self.assertTrue(draft.requireCsd)
        self.assertEqual(draft.closingDate, "2026-11-20")
        self.assertEqual(draft.warnings, [])

    def test_bad_values_become_warnings_not_errors(self):
        draft = build_opportunity_draft({
            "closingDate": "end of month",
            "maxBeeLevel": 12,
            "requireCsd": "yes",
            "documents": "not a list",
        }, self.today)
        self.assertIsNone(draft.closingDate)
        self.assertIsNone(draft.maxBeeLevel)
        self.assertFalse(draft.requireCsd)
        self.assertEqual(draft.documents, [])
        self.assertTrue(any("could not be read" in w for w in draft.warnings))
        self.assertTrue(any("No title" in w for w in draft.warnings))

    def test_past_and_missing_closing_dates_warn(self):
        past = build_opportunity_draft({"title": "x", "closingDate": "2026-01-01"}, self.today)
        self.assertTrue(any("already passed" in w for w in past.warnings))
        missing = build_opportunity_draft({"title": "x"}, self.today)
        self.assertTrue(any("No closing date" in w for w in missing.warnings))

    def test_prompt_names_the_allowed_lists(self):
        prompt = opportunity_extraction_prompt(self.today)
        self.assertIn("2026-10-30", prompt)
        self.assertIn("Transport & Logistics", prompt)
        self.assertIn("KwaZulu-Natal", prompt)


if __name__ == "__main__":
    unittest.main()
