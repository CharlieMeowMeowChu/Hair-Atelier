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
  profile = await mkdtemp(join(tmpdir(), 'hair-offline-registration-'));
  chrome = spawn(process.env.CHROMIUM_BIN ?? 'chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--no-first-run',
    `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-webgl',
    `--remote-debugging-port=${debugPort}`, 'about:blank',
  ], { stdio: 'ignore', detached: true });
  let target;
  const deadline = Date.now() + 15_000;
  while (!target && Date.now() < deadline) {
    target = (await (await waitFor(`${debugUrl}/json/list`)).json()).find((candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl);
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
  await waitUntil(client, "!!document.querySelector('#stage canvas') && !!navigator.serviceWorker.controller && !document.querySelector('#save').disabled && document.querySelector('#offline-status')?.dataset.state === 'ready'", 'initial controlled ready app');
  await evaluate(client, "document.querySelector('#save').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已儲存到本機瀏覽器')", 'initial save');
  const baseline = await evaluate(client, readSaved);
  if (!baseline) throw new Error('Could not save initial history');

  async function addPatch(source) {
    return (await client.command('Page.addScriptToEvaluateOnNewDocument', { source })).identifier;
  }
  async function loadPatched(source, label) {
    const id = await addPatch(source);
    const navigation = await client.command('Page.navigate', { url: appUrl });
    if (navigation.errorText) throw new Error(`${label}: ${navigation.errorText}`);
    await waitUntil(client, "!!navigator.serviceWorker.controller && !!document.querySelector('#stage canvas') && !document.querySelector('#save').disabled && window.__simulatedRegisterFailure", `${label} registration failure`);
    await waitUntil(client, "document.querySelector('#offline-status')?.dataset.state === 'ready'", `${label} verified readiness`);
    await delay(200);
    if (!(await evaluate(client, "document.querySelector('#offline-status')?.dataset.state === 'ready'"))) throw new Error(`${label} lost readiness after failed registration`);
    if (await evaluate(client, readSaved) !== baseline) throw new Error(`${label} changed saved history`);
    await client.command('Page.removeScriptToEvaluateOnNewDocument', { identifier: id });
  }
  const asyncFailure = `ServiceWorkerContainer.prototype.register = function () { return new Promise((resolve, reject) => setTimeout(() => { window.__simulatedRegisterFailure = true; reject(new Error('simulated delayed registration failure')); }, 350)); };`;
  const syncFailure = `ServiceWorkerContainer.prototype.register = function () { window.__simulatedRegisterFailure = true; throw new Error('simulated synchronous registration failure'); };`;
  await loadPatched(asyncFailure, 'delayed rejection');
  await loadPatched(syncFailure, 'synchronous throw');

  // A worker that cannot confirm completeness must time out to unavailable.
  const noReply = await addPatch(`${syncFailure} ServiceWorker.prototype.postMessage = function () {};`);
  await client.command('Page.navigate', { url: appUrl });
  await waitUntil(client, "window.__simulatedRegisterFailure && !!navigator.serviceWorker.controller && document.querySelector('#offline-status')?.dataset.state === 'unavailable'", 'unresponsive controller is unavailable');
  await client.command('Page.removeScriptToEvaluateOnNewDocument', { identifier: noReply });

  // Disconnect the actual server, not merely the page's DevTools network.
  await stop(preview); preview = undefined;
  await client.command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await loadPatched(asyncFailure, 'offline delayed rejection');
  await evaluate(client, `(async () => { for (const name of await caches.keys()) if (name.startsWith('hair-atelier-shell-')) await caches.delete(name); window.dispatchEvent(new Event('offline')); })()`);
  await waitUntil(client, "document.querySelector('#offline-status')?.dataset.state === 'unavailable'", 'deleted cache is unavailable');
  if (await evaluate(client, readSaved) !== baseline) throw new Error('Cache deletion affected saved history');
  console.log('Offline registration smoke passed: existing controller survives delayed and synchronous registration failures; nonresponse and deleted cache unavailable; offline history preserved');
} finally {
  client?.close();
  await stop(chrome);
  await stop(preview);
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
