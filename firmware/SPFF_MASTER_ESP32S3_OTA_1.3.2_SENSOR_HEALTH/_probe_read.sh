set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== FIRMWARE ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT to_char(received_at AT TIME ZONE 'Asia/Jakarta','HH24:MI:SS') AS wib, raw_payload->>'firmwareVersion' AS fw, raw_payload->>'pulseBootId' AS boot FROM spff.device_status_events ORDER BY received_at DESC LIMIT 3;"
echo
echo "=== BUS PROBE (last 8 status) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "
SELECT to_char(received_at AT TIME ZONE 'Asia/Jakarta','HH24:MI:SS') AS wib,
       raw_payload->'busProbe'->>'bytes' AS bytes,
       raw_payload->'busProbe'->>'ageMs' AS age_ms,
       raw_payload->'busProbe'->>'hex'   AS hex
FROM spff.device_status_events
ORDER BY received_at DESC LIMIT 8;"
echo
echo "=== SOIL VALID (last 4) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "
SELECT to_char(received_at AT TIME ZONE 'Asia/Jakarta','HH24:MI:SS') AS wib,
       (SELECT count(*) FROM jsonb_each(raw_payload->'sensorHealth') e(k,v) WHERE k LIKE 'soil%' AND v->>'valid'='true') AS ok
FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 4;"
