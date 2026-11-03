import unittest

from answer_cards import CARDS_MARKER, cards_directive, known_ids, sanitize_cards

FETCHED = {
    "toolResults": {
        "get_participants_for_program": {"ok": True, "data": [{"id": "sme-1", "name": "Thandi Foods"}, {"id": "sme-2"}]},
        "get_assigned_interventions_by_program": {"ok": True, "data": [{"id": "asg-9", "participantId": "sme-3", "title": "Cash Flow"}]},
    },
    "participant": None,
}


class AnswerCardsTests(unittest.TestCase):
    def test_ids_are_found_wherever_they_sit(self):
        self.assertEqual(known_ids(FETCHED), {"sme-1", "sme-2", "asg-9", "sme-3"})

    def test_only_cards_for_fetched_records_are_kept(self):
        cards = sanitize_cards([
            {"type": "sme", "id": "sme-1"},
            {"type": "intervention", "id": "asg-9"},
            {"type": "sme", "id": "someone-else"},
            {"type": "invoice", "id": "sme-2"},
            {"type": "sme", "id": "sme-1"},
            "nonsense",
        ], FETCHED)
        self.assertEqual(cards, [{"type": "sme", "id": "sme-1"}, {"type": "intervention", "id": "asg-9"}])

    def test_at_most_three_and_a_single_object_works(self):
        many = [{"type": "sme", "id": i} for i in ("sme-1", "sme-2", "sme-3", "asg-9")]
        self.assertEqual(len(sanitize_cards(many, FETCHED)), 3)
        self.assertEqual(sanitize_cards({"type": "sme", "id": " sme-2 "}, FETCHED), [{"type": "sme", "id": "sme-2"}])
        self.assertEqual(sanitize_cards(None, FETCHED), [])

    def test_directive_names_the_marker(self):
        self.assertIn(CARDS_MARKER, cards_directive())


if __name__ == "__main__":
    unittest.main()
