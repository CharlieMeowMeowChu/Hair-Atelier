export interface PanPosition { readonly x: number; readonly y: number }

/** Move the scene with the fingers while keeping the camera parallel. */
export function panCamera(position: PanPosition, delta: PanPosition, distance: number, fovRadians: number, viewportHeight: number): PanPosition {
  if (![position.x, position.y, delta.x, delta.y, distance, fovRadians, viewportHeight].every(Number.isFinite) || distance <= 0 || viewportHeight <= 0 || fovRadians <= 0 || fovRadians >= Math.PI) return position;
  const worldPerPixel = 2 * distance * Math.tan(fovRadians / 2) / viewportHeight;
  return {
    x: Math.max(-2.2, Math.min(2.2, position.x - delta.x * worldPerPixel)),
    y: Math.max(-2.2, Math.min(0.8, position.y + delta.y * worldPerPixel)),
  };
}
