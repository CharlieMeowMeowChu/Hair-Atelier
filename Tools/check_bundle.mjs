import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const assetDirectory = new URL('../dist/assets/', import.meta.url);
const scripts = readdirSync(assetDirectory).filter((name) => name.endsWith('.js'));
if (scripts.length === 0) throw new Error('Production JavaScript bundle is missing');

const bundles = scripts.map((name) => {
  const contents = readFileSync(new URL(name, assetDirectory));
  return { name, bytes: contents.length, gzipBytes: gzipSync(contents).length };
});
const largest = bundles.reduce((current, candidate) => candidate.gzipBytes > current.gzipBytes ? candidate : current);
const gzipBudget = 150 * 1024;
const rawBudget = 600 * 1024;
if (largest.gzipBytes > gzipBudget || largest.bytes > rawBudget) {
  throw new Error(`Largest bundle ${largest.name} is ${largest.bytes} B / ${largest.gzipBytes} B gzip; budget is ${rawBudget} B / ${gzipBudget} B gzip`);
}
console.log(`Bundle budget passed: ${largest.name} ${largest.bytes} B / ${largest.gzipBytes} B gzip`);
