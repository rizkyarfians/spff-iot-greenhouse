import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).parents[1]
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('tank_policy_configuration', SCRIPTS/'configure-tank-inventory.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TankPolicyConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=SCRIPTS)
        self.addCleanup(self.temp.cleanup)
        self.target = Path(self.temp.name)/'service.d/policy.conf'
        self.runtime = {'root': Path(self.temp.name), 'python': Path('test-python')}
        self.content = '[Service]\nEnvironment=AI_IRRIGATION_TARGET_POLICY=AVAILABLE_TANK\n'

    def apply(self, valid=True):
        summary = {'can_dispatch': False, 'operational_profile': {'status': 'TANK_BOUND'},
            'production_fuzzy': {'basis': 'TANK_INVENTORY_FUZZY', 'can_dispatch': not valid}}
        with patch.object(module.subprocess, 'run') as run, \
             patch.object(module, 'discover_runtime', return_value=self.runtime), \
             patch.object(module.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(summary).encode())), \
             contextlib.redirect_stdout(io.StringIO()):
            module.apply_policy(self.target, self.content, 'spff-ai-engine.service', self.runtime)
        return run

    def test_policy_apply_changes_only_its_dropin_and_checks_non_actuating_readback(self):
        self.apply()
        self.assertEqual(self.target.read_text(), self.content)
        self.assertNotIn('DISPATCH', self.target.read_text())

    def test_bad_readback_restores_existing_policy(self):
        self.target.parent.mkdir()
        self.target.write_text('previous policy\n')
        with self.assertRaisesRegex(RuntimeError, 'readback failed'):
            self.apply(valid=False)
        self.assertEqual(self.target.read_text(), 'previous policy\n')

    def test_bad_readback_removes_new_policy_when_no_previous_file_existed(self):
        with self.assertRaisesRegex(RuntimeError, 'readback failed'):
            self.apply(valid=False)
        self.assertFalse(self.target.exists())


if __name__ == '__main__':
    unittest.main()
