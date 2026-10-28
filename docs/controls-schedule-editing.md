# Editing schedules and applying sensor rules

Each schedule has an Edit action. The existing inline form opens with its current
times, recurrence and one-off date. Editing preserves the schedule ID, pump,
enabled state and execution history. The pump cannot be changed on an existing
schedule. Cancel leaves the server unchanged.

Admin/CSRF-protected `PUT /api/schedules/:id` accepts `onTime`, `offTime`,
`repeatRule`, `runDate` and `expectedUpdatedAt` from the fetched schedule. It
validates same-day times and recurrence dates, scopes updates to the configured
site, and rejects a stale version with 409. The existing database trigger bumps
the device schedule revision for the worker's normal MQTT sync. Saving is not a
claim that the device has applied the schedule. No new migration is required.

Sensor settings now show two pump cards, a large labelled enable switch, and a
plain-language preview of start/stop conditions. Limits and protections remain
editable. The Apply action saves both pump profiles together; the operating mode
is preserved. Local changes are explicitly marked, can be cancelled, and are not
erased by background refreshes. Status distinguishes draft, awaiting device
confirmation and a matching applied revision. The backend/firmware retain their
existing validation and pump protections. Liquid-EC control is labelled separately
from the soil-EC AI program. No calibrated or agronomic values are invented.

Validation covers schedule identity/history preservation, disabled schedules,
revision changes, one-off/recurring edits, site boundaries, stale writes, invalid
input, local draft preservation and existing mode-ACK behavior.
