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
  readonly length: number;
  readonly maximumLength: number;
  readonly curls: readonly CurlSegment[];
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

export function pointAt(strand: GuideStrand, s: number): Vec3 {
  const clampedS = Math.max(0, Math.min(s, strand.length));
  const base: [number, number, number] = [
    strand.root[0] + strand.direction[0] * clampedS,
    strand.root[1] + strand.direction[1] * clampedS,
    strand.root[2] + strand.direction[2] * clampedS,
  ];
  for (const curl of strand.curls) {
    const curlS = Math.max(curl.startS, Math.min(clampedS, curl.endS));
    if (curlS <= curl.startS) continue;
    const phase = curl.phase + curl.direction * ((curlS - curl.startS) / curl.pitch) * Math.PI * 2;
    base[0] += curl.radius * (Math.cos(phase) - Math.cos(curl.phase));
    base[2] += curl.radius * (Math.sin(phase) - Math.sin(curl.phase));
  }
  return base;
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
