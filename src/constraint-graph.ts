import type { BraidConstraint, HairState, HairTie } from './hair-core';

export type ConstraintType = 'ear-tuck' | 'tie-gather' | 'braid';
export type ConstraintDecision = 'Allowed' | 'Partial' | 'RequiresConfirmation' | 'Rejected';

export interface ConstraintInterval {
  readonly id: string;
  readonly ownerId: string;
  readonly strandId: string;
  readonly type: ConstraintType;
  readonly startS: number;
  readonly endS: number;
  readonly priority: 1 | 2 | 3;
}

export interface ConstraintGraph {
  readonly intervals: readonly ConstraintInterval[];
}

export interface ConstraintAssessment {
  readonly decision: ConstraintDecision;
  readonly message: string;
  readonly affectedStrandIds: readonly string[];
}

export type ActionIntent =
  | { readonly type: 'cut'; readonly strandId: string; readonly atS: number }
  | { readonly type: 'grow'; readonly strandId: string; readonly deltaS: number }
  | { readonly type: 'curl' | 'comb'; readonly strandId: string; readonly startS: number; readonly endS: number }
  | { readonly type: 'tie'; readonly strandIds: readonly string[]; readonly tie: HairTie }
  | { readonly type: 'braid'; readonly strandIds: readonly [string, string, string]; readonly braid: Omit<BraidConstraint, 'index'> }
  | { readonly type: 'release-tie'; readonly tieId: string }
  | { readonly type: 'unbraid'; readonly braidId: string };

const earTuckStartS = 0.035;
const earTuckEndS = 0.14;

function sortedIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function assessment(
  decision: ConstraintDecision,
  message: string,
  affectedStrandIds: readonly string[],
): ConstraintAssessment {
  return { decision, message, affectedStrandIds: sortedIds(affectedStrandIds) };
}

function sameTie(left: HairTie, right: HairTie): boolean {
  return left.id === right.id && left.gatherS === right.gatherS &&
    left.anchor[0] === right.anchor[0] && left.anchor[1] === right.anchor[1] && left.anchor[2] === right.anchor[2];
}

function hasFiniteRange(startS: number, endS: number): boolean {
  return Number.isFinite(startS) && Number.isFinite(endS) && startS >= 0 && endS > startS;
}

function overlaps(startS: number, endS: number, interval: ConstraintInterval): boolean {
  return startS < interval.endS && endS > interval.startS;
}

function intervalsFor(graph: ConstraintGraph, strandId: string, type?: ConstraintType): readonly ConstraintInterval[] {
  return graph.intervals.filter((interval) => interval.strandId === strandId && (type === undefined || interval.type === type));
}

/**
 * Derives the currently-supported interval constraints from saved GuideStrands.
 * These intervals are read-only decision data; render geometry stays derived.
 */
export function buildConstraintGraph(state: HairState): ConstraintGraph {
  const intervals: ConstraintInterval[] = [];
  for (const strand of state.strands) {
    if (strand.earTuck && strand.length > earTuckStartS) {
      intervals.push({
        id: `ear-tuck:${strand.id}`,
        ownerId: `ear-tuck:${strand.id}`,
        strandId: strand.id,
        type: 'ear-tuck',
        startS: earTuckStartS,
        endS: Math.min(earTuckEndS, strand.length),
        priority: 1,
      });
    }
    if (strand.tie) {
      intervals.push({
        id: `tie:${strand.tie.id}:${strand.id}`,
        ownerId: strand.tie.id,
        strandId: strand.id,
        type: 'tie-gather',
        startS: 0,
        endS: Math.min(strand.tie.gatherS, strand.length),
        priority: 2,
      });
    }
    if (strand.braid) {
      intervals.push({
        id: `braid:${strand.braid.id}:${strand.id}`,
        ownerId: strand.braid.id,
        strandId: strand.id,
        type: 'braid',
        startS: strand.braid.startS,
        endS: Math.min(strand.braid.endS, strand.length),
        priority: 3,
      });
    }
  }
  return {
    intervals: intervals.sort((left, right) => left.strandId.localeCompare(right.strandId) || left.startS - right.startS || left.id.localeCompare(right.id)),
  };
}

function validateTarget(state: HairState, strandId: string): ConstraintAssessment | undefined {
  return state.strands.some((strand) => strand.id === strandId)
    ? undefined
    : assessment('Rejected', '未找到指定髮束。', [strandId]);
}

