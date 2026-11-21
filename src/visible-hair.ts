import { pointAt, type GuideStrand } from './hair-core';
import { constrainHairSamples, type EllipsoidCollider, type HairCollisionSample } from './head-collision';

const sampleStepMeters = 0.005;

/** The guard and renderer must count the same fixed-grid samples. */
export function fullHairGridSegments(maximumLength: number): number {
  return Math.max(80, Math.floor(maximumLength / sampleStepMeters + 1e-10) + 2);
}

/** Build the full material path independent of the visible cut length. */
export function fullHairSamples(strand: GuideStrand, collider: EllipsoidCollider): HairCollisionSample[] {
  // A fixed material grid keeps previously displayed samples unchanged when
  // the recorded tail is extended. Evaluate two intervals beyond the recorded tip so ribbon direction and width remain stable.
  const step = sampleStepMeters;
  const segments = fullHairGridSegments(strand.maximumLength);
  const horizon = segments * step;
  const curls = strand.curls.map((curl, index) => index === strand.curls.length - 1 && curl.endS === strand.maximumLength
    ? { ...curl, endS: horizon } : curl);
  const full = { ...strand, curls, length: horizon, maximumLength: horizon };
  const samples = Array.from({ length: segments + 1 }, (_, index) => {
    const s = index * step;
    return { s, point: pointAt(full, s) };
  });
  return constrainHairSamples(samples, collider);
}

/** Clip the full path at the current material length. */
export function visibleHairSamples(strand: GuideStrand, collider: EllipsoidCollider, routed = fullHairSamples(strand, collider)): HairCollisionSample[] {
  const visible: HairCollisionSample[] = [];
  for (const sample of routed) {
    if (sample.s <= strand.length) { visible.push(sample); continue; }
    const previous = visible.at(-1);
    if (previous && previous.s < strand.length) {
      const t = (strand.length - previous.s) / (sample.s - previous.s);
      visible.push({ s: strand.length, point: [
        previous.point[0] + (sample.point[0] - previous.point[0]) * t,
        previous.point[1] + (sample.point[1] - previous.point[1]) * t,
        previous.point[2] + (sample.point[2] - previous.point[2]) * t,
      ] });
    }
    break;
  }
  return visible;
}
