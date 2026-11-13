import { describe, expect, it } from 'vitest';
import { Triangle, Vector3 } from 'three';
import { createDemoHairState, HairEditor } from './hair-core';
import { fullHairSamples } from './visible-hair';
import { buildVisibleRibbon } from './visible-ribbon';

const head = { center: [0, 0, 0] as const, radii: [0.22, 0.2464, 0.2024] as const, clearance: 0.018 };

describe('visible ribbon under recorded-tail growth', () => {
  it('keeps the retained surface within 0.5 mm for different curls and tip positions', () => {
    for (const radius of [0.005, 0.025, 0.04]) {
      for (const direction of [-1, 1] as const) {
        for (const extra of [0.2, 0.205, 0.213]) {
          const editor = new HairEditor(createDemoHairState());
          expect(editor.curlRange('C', { startS: 0.04, endS: 0.4, radius, pitch: radius * 4, phase: 1.24, direction }).changed).toBe(true);
          expect(editor.growBy('C', extra).changed).toBe(true);
          const ribbon = () => {
            const strand = editor.exportState().strands.find((value) => value.id === 'C')!;
            return buildVisibleRibbon(fullHairSamples(strand, head), strand.length, 0.006, head);
          };
          const before = ribbon();
          expect(editor.growBy('C', 0.05).changed).toBe(true);
          const after = ribbon();
          const point = (index: number) => new Vector3().fromArray(after.positions, index * 3);
          const triangles: Triangle[] = [];
          for (let i = 0; i < after.indices.length; i += 3) {
            triangles.push(new Triangle(point(after.indices[i]), point(after.indices[i + 1]), point(after.indices[i + 2])));
          }
          expect(before.positions.length).toBeGreaterThan(0);
          const candidate = new Vector3();
          for (let i = 0; i < before.positions.length; i += 3) {
            const p = new Vector3().fromArray(before.positions, i);
            let minimum = Infinity;
            for (const triangle of triangles) {
              const distance = triangle.closestPointToPoint(p, candidate).distanceTo(p);
              if (Number.isFinite(distance)) minimum = Math.min(minimum, distance);
            }
            expect(minimum, `radius=${radius}, direction=${direction}, tip=${0.4 + extra}, vertex=${i / 3}`).toBeLessThanOrEqual(0.0005);
          }
        }
      }
    }
  });
});
