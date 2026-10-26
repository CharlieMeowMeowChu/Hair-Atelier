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
  readonly schemaVersion: 1;
  readonly strands: readonly GuideStrand[];
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

export function parseHairState(serialized: string): HairState | undefined {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object') return undefined;
    const state = value as Partial<HairState>;
    if (state.schemaVersion !== 1 || !Array.isArray(state.strands) || state.strands.length === 0) return undefined;
    const valid = state.strands.every((strand) => {
      if (!strand || typeof strand !== 'object') return false;
      const candidate = strand as Partial<GuideStrand>;
      const vectorIsValid = (vector: unknown): vector is Vec3 => Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite);
      return typeof candidate.id === 'string' && candidate.id.length > 0 && vectorIsValid(candidate.root) && vectorIsValid(candidate.direction) &&
        (candidate.partingOffset === undefined || vectorIsValid(candidate.partingOffset)) &&
        (candidate.sideSweepOffset === undefined || vectorIsValid(candidate.sideSweepOffset)) &&
        (candidate.earTuck === undefined || candidate.earTuck === 'left' || candidate.earTuck === 'right') &&
        (candidate.tie === undefined || typeof candidate.tie.id === 'string' && vectorIsValid(candidate.tie.anchor) && Number.isFinite(candidate.tie.gatherS) && candidate.tie.gatherS > 0) &&
        (candidate.braid === undefined || typeof candidate.braid.id === 'string' && [0, 1, 2].includes(candidate.braid.index) && vectorIsValid(candidate.braid.axisOrigin) &&
          Number.isFinite(candidate.braid.startS) && Number.isFinite(candidate.braid.endS) && candidate.braid.endS > candidate.braid.startS &&
          Number.isFinite(candidate.braid.radius) && candidate.braid.radius > 0 && Number.isFinite(candidate.braid.pitch) && candidate.braid.pitch > 0) &&
        Number.isFinite(candidate.length) && Number.isFinite(candidate.maximumLength) && candidate.length! >= 0 && candidate.maximumLength! >= candidate.length! &&
        Array.isArray(candidate.curls) && candidate.curls.every((curl) => curl && Number.isFinite(curl.startS) && Number.isFinite(curl.endS) &&
          Number.isFinite(curl.radius) && Number.isFinite(curl.pitch) && Number.isFinite(curl.phase) && curl.startS >= 0 && curl.endS > curl.startS &&
          curl.radius > 0 && curl.pitch > 0 && (curl.direction === -1 || curl.direction === 1));
    });
    return valid ? copyState(state as HairState) : undefined;
  } catch {
    return undefined;
  }
}

function pointWithoutTie(strand: GuideStrand, s: number): Vec3 {
  const clampedS = Math.max(0, Math.min(s, strand.length));
  const partingOffset = strand.partingOffset ?? [0, 0, 0] as Vec3;
  const sideSweepOffset = strand.sideSweepOffset ?? [0, 0, 0] as Vec3;
  const base: [number, number, number] = [
    strand.root[0] + (strand.direction[0] + partingOffset[0] + sideSweepOffset[0]) * clampedS,
    strand.root[1] + (strand.direction[1] + partingOffset[1] + sideSweepOffset[1]) * clampedS,
    strand.root[2] + (strand.direction[2] + partingOffset[2] + sideSweepOffset[2]) * clampedS,
  ];
  for (const curl of strand.curls) {
    const curlS = Math.max(curl.startS, Math.min(clampedS, curl.endS));
    if (curlS <= curl.startS) continue;
    const phase = curl.phase + curl.direction * ((curlS - curl.startS) / curl.pitch) * Math.PI * 2;
    base[0] += curl.radius * (Math.cos(phase) - Math.cos(curl.phase));
    base[2] += curl.radius * (Math.sin(phase) - Math.sin(curl.phase));
  }
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

export function sampleStrand(strand: GuideStrand, segments = 40): Vec3[] {
  return Array.from({ length: segments + 1 }, (_, index) => pointAt(strand, (strand.length * index) / segments));
}

export class HairEditor {
  private state: HairState;
  private undoStack: HairState[] = [];
  private redoStack: HairState[] = [];

  public constructor(initial: HairState) {
    this.state = copyState(initial);
  }

  public exportState(): HairState { return copyState(this.state); }
  public get canUndo(): boolean { return this.undoStack.length > 0; }
  public get canRedo(): boolean { return this.redoStack.length > 0; }

  public cutAt(strandId: string, arcLengthMeters: number): EditResult {
    const strand = this.state.strands.find((candidate) => candidate.id === strandId);
    if (!strand || !Number.isFinite(arcLengthMeters)) return { changed: false, reason: 'Invalid target', strandId };
    const length = Math.max(minimumStubble, Math.min(arcLengthMeters, strand.length));
    if (length >= strand.length) return { changed: false, reason: 'No downstream geometry selected', strandId };
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
    const affected = this.state.strands.filter((strand) => strand.sideSweepOffset?.[0] !== offset[0]);
    if (affected.length === 0) return [];
    this.saveUndo();
    this.state = { ...this.state, strands: this.state.strands.map((strand) => ({ ...strand, sideSweepOffset: offset })) };
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
      group.strandIds.forEach((strandId) => assignment.set(strandId, tie));
    }
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
    const limited = { ...curl, endS: Math.min(curl.endS, strand.length) };
    if (limited.startS >= limited.endS) return { changed: false, reason: 'Curl range is outside current strand', strandId };
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
    this.saveUndo();
    const lastCurl = strand.curls.at(-1);
    const curls = lastCurl && length > lastCurl.endS && lastCurl.endS >= strand.length
      ? [...strand.curls.slice(0, -1), { ...lastCurl, endS: length }]
      : strand.curls;
    this.state = replaceStrand(this.state, { ...strand, length, curls });
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
    schemaVersion: 1,
    strands: Object.entries(roots).map(([id, root]) => ({
      id, root, direction: [0, -1, 0], length: id === 'C' ? 0.4 : 0.3,
      maximumLength: id === 'C' ? 0.6 : 0.45, curls: [],
    })),
  };
}
