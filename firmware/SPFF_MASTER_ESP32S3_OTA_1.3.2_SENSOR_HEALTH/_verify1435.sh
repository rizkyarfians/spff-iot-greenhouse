set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== DEVICE STATUS (last 4) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT received_at, raw_payload->>'firmwareVersion' AS fw, raw_payload->>'pulseBootId' AS boot, raw_payload->>'systemState' AS sys, raw_payload->>'mode' AS mode FROM spff.device_status_events ORDER BY received_at DESC LIMIT 4;"
echo
echo "=== BOOT IDS (last 90 min) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT raw_payload->>'pulseBootId' AS boot, count(*) AS n, min(received_at) AS first_seen, max(received_at) AS last_seen FROM spff.device_status_events WHERE received_at > now() - interval '90 minutes' GROUP BY 1 ORDER BY last_seen DESC;"
echo
echo "=== SOIL HEALTH (latest telemetry) ==="
S -u postgres psql -X -d spff -P pager=off -A -t -c "SELECT jsonb_pretty(raw_payload->'sensorHealth'->'soil_1_p') || jsonb_pretty(raw_payload->'sensorHealth'->'soil_1_moisture') || jsonb_pretty(raw_payload->'sensorHealth'->'soil_2_p') || jsonb_pretty(raw_payload->'sensorHealth'->'soil_2_moisture') FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 1;" | head -60
echo
echo "=== TELEMETRY COUNTERS (last 2 rows, soil fields) ==="
S -u postgres psql -X -d spff -P pager=off -A -t -c "SELECT received_at, raw_payload->'sensorHealth'->'soil_1_p'->>'pollTotalSuccesses' AS s1_ok, raw_payload->'sensorHealth'->'soil_1_p'->>'pollInvalidResponses' AS s1_bad, raw_payload->'sensorHealth'->'soil_2_p'->>'pollTotalSuccesses' AS s2_ok, raw_payload->'sensorHealth'->'soil_2_p'->>'pollInvalidResponses' AS s2_bad FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 3;"
echo
echo "=== GATEWAY ERRORS (last 5 min) ==="
S journalctl -u spff-edge-gateway --since '-5 min' --no-pager -o cat 2>/dev/null | grep -iE 'error|fail|disconnect|reconnect|corrupt|timeout' | tail -10
