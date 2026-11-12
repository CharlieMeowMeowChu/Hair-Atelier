import type { HairCollisionSample } from './head-collision';
import { buildRibbonGeometryData, type RibbonGeometryData } from './ribbon-geometry';
import type { EllipsoidCollider } from './head-collision';

/** Clip the original triangles, preserving their actual surface and diagonal. */
export function buildVisibleRibbon(samples: readonly HairCollisionSample[], length: number, width: number, collider: EllipsoidCollider): RibbonGeometryData {
  const full = buildRibbonGeometryData(samples.map((sample) => sample.point), width, collider);
  type Vertex = { p: [number, number, number]; s: number };
  const positions: number[] = [];
  const indices: number[] = [];
  const vertex = (index: number): Vertex => ({ p: [full.positions[index * 3], full.positions[index * 3 + 1], full.positions[index * 3 + 2]], s: samples[Math.floor(index / 2)].s });
  for (let i = 0; i < full.indices.length; i += 3) {
    const triangle = [vertex(full.indices[i]), vertex(full.indices[i + 1]), vertex(full.indices[i + 2])];
    const polygon: Vertex[] = [];
    for (let j = 0; j < triangle.length; j += 1) {
      const a = triangle[j], b = triangle[(j + 1) % triangle.length];
      const insideA = a.s <= length, insideB = b.s <= length;
      if (insideA) polygon.push(a);
      if (insideA !== insideB) {
        const t = (length - a.s) / (b.s - a.s);
        polygon.push({ s: length, p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t] });
      }
    }
    if (polygon.length < 3) continue;
    const start = positions.length / 3;
    for (const item of polygon) positions.push(...item.p);
    for (let j = 1; j + 1 < polygon.length; j += 1) indices.push(start, start + j, start + j + 1);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}
