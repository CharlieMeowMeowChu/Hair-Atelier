// Production builds inject a content-derived version and complete shell list.
// The development worker keeps an empty list and uses runtime caching.
const scopeUrl = new URL(self.registration.scope);
const CACHE_PREFIX = `hair-atelier-shell-${encodeURIComponent(scopeUrl.pathname)}-`;
const CACHE = `${CACHE_PREFIX}${self.__HAIR_BUILD_VERSION__ ?? 'dev'}`;
const precachePaths = self.__HAIR_PRECACHE_URLS__ ?? [];
const precacheIntegrity = self.__HAIR_PRECACHE_INTEGRITY__ ?? {};
const precacheUrls = precachePaths.map((path) => new URL(path, scopeUrl).href);
const precacheSet = new Set(precacheUrls);
const shellUrl = new URL('./index.html', scopeUrl).href;

function validShellResponse(url, response) {
  if (!response.ok || response.redirected) return false;
  const path = new URL(url).pathname;
  const type = response.headers.get('content-type') ?? '';
  if (path.endsWith('/') || path.endsWith('.html')) return /\btext\/html\b/i.test(type);
  if (path.endsWith('.js')) return /(?:java|ecma)script/i.test(type);
  if (path.endsWith('.css')) return /\btext\/css\b/i.test(type);
  if (path.endsWith('.svg')) return /\bimage\/svg\+xml\b/i.test(type);
  if (path.endsWith('.webmanifest')) return /(?:manifest\+json|application\/json)/i.test(type);
  return true;
}

async function matchesIntegrity(response, expected) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer()));
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}` === expected;
}

// Report readiness only for this worker's complete, verified production shell.
// Browsers can evict Cache Storage after installation, so recheck on request.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'HAIR_OFFLINE_STATUS_REQUEST' || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    let ready = false;
    try {
      const required = ['./', './index.html', './manifest.webmanifest', './icon.svg'];
      const hasShell = required.every((path) => precachePaths.includes(path)) &&
        precachePaths.some((path) => path.endsWith('.js')) && precachePaths.some((path) => path.endsWith('.css'));
      if (hasShell && (await caches.keys()).includes(CACHE)) {
        const cache = await caches.open(CACHE);
        const responses = await Promise.all(precacheUrls.map((url) => cache.match(url, { ignoreVary: true })));
        ready = responses.every((response, index) => response && validShellResponse(precacheUrls[index], response)) &&
          (await Promise.all(responses.map((response, index) => matchesIntegrity(response, precacheIntegrity[precachePaths[index]])))).every(Boolean);
      }
    } catch { /* Missing, unreadable or incomplete cache is not ready. */ }
    event.ports[0].postMessage({ type: 'HAIR_OFFLINE_STATUS', ready });
  })());
});

self.addEventListener('install', (event) => event.waitUntil((async () => {
  if (precachePaths.some((path) => !/^sha256-[A-Za-z0-9+/]{43}=$/.test(precacheIntegrity[path] ?? ''))) {
    throw new Error('Offline shell integrity information is missing');
  }
  const alreadyExists = (await caches.keys()).includes(CACHE);
  let cache = await caches.open(CACHE);
  if (alreadyExists) {
    // Reuse a same-name shell only after checking all of its bytes. An active
    // or waiting worker may rely on it, so never overwrite or delete it.
    let complete = false;
    try {
      const existing = await Promise.all(precacheUrls.map((url) => cache.match(url, { ignoreVary: true })));
      complete = existing.every((response, index) => response && validShellResponse(precacheUrls[index], response)) &&
        (await Promise.all(existing.map((response, index) => matchesIntegrity(response, precacheIntegrity[precachePaths[index]])))).every(Boolean);
    } catch { /* An unreadable shell is incomplete. */ }
    if (complete) return;
    if (self.registration.active || self.registration.waiting) {
      throw new Error('Existing offline shell is incomplete');
    }
    // A first install interrupted before activation can leave an orphaned
    // partial cache. With no active or waiting worker, it is safe to rebuild.
    await caches.delete(CACHE);
    cache = await caches.open(CACHE);
  }
  try {
    // Fetch everything before writing so a partial or redirected deployment
    // cannot become the next active offline shell.
    const requests = precacheUrls.map((url, index) => new Request(url, {
      cache: 'reload', redirect: 'error', integrity: precacheIntegrity[precachePaths[index]] ?? '',
    }));
    const responses = await Promise.all(requests.map((request) => fetch(request)));
    if (responses.some((response, index) => !validShellResponse(requests[index].url, response))) {
      throw new Error('Incomplete or invalid offline shell');
    }
    await Promise.all(requests.map((request, index) => cache.put(request, responses[index])));
  } catch (error) {
    await caches.delete(CACHE);
    throw error;
  }
  // Do not skip waiting: older controlled tabs may still need their old shell.
})()));

self.addEventListener('activate', (event) => event.waitUntil(
  caches.keys()
    .then((names) => Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE).map((name) => caches.delete(name))))
    .then(() => self.clients.claim()),
));

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const cachePromise = caches.open(CACHE);

  // The production shell and its hashed assets remain from one build while
  // an update waits for existing controlled tabs to close. These bytes were
  // integrity-checked at install, so Vary: Origin cannot select different
  // content from this version-pinned shell cache.
  if (precacheUrls.length && event.request.mode === 'navigate') {
    event.respondWith(cachePromise.then(async (cache) => (await cache.match(shellUrl, { ignoreVary: true })) ?? fetch(event.request)));
    return;
  }
  if (precacheSet.has(event.request.url)) {
    event.respondWith(cachePromise.then(async (cache) => (await cache.match(event.request, { ignoreVary: true })) ?? fetch(event.request)));
    return;
  }

  // Register background work synchronously. A cached offline asset still
  // succeeds; an uncached one propagates the network failure to the caller.
  const network = fetch(event.request).then((response) => ({ response, copy: response.ok ? response.clone() : undefined }));
  event.waitUntil(Promise.all([network, cachePromise])
    .then(([result, cache]) => result.copy ? cache.put(event.request, result.copy) : undefined)
    .catch(() => undefined));
  if (event.request.mode === 'navigate') {
    event.respondWith(network.then((result) => result.response).catch(async () => (await cachePromise).match(event.request)));
  } else {
    event.respondWith(cachePromise.then(async (cache) => (await cache.match(event.request)) ?? (await network).response));
  }
});
