set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== BOOT ID & STATUS ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT raw_payload->>'pulseBootId' AS boot, count(*) AS n, min(received_at AT TIME ZONE 'Asia/Jakarta') AS first_wib, max(received_at AT TIME ZONE 'Asia/Jakarta') AS last_wib FROM spff.device_status_events WHERE received_at > now() - interval '30 minutes' GROUP BY 1 ORDER BY last_wib DESC LIMIT 3;"
echo
echo "=== KESEHATAN UMUM (telemetry terakhir) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT raw_payload->'sensors'->>'tank_water_distance_cm' AS water_cm, raw_payload->'sensors'->>'air_temp' AS air, raw_payload->'sensors'->>'liquid_ec_us_cm' AS ec, raw_payload->'sensors'->>'ac_power_w' AS watt, raw_payload->'sensorHealth'->'tank_water_distance_cm'->>'valid' AS tank_ok FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 1;"
echo
echo "=== AKTUATOR ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT actuator_key, state FROM spff.latest_actuator_states WHERE site_id='greenhouse-01';"
echo
echo "=== ERROR GATEWAY 10 MENIT ==="
S journalctl -u spff-edge-gateway --since '-10 min' --no-pager -o cat 2>/dev/null | grep -icE 'error|invalid message' | xargs -I{} echo "jumlah baris error: {}"
