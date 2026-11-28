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
  profile = await mkdtemp(join(tmpdir(), 'hair-atelier-multitouch-'));
  chrome = spawn(process.env.CHROMIUM_BIN ?? 'chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--no-first-run',
    `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-webgl',
    '--window-size=430,932', `--remote-debugging-port=${debugPort}`, 'about:blank',
  ], { stdio: 'ignore', detached: true });
  let target;
  const deadline = Date.now() + 15_000;
  while (!target && Date.now() < deadline) {
    target = (await (await waitFor(`${debugUrl}/json/list`)).json()).find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
    if (!target) await delay(100);
  }
  if (!target) throw new Error('Chromium did not expose a page target');
  client = new DevToolsClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.command('Runtime.enable');
  await client.command('Page.enable');
  await client.command('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
  await client.command('Page.navigate', { url: appUrl });
  await waitUntil(client, "!!document.querySelector('#stage canvas') && !document.querySelector('#save')?.disabled", 'canvas and storage initialization');

  // Find an actual editable strand through the running app's own selection
  // tool. Mouse is only used to discover a hit point; all regressions below
  // use Chromium CDP touch events, not synthetic pointer events.
  await client.command('Emulation.setTouchEmulationEnabled', { enabled: false });
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
  if (!hairPoint) throw new Error('Could not locate an editable hair strand');
  const uiPoint = await evaluate(client, `(() => { const r = document.querySelector('h1').getBoundingClientRect(); return { x: r.left + 10, y: r.top + 10 }; })()`);
  const touch = (type, points) => client.command('Input.dispatchTouchEvent', { type, touchPoints: points });
  await client.command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await evaluate(client, "document.querySelector('#save').click()");
  await waitUntil(client, "document.querySelector('#status').textContent.includes('已儲存到本機瀏覽器')", 'initial save');
  const baseline = await evaluate(client, readSaved);
  if (!baseline) throw new Error('Initial history was not saved');

  async function resetBaseline() {
    await evaluate(client, `new Promise((resolve, reject) => {
      const open = indexedDB.open('hair-atelier', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('editor-history', 'readwrite');
        tx.objectStore('editor-history').put(${JSON.stringify(baseline)}, 'current-v4');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    })`);
    await client.command('Page.navigate', { url: appUrl });
    await waitUntil(client, "document.querySelector('#status')?.textContent?.includes('已自動讀取本機儲存與操作歷史') && !document.querySelector('#save')?.disabled", 'baseline reload');
  }
  async function currentHistory() {
    // Clicking save after all contacts end checks the actual in-memory state,
    // not merely whether the automatic write has had time to finish.
    await evaluate(client, "document.querySelector('#save').click()");
    await waitUntil(client, "document.querySelector('#status').textContent.includes('已儲存到本機瀏覽器')", 'save current history');
    return await evaluate(client, readSaved);
  }
  async function scenario(tool, uiFirst, releaseFirst = false) {
    await resetBaseline();
    await evaluate(client, `document.querySelector('[data-tool=${tool}]').click()`);
    const first = uiFirst ? { ...uiPoint, id: 41 } : { ...hairPoint, id: 41 };
    const second = uiFirst ? { ...hairPoint, id: 42 } : { x: hairPoint.x + 35, y: hairPoint.y + 15, id: 42 };
    const third = { ...hairPoint, id: 43 };
    await touch('touchStart', [first]);
    await touch('touchStart', [first, second]);
    if (releaseFirst) await touch('touchEnd', [first]);
    const targetFinger = uiFirst ? second : third;
    if (!uiFirst) await touch('touchStart', releaseFirst ? [second, third] : [first, second, third]);
    if (tool === 'cut') {
      const moving = { ...targetFinger, x: targetFinger.x + 12 };
      await touch('touchMove', uiFirst ? [first, moving] : releaseFirst ? [second, moving] : [first, second, moving]);
      await touch('touchEnd', [moving]);
    } else {
      await touch('touchEnd', [targetFinger]);
    }
    await touch('touchEnd', []);
    const status = await evaluate(client, "document.querySelector('#status').textContent");
    return { intact: await currentHistory() === baseline, status };
  }
  const results = {};
  for (const tool of ['grow', 'cut']) {
    results[`${tool}ThreeFinger`] = await scenario(tool, false);
    results[`${tool}UiFirst`] = await scenario(tool, true);
    results[`${tool}PrimaryLifted`] = await scenario(tool, false, true);
  }

  // After all fingers lift, deliberate one-finger actions must work again in
  // the SAME page; a reload would hide a stuck contact lock.
  const beforeRecovery = await currentHistory();
  await evaluate(client, "document.querySelector('[data-tool=grow]').click()");
  const finger = { ...hairPoint, id: 55 };
  await touch('touchStart', [finger]);
  await touch('touchEnd', []);
  const grownStatus = await evaluate(client, "document.querySelector('#status').textContent");
  const grown = await currentHistory();
  results.singleFingerGrowRecovers = grown !== beforeRecovery && grownStatus.includes('增長');
  await evaluate(client, "document.querySelector('[data-tool=cut]').click()");
  const cutFinger = { ...hairPoint, id: 56 };
  await touch('touchStart', [cutFinger]);
  await touch('touchMove', [{ ...cutFinger, x: cutFinger.x + 12 }]);
  await touch('touchEnd', []);
  const cutStatus = await evaluate(client, "document.querySelector('#status').textContent");
  const cut = await currentHistory();
  results.singleFingerCutRecovers = cut !== grown && cutStatus.includes('一次剪短');

  // Browsers may cancel contacts when an OS gesture interrupts the page.
  // That cancellation must discard the gesture and release its contact lock.
  await evaluate(client, "document.querySelector('[data-tool=grow]').click()");
  const cancelFirst = { ...hairPoint, id: 61 };
  const cancelSecond = { x: hairPoint.x + 35, y: hairPoint.y + 15, id: 62 };
  await touch('touchStart', [cancelFirst]);
  await touch('touchStart', [cancelFirst, cancelSecond]);
  await touch('touchCancel', []);
  const cancelled = await currentHistory();
  results.cancelDoesNotEdit = cancelled === cut;
  await evaluate(client, "document.querySelector('[data-tool=grow]').click()");
  await touch('touchStart', [{ ...hairPoint, id: 63 }]);
  await touch('touchEnd', []);
  const afterCancelStatus = await evaluate(client, "document.querySelector('#status').textContent");
  const afterCancel = await currentHistory();
  results.singleFingerAfterCancel = afterCancel !== cancelled && afterCancelStatus.includes('增長');
  if (!Object.values(results).every((result) => typeof result === 'boolean' ? result : result.intact)) {
    throw new Error(`Multi-touch ownership failed: ${JSON.stringify(results)}`);
  }
  console.log(`Multi-touch ownership smoke passed: ${JSON.stringify(results)}`);
} finally {
  client?.close();
  await stop(chrome);
  await stop(vite);
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
