import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

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
let vite, chrome, profile, client;
try {
  vite = spawn('./node_modules/.bin/vite', ['--host', '127.0.0.1', '--port', String(serverPort), '--strictPort'], { stdio: 'ignore', detached: true });
  await waitFor(appUrl);
  profile = await mkdtemp(join(tmpdir(), 'hair-atelier-webgl-startup-'));
  chrome = spawn(process.env.CHROMIUM_BIN ?? 'chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--no-first-run',
    `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-webgl',
    '--window-size=430,932', `--remote-debugging-port=${debugPort}`, 'about:blank',
  ], { stdio: 'ignore', detached: true });
  const targets = await (await waitFor(`${debugUrl}/json/list`)).json();
  const target = targets.find((candidate) => candidate.type === 'page');
  if (!target?.webSocketDebuggerUrl) throw new Error('Chromium did not expose a page target');
  client = new DevToolsClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.command('Runtime.enable');
  await client.command('Page.enable');
  await client.command('Page.navigate', { url: appUrl });
  await waitUntil(client, "!!document.querySelector('#stage canvas') && !document.querySelector('#save').disabled", 'normal startup');
  if (!(await evaluate(client, "document.querySelector('#context-warning').hidden"))) throw new Error('Warning shown during normal startup');
  if (!(await evaluate(client, "document.querySelector('#retry-graphics')?.hidden"))) throw new Error('Retry shown during normal startup');

  // A valid non-default history is seeded in this disposable browser profile.
  await evaluate(client, "document.querySelector('#save').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已儲存到本機瀏覽器')", 'initial save');
  const history = JSON.parse(await evaluate(client, readSaved));
  history.current.strands.find((strand) => strand.id === 'C').length = 0.2;
  const seeded = JSON.stringify(history);
  await evaluate(client, `new Promise((resolve, reject) => {
    const open = indexedDB.open('hair-atelier', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('editor-history', 'readwrite');
      tx.objectStore('editor-history').put(${JSON.stringify(seeded)}, 'current-v4');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  })`);

  for (const mode of ['null', 'throw']) {
    // Exercise the actual Three.js constructor's error paths; leave 2D canvas alone.
    const injected = await client.command('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        if (['webgl2', 'webgl', 'experimental-webgl'].includes(kind)) {
          if (${JSON.stringify(mode)} === 'throw') throw new Error('Simulated WebGL initialization failure');
          return null;
        }
        return original.call(this, kind, ...args);
      };
    })();` });
    await client.command('Page.navigate', { url: appUrl });
    await waitUntil(client, "!!document.querySelector('#context-warning')", 'startup DOM');
    // Give startup JS a chance to handle the constructor failure, but fail promptly
    // on the unfixed app instead of waiting indefinitely for a missing warning.
    let visible = false;
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      visible = await evaluate(client, `(() => {
        const warning = document.querySelector('#context-warning');
        return !!warning && !warning.hidden && warning.getBoundingClientRect().height > 0 && warning.textContent.trim().length > 0;
      })()`);
      if (visible) break;
      await delay(100);
    }
    if (!visible) throw new Error(`Startup WebGL ${mode} produced no visible explanation`);
    const protectedControls = await evaluate(client, `(() => {
      const ids = ['save', 'load', 'undo', 'redo', 'reset'];
      return ids.every((id) => document.getElementById(id)?.disabled)
        && [...document.querySelectorAll('[data-tool]')].every((item) => item.disabled)
        && [...document.querySelectorAll('input, select')].every((item) => item.disabled);
    })()`);
    if (!protectedControls) throw new Error(`Startup WebGL ${mode} left editing controls available`);
    const retryAvailable = await evaluate(client, `(() => {
      const retry = document.querySelector('#retry-graphics');
      return !!retry && !retry.hidden && !retry.disabled && retry.getBoundingClientRect().height >= 44;
    })()`);
    if (!retryAvailable) throw new Error(`Startup WebGL ${mode} did not provide an accessible retry`);
    await evaluate(client, "document.querySelector('#reset').click(); document.querySelector('#save').click()");
    if (await evaluate(client, readSaved) !== seeded) throw new Error(`Startup WebGL ${mode} changed the saved history`);
    await client.command('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
    await evaluate(client, "document.querySelector('#retry-graphics').click()");
    await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已自動讀取本機儲存與操作歷史') && !document.querySelector('#save').disabled", 'normal recovery');
    await evaluate(client, "document.querySelector('[data-tool=rotate]').click()");
    if (!(await evaluate(client, "document.querySelector('#context-warning').hidden && document.querySelector('#retry-graphics').hidden && document.querySelector('#status').textContent.includes('C：20 cm')"))) throw new Error(`Startup WebGL ${mode} did not restore the saved hairstyle`);
    if (await evaluate(client, readSaved) !== seeded) throw new Error(`Recovery after startup WebGL ${mode} changed history`);
  }
  console.log('WebGL startup smoke passed: null and exception, visible warning, locked editing, preserved history and retry');
} finally {
  client?.close();
  await stop(chrome);
  await stop(vite);
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
