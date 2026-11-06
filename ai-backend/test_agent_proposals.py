import unittest

from agent_proposals import allowed_proposals_for, proposal_directive, sanitize_proposal


class SanitizeProposalTests(unittest.TestCase):
    def test_keeps_allowed_kind_and_known_params(self):
        result = sanitize_proposal(
            {"kind": "send_nudge", "params": {"participantIds": ["p1", "p2", "p1"], "message": " Hi ", "extra": 1}},
            allowed_proposals_for("coordinator"),
        )
        self.assertEqual(result, {"kind": "send_nudge", "params": {"participantIds": ["p1", "p2"], "message": "Hi"}})

    def test_drops_kind_role_is_not_offered(self):
        self.assertIsNone(sanitize_proposal({"kind": "create_task", "params": {"title": "x"}}, allowed_proposals_for("coordinator")))

    def test_drops_unknown_kind(self):
        self.assertIsNone(sanitize_proposal({"kind": "delete_sme", "params": {}}, {"delete_sme"}))

    def test_roles_without_proposals_get_nothing(self):
        self.assertEqual(allowed_proposals_for("incubatee"), set())
        self.assertIsNone(sanitize_proposal({"kind": "send_nudge", "params": {}}, allowed_proposals_for("incubatee")))
        self.assertEqual(proposal_directive(set()), "")

    def test_rejects_path_like_ids_and_wrong_types(self):
        result = sanitize_proposal(
            {"kind": "schedule_appointment", "params": {
                "assignedInterventionId": "users/abc", "durationMinutes": "60", "date": "2026-11-02",
            }},
            {"schedule_appointment"},
        )
        self.assertEqual(result["params"], {"date": "2026-11-02"})

    def test_single_id_becomes_list_and_list_is_capped(self):
        one = sanitize_proposal({"kind": "send_compliance_reminder", "params": {"participantIds": "p1"}}, {"send_compliance_reminder"})
        self.assertEqual(one["params"]["participantIds"], ["p1"])
        many = sanitize_proposal(
            {"kind": "send_compliance_reminder", "params": {"participantIds": [f"p{i}" for i in range(80)]}},
            {"send_compliance_reminder"},
        )
        self.assertEqual(len(many["params"]["participantIds"]), 50)


if __name__ == "__main__":
    unittest.main()
