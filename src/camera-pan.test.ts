import { describe, expect, it } from 'vitest';
import { panCamera } from './camera-pan';

describe('camera pan', () => {
  it('moves the viewed scene with two-finger screen movement', () => {
    const position = panCamera({ x: 0, y: 0.05 }, { x: 30, y: -100 }, 1.35, 35 * Math.PI / 180, 300);
    expect(position.x).toBeLessThan(0);
    expect(position.y).toBeLessThan(0.05);
    expect(position.y).toBeCloseTo(0.05 - 100 * (2 * 1.35 * Math.tan(35 * Math.PI / 360) / 300));
  });
  it('keeps positions bounded and ignores invalid input', () => {
    expect(panCamera({ x: 0, y: 0 }, { x: 0, y: -10000 }, 1.35, 0.6, 300).y).toBe(-2.2);
    expect(panCamera({ x: 1, y: 0 }, { x: 4, y: 2 }, 1, 0.6, 0)).toEqual({ x: 1, y: 0 });
  });
});

it('brings a two-metre hair tip into a portrait viewport using vertical pan', async () => {
  const { PerspectiveCamera, Vector3 } = await import('three');
  const camera = new PerspectiveCamera(35, 430 / 300, 0.01, 10);
  camera.position.set(0, 0.05, 1.35);
  camera.updateMatrixWorld(true);
  const tip = new Vector3(0.05, -1.75, 0.05);
  expect(tip.clone().project(camera).y).toBeLessThan(-1);
  const moved = panCamera(camera.position, { x: 0, y: -560 }, camera.position.z, 35 * Math.PI / 180, 300);
  camera.position.set(moved.x, moved.y, 1.35);
  camera.updateMatrixWorld(true);
  expect(Math.abs(tip.clone().project(camera).y)).toBeLessThan(1);
});
