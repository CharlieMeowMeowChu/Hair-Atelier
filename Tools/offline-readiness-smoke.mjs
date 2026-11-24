import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Exercise real production assets, a disposable origin and browser profiles.
const root = resolve('dist');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
async function freePort() {
  const server = createNetServer();
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  await new Promise((ok, fail) => server.close((error) => error ? fail(error) : ok()));
  return port;
}
async function waitFor(url) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return response; } catch { /* starting */ }
    await delay(100);
  }
  throw new Error(`Timed out starting ${url}`);
}
class CDP {
  constructor(url) { this.url = url; this.next = 1; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((ok, fail) => { this.socket.addEventListener('open', ok, { once: true }); this.socket.addEventListener('error', fail, { once: true }); });
    this.socket.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)), item = this.pending.get(msg.id);
      if (!item) return;
      this.pending.delete(msg.id);
      if (msg.error) item.reject(new Error(msg.error.message)); else item.resolve(msg.result);
    });
  }
  command(method, params = {}) {
    const id = this.next++;
    return new Promise((ok, fail) => { this.pending.set(id, { resolve: ok, reject: fail }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  close() { this.socket?.close(); }
}
async function evaluate(client, expression) {
  const result = await client.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function until(client, expression, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await evaluate(client, expression)) return; } catch { /* navigation can replace context */ }
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  await Promise.race([once(child, 'exit'), delay(5000)]);
}
async function runScenario(mode) {
  let gate = mode === 'slow';
  const delayed = new Set();
  const server = createHttpServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://local.test').pathname;
      if (!pathname.startsWith('/atelier/')) { res.writeHead(404).end(); return; }
      const relative = decodeURIComponent(pathname.slice('/atelier/'.length)) || 'index.html';
      if (relative.includes('..')) { res.writeHead(400).end(); return; }
      let data = await readFile(join(root, relative));
      // A valid JS comment allows the page to execute while the worker's SRI
      // rejects a byte-different production shell.
      if (mode === 'bad' && relative.startsWith('assets/') && relative.endsWith('.js')) data = Buffer.concat([data, Buffer.from('\n/* corrupt worker integrity */')]);
      if (gate && relative === 'icon.svg') {
        delayed.add(res);
        res.once('close', () => delayed.delete(res));
        await new Promise((release) => { res.releaseDelayedResponse = release; });
      }
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': mime[extname(relative)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch { if (!res.headersSent && !res.destroyed) res.writeHead(404).end(); }
  });
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
  const appUrl = `http://127.0.0.1:${server.address().port}/atelier/`;
  const debugPort = await freePort(), debugUrl = `http://127.0.0.1:${debugPort}`;
  const profile = await mkdtemp(join(tmpdir(), `hair-offline-ready-${mode}-`));
  const chrome = spawn(process.env.CHROMIUM_BIN ?? 'chromium', ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-extensions','--no-first-run',`--user-data-dir=${profile}`,'--use-angle=swiftshader','--enable-webgl',`--remote-debugging-port=${debugPort}`,'about:blank'], { stdio: 'ignore', detached: true });
  let client;
  try {
    let target;
    const targetDeadline = Date.now() + 15_000;
    while (!target && Date.now() < targetDeadline) {
      target = (await (await waitFor(`${debugUrl}/json/list`)).json()).find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
      if (!target) await delay(100);
    }
    if (!target) throw new Error('Chromium did not expose a page target');
    client = new CDP(target.webSocketDebuggerUrl);
    await client.connect();
    await client.command('Runtime.enable');
    await client.command('Page.enable');
    await client.command('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
    await client.command('Page.navigate', { url: appUrl });
    await until(client, "!!document.querySelector('#stage canvas') && !document.querySelector('#save')?.disabled", `${mode} app startup`);
    const ui = `document.querySelector('#offline-status')`;
    if (mode === 'slow') {
      await until(client, `${ui}?.dataset.state === 'preparing'`, 'first install preparing', 6_000);
      if (!(await evaluate(client, `${ui}.getBoundingClientRect().height > 0 && ${ui}.textContent.trim().length > 0`))) throw new Error('Preparing status is not visible');
      const gateDeadline = Date.now() + 10_000;
      while (!delayed.size && Date.now() < gateDeadline) await delay(100);
      if (!delayed.size) throw new Error('Expected shell resource was not delayed');
      gate = false;
      for (const response of delayed) response.releaseDelayedResponse?.();
      await until(client, `${ui}?.dataset.state === 'ready' && !!navigator.serviceWorker.controller`, 'installed shell ready');
      if (!(await evaluate(client, `${ui}.getBoundingClientRect().height > 0 && ${ui}.textContent.trim().length > 0`))) throw new Error('Ready status is not visible');
      if (!(await evaluate(client, 'document.documentElement.scrollHeight <= window.innerHeight'))) throw new Error('Offline indicator makes phone layout scroll');
      // Losing the version cache must not retain a stale ready indication.
      await evaluate(client, `(async () => { for (const name of await caches.keys()) if (name.startsWith('hair-atelier-shell-')) await caches.delete(name); })()`);
      await evaluate(client, "window.dispatchEvent(new Event('offline'))");
      await until(client, `${ui}?.dataset.state === 'unavailable'`, 'cache removal must be noticed on offline event');
      await client.command('Page.reload');
      await until(client, `${ui}?.dataset.state === 'unavailable'`, 'deleted cache must not report ready');
    } else {
      await until(client, `${ui}?.dataset.state === 'unavailable'`, 'failed integrity installation must not report ready');
      if (await evaluate(client, '!!navigator.serviceWorker.controller')) throw new Error('Failed first installation unexpectedly controls the page');
    }
  } finally {
    gate = false;
    for (const response of delayed) response.releaseDelayedResponse?.();
    client?.close();
    await stop(chrome);
    if (server.listening) await new Promise((ok) => server.close(ok));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
await runScenario('slow');
await runScenario('bad');
console.log('Offline readiness smoke passed: preparing, ready, deleted cache and failed first install');
