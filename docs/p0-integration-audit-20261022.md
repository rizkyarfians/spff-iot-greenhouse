# P0 integration staging audit — 22 October 2026

## Scope
Isolated staging branch created from `fix/fertigation-responsive-layout` (PR #6), which already contains PR #4 server Soil EC pulse and PR #5 CH3 switch features. No merge to `main`, no production deployment, no hardware flashing, no change to AI/pulse enable defaults.

## Existing code reconciled
- The two commits merged by PR #2 into `main` added a persistent automatic-water fault latch and a strict fresh EC sample gate **after** fertilizer mixing, but these were absent from 1.4.30. Staging branch retains all PR #2 updates to 1.4.10, its test, and documentation, and ports both safety features into 1.4.30.
- The 1.4.30 controller now latches water faults due to invalid/stale moisture, inadequate flow (when enabled), or runtime exceeded. A latch blocks new automatic watering and is loaded from NVS at boot. A different acknowledged automatic config **revision** is required to clear it, with OFF/shutdown protection and NVS checks. Existing CH3 interlock ON/OFF switch remains unchanged.
- Fertilizer's mixing-to-next-pulse transition must use an EC sample with timestamp strictly after mixing start plus delay; reusing an older sample is blocked.
- The root `test` script now runs `test:firmware` across all firmware tests instead of the pulse-only script. The old alias `test:pulse-firmware` remains available.
- `firmware/test/fertigation-guards-1430.test.mjs` targets real extracted 1.4.30 water-controller logic and checks wiring to the new safety guards, with mocks to keep pumps unenergized.
- Controls UI's original pump selector in `main` is already present in the PR #6 descendant. UI changes from the integration chain are preserved.

## Status / constraints
GitHub code and blob paths verified after writes. No local full repository checkout can be fetched in this environment (GitHub DNS inaccessible from container), therefore `npm run build`, `npm run lint`, `npm test`, and the actual g++ firmware host regression cannot be claimed as executed. No CI check runs were visible on the previously inspected heads. Treat all staged changes as **untested** until verified in CI/local clone. Explicitly compile 1.4.30 with installed Arduino board support, then validate with pumps isolated before deployment.

## Outstanding P0/P1 work
1. Run workspace install/build/lint/test and ensure the new test harness compiles, correct errors before merge.
2. Check the 1.4.30 firmware's full relay ownership and shutdown path: a failed OFF readback must prevent any further ON, including after restart.
3. Merge `main` compatibility changes via normal review (do not overwrite PR #6 branch or bypass PR checks), confirm no hidden conflicts.
4. Ensure the independent session histories `fertigation_sessions` and `soil_ec_pulse_sessions` share a cross-strategy admission lock before allowing Rule-Based auto dispatch. **Keep both tables distinct.**
5. Preserve the user-requested CH3 switch and verify that other safety interlocks operate as designed, especially when its level check is disabled.
6. After software tests, verify migrations 020–027 and serial/MQTT/DB end-to-end with authentic ESP32 firmware before enabling pulse commands.
