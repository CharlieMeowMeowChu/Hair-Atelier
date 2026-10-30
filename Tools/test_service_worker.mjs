import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const listeners = new Map();
const storage = new Map();
const cacheNames = new Set(['hair-atelier-shell-v1']);
const cache = {
  put: async (request, response) => storage.set(request.url, response.clone()),
};
const caches = {
  keys: async () => [...cacheNames],
  delete: async (name) => cacheNames.delete(name),
  open: async (name) => { cacheNames.add(name); return cache; },
  match: async (request) => storage.get(request.url)?.clone(),
};
let fetchResponse = new Response('network', { status: 200 });
let fetchFails = false;
const sandbox = {
  URL,
  caches,
  fetch: async () => {
    if (fetchFails) throw new Error('offline');
    return fetchResponse.clone();
  },
  self: {
    location: { origin: 'https://hair.test' },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
    addEventListener: (name, listener) => listeners.set(name, listener),
  },
};
vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), sandbox, { filename: 'public/sw.js' });

const triggerFetch = async (request) => {
  let response;
  const pending = [];
  listeners.get('fetch')({ request, respondWith: (promise) => { response = promise; }, waitUntil: (promise) => pending.push(promise) });
  const resolved = await response;
  await Promise.all(pending);
  return resolved;
};
const navigation = (path) => {
  const request = new Request(`https://hair.test${path}`);
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  return request;
};

const activation = [];
listeners.get('activate')({ waitUntil: (promise) => activation.push(promise) });
await Promise.all(activation);
if (cacheNames.has('hair-atelier-shell-v1')) throw new Error('Old cache was not deleted during activation');

const firstNavigation = navigation('/');
if (await (await triggerFetch(firstNavigation)).text() !== 'network') throw new Error('Navigation did not use network response');
if (await (await caches.match(firstNavigation)).text() !== 'network') throw new Error('Navigation response was not cached');

fetchFails = true;
if (await (await triggerFetch(firstNavigation)).text() !== 'network') throw new Error('Offline navigation did not fall back to cache');
fetchFails = false;

const asset = new Request('https://hair.test/icon.svg');
storage.set(asset.url, new Response('cached-icon', { status: 200 }));
fetchResponse = new Response('fresh-icon', { status: 200 });
if (await (await triggerFetch(asset)).text() !== 'cached-icon') throw new Error('Static asset did not return cached response');
if (await (await caches.match(asset)).text() !== 'fresh-icon') throw new Error('Static asset was not refreshed in cache');

console.log('Service worker behavior check passed');
