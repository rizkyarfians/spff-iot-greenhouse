set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== HOST ==="; uptime | tr -s ' '; date
echo
echo "=== SERVICES ==="
for s in spff-api spff-mqtt-worker spff-edge-gateway; do printf "%-20s %s\n" "$s" "$(systemctl is-active $s 2>/dev/null)"; done
echo
echo "=== DEVICE STATUS (last 3) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT received_at AT TIME ZONE 'Asia/Jakarta' AS wib, raw_payload->>'firmwareVersion' AS fw, raw_payload->>'pulseBootId' AS boot, raw_payload->>'systemState' AS sys FROM spff.device_status_events ORDER BY received_at DESC LIMIT 3;"
echo
echo "=== WATER / FERT LEVEL + FLOW (last 3) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT received_at AT TIME ZONE 'Asia/Jakarta' AS wib, raw_payload->'sensors'->>'tank_water_distance_cm' AS wdist, raw_payload->'sensors'->>'tank_fert_distance_cm' AS fdist, raw_payload->'sensors'->>'flow_water_total_l' AS wtot, raw_payload->'sensors'->>'flow_fert_total_l' AS ftot, raw_payload->'sensors'->>'ac_power_w' AS watt FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 3;"
echo
echo "=== SLAVE HEALTH (tank fields valid?) ==="
S -u postgres psql -X -d spff -P pager=off -A -t -c "SELECT string_agg(k || '=' || (v->>'valid'), ' ') FROM (SELECT raw_payload->'sensorHealth' AS h FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 1) t, jsonb_each(h) e(k,v) WHERE k LIKE 'tank%';"
echo
echo "=== SOIL QUICK ==="
S -u postgres psql -X -d spff -P pager=off -A -t -c "SELECT string_agg(k || '=' || (v->>'valid') || '/' || coalesce(v->>'lastPollResult','-'), ' ') FROM (SELECT raw_payload->'sensorHealth' AS h FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 1) t, jsonb_each(h) e(k,v) WHERE k LIKE 'soil%';"
