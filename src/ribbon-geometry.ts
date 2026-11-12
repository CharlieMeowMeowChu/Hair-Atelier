import type { Vec3 } from './hair-core';
import type { EllipsoidCollider } from './head-collision';

export interface RibbonGeometryData {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

const epsilon = 1e-10;

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function add(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function scale(value: Vec3, amount: number): Vec3 {
  return [value[0] * amount, value[1] * amount, value[2] * amount];
}

function dot(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(value: Vec3, fallback: Vec3): Vec3 {
  const valueLength = Math.hypot(value[0], value[1], value[2]);
  return valueLength > epsilon ? scale(value, 1 / valueLength) : fallback;
}

function tangentAt(points: readonly Vec3[], index: number): Vec3 {
  for (let next = index + 1; next < points.length; next += 1) {
    const direction = subtract(points[next], points[index]);
    if (Math.hypot(...direction) > epsilon) return normalize(direction, [0, -1, 0]);
  }
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const direction = subtract(points[index], points[previous]);
    if (Math.hypot(...direction) > epsilon) return normalize(direction, [0, -1, 0]);
  }
  return [0, -1, 0];
}

function fallbackSide(tangent: Vec3): Vec3 {
  const reference: Vec3 = Math.abs(tangent[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return normalize(cross(tangent, reference), [0, 0, 1]);
}

function transportSide(previousSide: Vec3, tangent: Vec3): Vec3 {
  const projected = subtract(previousSide, scale(tangent, dot(previousSide, tangent)));
  return normalize(projected, fallbackSide(tangent));
}

/**
 * Derives a narrow, camera-independent ribbon from sampled guide points.
 * The ribbon is render-only; the GuideStrand centreline stays authoritative.
 */
export function buildRibbonGeometryData(points: readonly Vec3[], widthMeters: number, collider?: EllipsoidCollider): RibbonGeometryData {
  if (points.length < 2 || !Number.isFinite(widthMeters) || widthMeters <= 0) {
    return { positions: new Float32Array(), indices: new Uint32Array() };
  }
  const halfWidth = widthMeters / 2;
  // For any point on a centreline segment, minRadius * (normalised
  // distance - 1) is a conservative lower bound on distance to the head.
  // Limiting both endpoint offsets to that bound protects the whole triangle.
  const safeWidths = points.map(() => halfWidth);
  if (collider) {
    const normalized = (p: Vec3): Vec3 => [
      (p[0] - collider.center[0]) / collider.radii[0],
      (p[1] - collider.center[1]) / collider.radii[1],
      (p[2] - collider.center[2]) / collider.radii[2],
    ];
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = normalized(points[i]);
      const delta = subtract(normalized(points[i + 1]), a);
      const denominator = dot(delta, delta);
      const t = denominator > epsilon ? Math.max(0, Math.min(1, -dot(a, delta) / denominator)) : 0;
      const distance = Math.hypot(...add(a, scale(delta, t)));
      const safe = Math.max(0, Math.min(...collider.radii) * (distance - 1) - 0.000001);
      safeWidths[i] = Math.min(safeWidths[i], safe);
      safeWidths[i + 1] = Math.min(safeWidths[i + 1], safe);
    }
  }
  const positions = new Float32Array(points.length * 2 * 3);
  let side = fallbackSide(tangentAt(points, 0));
  for (let index = 0; index < points.length; index += 1) {
    const tangent = tangentAt(points, index);
    if (index > 0) side = transportSide(side, tangent);
    const left = add(points[index], scale(side, safeWidths[index]));
    const right = subtract(points[index], scale(side, safeWidths[index]));
    positions.set(left, index * 6);
    positions.set(right, index * 6 + 3);
  }
  const indices = new Uint32Array((points.length - 1) * 6);
  for (let index = 0; index < points.length - 1; index += 1) {
    const vertex = index * 2;
    indices.set([vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2], index * 6);
  }
  return { positions, indices };
}
