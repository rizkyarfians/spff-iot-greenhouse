set +e
FW=/home/orangepi/firmware_v1437_soil9600.bin
EXPECT=d7fd7a9c650fa64fa507e7d5675f117310afd4587a4bc1fe1bb8b3b32d7ea72c
PY=/home/orangepi/esptool-venv/bin/python
S() { echo 'orangepi' | sudo -S -p '' "$@"; }

echo "=== CEK POMPA ==="
S -u postgres psql -X -d spff -P pager=off -A -t -F '|' -c "SELECT actuator_key || '=' || state FROM spff.latest_actuator_states WHERE site_id='greenhouse-01';"
ACT=$(S -u postgres psql -X -d spff -P pager=off -A -t -c "SELECT count(*) FROM spff.latest_actuator_states WHERE site_id='greenhouse-01' AND state='active';")
if [ "$ACT" != "0" ]; then echo "BATAL: ada aktuator aktif"; exit 3; fi

echo "=== CEK FILE ==="
ACTUALSHA=$(sha256sum "$FW" | cut -d' ' -f1)
if [ "$ACTUALSHA" != "$EXPECT" ]; then echo "HASH TIDAK COCOK"; exit 2; fi
echo "HASH OK"

echo "=== STOP GATEWAY ==="
S systemctl stop spff-edge-gateway
sleep 1
echo "gateway: $(systemctl is-active spff-edge-gateway)"

echo "=== FLASH ==="
S "$PY" -m esptool --chip esp32s3 --port /dev/ttyACM0 --baud 115200 write-flash 0x10000 "$FW" 2>&1 | tail -8
RC=${PIPESTATUS[0]}
echo "FLASH EXIT CODE: $RC"

echo "=== START GATEWAY ==="
S systemctl start spff-edge-gateway
sleep 2
echo "gateway: $(systemctl is-active spff-edge-gateway)"
