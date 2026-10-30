import { describe, expect, it } from 'vitest';
import { assessActionIntent, buildConstraintGraph } from './constraint-graph';
import { createDemoHairState, HairEditor } from './hair-core';

const lowTie = { id: 'pony-low', anchor: [0, 0.02, -0.18] as const, gatherS: 0.16 };
const braid = { id: 'tail-braid', axisOrigin: [0.04, 0.22, -0.02] as const, startS: 0.18, endS: 0.24, radius: 0.018, pitch: 0.055 };

describe('ConstraintGraph decision contract', () => {
  it('represents a tie and a braid as separate ordered material intervals', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.tieStrands(['B', 'C', 'D'], lowTie);
    editor.braidStrands(['B', 'C', 'D'], braid);
    const cIntervals = buildConstraintGraph(editor.exportState()).intervals.filter((interval) => interval.strandId === 'C');
    expect(cIntervals.map((interval) => [interval.type, interval.startS, interval.endS])).toEqual([
      ['tie-gather', 0, 0.16],
      ['braid', 0.18, 0.24],
    ]);
  });

  it('allows a cut below a hair band but requires confirmation above it', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.tieStrands(['A'], lowTie);
    expect(assessActionIntent(editor.exportState(), { type: 'cut', strandId: 'A', atS: 0.22 }).decision).toBe('Allowed');
    expect(assessActionIntent(editor.exportState(), { type: 'cut', strandId: 'A', atS: 0.1 }).decision).toBe('RequiresConfirmation');
  });

  it('requires the user to resolve a braid before combing its braided interval', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.braidStrands(['B', 'C', 'D'], braid);
    const result = assessActionIntent(editor.exportState(), { type: 'comb', strandId: 'C', startS: 0.2, endS: 0.23 });
    expect(result.decision).toBe('RequiresConfirmation');
    expect(result.message).toContain('拆開辮子');
  });

  it('allows a matching ponytail tail to become a braid and rejects a competing anchor', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.tieStrands(['B', 'C', 'D'], lowTie);
    expect(assessActionIntent(editor.exportState(), { type: 'braid', strandIds: ['B', 'C', 'D'], braid }).decision).toBe('Allowed');
    expect(assessActionIntent(editor.exportState(), {
      type: 'tie', strandIds: ['C'], tie: { id: 'competing', anchor: [0.1, 0.1, -0.1], gatherS: 0.14 },
    }).decision).toBe('Rejected');
  });

  it('grows constrained hair only as a free tail by default', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.braidStrands(['B', 'C', 'D'], { ...braid, startS: 0.04 });
    expect(assessActionIntent(editor.exportState(), { type: 'grow', strandId: 'C', deltaS: 0.03 }).decision).toBe('Partial');
  });

  it('rejects a braid when one selected strand is too short instead of stretching it', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.cutAt('B', 0.1);
    expect(assessActionIntent(editor.exportState(), { type: 'braid', strandIds: ['B', 'C', 'D'], braid }).decision).toBe('Rejected');
  });
});
