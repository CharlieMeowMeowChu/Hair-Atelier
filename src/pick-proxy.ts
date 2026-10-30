import type { Vec3 } from './hair-core';

export interface PickRay {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

/**
 * A transient, local-space capsule centreline. It is derived from a GuideStrand
 * and is never saved as the hair's source of truth.
 */
export interface PickSegment {
  readonly strandId: string;
  readonly s0: number;
  readonly s1: number;
  readonly a: Vec3;
  readonly b: Vec3;
  readonly radiusMeters?: number;
}

export interface SphereOccluder {
  readonly center: Vec3;
  readonly radiusMeters: number;
}

export interface PickOptions {
  /** Converts the intended CSS-pixel touch tolerance to local-space metres. */
  readonly touchRadiusMetersAtDepth: (depthMeters: number) => number;
  readonly occluders?: readonly SphereOccluder[];
  readonly occlusionPaddingMeters?: number;
}

export interface ClosestRaySegmentPoint {
  readonly rayT: number;
  readonly segmentT: number;
  readonly distanceMeters: number;
  readonly pointOnRay: Vec3;
  readonly pointOnSegment: Vec3;
}

export interface PickHit extends ClosestRaySegmentPoint {
  readonly strandId: string;
  readonly materialS: number;
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

function lengthSquared(value: Vec3): number {
  return dot(value, value);
}

function length(value: Vec3): number {
  return Math.sqrt(lengthSquared(value));
}

function normalize(value: Vec3): Vec3 | undefined {
  const valueLength = length(value);
  return valueLength > epsilon ? scale(value, 1 / valueLength) : undefined;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pointOnSegment(segment: PickSegment, segmentT: number): Vec3 {
  return add(segment.a, scale(subtract(segment.b, segment.a), segmentT));
}

function pointOnRay(ray: PickRay, normalizedDirection: Vec3, rayT: number): Vec3 {
  return add(ray.origin, scale(normalizedDirection, rayT));
}

/**
 * Finds the closest points on a forward ray and a finite line segment. Candidate
 * enumeration deliberately handles parallel and endpoint cases without relying
 * on Three.js's Line.raycast segment index.
 */
export function closestPointOnRayToSegment(ray: PickRay, segment: PickSegment): ClosestRaySegmentPoint | undefined {
  const direction = normalize(ray.direction);
  if (!direction) return undefined;

  const segmentVector = subtract(segment.b, segment.a);
  const segmentLengthSquared = lengthSquared(segmentVector);
  const candidates: number[] = [0, 1];

  if (segmentLengthSquared > epsilon) {
    const originProjection = clamp01(dot(subtract(ray.origin, segment.a), segmentVector) / segmentLengthSquared);
    candidates.push(originProjection);

    const originToStart = subtract(ray.origin, segment.a);
    const directionSegmentDot = dot(direction, segmentVector);
    const denominator = segmentLengthSquared - directionSegmentDot * directionSegmentDot;
    if (Math.abs(denominator) > epsilon) {
      const interiorSegmentT = (dot(segmentVector, originToStart) - directionSegmentDot * dot(direction, originToStart)) / denominator;
      if (interiorSegmentT >= 0 && interiorSegmentT <= 1) candidates.push(interiorSegmentT);
    }
  }

  let best: ClosestRaySegmentPoint | undefined;
  for (const segmentT of candidates) {
    const pointOnCandidateSegment = pointOnSegment(segment, segmentT);
    const rayT = Math.max(0, dot(subtract(pointOnCandidateSegment, ray.origin), direction));
    const pointOnCandidateRay = pointOnRay(ray, direction, rayT);
    const distanceMeters = length(subtract(pointOnCandidateRay, pointOnCandidateSegment));
    const next: ClosestRaySegmentPoint = {
      rayT,
      segmentT,
      distanceMeters,
      pointOnRay: pointOnCandidateRay,
      pointOnSegment: pointOnCandidateSegment,
    };
    if (!best || distanceMeters < best.distanceMeters - epsilon ||
      (Math.abs(distanceMeters - best.distanceMeters) <= epsilon && rayT < best.rayT)) {
      best = next;
    }
  }
  return best;
}

function firstSphereHit(ray: PickRay, sphere: SphereOccluder): number | undefined {
  const direction = normalize(ray.direction);
  if (!direction || sphere.radiusMeters <= 0) return undefined;
  const offset = subtract(ray.origin, sphere.center);
  const projected = dot(offset, direction);
  const discriminant = projected * projected - (lengthSquared(offset) - sphere.radiusMeters * sphere.radiusMeters);
  if (discriminant < 0) return undefined;
  const near = -projected - Math.sqrt(discriminant);
  const far = -projected + Math.sqrt(discriminant);
  if (near >= 0) return near;
  return far >= 0 ? far : undefined;
}

function isOccluded(ray: PickRay, closest: ClosestRaySegmentPoint, hitRadiusMeters: number, options: PickOptions): boolean {
  const clearanceSquared = Math.max(0, hitRadiusMeters * hitRadiusMeters - closest.distanceMeters * closest.distanceMeters);
  const visibleSurfaceDepth = Math.max(0, closest.rayT - Math.sqrt(clearanceSquared));
  const padding = options.occlusionPaddingMeters ?? 0.0005;
  return (options.occluders ?? []).some((occluder) => {
    const occluderDepth = firstSphereHit(ray, occluder);
    return occluderDepth !== undefined && occluderDepth < visibleSurfaceDepth - padding;
  });
}

function compareHits(left: PickHit, right: PickHit): number {
  const depthDifference = left.rayT - right.rayT;
  if (Math.abs(depthDifference) > epsilon) return depthDifference;
  const distanceDifference = left.distanceMeters - right.distanceMeters;
  if (Math.abs(distanceDifference) > epsilon) return distanceDifference;
  const idDifference = left.strandId.localeCompare(right.strandId);
  if (idDifference !== 0) return idDifference;
  return left.materialS - right.materialS;
}

/**
 * Selects the front-most visible GuideStrand capsule. The deterministic ordering
 * is depth, screen-space proxy distance, stable strand ID, then material s.
 */
export function pickVisibleSegment(
  ray: PickRay,
  segments: readonly PickSegment[],
  options: PickOptions,
): PickHit | undefined {
  const hits: PickHit[] = [];
  for (const segment of segments) {
    if (!Number.isFinite(segment.s0) || !Number.isFinite(segment.s1)) continue;
    const closest = closestPointOnRayToSegment(ray, segment);
    if (!closest) continue;
    const touchRadius = options.touchRadiusMetersAtDepth(closest.rayT);
    const hitRadiusMeters = Math.max(0, segment.radiusMeters ?? 0) + (Number.isFinite(touchRadius) ? Math.max(0, touchRadius) : 0);
    if (closest.distanceMeters > hitRadiusMeters || isOccluded(ray, closest, hitRadiusMeters, options)) continue;
    hits.push({
      ...closest,
      strandId: segment.strandId,
      materialS: segment.s0 + (segment.s1 - segment.s0) * closest.segmentT,
    });
  }
  return hits.sort(compareHits)[0];
}
