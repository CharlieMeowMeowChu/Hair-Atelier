import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { isDeepStrictEqual } from 'node:util';

const serverPort = 4173;
const debugPort = 9222;
const appUrl = `http://127.0.0.1:${serverPort}/`;
const debugUrl = `http://127.0.0.1:${debugPort}`;
const chromium = process.env.CHROMIUM_BIN ?? 'chromium';

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(url, timeoutMilliseconds = 10_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function stop(processHandle) {
  if (!processHandle || processHandle.exitCode !== null || !processHandle.pid) return;
  try {
    process.kill(-processHandle.pid, 'SIGTERM');
  } catch {
    processHandle.kill('SIGTERM');
  }
  await Promise.race([once(processHandle, 'exit'), delay(5_000)]);
}

class DevToolsClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('Could not open Chromium DevTools WebSocket')), { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const handler of this.events.get(message.method) ?? []) handler(message.params);
    });
  }

  command(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    const handlers = this.events.get(method) ?? [];
    handlers.push(handler);
    this.events.set(method, handlers);
  }

  close() {
    this.socket?.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function screenshot(client) {
  return (await client.command('Page.captureScreenshot', { format: 'png' })).data;
}

let vite;
let chrome;
let profileDirectory;
let client;
let secondClient;
const consoleErrors = [];
try {
  vite = spawn('./node_modules/.bin/vite', ['--host', '127.0.0.1', '--port', String(serverPort), '--strictPort'], {
    stdio: 'ignore', detached: true,
  });
  await waitFor(appUrl);

  profileDirectory = await mkdtemp(join(tmpdir(), 'hair-atelier-browser-smoke-'));
  chrome = spawn(chromium, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--no-first-run',
    `--user-data-dir=${profileDirectory}`, '--use-angle=swiftshader', '--enable-webgl',
    '--window-size=430,932', `--remote-debugging-port=${debugPort}`, 'about:blank',
  ], { stdio: 'ignore', detached: true });

  const targets = await (await waitFor(`${debugUrl}/json/list`)).json();
  const target = targets.find((candidate) => candidate.type === 'page');
  if (!target?.webSocketDebuggerUrl) throw new Error('Chromium did not expose a page target');
  client = new DevToolsClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.command('Runtime.enable');
  await client.command('Page.enable');
  client.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') consoleErrors.push(args.map((argument) => argument.value ?? argument.description ?? '').join(' '));
  });
  await client.command('Page.addScriptToEvaluateOnNewDocument', {
    source: `globalThis.__hairAtelierSmokeErrors = [];
      addEventListener('error', (event) => globalThis.__hairAtelierSmokeErrors.push(String(event.message)));
      addEventListener('unhandledrejection', (event) => globalThis.__hairAtelierSmokeErrors.push(String(event.reason)));`,
  });
  await client.command('Page.navigate', { url: appUrl });

  const deadline = Date.now() + 10_000;
  let state;
  while (Date.now() < deadline) {
    state = await evaluate(client, `JSON.stringify({
      canvasCount: document.querySelectorAll('#stage canvas').length,
      overlayLabel: document.querySelector('#overlay div:nth-child(2) dt')?.textContent,
      status: document.querySelector('#status')?.textContent,
      startupReady: !!document.querySelector('#save') && !document.querySelector('#save').disabled,
      touchTargetsValid: [...document.querySelectorAll('button, select')].every((element) => getComputedStyle(element).minHeight === '44px' || element.getBoundingClientRect().height >= 44),
      stageTouchAction: document.querySelector('#stage') ? getComputedStyle(document.querySelector('#stage')).touchAction : undefined,
      errors: globalThis.__hairAtelierSmokeErrors ?? [],
    })`);
    const parsed = JSON.parse(state);
    if (parsed.canvasCount === 1 && parsed.overlayLabel === 'Rest arc s' && parsed.status !== '載入 3D 髮束中' && parsed.startupReady && parsed.touchTargetsValid && parsed.stageTouchAction === 'none') break;
    await delay(100);
  }
  const parsed = JSON.parse(state ?? '{}');
  const phoneViewport = JSON.parse(await evaluate(client, `JSON.stringify({ scrollFitsViewport: document.documentElement.scrollHeight <= window.innerHeight, primaryToolCount: document.querySelectorAll('.tools:not(.drawer-tools) [data-tool]').length, moreToolsOpens: Boolean(document.querySelector('#more-tools') && document.querySelector('#tool-drawer')) })`));
  parsed.phoneLayoutValid = phoneViewport.scrollFitsViewport && phoneViewport.primaryToolCount === 7 && phoneViewport.moreToolsOpens;
  parsed.curlSpanControlValid = await evaluate(client, `(() => {
    document.querySelector('#more-tools').click();
    const dialog = document.querySelector('#tool-drawer'), select = document.querySelector('#curl-span');
    const open = dialog.open && select.getBoundingClientRect().height >= 44;
    select.value = '0.05'; select.dispatchEvent(new Event('change', { bubbles: true }));
    const selected = select.value === '0.05';
    select.value = 'auto'; document.querySelector('#close-tools').click();
    return open && selected && !dialog.open;
  })()`);
  const beforeRotate = await screenshot(client);
  await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: 160, y: 380, button: 'left', clickCount: 1 });
  await client.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 270, y: 400, button: 'left', buttons: 1 });
  await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 270, y: 400, button: 'left', clickCount: 1 });
  await delay(100);
  const afterRotate = await screenshot(client);
  parsed.rotateVisualChanged = beforeRotate !== afterRotate;
  await client.command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const beforePinch = await screenshot(client);
  await client.command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 390, id: 1 }, { x: 230, y: 390, id: 2 }] });
  await client.command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 140, y: 390, id: 1 }, { x: 270, y: 390, id: 2 }] });
  await client.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(100);
  const afterPinch = await screenshot(client);
  parsed.pinchVisualChanged = beforePinch !== afterPinch;
  parsed.pinchResumeValid = true;
  for (const survivor of [1, 2]) {
    await client.command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 175, y: 330, id: 1 }, { x: 235, y: 330, id: 2 }] });
    await client.command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 160, y: 330, id: 1 }, { x: 250, y: 330, id: 2 }] });
    await delay(100);
    const beforeRelease = await screenshot(client);
    const remaining = survivor === 1 ? { x: 160, y: 330, id: 1 } : { x: 250, y: 330, id: 2 };
    const released = survivor === 1 ? { x: 250, y: 330, id: 2 } : { x: 160, y: 330, id: 1 };
    await client.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [released] });
    await delay(100);
    const afterRelease = await screenshot(client);
    await client.command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...remaining, x: remaining.x + 55 }] });
    await delay(100);
    const afterSingleMove = await screenshot(client);
    parsed[`pinchResume${survivor}`] = { stable: beforeRelease === afterRelease, moved: afterRelease !== afterSingleMove };
    parsed.pinchResumeValid &&= parsed[`pinchResume${survivor}`].stable && parsed[`pinchResume${survivor}`].moved;
    await client.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  // Zero-distance initial contacts must still establish a working pinch baseline.
  await client.command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 330, id: 1 }, { x: 200, y: 330, id: 2 }] });
  await delay(100);
  const zeroPinchBefore = await screenshot(client);
  await client.command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150, y: 330, id: 1 }, { x: 250, y: 330, id: 2 }] });
  await delay(100);
  parsed.zeroDistancePinchValid = zeroPinchBefore !== await screenshot(client);
  await client.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // Equal two-finger translation pans without requiring a pinch.
  await client.command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 175, y: 330, id: 1 }, { x: 235, y: 330, id: 2 }] });
  await delay(100);
  const beforePan = await screenshot(client);
  await client.command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 175, y: 250, id: 1 }, { x: 235, y: 250, id: 2 }] });
  await delay(100);
  const afterPan = await screenshot(client);
  await client.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  parsed.twoFingerPanValid = beforePan !== afterPan;
  await evaluate(client, "document.querySelector('#front').click()");
  await delay(100);
  // Switching tools while a canvas drag is in progress must cancel that drag.
  await client.command('Emulation.setTouchEmulationEnabled', { enabled: false });
  await evaluate(client, "document.querySelector('[data-tool=rotate]').click()");
  await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: 160, y: 320, button: 'left', clickCount: 1 });
  await client.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 260, y: 340, button: 'left', buttons: 1 });
  await evaluate(client, "document.querySelector('[data-tool=part]').click()");
  await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 260, y: 340, button: 'left', clickCount: 1 });
  await delay(100);
  parsed.toolSwitchCancelsGesture = await evaluate(client, "!document.querySelector('#status').textContent.includes('已移動分界')");
  await evaluate(client, "document.querySelector('[data-tool=rotate]').click()");
  // Locate a visible strand using the actual selection tool, then verify
  // an interrupted tap cannot grow it and a completed tap can.
  const stageBounds = await evaluate(client, `(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  let hairPoint;
  await evaluate(client, "document.querySelector('[data-tool=select]').click()");
  for (let y = stageBounds.top + 20; y < stageBounds.top + stageBounds.height - 50 && !hairPoint; y += 15) {
    for (let x = stageBounds.left + 20; x < stageBounds.left + stageBounds.width - 20; x += 15) {
      await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      if (await evaluate(client, "document.querySelector('#status').textContent.includes('已選取')")) { hairPoint = { x, y }; break; }
    }
  }
  parsed.tapCancellationValid = false;
  if (hairPoint) {
    await evaluate(client, "document.querySelector('[data-tool=grow]').click()");
    await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...hairPoint, button: 'left', clickCount: 1 });
    const beforeRelease = await evaluate(client, "document.querySelector('#status').textContent");
    await evaluate(client, "document.querySelector('#stage canvas').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))");
    await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...hairPoint, button: 'left', clickCount: 1 });
    const afterCancel = await evaluate(client, "document.querySelector('#status').textContent");
    await client.command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await client.command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...hairPoint, id: 1 }] });
    await client.command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...hairPoint, id: 1 }, { x: hairPoint.x + 35, y: hairPoint.y, id: 2 }] });
    await client.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const afterSecondFinger = await evaluate(client, "document.querySelector('#status').textContent");
    await client.command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...hairPoint, id: 3 }] });
    const outsidePoint = await evaluate(client, `(() => { const r = document.querySelector('#undo').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await client.command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...hairPoint, id: 3 }, { ...outsidePoint, id: 4 }] });
    await client.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const afterOutsideFinger = await evaluate(client, "document.querySelector('#status').textContent");
    await client.command('Emulation.setTouchEmulationEnabled', { enabled: false });
    await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...hairPoint, button: 'left', clickCount: 1 });
    await evaluate(client, "window.dispatchEvent(new Event('blur'))");
    await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...hairPoint, button: 'left', clickCount: 1 });
    const afterBlur = await evaluate(client, "document.querySelector('#status').textContent");
    await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...hairPoint, button: 'left', clickCount: 1 });
    await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...hairPoint, button: 'left', clickCount: 1 });
    const afterTap = await evaluate(client, "document.querySelector('#status').textContent");
    parsed.tapCancellationValid = !beforeRelease.includes('已對') && !afterCancel.includes('已對') && !afterSecondFinger.includes('已對') && !afterOutsideFinger.includes('已對') && !afterBlur.includes('已對') && afterTap.includes('已對');
    await evaluate(client, "document.querySelector('#undo').click(); document.querySelector('[data-tool=cut]').click()");
    await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...hairPoint, button: 'left', clickCount: 1 });
    await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hairPoint.x + 12, y: hairPoint.y, button: 'left', clickCount: 1 });
    const cutAfterFlick = await evaluate(client, "document.querySelector('#status').textContent");
    parsed.cutReleaseSweepValid = cutAfterFlick.includes('一次剪短');
    await evaluate(client, "document.querySelector('#undo').click(); document.querySelector('[data-tool=cut]').click()");
    await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...hairPoint, button: 'left', clickCount: 1 });
    await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...hairPoint, button: 'left', clickCount: 1 });
    parsed.cutReleaseSweepValid &&= !(await evaluate(client, "document.querySelector('#status').textContent.includes('一次剪短')"));
    await evaluate(client, "document.querySelector('[data-tool=rotate]').click()");
  }
  await client.command('Emulation.setDeviceMetricsOverride', { width: 820, height: 1180, deviceScaleFactor: 1, mobile: true });
  await delay(100);
  const tabletLayout = JSON.parse(await evaluate(client, `JSON.stringify({
    canvasCount: document.querySelectorAll('#stage canvas').length,
    toolColumns: getComputedStyle(document.querySelector('.tools')).gridTemplateColumns.trim().split(/\\s+/).length,
    touchTargetsValid: [...document.querySelectorAll('button, select')].filter((element) => element.getBoundingClientRect().height > 0).every((element) => element.getBoundingClientRect().height >= 44),
  })`));
  parsed.tabletLayoutValid = tabletLayout.canvasCount === 1 && tabletLayout.toolColumns === 4 && tabletLayout.touchTargetsValid;
  await client.command('Emulation.clearDeviceMetricsOverride');
  const indexedHistory = await evaluate(client, `new Promise((resolve) => {
    document.querySelector('#save')?.click();
    setTimeout(() => {
      const request = indexedDB.open('hair-atelier', 1);
      request.onerror = () => resolve(undefined);
      request.onsuccess = () => {
        const read = request.result.transaction('editor-history', 'readonly').objectStore('editor-history').get('current-v4');
        read.onerror = () => resolve(undefined);
        read.onsuccess = () => resolve(read.result);
      };
    }, 100);
  })`);
  parsed.indexedDbHistoryValid = (() => {
    try { return JSON.parse(indexedHistory).version === 4; } catch { return false; }
  })();
  await client.command('Page.navigate', { url: appUrl });
  const reloadDeadline = Date.now() + 10_000;
  while (Date.now() < reloadDeadline) {
    parsed.indexedDbReloaded = await evaluate(client, "document.querySelector('#status')?.textContent?.includes('已自動讀取本機儲存與操作歷史') ?? false");
    if (parsed.indexedDbReloaded) break;
    await delay(100);
  }
  // Exercise real IndexedDB upgrade and damaged-new-save protection in an isolated profile.
  const legacyHistory = JSON.parse(indexedHistory);
  legacyHistory.version = 2;
  for (const snapshot of [legacyHistory.current, ...legacyHistory.undo, ...legacyHistory.redo]) snapshot.schemaVersion = 2;
  const legacySerialized = JSON.stringify(legacyHistory);
  const storageWrite = async (v4, v2, v3 = undefined) => evaluate(client, `new Promise((resolve, reject) => {
    const open = indexedDB.open('hair-atelier', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('editor-history', 'readwrite'), store = tx.objectStore('editor-history');
      // These isolated scenarios seed an older format with no provenance.
      store.delete('localstorage-source-v1');
      ${v4 === undefined ? "store.delete('current-v4');" : `store.put(${JSON.stringify(v4)}, 'current-v4');`}
      ${v3 === undefined ? "store.delete('current-v3');" : `store.put(${JSON.stringify(v3)}, 'current-v3');`}
      ${v2 === undefined ? "store.delete('current-v2');" : `store.put(${JSON.stringify(v2)}, 'current-v2');`}
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => reject(tx.error);
    };
  })`);
  const waitStatus = async (expected) => {
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      if (await evaluate(client, `document.querySelector('#status')?.textContent?.includes(${JSON.stringify(expected)}) ?? false`)) return true;
      await delay(100);
    }
    return false;
  };
  // A v4 save may legitimately contain 20 Undo and 20 Redo snapshots. Undo
  // must move one snapshot without writing an unreadable 21-entry Redo stack
  // or silently discarding any of the other 39 snapshots.
  const capacityBase = await evaluate(client, "import('/src/hair-core.ts').then(module => module.createDemoHairState())");
  const capacityState = (length) => {
    const state = structuredClone(capacityBase);
    state.strands.find((strand) => strand.id === 'C').length = length;
    return state;
  };
  const fullHistory = {
    version: 4,
    current: capacityState(0.3),
    undo: Array.from({ length: 20 }, (_, index) => capacityState(0.1 + index * 0.005)),
    redo: Array.from({ length: 20 }, (_, index) => capacityState(0.31 + index * 0.005)),
  };
  const movedHistory = {
    version: 4,
    current: fullHistory.undo.at(-1),
    undo: fullHistory.undo.slice(0, -1),
    redo: [...fullHistory.redo, fullHistory.current],
  };
  const readCapacityHistory = async () => {
    const value = await evaluate(client, "import('/src/indexeddb-storage.ts').then(module => module.readEditorHistory()).then(result => result.value)");
    try { return JSON.parse(value); } catch { return undefined; }
  };
  const waitCapacityHistory = async (expected) => {
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      const stored = await readCapacityHistory();
      if (isDeepStrictEqual(stored, expected)) return true;
      await delay(100);
    }
    return false;
  };
  await storageWrite(JSON.stringify(fullHistory), legacySerialized);
  await client.command('Page.navigate', { url: appUrl });
  const capacityLoaded = await waitStatus('已自動讀取本機儲存與操作歷史');
  await evaluate(client, "document.querySelector('#undo').click()");
  const capacityUndoSaved = await waitCapacityHistory(movedHistory);
  await client.command('Page.navigate', { url: appUrl });
  const capacityReloaded = await waitStatus('已自動讀取本機儲存與操作歷史');
  await evaluate(client, "document.querySelector('#redo').click()");
  const capacityRedoSaved = await waitCapacityHistory(fullHistory);
  parsed.historyCapacityChecks = { capacityLoaded, capacityUndoSaved, capacityReloaded, capacityRedoSaved };
  parsed.historyCapacityValid = capacityLoaded && capacityUndoSaved && capacityReloaded && capacityRedoSaved;
  // Delay the very first IndexedDB open and try actual controls while a
  // non-default hairstyle is still loading. An early save used to replace it
  // with the default scene before the user saw the saved hairstyle.
  const startupHistory = JSON.parse(indexedHistory);
  startupHistory.current.strands.find((strand) => strand.id === 'C').length = 0.2;
  const startupSerialized = JSON.stringify(startupHistory);
  await storageWrite(startupSerialized, legacySerialized);
  const delayedOpen = await client.command('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
      const request = open.apply(this, args);
      return new Proxy(request, {
        get(target, key) { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; },
        set(target, key, value) {
          if (key === 'onsuccess' && typeof value === 'function') {
            target.onsuccess = (event) => setTimeout(() => value.call(target, event), 3500);
            return true;
          }
          return Reflect.set(target, key, value, target);
        }
      });
    };
  })();` });
  await client.command('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
  await client.command('Page.navigate', { url: appUrl });
  const startupDeadline = Date.now() + 10_000;
  let startupLocked = false;
  while (Date.now() < startupDeadline) {
    startupLocked = await evaluate(client, `!!document.querySelector('#stage canvas') &&
      document.querySelector('#status')?.textContent?.includes('正在讀取本機髮型') &&
      [...document.querySelectorAll('button, input, select')].every((element) => element.disabled)`);
    if (startupLocked) break;
    await delay(25);
  }
  const startupTargets = await evaluate(client, `(() => {
    const point = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    return { save: point('#save'), reset: point('#reset'), stage: point('#stage canvas') };
  })()`);
  await delay(100);
  const beforeStartupGesture = await screenshot(client);
  for (const point of [startupTargets.save, startupTargets.reset]) {
    await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...startupTargets.stage, button: 'left', clickCount: 1 });
  await client.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startupTargets.stage.x + 90, y: startupTargets.stage.y + 30, button: 'left', buttons: 1 });
  await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startupTargets.stage.x + 90, y: startupTargets.stage.y + 30, button: 'left', clickCount: 1 });
  await delay(100);
  const afterStartupGesture = await screenshot(client);
  const startupLoaded = await waitStatus('已自動讀取本機儲存與操作歷史');
  const startupControlsEnabled = await evaluate(client, `['#save', '#reset', '[data-tool=rotate]'].every((selector) => !document.querySelector(selector).disabled)`);
  await evaluate(client, "document.querySelector('[data-tool=rotate]').click()");
  const startupDisplayedSavedLength = await evaluate(client, "document.querySelector('#status').textContent.includes('C：20 cm')");
  const startupStored = await evaluate(client, "import('/src/indexeddb-storage.ts').then(module => module.readEditorHistory()).then(result => result.value)");
  parsed.startupLoadGuardValid = !!(startupLocked && beforeStartupGesture === afterStartupGesture && startupLoaded && startupControlsEnabled && startupDisplayedSavedLength && startupStored === startupSerialized);
  await client.command('Page.removeScriptToEvaluateOnNewDocument', { identifier: delayedOpen.identifier });
  await storageWrite(indexedHistory, legacySerialized);
  await client.command('Page.navigate', { url: appUrl });
  await waitStatus('已自動讀取本機儲存與操作歷史');
  await client.command('Emulation.clearDeviceMetricsOverride');
  // A valid saved root inside the head cannot be routed safely. Verify the
  // app warns without silently rewriting the original history, then recovers
  // when the user loads a normal history in the same page.
  const badRootHistory = JSON.parse(indexedHistory);
  const badRootC = badRootHistory.current.strands.find((strand) => strand.id === 'C');
  Object.assign(badRootC, { root: [0, 0, 0], direction: [0, -1, 0], length: 0.4, maximumLength: 0.6, curls: [] });
  for (const key of ['partingOffset', 'sideSweepOffset', 'earTuck', 'tie', 'braid']) delete badRootC[key];
  const badRootSerialized = JSON.stringify(badRootHistory);
  await client.command('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
  await storageWrite(badRootSerialized, legacySerialized);
  await client.command('Page.navigate', { url: appUrl });
  const badRootLoaded = await waitStatus('已自動讀取本機儲存與操作歷史');
  const warningShown = await evaluate(client, `(() => {
    const warning = document.querySelector('#render-warning');
    return !!warning && !warning.hidden && warning.textContent.includes('1 束') && warning.textContent.includes('無法安全顯示');
  })()`);
  await evaluate(client, "document.querySelector('[data-tool=cut]').click(); document.querySelector('#front').click()");
  const otherControlsWork = await evaluate(client, `(() => {
    const warning = document.querySelector('#render-warning');
    return document.querySelector('#status').textContent.includes('已回到正面視角')
      && document.querySelector('[data-tool=cut]').classList.contains('active')
      && !!warning && !warning.hidden && document.documentElement.scrollHeight <= window.innerHeight;
  })()`);
  // Probe the raw centreline below the head using actual pointer events. A
  // separate valid-root control verifies these coordinates can hit C.
  const hiddenCandidates = await evaluate(client, `(() => {
    const r = document.querySelector('#stage canvas').getBoundingClientRect();
    const focal = r.height / (2 * Math.tan(35 * Math.PI / 360));
    return [0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38].map(s => ({
      x: r.left + r.width / 2,
      y: r.top + r.height / 2 + (0.05 + s) * focal / 1.35
    })).filter(p => p.x >= r.left + 3 && p.x <= r.right - 3 && p.y >= r.top + 3 && p.y <= r.bottom - 3);
  })()`);
  let hiddenPickBlocked = hiddenCandidates.length > 0;
  for (const point of hiddenCandidates) {
    await client.command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    hiddenPickBlocked &&= await evaluate(client, "document.querySelector('#metric-selected').textContent !== 'C'");
  }
  await evaluate(client, "document.querySelector('#save').click()");
  const badRootSaved = await waitStatus('已儲存到本機瀏覽器');
  const retainedBadRoot = await evaluate(client, "import('/src/indexeddb-storage.ts').then(module => module.readEditorHistory()).then(result => result.value)");
  const validRootControl = structuredClone(badRootHistory);
  Object.assign(validRootControl.current.strands.find((strand) => strand.id === 'C'), { root: [0, -0.25, 0], length: 0.15, maximumLength: 0.2 });
  await storageWrite(JSON.stringify(validRootControl), legacySerialized);
  await evaluate(client, "document.querySelector('#load').click()");
  const controlLoaded = await waitStatus('已讀取本機儲存與操作歷史');
  let validPickObserved = false;
  for (const point of hiddenCandidates) {
    await client.command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    validPickObserved ||= await evaluate(client, "document.querySelector('#metric-selected').textContent === 'C'");
  }
  await storageWrite(indexedHistory, legacySerialized);
  await evaluate(client, "document.querySelector('#load').click()");
  const normalLoaded = await waitStatus('已讀取本機儲存與操作歷史');
  const warningCleared = await evaluate(client, "!!document.querySelector('#render-warning') && document.querySelector('#render-warning').hidden");
  const restoredHistory = await evaluate(client, "import('/src/indexeddb-storage.ts').then(module => module.readEditorHistory()).then(result => result.value)");
  parsed.collisionFailureGuardValid = !!(badRootLoaded && warningShown && otherControlsWork && hiddenPickBlocked && badRootSaved
    && retainedBadRoot === badRootSerialized && controlLoaded && validPickObserved && normalLoaded && warningCleared && restoredHistory === indexedHistory);
  await client.command('Emulation.clearDeviceMetricsOverride');
  const v3History = JSON.parse(indexedHistory);
  v3History.version = 3;
  for (const snapshot of [v3History.current, ...v3History.undo, ...v3History.redo]) snapshot.schemaVersion = 3;
  const v3Serialized = JSON.stringify(v3History);
  await storageWrite(undefined, legacySerialized, v3Serialized);
  await client.command('Page.navigate', { url: appUrl });
  parsed.v3IndexedDbLoaded = await waitStatus('已自動讀取本機儲存與操作歷史');
  await evaluate(client, "document.querySelector('#save').click()");
  parsed.v3UpgradeSaved = await waitStatus('已儲存到本機瀏覽器');
  const migrationKeys = await evaluate(client, `new Promise((resolve, reject) => {
    const open = indexedDB.open('hair-atelier', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('editor-history', 'readonly'), store = tx.objectStore('editor-history');
      const v2 = store.get('current-v2'), v3 = store.get('current-v3'), v4 = store.get('current-v4');
      tx.oncomplete = () => { db.close(); resolve({ v2: v2.result, v3: v3.result, v4: v4.result }); };
      tx.onerror = () => reject(tx.error);
    };
  })`);
  parsed.v3UpgradeSaved = parsed.v3UpgradeSaved && migrationKeys.v2 === legacySerialized && migrationKeys.v3 === v3Serialized && JSON.parse(migrationKeys.v4).version === 4;
  await storageWrite(undefined, legacySerialized, '{damaged-v3');
  await client.command('Page.navigate', { url: appUrl });
  parsed.corruptV3Protected = await waitStatus('已暫停自動儲存以保護資料');
  await evaluate(client, "document.querySelector('#save').click()");
  await waitStatus('瀏覽器拒絕本機儲存');
  const corruptV3 = await evaluate(client, `new Promise((resolve, reject) => {
    const open = indexedDB.open('hair-atelier', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('editor-history', 'readonly'), store = tx.objectStore('editor-history');
      const v3 = store.get('current-v3'), v4 = store.get('current-v4');
      tx.oncomplete = () => { db.close(); resolve({ v3: v3.result, v4: v4.result }); };
      tx.onerror = () => reject(tx.error);
    };
  })`);
  parsed.corruptV3Protected &&= corruptV3.v3 === '{damaged-v3' && corruptV3.v4 === undefined;
  await storageWrite(undefined, legacySerialized);
  await client.command('Page.navigate', { url: appUrl });
  parsed.legacyIndexedDbLoaded = await waitStatus('已自動讀取本機儲存與操作歷史');
  await evaluate(client, "document.querySelector('#save').click()");
  parsed.legacyUpgradeSaved = await waitStatus('已儲存到本機瀏覽器');
  const upgradedKeys = JSON.parse(await evaluate(client, `new Promise((resolve, reject) => {
    const open = indexedDB.open('hair-atelier', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('editor-history', 'readonly'), store = tx.objectStore('editor-history');
      const v2 = store.get('current-v2'), v4 = store.get('current-v4');
      tx.oncomplete = () => { db.close(); resolve(JSON.stringify({ v2: v2.result, v4: v4.result })); };
      tx.onerror = () => reject(tx.error);
    };
  })`));
  parsed.legacyUpgradeSaved = parsed.legacyUpgradeSaved && upgradedKeys.v2 === legacySerialized && JSON.parse(upgradedKeys.v4).version === 4;
  await storageWrite('{damaged-v4', legacySerialized);
  await client.command('Page.navigate', { url: appUrl });
  parsed.corruptStorageProtected = await waitStatus('已暫停自動儲存以保護資料');
  await evaluate(client, "document.querySelector('#reset').click(); document.querySelector('#save').click()");
  await waitStatus('瀏覽器拒絕本機儲存');
  parsed.storageWarningVisible = await evaluate(client, "!document.querySelector('#storage-warning').hidden");
  const protectedValue = await evaluate(client, `new Promise((resolve, reject) => {
    const open = indexedDB.open('hair-atelier', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('editor-history', 'readonly').objectStore('editor-history').get('current-v4');
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    };
  })`);
  parsed.corruptStorageProtected = parsed.corruptStorageProtected && protectedValue === '{damaged-v4';
  // A transient startup read failure must protect existing data, but a later
  // successful explicit Load should allow edits to be saved in this page.
  await storageWrite(startupSerialized, legacySerialized);
  const failOpen = await client.command('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function () { throw new Error('Simulated temporary IndexedDB failure'); };
    globalThis.__restoreHairStorageOpen = () => { IDBFactory.prototype.open = original; };
  })();` });
  await client.command('Page.navigate', { url: appUrl });
  const temporaryFailureWarned = await waitStatus('本機儲存暫時無法讀取');
  await evaluate(client, 'globalThis.__restoreHairStorageOpen()');
  await client.command('Page.removeScriptToEvaluateOnNewDocument', { identifier: failOpen.identifier });
  const afterTemporaryFailure = await evaluate(client, "import('/src/indexeddb-storage.ts').then(module => module.readEditorHistory()).then(result => result.value)");
  await evaluate(client, "document.querySelector('#load').click()");
  const recoveredLoad = await waitStatus('已讀取本機儲存與操作歷史');
  const recoveredView = await evaluate(client, `document.querySelector('#status')?.textContent?.includes('已讀取本機儲存與操作歷史') && document.querySelector('#storage-warning').hidden`);
  await evaluate(client, "document.querySelector('#reset').click(); document.querySelector('#save').click()");
  const recoveredSaveDeadline = Date.now() + 5_000;
  let recoveredSave = false;
  while (Date.now() < recoveredSaveDeadline) {
    const saveStatus = await evaluate(client, "document.querySelector('#status')?.textContent ?? ''");
    if (saveStatus.includes('已儲存到本機瀏覽器')) { recoveredSave = true; break; }
    if (saveStatus.includes('瀏覽器拒絕本機儲存')) break;
    await delay(100);
  }
  const recoveredHistory = await evaluate(client, "import('/src/indexeddb-storage.ts').then(module => module.readEditorHistory()).then(result => result.value)");
  let savedResetLength = false;
  try { savedResetLength = JSON.parse(recoveredHistory).current.strands.find((strand) => strand.id === 'C').length === 0.4; } catch { /* Invalid or missing history fails the assertion. */ }
  await client.command('Page.navigate', { url: appUrl });
  const recoveredReload = await waitStatus('已自動讀取本機儲存與操作歷史');
  await evaluate(client, "document.querySelector('[data-tool=rotate]').click()");
  const recoveredReloadLength = await evaluate(client, "document.querySelector('#status')?.textContent?.includes('C：40 cm') ?? false");
  parsed.storageRecoveryChecks = { temporaryFailureWarned, dataPreserved: afterTemporaryFailure === startupSerialized,
    recoveredLoad, recoveredView, recoveredSave, savedResetLength, recoveredReload, recoveredReloadLength };
  parsed.storageRecoveryValid = !!(temporaryFailureWarned && afterTemporaryFailure === startupSerialized && recoveredLoad && recoveredView
    && recoveredSave && savedResetLength && recoveredReload && recoveredReloadLength);
  const oversizedHistory = JSON.parse(indexedHistory);
  oversizedHistory.undo.push(structuredClone(oversizedHistory.current));
  oversizedHistory.undo.at(-1).strands[0].maximumLength = 1e100;
  const oversizedSerialized = JSON.stringify(oversizedHistory);
  await storageWrite(oversizedSerialized, legacySerialized);
  await client.command('Page.navigate', { url: appUrl });
  const preflightDeadline = Date.now() + 10_000;
  while (Date.now() < preflightDeadline) {
    parsed.oversizedStorageProtected = await evaluate(client, "document.querySelector('#storage-warning')?.textContent?.includes('暫不能安全顯示存檔') ?? false");
    if (parsed.oversizedStorageProtected) break;
    await delay(100);
  }
  await evaluate(client, "document.querySelector('#reset').click(); document.querySelector('#save').click()");
  await waitStatus('瀏覽器拒絕本機儲存');
  const afterOversized = await evaluate(client, `new Promise((resolve, reject) => {
    const open = indexedDB.open('hair-atelier', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, read = db.transaction('editor-history', 'readonly').objectStore('editor-history').get('current-v4');
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => reject(read.error);
    };
  })`);
  parsed.oversizedStorageProtected = parsed.oversizedStorageProtected && afterOversized === oversizedSerialized;
  await storageWrite(indexedHistory, legacySerialized);
  await client.command('Page.navigate', { url: appUrl });
  await waitStatus('已自動讀取本機儲存與操作歷史');
  const created = await client.command('Target.createTarget', { url: appUrl });
  const secondTarget = (await (await waitFor(`${debugUrl}/json/list`)).json()).find((item) => item.id === created.targetId);
  secondClient = new DevToolsClient(secondTarget.webSocketDebuggerUrl);
  await secondClient.connect();
  await secondClient.command('Runtime.enable');
  const storageModule = `import('/src/indexeddb-storage.ts')`;
  // Capture the localStorage source as the application does; otherwise a
  // rejection could merely mean "missing guard" rather than a real IDB race.
  const guardedRead = (target) => evaluate(target, `${storageModule}.then(async module => {
    const read = await module.readEditorHistory();
    const persisted = read.localDigest !== undefined;
    const format = !persisted ? undefined : typeof read.localDigest === 'string' && read.localDigest.startsWith('raw:') ? 'raw' : 'sha256';
    const localGuard = await module.makeLegacyGuard(module.snapshotLegacyLocalStorage(), persisted, format);
    if (persisted && localGuard.digest !== read.localDigest) throw new Error('Invalid test source marker');
    return { ...read, token: { ...read.token, localGuard } };
  })`);
  await storageWrite(undefined, legacySerialized, v3Serialized);
  const v3Read = await guardedRead(client);
  await storageWrite(undefined, legacySerialized, v3Serialized + ' ');
  parsed.v3RaceRejected = await evaluate(secondClient, `${storageModule}.then(async module => {
    try { await module.writeEditorHistory(${JSON.stringify(indexedHistory)}, ${JSON.stringify(v3Read.token)}); return false; }
    catch (error) { return error instanceof module.StorageConflictError; }
  })`);
  const afterV3Race = await evaluate(client, `${storageModule}.then(module => module.readEditorHistory())`);
  parsed.v3RaceRejected = parsed.v3RaceRejected && afterV3Race.token.current === undefined && afterV3Race.value === v3Serialized + ' ';
  await storageWrite(undefined, legacySerialized);
  const legacyRead = await guardedRead(client);
  await storageWrite(undefined, legacySerialized + ' ');
  parsed.legacyRaceRejected = await evaluate(secondClient, `${storageModule}.then(async module => {
    try { await module.writeEditorHistory(${JSON.stringify(indexedHistory)}, ${JSON.stringify(legacyRead.token)}); return false; }
    catch (error) { return error instanceof module.StorageConflictError; }
  })`);
  const afterLegacyRace = await evaluate(client, `${storageModule}.then(module => module.readEditorHistory())`);
  parsed.legacyRaceRejected = parsed.legacyRaceRejected && afterLegacyRace.token.current === undefined && afterLegacyRace.value === legacySerialized + ' ';
  await storageWrite(indexedHistory, legacySerialized);
  const bareRead = await evaluate(client, `${storageModule}.then(module => module.readEditorHistory())`);
  parsed.missingGuardRejected = await evaluate(secondClient, `${storageModule}.then(async module => {
    try { await module.writeEditorHistory(${JSON.stringify(indexedHistory + ' unguarded')}, ${JSON.stringify(bareRead.token)}); return false; }
    catch (error) { return error instanceof module.StorageConflictError; }
  })`);
  const afterMissingGuard = await evaluate(client, `${storageModule}.then(module => module.readEditorHistory())`);
  parsed.missingGuardRejected = parsed.missingGuardRejected && afterMissingGuard.value === indexedHistory && afterMissingGuard.localDigest === undefined;
  const firstRead = await guardedRead(client);
  const secondRead = await guardedRead(secondClient);
  await evaluate(client, `${storageModule}.then(module => module.writeEditorHistory(${JSON.stringify(indexedHistory + ' ')}, ${JSON.stringify(firstRead.token)}))`);
  parsed.secondTabWriteRejected = await evaluate(secondClient, `${storageModule}.then(async module => {
    try { await module.writeEditorHistory(${JSON.stringify(indexedHistory)}, ${JSON.stringify(secondRead.token)}); return false; }
    catch (error) { return error instanceof module.StorageConflictError; }
  })`);
  const afterConflict = await evaluate(client, `${storageModule}.then(module => module.readEditorHistory())`);
  parsed.secondTabWriteRejected = parsed.secondTabWriteRejected && afterConflict.value === indexedHistory + ' ';
  // The first page now has a stale token. Its failed save must not be
  // discarded by Load unless the user explicitly confirms.
  await evaluate(client, "document.querySelector('#reset').click(); document.querySelector('#save').click()");
  const firstConflictWarned = await waitStatus('瀏覽器拒絕本機儲存');
  await evaluate(client, "window.__confirmCount = 0; window.confirm = () => { window.__confirmCount++; return false; }; document.querySelector('#load').click()");
  const loadCancelled = await waitStatus('已取消讀取；保留目前髮型');
  const declinedConfirm = await evaluate(client, 'window.__confirmCount === 1 && !document.querySelector("#storage-warning").hidden');
  await evaluate(client, "window.confirm = () => { window.__confirmCount++; return true; }; document.querySelector('#load').click()");
  const loadConfirmed = await waitStatus('已讀取本機儲存與操作歷史');
  await evaluate(client, "document.querySelector('#save').click()");
  const saveAfterLoad = await waitStatus('已儲存到本機瀏覽器');
  parsed.unsavedLoadGuardValid = firstConflictWarned && loadCancelled && declinedConfirm && loadConfirmed && saveAfterLoad;
  secondClient.close();
  secondClient = undefined;
  await client.command('Target.closeTarget', { targetId: created.targetId });
  await client.command('Page.bringToFront');
  await storageWrite(indexedHistory, legacySerialized);
  await client.command('Page.navigate', { url: appUrl });
  await waitStatus('已自動讀取本機儲存與操作歷史');
  // Exercise the long-tail framing and an actual cut in the running app.
  const longHistory = JSON.parse(indexedHistory);
  const longC = longHistory.current.strands.find((strand) => strand.id === 'C');
  longC.length = 2; longC.maximumLength = 2; longC.curls = [];
  longHistory.undo = []; longHistory.redo = [];
  await storageWrite(JSON.stringify(longHistory), legacySerialized);
  await client.command('Page.navigate', { url: appUrl });
  await waitStatus('已自動讀取本機儲存與操作歷史');
  await evaluate(client, "document.querySelector('#front').click()");
  const longStage = await evaluate(client, `(() => { const r = document.querySelector('#stage canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  await client.command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const centerX = longStage.left + longStage.width / 2;
  const startY = longStage.top + longStage.height * 0.75;
  const drag = longStage.height * 0.48;
  for (let i = 0; i < 4; i += 1) {
    await client.command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: centerX - 25, y: startY, id: 1 }, { x: centerX + 25, y: startY, id: 2 }] });
    await client.command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: centerX - 25, y: startY - drag, id: 1 }, { x: centerX + 25, y: startY - drag, id: 2 }] });
    await client.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await client.command('Emulation.setTouchEmulationEnabled', { enabled: false });
  await evaluate(client, "document.querySelector('[data-tool=cut]').click()");
  const cameraY = Math.max(-2.2, 0.05 - 4 * drag * 2 * 1.35 * Math.tan(35 * Math.PI / 360) / longStage.height);
  const focalPixels = longStage.height / (2 * Math.tan(35 * Math.PI / 360));
  const tail = { x: centerX + 0.05 * focalPixels / 1.30, y: longStage.top + longStage.height / 2 + (cameraY - (0.25 - 1.8)) * focalPixels / 1.30 };
  await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...tail, button: 'left', clickCount: 1 });
  await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tail.x + 12, y: tail.y, button: 'left', clickCount: 1 });
  parsed.longTailPanCutValid = await evaluate(client, "document.querySelector('#status').textContent.includes('一次剪短') && document.querySelector('#status').textContent.includes('C')");
  await evaluate(client, "document.querySelector('#undo').click()");
  parsed.longTailPanCutValid &&= await evaluate(client, "document.querySelector('#status').textContent.includes('C：200 cm')");
  await storageWrite(indexedHistory, legacySerialized);
  await client.command('Page.navigate', { url: appUrl });
  await waitStatus('已自動讀取本機儲存與操作歷史');
  // Seed an existing curl, then use actual UI hit testing and drag to re-curl its middle.
  const recurlHistory = JSON.parse(indexedHistory);
  const recurlC = recurlHistory.current.strands.find((strand) => strand.id === 'C');
  recurlC.curls = [{ startS: 0.04, endS: 0.6, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1, orientationMode: 'phase-v1' }];
  recurlHistory.undo = []; recurlHistory.redo = [];
  await storageWrite(JSON.stringify(recurlHistory), legacySerialized);
  await client.command('Page.navigate', { url: appUrl });
  await waitStatus('已自動讀取本機儲存與操作歷史');
  await evaluate(client, "document.querySelector('#front').click(); document.querySelector('[data-tool=cut]').click()");
  const recurlCandidates = await evaluate(client, `import('/src/visible-hair.ts').then(module => {
    const strand = ${JSON.stringify(recurlC)};
    const collider = { center: [0,0,0], radii: [0.22,0.2464,0.2024], clearance: 0.018 };
    const r = document.querySelector('#stage canvas').getBoundingClientRect();
    const focal = r.height / (2 * Math.tan(35 * Math.PI / 360));
    return module.visibleHairSamples(strand, collider).filter(v => v.s >= 0.08 && v.s <= 0.29).map(v => ({
      x: r.left + r.width / 2 + v.point[0] * focal / (1.35 - v.point[2]),
      y: r.top + r.height / 2 - (v.point[1] - 0.05) * focal / (1.35 - v.point[2])
    })).filter(p => p.x >= r.left + 3 && p.x <= r.right - 20 && p.y >= r.top + 3 && p.y <= r.bottom - 3);
  })`);
  let recurlPoint;
  for (const point of recurlCandidates) {
    await client.command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    const target = await evaluate(client, `({ id: document.querySelector('#metric-selected').textContent, s: parseFloat(document.querySelector('#metric-cut').textContent) })`);
    if (target.id === 'C' && target.s >= 8 && target.s <= 29) { recurlPoint = point; break; }
  }
  parsed.middleRecurlFlowValid = false;
  if (recurlPoint) {
    await evaluate(client, "document.querySelector('#more-tools').click(); document.querySelector('#curl-span').value = '0.05'; document.querySelector('#close-tools').click(); document.querySelector('[data-tool=curl]').click()");
    await client.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...recurlPoint, button: 'left', clickCount: 1 });
    await client.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: recurlPoint.x + 12, y: recurlPoint.y, button: 'left', buttons: 1 });
    await client.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: recurlPoint.x + 12, y: recurlPoint.y, button: 'left', clickCount: 1 });
    const didRecurl = await evaluate(client, "document.querySelector('#status').textContent.includes('已捲曲 C')");
    const waitCurls = async (expected) => {
      const until = Date.now() + 10_000;
      while (Date.now() < until) {
        const saved = await evaluate(client, `${storageModule}.then(module => module.readEditorHistory())`);
        try {
          const history = JSON.parse(saved.value), c = history.current.strands.find((strand) => strand.id === 'C');
          if (c.curls.length === expected) return history;
        } catch { /* Wait for the queued write. */ }
        await delay(100);
      }
      return undefined;
    };
    const modified = await waitCurls(3);
    const c = modified?.current.strands.find((strand) => strand.id === 'C');
    const segmentsValid = c && Math.abs((c.curls[1].endS - c.curls[1].startS) - 0.05) < 1e-8 && Number.isFinite(c.curls[2].frameRoll)
      && JSON.stringify(modified.current.strands.filter((strand) => strand.id !== 'C')) === JSON.stringify(recurlHistory.current.strands.filter((strand) => strand.id !== 'C'));
    await evaluate(client, "document.querySelector('#undo').click()");
    const undone = await waitCurls(1);
    await evaluate(client, "document.querySelector('#redo').click()");
    const redone = await waitCurls(3);
    await client.command('Page.navigate', { url: appUrl });
    const reloaded = await waitStatus('已自動讀取本機儲存與操作歷史');
    const loadedHistory = await evaluate(client, `${storageModule}.then(module => module.readEditorHistory())`);
    let sameAfterReload = false;
    try { sameAfterReload = JSON.stringify(JSON.parse(loadedHistory.value).current) === JSON.stringify(redone?.current); } catch { /* Invalid data fails the assertion. */ }
    parsed.middleRecurlFlowValid = !!(didRecurl && segmentsValid && undone && redone && reloaded && sameAfterReload);
  }
  await storageWrite(indexedHistory, legacySerialized);
  await client.command('Page.navigate', { url: appUrl });
  await waitStatus('已自動讀取本機儲存與操作歷史');
  parsed.serviceWorkerControlled = await evaluate(client, 'navigator.serviceWorker.ready.then(() => Boolean(navigator.serviceWorker.controller))');
  await client.command('Network.enable');
  await client.command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  try {
    await client.command('Page.navigate', { url: appUrl });
    const offlineDeadline = Date.now() + 10_000;
    while (Date.now() < offlineDeadline) {
      parsed.offlineCanvasLoaded = await evaluate(client, "document.querySelectorAll('#stage canvas').length === 1");
      if (parsed.offlineCanvasLoaded) break;
      await delay(100);
    }
  } finally {
    await client.command('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
  parsed.consoleErrors = consoleErrors.filter((message) => !message.startsWith('[vite] failed to connect to websocket.'));
  if (parsed.canvasCount !== 1 || parsed.overlayLabel !== 'Rest arc s' || parsed.status === '載入 3D 髮束中' || !parsed.startupReady || !parsed.touchTargetsValid || parsed.stageTouchAction !== 'none' || !parsed.rotateVisualChanged || !parsed.pinchVisualChanged || !parsed.pinchResumeValid || !parsed.zeroDistancePinchValid || !parsed.twoFingerPanValid || !parsed.longTailPanCutValid || !parsed.toolSwitchCancelsGesture || !parsed.tapCancellationValid || !parsed.cutReleaseSweepValid || !parsed.phoneLayoutValid || !parsed.curlSpanControlValid || !parsed.middleRecurlFlowValid || !parsed.collisionFailureGuardValid || !parsed.startupLoadGuardValid || !parsed.tabletLayoutValid || !parsed.indexedDbHistoryValid || !parsed.indexedDbReloaded || !parsed.historyCapacityValid || !parsed.legacyIndexedDbLoaded || !parsed.legacyUpgradeSaved || !parsed.v3IndexedDbLoaded || !parsed.v3UpgradeSaved || !parsed.corruptV3Protected || !parsed.v3RaceRejected || !parsed.corruptStorageProtected || !parsed.storageRecoveryValid || !parsed.oversizedStorageProtected || !parsed.storageWarningVisible || !parsed.secondTabWriteRejected || !parsed.missingGuardRejected || !parsed.legacyRaceRejected || !parsed.unsavedLoadGuardValid || !parsed.serviceWorkerControlled || !parsed.offlineCanvasLoaded || parsed.errors.length > 0 || parsed.consoleErrors.length > 0) {
    throw new Error(`Browser smoke failed: ${JSON.stringify(parsed)}`);
  }
  console.log(`Browser smoke passed: canvas=${parsed.canvasCount}, overlay=${parsed.overlayLabel}, touchTargetsValid=${parsed.touchTargetsValid}, stageTouchAction=${parsed.stageTouchAction}, rotateVisualChanged=${parsed.rotateVisualChanged}, pinchVisualChanged=${parsed.pinchVisualChanged}, pinchResumeValid=${parsed.pinchResumeValid}, zeroDistancePinchValid=${parsed.zeroDistancePinchValid}, twoFingerPanValid=${parsed.twoFingerPanValid}, longTailPanCutValid=${parsed.longTailPanCutValid}, toolSwitchCancelsGesture=${parsed.toolSwitchCancelsGesture}, tapCancellationValid=${parsed.tapCancellationValid}, cutReleaseSweepValid=${parsed.cutReleaseSweepValid}, phoneLayoutValid=${parsed.phoneLayoutValid}, curlSpanControlValid=${parsed.curlSpanControlValid}, middleRecurlFlowValid=${parsed.middleRecurlFlowValid}, collisionFailureGuardValid=${parsed.collisionFailureGuardValid}, startupLoadGuardValid=${parsed.startupLoadGuardValid}, tabletLayoutValid=${parsed.tabletLayoutValid}, indexedDbHistoryValid=${parsed.indexedDbHistoryValid}, indexedDbReloaded=${parsed.indexedDbReloaded}, historyCapacityValid=${parsed.historyCapacityValid}, v3IndexedDbLoaded=${parsed.v3IndexedDbLoaded}, v3UpgradeSaved=${parsed.v3UpgradeSaved}, corruptV3Protected=${parsed.corruptV3Protected}, v3RaceRejected=${parsed.v3RaceRejected}, legacyIndexedDbLoaded=${parsed.legacyIndexedDbLoaded}, legacyUpgradeSaved=${parsed.legacyUpgradeSaved}, corruptStorageProtected=${parsed.corruptStorageProtected}, storageRecoveryValid=${parsed.storageRecoveryValid}, oversizedStorageProtected=${parsed.oversizedStorageProtected}, storageWarningVisible=${parsed.storageWarningVisible}, secondTabWriteRejected=${parsed.secondTabWriteRejected}, missingGuardRejected=${parsed.missingGuardRejected}, legacyRaceRejected=${parsed.legacyRaceRejected}, unsavedLoadGuardValid=${parsed.unsavedLoadGuardValid}, serviceWorkerControlled=${parsed.serviceWorkerControlled}, offlineCanvasLoaded=${parsed.offlineCanvasLoaded}, status=${parsed.status}`);
} finally {
  secondClient?.close();
  client?.close();
  await stop(chrome);
  await stop(vite);
  if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
