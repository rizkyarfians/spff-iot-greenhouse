#!/usr/bin/env bash
# Recover the live web build independently from the API and pump services.
set -Eeuo pipefail
umask 022
[[ "$EUID" == 0 ]] || { echo "STOP: run with sudo"; exit 1; }
exec 9>/run/lock/spff-hst-prod-rollout.lock
flock -n 9 || { echo "STOP: SPFF deployment lock occupied"; exit 1; }

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
temp_entry="$live/.index-$stamp"
trap 'rm -f -- "$config" "$temp_entry"' EXIT
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
# Publish dependencies before the entry. Old browser tabs keep access to their existing assets.
cp -an "$repair/dist/assets/." "$live/assets/"
while IFS= read -r -d '' file; do
 cmp -s "$file" "$live/assets/${file#"$repair/dist/assets/"}" ||
  { echo "STOP: asset verification failed for $file"; exit 1; }
done < <(find "$repair/dist/assets" -type f -print0)
install -m644 "$repair/dist/index.html" "$temp_entry"
mv -fT "$temp_entry" "$live/index.html"
echo "FRONTEND_REPAIR=SUCCESS; BACKUP=$repair/index-before.html"
