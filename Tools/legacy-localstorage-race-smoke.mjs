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

const serverPort = await freePort();
let debugPort = await freePort();
while (debugPort === serverPort) debugPort = await freePort();
const appUrl = `http://127.0.0.1:${serverPort}/`;
const debugUrl = `http://127.0.0.1:${debugPort}`;
let vite, chrome, profile, client, other;
try {
  vite = spawn('./node_modules/.bin/vite', ['--host', '127.0.0.1', '--port', String(serverPort), '--strictPort'], { stdio: 'ignore', detached: true });
  await waitFor(appUrl);
  profile = await mkdtemp(join(tmpdir(), 'hair-legacy-race-'));
  chrome = spawn(process.env.CHROMIUM_BIN ?? 'chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--no-first-run',
    `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-webgl',
    '--window-size=430,932', `--remote-debugging-port=${debugPort}`, 'about:blank',
  ], { stdio: 'ignore', detached: true });
  let initial;
  for (let i = 0; i < 150 && !initial; i += 1) {
    initial = (await (await waitFor(`${debugUrl}/json/list`)).json()).find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
    if (!initial) await delay(100);
  }
  if (!initial) throw new Error('Chromium did not expose a page target');
  client = new DevToolsClient(initial.webSocketDebuggerUrl);
  await client.connect(); await client.command('Runtime.enable'); await client.command('Page.enable');
  await navigateFresh(client, appUrl, 'initial page');
  await waitUntil(client, "!!document.querySelector('#save') && !document.querySelector('#save').disabled", 'initial app');
  const initialState = await evaluate(client, "import('/src/hair-core.ts').then(module => new module.HairEditor(module.createDemoHairState()).exportHistory())");
  const record = (length) => {
    const snapshot = structuredClone(initialState);
    snapshot.current.strands.find((strand) => strand.id === 'C').length = length;
    return JSON.stringify(snapshot);
  };
  const oldRecord = record(0.2), newerRecord = record(0.3);
  const writerTarget = (await client.command('Target.createTarget', { url: appUrl })).targetId;
  let otherTarget;
  for (let i = 0; i < 150 && !otherTarget; i += 1) {
    otherTarget = (await (await waitFor(`${debugUrl}/json/list`)).json()).find((entry) => entry.id === writerTarget && entry.webSocketDebuggerUrl);
    if (!otherTarget) await delay(100);
  }
  if (!otherTarget) throw new Error('Could not create isolated old-writer tab');
  other = new DevToolsClient(otherTarget.webSocketDebuggerUrl);
  await other.connect(); await other.command('Runtime.enable'); await other.command('Page.enable');
  await waitUntil(other, "location.origin !== 'null' && !!document.querySelector('#save') && !document.querySelector('#save').disabled", 'old writer origin');

  async function reset() {
    // The browser profile and database are dedicated to this test.
    await evaluate(client, `new Promise((resolve, reject) => {
      localStorage.clear();
      const request = indexedDB.open('hair-atelier', 1);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('editor-history', 'readwrite');
        tx.objectStore('editor-history').clear();
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      request.onerror = () => reject(request.error);
    })`);
  }
  async function seedAndLoad(key) {
    await reset();
    await evaluate(client, `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(oldRecord)})`);
    await navigateFresh(client, appUrl, 'legacy seed');
    await waitUntil(client, "!document.querySelector('#save').disabled && document.querySelector('#status').textContent.includes('已自動讀取')", 'legacy C20 loaded');
    await evaluate(client, "document.querySelector('[data-tool=rotate]').click()");
    if (!(await evaluate(client, "document.querySelector('#status').textContent.includes('C：20 cm')"))) throw new Error('Did not load the intended legacy C20');
  }
  const failures = [];
  async function race(sourceKey, updatedKey, label) {
    await seedAndLoad(sourceKey);
    await evaluate(other, `localStorage.setItem(${JSON.stringify(updatedKey)}, ${JSON.stringify(newerRecord)})`);
    await evaluate(client, "document.querySelector('#save').click()");
    const deadline = Date.now() + 5000;
    let outcome;
    while (Date.now() < deadline) {
      outcome = await evaluate(client, `({ status: document.querySelector('#status')?.textContent,
        warning: document.querySelector('#storage-warning')?.textContent,
        visible: !document.querySelector('#storage-warning')?.hidden })`);
      if (outcome.visible || outcome.status?.includes('已儲存到本機瀏覽器')) break;
      await delay(100);
    }
    if (!outcome?.visible || !outcome.warning?.trim() || outcome.status?.includes('已儲存到本機瀏覽器')) {
      failures.push(`${label}: newer legacy change was silently overwritten or hidden: ${JSON.stringify(outcome)}`);
      return;
    }
    const storedLegacy = await evaluate(client, `localStorage.getItem(${JSON.stringify(updatedKey)})`);
    if (storedLegacy !== newerRecord) throw new Error(`${label}: newer legacy data was modified`);
    const storedV4 = await evaluate(client, readSaved);
    if (storedV4 !== undefined) {
      // If a v4 snapshot was committed during the conflict, a reload must not
      // silently prefer its older value over the newer legacy data.
      await navigateFresh(client, appUrl, 'conflict reload');
      await waitUntil(client, "!!document.querySelector('#stage canvas') && document.querySelector('#storage-warning') && (!document.querySelector('#storage-warning').hidden || (!document.querySelector('#save')?.disabled && document.querySelector('#status')?.textContent?.includes('已自動讀取')))", 'conflict reload');
      const reloaded = await evaluate(client, `({ status: document.querySelector('#status')?.textContent, visible: !document.querySelector('#storage-warning')?.hidden })`);
      if (!reloaded.visible && !reloaded.status?.includes('C：30 cm')) throw new Error(`${label}: reload silently preferred stale v4: ${JSON.stringify(reloaded)}`);
    }
  }
  async function afterMigration(withLegacy) {
    const key = 'hair-atelier.editor-history.v2';
    if (withLegacy) await seedAndLoad(key);
    else {
      await reset();
      await navigateFresh(client, `${appUrl}?empty-legacy-start=1`, 'empty legacy startup');
      await waitUntil(client, "location.search.includes('empty-legacy-start=1') && !!document.querySelector('#stage canvas') && !!document.querySelector('#save') && !document.querySelector('#save').disabled && document.querySelector('#status')?.textContent?.includes('C：40 cm')", 'empty legacy startup');
    }
    await evaluate(client, "document.querySelector('#save').click()");
    try {
      await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已儲存到本機瀏覽器')", 'initial migration saved');
    } catch (error) {
      const state = await evaluate(client, `({ status: document.querySelector('#status')?.textContent, warning: document.querySelector('#storage-warning')?.textContent, visible: !document.querySelector('#storage-warning')?.hidden })`);
      throw new Error(`Initial migration failed (${withLegacy ? 'legacy' : 'empty'}): ${JSON.stringify(state)}`, { cause: error });
    }
    const initialV4 = await evaluate(client, readSaved);
    if (!initialV4) throw new Error('Initial migration did not save v4');
    await evaluate(client, "document.querySelector('[data-tool=rotate]').click()");
    await evaluate(other, `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(newerRecord)})`);
    const label = withLegacy ? 'legacy changed after migration' : 'legacy created after migration';
    try {
      await waitUntil(client, "!document.querySelector('#storage-warning')?.hidden && !!document.querySelector('#storage-warning')?.textContent.trim()", label);
    } catch {
      failures.push(`${label}: no visible warning in the open page`);
      return;
    }
    await evaluate(client, "document.querySelector('#save').click()");
    await delay(300);
    if (await evaluate(client, readSaved) !== initialV4) failures.push(`${label}: conflicting save changed the v4 snapshot`);
    if (await evaluate(client, `localStorage.getItem(${JSON.stringify(key)})`) !== newerRecord) failures.push(`${label}: newer legacy snapshot was changed`);
    await navigateFresh(client, appUrl, `${label} reload`);
    await waitUntil(client, "!!document.querySelector('#stage canvas') && document.querySelector('#storage-warning') && (!document.querySelector('#storage-warning').hidden || (!document.querySelector('#save')?.disabled && document.querySelector('#status')?.textContent?.includes('已自動讀取')))", `${label} reload`);
    const warning = await evaluate(client, "!document.querySelector('#storage-warning').hidden && !!document.querySelector('#storage-warning').textContent.trim()");
    if (!warning) { failures.push(`${label}: reload hid conflict with the legacy snapshot`); return; }
    await evaluate(client, "document.querySelector('#load').click()");
    await delay(500);
    if (!(await evaluate(client, "!document.querySelector('#storage-warning').hidden"))) failures.push(`${label}: manual load cleared unresolved conflict`);
    if (await evaluate(client, readSaved) !== initialV4) failures.push(`${label}: manual load overwrote saved v4`);
  }
  async function changeDuringCommit() {
    const key = 'hair-atelier.editor-history.v2';
    await seedAndLoad(key);
    // This intercepts the actual write request: the legacy key changes after
    // any earlier read/check but before the IndexedDB transaction commits.
    await evaluate(client, `(() => {
      const put = IDBObjectStore.prototype.put;
      window.__restorePut = () => { IDBObjectStore.prototype.put = put; };
      IDBObjectStore.prototype.put = function (value, key) {
        if (key === 'current-v4' && !window.__changedDuringCommit) {
          window.__changedDuringCommit = true;
          localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(newerRecord)});
        }
        return put.apply(this, arguments);
      };
    })()`);
    await evaluate(client, "document.querySelector('#save').click()");
    await waitUntil(client, 'window.__changedDuringCommit', 'intercepted v4 write');
    const deadline = Date.now() + 5000;
    let warning = false;
    while (Date.now() < deadline) {
      warning = await evaluate(client, "!document.querySelector('#storage-warning').hidden && !!document.querySelector('#storage-warning').textContent.trim()");
      if (warning) break;
      await delay(100);
    }
    await evaluate(client, 'window.__restorePut()');
    if (!warning) { failures.push('legacy changed during commit: no visible warning after save'); return; }
    if (await evaluate(client, `localStorage.getItem(${JSON.stringify(key)})`) !== newerRecord) failures.push('legacy changed during commit: newer data was modified');
    const v4 = await evaluate(client, readSaved);
    if (v4 !== undefined) {
      await navigateFresh(client, appUrl, 'commit race reload');
      await waitUntil(client, "!!document.querySelector('#stage canvas') && document.querySelector('#storage-warning') && (!document.querySelector('#storage-warning').hidden || (!document.querySelector('#save')?.disabled && document.querySelector('#status')?.textContent?.includes('已自動讀取')))", 'commit race reload');
      if (!(await evaluate(client, "!document.querySelector('#storage-warning').hidden"))) failures.push('legacy changed during commit: reload hid unresolved conflict');
    }
  }
  async function oldWriterWhileAppClosed() {
    const key = 'hair-atelier.editor-history.v2';
    await seedAndLoad(key);
    await evaluate(client, "document.querySelector('#save').click()");
    await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已儲存到本機瀏覽器')", 'closed-page initial migration');
    const before = await evaluate(client, readSaved);
    if (!before) throw new Error('Closed-page case did not initially save v4');
    await navigateFresh(client, 'about:blank', 'close new app page');
    await evaluate(other, `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(newerRecord)})`);
    await navigateFresh(client, appUrl, 'reopen after old writer');
    await waitUntil(client, "document.querySelector('#storage-warning') && !document.querySelector('#storage-warning').hidden", 'closed-page conflict warning');
    if (await evaluate(client, readSaved) !== before) failures.push('old writer while app closed: v4 changed');
    if (await evaluate(client, `localStorage.getItem(${JSON.stringify(key)})`) !== newerRecord) failures.push('old writer while app closed: newer legacy changed');
    await evaluate(client, "window.confirm = () => true; document.querySelector('#load').click()");
    await delay(500);
    await evaluate(client, "document.querySelector('#save').click()");
    await delay(500);
    if (!(await evaluate(client, "!document.querySelector('#storage-warning').hidden"))) failures.push('old writer while app closed: manual load bypassed warning');
    if (await evaluate(client, readSaved) !== before) failures.push('old writer while app closed: manual action changed v4');
  }
  async function corruptMarker(markerValue) {
    const key = 'hair-atelier.editor-history.v2';
    await seedAndLoad(key);
    await evaluate(client, "document.querySelector('#save').click()");
    await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已儲存到本機瀏覽器')", 'marker-case initial migration');
    const before = await evaluate(client, readSaved);
    if (!before) throw new Error('Marker case did not initially save v4');
    await evaluate(other, `new Promise((resolve, reject) => {
      const open = indexedDB.open('hair-atelier', 1);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('editor-history', 'readwrite');
        tx.objectStore('editor-history').put(${JSON.stringify(markerValue)}, 'localstorage-source-v1');
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      open.onerror = () => reject(open.error);
    })`);
    await navigateFresh(client, appUrl, 'corrupted source marker reload');
    await waitUntil(client, "document.querySelector('#storage-warning') && !document.querySelector('#storage-warning').hidden", 'corrupted source marker warning');
    await evaluate(client, "window.confirm = () => true; document.querySelector('#load').click()");
    await delay(500);
    await evaluate(client, "document.querySelector('#save').click()");
    await delay(500);
    if (!(await evaluate(client, "!document.querySelector('#storage-warning').hidden"))) failures.push(`corrupt marker ${String(markerValue)}: manual load bypassed warning`);
    if (await evaluate(client, readSaved) !== before) failures.push(`corrupt marker ${String(markerValue)}: saved v4 was modified`);
    if (await evaluate(client, `localStorage.getItem(${JSON.stringify(key)})`) !== oldRecord) failures.push(`corrupt marker ${String(markerValue)}: source legacy was modified`);
  }
  await race('hair-atelier.editor-history.v2', 'hair-atelier.editor-history.v2', 'updated source key');
  await race('hair-atelier.editor-history.v1', 'hair-atelier.editor-history.v2', 'new higher-priority key');
  await afterMigration(true);
  await afterMigration(false);
  await changeDuringCommit();
  await oldWriterWhileAppClosed();
  await corruptMarker(null);
  await corruptMarker('not-a-valid-fingerprint');
  await corruptMarker(undefined);
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('Legacy localStorage race smoke passed: pre- and post-migration conflicts, absent and higher-priority keys, commit-window, closed-page writes and corrupt markers');
} finally {
  other?.close(); client?.close();
  await stop(chrome); await stop(vite);
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
