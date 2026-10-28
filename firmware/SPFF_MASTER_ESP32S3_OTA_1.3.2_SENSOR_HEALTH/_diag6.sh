set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== LATEST ACTUATOR STATES ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT * FROM spff.latest_actuator_states ORDER BY 1;" 2>/dev/null | cut -c1-250
echo
echo "=== LAST CONTROL COMMANDS ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT created_at, command_type, status FROM spff.control_commands ORDER BY created_at DESC LIMIT 5;" 2>/dev/null | cut -c1-220
echo
echo "=== SOIL EC PULSE SESSIONS ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT created_at, state, reason FROM spff.soil_ec_pulse_sessions ORDER BY created_at DESC LIMIT 5;" 2>/dev/null | cut -c1-220
echo
echo "=== SCHEDULES ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT id, name, enabled, start_time, end_time FROM spff.actuator_schedules ORDER BY id LIMIT 10;" 2>/dev/null | cut -c1-220
echo
echo "=== ESP32 DEVICE STATUS RAW (last) ==="
S -u postgres psql -X -d spff -P pager=off -A -t -c "SELECT raw_payload::text FROM spff.device_status_events ORDER BY received_at DESC LIMIT 1;" 2>/dev/null | cut -c1-1200
