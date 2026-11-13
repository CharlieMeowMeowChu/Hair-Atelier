import { describe, expect, it } from 'vitest';
import { percentile, RecentMeasurements } from './performance-metrics';

describe('recent render measurements', () => {
  it('calculates an upper percentile without mutating caller samples', () => {
    const samples = [8, 2, 4, 6, 10];
    expect(percentile(samples, 0.95)).toBe(10);
    expect(samples).toEqual([8, 2, 4, 6, 10]);
  });

  it('keeps only the recent bounded window and rejects invalid values', () => {
    const measurements = new RecentMeasurements(3);
    [3, Number.NaN, -1, 7, 11, 2].forEach((value) => measurements.add(value));
    expect(measurements.p95).toBe(11);
  });
});
