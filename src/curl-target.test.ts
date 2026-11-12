import { describe, expect, it } from 'vitest';
import { freeCurlInterval } from './curl-target';

const curl = { startS: 0.2, endS: 0.3, radius: 0.025, pitch: 0.08, phase: 0, direction: 1 as const };
describe('curl target selection', () => {
  it('stops before the next curl and preserves the previous curl boundary', () => {
    const before = freeCurlInterval(0.15, 0.4, [curl]);
    expect(before?.startS).toBeCloseTo(0.11);
    expect(before?.endS).toBe(0.2);
    expect(freeCurlInterval(0.31, 0.4, [curl])).toEqual({ startS: 0.3, endS: 0.4 });
  });
  it('rejects an existing curl and invalid positions', () => {
    expect(freeCurlInterval(0.25, 0.4, [curl])).toBeUndefined();
    expect(freeCurlInterval(Number.NaN, 0.4, [])).toBeUndefined();
    expect(freeCurlInterval(0.4, 0.4, [])).toBeUndefined();
  });
});
