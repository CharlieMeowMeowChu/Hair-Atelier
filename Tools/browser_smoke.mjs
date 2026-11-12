import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

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
      touchTargetsValid: [...document.querySelectorAll('button, select')].every((element) => getComputedStyle(element).minHeight === '44px' || element.getBoundingClientRect().height >= 44),
      stageTouchAction: document.querySelector('#stage') ? getComputedStyle(document.querySelector('#stage')).touchAction : undefined,
      errors: globalThis.__hairAtelierSmokeErrors ?? [],
    })`);
    const parsed = JSON.parse(state);
    if (parsed.canvasCount === 1 && parsed.overlayLabel === 'Rest arc s' && parsed.status !== '載入 3D 髮束中' && parsed.touchTargetsValid && parsed.stageTouchAction === 'none') break;
    await delay(100);
  }
  const parsed = JSON.parse(state ?? '{}');
  const phoneViewport = JSON.parse(await evaluate(client, `JSON.stringify({ scrollFitsViewport: document.documentElement.scrollHeight <= window.innerHeight, primaryToolCount: document.querySelectorAll('.tools:not(.drawer-tools) [data-tool]').length, moreToolsOpens: Boolean(document.querySelector('#more-tools') && document.querySelector('#tool-drawer')) })`));
  parsed.phoneLayoutValid = phoneViewport.scrollFitsViewport && phoneViewport.primaryToolCount === 7 && phoneViewport.moreToolsOpens;
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
        const read = request.result.transaction('editor-history', 'readonly').objectStore('editor-history').get('current-v3');
        read.onerror = () => resolve(undefined);
        read.onsuccess = () => resolve(read.result);
      };
    }, 100);
  })`);
  parsed.indexedDbHistoryValid = (() => {
    try { return JSON.parse(indexedHistory).version === 3; } catch { return false; }
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
  const storageWrite = async (v3, v2) => evaluate(client, `new Promise((resolve, reject) => {
    const open = indexedDB.open('hair-atelier', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('editor-history', 'readwrite'), store = tx.objectStore('editor-history');
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
      const v2 = store.get('current-v2'), v3 = store.get('current-v3');
      tx.oncomplete = () => { db.close(); resolve(JSON.stringify({ v2: v2.result, v3: v3.result })); };
      tx.onerror = () => reject(tx.error);
    };
  })`));
  parsed.legacyUpgradeSaved = parsed.legacyUpgradeSaved && upgradedKeys.v2 === legacySerialized && JSON.parse(upgradedKeys.v3).version === 3;
  await storageWrite('{damaged-v3', legacySerialized);
  await client.command('Page.navigate', { url: appUrl });
  parsed.corruptStorageProtected = await waitStatus('已暫停自動儲存以保護資料');
  await evaluate(client, "document.querySelector('#reset').click(); document.querySelector('#save').click()");
  await waitStatus('瀏覽器拒絕本機儲存');
  parsed.storageWarningVisible = await evaluate(client, "!document.querySelector('#storage-warning').hidden");
  const protectedValue = await evaluate(client, `new Promise((resolve, reject) => {
    const open = indexedDB.open('hair-atelier', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('editor-history', 'readonly').objectStore('editor-history').get('current-v3');
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    };
  })`);
  parsed.corruptStorageProtected = parsed.corruptStorageProtected && protectedValue === '{damaged-v3';
  await storageWrite(indexedHistory, legacySerialized);
  await client.command('Page.navigate', { url: appUrl });
  await waitStatus('已自動讀取本機儲存與操作歷史');
  const created = await client.command('Target.createTarget', { url: appUrl });
  const secondTarget = (await (await waitFor(`${debugUrl}/json/list`)).json()).find((item) => item.id === created.targetId);
  secondClient = new DevToolsClient(secondTarget.webSocketDebuggerUrl);
  await secondClient.connect();
  await secondClient.command('Runtime.enable');
  const storageModule = `import('/src/indexeddb-storage.ts')`;
  await storageWrite(undefined, legacySerialized);
  const legacyRead = await evaluate(client, `${storageModule}.then(module => module.readEditorHistory())`);
  await storageWrite(undefined, legacySerialized + ' ');
  parsed.legacyRaceRejected = await evaluate(secondClient, `${storageModule}.then(async module => {
    try { await module.writeEditorHistory(${JSON.stringify(indexedHistory)}, ${JSON.stringify(legacyRead.token)}); return false; }
    catch (error) { return error instanceof module.StorageConflictError; }
  })`);
  const afterLegacyRace = await evaluate(client, `${storageModule}.then(module => module.readEditorHistory())`);
  parsed.legacyRaceRejected = parsed.legacyRaceRejected && afterLegacyRace.token.current === undefined && afterLegacyRace.value === legacySerialized + ' ';
  await storageWrite(indexedHistory, legacySerialized);
  const firstRead = await evaluate(client, `${storageModule}.then(module => module.readEditorHistory())`);
  const secondRead = await evaluate(secondClient, `${storageModule}.then(module => module.readEditorHistory())`);
  await evaluate(client, `${storageModule}.then(module => module.writeEditorHistory(${JSON.stringify(indexedHistory + ' ')}, ${JSON.stringify(firstRead.token)}))`);
  parsed.secondTabWriteRejected = await evaluate(secondClient, `${storageModule}.then(async module => {
    try { await module.writeEditorHistory(${JSON.stringify(indexedHistory)}, ${JSON.stringify(secondRead.token)}); return false; }
    catch (error) { return error instanceof module.StorageConflictError; }
  })`);
  const afterConflict = await evaluate(client, `${storageModule}.then(module => module.readEditorHistory())`);
  parsed.secondTabWriteRejected = parsed.secondTabWriteRejected && afterConflict.value === indexedHistory + ' ';
  secondClient.close();
  secondClient = undefined;
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
  if (parsed.canvasCount !== 1 || parsed.overlayLabel !== 'Rest arc s' || parsed.status === '載入 3D 髮束中' || !parsed.touchTargetsValid || parsed.stageTouchAction !== 'none' || !parsed.rotateVisualChanged || !parsed.pinchVisualChanged || !parsed.toolSwitchCancelsGesture || !parsed.phoneLayoutValid || !parsed.tabletLayoutValid || !parsed.indexedDbHistoryValid || !parsed.indexedDbReloaded || !parsed.legacyIndexedDbLoaded || !parsed.legacyUpgradeSaved || !parsed.corruptStorageProtected || !parsed.storageWarningVisible || !parsed.secondTabWriteRejected || !parsed.legacyRaceRejected || !parsed.serviceWorkerControlled || !parsed.offlineCanvasLoaded || parsed.errors.length > 0 || parsed.consoleErrors.length > 0) {
    throw new Error(`Browser smoke failed: ${JSON.stringify(parsed)}`);
  }
  console.log(`Browser smoke passed: canvas=${parsed.canvasCount}, overlay=${parsed.overlayLabel}, touchTargetsValid=${parsed.touchTargetsValid}, stageTouchAction=${parsed.stageTouchAction}, rotateVisualChanged=${parsed.rotateVisualChanged}, pinchVisualChanged=${parsed.pinchVisualChanged}, toolSwitchCancelsGesture=${parsed.toolSwitchCancelsGesture}, phoneLayoutValid=${parsed.phoneLayoutValid}, tabletLayoutValid=${parsed.tabletLayoutValid}, indexedDbHistoryValid=${parsed.indexedDbHistoryValid}, indexedDbReloaded=${parsed.indexedDbReloaded}, legacyIndexedDbLoaded=${parsed.legacyIndexedDbLoaded}, legacyUpgradeSaved=${parsed.legacyUpgradeSaved}, corruptStorageProtected=${parsed.corruptStorageProtected}, storageWarningVisible=${parsed.storageWarningVisible}, secondTabWriteRejected=${parsed.secondTabWriteRejected}, legacyRaceRejected=${parsed.legacyRaceRejected}, serviceWorkerControlled=${parsed.serviceWorkerControlled}, offlineCanvasLoaded=${parsed.offlineCanvasLoaded}, status=${parsed.status}`);
} finally {
  secondClient?.close();
  client?.close();
  await stop(chrome);
  await stop(vite);
  if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
