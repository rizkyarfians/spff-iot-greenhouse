import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).parents[1] / "ai_service_runtime.py"
spec = importlib.util.spec_from_file_location("ai_runtime", SCRIPT)
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=SCRIPT.parent)
        self.addCleanup(self.temporary.cleanup)
        self.proc = Path(self.temporary.name) / "proc"
        self.process = self.proc / "123"
        self.root = self.process / "cwd"
        (self.root / "app").mkdir(parents=True)
        (self.root / ".venv/bin").mkdir(parents=True)
        for name in ("app/api.py", "app/__init__.py", ".venv/bin/python"):
            (self.root / name).write_text("# isolated fixture\n")
        self.command = [str(self.root / ".venv/bin/python"), "-m", "app"]
        (self.process / "cmdline").write_bytes(b"\0".join(v.encode() for v in self.command) + b"\0")
        (self.process / "environ").write_bytes(b"AI_TEST_SECRET=private-test-value\0")
        (self.process / "fd").mkdir()
        (self.process / "fd/7").touch()
        (self.process / "net").mkdir()
        (self.process / "net/tcp").write_text(
            "header\n0: 0100007F:1392 00000000:0000 0A 0:0 0:0 0 1000 0 999\n")

    def discover(self, *, inode="999", imported=None, final_pid="123"):
        with patch.object(runtime.os, "readlink", return_value="socket:[" + inode + "]"), \
             patch.object(runtime.subprocess, "check_output", side_effect=[
                 "123\n", str(imported or self.root / "app/__init__.py") + "\n", final_pid + "\n"]):
            return runtime.discover_runtime("spff-ai-engine.service", self.proc)

    def test_active_directory_is_discovered_without_using_opt_default(self):
        actual = self.discover()
        self.assertEqual(actual["root"], self.root.resolve())
        self.assertEqual(actual["pid"], 123)
        self.assertEqual(actual["environment"]["AI_TEST_SECRET"], "private-test-value")

    def test_process_must_own_the_5010_listener(self):
        with self.assertRaisesRegex(ValueError, "does not own"):
            self.discover(inode="888")

    def test_different_import_directory_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "import directory differs"):
            self.discover(imported=self.root / "other/app/__init__.py")

    def test_service_restart_during_inspection_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "restarted during inspection"):
            self.discover(final_pid="124")

    def test_unsupported_entrypoint_is_not_guessed(self):
        with self.assertRaisesRegex(ValueError, "Unsupported AI entrypoint"):
            runtime.validate_runtime(self.root, [self.command[0], "other.py"], self.root / "app/__init__.py")

    def test_only_listening_rows_on_exact_port_match(self):
        table = "header\n0: 0100007F:1392 0:0 01 0 0 0 0 0 999\n"
        self.assertEqual(runtime.listening_inodes(table), set())


if __name__ == "__main__":
    unittest.main()
