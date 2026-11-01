#!/usr/bin/env bash
# Enable the already-tested, loopback-only Unified AI preview after reboot.
# Does NOT start/restart any service now, touch /opt/spff*, migrate a DB,
# publish MQTT, expose a network port, or enable AI polling.
set -Eeuo pipefail
umask 077

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$EUID" -eq 0 ]] || die "Jalankan dengan sudo (contoh di docs)."
OWNER="$SUDO_USER"
[[ "$OWNER" == "orangepi" ]] || die "Installer ini khusus sudo dari user orangepi."
HOME_DIR="$(getent passwd "$OWNER" | cut -d: -f6)"
[[ "$HOME_DIR" == "/home/orangepi" ]] || die "Home user tidak sesuai target pengujian."
OWNER_GROUP="$(id -gn "$OWNER")"
REPO="$HOME_DIR/spff-ai-dashboard-test"
PYTHON_BIN="$REPO/standalone-ai/.venv/bin/python"
API_ENTRY="$REPO/functions/lib/aiPreviewLocal.js"
# npm workspaces may install Vite inside frontend/node_modules or hoist it
# to the repo root. Check both without installing packages or changing state.
VITE_ENTRY=""
for candidate in \
  "$REPO/frontend/node_modules/vite/bin/vite.js" \
  "$REPO/node_modules/vite/bin/vite.js" \
  "$REPO/frontend/node_modules/.bin/vite" \
  "$REPO/node_modules/.bin/vite"; do
  if [[ -f "$candidate" ]]; then
    VITE_ENTRY="$candidate"
    break
  fi
done
[[ -n "$VITE_ENTRY" ]] || die "Vite tidak ditemukan di node_modules frontend/root; periksa npm ci."
SOURCE_ENV="/etc/spff-ai/engine.env"
STAGE_DIR="$HOME_DIR/.config/spff-ai-staging"
STAGE_ENV="$STAGE_DIR/source.env"

for path in "$PYTHON_BIN" "$API_ENTRY" "$VITE_ENTRY" "$SOURCE_ENV"; do
  [[ -f "$path" ]] || die "File wajib tidak ditemukan: $path"
done
[[ -x "$PYTHON_BIN" ]] || die "Python venv tidak executable."

