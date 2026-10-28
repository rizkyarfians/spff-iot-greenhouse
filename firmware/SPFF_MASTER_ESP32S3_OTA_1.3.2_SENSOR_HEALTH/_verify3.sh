set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== SOIL_1_MOISTURE HEALTH (full) ==="
S -u postgres psql -X -d spff -P pager=off -A -t -c "SELECT jsonb_pretty(raw_payload->'sensorHealth'->'soil_1_moisture') FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 1;"
echo "=== SOIL_2_MOISTURE HEALTH (full) ==="
S -u postgres psql -X -d spff -P pager=off -A -t -c "SELECT jsonb_pretty(raw_payload->'sensorHealth'->'soil_2_moisture') FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 1;"
echo "=== AIR TEMP (SHT20) HEALTH ==="
S -u postgres psql -X -d spff -P pager=off -A -t -c "SELECT jsonb_pretty(raw_payload->'sensorHealth'->'air_temp') FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 1;"
echo "=== COUNTER TREND (last 4 rows) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT received_at, raw_payload->'sensorHealth'->'soil_1_moisture'->>'pollTotalAttempts' AS s1_att, raw_payload->'sensorHealth'->'soil_1_moisture'->>'pollTotalSuccesses' AS s1_ok, raw_payload->'sensorHealth'->'soil_1_moisture'->>'blockPollAttempts' AS b_att, raw_payload->'sensorHealth'->'soil_1_moisture'->>'blockPollSuccesses' AS b_ok FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 4;"
