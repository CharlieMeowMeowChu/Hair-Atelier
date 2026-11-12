import { sampleStrandWithArcS, type EditorHistory, type HairState } from './hair-core';
import { restTangentAt } from './arc-length';

// Prototype resource guard, not a gameplay hair-length or strand-count rule.
const maximumWorkPerSnapshot = 200_000;

export function canRenderSnapshot(state: HairState): boolean {
  let work = 0;
  for (const strand of state.strands) {
    const samples = Math.max(40, Math.floor(strand.maximumLength / 0.01 + 1e-10) + 2);
    work += (samples + 1) * (strand.curls.length + 1);
    if (!Number.isSafeInteger(work) || work > maximumWorkPerSnapshot) return false;
    if (strand.curls.some((curl) => !Number.isFinite(Math.PI * 2 * curl.radius) || !Number.isFinite(Math.hypot(Math.PI * 2 * curl.radius, curl.pitch)))) return false;
  }
  try {
    for (const strand of state.strands) {
      const full = { ...strand, length: strand.maximumLength };
      for (const sample of sampleStrandWithArcS(full, 40)) {
        const tangent = restTangentAt(full, sample.s);
        if (![...sample.point, ...tangent].every((value) => Number.isFinite(value) && Number.isFinite(Math.fround(value)))) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function canRenderHistory(history: EditorHistory): boolean {
  return [history.current, ...history.undo, ...history.redo].every(canRenderSnapshot);
}
