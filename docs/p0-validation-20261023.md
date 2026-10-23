# P0 integration validation — 23 October 2026

Candidate only; NOT approved for production merge, flash or enabling pulses.

## Candidate

- Foundation: `d4884c3` (includes current dashboard layout changes).
- Integration: `1d4986f`.
- Combined on `codex/validate-p0-integration-20261023`, without merge conflicts.
- No changes to production environment files, PostgreSQL, running services or ESP32.

## Checks executed locally

- `npm run build`: PASS, all six workspace builds.
- `npm run lint`: exit 0. Existing frontend effect-cleanup warning in
  `SoilEcPulsePanel.tsx:49` remains; do not interpret this as warning-free.
- `npm test` with pulse/evaluation environment switches false: all software
  suites before firmware passed after retrying outside the restricted filesystem
  sandbox. Initial edge outbox failures were temporary-file rename EPERM; the
  retry passed all three outbox tests without changing source.
- Backend: 61 passed, 3 real-PostgreSQL tests skipped. No disposable database
  was configured; DB concurrency/migration behavior is NOT verified.
- Firmware host suite: 2 source-wiring checks passed; 5 executable tests failed
  to launch because `g++` is unavailable (`spawnSync g++ ENOENT`). They are NOT
  successful firmware regressions. Arduino CLI/full ESP32 build also unavailable.
- Hardware, shutdown readback and real serial/MQTT integration not tested.

## Blocking source-level finding: fault-reset durability

Both 1.4.30 and the carried 1.4.10 sync handlers persist
`water_fault=false` BEFORE calling `spffPersistAutomaticControl(candidate)`.
If power is lost between those writes, the old configuration can remain on
disk while the water-fault latch is already cleared. If configuration persistence
returns failure, the attempted rollback `putBool("water_fault", true)` is not
checked either. This undermines the intended new-configuration reset requirement
after reboot. This is a source-ordering finding, not a reproduced hardware fault.

Before production merge, make reset persistence fail closed across reboot and
partial writes (for example, a durable pending-reset/revision protocol), and add
tests for power interruption and failure of each persistence operation. Existing
tests exercise controller faults and source wiring, not this reset transaction.

## Remaining gates

1. Fix and validate the durable reset protocol on both firmware versions.
2. Run all seven firmware host tests with g++, then compile the complete 1.4.30
   sketch with its board/libraries. Run DB tests against a disposable database.
3. Retain the prior audit's relay-ownership, cross-strategy admission-lock,
   configurable CH3 and isolated-hardware checks.
4. The staging preflight script still intentionally pins integration ancestor
   `bd07d327a6fae62b65623b018151427a72db6d38`, NOT this combined candidate. Do not
   claim that running it validates this candidate or later fixes.
5. Keep production pulses OFF; foundation remains unchanged until gates pass.
