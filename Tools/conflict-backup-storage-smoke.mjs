import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// All storage operations use a temporary Chromium profile and local origin.
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
async function waitFor(url) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return response; } catch { /* starting */ }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  await Promise.race([once(child, 'exit'), delay(5000)]);
}
class CDP {
  constructor(url) { this.url = url; this.next = 1; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  command(method, params = {}) {
    const id = this.next++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  close() { this.socket?.close(); }
}
async function evaluate(client, expression) {
  const result = await client.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function waitUntil(client, expression, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if (await evaluate(client, expression)) return; } catch { /* page loading */ }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
const serverPort = await freePort();
let debugPort = await freePort();
while (debugPort === serverPort) debugPort = await freePort();
const appUrl = `http://127.0.0.1:${serverPort}/`;
const debugUrl = `http://127.0.0.1:${debugPort}`;
let vite, chrome, profile, client;
try {
  vite = spawn('./node_modules/.bin/vite', ['--host', '127.0.0.1', '--port', String(serverPort), '--strictPort'], { stdio: 'ignore', detached: true });
  await waitFor(appUrl);
  profile = await mkdtemp(join(tmpdir(), 'hair-backup-storage-'));
  chrome = spawn(process.env.CHROMIUM_BIN ?? 'chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--no-first-run',
    `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-webgl',
    `--remote-debugging-port=${debugPort}`, 'about:blank',
  ], { stdio: 'ignore', detached: true });
  let target;
  const deadline = Date.now() + 15000;
  while (!target && Date.now() < deadline) {
    target = (await (await waitFor(`${debugUrl}/json/list`)).json()).find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
    if (!target) await delay(100);
  }
  if (!target) throw new Error('Chromium page target unavailable');
  client = new CDP(target.webSocketDebuggerUrl);
  await client.connect(); await client.command('Runtime.enable'); await client.command('Page.enable');
  await client.command('Page.navigate', { url: appUrl });
  await waitUntil(client, "!!document.querySelector('#stage canvas') && !document.querySelector('#save').disabled", 'app startup');

  // Deleting this disposable profile's DB lets us verify an absent DB is not
  // permanently created merely by preparing a recovery backup.
  await evaluate(client, `new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('hair-atelier');
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database deletion blocked'));
  })`);
  const moduleExpression = "import('/src/conflict-backup.ts')";
  const missing = await evaluate(client, `${moduleExpression}.then(module => module.readConflictBackup())`);
  if (missing.format !== 'hair-atelier-conflict-backup' || missing.version !== 1 ||
    Object.values(missing.indexedDb).some((entry) => entry.kind !== 'missing')) throw new Error('Absent database backup did not preserve missing entries');
  const databaseNames = await evaluate(client, "indexedDB.databases().then(items => items.map(item => item.name))");
  if (databaseNames.includes('hair-atelier')) throw new Error('Preparing a backup permanently created an absent database');

  const baseline = await evaluate(client, `new Promise((resolve, reject) => {
    localStorage.setItem('hair-atelier.editor-history.v2', '舊髮型😀\\n');
    localStorage.setItem('hair-atelier.editor-history.v1', '');
    localStorage.removeItem('hair-atelier.hair-state.v1');
    const request = indexedDB.open('hair-atelier', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('editor-history');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('editor-history', 'readwrite');
      const store = tx.objectStore('editor-history');
      store.put('新版髮型\\u0000😀', 'current-v4');
      store.put(null, 'current-v3');
      store.put(undefined, 'current-v2');
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  })`);
  if (!baseline) throw new Error('Could not seed storage');
  await evaluate(client, `(() => {
    window.__backupWrites = 0;
    window.__backupOriginals = {};
    for (const name of ['put', 'add', 'delete', 'clear']) {
      window.__backupOriginals[name] = IDBObjectStore.prototype[name];
      IDBObjectStore.prototype[name] = function (...args) { window.__backupWrites++; return window.__backupOriginals[name].apply(this, args); };
    }
  })()`);
  const result = await evaluate(client, `${moduleExpression}.then(module => module.readConflictBackup('未儲存髮型😀'))`);
  const expectedDb = {
    'current-v4': { kind: 'string', value: '新版髮型\u0000😀' },
    'current-v3': { kind: 'null' },
    'current-v2': { kind: 'undefined' },
    'localstorage-source-v1': { kind: 'missing' },
  };
  const expectedLocal = {
    'hair-atelier.editor-history.v2': '舊髮型😀\n',
    'hair-atelier.editor-history.v1': '',
    'hair-atelier.hair-state.v1': null,
  };
  if (JSON.stringify(result.indexedDb) !== JSON.stringify(expectedDb) || JSON.stringify(result.localStorage) !== JSON.stringify(expectedLocal) ||
    result.memoryHistory !== '未儲存髮型😀' || Number.isNaN(Date.parse(result.createdAt))) throw new Error(`Backup did not preserve exact sources: ${JSON.stringify(result)}`);
  if (JSON.stringify(JSON.parse(JSON.stringify(result))) !== JSON.stringify(result)) throw new Error('Backup is not losslessly JSON serializable');
  if (await evaluate(client, 'window.__backupWrites') !== 0) throw new Error('Reading a backup unexpectedly wrote to IndexedDB');

  const changedWhileReading = await evaluate(client, `${moduleExpression}.then(async module => {
    const original = IDBObjectStore.prototype.get;
    let changed = false;
    IDBObjectStore.prototype.get = function (...args) {
      if (!changed) { changed = true; localStorage.setItem('hair-atelier.editor-history.v2', 'other-page-update'); }
      return original.apply(this, args);
    };
    try { await module.readConflictBackup(); return false; }
    catch { return changed; }
    finally { IDBObjectStore.prototype.get = original; }
  })`);
  if (!changedWhileReading) throw new Error('Backup accepted a localStorage change during its IndexedDB read');
  if (await evaluate(client, 'window.__backupWrites') !== 0) throw new Error('Conflict handling unexpectedly wrote to IndexedDB');

  // Seed an unsupported value only after restoring the test instrumentation;
  // the reader must reject it instead of silently producing lossy JSON.
  await evaluate(client, `(() => { for (const [name, original] of Object.entries(window.__backupOriginals)) IDBObjectStore.prototype[name] = original; })()`);
  await evaluate(client, `new Promise((resolve, reject) => {
    const request = indexedDB.open('hair-atelier', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('editor-history', 'readwrite');
      tx.objectStore('editor-history').put({ unsupported: new Uint8Array([7, 9]) }, 'current-v4');
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  })`);
  const unsupported = await evaluate(client, `${moduleExpression}.then(async module => {
    try { await module.readConflictBackup(); return false; } catch { return true; }
  })`);
  if (!unsupported) throw new Error('Backup silently accepted an unsupported IndexedDB value');
  const preserved = await evaluate(client, `new Promise((resolve, reject) => {
    const request = indexedDB.open('hair-atelier', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction('editor-history', 'readonly').objectStore('editor-history').get('current-v4');
      read.onsuccess = () => { db.close(); resolve(Array.from(read.result.unsupported)); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  })`);
  if (JSON.stringify(preserved) !== '[7,9]') throw new Error('Unsupported original value was changed');
  console.log('Conflict backup storage smoke passed: missing DB, exact sources, no writes, local race and unsupported value');
} finally {
  client?.close(); await stop(chrome); await stop(vite);
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
