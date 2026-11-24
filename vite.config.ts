import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Generate a version-pinned, integrity-checked offline shell from actual output. */
function offlineShell(): Plugin {
  return {
    name: 'hair-atelier-offline-shell',
    apply: 'build',
    enforce: 'post',
    async writeBundle(options) {
      const directory = resolve(options.dir ?? 'dist');
      async function filesAt(relative = ''): Promise<string[]> {
        const entries = await readdir(join(directory, relative), { withFileTypes: true });
        const nested = await Promise.all(entries.map(async (entry) => {
          const name = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isDirectory()) return filesAt(name);
          return entry.isFile() && name !== 'sw.js' ? [name] : [];
        }));
        return nested.flat();
      }
      const files = (await filesAt()).sort();
      if (!files.includes('index.html') || !files.includes('manifest.webmanifest') || !files.includes('icon.svg')) {
        throw new Error('Offline shell is missing its HTML, manifest or icon');
      }
      const workerPath = join(directory, 'sw.js');
      const worker = await readFile(workerPath);
      const integrity: Record<string, string> = {};
      const assetUrl = (file: string) => `./${file.split('/').map(encodeURIComponent).join('/')}`;
      for (const file of files) {
        const bytes = await readFile(join(directory, file));
        integrity[assetUrl(file)] = `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
      }
      integrity['./'] = integrity['./index.html'];
      const paths = ['./', ...files.map(assetUrl)];
      const marker = '__HAIR_VERSION_PLACEHOLDER__';
      const header = `self.__HAIR_BUILD_VERSION__ = ${JSON.stringify(marker)};\n` +
        `self.__HAIR_PRECACHE_URLS__ = ${JSON.stringify(paths)};\n` +
        `self.__HAIR_PRECACHE_INTEGRITY__ = ${JSON.stringify(integrity)};\n`;
      const template = header + worker.toString('utf8');
      const version = createHash('sha256').update(template).digest('hex').slice(0, 20);
      await writeFile(workerPath, template.replace(JSON.stringify(marker), JSON.stringify(version)));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [offlineShell()],
  build: { target: 'es2022' },
});
