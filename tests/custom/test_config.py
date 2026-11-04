import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("custom_ui", Path(__file__).parents[2] / "backend/open_webui/custom/ui.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CustomUIConfigTest(unittest.TestCase):
    def test_object(self):
        self.assertEqual(module.load_custom_ui('{"hello":true}'), {"hello": True})
        self.assertEqual(module.load_custom_ui('{"hello":false}'), {"hello": False})
    def test_invalid_fails_closed_without_logging_value(self):
        for raw in ('null', '[]', 'true', '"secret"', '{secret', ''):
            with self.assertLogs(module.__name__, level='WARNING') as logs:
                self.assertEqual(module.load_custom_ui(raw), {})
            self.assertNotIn('secret', ''.join(logs.output))
    def test_default(self):
        self.assertEqual(module.load_custom_ui('{}'), {})

class CustomBrandNameTest(unittest.TestCase):
    def test_strict_flag_and_upstream_fallback(self):
        for raw in ('{}', '{"brand":true}', '{"brand":{"suffix":"false","name":"Ai - dvokat"}}'):
            self.assertEqual(module.custom_webui_name('Original (Open WebUI)', raw), 'Original (Open WebUI)')
        self.assertEqual(module.custom_webui_name('Original (Open WebUI)', '{"brand":{"suffix":false,"name":"Ai - dvokat"}}'), 'Ai - dvokat')
        self.assertEqual(module.custom_webui_name('Original (Open WebUI)', '{"brand":{"suffix":false}}'), 'Original')

class StandFlagsTest(unittest.TestCase):
    def test_stand_line_is_one_json_object_with_brand_name(self):
        raw = (Path(__file__).parent / 'stand-flags.json').read_text(encoding='utf-8').strip()
        self.assertNotIn('\n', raw)
        flags = module.load_custom_ui(raw)
        self.assertEqual(sorted(flags), ['brand', 'result_card'])
        self.assertIs(flags['result_card'], True)
        self.assertEqual(module.custom_webui_name('Open WebUI (Open WebUI)', raw), 'Ai - dvokat')

if __name__ == '__main__':
    unittest.main()
