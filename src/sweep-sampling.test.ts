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