# Explicitly use the path resolved by the invoking user's shell; nvm Node
# may not exist in systemd's default PATH.
NODE_BIN="$SPFF_DEV_NODE"
[[ -n "$NODE_BIN" && "$NODE_BIN" == /* && -x "$NODE_BIN" ]] ||
  die 'Set SPFF_DEV_NODE ke path node dari command -v node (lihat panduan).'
"$NODE_BIN" --version >/dev/null || die "Node tidak dapat dijalankan."

# Refuse replacing unrelated service files. Re-running THIS installer is OK.
for name in spff-ai-dev-python spff-ai-dev-api spff-ai-dev-web; do
  unit="/etc/systemd/system/$name.service"
  if [[ -e "$unit" ]] && ! grep -Fq "SPFF AI dev boot installer" "$unit"; then
    die "Unit sudah ada dan bukan milik installer ini: $unit"
  fi
done

install -d -m 700 -o "$OWNER" -g "$OWNER_GROUP" "$STAGE_DIR"
# Extract only AI_SOURCE_DSN (never source or copy the production env).
# Validate the database identity and that source credentials cannot write
# into the operational SPFF schema before persisting them to a 0600 file.
SOURCE_ENV="$SOURCE_ENV" STAGE_ENV="$STAGE_ENV" STAGE_UID="$(id -u "$OWNER")" \
STAGE_GID="$(id -g "$OWNER")" "$PYTHON_BIN" - <<'PY'
import os
from pathlib import Path
import psycopg

source = Path(os.environ["SOURCE_ENV"])
lines = source.read_text(encoding="utf-8").splitlines()
values = [line.partition("=")[2].strip() for line in lines
          if line.strip().startswith("AI_SOURCE_DSN=")]
if len(values) != 1:
    raise SystemExit("Tolak: butuh tepat satu AI_SOURCE_DSN produksi read-only")
dsn = values[0].strip().strip('"').strip("'")
if not dsn or any(ord(ch) < 32 for ch in dsn):
    raise SystemExit("Tolak: DSN kosong/invalid")
with psycopg.connect(dsn, connect_timeout=5) as conn:
    conn.execute("SET TRANSACTION READ ONLY")
    row = conn.execute("""
        SELECT current_user, current_database(),
               (SELECT rolsuper OR rolcreatedb OR rolcreaterole
                  FROM pg_roles WHERE rolname=current_user),
               has_schema_privilege(current_user,'spff','CREATE'),
               has_database_privilege(current_user,current_database(),'CREATE'),
               has_table_privilege(current_user,'spff.telemetry_samples','SELECT'),
               EXISTS(
                 SELECT 1 FROM pg_class c JOIN pg_namespace n
                   ON c.relnamespace=n.oid
                 WHERE n.nspname='spff' AND c.relkind IN ('r','p','v','m','f')
                   AND (has_table_privilege(current_user,c.oid,'INSERT')
                     OR has_table_privilege(current_user,c.oid,'UPDATE')
                     OR has_table_privilege(current_user,c.oid,'DELETE')
                     OR has_table_privilege(current_user,c.oid,'TRUNCATE'))
               )
    """).fetchone()
    name, database, elevated, schema_create, database_create, can_read, can_write = row
    if (name, database) != ("spff_ai_reader", "spff") or any(
        (elevated, schema_create, database_create, not can_read, can_write)
    ):
        raise SystemExit("Tolak: AI_SOURCE_DSN bukan akun source SELECT-only yang diharapkan")

# systemd EnvironmentFile quoting: backslash/double-quote escaped; no shell
# interpolation and no secret copied into unit files or journal.
escaped = dsn.replace("\\", "\\\\").replace('"', '\\"')
target = Path(os.environ["STAGE_ENV"])
temporary = target.with_name(target.name + ".tmp")
temporary.write_text('AI_SOURCE_DSN="' + escaped + '"\n', encoding="utf-8")
os.chmod(temporary, 0o600)
os.chown(temporary, int(os.environ["STAGE_UID"]), int(os.environ["STAGE_GID"]))
os.replace(temporary, target)
print("PASS: staging source role spff_ai_reader (SELECT-only). DSN disimpan privat.")
PY

# Do not enable poll: each decision snapshot can grow local state/audit history.
# Only SHADOW_MODE is permitted; the AI has no MQTT/actuator command route.
cat > /etc/systemd/system/spff-ai-dev-python.service <<EOF
# SPFF AI dev boot installer — isolated Python preview
[Unit]
Description=SPFF Unified AI DEV Python preview (SHADOW only)
After=network.target

[Service]
Type=simple
User=$OWNER
Group=$OWNER_GROUP
WorkingDirectory=$REPO/standalone-ai
EnvironmentFile=$STAGE_ENV
Environment=AI_HOST=127.0.0.1
Environment=AI_PORT=5011
Environment=AI_MODE=SHADOW_MODE
Environment=AI_POLL_ENABLED=false
Environment=AI_STATE_DSN=
Environment=AI_STATE_PATH=$REPO/standalone-ai/data/staging-shadow.sqlite3
Environment=AI_SITE_ID=greenhouse-01
Environment=AI_DEVICE_ID=esp32-s3-01
Environment=AI_ZONE_ID=soil-1
ExecStart=$PYTHON_BIN -m app
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/spff-ai-dev-api.service <<EOF
# SPFF AI dev boot installer — API preview (no operational SPFF router)
[Unit]
Description=SPFF Unified AI DEV read-only Node preview API
After=network.target spff-ai-dev-python.service
Wants=spff-ai-dev-python.service

[Service]
Type=simple
User=$OWNER
Group=$OWNER_GROUP
WorkingDirectory=$REPO
Environment=SPFF_AI_STAGING=true
Environment=AI_PREVIEW_API_PORT=5002
Environment=AI_PREVIEW_PYTHON_PORT=5011
ExecStart=$NODE_BIN $API_ENTRY
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/spff-ai-dev-web.service <<EOF
# SPFF AI dev boot installer — Vite preview (one AI-only page)
[Unit]
Description=SPFF Unified AI DEV Vite dashboard preview
After=network.target spff-ai-dev-api.service
Wants=spff-ai-dev-api.service

[Service]
Type=simple
User=$OWNER
Group=$OWNER_GROUP
WorkingDirectory=$REPO/frontend
Environment=VITE_SPFF_AI_PREVIEW=true
ExecStart=$NODE_BIN $VITE_ENTRY --host 127.0.0.1 --port 5174 --strictPort
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

chmod 644 /etc/systemd/system/spff-ai-dev-{python,api,web}.service
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/spff-ai-dev-{python,api,web}.service
# Enable only: don't clash with the three manually running preview processes.
systemctl enable spff-ai-dev-python.service spff-ai-dev-api.service spff-ai-dev-web.service

echo
echo 'PASS: ketiga service DEV enabled untuk reboot selanjutnya.'
echo 'Tidak ada service yang dijalankan atau di-restart oleh installer.'
echo 'Setelah reboot, verifikasi:'
echo '  systemctl status spff-ai-dev-{python,api,web} --no-pager'
echo '  sudo ss -ltnp | grep -E ":(5011|5002|5174)\b"'
echo '  curl -fsS http://127.0.0.1:5011/health'
echo '  curl -fsS http://127.0.0.1:5002/api/health'
echo 'Buka via laptop SSH tunnel: ssh -N -L 5174:127.0.0.1:5174 orangepi@ORANGE_PI'
echo 'Polling AI tetap OFF; hasil keputusan akan STALE sampai evaluasi manual berikutnya.'
