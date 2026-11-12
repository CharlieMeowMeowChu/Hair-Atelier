import { describe, expect, it } from 'vitest';
import { isOutsideEllipsoid, keepHairOutsideEllipsoid, type EllipsoidCollider } from './head-collision';

const head: EllipsoidCollider = { center: [0, 0, 0], radii: [0.22, 0.2464, 0.2024], clearance: 0.018 };

describe('head collision presentation constraint', () => {
  it('projects curled guide samples outside the head while retaining already-free samples', () => {
    const result = keepHairOutsideEllipsoid([[0.05, 0.25, 0.05], [0.04, 0.1, 0.02], [0.32, -0.12, 0.02]], head);
    expect(result.every((point) => isOutsideEllipsoid(point, head))).toBe(true);
    expect(result[2]).toEqual([0.32, -0.12, 0.02]);
  });

  it('handles an exact-centre curl sample deterministically', () => {
    const [point] = keepHairOutsideEllipsoid([[0, 0, 0]], head);
    expect(point[0]).toBe(0);
    expect(point[1]).toBeCloseTo(0.2508352);
    expect(point[2]).toBe(0);
    expect(isOutsideEllipsoid(point, head)).toBe(true);
  });
});

it('keeps a real editor curl out of the displayed head without changing its hair data', async () => {
  const { createDemoHairState, HairEditor, sampleStrand } = await import('./hair-core');
  const editor = new HairEditor(createDemoHairState());
  const result = editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 });
  expect(result.changed).toBe(true);
  const c = editor.exportState().strands.find((strand) => strand.id === 'C')!;
  const restSamples = sampleStrand(c, 80);
  const renderedSamples = keepHairOutsideEllipsoid(restSamples, head);
  expect(restSamples.some((point) => !isOutsideEllipsoid(point, head))).toBe(true);
  expect(renderedSamples.every((point) => isOutsideEllipsoid(point, head))).toBe(true);
  expect(editor.exportState().strands.find((strand) => strand.id === 'C')).toEqual(c);
});

describe('segment routing', () => {
  it('preserves every demo root and routes actual curled, cut and grown guides outside the head', async () => {
    const { constrainHairSamples } = await import('./head-collision');
    const { createDemoHairState, HairEditor, sampleStrandWithArcS } = await import('./hair-core');
    const editor = new HairEditor(createDemoHairState());
    const check = () => {
      for (const strand of editor.exportState().strands) {
        const output = constrainHairSamples(sampleStrandWithArcS(strand), head);
        expect(output[0].point).toEqual(strand.root);
        for (let i = 1; i < output.length; i += 1) {
          expect(output[i].s).toBeGreaterThanOrEqual(output[i - 1].s);
          const a = output[i - 1].point, b = output[i].point;
          const p = a.map((v, n) => (v - head.center[n]) / head.radii[n]);
          const d = b.map((v, n) => (v - a[n]) / head.radii[n]);
          const denominator = d.reduce((sum, v) => sum + v * v, 0);
          const t = denominator ? Math.max(0, Math.min(1, -p.reduce((sum, v, n) => sum + v * d[n], 0) / denominator)) : 0;
          expect(Math.hypot(...p.map((v, n) => v + t * d[n]))).toBeGreaterThanOrEqual(1 - 1e-8);
        }
      }
    };
    check();
    editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 });
    check();
    editor.cutAt('C', 0.2);
    check();
    editor.growBy('C', 0.05);
    check();
  });

  it('routes an outside-to-outside segment across the head with ordered material coordinates', async () => {
    const { constrainHairSamples } = await import('./head-collision');
    const output = constrainHairSamples([{ s: 0, point: [0.3, 0, 0] }, { s: 1, point: [-0.3, 0, 0] }], head);
    expect(output.length).toBeGreaterThan(2);
    expect(output[0].point).toEqual([0.3, 0, 0]);
    expect(output.at(-1)?.s).toBe(1);
    expect(output.every((sample, i) => i === 0 || sample.s >= output[i - 1].s)).toBe(true);
  });
});
