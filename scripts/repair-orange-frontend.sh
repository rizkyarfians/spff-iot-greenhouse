#!/usr/bin/env bash
# Recover the live web build independently from the API and pump services.
set -Eeuo pipefail
umask 022
[[ "$EUID" == 0 ]] || { echo "STOP: run with sudo"; exit 1; }
if [[ "${1:-}" == '--lock-held' ]]; then
 [[ "$(readlink /proc/self/fd/9)" == /run/lock/spff-hst-prod-rollout.lock ]] ||
  { echo "STOP: deployment lock descriptor missing"; exit 1; }
else
 exec 9>/run/lock/spff-hst-prod-rollout.lock
fi
flock -n 9 || { echo "STOP: SPFF deployment lock occupied"; exit 1; }

repo="$(cd "$(dirname "$0")/.." && pwd)"
store=/mnt/spff-data/backups
live=/opt/spff/frontend/dist
[[ -d "$live/assets" && -f "$live/index.html" && ! -L "$live" ]] ||
 { echo "STOP: active frontend layout unexpected"; exit 1; }

latest=''
for run in "$store"/hst-backend-*; do
 if [[ -f "$run/deploy.exit" && $(cat "$run/deploy.exit") == 0 &&
       -f "$run/merged-build/frontend/vite.config.ts" &&
       "$run" > "$latest" ]]; then
  latest="$run"
 fi
done
[[ -n "$latest" ]] || { echo "STOP: no successful merged frontend source found"; exit 1; }

frontend="$latest/merged-build/frontend"
vite=''
for candidate in "$frontend/node_modules/.bin/vite" "$frontend/../node_modules/.bin/vite"; do
 if [[ -x "$candidate" ]]; then vite="$candidate"; break; fi
done
[[ -n "$vite" ]] || { echo "STOP: Vite missing from the previous successful build"; exit 1; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
repair="$store/frontend-repair-$stamp"
mkdir -m 700 "$repair"
config="$frontend/.repair-vite-$stamp.mjs"
cleanup(){
 local result=$?
 rm -f -- "$config"
 if (( result != 0 )) && [[ -f "$repair/App-before.tsx" ]]; then
  cp -a "$repair/App-before.tsx" "$frontend/src/App.tsx"
 fi
 if (( result != 0 )) && [[ -d "$repair/guide-before" ]]; then
  cp -a "$repair/guide-before/." "$frontend/src/"
 fi
 if (( result != 0 )) && [[ -d "$repair/sensors-before" ]]; then
  cp -a "$repair/sensors-before/." "$frontend/src/"
 fi
}
trap cleanup EXIT
if [[ "${1:-}" == '--sensor-groups' ]]; then
 repo="$(cd "$(dirname "$0")/.." && pwd)"
 mkdir "$repair/sensors-before"
 for file in App.tsx App.css dashboardSensors.ts; do
  cp -a "$frontend/src/$file" "$repair/sensors-before/$file"
 done
 install -m 644 "$repo/frontend/src/dashboardSensors.ts" "$frontend/src/dashboardSensors.ts"
 node "$repo/scripts/merge-dashboard-sensor-groups.cjs" "$repo" "$frontend/src/App.tsx"
fi
if [[ "${1:-}" == '--guide' ]]; then
 repo="$(cd "$(dirname "$0")/.." && pwd)"
 mkdir "$repair/guide-before"
 for file in HstApprovalPanel.tsx HstApprovalPanel.css HstDoseVolumeCard.tsx; do
  cp -a "$frontend/src/$file" "$repair/guide-before/$file"
  install -m 644 "$repo/frontend/src/$file" "$frontend/src/$file"
 done
fi
if [[ "${1:-}" == '--controller-status' ]]; then
 cp -a "$frontend/src/App.tsx" "$repair/App-before.tsx"
 python3 - "$frontend/src/App.tsx" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text(encoding='utf-8')
start = source.index('<div className="drawer-device-card"')
end = source.index('className="drawer-profile"', start)
card = source[start:end]
if 'Status alat telat' not in card:
    for old, new, required in (
        ('Data Terlambat', 'Status alat telat', True),
        ('Data masuk ${telemetryAgeLabel', 'Sensor diperbarui ${telemetryAgeLabel', True),
        ('Data terlambat ·', 'Data sensor terlambat ·', False),
        ('Menunggu data baru ·', 'Menunggu data sensor ·', False),
    ):
        if card.count(old) > 1 or (required and old not in card):
            raise SystemExit('STOP: controller status label changed: ' + old)
        card = card.replace(old, new, 1)
    marker = card.index('</small>') + len('</small>')
    card = card[:marker] + """
          {connectionState === 'connected' && primaryDevice?.connectionStatus === 'stale' &&
            <small>Status alat terakhir {formatTelemetryAge(primaryDevice.recordedAt, clock.getTime()) ?? 'belum diketahui'}</small>}
""" + card[marker:]
    path.write_text(source[:start] + card + source[end:], encoding='utf-8')
PY
fi
cat > "$config" <<CONFIG
import {defineConfig,mergeConfig} from 'vite';
import original from './vite.config.ts';
export default defineConfig(async env=>mergeConfig(
 typeof original==='function'?await original(env):await original,
 {build:{rolldownOptions:{output:{
  entryFileNames:'assets/[name]-repair-$stamp-[hash].js',
  chunkFileNames:'assets/[name]-repair-$stamp-[hash].js',
 }}}}
));
CONFIG

echo "Frontend source: $frontend"
(cd "$frontend" && "$vite" build --config "$config" --outDir "$repair/dist" --manifest)
node --input-type=module - "$repair/dist" "$stamp" <<'VERIFY'
import {readFileSync,statSync} from 'node:fs';
import {resolve,sep} from 'node:path';
const root=resolve(process.argv[2]),stamp=process.argv[3];
const manifest=JSON.parse(readFileSync(resolve(root,'.vite/manifest.json'),'utf8'));
const index=readFileSync(resolve(root,'index.html'),'utf8');
const files=new Set();
for(const entry of Object.values(manifest)){
 for(const ref of [...(entry.imports??[]),...(entry.dynamicImports??[])]){
  if(!manifest[ref])throw Error('Missing manifest dependency: '+ref);
 }
 for(const file of [entry.file,...(entry.assets??[]),...(entry.css??[])]){
  const path=resolve(root,file);
  if(!path.startsWith(root+sep)||!statSync(path).isFile()||statSync(path).size===0)throw Error('Missing file: '+file);
  files.add(file);
 }
}
for(const name of ['GuidePage','GuidePrograms']){
 const page=manifest['src/'+name+'.tsx'];
 if(!page?.file.includes('-repair-'+stamp+'-'))throw Error('Missing or unversioned '+name+' chunk');
}
if(!Object.values(manifest).some(entry=>entry.isEntry&&entry.file.includes('-repair-'+stamp+'-')&&index.includes(entry.file)))
 throw Error('index.html does not reference the repaired entry');
console.log('FRONTEND_MANIFEST=PASS; files='+files.size);
VERIFY

chmod -R a+rX "$repair/dist"
cp -a "$live/index.html" "$repair/index-before.html"
# Keep old tabs' assets; restore conflicting bytes from the verified build with backups.
node "$repo/scripts/publish-orange-frontend.mjs" "$repair/dist" "$live" "$repair"

echo "FRONTEND_REPAIR=SUCCESS; BACKUP=$repair/index-before.html"
