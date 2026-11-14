import unittest

from tool_select import select_tools

# A receptionist's tools: their own records plus the front desk's (app.py OWN_DATA_TOOLS | RECEPTIONIST_DATA_TOOLS).
RECEPTIONIST = {
    "get_participant_by_user", "get_applications_by_user", "get_inquiries_by_user", "get_intake_submissions_by_user",
    "get_applications_by_participant", "get_assigned_interventions_by_participant", "get_diagnostic_plan_by_participant",
    "get_compliance_by_participant", "get_appointments_by_participant", "get_clock_events_by_user",
    "get_time_records_by_user", "get_leave_requests_by_user", "get_active_programs",
    "get_inquiries_by_branch", "get_appointments_by_program", "get_participants_for_program",
    "get_applications_by_program", "get_programs", "get_departments",
}


class SelectToolsTests(unittest.TestCase):
    def test_a_named_topic_runs_only_that_topics_tools(self):
        self.assertEqual(sorted(select_tools("Show my submitted inquiries", RECEPTIONIST, [])),
                         ["get_inquiries_by_branch", "get_inquiries_by_user"])
        self.assertEqual(select_tools("Show my leave requests", RECEPTIONIST, []), ["get_leave_requests_by_user"])

    def test_my_still_prefers_the_persons_own_version(self):
        picked = select_tools("Show my applications", RECEPTIONIST, [])
        self.assertEqual(set(picked[:2]), {"get_applications_by_user", "get_applications_by_participant"})
        self.assertEqual(picked[2:], ["get_applications_by_program"])

    def test_a_topic_is_what_a_tool_reads_not_who_it_filters_by(self):
        picked = select_tools("Which SMEs are in my programme?", RECEPTIONIST, [])
        self.assertIn("get_participants_for_program", picked)
        self.assertNotIn("get_appointments_by_participant", picked)

    def test_without_a_topic_the_scope_and_page_decide(self):
        picked = select_tools("What do I have on today?", RECEPTIONIST, ["get_appointments_by_program"])
        self.assertEqual(picked[0], "get_appointments_by_program")
        self.assertTrue(set(select_tools("Show me my stuff", RECEPTIONIST, [])) <= RECEPTIONIST)


if __name__ == "__main__":
    unittest.main()
