BEGIN;

INSERT INTO spff.sensor_definitions
  (sensor_key, group_name, display_name, value_type, unit, sort_order, enabled)
VALUES
  ('soil_1_moisture', 'Soil Sensor 1', 'Kelembapan Tanah 1', 'float', '%', 1, true),
  ('soil_1_temp', 'Soil Sensor 1', 'Suhu Tanah 1', 'float', '°C', 2, true),
  ('soil_1_ec_us_cm', 'Soil Sensor 1', 'EC Tanah 1', 'float', 'µS/cm', 3, true),
  ('soil_1_ph', 'Soil Sensor 1', 'pH Tanah 1', 'float', 'pH', 4, true),
  ('soil_1_n', 'Soil Sensor 1', 'Nitrogen Tanah 1', 'integer', 'mg/kg', 5, true),
  ('soil_1_p', 'Soil Sensor 1', 'Fosfor Tanah 1', 'integer', 'mg/kg', 6, true),
  ('soil_1_k', 'Soil Sensor 1', 'Kalium Tanah 1', 'integer', 'mg/kg', 7, true),
  ('soil_2_moisture', 'Soil Sensor 2', 'Kelembapan Tanah 2', 'float', '%', 8, true),
  ('soil_2_temp', 'Soil Sensor 2', 'Suhu Tanah 2', 'float', '°C', 9, true),
  ('soil_2_ec_us_cm', 'Soil Sensor 2', 'EC Tanah 2', 'float', 'µS/cm', 10, true),
  ('soil_2_ph', 'Soil Sensor 2', 'pH Tanah 2', 'float', 'pH', 11, true),
  ('soil_2_n', 'Soil Sensor 2', 'Nitrogen Tanah 2', 'integer', 'mg/kg', 12, true),
  ('soil_2_p', 'Soil Sensor 2', 'Fosfor Tanah 2', 'integer', 'mg/kg', 13, true),
  ('soil_2_k', 'Soil Sensor 2', 'Kalium Tanah 2', 'integer', 'mg/kg', 14, true),
  ('liquid_ph', 'Nutrisense', 'pH Larutan', 'float', 'pH', 15, true),
  ('liquid_ec_us_cm', 'Nutrisense', 'EC Larutan', 'float', 'µS/cm', 16, true),
  ('liquid_temp', 'Nutrisense', 'Suhu Larutan', 'float', '°C', 17, true),
  ('air_temp', 'SHT20', 'Suhu Udara', 'float', '°C', 18, true),
  ('air_humidity', 'SHT20', 'Kelembapan Udara', 'float', '%RH', 19, true),
  ('tank_water_distance_cm', 'Tandon air', 'Jarak Permukaan Air', 'float', 'cm', 20, true),
  ('tank_water_level_pct', 'Tandon air', 'Level Tandon Air', 'float', '%', 21, true),
  ('tank_fert_distance_cm', 'Tandon pupuk', 'Jarak Permukaan Pupuk', 'float', 'cm', 22, true),
  ('tank_fert_level_pct', 'Tandon pupuk', 'Level Tandon Pupuk', 'float', '%', 23, true),
  ('flow_water_lpm', 'Flow air', 'Debit Air', 'float', 'L/min', 24, true),
  ('flow_water_total_l', 'Flow air', 'Total Air', 'float', 'L', 25, true),
  ('flow_fert_lpm', 'Flow pupuk', 'Debit Pupuk', 'float', 'L/min', 26, true),
  ('flow_fert_total_l', 'Flow pupuk', 'Total Pupuk', 'float', 'L', 27, true),
  ('battery_voltage', 'Daya', 'Tegangan Baterai', 'float', 'V', 28, true)
ON CONFLICT (sensor_key) DO UPDATE
SET group_name = EXCLUDED.group_name,
    display_name = EXCLUDED.display_name,
    value_type = EXCLUDED.value_type,
    unit = EXCLUDED.unit,
    sort_order = EXCLUDED.sort_order,
    enabled = EXCLUDED.enabled;

COMMIT;
