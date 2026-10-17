# Datalog CSV export

The table remains paginated via `GET /api/datalog`. CSV export uses the separate,
session-authenticated `GET /api/datalog/export` endpoint. Deploy the frontend,
backend, and contracts together; no schema migration or firmware change is needed.

## Filters and output

- Required `from` and `to`: ISO timestamps; inclusive boundaries, maximum 31 days.
- `kind`: `sensor` or `actuator`; `parameter`: `all` or a selected parameter.
- The UI uses Asia/Jakarta time. Empty start/end times mean 00:00:00 through
  23:59:59.999. A download keeps the filter values captured when clicked.
- All matching records are exported, independently of the displayed table page.
- Null sensor values are omitted as before; zero and invalid-but-recorded readings
  are preserved, along with their per-parameter health status.

## Data path

One read-only, repeatable-read PostgreSQL transaction declares a forward cursor.
The server fetches 250 telemetry samples per batch and expands the selected sensor
columns into readings. It does not repeatedly count results, use OFFSET, join every
sample against every sensor in SQL, or convert entire rows/raw payloads to JSON.
Actuator events use the same cursor approach. A consistent snapshot excludes data
committed after the snapshot was established, including late/backfilled telemetry.

The response is newline-delimited JSON, with `start`, `batch` (`items`), and
`complete` (`rowCount`) frames. Failures after headers produce an `error` frame,
not a successful completion. Backend backpressure prevents unlimited buffering.
`Cache-Control: private, no-store, no-transform` and `X-Accel-Buffering: no` allow
incremental delivery through the existing Nginx proxy.

The browser formats CSV chunks as batches arrive and displays the received row
count. It reuses the Jakarta date formatter and yields between batches so Cancel
remains usable. A Blob download is triggered only after a complete response with
a matching row count. It retains CSV chunks, not the whole JSON dataset. This
cross-browser path has a 64 MiB CSV limit; choose a shorter range above that limit.
It works on local HTTP as well as HTTPS and does not require File System Access API.
Keep the tab open until download starts; resuming interrupted exports is not supported.

Cancellation or leaving the page aborts the request. The server closes the cursor's
connection on disconnect, rolling back the read-only transaction. Each API process
allows two simultaneous exports, with a five-minute overall deadline, 20-second
SQL statement timeout, and 30-second idle-transaction timeout. These limits protect
monitoring/control workloads; no stored telemetry or actuator state is changed.

## Verification

Run `npm run build:contracts`, then `npm test`. Frontend tests cover split UTF-8/JSON
chunks, truncation, cancellation, row counts, CSV escaping, and timezone formatting.
Backend tests cover filtering, projected SQL, cursor cleanup, and response framing.

The optional `functions/test/datalogExport.integration.test.mjs` uses an **empty,
disposable** PostgreSQL database supplied via `SPFF_EXPORT_TEST_DATABASE_URL`.
It refuses any host except `127.0.0.1`, any database except `spff_export_test`, and
any login except `spff_export_test`. Do not point it at the real application DB.
It creates fixtures and compares output against the old query, checks timestamp
ties/boundaries, concurrent ingestion, parameter selection, and cancellation.
Provision a fresh test database before rerunning it.

On Orange Pi, inspect requests after deployment:

```bash
sudo journalctl -u spff-api --since "10 minutes ago" --no-pager -o cat | grep -F 'GET /api/datalog/export?'
```

An export should be one streaming request rather than many `pageSize=1000` calls.
The HTTP log duration covers the whole stream, not one database batch. HTTP 200
alone cannot prove completion after streaming starts: the client checks the final
`complete` frame. Actual production speed must be measured on Orange Pi.
