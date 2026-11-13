import type { EditResult } from './hair-core';

export function growthMessage(result: EditResult): string {
  if (result.changed && result.oldLength !== undefined && result.newLength !== undefined) {
    const centimeters = Number(((result.newLength - result.oldLength) * 100).toFixed(2));
    return `已對 ${result.strandId} 增長 ${centimeters} cm`;
  }
  if (result.reason === 'At maximum recorded length') return `${result.strandId} 已達可增長的上限`;
  return result.reason ?? '未能增長髮束';
}
