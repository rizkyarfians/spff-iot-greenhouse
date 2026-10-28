# Pump feedback in the notification bell

The bell listens to `alarm.updated`, refreshes active alarms on reconnect, and
polls every 15 seconds as a fallback. Alarm pagination is followed so resolved
history cannot hide active incidents. The 22px red badge counts unread entries,
hides at zero, and displays `99+` above 99. A repeated observation retains its
read identity; a new command/session/reason becomes unread.

Existing command failures show the pump, reason and device. AI calibration,
equipment/sensor blocks and pulse faults create durable incidents using the
existing `command_failed` rule. Repeated coordinator ticks deduplicate the same
failure. Normal waiting, cooldown and schedule priority are not start failures.
Notification storage errors cannot roll back a STOP or validated session.

For `1.4.34-INDEPENDENT-AI`, active local schedules are checked after a 30-second
grace. Fresh device status and applied Automatic mode are required. A missing
ON event is described as **unconfirmed**, not proof of a broken pump. The alert
recovers on a confirmed scheduled ON; otherwise it remains available for review.
Older firmware with permission-window schedules is excluded from this check.

No firmware change or additional migration is needed for this update. It uses
the existing alarm engine/permissions and migration 032 from the previous update.
Rebuild API, web and MQTT worker, restart API/worker, then hard-refresh the web UI.

Acknowledged/resolved command-failure alarms suppress the historical failure
caption on the pump card only when site, device, pump and command ID match.
Command outcomes and reported relay state remain unchanged. A new failed
command or a reopened alarm remains visible. The bell lists open alarms;
acknowledged alarms remain in Alarm history. Marking read only clears unread
state and is separate from acknowledging an incident. Alarm SSE updates refresh
both the alarm list and pump cards.
