#!/usr/bin/env python3
"""Inspect readiness without installing software, activating licenses, or modifying game data."""
import argparse
import hashlib
import json
import platform
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = 'HairStudio_AI_Development_Masterplan_zh-HK.md'
EXPECTED_SPEC_SHA256 = '8b49e95d73e497ccc16001d98b7e0beb4deb005f7d969a6709a75bc21fad9da3'

def probe(command):
    try:
        run = subprocess.run(command, capture_output=True, text=True, timeout=30)
        return {'exit_code': run.returncode, 'output': (run.stdout + run.stderr).strip()[:1500]}
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {'exit_code': None, 'output': str(exc)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--unity', type=Path, help='Explicit installed Editor executable')
    args = parser.parse_args()
    actual = hashlib.sha256((ROOT / SPEC).read_bytes()).hexdigest()
    checks = {
        'spec_unchanged': actual == EXPECTED_SPEC_SHA256,
        'planning_documents': all((ROOT / name).is_file() for name in
            ['DECISIONS.md', 'RISKS.md', 'VERSIONS.lock.md', 'HAIR_DOMAIN.md',
             'Docs/phase1-2-work-orders.md', 'Docs/requirements-checklist.md']),
    }
    blender = shutil.which('blender')
    xcode = shutil.which('xcodebuild')
    unity = str(args.unity.resolve()) if args.unity else shutil.which('Unity') or shutil.which('unity')
    report = {'schema_version': 1, 'os': platform.system(), 'machine': platform.machine(),
              'checks': checks, 'spec_sha256': actual,
              'tools': {'git': probe(['git', '--version']), 'git_lfs': probe(['git', 'lfs', 'version']),
                        'blender': probe([blender, '--version']) if blender else None,
                        'unity_executable': unity, 'unity_version': probe([unity, '-version']) if unity else None, 'xcode_on_path': xcode},
              'readiness': {'repository_checks': 'PASS' if all(checks.values()) else 'FAIL',
                            'unity_project_build': 'NOT_TESTED', 'apple_device_build': 'NOT_TESTED'},
              'note': 'Tool presence does not prove Unity licensing, project compilation or device support.'}
    text = json.dumps(report, indent=2, ensure_ascii=False) + '\n'
    print(text, end='')
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text)
    return 0 if all(checks.values()) else 1

if __name__ == '__main__':
    raise SystemExit(main())
