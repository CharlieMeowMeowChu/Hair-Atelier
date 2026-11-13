import { describe, expect, it } from 'vitest';
import { dragActivationDistancePx, hasExceededDragThreshold } from './input-gesture';

describe('tool drag activation', () => {
  it('ignores movement shorter than the shared touch safety threshold', () => {
    expect(hasExceededDragThreshold({ x: 10, y: 10 }, { x: 15.9, y: 10 })).toBe(false);
  });

  it('activates at the shared threshold in any direction', () => {
    expect(hasExceededDragThreshold({ x: 0, y: 0 }, { x: dragActivationDistancePx, y: 0 })).toBe(true);
    expect(hasExceededDragThreshold({ x: 0, y: 0 }, { x: 0, y: -dragActivationDistancePx })).toBe(true);
  });
});
