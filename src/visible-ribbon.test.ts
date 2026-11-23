import { describe, expect, it } from 'vitest';
import { Line3, Triangle, Vector3 } from 'three';
import { createDemoHairState, HairEditor } from './hair-core';
import { fullHairSamples } from './visible-hair';
import { buildVisibleRibbon } from './visible-ribbon';
import { buildRibbonGeometryData, type RibbonGeometryData } from './ribbon-geometry';

const head = { center: [0, 0, 0] as const, radii: [0.22, 0.2464, 0.2024] as const, clearance: 0.018 };
function triangles(geometry: RibbonGeometryData): Triangle[] {
  const point = (index: number) => new Vector3().fromArray(geometry.positions, index * 3);
  const result: Triangle[] = [];
  for (let i = 0; i < geometry.indices.length; i += 3) result.push(new Triangle(point(geometry.indices[i]), point(geometry.indices[i + 1]), point(geometry.indices[i + 2])));
  return result;
}
function maxSurfaceDistance(source: RibbonGeometryData, target: RibbonGeometryData): number {
  const targetTriangles = triangles(target);
  const nearest = new Vector3();
  let max = 0;
  for (let i = 0; i < source.positions.length; i += 3) {
    const point = new Vector3().fromArray(source.positions, i);
    max = Math.max(max, Math.min(...targetTriangles.map((triangle) => triangle.closestPointToPoint(point, nearest).distanceTo(point))));
  }
  return max;
}
describe('visible ribbon clipping', () => {
  it('preserves the prior surface and clips correctly across a shared narrowed seam', () => {
    const collider = { center: [0, 0, 0] as const, radii: [1, 1, 1] as const, clearance: 0.018 };
    const polar = (r: number, theta: number): [number, number, number] => [r * Math.cos(theta), r * Math.sin(theta), 0];
    const p0 = polar(1.02, 0.05), p1 = polar(1.02, 0.1);
    const previous = [{ s: 0, point: p0 }, { s: 0.5, point: p1 }, { s: 1, point: polar(1.02, 0.15) }];
    const next = [{ s: 0, point: p0 }, { s: 0.5, point: p1 }, { s: 1, point: polar(1.018, -0.28) }];
    const full = buildRibbonGeometryData(next.map((sample) => sample.point), 0.006, collider);
    expect(full.sampleIndices).toBeDefined();
    const junctionVertices = [...full.sampleIndices!].map((sample, vertex) => ({ sample, vertex }))
      .filter(({ sample, vertex }) => sample === 1 && vertex >= next.length * 2).map(({ vertex }) => vertex);
    expect(junctionVertices).toHaveLength(2);
    for (const vertex of junctionVertices) {
      const attachedSamples = new Set<number>();
      for (let i = 0; i < full.indices.length; i += 3) {
        const triangle = [...full.indices.slice(i, i + 3)];
        if (triangle.includes(vertex)) for (const index of triangle) attachedSamples.add(full.sampleIndices![index]);
      }
      // Each seam vertex is shared by triangles on both sides of the join.
      expect(attachedSamples.has(0)).toBe(true);
      expect(attachedSamples.has(2)).toBe(true);
    }
    const area = (geometry: RibbonGeometryData) => triangles(geometry).reduce((sum, triangle) => sum + triangle.getArea(), 0);
    let seamArea = 0;
    for (const length of [0.25, 0.5]) {
      const oldPrefix = buildVisibleRibbon(previous, length, 0.006, collider);
      const newPrefix = buildVisibleRibbon(next, length, 0.006, collider);
      expect(area(oldPrefix)).toBeGreaterThan(0);
      expect(maxSurfaceDistance(oldPrefix, newPrefix)).toBeLessThan(0.0000002);
      expect(maxSurfaceDistance(newPrefix, oldPrefix)).toBeLessThan(0.0000002);
      expect(Math.abs(area(oldPrefix) - area(newPrefix))).toBeLessThan(1e-8);
      seamArea = area(newPrefix);
    }
    const afterSeam = buildVisibleRibbon(next, 0.75, 0.006, collider);
    const whole = buildVisibleRibbon(next, 1, 0.006, collider);
    expect(area(afterSeam)).toBeGreaterThan(seamArea + 1e-6);
    expect(area(whole)).toBeGreaterThan(area(afterSeam) + 1e-6);
    expect(maxSurfaceDistance(afterSeam, whole)).toBeLessThan(0.0000002);
  });

  it('keeps the non-grid prefix surface within 0.5 mm after re-curling', () => {
    const editor = new HairEditor(createDemoHairState());
    expect(editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 }).changed).toBe(true);
    const strand = () => editor.exportState().strands.find((value) => value.id === 'C')!;
    const beforeSamples = fullHairSamples(strand(), head);
    const before = buildVisibleRibbon(beforeSamples, 0.043, 0.006, head);
    expect(editor.curlRange('C', { startS: 0.043, endS: 0.093, radius: 0.025, pitch: 0.08, phase: 0.3, direction: -1 }).changed).toBe(true);
    const afterSamples = fullHairSamples(strand(), head);
    const after = buildVisibleRibbon(afterSamples, 0.043, 0.006, head);
    expect(new Vector3(...beforeSamples.find((sample) => Math.abs(sample.s - 0.08) < 1e-9)!.point)
      .distanceTo(new Vector3(...afterSamples.find((sample) => Math.abs(sample.s - 0.08) < 1e-9)!.point))).toBeGreaterThan(0.0005);
    expect(maxSurfaceDistance(before, after)).toBeLessThanOrEqual(0.0005);
    expect(maxSurfaceDistance(after, before)).toBeLessThanOrEqual(0.0005);
  });

  it('keeps the prefix ribbon collision-safe and within 0.5 mm after a middle re-curl', () => {
    const editor = new HairEditor(createDemoHairState());
    expect(editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 }).changed).toBe(true);
    const strand = () => editor.exportState().strands.find((value) => value.id === 'C')!;
    const beforeSamples = fullHairSamples(strand(), head);
    const before = buildVisibleRibbon(beforeSamples, 0.12, 0.006, head);
    expect(editor.curlRange('C', { startS: 0.12, endS: 0.17, radius: 0.015, pitch: 0.05, phase: 0.8, direction: -1 }).changed).toBe(true);
    const afterSamples = fullHairSamples(strand(), head);
    const after = buildVisibleRibbon(afterSamples, 0.12, 0.006, head);
    const afterFull = buildVisibleRibbon(afterSamples, strand().length, 0.006, head);
    expect(new Vector3(...beforeSamples.find((sample) => Math.abs(sample.s - 0.16) < 1e-9)!.point)
      .distanceTo(new Vector3(...afterSamples.find((sample) => Math.abs(sample.s - 0.16) < 1e-9)!.point))).toBeGreaterThan(0.0005);

    // Check the whole triangle, not only its vertices: an edge or interior can cross the ellipsoid.
    for (const geometry of [before, after, afterFull]) {
      for (const triangle of triangles(geometry)) {
        const normalized = [triangle.a, triangle.b, triangle.c].map((p) => new Vector3(
          (p.x - head.center[0]) / head.radii[0],
          (p.y - head.center[1]) / head.radii[1],
          (p.z - head.center[2]) / head.radii[2],
        ));
        const scaled = new Triangle(normalized[0], normalized[1], normalized[2]);
        const origin = new Vector3();
        const distance = scaled.getArea() > 1e-12
          ? scaled.closestPointToPoint(origin, new Vector3()).length()
          : Math.min(...normalized.map((point, index) => {
            const next = normalized[(index + 1) % 3];
            return point.distanceToSquared(next) < 1e-20 ? point.length() : new Line3(point, next).closestPointToPoint(origin, true, new Vector3()).length();
          }));
        expect(distance).toBeGreaterThanOrEqual(1 - 1e-6);
      }
    }

    // Compare in both directions so changes to the surface cannot be hidden by clipping.
    expect(maxSurfaceDistance(before, after)).toBeLessThanOrEqual(0.0005);
    expect(maxSurfaceDistance(after, before)).toBeLessThanOrEqual(0.0005);
  });

  it('keeps the cut and grown ribbon on the original curved surface, including undo and redo', () => {
    const editor = new HairEditor(createDemoHairState());
    editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 });
    const strand = () => editor.exportState().strands.find((value) => value.id === 'C')!;
    const full = fullHairSamples(strand(), head);
    const original = triangles(buildRibbonGeometryData(full.map((sample) => sample.point), 0.006, head));
    const verify = () => {
      const visible = buildVisibleRibbon(fullHairSamples(strand(), head), strand().length, 0.006, head);
      expect(visible.indices.length).toBeGreaterThan(0);
      const nearest = new Vector3();
      for (let i = 0; i < visible.positions.length; i += 3) {
        const p = new Vector3().fromArray(visible.positions, i);
        const distance = Math.min(...original.map((triangle) => triangle.closestPointToPoint(p, nearest).distanceTo(p)));
        expect(distance).toBeLessThan(0.000001);
      }
    };
    editor.cutAt('C', 0.1973);
    verify();
    editor.growBy('C', 0.05);
    verify();
    editor.undo();
    verify();
    editor.redo();
    verify();
  });
});

