"""Install only hash-checked AI profile modules; preserve unrelated Orange files."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

FILES = {
    "api.py": "137e375801dbc054be6b4456a98745d720edcd26",
    "live_engine.py": "10c2b1c7471043006afc1d36a516b48db506c620",
    "dashboard_summary.py": "b2d5f4698971efcd25d0a0ff0ec06276a0cc79e6",
    "configure_live.py": "9ac73cada952743591f85512656e02d076b01892",
    "production_profile.py": None,
    "configure_guide_irrigation.py": None,
    "tank_inventory_policy.py": None,
}

# Previously published profile patch: allow an upgrade from these exact blobs,
# while continuing to preserve any unrecognized local source edits.
PREVIOUS = {
    "api.py": ("7debd01b71abbe1ea633f05c198c7780d666e88d",),
    "dashboard_summary.py": ("5a6d546289baa0d417701b4f192f1abccc4836b5",
                             "ffeaac49ed04725e979b2f4b29f578476db1977d"),
    "production_profile.py": ("56b6627f7f8232959d3117c2e3b4a7c924525cea",
                              "cbcd919073a6bf3ea1cb67c1eb53bbaeee67f60d"),
    "configure_guide_irrigation.py": ("918d5ddcf7de1bba86eed7e92c40dce53bad610c",),
}


def blob(path):
    data = path.read_text(encoding="utf-8").encode("utf-8")
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def checked(root, name):
    value = (root / name).resolve()
    if root.resolve() not in value.parents:
        raise ValueError("File escapes intended AI module directory")
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("stage", "apply", "rollback"))
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("backup", type=Path)
    parser.add_argument("--python", type=Path, help="Verified interpreter from the active AI service")
    args = parser.parse_args()
    source = args.source.resolve() / "standalone-ai"
    target = args.target.resolve()
    backup = args.backup.resolve()
    app = target / "app"
    python = args.python or target / ".venv/bin/python"
    if not python.is_file() or not app.is_dir():
        raise ValueError("Expected installed AI venv and app directory")
    if args.mode == "stage":
        for name, expected in FILES.items():
            candidate, live = checked(source / "app", name), checked(app, name)
            if not candidate.is_file():
                raise ValueError("Staged AI module missing: " + name)
            if live.exists() and blob(live) not in (expected, blob(candidate), *PREVIOUS.get(name, ())):
                raise ValueError("Local Python source differs; preserved without edits: " + name)
        check = backup / "check"
        shutil.copytree(app, check / "app", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        (check / "tests").mkdir()
        for name in FILES:
            shutil.copy2(checked(source / "app", name), checked(check / "app", name))
        for name in ("test_production_guide_profile.py", "test_hst_state_separation.py", "test_tank_inventory_profile.py"):
            shutil.copy2(source / "tests" / name, check / "tests" / name)
        subprocess.run([str(python), "-m", "unittest", "discover", "-s", "tests",
                        "-p", "test_*profile.py"], cwd=check, check=True)
        print("PYTHON_PROFILE_STAGE=PASS; LIVE_FILES=UNCHANGED")
        return
    manifest_path = backup / "files.json"
    if args.mode == "apply":
        previous = {}
        (backup / "originals").mkdir()
        for name, expected in FILES.items():
            live = checked(app, name)
            if live.exists() and blob(live) not in (expected, blob(checked(source / "app", name)), *PREVIOUS.get(name, ())):
                raise ValueError("Concurrent local source edit preserved: " + name)
            previous[name] = live.exists()
            if live.exists():
                shutil.copy2(live, checked(backup / "originals", name))
        manifest_path.write_text(json.dumps(previous), encoding="utf-8")
        for name in FILES:
            live = checked(app, name)
            temporary = live.with_suffix(".py.profile-patch")
            shutil.copy2(checked(source / "app", name), temporary)
            temporary.chmod(0o644)
            os.replace(temporary, live)
        print("PYTHON_PROFILE_FILES=APPLIED; DATABASE_AND_FLAGS=UNCHANGED")
        return
    if not manifest_path.exists():
        print("PYTHON_PROFILE_ROLLBACK=NO_FILES_APPLIED")
        return
    previous = json.loads(manifest_path.read_text())
    for name, existed in previous.items():
        live = checked(app, name)
        allowed = [blob(checked(source / "app", name))]
        if existed:
            allowed.append(blob(checked(backup / "originals", name)))
        if live.exists() and blob(live) not in allowed:
            raise ValueError("Concurrent local edit preserved; manual recovery needed: " + name)
        if existed:
            shutil.copy2(checked(backup / "originals", name), live)
        elif live.exists():
            live.unlink()
    print("PYTHON_PROFILE_ROLLBACK=COMPLETE")


if __name__ == "__main__":
    main()

