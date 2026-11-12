import { describe, expect, it } from 'vitest';
import { createDemoHairState, HairEditor, type HairState } from './hair-core';
import { canRenderHistory } from './runtime-budget';

describe('prototype render preflight', () => {
  it('accepts ordinary and zero-length history without changing the data', () => {
    const state = createDemoHairState();
    const before = JSON.stringify(state);
    const zero: HairState = { ...state, strands: [{ ...state.strands[0], length: 0, maximumLength: 0 }] };
    expect(canRenderHistory({ version: 3, current: state, undo: [zero], redo: [] })).toBe(true);
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
