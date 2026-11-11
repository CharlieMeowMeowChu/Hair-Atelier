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
