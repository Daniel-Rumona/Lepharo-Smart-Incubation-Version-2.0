# Agent Prompt: Add WhatsApp SME Message Handling to the ai-backend

Update the existing **ai-backend chatbot** so it can act as the conversational interpretation engine for incoming SME WhatsApp messages.

Do **not** build the Meta WhatsApp webhook/router yet. The WhatsApp router will be built separately after this work. Your task is only to prepare the **ai-backend** to receive messages from that future router and return structured, machine-readable actions alongside the normal conversational response.

## Existing architecture

The intended flow is:

```text
Meta WhatsApp
    ↓
Firebase WhatsApp Router
    ↓
LPH route selected
    ↓
ai-backend
    ↓
Interpret SME message
    ↓
Return:
- conversational reply
- structured action, if applicable
    ↓
Firebase router/business layer executes action
```

The ai-backend must **not become the source of truth for appointments**.

It should interpret what the SME means and return an action. The Firebase/Lepharo backend will be responsible for actually updating Firestore.

For example:

```text
SME:
"Yeah I'll be there"

ai-backend:
intent = appointment_accept

Firebase:
updates appointment
```

The ai-backend should not itself assume that saying "yes" means the appointment was successfully updated.

---

## 1. Add a channel-aware chat endpoint

Add or extend an API endpoint suitable for receiving messages from the future WhatsApp router.

Prefer:

```http
POST /api/chat
```

if this does not conflict with the existing API.

Do not break existing chat functionality or existing frontend consumers.

The endpoint should accept a request similar to:

```json
{
  "channel": "whatsapp",
  "userId": "+263771234567",
  "message": "yes I'll be there",
  "context": {
    "engine": "LPH",
    "type": "appointment_rsvp",
    "appointmentId": "abc123",
    "appointment": {
      "interventionTitle": "Financial Compliance",
      "date": "2026-08-28",
      "startTime": "10:00",
      "endTime": "11:00",
      "deliveryMode": "online"
    }
  }
}
```

All context fields except `channel`, `userId` and `message` should be treated defensively because future message types may not contain appointment information.

---

## 2. Standard response format

Return a predictable JSON response from WhatsApp-channel requests.

Use this general structure:

```json
{
  "ok": true,
  "reply": "Thank you. I understand that you will attend the appointment.",
  "intent": "appointment_accept",
  "confidence": 0.98,
  "action": {
    "type": "appointment_accept",
    "appointmentId": "abc123"
  },
  "conversation": {
    "awaiting": null
  }
}
```

If there is no business action:

```json
{
  "ok": true,
  "reply": "Your appointment is scheduled for Friday at 10:00.",
  "intent": "appointment_query",
  "confidence": 0.94,
  "action": null,
  "conversation": {
    "awaiting": null
  }
}
```

If clarification is needed:

```json
{
  "ok": true,
  "reply": "Do you mean that you cannot attend the appointment?",
  "intent": "unclear",
  "confidence": 0.46,
  "action": null,
  "conversation": {
    "awaiting": "appointment_rsvp_confirmation"
  }
}
```

Never invent a successful backend operation.

For example, do **not** say:

> Your appointment has been successfully updated.

unless the caller explicitly tells the ai-backend that the action has already been executed successfully.

Before execution, prefer wording such as:

> I understand that you will attend.

The Firebase router will decide what final acknowledgement should be sent after the action succeeds.

---

## 3. Appointment RSVP interpretation

When:

```json
"context": {
  "type": "appointment_rsvp"
}
```

the chatbot should understand natural SME responses instead of requiring the SME to press a WhatsApp button.

### ACCEPT examples

Interpret clear positive attendance responses as:

```text
appointment_accept
```

Examples include:

```text
yes
yeah
yep
sure
okay
ok
confirmed
I accept
I'll come
I will attend
I'll be there
that's fine
I'm available
yes I can make it
see you then
perfect
that works for me
```

Return:

```json
{
  "intent": "appointment_accept",
  "action": {
    "type": "appointment_accept",
    "appointmentId": "<context appointmentId>"
  }
}
```

---

## 4. Declining an appointment

Interpret clear negative attendance responses as:

```text
appointment_decline
```

Examples:

```text
no
I can't make it
I won't be available
I cannot attend
I won't be there
I am busy
not available
I need to decline
I can't come
```

However, a decline should support collecting a reason.

If the SME gives a reason in the same message:

```text
I can't make it because I will be out of town
```

return:

```json
{
  "intent": "appointment_decline",
  "action": {
    "type": "appointment_decline",
    "appointmentId": "abc123",
    "reason": "I will be out of town"
  },
  "conversation": {
    "awaiting": null
  }
}
```

If the SME only says:

