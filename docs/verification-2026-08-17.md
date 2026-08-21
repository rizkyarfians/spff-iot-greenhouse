# SPFF Verification Report — 2026-08-17

## Verified in source/sandbox

- `@spff/contracts`: build + lint + 4 tests passed.
- Local API (`functions`): build + ESLint + 2 reverse-proxy authentication tests passed.
- Frontend: TypeScript project build/typecheck passed.
- Edge Gateway: build + lint + durable outbox test passed.
- MQTT Worker: build + lint + 2 ingestion/state tests passed.
- Sync Worker: build + lint passed.
- Root `npm test`: passed.
- `scripts/configure-local-mqtt.mjs` and `scripts/check-postgres.mjs`: Node syntax check passed.
- Backup and health-check shell scripts: `bash -n` passed.
- Nginx production server config: syntax test passed using a temporary top-level Nginx config.
- `npm ci --dry-run --ignore-scripts --offline`: package manifest/lockfile consistency check passed.

## Root build/lint caveat

`npm run build` and `npm run lint` were executed as required. In this Linux sandbox they stop in the frontend native tooling because the uploaded ZIP contains Windows `node_modules`:

- Vite/lightningcss: missing `lightningcss.linux-x64-gnu.node`.
- oxlint: missing `@oxlint/binding-linux-x64-gnu`.

This does not prove a successful production bundle yet. On Windows or Orange Pi, remove/copy no `node_modules` and run a fresh `npm ci` for the target OS/architecture, then rerun `npm run build && npm run lint && npm test`.

## Not verified here

- PostgreSQL migrations `002`/`003` and least-privilege grants against the user's real Windows PostgreSQL.
- Real Mosquitto ACL/restart/reconnect behavior.
- Real Firebase credentials/sync.
- Real ESP32-S3 serial framing, USB reconnect, command ACK, selector/interlock/failsafe, and server receipt rule for firmware backlog.
- Backup restore drill on target PostgreSQL.
- Orange Pi NVMe/UPS/power-loss behavior.
- Pino/pino-http migration; dependency fetch timed out in the sandbox, so the lockfile was intentionally left consistent instead of adding a half-installed dependency.

The correct status is **production-ready local code path, hardware/database target not commissioned** until the real-environment checks above pass.
