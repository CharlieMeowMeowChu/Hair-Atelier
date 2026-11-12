/** Conservative CSS-pixel sampling step from a world-space line hit radius. */
export function sweepStepPixels(hitRadius: number, viewportHeight: number, verticalFovRadians: number, farthestDistance: number): number {
  if (![hitRadius, viewportHeight, verticalFovRadians, farthestDistance].every(Number.isFinite) || hitRadius <= 0 || viewportHeight <= 0 || farthestDistance <= 0 || verticalFovRadians <= 0 || verticalFovRadians >= Math.PI) return 1;
  const radiusPixels = hitRadius * viewportHeight / (2 * farthestDistance * Math.tan(verticalFovRadians / 2));
  return Math.max(0.25, Math.min(8, radiusPixels));
}
