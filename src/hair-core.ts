import { assessActionIntent } from './constraint-graph';
import { restPointAt } from './arc-length';

export type Vec3 = readonly [number, number, number];

export interface CurlSegment {
  readonly startS: number;
  readonly endS: number;
  readonly radius: number;
  readonly pitch: number;
  readonly phase: number;
  readonly direction: -1 | 1;
}

export interface GuideStrand {
  readonly id: string;
  readonly root: Vec3;
  readonly direction: Vec3;
  readonly partingOffset?: Vec3;
  readonly sideSweepOffset?: Vec3;
  readonly earTuck?: 'left' | 'right';
  readonly tie?: HairTie;
  readonly braid?: BraidConstraint;
  readonly length: number;
  readonly maximumLength: number;
  readonly curls: readonly CurlSegment[];
}

export interface HairTie {
  readonly id: string;
  readonly anchor: Vec3;
  readonly gatherS: number;
}

export interface TieGroup {
  readonly strandIds: readonly string[];
  readonly tie: HairTie;
}

export interface BraidConstraint {
  readonly id: string;
  readonly index: 0 | 1 | 2;
  readonly axisOrigin: Vec3;
  readonly startS: number;
  readonly endS: number;
  readonly radius: number;
  readonly pitch: number;
}

export interface HairState {
  /** schema v2 defines every persisted s/length in physical rest arc metres. */
  readonly schemaVersion: 2;
  readonly strands: readonly GuideStrand[];
}

export interface EditorHistory {
  readonly version: 2;
  readonly current: HairState;
  readonly undo: readonly HairState[];
  readonly redo: readonly HairState[];
}

interface LegacyHairState {
  readonly schemaVersion: 1;
  readonly strands: readonly GuideStrand[];
}

interface LegacyEditorHistory {
  readonly version: 1;
  readonly current: LegacyHairState;
  readonly undo: readonly LegacyHairState[];
  readonly redo: readonly LegacyHairState[];
}

export interface EditResult {
  readonly changed: boolean;
  readonly reason?: string;
  readonly strandId: string;
  readonly oldLength?: number;
  readonly newLength?: number;
}

export interface CutTarget {
  readonly strandId: string;
  readonly arcLengthMeters: number;
}

const minimumStubble = 0.01;
const copyState = (state: HairState): HairState => structuredClone(state);

const replaceStrand = (state: HairState, strand: GuideStrand): HairState => ({
  ...state,
  strands: state.strands.map((item) => item.id === strand.id ? strand : item),
});

export function canonicalState(state: HairState): string {
  return JSON.stringify({
    schemaVersion: state.schemaVersion,
    strands: [...state.strands].sort((a, b) => a.id.localeCompare(b.id)),
  });
}

const vectorIsValid = (vector: unknown): vector is Vec3 => Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite);
const vectorHasLength = (vector: Vec3): boolean => Math.hypot(vector[0], vector[1], vector[2]) > 1e-10;

function tieIsValid(value: unknown): value is HairTie {
  if (!value || typeof value !== 'object') return false;
  const tie = value as Partial<HairTie>;
  return typeof tie.id === 'string' && tie.id.length > 0 && vectorIsValid(tie.anchor) && Number.isFinite(tie.gatherS) && tie.gatherS! > 0;
}

function braidIsValid(value: unknown): value is BraidConstraint {
  if (!value || typeof value !== 'object') return false;
  const braid = value as Partial<BraidConstraint>;
  return typeof braid.id === 'string' && braid.id.length > 0 && [0, 1, 2].includes(braid.index ?? -1) && vectorIsValid(braid.axisOrigin) &&
    Number.isFinite(braid.startS) && Number.isFinite(braid.endS) && braid.endS! > braid.startS! &&
    Number.isFinite(braid.radius) && braid.radius! > 0 && Number.isFinite(braid.pitch) && braid.pitch! > 0;
}

