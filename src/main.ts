import {
  BufferAttribute, BufferGeometry, CircleGeometry, Color, DoubleSide, Group, HemisphereLight, Line, LineBasicMaterial, MathUtils,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Raycaster, RingGeometry, Scene, SphereGeometry,
  TorusGeometry, Vector2, Vector3, WebGLRenderer, type Vector3Tuple,
} from 'three';
import './style.css';
import { createDemoHairState, HairEditor, parseEditorHistory, parseHairState, sampleStrandWithArcS, type Vec3 } from './hair-core';
import { assessActionIntent } from './constraint-graph';
import { hasExceededDragThreshold } from './input-gesture';
import { projectPointToArcSegment } from './line-arc';
import { RecentMeasurements } from './performance-metrics';
import { buildRibbonGeometryData } from './ribbon-geometry';
import { readEditorHistory, writeEditorHistory } from './indexeddb-storage';

const stage = document.querySelector<HTMLElement>('#stage');
const status = document.querySelector<HTMLElement>('#status');
if (!stage || !status) throw new Error('Required UI is missing');
const appStatus: HTMLElement = status;
const metrics = {
  selected: document.querySelector<HTMLElement>('#metric-selected'),
  length: document.querySelector<HTMLElement>('#metric-length'),
  curl: document.querySelector<HTMLElement>('#metric-curl'),
  cut: document.querySelector<HTMLElement>('#metric-cut'),
  mesh: document.querySelector<HTMLElement>('#metric-mesh'),
  render: document.querySelector<HTMLElement>('#metric-render'),
};

const storageKey = 'hair-atelier.editor-history.v2';
const legacyHistoryStorageKey = 'hair-atelier.editor-history.v1';
const legacyStorageKey = 'hair-atelier.hair-state.v1';
async function persistEditorHistory(candidate: HairEditor): Promise<boolean> {
  try {
    await writeEditorHistory(JSON.stringify(candidate.exportHistory()));
    return true;
  } catch {
    return false;
  }
}
async function loadPersistedEditor(): Promise<HairEditor | undefined> {
  try {
    const indexedHistory = parseEditorHistory(await readEditorHistory() ?? '');
    if (indexedHistory) return new HairEditor(indexedHistory.current, indexedHistory);
    for (const key of [storageKey, legacyHistoryStorageKey]) {
      const history = parseEditorHistory(localStorage.getItem(key) ?? '');
      if (!history) continue;
      const restored = new HairEditor(history.current, history);
      await persistEditorHistory(restored);
      return restored;
    }
    const legacyState = parseHairState(localStorage.getItem(legacyStorageKey) ?? '');
    if (!legacyState) return undefined;
    const restored = new HairEditor(legacyState);
    await persistEditorHistory(restored);
    return restored;
  } catch {
    return undefined;
  }
}
function persistState(): Promise<boolean> {
  return persistEditorHistory(editor);
}
let editor = new HairEditor(createDemoHairState());
const scene = new Scene();
scene.background = new Color('#211c29');
const camera = new PerspectiveCamera(35, 1, 0.01, 10);
camera.position.set(0, 0.05, 1.35);
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
stage.append(renderer.domElement);
let renderPending = false;
const renderMeasurements = new RecentMeasurements();
function requestRender(): void {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    const startedAt = performance.now();
    renderer.render(scene, camera);
    renderMeasurements.add(performance.now() - startedAt);
    if (metrics.render) metrics.render.textContent = renderMeasurements.p95 === undefined ? '—' : `${renderMeasurements.p95.toFixed(2)} ms`;
  });
}

scene.add(new HemisphereLight('#f4dffc', '#17141f', 2.2));
const head = new Mesh(
  new SphereGeometry(0.22, 32, 24),
  new MeshStandardMaterial({ color: '#9a8b89', roughness: 0.72 }),
);
head.scale.set(1, 1.12, 0.92);
const headRig = new Group();
headRig.add(head);
const earMaterial = new MeshStandardMaterial({ color: '#9a8b89', roughness: 0.72 });
for (const side of [-1, 1]) {
  const ear = new Mesh(new SphereGeometry(0.045, 16, 12), earMaterial);
  ear.scale.set(0.62, 1, 0.5);
  ear.position.set(side * 0.218, 0.025, 0);
  headRig.add(ear);
}
scene.add(headRig);

