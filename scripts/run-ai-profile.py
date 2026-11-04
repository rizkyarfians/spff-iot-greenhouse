"""Run the profile CLI with the running AI service environment, without printing secrets."""
import argparse
import os
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", default="spff-ai-engine.service",
                        choices=("spff-ai-engine.service", "spff-ai.service"))
    parser.add_argument("arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("sudo is required to read the AI service process environment")
    root = Path("/opt/spff-ai").resolve()
    python = root / ".venv/bin/python"
    pid = subprocess.check_output(["systemctl", "show", args.service, "-p", "MainPID", "--value"], text=True).strip()
    if not pid.isdigit() or int(pid) <= 1:
        parser.error("AI service has no live process")
    process = Path("/proc") / pid
    if (process / "cwd").resolve() != root or not python.is_file():
        parser.error("AI service directory does not match /opt/spff-ai; no configuration changed")
    values = (process / "environ").read_bytes().split(b"\0")
    environment = dict(item.decode().split("=", 1) for item in values if b"=" in item)
    arguments = args.arguments or ["--list"]
    if arguments[0:1] == ["--"]:
        arguments = arguments[1:]
    os.chdir(root)
    os.execve(str(python), [str(python), "-m", "app.configure_guide_irrigation", *arguments], environment)


if __name__ == "__main__":
    main()

