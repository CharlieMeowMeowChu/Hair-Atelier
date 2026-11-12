import type { CurlSegment } from './hair-core';

/** Select the free material interval ending at the next curl or the visible tip. */
export function freeCurlInterval(hitS: number, length: number, curls: readonly CurlSegment[]): { startS: number; endS: number } | undefined {
  if (!Number.isFinite(hitS) || !Number.isFinite(length) || hitS < 0 || hitS >= length) return undefined;
  if (curls.some((curl) => hitS >= curl.startS && hitS < curl.endS)) return undefined;
  const previousEnd = curls.filter((curl) => curl.endS <= hitS).reduce((end, curl) => Math.max(end, curl.endS), 0.01);
  const nextStart = curls.filter((curl) => curl.startS > hitS).reduce((start, curl) => Math.min(start, curl.startS), length);
  const startS = Math.max(0.01, previousEnd, hitS - 0.04);
  return startS < nextStart ? { startS, endS: nextStart } : undefined;
}
