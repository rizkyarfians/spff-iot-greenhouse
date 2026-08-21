BEGIN;

-- Keep latest message metadata, but retain the latest non-null value
-- independently for every sensor.
CREATE OR REPLACE VIEW spff.latest_telemetry AS
WITH latest_message AS (
  SELECT DISTINCT ON (site_id, device_id)
    telemetry_id,
    schema_version,
    site_id,
    device_id,
    message_id,
    sequence,
    recorded_at,
    received_at,
    sensor_valid
  FROM spff.telemetry_samples
  ORDER BY site_id, device_id, recorded_at DESC, telemetry_id DESC
)
SELECT
  l.telemetry_id,
  l.schema_version,
  l.site_id,
  l.device_id,
  l.message_id,
  l.sequence,
  l.recorded_at,
  l.received_at,

  (
    SELECT t.soil_1_moisture
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.soil_1_moisture IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS soil_1_moisture,

  (
    SELECT t.soil_1_temp
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.soil_1_temp IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS soil_1_temp,

  (
    SELECT t.soil_1_ec_us_cm
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.soil_1_ec_us_cm IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS soil_1_ec_us_cm,

  (
    SELECT t.soil_1_ph
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.soil_1_ph IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS soil_1_ph,

  (
    SELECT t.soil_1_n
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.soil_1_n IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS soil_1_n,

  (
    SELECT t.soil_1_p
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.soil_1_p IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS soil_1_p,

  (
    SELECT t.soil_1_k
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.soil_1_k IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS soil_1_k,

  (
    SELECT t.soil_2_moisture
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.soil_2_moisture IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS soil_2_moisture,

  (
    SELECT t.soil_2_temp
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.soil_2_temp IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS soil_2_temp,

  (
    SELECT t.soil_2_ec_us_cm
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.soil_2_ec_us_cm IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS soil_2_ec_us_cm,

  (
    SELECT t.soil_2_ph
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.soil_2_ph IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS soil_2_ph,

  (
    SELECT t.soil_2_n
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.soil_2_n IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS soil_2_n,

  (
    SELECT t.soil_2_p
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.soil_2_p IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS soil_2_p,

  (
    SELECT t.soil_2_k
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.soil_2_k IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS soil_2_k,

  (
    SELECT t.liquid_ph
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.liquid_ph IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS liquid_ph,

  (
    SELECT t.liquid_ec_us_cm
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.liquid_ec_us_cm IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS liquid_ec_us_cm,

  (
    SELECT t.liquid_temp
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.liquid_temp IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS liquid_temp,

  (
    SELECT t.air_temp
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.air_temp IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS air_temp,

  (
    SELECT t.air_humidity
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.air_humidity IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS air_humidity,

  (
    SELECT t.tank_water_distance_cm
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.tank_water_distance_cm IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS tank_water_distance_cm,

  (
    SELECT t.tank_water_level_pct
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.tank_water_level_pct IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS tank_water_level_pct,

  (
    SELECT t.tank_fert_distance_cm
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.tank_fert_distance_cm IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS tank_fert_distance_cm,

  (
    SELECT t.tank_fert_level_pct
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.tank_fert_level_pct IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS tank_fert_level_pct,

  (
    SELECT t.flow_water_lpm
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.flow_water_lpm IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS flow_water_lpm,

  (
    SELECT t.flow_water_total_l
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.flow_water_total_l IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS flow_water_total_l,

  (
    SELECT t.flow_fert_lpm
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.flow_fert_lpm IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS flow_fert_lpm,

  (
    SELECT t.flow_fert_total_l
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.flow_fert_total_l IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS flow_fert_total_l,

  (
    SELECT t.battery_voltage
    FROM spff.telemetry_samples t
    WHERE t.site_id = l.site_id
      AND t.device_id = l.device_id
      AND t.battery_voltage IS NOT NULL
    ORDER BY t.recorded_at DESC, t.telemetry_id DESC
    LIMIT 1
  ) AS battery_voltage,

  l.sensor_valid
FROM latest_message l;

COMMIT;
