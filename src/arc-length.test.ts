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

    expect(direct?.schemaVersion).toBe(4);
    expect(history?.version).toBe(4);
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
  expect(parsed?.version).toBe(4);
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
  const base = createDemoHairState();
  const editor = new HairEditor({ ...base, strands: base.strands.map((strand) => strand.id === 'C' ? { ...strand, maximumLength: strand.length } : strand) });
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

it('renders both saved curls when their intervals overlap only within validation tolerance', () => {
  const base = createDemoHairState();
  const first = { startS: 0.04, endS: 0.2000000005, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 as const };
  const second = { startS: 0.2, endS: 0.35, radius: 0.04, pitch: 0.08, phase: 0.3, direction: -1 as const };
  const savedState = { ...base, strands: base.strands.map((s) => s.id === 'C' ? { ...s, curls: [first, second] } : s) };
  const serialized = JSON.stringify(savedState);
  const restored = parseHairState(serialized);
  expect(restored).toBeDefined();
  const actual = restored!.strands.find((s) => s.id === 'C')!;
  const expected = { ...actual, curls: [{ ...first, endS: 0.2 }, second] };
  for (const s of [0, 0.1, 0.2, 0.21, 0.25, 0.3, 0.35]) {
    expect(distance(restPointAt(actual, s), restPointAt(expected, s))).toBeLessThan(1e-8);
  }
  expect(dot(restTangentAt(actual, 0.2 - 1e-6), restTangentAt(actual, 0.2 + 1e-6))).toBeGreaterThan(0.999999);
  // Evaluation must not rewrite the original persisted coordinates.
  expect(JSON.stringify(restored)).toBe(serialized);
  const invalidOverlap = { ...savedState, strands: savedState.strands.map((s) => s.id === 'C' ? { ...s, curls: [{ ...first, endS: 0.200000002 }, second] } : s) };
  expect(parseHairState(JSON.stringify(invalidOverlap))).toBeUndefined();
  const editor = new HairEditor(restored!);
  expect(editor.cutAt('C', 0.29).changed).toBe(true);
  const parsedHistory = parseEditorHistory(JSON.stringify(editor.exportHistory()));
  expect(parsedHistory).toBeDefined();
  const replay = new HairEditor(parsedHistory!.current, parsedHistory!);
  expect(distance(restPointAt(replay.exportState().strands.find((s) => s.id === 'C')!, 0.25), restPointAt(actual, 0.25))).toBeLessThan(1e-9);
  replay.undo(); expect(replay.exportState()).toEqual(restored);
  replay.redo(); expect(replay.exportState()).toEqual(editor.exportState());
});

it('renders and continues a saved curl whose end exceeds the recorded tip by half a nanometre', () => {
  const base = createDemoHairState();
  const curl = { startS: 0.04, endS: 0.6000000005, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 as const };
  const state = { ...base, strands: base.strands.map((s) => s.id === 'C' ? { ...s, curls: [curl] } : s) };
  const serialized = JSON.stringify(state);
  const restored = parseHairState(serialized);
  expect(restored).toBeDefined();
  const original = restored!.strands.find((s) => s.id === 'C')!;
  const expected = { ...original, curls: [{ ...curl, endS: original.maximumLength }] };
  for (const s of [0.04, 0.1, 0.3, 0.4]) expect(distance(restPointAt(original, s), restPointAt(expected, s))).toBeLessThan(1e-8);
  expect(JSON.stringify(restored)).toBe(serialized);
  const editor = new HairEditor(restored!);
  expect(editor.growBy('C', 0.25).changed).toBe(true);
  const grown = editor.exportState().strands.find((s) => s.id === 'C')!;
  expect(grown.length).toBeCloseTo(0.65);
  expect(grown.curls[0].endS).toBeCloseTo(0.65);
  expect(dot(restTangentAt(grown, 0.6 - 1e-6), restTangentAt(grown, 0.6 + 1e-6))).toBeGreaterThan(0.999999);
  expect(dot(restTangentAt(grown, 0.62), restTangentAt(grown, 0.64))).toBeLessThan(0.99);
  editor.undo(); expect(editor.exportState()).toEqual(restored);
  editor.redo(); expect(editor.exportState().strands.find((s) => s.id === 'C')).toEqual(grown);
});

