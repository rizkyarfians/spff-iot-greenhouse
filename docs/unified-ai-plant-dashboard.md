# Unified AI — Halaman Kebutuhan Tanaman (development only)

Branch: `feature/unified-ai-plant-dashboard-20261101`, based on Phase 4A.
No server files were deployed, no Orange Pi production service restarted,
no firmware flashed, no migration applied, and no MQTT/pump command dispatched.

## User experience

After installing BOTH services and the frontend together in a reviewed
maintenance window, authenticated users can navigate to
`#/ai-needs` (“AI & Kebutuhan Tanaman”). It displays:

- Device-site SHADOW decision time (WIB), stale/error/empty status and HOLD reasons;
- A selectable, saved SPFF crop program, HST, plant count, per-activity schedule,
  product quantity and reference water;
- Rule/Fuzzy/plan outputs **only if the engine has produced a plan** (otherwise —);
- Per-product target and specifically bound credited dose/remaining when the
  AI ledger has proof. Manual completions are explicitly NOT measured volume;
- Last sampled soil/tank values, reported relay outputs/boot match, and
  execution lockdown. No UI controls can send a command.

The system does not infer growth stage, NPK uptake or physical relay contacts.
A planned fertilizer amount is not a delivered dose. Manual completion and
unbound historical sessions do not imply actual volume. The report is
source-read-only; it does not write to SPFF operational tables.

## Data flow

```text
Browser (existing cookie auth) → GET /api/unified-ai/dashboard
  → Node API (fixed 127.0.0.1:5010, 2.5 s timeout)
  → Python GET /dashboard/summary
  → Stored non-synthetic SHADOW decision + snapshot from AI-owned store
  → Whitelisted, bounded summary (contracts/Zod validated by Node)
```

Python remains bound to loopback. Avoid exposing its administrative endpoints
over the LAN or internet. Do not add permissive cross-origin access.

The Python service's source polling must already be configured and running
against read-only SPFF data; otherwise the page shows an explicit unavailable
or no-decision state. The current 1.5.03 firmware still cannot be used for
standalone volume-only AI dispatch; `can_dispatch=false` always.

## Verification procedure (isolated checkout ONLY)

On a clean detached testing checkout with the latest branch:

```bash
cd /tmp/spff-ai-phase2-test
git status --short
git fetch origin feature/unified-ai-plant-dashboard-20261101
git checkout --detach FETCH_HEAD
cd standalone-ai
pg_virtualenv -v 14 bash <<'BASH'
export AI_TEST_DATABASE_DSN="dbname=postgres"
python -m unittest discover -s tests -v
BASH
cd ..
npm run build
npm run lint
git status --short
```

Expected: all tests pass with no skips, npm build and lint exit 0.
The pre-existing frontend SoilEcPulsePanel hook warning may still appear.
This branch has NOT yet been executed against a live browser/backend stack
or deployed to `/opt/spff` or `/opt/spff-ai`.

## Operational acceptance (requires explicit deployment permission)

On a staged environment with a known SHADOW source-poll configuration, check:
- API `/api/unified-ai/dashboard` requires an authenticated SPFF session;
- AI unavailable → error state; no program → empty state;
- old decision >30 s → STALE and pump state UNKNOWN;
- independently old adaptive feedback >25 s → reported output state UNKNOWN even if decision is fresh;
- fresh matching-boot IDLE known OFF → reported state, not physical proof;
- program with manual completion → no automatic "dose delivered" label;
- both desktop and mobile navigation/cards reflow without horizontal overflow.

Do not enable command dispatch for this feature. Physical commissioning and
measured safe shutdown remain separate future gates.
