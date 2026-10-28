set +e
S() { echo 'orangepi' | sudo -S -p '' "$@" 2>/dev/null; }
echo "=== actuator_schedules schema ==="
S -u postgres psql -X -d spff -P pager=off -A -c "\d spff.actuator_schedules" 2>&1 | head -20
echo
echo "=== schedule rows ==="
S -u postgres psql -X -d spff -P pager=off -A -F ' | ' -c "SELECT * FROM spff.actuator_schedules LIMIT 5;" 2>&1 | cut -c1-300
echo
echo "=== firmware version gating in server code ==="
cd /opt/spff 2>/dev/null && grep -rn "independentSoilEcCapable\|1\.4\.3" --include=*.ts apps packages edge-gateway worker 2>/dev/null | head -20
echo
echo "=== device firmware_version helper ==="
cd /opt/spff 2>/dev/null && grep -rn "firmwareVersion" --include=*.ts edge-gateway/src | head -10
