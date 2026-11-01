# SPFF AI dashboard — localhost-only isolated preview

This preview is **not a production deployment**. It does not reuse the SPFF
API's operational router or authentication/session database. It intentionally
exposes only `GET /api/health` and `GET /api/unified-ai/dashboard` on
`127.0.0.1:5002`; every other API method/path returns 404.
The dashboard preview bypasses authentication **only** behind a local SSH tunnel.
Never bind Vite or preview API to 0.0.0.0, expose them through Nginx/Tailscale,
or use this preview as a replacement for production authentication.

## Isolation

- `/opt/spff`, `/opt/spff-ai`, Nginx, systemd, MQTT, production API, and ESP32
  are untouched and must not be restarted for this preview.
- Frontend: `VITE_SPFF_AI_PREVIEW=true`, `127.0.0.1:5174`. Only
  `UnifiedAiNeedsPage` mounts. Operational dashboard pages and buttons are
  not rendered. The dev Vite proxy targets `127.0.0.1:5002`.
- Node: `SPFF_AI_STAGING=true` running `functions/lib/aiPreviewLocal.js`.
  The production app is **not imported** and no production database connections,
  command routes or startup coordinators are created.
- Python: `127.0.0.1:5011`, `SHADOW_MODE`, separate state SQLite file,
  `AI_POLL_ENABLED=false`. The source reader requires a separately verified
  PostgreSQL **read-only** credential; it performs SELECT-only source inspection.
  Do not reuse the production AI state DSN or production AI writer role.
- No automatic evaluation in this prototype: a trusted local operator can run
  `POST /source/evaluate` explicitly on port 5011 (never from the browser).
  This writes only into the preview's dedicated SQLite file. A decision becomes
  STALE 30 seconds after evaluation, which is expected with polling disabled.
- `can_dispatch=false` in all modes. No command is published to MQTT.

## Preparation

On Orange Pi in the isolated checkout:
```bash
cd ~/spff-ai-dashboard-test
git status --short
git pull --ff-only
npm run build
npm run lint
```

Ensure the Python venv was installed into
`~/spff-ai-dashboard-test/standalone-ai/.venv` already.

Use **three separate Orange Pi terminals** (or SSH sessions). The snippets are
intentionally foreground processes, so Ctrl+C stops just the preview component.

**Terminal A — Python preview:**
```bash
cd ~/spff-ai-dashboard-test/standalone-ai
source .venv/bin/activate
export AI_HOST=127.0.0.1 AI_PORT=5011 AI_MODE=SHADOW_MODE
export AI_POLL_ENABLED=false AI_STATE_DSN=
export AI_STATE_PATH="$HOME/spff-ai-dashboard-test/standalone-ai/data/staging-shadow.sqlite3"
# Set AI_SITE_ID, AI_DEVICE_ID, AI_ZONE_ID to the verified source bindings.
# Obtain a SEPARATE read-only SPFF PostgreSQL DSN from the operator/DB admin.
# Enter it silently in this shell rather than in command history or chat:
read -r -s -p "Read-only AI_SOURCE_DSN: " AI_SOURCE_DSN; echo
export AI_SOURCE_DSN
python -m app
```

Verify the DSN only has SELECT privileges on appropriate SPFF source tables.
Do not run Python staging without ensuring the source user has NO DML
permission on operational tables.

**Terminal B — limited Node preview API:**
```bash
cd ~/spff-ai-dashboard-test
SPFF_AI_STAGING=true node functions/lib/aiPreviewLocal.js
```

**Terminal C — Vite preview:**
```bash
cd ~/spff-ai-dashboard-test
VITE_SPFF_AI_PREVIEW=true npm run dev --workspace frontend -- \
  --host 127.0.0.1 --port 5174 --strictPort
```

**From laptop** (replace only the host):
```bash
ssh -N -L 5174:127.0.0.1:5174 orangepi@YOUR_ORANGE_PI_HOST
```

Browse `http://127.0.0.1:5174/#/ai-needs`. There is no login screen
for this single-page preview. It is **not** the production dashboard.
Until a real evaluation is saved, the page displays "no decision" or an
explicit unavailable state, never generated live sensor data.

## Local read-only evaluation (optional)

Once the Python preview service is running with the verified source-only DSN:
```bash
curl -fsS http://127.0.0.1:5011/health
curl -fsS http://127.0.0.1:5002/api/health
curl --max-time 30 -sS -X POST http://127.0.0.1:5011/source/evaluate \
  -o /tmp/spff-ai-staging-evaluation.json \
  -w 'evaluate HTTP %{http_code} in %{time_total}s\n'
curl --max-time 15 -sS http://127.0.0.1:5011/dashboard/summary \
  -o /tmp/spff-ai-staging-summary.json \
  -w 'summary HTTP %{http_code} in %{time_total}s\n'
```

The response files can contain real telemetry/program details and must not be
shared without review; delete/secure them when finished. If source/config is
unavailable, the AI must report HOLD/no-plan rather than invent data.
The current Python instance with no PostgreSQL planning profile cannot claim
validated hydraulic or fertilizer quantities. Preview is not an authorization
to dispense fertilizer or start a pump.

## What this does not verify

- Browser/E2E operation with actual credentials and source telemetry.
- Actual execution, physical flow, safety response, or pump feedback.
- Production deployment/health. Production AI already has separate
  advisory-lock and audit-history pressure to address in a reviewed change.
