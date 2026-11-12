import { describe, expect, it } from 'vitest';
import { Triangle, Vector3 } from 'three';
import { createDemoHairState, HairEditor } from './hair-core';
import { fullHairSamples } from './visible-hair';
import { buildVisibleRibbon } from './visible-ribbon';
import { buildRibbonGeometryData, type RibbonGeometryData } from './ribbon-geometry';

const head = { center: [0, 0, 0] as const, radii: [0.22, 0.2464, 0.2024] as const, clearance: 0.018 };
function triangles(geometry: RibbonGeometryData): Triangle[] {
  const point = (index: number) => new Vector3().fromArray(geometry.positions, index * 3);
  const result: Triangle[] = [];
  for (let i = 0; i < geometry.indices.length; i += 3) result.push(new Triangle(point(geometry.indices[i]), point(geometry.indices[i + 1]), point(geometry.indices[i + 2])));
  return result;
}
describe('visible ribbon clipping', () => {
  it('keeps the cut and grown ribbon on the original curved surface, including undo and redo', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 });
    const strand = () => editor.exportState().strands.find((value) => value.id === 'C')!;
    const full = fullHairSamples(strand(), head);
    const original = triangles(buildRibbonGeometryData(full.map((sample) => sample.point), 0.006, head));
    const verify = () => {
      const visible = buildVisibleRibbon(fullHairSamples(strand(), head), strand().length, 0.006, head);
      expect(visible.indices.length).toBeGreaterThan(0);
      const nearest = new Vector3();
      for (let i = 0; i < visible.positions.length; i += 3) {
        const p = new Vector3().fromArray(visible.positions, i);
        const distance = Math.min(...original.map((triangle) => triangle.closestPointToPoint(p, nearest).distanceTo(p)));
        expect(distance).toBeLessThan(0.000001);
      }
    };
    editor.cutAt('C', 0.1973);
    verify();
    editor.growBy('C', 0.05);
    verify();
    editor.undo();
    verify();
    editor.redo();
    verify();
  });
});
