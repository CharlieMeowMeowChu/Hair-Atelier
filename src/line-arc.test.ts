import { describe, expect, it } from 'vitest';
import { projectPointToArcSegment } from './line-arc';

describe('rendered line to rest-arc interpolation', () => {
  const segment = { a: [0, 0, 0] as const, b: [0, -2, 0] as const, s0: 0.1, s1: 0.4 };

  it('interpolates rest arc s from an interior rendered point', () => {
    const projection = projectPointToArcSegment([0, -0.5, 0], segment);
    expect(projection.segmentT).toBeCloseTo(0.25, 10);
    expect(projection.s).toBeCloseTo(0.175, 10);
    expect(projection.point).toEqual([0, -0.5, 0]);
  });

  it('clamps a raycast point beyond either rendered endpoint', () => {
    expect(projectPointToArcSegment([0, 1, 0], segment)).toMatchObject({ segmentT: 0, s: 0.1, point: [0, 0, 0] });
    expect(projectPointToArcSegment([0, -3, 0], segment)).toMatchObject({ segmentT: 1, s: 0.4, point: [0, -2, 0] });
  });

  it('handles a degenerate rendered segment without producing a non-finite s', () => {
    const projection = projectPointToArcSegment([2, 3, 4], { a: [1, 1, 1], b: [1, 1, 1], s0: 0.2, s1: 0.4 });
    expect(projection).toEqual({ point: [1, 1, 1], segmentT: 0, s: 0.2 });
  });
});
