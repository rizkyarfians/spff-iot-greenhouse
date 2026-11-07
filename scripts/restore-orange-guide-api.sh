#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$EUID" == 0 ]] || { echo 'STOP: jalankan dengan sudo'; exit 1; }
exec 9>/run/lock/spff-hst-prod-rollout.lock
flock -n 9 || { echo 'STOP: deploy lain sedang berjalan'; exit 1; }

api=/opt/spff/functions/lib
router="$api/routes/index.js"
backup=$(mktemp -d /mnt/spff-data/backups/guide-api-XXXXXX)
cp -a "$router" "$backup/index.js"

for module in unifiedAiDashboardController aiHstController doseVolumeController; do
  [[ -s "$api/controllers/$module.js" ]] || { echo "STOP: controller $module belum terpasang"; exit 1; }
done

python3 - "$router" "$backup/router.mjs" <<'PY'
from pathlib import Path
import re
import sys

source, target = map(Path, sys.argv[1:])
code = source.read_text(encoding='utf-8')
auth = re.search(r'apiRouter\.use\(\s*requireAuth\s*,?\s*\)\s*;', code)
if not auth:
    sys.exit('STOP: batas autentikasi router tidak ditemukan')

routes = [
    ('get', '/unified-ai/dashboard', 'guideDashboard', 'unifiedAiDashboardController', 'getUnifiedAiDashboard'),
    ('get', '/unified-ai/hst/mode', 'guideHst', 'aiHstController', 'getHstMode'),
    ('put', '/unified-ai/hst/mode', 'guideHst', 'aiHstController', 'putHstMode'),
    ('get', '/unified-ai/hst/proposals', 'guideHst', 'aiHstController', 'getHstProposals'),
    ('get', '/unified-ai/hst/dose-volume/sessions', 'guideDose', 'doseVolumeController', 'getDoseVolumeSessions'),
    ('get', '/unified-ai/hst/real-sessions/latest/:obligationId', 'guideHst', 'aiHstController', 'getHstRealLatest'),
]
imports = set()
entries = []
for method, path, alias, module, handler in routes:
    if re.search(rf"""apiRouter\.{method}\(\s*['"]""" + re.escape(path) + r"""['"]""", code):
        continue
    statement = f"import * as {alias} from '../controllers/{module}.js';"
    if statement not in code:
        imports.add(statement)
    if method == 'put':
        statement = "import { requireAdmin as guideModeAdmin, requireCsrf as guideModeCsrf } from '../middleware/operatorAuth.js';"
        middleware = 'guideModeAdmin, guideModeCsrf'
    else:
        statement = "import { requireOperator as guideReadOperator } from '../middleware/operatorAuth.js';"
        middleware = 'guideReadOperator'
    if statement not in code:
        imports.add(statement)
    entries.append(f"apiRouter.{method}('{path}', {middleware}, {alias}.{handler});")
if entries:
    code = '\n'.join(sorted(imports)) + '\n' + code[:auth.end()] + '\n' + '\n'.join(entries) + '\n' + code[auth.end():]
target.write_text(code, encoding='utf-8')
PY

node --check "$backup/router.mjs"
install -m 644 "$backup/router.mjs" "$router"
if systemctl restart spff-api.service; then
  for ((i=0;i<15;i++)); do
    if curl -fsS --max-time 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
      grep -nE '/unified-ai/(dashboard|hst/(mode|proposals|dose-volume/sessions|real-sessions/latest))' "$router"
      echo "GUIDE_API_ROUTES=RESTORED; BACKUP=$backup/index.js"
      exit 0
    fi
    sleep 1
  done
fi

cp -a "$backup/index.js" "$router"
systemctl restart spff-api.service || true
journalctl -u spff-api.service -n 25 --no-pager -o cat
echo 'STOP: API gagal sehat; router lama dipulihkan'
exit 1