function assessRangeEdit(
  graph: ConstraintGraph,
  strandId: string,
  startS: number,
  endS: number,
  label: string,
): ConstraintAssessment {
  const braid = intervalsFor(graph, strandId, 'braid').find((interval) => overlaps(startS, endS, interval));
  if (braid) return assessment('RequiresConfirmation', `呢段已經編成辮子；請先拆開辮子，或者只${label}未編織的髮尾。`, [strandId]);
  const tie = intervalsFor(graph, strandId, 'tie-gather').find((interval) => overlaps(startS, endS, interval));
  if (tie) return assessment('RequiresConfirmation', `呢段正在匯入髮圈「${tie.ownerId}」；請先移動或解除髮圈。`, [strandId]);
  const earTuck = intervalsFor(graph, strandId, 'ear-tuck').find((interval) => overlaps(startS, endS, interval));
  if (earTuck) return assessment('Partial', '操作會觸及耳後路徑；提交前需要重算耳後約束。', [strandId]);
  return assessment('Allowed', '可直接操作自由髮段。', [strandId]);
}

function assessCut(state: HairState, graph: ConstraintGraph, strandId: string, atS: number): ConstraintAssessment {
  const invalid = validateTarget(state, strandId);
  if (invalid) return invalid;
  const strand = state.strands.find((candidate) => candidate.id === strandId)!;
  if (!Number.isFinite(atS) || atS < 0 || atS > strand.length) return assessment('Rejected', '剪刀位置不在髮束有效長度內。', [strandId]);
  const braid = intervalsFor(graph, strandId, 'braid').find((interval) => atS < interval.endS);
  if (braid) return assessment('RequiresConfirmation', '剪口會破壞已編織部分；請選擇保留上段並重建尾端，或先拆開辮子。', [strandId]);
  const tie = intervalsFor(graph, strandId, 'tie-gather').find((interval) => atS < interval.endS);
  if (tie) return assessment('RequiresConfirmation', `剪口位於髮圈「${tie.ownerId}」以上；應先預覽此束脫離綁群。`, [strandId]);
  const earTuck = intervalsFor(graph, strandId, 'ear-tuck').find((interval) => atS >= interval.startS && atS < interval.endS);
  if (earTuck) return assessment('Partial', '剪口位於耳後路徑；提交前需要重算耳後約束。', [strandId]);
  return assessment('Allowed', '剪口位於自由尾段。', [strandId]);
}

function assessGrowth(state: HairState, graph: ConstraintGraph, strandId: string, deltaS: number): ConstraintAssessment {
  const invalid = validateTarget(state, strandId);
  if (invalid) return invalid;
  if (!Number.isFinite(deltaS) || deltaS <= 0) return assessment('Rejected', '增長長度必須為正數。', [strandId]);
  const intervals = intervalsFor(graph, strandId).filter((interval) => interval.type === 'tie-gather' || interval.type === 'braid');
  return intervals.length > 0
    ? assessment('Partial', '會先延長未受約束的髮尾；不會自動在髮圈或辮子中間補長。', [strandId])
    : assessment('Allowed', '可直接延長自由髮束。', [strandId]);
}

function assessTie(state: HairState, graph: ConstraintGraph, strandIds: readonly string[], tie: HairTie): ConstraintAssessment {
  const ids = sortedIds(strandIds);
  if (ids.length === 0 || !tie.id || !Number.isFinite(tie.gatherS) || tie.gatherS <= 0 || !tie.anchor.every(Number.isFinite)) {
    return assessment('Rejected', '髮圈資料不完整。', ids);
  }
  const strands = ids.map((id) => state.strands.find((strand) => strand.id === id));
  if (strands.some((strand) => !strand)) return assessment('Rejected', '選取包含不存在的髮束。', ids);
  if (strands.some((strand) => strand!.length <= tie.gatherS)) return assessment('Rejected', '有髮束長度不足，不能到達髮圈。', ids);
  if (strands.some((strand) => strand!.tie && !sameTie(strand!.tie!, tie))) {
    return assessment('Rejected', '同一髮段不能同時服從兩個互相競爭的髮圈；請先移動或解除原髮圈。', ids);
  }
  if (strands.some((strand) => intervalsFor(graph, strand!.id, 'braid').length > 0)) {
    return assessment('Rejected', '已編織髮束不能直接加競爭髮圈；請先拆開辮子。', ids);
  }
  if (strands.some((strand) => intervalsFor(graph, strand!.id, 'ear-tuck').length > 0)) {
    return assessment('Partial', '選區含耳後髮束；提交前需要預覽耳後路徑是否可保留。', ids);
  }
  return assessment('Allowed', '可建立髮圈約束。', ids);
}