function curlIsValid(value: unknown): value is CurlSegment {
  if (!value || typeof value !== 'object') return false;
  const curl = value as Partial<CurlSegment>;
  return Number.isFinite(curl.startS) && Number.isFinite(curl.endS) && Number.isFinite(curl.radius) && Number.isFinite(curl.pitch) && Number.isFinite(curl.phase) &&
    curl.startS! >= 0 && curl.endS! > curl.startS! && curl.radius! > 0 && curl.pitch! > 0 && (curl.direction === -1 || curl.direction === 1);
}

function strandIsValid(value: unknown, requirePhysicalRanges: boolean): value is GuideStrand {
  if (!value || typeof value !== 'object') return false;
  const strand = value as Partial<GuideStrand>;
  if (typeof strand.id !== 'string' || strand.id.length === 0 || !vectorIsValid(strand.root) || !vectorIsValid(strand.direction) || !vectorHasLength(strand.direction) ||
    (strand.partingOffset !== undefined && !vectorIsValid(strand.partingOffset)) ||
    (strand.sideSweepOffset !== undefined && !vectorIsValid(strand.sideSweepOffset)) ||
    (strand.earTuck !== undefined && strand.earTuck !== 'left' && strand.earTuck !== 'right') ||
    (strand.tie !== undefined && !tieIsValid(strand.tie)) || (strand.braid !== undefined && !braidIsValid(strand.braid)) ||
    !Number.isFinite(strand.length) || !Number.isFinite(strand.maximumLength) || strand.length! < 0 || strand.maximumLength! < strand.length! ||
    !Array.isArray(strand.curls) || !strand.curls.every(curlIsValid)) return false;
  if (!requirePhysicalRanges) return true;
  if (strand.tie && strand.tie.gatherS > strand.maximumLength! + 1e-9) return false;
  if (strand.braid && strand.braid.endS > strand.maximumLength! + 1e-9) return false;
  let previousEnd = 0;
  for (const curl of strand.curls) {
    if (curl.startS < previousEnd - 1e-9 || curl.endS > strand.maximumLength! + 1e-9) return false;
    previousEnd = curl.endS;
  }
  return true;
}

function stateHasValidStrands(strands: unknown, requirePhysicalRanges: boolean): strands is readonly GuideStrand[] {
  return Array.isArray(strands) && strands.length > 0 && strands.every((strand) => strandIsValid(strand, requirePhysicalRanges)) &&
    new Set(strands.map((strand) => strand.id)).size === strands.length;
}

interface LegacyArcSample {
  readonly u: number;
  readonly s: number;
}

function legacyRestPointAt(strand: GuideStrand, u: number): Vec3 {
  const clamped = Math.max(0, Math.min(u, strand.maximumLength));
  const partingOffset = strand.partingOffset ?? [0, 0, 0] as Vec3;
  const sideSweepOffset = strand.sideSweepOffset ?? [0, 0, 0] as Vec3;
  const point: [number, number, number] = [
    strand.root[0] + (strand.direction[0] + partingOffset[0] + sideSweepOffset[0]) * clamped,
    strand.root[1] + (strand.direction[1] + partingOffset[1] + sideSweepOffset[1]) * clamped,
    strand.root[2] + (strand.direction[2] + partingOffset[2] + sideSweepOffset[2]) * clamped,
  ];
  for (const curl of strand.curls) {
    const curlU = Math.max(curl.startS, Math.min(clamped, curl.endS));
    if (curlU <= curl.startS) continue;
    const phase = curl.phase + curl.direction * ((curlU - curl.startS) / curl.pitch) * Math.PI * 2;
    point[0] += curl.radius * (Math.cos(phase) - Math.cos(curl.phase));
    point[2] += curl.radius * (Math.sin(phase) - Math.sin(curl.phase));
  }
  return point;
}