const hair = new Group();
scene.add(hair);
const tieMarkers = new Group();
const tieMarkerGeometry = new TorusGeometry(0.025, 0.006, 8, 20);
const tieMarkerMaterial = new MeshStandardMaterial({ color: '#f6a9be', roughness: 0.45 });
const tieMarkerPool = new Map<string, Mesh>();
hair.add(tieMarkers);
const presetColors: Record<string, string> = { A: '#ff9c79', B: '#ffd66b', C: '#85d8ff', D: '#cb9dff' };
function colorForStrand(id: string): string {
  const preset = presetColors[id];
  if (preset) return preset;
  const hue = [...id].reduce((hash, character) => (hash * 31 + character.codePointAt(0)!) >>> 0, 0) % 360;
  return `hsl(${hue} 78% 70%)`;
}
const hairLines = new Map<string, { line: Line; ribbon: Mesh; signature: string }>();
const guideRibbonWidthMeters = 0.006;
type Tool = 'rotate' | 'select' | 'cut' | 'clip' | 'curl' | 'comb' | 'part' | 'tuck' | 'ponytail' | 'halfup' | 'pair' | 'braid' | 'sweep' | 'grow';
type HairHit = { id: string; s: number; point: Vector3 };
let tool: Tool = 'rotate';
let selectedId: string | undefined;
const selectedStrandIds = new Set<string>();
let previewCutS: number | undefined;
let meshUpdateMilliseconds = 0;
let rebuiltStrandCount = 0;
const raycaster = new Raycaster();
raycaster.params.Line = { threshold: 0.014 };
const cursor = new Mesh(
  new RingGeometry(0.012, 0.016, 20),
  new MeshBasicMaterial({ color: '#ffffff', side: DoubleSide }),
);
cursor.visible = false;
scene.add(cursor);
const scissorsCursor = new Group();
const bladeGeometry = new BufferGeometry().setFromPoints([new Vector3(-0.028, -0.014, 0), new Vector3(0.028, 0.014, 0)]);
const bladeMaterial = new LineBasicMaterial({ color: '#ffd2e0' });
const bladeA = new Line(bladeGeometry, bladeMaterial);
const bladeB = bladeA.clone();
bladeB.rotation.z = Math.PI / 2;
scissorsCursor.add(bladeA, bladeB, new Mesh(new CircleGeometry(0.006, 16), new MeshBasicMaterial({ color: '#ffffff' })));
scissorsCursor.visible = false;
scene.add(scissorsCursor);

