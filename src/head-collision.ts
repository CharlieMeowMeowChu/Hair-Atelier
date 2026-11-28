import type { Vec3 } from './hair-core';

export interface EllipsoidCollider {
  readonly center: Vec3;
  readonly radii: Vec3;
  /** Extra visible distance between the guide centreline and the head surface. */
  readonly clearance: number;
}

const epsilon = 1e-8;

/**
 * Returns render/picking points that stay outside a head-shaped ellipsoid.
 * This is deliberately a presentation constraint: it never changes the
 * authoritative rest arc-length data used by cut, curl, grow, or history.
 */
export function keepHairOutsideEllipsoid(points: readonly Vec3[], collider: EllipsoidCollider): Vec3[] {
  const [cx, cy, cz] = collider.center;
  const [rx, ry, rz] = collider.radii;
  const clearance = Math.max(0, collider.clearance);
  return points.map(([x, y, z]) => {
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    const normalizedDistance = Math.hypot(dx / rx, dy / ry, dz / rz);
    const minimumDistance = 1 + clearance;
    if (normalizedDistance >= minimumDistance) return [x, y, z] as Vec3;

    // The rare exact-centre case has no radial direction. Push upward so the
    // result is deterministic and never leaves a point inside the head.
    if (normalizedDistance < epsilon) return [cx, cy + ry * minimumDistance, cz] as Vec3;
    const scale = minimumDistance / normalizedDistance;
    return [cx + dx * scale, cy + dy * scale, cz + dz * scale] as Vec3;
  });
}

export function isOutsideEllipsoid(point: Vec3, collider: EllipsoidCollider): boolean {
  const [cx, cy, cz] = collider.center;
  const [rx, ry, rz] = collider.radii;
  const distance = Math.hypot((point[0] - cx) / rx, (point[1] - cy) / ry, (point[2] - cz) / rz);
  return distance + epsilon >= 1 + Math.max(0, collider.clearance);
}

export interface HairCollisionSample { readonly s: number; readonly point: Vec3 }

/** Route sampled segments outside the head while preserving material coordinates. */
export function constrainHairSamples(samples: readonly HairCollisionSample[], collider: EllipsoidCollider): HairCollisionSample[] {
  if (!samples.length) return [];
  const [cx, cy, cz] = collider.center;
  const [rx, ry, rz] = collider.radii;
  const normalized = (p: Vec3): Vec3 => [(p[0] - cx) / rx, (p[1] - cy) / ry, (p[2] - cz) / rz];
  const world = (p: Vec3): Vec3 => [cx + p[0] * rx, cy + p[1] * ry, cz + p[2] * rz];
  const radius = 1 + Math.max(0, collider.clearance);
  const first = samples[0];
  const rootVector = normalized(first.point);
  const rootLength = Math.hypot(...rootVector);
  if (rootLength < 1 - epsilon) throw new Error('Hair root is inside the head collider');
  const fallback: Vec3 = rootLength > epsilon ? rootVector.map((v) => v / rootLength) as unknown as Vec3 : [0, 1, 0];
  const project = (point: Vec3): Vec3 => {
    const p = normalized(point);
    const length = Math.hypot(...p);
    if (length >= radius) return point;
    const direction = length > epsilon ? p.map((v) => v / length) as unknown as Vec3 : fallback;
    return world(direction.map((v) => v * radius) as unknown as Vec3);
  };
  const distanceToSegment = (a: Vec3, b: Vec3): number => {
    const p = normalized(a), q = normalized(b);
    const d = q.map((v, i) => v - p[i]);
    const lengthSquared = d.reduce((sum, v) => sum + v * v, 0);
    const t = lengthSquared > epsilon ? Math.max(0, Math.min(1, -p.reduce((sum, v, i) => sum + v * d[i], 0) / lengthSquared)) : 0;
    return Math.hypot(...p.map((v, i) => v + t * d[i]));
  };
  const result: HairCollisionSample[] = [{ s: first.s, point: first.point }];
  const route = (a: HairCollisionSample, b: HairCollisionSample, depth: number): void => {
    if (distanceToSegment(a.point, b.point) >= 1 - epsilon) { result.push(b); return; }
    if (depth >= 24) throw new Error('Unable to route hair segment outside head collider');
    const midpoint: Vec3 = [(a.point[0] + b.point[0]) / 2, (a.point[1] + b.point[1]) / 2, (a.point[2] + b.point[2]) / 2];
    const midpointVector = normalized(midpoint);
    let routedMidpoint = midpoint;
    if (Math.hypot(...midpointVector) < epsilon) {
      const direction = normalized(a.point);
      const length = Math.hypot(...direction);
      const unit = direction.map((v) => v / length);
      const reference = Math.abs(unit[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const dot = unit.reduce((sum, v, i) => sum + v * reference[i], 0);
      const perpendicular = reference.map((v, i) => v - dot * unit[i]);
      const perpendicularLength = Math.hypot(...perpendicular);
      routedMidpoint = world(perpendicular.map((v) => v * radius / perpendicularLength) as unknown as Vec3);
    }
    const middle = { s: (a.s + b.s) / 2, point: project(routedMidpoint) };
    route(a, middle, depth + 1);
    route(middle, b, depth + 1);
  };
  for (let i = 1; i < samples.length; i += 1) {
    const previous = result[result.length - 1];
    route(previous, { s: samples[i].s, point: project(samples[i].point) }, 0);
  }
  return result;
}
