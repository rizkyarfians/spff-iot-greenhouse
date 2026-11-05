"""Run the profile CLI with the running AI service environment, without printing secrets."""
import argparse
import os
import subprocess
from ai_service_runtime import discover_runtime


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", default="spff-ai-engine.service",
                        choices=("spff-ai-engine.service", "spff-ai.service"))
    parser.add_argument("arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("sudo is required to read the AI service process environment")
    try:
        runtime = discover_runtime(args.service)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        parser.error(str(error) if isinstance(error, ValueError)
                     else "AI process inspection failed (" + type(error).__name__ + ")")
    root, python, environment = runtime["root"], runtime["python"], runtime["environment"]
    arguments = args.arguments or ["--list"]
    if arguments[0:1] == ["--"]:
        arguments = arguments[1:]
    if not arguments:
        arguments = ["--list"]
    os.chdir(root)
    os.execve(str(python), [str(python), "-m", "app.configure_guide_irrigation", *arguments], environment)


if __name__ == "__main__":
    main()

