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

  it('commits a multi-strand scissors sweep as one undo command', () => {
    const editor = new HairEditor(createDemoHairState());
    const initial = canonicalState(editor.exportState());
    const results = editor.cutManyAt([
      { strandId: 'A', arcLengthMeters: 0.2 },
      { strandId: 'A', arcLengthMeters: 0.12 },
      { strandId: 'B', arcLengthMeters: 0.18 },
      { strandId: 'missing', arcLengthMeters: 0.1 },
    ]);
    expect(results.map((result) => [result.strandId, result.newLength])).toEqual([['A', 0.12], ['B', 0.18]]);
    editor.undo();
    expect(canonicalState(editor.exportState())).toBe(initial);
  });

  it('never grows while repeatedly cutting and treats the same cut as a no-op', () => {
    const editor = new HairEditor(createDemoHairState());
    let previousLength = 0.3;
    for (let index = 0; index < 10; index += 1) {
      const requested = 0.29 - index * 0.02;
      const result = editor.cutAt('A', requested);
      expect(result.changed).toBe(true);
      expect(result.newLength).toBeLessThan(previousLength);
      previousLength = result.newLength!;
    }
    expect(editor.cutAt('A', previousLength).changed).toBe(false);
  });

  it('keeps the root fixed through curl, cut, growth, undo and redo', () => {
    const editor = new HairEditor(createDemoHairState());
    const root = editor.exportState().strands.find((strand) => strand.id === 'C')!.root;
    editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0 });
    editor.cutAt('C', 0.2);
    editor.growBy('C', 0.1);
    editor.undo();
    editor.redo();
    expect(editor.exportState().strands.find((strand) => strand.id === 'C')!.root).toEqual(root);
  });

  it('supports twenty consecutive undo operations', () => {
    const editor = new HairEditor(createDemoHairState());
    const initial = canonicalState(editor.exportState());
    for (let index = 0; index < 20; index += 1) editor.cutAt('C', 0.39 - index * 0.01);
    for (let index = 0; index < 20; index += 1) editor.undo();
    expect(canonicalState(editor.exportState())).toBe(initial);
  });

  it('rejects a curl range entirely beyond the current tip without adding undo state', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.cutAt('C', 0.2);
    const before = canonicalState(editor.exportState());
    const result = editor.curlRange('C', { startS: 0.25, endS: 0.35, radius: 0.025, pitch: 0.08, phase: 0 });
    expect(result.changed).toBe(false);
    expect(canonicalState(editor.exportState())).toBe(before);
    editor.undo();
    expect(editor.exportState().strands.find((strand) => strand.id === 'C')?.length).toBe(0.4);
  });
});
