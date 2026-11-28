import type { CurlSegment, GuideStrand } from './hair-core';

/** Tolerance already accepted by the persisted hairstyle schema, in metres. */
export const restArcToleranceMeters = 1e-9;

/** Resolve schema-tolerated overlaps for evaluation without rewriting saved data. */
export function effectiveCurlIntervals(strand: GuideStrand): { curl: CurlSegment; index: number }[] {
  const result: { curl: CurlSegment; index: number }[] = [];
  let previousRawEnd = 0;
  let previousEnd = 0;
  for (let index = 0; index < strand.curls.length; index += 1) {
    const curl = strand.curls[index];
    if (curl.startS < previousRawEnd - restArcToleranceMeters || curl.startS < 0 || curl.endS <= curl.startS || curl.endS > strand.maximumLength + restArcToleranceMeters) continue;
    // Validate against the stored predecessor, but never let a fully covered
    // interval move the physical boundary backwards.
    previousRawEnd = curl.endS;
    const startS = Math.max(curl.startS, previousEnd);
    const endS = Math.min(curl.endS, strand.maximumLength);
    if (endS <= startS) continue;
    result.push({ curl: startS === curl.startS && endS === curl.endS ? curl : { ...curl, startS, endS }, index });
    previousEnd = endS;
  }
  return result;
}

/** Index of the last effective curl only if it actually reaches the tip. */
export function terminalRecordedCurlIndex(strand: GuideStrand): number | undefined {
  const last = effectiveCurlIntervals(strand).at(-1);
  return last?.curl.endS === strand.maximumLength ? last.index : undefined;
}
