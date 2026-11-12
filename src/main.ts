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
import { buildVisibleRibbon } from './visible-ribbon';
import { fullHairSamples, visibleHairSamples } from './visible-hair';
import { readEditorHistory, StorageConflictError, writeEditorHistory, type StorageToken } from './indexeddb-storage';
import { SaveQueue } from './save-queue';
import { freeCurlInterval } from './curl-target';
import { growthMessage } from './growth-message';
import { nearestVisibleHairHit } from './occlusion';
import { clipSweepToBounds, sweepStepPixels } from './sweep-sampling';

const stage = document.querySelector<HTMLElement>('#stage');
const status = document.querySelector<HTMLElement>('#status');
if (!stage || !status) throw new Error('Required UI is missing');
const appStatus: HTMLElement = status;
const storageWarning = document.querySelector<HTMLElement>('#storage-warning');
function showStorageWarning(message: string): void {
  if (!storageWarning) return;
  storageWarning.textContent = message;
  storageWarning.hidden = false;
}
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
let storageProtected = false;
let storageToken: StorageToken = { current: undefined, legacy: undefined };
let storageConflict = false;
let hasUnsavedChanges = false;
let finishInitialStorageRead!: () => void;
const initialStorageRead = new Promise<void>((resolve) => { finishInitialStorageRead = resolve; });
const saveQueue = new SaveQueue();
function persistEditorHistory(candidate: HairEditor): Promise<boolean> {
  hasUnsavedChanges = true;
  const result = saveQueue.save(JSON.stringify(candidate.exportHistory()), async (snapshot) => {
    await initialStorageRead;
    if (storageProtected) throw new Error('Existing storage is protected');
    try {
      await writeEditorHistory(snapshot, storageToken);
      storageToken = { current: snapshot, legacy: undefined };
    } catch (error) {
      if (error instanceof StorageConflictError) storageConflict = true;
      throw error;
    }
  });
  const revision = saveQueue.revision;
  return result.then((saved) => {
    if (revision === saveQueue.revision) hasUnsavedChanges = !saved;
    if (!saved) showStorageWarning(storageConflict ? '另一個分頁已更新存檔；目前操作未儲存，讀取存檔會取代目前操作。' : '儲存失敗，現有操作可能未保存。');
    else if (storageWarning && !storageProtected) storageWarning.hidden = true;
    return saved;
  });
}
async function loadPersistedEditor(): Promise<{ editor?: HairEditor; token: StorageToken } | undefined> {
  await saveQueue.settled();
  try {
    const read = await readEditorHistory();
    const stored = read.value;
    const indexedHistory = parseEditorHistory(stored ?? '');
    if (stored !== undefined && !indexedHistory) {
      storageProtected = true;
      appStatus.textContent = '本機存檔無法讀取；已暫停自動儲存以保護資料';
      showStorageWarning('本機存檔無法讀取，已暫停儲存以保護資料。');
      return undefined;
    }
    if (indexedHistory) return { editor: new HairEditor(indexedHistory.current, indexedHistory), token: read.token };
    for (const key of [storageKey, legacyHistoryStorageKey]) {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      const history = parseEditorHistory(raw);
      if (!history) {
        storageProtected = true;
        showStorageWarning('舊存檔無法讀取，已暫停儲存以保護資料。');
        return undefined;
      }
      const restored = new HairEditor(history.current, history);
      return { editor: restored, token: read.token };
    }
    const rawLegacyState = localStorage.getItem(legacyStorageKey);
    if (rawLegacyState === null) return { token: read.token };
    const legacyState = parseHairState(rawLegacyState);
    if (!legacyState) {
      storageProtected = true;
      showStorageWarning('舊存檔無法讀取，已暫停儲存以保護資料。');
      return undefined;
    }
    const restored = new HairEditor(legacyState);
    return { editor: restored, token: read.token };
  } catch {
    storageProtected = true;
    appStatus.textContent = '本機儲存暫時無法讀取，已暫停儲存以保護資料';
    showStorageWarning('本機儲存暫時無法讀取，已暫停儲存以保護資料。');
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
// Mirrors the visible head mesh (sphere radius .22, scaled 1 / 1.12 / .92).
// It is render-only: editor state keeps the physical rest centreline unchanged.
const headCollider = { center: [0, 0, 0] as Vec3, radii: [0.22, 0.2464, 0.2024] as Vec3, clearance: 0.018 };
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

function createRibbonGeometry(points: readonly Vec3[], fullSamples?: ReturnType<typeof fullHairSamples>, length = 0): BufferGeometry {
  const data = fullSamples ? buildVisibleRibbon(fullSamples, length, guideRibbonWidthMeters, headCollider) : buildRibbonGeometryData(points, guideRibbonWidthMeters, headCollider);
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
    // A curl may mathematically pass through the head. Constrain only the
    // rendered/pickable centreline so the visual hair stays outside the skull.
    let renderedSamples: typeof sampled;
    let fullSamples: ReturnType<typeof fullHairSamples> | undefined;
    try {
      fullSamples = fullHairSamples(strand, headCollider);
      renderedSamples = visibleHairSamples(strand, headCollider, fullSamples);
    } catch {
      // A legacy root inside the head cannot be fixed without moving it.
      // Preserve the saved data and render the original path instead of crashing.
      renderedSamples = sampled;
    }
    const renderedPoints = renderedSamples.map((sample) => sample.point);
    const points = renderedPoints.map(([x, y, z]) => new Vector3(x, y, z));
    const geometry = new BufferGeometry().setFromPoints(points);
    const ribbonGeometry = createRibbonGeometry(renderedPoints, fullSamples, strand.length);
    if (existing) {
      existing.line.geometry.dispose();
      existing.line.geometry = geometry;
      existing.ribbon.geometry.dispose();
      existing.ribbon.geometry = ribbonGeometry;
      existing.line.userData = { strandId: strand.id, sampleS: renderedSamples.map((sample) => sample.s) };
      existing.signature = signature;
    } else {
      const material = new LineBasicMaterial({ color: colorForStrand(strand.id), linewidth: 1, transparent: true, opacity: 0, depthWrite: false });
      const line = new Line(geometry, material);
      line.userData = { strandId: strand.id, sampleS: renderedSamples.map((sample) => sample.s) };
      const ribbon = new Mesh(ribbonGeometry, new MeshBasicMaterial({
        color: colorForStrand(strand.id), side: DoubleSide, transparent: false, opacity: 1, depthWrite: true,
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

interface PickContext { rect: DOMRect; lines: Line[]; cameraPosition: Vector3 }
const pickPosition = new Vector2();
const visibilityRaycaster = new Raycaster();
function preparePickContext(): PickContext {
  raycaster.params.Line.threshold = MathUtils.clamp(0.014 * camera.position.z / 1.35, 0.01, 0.025);
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  return {
    rect: renderer.domElement.getBoundingClientRect(),
    lines: [...hairLines.values()].map((record) => record.line),
    cameraPosition: camera.getWorldPosition(new Vector3()),
  };
}
function hitHair(clientX: number, clientY: number, context = preparePickContext()): HairHit | undefined {
  const { rect, lines, cameraPosition } = context;
  if (rect.width <= 0 || rect.height <= 0 || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return undefined;
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pickPosition.set(x, y), camera);
  const candidates = raycaster.intersectObjects(lines, false);
  const intersection = nearestVisibleHairHit(candidates, cameraPosition, headRig, visibilityRaycaster);
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
  const context = preparePickContext();
  const clipped = clipSweepToBounds({ x: fromX, y: fromY }, { x: toX, y: toY }, context.rect);
  if (!clipped) return [];
  const distance = Math.hypot(clipped.to.x - clipped.from.x, clipped.to.y - clipped.from.y);
  // Use the smallest expected screen-space target across the head and visible
  // strand range, rather than a fixed gap that can skip narrow targets.
  const radius = MathUtils.clamp(0.014 * camera.position.z / 1.35, 0.01, 0.025);
  const maxDistance = camera.position.length() + 1;
  const spacing = sweepStepPixels(radius, renderer.domElement.clientHeight, MathUtils.degToRad(camera.fov), maxDistance);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  const hits: HairHit[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const hit = hitHair(clipped.from.x + (clipped.to.x - clipped.from.x) * t, clipped.from.y + (clipped.to.y - clipped.from.y) * t, context);
    if (hit) hits.push(hit);
  }
  return hits;
}

type SweepGesture = { x: number; y: number; hasDragged: boolean; hit?: HairHit; cuts: Map<string, number>; clippedIds: Set<string> };
function collectSweep(gesture: SweepGesture, mode: 'cut' | 'clip', x: number, y: number): HairHit[] {
  if (!gesture.hasDragged && !hasExceededDragThreshold(gesture, { x, y })) return [];
  const hits = sweepHits(gesture.x, gesture.y, x, y);
  if (!gesture.hasDragged && gesture.hit) hits.unshift(gesture.hit);
  gesture.hasDragged = true;
  for (const hit of hits) {
    if (mode === 'cut') gesture.cuts.set(hit.id, Math.min(gesture.cuts.get(hit.id) ?? hit.s, hit.s));
    else gesture.clippedIds.add(hit.id);
  }
  gesture.x = x;
  gesture.y = y;
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
let pointer: { pointerId: number; tool: Tool; x: number; y: number; startX: number; startY: number; hasDragged: boolean; hit?: HairHit; cuts: Map<string, number>; clippedIds: Set<string>; curlStartX?: number; combStart?: { x: number; y: number } } | undefined;
const activePointers = new Map<number, { x: number; y: number }>();
let lastPinchDistance: number | undefined;
function cancelActiveGesture(): void {
  pointer = undefined;
  activePointers.clear();
  lastPinchDistance = undefined;
  cursor.visible = false;
  scissorsCursor.visible = false;
  previewCutS = undefined;
  updateOverlay();
  highlightHair();
  requestRender();
}
// A second finger can touch UI rather than the canvas, so observe the whole page.
document.addEventListener('pointerdown', (event) => {
  if (pointer && tool !== 'rotate' && event.pointerId !== pointer.pointerId) {
    const isCanvas = event.target === renderer.domElement;
    cancelActiveGesture();
    // Do not let the second finger start a new canvas gesture.
    if (isCanvas) event.stopPropagation();
  }
}, true);
window.addEventListener('blur', cancelActiveGesture);
window.addEventListener('pagehide', cancelActiveGesture);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelActiveGesture(); });
function pinchDistance(): number | undefined {
  const points = [...activePointers.values()];
  return points.length === 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : undefined;
}
function commitTap(tool: Tool, hit: HairHit): void {
  if (tool === 'select' && hit) {
    if (selectedStrandIds.has(hit.id)) selectedStrandIds.delete(hit.id);
    else selectedStrandIds.add(hit.id);
    selectedId = hit.id;
    redraw();
    appStatus.textContent = `已選取 ${[...selectedStrandIds].join('、') || '無髮束'}`;
  } else if (tool === 'grow' && hit) {
    const result = editor.growBy(hit.id, 0.05);
    if (result.changed) persistState();
    redraw();
    appStatus.textContent = growthMessage(result);
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
  }
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
  if (tool === 'rotate' && activePointers.size > 1) {
    renderer.domElement.setPointerCapture(event.pointerId);
    lastPinchDistance = pinchDistance();
    return;
  }
  const hit = hitHair(event.clientX, event.clientY);
  const cuts = new Map<string, number>();
  const clippedIds = new Set<string>();
  pointer = { pointerId: event.pointerId, tool, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, hasDragged: false, hit, cuts, clippedIds, curlStartX: event.clientX, combStart: { x: event.clientX, y: event.clientY } };
  renderer.domElement.setPointerCapture(event.pointerId);
  lastPinchDistance = pinchDistance();
  if (tool !== 'rotate') showCursor(hit);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (!pointer || (tool !== 'rotate' && event.pointerId !== pointer.pointerId)) return;
  if (['select', 'grow', 'tuck', 'ponytail', 'halfup', 'pair', 'braid', 'sweep'].includes(tool) && hasExceededDragThreshold(pointer, { x: event.clientX, y: event.clientY })) pointer.hasDragged = true;
  if (tool === 'cut' || tool === 'clip') {
    const hits = collectSweep(pointer, tool, event.clientX, event.clientY);
    const latest = hits.at(-1);
    if (pointer.hasDragged) showCursor(latest);
    if (tool === 'cut' && latest) {
      previewCutS = pointer.cuts.get(latest.id);
      updateOverlay();
    }
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
  if (activePointers.size > 1 && (nextPinchDistance === undefined || lastPinchDistance === undefined)) return;
  if (nextPinchDistance !== undefined && lastPinchDistance !== undefined) {
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
  if (!activePointers.has(event.pointerId)) return;
  if (cancelled && tool === 'rotate') { cancelActiveGesture(); return; }
  activePointers.delete(event.pointerId);
  lastPinchDistance = pinchDistance();
  if (pointer && tool === 'rotate' && pointer.tool === 'rotate' && activePointers.size > 0) {
    // Rebase the surviving finger at its latest position, regardless of which
    // finger ended first, to continue rotating without a jump.
    if (activePointers.size === 1) {
      const [remainingId, position] = activePointers.entries().next().value!;
      pointer.pointerId = remainingId;
      pointer.x = position.x;
      pointer.y = position.y;
    }
    return;
  }
  if (!pointer || event.pointerId !== pointer.pointerId) return;
  const gesture = pointer;
  pointer = undefined;
  cursor.visible = false;
  scissorsCursor.visible = false;
  previewCutS = undefined;
  updateOverlay();
  highlightHair();
  if (cancelled || gesture.tool !== tool) { requestRender(); return; }
  // The final position can arrive only with pointerup (e.g. a fast flick).
  if (tool === 'cut' || tool === 'clip') collectSweep(gesture, tool, event.clientX, event.clientY);
  const rect = renderer.domElement.getBoundingClientRect();
  const releasedInside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (gesture.hit && releasedInside && !gesture.hasDragged && !hasExceededDragThreshold(gesture, { x: event.clientX, y: event.clientY }) && ['select', 'grow', 'tuck', 'ponytail', 'halfup', 'pair', 'braid', 'sweep'].includes(tool)) {
    commitTap(tool, gesture.hit);
    return;
  }
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
    const interval = freeCurlInterval(gesture.hit.s, strand.length, strand.curls);
    if (!interval) {
      appStatus.textContent = '所選位置已有捲曲；暫未支援重疊修改';
      return;
    }
    const result = editor.curlRange(strand.id, { ...interval, radius: 0.025, pitch: 0.08, phase: 0.3, direction });
    if (result.changed) persistState();
    redraw();
    appStatus.textContent = result.changed ? `已捲曲 ${strand.id} 的 ${Math.round(interval.startS * 100)} 至 ${Math.round(interval.endS * 100)} cm` : result.reason ?? '未能建立捲曲';
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
renderer.domElement.addEventListener('lostpointercapture', (event) => finishGesture(event, true));
renderer.domElement.addEventListener('pointerleave', () => { if (!pointer) showCursor(undefined); });
renderer.domElement.addEventListener('pointermove', (event) => { if (!pointer && tool !== 'rotate') showCursor(hitHair(event.clientX, event.clientY)); });

const toolDrawer = document.querySelector<HTMLDialogElement>('#tool-drawer');
document.querySelector<HTMLButtonElement>('#more-tools')?.addEventListener('click', () => {
  if (!toolDrawer) return;
  if (typeof toolDrawer.showModal === 'function') toolDrawer.showModal();
  else toolDrawer.setAttribute('open', '');
});
document.querySelector<HTMLButtonElement>('#close-tools')?.addEventListener('click', () => toolDrawer?.close());
toolDrawer?.addEventListener('click', (event) => {
  if (event.target === toolDrawer) toolDrawer.close();
});

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
  button.addEventListener('click', () => {
    // A tool switch cancels any unfinished canvas gesture.
    cancelActiveGesture();
    tool = button.dataset.tool as Tool;
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((item) => item.classList.toggle('active', item.dataset.tool === tool));
    toolDrawer?.close();
    redraw();
  });
});
const clipperLength = document.querySelector<HTMLInputElement>('#clipper-length');
const clipperLengthValue = document.querySelector<HTMLOutputElement>('#clipper-length-value');
clipperLength?.addEventListener('input', () => {
  if (clipperLengthValue) clipperLengthValue.value = `${clipperLength.value} cm`;
});
document.querySelector<HTMLButtonElement>('#undo')?.addEventListener('click', () => {
  if (!editor.canUndo) return;
  editor.undo();
  persistState();
  redraw();
});
document.querySelector<HTMLButtonElement>('#redo')?.addEventListener('click', () => { if (!editor.canRedo) return; editor.redo(); persistState(); redraw(); });
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
  void (async () => {
    await saveQueue.settled();
    if (hasUnsavedChanges && !window.confirm('目前髮型有未儲存的修改。讀取存檔會取代這些修改，繼續嗎？')) {
      appStatus.textContent = '已取消讀取；保留目前髮型';
      return;
    }
    const revision = saveQueue.revision;
    const restored = await loadPersistedEditor();
    if (saveQueue.revision !== revision) { appStatus.textContent = '讀取期間髮型已改變，保留目前操作'; return; }
    if (!restored?.editor) { if (!storageProtected) appStatus.textContent = '沒有可讀取的有效儲存資料'; return; }
    storageToken = restored.token;
    storageConflict = false;
    hasUnsavedChanges = false;
    if (storageWarning && !storageProtected) storageWarning.hidden = true;
    editor = restored.editor;
    redraw();
    appStatus.textContent = '已讀取本機儲存與操作歷史';
  })();
});
document.querySelector<HTMLButtonElement>('#reset')?.addEventListener('click', () => {
  const changed = editor.resetTo(createDemoHairState());
  selectedStrandIds.clear();
  selectedId = undefined;
  if (changed) persistState();
  redraw();
  appStatus.textContent = changed ? '已重設樣板，可按 Undo 還原' : '樣板已是初始狀態';
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
const initialRevision = saveQueue.revision;
void loadPersistedEditor().then((restored) => {
  if (!restored) return;
  storageToken = restored.token;
  if (!restored.editor || saveQueue.revision !== initialRevision) return;
  editor = restored.editor;
  redraw();
  appStatus.textContent = '已自動讀取本機儲存與操作歷史';
}).finally(finishInitialStorageRead);
