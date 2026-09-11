import json
import unittest

from whatsapp import (
    AgentActionSelection,
    AgentConversationSelection,
    AgentDecision,
    GeminiWhatsAppReasoner,
    WhatsAppChatRequest,
    WhatsAppConversationStore,
    interpret_whatsapp_message,
)


APPOINTMENT = {
    "engine": "LPH",
    "type": "appointment_rsvp",
    "appointmentId": "abc123",
    "appointment": {"interventionTitle": "Financial Compliance"},
}


def decision(action_type=None, *, intent="appointment_query", confidence=0.97,
             arguments=None, mode=None, awaiting=None, reply="I can help with that."):
    return AgentDecision(
        intent=intent,
        confidence=confidence,
        responseMode=mode or ("action" if action_type else "conversation"),
        action=(AgentActionSelection(type=action_type, arguments=arguments or {}) if action_type else None),
        conversation=AgentConversationSelection(awaiting=awaiting),
        reply=reply,
    )


class StubReasoner:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def decide(self, message, trusted_context, conversation):
        self.calls.append((message, trusted_context, conversation))
        return self.result


class WhatsAppAgentPolicyTests(unittest.TestCase):
    def setUp(self):
        self.store = WhatsAppConversationStore()

    def send(self, message, model_decision, context=None, user_id="+263771234567"):
        reasoner = StubReasoner(model_decision)
        payload = WhatsAppChatRequest(
            channel="whatsapp",
            userId=user_id,
            message=message,
            context={"engine": "LPH"} if context is None else context,
        )
        return interpret_whatsapp_message(payload, self.store, reasoner), reasoner

    def test_upcoming_appointment_paraphrases_need_no_context_type(self):
        phrases = (
            "What are my upcoming appointments?",
            "What have I got coming up?",
            "Any meetings this week?",
            "What am I booked for?",
            "Can you show me what's next?",
            "Do I have anything on my calender?",
        )
        for index, text in enumerate(phrases):
            with self.subTest(text=text):
                result, _ = self.send(text, decision("get_upcoming_appointments"), user_id=f"upcoming-{index}")
                self.assertEqual(result.intent, "appointment_query")
                self.assertEqual(result.action.type, "get_upcoming_appointments")
                self.assertIsNone(result.action.appointmentId)

    def test_exact_reported_failing_case(self):
        result, reasoner = self.send(
            "What are my upcoming appointments",
            decision("get_upcoming_appointments", confidence=0.98),
            context={"engine": "LPH"},
            user_id="+263714551735",
        )
        self.assertEqual(result.action.type, "get_upcoming_appointments")
        self.assertIsNone(reasoner.calls[0][1]["type"])

    def test_read_detail_requires_trusted_target(self):
        result, _ = self.send("What time is that meeting?", decision("get_appointment"))
        self.assertIsNone(result.action)
        self.assertEqual(result.conversation.awaiting, "appointment_target")

    def test_known_appointment_read_uses_trusted_target(self):
        result, _ = self.send(
            "How do I join?",
            decision("get_meeting_link", intent="appointment_meeting_link_request"),
            context=APPOINTMENT,
        )
        self.assertEqual(result.action.type, "get_meeting_link")
        self.assertEqual(result.action.appointmentId, "abc123")

    def test_acceptance_paraphrases_in_rsvp_context(self):
        for index, text in enumerate(("Yes", "Sounds good", "I can make it", "See you then", "Yebo, I'll come")):
            with self.subTest(text=text):
                result, _ = self.send(
                    text,
                    decision("appointment_accept", intent="appointment_accept"),
                    context=APPOINTMENT,
                    user_id=f"accept-{index}",
                )
                self.assertEqual(result.action.type, "appointment_accept")
                self.assertEqual(result.action.appointmentId, "abc123")

    def test_yes_without_rsvp_context_cannot_mutate(self):
        result, _ = self.send(
            "yes",
            decision("appointment_accept", intent="appointment_accept"),
            context={"engine": "LPH", "type": "support", "appointmentId": "abc123"},
        )
        self.assertIsNone(result.action)
        self.assertEqual(result.conversation.awaiting, "appointment_rsvp_confirmation")

    def test_low_confidence_mutation_is_blocked(self):
        result, _ = self.send(
            "I should be able to",
            decision("appointment_accept", intent="appointment_accept", confidence=0.61),
            context=APPOINTMENT,
        )
        self.assertIsNone(result.action)
        self.assertEqual(result.intent, "unclear")

    def test_decline_collects_reason_then_uses_router_echoed_state(self):
        first, _ = self.send(
            "Unfortunately I can't make it",
            decision("appointment_decline", intent="appointment_decline"),
            context=APPOINTMENT,
        )
        self.assertIsNone(first.action)
        self.assertEqual(first.conversation.awaiting, "appointment_decline_reason")

        second, reasoner = self.send(
            "I have another client meeting",
            decision("appointment_decline", intent="appointment_decline",
                     arguments={"reason": "I have another client meeting"}),
            context={
                "engine": "LPH",
                "conversation": {"awaiting": "appointment_decline_reason", "appointmentId": "abc123"},
            },
        )
        self.assertEqual(second.action.reason, "I have another client meeting")
        self.assertEqual(second.action.appointmentId, "abc123")
        self.assertEqual(reasoner.calls[0][2]["awaiting"], "appointment_decline_reason")

    def test_reschedule_ignores_message_appointment_id(self):
        result, _ = self.send(
            "Move appointment xyz999 to Friday at 2pm",
            decision(
                "appointment_reschedule_request",
                intent="appointment_reschedule_request",
                arguments={
                    "appointmentId": "xyz999",
                    "requestedDateText": "Friday",
                    "requestedTimeText": "2pm",
                },
            ),
            context=APPOINTMENT,
        )
        self.assertEqual(result.action.appointmentId, "abc123")
        self.assertEqual(result.action.requestedDateText, "Friday")
        self.assertEqual(result.action.requestedTimeText, "2pm")
        self.assertIsNone(result.action.requestedDate)

    def test_ambiguous_and_unrelated_messages_emit_no_action(self):
        ambiguous, _ = self.send(
            "Maybe, let me see",
            decision(intent="unclear", confidence=0.48, mode="clarification",
                     awaiting="appointment_rsvp_confirmation",
                     reply="Would you like me to mark you as attending?"),
            context=APPOINTMENT,
        )
        self.assertIsNone(ambiguous.action)

        unrelated, _ = self.send(
            "Tell me a joke",
            decision(intent="conversation", mode="conversation", reply="I can help with Lepharo services."),
            user_id="unrelated",
        )
        self.assertIsNone(unrelated.action)
        self.assertEqual(unrelated.intent, "conversation")

    def test_router_null_conversation_clears_stale_local_state(self):
        self.store.set("whatsapp:+263771234567", "appointment_rsvp_confirmation", "abc123")
        result, reasoner = self.send(
            "yes",
            decision("appointment_accept", intent="appointment_accept"),
            context={"engine": "LPH", "conversation": {"awaiting": None}},
        )
        self.assertIsNone(result.action)
        self.assertIsNone(reasoner.calls[0][2]["awaiting"])


