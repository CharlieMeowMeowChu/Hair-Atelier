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
      errors: globalThis.__hairAtelierSmokeErrors ?? [],
    })`);
    const parsed = JSON.parse(state);
    if (parsed.canvasCount === 1 && parsed.overlayLabel === 'Rest arc s' && parsed.status !== '載入 3D 髮束中') break;
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
  parsed.consoleErrors = consoleErrors;
  if (parsed.canvasCount !== 1 || parsed.overlayLabel !== 'Rest arc s' || parsed.status === '載入 3D 髮束中' || !parsed.rotateVisualChanged || parsed.errors.length > 0 || parsed.consoleErrors.length > 0) {
    throw new Error(`Browser smoke failed: ${JSON.stringify(parsed)}`);
  }
  console.log(`Browser smoke passed: canvas=${parsed.canvasCount}, overlay=${parsed.overlayLabel}, rotateVisualChanged=${parsed.rotateVisualChanged}, status=${parsed.status}`);
} finally {
  client?.close();
  await stop(chrome);
  await stop(vite);
  if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
