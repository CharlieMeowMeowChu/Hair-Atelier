import type { CurlSegment, GuideStrand, Vec3 } from './hair-core';

export interface ArcLengthSample {
  readonly s: number;
  readonly point: Vec3;
  readonly tangent: Vec3;
}

interface LineSegment {
  readonly kind: 'line';
  readonly startS: number;
  readonly endS: number;
  readonly start: Vec3;
  readonly tangent: Vec3;
}

interface HelixSegment {
  readonly kind: 'helix';
  readonly startS: number;
  readonly endS: number;
  readonly start: Vec3;
  readonly axis: Vec3;
  readonly normal: Vec3;
  readonly binormal: Vec3;
  readonly radius: number;
  readonly turnLength: number;
  readonly phase: number;
  readonly direction: -1 | 1;
}

type RestSegment = LineSegment | HelixSegment;

const epsilon = 1e-10;

function add(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scale(value: Vec3, scalar: number): Vec3 {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function length(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function normalize(value: Vec3, fallback: Vec3): Vec3 {
  const valueLength = length(value);
  return valueLength > epsilon ? scale(value, 1 / valueLength) : fallback;
}

function addMany(...values: readonly Vec3[]): Vec3 {
  return values.reduce<Vec3>((sum, value) => add(sum, value), [0, 0, 0]);
}

function effectiveBaseTangent(strand: GuideStrand): Vec3 {
  const partingOffset = strand.partingOffset ?? [0, 0, 0] as Vec3;
  const sideSweepOffset = strand.sideSweepOffset ?? [0, 0, 0] as Vec3;
  return normalize(addMany(strand.direction, partingOffset, sideSweepOffset), [0, -1, 0]);
}

function orthogonal(tangent: Vec3): Vec3 {
  const reference: Vec3 = Math.abs(tangent[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return normalize(cross(tangent, reference), [0, 0, 1]);
}

function pointOnLine(segment: LineSegment, s: number): Vec3 {
  return add(segment.start, scale(segment.tangent, s - segment.startS));
}

function helixPoint(segment: HelixSegment, s: number): Vec3 {
  const delta = s - segment.startS;
  const theta = segment.phase + segment.direction * (Math.PI * 2 * delta / segment.turnLength);
  return addMany(
    segment.start,
    scale(segment.axis, delta * Math.sqrt(Math.max(0, 1 - (Math.PI * 2 * segment.radius / segment.turnLength) ** 2))),
    scale(segment.normal, segment.radius * (Math.cos(theta) - Math.cos(segment.phase))),
    scale(segment.binormal, segment.radius * (Math.sin(theta) - Math.sin(segment.phase))),
  );
}

function helixTangent(segment: HelixSegment, s: number): Vec3 {
  const delta = s - segment.startS;
  const theta = segment.phase + segment.direction * (Math.PI * 2 * delta / segment.turnLength);
  const radialSpeed = Math.PI * 2 * segment.radius / segment.turnLength;
  const axisSpeed = Math.sqrt(Math.max(0, 1 - radialSpeed * radialSpeed));
  return normalize(addMany(
    scale(segment.axis, axisSpeed),
    scale(segment.normal, -Math.sin(theta) * radialSpeed * segment.direction),
    scale(segment.binormal, Math.cos(theta) * radialSpeed * segment.direction),
  ), segment.axis);
}

function makeHelix(start: Vec3, startS: number, curl: CurlSegment, incomingTangent: Vec3): HelixSegment {
  const circumference = Math.PI * 2 * curl.radius;
  const turnLength = Math.hypot(circumference, curl.pitch);
  const axisSpeed = curl.pitch / turnLength;
  const radialSpeed = circumference / turnLength;
  const q = orthogonal(incomingTangent);
  const axis = normalize(add(scale(incomingTangent, axisSpeed), scale(q, radialSpeed)), incomingTangent);
  const radialAtStart = normalize(add(scale(incomingTangent, radialSpeed), scale(q, -axisSpeed)), q);
  const radialDerivativeBasis = scale(radialAtStart, curl.direction);
  const radialOffsetBasis = normalize(cross(radialDerivativeBasis, axis), orthogonal(axis));
  const normal = add(scale(radialOffsetBasis, Math.cos(curl.phase)), scale(radialDerivativeBasis, -Math.sin(curl.phase)));
  const binormal = add(scale(radialOffsetBasis, Math.sin(curl.phase)), scale(radialDerivativeBasis, Math.cos(curl.phase)));
  return {
    kind: 'helix', startS, endS: curl.endS, start, axis, normal, binormal,
    radius: curl.radius, turnLength, phase: curl.phase, direction: curl.direction,
  };
}

function validCurls(strand: GuideStrand): readonly CurlSegment[] {
  const valid: CurlSegment[] = [];
  let previousEnd = 0;
  for (const curl of strand.curls) {
    if (curl.startS < previousEnd || curl.startS < 0 || curl.endS <= curl.startS || curl.endS > strand.maximumLength) continue;
    valid.push(curl);
    previousEnd = curl.endS;
  }
  return valid;
}

function buildSegments(strand: GuideStrand): readonly RestSegment[] {
  const baseTangent = effectiveBaseTangent(strand);
  const segments: RestSegment[] = [];
  const curls = validCurls(strand);
  let point = strand.root;
  let tangent = baseTangent;
  let currentS = 0;
  for (const curl of curls) {
    if (curl.startS > currentS) {
      const line: LineSegment = { kind: 'line', startS: currentS, endS: curl.startS, start: point, tangent };
      segments.push(line);
      point = pointOnLine(line, curl.startS);
    }
    const helix = makeHelix(point, curl.startS, curl, tangent);
    segments.push(helix);
    point = helixPoint(helix, curl.endS);
    tangent = helixTangent(helix, curl.endS);
    currentS = curl.endS;
  }
  if (currentS < strand.maximumLength) {
    segments.push({ kind: 'line', startS: currentS, endS: strand.maximumLength, start: point, tangent });
  }
  return segments;
}

function clampS(s: number, maximumLength: number): number {
  return Math.max(0, Math.min(Number.isFinite(s) ? s : 0, maximumLength));
}

function segmentAt(segments: readonly RestSegment[], s: number): RestSegment {
  return segments.find((segment) => s <= segment.endS + epsilon) ?? segments.at(-1)!;
}

/**
 * A rest-centerline evaluator where input s is physical material arc length in
 * metres. The line and helix segments are unit-speed, so the renderer never
 * needs to treat a parameter distance as an arc length.
 */
export class ArcLengthSampler {
  private readonly segments: readonly RestSegment[];

  public constructor(private readonly strand: GuideStrand) {
    this.segments = buildSegments(strand);
  }

  public get maximumLength(): number { return this.strand.maximumLength; }

  public positionAtS(s: number): Vec3 {
    const clamped = clampS(s, this.maximumLength);
    const segment = segmentAt(this.segments, clamped);
    return segment.kind === 'line' ? pointOnLine(segment, clamped) : helixPoint(segment, clamped);
  }

  public tangentAtS(s: number): Vec3 {
    const clamped = clampS(s, this.maximumLength);
    const segment = segmentAt(this.segments, clamped);
    return segment.kind === 'line' ? segment.tangent : helixTangent(segment, clamped);
  }

  public sample(startS = 0, endS = this.maximumLength, maximumStepMeters = 0.001): readonly ArcLengthSample[] {
    const start = clampS(startS, this.maximumLength);
    const end = clampS(endS, this.maximumLength);
    if (end <= start) return [{ s: start, point: this.positionAtS(start), tangent: this.tangentAtS(start) }];
    const step = Math.max(0.0001, maximumStepMeters);
    const count = Math.ceil((end - start) / step);
    return Array.from({ length: count + 1 }, (_, index) => {
      const s = index === count ? end : start + index * step;
      return { s, point: this.positionAtS(s), tangent: this.tangentAtS(s) };
    });
  }
}

const samplerCache = new WeakMap<GuideStrand, ArcLengthSampler>();

export function arcLengthSamplerFor(strand: GuideStrand): ArcLengthSampler {
  const cached = samplerCache.get(strand);
  if (cached) return cached;
  const sampler = new ArcLengthSampler(strand);
  samplerCache.set(strand, sampler);
  return sampler;
}

export function restPointAt(strand: GuideStrand, s: number): Vec3 {
  return arcLengthSamplerFor(strand).positionAtS(s);
}

export function restTangentAt(strand: GuideStrand, s: number): Vec3 {
  return arcLengthSamplerFor(strand).tangentAtS(s);
}

export function measuredRestArcLength(strand: GuideStrand, maximumStepMeters = 0.0005): number {
  const samples = arcLengthSamplerFor(strand).sample(0, strand.length, maximumStepMeters);
  return samples.slice(1).reduce((total, sample, index) => total + length(subtract(sample.point, samples[index].point)), 0);
}
