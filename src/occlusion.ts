import { Raycaster, Vector3, type Intersection, type Object3D } from 'three';

/** Check the actual hair hit point, not the finger ray, against opaque head geometry. */
export function nearestVisibleHairHit<T extends Intersection>(hits: readonly T[], cameraPosition: Vector3, head: Object3D): T | undefined {
  const visibilityRay = new Raycaster();
  const direction = new Vector3();
  for (const hit of hits) {
    direction.subVectors(hit.point, cameraPosition);
    const distance = direction.length();
    if (distance <= 1e-10) continue;
    visibilityRay.set(cameraPosition, direction.multiplyScalar(1 / distance));
    const obstruction = visibilityRay.intersectObject(head, true)[0];
    if (!obstruction || obstruction.distance >= distance - 1e-7) return hit;
  }
  return undefined;
}
