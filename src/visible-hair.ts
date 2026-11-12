import { sampleStrandWithArcS, type GuideStrand } from './hair-core';
import { constrainHairSamples, type EllipsoidCollider, type HairCollisionSample } from './head-collision';

/** Build the full material path independent of the visible cut length. */
export function fullHairSamples(strand: GuideStrand, collider: EllipsoidCollider): HairCollisionSample[] {
  const full = { ...strand, length: strand.maximumLength };
  const segments = Math.max(40, Math.ceil(strand.maximumLength / 0.01));
  return constrainHairSamples(sampleStrandWithArcS(full, segments), collider);
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
