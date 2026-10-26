"""Blender-only environment smoke: meter scale and GLB round-trip, no game asset."""
import json
from pathlib import Path
import sys

import bpy

output = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1.0
bpy.ops.mesh.primitive_cube_add(size=0.2, location=(0, 0, 0))
cube = bpy.context.object
cube.name = 'EnvironmentOnly_20cmCube'
expected = tuple(cube.dimensions)
path = output / 'meter-scale.glb'
bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(path))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
assert len(meshes) == 1, f'Expected one mesh, got {len(meshes)}'
actual = tuple(meshes[0].dimensions)
error = max(abs(a-b) for a, b in zip(expected, actual))
assert error <= 1e-6, f'Meter scale round-trip error: {error}'
result = {'status': 'PASS', 'blender': bpy.app.version_string,
          'checks': ['headless_start', 'mesh_create', 'glb_export', 'glb_import', 'meter_scale'],
          'expected_dimensions_m': expected, 'actual_dimensions_m': actual,
          'max_error_m': error, 'fixture_bytes': path.stat().st_size,
          'scope': 'Environment smoke only; not F01 or any HAIR test'}
(output / 'blender-smoke.json').write_text(json.dumps(result, indent=2) + '\n')
print('HAIR_ENVIRONMENT_SMOKE ' + json.dumps(result))
