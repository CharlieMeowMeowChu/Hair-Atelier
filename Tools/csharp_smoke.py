#!/usr/bin/env python3
"""Compile and execute an isolated C# toolchain fixture, without Unity APIs."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--editor', type=Path, required=True, help='Path to Editor directory')
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
mono_root = a.editor.resolve() / 'Data' / 'MonoBleedingEdge'
mono = mono_root / 'bin' / 'mono'
compiler = mono_root / 'lib' / 'mono' / '4.5' / 'csc.exe'
source = '''using System;
using System.IO;
class EnvironmentSmoke {
  static int Main() {
    string file = Path.Combine(Path.GetTempPath(), "hair-env-" + Guid.NewGuid() + ".txt");
    try {
      File.WriteAllText(file, "Hair Atelier 環境測試");
      if (File.ReadAllText(file) != "Hair Atelier 環境測試") return 2;
      Console.WriteLine("CSHARP_ENVIRONMENT_SMOKE PASS: compile, execute, UTF-8 file round-trip");
      return 0;
    } finally { if (File.Exists(file)) File.Delete(file); }
  }
}'''
with tempfile.TemporaryDirectory(prefix='hair-csharp-smoke-') as temp:
    root = Path(temp)
    (root / 'Smoke.cs').write_text(source)
    compile_run = subprocess.run([str(mono), str(compiler), '-nologo', '-out:' + str(root / 'Smoke.exe'),
                                  str(root / 'Smoke.cs')], capture_output=True, text=True, timeout=30)
    result = {'scope': 'Standalone C# toolchain only; no Unity project/API/HAIR test',
              'compile_exit_code': compile_run.returncode,
              'compile_output': (compile_run.stdout + compile_run.stderr).strip()}
    if compile_run.returncode == 0:
        execute = subprocess.run([str(mono), str(root / 'Smoke.exe')], capture_output=True,
                                 text=True, timeout=30)
        result.update(execute_exit_code=execute.returncode, output=(execute.stdout+execute.stderr).strip())
    result['status'] = 'PASS' if result.get('execute_exit_code') == 0 else 'FAIL'
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result['status'] == 'PASS' else 1)
