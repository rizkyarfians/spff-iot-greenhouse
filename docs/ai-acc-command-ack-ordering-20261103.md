# Investigation: command ACK ordering / MCU clock skew (2026-11-03)

Staging only, built on Stage 7/8 firmware 1.5.07 alignment. No deployment.

## PostgreSQL live evidence supplied by operator

- `web-d167c52a-4b62-4dc0-9b0b-4a995b7524c6`:
  command issued at 16:33:21.429644 WIB, ACK completed (OFF) id 1830,
  ACK accepted id 1831, both MCU timestamps 16:33:18 WIB, later marked
  `timed_out` at 16:33:51 WIB. `completed_at` was 16:33:18 WIB.
- `web-593f55d1-8016-4b41-9bd1-bb5f1b1407a8`:
  command issued at 16:25:15.190285 WIB, ACK completed (ON) id 1828,
  ACK accepted id 1829, both MCU timestamps 16:25:16 WIB, later marked
  `timed_out` at 16:25:46 WIB.

`ack_event_id` proves insertion order, NOT necessarily physical emission or
transaction commit order. The live Worker binary was not inspected; the old
Worker allowing completed -> accepted is a hypothesis, not yet proven.

## Staging hardening

- `saveAcknowledgement` updates only commands still in
  `pending`, `published`, `accepted`. Terminal states are immutable,
  including QoS1 duplicate terminal ACKs. Late ACK events stay in the audit
  table but do not reopen the command or insert an actuator state.
- `completed_at` uses `GREATEST(now(), issued_at)` on a real terminal
  transition, not the ESP32 clock. The original MCU `acknowledgedAt` remains
  in `command_ack_events`, without rewriting the evidence.
- Existing `expireCommands` expires pending/published after delivery expiry
  and accepted regular commands after expiry. It cannot mutate a completed
  command. AI waterTrial accepted deadline remains duration + 60s.
- Existing water-trial completion still requires ESP32 to report OFF.

## Validation scope

New regression tests cover generated SQL and mock DB response behavior,
not a real SQL transition race. Before deployment:
1. `npm run build && npm run lint`; run targeted tests
   `mqtt-worker/test/commandAckLifecycle.test.ts`.
2. Execute transactional SQL lifecycle tests in disposable PostgreSQL with
   matching migrations, including concurrent/late ACKs.
3. Inspect the deployed Worker service version and reconcile MCU time skew,
   serial/MQTT queue order, and ACK event reception timestamps.
4. Confirm STOP and physical safety with motor power isolated.

No flag changes and no operational DB writes are part of this patch.


## PostgreSQL 14 isolated-test finding and fix (2026-11-03)

First `pg_virtualenv` execution failed with PostgreSQL SQLSTATE `42P18`:
`could not determine data type of parameter $3`. The prior patch changed
`completed_at` to `GREATEST(now(), issued_at)` but still supplied the
obsolete `acknowledgedAt` as bind `$3` for the command UPDATE.

Corrected the UPDATE bind indexes to contiguous `$1..$7` and removed
the unused acknowledgement timestamp from that UPDATE's parameter list.
The timestamp remains preserved in the ACK event INSERT. Added regression
assertions for contiguous bind indexes, and a repeatable real-Postgres
test runner using minimal disposable schema:

```bash
cd ~/spff-ai-ack-review
# After updating to the latest staging commit and rebuilding:
pg_virtualenv bash mqtt-worker/test/runAckPostgresIntegration.sh
```

The test runner verifies a pg_virtualenv marker and port, refuses the
operational `spff` database, and exercises the real repository SQL for:
terminal completed, late accepted, expiry, duplicate completed and
actuator/audit event counts. It is not a full migration-schema nor
concurrency test. It has not been run against real PostgreSQL after
the new bind-index fix yet.
