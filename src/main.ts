import * as THREE from 'three';
import './style.css';
import { createDemoHairState, HairEditor, sampleStrand } from './hair-core';

const stage = document.querySelector<HTMLElement>('#stage');
const status = document.querySelector<HTMLElement>('#status');
if (!stage || !status) throw new Error('Required UI is missing');
const appStatus: HTMLElement = status;

let editor = new HairEditor(createDemoHairState());
const scene = new THREE.Scene();
scene.background = new THREE.Color('#211c29');
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10);
camera.position.set(0, 0.05, 1.35);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
stage.append(renderer.domElement);

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
type Tool = 'rotate' | 'cut' | 'curl' | 'grow';
type HairHit = { id: string; s: number; point: THREE.Vector3; distance: number };
let tool: Tool = 'rotate';
let renderedSamples: Array<HairHit> = [];
const cursor = new THREE.Mesh(
  new THREE.RingGeometry(0.012, 0.016, 20),
  new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }),
);
cursor.visible = false;
scene.add(cursor);

function redraw(): void {
  hair.clear();
  renderedSamples = [];
  for (const strand of editor.exportState().strands) {
    const sampled = sampleStrand(strand);
    const points = sampled.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    points.forEach((point, index) => renderedSamples.push({
      id: strand.id,
      s: (strand.length * index) / (points.length - 1),
      point,
      distance: 0,
    }));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: colors[strand.id], linewidth: 2 });
    hair.add(new THREE.Line(geometry, material));
  }
  const c = editor.exportState().strands.find((strand) => strand.id === 'C');
  appStatus.textContent = c ? `${toolLabel(tool)} ｜ C：${Math.round(c.length * 100)} cm ｜ Undo ${editor.canUndo ? '可用' : '未有操作'}` : '髮束資料錯誤';
}

function toolLabel(value: Tool): string {
  return ({ rotate: '旋轉檢視', cut: '剪刀：拖過髮束後放手', curl: '捲髮器：按住後向側拖', grow: '增髮：點按髮束' })[value];
}

function hitHair(clientX: number, clientY: number): HairHit | undefined {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((clientY - rect.top) / rect.height) * 2 + 1;
  const threshold = 0.075;
  let result: HairHit | undefined;
  for (const sample of renderedSamples) {
    const worldPoint = sample.point.clone().applyMatrix4(hair.matrixWorld);
    const projected = worldPoint.clone().project(camera);
    const distance = Math.hypot(projected.x - x, projected.y - y);
    if (distance > threshold) continue;
    const candidate = { ...sample, point: worldPoint, distance };
    if (!result || candidate.distance < result.distance - 0.006 ||
      (Math.abs(candidate.distance - result.distance) <= 0.006 && camera.position.distanceTo(candidate.point) < camera.position.distanceTo(result.point))) result = candidate;
  }
  return result;
}

function showCursor(hit: HairHit | undefined): void {
  if (!hit) { cursor.visible = false; return; }
  cursor.position.copy(hit.point);
  cursor.quaternion.copy(camera.quaternion);
  cursor.visible = true;
}

let rotationX = 0;
let rotationY = 0;
let pointer: { x: number; y: number; hit?: HairHit; cutS?: number; curlStartX?: number } | undefined;
renderer.domElement.addEventListener('pointerdown', (event) => {
  const hit = hitHair(event.clientX, event.clientY);
  pointer = { x: event.clientX, y: event.clientY, hit, cutS: hit?.s, curlStartX: event.clientX };
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
    const hit = hitHair(event.clientX, event.clientY);
    if (hit && pointer.hit && hit.id === pointer.hit.id) pointer.cutS = Math.min(pointer.cutS ?? hit.s, hit.s);
    showCursor(hit);
    return;
  }
  if (tool === 'curl') { showCursor(hitHair(event.clientX, event.clientY)); return; }
  if (tool === 'grow') { showCursor(hitHair(event.clientX, event.clientY)); return; }
  rotationY += (event.clientX - pointer.x) * 0.01;
  rotationX = THREE.MathUtils.clamp(rotationX + (event.clientY - pointer.y) * 0.008, -0.45, 0.45);
  pointer = { x: event.clientX, y: event.clientY };
  hair.rotation.set(rotationX, rotationY, 0);
  head.rotation.set(rotationX, rotationY, 0);
});
function finishGesture(event: PointerEvent, cancelled = false): void {
  if (!pointer) return;
  const gesture = pointer;
  pointer = undefined;
  cursor.visible = false;
  if (cancelled || !gesture.hit) return;
  if (tool === 'cut' && gesture.cutS !== undefined) {
    const result = editor.cutAt(gesture.hit.id, gesture.cutS);
    redraw();
    appStatus.textContent = result.changed ? `已剪短 ${gesture.hit.id} 至 ${Math.round(result.newLength! * 100)} cm` : '剪刀未切到可移除的髮尾';
  }
  if (tool === 'curl') {
    const strand = editor.exportState().strands.find((item) => item.id === gesture.hit?.id);
    if (!strand) return;
    const direction = event.clientX - (gesture.curlStartX ?? event.clientX) >= 0 ? 1 : -1;
    const startS = Math.max(0.01, gesture.hit.s - 0.04);
    const result = editor.curlRange(strand.id, { startS, endS: strand.length, radius: 0.025, pitch: 0.08, phase: direction * 0.3 });
    redraw();
    appStatus.textContent = result.changed ? `已捲曲 ${strand.id} 的 ${Math.round(startS * 100)} cm 至髮尾` : '未能建立捲曲';
  }
}
renderer.domElement.addEventListener('pointerup', (event) => finishGesture(event));
renderer.domElement.addEventListener('pointercancel', (event) => finishGesture(event, true));

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
}).observe(stage);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
redraw();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
