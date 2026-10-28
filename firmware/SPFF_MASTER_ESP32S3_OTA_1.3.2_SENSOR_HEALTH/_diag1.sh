set +e
echo "=== HOST ==="
hostname; date; uptime | tr -s ' '
echo
echo "=== SUDO ==="
if sudo -n true 2>/dev/null; then echo "SUDO_NOPASS"; else echo "SUDO_NEEDS_PASS"; fi
echo
echo "=== SERVICES ==="
for s in spff-api spff-mqtt-worker spff-edge-gateway; do
  printf "%-20s %-10s %s\n" "$s" "$(systemctl is-active $s 2>/dev/null)" "$(systemctl show -p ActiveEnterTimestamp --value $s 2>/dev/null)"
done
echo
echo "=== FIRMWARE FILES IN /home/orangepi ==="
ls -l /home/orangepi/*.bin 2>/dev/null
sha256sum /home/orangepi/*.bin 2>/dev/null
echo
echo "=== SERIAL PORTS ==="
ls -l /dev/ttyACM* /dev/ttyUSB* 2>/dev/null || echo "none"
echo
echo "=== REPO /opt/spff ==="
if cd /opt/spff 2>/dev/null; then
  git rev-parse --abbrev-ref HEAD 2>&1
  git log -1 --format='%h %ad %s' --date=iso 2>&1
  echo "-- dirty files --"
  git status --porcelain 2>&1 | head -20
else
  echo "no /opt/spff"
fi