function createRibbonGeometry(points: readonly Vec3[]): BufferGeometry {
  const data = buildRibbonGeometryData(points, guideRibbonWidthMeters);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function redraw(): void {
  const startedAt = performance.now();
  rebuiltStrandCount = 0;
  const state = editor.exportState();
  const activeIds = new Set(state.strands.map((strand) => strand.id));
  for (const [id, record] of hairLines) {
    if (activeIds.has(id)) continue;
    hair.remove(record.line, record.ribbon);
    record.line.geometry.dispose();
    (Array.isArray(record.line.material) ? record.line.material : [record.line.material]).forEach((material) => material.dispose());
    record.ribbon.geometry.dispose();
    (Array.isArray(record.ribbon.material) ? record.ribbon.material : [record.ribbon.material]).forEach((material) => material.dispose());
    hairLines.delete(id);
  }
  for (const strand of state.strands) {
    const signature = JSON.stringify(strand);
    const existing = hairLines.get(strand.id);
    if (existing?.signature === signature) continue;
    const sampled = sampleStrandWithArcS(strand);
    const points = sampled.map(({ point: [x, y, z] }) => new Vector3(x, y, z));
    const geometry = new BufferGeometry().setFromPoints(points);
    const ribbonGeometry = createRibbonGeometry(sampled.map((sample) => sample.point));
    if (existing) {
      existing.line.geometry.dispose();
      existing.line.geometry = geometry;
      existing.ribbon.geometry.dispose();
      existing.ribbon.geometry = ribbonGeometry;
      existing.line.userData = { strandId: strand.id, sampleS: sampled.map((sample) => sample.s) };
      existing.signature = signature;
    } else {
      const material = new LineBasicMaterial({ color: colorForStrand(strand.id), linewidth: 1, transparent: true, opacity: 0, depthWrite: false });
      const line = new Line(geometry, material);
      line.userData = { strandId: strand.id, sampleS: sampled.map((sample) => sample.s) };
      const ribbon = new Mesh(ribbonGeometry, new MeshBasicMaterial({
        color: colorForStrand(strand.id), side: DoubleSide, transparent: true, opacity: 0.88, depthWrite: false,
      }));
      hair.add(line, ribbon);
      hairLines.set(strand.id, { line, ribbon, signature });
    }
    const record = hairLines.get(strand.id)!;
    (record.ribbon.material as MeshBasicMaterial).color.set(selectedStrandIds.has(strand.id) ? '#ffeaf1' : colorForStrand(strand.id));
    rebuiltStrandCount += 1;
  }
  const activeTies = [...new Map(state.strands.flatMap((strand) => strand.tie ? [[strand.tie.id, strand.tie] as const] : [])).values()];
  tieMarkerPool.forEach((marker) => { marker.visible = false; });
  for (const tie of activeTies) {
    let marker = tieMarkerPool.get(tie.id);
    if (!marker) {
      marker = new Mesh(tieMarkerGeometry, tieMarkerMaterial);
      marker.rotation.x = Math.PI / 2;
      tieMarkers.add(marker);
      tieMarkerPool.set(tie.id, marker);
    }
    marker.position.fromArray(tie.anchor);
    marker.visible = true;
  }
  const c = state.strands.find((strand) => strand.id === 'C');
  meshUpdateMilliseconds = performance.now() - startedAt;
  appStatus.textContent = c ? `${toolLabel(tool)} ｜ C：${Math.round(c.length * 100)} cm ｜ Undo ${editor.canUndo ? '可用' : '未有操作'}` : '髮束資料錯誤';
  updateOverlay();
  highlightHair();
  requestRender();
}

function updateOverlay(): void {
  const strand = editor.exportState().strands.find((item) => item.id === selectedId);
  const curl = strand?.curls[0];
  if (metrics.selected) metrics.selected.textContent = strand?.id ?? '—';
  if (metrics.length) metrics.length.textContent = strand ? `${(strand.length * 100).toFixed(1)} cm` : '—';
  if (metrics.curl) metrics.curl.textContent = curl ? `${(curl.radius * 100).toFixed(1)} / ${(curl.pitch * 100).toFixed(1)} cm` : '—';
  if (metrics.cut) metrics.cut.textContent = previewCutS === undefined ? '—' : `${(previewCutS * 100).toFixed(1)} cm`;
  if (metrics.mesh) metrics.mesh.textContent = `${meshUpdateMilliseconds.toFixed(2)} ms / ${rebuiltStrandCount}`;
}

function toolLabel(value: Tool): string {
  return ({ rotate: '旋轉檢視', select: '選取：點按髮束加入或移除', cut: '剪刀：拖過髮束後放手', clip: '電剪：拖掃髮束後放手', curl: '捲髮器：按住後向側拖', comb: '梳子：按住髮束拖動', part: '分界：在頭皮水平拖動', tuck: '夾耳後：點按髮束', ponytail: '馬尾：套用至選取組別', halfup: '公主頭：套用至選取組別', pair: '兩束綁：先選取兩束或以上，再點按髮束', braid: '三股辮：需要選取三束', sweep: '側撥：點按任一髮束', grow: '增髮：點按髮束' })[value];
}

function hitHair(clientX: number, clientY: number): HairHit | undefined {
  // Keep a roughly stable screen-space hit target when pinch zoom changes distance.
  raycaster.params.Line.threshold = MathUtils.clamp(0.014 * camera.position.z / 1.35, 0.01, 0.025);
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(new Vector2(x, y), camera);
  scene.updateMatrixWorld(true);
  const headDistance = raycaster.intersectObject(headRig, true)[0]?.distance ?? Number.POSITIVE_INFINITY;
  const intersection = raycaster.intersectObjects([...hairLines.values()].map((record) => record.line), false)
    .find((candidate) => candidate.distance <= headDistance + 0.002);
  if (!intersection) return undefined;
  const { strandId, sampleS } = intersection.object.userData as {
    strandId: string; sampleS: readonly number[];
  };
  const line = intersection.object as Line;
  const position = line.geometry.getAttribute('position');
  if (!position || !Array.isArray(sampleS) || sampleS.length < 2) return undefined;
  const segmentIndex = Math.max(0, Math.min(intersection.index ?? 0, sampleS.length - 2));
  const start: Vector3Tuple = [position.getX(segmentIndex), position.getY(segmentIndex), position.getZ(segmentIndex)];
  const end: Vector3Tuple = [position.getX(segmentIndex + 1), position.getY(segmentIndex + 1), position.getZ(segmentIndex + 1)];
  const localPoint = line.worldToLocal(intersection.point.clone());
  const projection = projectPointToArcSegment([localPoint.x, localPoint.y, localPoint.z], {
    a: start, b: end, s0: sampleS[segmentIndex], s1: sampleS[segmentIndex + 1],
  });
  return {
    id: strandId,
    s: projection.s,
    point: line.localToWorld(new Vector3(...projection.point)),
  };
}

function sweepHits(fromX: number, fromY: number, toX: number, toY: number): HairHit[] {
  const distance = Math.hypot(toX - fromX, toY - fromY);
  const steps = Math.max(1, Math.ceil(distance / 8));
  const hits: HairHit[] = [];
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const hit = hitHair(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t);
    if (hit) hits.push(hit);
  }
  return hits;
}

