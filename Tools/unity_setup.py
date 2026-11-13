#!/usr/bin/env python3
"""Fetch verified Unity metadata; optionally download/extract/probe without activation."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import urllib.request

VERSION = '6000.3.27f1'
API = 'https://services.api.unity.com/unity/editor/release/v1/releases?version=' + VERSION
EXPECTED_URL = 'https://download.unity3d.com/download_unity/672d562a42a7/LinuxEditorInstaller/Unity-6000.3.27f1.tar.xz'
EXPECTED_INTEGRITY = 'md5-69RDiGob9OioUv1r1ufMTA=='

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory', type=Path, required=True, help='Outside repository')
    p.add_argument('--download', action='store_true')
    p.add_argument('--extract', action='store_true')
    p.add_argument('--probe', action='store_true')
    args = p.parse_args()
    directory = args.directory.resolve()
    repo = Path(__file__).resolve().parents[1]
    if directory == repo or repo in directory.parents:
        p.error('Use a toolchain directory outside the public repository')
    directory.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(API, timeout=45) as response:
        data = json.load(response)
    release = next(r for r in data['results'] if r['version'] == VERSION)
    download = next(d for d in release['downloads']
                    if d['platform'] == 'LINUX' and d['architecture'] == 'X86_64')
    assert download['url'] == EXPECTED_URL, 'Unexpected official URL; review before proceeding'
    assert download['integrity'] == EXPECTED_INTEGRITY, 'Release metadata changed; review required'
    print(json.dumps({'version': VERSION, 'url': EXPECTED_URL,
                      'download_bytes': download['downloadSize']['value']}, indent=2), flush=True)
    archive = directory / ('unity-' + VERSION + '.tar.xz')
    install = directory / ('unity-' + VERSION)
    if args.download and not archive.exists():
        partial = archive.with_suffix('.partial')
        with urllib.request.urlopen(EXPECTED_URL, timeout=60) as src, partial.open('wb') as dst:
            while chunk := src.read(8 * 1024 * 1024):
                dst.write(chunk)
        partial.replace(archive)
    if args.download or args.extract:
        assert archive.stat().st_size == download['downloadSize']['value'], 'Archive size mismatch'
        digest = hashlib.md5()
        with archive.open('rb') as src:
            while chunk := src.read(16 * 1024 * 1024):
                digest.update(chunk)
        actual = 'md5-' + base64.b64encode(digest.digest()).decode()
        assert actual == EXPECTED_INTEGRITY, 'Archive integrity mismatch'
        print('ARCHIVE_INTEGRITY PASS', flush=True)
    if args.extract:
        install.mkdir(exist_ok=True)
        with tarfile.open(archive) as tf:
            tf.extractall(install, filter='data')
    if args.probe:
        executable = install / 'Editor' / 'Unity'
        # Version query only. Does not activate a license or accept terms on the owner's behalf.
        run = subprocess.run([str(executable), '-version'], timeout=60, capture_output=True, text=True)
        print(json.dumps({'probe_exit_code': run.returncode,
                          'output': (run.stdout + run.stderr).strip()}, indent=2), flush=True)
        return run.returncode
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
