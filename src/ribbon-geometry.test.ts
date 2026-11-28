import { describe, expect, it } from 'vitest';
import { Line3, Triangle, Vector3 } from 'three';
import { buildRibbonGeometryData } from './ribbon-geometry';

function pointAt(data: Float32Array, vertex: number): [number, number, number] {
  return [data[vertex * 3], data[vertex * 3 + 1], data[vertex * 3 + 2]];
}

describe('guide ribbon geometry', () => {
  it('keeps the prior segment vertices fixed when the following segment approaches the head', () => {
    const collider = { center: [0, 0, 0] as const, radii: [1, 1, 1] as const, clearance: 0.018 };
    const polar = (radius: number, angle: number): [number, number, number] => [radius * Math.cos(angle), radius * Math.sin(angle), 0];
    const p0 = polar(1.02, 0.05), p1 = polar(1.02, 0.1);
    const before = buildRibbonGeometryData([p0, p1, polar(1.02, 0.15)], 0.006, collider);
    const after = buildRibbonGeometryData([p0, p1, polar(1.018, -0.28)], 0.006, collider);
    for (const geometry of [before, after]) {
      for (let i = 0; i < geometry.indices.length; i += 3) {
        const vertices = [0, 1, 2].map((j) => new Vector3(...pointAt(geometry.positions, geometry.indices[i + j])));
        const triangle = new Triangle(vertices[0], vertices[1], vertices[2]);
        const origin = new Vector3();
        const distance = triangle.getArea() > 1e-12
          ? triangle.closestPointToPoint(origin, new Vector3()).length()
          : Math.min(...vertices.map((point, index) => {
            const next = vertices[(index + 1) % 3];
            return point.distanceToSquared(next) < 1e-20 ? point.length() : new Line3(point, next).closestPointToPoint(origin, true, new Vector3()).length();
          }));
        expect(distance).toBeGreaterThanOrEqual(1 - 1e-6);
      }
    }
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const a = new Vector3(...pointAt(before.positions, vertex));
      const b = new Vector3(...pointAt(after.positions, vertex));
      expect(a.distanceTo(b)).toBeLessThanOrEqual(1e-7);
    }
  });

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
  const { fullHairSamples } = await import('./visible-hair');
  const { buildVisibleRibbon } = await import('./visible-ribbon');
  const { Triangle, Vector3, Line3 } = await import('three');
  const collider = { center: [0, 0, 0] as const, radii: [0.22, 0.2464, 0.2024] as const, clearance: 0.018 };
  const editor = new HairEditor(createDemoHairState());
  const check = () => {
    for (const strand of editor.exportState().strands) {
      const geometry = buildVisibleRibbon(fullHairSamples(strand, collider), strand.length, 0.006, collider);
      for (let i = 0; i < geometry.indices.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map((j) => pointAt(geometry.positions, geometry.indices[i + j]));
        const normalized = (p: number[]) => new Vector3(...p.map((value, n) => value / collider.radii[n]) as [number, number, number]);
        const vertices = [a, b, c].map(normalized);
        const triangle = new Triangle(...vertices as [InstanceType<typeof Vector3>, InstanceType<typeof Vector3>, InstanceType<typeof Vector3>]);
        const origin = new Vector3();
        const nearest = new Vector3();
        const distance = triangle.getArea() > 1e-12
          ? triangle.closestPointToPoint(origin, nearest).length()
          : Math.min(...vertices.map((point, n) => point.distanceToSquared(vertices[(n + 1) % 3]) < 1e-20 ? point.length() : new Line3(point, vertices[(n + 1) % 3]).closestPointToPoint(origin, true, new Vector3()).length()));
        expect(distance).toBeGreaterThanOrEqual(1 - 1e-6);
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
