import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Run against the production build; the Vite development server serves a
// different dependency graph and cannot prove that the installed app works.
if (!existsSync(new URL('../dist/index.html', import.meta.url))) {
  throw new Error('Production build missing; run npm run build first');
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
async function waitFor(url) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return response; } catch { /* still starting */ }
    await delay(100);
  }
  throw new Error('Local browser or production server did not start');
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  await Promise.race([once(child, 'exit'), delay(5_000)]);
}
class DevToolsClient {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('Cannot connect to Chromium')), { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    });
  }
  command(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket?.close(); }
}
async function evaluate(client, expression) {
  const result = await client.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function waitUntil(client, expression, label) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { if (await evaluate(client, expression)) return; } catch { /* navigation may replace the context */ }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
const readSaved = `new Promise((resolve, reject) => {
  const open = indexedDB.open('hair-atelier', 1);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result, read = db.transaction('editor-history', 'readonly').objectStore('editor-history').get('current-v4');
    read.onsuccess = () => { db.close(); resolve(read.result); };
    read.onerror = () => reject(read.error);
  };
})`;

const serverPort = await freePort();
let debugPort = await freePort();
while (debugPort === serverPort) debugPort = await freePort();
const appUrl = `http://127.0.0.1:${serverPort}/`;
const debugUrl = `http://127.0.0.1:${debugPort}`;
let preview, chrome, profile, client;
try {
  preview = spawn('./node_modules/.bin/vite', ['preview', '--host', '127.0.0.1', '--port', String(serverPort), '--strictPort'], { stdio: 'ignore', detached: true });
  await waitFor(appUrl);
  profile = await mkdtemp(join(tmpdir(), 'hair-atelier-first-visit-'));
  chrome = spawn(process.env.CHROMIUM_BIN ?? 'chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--no-first-run',
    `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-webgl',
    `--remote-debugging-port=${debugPort}`, 'about:blank',
  ], { stdio: 'ignore', detached: true });
  let target;
  const targetDeadline = Date.now() + 15_000;
  while (Date.now() < targetDeadline && !target) {
    const targets = await (await waitFor(`${debugUrl}/json/list`)).json();
    target = targets.find((candidate) => candidate.type === 'page');
    if (!target) await delay(100);
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('Chromium did not expose a page target');
  client = new DevToolsClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.command('Runtime.enable');
  await client.command('Page.enable');
  await client.command('Network.enable');
  await client.command('Network.setCacheDisabled', { cacheDisabled: true });
  await client.command('Page.navigate', { url: appUrl });
  await waitUntil(client, "!!document.querySelector('#stage canvas') && !!navigator.serviceWorker.controller && !!document.querySelector('#save') && !document.querySelector('#save').disabled", 'first visit and service worker control');

  // Save once through the UI, then seed an identifiable valid hairstyle in
  // the isolated test profile; the original and offline reads must match.
  await evaluate(client, "document.querySelector('#save').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已儲存到本機瀏覽器')", 'initial save');
  const initialSaved = await evaluate(client, readSaved);
  const savedHistory = JSON.parse(initialSaved);
  const strand = savedHistory.current.strands.find((item) => item.id === 'C');
  if (!strand || strand.length <= 0.2) throw new Error('Cannot prepare an identifiable saved hairstyle');
  strand.length = 0.2;
  const savedText = JSON.stringify(savedHistory);
  await evaluate(client, `new Promise((resolve, reject) => {
    const open = indexedDB.open('hair-atelier', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('editor-history', 'readwrite');
      tx.objectStore('editor-history').put(${JSON.stringify(savedText)}, 'current-v4');
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => reject(tx.error);
    };
  })`);
  if (await evaluate(client, readSaved) !== savedText) throw new Error('Saved hairstyle was not written before offline test');

  // Stop the server: CDP offline emulation alone may not affect fetches made
  // by the service worker. Disable HTTP cache to isolate the app-shell cache.
  await stop(preview);
  preview = undefined;
  await client.command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const navigation = await client.command('Page.navigate', { url: appUrl });
  if (navigation.errorText) throw new Error(`First offline relaunch failed: ${navigation.errorText}`);
  await waitUntil(client, "!!document.querySelector('#stage canvas') && !!document.querySelector('#save') && !document.querySelector('#save').disabled && document.querySelector('#status')?.textContent?.includes('已自動讀取本機儲存與操作歷史')", 'offline canvas and saved history');
  await evaluate(client, "document.querySelector('[data-tool=rotate]').click()");
  const renderedSavedLength = await evaluate(client, "document.querySelector('#status').textContent.includes('C：20 cm')");
  const afterSaved = await evaluate(client, readSaved);
  if (!renderedSavedLength || afterSaved !== savedText) throw new Error('Offline relaunch did not restore the saved hairstyle');

  // Actual offline edits and their undo history must survive another offline
  // navigation; restoring the initial data alone is not sufficient.
  await evaluate(client, "document.querySelector('#reset').click(); document.querySelector('#save').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已儲存到本機瀏覽器')", 'offline edit save');
  const offlineEdit = await evaluate(client, readSaved);
  if (JSON.parse(offlineEdit).current.strands.find((item) => item.id === 'C')?.length !== 0.4) throw new Error('Offline edit was not saved');
  const secondNavigation = await client.command('Page.navigate', { url: appUrl });
  if (secondNavigation.errorText) throw new Error(`Second offline relaunch failed: ${secondNavigation.errorText}`);
  await waitUntil(client, "!!document.querySelector('#stage canvas') && !document.querySelector('#save').disabled && document.querySelector('#status')?.textContent?.includes('已自動讀取本機儲存與操作歷史')", 'offline edit reload');
  if (await evaluate(client, readSaved) !== offlineEdit) throw new Error('Offline edit changed during reload');
  await evaluate(client, "document.querySelector('#undo').click()");
  if (!(await evaluate(client, "document.querySelector('#status').textContent.includes('C：20 cm')"))) throw new Error('Offline undo did not restore the previous hairstyle');
  await evaluate(client, "document.querySelector('#redo').click(); document.querySelector('#save').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已儲存到本機瀏覽器')", 'offline redo save');
  const redone = JSON.parse(await evaluate(client, readSaved));
  if (redone.current.strands.find((item) => item.id === 'C')?.length !== 0.4) throw new Error('Offline redo was not saved');
  console.log('First-visit offline smoke passed: production canvas, saved hairstyle, offline edit and undo/redo restored');
} finally {
  client?.close();
  await stop(chrome);
  await stop(preview);
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
