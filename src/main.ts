import * as THREE from 'three';
import './style.css';
import { createDemoHairState, HairEditor, sampleStrand } from './hair-core';

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
};

let editor = new HairEditor(createDemoHairState());
const scene = new THREE.Scene();
scene.background = new THREE.Color('#211c29');
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10);
camera.position.set(0, 0.05, 1.35);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
stage.append(renderer.domElement);
let renderPending = false;
function requestRender(): void {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    renderer.render(scene, camera);
  });
}

scene.add(new THREE.HemisphereLight('#f4dffc', '#17141f', 2.2));
const head = new THREE.Mesh(
  new THREE.SphereGeometry(0.22, 32, 24),
  new THREE.MeshStandardMaterial({ color: '#9a8b89', roughness: 0.72 }),
);
head.scale.set(1, 1.12, 0.92);
scene.add(head);

const hair = new THREE.Group();
scene.add(hair);
const colors: Record<string, string> = { A: '#ff9c79', B: '#ffd66b', C: '#85d8ff', D: '#cb9dff' };
const hairLines = new Map<string, { line: THREE.Line; signature: string }>();
type Tool = 'rotate' | 'cut' | 'curl' | 'grow';
type HairHit = { id: string; s: number; point: THREE.Vector3 };
let tool: Tool = 'rotate';
let selectedId: string | undefined;
let previewCutS: number | undefined;
let meshUpdateMilliseconds = 0;
let rebuiltStrandCount = 0;
const raycaster = new THREE.Raycaster();
raycaster.params.Line = { threshold: 0.014 };
const cursor = new THREE.Mesh(
  new THREE.RingGeometry(0.012, 0.016, 20),
  new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }),
);
cursor.visible = false;
scene.add(cursor);

function redraw(): void {
  const startedAt = performance.now();
  rebuiltStrandCount = 0;
  const state = editor.exportState();
  const activeIds = new Set(state.strands.map((strand) => strand.id));
  for (const [id, record] of hairLines) {
    if (activeIds.has(id)) continue;
    hair.remove(record.line);
    record.line.geometry.dispose();
    (Array.isArray(record.line.material) ? record.line.material : [record.line.material]).forEach((material) => material.dispose());
    hairLines.delete(id);
  }
  for (const strand of state.strands) {
    const signature = JSON.stringify(strand);
    const existing = hairLines.get(strand.id);
    if (existing?.signature === signature) continue;
    const sampled = sampleStrand(strand);
    const points = sampled.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    if (existing) {
      existing.line.geometry.dispose();
      existing.line.geometry = geometry;
      existing.line.userData = { strandId: strand.id, strandLength: strand.length, sampleCount: points.length };
      existing.signature = signature;
    } else {
      const material = new THREE.LineBasicMaterial({ color: colors[strand.id], linewidth: 2 });
      const line = new THREE.Line(geometry, material);
      line.userData = { strandId: strand.id, strandLength: strand.length, sampleCount: points.length };
      hair.add(line);
      hairLines.set(strand.id, { line, signature });
    }
    const line = hairLines.get(strand.id)!.line;
    (line.material as THREE.LineBasicMaterial).color.set(strand.id === selectedId ? '#ffffff' : colors[strand.id]);
    rebuiltStrandCount += 1;
  }
  const c = state.strands.find((strand) => strand.id === 'C');
  meshUpdateMilliseconds = performance.now() - startedAt;
  appStatus.textContent = c ? `${toolLabel(tool)} ｜ C：${Math.round(c.length * 100)} cm ｜ Undo ${editor.canUndo ? '可用' : '未有操作'}` : '髮束資料錯誤';
  updateOverlay();
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
  return ({ rotate: '旋轉檢視', cut: '剪刀：拖過髮束後放手', curl: '捲髮器：按住後向側拖', grow: '增髮：點按髮束' })[value];
}

