import type { Vec3 } from './hair-core';

export interface ArcLineSegment {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly s0: number;
  readonly s1: number;
}

export interface ArcLineProjection {
  readonly point: Vec3;
  readonly segmentT: number;
  readonly s: number;
}

const epsilon = 1e-12;

/**
 * Maps a point on a rendered line segment back to its Rest arc coordinate.
 * The rendered segment is only a local approximation; its endpoints retain
 * the exact s values from the GuideStrand sample.
 */
export function projectPointToArcSegment(point: Vec3, segment: ArcLineSegment): ArcLineProjection {
  const direction: Vec3 = [
    segment.b[0] - segment.a[0],
    segment.b[1] - segment.a[1],
    segment.b[2] - segment.a[2],
  ];
  const lengthSquared = direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2;
  const offset: Vec3 = [point[0] - segment.a[0], point[1] - segment.a[1], point[2] - segment.a[2]];
  const segmentT = lengthSquared > epsilon
    ? Math.max(0, Math.min(1, (offset[0] * direction[0] + offset[1] * direction[1] + offset[2] * direction[2]) / lengthSquared))
    : 0;
  return {
    point: [
      segment.a[0] + direction[0] * segmentT,
      segment.a[1] + direction[1] * segmentT,
      segment.a[2] + direction[2] * segmentT,
    ],
    segmentT,
    s: segment.s0 + (segment.s1 - segment.s0) * segmentT,
  };
}
