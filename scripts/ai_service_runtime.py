"""Locate the AI process serving 5010; never assume a deployment directory."""
import argparse
import json
import os
import subprocess
from pathlib import Path

SERVICES = ("spff-ai-engine.service", "spff-ai.service")


def listening_inodes(table, port=5010):
    result = set()
    for line in table.splitlines()[1:]:
        fields = line.split()
        if len(fields) >= 10 and fields[3] == "0A":
            if int(fields[1].rsplit(":", 1)[1], 16) == port:
                result.add(fields[9])
    return result


def validate_runtime(cwd, command, imported_package):
    root = Path(cwd).resolve()
    if len(command) != 3 or command[1:] != ["-m", "app"]:
        raise ValueError("Unsupported AI entrypoint; inspect the service before applying files")
    # Preserve the executable path used to launch the service: resolving a venv
    # symlink to /usr/bin/python would lose its site-packages configuration.
    python = Path(command[0])
    if not python.is_absolute() or not python.is_file():
        raise ValueError("Active AI interpreter is not an existing absolute path")
    if not (root / "app/api.py").is_file():
        raise ValueError("Active AI directory needs app/api.py: " + str(root))
    if Path(imported_package).resolve() != (root / "app/__init__.py").resolve():
        raise ValueError("AI import directory differs from service cwd; no files changed")
    return root, python


def discover_runtime(service, proc_root=Path("/proc")):
    if service not in SERVICES:
        raise ValueError("Unexpected AI service name")
    pid = subprocess.check_output(
        ["systemctl", "show", service, "-p", "MainPID", "--value"], text=True).strip()
    if not pid.isdigit() or int(pid) <= 1:
        raise ValueError("AI service has no live MainPID")
    process = proc_root / pid
    cwd = (process / "cwd").resolve(strict=True)
    command = [os.fsdecode(part) for part in (process / "cmdline").read_bytes().split(b"\0") if part]
    environment = dict(os.fsdecode(item).split("=", 1)
                       for item in (process / "environ").read_bytes().split(b"\0") if b"=" in item)
    owned = set()
    for fd in (process / "fd").iterdir():
        try:
            link = os.readlink(fd)
        except FileNotFoundError:
            continue
        if link.startswith("socket:[") and link.endswith("]"):
            owned.add(link[8:-1])
    listeners = set()
    for family in ("tcp", "tcp6"):
        table = process / "net" / family
        if table.exists():
            listeners.update(listening_inodes(table.read_text()))
    if not owned.intersection(listeners):
        raise ValueError("Selected AI MainPID does not own listening port 5010; no files changed")
    # Validate the supported -m app launch before invoking its interpreter.
    root, python = validate_runtime(cwd, command, cwd / "app/__init__.py")
    if not python.samefile(process / "exe"):
        raise ValueError("AI command interpreter differs from process executable; no files changed")
    imported = subprocess.check_output([str(python), "-c",
        "import importlib.util; print(importlib.util.find_spec('app').origin)"],
        cwd=root, env=environment, text=True, timeout=10).strip()
    validate_runtime(cwd, command, imported)
    current_pid = subprocess.check_output(
        ["systemctl", "show", service, "-p", "MainPID", "--value"], text=True).strip()
    if current_pid != pid:
        raise ValueError("AI service restarted during inspection; retry without changing files")
    return {"pid": int(pid), "root": root, "python": python, "environment": environment}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", choices=SERVICES, default=SERVICES[0])
    output = parser.add_mutually_exclusive_group()
    output.add_argument("--root-only", action="store_true")
    output.add_argument("--python-only", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("sudo is required to inspect the AI service")
    try:
        runtime = discover_runtime(args.service)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        # Driver/env contents and command arguments are never printed.
        if isinstance(error, ValueError):
            parser.error(str(error))
        parser.error("AI process inspection failed (" + type(error).__name__ + ")")
    if args.root_only:
        print(runtime["root"])
    elif args.python_only:
        print(runtime["python"])
    else:
        print(json.dumps({"service": args.service, "pid": runtime["pid"],
            "root": str(runtime["root"]), "python": str(runtime["python"]),
            "port": 5010, "listener_verified": True}))


if __name__ == "__main__":
    main()
