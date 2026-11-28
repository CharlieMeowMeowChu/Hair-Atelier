/** Conservative CSS-pixel sampling step from a world-space line hit radius. */
export function sweepStepPixels(hitRadius: number, viewportHeight: number, verticalFovRadians: number, farthestDistance: number): number {
  if (![hitRadius, viewportHeight, verticalFovRadians, farthestDistance].every(Number.isFinite) || hitRadius <= 0 || viewportHeight <= 0 || farthestDistance <= 0 || verticalFovRadians <= 0 || verticalFovRadians >= Math.PI) return 1;
  const radiusPixels = hitRadius * viewportHeight / (2 * farthestDistance * Math.tan(verticalFovRadians / 2));
  return Math.max(0.25, Math.min(8, radiusPixels));
}

export interface ScreenPoint { readonly x: number; readonly y: number }
export interface ScreenBounds { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

/** Clips the segment to the canvas without changing its direction. */
export function clipSweepToBounds(from: ScreenPoint, to: ScreenPoint, bounds: ScreenBounds): { from: ScreenPoint; to: ScreenPoint } | undefined {
  if (![from.x, from.y, to.x, to.y, bounds.left, bounds.right, bounds.top, bounds.bottom].every(Number.isFinite) || bounds.left >= bounds.right || bounds.top >= bounds.bottom) return undefined;
  const dx = to.x - from.x, dy = to.y - from.y;
  let start = 0, end = 1;
  for (const [p, q] of [[-dx, from.x - bounds.left], [dx, bounds.right - from.x], [-dy, from.y - bounds.top], [dy, bounds.bottom - from.y]]) {
    if (p === 0) { if (q < 0) return undefined; continue; }
    const t = q / p;
    if (p < 0) start = Math.max(start, t);
    else end = Math.min(end, t);
    if (start > end) return undefined;
  }
  return { from: { x: from.x + dx * start, y: from.y + dy * start }, to: { x: from.x + dx * end, y: from.y + dy * end } };
}
