import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).parents[1] / 'install-ai-profile-patch.py'
spec = importlib.util.spec_from_file_location('installer', SCRIPT)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=SCRIPT.parent)
        self.assertEqual(Path(self.temporary.name).resolve().parent, SCRIPT.parent.resolve())
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.source, self.target, self.backup = root/'source', root/'target', root/'backup'
        (self.source/'standalone-ai/app').mkdir(parents=True)
        (self.source/'standalone-ai/tests').mkdir()
        (self.target/'app').mkdir(parents=True)
        (self.target/'.venv/bin').mkdir(parents=True)
        (self.target/'.venv/bin/python').write_text('test-only executable placeholder')
        self.backup.mkdir()
        (self.target/'app/a.py').write_text('old = True\n')
        (self.source/'standalone-ai/app/a.py').write_text('new = True\n')
        (self.source/'standalone-ai/app/b.py').write_text('added = True\n')
        for name in ('test_production_guide_profile.py', 'test_hst_state_separation.py'):
            (self.source/'standalone-ai/tests'/name).write_text('# fixture only\n')
        self.files = {'a.py': installer.blob(self.target/'app/a.py'), 'b.py': None}

    def run_mode(self, mode, extra=None):
        argv = [str(SCRIPT), mode, str(self.source), str(self.target), str(self.backup)]
        argv.extend(extra or [])
        with patch.object(installer, 'FILES', self.files), patch('sys.argv', argv), patch.object(installer.subprocess, 'run'):
            installer.main()

    def test_stage_preserves_live_files_and_apply_can_rollback(self):
        self.run_mode('stage')
        self.assertEqual((self.target/'app/a.py').read_text(), 'old = True\n')
        self.run_mode('apply')
        self.assertEqual((self.target/'app/a.py').read_text(), 'new = True\n')
        self.assertTrue((self.target/'app/b.py').exists())
        self.run_mode('rollback')
        self.assertEqual((self.target/'app/a.py').read_text(), 'old = True\n')
        self.assertFalse((self.target/'app/b.py').exists())

    def test_release_can_stage_apply_and_rollback_with_shared_service_interpreter(self):
        shared = self.target.parent / 'shared-venv'
        (self.target/'.venv').rename(shared)
        arguments = ['--python', str(shared/'bin/python')]
        self.run_mode('stage', arguments)
        self.run_mode('apply', arguments)
        self.run_mode('rollback', arguments)
        self.assertEqual((self.target/'app/a.py').read_text(), 'old = True\n')
        self.assertFalse((self.target/'.venv').exists())

    def test_local_edits_are_not_overwritten(self):
        (self.target/'app/a.py').write_text('local_change = True\n')
        with self.assertRaisesRegex(ValueError, 'Local Python source differs'):
            self.run_mode('stage')
        self.assertEqual((self.target/'app/a.py').read_text(), 'local_change = True\n')

    def test_exact_previous_patch_is_upgradable_and_rollback_keeps_that_version(self):
        (self.target/'app/a.py').write_text('previous_patch = True\n')
        previous = {'a.py': (installer.blob(self.target/'app/a.py'),)}
        with patch.object(installer, 'PREVIOUS', previous):
            self.run_mode('stage')
            self.run_mode('apply')
            self.assertEqual((self.target/'app/a.py').read_text(), 'new = True\n')
            self.run_mode('rollback')
        self.assertEqual((self.target/'app/a.py').read_text(), 'previous_patch = True\n')

    def test_partial_apply_can_restore_both_old_and_new_files(self):
        self.run_mode('apply')
        (self.target/'app/a.py').write_text('old = True\n')
        self.run_mode('rollback')
        self.assertEqual((self.target/'app/a.py').read_text(), 'old = True\n')
        self.assertFalse((self.target/'app/b.py').exists())

    def test_rollback_before_any_apply_is_a_noop(self):
        self.run_mode('rollback')
        self.assertEqual((self.target/'app/a.py').read_text(), 'old = True\n')


if __name__ == '__main__':
    unittest.main()
