import { describe, expect, it } from 'vitest';
import { ArcLengthSampler, measuredRestArcLength, restPointAt, restTangentAt } from './arc-length';
import { createDemoHairState, HairEditor, parseEditorHistory, parseHairState, type GuideStrand, type Vec3 } from './hair-core';

const distance = (left: Vec3, right: Vec3): number => Math.hypot(
  left[0] - right[0], left[1] - right[1], left[2] - right[2],
);

const dot = (left: Vec3, right: Vec3): number => left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

function testStrand(overrides: Partial<GuideStrand> = {}): GuideStrand {
  return {
    id: 'arc-test',
    root: [0, 0.25, 0],
    direction: [0, -1, 0],
    length: 0.4,
    maximumLength: 0.6,
    curls: [],
    ...overrides,
  };
}

describe('rest arc-length sampler', () => {
  it('keeps physical rest length invariant under base direction, comb, parting and sweep changes', () => {
    const strands = [
      testStrand(),
      testStrand({ direction: [0.4, -0.8, 0.3] }),
      testStrand({ direction: [0.15, -0.8, -0.25], partingOffset: [-0.2, 0, 0] }),
      testStrand({ direction: [-0.1, -0.7, 0.2], sideSweepOffset: [0.38, 0, 0] }),
    ];
    for (const strand of strands) {
      expect(measuredRestArcLength(strand)).toBeCloseTo(strand.length, 4);
      expect(restPointAt(strand, 0)).toEqual(strand.root);
      expect(Math.hypot(...restTangentAt(strand, 0.2))).toBeCloseTo(1, 10);
    }
  });

  it('maps curl s to a unit-speed helix with continuous position and tangent at both boundaries', () => {
    const strand = testStrand({
      curls: [{ startS: 0.04, endS: 0.32, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 }],
    });
    const sampler = new ArcLengthSampler(strand);
    const epsilon = 0.00001;
    expect(measuredRestArcLength(strand)).toBeCloseTo(strand.length, 4);
    expect(distance(sampler.positionAtS(0.19), sampler.positionAtS(0.1901))).toBeCloseTo(0.0001, 7);

    for (const boundary of [0.04, 0.32]) {
      const before = sampler.positionAtS(boundary - epsilon);
      const at = sampler.positionAtS(boundary);
      const after = sampler.positionAtS(boundary + epsilon);
      expect(distance(before, at)).toBeCloseTo(epsilon, 8);
      expect(distance(at, after)).toBeCloseTo(epsilon, 8);
      expect(dot(sampler.tangentAtS(boundary - epsilon), sampler.tangentAtS(boundary + epsilon))).toBeGreaterThan(0.999999);
    }
  });

  it('preserves every retained rest point when a curled strand is cut', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.curlRange('C', { startS: 0.04, endS: 0.25, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 });
    const before = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    const retained = Array.from({ length: 22 }, (_, index) => (index * 0.21) / 21)
      .map((s) => ({ s, point: restPointAt(before, s) }));

    expect(editor.cutAt('C', 0.21).changed).toBe(true);
    const cut = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    expect(cut.length).toBeCloseTo(0.21, 10);
    expect(measuredRestArcLength(cut)).toBeCloseTo(cut.length, 4);
    retained.forEach(({ s, point }) => expect(distance(restPointAt(cut, s), point)).toBeLessThanOrEqual(0.0005));
  });

  it('restores both a partial curl and its free tail after cut then grow', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.curlRange('C', { startS: 0.04, endS: 0.22, radius: 0.025, pitch: 0.08, phase: 0.1, direction: -1 });
    const original = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    const originalPoints = Array.from({ length: 101 }, (_, index) => {
      const s = (index * original.length) / 100;
      return { s, point: restPointAt(original, s) };
    });

    editor.cutAt('C', 0.12);
    editor.growBy('C', 0.28);
    const restored = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    expect(restored.length).toBeCloseTo(original.length, 10);
    expect(restored.curls[0].endS).toBeCloseTo(0.22, 10);
    originalPoints.forEach(({ s, point }) => expect(distance(restPointAt(restored, s), point)).toBeLessThanOrEqual(0.0005));
  });

  it('migrates every v1 history snapshot to physical v2 coordinates', () => {
    const legacyStrand = {
      id: 'legacy-C',
      root: [0.05, 0.25, 0.05],
      direction: [0, -1, 0],
      length: 0.4,
      maximumLength: 0.6,
      curls: [{ startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 }],
      tie: { id: 'legacy-band', anchor: [0, 0.02, -0.18], gatherS: 0.16 },
    };
    const current = { schemaVersion: 1, strands: [legacyStrand] };
    const undo = { schemaVersion: 1, strands: [{ ...legacyStrand, length: 0.2 }] };
    const redo = { schemaVersion: 1, strands: [{ ...legacyStrand, length: 0.3 }] };
    const history = parseEditorHistory(JSON.stringify({ version: 1, current, undo: [undo], redo: [redo] }));
    const direct = parseHairState(JSON.stringify(current));

    expect(direct?.schemaVersion).toBe(2);
    expect(history?.version).toBe(2);
    expect(history?.undo).toHaveLength(1);
    expect(history?.redo).toHaveLength(1);
    expect(history!.current.strands[0].length).toBeGreaterThan(0.75);
    expect(history!.undo[0].strands[0].length).toBeLessThan(history!.redo[0].strands[0].length);
    expect(history!.redo[0].strands[0].length).toBeLessThan(history!.current.strands[0].length);
    for (const state of [history!.current, ...history!.undo, ...history!.redo]) {
      const strand = state.strands[0];
      expect(strand.id).toBe('legacy-C');
      expect(strand.length).toBeGreaterThan(0);
      expect(strand.maximumLength).toBeGreaterThan(strand.length);
      expect(strand.curls[0].startS).toBeGreaterThan(0);
      expect(strand.curls[0].endS).toBeLessThanOrEqual(strand.maximumLength);
      expect(strand.tie?.gatherS).toBeGreaterThan(0);
      expect(Number.isFinite(measuredRestArcLength(strand))).toBe(true);
    }
  });

  it('rejects invalid v2 rest coordinates instead of silently repairing them', () => {
    const valid = testStrand();
    expect(parseHairState(JSON.stringify({
      schemaVersion: 2,
      strands: [{ ...valid, direction: [0, 0, 0] }],
    }))).toBeUndefined();
    expect(parseHairState(JSON.stringify({
      schemaVersion: 2,
      strands: [{
        ...valid,
        curls: [
          { startS: 0.04, endS: 0.2, radius: 0.02, pitch: 0.08, phase: 0, direction: 1 },
          { startS: 0.19, endS: 0.3, radius: 0.02, pitch: 0.08, phase: 0, direction: -1 },
        ],
      }],
    }))).toBeUndefined();
  });
});
