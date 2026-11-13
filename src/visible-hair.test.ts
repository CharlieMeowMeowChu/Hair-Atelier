import { describe, expect, it } from 'vitest';
import { createDemoHairState, HairEditor } from './hair-core';
import { visibleHairSamples } from './visible-hair';
import type { HairCollisionSample } from './head-collision';

const head = { center: [0, 0, 0] as const, radii: [0.22, 0.2464, 0.2024] as const, clearance: 0.018 };
function at(samples: readonly HairCollisionSample[], s: number) {
  const i = samples.findIndex((sample) => sample.s >= s);
  if (i <= 0) return samples[0].point;
  const a = samples[i - 1], b = samples[i];
  const t = (s - a.s) / (b.s - a.s);
  return a.point.map((v, n) => v + (b.point[n] - v) * t);
}
describe('visible curl prefix', () => {
  it('retains the same visible centreline after a non-grid cut and growth', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 });
    const get = () => visibleHairSamples(editor.exportState().strands.find((strand) => strand.id === 'C')!, head);
    const before = get();
    editor.cutAt('C', 0.1973);
    const after = get();
    expect(after.at(-1)?.s).toBeCloseTo(0.1973, 10);
    editor.growBy('C', 0.05);
    const grown = get();
    for (let i = 0; i <= 100; i += 1) {
      const s = 0.1973 * i / 100;
      const expected = at(before, s);
      for (const actual of [at(after, s), at(grown, s)]) {
        expect(Math.hypot(...actual.map((v, n) => v - expected[n]))).toBeLessThan(0.0005);
      }
    }
  });
});

it('preserves the displayed prefix while extending beyond a recorded non-grid tail', () => {
  const editor = new HairEditor(createDemoHairState());
  editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 });
  editor.growBy('C', 0.213);
  const get = () => visibleHairSamples(editor.exportState().strands.find((strand) => strand.id === 'C')!, head);
  const before = get();
  editor.growBy('C', 0.05);
  const after = get();
  for (let i = 0; i <= 100; i += 1) {
    const s = 0.613 * i / 100;
    expect(Math.hypot(...at(before, s).map((v, n) => v - at(after, s)[n]))).toBeLessThan(0.0005);
  }
});
