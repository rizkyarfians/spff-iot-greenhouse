set +e
FW=/home/orangepi/firmware_v1441_soil1only.bin
EXPECT=cfe600002a450b7363c97c6d2c75e6b66fa1d6144b7a6d8adbaffb7d0708b132
PY=/home/orangepi/esptool-venv/bin/python
S() { echo 'orangepi' | sudo -S -p '' "$@"; }

ACT=$(S -u postgres psql -X -d spff -P pager=off -A -t -c "SELECT count(*) FROM spff.latest_actuator_states WHERE site_id='greenhouse-01' AND state='active';")
if [ "$ACT" != "0" ]; then echo "BATAL: ada aktuator aktif"; exit 3; fi

ACTUALSHA=$(sha256sum "$FW" | cut -d' ' -f1)
if [ "$ACTUALSHA" != "$EXPECT" ]; then echo "HASH TIDAK COCOK: $ACTUALSHA"; exit 2; fi
echo "HASH OK"

S systemctl stop spff-edge-gateway
sleep 1
S "$PY" -m esptool --chip esp32s3 --port /dev/ttyACM0 --baud 115200 write-flash 0x10000 "$FW" 2>&1 | tail -4
echo "FLASH EXIT CODE: ${PIPESTATUS[0]}"
S systemctl start spff-edge-gateway
sleep 2
echo "gateway: $(systemctl is-active spff-edge-gateway)"