function assessBraid(state: HairState, graph: ConstraintGraph, strandIds: readonly [string, string, string], braid: Omit<BraidConstraint, 'index'>): ConstraintAssessment {
  const ids = sortedIds(strandIds);
  if (ids.length !== 3 || !braid.id || !hasFiniteRange(braid.startS, braid.endS) || !Number.isFinite(braid.radius) || braid.radius <= 0 || !Number.isFinite(braid.pitch) || braid.pitch <= 0 || !braid.axisOrigin.every(Number.isFinite)) {
    return assessment('Rejected', '三股辮需要三束不同、長度足夠的髮束及有效參數。', ids);
  }
  const strands = ids.map((id) => state.strands.find((strand) => strand.id === id));
  if (strands.some((strand) => !strand)) return assessment('Rejected', '選取包含不存在的髮束。', ids);
  if (strands.some((strand) => strand!.length <= braid.endS)) return assessment('Rejected', '有髮束長度不足，不能完成指定辮段。', ids);
  if (strands.some((strand) => intervalsFor(graph, strand!.id, 'braid').length > 0)) {
    return assessment('Rejected', '選區已有三股辮；請先拆開原來的辮子。', ids);
  }
  const ties = strands.map((strand) => strand!.tie).filter((tie): tie is HairTie => Boolean(tie));
  if (ties.length > 0) {
    if (ties.length !== 3 || !ties.every((tie) => sameTie(tie, ties[0])) || braid.startS < ties[0].gatherS) {
      return assessment('Rejected', '馬尾後編辮必須由同一髮圈下方的三束自由尾段開始。', ids);
    }
  }
  if (strands.some((strand) => intervalsFor(graph, strand!.id, 'ear-tuck').length > 0)) {
    return assessment('Partial', '選區含耳後髮束；提交前需要預覽其路徑。', ids);
  }
  return assessment('Allowed', '可建立三股辮約束。', ids);
}

/**
 * Implements the non-destructive decision phase from B6.2. It does not mutate
 * state and therefore can be used identically by previews, commands and tests.
 */
export function assessActionIntent(state: HairState, intent: ActionIntent): ConstraintAssessment {
  const graph = buildConstraintGraph(state);
  switch (intent.type) {
    case 'cut': return assessCut(state, graph, intent.strandId, intent.atS);
    case 'grow': return assessGrowth(state, graph, intent.strandId, intent.deltaS);
    case 'curl':
    case 'comb': {
      const invalid = validateTarget(state, intent.strandId);
      if (invalid) return invalid;
      const strand = state.strands.find((candidate) => candidate.id === intent.strandId)!;
      if (!hasFiniteRange(intent.startS, intent.endS) || intent.endS > strand.length) {
        return assessment('Rejected', '操作區間不在髮束有效長度內。', [intent.strandId]);
      }
      return assessRangeEdit(graph, intent.strandId, intent.startS, intent.endS, intent.type === 'curl' ? '捲' : '梳');
    }
    case 'tie': return assessTie(state, graph, intent.strandIds, intent.tie);
    case 'braid': return assessBraid(state, graph, intent.strandIds, intent.braid);
    case 'release-tie': {
      const tied = state.strands.filter((strand) => strand.tie?.id === intent.tieId);
      if (tied.length === 0) return assessment('Rejected', '未找到指定髮圈。', []);
      if (tied.some((strand) => strand.braid)) {
        return assessment('RequiresConfirmation', '移除髮圈後需要重新計算相關辮子路徑；請先預覽結果。', tied.map((strand) => strand.id));
      }
      return assessment('Allowed', '可解除髮圈，原有剪長及捲曲會保留。', tied.map((strand) => strand.id));
    }
    case 'unbraid': {
      const braided = state.strands.filter((strand) => strand.braid?.id === intent.braidId);
      return braided.length > 0
        ? assessment('Allowed', '可解除辮子，原有剪長、捲曲及髮圈會保留。', braided.map((strand) => strand.id))
        : assessment('Rejected', '未找到指定辮子。', []);
    }
  }
}
