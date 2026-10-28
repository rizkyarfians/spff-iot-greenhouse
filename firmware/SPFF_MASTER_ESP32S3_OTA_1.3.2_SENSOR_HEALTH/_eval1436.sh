set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== FIRMWARE / BOOT ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT received_at AT TIME ZONE 'Asia/Jakarta' AS wib, raw_payload->>'firmwareVersion' AS fw, raw_payload->>'pulseBootId' AS boot, raw_payload->>'systemState' AS sys FROM spff.device_status_events ORDER BY received_at DESC LIMIT 3;"
echo
echo "=== SOIL VALID COUNT PER TELEMETRY (last 12) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "
SELECT to_char(received_at AT TIME ZONE 'Asia/Jakarta','HH24:MI:SS') AS wib,
       (SELECT count(*) FROM jsonb_each(raw_payload->'sensorHealth') e(k,v) WHERE k LIKE 'soil%' AND v->>'valid'='true') AS ok,
       (SELECT count(*) FROM jsonb_each(raw_payload->'sensorHealth') e(k,v) WHERE k LIKE 'soil%') AS total
FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 12;"
echo
echo "=== SOIL POLL COUNTERS (latest) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "
SELECT k AS field, v->>'lastPollResult' AS poll, v->>'pollTotalAttempts' AS att, v->>'pollTotalSuccesses' AS ok,
       v->>'pollInvalidResponses' AS bad, v->>'pollCrcErrors' AS crc, v->>'lastPollHex' AS hex
FROM (SELECT raw_payload->'sensorHealth' AS h FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 1) t,
     jsonb_each(h) e(k,v) WHERE k LIKE 'soil%' ORDER BY k;"
