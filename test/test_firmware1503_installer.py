import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("fw1503_installer", Path(__file__).resolve().parents[1] / "scripts/apply-firmware-1503-compat.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.root = Path(self.temp.name)
        self.source, self.target = self.root / "source", self.root / "target"
        self.source.mkdir()
        self.target.mkdir()
        (self.target / "package.json").write_text("{}")
        self.paths = ["functions/a.ts", "packages/b.ts"]
        self.manifest = {"files": []}
        for name in self.paths:
            for root, content in ((self.source, b"new\n"), (self.target, b"old\r\n")):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
            self.manifest["files"].append({"path": name, "before_sha256": [installer.checksum(b"old\n")], "after_sha256": installer.checksum(b"new\n")})
        (self.target / "untouched.ts").write_text("operator change")

    def tearDown(self):
        self.temp.cleanup()

    def run_install(self, **kwargs):
        return installer.install(self.source, self.target, self.manifest, backup_root=self.root / "backups", **kwargs)

    def test_default_only_checks_and_normalizes_line_endings(self):
        result = self.run_install()
        self.assertEqual(result["status"], "READY")
        self.assertFalse(result["applied"])
        self.assertEqual((self.target / self.paths[0]).read_bytes(), b"old\r\n")
        self.assertFalse((self.root / "backups").exists())

    def test_backup_apply_idempotence_and_unrelated_changes_preserved(self):
        result = self.run_install(apply=True)
        self.assertEqual(result["status"], "APPLIED")
        self.assertEqual((Path(result["backup"]) / self.paths[0]).read_bytes(), b"old\r\n")
        self.assertEqual((self.target / self.paths[0]).read_bytes(), b"new\n")
        self.assertEqual((self.target / "untouched.ts").read_text(), "operator change")
        self.assertEqual(self.run_install(apply=True)["status"], "ALREADY_APPLIED")

    def test_conflict_checks_all_files_before_writing_any(self):
        (self.target / self.paths[1]).write_text("unexpected edit")
        result = self.run_install(apply=True)
        self.assertEqual(result["status"], "CONFLICT")
        self.assertEqual((self.target / self.paths[0]).read_bytes(), b"old\r\n")
        self.assertFalse((self.root / "backups").exists())

    def test_partial_failure_rolls_back_raw_originals(self):
        original_write = installer.write_atomic
        calls = 0
        def interrupted_write(*args):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("simulated write failure")
            return original_write(*args)
        with patch.object(installer, "write_atomic", side_effect=interrupted_write):
            with self.assertRaisesRegex(RuntimeError, "backup retained"):
                self.run_install(apply=True)
        for name in self.paths:
            self.assertEqual((self.target / name).read_bytes(), b"old\r\n")

    def test_manifest_escape_and_changed_patch_source_rejected(self):
        self.manifest["files"][0]["path"] = "../escape.ts"
        with self.assertRaises(ValueError):
            self.run_install(apply=True)
        self.manifest["files"][0]["path"] = self.paths[0]
        (self.source / self.paths[0]).write_text("tampered")
        with self.assertRaisesRegex(ValueError, "source fingerprint"):
            self.run_install(apply=True)

    def test_missing_target_is_not_created(self):
        (self.target / self.paths[0]).unlink()
        self.assertEqual(self.run_install(apply=True)["status"], "CONFLICT")
        self.assertFalse((self.target / self.paths[0]).exists())