function legacyArcMap(strand: GuideStrand): readonly LegacyArcSample[] {
  const step = 0.00025;
  const count = Math.max(1, Math.ceil(strand.maximumLength / step));
  const samples: LegacyArcSample[] = [{ u: 0, s: 0 }];
  let previousPoint = legacyRestPointAt(strand, 0);
  let total = 0;
  for (let index = 1; index <= count; index += 1) {
    const u = index === count ? strand.maximumLength : index * step;
    const point = legacyRestPointAt(strand, u);
    total += Math.hypot(point[0] - previousPoint[0], point[1] - previousPoint[1], point[2] - previousPoint[2]);
    samples.push({ u, s: total });
    previousPoint = point;
  }
  return samples;
}

function sAtLegacyU(samples: readonly LegacyArcSample[], u: number): number {
  const target = Math.max(0, Math.min(u, samples.at(-1)!.u));
  let low = 0;
  let high = samples.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].u < target) low = middle;
    else high = middle;
  }
  const before = samples[low];
  const after = samples[high];
  const span = after.u - before.u;
  return span <= 0 ? before.s : before.s + (after.s - before.s) * ((target - before.u) / span);
}

/** Converts persisted v1 parameter coordinates into v2 physical rest arc metres. */
function migrateLegacyHairState(state: LegacyHairState): HairState | undefined {
  if (!stateHasValidStrands(state.strands, false)) return undefined;
  const strands = state.strands.map((legacy) => {
    const samples = legacyArcMap(legacy);
    const maximumLength = samples.at(-1)!.s;
    const visibleLength = sAtLegacyU(samples, legacy.length);
    const curls = [...legacy.curls]
      .sort((left, right) => left.startS - right.startS)
      .map((curl, index, all) => ({
        ...curl,
        startS: sAtLegacyU(samples, curl.startS),
        endS: curl.endS >= legacy.length - 1e-9 && index === all.length - 1 ? maximumLength : sAtLegacyU(samples, curl.endS),
      }));
    const tie = legacy.tie ? { ...legacy.tie, gatherS: sAtLegacyU(samples, legacy.tie.gatherS) } : undefined;
    const braid = legacy.braid ? {
      ...legacy.braid,
      startS: sAtLegacyU(samples, legacy.braid.startS),
      endS: sAtLegacyU(samples, legacy.braid.endS),
    } : undefined;
    return { ...legacy, length: visibleLength, maximumLength, curls, tie, braid };
  });
  const migrated: HairState = { schemaVersion: 2, strands };
  return stateHasValidStrands(migrated.strands, true) ? copyState(migrated) : undefined;
}

