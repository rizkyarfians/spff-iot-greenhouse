# Measured EC and tank progress

A brand-green floating sparkle button at the bottom right opens the read-only
progress panel on any page. Program Fertigasi shares the same report. The
notification bell contains alarms and sensor faults only. It refreshes every 10 seconds. Normal target sufficiency is a status,
not a failed-pump alarm and does not add to the unread bell count.

- Soil EC: the selected automatic program supplies the approved crop/HST target
  for today. 500 / 1200 µS/cm fills 41.67% of the bar, with a 700 µS/cm gap.
- Soil values use the controller's stable-sample average when available; the
  tolerance and low/high thresholds explain why a pump may wait below target.
- Liquid EC uses its separate target from device fertilizer configuration.
  It never inherits the soil EC target. Disabled legacy control is stated.
- Water/fertilizer levels fill a 0–100% capacity bar, with the program's minimum
  operational level marked. Capacity percentage is not a measured litre value.
- Invalid, missing, out-of-range, future or stale readings remain unavailable;
  no zero or full bar is fabricated. An absent target is explicitly unset.
- Pulse duration budget is labelled commanded time, not actual volume delivered.

GET `/api/fertigation/progress?deviceId=...&recipeId=...` is authenticated and
read-only. Omit recipeId to use the saved automatic program, or one unambiguous
approved crop/HST rule as a reference if no automatic program is saved. The
response uses the same sample decision and readiness checks as execution.
Viewing it creates no sessions, commands, alarms or MQTT messages.

A stable EC baseline already sufficient before any dosing does not request
fertilizer and is not classified as overshoot. High EC remains blocked; actual
post-pulse overshoot remains a fault. Tank gates are checked before new ON
commands; a sufficient EC target does not create a pump failure merely because
a tank is low. This does not bypass local interlocks or change timer schedules.

No additional migration or firmware update is required beyond the existing
independent-AI deployment. Rebuild contracts, API, frontend and worker; restart
API/worker. Tests cover measured ratios, missing targets/health, concentration
versus volume, distinct liquid targets, target sufficiency/tolerance, high EC,
tank gates, stale telemetry and absence of commands from report reads.

The floating panel is non-modal: Close/Escape returns focus to the trigger,
clicking outside dismisses without stealing focus, and narrow screens retain
scrollable access to all metrics. The inline dashboard block is replaced by
this launcher. Loading failures show the API message and a manual retry;
missing schema, missing permissions and invalid stored rules are distinguished
without exposing SQL details to the browser. Deployment logs are still needed
to diagnose an unknown production failure.
