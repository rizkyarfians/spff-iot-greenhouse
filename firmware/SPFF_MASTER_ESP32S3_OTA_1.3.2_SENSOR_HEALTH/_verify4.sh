set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT received_at, raw_payload->'sensors'->>'air_temp' AS air_t, raw_payload->'sensors'->>'air_humidity' AS air_h, raw_payload->'sensors'->>'liquid_temp' AS liq_t, raw_payload->'sensors'->>'soil_2_moisture' AS s2m FROM spff.telemetry_samples ORDER BY received_at DESC LIMIT 5;"
