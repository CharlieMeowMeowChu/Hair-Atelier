import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// This exercise uses an isolated origin/profile and an in-memory server; no
// generated build files, application storage or remote deployments are changed.
const root = resolve('dist');
const originalWorker = await readFile(join(root, 'sw.js'), 'utf8');
const originalHtml = await readFile(join(root, 'index.html'));
const header = originalWorker.match(/^self\.__HAIR_BUILD_VERSION__ = "([^"]+)";\nself\.__HAIR_PRECACHE_URLS__ = (.+);\nself\.__HAIR_PRECACHE_INTEGRITY__ = (.+);/);
if (!header) throw new Error('Production worker metadata missing; run npm run build');
const precache = JSON.parse(header[2]);
const integrity = JSON.parse(header[3]);
const jsAsset = precache.find((p) => p.startsWith('./assets/') && p.endsWith('.js'));
if (!jsAsset) throw new Error('No production JS asset in the precache manifest');
const updatedHtml = Buffer.from(originalHtml.toString('utf8').replace('</head>', '<meta name="hair-update-test" content="build-b" /></head>'));
const updatedDigest = `sha256-${createHash('sha256').update(updatedHtml).digest('base64')}`;
const nextIntegrity = { ...integrity, './': updatedDigest, './index.html': updatedDigest };
const badWorker = originalWorker.replace(header[1], `bad-${header[1]}`);
const newWorker = originalWorker.replace(header[1], `new-${header[1]}`).replace(header[3], JSON.stringify(nextIntegrity));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
let deployment = 'old';
const server = createHttpServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://local.test').pathname;
    if (!pathname.startsWith('/atelier/')) { res.writeHead(404).end(); return; }
    const relative = pathname.slice('/atelier/'.length) || 'index.html';
    if (relative.includes('..')) { res.writeHead(400).end(); return; }
    let data;
    if (relative === 'sw.js') data = Buffer.from(deployment === 'old' ? originalWorker : deployment === 'bad' ? badWorker : newWorker);
    else if (relative === 'index.html') data = deployment === 'new' ? updatedHtml : originalHtml;
    else {
      data = await readFile(join(root, relative));
      if (deployment === 'bad' && `./${relative}` === jsAsset) data = Buffer.concat([data, Buffer.from('\n/* deliberately altered */')]);
    }
    res.writeHead(200, { 'Content-Type': mime[extname(relative)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolveServer, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolveServer));
const appUrl = `http://127.0.0.1:${server.address().port}/atelier/`;
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
async function freePort() {
  const probe = createNetServer();
  await new Promise((ok, fail) => probe.once('error', fail).listen(0, '127.0.0.1', ok));
  const port = probe.address().port;
  await new Promise((ok, fail) => probe.close((e) => e ? fail(e) : ok()));
  return port;
}
const debugPort = await freePort(), debugUrl = `http://127.0.0.1:${debugPort}`;
async function waitFor(url) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) { try { const r = await fetch(url); if (r.ok) return r; } catch { /* Chrome starting */ } await delay(100); }
  throw new Error(`Timed out waiting for ${url}`);
}
class CDP {
  constructor(url) { this.url = url; this.next = 1; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((ok, fail) => { this.socket.addEventListener('open', ok, { once: true }); this.socket.addEventListener('error', fail, { once: true }); });
    this.socket.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)), item = this.pending.get(msg.id);
      if (!item) return;
      this.pending.delete(msg.id); if (msg.error) item.reject(new Error(msg.error.message)); else item.resolve(msg.result);
    });
  }
  command(method, params = {}) {
    const id = this.next++;
    return new Promise((resolveCommand, reject) => { this.pending.set(id, { resolve: resolveCommand, reject }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  close() { this.socket?.close(); }
}
async function attach(targetId) {
  const target = (await (await waitFor(`${debugUrl}/json/list`)).json()).find((t) => t.id === targetId);
  if (!target?.webSocketDebuggerUrl) throw new Error(`Missing browser target ${targetId}`);
  const c = new CDP(target.webSocketDebuggerUrl); await c.connect(); await c.command('Runtime.enable'); await c.command('Page.enable'); return c;
}
async function evaluate(c, expression) {
  const r = await c.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function until(c, expr, label) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) { try { if (await evaluate(c, expr)) return; } catch { /* navigating */ } await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
const savedText = `new Promise((ok,fail)=>{const q=indexedDB.open('hair-atelier',1);q.onerror=()=>fail(q.error);q.onsuccess=()=>{const db=q.result,r=db.transaction('editor-history','readonly').objectStore('editor-history').get('current-v4');r.onsuccess=()=>{db.close();ok(r.result)};r.onerror=()=>fail(r.error)}})`;
const update = `(async()=>{const r=await navigator.serviceWorker.getRegistration();window.__swStates=[];r.addEventListener('updatefound',()=>{const w=r.installing;if(w)w.addEventListener('statechange',()=>window.__swStates.push(w.state));});await r.update();return true;})()`;
const profile = await mkdtemp(join(tmpdir(), 'hair-sw-update-'));
const chrome = spawn(process.env.CHROMIUM_BIN ?? 'chromium', ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-extensions','--no-first-run',`--user-data-dir=${profile}`,'--use-angle=swiftshader','--enable-webgl',`--remote-debugging-port=${debugPort}`,'about:blank'], { stdio:'ignore', detached:true });
let control, old, extra, newer;
try {
  const targets = await (await waitFor(`${debugUrl}/json/list`)).json();
  control = await attach(targets.find((t) => t.type === 'page').id);
  const oldTarget = (await control.command('Target.createTarget', { url: appUrl })).targetId;
  old = await attach(oldTarget);
  await until(old, "!!document.querySelector('#stage canvas') && !!navigator.serviceWorker.controller && !document.querySelector('#save').disabled", 'initial shell');
  await until(old, "document.querySelector('#offline-status')?.dataset.state === 'ready'", 'original shell readiness');
  await evaluate(old, "document.querySelector('#save').click()");
  await until(old, "document.querySelector('#status')?.textContent.includes('已儲存到本機瀏覽器')", 'save');
  const saved = await evaluate(old, savedText);
  if (!saved) throw new Error('Original history was not saved');
  const oldCaches = await evaluate(old, 'caches.keys()');
  const oldName = oldCaches.find((n) => n.endsWith(header[1]));
  if (!oldName) throw new Error('Original version cache missing');

  deployment = 'bad';
  await evaluate(old, update);
  await until(old, "window.__swStates.includes('redundant')", 'bad SRI worker rejected');
  const badCheck = await evaluate(old, `(async()=>({waiting:!!(await navigator.serviceWorker.getRegistration()).waiting,caches:await caches.keys(),saved:await (${savedText})}))()`);
  if (badCheck.waiting || !badCheck.caches.includes(oldName) || badCheck.caches.some((n) => n.includes('bad-')) || badCheck.saved !== saved) throw new Error(`Failed SRI update affected active cache or history: ${JSON.stringify(badCheck)}`);
  await until(old, "document.querySelector('#offline-status')?.dataset.state === 'ready'", 'existing shell remains ready after rejected update');
  if (await evaluate(old, "document.querySelector('#offline-status').textContent.includes('更新')")) throw new Error('Rejected update was reported as ready to apply');

  deployment = 'new';
  await evaluate(old, update);
  await until(old, "navigator.serviceWorker.getRegistration().then(r=>!!r.waiting)", 'new worker waiting');
  await until(old, "document.querySelector('#offline-status')?.dataset.state === 'waiting'", 'old shell readiness with waiting update');
  if (!(await evaluate(old, "document.querySelector('#offline-status').textContent.includes('離線') && document.querySelector('#offline-status').textContent.includes('更新')"))) throw new Error('Waiting status does not distinguish old shell readiness and update');
  await old.command('Page.navigate', { url: `${appUrl}?old-client=1` });
  await until(old, "!!document.querySelector('#stage canvas') && !document.querySelector('#save').disabled", 'old page after reload');
  await until(old, "document.querySelector('#offline-status')?.dataset.state === 'waiting'", 'waiting status after old page reload');
  if (await evaluate(old, "!!document.querySelector('meta[name=hair-update-test]')") || await evaluate(old, savedText) !== saved) throw new Error('Old controlled page mixed in the new shell or changed history');
  const extraTarget = (await control.command('Target.createTarget', { url: appUrl })).targetId;
  extra = await attach(extraTarget);
  await until(extra, "!!document.querySelector('#stage canvas') && !!navigator.serviceWorker.controller", 'second old controlled tab');
  await until(extra, "document.querySelector('#offline-status')?.dataset.state === 'waiting'", 'waiting status in second old tab');
  if (await evaluate(extra, "!!document.querySelector('meta[name=hair-update-test]')")) throw new Error('New tab switched before old controlled tabs closed');
  await control.command('Target.closeTarget', { targetId: oldTarget }); old.close(); old = undefined;
  await control.command('Target.closeTarget', { targetId: extraTarget }); extra.close(); extra = undefined;
  await delay(800);
  const newTarget = (await control.command('Target.createTarget', { url: appUrl })).targetId;
  newer = await attach(newTarget);
  await until(newer, "!!document.querySelector('#stage canvas') && !!navigator.serviceWorker.controller && !document.querySelector('#save').disabled", 'new worker page');
  await until(newer, "document.querySelector('#offline-status')?.dataset.state === 'ready'", 'new active shell readiness');
  if (!(await evaluate(newer, "!!document.querySelector('meta[name=hair-update-test]')"))) throw new Error('New shell did not activate after old tabs closed');
  if (await evaluate(newer, savedText) !== saved) throw new Error('Worker update changed saved history');
  const remainingCaches = await evaluate(newer, 'caches.keys()');
  if (remainingCaches.includes(oldName) || !remainingCaches.some((n) => n.endsWith(`new-${header[1]}`))) throw new Error('Activation did not replace the previous scoped cache');
  await new Promise((ok, fail) => server.close((e) => e ? fail(e) : ok()));
  await newer.command('Network.enable'); await newer.command('Network.setCacheDisabled', { cacheDisabled: true });
  await newer.command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const navigation = await newer.command('Page.navigate', { url: appUrl });
  if (navigation.errorText) throw new Error(`Updated shell failed offline: ${navigation.errorText}`);
  await until(newer, "!!document.querySelector('#stage canvas') && !document.querySelector('#save').disabled && !!document.querySelector('meta[name=hair-update-test]')", 'updated shell offline');
  await until(newer, "document.querySelector('#offline-status')?.dataset.state === 'ready'", 'updated shell offline readiness');
  if (await evaluate(newer, savedText) !== saved) throw new Error('Offline updated shell did not retain history');
  console.log('Service-worker update smoke passed: subpath, SRI rejection, readiness UI, waiting tabs, activation and offline history');
} finally {
  old?.close(); extra?.close(); newer?.close(); control?.close();
  if (server.listening) await new Promise((ok) => server.close(ok));
  if (chrome.exitCode === null && chrome.signalCode === null) { try { process.kill(-chrome.pid, 'SIGTERM'); } catch { chrome.kill('SIGTERM'); } await Promise.race([once(chrome, 'exit'), delay(5000)]); }
  await rm(profile, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
}
