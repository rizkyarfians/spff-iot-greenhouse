"""Add the conversion card while preserving Orange's local panel/API edits."""
import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

ASSETS = ["frontend/src/ConversionTarget.tsx", "frontend/src/ConversionTarget.css", "frontend/src/conversionTargetData.ts"]
IMPORT = "import {ConversionTarget} from './ConversionTarget'"
CARD = "{a&&<ConversionTarget programId={p.programId} activityId={a.id} title={`${a.title} · HST ${a.hst??'—'}`} waterEcMsCm={p.config.waterEcMsCm}/>}"


def normalized(path):
    return path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")


def prepare(source, target):
    changes = {}
    for name in ASSETS:
        desired = normalized(source / name)
        destination = target / name
        if destination.exists() and normalized(destination) != desired:
            raise ValueError("Existing file differs: " + name)
        if not destination.exists():
            changes[name] = desired
    name = "frontend/src/AdaptiveRecommendation.tsx"
    original = content = normalized(target / name)
    # Only add two fragments. Existing device panel, API calls and local layout stay.
    if "<ConversionTarget " not in content:
        for token in ("const p=data?.program", "const a=activities.find", '<div className="ar-status">'):
            if content.count(token) != 1:
                raise ValueError("Unrecognized recommendation layout: " + token)
        if IMPORT not in content:
            content = IMPORT + "\n" + content
        content = content.replace('<div className="ar-status">', CARD + '\n   <div className="ar-status">', 1)
    elif IMPORT not in content or CARD not in content:
        raise ValueError("An existing conversion card differs; review before replacing")
    if content != original:
        changes[name] = content
    # Explicit extension resolves the existing GuideSchedule/guideSchedule naming
    # collision on Windows; no component or helper is renamed or removed.
    name = "frontend/src/GuidePrograms.tsx"
    original = content = normalized(target / name)
    content = content.replace("from './GuideSchedule'", "from './GuideSchedule.tsx'")
    if content != original:
        changes[name] = content
    for name in changes:
        path = target / name
        if path.is_symlink() or not path.resolve().is_relative_to(target):
            raise ValueError("Symlink or escaped target: " + name)
    return changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[1]
    target = args.target.resolve()
    if source == target or not (target / "package.json").is_file():
        raise ValueError("Use a separate patch checkout and an existing SPFF target")
    changes = prepare(source, target)
    result = {"status": "READY" if changes else "ALREADY_APPLIED", "applied": False, "files": list(changes)}
    if args.apply and changes:
        backup = Path.home() / "spff-conversion-backups" / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8])
        backup.mkdir(parents=True, mode=0o700)
        originals = {}
        for name in changes:
            destination = target / name
            originals[name] = destination.read_bytes() if destination.exists() else None
            if destination.exists():
                saved = backup / name
                saved.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(destination, saved)
        (backup / "install.json").write_text(json.dumps({"target": str(target), "added": [n for n,v in originals.items() if v is None]}, indent=2))
        written = []
        try:
            for name, content in changes.items():
                destination = target / name
                current = destination.read_bytes() if destination.exists() else None
                if current != originals[name]:
                    raise RuntimeError("Concurrent edit: " + name)
                destination.write_text(content, encoding="utf-8", newline="\n")
                written.append(name)
        except BaseException:
            for name in reversed(written):
                destination = target / name
                if normalized(destination) != changes[name]:
                    continue
                if originals[name] is None:
                    destination.unlink()
                else:
                    destination.write_bytes(originals[name])
            raise
        result.update(status="APPLIED", applied=True, backup=str(backup))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(json.dumps({"status": "ERROR", "message": str(error)}))
        raise SystemExit(2)
