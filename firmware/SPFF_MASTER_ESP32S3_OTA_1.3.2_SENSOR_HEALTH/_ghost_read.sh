set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== FIRMWARE ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT to_char(received_at AT TIME ZONE 'Asia/Jakarta','HH24:MI:SS') AS wib, raw_payload->>'firmwareVersion' AS fw, raw_payload->>'pulseBootId' AS boot FROM spff.device_status_events ORDER BY received_at DESC LIMIT 2;"
echo
echo "=== GHOST PROBE (idle / ghost / real) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "
SELECT to_char(received_at AT TIME ZONE 'Asia/Jakarta','HH24:MI:SS') AS wib,
       raw_payload->'busProbe'->>'idleB'  AS idle_b,
       raw_payload->'busProbe'->>'idleH'  AS idle_hex,
       raw_payload->'busProbe'->>'ghostB' AS ghost_b,
       raw_payload->'busProbe'->>'ghostH' AS ghost_hex,
       raw_payload->'busProbe'->>'realB'  AS real_b,
       raw_payload->'busProbe'->>'realH'  AS real_hex
FROM spff.device_status_events
WHERE raw_payload ? 'busProbe'
ORDER BY received_at DESC LIMIT 8;"
