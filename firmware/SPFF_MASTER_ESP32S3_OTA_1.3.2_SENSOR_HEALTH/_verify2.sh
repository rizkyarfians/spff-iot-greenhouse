set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== SOIL + SHT20 HEALTH (latest row) ==="
S -u postgres psql -X -d spff -P pager=off -A -t -c "
SELECT
  's1_p        ' || (h->'soil_1_p'->>'pollTotalSuccesses') || '/' || ((h->'soil_1_p'->>'pollTotalAttempts')) || ' ok, bad=' || (h->'soil_1_p'->>'pollInvalidResponses') || ' hex=' || coalesce(h->'soil_1_p'->>'lastPollHex','-'),
  's1_block    ' || coalesce(h->'soil_1_p'->>'blockPollSuccesses','0') || '/' || coalesce(h->'soil_1_p'->>'blockPollAttempts','0') || ' res=' || coalesce(h->'soil_1_p'->>'blockPollResult','-') || ' hex=' || coalesce(h->'soil_1_p'->>'blockLastHex','-'),
  's2_block    ' || coalesce(h->'soil_2_p'->>'blockPollSuccesses','0') || '/' || coalesce(h->'soil_2_p'->>'blockPollAttempts','0') || ' res=' || coalesce(h->'soil_2_p'->>'blockPollResult','-') || ' hex=' || coalesce(h->'soil_2_p'->>'blockLastHex','-'),
  'sht20_temp  ' || coalesce(h->'air_temp'->>'valid','?') || ' hex=' || coalesce(h->'air_temp'->>'lastPollHex','-') || ' ok=' || coalesce(h->'air_temp'->>'pollTotalSuccesses','-')
FROM (SELECT raw_payload->'sensorHealth' AS h FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 1) t;"
echo
echo "=== VALID FLAGS (latest) ==="
S -u postgres psql -X -d spff -P pager=off -A -t -c "SELECT string_agg(k || '=' || (v->>'valid'), ' ') FROM (SELECT raw_payload->'sensorHealth' AS h FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 1) t, jsonb_each(h) AS e(k,v) WHERE k LIKE 'soil%';"
echo
echo "=== LAST 6 TELEMETRY SOIL VALUES ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT received_at, raw_payload->'sensors'->>'soil_1_moisture' AS s1m, raw_payload->'sensors'->>'soil_1_temp' AS s1t, raw_payload->'sensors'->>'soil_2_moisture' AS s2m, raw_payload->'sensors'->>'soil_2_temp' AS s2t, raw_payload->'sensors'->>'soil_1_p' AS s1p, raw_payload->'sensors'->>'soil_2_p' AS s2p FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 6;"
echo
echo "=== SYSTEM STATE / UPTIME ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT received_at, raw_payload->>'firmwareVersion' AS fw, raw_payload->>'pulseBootId' AS boot, raw_payload->>'systemState' AS sys, raw_payload->>'sensorValid' AS svalid FROM spff.device_status_events ORDER BY received_at DESC LIMIT 3;"
