set +e
FW=/home/orangepi/firmware_v1436_soilslow.bin
EXPECT=ab5aa7450a11aa6df270d66679f5789e21ed601398bd9e5ec1a944fbcfc48db0
PY=/home/orangepi/esptool-venv/bin/python
S() { echo 'orangepi' | sudo -S -p '' "$@"; }

echo "=== PUMP SAFETY CHECK ==="
S -u postgres psql -X -d spff -P pager=off -A -t -F '|' -c "SELECT actuator_key || '=' || state FROM spff.latest_actuator_states WHERE site_id='greenhouse-01';"
ACT=$(S -u postgres psql -X -d spff -P pager=off -A -t -c "SELECT count(*) FROM spff.latest_actuator_states WHERE site_id='greenhouse-01' AND state='active';")
if [ "$ACT" != "0" ]; then echo "ABORT: ada aktuator AKTIF"; exit 3; fi
echo "semua aktuator OFF - lanjut"

echo "=== FILE CHECK ==="
ACTUALSHA=$(sha256sum "$FW" | cut -d' ' -f1)
echo "sha actual  : $ACTUALSHA"
if [ "$ACTUALSHA" != "$EXPECT" ]; then echo "HASH MISMATCH"; exit 2; fi
echo "HASH OK"

echo "=== STOP GATEWAY ==="
S systemctl stop spff-edge-gateway
sleep 1
echo "gateway: $(systemctl is-active spff-edge-gateway)"

echo "=== FLASH ==="
S "$PY" -m esptool --chip esp32s3 --port /dev/ttyACM0 --baud 115200 write-flash 0x10000 "$FW" 2>&1 | tail -12
RC=${PIPESTATUS[0]}
echo "FLASH EXIT CODE: $RC"

echo "=== START GATEWAY ==="
S systemctl start spff-edge-gateway
sleep 2
echo "gateway: $(systemctl is-active spff-edge-gateway)"
