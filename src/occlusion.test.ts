import { describe, expect, it } from 'vitest';
import { BufferGeometry, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three';
import { nearestVisibleHairHit } from './occlusion';

describe('hair picking against the head', () => {
  it('picks only the visible guide from either side of the head', () => {
    const head = new Mesh(new SphereGeometry(1, 64, 48), new MeshBasicMaterial());
    const line = (z: number) => new Line(new BufferGeometry().setFromPoints([new Vector3(0, -0.2, z), new Vector3(0, 0.2, z)]), new LineBasicMaterial());
    const front = line(1.1), back = line(-1.1);
    const raycaster = new Raycaster();
    raycaster.params.Line = { threshold: 0.01 };
    for (const [z, expected] of [[5, front], [-5, back]] as const) {
      const camera = new PerspectiveCamera(35, 1, 0.01, 20);
      camera.position.set(0, 0, z); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
      head.updateMatrixWorld(true); front.updateMatrixWorld(true); back.updateMatrixWorld(true);
      raycaster.setFromCamera(new Vector2(0, 0), camera);
      const hits = raycaster.intersectObjects([front, back]);
      expect(nearestVisibleHairHit(hits, camera.position, head)?.object).toBe(expected);
      expect(nearestVisibleHairHit(hits.filter((hit) => hit.object !== expected), camera.position, head)).toBeUndefined();
    }
  });
  it('rejects hair behind the silhouette when the finger ray misses the head', () => {
    const head = new Mesh(new SphereGeometry(0.22, 96, 64), new MeshBasicMaterial());
    const behind = new Line(new BufferGeometry().setFromPoints([new Vector3(0.215, -0.01, -0.07), new Vector3(0.215, 0.01, -0.07)]), new LineBasicMaterial());
    head.updateMatrixWorld(true); behind.updateMatrixWorld(true);
    const raycaster = new Raycaster(new Vector3(0.225, 0, 1.35), new Vector3(0, 0, -1));
    raycaster.params.Line = { threshold: 0.014 };
    expect(raycaster.intersectObject(head)).toHaveLength(0);
    const hits = raycaster.intersectObject(behind);
    expect(hits.length).toBeGreaterThan(0);
    expect(nearestVisibleHairHit(hits, raycaster.ray.origin, head)).toBeUndefined();
  });
});
