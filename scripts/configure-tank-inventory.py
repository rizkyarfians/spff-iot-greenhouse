"""Apply the operator's available-water policy without changing pump dispatch flags."""
import argparse
import json
import os
import re
import subprocess
import time
import urllib.request
from pathlib import Path

from ai_service_runtime import discover_runtime, SERVICES


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--service', choices=SERVICES, default=SERVICES[0])
    parser.add_argument('--actor', required=True)
    parser.add_argument('--reference', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('sudo is required')
    if not re.fullmatch(r'[A-Za-z0-9_.@-]{1,128}', args.actor) or not 10 <= len(args.reference) <= 300 or '\n' in args.reference or '\r' in args.reference:
        parser.error('Use a bounded actor and one-line operator reference')
    runtime = discover_runtime(args.service)
    digest = subprocess.check_output([str(runtime['python']), '-m', 'app.tank_inventory_policy'],
        cwd=runtime['root'], env=runtime['environment'], text=True, timeout=15).strip()
    if not re.fullmatch(r'[a-f0-9]{64}', digest):
        parser.error('Unexpected policy fingerprint; no configuration changed')
    content = ('# Operator: ' + args.actor + '\n# Reference: ' + args.reference + '\n[Service]\n'
        'Environment=AI_IRRIGATION_TARGET_POLICY=AVAILABLE_TANK\n'
        'Environment=AI_TANK_POLICY_APPROVAL=' + digest + '\n')
    if not args.apply:
        print(content)
        print('PREVIEW_ONLY; add --apply to save this calculation policy')
        return
    import fcntl
    lock = open('/run/lock/spff-ai-production-profile.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    target = Path('/etc/systemd/system') / (args.service + '.d') / '60-tank-inventory-policy.conf'
    apply_policy(target, content, args.service, runtime)


def apply_policy(target, content, service, runtime):
    target.parent.mkdir(parents=True, exist_ok=True)
    previous = target.read_bytes() if target.exists() else None
    temporary = target.with_suffix('.conf.tmp')
    try:
        temporary.write_text(content, encoding='utf-8')
        temporary.chmod(0o644)
        os.replace(temporary, target)
        subprocess.run(['systemctl', 'daemon-reload'], check=True)
        subprocess.run(['systemctl', 'restart', service], check=True)
        summary = None
        for attempt in range(15):
            try:
                with urllib.request.urlopen('http://127.0.0.1:5010/dashboard/summary', timeout=20) as response:
                    summary = json.load(response)
                break
            except (OSError, ValueError):
                time.sleep(1)
        active = discover_runtime(service)
        if active['root'] != runtime['root'] or active['python'] != runtime['python']:
            raise RuntimeError('Service directory/interpreter changed')
        if (summary is None or summary.get('production_fuzzy', {}).get('basis') != 'TANK_INVENTORY_FUZZY'
                or summary.get('operational_profile', {}).get('status') != 'TANK_BOUND'
                or summary['can_dispatch'] is not False
                or summary['production_fuzzy']['can_dispatch'] is not False):
            raise RuntimeError('Policy readback failed')
        print(json.dumps({'policy': 'AVAILABLE_TANK', 'applies_to': 'ALL_PROGRAMS',
            'operational_profile': summary['operational_profile'],
            'production_fuzzy': summary['production_fuzzy'], 'pump_commands': 'NONE'}, indent=2))
    except Exception:
        if previous is None:
            target.unlink(missing_ok=True)
        else:
            target.write_bytes(previous)
        subprocess.run(['systemctl', 'daemon-reload'], check=True)
        subprocess.run(['systemctl', 'restart', service], check=True)
        raise


if __name__ == '__main__':
    main()
