import unittest

from watch_draft import WATCH_MARKER, sanitize_watch, watch_directive


class SanitizeWatchTests(unittest.TestCase):
    def test_a_risk_watch_keeps_its_names_and_options(self):
        draft = sanitize_watch({"type": "sme_risk", "programName": "  Rustenburg ", "level": "medium", "noSessionDays": "200", "query": "drop"})
        self.assertEqual(draft, {"type": "sme_risk", "programName": "Rustenburg", "level": "Medium", "noSessionDays": 90})

    def test_unknown_types_and_shapes_are_dropped(self):
        self.assertIsNone(sanitize_watch({"type": "delete_all"}))
        self.assertIsNone(sanitize_watch(["sme_risk"]))
        self.assertIsNone(sanitize_watch(None))

    def test_watches_on_a_record_need_the_record(self):
        self.assertIsNone(sanitize_watch({"type": "impact_reportable"}))
        self.assertIsNone(sanitize_watch({"type": "intervention_done", "interventionTitle": "IP Advisory"}))
        self.assertEqual(
            sanitize_watch({"type": "impact_reportable", "interventionTitle": "Cash Flow Planning", "metric": "jobs"}),
            {"type": "impact_reportable", "interventionTitle": "Cash Flow Planning", "metric": "jobs"},
        )

    def test_text_is_bounded_and_never_objects(self):
        draft = sanitize_watch({"type": "intervention_done", "participantName": "x" * 500, "interventionTitle": {"$ne": 1}})
        self.assertEqual(len(draft["participantName"]), 120)
        self.assertNotIn("interventionTitle", draft)

    def test_an_offer_is_kept_only_when_it_is_exactly_true(self):
        self.assertTrue(sanitize_watch({"type": "sme_risk", "offer": True})["offer"])
        self.assertNotIn("offer", sanitize_watch({"type": "sme_risk", "offer": "yes"}))

    def test_the_directive_names_the_marker(self):
        self.assertIn(WATCH_MARKER, watch_directive())


if __name__ == "__main__":
    unittest.main()
