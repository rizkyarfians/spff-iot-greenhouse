"""Run the PostgreSQL repository test on a new isolated cluster (Windows).

Does not read SPFF credentials or connect to its running database. All subprocesses
have hidden windows. The temporary cluster is stopped even if tests fail.
"""
import os
import socket
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(os.getenv("AI_PG_BIN", r"C:\Program Files\PostgreSQL\18\bin"))
DATA = (ROOT / "data" / ("test-postgres-" + uuid4().hex)).resolve()
if not DATA.is_relative_to((ROOT / "data").resolve()):
    raise RuntimeError("temporary test target escaped project data directory")
DATA.mkdir(parents=True)
flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def run(args, **kwargs):
    return subprocess.run(args, creationflags=flags, check=True, **kwargs)


with socket.socket() as available:
    available.bind(("127.0.0.1", 0))
    port = available.getsockname()[1]

started = False
try:
    run([str(BIN / "initdb.exe"), "-D", str(DATA), "-U", "ai_test", "-A", "trust", "--no-locale", "--encoding=UTF8"], stdout=subprocess.DEVNULL)
    run([str(BIN / "pg_ctl.exe"), "-D", str(DATA), "-l", str(DATA / "server.log"), "-o", f"-p {port} -h 127.0.0.1", "-w", "start"], stdout=subprocess.DEVNULL)
    started = True
    env = os.environ.copy()
    env["AI_TEST_DATABASE_DSN"] = f"postgresql://ai_test@127.0.0.1:{port}/postgres"
    result = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"], cwd=ROOT, env=env, creationflags=flags, capture_output=True, text=True)
    output = result.stdout + result.stderr
    print(output)
    (ROOT / "data" / "verification-tests.txt").write_text(output, encoding="utf-8")
    result_code = result.returncode
finally:
    if started:
        run([str(BIN / "pg_ctl.exe"), "-D", str(DATA), "-m", "fast", "-w", "stop"], stdout=subprocess.DEVNULL)
print(f"Stopped isolated test cluster. Logs retained at {DATA}")
sys.exit(result_code)
