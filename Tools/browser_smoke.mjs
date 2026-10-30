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
      stageTouchAction: getComputedStyle(document.querySelector('#stage')).touchAction,
      errors: globalThis.__hairAtelierSmokeErrors ?? [],
    })`);
    const parsed = JSON.parse(state);
    if (parsed.canvasCount === 1 && parsed.overlayLabel === 'Rest arc s' && parsed.status !== '載入 3D 髮束中' && parsed.touchTargetsValid && parsed.stageTouchAction === 'none') break;
    await delay(100);
  }
  const parsed = JSON.parse(state ?? '{}');
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
  const indexedHistory = await evaluate(client, `new Promise((resolve) => {
    document.querySelector('#save')?.click();
    setTimeout(() => {
      const request = indexedDB.open('hair-atelier', 1);
      request.onerror = () => resolve(undefined);
      request.onsuccess = () => {
        const read = request.result.transaction('editor-history', 'readonly').objectStore('editor-history').get('current-v2');
        read.onerror = () => resolve(undefined);
        read.onsuccess = () => resolve(read.result);
      };
    }, 100);
  })`);
  parsed.indexedDbHistoryValid = (() => {
    try { return JSON.parse(indexedHistory).version === 2; } catch { return false; }
  })();
  await client.command('Page.navigate', { url: appUrl });
  const reloadDeadline = Date.now() + 10_000;
  while (Date.now() < reloadDeadline) {
    parsed.indexedDbReloaded = await evaluate(client, "document.querySelector('#status')?.textContent?.includes('已自動讀取本機儲存與操作歷史') ?? false");
    if (parsed.indexedDbReloaded) break;
    await delay(100);
  }
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
  if (parsed.canvasCount !== 1 || parsed.overlayLabel !== 'Rest arc s' || parsed.status === '載入 3D 髮束中' || !parsed.touchTargetsValid || parsed.stageTouchAction !== 'none' || !parsed.rotateVisualChanged || !parsed.pinchVisualChanged || !parsed.indexedDbHistoryValid || !parsed.indexedDbReloaded || !parsed.serviceWorkerControlled || !parsed.offlineCanvasLoaded || parsed.errors.length > 0 || parsed.consoleErrors.length > 0) {
    throw new Error(`Browser smoke failed: ${JSON.stringify(parsed)}`);
  }
  console.log(`Browser smoke passed: canvas=${parsed.canvasCount}, overlay=${parsed.overlayLabel}, touchTargetsValid=${parsed.touchTargetsValid}, stageTouchAction=${parsed.stageTouchAction}, rotateVisualChanged=${parsed.rotateVisualChanged}, pinchVisualChanged=${parsed.pinchVisualChanged}, indexedDbHistoryValid=${parsed.indexedDbHistoryValid}, indexedDbReloaded=${parsed.indexedDbReloaded}, serviceWorkerControlled=${parsed.serviceWorkerControlled}, offlineCanvasLoaded=${parsed.offlineCanvasLoaded}, status=${parsed.status}`);
} finally {
  client?.close();
  await stop(chrome);
  await stop(vite);
  if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