```text
no
```

return:

```json
{
  "intent": "appointment_decline",
  "action": null,
  "conversation": {
    "awaiting": "appointment_decline_reason",
    "appointmentId": "abc123"
  },
  "reply": "I understand that you cannot attend. Please tell me why you are unable to make the appointment."
}
```

The conversation should then be able to interpret their next message as the decline reason.

Example:

```text
SME:
"I have another client meeting"
```

Response:

```json
{
  "intent": "appointment_decline",
  "action": {
    "type": "appointment_decline",
    "appointmentId": "abc123",
    "reason": "I have another client meeting"
  },
  "conversation": {
    "awaiting": null
  }
}
```

---

## 5. Postponement / rescheduling intent

Do **not** classify the following as a simple decline:

```text
Can we move it?
Can I do another day?
Can we reschedule?
Tomorrow won't work but Friday will.
Can we make it later?
Can we postpone the meeting?
```

Return:

```json
{
  "intent": "appointment_reschedule_request",
  "action": {
    "type": "appointment_reschedule_request",
    "appointmentId": "abc123",
    "requestedDate": null,
    "requestedTime": null,
    "reason": null
  }
}
```

Extract requested date/time/reason when clearly supplied.

Example:

```text
Can we move it to Friday at 2pm? I have another meeting in the morning.
```

Return conceptually:

```json
{
  "intent": "appointment_reschedule_request",
  "action": {
    "type": "appointment_reschedule_request",
    "appointmentId": "abc123",
    "requestedDateText": "Friday",
    "requestedTimeText": "2pm",
    "reason": "I have another meeting in the morning"
  }
}
```

Do not invent an exact ISO date unless the supplied context makes the intended date unambiguous.

---

## 6. Appointment questions

The ai-backend should also identify common questions such as:

```text
When is my meeting?
What time is it?
Where is the meeting?
Is this online?
Send me the meeting link.
Who am I meeting?
What is this meeting about?
```

Use intents such as:

```text
appointment_query
appointment_meeting_link_request
```

If the answer exists in the provided appointment context, answer from that context.

If the required information is not available, return a structured request instead of inventing it:

```json
{
  "intent": "appointment_query",
  "reply": "Let me check your appointment details.",
  "action": {
    "type": "get_appointment",
    "appointmentId": "abc123"
  }
}
```

---

## 7. Context is critical

A message such as:

```text
yes
```

must **not automatically mean appointment acceptance globally**.

It means appointment acceptance only when the current conversation context shows that the user is responding to an appointment RSVP.

Example:

```json
{
  "context": {
    "type": "appointment_rsvp",
    "appointmentId": "abc123"
  }
}
```

Without suitable context, `"yes"` should remain a conversational response or require clarification.

This prevents unrelated conversations from accidentally accepting appointments.

---

## 8. Conversation state

The ai-backend may already have its own session/conversation memory. Integrate with the existing mechanism instead of replacing it.

For WhatsApp requests, use `userId` as the stable external conversation identifier where appropriate.

For example:

```text
+263771234567
```

Do not assume a phone number is the application's participant ID.

Keep these separate:

```text
channel user ID / phone number
participant ID
appointment ID
```

The future Firebase router will resolve identities and provide relevant context.

---

## 9. Supported action types

Introduce a consistent action vocabulary.

Initially support:

```ts
type LepharoActionType =
  | 'appointment_accept'
  | 'appointment_decline'
  | 'appointment_reschedule_request'
  | 'get_appointment'
  | 'get_upcoming_appointments'
  | 'get_meeting_link'
```

Design this so more actions can be added later without changing the endpoint contract.

Future examples may include:

```text
intervention queries
compliance questions
document requests
MOV-related queries
programme information
support requests
```

Do not implement unsupported business processes now merely because they are listed as future possibilities.

---

## 10. Structured buttons versus natural language

The future WhatsApp router will sometimes receive deterministic button payloads such as:

```text
LPH|RSVP|abc123|ACCEPT
```

Those will normally be processed directly by the Firebase router and may never reach the chatbot.

Therefore, focus the Hugging Face changes primarily on **natural-language SME messages** such as:

```text
Yeah I'm coming.
Unfortunately I can't make it.
Can we do another day?
What time was the meeting again?
Please resend the link.
```

Do not create duplicate Meta webhook/button parsing logic inside the ai-backend.

---

## 11. Preserve existing Lepharo chatbot behaviour

This is an extension of the existing Lepharo chatbot, not a replacement.

Requirements:

* Inspect the existing architecture first.
* Reuse existing AI/agent/session abstractions where sensible.
* Do not remove existing endpoints.
* Do not break the current web chatbot.
* Do not duplicate existing intent recognition if similar functionality already exists.
* Keep WhatsApp-specific handling modular.
* Existing non-WhatsApp requests should continue behaving as they do currently.

