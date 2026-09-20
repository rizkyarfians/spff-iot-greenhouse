BEGIN;

ALTER TABLE spff.telemetry_samples
  ADD COLUMN IF NOT EXISTS ac_voltage_v double precision,
  ADD COLUMN IF NOT EXISTS ac_current_a double precision,
  ADD COLUMN IF NOT EXISTS ac_power_w double precision,
  ADD COLUMN IF NOT EXISTS ac_energy_kwh double precision,
  ADD COLUMN IF NOT EXISTS ac_frequency_hz double precision,
  ADD COLUMN IF NOT EXISTS ac_power_factor double precision;

INSERT INTO spff.sensor_definitions (
  sensor_key,
  group_name,
  display_name,
  value_type,
  unit,
  sort_order,
  enabled
)
VALUES
  ('ac_voltage_v', 'Energi', 'Tegangan AC', 'float', 'V', 29, true),
  ('ac_current_a', 'Energi', 'Arus AC', 'float', 'A', 30, true),
  ('ac_power_w', 'Energi', 'Daya Aktif', 'float', 'W', 31, true),
  ('ac_energy_kwh', 'Energi', 'Energi Terpakai', 'float', 'kWh', 32, true),
  ('ac_frequency_hz', 'Energi', 'Frekuensi', 'float', 'Hz', 33, true),
  ('ac_power_factor', 'Energi', 'Faktor Daya', 'float', 'PF', 34, true)
ON CONFLICT (sensor_key) DO UPDATE SET
  group_name = EXCLUDED.group_name,
  display_name = EXCLUDED.display_name,
  value_type = EXCLUDED.value_type,
  unit = EXCLUDED.unit,
  sort_order = EXCLUDED.sort_order,
  enabled = EXCLUDED.enabled;

COMMENT ON COLUMN spff.telemetry_samples.ac_voltage_v IS
  'Tegangan AC RMS yang dilaporkan perangkat dalam volt.';
COMMENT ON COLUMN spff.telemetry_samples.ac_current_a IS
  'Arus AC RMS yang dilaporkan perangkat dalam ampere.';
COMMENT ON COLUMN spff.telemetry_samples.ac_power_w IS
  'Daya aktif AC yang dilaporkan perangkat dalam watt.';
COMMENT ON COLUMN spff.telemetry_samples.ac_energy_kwh IS
  'Akumulasi energi AC yang dilaporkan perangkat dalam kilowatt-hour.';
COMMENT ON COLUMN spff.telemetry_samples.ac_frequency_hz IS
  'Frekuensi jaringan AC yang dilaporkan perangkat dalam hertz.';
COMMENT ON COLUMN spff.telemetry_samples.ac_power_factor IS
  'Faktor daya AC tanpa satuan yang dilaporkan perangkat.';

COMMIT;
