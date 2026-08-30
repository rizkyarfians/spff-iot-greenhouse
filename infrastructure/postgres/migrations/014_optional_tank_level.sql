BEGIN;

ALTER TABLE spff.device_automatic_control_configs
  DROP CONSTRAINT IF EXISTS automatic_control_water_values_check;

ALTER TABLE spff.device_automatic_control_configs
  ADD CONSTRAINT automatic_control_water_values_check
  CHECK (
    (water_moisture_low_pct IS NULL OR water_moisture_low_pct BETWEEN 0 AND 100)
    AND (water_moisture_target_pct IS NULL OR water_moisture_target_pct BETWEEN 0 AND 100)
    AND (water_max_runtime_seconds IS NULL OR water_max_runtime_seconds BETWEEN 1 AND 86400)
    AND (water_cooldown_seconds IS NULL OR water_cooldown_seconds BETWEEN 0 AND 86400)
    AND (water_min_tank_level_pct IS NULL OR water_min_tank_level_pct BETWEEN 0 AND 100)
    AND (water_min_flow_lpm IS NULL OR water_min_flow_lpm BETWEEN 0 AND 10000)
    AND (
      NOT water_enabled
      OR (
        water_moisture_low_pct IS NOT NULL
        AND water_moisture_target_pct IS NOT NULL
        AND water_moisture_low_pct < water_moisture_target_pct
        AND water_max_runtime_seconds IS NOT NULL
        AND water_cooldown_seconds IS NOT NULL
        AND water_min_flow_lpm IS NOT NULL
      )
    )
  );

ALTER TABLE spff.device_automatic_control_configs
  DROP CONSTRAINT IF EXISTS automatic_control_fertilizer_values_check;

ALTER TABLE spff.device_automatic_control_configs
  ADD CONSTRAINT automatic_control_fertilizer_values_check
  CHECK (
    (fertilizer_ec_low_us_cm IS NULL OR fertilizer_ec_low_us_cm BETWEEN 0 AND 100000)
    AND (fertilizer_ec_target_us_cm IS NULL OR fertilizer_ec_target_us_cm BETWEEN 0 AND 100000)
    AND (fertilizer_ec_high_us_cm IS NULL OR fertilizer_ec_high_us_cm BETWEEN 0 AND 100000)
    AND (fertilizer_dose_pulse_seconds IS NULL OR fertilizer_dose_pulse_seconds BETWEEN 1 AND 3600)
    AND (fertilizer_mixing_delay_seconds IS NULL OR fertilizer_mixing_delay_seconds BETWEEN 1 AND 86400)
    AND (fertilizer_cooldown_seconds IS NULL OR fertilizer_cooldown_seconds BETWEEN 0 AND 86400)
    AND (fertilizer_max_dose_volume_l IS NULL OR fertilizer_max_dose_volume_l BETWEEN 0.001 AND 100000)
    AND (fertilizer_max_daily_volume_l IS NULL OR fertilizer_max_daily_volume_l BETWEEN 0.001 AND 1000000)
    AND (fertilizer_min_tank_level_pct IS NULL OR fertilizer_min_tank_level_pct BETWEEN 0 AND 100)
    AND (fertilizer_min_flow_lpm IS NULL OR fertilizer_min_flow_lpm BETWEEN 0 AND 10000)
    AND (
      NOT fertilizer_enabled
      OR (
        fertilizer_ec_low_us_cm IS NOT NULL
        AND fertilizer_ec_target_us_cm IS NOT NULL
        AND fertilizer_ec_high_us_cm IS NOT NULL
        AND fertilizer_ec_low_us_cm < fertilizer_ec_target_us_cm
        AND fertilizer_ec_target_us_cm < fertilizer_ec_high_us_cm
        AND fertilizer_dose_pulse_seconds IS NOT NULL
        AND fertilizer_mixing_delay_seconds IS NOT NULL
        AND fertilizer_cooldown_seconds IS NOT NULL
        AND fertilizer_max_dose_volume_l IS NOT NULL
        AND fertilizer_max_daily_volume_l IS NOT NULL
        AND fertilizer_max_dose_volume_l <= fertilizer_max_daily_volume_l
        AND fertilizer_min_flow_lpm IS NOT NULL
      )
    )
  );

COMMENT ON CONSTRAINT automatic_control_water_values_check
  ON spff.device_automatic_control_configs
  IS 'Water automatic profile; calibrated tank percentage remains optional.';

COMMENT ON CONSTRAINT automatic_control_fertilizer_values_check
  ON spff.device_automatic_control_configs
  IS 'Fertilizer automatic profile; calibrated tank percentage remains optional.';

COMMIT;
