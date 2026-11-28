import { describe, expect, it } from 'vitest';
import { createDemoHairState, HairEditor, type HairState } from './hair-core';
import { canRenderHistory } from './runtime-budget';
import { fullHairGridSegments } from './visible-hair';

describe('prototype render preflight', () => {
  it('does not reject a previously allowed grid-work count solely because of denser sampling', () => {
    for (const length of [0, 0.2, 0.4, 0.6, 0.605, 1, 2, 10, 100]) {
      const oldSegments = Math.max(40, Math.floor(length / 0.01 + 1e-10) + 2);
      expect(fullHairGridSegments(length) + 1).toBeLessThanOrEqual(2 * (oldSegments + 1));
    }
  });
  it('accepts ordinary and zero-length history without changing the data', () => {
    const state = createDemoHairState();
    const before = JSON.stringify(state);
    const zero: HairState = { ...state, strands: [{ ...state.strands[0], length: 0, maximumLength: 0 }] };
    expect(canRenderHistory({ version: 4, current: state, undo: [zero], redo: [] })).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });
  it('rejects excessive work and overflow in any saved snapshot', () => {
    const base = createDemoHairState();
    const huge: HairState = { ...base, strands: [{ ...base.strands[0], maximumLength: 1e100 }] };
    const badRoot: HairState = { ...base, strands: [{ ...base.strands[0], root: [1e308, 0, 0] }] };
    const badCurl: HairState = { ...base, strands: [{ ...base.strands[0], curls: [{ startS: 0.01, endS: 0.1, radius: 1e308, pitch: 0.08, phase: 0, direction: 1 }] }] };
    const history = new HairEditor(base).exportHistory();
    expect(canRenderHistory({ ...history, undo: [huge] })).toBe(false);
    expect(canRenderHistory({ ...history, redo: [badRoot] })).toBe(false);
    expect(canRenderHistory({ ...history, current: badCurl })).toBe(false);
  });
});
