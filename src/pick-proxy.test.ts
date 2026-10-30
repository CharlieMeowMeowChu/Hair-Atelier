import { describe, expect, it } from 'vitest';
import { closestPointOnRayToSegment, pickVisibleSegment, type PickRay, type PickSegment } from './pick-proxy';

const ray: PickRay = { origin: [0, 0, 1], direction: [0, 0, -1] };
const preciseTouch = { touchRadiusMetersAtDepth: () => 0.001 };

describe('GuideStrand pick proxy', () => {
  it('interpolates rest arc s from the closest point on a segment', () => {
    const segment: PickSegment = { strandId: 'C', s0: 0.1, s1: 0.3, a: [-1, 0, 0], b: [1, 0, 0] };
    const hit = pickVisibleSegment(ray, [segment], preciseTouch);
    expect(hit?.materialS).toBeCloseTo(0.2, 8);
    expect(hit?.segmentT).toBeCloseTo(0.5, 8);
  });

  it('selects the front-most visible segment before a farther segment', () => {
    const hit = pickVisibleSegment(ray, [
      { strandId: 'back', s0: 0.2, s1: 0.3, a: [-0.1, 0, -0.2], b: [0.1, 0, -0.2] },
      { strandId: 'front', s0: 0.2, s1: 0.3, a: [-0.1, 0, 0.2], b: [0.1, 0, 0.2] },
    ], preciseTouch);
    expect(hit?.strandId).toBe('front');
  });

  it('rejects a capsule fully hidden behind an opaque head proxy', () => {
    const hit = pickVisibleSegment(ray, [
      { strandId: 'hidden', s0: 0.2, s1: 0.3, a: [-0.1, 0, -0.7], b: [0.1, 0, -0.7] },
    ], {
      ...preciseTouch,
      occluders: [{ center: [0, 0, 0], radiusMeters: 0.5 }],
    });
    expect(hit).toBeUndefined();
  });

  it('uses stable strand IDs to break an otherwise exact tie', () => {
    const overlap: Omit<PickSegment, 'strandId'> = { s0: 0.2, s1: 0.3, a: [-0.1, 0, 0], b: [0.1, 0, 0] };
    const hit = pickVisibleSegment(ray, [
      { strandId: 'B', ...overlap },
      { strandId: 'A', ...overlap },
    ], preciseTouch);
    expect(hit?.strandId).toBe('A');
  });

  it('handles a parallel ray and segment without producing non-finite coordinates', () => {
    const closest = closestPointOnRayToSegment(ray, {
      strandId: 'parallel', s0: 0, s1: 0.1, a: [0.02, 0, 0.5], b: [0.02, 0, -0.5],
    });
    expect(closest).toBeDefined();
    expect(Number.isFinite(closest!.rayT)).toBe(true);
    expect(Number.isFinite(closest!.distanceMeters)).toBe(true);
  });
});