it('does not add degenerate triangles when a cut lands exactly on a sample', () => {
  const farHead = { center: [100, 100, 100] as const, radii: [1, 1, 1] as const, clearance: 0 };
  const samples = [
    { s: 0, point: [0, 0, 0] as const },
    { s: 0.1, point: [0, -0.1, 0] as const },
    { s: 0.2, point: [0, -0.2, 0.03] as const },
  ];
  const output = buildVisibleRibbon(samples, 0.1, 0.006, farHead);
  const surface = triangles(output);
  expect(surface).toHaveLength(2);
  expect(surface.every((triangle) => triangle.getArea() > 1e-8)).toBe(true);
  const original = triangles(buildRibbonGeometryData(samples.map((sample) => sample.point), 0.006, farHead));
  expect(surface.reduce((sum, triangle) => sum + triangle.getArea(), 0)).toBeCloseTo(original[0].getArea() + original[1].getArea(), 9);
});

it('keeps the original ribbon surface when a curled non-grid tail grows beyond its recording', () => {
  const base = createDemoHairState();
  const editor = new HairEditor({ ...base, strands: base.strands.map((strand) => strand.id === 'C' ? { ...strand, maximumLength: strand.length } : strand) });
  editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.7, direction: -1 });
  editor.growBy('C', 0.213);
  const strand = () => editor.exportState().strands.find((item) => item.id === 'C')!;
  const ribbon = () => buildVisibleRibbon(fullHairSamples(strand(), head), strand().length, 0.006, head);
  const before = ribbon();
  editor.growBy('C', 0.05);
  const afterTriangles = triangles(ribbon());
  const nearest = new Vector3();
  for (let i = 0; i < before.positions.length; i += 3) {
    const p = new Vector3().fromArray(before.positions, i);
    expect(Math.min(...afterTriangles.map((triangle) => triangle.closestPointToPoint(p, nearest).distanceTo(p)))).toBeLessThanOrEqual(0.0005);
  }
});

