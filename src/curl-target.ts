import type { CurlSegment } from './hair-core';

/** Select a free interval, or the remainder of the curl at the hit. */
export function freeCurlInterval(hitS: number, length: number, curls: readonly CurlSegment[], spanMeters?: number): { startS: number; endS: number } | undefined {
  if (!Number.isFinite(hitS) || !Number.isFinite(length) || hitS < 0 || hitS >= length) return undefined;
  if (spanMeters !== undefined) {
    if (!Number.isFinite(spanMeters) || spanMeters <= 0) return undefined;
    const startS = Math.max(0.01, hitS);
    const endS = Math.min(length, startS + spanMeters);
    return startS < endS ? { startS, endS } : undefined;
  }
  const selected = curls.find((curl) => hitS >= curl.startS && hitS < curl.endS);
  if (selected) return { startS: hitS, endS: Math.min(selected.endS, length) };
  const previousEnd = curls.filter((curl) => curl.endS <= hitS).reduce((end, curl) => Math.max(end, curl.endS), 0.01);
  const nextStart = curls.filter((curl) => curl.startS > hitS).reduce((start, curl) => Math.min(start, curl.startS), length);
  const startS = Math.max(0.01, previousEnd, hitS - 0.04);
  return startS < nextStart ? { startS, endS: nextStart } : undefined;
}
