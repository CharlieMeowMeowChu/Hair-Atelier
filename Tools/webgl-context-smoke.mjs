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
  profile = await mkdtemp(join(tmpdir(), 'hair-atelier-context-'));
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
  await waitUntil(client, "!!document.querySelector('#stage canvas') && !!document.querySelector('#save') && !document.querySelector('#save').disabled", 'canvas and storage initialization');

  // Prepare a non-default valid hairstyle with history in an isolated profile.
  await evaluate(client, "document.querySelector('#save').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已儲存到本機瀏覽器')", 'initial save');
  const saved = JSON.parse(await evaluate(client, readSaved));
  saved.current.strands.find((strand) => strand.id === 'C').length = 0.2;
  const seeded = JSON.stringify(saved);
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
  await client.command('Page.navigate', { url: appUrl });
  await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已自動讀取本機儲存與操作歷史')", 'saved hairstyle load');
  await evaluate(client, "document.querySelector('[data-tool=select]').click()");
  const bounds = await evaluate(client, `(() => { const r = document.querySelector('#stage canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  let hairPoint;
  for (let y = bounds.top + 20; y < bounds.top + bounds.height - 50 && !hairPoint; y += 15) {
    for (let x = bounds.left + 20; x < bounds.left + bounds.width - 20; x += 15) {
      await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      if (await evaluate(client, "document.querySelector('#status').textContent.includes('已選取')")) { hairPoint = { x, y }; break; }
    }
  }
  if (!hairPoint) throw new Error('Could not locate a visible hair strand');
  await evaluate(client, "document.querySelector('[data-tool=grow]').click()");
  await delay(200);
  const clip = { x: bounds.left + bounds.width * 0.25, y: bounds.top + bounds.height * 0.25, width: bounds.width * 0.5, height: bounds.height * 0.4, scale: 1 };
  const beforeImage = (await client.command('Page.captureScreenshot', { format: 'png', clip })).data;
  const available = await evaluate(client, `(() => {
    const canvas = document.querySelector('#stage canvas');
    const gl = canvas.getContext('webgl2');
    globalThis.__contextTestGl = gl;
    globalThis.__contextTestExtension = gl?.getExtension('WEBGL_lose_context');
    return !!globalThis.__contextTestExtension;
  })()`);
  if (!available) throw new Error('WEBGL_lose_context extension unavailable in Chromium');

  // A real context loss occurs while an editing tap is held down.
  await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...hairPoint, button: 'left', clickCount: 1 });
  await evaluate(client, 'globalThis.__contextTestExtension.loseContext()');
  await waitUntil(client, "globalThis.__contextTestGl.isContextLost() && !!document.querySelector('#context-warning') && !document.querySelector('#context-warning').hidden", 'WebGL context loss warning');
  const interruptedProtected = await evaluate(client, `(() => {
    const warning = document.querySelector('#context-warning');
    return !!warning && !warning.hidden && warning.textContent.trim().length > 0
      && [...document.querySelectorAll('button, input, select')].filter((item) => item.id !== 'save').every((item) => item.disabled);
  })()`);
  await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...hairPoint, button: 'left', clickCount: 1 });
  // Saving an already-completed hairstyle remains available during context loss.
  if (!(await evaluate(client, "!document.querySelector('#save').disabled"))) throw new Error('Save was disabled while graphics were lost');
  await evaluate(client, "document.querySelector('#save').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已儲存到本機瀏覽器')", 'save during context loss');
  if (await evaluate(client, readSaved) !== seeded) throw new Error('Saving during context loss changed hairstyle or history');
  // In addition to disabled controls, a new canvas gesture started while lost
  // must not turn into a committed edit when released after recovery.
  await evaluate(client, "document.querySelector('#reset').click(); document.querySelector('#undo').click()");
  await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...hairPoint, button: 'left', clickCount: 1 });
  await evaluate(client, 'globalThis.__contextTestExtension.restoreContext()');
  await waitUntil(client, "!globalThis.__contextTestGl.isContextLost() && !!document.querySelector('#context-warning') && document.querySelector('#context-warning').hidden && !document.querySelector('#reset').disabled", 'context restored and controls re-enabled');
  await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...hairPoint, button: 'left', clickCount: 1 });
  await delay(200);
  const afterImage = (await client.command('Page.captureScreenshot', { format: 'png', clip })).data;
  await evaluate(client, "document.querySelector('#save').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已儲存到本機瀏覽器')", 'save after recovery');
  const afterRecovery = await evaluate(client, readSaved);
  if (!interruptedProtected) throw new Error('Context loss did not show its warning and lock editing controls');
  if (afterRecovery !== seeded) throw new Error('Context interruption changed the saved hairstyle or history');
  if (afterImage !== beforeImage) throw new Error('Recovered canvas does not match the view before context loss');

  // Confirm that a deliberate edit and undo work after the redraw.
  await evaluate(client, "document.querySelector('#reset').click(); document.querySelector('#save').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已儲存到本機瀏覽器')", 'save after deliberate edit');
  const edited = JSON.parse(await evaluate(client, readSaved));
  if (edited.current.strands.find((strand) => strand.id === 'C')?.length !== 0.4) throw new Error('Editing was not restored');
  await evaluate(client, "document.querySelector('#undo').click(); document.querySelector('#save').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已儲存到本機瀏覽器')", 'save after undo');
  const undone = JSON.parse(await evaluate(client, readSaved));
  if (undone.current.strands.find((strand) => strand.id === 'C')?.length !== 0.2) throw new Error('Undo was not restored');
  // Hold the initial IndexedDB read open while context loss occurs; finishing
  // the read must not unlock editing before graphics recovery.
  const delayedOpen = await client.command('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
      const request = original.apply(this, args);
      return new Proxy(request, {
        get(target, key) { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; },
        set(target, key, value) {
          if (key === 'onsuccess' && typeof value === 'function') {
            target.onsuccess = (event) => setTimeout(() => value.call(target, event), 3000);
            return true;
          }
          return Reflect.set(target, key, value, target);
        },
      });
    };
    globalThis.__restoreOpen = () => { IDBFactory.prototype.open = original; };
  })();` });
  await client.command('Page.navigate', { url: appUrl });
  await waitUntil(client, "!!document.querySelector('#stage canvas') && document.querySelector('#save').disabled", 'pending initial storage read');
  const startupExtension = await evaluate(client, `(() => {
    globalThis.__startupGl = document.querySelector('#stage canvas').getContext('webgl2');
    globalThis.__startupExtension = globalThis.__startupGl?.getExtension('WEBGL_lose_context');
    globalThis.__startupExtension?.loseContext();
    return !!globalThis.__startupExtension;
  })()`);
  if (!startupExtension) throw new Error('WEBGL_lose_context unavailable during startup');
  await waitUntil(client, 'globalThis.__startupGl.isContextLost()', 'startup WebGL context loss');
  await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已自動讀取本機儲存與操作歷史')", 'delayed storage read');
  const startupProtected = await evaluate(client, `!!document.querySelector('#context-warning') && !document.querySelector('#context-warning').hidden
    && !document.querySelector('#save').disabled && document.querySelector('#reset').disabled && document.querySelector('[data-tool=grow]').disabled`);
  if (!startupProtected) throw new Error('Completing startup storage read unlocked editing while graphics remained lost');
  await evaluate(client, 'globalThis.__startupExtension.restoreContext()');
  await waitUntil(client, "!globalThis.__startupGl.isContextLost() && document.querySelector('#context-warning').hidden && !document.querySelector('#reset').disabled", 'startup context restored');
  await evaluate(client, 'globalThis.__restoreOpen()');
  await client.command('Page.removeScriptToEvaluateOnNewDocument', { identifier: delayedOpen.identifier });
  if (await evaluate(client, readSaved) !== JSON.stringify(undone)) throw new Error('Startup context loss modified the saved history');
  // A manual read may have started before the context loss and finish only
  // after restoration. It must not replace the hairstyle seen by the user.
  await client.command('Page.navigate', { url: appUrl });
  await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已自動讀取本機儲存與操作歷史') && !document.querySelector('#load').disabled", 'initial state before delayed manual read');
  const otherHistory = structuredClone(undone);
  otherHistory.current.strands.find((strand) => strand.id === 'C').length = 0.3;
  const otherSaved = JSON.stringify(otherHistory);
  await evaluate(client, `new Promise((resolve, reject) => {
    const open = indexedDB.open('hair-atelier', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('editor-history', 'readwrite');
      tx.objectStore('editor-history').put(${JSON.stringify(otherSaved)}, 'current-v4');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  })`);
  await evaluate(client, `(() => {
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
      IDBFactory.prototype.open = original;
      const request = original.apply(this, args);
      return new Proxy(request, {
        get(target, key) { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; },
        set(target, key, value) {
          if (key === 'onsuccess' && typeof value === 'function') {
            target.onsuccess = (event) => { globalThis.__releaseManualRead = () => value.call(target, event); };
            return true;
          }
          return Reflect.set(target, key, value, target);
        },
      });
    };
    document.querySelector('#load').click();
  })()`);
  await waitUntil(client, "typeof globalThis.__releaseManualRead === 'function'", 'delayed manual read');
  const manualExtension = await evaluate(client, `(() => {
    globalThis.__manualGl = document.querySelector('#stage canvas').getContext('webgl2');
    globalThis.__manualExtension = globalThis.__manualGl?.getExtension('WEBGL_lose_context');
    globalThis.__manualExtension?.loseContext();
    return !!globalThis.__manualExtension;
  })()`);
  if (!manualExtension) throw new Error('WEBGL_lose_context unavailable during manual read');
  await waitUntil(client, "globalThis.__manualGl.isContextLost() && !document.querySelector('#context-warning').hidden", 'manual read context loss');
  await evaluate(client, 'globalThis.__manualExtension.restoreContext()');
  await waitUntil(client, "!globalThis.__manualGl.isContextLost() && document.querySelector('#context-warning').hidden && !document.querySelector('#reset').disabled", 'manual read context restored');
  await evaluate(client, 'globalThis.__releaseManualRead()');
  await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('畫面中斷，已取消讀取')", 'stale manual read rejected');
  await evaluate(client, "document.querySelector('[data-tool=rotate]').click()");
  if (!(await evaluate(client, "document.querySelector('#status').textContent.includes('C：20 cm')"))) throw new Error('Delayed manual read replaced the visible hairstyle');
  if (await evaluate(client, readSaved) !== otherSaved) throw new Error('Delayed manual read modified the saved history');
  console.log('WebGL context smoke passed: real loss, save while lost, locked edits, cancelled gestures, restored pixels/history, edit/undo and startup/manual read races');
} finally {
  client?.close();
  await stop(chrome);
  await stop(vite);
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