it('restores extended straight and curled ribbons after saving, loading and redo', async () => {
  const { parseEditorHistory } = await import('./hair-core');
  for (const curled of [false, true]) {
    const base = createDemoHairState();
    const editor = new HairEditor({ ...base, strands: base.strands.map((strand) => strand.id === 'C' ? { ...strand, maximumLength: strand.length } : strand) });
    if (curled) editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.7, direction: 1 });
    editor.cutAt('C', 0.2);
    editor.growBy('C', 0.463);
    const render = (source: HairEditor) => {
      const strand = source.exportState().strands.find((value) => value.id === 'C')!;
      return buildVisibleRibbon(fullHairSamples(strand, head), strand.length, 0.006, head);
    };
    const original = render(editor);
    const history = parseEditorHistory(JSON.stringify(editor.exportHistory()))!;
    const reloaded = new HairEditor(history.current, history);
    expect(render(reloaded)).toEqual(original);
    reloaded.undo();
    expect(reloaded.exportState().strands.find((value) => value.id === 'C')?.length).toBeCloseTo(0.2);
    reloaded.redo();
    expect(render(reloaded)).toEqual(original);
  }
});

it('keeps small tight curls within 0.5 mm when extending a non-grid recorded tip', () => {
  const base = createDemoHairState();
  const editor = new HairEditor({ ...base, strands: base.strands.map((strand) => strand.id === 'C' ? { ...strand, maximumLength: strand.length } : strand) });
  editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.005, pitch: 0.02, phase: 1.24, direction: -1 });
  editor.growBy('C', 0.205);
  const strand = () => editor.exportState().strands.find((item) => item.id === 'C')!;
  const ribbon = () => buildVisibleRibbon(fullHairSamples(strand(), head), strand().length, 0.006, head);
  const before = ribbon();
  editor.growBy('C', 0.05);
  const after = triangles(ribbon());
  const nearest = new Vector3();
  for (let i = 0; i < before.positions.length; i += 3) {
    const p = new Vector3().fromArray(before.positions, i);
    expect(Math.min(...after.map((triangle) => triangle.closestPointToPoint(p, nearest).distanceTo(p)))).toBeLessThanOrEqual(0.0005);
  }
});