it('retains a later curl after multiple fully covered tolerance-sized intervals', () => {
  const base = createDemoHairState();
  const first = { startS: 0.04, endS: 0.2, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 as const };
  const template = { radius: 0.04, pitch: 0.08, phase: 0.3, direction: -1 as const };
  const curls = [first,
    { ...template, startS: 0.1999999991, endS: 0.1999999992 },
    { ...template, startS: 0.1999999983, endS: 0.1999999984 },
    { ...template, startS: 0.1999999975, endS: 0.35 }];
  const state = { ...base, strands: base.strands.map((strand) => strand.id === 'C' ? { ...strand, curls } : strand) };
  const saved = JSON.stringify(state);
  const parsed = parseHairState(saved);
  expect(parsed).toBeDefined();
  const actual = parsed!.strands.find((strand) => strand.id === 'C')!;
  const expected = { ...actual, curls: [first, { ...curls[3], startS: 0.2 }] };
  for (const s of [0.2, 0.21, 0.25, 0.3, 0.35]) {
    expect(distance(restPointAt(actual, s), restPointAt(expected, s))).toBeLessThan(1e-9);
  }
  expect(JSON.stringify(parsed)).toBe(saved);
});

it('continues the actual terminal curl without rewriting later fully covered records', () => {
  for (const coveredEnd of [0.6, 0.6000000005, 0.600000001]) {
    const base = createDemoHairState();
    const first = { startS: 0.04, endS: 0.6, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 as const };
    const covered = { startS: 0.5999999995, endS: coveredEnd, radius: 0.04, pitch: 0.12, phase: 0.8, direction: -1 as const };
    const state = { ...base, strands: base.strands.map((strand) => strand.id === 'C' ? { ...strand, length: 0.6, maximumLength: 0.6, curls: [first, covered] } : strand) };
    const parsed = parseHairState(JSON.stringify(state));
    expect(parsed).toBeDefined();
    const editor = new HairEditor(parsed!);
    const before = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    expect(editor.growBy('C', 0.05).changed).toBe(true);
    const after = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    expect(after.curls.slice(0, 2)).toEqual([first, covered]);
    expect(after.curls[2]).toMatchObject({ startS: 0.6, endS: 0.65, radius: first.radius, pitch: first.pitch, phase: first.phase, direction: first.direction });
    const expected = { ...after, curls: [{ ...first, endS: 0.65 }] };
    for (const s of [0.2, 0.5, 0.6, 0.61, 0.64]) expect(distance(restPointAt(after, s), restPointAt(expected, s))).toBeLessThan(1e-7);
    expect(dot(restTangentAt(after, 0.6 - 1e-6), restTangentAt(after, 0.6 + 1e-6))).toBeGreaterThan(0.999999);
    expect(parseEditorHistory(JSON.stringify(editor.exportHistory()))).toBeDefined();
    editor.undo(); expect(editor.exportState().strands.find((strand) => strand.id === 'C')).toEqual(before);
    editor.redo(); expect(editor.exportState().strands.find((strand) => strand.id === 'C')).toEqual(after);
    expect(editor.growBy('C', 0.05).changed).toBe(true);
    const again = editor.exportState().strands.find((strand) => strand.id === 'C')!;
    expect(again.curls).toHaveLength(3);
    expect(again.curls.slice(0, 2)).toEqual([first, covered]);
    expect(again.curls[2].endS).toBeCloseTo(0.7);
  }
});

