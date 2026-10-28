set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== TABLES (actuator/relay/pulse/schedule) ==="
S -u postgres psql -X -d spff -P pager=off -A -t -c "SELECT table_name FROM information_schema.tables WHERE table_schema='spff' AND (table_name ILIKE '%actuator%' OR table_name ILIKE '%relay%' OR table_name ILIKE '%pulse%' OR table_name ILIKE '%command%') ORDER BY 1;"
echo
echo "=== LAST ACTUATOR EVENTS ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT received_at, device_id, event_type, payload::text FROM spff.actuator_events ORDER BY received_at DESC LIMIT 4;" 2>/dev/null | cut -c1-300
echo
echo "=== PULSE SESSIONS (last 3) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT * FROM spff.fertigation_pulse_sessions ORDER BY created_at DESC LIMIT 3;" 2>/dev/null | cut -c1-300
echo
echo "=== AI PROFILE ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT * FROM spff.soil_ec_automatic_profiles ORDER BY updated_at DESC LIMIT 2;" 2>/dev/null | cut -c1-400
echo
echo "=== SCHEDULE ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT * FROM spff.schedules ORDER BY updated_at DESC LIMIT 3;" 2>/dev/null | cut -c1-300