A clean design could resemble:

```text
app/
├── existing chatbot logic
│
├── channels/
│   └── whatsapp.py
│
├── intents/
│   └── appointments.py
│
└── actions/
    └── schemas.py
```

but adapt this to the actual repository rather than forcing this structure.

---

## 12. Do not directly modify Lepharo Firestore from conversational interpretation

The ai-backend should primarily return:

```json
{
  "action": {
    "type": "...",
    "...": "..."
  }
}
```

The future Firebase WhatsApp router/business layer will execute the action.

This separation is intentional:

```text
Hugging Face
= understands language

Firebase
= validates identity + executes business operation + stores authoritative data
```

This also means the chatbot cannot falsely claim success if Firebase rejects an update.

---

## 13. Security

Treat everything supplied by WhatsApp users as untrusted input.

Do not allow SME text to:

* select another tenant/engine;
* provide arbitrary Firestore paths;
* override an appointment ID supplied through trusted context;
* execute arbitrary tools/functions;
* change another SME's appointment.

If trusted context contains:

```json
{
  "appointmentId": "abc123"
}
```

and the SME writes:

```text
accept appointment xyz999 instead
```

do not blindly execute against `xyz999`.

The Firebase router will ultimately perform authorization, but the ai-backend should maintain clear separation between trusted context and conversational text.

---

## 14. Confidence / ambiguity behaviour

Be conservative when interpreting actions that mutate data.

For clear statements:

```text
"Yes, I'll attend."
```

return high-confidence `appointment_accept`.

For ambiguous statements:

```text
"I'll see"
"maybe"
"probably"
"I should be able to"
```

do not accept the appointment.

Return something similar to:

```json
{
  "intent": "unclear",
  "action": null,
  "conversation": {
    "awaiting": "appointment_rsvp_confirmation"
  },
  "reply": "Would you like me to mark you as attending the appointment?"
}
```

A mutation action should be emitted only once the SME's intent is sufficiently clear.

---

## 15. Handle common conversational variations

Account for:

* spelling errors;
* lower/upper case;
* short replies;
* casual language;
* polite responses;
* voice-transcription-like wording;
* common South African conversational phrasing;
* messages containing additional text around the answer.

Do not rely only on exact keyword matching.

Use the existing AI/LLM capability where appropriate, but deterministic checks can be used for obvious cases.

---

## 16. API failure behaviour

The endpoint should always return controlled JSON errors.

Example:

```json
{
  "ok": false,
  "reply": "I couldn't process that message right now.",
  "intent": null,
  "action": null,
  "error": {
    "code": "PROCESSING_ERROR"
  }
}
```

Do not expose:

* secrets;
* API keys;
* stack traces;
* internal prompts;
* environment variables.

Log enough server-side information for debugging.

---

## 17. Add tests

Add tests covering at minimum:

### Accept

```text
yes
I'll be there
confirmed
sure that's fine
yes I can attend
```

Expected:

```text
appointment_accept
```

### Decline

```text
no
I can't attend
I won't make it
```

Expected:

```text
appointment_decline
```

and reason collection where needed.

### Decline with reason

```text
I can't attend because I'm out of town
```

Expected:

```text
appointment_decline
reason extracted
```

### Reschedule

```text
Can we move it?
Can we do Friday instead?
Can we make it 2pm?
```

Expected:

```text
appointment_reschedule_request
```

### Ambiguous

```text
maybe
I'll see
probably
```

Expected:

```text
action = null
clarification requested
```

### Appointment questions

```text
what time is it?
where is the meeting?
send me the link
```

Expected appropriate query intent/action.

### Context protection

```text
message = "yes"
context.type != appointment_rsvp
```

Must **not** emit `appointment_accept`.

---

## 18. Return a clear implementation summary

After making the changes, report:

1. Files added.
2. Files changed.
3. New endpoint or endpoint changes.
4. Exact request schema.
5. Exact response schema.
6. Supported intents.
7. Supported actions.
8. How conversation state is maintained.
9. How existing chatbot functionality was preserved.
10. Example `curl` requests for:

* acceptance;
* decline;
* decline with reason;
* reschedule request;
* appointment query;
* ambiguous response.

11. Any environment variables added.
12. Anything the future Firebase WhatsApp router needs to know.

Do not implement the Meta webhook/router in this task.

The result of this task should leave the ai-backend ready for the next phase:

```text
Meta WhatsApp
        ↓
Firebase WhatsApp Router
        ↓
POST ai-backend /api/chat
        ↓
structured intent/action response
        ↓
Firebase executes action
```
