import json
import threading
import unittest

from chat_steps import StepReporter, stream_events, tool_step_label


class ChatStepsTests(unittest.TestCase):
    def test_plain_labels_from_tool_names(self):
        self.assertEqual(tool_step_label("get_appointments_by_department"), "Reading appointments")
        self.assertEqual(tool_step_label("get_assigned_interventions_by_program"), "Reading assigned interventions")
        self.assertEqual(tool_step_label("get_movs_by_participant"), "Reading MOVs")
        self.assertEqual(tool_step_label("get_kpi_targets_by_department"), "Reading KPI targets")

    def test_overrides_read_like_a_person(self):
        self.assertEqual(tool_step_label("get_participant_by_email"), "Looking up your profile")
        self.assertEqual(tool_step_label("get_intervention_impact_by_program"), "Reading what's working")

    def test_odd_names_still_say_something(self):
        self.assertEqual(tool_step_label(""), "Gathering data")
        self.assertEqual(tool_step_label("get_"), "Gathering data")

    def test_reporter_sends_each_label_once(self):
        sent = []
        step = StepReporter(sent.append)
        step("Understanding your question")
        step.tool("get_movs")
        step.tool("get_movs_by_department")
        step("")
        step("Writing the answer")
        self.assertEqual(sent, ["Understanding your question", "Reading MOVs", "Writing the answer"])


def parse(chunks):
    return [json.loads(chunk[len("data: "):]) for chunk in chunks]


class StreamTests(unittest.TestCase):
    def test_steps_then_result(self):
        def run(step):
            step("Understanding your question")
            step.tool("get_movs")
            step("Writing the answer")
            return {"answer": "Done", "when": __import__("datetime").date(2026, 11, 2)}
        events = parse(stream_events(run, "unavailable"))
        self.assertEqual([e["type"] for e in events], ["step", "step", "step", "result"])
        self.assertEqual(events[1]["label"], "Reading MOVs")
        self.assertEqual(events[-1]["data"]["when"], "2026-11-02")

    def test_steps_arrive_before_the_answer_is_ready(self):
        release = threading.Event()
        def run(step):
            step("Understanding your question")
            release.wait(5)
            return {"answer": "late"}
        stream = stream_events(run, "unavailable")
        first = json.loads(next(stream)[len("data: "):])
        self.assertEqual(first, {"type": "step", "label": "Understanding your question"})
        release.set()
        self.assertEqual(json.loads(next(stream)[len("data: "):])["type"], "result")

    def test_http_style_errors_keep_their_status(self):
        class Refused(Exception):
            status_code = 429
            detail = "Busy, try again."
        def run(step):
            step("Understanding your question")
            raise Refused()
        events = parse(stream_events(run, "unavailable"))
        self.assertEqual(events[-1], {"type": "error", "status": 429, "detail": "Busy, try again."})

    def test_unexpected_errors_do_not_leak_details(self):
        def run(step):
            raise RuntimeError("secret stack detail")
        events = parse(stream_events(run, "The assistant is unavailable."))
        self.assertEqual(events, [{"type": "error", "status": 500, "detail": "The assistant is unavailable."}])


if __name__ == "__main__":
    unittest.main()