export function parseHairState(serialized: string): HairState | undefined {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Partial<HairState> | Partial<LegacyHairState>;
    if (candidate.schemaVersion === 2 && stateHasValidStrands(candidate.strands, true)) {
      return copyState(candidate as HairState);
    }
    if (candidate.schemaVersion === 1 && stateHasValidStrands(candidate.strands, false)) {
      return migrateLegacyHairState(candidate as LegacyHairState);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function parseEditorHistory(serialized: string): EditorHistory | undefined {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Partial<EditorHistory> | Partial<LegacyEditorHistory>;
    if ((candidate.version !== 1 && candidate.version !== 2) || !Array.isArray(candidate.undo) || !Array.isArray(candidate.redo) ||
      candidate.undo.length > 20 || candidate.redo.length > 20) return undefined;
    const parseState = (state: unknown): HairState | undefined => parseHairState(JSON.stringify(state));
    const current = parseState(candidate.current);
    const undo = candidate.undo.map(parseState);
    const redo = candidate.redo.map(parseState);
    if (!current || undo.some((state) => !state) || redo.some((state) => !state)) return undefined;
    return {
      version: 2,
      current,
      undo: undo as HairState[],
      redo: redo as HairState[],
    };
  } catch {
    return undefined;
  }
}

function pointWithoutTie(strand: GuideStrand, s: number): Vec3 {
  const clampedS = Math.max(0, Math.min(s, strand.length));
  const rest = restPointAt(strand, clampedS);
  const base: [number, number, number] = [rest[0], rest[1], rest[2]];
  if (strand.earTuck) {
    const side = strand.earTuck === 'left' ? -1 : 1;
    const t = Math.max(0, Math.min(1, (clampedS - 0.035) / 0.105));
    const ease = t * t * (3 - 2 * t);
    base[0] += (side * 0.23 - strand.root[0]) * ease;
    base[2] += 0.055 * ease;
  }
  return base;
}

function pointWithoutBraid(strand: GuideStrand, s: number): Vec3 {
  const clampedS = Math.max(0, Math.min(s, strand.length));
  const base = pointWithoutTie(strand, clampedS);
  if (!strand.tie) return base;
  const gatherS = Math.min(strand.tie.gatherS, strand.length);
  const gatherPoint = pointWithoutTie(strand, gatherS);
  const t = Math.max(0, Math.min(1, clampedS / gatherS));
  const ease = t * t * (3 - 2 * t);
  return [
    base[0] + (strand.tie.anchor[0] - gatherPoint[0]) * ease,
    base[1] + (strand.tie.anchor[1] - gatherPoint[1]) * ease,
    base[2] + (strand.tie.anchor[2] - gatherPoint[2]) * ease,
  ];
}

export function pointAt(strand: GuideStrand, s: number): Vec3 {
  const clampedS = Math.max(0, Math.min(s, strand.length));
  const base = pointWithoutBraid(strand, clampedS);
  if (!strand.braid) return base;
  const braid = strand.braid;
  const braidS = Math.max(braid.startS, Math.min(clampedS, braid.endS));
  const progress = (braidS - braid.startS) / (braid.endS - braid.startS);
  const phase = braid.index * (Math.PI * 2 / 3) + ((braidS - braid.startS) / braid.pitch) * Math.PI * 2;
  const target: Vec3 = [
    braid.axisOrigin[0] + Math.cos(phase) * braid.radius,
    braid.axisOrigin[1] - (braidS - braid.startS),
    braid.axisOrigin[2] - progress * 0.1 + Math.sin(phase) * braid.radius,
  ];
  const transition = Math.max(0, Math.min(1, (braidS - braid.startS) / 0.1));
  const ease = transition * transition * (3 - 2 * transition);
  const baseAtBraidS = pointWithoutBraid(strand, braidS);
  const correction: Vec3 = [
    (target[0] - baseAtBraidS[0]) * ease,
    (target[1] - baseAtBraidS[1]) * ease,
    (target[2] - baseAtBraidS[2]) * ease,
  ];
  return [base[0] + correction[0], base[1] + correction[1], base[2] + correction[2]];
}

export interface StrandSample {
  readonly s: number;
  readonly point: Vec3;
}

export function sampleStrandWithArcS(strand: GuideStrand, segments = 40): readonly StrandSample[] {
  const count = Math.max(1, Math.floor(segments));
  return Array.from({ length: count + 1 }, (_, index) => {
    const s = (strand.length * index) / count;
    return { s, point: pointAt(strand, s) };
  });
}

export function sampleStrand(strand: GuideStrand, segments = 40): Vec3[] {
  return sampleStrandWithArcS(strand, segments).map((sample) => sample.point);
}

export class HairEditor {
  private state: HairState;
  private undoStack: HairState[] = [];
  private redoStack: HairState[] = [];

  public constructor(initial: HairState, history?: Pick<EditorHistory, 'undo' | 'redo'>) {
    this.state = copyState(initial);
    this.undoStack = (history?.undo ?? []).slice(-20).map(copyState);
    this.redoStack = (history?.redo ?? []).slice(-20).map(copyState);
  }

  public exportState(): HairState { return copyState(this.state); }
  public exportHistory(): EditorHistory {
    return {
      version: 2,
      current: this.exportState(),
      undo: this.undoStack.map(copyState),
      redo: this.redoStack.map(copyState),
    };
  }
  public get canUndo(): boolean { return this.undoStack.length > 0; }
  public get canRedo(): boolean { return this.redoStack.length > 0; }

  public cutAt(strandId: string, arcLengthMeters: number): EditResult {
    const strand = this.state.strands.find((candidate) => candidate.id === strandId);
    if (!strand || !Number.isFinite(arcLengthMeters)) return { changed: false, reason: 'Invalid target', strandId };
    const length = Math.max(minimumStubble, Math.min(arcLengthMeters, strand.length));
    if (length >= strand.length) return { changed: false, reason: 'No downstream geometry selected', strandId };
    const constraint = assessActionIntent(this.state, { type: 'cut', strandId, atS: length });
    if (constraint.decision !== 'Allowed') return { changed: false, reason: constraint.message, strandId };
    this.saveUndo();
    this.state = replaceStrand(this.state, { ...strand, length });
    return { changed: true, strandId, oldLength: strand.length, newLength: length };
  }

  public cutManyAt(targets: readonly CutTarget[]): readonly EditResult[] {
    const shortestByStrand = new Map<string, number>();
    for (const target of targets) {
      if (!Number.isFinite(target.arcLengthMeters)) continue;
      const previous = shortestByStrand.get(target.strandId);
      if (previous === undefined || target.arcLengthMeters < previous) {
        shortestByStrand.set(target.strandId, target.arcLengthMeters);
      }
    }

    const results: EditResult[] = [];
    let nextState = this.state;
    for (const strand of this.state.strands) {
      const requested = shortestByStrand.get(strand.id);
      if (requested === undefined) continue;
      const length = Math.max(minimumStubble, Math.min(requested, strand.length));
      if (length >= strand.length) continue;
      const constraint = assessActionIntent(this.state, { type: 'cut', strandId: strand.id, atS: length });
      if (constraint.decision !== 'Allowed') continue;
      nextState = replaceStrand(nextState, { ...strand, length });
      results.push({ changed: true, strandId: strand.id, oldLength: strand.length, newLength: length });
    }
    if (results.length === 0) return [];
    this.saveUndo();
    this.state = nextState;
    return results;
  }

  public clipManyAt(strandIds: readonly string[], guardLengthMeters: number): readonly EditResult[] {
    if (!Number.isFinite(guardLengthMeters) || guardLengthMeters <= 0) return [];
    return this.cutManyAt(strandIds.map((strandId) => ({ strandId, arcLengthMeters: guardLengthMeters })));
  }

  public combBy(strandId: string, lateralDelta: Vec3): EditResult {
    const strand = this.state.strands.find((candidate) => candidate.id === strandId);
    if (!strand || !lateralDelta.every(Number.isFinite)) return { changed: false, reason: 'Invalid comb target', strandId };
    const constraint = assessActionIntent(this.state, { type: 'comb', strandId, startS: 0, endS: strand.length });
    if (constraint.decision !== 'Allowed') return { changed: false, reason: constraint.message, strandId };
    const direction: Vec3 = [
      Math.max(-0.75, Math.min(0.75, strand.direction[0] + lateralDelta[0])),
      strand.direction[1],
      Math.max(-0.75, Math.min(0.75, strand.direction[2] + lateralDelta[2])),
    ];
    if (direction[0] === strand.direction[0] && direction[2] === strand.direction[2]) {
      return { changed: false, reason: 'No comb displacement', strandId };
    }
    this.saveUndo();
    this.state = replaceStrand(this.state, { ...strand, direction });
    return { changed: true, strandId, oldLength: strand.length, newLength: strand.length };
  }

  public setParting(partingX: number, strength = 0.22): EditResult {
    if (!Number.isFinite(partingX) || !Number.isFinite(strength) || strength < 0) {
      return { changed: false, reason: 'Invalid parting', strandId: 'parting' };
    }
    const strands = this.state.strands.map((strand) => {
      const side = strand.root[0] < partingX ? -1 : 1;
      const proximity = Math.max(0.25, 1 - Math.min(1, Math.abs(strand.root[0] - partingX) / 0.2));
      return { ...strand, partingOffset: [side * strength * proximity, 0, 0] as Vec3 };
    });
    if (canonicalState({ ...this.state, strands }) === canonicalState(this.state)) {
      return { changed: false, reason: 'No parting displacement', strandId: 'parting' };
    }
    this.saveUndo();
    this.state = { ...this.state, strands };
    return { changed: true, strandId: 'parting' };
  }

  public sweepToSide(side: 'left' | 'right'): readonly EditResult[] {
    if (side !== 'left' && side !== 'right') return [];
    const offset: Vec3 = [side === 'left' ? -0.38 : 0.38, 0, 0];
    const affected = this.state.strands.filter((strand) => {
      if (strand.sideSweepOffset?.[0] === offset[0]) return false;
      return assessActionIntent(this.state, { type: 'comb', strandId: strand.id, startS: 0, endS: strand.length }).decision === 'Allowed';
    });
    if (affected.length === 0) return [];
    const affectedIds = new Set(affected.map((strand) => strand.id));
    this.saveUndo();
    this.state = {
      ...this.state,
      strands: this.state.strands.map((strand) => affectedIds.has(strand.id) ? { ...strand, sideSweepOffset: offset } : strand),
    };
    return affected.map((strand) => ({ changed: true, strandId: strand.id, oldLength: strand.length, newLength: strand.length }));
  }

  public tuckBehindEar(strandId: string, side: 'left' | 'right'): EditResult {
    const strand = this.state.strands.find((candidate) => candidate.id === strandId);
    if (!strand || (side !== 'left' && side !== 'right')) return { changed: false, reason: 'Invalid ear tuck', strandId };
    if (strand.earTuck === side) return { changed: false, reason: 'Already tucked', strandId };
    this.saveUndo();
    this.state = replaceStrand(this.state, { ...strand, earTuck: side });
    return { changed: true, strandId, oldLength: strand.length, newLength: strand.length };
  }

  public tieStrands(strandIds: readonly string[], tie: HairTie): readonly EditResult[] {
    return this.tieGroups([{ strandIds, tie }]);
  }

  public tieGroups(groups: readonly TieGroup[]): readonly EditResult[] {
    const assignment = new Map<string, HairTie>();
    for (const group of groups) {
      const { tie } = group;
      if (!tie.id || !tie.anchor.every(Number.isFinite) || !Number.isFinite(tie.gatherS) || tie.gatherS <= 0) return [];
      for (const strandId of group.strandIds) {
        if (assignment.has(strandId)) return [];
        assignment.set(strandId, tie);
      }
    }
    if (groups.some((group) => assessActionIntent(this.state, { type: 'tie', strandIds: group.strandIds, tie: group.tie }).decision !== 'Allowed')) return [];
    const eligible = this.state.strands.filter((strand) => {
      const tie = assignment.get(strand.id);
      return tie && strand.length > tie.gatherS && strand.tie?.id !== tie.id;
    });
    if (eligible.length === 0) return [];
    this.saveUndo();
    this.state = {
      ...this.state,
      strands: this.state.strands.map((strand) => {
        const tie = assignment.get(strand.id);
        return tie && strand.length > tie.gatherS ? { ...strand, tie } : strand;
      }),
    };
    return eligible.map((strand) => ({ changed: true, strandId: strand.id, oldLength: strand.length, newLength: strand.length }));
  }

  public braidStrands(strandIds: readonly [string, string, string], braid: Omit<BraidConstraint, 'index'>): readonly EditResult[] {
    if (!braid.id || !braid.axisOrigin.every(Number.isFinite) || !Number.isFinite(braid.startS) || !Number.isFinite(braid.endS) ||
      braid.endS <= braid.startS || !Number.isFinite(braid.radius) || braid.radius <= 0 || !Number.isFinite(braid.pitch) || braid.pitch <= 0) return [];
    if (assessActionIntent(this.state, { type: 'braid', strandIds, braid }).decision !== 'Allowed') return [];
    const eligible = strandIds.map((id) => this.state.strands.find((strand) => strand.id === id)).filter((strand): strand is GuideStrand =>
      Boolean(strand) && strand!.length > braid.endS && strand!.braid?.id !== braid.id);
    if (eligible.length !== 3) return [];
    this.saveUndo();
    const indexById = new Map(strandIds.map((id, index) => [id, index as 0 | 1 | 2]));
    this.state = {
      ...this.state,
      strands: this.state.strands.map((strand) => {
        const index = indexById.get(strand.id);
        return index === undefined ? strand : { ...strand, braid: { ...braid, index } };
      }),
    };
    return eligible.map((strand) => ({ changed: true, strandId: strand.id, oldLength: strand.length, newLength: strand.length }));
  }

  public curlRange(strandId: string, curl: CurlSegment): EditResult {
    const strand = this.state.strands.find((candidate) => candidate.id === strandId);
    if (!strand || curl.radius <= 0 || curl.pitch <= 0 || curl.startS < 0 || curl.endS <= curl.startS ||
      (curl.direction !== -1 && curl.direction !== 1)) {
      return { changed: false, reason: 'Invalid curl', strandId };
    }
    const visibleEndS = Math.min(curl.endS, strand.length);
    if (curl.startS >= visibleEndS) return { changed: false, reason: 'Curl range is outside current strand', strandId };
    const limited = { ...curl, endS: visibleEndS >= strand.length - 1e-9 ? strand.maximumLength : visibleEndS };
    const constraint = assessActionIntent(this.state, { type: 'curl', strandId, startS: limited.startS, endS: visibleEndS });
    if (constraint.decision !== 'Allowed') return { changed: false, reason: constraint.message, strandId };
    this.saveUndo();
    this.state = replaceStrand(this.state, { ...strand, curls: [limited] });
    return { changed: true, strandId, oldLength: strand.length, newLength: strand.length };
  }

  public growBy(strandId: string, deltaArcLengthMeters: number): EditResult {
    const strand = this.state.strands.find((candidate) => candidate.id === strandId);
    if (!strand || !Number.isFinite(deltaArcLengthMeters) || deltaArcLengthMeters <= 0) {
      return { changed: false, reason: 'Invalid growth', strandId };
    }
    const length = Math.min(strand.maximumLength, strand.length + deltaArcLengthMeters);
    if (length === strand.length) return { changed: false, reason: 'At maximum recorded length', strandId };
    const constraint = assessActionIntent(this.state, { type: 'grow', strandId, deltaS: deltaArcLengthMeters });
    if (constraint.decision === 'Rejected' || constraint.decision === 'RequiresConfirmation') {
      return { changed: false, reason: constraint.message, strandId };
    }
    this.saveUndo();
    this.state = replaceStrand(this.state, { ...strand, length });
    return { changed: true, strandId, oldLength: strand.length, newLength: length };
  }

  public undo(): void {
    const prior = this.undoStack.pop();
    if (!prior) return;
    this.redoStack.push(copyState(this.state));
    this.state = prior;
  }

  public redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(copyState(this.state));
    this.state = next;
  }

  private saveUndo(): void {
    this.undoStack.push(copyState(this.state));
    if (this.undoStack.length > 20) this.undoStack.shift();
    this.redoStack = [];
  }
}

export function createDemoHairState(): HairState {
  const roots: Record<string, Vec3> = {
    A: [-0.12, 0.22, 0], B: [-0.04, 0.25, 0.04], C: [0.05, 0.25, 0.05], D: [0.13, 0.2, 0],
  };
  return {
    schemaVersion: 2,
    strands: Object.entries(roots).map(([id, root]) => ({
      id, root, direction: [0, -1, 0], length: id === 'C' ? 0.4 : 0.3,
      maximumLength: id === 'C' ? 0.6 : 0.45, curls: [],
    })),
  };
}