class _FakeResponse:
    def __init__(self, text):
        self.text = text


class _FakeModels:
    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = 0

    def generate_content(self, **_kwargs):
        output = self.outputs[self.calls]
        self.calls += 1
        return _FakeResponse(output)


class _FakeClient:
    def __init__(self, outputs):
        self.models = _FakeModels(outputs)


class GeminiReasonerContractTests(unittest.TestCase):
    def test_valid_structured_output_is_pydantic_validated(self):
        output = json.dumps({
            "intent": "appointment_query",
            "confidence": 0.98,
            "responseMode": "action",
            "action": {"type": "get_upcoming_appointments", "arguments": {}},
            "conversation": {"awaiting": None},
            "reply": "Let me check.",
        })
        reasoner = GeminiWhatsAppReasoner(_FakeClient([output]), "test-model")
        result = reasoner.decide("What's next?", {"engine": "LPH"}, {})
        self.assertEqual(result.action.type, "get_upcoming_appointments")

    def test_invalid_output_is_repaired_once(self):
        valid = json.dumps({
            "intent": "conversation",
            "confidence": 0.9,
            "responseMode": "conversation",
            "action": None,
            "conversation": {"awaiting": None},
            "reply": "How can I help?",
        })
        client = _FakeClient(["not json", valid])
        reasoner = GeminiWhatsAppReasoner(client, "test-model")
        result = reasoner.decide("Hello", {"engine": "LPH"}, {})
        self.assertEqual(result.intent, "conversation")
        self.assertEqual(client.models.calls, 2)

    def test_twice_invalid_output_becomes_safe_no_action_response(self):
        payload = WhatsAppChatRequest(
            channel="whatsapp",
            userId="invalid-model-output",
            message="What have I got coming up?",
            context={"engine": "LPH"},
        )
        reasoner = GeminiWhatsAppReasoner(_FakeClient(["not json", "still not json"]), "test-model")
        result = interpret_whatsapp_message(payload, WhatsAppConversationStore(), reasoner)
        self.assertTrue(result.ok)
        self.assertEqual(result.intent, "unclear")
        self.assertIsNone(result.action)


if __name__ == "__main__":
    unittest.main()
