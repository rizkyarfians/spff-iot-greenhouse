BEGIN;

DO $$
BEGIN
  IF to_regprocedure('spff.set_sensor_display_group(text,boolean)') IS NULL THEN
    UPDATE spff.sensor_definitions SET enabled=false WHERE sensor_key ~ '^soil_1_';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION spff.set_sensor_display_group(display_group text, display_enabled boolean)
RETURNS integer LANGUAGE sql AS $$
  WITH changed AS (
    UPDATE spff.sensor_definitions SET enabled=display_enabled
    WHERE CASE
      WHEN sensor_key='battery_voltage' OR sensor_key ~ '^ac_' THEN 'energy'
      WHEN sensor_key ~ '^soil_1_' THEN 'soil1'
      WHEN sensor_key ~ '^soil_2_' THEN 'soil2'
      WHEN sensor_key ~ '^(liquid_|tank_|flow_)' THEN 'water'
      ELSE 'environment'
    END = display_group
    RETURNING sensor_key
  )
  SELECT count(*)::integer FROM changed;
$$;

COMMIT;
