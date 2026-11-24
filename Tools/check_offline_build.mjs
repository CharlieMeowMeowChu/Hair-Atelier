import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
const worker = await readFile(join(directory, 'sw.js'), 'utf8');
const readHeader = (name) => {
  const match = worker.match(new RegExp(`^self\\.__HAIR_${name}__ = (.+);$`, 'm'));
  if (!match) throw new Error(`Production worker is missing ${name}`);
  return JSON.parse(match[1]);
};
const version = readHeader('BUILD_VERSION');
const paths = readHeader('PRECACHE_URLS');
const integrity = readHeader('PRECACHE_INTEGRITY');
async function listFiles(relative = '') {
  const entries = await readdir(join(directory, relative), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listFiles(name);
    return entry.isFile() && name !== 'sw.js' ? [name] : [];
  }));
  return nested.flat();
}
const files = (await listFiles()).sort();
const assetUrl = (file) => `./${file.split('/').map(encodeURIComponent).join('/')}`;
const expectedPaths = ['./', ...files.map(assetUrl)];
if (JSON.stringify(paths) !== JSON.stringify(expectedPaths)) throw new Error('Offline shell list does not match production files');
for (const file of files) {
  const bytes = await readFile(join(directory, file));
  const expected = `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
  if (integrity[assetUrl(file)] !== expected) throw new Error(`Offline integrity does not match ${file}`);
}
if (integrity['./'] !== integrity['./index.html']) throw new Error('Offline root does not match index.html');
if (typeof version !== 'string' || !/^[a-f0-9]{20}$/.test(version)) throw new Error('Invalid offline build version');
const firstLine = `self.__HAIR_BUILD_VERSION__ = ${JSON.stringify(version)};`;
if (!worker.startsWith(`${firstLine}\n`)) throw new Error('Offline version header is malformed');
const template = `self.__HAIR_BUILD_VERSION__ = "__HAIR_VERSION_PLACEHOLDER__";` + worker.slice(firstLine.length);
if (version !== createHash('sha256').update(template).digest('hex').slice(0, 20)) throw new Error('Offline build version does not match its worker and manifest');
const bodyStart = worker.indexOf('\n', worker.indexOf('\n', worker.indexOf('\n') + 1) + 1) + 1;
if (worker.slice(bodyStart) !== await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')) throw new Error('Offline worker differs from its source template');
if (!files.includes('index.html') || !files.includes('manifest.webmanifest') || !files.includes('icon.svg') ||
  !files.some((file) => file.endsWith('.js')) || !files.some((file) => file.endsWith('.css'))) {
  throw new Error('Offline shell is missing a required production asset');
}
console.log(`Offline build manifest passed: ${paths.length} integrity-checked shell URLs, version ${version}`);
