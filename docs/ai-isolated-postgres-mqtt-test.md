# Stage 3 — Isolated local PostgreSQL + Mosquitto transport test

This test uses the **real** `PostgresIngestionRepository`, `CommandDispatchService`, `MqttWorker` (publish/subscribe), `IngestionService`, PostgreSQL schema and Mosquitto QoS1. The device side is an **ESP32 simulator**, not a firmware/hardware test. No physical relay or pump is connected.

Hard separation:
- Broker: standalone temporary Mosquitto listener **only** on `127.0.0.1:18884`; refuse to run if the port is occupied. Does not touch 1883 or the running broker's config.
- DB: `pg_virtualenv -v 14` ephemeral PostgreSQL, migrations 001–037 applied in test cluster only; abort if `data_directory` is not under /tmp or /var/tmp. `DATABASE_URL` is deliberately an unreachable dummy; the real test connects only via pg_virtualenv's PGHOST/PGPORT.
- MQTT topics use `ai-isolated-software-test/esp32-s3-test-isolated`, no real site or device ID.
- The script cleans up the temporary broker, config, and database after completion or failure.
- Live Python AI `127.0.0.1:5011/dashboard/summary` is fetched **GET read-only**, and its current SHADOW Fuzzy preview is capped to 5 L with 30-second safety timeout. If the source is stale or invalid, the test fails closed.
- The SQL command is a synthetic, manual trial-shaped row in a **test DB only**. It is not a permission grant and **never** exists in the SPFF production DB.
- A simulator receives the command on real isolated MQTT QoS1 and publishes accepted, invalid-completed-ON, completed-OFF, and duplicate-completed messages.
- Assertions check DB command transitions, ON completion blocked, OFF completion recorded, ACK QoS1 idempotency, and latest reported OFF state. `completed` means *simulated hardware ACK*, not physical pump success.

Run from the new worktree on Orange Pi (no production service changes):

```bash
npm run build
npm run lint
bash scripts/test-ai-volume-isolated-transport.sh
```

Do not run `npm run mqtt:up`, `npm run mqtt:down`, `npm run mqtt-worker`, or any deploy command while running the test. No `AI_MODE=ACTIVE`, dispatch flags, database migrations against production, or real ESP32 firmware changes.

Remaining: authentication/approval service, true firmware volume-session command compatibility, measured water calibration and safety interlock, and supervised physical bench test before any production dispatch.
