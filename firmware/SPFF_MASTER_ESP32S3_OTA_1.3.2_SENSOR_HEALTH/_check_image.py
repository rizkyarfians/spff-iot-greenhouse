import struct, sys, hashlib, os

path = "binary/SPFF_MASTER_1_4_34_INDEPENDENT_AI.ino.bin"
data = open(path, "rb").read()
print("file bytes :", len(data))
print("sha256     :", hashlib.sha256(data).hexdigest())

magic, segs, mode, size_freq, size = struct.unpack_from("<BBBB B", data, 0)[:4] + (data[3],)
magic = data[0]
segs = data[1]
mode = data[2]
sf = data[3]
ext = data[4:8]
print(f"magic      : 0x{magic:02X} (expect 0xE9)")
print(f"segments   : {segs}")
print(f"spi_mode   : {mode}  spi_speed_size: 0x{sf:02X} -> size_code={sf & 0x0F} freq_code={sf >> 4}")
print(f"ext header : {ext.hex()} (chip_id little-endian for ESP32-S3 = 09 00)")

# flash size code 0=1MB,1=2MB,2=4MB,3=8MB,4=16MB ; freq: 0=40,1=26,2=20,f=80MHz
sizes = {0: "1MB", 1: "2MB", 2: "4MB", 3: "8MB", 4: "16MB"}
freqs = {0x0: "40MHz", 0x1: "26MHz", 0x2: "20MHz", 0xF: "80MHz"}
print(f"flash size : {sizes.get(sf & 0x0F, '?')}   freq: {freqs.get(sf >> 4, '?')}")

# app descriptor at 0x20
off = 0x20
magic2 = struct.unpack_from("<I", data, off)[0]
print(f"app_desc magic at 0x20: 0x{magic2:08X} (expect 0xABCD5432)")
if magic2 == 0xABCD5432:
    sec_ver, res, app_ver, proj = struct.unpack_from("<I16s32s32s", data, off + 16)
    t, d = struct.unpack_from("<16s16s", data, off + 96)
    idf = struct.unpack_from("<32s", data, off + 112)[0]
    print("app version:", app_ver.split(b"\0")[0].decode(errors="replace"))
    print("project    :", proj.split(b"\0")[0].decode(errors="replace"))
    print("built      :", d.split(b"\0")[0].decode(errors="replace"), t.split(b"\0")[0].decode(errors="replace"))
    print("idf        :", idf.split(b"\0")[0].decode(errors="replace"))

# walk first segment to sanity check length
pos = 8
total_end = 0
for i in range(segs):
    addr, ln = struct.unpack_from("<II", data, pos)
    pos += 8
    end = pos + ln
    if i == 0:
        print(f"seg0 load addr 0x{addr:08X} len {ln} (ESP32-S3 IROM starts 0x42000000)")
    total_end = end
    pos = end
print("segments end offset:", total_end, "trailing bytes:", len(data) - total_end)
