import * as THREE from 'three';
import './style.css';
import { createDemoHairState, HairEditor, sampleStrand } from './hair-core';

const stage = document.querySelector<HTMLElement>('#stage');
const status = document.querySelector<HTMLElement>('#status');
if (!stage || !status) throw new Error('Required UI is missing');
const appStatus: HTMLElement = status;

const editor = new HairEditor(createDemoHairState());
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

function redraw(): void {
  hair.clear();
  for (const strand of editor.exportState().strands) {
    const points = sampleStrand(strand).map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: colors[strand.id], linewidth: 2 });
    hair.add(new THREE.Line(geometry, material));
  }
  const c = editor.exportState().strands.find((strand) => strand.id === 'C');
  appStatus.textContent = c ? `C：${Math.round(c.length * 100)} cm ｜ Undo ${editor.canUndo ? '可用' : '未有操作'}` : '髮束資料錯誤';
}

let rotationX = 0;
let rotationY = 0;
let pointer: { x: number; y: number } | undefined;
renderer.domElement.addEventListener('pointerdown', (event) => {
  pointer = { x: event.clientX, y: event.clientY };
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!pointer) return;
  rotationY += (event.clientX - pointer.x) * 0.01;
  rotationX = THREE.MathUtils.clamp(rotationX + (event.clientY - pointer.y) * 0.008, -0.45, 0.45);
  pointer = { x: event.clientX, y: event.clientY };
  hair.rotation.set(rotationX, rotationY, 0);
  head.rotation.set(rotationX, rotationY, 0);
});
renderer.domElement.addEventListener('pointerup', () => { pointer = undefined; });
renderer.domElement.addEventListener('pointercancel', () => { pointer = undefined; });

document.querySelector<HTMLButtonElement>('#curl')?.addEventListener('click', () => {
  editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0 });
  redraw();
});
document.querySelector<HTMLButtonElement>('#cut')?.addEventListener('click', () => {
  editor.cutAt('C', 0.2);
  redraw();
});
document.querySelector<HTMLButtonElement>('#grow')?.addEventListener('click', () => {
  editor.growBy('C', 0.1);
  redraw();
});
document.querySelector<HTMLButtonElement>('#undo')?.addEventListener('click', () => {
  editor.undo();
  redraw();
});

new ResizeObserver(() => {
  const { clientWidth, clientHeight } = stage;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight);
}).observe(stage);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
redraw();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
