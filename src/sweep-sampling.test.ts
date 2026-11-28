import { expect, it } from 'vitest';
import { sweepStepPixels } from './sweep-sampling';

it('uses finer sampling for a small viewport and distant camera', () => {
  const fov = 35 * Math.PI / 180;
  const near = sweepStepPixels(0.014, 400, fov, 1.72);
  const far = sweepStepPixels(0.01, 190, fov, 3.2);
  expect(far).toBeLessThan(near);
  expect(far).toBeLessThan(1);
  expect(sweepStepPixels(0, 190, fov, 3.2)).toBe(1);
});

it('clips sweeps to the canvas while preserving crossing and return paths', async () => {
  const { clipSweepToBounds } = await import('./sweep-sampling');
  const box = { left: 10, top: 20, right: 110, bottom: 120 };
  expect(clipSweepToBounds({ x: 50, y: 50 }, { x: 10000, y: 50 }, box)).toEqual({ from: { x: 50, y: 50 }, to: { x: 110, y: 50 } });
  expect(clipSweepToBounds({ x: 150, y: 50 }, { x: -50, y: 50 }, box)).toEqual({ from: { x: 110, y: 50 }, to: { x: 10, y: 50 } });
  expect(clipSweepToBounds({ x: 0, y: 10 }, { x: 200, y: 10 }, box)).toBeUndefined();
  expect(clipSweepToBounds({ x: 10, y: 20 }, { x: 10, y: 20 }, box)).toEqual({ from: { x: 10, y: 20 }, to: { x: 10, y: 20 } });
  expect(clipSweepToBounds({ x: NaN, y: 20 }, { x: 10, y: 20 }, box)).toBeUndefined();
});
