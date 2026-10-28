set +e
FW=/home/orangepi/firmware_v1436_soilslow.bin
EXPECT=ab5aa7450a11aa6df270d66679f5789e21ed601398bd9e5ec1a944fbcfc48db0
PY=/home/orangepi/esptool-venv/bin/python
S() { echo 'orangepi' | sudo -S -p '' "$@"; }

if [ ! -s "$FW" ]; then echo "file v1436 tidak ada"; exit 4; fi
ACTUALSHA=$(sha256sum "$FW" | cut -d' ' -f1)
if [ "$ACTUALSHA" != "$EXPECT" ]; then echo "HASH v1436 tidak cocok: $ACTUALSHA"; exit 2; fi
echo "HASH v1.4.36 OK"

ACT=$(S -u postgres psql -X -d spff -P pager=off -A -t -c "SELECT count(*) FROM spff.latest_actuator_states WHERE site_id='greenhouse-01' AND state='active';")
if [ "$ACT" != "0" ]; then echo "BATAL: ada aktuator aktif"; exit 3; fi

S systemctl stop spff-edge-gateway
sleep 1
S "$PY" -m esptool --chip esp32s3 --port /dev/ttyACM0 --baud 115200 write-flash 0x10000 "$FW" 2>&1 | tail -6
echo "FLASH EXIT CODE: ${PIPESTATUS[0]}"
S systemctl start spff-edge-gateway
sleep 2
echo "gateway: $(systemctl is-active spff-edge-gateway)"
