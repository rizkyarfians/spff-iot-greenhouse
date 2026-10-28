set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== SOIL RAW HEX PER FIELD (latest telemetry) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "
SELECT k AS field,
       v->>'lastPollResult' AS poll,
       v->>'lastPollHex'    AS hex,
       v->>'lastPollRxBytes' AS rx,
       v->>'lastPollElapsedMs' AS ms
FROM (SELECT raw_payload->'sensorHealth' AS h FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 1) t,
     jsonb_each(h) e(k,v)
WHERE k LIKE 'soil%'
ORDER BY k;"
echo
echo "=== SLAVE TANK RAW (latest 2) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT received_at AT TIME ZONE 'Asia/Jakarta' AS wib, raw_payload->'sensorHealth'->'tank_water_distance_cm' AS wh, raw_payload->'sensorHealth'->'tank_fert_distance_cm' AS fh FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 2;"
