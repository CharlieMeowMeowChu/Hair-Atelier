import { describe, expect, it } from 'vitest';
import { canonicalState, createDemoHairState, HairEditor, parseHairState, pointAt } from './hair-core';

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
    editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 });
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
    editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0, direction: 1 });
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
    editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0, direction: 1 });
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

  it('clips only selected strands down to the requested guard length', () => {
    const editor = new HairEditor(createDemoHairState());
    const before = editor.exportState();
    const results = editor.clipManyAt(['A', 'C', 'missing'], 0.06);
    const after = editor.exportState();
    expect(results.map((result) => result.strandId)).toEqual(['A', 'C']);
    expect(after.strands.find((strand) => strand.id === 'A')?.length).toBe(0.06);
    expect(after.strands.find((strand) => strand.id === 'C')?.length).toBe(0.06);
    expect(after.strands.find((strand) => strand.id === 'B')).toEqual(before.strands.find((strand) => strand.id === 'B'));
    expect(editor.clipManyAt(['A', 'C'], 0.06)).toEqual([]);
  });

  it('keeps roots fixed and retained combed geometry stable after cutting', () => {
    const editor = new HairEditor(createDemoHairState());
    const original = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    expect(editor.combBy('C', [0.25, 0, -0.1]).changed).toBe(true);
    const combed = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    const retained = pointAt(combed, 0.16);
    expect(pointAt(combed, 0)).toEqual(original.root);
    editor.cutAt('C', 0.2);
    const cut = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    expect(pointAt(cut, 0.16)).toEqual(retained);
  });

  it('moves a parting without moving roots or erasing a comb direction', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.combBy('C', [0.12, 0, 0]);
    const before = editor.exportState();
    const cDirection = before.strands.find((strand) => strand.id === 'C')!.direction;
    expect(editor.setParting(0).changed).toBe(true);
    const after = editor.exportState();
    expect(after.strands.map((strand) => strand.root)).toEqual(before.strands.map((strand) => strand.root));
    expect(after.strands.find((strand) => strand.id === 'C')!.direction).toEqual(cDirection);
    expect(after.strands.some((strand) => strand.partingOffset?.[0] !== 0)).toBe(true);
  });

  it('stores independent ear-tuck sides without moving roots', () => {
    const editor = new HairEditor(createDemoHairState());
    const before = editor.exportState();
    expect(editor.tuckBehindEar('A', 'left').changed).toBe(true);
    expect(editor.tuckBehindEar('D', 'right').changed).toBe(true);
    const after = editor.exportState();
    expect(after.strands.find((strand) => strand.id === 'A')?.earTuck).toBe('left');
    expect(after.strands.find((strand) => strand.id === 'D')?.earTuck).toBe('right');
    expect(pointAt(after.strands.find((strand) => strand.id === 'A')!, 0)).toEqual(before.strands.find((strand) => strand.id === 'A')!.root);
    editor.undo();
    expect(editor.exportState().strands.find((strand) => strand.id === 'D')?.earTuck).toBeUndefined();
  });

  it('gathers selected strands to a ponytail anchor while retaining downstream curl geometry', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0, direction: 1 });
    const beforeTie = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    const beforeDelta = pointAt(beforeTie, 0.24).map((value, index) => value - pointAt(beforeTie, 0.2)[index]);
    const results = editor.tieStrands(['A', 'C'], { id: 'pony-low', anchor: [0, 0.02, -0.18], gatherS: 0.16 });
    const afterTie = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    const afterDelta = pointAt(afterTie, 0.24).map((value, index) => value - pointAt(afterTie, 0.2)[index]);
    expect(results.map((result) => result.strandId)).toEqual(['A', 'C']);
    expect(pointAt(afterTie, 0)).toEqual(beforeTie.root);
    pointAt(afterTie, 0.16).forEach((value, index) => expect(value).toBeCloseTo([0, 0.02, -0.18][index]));
    afterDelta.forEach((value, index) => expect(value).toBeCloseTo(beforeDelta[index]));
  });

  it('allows a tied group to move predictably between low and high anchors', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.tieStrands(['A', 'B', 'C', 'D'], { id: 'pony-low', anchor: [0, 0.02, -0.18], gatherS: 0.16 });
    const high = editor.tieStrands(['A', 'B', 'C', 'D'], { id: 'pony-high', anchor: [0, 0.17, -0.16], gatherS: 0.14 });
    expect(high).toHaveLength(4);
    expect(editor.exportState().strands.every((strand) => strand.tie?.id === 'pony-high')).toBe(true);
  });

  it('keeps lower strands free when only the upper group is tied', () => {
    const editor = new HairEditor(createDemoHairState());
    const results = editor.tieStrands(['B', 'C'], { id: 'half-up', anchor: [0, 0.12, -0.15], gatherS: 0.13 });
    const state = editor.exportState();
    expect(results.map((result) => result.strandId)).toEqual(['B', 'C']);
    expect(state.strands.find((strand) => strand.id === 'A')?.tie).toBeUndefined();
    expect(state.strands.find((strand) => strand.id === 'D')?.tie).toBeUndefined();
    expect(state.strands.find((strand) => strand.id === 'B')?.tie?.id).toBe('half-up');
  });

  it('ties two distinguishable groups to the same anchor in one undo step', () => {
    const editor = new HairEditor(createDemoHairState());
    const anchor: [number, number, number] = [0, 0.04, -0.18];
    const results = editor.tieGroups([
      { strandIds: ['A', 'C'], tie: { id: 'pair-left', anchor, gatherS: 0.15 } },
      { strandIds: ['B', 'D'], tie: { id: 'pair-right', anchor, gatherS: 0.15 } },
    ]);
    const tied = editor.exportState();
    expect(results).toHaveLength(4);
    expect(tied.strands.find((strand) => strand.id === 'A')?.tie?.id).toBe('pair-left');
    expect(tied.strands.find((strand) => strand.id === 'C')?.tie?.id).toBe('pair-left');
    expect(tied.strands.find((strand) => strand.id === 'B')?.tie?.id).toBe('pair-right');
    editor.undo();
    expect(editor.exportState().strands.every((strand) => strand.tie === undefined)).toBe(true);
  });

  it('creates three distinct procedural braid paths while keeping roots fixed', () => {
    const editor = new HairEditor(createDemoHairState());
    const before = editor.exportState();
    const results = editor.braidStrands(['B', 'C', 'D'], {
      id: 'braid-demo', axisOrigin: [0.04, 0.22, -0.02], startS: 0.04, endS: 0.24, radius: 0.018, pitch: 0.055,
    });
    const after = editor.exportState();
    const paths = ['B', 'C', 'D'].map((id) => pointAt(after.strands.find((strand) => strand.id === id)!, 0.18));
    expect(results).toHaveLength(3);
    expect(paths[0]).not.toEqual(paths[1]);
    expect(paths[1]).not.toEqual(paths[2]);
    expect(pointAt(after.strands.find((strand) => strand.id === 'B')!, 0)).toEqual(before.strands.find((strand) => strand.id === 'B')!.root);
    editor.cutAt('C', 0.2);
    expect(editor.exportState().strands.find((strand) => strand.id === 'C')?.braid?.id).toBe('braid-demo');
  });

  it('sweeps all strands to one side while keeping roots and individual comb direction', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.combBy('C', [0.12, 0, 0]);
    const before = editor.exportState();
    const results = editor.sweepToSide('left');
    const after = editor.exportState();
    expect(results).toHaveLength(4);
    expect(after.strands.every((strand) => strand.sideSweepOffset?.[0] === -0.38)).toBe(true);
    expect(after.strands.find((strand) => strand.id === 'C')?.direction).toEqual(before.strands.find((strand) => strand.id === 'C')?.direction);
    expect(after.strands.map((strand) => pointAt(strand, 0))).toEqual(before.strands.map((strand) => strand.root));
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
    editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0, direction: 1 });
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
    const result = editor.curlRange('C', { startS: 0.25, endS: 0.35, radius: 0.025, pitch: 0.08, phase: 0, direction: 1 });
    expect(result.changed).toBe(false);
    expect(canonicalState(editor.exportState())).toBe(before);
    editor.undo();
    expect(editor.exportState().strands.find((strand) => strand.id === 'C')?.length).toBe(0.4);
  });

  it('keeps a local curl endpoint continuous into the downstream strand', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.curlRange('C', { startS: 0.04, endS: 0.2, radius: 0.025, pitch: 0.09, phase: 0.2, direction: 1 });
    const strand = editor.exportState().strands.find((item) => item.id === 'C')!;
    const atEnd = pointAt(strand, 0.2);
    const afterEnd = pointAt(strand, 0.2001);
    expect(Math.abs(atEnd[0] - afterEnd[0])).toBeLessThan(1e-9);
    expect(Math.abs(atEnd[2] - afterEnd[2])).toBeLessThan(1e-9);
    expect(Math.abs(atEnd[1] - afterEnd[1])).toBeCloseTo(0.0001);
  });

  it('stores and applies clockwise and counter-clockwise curl directions', () => {
    const positive = new HairEditor(createDemoHairState());
    const negative = new HairEditor(createDemoHairState());
    positive.curlRange('C', { startS: 0.04, endS: 0.3, radius: 0.025, pitch: 0.08, phase: 0, direction: 1 });
    negative.curlRange('C', { startS: 0.04, endS: 0.3, radius: 0.025, pitch: 0.08, phase: 0, direction: -1 });
    const positiveStrand = positive.exportState().strands.find((item) => item.id === 'C')!;
    const negativeStrand = negative.exportState().strands.find((item) => item.id === 'C')!;
    expect(positiveStrand.curls[0].direction).toBe(1);
    expect(negativeStrand.curls[0].direction).toBe(-1);
    const positivePoint = pointAt(positiveStrand, 0.07);
    const negativePoint = pointAt(negativeStrand, 0.07);
    expect(positivePoint[0]).toBeCloseTo(negativePoint[0]);
    expect(positivePoint[2] - positiveStrand.root[2]).toBeCloseTo(-(negativePoint[2] - negativeStrand.root[2]));
  });

  it('extends curl parameters continuously only after restoring the recorded tip', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0, direction: 1 });
    const original = editor.exportState().strands.find((item) => item.id === 'C')!;
    const oldCurlSample = pointAt(original, 0.16);
    editor.cutAt('C', 0.2);
    editor.growBy('C', 0.25);
    const grown = editor.exportState().strands.find((item) => item.id === 'C')!;
    expect(grown.length).toBeCloseTo(0.45);
    expect(grown.curls[0].endS).toBeCloseTo(0.45);
    const justAfterFormerTip = pointAt(grown, 0.4001);
    const atFormerTip = pointAt(grown, 0.4);
    expect(Math.hypot(justAfterFormerTip[0] - atFormerTip[0], justAfterFormerTip[2] - atFormerTip[2])).toBeGreaterThan(0);
    expect(oldCurlSample).toEqual(pointAt(grown, 0.16));
  });

  it('round-trips valid saved state and rejects malformed persistence data', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.curlRange('C', { startS: 0.04, endS: 0.3, radius: 0.025, pitch: 0.08, phase: 0, direction: -1 });
    editor.cutAt('C', 0.2);
    const saved = canonicalState(editor.exportState());
    expect(canonicalState(parseHairState(saved)!)).toBe(saved);
    expect(parseHairState('{')).toBeUndefined();
    expect(parseHairState(JSON.stringify({ schemaVersion: 1, strands: [{ id: 'bad' }] }))).toBeUndefined();
  });
});
