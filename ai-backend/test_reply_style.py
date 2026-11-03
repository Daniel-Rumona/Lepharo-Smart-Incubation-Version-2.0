import unittest

from reply_style import HELP_REPLY_DIRECTIVE, reply_style_directive


class ReplyStyleTests(unittest.TestCase):
    def test_help_window_gets_short_reply_rules(self):
        self.assertEqual(reply_style_directive({"surface": "help"}), HELP_REPLY_DIRECTIVE)
        self.assertEqual(reply_style_directive({"surface": " Help "}), HELP_REPLY_DIRECTIVE)

    def test_full_assistant_page_is_unchanged(self):
        self.assertEqual(reply_style_directive({}), "")
        self.assertEqual(reply_style_directive({"availableGuides": [{"guideId": "x"}]}), "")
        self.assertEqual(reply_style_directive({"surface": "chat"}), "")

    def test_bad_context_is_ignored(self):
        self.assertEqual(reply_style_directive(None), "")
        self.assertEqual(reply_style_directive("help"), "")  # type: ignore[arg-type]

    def test_rules_lead_with_the_answer_and_cap_length(self):
        self.assertIn("direct answer in one sentence", HELP_REPLY_DIRECTIVE)
        self.assertIn("at most three short bullets", HELP_REPLY_DIRECTIVE)
        self.assertIn("under about 60 words", HELP_REPLY_DIRECTIVE)


if __name__ == "__main__":
    unittest.main()
