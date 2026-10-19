# SPFF Master 1.4.16 — Session protocol staging (not a production firmware)

Source basis: uploaded `SPFF_MASTER_1.4.15_SOIL_9600_DIAG.ino` (fixed soil baud 9600). The generated .ino file and 1.4.15→1.4.16 patch are provided as conversation attachments, **not copied into this GitHub branch**. Do not flash firmware by name or copy code from older 1.3.x repository firmware.

## Implemented in the staged local firmware artifact
- ESP32 persists up to **four device-origin** `fertigation_session_event` frames in Preferences NVS under `ses_obx` before sending them over Serial JSON Lines.
- Sends one oldest pending frame at a time; retransmits every four seconds while it remains unacknowledged, including after reboot. Queue entries stay until an exact matching `fertigation_session_persisted_ack` containing site/device/session/message/sequence is received from the gateway.
- NVS state is checksum-validated and rewritten before acknowledging completion of an outbox removal. Corrupt state or full storage fails closed for session queueing.
- No change to pump relay writes, schedule, sensor loop, control strategy, or interlocks; old sensor-based firmware continues to own the relays.

## What is explicitly NOT implemented
- **No producer for session events yet.** A real Rule-Based session requires an approved `recipeId`, device-issued `sessionId`, target volume, actual calibrated flow-counter evidence, immutable sequence, and a verified safe strategy switch. Legacy pump operation must not be misreported as a completed Rule-Based session.
- No Rule-Based pump ON/OFF commands, no firmware strategy switch, no flash/OTA/deployment, and no claimed live database session ingestion.
- No Arduino firmware build or hardware tests were performed in this environment.

## End-to-end contract
`ESP32 Serial JSONL -> Edge durable outbox -> MQTT spff/v1/{siteId}/{deviceId}/sessions (QoS 1, non-retained) -> MQTT Worker -> PostgreSQL transaction -> /ack fertigation_session_persisted_ack -> Edge -> ESP32 -> NVS dequeue`.

The persistence ACK is **not** confirmation the relay changed, nor proof volumes are calibrated. Only device-origin states, flow-counter readings, and actual pump-off readback justify status `completed`.

## Hardware acceptance criteria before integration
1. Build actual 1.4.16 firmware using the correct ESP32 Arduino Core and all existing peripheral libraries; verify binary size and NVS capacity.
2. Boot with both pumps physically isolated/OFF. Confirm status/telemetry/command behavior unchanged.
3. Use a dedicated test session producer (never synthetic `completed` in production) to queue one event; disconnect gateway; restore connection; confirm exact event replay and SQL commit.
4. Simulate lost worker ACK: event persists and replays; a duplicate must neither change the session state nor create another database row.
5. Reboot ESP32 with pending events; verify replay resumes and matching ACK deletes only the oldest correct entry; mismatched ACK must not delete.
6. Verify no unauthorised mode transition activates Rule-Based outputs, including offline and power interruption.
7. Integrate the real Rule-Based session owner only after command arbitration, flow calibration, safety interlocks, reservation/idempotency, and device-origin completion tests are finished.

## Follow-up
Add firmware-origin session producer only after Model 1 becomes an explicitly selectable **mutually exclusive** automatic control strategy, with ESP32 the final safety authority. Never send `recipeId` from a simulated evaluation as evidence that the device actually ran it.
