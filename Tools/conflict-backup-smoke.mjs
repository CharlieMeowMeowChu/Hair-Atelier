import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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

const serverPort = await freePort();
let debugPort = await freePort();
while (debugPort === serverPort) debugPort = await freePort();
const appUrl = 'http://127.0.0.1:' + serverPort + '/';
const debugUrl = 'http://127.0.0.1:' + debugPort;
let vite, chrome, profile, downloadDirectory, client, other;
try {
  vite = spawn('./node_modules/.bin/vite', ['--host', '127.0.0.1', '--port', String(serverPort), '--strictPort'], { stdio: 'ignore', detached: true });
  await waitFor(appUrl);
  profile = await mkdtemp(join(tmpdir(), 'hair-conflict-backup-'));
  downloadDirectory = await mkdtemp(join(tmpdir(), 'hair-conflict-download-'));
  chrome = spawn(process.env.CHROMIUM_BIN ?? 'chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--no-first-run',
    '--user-data-dir=' + profile, '--use-angle=swiftshader', '--enable-webgl',
    '--window-size=430,932', '--remote-debugging-port=' + debugPort, 'about:blank',
  ], { stdio: 'ignore', detached: true });
  let initial;
  for (let i = 0; i < 150 && !initial; i += 1) {
    initial = (await (await waitFor(debugUrl + '/json/list')).json()).find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
    if (!initial) await delay(100);
  }
  if (!initial) throw new Error('Chromium did not expose a page target');
  client = new DevToolsClient(initial.webSocketDebuggerUrl);
  await client.connect(); await client.command('Runtime.enable'); await client.command('Page.enable');
  await client.command('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
  await client.command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDirectory, eventsEnabled: true });
  await navigateFresh(client, appUrl, 'initial page');
  await waitUntil(client, "!!document.querySelector('#stage canvas') && !document.querySelector('#save')?.disabled && document.querySelector('#status')?.textContent.includes('C：40 cm')", 'initial ready');
  await evaluate(client, "document.querySelector('#save').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent.includes('已儲存到本機瀏覽器')", 'initial save');
  const original = await evaluate(client, readSaved);
  const history = JSON.parse(original);
  history.current.strands.find((strand) => strand.id === 'C').length = 0.2;
  const savedV4 = JSON.stringify(history);
  const history3 = structuredClone(history); history3.version = 3;
  for (const item of [history3.current, ...history3.undo, ...history3.redo]) item.schemaVersion = 3;
  const savedV3 = JSON.stringify(history3);
  const history2 = structuredClone(history); history2.version = 2;
  for (const item of [history2.current, ...history2.undo, ...history2.redo]) item.schemaVersion = 2;
  const savedV2 = JSON.stringify(history2);
  await evaluate(client, `new Promise((resolve, reject) => {
    const open = indexedDB.open('hair-atelier', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('editor-history', 'readwrite'), store = tx.objectStore('editor-history');
      store.put(${JSON.stringify(savedV4)}, 'current-v4');
      store.put(${JSON.stringify(savedV3)}, 'current-v3');
      store.put(${JSON.stringify(savedV2)}, 'current-v2');
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  })`);
  await navigateFresh(client, appUrl, 'load v4 C20');
  await waitUntil(client, "!document.querySelector('#save')?.disabled && document.querySelector('#status')?.textContent.includes('已自動讀取')", 'C20 loaded');
  const writerId = (await client.command('Target.createTarget', { url: appUrl })).targetId;
  let writer;
  for (let i = 0; i < 150 && !writer; i += 1) {
    writer = (await (await waitFor(debugUrl + '/json/list')).json()).find((entry) => entry.id === writerId && entry.webSocketDebuggerUrl);
    if (!writer) await delay(100);
  }
  if (!writer) throw new Error('Could not create another page');
  other = new DevToolsClient(writer.webSocketDebuggerUrl);
  await other.connect(); await other.command('Runtime.enable'); await other.command('Page.enable');
  await waitUntil(other, "!!document.querySelector('#stage canvas') && !document.querySelector('#save')?.disabled", 'other page ready');
  const legacy = structuredClone(history); legacy.current.strands.find((strand) => strand.id === 'C').length = 0.3;
  const legacyCurrent = JSON.stringify(legacy);
  const legacyV1 = JSON.stringify({ ...legacy, version: 1, current: { ...legacy.current, schemaVersion: 1 } });
  const legacySingle = JSON.stringify({ ...legacy.current, schemaVersion: 1 });
  await evaluate(other, `(() => {
    localStorage.setItem('hair-atelier.editor-history.v2', ${JSON.stringify(legacyCurrent)});
    localStorage.setItem('hair-atelier.editor-history.v1', ${JSON.stringify(legacyV1)});
    localStorage.setItem('hair-atelier.hair-state.v1', ${JSON.stringify(legacySingle)});
  })()`);
  await waitUntil(client, "!!document.querySelector('#storage-warning') && !document.querySelector('#storage-warning').hidden", 'legacy conflict');
  if (!(await evaluate(client, "!!document.querySelector('#backup-conflict')"))) throw new Error('Conflict backup UI is missing');

  const inspectSources = `new Promise((resolve, reject) => {
    const names = ['current-v4', 'current-v3', 'current-v2', 'localstorage-source-v1'];
    const localKeys = ['hair-atelier.editor-history.v2', 'hair-atelier.editor-history.v1', 'hair-atelier.hair-state.v1'];
    const local = Object.fromEntries(localKeys.map(key => [key, localStorage.getItem(key)]));
    const open = indexedDB.open('hair-atelier', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('editor-history', 'readonly'), store = tx.objectStore('editor-history');
      const entries = names.map(key => ({ key, exists: store.getKey(key), value: store.get(key) }));
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.oncomplete = () => {
        const result = {};
        for (const entry of entries) {
          const value = entry.value.result;
          result[entry.key] = entry.exists.result === undefined ? { kind: 'missing' }
            : value === undefined ? { kind: 'undefined' }
              : value === null ? { kind: 'null' }
                : typeof value === 'string' ? { kind: 'string', value }
                  : value instanceof Uint8Array ? { kind: 'bytes', value: [...value] } : { kind: 'other' };
        }
        db.close(); resolve({ indexedDb: result, localStorage: local });
      };
    };
  })`;
  const inspect = () => evaluate(client, inspectSources);
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const openBackup = async () => {
    await evaluate(client, "document.querySelector('#backup-conflict').click()");
    await waitUntil(client, "document.querySelector('#backup-dialog')?.open", 'backup dialog open');
  };
  const closeBackup = async () => {
    await evaluate(client, "document.querySelector('#close-conflict-backup').click()");
    await waitUntil(client, "!document.querySelector('#backup-dialog')?.open", 'backup dialog closed');
  };
  const prepare = async () => {
    await evaluate(client, "document.querySelector('#prepare-conflict-backup').click()");
    await waitUntil(client, "!document.querySelector('#download-conflict-backup')?.hidden && document.querySelector('#download-conflict-backup')?.href.startsWith('blob:')", 'backup Blob prepared');
    return await evaluate(client, `fetch(document.querySelector('#download-conflict-backup').href).then(response => response.text())`);
  };
  const assertBackup = (content, expected, memory) => {
    const backup = JSON.parse(content);
    if (backup.format !== 'hair-atelier-conflict-backup' || backup.version !== 1 || !Number.isFinite(Date.parse(backup.createdAt))) throw new Error('Invalid backup envelope');
    if (!equal(backup.indexedDb, expected.indexedDb)) throw new Error('Backup differs from the exact IndexedDB values');
    if (!equal(backup.localStorage, expected.localStorage)) throw new Error('Backup differs from the exact localStorage values');
    if (memory === undefined) {
      if ('memoryHistory' in backup) throw new Error('A default or unmodified editor was falsely exported as unsaved work');
    } else {
      if (typeof backup.memoryHistory !== 'string' || !equal(JSON.parse(backup.memoryHistory), memory)) throw new Error('Unsaved in-memory hairstyle or its undo history was not preserved');
    }
  };

  const layout = await evaluate(client, `(() => {
    const button = document.querySelector('#backup-conflict'), rect = button.getBoundingClientRect();
    return { visible: !button.hidden && rect.width > 0 && rect.height >= 44, bottom: rect.bottom, viewport: window.innerHeight };
  })()`);
  if (!layout.visible || layout.bottom > layout.viewport) throw new Error('Conflict backup button is outside the phone viewport: ' + JSON.stringify(layout));
  await openBackup();
  const modalTargetsValid = await evaluate(client, `['#prepare-conflict-backup', '#close-conflict-backup'].every(selector => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return rect.height >= 44 && rect.width > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
  })`);
  if (!modalTargetsValid) throw new Error('Backup dialog controls are not accessible touch targets');
  await closeBackup();

  const before = await inspect();
  if (before.indexedDb['current-v4'].value !== savedV4 || before.indexedDb['current-v3'].value !== savedV3 || before.indexedDb['current-v2'].value !== savedV2) throw new Error('Test history was not seeded correctly');
  // This edit is real but cannot be saved because the other tab changed legacy
  // data. The exported in-memory history should contain the edit and undo.
  await evaluate(client, "document.querySelector('#reset').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent.includes('已重設樣板')", 'unsaved edit');
  const expectedMemory = { version: 4, current: JSON.parse(original).current, undo: [history.current], redo: [] };
  await openBackup();
  await closeBackup();
  if (!equal(await inspect(), before)) throw new Error('Opening and cancelling the backup changed source data');
  await openBackup();
  const text = await prepare();
  assertBackup(text, before, expectedMemory);
  await evaluate(client, "document.querySelector('#download-conflict-backup').click()");
  const downloadDeadline = Date.now() + 15_000;
  let downloaded;
  while (Date.now() < downloadDeadline && !downloaded) {
    const names = (await readdir(downloadDirectory)).filter((name) => name.endsWith('.json'));
    if (names.length === 1) downloaded = await readFile(join(downloadDirectory, names[0]), 'utf8');
    else await delay(100);
  }
  if (!downloaded || downloaded !== text) throw new Error('The actual downloaded file did not match the prepared JSON Blob');
  assertBackup(downloaded, before, expectedMemory);
  if (!equal(await inspect(), before)) throw new Error('Preparing or downloading the backup changed source data');
  await closeBackup();

  // A closed dialog must not be held hostage by its earlier pending read.
  // Finish a second request first, then deliver the stale first result.
  await openBackup();
  await evaluate(client, `(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
      const request = open.apply(this, args);
      return new Proxy(request, {
        get(target, key) { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; },
        set(target, key, value) {
          if (key === 'onsuccess' && typeof value === 'function') {
            target.onsuccess = (event) => {
              IDBFactory.prototype.open = open;
              window.__releaseFirstBackup = () => value.call(target, event);
            };
            return true;
          }
          return Reflect.set(target, key, value, target);
        },
      });
    };
  })()`);
  await evaluate(client, "document.querySelector('#prepare-conflict-backup').click()");
  await waitUntil(client, "typeof window.__releaseFirstBackup === 'function'", 'first backup pending');
  await evaluate(client, `(() => {
    const dialog = document.querySelector('#backup-dialog');
    dialog.addEventListener('close', () => { window.__priorBackupCloseObserved = true }, { once: true });
    const original = dialog.close;
    dialog.close = function (...args) { window.__dialogCloseCalls = (window.__dialogCloseCalls || 0) + 1; return original.apply(this, args); };
  })()`);
  await closeBackup();
  await delay(500);
  const closeDetails = await evaluate(client, `({ open: document.querySelector('#backup-dialog')?.open, closeDisabled: document.querySelector('#close-conflict-backup')?.disabled, prepareDisabled: document.querySelector('#prepare-conflict-backup')?.disabled, status: document.querySelector('#conflict-backup-status')?.textContent, observed: window.__priorBackupCloseObserved, closeCalls: window.__dialogCloseCalls, ready: document.readyState, url: location.href })`);
  if (closeDetails.open || closeDetails.closeCalls !== 1 || closeDetails.prepareDisabled || closeDetails.status) {
    throw new Error('Closing a pending backup did not synchronously clear it: ' + JSON.stringify(closeDetails));
  }
  await evaluate(client, "document.querySelector('#undo').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent.includes('C：20 cm')", 'new editor snapshot for second backup');
  await openBackup();
  if (!(await evaluate(client, "!document.querySelector('#prepare-conflict-backup').disabled"))) throw new Error('Pending first read disabled preparation after reopening');
  const secondText = await prepare();
  const newMemory = { version: 4, current: history.current, undo: [], redo: [JSON.parse(original).current] };
  assertBackup(secondText, before, newMemory);
  const secondHref = await evaluate(client, "document.querySelector('#download-conflict-backup').href");
  // Model a previously queued close event arriving after the dialog reopened.
  // Chromium can defer its native close event while the page is backgrounded.
  await evaluate(client, "document.querySelector('#backup-dialog').dispatchEvent(new Event('close'))");
  if (!(await evaluate(client, "!document.querySelector('#download-conflict-backup').hidden && document.querySelector('#download-conflict-backup').href === " + JSON.stringify(secondHref)))) {
    throw new Error('A delayed close event cleared the reopened dialog');
  }
  await evaluate(client, 'window.__releaseFirstBackup()');
  await delay(400);
  if (!(await evaluate(client, "!document.querySelector('#download-conflict-backup').hidden && document.querySelector('#download-conflict-backup').href === " + JSON.stringify(secondHref)))) {
    throw new Error('The old pending backup replaced the new result');
  }
  if (await evaluate(client, "fetch(document.querySelector('#download-conflict-backup').href).then(r => r.text())") !== secondText) throw new Error('The old pending backup changed the new Blob');
  if (!equal(await inspect(), before)) throw new Error('Overlapping backup preparation changed source data');
  await closeBackup();
  await evaluate(client, "document.querySelector('#redo').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent.includes('C：40 cm')", 'restore editor after overlapping backup');

  // Delay the real database-open callback and change the editor while the
  // backup is in flight. A stale in-memory snapshot must not become a Blob.
  await openBackup();
  await evaluate(client, `(() => {
    const open = IDBFactory.prototype.open;
    window.__restoreBackupOpen = () => { IDBFactory.prototype.open = open; };
    IDBFactory.prototype.open = function (...args) {
      const request = open.apply(this, args);
      return new Proxy(request, {
        get(target, key) { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; },
        set(target, key, value) {
          if (key === 'onsuccess' && typeof value === 'function') {
            target.onsuccess = (event) => { window.__releaseBackupOpen = () => value.call(target, event); };
            return true;
          }
          return Reflect.set(target, key, value, target);
        },
      });
    };
  })()`);
  await evaluate(client, "document.querySelector('#prepare-conflict-backup').click()");
  await waitUntil(client, "typeof window.__releaseBackupOpen === 'function'", 'delayed backup read');
  await evaluate(client, "document.querySelector('#undo').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent.includes('C：20 cm')", 'editor changed during backup');
  await evaluate(client, 'window.__restoreBackupOpen(); window.__releaseBackupOpen()');
  await waitUntil(client, "!!document.querySelector('#conflict-backup-error') && !document.querySelector('#conflict-backup-error').hidden && document.querySelector('#conflict-backup-error').textContent.includes('變更')", 'stale backup rejected');
  if (!(await evaluate(client, "document.querySelector('#download-conflict-backup').hidden"))) throw new Error('Editor changed during preparation but stale backup remained downloadable');
  if (!equal(await inspect(), before)) throw new Error('Rejecting a stale in-flight backup changed source data');
  await closeBackup();
  await evaluate(client, "document.querySelector('#redo').click()");
  await waitUntil(client, "document.querySelector('#status')?.textContent.includes('C：40 cm')", 'restore unsaved editor');

  // Unsupported IndexedDB values must produce a visible error, not a lossy
  // JSON conversion or a stale downloadable link from the previous attempt.
  await evaluate(other, `new Promise((resolve, reject) => {
    const open = indexedDB.open('hair-atelier', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('editor-history', 'readwrite');
      tx.objectStore('editor-history').put(new Uint8Array([1, 7, 255]), 'current-v3');
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  })`);
  const unsupportedBefore = await inspect();
  await openBackup();
  await evaluate(client, "document.querySelector('#prepare-conflict-backup').click()");
  await waitUntil(client, "!!document.querySelector('#conflict-backup-error') && !document.querySelector('#conflict-backup-error').hidden && !!document.querySelector('#conflict-backup-error').textContent.trim()", 'unsupported value error');
  if (!(await evaluate(client, "document.querySelector('#download-conflict-backup').hidden"))) throw new Error('Unsupported value left a downloadable file');
  if (!equal(await inspect(), unsupportedBefore)) throw new Error('A failed backup changed original data');
  await closeBackup();

  // Test distinct null, undefined and absent marker values. Starting in a
  // conflict must not export the default hairstyle as unsaved user work.
  for (const kind of ['null', 'undefined', 'missing']) {
    await evaluate(other, `new Promise((resolve, reject) => {
      const open = indexedDB.open('hair-atelier', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('editor-history', 'readwrite'), store = tx.objectStore('editor-history');
        store.put(${JSON.stringify(savedV3)}, 'current-v3');
        if (${JSON.stringify(kind)} === 'missing') store.delete('localstorage-source-v1');
        else store.put(${kind === 'null' ? 'null' : 'undefined'}, 'localstorage-source-v1');
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    })`);
    await navigateFresh(client, appUrl, 'marker ' + kind);
    if (kind === 'missing') {
      await waitUntil(client, "!document.querySelector('#save')?.disabled && document.querySelector('#status')?.textContent.includes('已自動讀取')", 'unmarked v4 loaded');
      await evaluate(other, `localStorage.setItem('hair-atelier.editor-history.v2', ${JSON.stringify(legacyCurrent + ' ')})`);
    }
    await waitUntil(client, "!!document.querySelector('#storage-warning') && !document.querySelector('#storage-warning').hidden && !document.querySelector('#backup-conflict')?.hidden", 'marker ' + kind + ' conflict');
    const markerBefore = await inspect();
    if (markerBefore.indexedDb['localstorage-source-v1'].kind !== kind) throw new Error('Test did not construct marker ' + kind);
    await openBackup();
    const markerText = await prepare();
    assertBackup(markerText, markerBefore, undefined);
    await closeBackup();
    if (!equal(await inspect(), markerBefore)) throw new Error('Backing up marker ' + kind + ' changed data');
  }
  console.log('Conflict backup smoke passed: actual downloaded JSON matches Blob, exact stores and unsaved history, cancel, closed dialog race, mobile layout, stale preparation, unsupported values and missing/null/undefined markers');
} finally {
  other?.close(); client?.close();
  await stop(chrome); await stop(vite);
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (downloadDirectory) await rm(downloadDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
