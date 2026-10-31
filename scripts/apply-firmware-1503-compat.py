"""Install only reviewed source files into an existing, possibly dirty SPFF tree.

Default is check-only. No Git operations, builds, environment edits, service
restarts, database access or actuator calls are performed by this script.
"""
import argparse
import hashlib
import json
import os
import shutil
import stat
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


def normalized(content):
    return content.decode("utf-8-sig").replace("\r\n", "\n").encode("utf-8")


def checksum(content):
    return hashlib.sha256(normalized(content)).hexdigest()


def inside(root, name):
    relative = Path(name)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Invalid manifest path: " + name)
    path = root / relative
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Symlink or escaped target: " + name)
    return path


def inspect(source, target, manifest):
    entries = []
    for item in manifest["files"]:
        candidate, destination = inside(source, item["path"]), inside(target, item["path"])
        if not candidate.is_file() or checksum(candidate.read_bytes()) != item["after_sha256"]:
            raise ValueError("Patch source fingerprint mismatch: " + item["path"])
        if not destination.is_file():
            status, actual = "MISSING", None
        else:
            actual = checksum(destination.read_bytes())
            status = ("ALREADY_APPLIED" if actual == item["after_sha256"] else
                      "READY" if actual in item["before_sha256"] else "CONFLICT")
        entries.append({**item, "status": status, "actual_sha256": actual})
    return entries


def write_atomic(path, content, metadata):
    descriptor, temporary = tempfile.mkstemp(prefix=".spff-1503-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, stat.S_IMODE(metadata.st_mode))
        if os.name != "nt" and os.geteuid() == 0:
            os.chown(temporary, metadata.st_uid, metadata.st_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(source, target, manifest, *, apply=False, backup_root=None):
    source, target = Path(source).resolve(), Path(target).resolve()
    if source == target:
        raise ValueError("Use a separate patch checkout, not the running target tree")
    if not target.is_dir() or not (target / "package.json").is_file():
        raise ValueError("Target must be an existing SPFF source checkout")
    entries = inspect(source, target, manifest)
    ready = all(item["status"] in ("READY", "ALREADY_APPLIED") for item in entries)
    result = {"status": "READY" if ready else "CONFLICT", "applied": False,
              "files": [{"path": item["path"], "status": item["status"]} for item in entries]}
    if not ready or not apply:
        return result
    pending = [item for item in entries if item["status"] == "READY"]
    if not pending:
        return {**result, "status": "ALREADY_APPLIED"}
    backup_root = Path(backup_root or Path.home() / "spff-1503-backups").expanduser().resolve()
    backup = backup_root / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8])
    backup.mkdir(parents=True, mode=0o700)
    originals = {}
    # Save every original before any source file can be replaced.
    for item in pending:
        destination = inside(target, item["path"])
        content, metadata = destination.read_bytes(), destination.stat()
        if checksum(content) != item["actual_sha256"]:
            raise RuntimeError("Target changed during preflight: " + item["path"])
        saved = inside(backup, item["path"])
        saved.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(destination, saved)
        originals[item["path"]] = (content, metadata)
    (backup / "install.json").write_text(json.dumps({"target": str(target), "files": pending}, indent=2), encoding="utf-8")
    written = []
    try:
        for item in pending:
            destination = inside(target, item["path"])
            if checksum(destination.read_bytes()) != item["actual_sha256"]:
                raise RuntimeError("Target changed during installation: " + item["path"])
            write_atomic(destination, normalized(inside(source, item["path"]).read_bytes()), originals[item["path"]][1])
            written.append(item)
    except BaseException as error:
        conflicts = []
        for item in reversed(written):
            destination = inside(target, item["path"])
            # Do not overwrite an unrelated concurrent edit during rollback.
            if checksum(destination.read_bytes()) != item["after_sha256"]:
                conflicts.append(item["path"])
                continue
            write_atomic(destination, *originals[item["path"]])
        message = f"Installation failed; backup retained at {backup}."
        if conflicts:
            message += " Concurrent edits require manual recovery: " + ", ".join(conflicts)
        raise RuntimeError(message) from error
    return {**result, "status": "APPLIED", "applied": True, "backup": str(backup),
            "next_step": "Build contracts/backend/edge/worker; services have NOT been restarted."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, type=Path)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--apply", action="store_true", help="Back up and replace reviewed source files")
    parser.add_argument("--backup-dir", type=Path)
    args = parser.parse_args()
    try:
        manifest = json.loads((args.source / "scripts" / "firmware-1503-manifest.json").read_text(encoding="utf-8"))
        result = install(args.source, args.target, manifest, apply=args.apply, backup_root=args.backup_dir)
        print(json.dumps(result, indent=2))
        return 0 if result["status"] != "CONFLICT" else 2
    except (OSError, ValueError, RuntimeError) as error:
        print(json.dumps({"status": "ERROR", "message": str(error)}, indent=2))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
