import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(process.env.HAIR_SW_SOURCE ?? new URL('../public/sw.js', import.meta.url), 'utf8');
const scope = 'https://hair.test/app/';
const scopePrefix = `hair-atelier-shell-${encodeURIComponent('/app/')}-`;
const otherPrefix = `hair-atelier-shell-${encodeURIComponent('/other/')}-`;
const precache = ['./', './index.html', './assets/app-hash.js', './assets/app-hash.css', './manifest.webmanifest', './icon.svg'];
const address = (value, base = scope) => new URL(typeof value === 'string' ? value : value.url, base).href;
const integrity = Object.fromEntries(precache.map((path) => [path, `sha256-${createHash('sha256').update(`network:${address(path)}`).digest('base64')}`]));
const contentType = (value, base = scope) => {
  const path = new URL(address(value, base)).pathname;
  if (path.endsWith('/') || path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.js')) return 'application/javascript';
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.webmanifest')) return 'application/manifest+json';
  return 'application/octet-stream';
};

function createHarness({ urls, version, hashes, shared = new Map(), scopeUrl = scope, active = false, waiting = false } = {}) {
  const listeners = new Map();
  const requests = [];
  const matchCalls = [];
  let skipCount = 0;
  let claimCount = 0;
  let failPut;
  const sandbox = {
    URL, Request, Response, crypto: webcrypto, btoa,
    self: {
      location: { origin: new URL(scopeUrl).origin, href: new URL('sw.js', scopeUrl).href },
      registration: { scope: scopeUrl, active: active ? {} : null, waiting: waiting ? {} : null },
      __HAIR_PRECACHE_URLS__: urls,
      __HAIR_BUILD_VERSION__: version,
      __HAIR_PRECACHE_INTEGRITY__: hashes,
      skipWaiting: async () => { skipCount += 1; },
      clients: { claim: async () => { claimCount += 1; } },
      addEventListener: (name, listener) => listeners.set(name, listener),
    },
  };
  const makeCache = (name) => {
    if (!shared.has(name)) shared.set(name, new Map());
    const entries = shared.get(name);
    return {
      match: async (request, options) => { matchCalls.push({ name, url: address(request, scopeUrl), options }); return entries.get(address(request, scopeUrl))?.clone(); },
      put: async (request, response) => {
        if (failPut?.(name, address(request, scopeUrl))) throw new Error('Cache.put failed');
        entries.set(address(request, scopeUrl), response.clone());
      },
      delete: async (request) => entries.delete(address(request, scopeUrl)),
      keys: async () => [...entries.keys()].map((url) => new Request(url)),
      add: async (request) => {
        const response = await sandbox.fetch(request);
        if (!response.ok) throw new TypeError('Cache.add failed');
        entries.set(address(request, scopeUrl), response.clone());
      },
      addAll: async (requests) => {
        // Like Cache.addAll, no entries are committed if any fetch fails.
        const results = await Promise.all(requests.map(async (request) => {
          const response = await sandbox.fetch(request);
          if (!response.ok) throw new TypeError('Cache.addAll failed');
          return [address(request, scopeUrl), response.clone()];
        }));
        for (const [key, response] of results) entries.set(key, response);
      },
    };
  };
  sandbox.caches = {
    keys: async () => [...shared.keys()],
    delete: async (name) => shared.delete(name),
    open: async (name) => makeCache(name),
    match: async (request) => {
      for (const name of shared.keys()) {
        const result = await makeCache(name).match(request);
        if (result) return result;
      }
      return undefined;
    },
  };
  sandbox.fetch = async (request) => {
    requests.push({ url: address(request, scopeUrl), integrity: request.integrity });
    return new Response(`network:${address(request, scopeUrl)}`, { status: 200, headers: { 'content-type': contentType(request, scopeUrl) } });
  };
  vm.runInNewContext(source, sandbox, { filename: 'public/sw.js' });
  return { listeners, sandbox, shared, requests, matchCalls, makeCache, setPutFailure: (fn) => { failPut = fn; }, get skipCount() { return skipCount; }, get claimCount() { return claimCount; } };
}

function dispatchLifetime(harness, name) {
  const pending = [];
  const listener = harness.listeners.get(name);
  if (!listener) throw new Error(`Missing ${name} listener`);
  listener({ waitUntil: (promise) => pending.push(Promise.resolve(promise)) });
  return pending;
}
async function triggerFetch(harness, request) {
  let response;
  const pending = [];
  harness.listeners.get('fetch')({ request, respondWith: (promise) => { response = promise; }, waitUntil: (promise) => pending.push(Promise.resolve(promise)) });
  const resolved = await response;
  await Promise.all(pending);
  return resolved;
}
function navigation(url) {
  const request = new Request(url);
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  return request;
}
async function queryOfflineStatus(harness) {
  let reply;
  const pending = [];
  const handler = harness.listeners.get('message');
  if (!handler) throw new Error('Offline readiness message handler is missing');
  handler({ data: { type: 'HAIR_OFFLINE_STATUS_REQUEST' }, ports: [{ postMessage: (value) => { reply = value; } }], waitUntil: (promise) => pending.push(Promise.resolve(promise)) });
  await Promise.all(pending);
  return reply;
}

// Seed another app's cache with the same asset URL so global caches.match()
// would retrieve the wrong response even after this app's old cache is removed.
const shared = new Map();
const prod = createHarness({ urls: precache, hashes: integrity, version: 'build-20261124', shared });
const asset = new Request(new URL('./dynamic.svg', scope));
await prod.makeCache(`${scopePrefix}old`).put(asset, new Response('old app asset'));
await prod.makeCache(`${otherPrefix}other`).put(asset, new Response('other scope asset'));
await prod.makeCache('hair-atelier-shell-v2').put(asset, new Response('unscoped legacy asset'));
const installation = dispatchLifetime(prod, 'install');
if (!installation.length) throw new Error('Production install did not wait for the complete app shell');
await Promise.all(installation);
if (prod.skipCount !== 0) throw new Error('Installing a new worker must not force existing clients to switch');
const currentNames = [...shared.keys()].filter((name) => name.startsWith(scopePrefix) && name !== `${scopePrefix}old`);
if (currentNames.length !== 1) throw new Error(`Expected one versioned cache for this scope, found ${currentNames.length}`);
const current = prod.makeCache(currentNames[0]);
for (const url of precache) {
  const response = await current.match(new Request(new URL(url, scope)));
  if (!response || await response.text() !== `network:${address(url)}`) throw new Error(`Production shell entry missing from current cache: ${url}`);
  const request = prod.requests.find((entry) => entry.url === address(url));
  if (!request || request.integrity !== integrity[url]) throw new Error(`Production shell entry was fetched without its expected integrity: ${url}`);
}
await current.put(asset, new Response(`network:${asset.url}`, { headers: { 'content-type': 'image/svg+xml' } }));
const activation = dispatchLifetime(prod, 'activate');
if (!activation.length) throw new Error('Activation did not wait for cache cleanup');
await Promise.all(activation);
if (shared.has(`${scopePrefix}old`)) throw new Error('Old cache for this scope was not cleaned after successful activation');
if (!shared.has(`${otherPrefix}other`) || !shared.has('hair-atelier-shell-v2')) throw new Error('Activation deleted an unrelated or unscoped cache');
if (!shared.has(currentNames[0])) throw new Error('Activation removed the current production cache');
if (!(await queryOfflineStatus(prod))?.ready) throw new Error('Complete production cache was not reported ready');
const statusAsset = new Request(address('./assets/app-hash.js'));
const savedStatusAsset = await current.match(statusAsset);
await current.delete(statusAsset);
if ((await queryOfflineStatus(prod))?.ready) throw new Error('Missing cache entry was reported ready');
await current.put(statusAsset, new Response('tampered', { headers: { 'content-type': 'application/javascript' } }));
if ((await queryOfflineStatus(prod))?.ready) throw new Error('Tampered cache entry was reported ready');
await current.put(statusAsset, savedStatusAsset);
const callsBeforeNavigation = prod.requests.length;
const cachedNavigation = await triggerFetch(prod, navigation(`${scope}?session=1`));
if (await cachedNavigation.text() !== `network:${address('./index.html')}` || prod.requests.length !== callsBeforeNavigation) {
  throw new Error('Production navigation did not use this build’s cached shell');
}
const staticUrl = address('./assets/app-hash.js');
const cachedStatic = await triggerFetch(prod, new Request(staticUrl));
if (await cachedStatic.text() !== `network:${staticUrl}` || prod.requests.length !== callsBeforeNavigation ||
  !prod.matchCalls.some((call) => call.url === staticUrl && call.options?.ignoreVary === true)) {
  throw new Error('Version-pinned static asset did not use its integrity-checked cache across Vary headers');
}

// A same-name cache may still be in use by another worker. Never overwrite or
// delete it if an update or its installation fails.
const sameShared = new Map();
const same = createHarness({ urls: precache, hashes: integrity, version: 'same-version', shared: sameShared, active: true });
const sameName = `${scopePrefix}same-version`;
await same.makeCache(sameName).put(asset, new Response('active cache remains intact'));
same.sandbox.fetch = async () => { throw new Error('must not fetch into an existing cache'); };
const sameResult = await Promise.allSettled(dispatchLifetime(same, 'install'));
if (!sameResult.some((item) => item.status === 'rejected') || !sameShared.has(sameName) ||
  await (await same.makeCache(sameName).match(asset)).text() !== 'active cache remains intact') {
  throw new Error('Incomplete same-name cache was modified or deleted during install');
}
const waitingShared = new Map();
const waiting = createHarness({ urls: precache, hashes: integrity, version: 'waiting-version', shared: waitingShared, waiting: true });
const waitingName = `${scopePrefix}waiting-version`;
await waiting.makeCache(waitingName).put(asset, new Response('waiting cache remains intact'));
const waitingResult = await Promise.allSettled(dispatchLifetime(waiting, 'install'));
if (!waitingResult.some((item) => item.status === 'rejected') || !waitingShared.has(waitingName) ||
  await (await waiting.makeCache(waitingName).match(asset)).text() !== 'waiting cache remains intact') {
  throw new Error('A cache potentially used by a waiting worker was modified or deleted');
}
const previousFetch = prod.sandbox.fetch;
prod.sandbox.fetch = async () => { throw new Error('must reuse the complete existing cache'); };
const reuse = await Promise.allSettled(dispatchLifetime(prod, 'install'));
if (reuse.some((item) => item.status === 'rejected') || !shared.has(currentNames[0])) throw new Error('Complete existing shell was not safely reused');
prod.sandbox.fetch = previousFetch;

const tamperedShared = new Map();
const tampered = createHarness({ urls: precache, hashes: integrity, version: 'same-version', shared: tamperedShared, active: true });
for (const url of precache) {
  const target = address(url);
  await tampered.makeCache(sameName).put(new Request(target), new Response(`network:${target}`, { headers: { 'content-type': contentType(target) } }));
}
const tamperedUrl = address('./assets/app-hash.js');
await tampered.makeCache(sameName).put(new Request(tamperedUrl), new Response('tampered', { headers: { 'content-type': 'application/javascript' } }));
const tamperedResult = await Promise.allSettled(dispatchLifetime(tampered, 'install'));
if (!tamperedResult.some((item) => item.status === 'rejected') || !tamperedShared.has(sameName) ||
  await (await tampered.makeCache(sameName).match(new Request(tamperedUrl))).text() !== 'tampered') {
  throw new Error('A tampered same-name cache was accepted, modified, or deleted');
}
const noIntegrity = createHarness({ urls: precache, version: 'no-integrity' });
if (!(await Promise.allSettled(dispatchLifetime(noIntegrity, 'install'))).some((item) => item.status === 'rejected')) {
  throw new Error('An offline shell without integrity information was accepted');
}

const orphanShared = new Map();
const orphan = createHarness({ urls: precache, hashes: integrity, version: 'orphan', shared: orphanShared });
const orphanName = `${scopePrefix}orphan`;
await orphan.makeCache(orphanName).put(asset, new Response('interrupted installation'));
const orphanResult = await Promise.allSettled(dispatchLifetime(orphan, 'install'));
if (orphanResult.some((item) => item.status === 'rejected') || orphan.requests.length !== precache.length ||
  await orphan.makeCache(orphanName).match(asset) || !(await orphan.makeCache(orphanName).match(new Request(address('./index.html'))))) {
  throw new Error('Interrupted first installation did not rebuild its orphaned cache');
}

// A failed shell install must not force activation or delete any old cache.
for (const failure of ['network', 'http', 'mime', 'redirect', 'put']) {
  const isolated = new Map();
  const broken = createHarness({ urls: precache, hashes: integrity, version: `bad-${failure}`, shared: isolated });
  await broken.makeCache(`${scopePrefix}old`).put(asset, new Response('preserved'));
  await broken.makeCache(`${otherPrefix}other`).put(asset, new Response('other'));
  if (failure === 'put') broken.setPutFailure((name, url) => name !== `${scopePrefix}old` && url.endsWith('/assets/app-hash.js'));
  broken.sandbox.fetch = async (request) => {
    if (address(request).endsWith('/assets/app-hash.js')) {
      if (failure === 'network') throw new Error('offline while installing');
      if (failure === 'http') return new Response('missing', { status: 404, headers: { 'content-type': contentType(request) } });
      if (failure === 'mime') return new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      if (failure === 'redirect') {
        const redirected = new Response('login', { headers: { 'content-type': contentType(request) } });
        Object.defineProperty(redirected, 'redirected', { value: true });
        return redirected;
      }
    }
    return new Response('ok', { headers: { 'content-type': contentType(request) } });
  };
  const pending = dispatchLifetime(broken, 'install');
  if (!pending.length) throw new Error(`Failed ${failure} install did not register waitUntil`);
  const results = await Promise.allSettled(pending);
  if (!results.some((result) => result.status === 'rejected')) throw new Error(`Failed ${failure} install was accepted`);
  if (broken.skipCount !== 0) throw new Error(`Failed ${failure} install forced activation`);
  if ([...isolated.keys()].some((name) => name.startsWith(scopePrefix) && name !== `${scopePrefix}old`)) throw new Error(`Failed ${failure} install retained an incomplete new cache`);
  if (await (await broken.makeCache(`${scopePrefix}old`).match(asset)).text() !== 'preserved' || !isolated.has(`${otherPrefix}other`)) {
    throw new Error(`Failed ${failure} install removed an existing cache`);
  }
}

// Runtime navigation caching remains available in development without a
// production-injected precache manifest.
const dev = createHarness();
if ((await queryOfflineStatus(dev))?.ready) throw new Error('Development runtime cache was reported as a complete offline shell');
const firstNavigation = navigation('https://hair.test/app/');
if (await (await triggerFetch(dev, firstNavigation)).text() !== `network:${scope}`) throw new Error('Navigation did not use network response');
dev.sandbox.fetch = async () => { throw new Error('offline navigation'); };
if (await (await triggerFetch(dev, firstNavigation)).text() !== `network:${scope}`) throw new Error('Offline navigation did not use its cached response');

// Cached static responses must not return a same-origin cache belonging to a
// different scope, and their background update must keep the worker alive.
const unhandled = [];
const onUnhandled = (reason) => unhandled.push(reason);
process.on('unhandledRejection', onUnhandled);
try {
  let rejectRefresh;
  const refresh = new Promise((_, reject) => { rejectRefresh = reject; });
  prod.sandbox.fetch = () => refresh;
  const pending = [];
  let response;
  prod.listeners.get('fetch')({ request: asset, respondWith: (promise) => { response = promise; }, waitUntil: (promise) => pending.push(Promise.resolve(promise)) });
  const registeredBeforeReturn = pending.length > 0;
  if (await (await response).text() !== `network:${asset.url}`) throw new Error('Cached static asset came from the wrong scope or version');
  let completed = false;
  const background = Promise.allSettled(pending).then((results) => { completed = true; return results; });
  await new Promise((resolve) => setImmediate(resolve));
  const stayedPending = !completed;
  rejectRefresh(new Error('offline background refresh'));
  const results = await background;
  await new Promise((resolve) => setImmediate(resolve));
  const failures = [];
  if (!registeredBeforeReturn) failures.push('refresh was not registered with waitUntil during the fetch event');
  if (!stayedPending) failures.push('waitUntil did not remain pending until the refresh completed');
  if (results.some((result) => result.status === 'rejected')) failures.push('offline background refresh rejected waitUntil');
  if (unhandled.length) failures.push('offline background refresh produced an unhandled rejection');
  prod.sandbox.fetch = async () => { throw new Error('offline missing asset'); };
  let missingFailed = false;
  try { await triggerFetch(prod, new Request(new URL('./missing.svg', scope))); }
  catch { missingFailed = true; }
  if (!missingFailed) failures.push('an uncached offline asset did not fail');
  if (failures.length) throw new Error(failures.join('; '));
} finally {
  process.off('unhandledRejection', onUnhandled);
}
console.log('Service worker behavior check passed');
