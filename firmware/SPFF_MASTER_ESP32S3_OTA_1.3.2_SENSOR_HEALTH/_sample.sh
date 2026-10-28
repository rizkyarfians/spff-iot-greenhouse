set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
S -u postgres psql -X -d spff -P pager=off -A -t -F '|' -c "
SELECT to_char(received_at AT TIME ZONE 'Asia/Jakarta','HH24:MI:SS')
  || ' soilOK=' || (
       SELECT count(*) FROM jsonb_each(raw_payload->'sensorHealth') e(k,v)
       WHERE k LIKE 'soil%' AND v->>'valid'='true')
  || '/' || (
       SELECT count(*) FROM jsonb_each(raw_payload->'sensorHealth') e(k,v)
       WHERE k LIKE 'soil%')
  || ' tank=' || coalesce(raw_payload->'sensorHealth'->'tank_water_distance_cm'->>'valid','?')
  || ' water=' || coalesce(raw_payload->'sensors'->>'tank_water_distance_cm','-')
  || ' ac=' || coalesce(raw_payload->'sensors'->>'ac_power_w','-')
FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 1;"
