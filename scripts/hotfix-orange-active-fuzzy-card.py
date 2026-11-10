#!/usr/bin/env python3
"""Patch the Fuzzy card in one known frontend build, without rebuilding it."""
import argparse
import fcntl
import hashlib
import os
import tempfile
from pathlib import Path


INDEX_HASH = '160b87f48ef3d78925709872e909208dedf7c2f2162648046226dc590e7fcadb'
STAMP = '-repair-20261109T173748Z-34851-'
HASHES = {
    'index-Ck2nRrTt.js': 'b3001456835a54230a61892df9ffa245765bcaf8ac081a35683be9412ec98af2',
    'AutomationMethod-DBNPunWC.js': 'f421c0d32b1329881a43806b92f77f52342cb3eddab99b3512122a1760113770',
    'GuidePage-C_S3okaD.js': 'c71e42089dd035540792bc3c979047f326927d619afd1b7beb58c71d770c18d2',
    'GuidePrograms-BFduzawE.js': 'be966f30fefdfe5a0f5db0905dfcb158b9a1ab04144bf0e5f413cbedf52a986e',
    'HstApprovalPanel-DRQkKlcl.js': '17b5628ea08e8a77cc6eaf2b5adfb5d1425f668c45c68e387d59efbf008ba075',
}
CARD = 'HstApprovalPanel-DRQkKlcl.js'
SELECTOR = """function selectCurrentFuzzy(data) {
 const preview = data?.fuzzy_preview;
 const recorded = Date.parse(data?.planning_recorded_at ?? "");
 if (data?.planning_status === "CURRENT" && preview && Number.isFinite(recorded)
     && Date.parse(preview.recorded_at ?? "") === recorded
     && Number.isFinite(preview.illustrative_water_l) && preview.illustrative_water_l >= 0) {
  const guide = preview.basis === "OPERATIONAL_PROFILE";
  return {kind: "demand_preview", valueL: preview.illustrative_water_l,
   label: guide ? "Kebutuhan air · profil Panduan" : "Kebutuhan air · simulasi Fuzzy",
   note: guide ? "Estimasi dari profil Panduan." : "Estimasi simulasi dari kelembapan tanah."};
 }
 return r(data);
}
""".encode()


def verified(path, expected):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit(f'STOP: build differs from verified version: {path}')
    return data


def prepare(root):
    html = verified(root / 'index.html', INDEX_HASH)
    assets = {}
    for name, digest in HASHES.items():
        old = name.replace('-', STAMP, 1)
        data = verified(root / 'assets' / old, digest)
        if name == CARD:
            anchor = b'D=r(c);'
            if data.count(anchor) != 1:
                raise SystemExit('STOP: unexpected Fuzzy card selector')
            data = data.replace(anchor, b'D=selectCurrentFuzzy(c);') + b'\n' + SELECTOR
        assets[old] = data
    return html, assets


def write_atomic(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
        temp = Path(output.name)
        try:
            output.write(data)
            output.close()
            temp.chmod(0o644)
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)


def publish(root, backups, html, assets):
    backup = Path(tempfile.mkdtemp(prefix='fuzzy-card-live-', dir=backups))
    (backup / 'index-before.html').write_bytes(html)
    mapping = {name: name.replace('.js', f'-{backup.name}.js') for name in assets}
    for old, new in mapping.items():
        html = html.replace(old.encode(), new.encode())
    for name, data in assets.items():
        for old, new in mapping.items():
            data = data.replace(old.encode(), new.encode())
        write_atomic(root / 'assets' / mapping[name], data)
    write_atomic(root / 'index.html', html)
    print(f'FUZZY_CARD_PUBLISHED backup={backup}/index-before.html')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = Path('/opt/spff/frontend/dist')
    if not args.apply:
        prepare(root)
        print('FUZZY_CARD_PREFLIGHT_OK')
        return
    with open('/run/lock/spff-hst-prod-rollout.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        html, assets = prepare(root)
        publish(root, Path('/mnt/spff-data/backups'), html, assets)


if __name__ == '__main__':
    main()
