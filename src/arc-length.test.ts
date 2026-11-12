import { describe, expect, it } from 'vitest';
import { ArcLengthSampler, measuredRestArcLength, restPointAt, restTangentAt } from './arc-length';
import { createDemoHairState, HairEditor, parseEditorHistory, parseHairState, pointAt, sampleStrandWithArcS, type GuideStrand, type Vec3 } from './hair-core';

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

  it('carries exact rest arc endpoints into every rendered sample', () => {
    const strand = testStrand({
      curls: [{ startS: 0.04, endS: 0.32, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 }],
    });
    const samples = sampleStrandWithArcS(strand, 4);
    expect(samples.map((sample) => sample.s)).toEqual([0, 0.1, 0.2, 0.30000000000000004, 0.4]);
    samples.forEach((sample) => expect(distance(sample.point, pointAt(strand, sample.s))).toBeLessThan(1e-12));
    expect(sampleStrandWithArcS(strand, 0).map((sample) => sample.s)).toEqual([0, 0.4]);
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

    expect(direct?.schemaVersion).toBe(3);
    expect(history?.version).toBe(3);
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

describe('curl orientation compatibility', () => {
  it('uses phase for new curls while preserving the start point, tangent and arc length', () => {
    const create = (phase: number) => {
      const editor = new HairEditor(createDemoHairState());
      editor.curlRange('C', { startS: 0.04, endS: 0.3, radius: 0.025, pitch: 0.08, phase, direction: 1 });
      return editor.exportState().strands.find((strand) => strand.id === 'C')!;
    };
    const a = create(0), b = create(Math.PI / 2);
    expect(distance(restPointAt(a, 0.13), restPointAt(b, 0.13))).toBeGreaterThan(0.01);
    expect(distance(restPointAt(a, 0.04), restPointAt(b, 0.04))).toBeLessThan(1e-10);
    for (const strand of [a, b]) {
      expect(dot(restTangentAt(strand, 0.04 - 1e-6), restTangentAt(strand, 0.04 + 1e-6))).toBeGreaterThan(0.999999);
      expect(dot(restTangentAt(strand, 0.3 - 1e-6), restTangentAt(strand, 0.3 + 1e-6))).toBeGreaterThan(0.999999);
      expect(measuredRestArcLength(strand)).toBeCloseTo(strand.length, 4);
    }
    expect(parseHairState(JSON.stringify({ schemaVersion: 3, strands: [b] }))?.strands[0].curls[0].orientationMode).toBe('phase-v1');
  });
  it('leaves unversioned saved curls on the legacy path and rejects unknown modes', () => {
    const legacy = { startS: 0.04, endS: 0.3, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 as const };
    const a = testStrand({ curls: [legacy] });
    const b = testStrand({ curls: [{ ...legacy, phase: 0 }] });
    for (let i = 0; i <= 40; i += 1) expect(distance(restPointAt(a, i / 100), restPointAt(b, i / 100))).toBeLessThan(1e-10);
    const invalid = { ...a, curls: [{ ...legacy, orientationMode: 'unknown' }] };
    expect(parseHairState(JSON.stringify({ schemaVersion: 2, strands: [invalid] }))).toBeUndefined();
  });
});


it('upgrades v2 history snapshots without losing legacy or versioned curl geometry', () => {
  const legacy = { startS: 0.04, endS: 0.3, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 as const };
  const original = testStrand({ curls: [legacy] });
  const transitional = testStrand({ curls: [{ ...legacy, orientationMode: 'phase-v1' }] });
  const oldState = (strand: GuideStrand) => ({ schemaVersion: 2, strands: [strand] });
  const parsed = parseEditorHistory(JSON.stringify({ version: 2, current: oldState(transitional), undo: [oldState(original)], redo: [oldState(transitional)] }));
  expect(parsed?.version).toBe(3);
  for (const [restored, expected] of [[parsed!.current.strands[0], transitional], [parsed!.undo[0].strands[0], original], [parsed!.redo[0].strands[0], transitional]] as const) {
    expect(restored.curls).toEqual(expected.curls);
    for (let i = 0; i <= 40; i += 1) expect(distance(restPointAt(restored, i / 100), restPointAt(expected, i / 100))).toBeLessThan(1e-10);
  }
  expect(parseEditorHistory(JSON.stringify({ version: 99, current: oldState(original), undo: [], redo: [] }))).toBeUndefined();
});

it('restores and samples zero-length saved strands through undo and redo', async () => {
  const { visibleHairSamples } = await import('./visible-hair');
  const empty = testStrand({ root: [0, 0.3, 0], length: 0, maximumLength: 0 });
  const zeroState = { schemaVersion: 3, strands: [empty] };
  const regularState = { schemaVersion: 3, strands: [testStrand()] };
  const history = parseEditorHistory(JSON.stringify({ version: 3, current: regularState, undo: [zeroState], redo: [] }))!;
  const editor = new HairEditor(history.current, history);
  editor.undo();
  const restored = editor.exportState().strands[0];
  expect(restPointAt(restored, 0)).toEqual(empty.root);
  expect(restTangentAt(restored, 0)).toEqual([0, -1, 0]);
  expect(sampleStrandWithArcS(restored).every((sample) => sample.s === 0 && distance(sample.point, empty.root) === 0)).toBe(true);
  const head = { center: [0, 0, 0] as const, radii: [0.22, 0.2464, 0.2024] as const, clearance: 0.018 };
  expect(visibleHairSamples(restored, head).every((sample) => distance(sample.point, empty.root) === 0)).toBe(true);
  editor.redo();
  expect(editor.exportState().strands[0].length).toBe(0.4);
});

it('rejects legacy migrations exceeding the prototype work budget before allocating samples', () => {
  const huge = { schemaVersion: 1, strands: [{ ...testStrand(), length: 0.4, maximumLength: 1e100 }] };
  expect(parseHairState(JSON.stringify(huge))).toBeUndefined();
  expect(parseEditorHistory(JSON.stringify({ version: 1, current: huge, undo: [], redo: [] }))).toBeUndefined();
  const legacy = { schemaVersion: 1, strands: [{ ...testStrand(), maximumLength: 10 }] };
  expect(parseEditorHistory(JSON.stringify({ version: 1, current: legacy, undo: Array(20).fill(legacy), redo: [] }))).toBeDefined();
  const many = { schemaVersion: 1, strands: [{ ...testStrand(), maximumLength: 30 }] };
  expect(parseEditorHistory(JSON.stringify({ version: 1, current: many, undo: Array(20).fill(many), redo: Array(20).fill(many) }))).toBeUndefined();
});

it('extends past the recorded end without changing the retained curl or breaking the tangent', () => {
  const editor = new HairEditor(createDemoHairState());
  editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.7, direction: 1 });
  editor.growBy('C', 0.2);
  const before = editor.exportState().strands.find((strand) => strand.id === 'C')!;
  const samples = Array.from({ length: 61 }, (_, i) => restPointAt(before, i * 0.01));
  expect(editor.growBy('C', 0.05).changed).toBe(true);
  const grown = editor.exportState().strands.find((strand) => strand.id === 'C')!;
  expect(grown.length).toBeCloseTo(0.65);
  expect(grown.maximumLength).toBeCloseTo(0.65);
  expect(grown.curls[0].endS).toBeCloseTo(0.65);
  samples.forEach((p, i) => expect(distance(p, restPointAt(grown, i * 0.01))).toBeLessThan(1e-9));
  expect(dot(restTangentAt(grown, 0.6 - 1e-6), restTangentAt(grown, 0.6 + 1e-6))).toBeGreaterThan(0.999999);
  const saved = parseEditorHistory(JSON.stringify(editor.exportHistory()))!;
  const restored = new HairEditor(saved.current, saved);
  restored.undo();
  expect(restored.exportState().strands.find((strand) => strand.id === 'C')?.length).toBeCloseTo(0.6);
  restored.redo();
  expect(restored.exportState().strands.find((strand) => strand.id === 'C')?.length).toBeCloseTo(0.65);
});

it('extends a straight tail without extending a curl that ends before the recorded tip', () => {
  const editor = new HairEditor(createDemoHairState());
  editor.curlRange('C', { startS: 0.04, endS: 0.2, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 });
  editor.growBy('C', 0.2);
  const prior = editor.exportState().strands.find((strand) => strand.id === 'C')!;
  editor.growBy('C', 0.05);
  const grown = editor.exportState().strands.find((strand) => strand.id === 'C')!;
  expect(grown.curls).toEqual(prior.curls);
  expect(dot(restTangentAt(grown, 0.6), restTangentAt(grown, 0.65))).toBeGreaterThan(0.999999);
  expect(distance(restPointAt(prior, 0.55), restPointAt(grown, 0.55))).toBeLessThan(1e-9);
});
