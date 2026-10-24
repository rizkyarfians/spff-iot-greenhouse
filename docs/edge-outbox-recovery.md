# Edge outbox recovery

The gateway scans only regular `.json` files directly inside `EDGE_OUTBOX_DIR`.
The default path is `./data/edge-outbox`, resolved from the service working
directory (normally `/opt/spff/edge-gateway`).

Malformed JSON (including empty/truncated files) is moved, without rewriting its
contents, into `quarantine/<original-name>.<uuid>.bad` inside the outbox directory.
A warning includes the source path, destination, parse error and pending-file
count. Healthy queued messages continue. Quarantined messages are NOT marked as
delivered, do not count toward the active queue limit, and are not replayed on
restart. Preserve them for investigation; do not automatically requeue control
acknowledgements or invent replacement telemetry.

Both flush and persistence-ACK scans use the same recovery path. Telemetry and
session records still require their matching persistence ACK before deletion.
Read failures other than ENOENT, failed quarantine moves and broker failures
still pause processing. ENOENT is tolerated for files removed by a concurrent
ACK/scan. This patch handles JSON syntax errors, not every possible semantically
invalid record or application payload.

This is recovery from malformed files, NOT a repair of SSD faults or proof of
power-loss-safe writes. The existing temporary-file/rename enqueue path is
unchanged. File/directory fsync, broader storage-health reporting and queue-size
monitoring remain separate work. A missing or unreliable mount must still be
investigated before further deployment.

## Validation

`npm run test --workspace @spff/edge-gateway` covers retention until ACK,
failed publish/restart, empty/truncated files, ACK-scan recovery, real read errors,
failed quarantine, files removed during flush, and concurrent flush/ACK recovery.
The Windows run requires permission for temporary-file renames. No physical SSD,
MQTT broker, production database or ESP32 is exercised by these tests.

## Orange deployment

No firmware flash, migration or AI/pulse setting change is needed. Confirm the
SSD is mounted and stable and pumps are safely OFF/manual before deployment.
Stopping the gateway does not itself stop a relay. Build while the old service
is running; restart only after the build succeeds. Preserve the existing outbox
and quarantine directories. After restart check serial connection, MQTT and a
fresh `Telemetry persisted` entry with `edgeOutboxRemoved: true`.
