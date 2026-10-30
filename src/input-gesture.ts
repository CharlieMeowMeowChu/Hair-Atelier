export const dragActivationDistancePx = 6;

export function hasExceededDragThreshold(
  start: Readonly<{ x: number; y: number }>,
  current: Readonly<{ x: number; y: number }>,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= dragActivationDistancePx;
}
