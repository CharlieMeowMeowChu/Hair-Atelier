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
async function navigateFresh(client, url, label) {
  const previousDocument = await evaluate(client, 'performance.timeOrigin');
  const navigation = await client.command('Page.navigate', { url });
  if (navigation.errorText) throw new Error(`${label}: ${navigation.errorText}`);
  await waitUntil(client, `performance.timeOrigin !== ${previousDocument} && document.readyState === 'complete'`, `${label} document`);
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

const readMarker = `new Promise((resolve, reject) => {
  const open = indexedDB.open('hair-atelier', 1);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result, read = db.transaction('editor-history', 'readonly').objectStore('editor-history').get('localstorage-source-v1');
    read.onsuccess = () => { db.close(); resolve(read.result); };
    read.onerror = () => reject(read.error);
  };
})`;

const serverPort = await freePort();
let debugPort = await freePort();
while (debugPort === serverPort) debugPort = await freePort();
const appUrl = `http://127.0.0.1:${serverPort}/`;
const debugUrl = `http://127.0.0.1:${debugPort}`;
const legacyKey = 'hair-atelier.editor-history.v2';
let vite, chrome, profile, client, other;
try {
  vite = spawn('./node_modules/.bin/vite', ['--host', '127.0.0.1', '--port', String(serverPort), '--strictPort'], { stdio: 'ignore', detached: true });
  await waitFor(appUrl);
  profile = await mkdtemp(join(tmpdir(), 'hair-legacy-insecure-'));
  chrome = spawn(process.env.CHROMIUM_BIN ?? 'chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--no-first-run',
    `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-webgl',
    '--window-size=430,932', `--remote-debugging-port=${debugPort}`, 'about:blank',
  ], { stdio: 'ignore', detached: true });
  let target;
  for (let i = 0; i < 150 && !target; i += 1) {
    target = (await (await waitFor(`${debugUrl}/json/list`)).json()).find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
    if (!target) await delay(100);
  }
  if (!target) throw new Error('Chromium did not expose a page target');
  client = new DevToolsClient(target.webSocketDebuggerUrl);
  await client.connect(); await client.command('Runtime.enable'); await client.command('Page.enable');
  // Simulate the specific insecure-context API restriction while retaining
  // the browser's other crypto methods. The isolated page uses localhost.
  await client.command('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(Crypto.prototype, 'subtle', { configurable: true, get: () => undefined });` });
  await client.command('Page.navigate', { url: appUrl });
  await waitUntil(client, "!!document.querySelector('#stage canvas') && !!document.querySelector('#save') && !document.querySelector('#save').disabled && document.querySelector('#status')?.textContent?.includes('C：40 cm')", 'initial startup without subtle');
  if (!(await evaluate(client, "typeof crypto.subtle === 'undefined'"))) throw new Error('Could not simulate a missing crypto.subtle API');
  if (await evaluate(client, "!document.querySelector('#storage-warning').hidden")) throw new Error('Missing subtle blocked first startup');
  await evaluate(client, "document.querySelector('#save').click()");
  try {
    // ResizeObserver may overwrite the transient status; the actual commit is
    // evidenced by reading the expected marker from IndexedDB instead.
    await waitUntil(client, `(${readMarker}).then(value => value === 'raw:[null,null,null]')`, 'new hairstyle saved without subtle');
  } catch (error) {
    const result = await evaluate(client, `({ status: document.querySelector('#status')?.textContent, warning: document.querySelector('#storage-warning')?.textContent, warningVisible: !document.querySelector('#storage-warning')?.hidden })`);
    result.saved = await evaluate(client, readSaved);
    result.marker = await evaluate(client, readMarker);
    throw new Error(`New hairstyle was not saved without subtle: ${JSON.stringify(result)}`, { cause: error });
  }
  if (await evaluate(client, readMarker) !== 'raw:[null,null,null]') throw new Error('A first-time user did not get an exact empty-source marker');
  if (!(await evaluate(client, readSaved))) throw new Error('A first-time user could not save without subtle');
  // This database is in a disposable Chromium profile; reset it to exercise
  // a separate first-time migration from a legacy localStorage source.
  await evaluate(client, `new Promise((resolve, reject) => {
    const open = indexedDB.open('hair-atelier', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('editor-history', 'readwrite');
      tx.objectStore('editor-history').clear();
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  })`);

  const history = await evaluate(client, "import('/src/hair-core.ts').then(module => new module.HairEditor(module.createDemoHairState()).exportHistory())");
  history.current.strands.find((strand) => strand.id === 'C').length = 0.2;
  const oldRecord = JSON.stringify(history);
  history.current.strands.find((strand) => strand.id === 'C').length = 0.3;
  const newerRecord = JSON.stringify(history);
  await evaluate(client, `localStorage.setItem(${JSON.stringify(legacyKey)}, ${JSON.stringify(oldRecord)})`);
  await navigateFresh(client, appUrl, 'legacy source load');
  await waitUntil(client, "!document.querySelector('#save').disabled && document.querySelector('#status').textContent.includes('已自動讀取')", 'legacy source loaded');
  await evaluate(client, "document.querySelector('[data-tool=rotate]').click()");
  if (!(await evaluate(client, "document.querySelector('#status').textContent.includes('C：20 cm')"))) throw new Error('Legacy hairstyle was not loaded');
  await evaluate(client, "document.querySelector('#save').click()");
  await waitUntil(client, "document.querySelector('#status').textContent.includes('已儲存到本機瀏覽器')", 'migration saved without subtle');
  const saved = await evaluate(client, readSaved);
  const marker = await evaluate(client, readMarker);
  if (marker !== `raw:${JSON.stringify([oldRecord, null, null])}`) throw new Error('Missing exact raw source marker');

  await navigateFresh(client, appUrl, 'raw marker reload');
  await waitUntil(client, "!document.querySelector('#save').disabled && document.querySelector('#status').textContent.includes('已自動讀取')", 'raw marker verified');
  await evaluate(client, "document.querySelector('[data-tool=rotate]').click()");
  if (!(await evaluate(client, "document.querySelector('#status').textContent.includes('C：20 cm') && document.querySelector('#storage-warning').hidden"))) throw new Error('Raw marker did not restore the saved hairstyle');
  if (await evaluate(client, readSaved) !== saved) throw new Error('Reload changed the saved hairstyle');

  // A second tab with normal crypto must still read a persisted raw marker.
  const otherId = (await client.command('Target.createTarget', { url: 'about:blank' })).targetId;
  let otherTarget;
  for (let i = 0; i < 150 && !otherTarget; i += 1) {
    otherTarget = (await (await waitFor(`${debugUrl}/json/list`)).json()).find((item) => item.id === otherId && item.webSocketDebuggerUrl);
    if (!otherTarget) await delay(100);
  }
  if (!otherTarget) throw new Error('Could not create second isolated tab');
  other = new DevToolsClient(otherTarget.webSocketDebuggerUrl);
  await other.connect(); await other.command('Runtime.enable'); await other.command('Page.enable');
  await other.command('Page.navigate', { url: appUrl });
  await waitUntil(other, "!document.querySelector('#save')?.disabled && document.querySelector('#status')?.textContent.includes('已自動讀取')", 'raw marker read with subtle available');
  if (!(await evaluate(other, "!!crypto.subtle && document.querySelector('#storage-warning').hidden"))) throw new Error('A later crypto-capable page rejected the raw marker');

  await evaluate(other, `localStorage.setItem(${JSON.stringify(legacyKey)}, ${JSON.stringify(newerRecord)})`);
  await waitUntil(client, "!document.querySelector('#storage-warning').hidden", 'legacy conflict warning');
  await evaluate(client, "document.querySelector('#save').click()");
  await waitUntil(client, "document.querySelector('#status').textContent.includes('瀏覽器拒絕本機儲存')", 'conflicting save blocked');
  if (await evaluate(client, readSaved) !== saved) throw new Error('Conflict overwrote the v4 hairstyle');
  if (await evaluate(client, `localStorage.getItem(${JSON.stringify(legacyKey)})`) !== newerRecord) throw new Error('Conflict overwrote the newer legacy hairstyle');
  await navigateFresh(client, appUrl, 'legacy conflict reload');
  await waitUntil(client, "!!document.querySelector('#save') && !document.querySelector('#save').disabled", 'conflict reload initialized');
  if (!(await evaluate(client, "!document.querySelector('#storage-warning').hidden"))) throw new Error('Reload hid the unresolved legacy conflict');
  console.log('Legacy no-subtle smoke passed: raw migration, reload, crypto-capable reader and cross-tab conflict protection');
} finally {
  other?.close(); client?.close();
  await stop(chrome); await stop(vite);
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
