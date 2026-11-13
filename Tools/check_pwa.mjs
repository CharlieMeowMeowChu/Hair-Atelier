import { readFileSync, existsSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const html = read('index.html');

if (manifest.display !== 'standalone' || manifest.lang !== 'zh-Hant') throw new Error('PWA manifest display or language is invalid');
if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) throw new Error('PWA manifest has no icon');
for (const icon of manifest.icons) {
  if (typeof icon.src !== 'string' || !icon.src.startsWith('./')) throw new Error('PWA icon source must be a local relative path');
  if (!existsSync(new URL(`../public/${icon.src.slice(2)}`, import.meta.url))) throw new Error(`PWA icon is missing: ${icon.src}`);
}
if (!html.includes('rel="manifest"') || !html.includes('rel="icon"') || !html.includes('rel="apple-touch-icon"')) {
  throw new Error('HTML is missing manifest or icon link');
}
if (!html.includes('name="apple-mobile-web-app-capable"') || !html.includes('name="apple-mobile-web-app-status-bar-style"')) {
  throw new Error('HTML is missing iOS standalone metadata');
}
if (!existsSync(new URL('../public/sw.js', import.meta.url))) throw new Error('Service worker is missing');
console.log('PWA shell check passed');
