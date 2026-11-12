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