it('rejects an unstable covered-tail continuation without changing its data or history', () => {
  const base = createDemoHairState();
  const first = { startS: 0.04, endS: 0.6, radius: 1e-20, pitch: 0.08, phase: 0.3, direction: 1 as const };
  const covered = { startS: 0.5999999995, endS: 0.6, radius: 0.04, pitch: 0.12, phase: 0.8, direction: -1 as const };
  const state = { ...base, strands: base.strands.map((strand) => strand.id === 'C' ? { ...strand, length: 0.6, maximumLength: 0.6, curls: [first, covered] } : strand) };
  const parsed = parseHairState(JSON.stringify(state));
  expect(parsed).toBeDefined();
  const editor = new HairEditor(parsed!);
  const result = editor.growBy('C', 0.05);
  expect(result.changed).toBe(false);
  expect(result.reason).toContain('無法安全');
  expect(editor.exportState()).toEqual(parsed);
  expect(editor.canUndo).toBe(false);
});

describe('curl continuation frame', () => {
  it('reconstructs an unmodified suffix at the same material coordinates', async () => {
    const { curlContinuationFrame, evaluateCurlContinuation } = await import('./arc-length');
    for (const direction of [-1, 1] as const) for (const phase of [0, 0.7, 2.4]) for (const orientationMode of [undefined, 'phase-v1'] as const) {
      const curl = { startS: 0.04, endS: 0.35, radius: 0.025, pitch: 0.08, phase, direction, orientationMode };
      const strand = testStrand({ curls: [curl] });
      const split = 0.173;
      const frame = curlContinuationFrame(strand, split);
      expect(frame).toBeDefined();
      for (let i = 0; i <= 40; i += 1) {
        const s = split + (curl.endS - split) * i / 40;
        const actual = evaluateCurlContinuation(curl, frame!, split, s);
        expect(distance(actual.point, restPointAt(strand, s))).toBeLessThan(1e-9);
        expect(dot(actual.tangent, restTangentAt(strand, s))).toBeGreaterThan(1 - 1e-9);
      }
    }
  });
  it('rejects absent and numerically unstable continuation frames', async () => {
    const { curlContinuationFrame } = await import('./arc-length');
    expect(curlContinuationFrame(testStrand(), 0.2)).toBeUndefined();
    const strand = testStrand({ curls: [{ startS: 0.04, endS: 0.35, radius: 1e-20, pitch: 1, phase: 0, direction: 1 }] });
    expect(curlContinuationFrame(strand, 0.2)).toBeUndefined();
  });
});

it('preserves a continuation local shape when its incoming tangent changes', async () => {
  const { curlContinuationFrame, evaluateCurlContinuation } = await import('./arc-length');
  const curl = { startS: 0.04, endS: 0.35, radius: 0.025, pitch: 0.08, phase: 0.7, direction: -1 as const, orientationMode: 'phase-v1' as const };
  const strand = testStrand({ curls: [curl] });
  const split = 0.173;
  const frame = curlContinuationFrame(strand, split)!;
  const moved = { ...frame, point: [0.4, -0.2, 0.1] as Vec3, tangent: [0, 0, 1] as Vec3 };
  const coordinates = [split, 0.2, 0.25, 0.3, 0.35];
  const before = coordinates.map((s) => evaluateCurlContinuation(curl, frame, split, s));
  const after = coordinates.map((s) => evaluateCurlContinuation(curl, moved, split, s));
  for (let i = 0; i < coordinates.length; i += 1) for (let j = 0; j < coordinates.length; j += 1) {
    expect(distance(before[i].point, before[j].point)).toBeCloseTo(distance(after[i].point, after[j].point), 9);
    expect(dot(before[i].tangent, before[j].tangent)).toBeCloseTo(dot(after[i].tangent, after[j].tangent), 9);
  }
  expect(after[0].point).toEqual(moved.point);
  expect(dot(after[0].tangent, moved.tangent)).toBeGreaterThan(1 - 1e-9);
});
