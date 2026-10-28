set +e
SUDO() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== ESP32 DEVICE STATUS (last 6) ==="
SUDO -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "
SELECT received_at,
       raw_payload->>'firmwareVersion' AS fw,
       raw_payload->>'serverPulseCapable' AS pulse,
       raw_payload->>'independentSoilEcCapable' AS indep,
       raw_payload->>'pulseBootId' AS boot_id,
       raw_payload->>'mode' AS mode
FROM spff.device_status_events
WHERE site_id='greenhouse-01' AND device_id='esp32-s3-01'
ORDER BY received_at DESC, device_status_id DESC LIMIT 6;"
echo
echo "=== TELEMETRY COLUMNS ==="
SUDO -u postgres psql -X -d spff -P pager=off -A -c "
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='spff' AND table_name='telemetry_samples' ORDER BY ordinal_position;"
echo
echo "=== TELEMETRY LATEST (last 8 rows) ==="
SUDO -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "
SELECT * FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 8;"
echo
echo "=== GATEWAY JOURNAL (40) ==="
SUDO journalctl -u spff-edge-gateway -n 40 --no-pager -o short-iso
