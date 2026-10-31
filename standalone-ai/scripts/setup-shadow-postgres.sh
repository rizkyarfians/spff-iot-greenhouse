#!/usr/bin/env bash
# Run explicitly: sudo bash /opt/spff-ai/scripts/setup-shadow-postgres.sh --apply
# Only the AI service is restarted; no SPFF control command is created.
set -euo pipefail
if [[ "${1:-}" != "--apply" ]]; then
  echo 'Creates AI-owned PostgreSQL schema/tables and a separate state role, adds SELECT on adaptive feedback for the existing reader, configures AI shadow polling, and restarts only spff-ai-engine. No SPFF table data or relay commands are changed.'
  echo 'Use --apply to run.'
  exit 0
fi
if [[ "$EUID" -ne 0 ]]; then echo 'Run with sudo bash.' >&2; exit 1; fi
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
config=/etc/spff-ai/engine.env
cd /tmp
test -f "$config"
grep -Eq '^AI_SOURCE_DSN=.+$' "$config" || { echo 'Configure AI_SOURCE_DSN first.' >&2; exit 1; }
if grep -Eq '^AI_STATE_DSN=.+$' "$config"; then
  echo 'AI_STATE_DSN already configured; preserving existing credentials. Apply migrations with your migrator if needed.'
  exit 0
fi
role_exists="$(runuser -u postgres -- psql -XAt -d spff -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_roles WHERE rolname='spff_ai_state'")"
if [[ "$role_exists" != "0" ]]; then echo 'spff_ai_state already exists; reconcile credentials before rerunning.' >&2; exit 1; fi
reader_exists="$(runuser -u postgres -- psql -XAt -d spff -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_roles WHERE rolname='spff_ai_reader'")"
if [[ "$reader_exists" != "1" ]]; then echo 'Existing spff_ai_reader role required.' >&2; exit 1; fi
runuser -u postgres -- psql -X -d spff -v ON_ERROR_STOP=1 -f "$root/migrations/001_ai_state.sql"
runuser -u postgres -- psql -X -d spff -v ON_ERROR_STOP=1 -f "$root/migrations/002_runtime_profiles.sql"
password="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
runuser -u postgres -- psql -X -d spff -v ON_ERROR_STOP=1 <<SQL
BEGIN;
CREATE ROLE spff_ai_state LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$password';
GRANT CONNECT ON DATABASE spff TO spff_ai_state;
GRANT USAGE ON SCHEMA spff_ai TO spff_ai_state;
GRANT SELECT,INSERT,UPDATE ON spff_ai.engine_state TO spff_ai_state;
GRANT SELECT,INSERT ON spff_ai.audit_events TO spff_ai_state;
GRANT USAGE,SELECT ON SEQUENCE spff_ai.audit_events_id_seq TO spff_ai_state;
GRANT SELECT,INSERT,UPDATE ON spff_ai.runtime_profiles TO spff_ai_state;
GRANT SELECT,INSERT ON spff_ai.runtime_profile_history TO spff_ai_state;
SELECT 'GRANT SELECT ON spff.adaptive_fert_events TO spff_ai_reader'
WHERE to_regclass('spff.adaptive_fert_events') IS NOT NULL
\gexec
COMMIT;
SQL
backup="${config}.before-live-shadow-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p -- "$config" "$backup"
AI_STATE_PASSWORD="$password" python3 - "$config" <<'PY'
import os,sys
from pathlib import Path
path=Path(sys.argv[1])
updates={'AI_STATE_DSN':'postgresql://spff_ai_state:'+os.environ['AI_STATE_PASSWORD']+'@127.0.0.1:5432/spff',
         'AI_MODE':'SHADOW_MODE','AI_POLL_ENABLED':'true'}
lines=[line for line in path.read_text().splitlines() if line.partition('=')[0].strip() not in updates]
path.write_text('\n'.join(lines+[key+'='+value for key,value in updates.items()])+'\n')
path.chmod(0o640)
PY
unset password
systemctl restart spff-ai-engine.service
echo "AI PostgreSQL shadow polling configured. Environment backup: $backup"
echo 'Profiles are intentionally not populated with sample calibration or stock values.'
