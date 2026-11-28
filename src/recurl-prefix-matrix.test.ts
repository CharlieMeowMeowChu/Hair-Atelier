import { describe, expect, it } from 'vitest';
import { Line3, Triangle, Vector3 } from 'three';
import { createDemoHairState, HairEditor } from './hair-core';
import { fullHairSamples } from './visible-hair';
import { buildVisibleRibbon } from './visible-ribbon';
import type { RibbonGeometryData } from './ribbon-geometry';

const head = { center: [0, 0, 0] as const, radii: [0.22, 0.2464, 0.2024] as const, clearance: 0.018 };

function triangles(geometry: RibbonGeometryData): Triangle[] {
  const vertex = (index: number) => new Vector3().fromArray(geometry.positions, index * 3);
  const result: Triangle[] = [];
  for (let i = 0; i < geometry.indices.length; i += 3) {
    result.push(new Triangle(vertex(geometry.indices[i]), vertex(geometry.indices[i + 1]), vertex(geometry.indices[i + 2])));
  }
  return result;
}

function distanceToTriangle(point: Vector3, triangle: Triangle): number {
  if (triangle.getArea() > 1e-12) return triangle.closestPointToPoint(point, new Vector3()).distanceTo(point);
  const edges = [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]];
  return Math.min(...edges.map(([a, b]) => a.distanceToSquared(b) < 1e-20
    ? a.distanceTo(point) : new Line3(a, b).closestPointToPoint(point, true, new Vector3()).distanceTo(point)));
}

// Sample each triangle's vertices, edge midpoints and centroid. Checking in
// both directions catches gaps as well as newly displaced surface pieces.
function directedSurfaceDistance(source: Triangle[], target: Triangle[]): number {
  let maximum = 0;
  for (const triangle of source) {
    const { a, b, c } = triangle;
    const samples = [a, b, c, a.clone().add(b).multiplyScalar(0.5), b.clone().add(c).multiplyScalar(0.5),
      c.clone().add(a).multiplyScalar(0.5), a.clone().add(b).add(c).multiplyScalar(1 / 3)];
    for (const point of samples) {
      let nearest = Infinity;
      for (const other of target) nearest = Math.min(nearest, distanceToTriangle(point, other));
      maximum = Math.max(maximum, nearest);
    }
  }
  return maximum;
}

// Scaling to a unit sphere makes nearest-point distance test the interior and
// edges of each triangle, including degenerate triangles at a narrow root.
function minimumHeadDistance(surface: Triangle[]): number {
  const normalize = (point: Vector3) => new Vector3(
    (point.x - head.center[0]) / head.radii[0],
    (point.y - head.center[1]) / head.radii[1],
    (point.z - head.center[2]) / head.radii[2],
  );
  const origin = new Vector3();
  let minimum = Infinity;
  for (const triangle of surface) {
    minimum = Math.min(minimum, distanceToTriangle(origin,
      new Triangle(normalize(triangle.a), normalize(triangle.b), normalize(triangle.c))));
  }
  return minimum;
}

describe('middle re-curl prefix matrix', () => {
  it('preserves the visible prefix and keeps the full ribbon outside the head', () => {
    for (const startS of [0.043, 0.095, 0.103, 0.12, 0.123, 0.153, 0.2, 0.205]) {
      for (const direction of [-1, 1] as const) {
        const context = `start=${startS}, direction=${direction}`;
        const editor = new HairEditor(createDemoHairState());
        const curl = { radius: 0.025, pitch: 0.08, phase: 0.3 };
        expect(editor.curlRange('C', { startS: 0.04, endS: 0.4, ...curl, direction: 1 }).changed, context).toBe(true);
        const surface = (length: number) => {
          const strand = editor.exportState().strands.find((item) => item.id === 'C')!;
          return triangles(buildVisibleRibbon(fullHairSamples(strand, head), length, 0.006, head));
        };
        const before = surface(startS);
        expect(editor.curlRange('C', { startS, endS: startS + 0.05, ...curl, direction }).changed, context).toBe(true);
        const after = surface(startS);
        const afterFull = surface(0.4);
        expect(before.length, context).toBeGreaterThan(0);
        expect(after.length, context).toBeGreaterThan(0);
        expect(afterFull.length, context).toBeGreaterThan(0);
        expect(directedSurfaceDistance(before, after), context).toBeLessThanOrEqual(0.0005);
        expect(directedSurfaceDistance(after, before), context).toBeLessThanOrEqual(0.0005);
        for (const ribbon of [before, after, afterFull]) {
          expect(minimumHeadDistance(ribbon), context).toBeGreaterThanOrEqual(1 - 1e-6);
        }
      }
    }
  });
});
