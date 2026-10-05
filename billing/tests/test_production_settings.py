"""What the production image actually configures, loaded the way it loads it.

Nothing in the suite ran under production_settings: test_settings imports the
dev settings, which had what production lacked.
"""

from unittest import mock

from django.test import SimpleTestCase

from billing.tests.test_base import load_production_settings
from billing.utils import AIInvoiceProcessor


class GeminiSettingsTest(SimpleTestCase):
    """C2: AIInvoiceProcessor reads its keys from Django settings, and
    production_settings never defined them, so since v2.0.5 every AI import
    and inward-bill extract failed with "No Gemini API key configured"
    whatever the container's .env held."""

    def _processor(self, **env):
        with mock.patch("billing.utils.settings", load_production_settings(**env)):
            return AIInvoiceProcessor()

    def test_ai_import_uses_the_keys_and_model_from_the_environment(self):
        p = self._processor(
            GEMINI_API_KEYS="key-one, key-two",
            GEMINI_API_KEY="key-three",
            GEMINI_VISION_MODEL="gemini-test-model",
        )
        self.assertEqual(p.gemini_keys, ["key-one", "key-two", "key-three"])
        self.assertEqual(p.gemini_model, "gemini-test-model")

    def test_a_blank_model_line_keeps_the_default_model(self):
        p = self._processor(GEMINI_API_KEYS="key-one", GEMINI_API_KEY=None, GEMINI_VISION_MODEL="")
        self.assertEqual(p.gemini_model, "gemini-2.5-flash-lite")
