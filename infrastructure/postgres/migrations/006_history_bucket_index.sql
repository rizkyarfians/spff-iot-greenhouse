BEGIN;

CREATE INDEX IF NOT EXISTS telemetry_site_recorded_idx
  ON spff.telemetry_samples (site_id, recorded_at DESC);

COMMENT ON INDEX spff.telemetry_site_recorded_idx IS
  'Supports bounded time-range and bucket aggregation queries for dashboard charts.';

COMMIT;
