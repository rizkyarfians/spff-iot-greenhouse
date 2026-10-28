set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== DEVICE STATUS (5) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT received_at, raw_payload->>'firmwareVersion' AS fw, raw_payload->>'serverPulseCapable' AS pulse, raw_payload->>'independentSoilEcCapable' AS indep, raw_payload->>'pulseBootId' AS boot, raw_payload->>'mode' AS mode FROM spff.device_status_events ORDER BY received_at DESC, device_status_id DESC LIMIT 5;"
echo
echo "=== BOOT IDs LAST 6 HOURS ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT raw_payload->>'pulseBootId' AS boot, count(*) AS n, min(received_at) AS first_seen, max(received_at) AS last_seen FROM spff.device_status_events WHERE received_at > now() - interval '6 hours' GROUP BY 1 ORDER BY last_seen DESC;"
echo
echo "=== SOIL POLL SUCCESS RATE (last 10 min, from telemetry) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT date_trunc('minute', received_at) AS minute, count(*) AS samples FROM spff.telemetry_samples WHERE received_at > now() - interval '10 minutes' GROUP BY 1 ORDER BY 1 DESC LIMIT 5;"
echo
echo "=== GATEWAY UNIT ==="
systemctl cat spff-edge-gateway 2>/dev/null | head -25
echo
echo "=== GATEWAY ENV / SERIAL ==="
S journalctl -u spff-edge-gateway --since '-30 min' --no-pager -o cat 2>/dev/null | grep -iE 'serial|ttyACM|connected|disconnect|error|restart' | tail -15