function highlightHair(strandId?: string): void {
  for (const [id, record] of hairLines) {
    (record.ribbon.material as MeshBasicMaterial).color.set(
      id === strandId ? '#ffffff' : selectedStrandIds.has(id) ? '#ffeaf1' : colorForStrand(id),
    );
  }
  requestRender();
}

function showCursor(hit: HairHit | undefined): void {
  selectedId = hit?.id;
  previewCutS = tool === 'cut' ? hit?.s : undefined;
  updateOverlay();
  if (!hit) { cursor.visible = false; scissorsCursor.visible = false; highlightHair(); return; }
  cursor.position.copy(hit.point);
  cursor.quaternion.copy(camera.quaternion);
  cursor.visible = tool !== 'cut';
  scissorsCursor.position.copy(hit.point);
  scissorsCursor.quaternion.copy(camera.quaternion);
  scissorsCursor.visible = tool === 'cut';
  highlightHair(hit.id);
  requestRender();
}

let rotationX = 0;
let rotationY = 0;
function applyViewRotation(): void {
  hair.rotation.set(rotationX, rotationY, 0);
  headRig.rotation.set(rotationX, rotationY, 0);
  requestRender();
}
let pointer: { x: number; y: number; startX: number; startY: number; hasDragged: boolean; hit?: HairHit; cuts: Map<string, number>; clippedIds: Set<string>; curlStartX?: number; combStart?: { x: number; y: number } } | undefined;
const activePointers = new Map<number, { x: number; y: number }>();
let lastPinchDistance: number | undefined;
function pinchDistance(): number | undefined {
  const points = [...activePointers.values()];
  return points.length === 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : undefined;
}
renderer.domElement.addEventListener('pointerdown', (event) => {
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size > 1 && tool !== 'rotate') {
    pointer = undefined;
    cursor.visible = false;
    scissorsCursor.visible = false;
    previewCutS = undefined;
    updateOverlay();
    requestRender();
    return;
  }
  const hit = hitHair(event.clientX, event.clientY);
  const cuts = new Map<string, number>();
  const clippedIds = new Set<string>();
  pointer = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, hasDragged: false, hit, cuts, clippedIds, curlStartX: event.clientX, combStart: { x: event.clientX, y: event.clientY } };
  renderer.domElement.setPointerCapture(event.pointerId);
  lastPinchDistance = pinchDistance();
  if (tool === 'select' && hit) {
    if (selectedStrandIds.has(hit.id)) selectedStrandIds.delete(hit.id);
    else selectedStrandIds.add(hit.id);
    selectedId = hit.id;
    redraw();
    appStatus.textContent = `已選取 ${[...selectedStrandIds].join('、') || '無髮束'}`;
  } else if (tool === 'grow' && hit) {
    editor.growBy(hit.id, 0.05);
    persistState();
    redraw();
    appStatus.textContent = `已對 ${hit.id} 增長 5 cm`;
  } else if (tool === 'tuck' && hit) {
    const strand = editor.exportState().strands.find((item) => item.id === hit.id);
    const side = strand && strand.root[0] < 0 ? 'left' : 'right';
    const result = editor.tuckBehindEar(hit.id, side);
    if (result.changed) persistState();
    redraw();
    appStatus.textContent = result.changed ? `已將 ${hit.id} 夾到${side === 'left' ? '左' : '右'}耳後` : '此髮束已在指定耳後';
  } else if (tool === 'ponytail' && hit) {
    const height = document.querySelector<HTMLSelectElement>('#ponytail-height')?.value === 'high' ? 'high' : 'low';
    const tie = height === 'high'
      ? { id: 'pony-high', anchor: [0, 0.17, -0.16] as Vector3Tuple, gatherS: 0.14 }
      : { id: 'pony-low', anchor: [0, 0.02, -0.18] as Vector3Tuple, gatherS: 0.16 };
    const targetIds = selectedStrandIds.size > 0 ? [...selectedStrandIds] : editor.exportState().strands.map((strand) => strand.id);
    const assessment = assessActionIntent(editor.exportState(), { type: 'tie', strandIds: targetIds, tie });
    if (assessment.decision !== 'Allowed') {
      appStatus.textContent = assessment.message;
      requestRender();
      return;
    }
    const results = editor.tieStrands(targetIds, {
      ...tie,
    });
    if (results.length > 0) persistState();
    redraw();
    appStatus.textContent = results.length > 0 ? `已將 ${results.length} 束髮綁成${height === 'high' ? '高' : '低'}馬尾` : '髮束已綁定或長度不足';
  } else if (tool === 'halfup' && hit) {
    const targetIds = selectedStrandIds.size > 0 ? [...selectedStrandIds] : ['B', 'C'];
    const tie = { id: 'half-up', anchor: [0, 0.12, -0.15] as Vector3Tuple, gatherS: 0.13 };
    const assessment = assessActionIntent(editor.exportState(), { type: 'tie', strandIds: targetIds, tie });
    if (assessment.decision !== 'Allowed') {
      appStatus.textContent = assessment.message;
      requestRender();
      return;
    }
    const results = editor.tieStrands(targetIds, tie);
    if (results.length > 0) persistState();
    redraw();
    appStatus.textContent = results.length > 0 ? '已將上半部髮束綁成公主頭' : '上半部髮束已綁定或長度不足';
  } else if (tool === 'pair' && hit) {
    const selected = [...selectedStrandIds]
      .map((id) => editor.exportState().strands.find((strand) => strand.id === id))
      .filter((strand): strand is NonNullable<typeof strand> => Boolean(strand))
      .sort((left, right) => left.root[0] - right.root[0]);
    if (selected.length < 2) {
      appStatus.textContent = '請先用「選取」揀至少兩束髮，再建立兩束綁';
      requestRender();
      return;
    }
    const splitAt = Math.ceil(selected.length / 2);
    const leftIds = selected.slice(0, splitAt).map((strand) => strand.id);
    const rightIds = selected.slice(splitAt).map((strand) => strand.id);
    const anchor: Vector3Tuple = [0, 0.04, -0.18];
    const groups = [
      { strandIds: leftIds, tie: { id: 'pair-left', anchor, gatherS: 0.15 } },
      { strandIds: rightIds, tie: { id: 'pair-right', anchor, gatherS: 0.15 } },
    ];
    const assessment = groups.map((group) => assessActionIntent(editor.exportState(), { type: 'tie' as const, ...group }))
      .find((result) => result.decision !== 'Allowed');
    if (assessment) {
      appStatus.textContent = assessment.message;
      requestRender();
      return;
    }
    const results = editor.tieGroups(groups);
    if (results.length > 0) persistState();
    redraw();
    appStatus.textContent = results.length > 0
      ? `已把 ${leftIds.join('、')} 與 ${rightIds.join('、')} 綁到同一位置`
      : '髮束已綁定或長度不足';
  } else if (tool === 'braid' && hit) {
    const selected = selectedStrandIds.size === 3 ? [...selectedStrandIds] as [string, string, string] : ['B', 'C', 'D'] as [string, string, string];
    const selectedStrands = selected.map((id) => editor.exportState().strands.find((strand) => strand.id === id));
    const sharedTie = selectedStrands[0]?.tie && selectedStrands.every((strand) => strand?.tie?.id === selectedStrands[0]?.tie?.id)
      ? selectedStrands[0].tie
      : undefined;
    const startS = Math.max(0.04, (sharedTie?.gatherS ?? 0.02) + 0.02);
    const endS = Math.min(0.24, ...selectedStrands.map((strand) => strand?.length ?? 0));
    const braid = {
      id: 'braid-demo', axisOrigin: sharedTie?.anchor ?? [0.04, 0.22, -0.02], startS, endS, radius: 0.018, pitch: 0.055,
    } as const;
    const assessment = assessActionIntent(editor.exportState(), { type: 'braid', strandIds: selected, braid });
    if (assessment.decision !== 'Allowed') {
      appStatus.textContent = assessment.message;
      requestRender();
      return;
    }
    const results = editor.braidStrands(selected, braid);
    if (results.length > 0) persistState();
    redraw();
    appStatus.textContent = results.length > 0 ? `已以 ${selected.join('、')} 建立三股辮路徑` : '需要三束未編髮或髮束長度不足';
  } else if (tool === 'sweep' && hit) {
    const side = document.querySelector<HTMLSelectElement>('#sweep-side')?.value === 'right' ? 'right' : 'left';
    const results = editor.sweepToSide(side);
    if (results.length > 0) persistState();
    redraw();
    appStatus.textContent = results.length > 0 ? `已將 ${results.length} 束髮撥向${side === 'left' ? '左' : '右'}側` : '髮束已在指定側';
  } else if (tool !== 'rotate') showCursor(hit);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (!pointer) return;
  if (tool === 'cut') {
    if (!pointer.hasDragged && !hasExceededDragThreshold(pointer, { x: event.clientX, y: event.clientY })) return;
    pointer.hasDragged = true;
    const hits = sweepHits(pointer.x, pointer.y, event.clientX, event.clientY);
    for (const hit of hits) pointer.cuts.set(hit.id, Math.min(pointer.cuts.get(hit.id) ?? hit.s, hit.s));
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const latest = hits.at(-1);
    showCursor(latest);
    if (latest) {
      previewCutS = pointer.cuts.get(latest.id);
      updateOverlay();
    }
    return;
  }
  if (tool === 'clip') {
    if (!pointer.hasDragged && !hasExceededDragThreshold(pointer, { x: event.clientX, y: event.clientY })) return;
    pointer.hasDragged = true;
    const hits = sweepHits(pointer.x, pointer.y, event.clientX, event.clientY);
    hits.forEach((hit) => pointer?.clippedIds.add(hit.id));
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    showCursor(hits.at(-1));
    return;
  }
  if (tool === 'comb') { showCursor(hitHair(event.clientX, event.clientY)); return; }
  if (tool === 'part') {
    if (hasExceededDragThreshold(pointer, { x: event.clientX, y: event.clientY })) pointer.hasDragged = true;
    return;
  }
  if (tool === 'curl') {
    if (hasExceededDragThreshold(pointer, { x: event.clientX, y: event.clientY })) pointer.hasDragged = true;
    showCursor(hitHair(event.clientX, event.clientY));
    return;
  }
  if (tool === 'grow') { showCursor(hitHair(event.clientX, event.clientY)); return; }
  if (tool !== 'rotate') return;
  const nextPinchDistance = pinchDistance();
  if (nextPinchDistance && lastPinchDistance) {
    camera.position.z = MathUtils.clamp(camera.position.z - (nextPinchDistance - lastPinchDistance) * 0.0025, 0.72, 2.2);
    lastPinchDistance = nextPinchDistance;
    requestRender();
    return;
  }
  rotationY += (event.clientX - pointer.x) * 0.01;
  rotationX = MathUtils.clamp(rotationX + (event.clientY - pointer.y) * 0.008, -0.45, 0.45);
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  applyViewRotation();
});
function finishGesture(event: PointerEvent, cancelled = false): void {
  activePointers.delete(event.pointerId);
  lastPinchDistance = pinchDistance();
  if (!pointer) return;
  const gesture = pointer;
  pointer = undefined;
  cursor.visible = false;
  scissorsCursor.visible = false;
  previewCutS = undefined;
  updateOverlay();
  highlightHair();
  if (cancelled) return;
  if (tool === 'cut' && gesture.cuts.size > 0) {
    const targets = [...gesture.cuts].map(([strandId, arcLengthMeters]) => ({ strandId, arcLengthMeters }));
    const blocked = targets.map((target) => assessActionIntent(editor.exportState(), { type: 'cut', strandId: target.strandId, atS: target.arcLengthMeters }))
      .find((assessment) => assessment.decision !== 'Allowed');
    const results = editor.cutManyAt(targets);
    if (results.length > 0) persistState();
    redraw();
    appStatus.textContent = results.length > 0
      ? `一次剪短 ${results.map((result) => result.strandId).join('、')} 共 ${results.length} 束${blocked ? '；部分髮束未剪：' + blocked.message : ''}`
      : blocked?.message ?? '剪刀未切到可移除的髮尾';
  }
  if (tool === 'clip' && gesture.clippedIds.size > 0) {
    const guard = Number(document.querySelector<HTMLInputElement>('#clipper-length')?.value ?? 6) / 100;
    const targetIds = [...gesture.clippedIds];
    const blocked = targetIds.map((strandId) => assessActionIntent(editor.exportState(), { type: 'cut', strandId, atS: guard }))
      .find((assessment) => assessment.decision !== 'Allowed');
    const results = editor.clipManyAt(targetIds, guard);
    if (results.length > 0) persistState();
    redraw();
    appStatus.textContent = results.length > 0
      ? `電剪修短 ${results.map((result) => result.strandId).join('、')} 至 ${Math.round(guard * 100)} cm${blocked ? '；部分髮束未剪：' + blocked.message : ''}`
      : blocked?.message ?? '命中髮束已短於設定留髮長度';
  }
  if (tool === 'curl' && gesture.hit && gesture.hasDragged) {
    const strand = editor.exportState().strands.find((item) => item.id === gesture.hit?.id);
    if (!strand) return;
    const direction = event.clientX - (gesture.curlStartX ?? event.clientX) >= 0 ? 1 : -1;
    const startS = Math.max(0.01, gesture.hit.s - 0.04);
    const result = editor.curlRange(strand.id, { startS, endS: strand.length, radius: 0.025, pitch: 0.08, phase: 0.3, direction });
    if (result.changed) persistState();
    redraw();
    appStatus.textContent = result.changed ? `已捲曲 ${strand.id} 的 ${Math.round(startS * 100)} cm 至髮尾` : result.reason ?? '未能建立捲曲';
  }
  if (tool === 'comb' && gesture.hit && gesture.combStart) {
    const result = editor.combBy(gesture.hit.id, [
      (event.clientX - gesture.combStart.x) * 0.0025,
      0,
      -(event.clientY - gesture.combStart.y) * 0.0025,
    ]);
    if (result.changed) persistState();
    redraw();
    appStatus.textContent = result.changed ? `已向指定方向撥動 ${gesture.hit.id}` : result.reason ?? '梳子未產生有效位移';
  }
  if (tool === 'part' && gesture.combStart && gesture.hasDragged) {
    const rect = renderer.domElement.getBoundingClientRect();
    const partingX = MathUtils.clamp(((event.clientX - rect.left) / rect.width - 0.5) * 0.3, -0.15, 0.15);
    const result = editor.setParting(partingX);
    if (result.changed) persistState();
    redraw();
    appStatus.textContent = result.changed ? `已移動分界至 ${Math.round(partingX * 100)} cm` : '分界位置未改變';
  }
}
renderer.domElement.addEventListener('pointerup', (event) => finishGesture(event));
renderer.domElement.addEventListener('pointercancel', (event) => finishGesture(event, true));
renderer.domElement.addEventListener('pointerleave', () => { if (!pointer) showCursor(undefined); });
renderer.domElement.addEventListener('pointermove', (event) => { if (!pointer && tool !== 'rotate') showCursor(hitHair(event.clientX, event.clientY)); });

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
  button.addEventListener('click', () => {
    tool = button.dataset.tool as Tool;
    document.querySelectorAll('[data-tool]').forEach((item) => item.classList.toggle('active', item === button));
    redraw();
  });
});
const clipperLength = document.querySelector<HTMLInputElement>('#clipper-length');
const clipperLengthValue = document.querySelector<HTMLOutputElement>('#clipper-length-value');
clipperLength?.addEventListener('input', () => {
  if (clipperLengthValue) clipperLengthValue.value = `${clipperLength.value} cm`;
});
document.querySelector<HTMLButtonElement>('#undo')?.addEventListener('click', () => {
  editor.undo();
  persistState();
  redraw();
});
document.querySelector<HTMLButtonElement>('#redo')?.addEventListener('click', () => { editor.redo(); persistState(); redraw(); });
document.querySelector<HTMLButtonElement>('#clear-selection')?.addEventListener('click', () => {
  selectedStrandIds.clear();
  selectedId = undefined;
  redraw();
  appStatus.textContent = '已取消所有髮束選取';
});
document.querySelector<HTMLButtonElement>('#save')?.addEventListener('click', () => {
  void persistState().then((saved) => { appStatus.textContent = saved ? '已儲存到本機瀏覽器' : '瀏覽器拒絕本機儲存'; });
});
document.querySelector<HTMLButtonElement>('#load')?.addEventListener('click', () => {
  void loadPersistedEditor().then((restored) => {
    if (!restored) { appStatus.textContent = '沒有可讀取的有效儲存資料'; return; }
    editor = restored;
    appStatus.textContent = '已讀取本機儲存與操作歷史';
    redraw();
  });
});
document.querySelector<HTMLButtonElement>('#reset')?.addEventListener('click', () => {
  editor = new HairEditor(createDemoHairState());
  selectedStrandIds.clear();
  selectedId = undefined;
  persistState();
  redraw();
});
document.querySelector<HTMLButtonElement>('#front')?.addEventListener('click', () => {
  rotationX = 0;
  rotationY = 0;
  camera.position.z = 1.35;
  applyViewRotation();
  appStatus.textContent = '已回到正面視角';
});

new ResizeObserver(() => {
  const { clientWidth, clientHeight } = stage;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight);
  requestRender();
}).observe(stage);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
redraw();
void loadPersistedEditor().then((restored) => {
  if (!restored) return;
  editor = restored;
  appStatus.textContent = '已自動讀取本機儲存與操作歷史';
  redraw();
});
