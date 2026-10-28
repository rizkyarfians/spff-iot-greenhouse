set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== AKTUATOR ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT actuator_key, state, source, reason, to_char(received_at AT TIME ZONE 'Asia/Jakarta','HH24:MI:SS') AS wib FROM spff.latest_actuator_states WHERE site_id='greenhouse-01';"
echo
echo "=== EVENT AKTUATOR TERAKHIR ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT to_char(received_at AT TIME ZONE 'Asia/Jakarta','HH24:MI:SS') AS wib, actuator_key, state, source, reason FROM spff.actuator_state_events ORDER BY received_at DESC LIMIT 6;"
echo
echo "=== COMMAND TERAKHIR ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT to_char(created_at AT TIME ZONE 'Asia/Jakarta','HH24:MI:SS') AS wib, command_type, status FROM spff.control_commands ORDER BY created_at DESC LIMIT 4;"
echo
echo "=== DAYA / FLOW SEKARANG ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT to_char(received_at AT TIME ZONE 'Asia/Jakarta','HH24:MI:SS') AS wib, raw_payload->'sensors'->>'ac_power_w' AS watt, raw_payload->'sensors'->>'flow_water_lpm' AS water_lpm, raw_payload->'sensors'->>'flow_fert_lpm' AS fert_lpm FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 3;"
