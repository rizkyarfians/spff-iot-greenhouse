#!/usr/bin/env bash
# Backport the reviewed Fuzzy card into the preserved production frontend.
set -Eeuo pipefail
umask 022
[[ "$EUID" == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
repo=${1:?Expected the local checkout containing the frontend repair script}
release=${2:?Expected the temporary Git repository containing the reviewed frontend}
test -r "$repo/scripts/repair-orange-frontend.sh"

exec 9>/run/lock/spff-hst-prod-rollout.lock
flock -n 9 || { echo 'SPFF deployment lock is occupied.' >&2; exit 1; }
store=/mnt/spff-data/backups
latest=''
for run in "$store"/hst-backend-*; do
  if [[ -f "$run/deploy.exit" && $(cat "$run/deploy.exit") == 0 &&
        -f "$run/merged-build/frontend/vite.config.ts" && "$run" > "$latest" ]]; then
    latest="$run"
  fi
done
test -n "$latest" || { echo 'Production frontend source not found.' >&2; exit 1; }
src="$latest/merged-build/frontend/src"
backup=$(mktemp -d "$store/fuzzy-card-source-XXXXXXXX")
for file in HstApprovalPanel.tsx hstIrrigationSummary.ts; do
  cp -a "$src/$file" "$backup/$file"
  git -c safe.directory="$release" -C "$release" show "FETCH_HEAD:frontend/src/$file" > "$backup/$file.reviewed"
done
restore_on_failure() {
  local result=$?
  if (( result != 0 )); then
    cp -a "$backup/HstApprovalPanel.tsx" "$backup/hstIrrigationSummary.ts" "$src/"
  fi
}
trap restore_on_failure EXIT

python3 - "$src" "$backup" <<'PY'
from pathlib import Path
import sys

src, backup = map(Path, sys.argv[1:])
panel_path = src / 'HstApprovalPanel.tsx'
summary_path = src / 'hstIrrigationSummary.ts'
panel = panel_path.read_text()
summary = summary_path.read_text()
reviewed_panel = (backup / 'HstApprovalPanel.tsx.reviewed').read_text()
reviewed_summary = (backup / 'hstIrrigationSummary.ts.reviewed').read_text()


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise SystemExit(f'STOP: unexpected frontend source around {old.splitlines()[0]}')
    return source.replace(old, new, 1)


def between(source, start, end):
    first = source.index(start)
    return source[first:source.index(end, first)]


if 'const demand = fuzzyIrrigationEstimate(liquid);' not in panel:
    old_import = "import { hstIrrigationDisplay } from './hstIrrigationSummary';"
    new_import = next(line for line in reviewed_panel.splitlines() if line.startswith('import { fuzzyIrrigationEstimate,'))
    panel = replace_once(panel, old_import, new_import)
    anchor = '  const irrigation = hstIrrigationDisplay(liquid);\n'
    panel = replace_once(panel, anchor, between(reviewed_panel, anchor, '\n  return <article'))
    panel = replace_once(
        panel,
        '        <div><small>{irrigation.label}</small><strong>{litres(irrigation.valueL)}</strong></div>\n',
        between(reviewed_panel, '        <div>\n          <small>Kebutuhan penyiraman', '      </div>\n    </section>'),
    )
    panel = replace_once(
        panel,
        '        <p>{litres(irrigation.valueL)}</p>\n        <small>{irrigation.note}</small>\n',
        between(reviewed_panel, '        <p>{litres(demand?.valueL)}</p>', '      </>}\n    </section>'),
    )

if 'export function fuzzyIrrigationEstimate(' not in summary:
    anchor = '}\ntype Display='
    fields = between(reviewed_summary, ' fuzzy_preview_blockers?:', anchor)
    summary = replace_once(summary, anchor, fields + anchor)
    anchor = '/** Select existing Python results only.'
    helpers = between(reviewed_summary, 'export function fuzzyIrrigationEstimate(', 'type TankReading=')
    summary = replace_once(summary, anchor, helpers + anchor)

if 'export function fuzzyUnavailableReason(' not in summary:
    raise SystemExit('STOP: existing Fuzzy helpers need review.')

panel_path.write_text(panel)
summary_path.write_text(summary)
print(f'Fuzzy card source updated: {src}')
PY

bash "$repo/scripts/repair-orange-frontend.sh" --lock-held
echo "Fuzzy card source backup: $backup"
