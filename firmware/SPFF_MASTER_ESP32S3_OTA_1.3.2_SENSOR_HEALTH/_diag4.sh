set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== BASH HISTORY (esptool/scp/flash) ==="
grep -nE 'esptool|write-flash|write_flash|scp |firmware_v' /home/orangepi/.bash_history 2>/dev/null | tail -25
echo
echo "=== HISTORY TAIL ==="
tail -25 /home/orangepi/.bash_history 2>/dev/null
echo
echo "=== GATEWAY LOG 02:25-02:45 UTC ==="
S journalctl -u spff-edge-gateway --since '2026-10-28 02:25:00' --until '2026-10-28 02:45:00' --no-pager -o short-iso 2>/dev/null | grep -viE 'Telemetry persisted|messageId|sequence:|edgeOutboxRemoved|^\s*\}' | head -40
echo
echo "=== PARTITION TABLE / OTADATA ==="
ls -l /home/orangepi/otadata-current.bin 2>/dev/null
echo
echo "=== RELAY / ACTUATOR STATE (latest) ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT received_at, site_id, device_id, payload FROM spff.actuator_events ORDER BY received_at DESC LIMIT 3;" 2>/dev/null | cut -c1-400