function hitHair(clientX: number, clientY: number): HairHit | undefined {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
  scene.updateMatrixWorld(true);
  const headDistance = raycaster.intersectObject(head, false)[0]?.distance ?? Number.POSITIVE_INFINITY;
  const intersection = raycaster.intersectObjects(hair.children, false)
    .find((candidate) => candidate.distance <= headDistance + 0.002);
  if (!intersection) return undefined;
  const { strandId, strandLength, sampleCount } = intersection.object.userData as {
    strandId: string; strandLength: number; sampleCount: number;
  };
  const segmentIndex = Math.max(0, Math.min(intersection.index ?? 0, sampleCount - 1));
  return { id: strandId, s: strandLength * segmentIndex / (sampleCount - 1), point: intersection.point.clone() };
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
  for (const child of hair.children) {
    const material = (child as THREE.Line).material as THREE.LineBasicMaterial;
    const id = child.userData.strandId as string;
    material.color.set(id === strandId ? '#ffffff' : colors[id]);
  }
  requestRender();
}

function showCursor(hit: HairHit | undefined): void {
  selectedId = hit?.id;
  previewCutS = tool === 'cut' ? hit?.s : undefined;
  updateOverlay();
  if (!hit) { cursor.visible = false; highlightHair(); return; }
  cursor.position.copy(hit.point);
  cursor.quaternion.copy(camera.quaternion);
  cursor.visible = true;
  highlightHair(hit.id);
  requestRender();
}

let rotationX = 0;
let rotationY = 0;
let pointer: { x: number; y: number; hit?: HairHit; cuts: Map<string, number>; curlStartX?: number } | undefined;
renderer.domElement.addEventListener('pointerdown', (event) => {
  const hit = hitHair(event.clientX, event.clientY);
  const cuts = new Map<string, number>();
  if (hit) cuts.set(hit.id, hit.s);
  pointer = { x: event.clientX, y: event.clientY, hit, cuts, curlStartX: event.clientX };
  renderer.domElement.setPointerCapture(event.pointerId);
  if (tool === 'grow' && hit) {
    editor.growBy(hit.id, 0.05);
    redraw();
    appStatus.textContent = `已對 ${hit.id} 增長 5 cm`;
  } else if (tool !== 'rotate') showCursor(hit);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!pointer) return;
  if (tool === 'cut') {
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
  if (tool === 'curl') { showCursor(hitHair(event.clientX, event.clientY)); return; }
  if (tool === 'grow') { showCursor(hitHair(event.clientX, event.clientY)); return; }
  rotationY += (event.clientX - pointer.x) * 0.01;
  rotationX = THREE.MathUtils.clamp(rotationX + (event.clientY - pointer.y) * 0.008, -0.45, 0.45);
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  hair.rotation.set(rotationX, rotationY, 0);
  head.rotation.set(rotationX, rotationY, 0);
  requestRender();
});
function finishGesture(event: PointerEvent, cancelled = false): void {
  if (!pointer) return;
  const gesture = pointer;
  pointer = undefined;
  cursor.visible = false;
  previewCutS = undefined;
  updateOverlay();
  highlightHair();
  if (cancelled) return;
  if (tool === 'cut' && gesture.cuts.size > 0) {
    const results = editor.cutManyAt([...gesture.cuts].map(([strandId, arcLengthMeters]) => ({ strandId, arcLengthMeters })));
    redraw();
    appStatus.textContent = results.length > 0 ? `一次剪短 ${results.map((result) => result.strandId).join('、')} 共 ${results.length} 束` : '剪刀未切到可移除的髮尾';
  }
  if (tool === 'curl' && gesture.hit) {
    const strand = editor.exportState().strands.find((item) => item.id === gesture.hit?.id);
    if (!strand) return;
    const direction = event.clientX - (gesture.curlStartX ?? event.clientX) >= 0 ? 1 : -1;
    const startS = Math.max(0.01, gesture.hit.s - 0.04);
    const result = editor.curlRange(strand.id, { startS, endS: strand.length, radius: 0.025, pitch: 0.08, phase: 0.3, direction });
    redraw();
    appStatus.textContent = result.changed ? `已捲曲 ${strand.id} 的 ${Math.round(startS * 100)} cm 至髮尾` : '未能建立捲曲';
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
document.querySelector<HTMLButtonElement>('#undo')?.addEventListener('click', () => {
  editor.undo();
  redraw();
});
document.querySelector<HTMLButtonElement>('#redo')?.addEventListener('click', () => { editor.redo(); redraw(); });
document.querySelector<HTMLButtonElement>('#reset')?.addEventListener('click', () => { editor = new HairEditor(createDemoHairState()); redraw(); });

new ResizeObserver(() => {
  const { clientWidth, clientHeight } = stage;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight);
  requestRender();
}).observe(stage);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
redraw();
