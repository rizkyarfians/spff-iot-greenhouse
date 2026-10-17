# Tank level calibration

The MQTT worker derives level percentages on ingestion for site `greenhouse-01`,
device `esp32-s3-01`. Water tank height is 180 cm and fertilizer tank height is
90 cm. The firmware's legacy `tank_*_distance_cm` fields contain liquid height
from the tank bottom, NOT sensor-to-surface distance. Field names are retained
for wire compatibility.
Constants are in `mqtt-worker/src/tankLevels.ts`.

Level = liquid height / tank height * 100, rounded to one decimal.
For example, water height 0.8 cm gives 0.4%, and fertilizer height 69.9 cm gives
77.7%. Zero means empty; tank height means full.
This is height percentage, not a calibrated volume or litre measurement.
Explicitly invalid, missing, nonfinite, negative or over-height readings produce
no level value and an invalid per-parameter health entry, not a fabricated zero.
Other sensors remain independent of the global `sensorValid` flag.

Derived columns and health are stored in existing telemetry columns. The original
raw payload remains unchanged. Existing dashboard/history consumers use these
columns. Historical rows are not backfilled. A latest-known-value display may
retain a prior valid reading when the current height is unavailable. Historical
percentages previously computed with the inverted formula are not corrected by
this change; only new telemetry uses the corrected formula.

No migration or firmware update is needed for display/history if the firmware
already sends valid `tank_water_distance_cm` and `tank_fert_distance_cm`.
This does not enable firmware tank safety interlocks or change pump control.
Deploy by rebuilding and restarting the MQTT worker after pulling the changes.
