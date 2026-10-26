import { describe, expect, it } from 'vitest';
import { canonicalState, createDemoHairState, HairEditor, pointAt } from './hair-core';

describe('HairEditor core invariants', () => {
  it('cuts only the selected strand', () => {
    const editor = new HairEditor(createDemoHairState());
    const before = editor.exportState();
    expect(editor.cutAt('A', 0.15).changed).toBe(true);
    const after = editor.exportState();
    expect(after.strands.find((strand) => strand.id === 'A')?.length).toBe(0.15);
    for (const id of ['B', 'C', 'D']) {
      expect(canonicalState({ schemaVersion: 1, strands: [after.strands.find((strand) => strand.id === id)!] }))
        .toBe(canonicalState({ schemaVersion: 1, strands: [before.strands.find((strand) => strand.id === id)!] }));
    }
  });

  it('preserves the curled prefix after a cut', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.3 });
    const curled = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    const samples = [0.04, 0.08, 0.12, 0.16].map((s) => pointAt(curled, s));
    editor.cutAt('C', 0.2);
    const cut = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    samples.forEach((sample, index) => {
      const result = pointAt(cut, [0.04, 0.08, 0.12, 0.16][index]);
      expect(Math.hypot(sample[0] - result[0], sample[1] - result[1], sample[2] - result[2])).toBeLessThanOrEqual(0.0005);
    });
    expect(cut.curls[0]).toEqual(curled.curls[0]);
  });

  it('grows without scaling or straightening retained curl', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0 });
    editor.cutAt('C', 0.2);
    const beforeGrow = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    const retained = pointAt(beforeGrow, 0.16);
    editor.growBy('C', 0.1);
    const afterGrow = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    expect(afterGrow.length).toBeCloseTo(0.3);
    expect(pointAt(afterGrow, 0.16)).toEqual(retained);
  });

  it('restores serialized state through undo and redo', () => {
    const editor = new HairEditor(createDemoHairState());
    const initial = canonicalState(editor.exportState());
    editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0 });
    editor.cutAt('C', 0.2);
    const edited = canonicalState(editor.exportState());
    editor.undo(); editor.undo();
    expect(canonicalState(editor.exportState())).toBe(initial);
    editor.redo(); editor.redo();
    expect(canonicalState(editor.exportState())).toBe(edited);
  });

  it('returns a safe no-op for invalid cuts', () => {
    const editor = new HairEditor(createDemoHairState());
    expect(editor.cutAt('C', Number.NaN).changed).toBe(false);
    expect(editor.cutAt('missing', 0.1).changed).toBe(false);
  });
});
