set +e
FW=/home/orangepi/firmware_v1435_blockread.bin
EXPECT=76956c6a42a707b3b7b0308af2f7adc6abf4405063ddde1a08d3c6f9cd5ea8d4
PY=/home/orangepi/esptool-venv/bin/python
S() { echo 'orangepi' | sudo -S -p '' "$@"; }

echo "=== FILE CHECK ==="
ls -l "$FW"
ACT=$(sha256sum "$FW" | cut -d' ' -f1)
echo "sha256 actual  : $ACT"
echo "sha256 expected: $EXPECT"
if [ "$ACT" != "$EXPECT" ]; then echo "HASH MISMATCH - abort"; exit 2; fi
echo "HASH OK"

echo "=== IMAGE INFO ==="
S "$PY" -m esptool --chip esp32s3 image-info "$FW" 2>/dev/null | head -18

echo "=== STOP GATEWAY ==="
S systemctl stop spff-edge-gateway
sleep 1
echo "gateway state: $(systemctl is-active spff-edge-gateway)"

echo "=== FLASH ==="
S "$PY" -m esptool --chip esp32s3 --port /dev/ttyACM0 --baud 115200 write-flash 0x10000 "$FW"
RC=$?
echo "FLASH EXIT CODE: $RC"

echo "=== START GATEWAY ==="
S systemctl start spff-edge-gateway
sleep 2
echo "gateway state: $(systemctl is-active spff-edge-gateway)"
echo "DONE rc=$RC"
