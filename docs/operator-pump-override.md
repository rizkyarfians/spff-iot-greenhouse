# Operator ON/OFF while remaining in automatic mode

The dashboard and Controls page send an explicit `operatorOverride: true` on
operator pump requests while automatic mode is selected. This uses `set_pump`,
not a fabricated schedule identity, HST approval, Fuzzy decision or changed mode.

For ON, the server verifies a recent online heartbeat, confirmed automatic configuration,
both readback fields and `operatorOverrideCapable: true`. Relay owners such as
pulse/adaptive sessions must settle first. Older firmware is rejected with a
specific message; removing a frontend disabled attribute does not enable it.

Override holds the device's automation. Unpublished HST/Fuzzy ONs are cancelled;
published commands must settle before taking control. Existing dose history is
retained and the estimator continues accounting. HST, Fuzzy and timer schedule
dispatch/sync are held, including their ordinary OFF commands. Operator OFF and
firmware interlocks remain available. The firmware retains its hold across reboot,
but never restores an ON output. Override runtime is limited by the water pump's
configured maximum, capped at 900 seconds; another explicit ON may start a new
cycle after verified OFF. Timer expiry does not automatically resume automation.
Operator OFF does not require the new capability or healthy sensor values and can
preempt an outstanding ON. Firmware storage failure must not prevent an OFF.

## Return control to automation

Turn both pumps OFF and choose **Lanjutkan otomatis**. The server requires a new
OFF heartbeat after the previous ON command has expired and no live commands.
It increments the existing configuration revision with the same desired mode.
The worker sends `releaseOperatorOverride: true`; firmware stops outputs, clears
its persisted hold and acknowledges that new revision. Automatic ON remains
blocked until that configuration ACK. Regular settings saves carry
`releaseOperatorOverride: false` while held, so they do not silently resume it.
Explicitly switching to Manual releases the automatic override through the same
configuration acknowledgement channel and restores ordinary manual controls.

## Orange Pi

Stop both pumps and wait for a fresh OFF readback, then:

```bash
cd /home/orangepi/spff-hst-mode-preview &&
git fetch origin &&
git merge --ff-only origin/feature/hst-shadow-real-test-switch-20261104 &&
sudo bash scripts/deploy-orange-operator-override.sh
```

This backs up the database, applies additive migration 047, rebuilds and repairs
the API/worker, then publishes the frontend. Existing server dispatch flags and
plant delivery history are preserved. Normal enabled automation can resume when
services restart; this installer does not itself enqueue pump commands.

## Firmware 1.5.12 TIMED-FERT-EC

The provided patcher accepts the reviewed `SPFF_TIMED_FERT_EC_1_5_12.zip` and
creates a separate ZIP. Exact source anchors are checked before output; every
other member, including the original project headers, is copied byte for byte.

```powershell
python scripts/patch-operator-override-firmware.py `
  C:/Users/rizky/Downloads/SPFF_TIMED_FERT_EC_1_5_12.zip `
  SPFF_1_5_12_OPERATOR_OVERRIDE.zip
```

Compile the generated sketch with the original board/library settings and flash
it. The reported firmware becomes `1.5.12-OPERATOR-OVERRIDE`. The source patch
was checked against the supplied archive, but has not been compiled with Arduino
or tested on physical hardware in this environment. It retains existing CH3,
relay readback, shutdown-latch, maintenance and session-owner checks.

Verify `operatorOverrideCapable`, `operatorOverrideActive`, both actual pump
states and command ACKs during the first hardware test. A click or database queue
is not evidence that a relay physically changed.
