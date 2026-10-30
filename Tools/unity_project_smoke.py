#!/usr/bin/env python3
"""Probe temporary empty-project creation. No activation; no repository game project."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--unity', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
with tempfile.TemporaryDirectory(prefix='hair-unity-env-') as temp:
    root = Path(temp)
    log = root / 'editor.log'
    project = root / 'EmptyProject'
    command = [str(a.unity.resolve()), '-batchmode', '-nographics', '-createProject',
               str(project), '-quit', '-logFile', str(log)]
    try:
        run = subprocess.run(command, timeout=60, capture_output=True, text=True)
        exit_code = run.returncode
    except subprocess.TimeoutExpired:
        exit_code = None
    content = log.read_text(errors='replace') if log.exists() else ''
    # Preserve only diagnostic lines; raw licensing logs may include machine/account identifiers.
    diagnostics = [line for line in content.splitlines()
                   if 'No valid Unity Editor license found' in line
                   or 'Access token is unavailable' in line
                   or "'com.unity.editor.headless' was not found" in line]
    status = 'BLOCKED_LICENSE' if diagnostics else 'PASS' if exit_code == 0 else 'FAIL'
    result = {'scope': 'Temporary empty project; no game functionality', 'command': command,
              'exit_code': exit_code, 'status': status, 'diagnostics': diagnostics,
              'project_version_file_created': (project / 'ProjectSettings/ProjectVersion.txt').is_file(),
              'note': 'No license activated; no terms accepted. Raw logs remain local and are not published.'}
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if status == 'PASS' else 2 if status == 'BLOCKED_LICENSE' else 1)
