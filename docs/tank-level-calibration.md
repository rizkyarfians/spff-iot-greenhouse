# Tank level calibration

The MQTT worker derives level percentages on ingestion for site `greenhouse-01`,
device `esp32-s3-01`. Calibration assumes the sensor face is 180 cm above the
water tank bottom and 90 cm above the fertilizer tank bottom. Confirm these
distances at installation; nominal tank height alone may exclude a sensor offset.
Constants are in `mqtt-worker/src/tankLevels.ts`.

Level = (height - measured distance) / height * 100, rounded to one decimal.
This is height percentage, not a calibrated volume or litre measurement.
Explicitly invalid, missing, nonfinite, negative or over-height distances produce
no level value and an invalid per-parameter health entry, not a fabricated zero.
Other sensors remain independent of the global `sensorValid` flag.

Derived columns and health are stored in existing telemetry columns. The original
raw payload remains unchanged. Existing dashboard/history consumers use these
columns. Historical rows are not backfilled. A latest-known-value display may
retain a prior valid reading when the current distance is unavailable.

No migration or firmware update is needed for display/history if the firmware
already sends valid `tank_water_distance_cm` and `tank_fert_distance_cm`.
This does not enable firmware tank safety interlocks or change pump control.
Deploy by rebuilding and restarting the MQTT worker after pulling the changes.
