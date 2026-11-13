import { expect, it } from 'vitest';
import { BufferGeometry, Line, LineBasicMaterial, Raycaster, Vector3 } from 'three';
import { createDemoHairState, HairEditor, parseEditorHistory, type HairState } from './hair-core';
import { visibleHairSamples } from './visible-hair';
import { projectPointToArcSegment } from './line-arc';

it('maps a ray hit on an extended tail to the correct cut and restores it via undo and reload', () => {
  const demo = createDemoHairState();
  const state: HairState = { ...demo, strands: demo.strands.map((strand) => strand.id === 'C'
    ? { ...strand, root: [0.3, 0, 0] as const, direction: [1, 0, 0] as const, length: 0.4, maximumLength: 0.6 }
    : strand) };
  const editor = new HairEditor(state);
  expect(editor.growBy('C', 0.4).changed).toBe(true);
  const strand = editor.exportState().strands.find((item) => item.id === 'C')!;
  const head = { center: [0, 0, 0] as const, radii: [0.22, 0.2464, 0.2024] as const, clearance: 0.018 };
  const samples = visibleHairSamples(strand, head);
  const points = samples.map((sample) => new Vector3(...sample.point));
  const line = new Line(new BufferGeometry().setFromPoints(points), new LineBasicMaterial());
  line.updateMatrixWorld(true);
  const desiredS = 0.635;
  const raycaster = new Raycaster(new Vector3(0.3 + desiredS, 0, 1), new Vector3(0, 0, -1));
  raycaster.params.Line = { threshold: 0.001 };
  const hit = raycaster.intersectObject(line)[0];
  expect(hit).toBeDefined();
  const index = hit.index!;
  const projected = projectPointToArcSegment([hit.point.x, hit.point.y, hit.point.z], {
    a: samples[index].point, b: samples[index + 1].point, s0: samples[index].s, s1: samples[index + 1].s,
  });
  expect(projected.s).toBeCloseTo(desiredS, 6);
  const before = editor.exportState();
  expect(editor.cutAt('C', projected.s).changed).toBe(true);
  expect(editor.exportState().strands.find((item) => item.id === 'C')!.length).toBeCloseTo(desiredS, 6);
  expect(editor.exportState().strands.filter((item) => item.id !== 'C')).toEqual(before.strands.filter((item) => item.id !== 'C'));
  const history = parseEditorHistory(JSON.stringify(editor.exportHistory()))!;
  const restored = new HairEditor(history.current, history);
  restored.undo();
  expect(restored.exportState()).toEqual(before);
  restored.redo();
  expect(restored.exportState().strands.find((item) => item.id === 'C')!.length).toBeCloseTo(desiredS, 6);
});
