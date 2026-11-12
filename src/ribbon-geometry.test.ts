import { describe, expect, it } from 'vitest';
import { buildRibbonGeometryData } from './ribbon-geometry';

function pointAt(data: Float32Array, vertex: number): [number, number, number] {
  return [data[vertex * 3], data[vertex * 3 + 1], data[vertex * 3 + 2]];
}

describe('guide ribbon geometry', () => {
  it('creates paired vertices and triangles around a straight centreline', () => {
    const geometry = buildRibbonGeometryData([[0, 0, 0], [0, -0.2, 0], [0, -0.4, 0]], 0.006);
    expect(geometry.positions).toHaveLength(18);
    expect(geometry.indices).toEqual(new Uint32Array([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]));
    for (const vertex of [0, 2, 4]) {
      const left = pointAt(geometry.positions, vertex);
      const right = pointAt(geometry.positions, vertex + 1);
      expect(Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])).toBeCloseTo(0.006, 7);
      expect((left[0] + right[0]) / 2).toBeCloseTo(0, 6);
      expect((left[1] + right[1]) / 2).toBeCloseTo(-0.2 * (vertex / 2), 6);
      expect((left[2] + right[2]) / 2).toBeCloseTo(0, 6);
    }
  });

  it('keeps finite, non-zero-width pairs through a curved or repeated sample', () => {
    const geometry = buildRibbonGeometryData([[0, 0, 0], [0, -0.1, 0], [0, -0.1, 0], [0.1, -0.2, 0]], 0.004);
    expect([...geometry.positions].every(Number.isFinite)).toBe(true);
    for (let vertex = 0; vertex < geometry.positions.length / 3; vertex += 2) {
      const left = pointAt(geometry.positions, vertex);
      const right = pointAt(geometry.positions, vertex + 1);
      expect(Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])).toBeCloseTo(0.004, 7);
    }
  });

  it('returns empty geometry for invalid ribbons', () => {
    expect(buildRibbonGeometryData([[0, 0, 0]], 0.004)).toEqual({ positions: new Float32Array(), indices: new Uint32Array() });
    expect(buildRibbonGeometryData([[0, 0, 0], [0, -0.1, 0]], 0)).toEqual({ positions: new Float32Array(), indices: new Uint32Array() });
  });
});

it('keeps rendered ribbon triangles outside the demo head through curl, cut and growth', async () => {
  const { createDemoHairState, HairEditor } = await import('./hair-core');
  const { visibleHairSamples } = await import('./visible-hair');
  const collider = { center: [0, 0, 0] as const, radii: [0.22, 0.2464, 0.2024] as const, clearance: 0.018 };
  const editor = new HairEditor(createDemoHairState());
  const check = () => {
    for (const strand of editor.exportState().strands) {
      const geometry = buildRibbonGeometryData(visibleHairSamples(strand, collider).map((sample) => sample.point), 0.006, collider);
      for (let i = 0; i < geometry.indices.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map((j) => pointAt(geometry.positions, geometry.indices[i + j]));
        for (let u = 0; u <= 10; u += 1) for (let v = 0; v <= 10 - u; v += 1) {
          const w = 10 - u - v;
          const point = a.map((value, n) => (value * u + b[n] * v + c[n] * w) / 10 / collider.radii[n]);
          expect(Math.hypot(...point)).toBeGreaterThanOrEqual(1 - 1e-6);
        }
      }
    }
  };
  check();
  editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 });
  check();
  editor.cutAt('C', 0.1973);
  check();
  editor.growBy('C', 0.05);
  check();
});
